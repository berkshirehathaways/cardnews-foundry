import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildPackageCandidate,
  computeEvaluationIdentities,
  evaluateGateMatrix,
  GATE_IDS,
  loadEvaluationInput,
  regenerateEvaluationCaptures
} from "../../src/evaluate/index.mjs";
import { applyBrokenFixture, packageFilesFromRender, readJson } from "./helpers.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(root, "fixtures", "synthetic");
const brokenFixtures = await readJson(path.join(root, "test", "evaluate", "fixtures", "broken-gates.json"));

let baseline;
let captureResult;
let temporaryRoot;

test.before(async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "cardnews-evaluate-matrix-"));
  const renderRoot = path.join(temporaryRoot, "render");
  captureResult = await regenerateEvaluationCaptures({
    repositoryRoot: root,
    fixtureRoot,
    outputRoot: renderRoot,
    latestEditAt: Date.now() - 1_000
  });
  baseline = await loadEvaluationInput({ repositoryRoot: root, fixtureRoot, renderRoot });
  const identities = computeEvaluationIdentities(baseline);
  const capturedAt = new Date(identities.latestCaptureMtimeMs + 1_000).toISOString();
  baseline.nowMs = Date.parse(capturedAt) + 1_000;
  baseline.verdicts = {
    passA: {
      schemaVersion: "1.0.0",
      verdictId: "visual-pass-a",
      renderSetDigest: identities.renderSetDigest,
      captureSetDigest: identities.captureSetDigest,
      sourceRevision: identities.sourceRevision,
      reviewer: { id: "reviewer-pass-a", kind: "codex" },
      evidenceIdentity: { paths: identities.evidencePaths, capturedAt },
      category: "design-system",
      differences: [],
      blockers: [],
      verdict: "PASS"
    },
    passB: {
      schemaVersion: "1.0.0",
      verdictId: "visual-pass-b",
      renderSetDigest: identities.renderSetDigest,
      captureSetDigest: identities.captureSetDigest,
      sourceRevision: identities.sourceRevision,
      reviewer: { id: "reviewer-pass-b", kind: "codex" },
      evidenceIdentity: { paths: identities.evidencePaths, capturedAt },
      category: "combined",
      differences: [],
      blockers: [],
      verdict: "PASS"
    }
  };
  baseline.package = {
    files: await packageFilesFromRender(renderRoot, baseline.render.manifest),
    manifest: buildPackageCandidate(baseline)
  };
});

test.after(async () => {
  await rm(temporaryRoot, { recursive: true, force: true });
});

test("Given the complete valid evaluation input, When all deterministic and normalized visual gates run, Then every declared gate passes in stable order", async () => {
  // Given
  const input = structuredClone(baseline);

  // When
  const result = await evaluateGateMatrix(input);

  // Then
  assert.deepEqual(result.report.gates.map((gate) => gate.id), GATE_IDS);
  assert.equal(
    result.report.gates.every((gate) => gate.status === "pass"),
    true,
    result.report.gates.filter((gate) => gate.status === "fail").map((gate) => gate.id).join(",")
  );
  assert.equal(result.report.blocking, false);
});

test("Given the latest evaluated source edit, When captures are regenerated through renderer primitives, Then every ordered card and contact sheet is fresh and identity-bound", () => {
  // Given / When
  const result = captureResult;

  // Then
  assert.deepEqual(result.cardIds, ["card-1", "card-2", "card-3", "card-4", "card-5", "card-6", "card-7"]);
  assert.equal(result.evidencePaths.length, 8);
  assert.match(result.renderSetDigest, /^[a-f0-9]{64}$/u);
  assert.match(result.captureSetDigest, /^[a-f0-9]{64}$/u);
});

for (const fixture of brokenFixtures) {
  test(`Given the deliberately broken ${fixture.gateId} fixture, When the matrix runs, Then ${fixture.gateId} blocks acceptance`, async () => {
    // Given
    const input = structuredClone(baseline);
    applyBrokenFixture(input, fixture);

    // When
    const result = await evaluateGateMatrix(input);
    const gate = result.report.gates.find((candidate) => candidate.id === fixture.gateId);

    // Then
    assert.equal(gate?.status, "fail");
    assert.equal(result.report.blocking, true);
  });
}

test("Given a score of 100 and a blocking visual finding, When the report is evaluated, Then score cannot override the blocker", async () => {
  // Given
  const input = structuredClone(baseline);
  input.score = 100;
  input.verdicts.passA.blockers.push("clipped closing statement");

  // When
  const result = await evaluateGateMatrix(input);

  // Then
  assert.equal(result.report.blocking, true);
  assert.equal(result.report.gates.find((gate) => gate.id === "package-preconditions")?.status, "fail");
});

test("Given no package manifest or bytes, When the complete matrix runs, Then package evidence and preconditions block", async () => {
  // Given
  const input = structuredClone(baseline);
  input.package = undefined;

  // When
  const result = await evaluateGateMatrix(input);

  // Then
  assert.equal(result.report.gates.find((gate) => gate.id === "package-schema")?.status, "fail");
  assert.equal(result.report.gates.find((gate) => gate.id === "package-preconditions")?.status, "fail");
  assert.equal(result.report.blocking, true);
});

for (const unsafeLocator of [
  "https://[fe80::1]/metadata",
  "https://metadata.google.internal/computeMetadata/v1/",
  "https://0x7f000001/private"
]) {
  test(`Given unsafe source locator ${unsafeLocator}, When source security runs, Then acceptance blocks`, async () => {
    // Given
    const input = structuredClone(baseline);
    input.records.source.provenance.finalLocator = unsafeLocator;

    // When
    const result = await evaluateGateMatrix(input);

    // Then
    assert.equal(result.report.gates.find((gate) => gate.id === "source-security")?.status, "fail");
  });
}

test("Given the frozen synthetic records, When evaluation completes, Then no record or source fixture byte changes", async () => {
  // Given
  const tracked = [
    "source/article.html",
    "records/source-envelope.json",
    "records/editorial-brief.json",
    "records/storyboard.json",
    "records/visual-recipe.json",
    "records/render-spec.json"
  ];
  const before = await Promise.all(tracked.map((name) => readFile(path.join(fixtureRoot, name))));

  // When
  await evaluateGateMatrix(structuredClone(baseline));
  const after = await Promise.all(tracked.map((name) => readFile(path.join(fixtureRoot, name))));

  // Then
  assert.deepEqual(after, before);
});
