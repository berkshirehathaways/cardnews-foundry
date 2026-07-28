import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { validateContract } from "../contracts/index.ts";
import { RenderError } from "./errors.mjs";

const execFileAsync = promisify(execFile);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const parse = (bytes, subject) => {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new RenderError("RENDER_JSON_INVALID", `invalid JSON: ${subject}`, {
      cause: error instanceof Error ? error.message : "unknown"
    });
  }
};
const assertContract = (name, value) => {
  const result = validateContract(name, value);
  if (!result.ok) throw new RenderError("RENDER_CONTRACT_INVALID", `${name} did not validate`, result.issues);
  return result.value;
};
const readRequired = async (file, code) => {
  try {
    return await readFile(file);
  } catch (error) {
    throw new RenderError(code, `required render input is unavailable: ${path.basename(file)}`, {
      cause: error instanceof Error && "code" in error ? error.code : "unknown"
    });
  }
};
export const computeRendererSourceRevision = async (repositoryRoot) => {
  const renderRoot = path.join(repositoryRoot, "src", "render");
  const names = (await readdir(renderRoot)).filter((name) => name.endsWith(".mjs")).sort();
  const hash = createHash("sha256");
  hash.update(await readRequired(path.join(repositoryRoot, "DESIGN.md"), "SOURCE_FILE_MISSING"));
  for (const name of names) {
    hash.update(name);
    hash.update(await readRequired(path.join(renderRoot, name), "SOURCE_FILE_MISSING"));
  }
  return hash.digest("hex");
};
const fixtureValidation = async (repositoryRoot, fixtureRoot) => {
  const verifier = path.join(repositoryRoot, "scripts", "verify-fixture.mjs");
  const fixtureArgument = path.relative(repositoryRoot, fixtureRoot);
  if (fixtureArgument.startsWith("..") || path.isAbsolute(fixtureArgument)) {
    throw new RenderError("RENDER_INPUT_INVALID", "fixture root must be confined to the repository");
  }
  try {
    const { stdout } = await execFileAsync(process.execPath, [verifier, fixtureArgument], {
      cwd: repositoryRoot,
      timeout: 20_000,
      maxBuffer: 4 * 1024 * 1024
    });
    const report = JSON.parse(stdout);
    if (report.ok !== true) throw new RenderError("RENDER_INPUT_INVALID", "fixture verification failed", report.errors);
  } catch (error) {
    if (error instanceof RenderError) throw error;
    let report;
    if (error instanceof Error && "stdout" in error && typeof error.stdout === "string") {
      try {
        report = JSON.parse(error.stdout);
      } catch {
        report = undefined;
      }
    }
    throw new RenderError("RENDER_INPUT_INVALID", "fixture verification failed", report?.errors);
  }
};
const keyedResources = (manifest) => new Map([
  [manifest.source.key, manifest.source],
  [manifest.resources.target.key, manifest.resources.target],
  [manifest.resources.theme.key, manifest.resources.theme],
  [manifest.resources.fontManifest.key, manifest.resources.fontManifest],
  ...manifest.resources.fonts.map((entry) => [entry.key, entry]),
  ...manifest.assets.flatMap((entry) => [
    [entry.key, { key: entry.key, path: entry.path, sha256: entry.sha256, byteCount: entry.byteCount }],
    [entry.metadataKey, {
      key: entry.metadataKey,
      path: entry.metadataPath,
      sha256: entry.metadataSha256,
      byteCount: entry.metadataByteCount
    }]
  ]),
  ...manifest.records.map((entry) => [entry.key, entry])
]);

export const loadRenderInput = async (options) => {
  if (options.validatedFixture !== true) {
    await fixtureValidation(options.repositoryRoot, options.fixtureRoot);
  }
  const manifestBytes = await readRequired(path.join(options.fixtureRoot, "manifest.json"), "MANIFEST_MISSING");
  const manifest = parse(manifestBytes, "manifest");
  const resources = keyedResources(manifest);
  const record = async (stage, contract) => {
    const entry = manifest.records.find((candidate) => candidate.stage === stage);
    if (entry === undefined) throw new RenderError("RENDER_STAGE_MISSING", `missing ${stage}`);
    const bytes = await readRequired(path.join(options.repositoryRoot, entry.path), "RENDER_RECORD_MISSING");
    if (sha256(bytes) !== entry.sha256) throw new RenderError("DEPENDENCY_DIGEST_MISMATCH", stage);
    return { entry, value: assertContract(contract, parse(bytes, stage)), bytes };
  };
  const [storyboard, recipe, spec] = await Promise.all([
    record("Storyboard", "Storyboard"),
    record("VisualRecipe", "VisualRecipe"),
    record("RenderSpec", "RenderSpec")
  ]);
  const targetEntry = resources.get(manifest.resources.target.key);
  const themeEntry = resources.get(manifest.resources.theme.key);
  const fontManifestEntry = resources.get(manifest.resources.fontManifest.key);
  const [targetBytes, themeBytes, fontManifestBytes] = await Promise.all([
    readRequired(path.join(options.repositoryRoot, targetEntry.path), "TARGET_FILE_MISSING"),
    readRequired(path.join(options.repositoryRoot, themeEntry.path), "THEME_FILE_MISSING"),
    readRequired(path.join(options.repositoryRoot, fontManifestEntry.path), "FONT_MANIFEST_MISSING")
  ]);
  if (sha256(targetBytes) !== targetEntry.sha256) throw new RenderError("DEPENDENCY_DIGEST_MISMATCH", targetEntry.key);
  if (sha256(themeBytes) !== themeEntry.sha256) throw new RenderError("DEPENDENCY_DIGEST_MISMATCH", themeEntry.key);
  if (sha256(fontManifestBytes) !== fontManifestEntry.sha256) {
    throw new RenderError("DEPENDENCY_DIGEST_MISMATCH", fontManifestEntry.key);
  }
  const target = parse(targetBytes, "target");
  const theme = parse(themeBytes, "theme");
  const fontManifest = parse(fontManifestBytes, "font manifest");
  const fontByWeight = new Map(fontManifest.fonts.map((entry) => [entry.weight, entry]));
  const readFont = async (weight, overridePath, overrideBytes) => {
    const entry = fontByWeight.get(weight);
    if (entry === undefined) throw new RenderError("FONT_FILE_MISSING", weight);
    const bytes = overrideBytes ?? await readRequired(
      overridePath ?? path.join(options.repositoryRoot, entry.file),
      "FONT_FILE_MISSING"
    );
    if (sha256(bytes) !== entry.sha256) throw new RenderError("FONT_DIGEST_MISMATCH", weight);
    return { entry, bytes };
  };
  const fonts = {
    regular: await readFont("Regular", options.fontOverrides?.regular, options.fontByteOverrides?.regular),
    bold: await readFont("Bold", options.fontOverrides?.bold, options.fontByteOverrides?.bold)
  };
  const assets = new Map();
  for (const entry of manifest.assets) {
    const bytes = options.assetByteOverrides?.[entry.id] ??
      await readRequired(path.join(options.repositoryRoot, entry.path), "ASSET_FILE_MISSING");
    if (sha256(bytes) !== entry.sha256) throw new RenderError("ASSET_DIGEST_MISMATCH", entry.id);
    const metadataBytes = await readRequired(path.join(options.repositoryRoot, entry.metadataPath), "ASSET_METADATA_MISSING");
    if (sha256(metadataBytes) !== entry.metadataSha256) throw new RenderError("ASSET_DIGEST_MISMATCH", entry.metadataKey);
    assets.set(entry.sha256, { entry, bytes, metadata: parse(metadataBytes, entry.metadataPath) });
  }
  const revision = await computeRendererSourceRevision(options.repositoryRoot);
  const allDigests = [...resources.values()].map((entry) => entry.sha256);
  if (options.expectedDependencyDigest !== undefined && !allDigests.includes(options.expectedDependencyDigest)) {
    throw new RenderError("DEPENDENCY_DIGEST_MISMATCH", "expected dependency was not present");
  }
  if ((options.expectedThemeId ?? recipe.value.themeId) !== recipe.value.themeId) throw new RenderError("THEME_MISMATCH", recipe.value.themeId);
  if ((options.expectedTargetId ?? recipe.value.targetId) !== recipe.value.targetId) throw new RenderError("TARGET_MISMATCH", recipe.value.targetId);
  if ((options.expectedRendererVersion ?? "1.0.0") !== "1.0.0") throw new RenderError("RENDERER_VERSION_MISMATCH", "1.0.0");
  const dimensions = options.expectedDimensions ?? target.dimensions;
  if (dimensions.width !== spec.value.dimensions.width || dimensions.height !== spec.value.dimensions.height) {
    throw new RenderError("DIMENSIONS_MISMATCH", "target and render spec differ");
  }
  if ((options.expectedSourceRevision ?? revision) !== revision) throw new RenderError("SOURCE_REVISION_MISMATCH", revision);
  return {
    manifest,
    storyboard: storyboard.value,
    recipe: recipe.value,
    spec: spec.value,
    target,
    theme,
    fonts,
    assets,
    sourceRevision: revision,
    renderSpecDigest: spec.entry.sha256,
    dependencyDigests: allDigests.sort(),
    nativeEnvironment: {
      platform: process.platform,
      architecture: process.arch,
      osRelease: os.release(),
      node: process.version
    }
  };
};
