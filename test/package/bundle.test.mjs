import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildGeneratedBundle,
  inspectGeneratedBundle
} from "../../src/package/index.mjs";
import {
  computeEvaluationIdentities,
  loadEvaluationInput,
  regenerateEvaluationCaptures
} from "../../src/evaluate/index.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(repositoryRoot, "fixtures", "synthetic");

let input;
let verdicts;
let temporary;

test.before(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), "cardnews-package-test-"));
  const renderRoot = path.join(temporary, "render");
  await regenerateEvaluationCaptures({
    repositoryRoot,
    fixtureRoot,
    outputRoot: renderRoot,
    latestEditAt: Date.now() - 1_000
  });
  input = await loadEvaluationInput({ repositoryRoot, fixtureRoot, renderRoot });
  const identity = computeEvaluationIdentities(input);
  const capturedAt = new Date(identity.latestCaptureMtimeMs + 1_000).toISOString();
  input.nowMs = Date.parse(capturedAt) + 1_000;
  verdicts = {
    passA: {
      schemaVersion: "1.0.0",
      verdictId: "t12-pass-a",
      renderSetDigest: identity.renderSetDigest,
      captureSetDigest: identity.captureSetDigest,
      sourceRevision: identity.sourceRevision,
      reviewer: { id: "independent-a", kind: "codex" },
      evidenceIdentity: { paths: identity.evidencePaths, capturedAt },
      category: "design-system",
      differences: [],
      blockers: [],
      verdict: "PASS"
    },
    passB: {
      schemaVersion: "1.0.0",
      verdictId: "t12-pass-b",
      renderSetDigest: identity.renderSetDigest,
      captureSetDigest: identity.captureSetDigest,
      sourceRevision: identity.sourceRevision,
      reviewer: { id: "independent-b", kind: "human" },
      evidenceIdentity: { paths: identity.evidencePaths, capturedAt },
      category: "combined",
      differences: [],
      blockers: [],
      verdict: "PASS"
    }
  };
});

test.after(async () => {
  await rm(temporary, { recursive: true, force: true });
});

test("Given current render and independent normalized T12 verdicts, When a bundle is built twice, Then only distributable files exist and ZIP bytes match", async () => {
  // Given
  const request = { slug: "moonlight-library", input, verdicts };

  // When
  const first = await buildGeneratedBundle(request);
  const second = await buildGeneratedBundle(request);
  const inspected = inspectGeneratedBundle(first.bytes);

  // Then
  assert.deepEqual(first.bytes, second.bytes);
  assert.equal(first.report.blocking, false);
  assert.equal(first.report.gates.every((gate) => gate.status === "pass"), true);
  assert.deepEqual(inspected.paths, [
    "cards/card-1.png",
    "cards/card-2.png",
    "cards/card-3.png",
    "cards/card-4.png",
    "cards/card-5.png",
    "cards/card-6.png",
    "cards/card-7.png",
    "contact-sheet.png",
    "manifest.json",
    "metadata/attribution.json",
    "metadata/source-summary.json",
    "reports/evaluation-summary.json"
  ]);
  assert.equal(inspected.manifest.files.every((file) => !path.isAbsolute(file.relativePath)), true);
  assert.equal(inspected.text.includes(input.records.source.spans[1].text), false);
  assert.equal(inspected.text.includes(repositoryRoot), false);
});

test("Given unknown source publication rights, When packaging is requested, Then class 6 blocks before ZIP acceptance", async () => {
  // Given
  const unsafeInput = structuredClone(input);
  unsafeInput.records.source.provenance.rightsStatus = "unknown";

  // When / Then
  await assert.rejects(
    buildGeneratedBundle({ slug: "unknown-rights", input: unsafeInput, verdicts }),
    (error) => error.code === "PUBLICATION_RIGHTS_UNKNOWN" && error.exitClass === 6
  );
});

test("Given a current bundle, When its manifest digest is changed, Then independent inspection rejects the archive", async () => {
  // Given
  const bundle = await buildGeneratedBundle({ slug: "tamper-check", input, verdicts });
  const manifest = structuredClone(bundle.manifest);
  manifest.files[0].sha256 = "0".repeat(64);
  const replacement = Buffer.from(JSON.stringify(manifest));

  // When / Then
  assert.notEqual(replacement.length, 0);
  assert.equal((await readFile(path.join(input.renderRoot, "cards", "card-1.png"))).length > 0, true);
  assert.throws(
    () => inspectGeneratedBundle(bundle.bytes, { expectedManifest: manifest }),
    (error) => error.code === "PACKAGE_DIGEST_MISMATCH" && error.exitClass === 6
  );
});

