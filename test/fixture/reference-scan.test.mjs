import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  errorCodes,
  makeFixtureCopy,
  manifest,
  readJson,
  resealRecordChain,
  runVerifier,
  stageEntry,
  writeCanonicalJson,
  writeJson
} from "./helpers.mjs";

const mutateBriefAndReseal = async (root, thesis) => {
  const fixtureManifest = await manifest(root);
  const entry = stageEntry(fixtureManifest, "EditorialBrief");
  const brief = await readJson(root, entry.path);
  brief.thesis = thesis;
  await writeCanonicalJson(root, entry.path, brief);
  await resealRecordChain(root);
};

for (const variant of [
  "DeepSeek",
  "dEePsEeK",
  "Deep-Seek",
  "Deep Seek",
  "Ｄｅｅｐ－Ｓｅｅｋ",
  "Deep\u200bSeek",
  "Deep\u202e\u202cSeek",
  "Deep\u2066Seek\u2069",
  "\u1105\u1163\u11bc\u110b\u116f\u11ab\u1111\u1165\u11bc",
  "Liang.Wenfeng"
]) {
  test(`normalized prohibited reference variant is rejected: ${variant}`, async (context) => {
    const root = await makeFixtureCopy(context);
    await mutateBriefAndReseal(root, `${variant} reference copy`);
    const result = runVerifier(root);
    assert.equal(result.status, 1);
    assert.deepEqual([...errorCodes(result)], ["PROHIBITED_CONTENT"]);
  });
}

for (const safeText of [
  "Deep sea keeps a fictional seed archive calm.",
  "A deep-seeking fictional explorer catalogs seeds.",
  "Liang Wen fern is not a named reference.",
  "deep seek as two ordinary English words",
  "DeepSeekable is an original compound.",
  "NotDeepSeek is an unrelated prefixed token.",
  "A Deep-Seek-inspired fictional method remains original."
]) {
  test(`safe near-miss original text passes: ${safeText}`, async (context) => {
    const root = await makeFixtureCopy(context);
    await mutateBriefAndReseal(root, safeText);
    const result = runVerifier(root);
    assert.equal(result.status, 0, result.stdout);
    assert.equal(result.report.ok, true);
  });
}

test("JSON-escaped prohibited identity is decoded before scanning and precedes canonical-byte errors", async (context) => {
  const root = await makeFixtureCopy(context);
  await mutateBriefAndReseal(root, "DeepSeek");
  await resealRecordChain(root, {
    stage: "EditorialBrief",
    transform: (bytes) => Buffer.from(bytes.toString("utf8").replace(
      "DeepSeek",
      String.raw`\u0044\u0065\u0065\u0070\u0053\u0065\u0065\u006b`
    ))
  });
  const result = runVerifier(root);
  assert.equal(result.status, 1);
  assert.equal(result.report.errors[0].code, "PROHIBITED_CONTENT");
  assert.equal(errorCodes(result).has("NON_CANONICAL_JSON"), true);
  assert.equal(errorCodes(result).has("DIGEST_MISMATCH"), false);
});

test("prohibited content precedes digest drift when record bytes are not resealed", async (context) => {
  const root = await makeFixtureCopy(context);
  const fixtureManifest = await manifest(root);
  const entry = stageEntry(fixtureManifest, "EditorialBrief");
  const brief = await readJson(root, entry.path);
  brief.thesis = "Deep\u200bSeek";
  await writeCanonicalJson(root, entry.path, brief);
  const result = runVerifier(root);
  assert.equal(result.status, 1);
  assert.equal(result.report.errors[0].code, "PROHIBITED_CONTENT");
  assert.equal(errorCodes(result).has("DIGEST_MISMATCH"), true);
});

test("prohibited content in a fully resealed source file is rejected", async (context) => {
  const root = await makeFixtureCopy(context);
  const fixtureManifest = await manifest(root);
  const sourcePath = path.join(root, fixtureManifest.source.path);
  const sourceBytes = Buffer.concat([await readFile(sourcePath), Buffer.from("\n<!-- Deep Seek -->")]);
  await writeFile(sourcePath, sourceBytes);
  fixtureManifest.source.sha256 = createHash("sha256").update(sourceBytes).digest("hex");
  fixtureManifest.source.byteCount = sourceBytes.byteLength;
  const sourceEntry = stageEntry(fixtureManifest, "SourceEnvelope");
  const envelope = await readJson(root, sourceEntry.path);
  envelope.provenance.rawSha256 = fixtureManifest.source.sha256;
  envelope.provenance.rawByteCount = fixtureManifest.source.byteCount;
  await writeCanonicalJson(root, sourceEntry.path, envelope);
  await writeJson(root, "fixtures/synthetic/manifest.json", fixtureManifest);
  await resealRecordChain(root);
  const result = runVerifier(root);
  assert.deepEqual([...errorCodes(result)], ["PROHIBITED_CONTENT"]);
});

test("prohibited reference identity in a filename is rejected without reading binary bytes as text", async (context) => {
  const root = await makeFixtureCopy(context);
  const fixtureManifest = await manifest(root);
  const asset = fixtureManifest.assets[0];
  const renamed = asset.path.replace("asset.bin", "Deep-Seek.bin");
  await rename(path.join(root, asset.path), path.join(root, renamed));
  asset.path = renamed;
  await writeCanonicalJson(root, "fixtures/synthetic/manifest.json", fixtureManifest);
  const result = runVerifier(root);
  assert.deepEqual([...errorCodes(result)], ["PROHIBITED_CONTENT"]);
});

test("prohibited identity in a multi-suffix filename is rejected", async (context) => {
  const root = await makeFixtureCopy(context);
  const fixtureManifest = await manifest(root);
  const asset = fixtureManifest.assets[0];
  const renamed = asset.path.replace("asset.bin", "Deep-Seek.backup.bin");
  await rename(path.join(root, asset.path), path.join(root, renamed));
  asset.path = renamed;
  await writeCanonicalJson(root, "fixtures/synthetic/manifest.json", fixtureManifest);
  const result = runVerifier(root);
  assert.deepEqual([...errorCodes(result)], ["PROHIBITED_CONTENT"]);
});

test("prohibited reference identity in resealed asset metadata is rejected", async (context) => {
  const root = await makeFixtureCopy(context);
  const fixtureManifest = await manifest(root);
  const asset = fixtureManifest.assets[0];
  const metadata = await readJson(root, asset.metadataPath);
  metadata.originNote = "Generated locally; Liang-Wenfeng reference";
  const bytes = await writeCanonicalJson(root, asset.metadataPath, metadata);
  asset.metadataSha256 = createHash("sha256").update(bytes).digest("hex");
  asset.metadataByteCount = bytes.byteLength;
  for (const entry of fixtureManifest.records) {
    const dependency = entry.dependencies.find((candidate) => candidate.key === asset.metadataKey);
    if (dependency !== undefined) dependency.sha256 = asset.metadataSha256;
  }
  await writeCanonicalJson(root, "fixtures/synthetic/manifest.json", fixtureManifest);
  const result = runVerifier(root);
  assert.deepEqual([...errorCodes(result)], ["PROHIBITED_CONTENT"]);
});
