import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  errorCodes,
  makeFixtureCopy,
  manifest,
  mutateRecord,
  runVerifier,
  writeJson
} from "./helpers.mjs";

test("Given provider or render implementation fields leak into a semantic stage, When verified, Then leakage is rejected", async (context) => {
  // Given
  const root = await makeFixtureCopy(context);
  await mutateRecord(root, "Storyboard", (record) => {
    record.cards[0].provider = "remote";
    record.cards[0].css = "position:absolute";
    record.cards[0].pixels = [1, 2, 3];
    record.cards[0].output = "card.png";
  });

  // When
  const result = runVerifier(root);

  // Then
  assert.equal(result.status, 1);
  assert.equal(errorCodes(result).has("SEMANTIC_FIELD_LEAKAGE"), true);
});

test("Given an absolute path enters the fixture manifest, When verified, Then path portability rejects it", async (context) => {
  // Given
  const root = await makeFixtureCopy(context);
  const fixtureManifest = await manifest(root);
  fixtureManifest.source.path = "/tmp/private-source.html";
  await writeJson(root, "fixtures/synthetic/manifest.json", fixtureManifest);

  // When
  const result = runVerifier(root);

  // Then
  assert.equal(result.status, 1);
  assert.equal(errorCodes(result).has("ABSOLUTE_PATH_FORBIDDEN"), true);
});

test("Given reference-project identity enters fixture content, When verified, Then the prohibited-content scan rejects it", async (context) => {
  // Given
  const root = await makeFixtureCopy(context);
  await mutateRecord(root, "EditorialBrief", (record) => {
    record.thesis = "DeepSeek reference copy";
  });

  // When
  const result = runVerifier(root);

  // Then
  assert.equal(result.status, 1);
  assert.equal(errorCodes(result).has("PROHIBITED_CONTENT"), true);
});

test("Given malformed manifest input, When verified, Then the CLI fails closed with machine-readable output", async (context) => {
  // Given
  const root = await makeFixtureCopy(context);
  await writeFile(path.join(root, "fixtures/synthetic/manifest.json"), "{broken", "utf8");

  // When
  const result = runVerifier(root);

  // Then
  assert.equal(result.status, 1);
  assert.equal(errorCodes(result).has("MANIFEST_INVALID"), true);
});
