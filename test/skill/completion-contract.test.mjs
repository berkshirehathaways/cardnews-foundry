import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const skillPath = path.resolve(import.meta.dirname, "../../skill/cardnews-foundry/SKILL.md");
const visualReferencePath = path.resolve(
  import.meta.dirname,
  "../../skill/cardnews-foundry/references/visual.md"
);

test("Given a finished-cardnews request, When visual verdicts are authored, Then the skill keeps inputs outside package-owned report paths", async () => {
  const skill = await readFile(skillPath, "utf8");

  assert.match(skill, /drafts\/visual-pass-a\.input\.json/u);
  assert.match(skill, /drafts\/visual-pass-b\.input\.json/u);
  assert.match(skill, /Do not pre-create `reports\/visual-pass-a\.json`/u);
  assert.match(skill, /`VISUAL_VERDICT_MISSING` is a next\s+action/u);
});

test("Given a scaled contact sheet, When a visual reviewer suspects overlap, Then the method requires original-resolution evidence before blocking", async () => {
  const visualReference = await readFile(visualReferencePath, "utf8");

  assert.match(visualReference, /contact sheet for inventory and sequence, not for pixel-level defect\s+claims/u);
  assert.match(visualReference, /reopen each affected\s+card at original resolution/u);
  assert.match(visualReference, /visible pixel occlusion or measured intersecting bounds/u);
  assert.match(visualReference, /left\/right-aligned footer items are not overlapping/u);
});
