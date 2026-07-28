import { validateContract } from "../contracts/index.ts";
import { EvaluationError } from "./errors.mjs";

const sameArray = (left, right) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const normalizedCopy = (raw) => {
  const value = structuredClone(raw);
  if (typeof value.sourceRevision === "string") value.sourceRevision = value.sourceRevision.trim();
  if (typeof value.reviewer?.id === "string") value.reviewer.id = value.reviewer.id.trim();
  if (Array.isArray(value.blockers)) value.blockers = value.blockers.map((blocker) => blocker.trim());
  if (Array.isArray(value.differences)) {
    value.differences = value.differences.map((difference) => ({
      ...difference,
      description: typeof difference.description === "string"
        ? difference.description.trim()
        : difference.description
    }));
  }
  return value;
};

export const normalizeVisualVerdict = (raw, expected) => {
  const boundary = validateContract("VisualVerdictRecord", raw);
  if (!boundary.ok) {
    throw new EvaluationError("VISUAL_VERDICT_MALFORMED", "visual verdict does not match its contract", boundary.issues);
  }
  const value = normalizedCopy(boundary.value);
  const validation = validateContract("VisualVerdictRecord", value);
  if (!validation.ok) {
    throw new EvaluationError("VISUAL_VERDICT_MALFORMED", "visual verdict does not match its contract", validation.issues);
  }
  const verdict = validation.value;
  if (new Set(verdict.evidenceIdentity.paths).size !== verdict.evidenceIdentity.paths.length) {
    throw new EvaluationError("VISUAL_EVIDENCE_DUPLICATE", "visual evidence paths must be unique");
  }
  if (verdict.renderSetDigest !== expected.renderSetDigest) {
    throw new EvaluationError("VISUAL_RENDER_SET_MISMATCH", "visual verdict reviewed a different render set");
  }
  if (verdict.captureSetDigest !== expected.captureSetDigest) {
    throw new EvaluationError("VISUAL_CAPTURE_SET_MISMATCH", "visual verdict reviewed a different capture set");
  }
  if (verdict.sourceRevision !== expected.sourceRevision) {
    throw new EvaluationError("VISUAL_SOURCE_REVISION_MISMATCH", "visual verdict reviewed a different source revision");
  }
  if (!sameArray(verdict.evidenceIdentity.paths, expected.evidencePaths)) {
    throw new EvaluationError("VISUAL_EVIDENCE_MISMATCH", "visual verdict evidence inventory is incomplete or reordered");
  }
  const reviewedAt = Date.parse(verdict.evidenceIdentity.capturedAt);
  if (reviewedAt < expected.latestCaptureMtimeMs || reviewedAt > expected.nowMs) {
    throw new EvaluationError("VISUAL_VERDICT_STALE", "visual verdict is older than its captures or from the future");
  }
  const category = expected.pass === "A" ? "design-system" : "combined";
  if (verdict.category !== category) {
    throw new EvaluationError("VISUAL_CATEGORY_MISMATCH", `visual pass ${expected.pass} requires ${category}`);
  }
  const blockingDifference = verdict.differences.some((difference) => difference.severity === "blocking");
  if (
    verdict.blockers.some((blocker) => blocker.length === 0) ||
    verdict.differences.some((difference) => difference.description.length === 0) ||
    (verdict.verdict === "PASS" && (verdict.blockers.length > 0 || blockingDifference)) ||
    (verdict.verdict === "FAIL" && verdict.blockers.length === 0 && !blockingDifference)
  ) {
    throw new EvaluationError("VISUAL_VERDICT_INCONSISTENT", "visual verdict and blocking findings disagree");
  }
  return verdict;
};

export const normalizeVisualVerdictPair = ({ passA, passB }, expected) => {
  const normalizedA = normalizeVisualVerdict(passA, { ...expected, pass: "A" });
  const normalizedB = normalizeVisualVerdict(passB, { ...expected, pass: "B" });
  if (normalizedA.verdictId === normalizedB.verdictId) {
    throw new EvaluationError("VISUAL_VERDICT_DUPLICATE", "the same verdict cannot satisfy both passes");
  }
  if (normalizedA.reviewer.id === normalizedB.reviewer.id) {
    throw new EvaluationError("VISUAL_REVIEWER_NOT_INDEPENDENT", "visual passes require distinct reviewer sessions");
  }
  return { passA: normalizedA, passB: normalizedB };
};
