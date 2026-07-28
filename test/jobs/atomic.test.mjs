import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("Given interruption before the record rename, When commit is retried, Then no partial record is accepted and recovery advances the head", async (context) => {
  // Given
  const root = await mkdtemp(path.join(os.tmpdir(), "cardnews-jobs-red-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const jobs = await import("../../src/jobs/index.ts");
  const job = await jobs.createJob({ root, slug: "atomic-boundary", seed: { source: "red" } });

  // When
  const commit = jobs.commitStage(job, {
    stage: "source",
    value: { schemaVersion: "1.0.0", sourceId: "source-red" },
    failpoint: "record-before-rename"
  });

  // Then
  await assert.rejects(commit, (error) => error.code === "ATOMIC_WRITE_INTERRUPTED");
  assert.deepEqual(await readdir(path.join(job.path, "records")), []);
  await jobs.commitStage(job, { stage: "source", value: { recovered: true } });
  assert.equal((await jobs.getJobStatus(job)).resume.stage, "brief");
});

test("Given interruption before the job-head rename, When commit is retried, Then the unaccepted record is cleaned and recovery advances the head", async (context) => {
  // Given
  const root = await mkdtemp(path.join(os.tmpdir(), "cardnews-jobs-head-interrupt-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const jobs = await import("../../src/jobs/index.ts");
  const job = await jobs.createJob({ root, slug: "head-boundary", seed: { source: "head" } });

  // When
  const commit = jobs.commitStage(job, {
    stage: "source",
    value: { sourceId: "source-head" },
    failpoint: "head-before-rename"
  });

  // Then
  await assert.rejects(commit, (error) => error.code === "ATOMIC_WRITE_INTERRUPTED");
  assert.deepEqual(await readdir(path.join(job.path, "records")), []);
  assert.equal((await jobs.getJobStatus(job)).resume.stage, "source");
  await jobs.commitStage(job, { stage: "source", value: { recovered: true } });
  assert.equal((await jobs.getJobStatus(job)).resume.stage, "brief");
});

test("Given interruption before the revision-head rename, When force is retried, Then no partial revision remains and recovery creates one revision", async (context) => {
  // Given
  const root = await mkdtemp(path.join(os.tmpdir(), "cardnews-jobs-revision-interrupt-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const jobs = await import("../../src/jobs/index.ts");
  const job = await jobs.createJob({ root, slug: "revision-boundary", seed: { source: "revision" } });
  await jobs.commitStage(job, { stage: "source", value: { version: 1 } });
  const before = (await readdir(root)).sort();

  // When
  const force = jobs.forceCommitStage(job, {
    stage: "source",
    value: { version: 2 },
    failpoint: "revision-head-before-rename"
  });

  // Then
  await assert.rejects(force, (error) => error.code === "ATOMIC_WRITE_INTERRUPTED");
  assert.deepEqual((await readdir(root)).sort(), before);
  const recovered = await jobs.forceCommitStage(job, { stage: "source", value: { version: 2 } });
  assert.equal(recovered.job.revision, 1);
  assert.equal((await jobs.getJobStatus(recovered.job)).resume.stage, "brief");
});
