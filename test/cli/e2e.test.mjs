import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { watch } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalJson, canonicalSha256 } from "../../src/contracts/index.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const executable = path.join(repositoryRoot, "bin", "cardnews");
const synthetic = path.join(repositoryRoot, "fixtures", "synthetic");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

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

const runJson = async (cwd, args, expectedCode = 0, environment = {}) => {
  const result = await run(cwd, [...args, "--json"], environment);
  assert.equal(result.code, expectedCode, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  assert.equal(result.stderr, "");
  return { result, output: JSON.parse(result.stdout) };
};

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

const privateProjectionResidue = async () => readdir(
  path.join(repositoryRoot, ".cardnews", "private-cli-fixtures")
).catch((error) => {
  if (error?.code === "ENOENT") return [];
  throw error;
});

const renderResidue = async (workspace, job) =>
  (await readdir(path.join(workspace, job, "render")))
    .filter((name) => name === "accepted" || /^\.accepted\..+\.tmp$/u.test(name));

const removeEmpty = async (target) => {
  try {
    await rmdir(target);
  } catch (error) {
    if (error?.code !== "ENOENT" && error?.code !== "ENOTEMPTY") throw error;
  }
};

const interruptRender = async (workspace, job, signal) => new Promise((resolve, reject) => {
  const renderDirectory = path.join(workspace, job, "render");
  const watcher = watch(renderDirectory, (event, filename) => {
    if (event !== "rename" || typeof filename !== "string" || !filename.startsWith(".accepted.")) return;
    watcher.close();
    child.kill(signal);
  });
  const child = spawn(executable, ["render", "--job", job, "--json"], {
    cwd: workspace,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.on("error", (error) => {
    watcher.close();
    reject(error);
  });
  child.on("close", (code, signal) => {
    watcher.close();
    resolve({ code, signal });
  });
});

const authorAndCommit = async (workspace, job, stage, fixtureName, dependencyField, dependencyDigest) => {
  const scaffold = await runJson(workspace, ["scaffold-record", "--job", job, "--stage", stage]);
  const draft = path.join(workspace, scaffold.output.result.draftPath);
  const value = await readJson(path.join(synthetic, "records", fixtureName));
  if (dependencyField !== undefined) value[dependencyField] = dependencyDigest;
  await writeFile(draft, `${canonicalJson(value)}\n`);
  const committed = await runJson(workspace, [
    "commit-record", "--job", job, "--stage", stage, "--input", scaffold.output.result.draftPath
  ]);
  return { value, digest: committed.output.result.contractDigest };
};

test("Given two fresh fixture roots and a sentinel user job, When each render process is interrupted, Then no owned temp or private residue remains before retry", async (context) => {
  // Given
  const workspace = await mkdtemp(path.join(os.tmpdir(), "cardnews-cli-e2e-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const source = path.join(workspace, "article.html");
  const assetA = path.join(workspace, "seed-orbit.bin");
  const assetB = path.join(workspace, "record-grid.bin");
  await cp(path.join(synthetic, "source", "article.html"), source);
  await cp(path.join(synthetic, "assets", "seed-orbit", "asset.bin"), assetA);
  await cp(path.join(synthetic, "assets", "record-grid", "asset.bin"), assetB);

  // When
  const initialized = await runJson(workspace, [
    "init", "--slug", "synthetic-orbit", "--target", "portrait-social-1080x1350", "--cards", "7"
  ]);
  const job = initialized.output.result.jobPath;
  const ingested = await runJson(workspace, [
    "ingest", "--job", job, "--file", source, "--allowed-root", workspace
  ]);
  const editorial = await authorAndCommit(
    workspace, job, "editorial-brief", "editorial-brief.json",
    "sourceEnvelopeDigest", ingested.output.result.contractDigest
  );
  const storyboard = await authorAndCommit(
    workspace, job, "storyboard", "storyboard.json",
    "editorialBriefDigest", editorial.digest
  );
  const recipe = await authorAndCommit(
    workspace, job, "visual-recipe", "visual-recipe.json",
    "storyboardDigest", storyboard.digest
  );
  const renderSpec = await authorAndCommit(
    workspace, job, "render-spec", "render-spec.json",
    "visualRecipeDigest", recipe.digest
  );
  const importedA = await runJson(workspace, [
    "import-asset", "--job", job, "--file", assetA, "--allowed-root", workspace,
    "--rights", "generated", "--origin-note", "synthetic generated fixture", "--slot", "hero"
  ]);
  const importedB = await runJson(workspace, [
    "import-asset", "--job", job, "--file", assetB, "--allowed-root", workspace,
    "--rights", "generated", "--origin-note", "synthetic generated fixture", "--slot", "illustration"
  ]);
  const validation = await runJson(workspace, [
    "validate", "--job", job, "--stage", "render-spec"
  ]);
  const projectionParent = path.join(repositoryRoot, ".cardnews", "private-cli-fixtures");
  const sentinelName = `sentinel-user-job-${randomUUID()}`;
  const sentinel = path.join(projectionParent, sentinelName);
  const sentinelFile = path.join(sentinel, "DO-NOT-DELETE.txt");
  const sentinelBytes = Buffer.from(`pre-existing-user-job:${sentinelName}\n`);
  await mkdir(sentinel, { recursive: true });
  await writeFile(sentinelFile, sentinelBytes, { flag: "wx", mode: 0o600 });
  context.after(async () => {
    await rm(sentinel, { recursive: true, force: true });
    await removeEmpty(projectionParent);
    await removeEmpty(path.dirname(projectionParent));
  });
  const interruptionRoots = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parent = await mkdtemp(path.join(os.tmpdir(), "cardnews-cli-interrupt-"));
    context.after(() => rm(parent, { recursive: true, force: true }));
    const root = path.join(parent, "fixture");
    await cp(workspace, root, { recursive: true });
    interruptionRoots.push(root);
  }
  const interruptions = [];
  for (const [index, root] of interruptionRoots.entries()) {
    const signal = index === 0 ? "SIGTERM" : "SIGINT";
    const interrupted = await interruptRender(root, job, signal);
    interruptions.push({
      signal,
      interrupted: interrupted.code !== 0 || interrupted.signal !== null,
      renderResidue: await renderResidue(root, job),
      projectionResidue: (await privateProjectionResidue()).filter((name) => name !== sentinelName),
      sentinelPreserved: (await readFile(sentinelFile)).equals(sentinelBytes)
    });
  }
  const retryWorkspace = interruptionRoots[1];
  assert.notEqual(retryWorkspace, undefined);
  const rendered = await runJson(retryWorkspace, ["render", "--job", job]);
  const failHeadSync = path.join(retryWorkspace, "fail-evaluate-head-sync.cjs");
  await writeFile(
    failHeadSync,
    "const fs=require('node:fs');if(process.argv[3]==='job'&&process.argv[4]==='atomic-write'&&process.argv[5]==='head.json'){fs.fsyncSync=()=>{const error=new Error('forced evaluate head sync failure');error.code='EIO';throw error;};}\n",
  );
  const interruptedEvaluation = await runJson(
    retryWorkspace,
    ["evaluate", "--job", job, "--deterministic-only"],
    2,
    { NODE_OPTIONS: `--require=${failHeadSync}` },
  );
  await assert.rejects(
    access(path.join(retryWorkspace, job, "reports", "evaluation-report.json")),
    (error) => error.code === "ENOENT",
  );
  const evaluated = await runJson(retryWorkspace, ["evaluate", "--job", job, "--deterministic-only"]);
  const packaged = await runJson(retryWorkspace, ["package", "--job", job], 6);
  const status = await runJson(retryWorkspace, ["status", "--job", job]);
  const resumed = await runJson(retryWorkspace, ["resume", "--job", job]);

  // Then
  assert.equal(editorial.value.sourceEnvelopeDigest, canonicalSha256((await readJson(path.join(
    retryWorkspace, ingested.output.result.recordPath
  ))).value));
  assert.equal(importedA.output.result.assetDigest, sha256(await readFile(assetA)));
  assert.equal(importedB.output.result.assetDigest, sha256(await readFile(assetB)));
  assert.equal(validation.output.result.valid, true);
  assert.deepEqual(interruptions.map((attempt) => attempt.signal), ["SIGTERM", "SIGINT"]);
  assert.deepEqual(interruptions.map((attempt) => attempt.interrupted), [true, true]);
  assert.deepEqual(interruptions.map((attempt) => attempt.renderResidue), [[], []]);
  assert.deepEqual(interruptions.map((attempt) => attempt.projectionResidue), [[], []]);
  assert.deepEqual(interruptions.map((attempt) => attempt.sentinelPreserved), [true, true]);
  assert.deepEqual(rendered.output.result.cardIds, renderSpec.value.cardOrder);
  assert.equal((await readdir(path.join(retryWorkspace, rendered.output.result.cardsPath))).length, 7);
  assert.equal(
    (await readdir(path.join(retryWorkspace, job, "render"))).some((name) => name.startsWith(".accepted.")),
    false
  );
  assert.equal((await readFile(sentinelFile)).equals(sentinelBytes), true);
  assert.deepEqual((await privateProjectionResidue()).filter((name) => name !== sentinelName), []);
  assert.equal(interruptedEvaluation.output.error.code, "EIO");
  assert.equal(evaluated.output.result.blocking, false);
  assert.equal(packaged.output.error.class, "package");
  assert.equal(packaged.output.error.code, "VISUAL_VERDICT_MISSING");
  assert.equal(status.output.result.nextStage, "package");
  assert.equal(resumed.output.result.nextCommand, status.output.result.nextCommand);
  assert.equal(
    (await readdir(path.join(retryWorkspace, job, "drafts"))).every((name) => name.endsWith(".receipt.json")),
    true
  );
});

test("Given committed upstream records and accepted outputs, When an upstream force revision changes and retries repeat, Then downstream state is stale and prior bytes remain immutable", async (context) => {
  // Given
  const workspace = await mkdtemp(path.join(os.tmpdir(), "cardnews-cli-stale-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const source = path.join(workspace, "article.html");
  await cp(path.join(synthetic, "source", "article.html"), source);
  const initialized = await runJson(workspace, [
    "init", "--slug", "stale-chain", "--target", "portrait-social-1080x1350", "--cards", "7"
  ]);
  const job = initialized.output.result.jobPath;
  const ingested = await runJson(workspace, [
    "ingest", "--job", job, "--file", source, "--allowed-root", workspace
  ]);
  const editorial = await authorAndCommit(
    workspace, job, "editorial-brief", "editorial-brief.json",
    "sourceEnvelopeDigest", ingested.output.result.contractDigest
  );
  await authorAndCommit(
    workspace, job, "storyboard", "storyboard.json",
    "editorialBriefDigest", editorial.digest
  );
  const originalHead = await readFile(path.join(workspace, job, "head.json"));
  const revisedSource = path.join(workspace, "article-revised.html");
  await writeFile(revisedSource, `${await readFile(source, "utf8")}<p>Revision marker.</p>`);

  // When
  const forced = await runJson(workspace, [
    "ingest", "--job", job, "--file", revisedSource, "--allowed-root", workspace, "--force"
  ]);
  const revisionJob = forced.output.result.jobPath;
  const revisionStatus = await runJson(workspace, ["status", "--job", revisionJob]);
  const retry = await runJson(workspace, [
    "ingest", "--job", job, "--file", revisedSource, "--allowed-root", workspace
  ], 2);

  // Then
  assert.notEqual(revisionJob, job);
  assert.equal(revisionStatus.output.result.stages.find((stage) => stage.stage === "editorial-brief").state, "stale");
  assert.equal(revisionStatus.output.result.nextStage, "editorial-brief");
  assert.deepEqual(await readFile(path.join(workspace, job, "head.json")), originalHead);
  assert.equal(retry.output.error.code, "IMMUTABLE_CHECKPOINT");
});

test("Given deterministic render, QA, and package rejection paths, When each command fails, Then exit classes 4, 5, and 6 are exact", async (context) => {
  // Given
  const workspace = await mkdtemp(path.join(os.tmpdir(), "cardnews-cli-exits-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const initialized = await runJson(workspace, [
    "init", "--slug", "exit-matrix", "--target", "portrait-social-1080x1350"
  ]);
  const job = initialized.output.result.jobPath;

  // When
  const render = await runJson(workspace, ["render", "--job", job], 4);
  const evaluate = await runJson(workspace, ["evaluate", "--job", job], 5);
  const packageResult = await runJson(workspace, ["package", "--job", job], 6);

  // Then
  assert.equal(render.output.error.class, "render");
  assert.equal(evaluate.output.error.class, "qa");
  assert.equal(packageResult.output.error.class, "package");
});
