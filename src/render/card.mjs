import { escapeHtml, fontFaceCss, systemCss } from "./design.mjs";
import { RenderError } from "./errors.mjs";
import { headlineScript, publicKoreanRole, semanticKoreanHtml } from "./korean.mjs";

const backgroundSlots = new Set(["background", "texture", "scene"]);
const isBackgroundBinding = (recipeCard, binding) =>
  backgroundSlots.has(binding.slot) || recipeCard.composition === "diagram";
const hasBackgroundMedia = (recipeCard) =>
  recipeCard.assetBindings.some((binding) => isBackgroundBinding(recipeCard, binding));

const imageFor = (binding, assets) => {
  const asset = assets.get(binding.assetDigest);
  if (asset === undefined) throw new RenderError("ASSET_BINDING_MISSING", binding.assetDigest);
  return `data:${asset.metadata.detectedMime};base64,${asset.bytes.toString("base64")}`;
};

const contentBindings = (recipeCard) =>
  recipeCard.assetBindings.filter((binding) => !isBackgroundBinding(recipeCard, binding));

const backgroundMedia = (recipeCard, assets) => recipeCard.assetBindings
  .filter((binding) => isBackgroundBinding(recipeCard, binding))
  .map((binding) => `
<figure class="background-media" data-variant="${escapeHtml(binding.slot)}">
  <img src="${imageFor(binding, assets)}" alt="${escapeHtml(binding.altText)}">
</figure>`).join("");

const media = (recipeCard, assets) => contentBindings(recipeCard).map((binding) => `
<figure class="media-frame" data-box data-variant="${escapeHtml(binding.slot)}">
  <div class="media-viewport"><img src="${imageFor(binding, assets)}" alt="${escapeHtml(binding.altText)}"></div>
</figure>`).join("");

const footer = () => '<footer class="provenance-footer" data-box aria-hidden="true"></footer>';

const headline = (card, variant) => `<header class="headline-block" data-box data-variant="${variant}" data-script="${headlineScript(card.headline)}">
  <span class="eyebrow">${semanticKoreanHtml(publicKoreanRole(card.role))}</span>
  <h1>${semanticKoreanHtml(card.headline)}</h1>
</header>`;

const body = (card, state = "plain") =>
  `<div class="body-block" data-box data-state="${state}"><p>${semanticKoreanHtml(card.body)}</p></div>`;

const emphasis = (values) => values.map((value) => semanticKoreanHtml(value)).join(" · ");

const splitStage = (card, recipeCard, assets) => {
  if (contentBindings(recipeCard).length === 0) {
    return `<div class="split-stage" data-state="evidence">
      <div class="evidence-block" data-box data-state="inset">
        <p>${emphasis(recipeCard.emphasis) || semanticKoreanHtml(publicKoreanRole(card.role))}</p>
      </div>
    </div>`;
  }
  return `<div class="split-stage" data-state="media">
    ${media(recipeCard, assets)}
    <aside class="callout-block" data-box data-state="insight">
      <p>${semanticKoreanHtml(recipeCard.emphasis[0])}</p>
    </aside>
  </div>`;
};

const diagram = (recipeCard) => recipeCard.emphasis
  .flatMap((value, index) => [
    index === 0 ? "" : '<i aria-hidden="true"></i>',
    `<span><b aria-hidden="true">${String(index + 1).padStart(2, "0")}</b><em>${semanticKoreanHtml(value)}</em></span>`
  ])
  .join("");

const composition = (card, recipeCard, assets) => {
  switch (recipeCard.composition) {
    case "headline":
      return `${headline(card, "display")}${body(card)}
        ${contentBindings(recipeCard).length > 0 ? `<div class="hero-region">${media(recipeCard, assets)}</div>` : ""}`;
    case "split":
      return `${headline(card, "headline")}
        ${splitStage(card, recipeCard, assets)}${body(card)}`;
    case "quote":
      return `${headline(card, "headline")}
        <blockquote class="quote-block" data-box>${semanticKoreanHtml(card.body)}</blockquote>
        <aside class="callout-block" data-box data-state="insight">
          <strong class="callout-label">${semanticKoreanHtml(publicKoreanRole(card.role))}</strong>
          <p>${emphasis(recipeCard.emphasis)}</p>
        </aside>`;
    case "diagram":
      return `${headline(card, "headline")}
        <div class="diagram" data-box role="img" aria-label="${escapeHtml(recipeCard.accessibilityText)}">
          ${diagram(recipeCard)}
        </div>${body(card, hasBackgroundMedia(recipeCard) ? "on-background" : "plain")}`;
    case "closing": {
      const closingState = backgroundMedia(recipeCard, assets) === "" ? "surface" : "over-background";
      return `${headline(card, "display")}<div class="accent-rule" aria-hidden="true"></div>
        <aside class="closing-statement" data-box data-state="${closingState}">
          <strong>${emphasis(recipeCard.emphasis)}</strong>
        </aside>${body(card)}`;
    }
    default:
      throw new RenderError("COMPOSITION_UNSUPPORTED", recipeCard.composition);
  }
};

export const buildCardHtml = ({ card, recipeCard, input, injectedCss = "", semanticTextTransform }) => {
  const transformed = semanticTextTransform?.({ headline: card.headline, body: card.body });
  const visibleCard = transformed === undefined ? card : {
    ...card,
    headline: transformed.headline ?? card.headline,
    body: transformed.body ?? card.body
  };
  const regular = input.fonts.regular.bytes.toString("base64");
  const bold = input.fonts.bold.bytes.toString("base64");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:">
<meta name="viewport" content="width=${input.target.dimensions.width},initial-scale=1">
<title>${escapeHtml(visibleCard.headline)}</title>
<style>${fontFaceCss({ regular, bold })}${systemCss}
body{width:var(--page-width);height:var(--page-height);overflow:hidden;background:var(--color-canvas)}
.card-content{min-height:var(--mechanic-zero);display:flex;flex-direction:column;gap:var(--card-content-gap)}
.card-content>*{flex:0 0 auto}
.background-media{position:absolute;inset:var(--mechanic-zero);z-index:var(--mechanic-zero);
  width:var(--mechanic-full);height:var(--mechanic-full);margin:var(--mechanic-zero)}
.background-media img{display:block;width:var(--mechanic-full);height:var(--mechanic-full);
  object-fit:cover;filter:var(--background-image-filter)}
.safe-area{z-index:1}
.card-content .headline-block{margin:var(--mechanic-zero);
  padding:var(--space-2) var(--mechanic-zero) var(--space-3)}
.card-content .headline-block .eyebrow{margin-bottom:var(--space-3)}
.card-content>.body-block,.card-content>.quote-block,.card-content>.callout-block{
  margin-top:var(--mechanic-zero)}
.card-content>.accent-rule{margin:var(--mechanic-zero)}
.media-viewport{width:var(--mechanic-full);height:var(--mechanic-full)}
.hero-region{height:var(--hero-height)}
.hero-region .media-frame{height:var(--mechanic-full);margin:var(--mechanic-zero)}
.split-stage{position:relative}
.split-stage[data-state="media"]{padding-bottom:var(--split-overlay-offset)}
.split-stage .media-frame{height:var(--split-media-height);margin:var(--mechanic-zero);
  padding:var(--mechanic-zero);overflow:hidden}
.split-stage .media-frame img{object-fit:cover}
.split-stage[data-state="media"] .callout-block{position:absolute;left:var(--split-overlay-inset);
  bottom:var(--mechanic-zero);width:var(--split-overlay-width);margin:var(--mechanic-zero)}
.split-stage[data-state="evidence"] .evidence-block{margin:var(--mechanic-zero)}
.diagram{display:flex;flex-direction:column;align-items:stretch;justify-content:center;
  gap:var(--diagram-item-gap);padding:var(--mechanic-zero)}
.diagram span{width:var(--mechanic-full);height:var(--diagram-node-height);
  flex:0 0 var(--diagram-node-height);display:grid;
  grid-template-columns:var(--diagram-index-width) minmax(var(--mechanic-zero),1fr);align-items:center;
  padding-inline:var(--space-3);border-left:var(--stroke-standard) solid var(--color-accent);
  background:var(--color-canvas);font-size:var(--body-size);line-height:var(--body-leading);
  font-weight:var(--font-weight-bold);word-break:keep-all}
.diagram span b{color:var(--color-accent);font-size:var(--caption-size);
  line-height:var(--caption-leading);letter-spacing:var(--caption-tracking)}
.diagram span em{font-style:normal}
.diagram i{display:block;width:var(--stroke-standard);height:var(--diagram-line-height);
  flex:0 0 var(--diagram-line-height);align-self:flex-start;background:var(--color-accent)}
.closing-statement{display:flex;flex-direction:column;gap:var(--space-1);
  padding:var(--space-4);background:var(--color-surface);border-radius:var(--radius-large);box-shadow:var(--shadow-soft)}
.closing-statement strong{font-size:var(--closing-size);line-height:var(--headline-leading)}
.closing-statement[data-state="over-background"]{max-width:var(--safe-width);
  padding:var(--space-3) var(--mechanic-zero);
  background:transparent;border-radius:var(--mechanic-zero);box-shadow:none}
.closing-statement[data-state="over-background"] strong{font-size:var(--headline-size);
  line-height:var(--headline-leading)}
${injectedCss}</style></head>
<body data-theme="${escapeHtml(input.theme.themeId)}">
<article class="card-shell" aria-label="${escapeHtml(recipeCard.accessibilityText)}">
${backgroundMedia(recipeCard, input.assets)}
<div class="safe-area">
  <div class="sequence-marker" data-box data-state="${visibleCard.role === "closing" ? "terminal" : "accent"}">
    <span>${String(visibleCard.order + 1).padStart(2, "0")} / ${String(input.storyboard.cards.length).padStart(2, "0")}</span>
  </div>
  <div class="card-content" data-composition="${escapeHtml(recipeCard.composition)}">
    ${composition(visibleCard, recipeCard, input.assets)}
  </div>
  ${footer()}
</div></article></body></html>`;
};
