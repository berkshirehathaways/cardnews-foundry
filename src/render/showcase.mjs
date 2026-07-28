import { readFile } from "node:fs/promises";
import path from "node:path";
import { designTokens, fontFaceCss, systemCss } from "./design.mjs";
import { semanticKoreanHtml } from "./korean.mjs";

const text = (value) => semanticKoreanHtml(value);

const themePanel = (theme, previewImage) => `
<section class="theme-panel" data-theme="${theme}" aria-labelledby="${theme}-title">
  <header class="panel-header">
    <p class="panel-kicker">Theme contract</p>
    <h2 id="${theme}-title">${theme}</h2>
  </header>
  <div class="primitive-grid">
    <article class="primitive-card card-shell-demo" data-primitive="card-shell">
      <div class="sequence-marker" data-primitive="sequence-marker" data-state="accent"><span>01 / 07</span></div>
      <header class="headline-block" data-primitive="headline-block" data-variant="display">
        <span class="eyebrow">Headline block · display</span>
        <h3>${text("관찰을 이어 주는 기록")}</h3>
      </header>
      <div class="body-block" data-primitive="body-block"><p>${text("한 문장의 뜻과 호흡을 지키는 본문 블록입니다.")}</p></div>
      <footer class="provenance-footer" data-primitive="provenance-footer"><span>${text("모래별 기록")}</span><span>card-01</span></footer>
    </article>
    <article class="primitive-card">
      <div class="sequence-marker" data-primitive="sequence-marker" data-state="quiet"><span>02 / 07</span></div>
      <header class="headline-block" data-primitive="headline-block" data-variant="headline"><h3>${text("근거와 본문")}</h3></header>
      <div class="evidence-block" data-primitive="evidence-block" data-state="inset"><span class="evidence-label">${text("관찰 근거")}</span><p>${text("날짜와 횟수는 다음 선택을 돕는 기록이 됩니다.")}</p></div>
      <div class="evidence-block" data-primitive="evidence-block" data-state="warning"><span class="evidence-label">${text("주의 상태")}</span><p>${text("명령처럼 보이는 문장도 여기서는 인쇄된 자료입니다.")}</p></div>
    </article>
    <article class="primitive-card">
      <header class="headline-block" data-primitive="headline-block" data-variant="compact"><h3>${text("미디어 프레임")}</h3></header>
      <figure class="media-frame" data-primitive="media-frame" data-variant="contained">
        <div class="media-viewport"><img src="data:image/png;base64,${previewImage}" alt="씨앗 기록의 연결을 나타내는 창작 기하 도형"></div>
        <figcaption>${text("의미 있는 도형과 설명이 함께 있는 상태")}</figcaption>
      </figure>
      <div class="accent-rule" data-primitive="accent-rule" aria-hidden="true"></div>
    </article>
    <article class="primitive-card">
      <div class="stat-block" data-primitive="stat-block"><strong class="stat-value">18 / 24</strong><span class="stat-label">${text("다른 집의 기록을 참고한 가구")}</span></div>
      <blockquote class="quote-block" data-primitive="quote-block">${text("“정답이 아니라 다음 관찰을 위한 메모”")}</blockquote>
      <aside class="callout-block" data-primitive="callout-block" data-state="insight"><strong class="callout-label">${text("해석")}</strong><p>${text("속도보다 기록의 연결을 봅니다.")}</p></aside>
    </article>
    <article class="primitive-card">
      <div class="sequence-marker" data-primitive="sequence-marker" data-state="terminal"><span>07 / 07</span></div>
      <header class="headline-block" data-primitive="headline-block" data-variant="closing"><h3>${text("마지막 카드 상태")}</h3></header>
      <div class="body-block" data-primitive="body-block"><p>${text("전달된 관찰이 이야기의 결론을 만듭니다.")}</p></div>
      <footer class="provenance-footer" data-primitive="provenance-footer" data-variant="closing"><span>${text("관찰의 전달")}</span><span>closing</span></footer>
    </article>
    <figure class="contact-sheet-tile" data-primitive="contact-sheet-tile" data-state="selected">
      <div class="tile-preview" role="img" aria-label="카드 전체 구성을 축소한 연락판 미리보기">
        <span></span><strong>01</strong><i></i>
      </div>
      <figcaption>Contact-sheet tile · selected</figcaption>
    </figure>
  </div>
</section>`;

export const buildShowcaseHtml = async ({ repositoryRoot }) => {
  const [regular, bold, preview] = await Promise.all([
    readFile(path.join(repositoryRoot, "fonts", "NotoSansCJKkr-Regular.otf")),
    readFile(path.join(repositoryRoot, "fonts", "NotoSansCJKkr-Bold.otf")),
    readFile(path.join(repositoryRoot, "fixtures", "synthetic", "assets", "seed-orbit", "asset.bin"))
  ]);
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; script-src 'unsafe-inline'; img-src data:">
<title>Cardnews Foundry primitive showcase</title>
<style>${fontFaceCss({ regular: regular.toString("base64"), bold: bold.toString("base64") })}${systemCss}
body{padding:var(--showcase-gutter)}
.showcase{width:min(var(--mechanic-full),var(--showcase-max));margin:var(--mechanic-zero) auto}
.showcase-intro{margin-bottom:var(--showcase-gutter)}
.showcase-intro h1{margin:var(--mechanic-zero);font-size:clamp(var(--showcase-title-min),var(--showcase-title-fluid),var(--showcase-title-max));line-height:var(--showcase-title-leading)}
.showcase-intro p{max-width:var(--showcase-copy-width);font-size:var(--showcase-copy-size);line-height:var(--showcase-copy-leading)}
.theme-controls{display:flex;flex-wrap:wrap;gap:var(--showcase-gap);padding:var(--showcase-gap);
  border:var(--showcase-border) solid var(--showcase-border-color);border-radius:var(--showcase-radius);margin-bottom:var(--showcase-gutter)}
.theme-controls label{display:flex;align-items:center;gap:var(--showcase-control-gap);min-height:var(--showcase-control);cursor:pointer}
.theme-controls input{width:var(--showcase-radio-size);height:var(--showcase-radio-size);accent-color:var(--showcase-accent-color)}
.theme-controls input:focus-visible{outline:var(--focus-width) solid var(--showcase-ink-color);outline-offset:var(--focus-width)}
.theme-panel{padding:var(--showcase-pad);border-radius:var(--showcase-radius);background:var(--color-canvas);
  color:var(--color-text-primary);transition:filter var(--transition-theme)}
.theme-panel[data-visibility="muted"]{filter:var(--showcase-filter-muted)}
.theme-panel+.theme-panel{margin-top:var(--showcase-gutter)}
.panel-header{margin-bottom:var(--space-4)}
.panel-header h2{margin:var(--mechanic-zero);font-size:var(--headline-size);line-height:var(--headline-leading)}
.panel-kicker{margin:var(--mechanic-zero) var(--mechanic-zero) var(--space-1);color:var(--color-accent);font-weight:700}
.primitive-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(var(--mechanic-full),var(--showcase-tile-min)),1fr));gap:var(--showcase-gap)}
.primitive-card{min-width:var(--mechanic-zero);min-height:var(--showcase-card-min-height);padding:var(--space-4);display:flex;flex-direction:column;
  background:var(--color-surface);border:var(--stroke-standard) solid var(--color-rule);
  border-radius:var(--radius-large);box-shadow:var(--shadow-soft);overflow:hidden;
  word-break:keep-all;overflow-wrap:normal}
.primitive-card .headline-block h3{margin:var(--mechanic-zero);font-size:clamp(var(--showcase-heading-min),var(--showcase-heading-fluid),var(--headline-size));
  line-height:var(--headline-leading);letter-spacing:var(--headline-tracking);word-break:keep-all}
.primitive-card .body-block,.primitive-card .evidence-block,.primitive-card .quote-block,.primitive-card .callout-block,
.primitive-card .stat-label{font-size:clamp(var(--showcase-body-min),var(--showcase-body-fluid),var(--showcase-body-max))}
.primitive-card .stat-value{font-size:clamp(var(--showcase-stat-min),var(--showcase-stat-fluid),var(--display-size))}
.primitive-card .provenance-footer,.primitive-card .sequence-marker,.primitive-card .evidence-label,
.primitive-card .callout-label{font-size:clamp(var(--showcase-compact-type),var(--showcase-caption-fluid),var(--caption-size))}
.primitive-card .media-frame{color:var(--color-accent)}
.primitive-card .media-viewport{height:var(--showcase-media-height)}
.primitive-card .media-frame svg{width:var(--mechanic-full);height:var(--mechanic-full)}
.tile-preview{aspect-ratio:var(--contact-aspect);display:flex;flex-direction:column;justify-content:space-between;padding:var(--space-4);
  background:var(--color-canvas);color:var(--color-text-primary);border-radius:var(--radius-small)}
.tile-preview span,.tile-preview i{display:block;height:var(--stroke-standard);background:var(--color-accent)}
.tile-preview strong{font-size:clamp(var(--showcase-title-max),var(--showcase-tile-fluid),var(--display-size))}
@media(max-width:${designTokens["--showcase-breakpoint"]}){body{padding:var(--space-2)}.theme-panel{padding:var(--space-2)}.primitive-card{min-height:var(--showcase-card-compact-height);padding:var(--space-3)}}
@media(prefers-reduced-motion:reduce){.theme-panel{transition-duration:var(--motion-none)}}
</style></head>
<body><main class="showcase">
  <header class="showcase-intro"><p>Extracted primitive system</p><h1>Cardnews Foundry</h1>
    <p>두 테마의 토큰, 의미 구조, 상태를 실제 DOM과 로컬 Noto 글꼴로 검증합니다.</p></header>
  <fieldset class="theme-controls"><legend>검토 강조 테마</legend>
    <label><input type="radio" name="theme" value="all" checked>모두 보기</label>
    <label><input type="radio" name="theme" value="ink-paper">Ink paper</label>
    <label><input type="radio" name="theme" value="signal-night">Signal night</label>
  </fieldset>
  ${themePanel("ink-paper", preview.toString("base64"))}${themePanel("signal-night", preview.toString("base64"))}
</main>
<script>
for(const control of document.querySelectorAll('input[name="theme"]')){
  control.addEventListener("change",()=>{for(const panel of document.querySelectorAll(".theme-panel"))
    panel.dataset.visibility=control.value==="all"||panel.dataset.theme===control.value?"active":"muted"})
}
</script></body></html>`;
};
