import assert from "node:assert/strict";
import test from "node:test";
import { parseTestSkillArgs } from "../../scripts/test-skill-options.mjs";

test("Given a target and fresh context flag, When skill test options are parsed, Then the ambiguous validation target is rejected", () => {
  // Given
  const args = ["--target", "/tmp/cardnews-skill", "--fresh-context"];

  // When / Then
  assert.throws(() => parseTestSkillArgs(args), /usage: test-skill\.mjs/u);
});

test("Given the pnpm argument separator and fresh context flag, When skill test options are parsed, Then fresh context runs without a target", () => {
  // Given
  const args = ["--", "--fresh-context"];

  // When
  const options = parseTestSkillArgs(args);

  // Then
  assert.deepEqual(options, { target: "", freshContext: true });
});

test("Given an unknown skill test option, When options are parsed, Then the parser rejects it", () => {
  // Given
  const args = ["--unexpected"];

  // When / Then
  assert.throws(() => parseTestSkillArgs(args), /usage: test-skill\.mjs/u);
});

test("Given a target flag followed by another flag, When skill test options are parsed, Then the missing target value is rejected", () => {
  // Given
  const args = ["--target", "--fresh-context"];

  // When / Then
  assert.throws(() => parseTestSkillArgs(args), /usage: test-skill\.mjs/u);
});
