import assert from "node:assert/strict";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  digestFile,
  fixedTimestamp,
  importInput,
  makeSandbox,
  recipeFor
} from "./helpers.mjs";

const assets = await import("../../src/assets/index.ts");

test("Given generated PNG bytes with alpha, When imported, Then immutable digest metadata records exact provenance and slot", async (context) => {
  // Given
  const sandbox = await makeSandbox(context);
  const input = await importInput(sandbox);

  // When
  const result = await assets.importAsset(input);

  // Then
  assert.deepEqual(result.record, {
    schemaVersion: 1,
    assetDigest: "a3cb6a194c177ca649b5f7d9432a09f3d9cb7167492fb5a6467366c9a4123aa3",
    originalRelativePath: "nested/Alpha Card.weird",
    byteCount: 74,
    detectedMime: "image/png",
    width: 2,
    height: 1,
    alpha: "present",
    rights: "generated",
    originNote: "Generated locally for deterministic test use",
    importedAt: fixedTimestamp,
    binding: { cardId: "card-1", slot: "hero" },
    publicEligible: true,
    publicPackageBlockers: []
  });
  assert.equal(await digestFile(result.artifactPath), result.record.assetDigest);
  assert.deepEqual(JSON.parse(await readFile(result.metadataPath, "utf8")), result.record);
  assert.equal(path.relative(await realpath(sandbox.workspaceRoot), result.artifactPath).startsWith("assets/"), true);
});

test("Given opaque PNG and user-provided JPEG bytes, When imported, Then dimensions and alpha follow bytes rather than extension", async (context) => {
  // Given
  const pngSandbox = await makeSandbox(context, "cardnews-assets-png-");
  const jpgSandbox = await makeSandbox(context, "cardnews-assets-jpg-");
  const pngInput = await importInput({
    ...pngSandbox,
    file: "opaque-png.bin",
    rights: "user-provided",
    originNote: undefined
  });
  const jpgInput = await importInput({
    ...jpgSandbox,
    file: "jpeg-named-png.bin",
    rights: "user-provided",
    originNote: undefined
  });

  // When
  const png = await assets.importAsset(pngInput);
  const jpg = await assets.importAsset(jpgInput);

  // Then
  assert.deepEqual(
    [png.record.detectedMime, png.record.width, png.record.height, png.record.alpha],
    ["image/png", 2, 1, "opaque"]
  );
  assert.deepEqual(
    [jpg.record.detectedMime, jpg.record.width, jpg.record.height, jpg.record.alpha],
    ["image/jpeg", 2, 1, "opaque"]
  );
});

test("Given the same source and metadata in separate workspaces, When imported, Then records and accepted bytes are deterministic", async (context) => {
  // Given
  const firstSandbox = await makeSandbox(context, "cardnews-assets-determinism-a-");
  const secondSandbox = await makeSandbox(context, "cardnews-assets-determinism-b-");

  // When
  const first = await assets.importAsset(await importInput(firstSandbox));
  const second = await assets.importAsset(await importInput(secondSandbox));

  // Then
  assert.deepEqual(first.record, second.record);
  assert.deepEqual(await readFile(first.metadataPath), await readFile(second.metadataPath));
  assert.deepEqual(await readFile(first.artifactPath), await readFile(second.artifactPath));
});

test("Given an already accepted digest, When reimported, Then accepted bytes and metadata remain immutable", async (context) => {
  // Given
  const sandbox = await makeSandbox(context);
  const input = await importInput(sandbox);
  const first = await assets.importAsset(input);
  const before = await stat(first.metadataPath);

  // When
  const second = await assets.importAsset(input);

  // Then
  assert.deepEqual(second.record, first.record);
  assert.equal((await stat(second.metadataPath)).mtimeMs, before.mtimeMs);
  assert.deepEqual(await readFile(second.artifactPath), await readFile(first.artifactPath));
});

test("Given unknown rights with an origin note, When imported privately, Then public packaging is blocked deterministically", async (context) => {
  // Given
  const sandbox = await makeSandbox(context);
  const file = path.join("nested", "Alpha Card.weird");
  const digest = await digestFile(path.join(sandbox.allowedRoot, file));
  const input = await importInput({
    ...sandbox,
    file,
    rights: "unknown",
    originNote: "Rights review pending",
    recipe: recipeFor(digest, { rights: "unknown", originNote: "Rights review pending" })
  });

  // When
  const result = await assets.importAsset(input);

  // Then
  assert.equal(result.record.publicEligible, false);
  assert.deepEqual(result.record.publicPackageBlockers, ["ASSET_RIGHTS_UNKNOWN"]);
  assert.throws(
    () => assets.assertPublicPackageEligible(result.record),
    (error) => error.code === "ASSET_PUBLIC_PACKAGE_BLOCKED"
  );
});

for (const rights of ["licensed", "public-domain"]) {
  test(`Given ${rights} PNG provenance, When imported, Then it remains public eligible`, async (context) => {
    // Given
    const sandbox = await makeSandbox(context);
    const file = "opaque-png.bin";
    const digest = await digestFile(path.join(sandbox.allowedRoot, file));
    const input = await importInput({
      ...sandbox,
      file,
      rights,
      originNote: `${rights} synthetic fixture provenance`,
      recipe: recipeFor(digest, {
        rights,
        originNote: `${rights} synthetic fixture provenance`
      })
    });

    // When
    const result = await assets.importAsset(input);

    // Then
    assert.equal(result.record.rights, rights);
    assert.equal(result.record.publicEligible, true);
    assert.doesNotThrow(() => assets.assertPublicPackageEligible(result.record));
  });
}
