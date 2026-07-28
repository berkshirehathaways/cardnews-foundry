#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const forwarded = process.argv.slice(2);
const args = forwarded[0] === "--" ? forwarded.slice(1) : forwarded;
if (args.length !== 0 && (args.length !== 2 || args[0] !== "--target" || args[1] === "")) {
  process.stderr.write("usage: test-skill.mjs [--target <skill-path>]\n");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--test", "--test-concurrency=1", "test/skill/lifecycle.test.mjs"],
  { env: { ...process.env, CARDNEWS_SKILL_TARGET: args[1] ?? "" }, stdio: "inherit" },
);
process.exit(result.status ?? 1);
