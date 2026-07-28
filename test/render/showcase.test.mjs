import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("Given the extracted design contract, When the primitive showcase is built, Then both themes and every named primitive/state are present without remote references", async () => {
  // Given
  const { buildShowcaseHtml } = await import("../../src/render/showcase.mjs");
  const design = await readFile(path.join(root, "DESIGN.md"), "utf8");

  // When
  const html = await buildShowcaseHtml({ repositoryRoot: root });

  // Then
  for (const name of [
    "card-shell", "sequence-marker", "headline-block", "body-block",
    "evidence-block", "media-frame", "accent-rule", "stat-block",
    "quote-block", "callout-block", "provenance-footer", "contact-sheet-tile"
  ]) {
    assert.match(design, new RegExp(name));
    assert.match(html, new RegExp(name));
  }
  assert.match(html, /data-theme="ink-paper"/u);
  assert.match(html, /data-theme="signal-night"/u);
  assert.doesNotMatch(html, /https?:|url\s*\(\s*["']?(?!data:)/iu);
  assert.doesNotMatch(html, /[\p{Extended_Pictographic}]/u);
});

test("Given native showcase controls, When their markup is inspected, Then keyboard, focus, reduced-motion and semantic media contracts are explicit", async () => {
  // Given
  const { buildShowcaseHtml } = await import("../../src/render/showcase.mjs");

  // When
  const html = await buildShowcaseHtml({ repositoryRoot: root });

  // Then
  assert.match(html, /<fieldset/u);
  assert.match(html, /type="radio"/u);
  assert.match(html, /:focus-visible/u);
  assert.match(html, /prefers-reduced-motion:\s*reduce/u);
  assert.match(html, /<figure/u);
  assert.match(html, /alt="/u);
});
