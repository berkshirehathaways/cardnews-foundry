import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(root, "fixtures", "synthetic");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

const renderToTemporaryJob = async (context, options = {}) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "cardnews-render-test-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const { renderFixture } = await import("../../src/render/index.mjs");
  const outputRoot = path.join(parent, "job");
  const result = await renderFixture({
    repositoryRoot: root,
    fixtureRoot,
    outputRoot,
    ...options
  });
  return { outputRoot, result };
};

test("Given the validated T7 synthetic chain, When it is rendered offline, Then all ordered cards, HTML sources, records and one complete contact sheet are accepted", async (context) => {
  // Given
  const storyboard = await readJson(path.join(fixtureRoot, "records", "storyboard.json"));
  const renderSpec = await readJson(path.join(fixtureRoot, "records", "render-spec.json"));

  // When
  const { outputRoot, result } = await renderToTemporaryJob(context);

  // Then
  assert.deepEqual(result.cardIds, renderSpec.cardOrder);
  assert.equal(result.artifacts.length, storyboard.cards.length);
  assert.equal((await readdir(path.join(outputRoot, "cards"))).length, storyboard.cards.length);
  for (const artifact of result.artifacts) {
    assert.match(artifact.htmlSource.sha256, /^[0-9a-f]{64}$/u);
    assert.equal(artifact.htmlSource.byteCount > 0, true);
    assert.equal("relativePath" in artifact.htmlSource, false);
  }
  await assert.rejects(readdir(path.join(outputRoot, "html")), (error) => error.code === "ENOENT");
  assert.equal((await readdir(path.join(outputRoot, "records"))).length, storyboard.cards.length);
  assert.equal((await stat(path.join(outputRoot, "contact-sheet.png"))).size > 0, true);
  assert.equal(result.networkRequests.length, 0);
});

test("Given rendered synthetic cards, When PNG and artifact records are independently inspected, Then signature, dimensions, byte count, opacity, sRGB assertion and exact dependency identities agree", async (context) => {
  // Given
  const target = await readJson(path.join(root, "targets", "portrait-social-1080x1350.json"));
  const manifest = await readJson(path.join(fixtureRoot, "manifest.json"));
  const { inspectPng } = await import("../../src/render/png.mjs");

  // When
  const { outputRoot, result } = await renderToTemporaryJob(context);
  const inspections = await Promise.all(result.artifacts.map(async (artifact) => {
    const bytes = await readFile(path.join(outputRoot, artifact.contract.relativePath));
    return { artifact, bytes, png: inspectPng(bytes) };
  }));

  // Then
  const knownDigests = new Set([
    manifest.source.sha256,
    ...manifest.records.map((entry) => entry.sha256),
    manifest.resources.target.sha256,
    manifest.resources.theme.sha256,
    manifest.resources.fontManifest.sha256,
    ...manifest.resources.fonts.map((entry) => entry.sha256),
    ...manifest.assets.flatMap((entry) => [entry.sha256, entry.metadataSha256])
  ]);
  for (const { artifact, bytes, png } of inspections) {
    knownDigests.add(artifact.canonicalRenderProfileDigest);
    assert.equal(artifact.contract.mediaSignature, "89504e470d0a1a0a");
    assert.deepEqual({ width: png.width, height: png.height }, target.dimensions);
    assert.equal(png.opaque, true);
    assert.equal(artifact.byteCount, bytes.byteLength);
    assert.equal(artifact.contract.sha256, sha256(bytes));
    assert.equal(artifact.colorSpace, target.output.colorSpace);
    assert.equal(artifact.contract.dependencyDigests.every((digest) => knownDigests.has(digest)), true);
    assert.equal(artifact.nativeEnvironment.platform, process.platform);
    assert.equal(artifact.canonicalRenderProfile.locale, "ko-KR");
  }
});

test("Given instruction-like HTML and script syntax in validated semantic text, When one card is rendered, Then it remains inert escaped text with no request or script execution", async (context) => {
  // Given
  const phrase = `<script>globalThis.compromised = true</script><img src="https://attack.invalid/pixel">`;

  // When
  const { outputRoot, result } = await renderToTemporaryJob(context, {
    retainHtml: true,
    semanticTextTransform: ({ body }) => ({ body: `${body} ${phrase}` })
  });
  const html = await readFile(path.join(outputRoot, "html", "card-1.html"), "utf8");

  // Then
  assert.match(html, /&lt;script&gt;/u);
  assert.doesNotMatch(html, /<script>globalThis\.compromised/u);
  assert.equal(result.runtime.compromised, false);
  assert.deepEqual(result.networkRequests, []);
});

test("Given missing, tampered, or wrong font inputs, When rendering begins, Then exact font verification fails before output acceptance", async (context) => {
  // Given
  const missing = path.join(os.tmpdir(), `missing-font-${process.pid}.otf`);
  const tampered = Buffer.from("not an OpenType font");

  // When / Then
  await assert.rejects(
    () => renderToTemporaryJob(context, { fontOverrides: { regular: missing } }),
    (error) => error.code === "FONT_FILE_MISSING"
  );
  await assert.rejects(
    () => renderToTemporaryJob(context, { fontByteOverrides: { regular: tampered } }),
    (error) => ["FONT_DIGEST_MISMATCH", "FONT_LOAD_FAILED"].includes(error.code)
  );
});

test("Given a fallback/tofu marker, missing/tampered asset, or a network-bearing content mutation, When rendering begins, Then it fails closed", async (context) => {
  // Given / When / Then
  await assert.rejects(
    () => renderToTemporaryJob(context, {
      semanticTextTransform: ({ body }) => ({ body: `${body} \uFFFD` })
    }),
    (error) => error.code === "FONT_GLYPH_UNSAFE"
  );
  await assert.rejects(
    () => renderToTemporaryJob(context, { assetByteOverrides: { "seed-orbit": Buffer.from("tampered") } }),
    (error) => error.code === "ASSET_DIGEST_MISMATCH"
  );
  await assert.rejects(
    () => renderToTemporaryJob(context, { injectedCss: `@import "https://attack.invalid/style.css";` }),
    (error) => error.code === "NETWORK_REQUEST_BLOCKED"
  );
});

test("Given wrong dependency, theme, target, renderer version, dimensions, or stale source revision, When inputs are checked, Then each mismatch is rejected before acceptance", async (context) => {
  // Given
  const cases = [
    [{ expectedDependencyDigest: "0".repeat(64) }, "DEPENDENCY_DIGEST_MISMATCH"],
    [{ expectedThemeId: "signal-night" }, "THEME_MISMATCH"],
    [{ expectedTargetId: "other-target" }, "TARGET_MISMATCH"],
    [{ expectedRendererVersion: "9.9.9" }, "RENDERER_VERSION_MISMATCH"],
    [{ expectedDimensions: { width: 1, height: 1 } }, "DIMENSIONS_MISMATCH"],
    [{ expectedSourceRevision: "0".repeat(64) }, "SOURCE_REVISION_MISMATCH"]
  ];

  // When / Then
  for (const [options, code] of cases) {
    await assert.rejects(
      () => renderToTemporaryJob(context, options),
      (error) => error.code === code
    );
  }
});

test("Given forced overflow, clipping, or safe-area displacement, When DOM geometry is audited, Then screenshot acceptance is blocked", async (context) => {
  // Given
  const cases = [
    [{ injectedCss: ".headline-block{width:2000px}" }, "DOM_OVERFLOW"],
    [{ injectedCss: ".body-block{height:20px;overflow:hidden}" }, "DOM_CLIPPING"],
    [{ injectedCss: ".safe-area{transform:translateX(-200px)}" }, "SAFE_AREA_VIOLATION"]
  ];

  // When / Then
  for (const [options, code] of cases) {
    await assert.rejects(
      () => renderToTemporaryJob(context, options),
      (error) => error.code === code
    );
  }
});

test("Given browser interruption at multiple pre-rename boundaries, When rendering is retried repeatedly, Then no partial job or temp sibling survives and the retry succeeds", async (context) => {
  // Given
  const parent = await mkdtemp(path.join(os.tmpdir(), "cardnews-render-recovery-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const { renderFixture } = await import("../../src/render/index.mjs");
  const outputRoot = path.join(parent, "job");

  // When / Then
  for (const failpoint of ["after-html", "after-card", "after-record", "before-rename"]) {
    await assert.rejects(
      () => renderFixture({ repositoryRoot: root, fixtureRoot, outputRoot, failpoint }),
      (error) => error.code === "RENDER_INTERRUPTED"
    );
    assert.deepEqual(await readdir(parent), []);
  }
  const accepted = await renderFixture({ repositoryRoot: root, fixtureRoot, outputRoot });
  assert.equal(accepted.cardIds.length, 7);
});

test("Given an accepted immutable render, When another render targets the same job, Then existing output is never overwritten", async (context) => {
  // Given
  const { outputRoot } = await renderToTemporaryJob(context);
  const before = sha256(await readFile(path.join(outputRoot, "cards", "card-1.png")));
  const { renderFixture } = await import("../../src/render/index.mjs");

  // When
  const overwrite = renderFixture({ repositoryRoot: root, fixtureRoot, outputRoot });

  // Then
  await assert.rejects(overwrite, (error) => error.code === "OUTPUT_IMMUTABLE");
  assert.equal(sha256(await readFile(path.join(outputRoot, "cards", "card-1.png"))), before);
});

test("Given source and fixture bytes before a render, When the render completes, Then current fixture/source inputs are unchanged", async (context) => {
  // Given
  const tracked = [
    path.join(fixtureRoot, "manifest.json"),
    path.join(fixtureRoot, "records", "storyboard.json"),
    path.join(fixtureRoot, "records", "visual-recipe.json"),
    path.join(fixtureRoot, "records", "render-spec.json")
  ];
  const before = await Promise.all(tracked.map(async (file) => sha256(await readFile(file))));

  // When
  await renderToTemporaryJob(context);

  // Then
  const after = await Promise.all(tracked.map(async (file) => sha256(await readFile(file))));
  assert.deepEqual(after, before);
});

test("Given a generated render set, When inventory order is validated, Then missing, duplicate, reordered cards and contact-sheet omissions reject", async (context) => {
  // Given
  const { outputRoot } = await renderToTemporaryJob(context);
  const { verifyRenderInventory } = await import("../../src/render/verify.mjs");
  const manifestPath = path.join(outputRoot, "render-manifest.json");
  const baseline = await readJson(manifestPath);
  const cases = [
    baseline.artifacts.slice(1),
    [...baseline.artifacts, baseline.artifacts[0]],
    [...baseline.artifacts].reverse()
  ];

  // When / Then
  for (const artifacts of cases) {
    await assert.rejects(
      () => verifyRenderInventory({ outputRoot, manifest: { ...baseline, artifacts } }),
      (error) => ["CARD_SET_MISMATCH", "CARD_ORDER_MISMATCH"].includes(error.code)
    );
  }
  for (const mutate of [
    (artifact) => { artifact.contract.width += 1; },
    (artifact) => { artifact.contract.mediaSignature = "0000000000000000"; },
    (artifact) => { artifact.alpha = "present"; },
    (artifact) => { artifact.colorSpace = "display-p3"; }
  ]) {
    const changed = structuredClone(baseline);
    mutate(changed.artifacts[0]);
    await assert.rejects(
      () => verifyRenderInventory({ outputRoot, manifest: changed }),
      (error) => ["CARD_MEDIA_MISMATCH", "RENDER_MANIFEST_INVALID"].includes(error.code)
    );
  }
  await writeFile(path.join(outputRoot, "contact-sheet.png"), Buffer.from("missing cards"));
  await assert.rejects(
    () => verifyRenderInventory({ outputRoot, manifest: baseline }),
    (error) => ["CONTACT_SHEET_DIGEST_MISMATCH", "PNG_SIGNATURE_INVALID"].includes(error.code)
  );
});
