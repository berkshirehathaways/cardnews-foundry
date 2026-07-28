import assert from "node:assert/strict";
import test from "node:test";
import {
  EvaluationError,
  normalizeVisualVerdict,
  normalizeVisualVerdictPair
} from "../../src/evaluate/index.mjs";

const digest = (character) => character.repeat(64);
const expectations = {
  renderSetDigest: digest("1"),
  captureSetDigest: digest("2"),
  sourceRevision: digest("3"),
  evidencePaths: ["captures/card-1.png", "captures/contact-sheet.png"],
  latestCaptureMtimeMs: Date.parse("2026-01-01T00:00:00Z"),
  nowMs: Date.parse("2026-01-01T00:02:00Z")
};
const verdict = (pass, reviewerId) => ({
  schemaVersion: "1.0.0",
  verdictId: `visual-pass-${pass.toLowerCase()}`,
  renderSetDigest: expectations.renderSetDigest,
  captureSetDigest: expectations.captureSetDigest,
  sourceRevision: expectations.sourceRevision,
  reviewer: { id: reviewerId, kind: "codex" },
  evidenceIdentity: {
    paths: [...expectations.evidencePaths],
    capturedAt: "2026-01-01T00:01:00Z"
  },
  category: pass === "A" ? "design-system" : "combined",
  differences: [],
  blockers: [],
  verdict: "PASS"
});

for (const [name, mutate, code] of [
  ["malformed", (value) => { value.verdict = "MAYBE"; }, "VISUAL_VERDICT_MALFORMED"],
  ["stale", (value) => { value.evidenceIdentity.capturedAt = "2025-12-31T23:59:59Z"; }, "VISUAL_VERDICT_STALE"],
  ["incomplete", (value) => { delete value.differences; }, "VISUAL_VERDICT_MALFORMED"],
  ["duplicate evidence", (value) => { value.evidenceIdentity.paths.push(value.evidenceIdentity.paths[0]); }, "VISUAL_EVIDENCE_DUPLICATE"],
  ["mismatched render", (value) => { value.renderSetDigest = digest("9"); }, "VISUAL_RENDER_SET_MISMATCH"]
]) {
  test(`Given a ${name} external verdict, When it is normalized, Then it is rejected with a typed boundary error`, () => {
    // Given
    const external = verdict("A", "reviewer-a");
    mutate(external);

    // When / Then
    assert.throws(
      () => normalizeVisualVerdict(external, { ...expectations, pass: "A" }),
      (error) => error instanceof EvaluationError && error.code === code
    );
  });
}

test("Given two verdicts from the same reviewer, When the pair is normalized, Then reviewer independence is rejected", () => {
  // Given
  const passA = verdict("A", "same-reviewer");
  const passB = verdict("B", "same-reviewer");

  // When / Then
  assert.throws(
    () => normalizeVisualVerdictPair({ passA, passB }, expectations),
    (error) => error instanceof EvaluationError && error.code === "VISUAL_REVIEWER_NOT_INDEPENDENT"
  );
});

test("Given one verdict reused under both pass labels, When the pair is normalized, Then duplicate verdict identity is rejected", () => {
  // Given
  const passA = verdict("A", "reviewer-a");
  const passB = { ...verdict("B", "reviewer-b"), verdictId: passA.verdictId };

  // When / Then
  assert.throws(
    () => normalizeVisualVerdictPair({ passA, passB }, expectations),
    (error) => error instanceof EvaluationError && error.code === "VISUAL_VERDICT_DUPLICATE"
  );
});
