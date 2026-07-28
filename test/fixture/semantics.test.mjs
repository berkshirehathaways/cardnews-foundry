import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  errorCodes,
  makeFixtureCopy,
  manifest,
  mutateRecord,
  readJson,
  runVerifier,
  writeJson
} from "./helpers.mjs";

for (const [name, stage, mutate, expected] of [
  ["duplicate span", "SourceEnvelope", (value) => value.spans.push(structuredClone(value.spans[0])), "DUPLICATE_SOURCE_SPAN_ID"],
  ["dangling span", "EditorialBrief", (value) => value.claims[0].sourceSpanIds[0] = "span-missing", "UNKNOWN_SOURCE_SPAN"],
  ["duplicate claim", "EditorialBrief", (value) => value.claims.push(structuredClone(value.claims[0])), "DUPLICATE_CLAIM_ID"],
  ["dangling claim", "Storyboard", (value) => value.cards[0].claimIds[0] = "claim-missing", "UNKNOWN_CLAIM"],
  ["duplicate card", "Storyboard", (value) => value.cards.push(structuredClone(value.cards[0])), "DUPLICATE_CARD_ID"],
  ["dangling card", "VisualRecipe", (value) => value.cards[0].cardId = "card-missing", "CARD_SET_MISMATCH"],
  ["duplicate slot", "VisualRecipe", (value) => value.cards[1].assetBindings.push(structuredClone(value.cards[0].assetBindings[0])), "DUPLICATE_ASSET_SLOT"],
  ["unsupported version", "RenderSpec", (value) => value.schemaVersion = "2.0.0", "UNSUPPORTED_SCHEMA_MAJOR"],
  ["wrong target", "RenderSpec", (value) => value.target.id = "target-missing", "TARGET_MISMATCH"],
  ["wrong theme", "RenderSpec", (value) => value.theme.id = "theme-missing", "THEME_MISMATCH"]
]) {
  test(`Given a ${name}, When verified, Then semantic validation rejects it`, async (context) => {
    // Given
    const root = await makeFixtureCopy(context);
    await mutateRecord(root, stage, mutate);

    // When
    const result = runVerifier(root);

    // Then
    assert.equal(result.status, 1);
    assert.equal(errorCodes(result).has(expected), true);
  });
}

test("Given asset metadata no longer matches its raw digest or recipe rights, When verified, Then both mismatches reject", async (context) => {
  // Given
  const root = await makeFixtureCopy(context);
  const fixtureManifest = await manifest(root);
  const metadata = await readJson(root, fixtureManifest.assets[0].metadataPath);
  metadata.assetDigest = "0".repeat(64);
  metadata.rights = "unknown";
  await writeJson(root, fixtureManifest.assets[0].metadataPath, metadata);

  // When
  const result = runVerifier(root);
  const codes = errorCodes(result);

  // Then
  assert.equal(result.status, 1);
  assert.equal(codes.has("ASSET_DIGEST_MISMATCH"), true);
  assert.equal(codes.has("ASSET_RIGHTS_MISMATCH"), true);
});

test("Given an imported asset metadata file is absent, When verified, Then its recipe slot is dangling", async (context) => {
  // Given
  const root = await makeFixtureCopy(context);
  const fixtureManifest = await manifest(root);
  await rm(path.join(root, fixtureManifest.assets[0].metadataPath));

  // When
  const result = runVerifier(root);

  // Then
  assert.equal(result.status, 1);
  assert.equal(errorCodes(result).has("FILE_MISSING"), true);
  assert.equal(errorCodes(result).has("DANGLING_ASSET_SLOT"), true);
});

test("Given a referenced font is missing, When verified, Then font resolution rejects", async (context) => {
  // Given
  const root = await makeFixtureCopy(context);
  const fixtureManifest = await manifest(root);
  const font = fixtureManifest.resources.fonts[0];
  await rm(path.join(root, font.path));

  // When
  const result = runVerifier(root);

  // Then
  assert.equal(result.status, 1);
  assert.equal(errorCodes(result).has("FONT_MISSING"), true);
});

test("Given the font manifest binds the wrong digest, When verified, Then font integrity rejects", async (context) => {
  // Given
  const root = await makeFixtureCopy(context);
  const fixtureManifest = await manifest(root);
  const fontManifest = await readJson(root, fixtureManifest.resources.fontManifest.path);
  fontManifest.fonts[0].sha256 = "0".repeat(64);
  await writeJson(root, fixtureManifest.resources.fontManifest.path, fontManifest);

  // When
  const result = runVerifier(root);

  // Then
  assert.equal(result.status, 1);
  assert.equal(errorCodes(result).has("FONT_DIGEST_MISMATCH"), true);
});
