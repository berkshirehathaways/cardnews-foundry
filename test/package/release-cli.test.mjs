import assert from "node:assert/strict";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const script = path.join(repositoryRoot, "scripts", "verify-release.mjs");

const run = (args) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: repositoryRoot,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  child.once("error", reject);
  child.once("close", (code) => resolve({
    code,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8")
  }));
});

test("Given the current clean source tree, When release dry-run executes, Then its Git-selected inventory and replayed source archive pass", async () => {
  // Given
  const head = spawnSync("git", ["rev-parse", "--verify", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8"
  });

  // When
  const result = await run(["--dry-run"]);

  // Then
  assert.equal(result.code, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.inventory.mode, head.status === 0 ? "tracked-files" : "source-inventory");
  assert.equal(output.source.ok, true);
  assert.equal(output.sourceArchive.ok, true);
  assert.match(output.sourceArchive.sha256, /^[a-f0-9]{64}$/u);
  assert.equal(output.sourceArchive.executablePaths.includes("bin/cardnews"), true);
});

test("Given the seeded violation matrix, When release verification executes, Then every case is independently rejected with class 6", async () => {
  // Given / When
  const result = await run(["--seed-violations"]);

  // Then
  assert.equal(result.code, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.seeded.length >= 10, true);
  assert.equal(output.seeded.every((entry) => entry.rejected && entry.exitClass === 6), true);
  assert.equal(output.seeded.some((entry) => entry.name === "zip-bomb"), true);
  assert.equal(output.seeded.some((entry) => entry.name === "special-node"), true);
  assert.equal(output.seeded.some((entry) => entry.name === "font-license"), true);
  assert.equal(output.seeded.some((entry) => entry.name === "image-rights"), true);
});
