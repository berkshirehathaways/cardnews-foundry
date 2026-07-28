import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const executable = path.join(repositoryRoot, "bin", "cardnews");
const fixtures = path.join(repositoryRoot, "test", "cli", "fixtures");

const run = async (cwd, args, environment = {}) => new Promise((resolve, reject) => {
  const child = spawn(executable, args, {
    cwd,
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  child.on("error", reject);
  child.on("close", (code, signal) => resolve({
    code,
    signal,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8")
  }));
});

const temporaryWorkspace = async (context) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "cardnews-cli-contract-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  return workspace;
};

test("Given the executable wrapper, When help is requested, Then the documented command inventory is byte-stable on stdout", async (context) => {
  // Given
  const workspace = await temporaryWorkspace(context);
  const expected = await readFile(path.join(fixtures, "help.txt"), "utf8");

  // When
  const result = await run(workspace, ["--help"]);

  // Then
  assert.equal(result.code, 0);
  assert.equal(result.stdout, expected);
  assert.equal(result.stderr, "");
});

test("Given an unknown flag in JSON mode, When parsing occurs, Then usage class 2 is stable and stderr stays empty", async (context) => {
  // Given
  const workspace = await temporaryWorkspace(context);
  const expected = await readFile(path.join(fixtures, "unknown-flag.json"), "utf8");

  // When
  const result = await run(workspace, ["status", "--job", "missing", "--wat", "--json"]);

  // Then
  assert.equal(result.code, 2);
  assert.equal(result.stdout, expected);
  assert.equal(result.stderr, "");
});

test("Given a clean workspace, When init and status run in JSON mode, Then filesystem state and the exact next action agree", async (context) => {
  // Given
  const workspace = await temporaryWorkspace(context);

  // When
  const initialized = await run(workspace, [
    "init", "--slug", "orbit-notes", "--target", "portrait-social-1080x1350", "--cards", "7", "--json"
  ]);
  const initOutput = JSON.parse(initialized.stdout);
  const status = await run(workspace, ["status", "--job", initOutput.result.jobPath, "--json"]);
  const statusOutput = JSON.parse(status.stdout);

  // Then
  assert.equal(initialized.code, 0);
  assert.equal(initialized.stderr, "");
  assert.equal(status.code, 0);
  assert.equal(status.stderr, "");
  assert.equal(statusOutput.result.nextStage, "source");
  assert.equal(statusOutput.result.draftPath, null);
  assert.deepEqual(statusOutput.result.requiredDependencies, []);
  assert.equal(
    statusOutput.result.nextCommand,
    `cardnews ingest --job ${initOutput.result.jobPath} --file <source> --allowed-root <root>`
  );
  assert.equal(
    JSON.parse(await readFile(path.join(workspace, initOutput.result.jobPath, "job.json"), "utf8")).cardCount,
    7
  );
});

test("Given a local source without an allowed root, When ingest runs, Then it is rejected as usage class 2 before reading source bytes", async (context) => {
  // Given
  const workspace = await temporaryWorkspace(context);
  const secret = "PRIVATE-SOURCE-TEXT-MUST-NOT-LEAK";
  const source = path.join(workspace, "private.md");
  await import("node:fs/promises").then(({ writeFile }) => writeFile(source, secret));
  const initialized = await run(workspace, [
    "init", "--slug", "redaction", "--target", "portrait-social-1080x1350", "--json"
  ]);
  const job = JSON.parse(initialized.stdout).result.jobPath;

  // When
  const result = await run(workspace, ["ingest", "--job", job, "--file", source, "--json"]);

  // Then
  assert.equal(result.code, 2);
  assert.equal(result.stderr, "");
  assert.equal(JSON.parse(result.stdout).error.class, "usage");
  assert.doesNotMatch(result.stdout, /PRIVATE-SOURCE|\/Users\/|cardnews-cli-contract-/u);
});

test("Given a credentialed URL containing secrets, When ingest rejects it, Then security class 3 exposes neither credentials nor the locator", async (context) => {
  // Given
  const workspace = await temporaryWorkspace(context);
  const initialized = await run(workspace, [
    "init", "--slug", "url-redaction", "--target", "portrait-social-1080x1350", "--json"
  ]);
  const job = JSON.parse(initialized.stdout).result.jobPath;

  // When
  const result = await run(workspace, [
    "ingest", "--job", job, "--url", "https://secret-user:secret-pass@example.invalid/article", "--json"
  ]);

  // Then
  assert.equal(result.code, 3);
  assert.equal(result.stderr, "");
  assert.equal(JSON.parse(result.stdout).error.class, "security");
  assert.doesNotMatch(result.stdout, /secret-user|secret-pass|example\.invalid|\/Users\/|cookies?|authorization/iu);
});

test("Given drafts or source storage redirected through symlinks, When CLI writes private state, Then both writes fail before touching the targets", async (context) => {
  // Given
  const workspace = await temporaryWorkspace(context);
  const outsideDrafts = await mkdtemp(path.join(os.tmpdir(), "cardnews-cli-drafts-outside-"));
  const outsideSource = await mkdtemp(path.join(os.tmpdir(), "cardnews-cli-source-outside-"));
  context.after(() => Promise.all([
    rm(outsideDrafts, { recursive: true, force: true }),
    rm(outsideSource, { recursive: true, force: true })
  ]));
  const draftInitialized = await run(workspace, [
    "init", "--slug", "draft-link", "--target", "portrait-social-1080x1350", "--json"
  ]);
  const draftJob = JSON.parse(draftInitialized.stdout).result.jobPath;
  const sourceFile = path.join(workspace, "article.md");
  await writeFile(sourceFile, "# Safe source\n\nLocal evidence.");
  await run(workspace, [
    "ingest", "--job", draftJob, "--file", sourceFile, "--allowed-root", workspace, "--json"
  ]);
  const draftJobPath = path.join(workspace, draftJob);
  await rm(path.join(draftJobPath, "drafts"), { recursive: true });
  await symlink(outsideDrafts, path.join(draftJobPath, "drafts"));
  const sourceInitialized = await run(workspace, [
    "init", "--slug", "source-link", "--target", "portrait-social-1080x1350", "--json"
  ]);
  const sourceJob = JSON.parse(sourceInitialized.stdout).result.jobPath;
  const sourceJobPath = path.join(workspace, sourceJob);

  // When
  const draft = await run(workspace, [
    "scaffold-record", "--job", draftJob, "--stage", "editorial-brief", "--json"
  ]);
  await rm(path.join(sourceJobPath, "source"), { recursive: true });
  await symlink(outsideSource, path.join(sourceJobPath, "source"));
  const ingest = await run(workspace, [
    "ingest", "--job", sourceJob, "--file", sourceFile, "--allowed-root", workspace, "--json"
  ]);

  // Then
  assert.equal(draft.code, 3);
  assert.equal(ingest.code, 3);
  assert.deepEqual(await readdir(outsideDrafts), []);
  assert.deepEqual(await readdir(outsideSource), []);
});

test("Given an existing immutable job, When init is retried and then forced, Then retry preserves the original and force creates a revision", async (context) => {
  // Given
  const workspace = await temporaryWorkspace(context);
  const args = ["init", "--slug", "revision", "--target", "portrait-social-1080x1350", "--json"];
  const first = await run(workspace, args);
  const firstOutput = JSON.parse(first.stdout);
  const before = await readFile(path.join(workspace, firstOutput.result.jobPath, "head.json"));

  // When
  const retry = await run(workspace, args);
  const forced = await run(workspace, [...args.slice(0, -1), "--force", "--json"]);
  const forcedOutput = JSON.parse(forced.stdout);

  // Then
  assert.equal(retry.code, 2);
  assert.deepEqual(await readFile(path.join(workspace, firstOutput.result.jobPath, "head.json")), before);
  assert.equal(forced.code, 0);
  assert.notEqual(forcedOutput.result.jobPath, firstOutput.result.jobPath);
  assert.equal(forcedOutput.result.revision, 1);
});

test("Given human mode, When a command succeeds, Then stdout is empty and the actionable result is written only to stderr", async (context) => {
  // Given
  const workspace = await temporaryWorkspace(context);

  // When
  const result = await run(workspace, [
    "init", "--slug", "human-output", "--target", "portrait-social-1080x1350"
  ]);

  // Then
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^init: \.cardnews\/jobs\/human-output-/u);
  assert.doesNotMatch(result.stderr, /\/Users\/|cardnews-cli-contract-/u);
});
