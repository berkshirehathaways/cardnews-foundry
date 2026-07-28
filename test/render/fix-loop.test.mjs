import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(root, "fixtures", "synthetic");
const source = (relativePath) => readFile(path.join(root, relativePath), "utf8");

const lineCount = async (page, selector, phrase) => page.locator(selector).evaluate((element, expected) => {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let text = "";
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const start = text.length;
    const value = node.textContent ?? "";
    text += value;
    nodes.push({ node, start, end: text.length });
  }
  const normalized = text.replaceAll("\u00a0", " ");
  const start = normalized.indexOf(expected);
  if (start < 0) return 0;
  const end = start + expected.length;
  const first = nodes.find((entry) => entry.start <= start && entry.end > start);
  const last = nodes.find((entry) => entry.start < end && entry.end >= end);
  if (first === undefined || last === undefined) return 0;
  const range = document.createRange();
  range.setStart(first.node, start - first.start);
  range.setEnd(last.node, end - last.start);
  return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top * 10) / 10)).size;
}, phrase);

test("Given renderer source, When composition branching is scanned, Then card identity and fixture copy never select presentation", async () => {
  // Given
  const card = await source("src/render/card.mjs");

  // When / Then
  assert.doesNotMatch(card, /(?:if|switch)\s*\([^)]*card\.id|card\.id\s*={2,3}|card-\d/gu);
  assert.doesNotMatch(card, /[\uac00-\ud7a3]/gu);
});

test("Given renderer CSS outside the token source, When visual literals are scanned, Then every value is token-bound", async () => {
  // Given
  const renderFiles = [
    "src/render/card.mjs",
    "src/render/contact-sheet.mjs",
    "src/render/showcase.mjs"
  ];
  const css = (await Promise.all(renderFiles.map(source))).join("\n");

  // When / Then
  assert.doesNotMatch(css, /aspect-ratio\s*:\s*(?!var\()[^;}]+/gu);
  assert.doesNotMatch(css, /@media\s*\([^)]*\d+(?:px|em|rem)/gu);
  assert.doesNotMatch(css, /opacity\s*\(\s*(?:0?\.)?\d+/gu);
  assert.doesNotMatch(css, /--[\w-]+\s*:\s*(?:#[\da-f]{3,8}|-?(?:\d*\.)?\d+(?:px|em|vw|vh|%|s|ms)?)(?=[;}])/giu);
  assert.doesNotMatch(css, /(?:width|height|padding|margin|gap|font-size|line-height|opacity)\s*:\s*-?(?:\d*\.)?\d+(?:px|em|vw|vh|%|s|ms)?(?=[;}])/giu);
});

test("Given every showcase theme and required viewport, When primitive rectangles are measured, Then no content clips or overlaps", async () => {
  // Given
  const { buildShowcaseHtml } = await import("../../src/render/showcase.mjs");
  const html = await buildShowcaseHtml({ repositoryRoot: root });
  const browser = await chromium.launch({ headless: true });

  try {
    for (const capture of [
      { width: 375, zoom: 1 },
      { width: 768, zoom: 1 },
      { width: 1280, zoom: 1 },
      { width: 1280, zoom: 2 }
    ]) {
      const page = await browser.newPage({ viewport: { width: capture.width, height: 900 } });
      await page.setContent(html, { waitUntil: "load" });
      if (capture.zoom !== 1) await page.evaluate((zoom) => { document.documentElement.style.zoom = String(zoom); }, capture.zoom);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map((image) => image.decode()));
      });

      // When
      const failures = await page.evaluate(() => [...document.querySelectorAll(".theme-panel")].flatMap((panel) =>
        [...panel.querySelectorAll(".primitive-card,.contact-sheet-tile")].flatMap((container, cardIndex) => {
          const own = container.getBoundingClientRect();
          const issues = [];
          if (container.scrollWidth > container.clientWidth + 1 || container.scrollHeight > container.clientHeight + 1) {
            issues.push({ theme: panel.dataset.theme, cardIndex, kind: "scroll-clipping" });
          }
          const children = [...container.children];
          for (let index = 1; index < children.length; index += 1) {
            const before = children[index - 1].getBoundingClientRect();
            const after = children[index].getBoundingClientRect();
            if (before.bottom > after.top + 1) issues.push({ theme: panel.dataset.theme, cardIndex, kind: "sibling-overlap" });
          }
          for (const child of container.querySelectorAll("img,figcaption,.accent-rule")) {
            const rect = child.getBoundingClientRect();
            if (rect.left < own.left - 1 || rect.right > own.right + 1 || rect.top < own.top - 1 || rect.bottom > own.bottom + 1) {
              issues.push({ theme: panel.dataset.theme, cardIndex, kind: "descendant-overflow" });
            }
          }
          for (const figure of container.querySelectorAll(".media-frame")) {
            const figureRect = figure.getBoundingClientRect();
            if (figure.scrollWidth > figure.clientWidth + 1 || figure.scrollHeight > figure.clientHeight + 1) {
              issues.push({ theme: panel.dataset.theme, cardIndex, kind: "media-scroll-clipping" });
            }
            for (const child of figure.children) {
              const rect = child.getBoundingClientRect();
              if (
                rect.left < figureRect.left - 1 || rect.right > figureRect.right + 1 ||
                rect.top < figureRect.top - 1 || rect.bottom > figureRect.bottom + 1
              ) issues.push({ theme: panel.dataset.theme, cardIndex, kind: "media-child-overflow" });
            }
            const mediaChildren = [...figure.children];
            for (let index = 1; index < mediaChildren.length; index += 1) {
              if (
                mediaChildren[index - 1].getBoundingClientRect().bottom >
                mediaChildren[index].getBoundingClientRect().top + 1
              ) issues.push({ theme: panel.dataset.theme, cardIndex, kind: "media-child-overlap" });
            }
          }
          return issues;
        })
      ));

      // Then
      assert.deepEqual(failures, [], `${capture.width}px at ${capture.zoom * 100}%`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test("Given target cards and showcase states, When Korean phrase ranges are measured, Then semantic groups stay on one line", async () => {
  // Given
  const { loadRenderInput } = await import("../../src/render/input.mjs");
  const { buildCardHtml } = await import("../../src/render/card.mjs");
  const { buildShowcaseHtml } = await import("../../src/render/showcase.mjs");
  const input = await loadRenderInput({ repositoryRoot: root, fixtureRoot });
  const recipeByCard = new Map(input.recipe.cards.map((card) => [card.cardId, card]));
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: input.target.dimensions });
    for (const [cardId, phrase] of [
      ["card-2", "세 개씩"],
      ["card-4", "기록은 답안지가 아니라"],
      ["card-5", "실행할 명령"],
      ["card-6", "스물네 집 중 열여덟 집이"],
      ["card-7", "목적은 경쟁이 아니라"]
    ]) {
      const card = input.storyboard.cards.find((entry) => entry.id === cardId);
      await page.setContent(buildCardHtml({ card, recipeCard: recipeByCard.get(cardId), input }), { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await lineCount(page, ".safe-area", phrase), 1, `${cardId}: ${phrase}`);
    }

    const showcase = await buildShowcaseHtml({ repositoryRoot: root });
    for (const [width, phrase] of [[375, "가구"], [1280, "기록을"]]) {
      await page.setViewportSize({ width, height: 900 });
      await page.setContent(showcase, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await lineCount(page, '[data-theme="ink-paper"]', phrase), 1, `${width}px: ${phrase}`);
    }

    const card = input.storyboard.cards[0];
    for (const phrase of ["열두 명 중 세 명이", "새로 만든 기록을", "계획은 답안지가 아니라"]) {
      const html = buildCardHtml({
        card,
        recipeCard: recipeByCard.get(card.id),
        input,
        semanticTextTransform: () => ({ body: phrase })
      });
      await page.setViewportSize(input.target.dimensions);
      await page.setContent(html, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await lineCount(page, ".body-block", phrase), 1, `stress: ${phrase}`);
    }
    await page.close();
  } finally {
    await browser.close();
  }
});

test("Given evidence tooling, When freshness and capture strategy are inspected, Then prep is last and zoom uses bounded validated segments", async () => {
  // Given
  const [finalizer, showcaseQa, showcaseAudit] = await Promise.all([
    source("scripts/finalize-render-evidence.mjs"),
    source("scripts/qa-render-showcase.mjs"),
    source("src/render/showcase-audit.mjs")
  ]);

  // When / Then
  assert.match(finalizer, /inventory\.sourceRevision\s*===\s*manual\.sourceRevision/gu);
  assert.match(finalizer, /inventory\.sourceRevision\s*===\s*showcase\.sourceRevision/gu);
  assert.ok(finalizer.lastIndexOf('writeJson("visual-qa-prep.json"') > finalizer.lastIndexOf('writeJson("done-claim.json"'));
  assert.doesNotMatch(showcaseQa, /fullPage\s*:\s*true/gu);
  for (const segment of ["zoom-intro-controls", "zoom-ink-panel", "zoom-signal-panel"]) {
    assert.match(showcaseQa, new RegExp(segment, "u"));
  }
  assert.match(`${showcaseQa}\n${showcaseAudit}`, /inspectPng/gu);
  assert.match(showcaseQa, /captureCount/gu);
  assert.match(showcaseQa, /compositor/gu);
});
