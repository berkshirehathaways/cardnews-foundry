import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  errorCodes,
  makeFixtureCopy,
  manifest,
  mutateRecord,
  readJson,
  runVerifier,
  stageEntry,
  writeJson
} from "./helpers.mjs";

test("Given non-canonical record bytes, When verified, Then canonical byte drift is rejected", async (context) => {
  // Given
  const root = await makeFixtureCopy(context);
  const fixtureManifest = await manifest(root);
  const record = stageEntry(fixtureManifest, "EditorialBrief");
  const bytes = await readFile(path.join(root, record.path));
  await writeFile(path.join(root, record.path), Buffer.concat([bytes, Buffer.from("\n")]));

  // When
  const result = runVerifier(root);

  // Then
  assert.equal(result.status, 1);
  assert.equal(errorCodes(result).has("NON_CANONICAL_JSON"), true);
});

for (const [name, mutate, expected] of [
  ["wrong digest", (entry) => { entry.dependencies[0].sha256 = "0".repeat(64); }, "DEPENDENCY_DIGEST_MISMATCH"],
  ["missing dependency", (entry) => { entry.dependencies.pop(); }, "DEPENDENCY_SET_MISMATCH"],
  ["undeclared dependency", (entry) => { entry.dependencies.push({ key: "record:ghost", sha256: "0".repeat(64) }); }, "DEPENDENCY_SET_MISMATCH"]
]) {
  test(`Given a ${name}, When verified, Then the exact dependency graph is rejected`, async (context) => {
    // Given
    const root = await makeFixtureCopy(context);
    const fixtureManifest = await manifest(root);
    mutate(stageEntry(fixtureManifest, "RenderSpec"));
    await writeJson(root, "fixtures/synthetic/manifest.json", fixtureManifest);

    // When
    const result = runVerifier(root);

    // Then
    assert.equal(result.status, 1);
    assert.equal(errorCodes(result).has(expected), true);
  });
}

test("Given an upstream record changes, When verified, Then every declared downstream edge is identified", async (context) => {
  // Given
  const root = await makeFixtureCopy(context);
  await mutateRecord(root, "SourceEnvelope", (record) => { record.title = `${record.title} 변경`; });

  // When
  const result = runVerifier(root);
  const affected = (result.report.errors ?? [])
    .filter((error) => error.code === "DEPENDENCY_DIGEST_MISMATCH" && error.subject.includes("record:SourceEnvelope"));

  // Then
  assert.equal(result.status, 1);
  assert.deepEqual(affected.map((error) => error.stage), [
    "EditorialBrief", "Storyboard", "VisualRecipe", "RenderSpec"
  ]);
});

test("Given one asset byte changes, When verified, Then asset metadata and all dependent stages reject it", async (context) => {
  // Given
  const root = await makeFixtureCopy(context);
  const fixtureManifest = await manifest(root);
  const asset = fixtureManifest.assets[0];
  const bytes = await readFile(path.join(root, asset.path));
  bytes[bytes.length - 1] ^= 1;
  await writeFile(path.join(root, asset.path), bytes);

  // When
  const result = runVerifier(root);
  const codes = errorCodes(result);
  const affected = (result.report.errors ?? [])
    .filter((error) => error.code === "DEPENDENCY_DIGEST_MISMATCH" && error.subject === asset.key);

  // Then
  assert.equal(result.status, 1);
  assert.equal(codes.has("ASSET_DIGEST_MISMATCH"), true);
  assert.deepEqual(affected.map((error) => error.stage), ["VisualRecipe", "RenderSpec"]);
});

test("Given a manifest references a missing file, When verified, Then clean resolution fails closed", async (context) => {
  // Given
  const root = await makeFixtureCopy(context);
  const fixtureManifest = await manifest(root);
  await rm(path.join(root, fixtureManifest.assets[0].path));

  // When
  const result = runVerifier(root);

  // Then
  assert.equal(result.status, 1);
  assert.equal(errorCodes(result).has("FILE_MISSING"), true);
});
