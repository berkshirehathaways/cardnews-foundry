import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const jobs = await import("../../src/jobs/index.ts");
const contracts = await import("../../src/contracts/index.ts");

const fixture = async (context, name) => {
  const root = await mkdtemp(path.join(os.tmpdir(), `cardnews-jobs-${name}-`));
  context.after(async () => rm(root, { recursive: true, force: true }));
  return jobs.createJob({ root, slug: name, seed: { name } });
};

test("Given a job seed, When a private job is created, Then its slug and short canonical digest address an explicit root", async (context) => {
  // Given
  const root = await mkdtemp(path.join(os.tmpdir(), "cardnews-jobs-root-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const seed = { z: 2, a: 1 };

  // When
  const job = await jobs.createJob({ root, slug: "My News!", seed });

  // Then
  assert.equal(job.id, `my-news-${contracts.canonicalSha256(seed).slice(0, 12)}`);
  assert.equal(job.path, path.join(await import("node:fs/promises").then((fs) => fs.realpath(root)), job.id));
  assert.equal(jobs.DEFAULT_JOB_ROOT, ".cardnews/jobs");
});

test("Given unsafe targets, When job paths are resolved, Then traversal, absolute, device, and symlink escapes are rejected", async (context) => {
  // Given
  const job = await fixture(context, "confined");
  const outside = await mkdtemp(path.join(os.tmpdir(), "cardnews-outside-"));
  context.after(async () => rm(outside, { recursive: true, force: true }));
  await symlink(outside, path.join(job.path, "escape"));

  // When
  const attempts = [
    jobs.resolveConfinedPath(job.path, "../outside.json"),
    jobs.resolveConfinedPath(job.path, path.join(outside, "absolute.json")),
    jobs.resolveConfinedPath(job.path, "NUL.json"),
    jobs.resolveConfinedPath(job.path, "escape/linked.json")
  ];

  // Then
  const results = await Promise.all(attempts.map(async (attempt) => attempt.then(
    () => "accepted",
    (error) => error.code
  )));
  assert.deepEqual(results, ["PATH_ESCAPE", "PATH_ESCAPE", "DEVICE_PATH", "SYMLINK_ESCAPE"]);
});

test("Given committed dependencies, When records are inspected, Then canonical immutable digest files form the dependency graph", async (context) => {
  // Given
  const job = await fixture(context, "graph");
  const sourceDigest = await jobs.commitStage(job, { stage: "source", value: { text: "source" } });

  // When
  const briefDigest = await jobs.commitStage(job, { stage: "brief", value: { thesis: "brief" } });
  const recordText = await readFile(path.join(job.path, "records", `${briefDigest}.json`), "utf8");
  const record = JSON.parse(recordText);

  // Then
  assert.equal(recordText, contracts.canonicalJson(record));
  assert.equal(contracts.canonicalSha256(record), briefDigest);
  assert.deepEqual(record.dependencies, { source: sourceDigest });
  await assert.rejects(
    jobs.commitStage(job, { stage: "source", value: { text: "replacement" } }),
    (error) => error.code === "STAGE_IMMUTABLE"
  );
});

test("Given an interrupted stage write, When status and resume are read then commit is retried, Then cleanup is complete and the exact stage resumes", async (context) => {
  // Given
  const job = await fixture(context, "cancel-resume");

  // When
  await assert.rejects(
    jobs.commitStage(job, { stage: "source", value: { text: "partial" }, failpoint: "record-before-rename" }),
    (error) => error.code === "ATOMIC_WRITE_INTERRUPTED"
  );
  const interrupted = await jobs.getJobStatus(job);
  const temporaryFiles = (await readdir(path.join(job.path, "records"))).filter((file) => file.endsWith(".tmp"));
  await jobs.commitStage(job, { stage: "source", value: { text: "complete" } });
  const resumed = await jobs.getJobStatus(job);

  // Then
  assert.deepEqual(interrupted.resume, {
    action: "commit",
    stage: "source",
    path: path.join(job.path, "records", "source.pending.json")
  });
  assert.deepEqual(temporaryFiles, []);
  assert.equal(resumed.resume.action, "commit");
  assert.equal(resumed.resume.stage, "brief");
});

test("Given a live writer lock, When another writer commits, Then contention fails while read-only status remains available", async (context) => {
  // Given
  const job = await fixture(context, "lock-contention");
  const lock = await jobs.acquireJobLock(job);
  context.after(async () => lock.release().catch(() => undefined));

  // When
  const status = await jobs.getJobStatus(job);
  const write = jobs.commitStage(job, { stage: "source", value: { text: "blocked" } });

  // Then
  assert.equal(status.resume.action, "commit");
  await assert.rejects(write, (error) => error.code === "JOB_LOCKED");
  await lock.release();
});

test("Given a dead stale lock and a malformed lock, When lock recovery runs, Then only the provably dead lock is reclaimed", async (context) => {
  // Given
  const job = await fixture(context, "stale-lock");
  const lockPath = path.join(job.path, ".write.lock");
  await writeFile(lockPath, JSON.stringify({ token: "dead", pid: 999_999_999, createdAtMs: 1 }), "utf8");

  // When
  const recovered = await jobs.acquireJobLock(job, { staleAfterMs: 10, nowMs: 100 });
  await recovered.release();
  await writeFile(lockPath, "{malformed", "utf8");

  // Then
  await assert.rejects(
    jobs.acquireJobLock(job, { staleAfterMs: 10, nowMs: 100 }),
    (error) => error.code === "JOB_LOCKED"
  );
});

test("Given accepted downstream checkpoints, When an upstream stage is force-revised, Then prior bytes stay immutable and stale propagates to exact resume", async (context) => {
  // Given
  const job = await fixture(context, "revision");
  await jobs.commitStage(job, { stage: "source", value: { version: 1 } });
  await jobs.commitStage(job, { stage: "brief", value: { version: 1 } });
  await jobs.commitStage(job, { stage: "storyboard", value: { version: 1 } });
  const oldHead = await readFile(path.join(job.path, "head.json"), "utf8");
  const oldRecords = await Promise.all((await readdir(path.join(job.path, "records"))).sort().map(
    async (file) => readFile(path.join(job.path, "records", file), "utf8")
  ));

  // When
  const revised = await jobs.forceCommitStage(job, { stage: "source", value: { version: 2 } });
  const status = await jobs.getJobStatus(revised.job);
  await jobs.commitStage(revised.job, { stage: "brief", value: { version: 2 } });
  const resumed = await jobs.getJobStatus(revised.job);

  // Then
  assert.notEqual(revised.job.id, job.id);
  assert.equal(revised.job.revision, 1);
  assert.equal(await readFile(path.join(job.path, "head.json"), "utf8"), oldHead);
  assert.deepEqual(await Promise.all((await readdir(path.join(job.path, "records"))).sort().map(
    async (file) => readFile(path.join(job.path, "records", file), "utf8")
  )), oldRecords);
  assert.deepEqual(status.stages.slice(0, 3).map(({ stage, state }) => ({ stage, state })), [
    { stage: "source", state: "valid" },
    { stage: "brief", state: "stale" },
    { stage: "storyboard", state: "stale" }
  ]);
  assert.equal(status.resume.stage, "brief");
  assert.equal(status.resume.path, path.join(revised.job.path, "records", `${status.stages[1].digest}.json`));
  assert.equal(resumed.resume.stage, "storyboard");
});

test("Given a complete stage graph, When status is requested, Then resume reports completion at the explicit job head", async (context) => {
  // Given
  const job = await fixture(context, "complete");
  for (const stage of jobs.JOB_STAGES) {
    await jobs.commitStage(job, { stage, value: { stage } });
  }

  // When
  const status = await jobs.getJobStatus(job);

  // Then
  assert.equal(status.stages.every((stage) => stage.state === "valid"), true);
  assert.deepEqual(status.resume, { action: "complete", path: path.join(job.path, "head.json") });
});

test("Given a mutated upstream record, When status is recomputed, Then the digest mismatch and all accepted downstream stages are stale", async (context) => {
  // Given
  const job = await fixture(context, "tamper");
  const sourceDigest = await jobs.commitStage(job, { stage: "source", value: { version: 1 } });
  await jobs.commitStage(job, { stage: "brief", value: { version: 1 } });
  await writeFile(path.join(job.path, "records", `${sourceDigest}.json`), JSON.stringify({
    schemaVersion: 1, stage: "source", value: { version: 2 }, dependencies: {}
  }), "utf8");

  // When
  const status = await jobs.getJobStatus(job);

  // Then
  assert.deepEqual(status.stages.slice(0, 2).map(({ state }) => state), ["stale", "stale"]);
  assert.equal(status.resume.stage, "source");
});

test("Given a digest-addressed record with non-canonical bytes, When status is recomputed, Then the record and downstream stages are stale", async (context) => {
  // Given
  const job = await fixture(context, "noncanonical");
  const sourceDigest = await jobs.commitStage(job, { stage: "source", value: { version: 1 } });
  await jobs.commitStage(job, { stage: "brief", value: { version: 1 } });
  const sourcePath = path.join(job.path, "records", `${sourceDigest}.json`);
  const sourceRecord = JSON.parse(await readFile(sourcePath, "utf8"));
  await writeFile(sourcePath, JSON.stringify(sourceRecord, null, 2), "utf8");

  // When
  const status = await jobs.getJobStatus(job);

  // Then
  assert.deepEqual(status.stages.slice(0, 2).map(({ state }) => state), ["stale", "stale"]);
  assert.equal(status.resume.stage, "source");
});

test("Given a record with an undeclared dependency edge, When status is recomputed, Then the dependency graph rejects it as stale", async (context) => {
  // Given
  const job = await fixture(context, "dependency-shape");
  await jobs.commitStage(job, { stage: "source", value: { version: 1 } });
  const briefDigest = await jobs.commitStage(job, { stage: "brief", value: { version: 1 } });
  const briefPath = path.join(job.path, "records", `${briefDigest}.json`);
  const briefRecord = JSON.parse(await readFile(briefPath, "utf8"));
  const malformed = {
    ...briefRecord,
    dependencies: { ...briefRecord.dependencies, recipe: "undeclared" }
  };
  const malformedDigest = contracts.canonicalSha256(malformed);
  await writeFile(
    path.join(job.path, "records", `${malformedDigest}.json`),
    contracts.canonicalJson(malformed),
    "utf8"
  );
  const headPath = path.join(job.path, "head.json");
  const head = JSON.parse(await readFile(headPath, "utf8"));
  await writeFile(
    headPath,
    contracts.canonicalJson({ ...head, stages: { ...head.stages, brief: malformedDigest } }),
    "utf8"
  );

  // When
  const status = await jobs.getJobStatus(job);

  // Then
  assert.equal(status.stages[1].state, "stale");
  assert.equal(status.resume.stage, "brief");
});
