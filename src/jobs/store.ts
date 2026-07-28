import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { canonicalSha256 } from "#contracts";
import {
  atomicWriteAnchored,
  listAnchored,
  readAnchoredText,
  removeAnchored
} from "#jobs/anchored";
import { atomicWrite, type AtomicWriteOptions } from "#jobs/atomic";
import { errorCode, JobError } from "#jobs/errors";
import { headBytes, headPath, parseHead } from "#jobs/head";
import { acquireJobLock } from "#jobs/lock";
import { DEFAULT_JOB_ROOT, prepareRoot, resolveJobTarget, safeSlug } from "#jobs/paths";
import { parseCanonicalRecord, recordBytes, recordDigest, STAGE_DEPENDENCIES } from "#jobs/records";
import type { JobHandle, JobHead, StageName, StageRecord } from "#jobs/types";

export type CreateJobInput = {
  readonly root?: string;
  readonly slug: string;
  readonly seed: unknown;
};

export type CommitStageInput = AtomicWriteOptions & {
  readonly stage: StageName;
  readonly value: unknown;
};

const makeHandle = (root: string, head: JobHead): JobHandle => ({
  root,
  path: path.join(root, head.jobId),
  id: head.jobId,
  slug: head.slug,
  revision: head.revision
});

export const createJob = async (input: CreateJobInput): Promise<JobHandle> => {
  const root = await prepareRoot(input.root ?? path.resolve(DEFAULT_JOB_ROOT));
  const slug = safeSlug(input.slug);
  const id = `${slug}-${canonicalSha256(input.seed).slice(0, 12)}`;
  const jobPath = path.join(root, id);
  try {
    await mkdir(jobPath, { recursive: false });
    await mkdir(path.join(jobPath, "records"), { recursive: false });
  } catch (error) {
    if (errorCode(error) === "EEXIST") {
      throw new JobError("JOB_EXISTS", "job already exists", id);
    }
    throw error;
  }
  const head: JobHead = { schemaVersion: 1, jobId: id, slug, revision: 0, stages: {} };
  await atomicWrite(headPath(jobPath), headBytes(head));
  return makeHandle(root, head);
};

const dependenciesFor = (
  stage: StageName,
  stages: Readonly<Partial<Record<StageName, string>>>
): Readonly<Record<string, string>> => {
  const dependencies: Record<string, string> = {};
  for (const dependency of STAGE_DEPENDENCIES[stage]) {
    const digest = stages[dependency];
    if (digest === undefined) {
      throw new JobError("MISSING_DEPENDENCY", `stage ${stage} requires ${dependency}`);
    }
    dependencies[dependency] = digest;
  }
  return dependencies;
};

const commit = async (job: JobHandle, input: CommitStageInput, replacement: boolean): Promise<string> => {
  await resolveJobTarget(job, path.join("records", ".probe"));
  const lock = await acquireJobLock(job);
  try {
    const head = parseHead(await readAnchoredText(job, "job", "head.json"));
    const acceptedDigest = head.stages[input.stage];
    if (acceptedDigest !== undefined && !replacement) {
      let staleRevisionRecord = false;
      if (head.parentJobId !== undefined) {
        try {
          const accepted = parseCanonicalRecord(
            await readAnchoredText(job, "records", `${acceptedDigest}.json`)
          );
          staleRevisionRecord = STAGE_DEPENDENCIES[input.stage].some(
            (dependency) => accepted.dependencies[dependency] !== head.stages[dependency]
          );
        } catch (error) {
          if (error instanceof JobError || error instanceof SyntaxError || errorCode(error) === "ENOENT") {
            staleRevisionRecord = true;
          } else {
            throw error;
          }
        }
      }
      if (!staleRevisionRecord) {
        throw new JobError("STAGE_IMMUTABLE", "accepted stages require a new revision", input.stage);
      }
    }
    const record: StageRecord = {
      schemaVersion: 1,
      stage: input.stage,
      value: input.value,
      dependencies: dependenciesFor(input.stage, head.stages)
    };
    const digest = recordDigest(record);
    const targetName = `${digest}.json`;
    const bytes = recordBytes(record);
    let existing: string | undefined;
    try {
      existing = await readAnchoredText(job, "records", targetName);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
    if (existing !== undefined && existing !== new TextDecoder().decode(bytes)) {
      throw new JobError("DIGEST_COLLISION", "digest address already contains different bytes", digest);
    }
    let recordCreated = false;
    try {
      if (existing === undefined) {
        await atomicWriteAnchored(job, "records", targetName, bytes, {
          boundary: "record-before-rename",
          failpoint: input.failpoint
        });
        recordCreated = true;
      }
      const nextHead: JobHead = { ...head, stages: { ...head.stages, [input.stage]: digest } };
      await atomicWriteAnchored(job, "job", "head.json", headBytes(nextHead), {
        boundary: "head-before-rename",
        failpoint: input.failpoint
      });
    } catch (error) {
      if (recordCreated) await removeAnchored(job, "records", targetName, true);
      throw error;
    }
    return digest;
  } finally {
    await lock.release();
  }
};

export const commitStage = async (job: JobHandle, input: CommitStageInput): Promise<string> =>
  commit(job, input, false);

const cloneRevision = async (
  job: JobHandle,
  failpoint: CommitStageInput["failpoint"]
): Promise<JobHandle> => {
  await resolveJobTarget(job, path.join("records", ".probe"));
  const sourceHead = parseHead(await readAnchoredText(job, "job", "head.json"));
  const files = await listAnchored(job, "records");
  const sourceRecords: { readonly name: string; readonly bytes: Uint8Array }[] = [];
  for (const file of files) {
    sourceRecords.push({
      name: file,
      bytes: new TextEncoder().encode(await readAnchoredText(job, "records", file))
    });
  }
  let revision = sourceHead.revision + 1;
  let revisionHead: JobHead;
  let revisionPath: string;
  while (true) {
    const digest = canonicalSha256({ parentJobId: sourceHead.jobId, revision }).slice(0, 12);
    const id = `${sourceHead.slug}-${digest}`;
    revisionPath = path.join(job.root, id);
    try {
      await mkdir(revisionPath, { recursive: false });
      await mkdir(path.join(revisionPath, "records"), { recursive: false });
      revisionHead = {
        ...sourceHead,
        jobId: id,
        revision,
        parentJobId: sourceHead.jobId,
        stages: { ...sourceHead.stages }
      };
      break;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      revision += 1;
    }
  }
  const revisionJob = makeHandle(job.root, revisionHead);
  try {
    await atomicWrite(
      headPath(revisionPath),
      headBytes({ ...revisionHead, stages: {} })
    );
    for (const source of sourceRecords) {
      await atomicWriteAnchored(revisionJob, "records", source.name, source.bytes);
    }
    await atomicWriteAnchored(revisionJob, "job", "head.json", headBytes(revisionHead), {
      boundary: "revision-head-before-rename",
      failpoint
    });
  } catch (error) {
    await rm(revisionPath, { recursive: true, force: true });
    throw error;
  }
  return revisionJob;
};

export const forceCommitStage = async (
  job: JobHandle,
  input: CommitStageInput
): Promise<{ readonly job: JobHandle; readonly digest: string }> => {
  const lock = await acquireJobLock(job);
  let revision: JobHandle;
  try {
    revision = await cloneRevision(job, input.failpoint);
  } finally {
    await lock.release();
  }
  return { job: revision, digest: await commit(revision, input, true) };
};

export const createJobRevision = async (job: JobHandle): Promise<JobHandle> => {
  const lock = await acquireJobLock(job);
  try {
    return await cloneRevision(job, undefined);
  } finally {
    await lock.release();
  }
};
