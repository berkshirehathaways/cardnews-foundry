import { escapeHtml, fontFaceCss, systemCss } from "./design.mjs";
import { RenderError } from "./errors.mjs";
import { semanticKoreanHtml } from "./korean.mjs";

const imageFor = (binding, assets) => {
  const asset = assets.get(binding.assetDigest);
  if (asset === undefined) throw new RenderError("ASSET_BINDING_MISSING", binding.assetDigest);
  return `data:${asset.metadata.detectedMime};base64,${asset.bytes.toString("base64")}`;
};

const media = (recipeCard, assets) => recipeCard.assetBindings.map((binding) => `
<figure class="media-frame" data-box data-variant="${escapeHtml(binding.slot)}">
  <div class="media-viewport"><img src="${imageFor(binding, assets)}" alt="${escapeHtml(binding.altText)}"></div>
</figure>`).join("");

const footerMood = (value) => value.replace(/^(?:\s*·)+\s*/u, "").trim();

const footer = (card, recipeCard) => `<footer class="provenance-footer" data-box>
  <span>${escapeHtml(card.role)} · ${semanticKoreanHtml(footerMood(recipeCard.mood))}</span>
  <span>${escapeHtml(card.id)}</span>
</footer>`;

const headline = (card, variant) => `<header class="headline-block" data-box data-variant="${variant}">
  <span class="eyebrow">${escapeHtml(card.role)}</span>
  <h1>${semanticKoreanHtml(card.headline)}</h1>
</header>`;

const body = (card) =>
  `<div class="body-block" data-box><p>${semanticKoreanHtml(card.body)}</p></div>`;

const emphasis = (recipeCard) =>
  recipeCard.emphasis.map((value) => semanticKoreanHtml(value)).join(" · ");

const splitSupport = (card, recipeCard, assets) => recipeCard.assetBindings.length > 0
  ? media(recipeCard, assets)
  : `<div class="evidence-block" data-box data-state="inset">
      <span class="evidence-label">${semanticKoreanHtml(recipeCard.mood)}</span>
      <p>${emphasis(recipeCard)}</p>
    </div>`;

const composition = (card, recipeCard, assets) => {
  switch (recipeCard.composition) {
    case "headline":
      return `${headline(card, "display")}${body(card)}
        <div class="hero-region">${media(recipeCard, assets)}</div>`;
    case "split":
      return `${headline(card, "headline")}
        <div class="split-region">
          <aside class="callout-block" data-box data-state="insight">
            <strong class="callout-label">${escapeHtml(card.role)}</strong>
            <p>${semanticKoreanHtml(recipeCard.mood)}</p>
          </aside>
          <div class="split-support">${splitSupport(card, recipeCard, assets)}</div>
        </div>${body(card)}`;
    case "quote":
      return `${headline(card, "headline")}
        <blockquote class="quote-block" data-box>${semanticKoreanHtml(card.body)}</blockquote>
        <aside class="callout-block" data-box data-state="insight">
          <strong class="callout-label">${semanticKoreanHtml(recipeCard.mood)}</strong>
          <p>${emphasis(recipeCard)}</p>
        </aside>`;
    case "diagram":
      return `${headline(card, "headline")}
        <div class="diagram" data-box role="img" aria-label="${escapeHtml(recipeCard.accessibilityText)}">
          <span>${escapeHtml(card.role)}</span><i aria-hidden="true"></i>
          <span>${semanticKoreanHtml(recipeCard.mood)}</span><i aria-hidden="true"></i>
          <span>${emphasis(recipeCard)}</span>
        </div>${body(card)}`;
    case "closing":
      return `${headline(card, "display")}<div class="accent-rule" aria-hidden="true"></div>
        <aside class="closing-statement" data-box>
          <strong>${emphasis(recipeCard)}</strong>
          <span>${semanticKoreanHtml(recipeCard.mood)}</span>
        </aside>${body(card)}`;
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
.card-content .headline-block{margin:var(--mechanic-zero);
  padding:var(--space-2) var(--mechanic-zero) var(--space-3)}
.card-content .headline-block .eyebrow{margin-bottom:var(--space-3)}
.card-content>.body-block,.card-content>.quote-block,.card-content>.callout-block{
  margin-top:var(--mechanic-zero)}
.card-content>.accent-rule{margin:var(--mechanic-zero)}
.media-viewport{width:var(--mechanic-full);height:var(--mechanic-full)}
.hero-region{height:var(--hero-height)}
.hero-region .media-frame{height:var(--mechanic-full);margin:var(--mechanic-zero)}
.split-region{display:grid;grid-template-columns:minmax(var(--mechanic-zero),var(--split-left))
  minmax(var(--mechanic-zero),var(--split-right));gap:var(--space-4);align-items:center}
.split-region .media-frame{height:var(--split-media-height);margin:var(--mechanic-zero)}
.split-region .callout-block,.split-region .evidence-block{margin-top:var(--mechanic-zero)}
.diagram{display:flex;align-items:center;justify-content:center;gap:var(--diagram-item-gap);
  padding:var(--space-4);background:var(--color-surface);border:var(--stroke-standard) solid var(--color-rule);
  border-radius:var(--radius-large);box-shadow:var(--shadow-soft)}
.diagram span{width:var(--diagram-node-basis);height:var(--diagram-node-basis);
  flex:0 0 var(--diagram-node-basis);display:grid;place-items:center;text-align:center;
  border:var(--stroke-standard) solid var(--color-accent);border-radius:var(--mechanic-full);
  font-size:var(--body-size);line-height:var(--body-leading);font-weight:var(--font-weight-bold);word-break:keep-all}
.diagram i{display:block;width:var(--diagram-line-basis);height:var(--stroke-standard);
  flex:0 0 var(--diagram-line-basis);background:var(--color-rule)}
.closing-statement{display:flex;flex-direction:column;gap:var(--space-1);
  padding:var(--space-4);background:var(--color-surface);border-radius:var(--radius-large);box-shadow:var(--shadow-soft)}
.closing-statement strong,.closing-statement span{font-size:var(--closing-size);line-height:var(--headline-leading)}
.closing-statement span{color:var(--color-accent);font-weight:var(--font-weight-bold)}
${injectedCss}</style></head>
<body data-theme="${escapeHtml(input.theme.themeId)}">
<article class="card-shell" aria-label="${escapeHtml(recipeCard.accessibilityText)}">
<div class="safe-area">
  <div class="sequence-marker" data-box data-state="${visibleCard.role === "closing" ? "terminal" : "accent"}">
    <span>${String(visibleCard.order + 1).padStart(2, "0")} / ${String(input.storyboard.cards.length).padStart(2, "0")}</span>
  </div>
  <div class="card-content" data-composition="${escapeHtml(recipeCard.composition)}">
    ${composition(visibleCard, recipeCard, input.assets)}
  </div>
  ${footer(visibleCard, recipeCard)}
</div></article></body></html>`;
};
