#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { parseTestSkillArgs } from "./test-skill-options.mjs";

let options;
try {
  options = parseTestSkillArgs(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [
    "--test",
    "--test-concurrency=1",
    "test/skill/completion-contract.test.mjs",
    "test/skill/lifecycle.test.mjs",
    "test/skill/test-skill-options.test.mjs",
  ],
  { env: { ...process.env, CARDNEWS_SKILL_TARGET: options.target }, stdio: "inherit" },
);
if (result.status !== 0 || !options.freshContext) process.exit(result.status ?? 1);

const freshContext = spawnSync(
  process.execPath,
  ["scripts/qa-forward.mjs", "--fixture", "fixtures/synthetic"],
  {
    env: { ...process.env, CARDNEWS_FORWARD_CONTEXTS: "fresh-create" },
    stdio: "inherit",
  },
);
process.exit(freshContext.status ?? 1);
