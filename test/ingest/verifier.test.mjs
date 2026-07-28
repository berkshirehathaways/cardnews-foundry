import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("Given the public ingest verifier, When its real HTTP and filesystem scenarios run, Then every case passes and all resources are removed", async () => {
  // Given
  const verifier = path.join(root, "scripts", "verify-ingest.mjs");

  // When
  const { stdout, stderr } = await execFileAsync(process.execPath, [verifier], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000
  });
  const result = JSON.parse(stdout);

  // Then
  assert.equal(stderr, "");
  assert.equal(result.ok, true);
  assert.equal(Object.values(result.cases).every(Boolean), true);
  assert.deepEqual(result.cleanup, {
    rootsRemoved: true,
    serversClosed: true,
    sockets: 0,
    timers: 0,
    temporaryFiles: 0,
    acceptedFailures: 0,
    resourcesClean: true
  });
  assert.equal(result.adversarial.cancel_resume.status, "not_applicable");
  assert.equal(result.adversarial.cancel_resume.reason.length > 0, true);
});
