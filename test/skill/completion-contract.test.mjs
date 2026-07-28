import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const skillPath = path.resolve(import.meta.dirname, "../../skill/cardnews-foundry/SKILL.md");

test("Given a finished-cardnews request, When visual verdicts are authored, Then the skill keeps inputs outside package-owned report paths", async () => {
  const skill = await readFile(skillPath, "utf8");

  assert.match(skill, /drafts\/visual-pass-a\.input\.json/u);
  assert.match(skill, /drafts\/visual-pass-b\.input\.json/u);
  assert.match(skill, /Do not pre-create `reports\/visual-pass-a\.json`/u);
  assert.match(skill, /`VISUAL_VERDICT_MISSING` is a next\s+action/u);
});
