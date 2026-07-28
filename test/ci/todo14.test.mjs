import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packagePath = path.join(repositoryRoot, "package.json");
const workflowPath = path.join(repositoryRoot, ".github", "workflows", "ci.yml");

const actionPins = new Map([
  ["actions/checkout", "11d5960a326750d5838078e36cf38b85af677262"],
  ["actions/setup-node", "49933ea5288caeca8642d1e84afbd3f7d6820020"],
]);

test("Given the package manifest, When public metadata is audited, Then repository discovery is precise without enabling publication", async () => {
  // Given
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));

  // When / Then
  assert.equal(packageJson.license, "Apache-2.0");
  assert.deepEqual(packageJson.repository, {
    type: "git",
    url: "https://github.com/berkshirehathaways/cardnews-foundry",
  });
  assert.equal(packageJson.homepage, "https://github.com/berkshirehathaways/cardnews-foundry#readme");
  assert.deepEqual(packageJson.bugs, {
    url: "https://github.com/berkshirehathaways/cardnews-foundry/issues",
  });
  assert.deepEqual(packageJson.keywords, ["codex", "korean", "cardnews", "playwright"]);
  assert.equal(packageJson.private, true);
  assert.deepEqual(
    Object.keys(packageJson.scripts).filter((scriptName) => /(?:publish|deploy)/iu.test(scriptName)),
    [],
  );
});

test("Given the CI workflow, When its trust boundary is audited, Then YAML, action pins, permissions, and secret isolation are exact", async () => {
  // Given
  const workflow = await readFile(workflowPath, "utf8");

  // When
  const parsed = spawnSync(
    "ruby",
    ["-e", "require 'yaml'; YAML.safe_load(File.read(ARGV.fetch(0)), aliases: true)", workflowPath],
    { encoding: "utf8" },
  );
  const uses = [...workflow.matchAll(/^\s*uses:\s*([^@\s]+)@([a-f0-9]+)\s*$/gmu)];

  // Then
  assert.equal(parsed.status, 0, parsed.stderr);
  assert.match(workflow, /^permissions:\n  contents: read$/mu);
  assert.doesNotMatch(workflow, /^\s*[a-z-]+:\s*write\s*$/mu);
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./u);
  assert.doesNotMatch(workflow, /actions\/upload-artifact/u);
  assert.equal(uses.length, actionPins.size);
  for (const match of uses) {
    const action = match[1];
    const sha = match[2];
    assert.equal(actionPins.get(action), sha, `${action} must use its audited full SHA`);
    assert.match(sha, /^[a-f0-9]{40}$/u);
  }
});

test("Given the CI workflow, When its execution contract is audited, Then Node 24 and the bounded clean-clone gate run on pushes and pull requests", async () => {
  // Given / When
  const workflow = await readFile(workflowPath, "utf8");

  // Then
  assert.match(workflow, /^  push:$/mu);
  assert.match(workflow, /^  pull_request:$/mu);
  assert.match(workflow, /^concurrency:$/mu);
  assert.match(workflow, /^\s+timeout-minutes:\s*[1-9][0-9]*$/mu);
  assert.match(workflow, /^\s+node-version-file:\s*\.node-version$/mu);
  assert.match(workflow, /^\s+run:\s*corepack enable$/mu);
  assert.match(workflow, /^\s+run:\s*corepack pnpm verify:clean-clone$/mu);
});
