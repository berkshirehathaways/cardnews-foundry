import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("Given the public jobs verifier, When its real filesystem scenario runs, Then every binary case and cleanup outcome passes", async () => {
  // Given
  const command = path.join(root, "scripts", "verify-jobs.mjs");

  // When
  const { stdout } = await execFileAsync(process.execPath, [command], { cwd: root, encoding: "utf8" });
  const result = JSON.parse(stdout);

  // Then
  assert.equal(result.ok, true);
  assert.equal(Object.values(result.cases).every(Boolean), true);
  assert.deepEqual(result.cleanup, {
    rootsRemoved: true,
    locks: 0,
    temporaryFiles: 0,
    specialNodes: 0,
    childProcesses: 0
  });
  assert.deepEqual(result.interruptedCodes, [
    "ATOMIC_WRITE_INTERRUPTED",
    "ATOMIC_WRITE_INTERRUPTED",
    "ATOMIC_WRITE_INTERRUPTED"
  ]);
});
