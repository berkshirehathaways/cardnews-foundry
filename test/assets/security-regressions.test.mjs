import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fixtureRoot, importInput, makeSandbox } from "./helpers.mjs";

const assets = await import("../../src/assets/index.ts");

const rejectCode = async (promise, code) =>
  assert.rejects(promise, (error) => error.code === code && error.exitClass === 3);

test("Given an accepted artifact replaced by a symlink, When reimported, Then the external target is never accepted", async (context) => {
  // Given
  const sandbox = await makeSandbox(context);
  const input = await importInput({ ...sandbox, file: "opaque-png.bin" });
  const first = await assets.importAsset(input);
  const original = await readFile(first.artifactPath);
  const external = path.join(sandbox.root, "external.png");
  await writeFile(external, original);
  await chmod(path.dirname(first.artifactPath), 0o700);
  await rm(first.artifactPath);
  await symlink(external, first.artifactPath);

  // When / Then
  await rejectCode(assets.importAsset(input), "ASSET_SYMLINK_FORBIDDEN");
  assert.equal((await lstat(first.artifactPath)).isSymbolicLink(), false);
  assert.deepEqual(await readFile(first.artifactPath), original);
  await writeFile(external, Buffer.from("mutated external bytes"));
  assert.deepEqual(await readFile(first.artifactPath), original);
});

test("Given accepted metadata replaced by a symlink, When reimported, Then metadata reuse rejects without following it", async (context) => {
  // Given
  const sandbox = await makeSandbox(context);
  const input = await importInput({ ...sandbox, file: "opaque-png.bin" });
  const first = await assets.importAsset(input);
  const external = path.join(sandbox.root, "external-metadata.json");
  const original = await readFile(first.metadataPath);
  await writeFile(external, original);
  await chmod(path.dirname(first.metadataPath), 0o700);
  await rm(first.metadataPath);
  await symlink(external, first.metadataPath);

  // When / Then
  await rejectCode(assets.importAsset(input), "ASSET_SYMLINK_FORBIDDEN");
  assert.equal((await lstat(first.metadataPath)).isSymbolicLink(), false);
  assert.deepEqual(await readFile(first.metadataPath), original);
  assert.deepEqual(await readFile(external), original);
});

test("Given an accepted artifact replaced by a non-regular node, When reimported, Then reuse rejects its type", async (context) => {
  // Given
  const sandbox = await makeSandbox(context);
  const input = await importInput({ ...sandbox, file: "opaque-png.bin" });
  const first = await assets.importAsset(input);
  await chmod(path.dirname(first.artifactPath), 0o700);
  await rm(first.artifactPath);
  await mkdir(first.artifactPath);

  // When / Then
  await rejectCode(assets.importAsset(input), "ASSET_NOT_REGULAR");
});

test("Given an accepted digest directory replaced by a symlink parent, When reimported, Then reuse rejects before reading children", async (context) => {
  // Given
  const sandbox = await makeSandbox(context);
  const input = await importInput({ ...sandbox, file: "opaque-png.bin" });
  const first = await assets.importAsset(input);
  const digestDirectory = path.dirname(first.artifactPath);
  const externalDirectory = path.join(sandbox.root, "external-digest");
  await chmod(digestDirectory, 0o700);
  await rm(digestDirectory, { recursive: true });
  await mkdir(externalDirectory);
  await symlink(externalDirectory, digestDirectory);

  // When / Then
  await rejectCode(assets.importAsset(input), "ASSET_SYMLINK_FORBIDDEN");
  assert.deepEqual(await (await import("node:fs/promises")).readdir(externalDirectory), []);
});

test("Given accepted regular bytes tampered after import, When reimported, Then digest comparison rejects without overwrite", async (context) => {
  // Given
  const sandbox = await makeSandbox(context);
  const input = await importInput({ ...sandbox, file: "opaque-png.bin" });
  const first = await assets.importAsset(input);
  const tampered = Buffer.from("tampered accepted bytes");
  await chmod(path.dirname(first.artifactPath), 0o700);
  await chmod(first.artifactPath, 0o600);
  await writeFile(first.artifactPath, tampered);

  // When / Then
  await rejectCode(assets.importAsset(input), "ASSET_DIGEST_CONFLICT");
  assert.deepEqual(await readFile(first.artifactPath), tampered);
});

test("Given duplicate matching slot IDs across a recipe, When binding an asset, Then semantic uniqueness rejects", async (context) => {
  // Given
  const sandbox = await makeSandbox(context);
  const input = await importInput(sandbox);
  input.recipe.cards[0].assetBindings.push({
    ...input.recipe.cards[0].assetBindings[0]
  });

  // When / Then
  await rejectCode(assets.importAsset(input), "ASSET_SLOT_DUPLICATE");
});

test("Given duplicate conflicting slot IDs across a recipe, When binding an asset, Then the first match cannot hide the conflict", async (context) => {
  // Given
  const sandbox = await makeSandbox(context);
  const input = await importInput(sandbox);
  input.recipe.cards.push({
    ...input.recipe.cards[0],
    cardId: "card-2",
    assetBindings: [{
      slot: "hero",
      assetDigest: "f".repeat(64),
      rights: "unknown",
      altText: "Conflicting duplicate slot"
    }]
  });

  // When / Then
  await rejectCode(assets.importAsset(input), "ASSET_SLOT_DUPLICATE");
});

for (const [file, code] of [
  ["invalid-zlib-png.bin", "PNG_IDAT_INVALID"],
  ["truncated-zlib-png.bin", "PNG_IDAT_INVALID"],
  ["overrun-zlib-png.bin", "PNG_DECOMPRESSED_OVERRUN"],
  ["underrun-zlib-png.bin", "PNG_DECOMPRESSED_TRUNCATED"],
  ["invalid-filter-png.bin", "PNG_FILTER_INVALID"],
  ["trailing-zlib-data-png.bin", "PNG_IDAT_INVALID"],
  ["concatenated-zlib-members-png.bin", "PNG_IDAT_INVALID"],
  ["interlaced-png.bin", "PNG_INTERLACE_UNSUPPORTED"]
]) {
  test(`Given ${file} with valid chunk CRCs, When imported, Then ${code} rejects undecodable PNG bytes`, async (context) => {
    // Given
    const sandbox = await makeSandbox(context);
    const input = await importInput({ ...sandbox, file });

    // When / Then
    await rejectCode(assets.importAsset(input), code);
  });
}

for (const file of ["trailing-zlib-data-png.bin", "concatenated-zlib-members-png.bin"]) {
  test(`Given ${file}, When inspected through the exported parser, Then trailing compressed bytes reject`, async () => {
    // Given
    const bytes = await readFile(path.join(fixtureRoot, file));

    // When / Then
    assert.throws(
      () => assets.inspectImage(bytes),
      (error) => error.code === "PNG_IDAT_INVALID" && error.exitClass === 3
    );
  });
}

test("Given a valid zlib stream split across IDAT chunks, When imported, Then concatenated streaming validation accepts it", async (context) => {
  // Given
  const sandbox = await makeSandbox(context);
  const input = await importInput({ ...sandbox, file: "split-idat-png.bin" });

  // When
  const imported = await assets.importAsset(input);

  // Then
  assert.deepEqual(
    [imported.record.detectedMime, imported.record.width, imported.record.height, imported.record.alpha],
    ["image/png", 2, 1, "opaque"]
  );
});
