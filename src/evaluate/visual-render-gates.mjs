import { canonicalSha256, validateContract } from "../contracts/index.ts";

const unique = (values) => new Set(values).size === values.length;
const same = (left, right) =>
  left.length === right.length && left.every((value, index) => value === right[index]);
const loadedFonts = (geometry) => {
  const regular = geometry.fonts?.regular ?? [];
  const bold = geometry.fonts?.bold ?? [];
  return regular.length === 1 && bold.length === 1 &&
    regular[0].family === "Noto Sans CJK KR" && regular[0].weight === "400" && regular[0].status === "loaded" &&
    bold[0].family === "Noto Sans CJK KR" && bold[0].weight === "700" && bold[0].status === "loaded";
};
const noOverflow = (geometry) =>
  geometry.stableLayout === true &&
  geometry.viewport.scrollWidth <= geometry.viewport.width &&
  geometry.viewport.scrollHeight <= geometry.viewport.height &&
  geometry.boxes.every((box) =>
    box.scroll.width <= box.client.width + 1 && box.scroll.height <= box.client.height + 1
  );
const koreanSafe = (geometry) =>
  [...(geometry.lineGroups ?? []), ...(geometry.namedPhraseLines ?? [])]
    .every((group) => group.lineCount === 1);

export const visualAndRenderGates = (input) => {
  const { storyboard, visualRecipe, renderSpec } = input.records;
  const recipeCards = visualRecipe.cards ?? [];
  const artifacts = input.render.manifest.artifacts ?? [];
  const expectedIds = renderSpec.cardOrder ?? [];
  const actualIds = artifacts.map((artifact) => artifact.contract.cardId);
  const metadataByDigest = new Map(input.assetMetadata.map((metadata) => [metadata.assetDigest, metadata]));
  const requiredDependencies = input.requiredDependencyDigests;
  return [
    ["visual-recipe-schema", () => validateContract("VisualRecipe", visualRecipe).ok],
    ["visual-asset-slots", () =>
      unique(recipeCards.map((card) => card.cardId)) &&
      same(recipeCards.map((card) => card.cardId), storyboard.cards.map((card) => card.id)) &&
      recipeCards.every((card) =>
        unique(card.assetBindings.map((binding) => binding.slot)) &&
        card.assetBindings.every((binding) => {
          const metadata = metadataByDigest.get(binding.assetDigest);
          return metadata !== undefined &&
            metadata.binding.cardId === card.cardId &&
            metadata.binding.slot === binding.slot;
        })
      )],
    ["visual-rights", () =>
      input.records.source.provenance.rightsStatus !== "unknown" &&
      recipeCards.every((card) => card.assetBindings.every((binding) => {
        const metadata = metadataByDigest.get(binding.assetDigest);
        return binding.rights !== "unknown" &&
          metadata?.rights === binding.rights &&
          metadata.publicEligible === true &&
          metadata.publicPackageBlockers.length === 0;
      }))],
    ["visual-alt-text", () =>
      recipeCards.every((card) =>
        card.accessibilityText.trim() !== "" &&
        card.assetBindings.every((binding) => binding.altText.trim() !== "")
      )],
    ["visual-theme-target", () =>
      visualRecipe.themeId === renderSpec.theme.id &&
      visualRecipe.targetId === renderSpec.target.id &&
      visualRecipe.themeId === input.theme.themeId &&
      visualRecipe.targetId === input.target.targetId &&
      renderSpec.dimensions.width === input.target.dimensions.width &&
      renderSpec.dimensions.height === input.target.dimensions.height],
    ["render-schema", () =>
      validateContract("RenderSpec", renderSpec).ok &&
      artifacts.every((artifact) => validateContract("RenderArtifact", artifact.contract).ok)],
    ["render-offline", () =>
      input.render.networkRequests.length === 0 &&
      input.render.runtime.compromised === false],
    ["render-fonts", () => artifacts.every((artifact) => loadedFonts(artifact.geometry))],
    ["render-dimensions", () => artifacts.every((artifact) =>
      artifact.contract.width === renderSpec.dimensions.width &&
      artifact.contract.height === renderSpec.dimensions.height
    )],
    ["render-media", () => artifacts.every((artifact) => {
      const capture = input.render.captures[artifact.contract.cardId];
      return capture !== undefined &&
        artifact.contract.mediaType === `image/${renderSpec.codec}` &&
        artifact.contract.mediaSignature === capture.signature &&
        artifact.colorSpace === input.target.output.colorSpace;
    })],
    ["render-alpha", () => artifacts.every((artifact) => {
      const capture = input.render.captures[artifact.contract.cardId];
      return artifact.alpha === input.target.output.alpha && capture?.opaque === true;
    })],
    ["render-dependencies", () => artifacts.every((artifact) =>
      artifact.contract.renderSpecDigest === canonicalSha256(renderSpec) &&
      same(
        [...artifact.contract.dependencyDigests].sort(),
        [...requiredDependencies, artifact.canonicalRenderProfileDigest].sort()
      )
    )],
    ["render-overflow-clipping", () => artifacts.every((artifact) => noOverflow(artifact.geometry))],
    ["korean-overflow-indicators", () => artifacts.every((artifact) => koreanSafe(artifact.geometry))],
    ["card-inventory", () =>
      unique(actualIds) &&
      same(actualIds, expectedIds) &&
      same(input.render.manifest.cardOrder, expectedIds) &&
      same(storyboard.cards.map((card) => card.id), expectedIds)],
    ["capture-identity", () => artifacts.every((artifact) => {
      const capture = input.render.captures[artifact.contract.cardId];
      return capture !== undefined &&
        capture.relativePath === artifact.contract.relativePath &&
        capture.sha256 === artifact.contract.sha256 &&
        capture.width === artifact.contract.width &&
        capture.height === artifact.contract.height &&
        capture.size === artifact.byteCount;
    }) && same(Object.keys(input.render.captures).sort(), [...expectedIds].sort())],
    ["contact-sheet", () => {
      const contact = input.render.manifest.contactSheet;
      const capture = input.render.contactCapture;
      return same(contact.cardIds, expectedIds) &&
        capture.relativePath === contact.relativePath &&
        capture.sha256 === contact.sha256 &&
        capture.width === contact.width &&
        capture.height === contact.height &&
        capture.size === contact.byteCount &&
        capture.opaque;
    }],
    ["evidence-freshness", () =>
      input.render.manifest.sourceRevision === input.currentSourceRevision &&
      Object.values(input.render.captures).every((capture) => capture.mtimeMs >= input.latestSourceEditMs) &&
      input.render.contactCapture.mtimeMs >= input.latestSourceEditMs]
  ];
};
