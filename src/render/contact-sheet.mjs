import { fontFaceCss, systemCss } from "./design.mjs";
import { escapeHtml } from "./design.mjs";

export const buildContactSheetHtml = ({ input, cards }) => {
  const regular = input.fonts.regular.bytes.toString("base64");
  const bold = input.fonts.bold.bytes.toString("base64");
  const tiles = cards.map(({ cardId, png }, index) => `
<figure class="contact-sheet-tile" data-box>
  <img src="data:image/png;base64,${png.toString("base64")}" alt="${escapeHtml(cardId)} 전체 카드">
  <figcaption>${String(index + 1).padStart(2, "0")} · ${escapeHtml(cardId)}</figcaption>
</figure>`).join("");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:">
<style>${fontFaceCss({ regular, bold })}${systemCss}
body{width:var(--sheet-width);height:var(--sheet-height);overflow:hidden;background:var(--color-canvas);color:var(--color-text-primary)}
.sheet{width:var(--mechanic-full);height:var(--mechanic-full);padding:var(--sheet-padding)}
.sheet h1{margin:var(--mechanic-zero) var(--mechanic-zero) var(--sheet-gap);font-size:var(--sheet-title);line-height:var(--headline-leading)}
.tiles{display:grid;grid-template-columns:repeat(var(--sheet-columns),1fr);gap:var(--sheet-gap)}
.contact-sheet-tile{padding:var(--space-2)}.contact-sheet-tile img{aspect-ratio:var(--contact-aspect)}
.contact-sheet-tile figcaption{font-size:var(--caption-size)}
</style></head><body data-theme="${escapeHtml(input.theme.themeId)}"><main class="sheet">
<h1>${escapeHtml(input.theme.themeId)} · ${cards.length} cards</h1><div class="tiles">${tiles}</div></main></body></html>`;
};
