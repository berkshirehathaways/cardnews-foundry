import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createDeterministicZip,
  inspectZip
} from "../../src/package/index.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("Given the same unsorted entries, When two ZIPs are created, Then bytes and fixed metadata are identical", async () => {
  // Given
  const entries = [
    { path: "metadata/source-summary.json", bytes: Buffer.from('{"schemaVersion":1}') },
    { path: "cards/card-1.png", bytes: Buffer.from([137, 80, 78, 71]) }
  ];

  // When
  const first = await createDeterministicZip(entries);
  const second = await createDeterministicZip(entries);
  const inspected = inspectZip(first);

  // Then
  assert.equal(sha256(first), sha256(second));
  assert.deepEqual(inspected.entries.map((entry) => entry.path), [
    "cards/card-1.png",
    "metadata/source-summary.json"
  ]);
  assert.equal(inspected.entries.every((entry) => entry.mode === 0o100444), true);
  assert.equal(inspected.entries.every((entry) => entry.modifiedAt === "1980-01-01T00:00:00.000Z"), true);
});

test("Given traversal or absolute entry names, When ZIP creation is attempted, Then the archive boundary rejects", async () => {
  // Given
  const unsafe = ["../escape.txt", "/absolute.txt", "cards\\card-1.png"];

  // When / Then
  for (const path of unsafe) {
    await assert.rejects(
      createDeterministicZip([{ path, bytes: Buffer.from("unsafe") }]),
      (error) => error.code === "ARCHIVE_PATH_UNSAFE" && error.exitClass === 6
    );
  }
});

test("Given a highly compressible oversized entry, When bounded inspection runs, Then the zip-bomb ratio rejects", async () => {
  // Given
  const archive = await createDeterministicZip([
    { path: "metadata/source-summary.json", bytes: Buffer.alloc(1024 * 1024, 0x20) }
  ]);

  // When / Then
  assert.throws(
    () => inspectZip(archive, { maxCompressionRatio: 10 }),
    (error) => error.code === "ARCHIVE_COMPRESSION_RATIO" && error.exitClass === 6
  );
});

