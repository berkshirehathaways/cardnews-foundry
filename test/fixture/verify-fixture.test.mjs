import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("Given the repository synthetic fixture, When the public verifier runs, Then a complete semantic chain is reported", () => {
  // Given
  const fixtureRoot = "fixtures/synthetic";

  // When
  const result = spawnSync(
    process.execPath,
    ["scripts/verify-fixture.mjs", "--", fixtureRoot],
    { cwd: repositoryRoot, encoding: "utf8" }
  );

  // Then
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /complete semantic chain/u);
});
