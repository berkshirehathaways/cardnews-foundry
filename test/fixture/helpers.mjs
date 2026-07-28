import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const verifierPath = path.join(repositoryRoot, "scripts", "verify-fixture.mjs");

export const readJson = async (root, relativePath) =>
  JSON.parse(await readFile(path.join(root, relativePath), "utf8"));

export const writeJson = async (root, relativePath, value) =>
  writeFile(path.join(root, relativePath), JSON.stringify(value), "utf8");

const canonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
};

export const writeCanonicalJson = async (root, relativePath, value) => {
  const bytes = Buffer.from(JSON.stringify(canonicalValue(value)));
  await writeFile(path.join(root, relativePath), bytes);
  return bytes;
};

export const makeFixtureCopy = async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cardnews-fixture-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all([
    cp(path.join(repositoryRoot, "fixtures"), path.join(root, "fixtures"), { recursive: true }),
    cp(path.join(repositoryRoot, "schemas"), path.join(root, "schemas"), { recursive: true }),
    cp(path.join(repositoryRoot, "targets"), path.join(root, "targets"), { recursive: true }),
    cp(path.join(repositoryRoot, "themes"), path.join(root, "themes"), { recursive: true }),
    cp(path.join(repositoryRoot, "fonts"), path.join(root, "fonts"), { recursive: true })
  ]);
  return root;
};

export const runVerifier = (cwd = repositoryRoot, fixtureRoot = "fixtures/synthetic") => {
  const result = spawnSync(process.execPath, [verifierPath, fixtureRoot], {
    cwd,
    encoding: "utf8",
    timeout: 15_000
  });
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    report = { ok: false, errors: [{ code: "UNPARSEABLE_OUTPUT", subject: result.stdout }] };
  }
  return { ...result, report };
};

export const errorCodes = (result) =>
  new Set((result.report.errors ?? []).map((error) => error.code));

export const manifest = async (root) =>
  readJson(root, "fixtures/synthetic/manifest.json");

export const stageEntry = (fixtureManifest, stage) => {
  const entry = fixtureManifest.records.find((candidate) => candidate.stage === stage);
  if (entry === undefined) throw new Error(`stage missing from test fixture: ${stage}`);
  return entry;
};

export const mutateRecord = async (root, stage, mutate) => {
  const fixtureManifest = await manifest(root);
  const entry = stageEntry(fixtureManifest, stage);
  const record = await readJson(root, entry.path);
  mutate(record);
  await writeJson(root, entry.path, record);
};

export const resealRecordChain = async (root, rawSerialization = undefined) => {
  const fixtureManifest = await manifest(root);
  const digests = new Map([
    [fixtureManifest.source.key, fixtureManifest.source.sha256],
    ...Object.values(fixtureManifest.resources).flat().map((entry) => [entry.key, entry.sha256]),
    ...fixtureManifest.assets.flatMap((asset) => [
      [asset.key, asset.sha256],
      [asset.metadataKey, asset.metadataSha256]
    ])
  ]);
  const upstream = new Map([
    ["EditorialBrief", ["sourceEnvelopeDigest", "record:SourceEnvelope"]],
    ["Storyboard", ["editorialBriefDigest", "record:EditorialBrief"]],
    ["VisualRecipe", ["storyboardDigest", "record:Storyboard"]],
    ["RenderSpec", ["visualRecipeDigest", "record:VisualRecipe"]]
  ]);
  for (const stage of ["SourceEnvelope", "EditorialBrief", "Storyboard", "VisualRecipe", "RenderSpec"]) {
    const entry = stageEntry(fixtureManifest, stage);
    const record = await readJson(root, entry.path);
    const link = upstream.get(stage);
    if (link !== undefined) record[link[0]] = digests.get(link[1]);
    let bytes = Buffer.from(JSON.stringify(canonicalValue(record)));
    if (rawSerialization?.stage === stage) bytes = rawSerialization.transform(bytes);
    await writeFile(path.join(root, entry.path), bytes);
    entry.sha256 = createHash("sha256").update(bytes).digest("hex");
    entry.byteCount = bytes.byteLength;
    digests.set(entry.key, entry.sha256);
  }
  for (const entry of fixtureManifest.records) {
    for (const dependency of entry.dependencies) dependency.sha256 = digests.get(dependency.key);
  }
  await writeCanonicalJson(root, "fixtures/synthetic/manifest.json", fixtureManifest);
};
