import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("Given two independent clean jobs with one canonical profile, When every normalized output and record is hashed, Then ordered hash sets are byte-identical", async (context) => {
  // Given
  const parent = await mkdtemp(path.join(os.tmpdir(), "cardnews-determinism-test-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const { verifyDeterminism } = await import("../../src/render/determinism.mjs");

  // When
  const result = await verifyDeterminism({
    repositoryRoot: root,
    fixtureRoot: path.join(root, "fixtures", "synthetic"),
    outputParent: parent
  });

  // Then
  assert.equal(result.equal, true);
  assert.deepEqual(result.first.hashes, result.second.hashes);
  // lean accepted output: 7 card PNGs + 7 render records + contact sheet + manifest
  assert.equal(result.first.hashes.length, 16);
  assert.equal(result.nativeEnvironment.platform, process.platform);
  assert.equal(result.crossOsByteIdentity, "deferred-to-t14-ci");
});
