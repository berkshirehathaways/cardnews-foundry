import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(root, "fixtures", "synthetic");
const stableChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const inspectGeometry = (page) => page.evaluate(() => {
  const epsilon = 0.1;
  const rectangle = (element) => {
    const value = element.getBoundingClientRect();
    return {
      left: value.left,
      top: value.top,
      right: value.right,
      bottom: value.bottom
    };
  };
  const textRectangles = (element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return [...range.getClientRects()]
      .filter((value) => value.width > 0 && value.height > 0)
      .map((value) => ({
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom
      }));
  };
  const contains = (outer, inner) =>
    inner.left >= outer.left - epsilon &&
    inner.top >= outer.top - epsilon &&
    inner.right <= outer.right + epsilon &&
    inner.bottom <= outer.bottom + epsilon;
  const intersects = (left, right) =>
    left.right > right.left + epsilon &&
    right.right > left.left + epsilon &&
    left.bottom > right.top + epsilon &&
    right.bottom > left.top + epsilon;
  const issue = (kind, selector, detail = {}) => ({ kind, selector, ...detail });
  const issues = [];
  const safeElement = document.querySelector(".safe-area");
  if (safeElement === null) return [issue("safe-area-missing", ".safe-area")];
  const safe = rectangle(safeElement);
  const pageBounds = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };

  for (const element of document.querySelectorAll("[data-box]")) {
    const selector = String(element.className);
    const own = rectangle(element);
    const text = textRectangles(element);
    if (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1) {
      issues.push(issue("data-box-scroll-clipping", selector));
    }
    for (const painted of text) {
      if (!contains(own, painted)) issues.push(issue("text-outside-own-box", selector, { own, painted }));
    }
    let container = element.parentElement;
    while (
      container !== null &&
      !container.matches(".safe-area,.card-content,.hero-region,.split-region,.split-support,.diagram")
    ) {
      container = container.parentElement;
    }
    if (container !== null && !contains(rectangle(container), own)) {
      issues.push(issue("data-box-outside-container", selector, { container: String(container.className) }));
    }
    if (!contains(pageBounds, own)) issues.push(issue("data-box-outside-page", selector));
  }

  const flow = [...document.querySelectorAll([
    ".sequence-marker",
    ".eyebrow",
    ".headline-block h1",
    ".hero-region",
    ".split-region",
    ".card-content > .quote-block",
    ".safe-area > .quote-block",
    ".card-content > .callout-block",
    ".safe-area > .callout-block",
    ".diagram",
    ".accent-rule",
    ".closing-statement",
    ".card-content > .body-block",
    ".safe-area > .body-block",
    ".provenance-footer"
  ].join(","))];
  for (let index = 1; index < flow.length; index += 1) {
    const before = flow[index - 1];
    const after = flow[index];
    const beforePaint = textRectangles(before);
    const afterPaint = textRectangles(after);
    const beforeBounds = beforePaint.length === 0 ? [rectangle(before)] : beforePaint;
    const afterBounds = afterPaint.length === 0 ? [rectangle(after)] : afterPaint;
    if (beforeBounds.some((left) => afterBounds.some((right) => intersects(left, right)))) {
      issues.push(issue("flow-paint-overlap", `${before.className} -> ${after.className}`));
    }
    const beforeBottom = Math.max(...beforeBounds.map((value) => value.bottom));
    const afterTop = Math.min(...afterBounds.map((value) => value.top));
    if (beforeBottom > afterTop + epsilon) {
      issues.push(issue("flow-order-violation", `${before.className} -> ${after.className}`));
    }
  }

  const diagram = document.querySelector(".diagram");
  if (diagram !== null) {
    const diagramBounds = rectangle(diagram);
    const items = [...diagram.children].map((element) => ({
      selector: element.tagName,
      bounds: rectangle(element)
    }));
    for (const item of items) {
      if (!contains(diagramBounds, item.bounds)) {
        issues.push(issue("diagram-item-outside", item.selector));
      }
    }
    for (let left = 0; left < items.length; left += 1) {
      for (let right = left + 1; right < items.length; right += 1) {
        if (intersects(items[left].bounds, items[right].bounds)) {
          issues.push(issue("diagram-item-overlap", `${left}:${right}`));
        }
      }
    }
  }

  const footer = document.querySelector(".provenance-footer");
  if (footer !== null) {
    const footerBounds = rectangle(footer);
    const footerText = textRectangles(footer);
    if (!contains(safe, footerBounds) || !contains(pageBounds, footerBounds)) {
      issues.push(issue("footer-box-clipping", ".provenance-footer"));
    }
    for (const painted of footerText) {
      if (!contains(safe, painted) || !contains(pageBounds, painted)) {
        issues.push(issue("footer-text-clipping", ".provenance-footer", { painted, safe }));
      }
    }
  }
  return issues;
});

const renderCardsInBrowser = async ({ executablePath, cardIds }) => {
  const { loadRenderInput } = await import("../../src/render/input.mjs");
  const { buildCardHtml } = await import("../../src/render/card.mjs");
  const input = await loadRenderInput({ repositoryRoot: root, fixtureRoot });
  const recipeByCard = new Map(input.recipe.cards.map((card) => [card.cardId, card]));
  const browser = await chromium.launch({ headless: true, executablePath });
  const reports = [];
  try {
    for (const card of input.storyboard.cards.filter((entry) => cardIds.includes(entry.id))) {
      const page = await browser.newPage({ viewport: input.target.dimensions });
      await page.setContent(buildCardHtml({
        card,
        recipeCard: recipeByCard.get(card.id),
        input
      }), { waitUntil: "load" });
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map((image) => image.decode()));
      });
      reports.push({ cardId: card.id, issues: await inspectGeometry(page) });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return reports;
};

test("Given all production cards, When pinned Chromium measures flow and text paint geometry, Then every region fits without collision", async () => {
  // Given
  const cardIds = Array.from({ length: 7 }, (_, index) => `card-${index + 1}`);

  // When
  const reports = await renderCardsInBrowser({
    executablePath: chromium.executablePath(),
    cardIds
  });

  // Then
  assert.deepEqual(reports.filter((report) => report.issues.length > 0), []);
});

test("Given affected production cards, When Chrome Stable measures geometry, Then it agrees that paint and footer bounds are safe", async () => {
  // Given / When
  const reports = await renderCardsInBrowser({
    executablePath: stableChrome,
    cardIds: ["card-2", "card-4", "card-6"]
  });

  // Then
  assert.deepEqual(reports.filter((report) => report.issues.length > 0), []);
});

test("Given injected flex collision, oversized diagram nodes, and displaced footer, When renderer geometry runs, Then typed failures reject screenshots", async () => {
  // Given
  const { loadRenderInput } = await import("../../src/render/input.mjs");
  const { buildCardHtml } = await import("../../src/render/card.mjs");
  const { createRendererBrowser } = await import("../../src/render/browser.mjs");
  const input = await loadRenderInput({ repositoryRoot: root, fixtureRoot });
  const recipeByCard = new Map(input.recipe.cards.map((card) => [card.cardId, card]));
  const renderer = await createRendererBrowser(input);
  const cases = [
    {
      card: input.storyboard.cards[1],
      css: ".safe-area{display:flex;flex-direction:column}.card-content{flex:0 1 4px}.headline-block{transform:translateY(-80px)}",
      code: "DOM_PAINT_OVERLAP"
    },
    {
      card: input.storyboard.cards[3],
      css: ".diagram span{flex-basis:360px;width:360px}",
      code: "DIAGRAM_GEOMETRY"
    },
    {
      card: input.storyboard.cards[5],
      css: ".provenance-footer{transform:translateY(40px)}",
      code: "FOOTER_CLIPPING"
    }
  ];

  try {
    // When / Then
    for (const scenario of cases) {
      const html = buildCardHtml({
        card: scenario.card,
        recipeCard: recipeByCard.get(scenario.card.id),
        input,
        injectedCss: scenario.css
      });
      await assert.rejects(
        () => renderer.renderHtml(html),
        (error) => error.code === scenario.code
      );
    }
  } finally {
    await renderer.close();
  }
});
