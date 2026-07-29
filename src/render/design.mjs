export const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

export const fontFaceCss = ({ regular, bold }) => `
@font-face{font-family:"Noto Sans CJK KR";src:url(data:font/otf;base64,${regular}) format("opentype");font-style:normal;font-weight:400;font-display:block}
@font-face{font-family:"Noto Sans CJK KR";src:url(data:font/otf;base64,${bold}) format("opentype");font-style:normal;font-weight:700;font-display:block}`;

export const designTokens = Object.freeze({
  "--mechanic-zero": "0",
  "--mechanic-full": "100%",
  "--mechanic-border-box": "border-box",
  "--font-weight-regular": "400",
  "--font-weight-bold": "700",
  "--unit": "4px",
  "--page-width": "1080px",
  "--page-height": "1350px",
  "--safe-top": "120px",
  "--safe-right": "96px",
  "--safe-bottom": "120px",
  "--safe-left": "96px",
  "--safe-width": "888px",
  "--safe-height": "1110px",
  "--showcase-max": "1280px",
  "--showcase-gutter": "24px",
  "--showcase-tile-min": "320px",
  "--focus-width": "4px",
  "--transition-theme": "160ms ease-out",
  "--motion-none": "0s",
  "--showcase-card-width": "540px",
  "--showcase-card-height": "675px",
  "--showcase-pad": "32px",
  "--showcase-control": "44px",
  "--showcase-gap": "20px",
  "--showcase-radius": "20px",
  "--showcase-border": "2px",
  "--media-size": "220px",
  "--media-small": "144px",
  "--contact-aspect": "4 / 5",
  "--opacity-muted": ".72",
  "--opacity-hidden": "0",
  "--background-image-filter": "brightness(.32) saturate(.9)",
  "--showcase-filter-muted": "grayscale(1) opacity(.35)",
  "--showcase-stage-color": "#ECEFF3",
  "--showcase-ink-color": "#17212B",
  "--showcase-border-color": "#52606D",
  "--showcase-accent-color": "#C95B2B",
  "--showcase-title-min": "32px",
  "--showcase-title-fluid": "6vw",
  "--showcase-title-max": "64px",
  "--showcase-title-leading": "1.08",
  "--showcase-copy-width": "720px",
  "--showcase-copy-size": "20px",
  "--showcase-copy-leading": "1.55",
  "--showcase-control-gap": "12px",
  "--showcase-radio-size": "24px",
  "--showcase-card-min-height": "480px",
  "--showcase-card-compact-height": "420px",
  "--showcase-media-height": "320px",
  "--showcase-stat-min": "52px",
  "--showcase-stat-fluid": "8vw",
  "--showcase-tile-fluid": "10vw",
  "--showcase-breakpoint": "600px",
  "--showcase-compact-type": "16px",
  "--showcase-body-min": "20px",
  "--showcase-body-fluid": "3vw",
  "--showcase-body-max": "28px",
  "--showcase-heading-min": "34px",
  "--showcase-heading-fluid": "5vw",
  "--showcase-caption-fluid": "2vw",
  "--hero-height": "410px",
  "--split-media-height": "480px",
  "--split-overlay-width": "520px",
  "--split-overlay-inset": "32px",
  "--split-overlay-offset": "56px",
  "--card-section-gap": "24px",
  "--card-content-gap": "32px",
  "--footer-paint-clearance": "8px",
  "--diagram-node-height": "92px",
  "--diagram-line-height": "24px",
  "--diagram-index-width": "72px",
  "--diagram-item-gap": "0px",
  "--closing-size": "48px",
  "--sheet-width": "1080px",
  "--sheet-height": "1480px",
  "--sheet-columns": "3",
  "--sheet-padding": "40px",
  "--sheet-gap": "24px",
  "--sheet-title": "48px"
});

const rootTokenCss = Object.entries(designTokens)
  .map(([name, value]) => `${name}:${value}`)
  .join(";");

export const systemCss = `
:root{${rootTokenCss}}
*{box-sizing:var(--mechanic-border-box)}
html,body{margin:var(--mechanic-zero);min-width:var(--mechanic-zero)}
body{font-family:"Noto Sans CJK KR";background:var(--showcase-stage-color);color:var(--showcase-ink-color)}
button,input{font:inherit}
[data-theme="ink-paper"]{
  --color-canvas:#F6F0E4;--color-surface:#FFFDF8;--color-text-primary:#17212B;
  --color-text-secondary:#52606D;--color-accent:#C95B2B;--color-rule:#D8CDBB;
  --shadow-soft-color:#D8CDBB;--shadow-strong-color:#52606D;
  --display-size:92px;--display-leading:1.05;--display-tracking:-.04em;
  --headline-size:62px;--headline-leading:1.16;--headline-tracking:-.02em;
  --mixed-headline-size:56px;
  --body-size:34px;--body-leading:1.48;--body-tracking:0em;
  --caption-size:24px;--caption-leading:1.35;--caption-tracking:.02em;
  --space-1:8px;--space-2:16px;--space-3:24px;--space-4:40px;--space-5:64px;--space-6:96px;
  --radius-small:12px;--radius-medium:24px;--radius-large:40px;
  --stroke-hairline:1px;--stroke-standard:3px;
  --shadow-soft:0 12px 24px var(--shadow-soft-color);
  --shadow-strong:0 24px 48px var(--shadow-strong-color);
}
[data-theme="signal-night"]{
  --color-canvas:#10131F;--color-surface:#1B2033;--color-text-primary:#F8FAFF;
  --color-text-secondary:#B6C2D9;--color-accent:#67E8F9;--color-rule:#33415E;
  --shadow-soft-color:#33415E;--shadow-strong-color:#10131F;
  --display-size:84px;--display-leading:1.1;--display-tracking:-.03em;
  --headline-size:58px;--headline-leading:1.2;--headline-tracking:-.01em;
  --mixed-headline-size:52px;
  --body-size:32px;--body-leading:1.52;--body-tracking:.01em;
  --caption-size:22px;--caption-leading:1.4;--caption-tracking:.04em;
  --space-1:6px;--space-2:12px;--space-3:20px;--space-4:32px;--space-5:52px;--space-6:84px;
  --radius-small:4px;--radius-medium:12px;--radius-large:20px;
  --stroke-hairline:1px;--stroke-standard:2px;
  --shadow-soft:0 8px 20px var(--shadow-soft-color);
  --shadow-strong:0 20px 40px var(--shadow-strong-color);
}
.card-shell{
  position:relative;overflow:hidden;background:var(--color-canvas);color:var(--color-text-primary);
  width:var(--page-width);height:var(--page-height);
}
.safe-area{
  position:absolute;inset:var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left);
  width:var(--safe-width);height:var(--safe-height);display:grid;
  grid-template-rows:max-content minmax(var(--mechanic-zero),1fr) max-content;
  row-gap:var(--card-section-gap);
}
.sequence-marker{display:flex;align-items:center;gap:var(--space-2);padding-block:var(--space-1);font-size:var(--caption-size);
  line-height:var(--caption-leading);letter-spacing:var(--caption-tracking);color:var(--color-text-secondary)}
.sequence-marker::before{content:"";display:block;width:var(--space-5);height:var(--stroke-standard);background:var(--color-accent)}
.sequence-marker[data-state="terminal"]::before{width:var(--space-6)}
.headline-block{margin-top:var(--space-4);padding-block:var(--space-2)}
.headline-block h1{margin:var(--mechanic-zero);font-size:var(--headline-size);line-height:var(--headline-leading);
  letter-spacing:var(--headline-tracking);font-weight:700;word-break:keep-all;overflow-wrap:normal}
.headline-block[data-variant="display"] h1{font-size:var(--display-size);line-height:var(--display-leading);letter-spacing:var(--display-tracking)}
.headline-block[data-script="mixed"] h1{font-size:var(--mixed-headline-size)}
.headline-block .eyebrow{display:block;margin-bottom:var(--space-2);font-size:var(--caption-size);
  line-height:var(--caption-leading);letter-spacing:var(--caption-tracking);color:var(--color-accent);font-weight:700}
.body-block,.evidence-block,.quote-block,.callout-block{font-size:var(--body-size);line-height:var(--body-leading);
  letter-spacing:var(--body-tracking);word-break:keep-all;overflow-wrap:normal}
.keep-phrase{white-space:nowrap}
.body-block p,.evidence-block p,.callout-block p{margin:var(--mechanic-zero)}
.body-block{margin-top:var(--space-4);color:var(--color-text-secondary)}
.body-block[data-state="on-background"]{margin-top:var(--mechanic-zero);padding:var(--space-3);
  color:var(--color-text-secondary);background:var(--color-canvas);
  border-left:var(--stroke-standard) solid var(--color-accent)}
.evidence-block,.callout-block{margin-top:var(--space-4);padding:var(--space-3);background:var(--color-surface);
  border:var(--stroke-standard) solid var(--color-rule);border-radius:var(--radius-medium);box-shadow:var(--shadow-soft)}
.evidence-block[data-state="warning"],.callout-block[data-state="warning"]{border-color:var(--color-accent)}
.evidence-label,.callout-label{display:block;margin-bottom:var(--space-2);font-size:var(--caption-size);
  line-height:var(--caption-leading);color:var(--color-accent);font-weight:700}
.media-frame{margin:var(--space-4) var(--mechanic-zero) var(--mechanic-zero);padding:var(--space-3);
  background:var(--color-surface);border:var(--stroke-standard) solid var(--color-rule);
  border-radius:var(--radius-large);box-shadow:var(--shadow-strong)}
.media-frame img{display:block;width:var(--mechanic-full);height:var(--mechanic-full);object-fit:contain}
.media-frame figcaption{margin-top:var(--space-2);font-size:var(--caption-size);line-height:var(--caption-leading);color:var(--color-text-secondary)}
.accent-rule{width:var(--mechanic-full);height:var(--stroke-standard);margin:var(--space-4) var(--mechanic-zero);background:var(--color-accent)}
.stat-block{display:grid;gap:var(--space-1);padding:var(--space-3);border-left:var(--space-1) solid var(--color-accent)}
.stat-value{font-size:var(--display-size);line-height:var(--display-leading);font-weight:700;color:var(--color-text-primary)}
.stat-label{font-size:var(--body-size);line-height:var(--body-leading);color:var(--color-text-secondary);
  word-break:keep-all;overflow-wrap:normal}
.quote-block{margin:var(--space-4) var(--mechanic-zero) var(--mechanic-zero);padding:var(--space-4);
  border-left:var(--space-2) solid var(--color-accent);background:var(--color-surface);color:var(--color-text-primary)}
.provenance-footer{min-height:var(--stroke-hairline);border-top:var(--stroke-hairline) solid var(--color-rule)}
.contact-sheet-tile{margin:var(--mechanic-zero);padding:var(--space-2);background:var(--color-surface);
  border:var(--stroke-standard) solid var(--color-rule);border-radius:var(--radius-medium)}
.contact-sheet-tile img{display:block;width:var(--mechanic-full);aspect-ratio:var(--contact-aspect);object-fit:cover;background:var(--color-canvas)}
.contact-sheet-tile figcaption{margin-top:var(--space-1);font-size:var(--caption-size);line-height:var(--caption-leading);color:var(--color-text-secondary)}
.contact-sheet-tile[data-state="selected"]{border-color:var(--color-accent);box-shadow:var(--shadow-soft)}
`;
