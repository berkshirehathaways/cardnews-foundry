import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const jobs = await import("../../src/jobs/index.ts");
const execFileAsync = promisify(execFile);

test("Given a job records directory replaced by an escaping symlink, When a stage commits, Then the internal write is rejected before touching the target", async (context) => {
  // Given
  const root = await mkdtemp(path.join(os.tmpdir(), "cardnews-jobs-internal-root-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "cardnews-jobs-internal-outside-"));
  context.after(async () => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true })
  ]));
  const job = await jobs.createJob({ root, slug: "internal-symlink", seed: { safe: true } });
  await rm(path.join(job.path, "records"), { recursive: true });
  await symlink(outside, path.join(job.path, "records"));

  // When
  const commit = jobs.commitStage(job, { stage: "source", value: { text: "escape" } });

  // Then
  await assert.rejects(commit, (error) => error.code === "SYMLINK_ESCAPE");
  assert.deepEqual(await readdir(outside), []);
  assert.equal((await readdir(job.path)).some((file) => file.includes(".lock")), false);
});

test("Given a job records directory redirected to a sibling job, When a stage commits, Then cross-job writes are rejected", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cardnews-jobs-sibling-link-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const first = await jobs.createJob({ root, slug: "first", seed: { job: 1 } });
  const second = await jobs.createJob({ root, slug: "second", seed: { job: 2 } });
  const secondRecords = path.join(second.path, "records");
  await rm(path.join(first.path, "records"), { recursive: true });
  await symlink(secondRecords, path.join(first.path, "records"));
  const before = await readdir(secondRecords);

  const commit = jobs.commitStage(first, { stage: "source", value: { text: "cross-write" } });

  await assert.rejects(commit, (error) => error.code === "SYMLINK_ESCAPE");
  assert.deepEqual(await readdir(secondRecords), before);
  assert.equal((await readdir(first.path)).some((file) => file.includes(".lock")), false);
});

test("Given a non-JSON stage value, When commit canonicalizes it, Then malformed input is rejected and resume remains unchanged", async (context) => {
  // Given
  const root = await mkdtemp(path.join(os.tmpdir(), "cardnews-jobs-malformed-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const job = await jobs.createJob({ root, slug: "malformed", seed: { safe: true } });

  // When
  const commit = jobs.commitStage(job, { stage: "source", value: { missing: undefined } });

  // Then
  await assert.rejects(commit, (error) => error.code === "UNSUPPORTED_JSON_VALUE");
  const status = await jobs.getJobStatus(job);
  assert.equal(status.resume.stage, "source");
  assert.equal((await readdir(job.path)).some((file) => file.includes(".lock")), false);
});

test("Given a job handle whose path names another job, When status is read, Then the forged handle is rejected", async (context) => {
  // Given
  const root = await mkdtemp(path.join(os.tmpdir(), "cardnews-jobs-forged-handle-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const first = await jobs.createJob({ root, slug: "first", seed: { job: 1 } });
  const second = await jobs.createJob({ root, slug: "second", seed: { job: 2 } });
  const forged = { ...first, path: second.path };

  // When
  const status = jobs.getJobStatus(forged);

  // Then
  await assert.rejects(status, (error) => error.code === "PATH_ESCAPE");
});

test("Given real FIFO and Unix socket nodes, When confined paths resolve them, Then both non-regular nodes fail closed", async (context) => {
  // Given
  const root = await mkdtemp(path.join(os.tmpdir(), "cardnews-jobs-special-nodes-"));
  const socketRoot = await mkdtemp(path.join("/tmp", "cj-sock-"));
  const fifoPath = path.join(root, "input.fifo");
  const socketPath = path.join(socketRoot, "input.sock");
  const server = net.createServer();
  context.after(async () => {
    if (server.listening) {
      await new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(socketRoot, { recursive: true, force: true })
    ]);
  });
  await execFileAsync("mkfifo", [fifoPath]);
  server.listen(socketPath);
  await once(server, "listening");

  // When
  const fifo = assert.rejects(
    jobs.resolveConfinedPath(root, "input.fifo"),
    (error) => error.code === "NON_REGULAR_PATH"
  );
  const socket = assert.rejects(
    jobs.resolveConfinedPath(socketRoot, "input.sock"),
    (error) => error.code === "NON_REGULAR_PATH"
  );

  // Then
  await Promise.all([fifo, socket]);
});

test("Given a symlinked record file inside an otherwise valid records directory, When force creates a revision, Then cloning fails closed without a partial revision", async (context) => {
  // Given
  const root = await mkdtemp(path.join(os.tmpdir(), "cardnews-jobs-record-link-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "cardnews-jobs-record-link-outside-"));
  context.after(async () => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true })
  ]));
  const job = await jobs.createJob({ root, slug: "record-link", seed: { safe: true } });
  const digest = await jobs.commitStage(job, { stage: "source", value: { version: 1 } });
  const recordPath = path.join(job.path, "records", `${digest}.json`);
  const outsideRecord = path.join(outside, "source.json");
  await writeFile(outsideRecord, await readFile(recordPath));
  await rm(recordPath);
  await symlink(outsideRecord, recordPath);
  const before = (await readdir(root)).sort();

  // When
  const force = jobs.forceCommitStage(job, { stage: "source", value: { version: 2 } });

  // Then
  await assert.rejects(force, (error) => error.code === "SYMLINK_ESCAPE");
  assert.deepEqual((await readdir(root)).sort(), before);
  assert.equal((await readdir(job.path)).some((file) => file.includes(".lock")), false);
});
