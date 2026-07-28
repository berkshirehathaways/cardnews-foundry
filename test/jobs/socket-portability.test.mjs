import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("Given a deliberately long valid TMPDIR, When the special-node regression runs, Then it reaches and passes Unix socket rejection", async (context) => {
  // Given
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "cardnews-jobs-long-tmp-"));
  const longTempRoot = path.join(fixtureRoot, "portable-temp-root-123456789012345678901234567890");
  await mkdir(longTempRoot);
  context.after(async () => rm(fixtureRoot, { recursive: true, force: true }));

  // When
  const result = await execFileAsync(process.execPath, [
    "--test",
    "--test-name-pattern",
    "Given real FIFO and Unix socket nodes",
    path.join(repositoryRoot, "test", "jobs", "security.test.mjs")
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== "NODE_TEST_CONTEXT")),
      TMPDIR: longTempRoot
    }
  });

  // Then
  assert.match(result.stdout, /pass 1/);
  assert.match(result.stdout, /fail 0/);
});
