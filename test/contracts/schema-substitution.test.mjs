import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const verifier = path.join(root, "scripts", "verify-contracts.mjs");

const assertStructuralSubstitutionFails = async (context, replacedFile, substituteFile, expectedCode) => {
  const schemaRoot = await mkdtemp(path.join(os.tmpdir(), "cardnews-schema-shape-"));
  context.after(async () => rm(schemaRoot, { recursive: true, force: true }));
  await cp(path.join(root, "schemas"), schemaRoot, { recursive: true });
  const replacedPath = path.join(schemaRoot, replacedFile);
  const expected = JSON.parse(await readFile(replacedPath, "utf8"));
  const substitute = JSON.parse(await readFile(path.join(schemaRoot, substituteFile), "utf8"));
  substitute.$id = expected.$id;
  await writeFile(replacedPath, `${JSON.stringify(substitute)}\n`, "utf8");

  const error = await execFileAsync(
    process.execPath,
    [verifier, "--schemas", schemaRoot],
    { cwd: root, encoding: "utf8" }
  ).then(() => null, (failure) => failure);
  const summary = JSON.parse(error?.stdout ?? "{}");

  assert.deepEqual(
    { exitCode: error?.code, ok: summary.ok, code: summary.error?.code },
    { exitCode: 1, ok: false, code: expectedCode }
  );
};

test("Given SourceEnvelope keeps its filename and id but has an infrastructure shape, When verified, Then it fails closed", async (context) => {
  await assertStructuralSubstitutionFails(
    context,
    "source-envelope.schema.json",
    "target-profile.schema.json",
    "SELECTED_VALID_FIXTURE_REJECTED"
  );
});

test("Given EditorialBrief keeps its filename and id but has another public shape, When verified, Then it fails closed", async (context) => {
  await assertStructuralSubstitutionFails(
    context,
    "editorial-brief.schema.json",
    "evaluation-report.schema.json",
    "SELECTED_VALID_FIXTURE_REJECTED"
  );
});
