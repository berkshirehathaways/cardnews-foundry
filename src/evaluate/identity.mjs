import { canonicalSha256 } from "../contracts/index.ts";

export const computeEvaluationIdentities = (input) => {
  const orderedRenders = input.render.manifest.artifacts.map((artifact) => ({
    cardId: artifact.contract.cardId,
    sha256: artifact.contract.sha256
  }));
  const orderedCaptures = input.render.manifest.cardOrder.map((cardId) => {
    const capture = input.render.captures[cardId];
    return {
      cardId,
      relativePath: capture?.relativePath ?? "",
      sha256: capture?.sha256 ?? ""
    };
  });
  const contact = input.render.contactCapture;
  const captureSet = [
    ...orderedCaptures,
    {
      cardId: "contact-sheet",
      relativePath: contact.relativePath,
      sha256: contact.sha256
    }
  ];
  const captureTimes = [
    ...Object.values(input.render.captures).map((capture) => capture.mtimeMs),
    contact.mtimeMs
  ];
  return {
    renderSetDigest: canonicalSha256(orderedRenders),
    captureSetDigest: canonicalSha256(captureSet),
    sourceRevision: input.render.manifest.sourceRevision,
    evidencePaths: captureSet.map((capture) => capture.relativePath),
    latestCaptureMtimeMs: Math.max(...captureTimes)
  };
};
