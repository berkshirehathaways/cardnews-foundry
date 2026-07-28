import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { EvaluationError } from "../../src/evaluate/index.mjs";
import { readConfinedRepositoryFile } from "../../src/evaluate/input.mjs";

test("Given traversal and symlink manifest paths, When repository input is read, Then arbitrary files outside the repository are rejected", async (context) => {
  // Given
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "cardnews-evaluate-input-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "cardnews-evaluate-secret-"));
  context.after(() => Promise.all([
    rm(repositoryRoot, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true })
  ]));
  await writeFile(path.join(outside, "secret.txt"), "secret");
  await mkdir(path.join(repositoryRoot, "fixtures"));
  await symlink(outside, path.join(repositoryRoot, "fixtures", "escape"));

  // When / Then
  for (const relativePath of ["../secret.txt", "fixtures/escape/secret.txt", "/etc/passwd"]) {
    await assert.rejects(
      () => readConfinedRepositoryFile(repositoryRoot, relativePath),
      (error) => error instanceof EvaluationError && error.code === "EVALUATION_INPUT_PATH_ESCAPE"
    );
  }
});
