import { EvaluationError } from "./errors.mjs";
import { computeEvaluationIdentities } from "./identity.mjs";
import { loadEvaluationInput } from "./input.mjs";
import { renderFixture } from "../render/index.mjs";

export const regenerateEvaluationCaptures = async ({
  repositoryRoot,
  fixtureRoot,
  outputRoot,
  latestEditAt,
  validatedFixture = false
}) => {
  const rendered = await renderFixture({ repositoryRoot, fixtureRoot, outputRoot, validatedFixture });
  const input = await loadEvaluationInput({ repositoryRoot, fixtureRoot, renderRoot: outputRoot });
  const identities = computeEvaluationIdentities(input);
  const requiredFreshness = Math.max(latestEditAt, input.latestSourceEditMs);
  const allFresh =
    Object.values(input.render.captures).every((capture) => capture.mtimeMs >= requiredFreshness) &&
    input.render.contactCapture.mtimeMs >= requiredFreshness;
  if (!allFresh) {
    throw new EvaluationError("CAPTURE_EVIDENCE_STALE", "capture regeneration predates the latest evaluated edit");
  }
  return {
    cardIds: rendered.cardIds,
    evidencePaths: identities.evidencePaths,
    renderSetDigest: identities.renderSetDigest,
    captureSetDigest: identities.captureSetDigest,
    sourceRevision: identities.sourceRevision,
    latestCaptureMtimeMs: identities.latestCaptureMtimeMs
  };
};
