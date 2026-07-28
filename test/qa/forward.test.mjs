import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("Given Todo 12 command contracts, When package metadata is read, Then each QA command routes to its owned script", async () => {
  // Given
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));

  // When
  const scripts = packageJson.scripts;

  // Then
  assert.equal(scripts["qa:forward"], "node scripts/qa-forward.mjs");
  assert.equal(scripts["qa:live-smoke"], "node scripts/qa-live-smoke.mjs");
  assert.equal(scripts["qa:visual"], "node scripts/qa-visual.mjs");
  await Promise.all([
    access(path.join(repositoryRoot, "scripts", "qa-forward.mjs")),
    access(path.join(repositoryRoot, "scripts", "qa-live-smoke.mjs")),
    access(path.join(repositoryRoot, "scripts", "qa-visual.mjs")),
  ]);
});

test("Given a fresh-context disclosure envelope, When it is serialized, Then only the installed skill and raw task inputs are disclosed", async (context) => {
  // Given
  const root = await mkdtemp(path.join(os.tmpdir(), "cardnews-forward-policy-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const rawInput = path.join(root, "article.html");
  const job = path.join(root, ".cardnews", "jobs", "job-1");
  await writeFile(rawInput, "<article>synthetic</article>");
  const { createDisclosureEnvelope } = await import("../../scripts/qa-fresh-context.mjs");

  // When
  const envelope = createDisclosureEnvelope({
    scenario: "fresh-create",
    installedSkill: "/Users/test/.codex/skills/cardnews-foundry",
    rawInputs: [rawInput],
    jobInputs: [job],
  });

  // Then
  assert.deepEqual(envelope.disclosureKinds, ["installed-skill", "raw-input", "job-state"]);
  assert.deepEqual(envelope.disclosedPaths, [
    "/Users/test/.codex/skills/cardnews-foundry",
    rawInput,
    job,
  ]);
  assert.deepEqual(envelope.prohibitedContext, [
    "expected-answers",
    "implementation-plan",
    "intended-fixes",
    "prior-diagnosis",
  ]);
});

test("Given an ephemeral non-repository workspace, When Codex arguments are built, Then the fresh context may run there", async () => {
  // Given
  const { createCodexArgs } = await import("../../scripts/qa-fresh-context.mjs");

  // When
  const args = createCodexArgs({
    cwd: "/private/ephemeral",
    finalMessage: "/private/evidence/final.txt",
    prompt: "user task",
  });

  // Then
  assert.equal(args.includes("--skip-git-repo-check"), true);
  assert.equal(args.includes("--ephemeral"), true);
  assert.equal(args.includes("--json"), true);
});

test("Given repeated forward runs, When context evidence paths are allocated, Then each run gets an isolated Codex home", async () => {
  // Given
  const { createContextRoot } = await import("../../scripts/qa-fresh-context.mjs");

  // When
  const first = createContextRoot("/evidence", "fresh-create", "run-a");
  const second = createContextRoot("/evidence", "fresh-create", "run-b");

  // Then
  assert.notEqual(first, second);
  assert.equal(first, path.join("/evidence", "fresh-contexts", "fresh-create", "run-a"));
  assert.equal(second, path.join("/evidence", "fresh-contexts", "fresh-create", "run-b"));
});

test("Given Codex exits zero with a nonempty failure response, When the job oracle rejects its artifacts, Then the context fails", async () => {
  // Given
  const { contextSucceeded } = await import("../../scripts/qa-fresh-context.mjs");

  // When
  const passed = contextSucceeded({
    exitCode: 0,
    threadId: "fresh-thread",
    finalMessagePresent: true,
    outcomePassed: false,
  });

  // Then
  assert.equal(passed, false);
});

test("Given a real completed job but an empty final response, When context completion is assessed, Then the context fails", async () => {
  // Given
  const { contextSucceeded } = await import("../../scripts/qa-fresh-context.mjs");

  // When
  const passed = contextSucceeded({
    exitCode: 0,
    threadId: "fresh-thread",
    finalMessagePresent: false,
    outcomePassed: true,
  });

  // Then
  assert.equal(passed, false);
});

test("Given prose-only completion with no job directory, When the workspace oracle runs, Then it returns a failed outcome", async (context) => {
  // Given
  const workspace = await mkdtemp(path.join(os.tmpdir(), "cardnews-prose-only-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const { inspectWorkspaceOutcome } = await import("../../scripts/qa-job-oracle.mjs");

  // When
  const outcome = await inspectWorkspaceOutcome({
    runner: path.join(repositoryRoot, "skill", "cardnews-foundry", "scripts", "cardnews.mjs"),
    workspace,
  });

  // Then
  assert.equal(outcome.passed, false);
  assert.equal(outcome.candidateCount, 0);
});

test("Given an unreachable optional live source, When live smoke runs, Then unavailability is recorded without failing the command", async (context) => {
  // Given
  const root = await mkdtemp(path.join(os.tmpdir(), "cardnews-live-smoke-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const evidence = path.join(root, "evidence");
  const { runLiveSmoke } = await import("../../scripts/qa-live-smoke.mjs");

  // When
  const result = await runLiveSmoke({
    url: "https://127.0.0.1.invalid/example",
    evidenceRoot: evidence,
  });

  // Then
  assert.equal(result.blocking, false);
  assert.equal(result.status, "unavailable");
  assert.equal(result.rawContentPersisted, false);
  await access(path.join(evidence, "live-smoke-status.json"));
});

test("Given a render manifest, When capture dimensions are checked, Then cards and contact sheet use their own contracts", async () => {
  // Given
  const { dimensionsMatchManifest } = await import("../../scripts/qa-visual.mjs");
  const manifest = {
    artifacts: [{
      contract: { cardId: "card-1", width: 1080, height: 1350 },
    }],
    contactSheet: { width: 1080, height: 1480 },
  };

  // When
  const matches = dimensionsMatchManifest([
    { id: "card-1", width: 1080, height: 1350 },
    { id: "contact-sheet", width: 1080, height: 1480 },
  ], manifest);

  // Then
  assert.equal(matches, true);
});
