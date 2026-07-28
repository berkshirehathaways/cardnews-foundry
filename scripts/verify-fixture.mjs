import Ajv2020 from "ajv/dist/2020.js";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { canonicalJsonBytes, validateContract, validateContractChain } from "../src/contracts/index.ts";
import { inspectImage } from "../src/assets/index.ts";
import {
  auditAbsolutePaths,
  createFileBoundary,
  resolveManifestFiles,
  scanProhibitedFiles,
  validateManifestRecords
} from "./fixture-verifier-boundary.mjs";

const stages = ["SourceEnvelope", "EditorialBrief", "Storyboard", "VisualRecipe", "RenderSpec"];
const forbiddenKeys = new Set(["html", "css", "pixels", "provider", "providerParams", "output"]);
const root = process.cwd();
const fixtureArg = process.argv.slice(2).find((argument) => argument !== "--");
const errors = [];
const resolver = new Map();
const snapshotsByKey = new Map();
const snapshotsByPath = new Map();
const records = new Map();
const metadata = new Map();
const resourceBytes = new Map();
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const issue = (code, subject, context = undefined) => {
  const staged = isObject(context) && Object.hasOwn(context, "stage");
  const stage = staged ? context.stage : undefined;
  const details = staged ? context.details : context;
  errors.push({ code, subject, ...(stage === undefined ? {} : { stage }), ...(details === undefined ? {} : { details }) });
};
const readDescriptor = async (entry, digestField = "sha256", countField = "byteCount") => {
  const bytes = snapshotsByKey.get(entry?.key)?.bytes;
  if (bytes === undefined) {
    issue("FILE_SNAPSHOT_MISSING", entry?.key ?? "descriptor");
    return undefined;
  }
  const digest = sha256(bytes);
  resolver.set(entry.key, digest);
  if (entry[digestField] !== digest || entry[countField] !== bytes.byteLength) {
    issue("DIGEST_MISMATCH", entry.key, { expected: entry[digestField], actual: digest });
  }
  return bytes;
};
const parseJson = (bytes, subject) => {
  try { return JSON.parse(bytes.toString("utf8")); } catch (error) {
    issue("INVALID_JSON", subject, error instanceof Error ? error.message : undefined);
    return undefined;
  }
};
const canonicalCheck = (bytes, value, subject) => {
  if (value !== undefined && !Buffer.from(canonicalJsonBytes(value)).equals(bytes)) issue("NON_CANONICAL_JSON", subject);
};
const scanKeys = (value, location, stage) => {
  if (Array.isArray(value)) return value.forEach((entry, index) => scanKeys(entry, `${location}/${index}`, stage));
  if (!isObject(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) issue("SEMANTIC_FIELD_LEAKAGE", `${location}/${key}`, { stage });
    scanKeys(entry, `${location}/${key}`, stage);
  }
};
const compile = async (name) => {
  const schema = JSON.parse(await readFile(path.join(root, "schemas", `${name}.schema.json`), "utf8"));
  return new Ajv2020({ allErrors: true, strict: true }).compile(schema);
};
const sameSet = (left, right) =>
  left.length === right.length && new Set(left).size === left.length && left.every((entry) => right.includes(entry));
const main = async () => {
  if (fixtureArg === undefined) throw new Error("usage: verify-fixture <fixture-root>");
  const boundary = createFileBoundary({ repositoryRoot: root, issue });
  const fixturePath = await boundary.resolveDirectory({ relativePath: fixtureArg, subject: "fixture-root" });
  if (fixturePath === undefined) return;
  const manifestRelative = path.relative(root, path.join(fixturePath, "manifest.json")).split(path.sep).join("/");
  const manifestFile = await boundary.resolveFile({
    relativePath: manifestRelative, subject: "manifest", approvedRoot: fixturePath
  });
  if (manifestFile === undefined) return;
  const manifestBytes = manifestFile.bytes;
  snapshotsByPath.set(manifestFile.relativePath, manifestFile);
  const manifest = parseJson(manifestBytes, "manifest");
  if (!isObject(manifest) || manifest.schemaVersion !== 1 || !Array.isArray(manifest.records) || !Array.isArray(manifest.assets)) {
    issue("MANIFEST_INVALID", "manifest");
    return;
  }
  const validRecordManifest = validateManifestRecords({
    entries: manifest.records, stages, repositoryRoot: root, issue
  });
  const pathErrorCount = errors.length;
  const resolution = await resolveManifestFiles({ boundary, manifest, fixturePath, repositoryRoot: root });
  for (const [key, snapshot] of resolution.files) {
    snapshotsByKey.set(key, snapshot);
    snapshotsByPath.set(snapshot.relativePath, snapshot);
  }
  const validPaths = errors.slice(pathErrorCount).every((error) => error.code === "FILE_MISSING");
  await scanProhibitedFiles({ issue, candidates: [
    manifestFile,
    ...resolution.candidates
  ] });
  if (!validRecordManifest || !validPaths) return;
  await readDescriptor(manifest.source);
  for (const resource of resolution.resourceList) {
    const bytes = await readDescriptor(resource);
    if (bytes !== undefined) resourceBytes.set(resource.key, bytes);
  }
  for (const [index, asset] of manifest.assets.entries()) {
    const raw = await readDescriptor(asset);
    const metadataEntry = resolution.metadataEntries[index];
    const metadataBytes = await readDescriptor(metadataEntry);
    const record = metadataBytes === undefined ? undefined : parseJson(metadataBytes, asset.metadataKey);
    canonicalCheck(metadataBytes ?? Buffer.alloc(0), record, asset.metadataKey);
    if (record !== undefined) metadata.set(asset.id, record);
    if (raw !== undefined && record !== undefined) {
      let image;
      try { image = inspectImage(raw); } catch (error) { issue("ASSET_INVALID", asset.key, error.code); }
      if (record.assetDigest !== sha256(raw)) issue("ASSET_DIGEST_MISMATCH", asset.key);
      if (record.byteCount !== raw.byteLength || image?.width !== record.width || image?.height !== record.height || image?.mime !== record.detectedMime) {
        issue("ASSET_METADATA_MISMATCH", asset.key);
      }
      if (!["generated", "public-domain"].includes(record.rights) || !record.publicEligible || record.publicPackageBlockers.length !== 0) {
        issue("ASSET_RIGHTS_INELIGIBLE", asset.key);
      }
    }
  }
  for (const [index, expectedStage] of stages.entries()) {
    const entry = manifest.records[index];
    if (entry?.stage !== expectedStage) { issue("STAGE_MISSING", expectedStage); continue; }
    const bytes = await readDescriptor(entry);
    const value = bytes === undefined ? undefined : parseJson(bytes, expectedStage);
    canonicalCheck(bytes ?? Buffer.alloc(0), value, expectedStage);
    if (value === undefined) continue;
    records.set(expectedStage, value);
    const validation = validateContract(expectedStage, value);
    if (!validation.ok) for (const problem of validation.issues) issue(problem.code, problem.path, { stage: expectedStage, details: problem.message });
    if (expectedStage === "Storyboard" || expectedStage === "VisualRecipe") scanKeys(value, "", expectedStage);
  }
  const assetKeys = manifest.assets.flatMap((asset) => [asset.key, asset.metadataKey]);
  const expectedDependencies = {
    SourceEnvelope: [manifest.source.key],
    EditorialBrief: ["record:SourceEnvelope"],
    Storyboard: ["record:SourceEnvelope", "record:EditorialBrief"],
    VisualRecipe: ["record:SourceEnvelope", "record:EditorialBrief", "record:Storyboard", manifest.resources.target.key, manifest.resources.theme.key, ...assetKeys],
    RenderSpec: ["record:SourceEnvelope", "record:EditorialBrief", "record:Storyboard", "record:VisualRecipe", manifest.resources.target.key, manifest.resources.theme.key, manifest.resources.fontManifest.key, ...manifest.resources.fonts.map((font) => font.key), ...assetKeys]
  };
  for (const entry of manifest.records) {
    const actualKeys = entry.dependencies?.map((dependency) => dependency.key) ?? [];
    if (!sameSet(actualKeys, expectedDependencies[entry.stage] ?? [])) issue("DEPENDENCY_SET_MISMATCH", entry.key, { stage: entry.stage });
    for (const dependency of entry.dependencies ?? []) {
      const actual = resolver.get(dependency.key);
      if (actual === undefined) issue("DEPENDENCY_UNRESOLVED", dependency.key, { stage: entry.stage });
      else if (actual !== dependency.sha256) issue("DEPENDENCY_DIGEST_MISMATCH", dependency.key, { stage: entry.stage, details: { expected: dependency.sha256, actual } });
    }
  }
  const source = records.get("SourceEnvelope");
  const brief = records.get("EditorialBrief");
  const story = records.get("Storyboard");
  const recipe = records.get("VisualRecipe");
  const render = records.get("RenderSpec");
  if (source && brief && story) {
    for (const problem of validateContractChain({ SourceEnvelope: source, EditorialBrief: brief, Storyboard: story })) {
      issue(problem.code, problem.path, problem.message);
    }
    if (brief.sourceEnvelopeDigest !== resolver.get("record:SourceEnvelope")) issue("UPSTREAM_DIGEST_MISMATCH", "EditorialBrief");
    if (source.provenance.rawSha256 !== resolver.get(manifest.source.key) || source.provenance.rawByteCount !== manifest.source.byteCount) issue("SOURCE_PROVENANCE_MISMATCH", "SourceEnvelope");
    if (!sameSet(source.provenance.extractedSpanIds, source.spans.map((span) => span.id)) || source.spans.some((span, index) => span.order !== index)) issue("SOURCE_SPAN_ORDER_MISMATCH", "SourceEnvelope");
    if (brief.exclusions.length === 0) issue("UNSUPPORTED_INFERENCE_LIST_MISSING", "EditorialBrief");
    const claimIds = brief.claims.map((claim) => claim.id);
    const inherited = story.cards.flatMap((card) => card.claimIds);
    if (!sameSet(inherited, claimIds)) issue("CLAIM_COVERAGE_MISMATCH", "Storyboard");
    for (const card of story.cards) {
      const claimSpans = card.claimIds.flatMap((id) => brief.claims.find((claim) => claim.id === id)?.sourceSpanIds ?? []);
      if (!sameSet(card.sourceSpanIds, claimSpans)) issue("CARD_SPAN_MISMATCH", card.id);
    }
  }
  if (story && recipe) {
    if (story.editorialBriefDigest !== resolver.get("record:EditorialBrief")) issue("UPSTREAM_DIGEST_MISMATCH", "Storyboard");
    if (recipe.storyboardDigest !== resolver.get("record:Storyboard")) issue("UPSTREAM_DIGEST_MISMATCH", "VisualRecipe");
    if (!sameSet(recipe.cards.map((card) => card.cardId), story.cards.map((card) => card.id))) issue("CARD_SET_MISMATCH", "VisualRecipe");
    else if (recipe.cards.some((card, index) => card.cardId !== story.cards[index]?.id)) issue("CARD_ORDER_MISMATCH", "VisualRecipe");
    if (story.cards.some((card, index) => card.order !== index)) issue("CARD_ORDER_MISMATCH", "Storyboard");
    const slots = new Set();
    for (const card of recipe.cards) for (const binding of card.assetBindings) {
      if (slots.has(binding.slot)) issue("DUPLICATE_ASSET_SLOT", binding.slot);
      slots.add(binding.slot);
      const match = [...metadata.values()].find((record) => record.binding.cardId === card.cardId && record.binding.slot === binding.slot);
      if (match === undefined) issue("DANGLING_ASSET_SLOT", binding.slot);
      else {
        if (match.assetDigest !== binding.assetDigest) issue("ASSET_DIGEST_MISMATCH", binding.slot);
        if (match.rights !== binding.rights) issue("ASSET_RIGHTS_MISMATCH", binding.slot);
      }
    }
    for (const record of metadata.values()) {
      if (!recipe.cards.some((card) => card.cardId === record.binding.cardId && card.assetBindings.some((binding) => binding.slot === record.binding.slot))) {
        issue("DANGLING_ASSET_METADATA", record.binding.slot);
      }
    }
  }
  const target = parseJson(resourceBytes.get(manifest.resources.target.key), "target");
  const theme = parseJson(resourceBytes.get(manifest.resources.theme.key), "theme");
  const fonts = parseJson(resourceBytes.get(manifest.resources.fontManifest.key), "font-manifest");
  for (const [name, value] of [["target-profile", target], ["theme-pack", theme], ["font-manifest", fonts]]) {
    const validator = await compile(name);
    if (!validator(value)) issue(`${name.toUpperCase().replaceAll("-", "_")}_INVALID`, name, validator.errors);
  }
  if (brief && story && (brief.cardCountIntent !== story.cards.length || story.cards.length < target.cardCount.minimum || story.cards.length > target.cardCount.maximum)) issue("CARD_COUNT_MISMATCH", "Storyboard");
  if (recipe && (recipe.targetId !== target.targetId || !theme.targetCompatibility.targetIds.includes(target.targetId))) issue("TARGET_MISMATCH", "VisualRecipe");
  if (recipe && recipe.themeId !== theme.themeId) issue("THEME_MISMATCH", "VisualRecipe");
  if (render) {
    if (render.visualRecipeDigest !== resolver.get("record:VisualRecipe")) issue("UPSTREAM_DIGEST_MISMATCH", "RenderSpec");
    if (render.target.id !== target.targetId || render.target.version !== target.schemaVersion || render.dimensions.width !== target.dimensions.width || render.dimensions.height !== target.dimensions.height) issue("TARGET_MISMATCH", "RenderSpec");
    if (render.theme.id !== theme.themeId || render.theme.version !== theme.schemaVersion) issue("THEME_MISMATCH", "RenderSpec");
    if (story && render.cardOrder.some((cardId, index) => cardId !== story.cards[index]?.id)) issue("CARD_ORDER_MISMATCH", "RenderSpec");
  }
  for (const font of manifest.resources.fonts) {
    if (resolver.get(font.key) === undefined) issue("FONT_MISSING", font.key);
    if (!fonts.fonts.some((entry) => entry.sha256 === resolver.get(font.key) && entry.file === font.path)) issue("FONT_DIGEST_MISMATCH", font.key);
  }
  for (const role of Object.values(theme.tokens.typography)) {
    if (!fonts.fonts.some((font) => font.file === role.font.file && font.weight === role.font.weight)) issue("FONT_DIGEST_MISMATCH", role.font.file);
  }
  const allowed = new Set(["fixtures/synthetic/manifest.json", "fixtures/synthetic/generate.mjs", "fixtures/synthetic/png.mjs", manifest.source.path, ...manifest.records.map((entry) => entry.path), ...manifest.assets.flatMap((asset) => [asset.path, asset.metadataPath])]);
  const fixtureFiles = (await readdir(fixturePath, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile()).map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"));
  for (const file of fixtureFiles) if (!allowed.has(file)) issue("UNDECLARED_FIXTURE_FILE", file);
  for (const file of allowed) {
    if (!/\.(?:json|html)$/u.test(file)) continue;
    if (!snapshotsByPath.has(file)) issue("FILE_SNAPSHOT_MISSING", file);
  }
  auditAbsolutePaths({
    snapshots: [...snapshotsByPath.values()].filter((snapshot) => allowed.has(snapshot.relativePath)), issue
  });
};

try {
  await main();
  errors.sort((left, right) =>
    Number(right.code === "PROHIBITED_CONTENT") - Number(left.code === "PROHIBITED_CONTENT")
    || stages.indexOf(left.stage) - stages.indexOf(right.stage)
    || left.code.localeCompare(right.code)
    || left.subject.localeCompare(right.subject));
  if (errors.length > 0) {
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ok: false, errors })}\n`);
    process.exitCode = 1;
  } else {
    const chain = stages.map((stage) => ({ stage, digest: resolver.get(`record:${stage}`) }));
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ok: true, message: "complete semantic chain", chain, checks: { dependencies: "resolved", claims: "resolved", spans: "resolved", assets: "rights-eligible", targetThemeFonts: "resolved" } })}\n`);
  }
} catch (error) {
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ok: false, errors: [{ code: "FIXTURE_VERIFIER_ERROR", subject: error instanceof Error ? error.message : "unknown failure" }] })}\n`);
  process.exitCode = 1;
}
