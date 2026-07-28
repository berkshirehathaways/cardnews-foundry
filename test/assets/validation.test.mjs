import assert from "node:assert/strict";
import { appendFile, chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { digestFile, importInput, makeSandbox, recipeFor } from "./helpers.mjs";

const assets = await import("../../src/assets/index.ts");

const rejectCode = async (promise, code) =>
  assert.rejects(promise, (error) => error.code === code && error.exitClass === 3);

for (const [file, code] of [
  ["mislabeled-png.bin", "ASSET_SIGNATURE_UNSUPPORTED"],
  ["truncated-png.bin", "PNG_TRUNCATED"],
  ["corrupt-png-crc.bin", "PNG_CRC_MISMATCH"],
  ["trailing-png-polyglot.bin", "PNG_TRAILING_BYTES"],
  ["truncated-jpeg.bin", "JPEG_TRUNCATED"],
  ["corrupt-jpeg-segment.bin", "JPEG_SEGMENT_INVALID"],
  ["oversized-dimension-png.bin", "ASSET_DIMENSION_LIMIT"],
  ["oversized-early-png.bin", "ASSET_DIMENSION_LIMIT"],
  ["oversized-pixels-png.bin", "ASSET_PIXEL_LIMIT"]
]) {
  test(`Given ${file}, When imported, Then ${code} rejects before acceptance`, async (context) => {
    // Given
    const sandbox = await makeSandbox(context);
    const input = await importInput({ ...sandbox, file });

    // When / Then
    await rejectCode(assets.importAsset(input), code);
  });
}

test("Given a file above the explicit byte ceiling, When imported, Then it rejects before media parsing", async (context) => {
  // Given
  const sandbox = await makeSandbox(context);
  await writeFile(path.join(sandbox.allowedRoot, "large.png"), Buffer.alloc(1025, 0x89));
  const input = await importInput({
    ...sandbox,
    file: "large.png",
    limits: { maxBytes: 1024, maxDimension: 8192, maxPixels: 40_000_000 }
  });

  // When / Then
  await rejectCode(assets.importAsset(input), "ASSET_BYTE_LIMIT");
});

for (const [rights, code] of [
  [undefined, "ASSET_RIGHTS_MISSING"],
  ["borrowed", "ASSET_RIGHTS_INVALID"]
]) {
  test(`Given rights ${String(rights)}, When imported, Then ${code} rejects`, async (context) => {
    // Given
    const sandbox = await makeSandbox(context);
    const input = await importInput({ ...sandbox, rights });
    if (rights === undefined) input.rights = undefined;

    // When / Then
    await rejectCode(assets.importAsset(input), code);
  });
}

for (const rights of ["generated", "licensed", "public-domain", "unknown"]) {
  test(`Given ${rights} rights without an origin note, When imported, Then provenance rejects`, async (context) => {
    // Given
    const sandbox = await makeSandbox(context);
    const file = "opaque-png.bin";
    const digest = await digestFile(path.join(sandbox.allowedRoot, file));
    const input = await importInput({
      ...sandbox,
      file,
      rights,
      originNote: undefined,
      recipe: recipeFor(digest, { rights })
    });
    input.originNote = undefined;

    // When / Then
    await rejectCode(assets.importAsset(input), "ASSET_ORIGIN_NOTE_REQUIRED");
  });
}

test("Given any explicit blank origin note, When imported, Then provenance rejects before storage", async (context) => {
  // Given
  const sandbox = await makeSandbox(context);
  const input = await importInput({
    ...sandbox,
    rights: "user-provided",
    originNote: "   "
  });

  // When / Then
  await rejectCode(assets.importAsset(input), "ASSET_ORIGIN_NOTE_INVALID");
});

test("Given an invalid or non-UTC import timestamp, When imported, Then the deterministic timestamp boundary rejects", async (context) => {
  // Given
  const first = await makeSandbox(context, "cardnews-assets-time-a-");
  const second = await makeSandbox(context, "cardnews-assets-time-b-");

  // When / Then
  await rejectCode(
    assets.importAsset(await importInput({ ...first, importedAt: "not-a-time" })),
    "ASSET_TIMESTAMP_INVALID"
  );
  await rejectCode(
    assets.importAsset(await importInput({ ...second, importedAt: "2026-07-27T09:00:00+09:00" })),
    "ASSET_TIMESTAMP_INVALID"
  );
});

test("Given a missing recipe slot or mismatched binding, When imported, Then the slot boundary fails closed", async (context) => {
  // Given
  const missingSandbox = await makeSandbox(context, "cardnews-assets-slot-a-");
  const mismatchSandbox = await makeSandbox(context, "cardnews-assets-slot-b-");
  const missing = await importInput(missingSandbox);
  missing.slot = "missing";
  const mismatch = await importInput(mismatchSandbox);
  mismatch.recipe = recipeFor("f".repeat(64));

  // When / Then
  await rejectCode(assets.importAsset(missing), "ASSET_SLOT_MISSING");
  await rejectCode(assets.importAsset(mismatch), "ASSET_SLOT_BINDING_MISMATCH");
});

test("Given a nonblank origin note differs from its immutable recipe receipt, When imported, Then the slot boundary fails closed", async (context) => {
  // Given
  const sandbox = await makeSandbox(context);
  const input = await importInput(sandbox);
  input.originNote = "Forged nonblank provenance";

  // When / Then
  await rejectCode(assets.importAsset(input), "ASSET_SLOT_BINDING_MISMATCH");
});

test("Given a JPEG bound to an alpha overlay slot, When imported, Then MIME and alpha constraints reject", async (context) => {
  // Given
  const sandbox = await makeSandbox(context);
  const file = "user-jpeg.bin";
  const digest = await digestFile(path.join(sandbox.allowedRoot, file));
  const input = await importInput({
    ...sandbox,
    file,
    rights: "user-provided",
    originNote: undefined,
    slot: "overlay",
    recipe: recipeFor(digest, { slot: "overlay", rights: "user-provided" })
  });

  // When / Then
  await rejectCode(assets.importAsset(input), "ASSET_SLOT_MEDIA_MISMATCH");
});

test("Given a recipe slot without a runtime media policy, When imported, Then slot constraints fail closed", async (context) => {
  // Given
  const sandbox = await makeSandbox(context);
  const file = "opaque-png.bin";
  const digest = await digestFile(path.join(sandbox.allowedRoot, file));
  const input = await importInput({
    ...sandbox,
    file,
    slot: "video",
    recipe: recipeFor(digest, { slot: "video" })
  });

  // When / Then
  await rejectCode(assets.importAsset(input), "ASSET_SLOT_CONSTRAINT_MISSING");
});

test("Given malformed VisualRecipe data, When importing, Then schema validation is not weakened", async (context) => {
  // Given
  const sandbox = await makeSandbox(context);
  const input = await importInput(sandbox);
  input.recipe.cards[0].provider = "forbidden";

  // When / Then
  await rejectCode(assets.importAsset(input), "ASSET_RECIPE_INVALID");
});

test("Given traversal, absolute, device-like, or missing paths, When imported, Then each path rejects", async (context) => {
  // Given
  const sandbox = await makeSandbox(context);
  const outside = path.join(sandbox.root, "outside.png");
  await writeFile(outside, Buffer.from([137, 80, 78, 71]));

  // When / Then
  for (const [file, code] of [
    ["../outside.png", "ASSET_PATH_ESCAPE"],
    [outside, "ASSET_PATH_ESCAPE"],
    ["CON", "ASSET_DEVICE_PATH"],
    ["missing.png", "ASSET_SOURCE_MISSING"]
  ]) {
    const input = await importInput(sandbox);
    input.file = file;
    await rejectCode(assets.importAsset(input), code);
  }
});

test("Given symlink source files, symlink parents, or a symlink assets directory, When imported, Then confinement rejects", async (context) => {
  // Given
  const fileSandbox = await makeSandbox(context, "cardnews-assets-link-a-");
  const parentSandbox = await makeSandbox(context, "cardnews-assets-link-b-");
  const outputSandbox = await makeSandbox(context, "cardnews-assets-link-c-");
  await symlink("opaque-png.bin", path.join(fileSandbox.allowedRoot, "file-link.png"));
  await symlink("nested", path.join(parentSandbox.allowedRoot, "parent-link"));
  await mkdir(path.join(outputSandbox.root, "escaped-assets"));
  await symlink(path.join(outputSandbox.root, "escaped-assets"), path.join(outputSandbox.workspaceRoot, "assets"));

  // When / Then
  await rejectCode(
    assets.importAsset(await importInput({ ...fileSandbox, file: "file-link.png" })),
    "ASSET_SYMLINK_FORBIDDEN"
  );
  await rejectCode(
    assets.importAsset(await importInput({ ...parentSandbox, file: "parent-link/Alpha Card.weird" })),
    "ASSET_SYMLINK_FORBIDDEN"
  );
  await rejectCode(
    assets.importAsset(await importInput(outputSandbox)),
    "ASSET_SYMLINK_FORBIDDEN"
  );
});

test("Given FIFO and Unix socket source nodes, When imported, Then only regular files are accepted", { skip: process.platform === "win32" }, async (context) => {
  // Given
  const sandbox = await makeSandbox(context);
  const fifo = path.join(sandbox.allowedRoot, "asset.fifo");
  const socket = path.join(sandbox.allowedRoot, "asset.sock");
  execFileSync("mkfifo", [fifo]);
  const server = net.createServer();
  context.after(() => server.close());
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socket, resolve);
  });
  const fifoInput = await importInput(sandbox);
  fifoInput.file = "asset.fifo";
  const socketInput = await importInput(sandbox);
  socketInput.file = "asset.sock";

  // When / Then
  await rejectCode(
    assets.importAsset(fifoInput),
    "ASSET_NOT_REGULAR"
  );
  await rejectCode(
    assets.importAsset(socketInput),
    "ASSET_NOT_REGULAR"
  );
});

test("Given source mutation after metadata inspection, When bytes are read, Then TOCTOU detection rejects stale state", async (context) => {
  // Given
  const sandbox = await makeSandbox(context);
  const input = await importInput({
    ...sandbox,
    hooks: {
      afterSourceStat: async (sourcePath) => appendFile(sourcePath, Buffer.from([0]))
    }
  });

  // When / Then
  await rejectCode(assets.importAsset(input), "ASSET_SOURCE_CHANGED");
});

test("Given interruption before atomic acceptance, When retried, Then no temporary or accepted partial remains and recovery succeeds", async (context) => {
  // Given
  const sandbox = await makeSandbox(context);
  const input = await importInput({ ...sandbox, failpoint: "asset-before-rename" });

  // When
  await rejectCode(assets.importAsset(input), "ASSET_WRITE_INTERRUPTED");
  const assetsRoot = path.join(sandbox.workspaceRoot, "assets");
  const entriesAfterFailure = await (await import("node:fs/promises")).readdir(assetsRoot);

  // Then
  assert.deepEqual(entriesAfterFailure, []);
  const recovered = await assets.importAsset({ ...input, failpoint: undefined });
  assert.equal(await digestFile(recovered.artifactPath), recovered.record.assetDigest);
});

test("Given an accepted digest directory with conflicting metadata, When reimported, Then conflict fails without overwrite", async (context) => {
  // Given
  const sandbox = await makeSandbox(context);
  const input = await importInput(sandbox);
  const first = await assets.importAsset(input);
  await chmod(path.dirname(first.metadataPath), 0o700);
  await chmod(first.metadataPath, 0o600);
  await writeFile(first.metadataPath, "{}");

  // When / Then
  await rejectCode(assets.importAsset(input), "ASSET_DIGEST_CONFLICT");
});
