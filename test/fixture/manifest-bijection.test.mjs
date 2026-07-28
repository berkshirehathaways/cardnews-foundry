import assert from "node:assert/strict";
import test from "node:test";
import {
  errorCodes,
  makeFixtureCopy,
  manifest,
  runVerifier,
  writeJson
} from "./helpers.mjs";

const verifyMutation = async (context, mutate, expectedCodes) => {
  const root = await makeFixtureCopy(context);
  const fixtureManifest = await manifest(root);
  mutate(fixtureManifest.records);
  await writeJson(root, "fixtures/synthetic/manifest.json", fixtureManifest);
  const result = runVerifier(root);
  assert.equal(result.status, 1);
  for (const code of expectedCodes) assert.equal(errorCodes(result).has(code), true, `${code}\n${result.stdout}`);
};

test("duplicate stage and record key violate the manifest bijection", async (context) => {
  await verifyMutation(context, (records) => {
    records.push(structuredClone(records[0]));
  }, ["MANIFEST_RECORD_COUNT_MISMATCH", "MANIFEST_RECORD_STAGE_DUPLICATE", "MANIFEST_RECORD_KEY_DUPLICATE"]);
});

test("one record file cannot be aliased under two semantic stages", async (context) => {
  await verifyMutation(context, (records) => {
    records[1].path = records[0].path;
  }, ["MANIFEST_RECORD_PATH_DUPLICATE"]);
});

test("manifest records must retain exact semantic stage order", async (context) => {
  await verifyMutation(context, (records) => {
    [records[0], records[1]] = [records[1], records[0]];
  }, ["MANIFEST_RECORD_ORDER_MISMATCH"]);
});

test("extra stages and records are rejected", async (context) => {
  await verifyMutation(context, (records) => {
    records.push({ ...structuredClone(records.at(-1)), stage: "GhostStage", key: "record:GhostStage" });
  }, ["MANIFEST_RECORD_COUNT_MISMATCH", "MANIFEST_RECORD_STAGE_UNKNOWN"]);
});
