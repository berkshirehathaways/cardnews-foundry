import { randomUUID } from "node:crypto";
import path from "node:path";
import { canonicalJson } from "#contracts";
import {
  createAnchoredExclusive,
  readAnchoredText,
  removeAnchored,
  renameRemoveAnchored
} from "#jobs/anchored";
import { errorCode, JobError } from "#jobs/errors";
import type { JobHandle, JobLock } from "#jobs/types";

const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;

type LockRecord = {
  readonly token: string;
  readonly pid: number;
  readonly createdAtMs: number;
};

const parseLock = (text: string): LockRecord | undefined => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  if (!("token" in value) || typeof value.token !== "string") return undefined;
  if (!("pid" in value) || typeof value.pid !== "number" || !Number.isInteger(value.pid)) return undefined;
  if (!("createdAtMs" in value) || typeof value.createdAtMs !== "number") return undefined;
  return { token: value.token, pid: value.pid, createdAtMs: value.createdAtMs };
};

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && errorCode(error) === "ESRCH") return false;
    if (error instanceof Error && errorCode(error) === "EPERM") return true;
    throw error;
  }
};

export type LockOptions = {
  readonly staleAfterMs?: number;
  readonly nowMs?: number;
};

export const acquireJobLock = async (job: JobHandle, options: LockOptions = {}): Promise<JobLock> => {
  const lockName = ".write.lock";
  const lockPath = path.join(job.path, lockName);
  const nowMs = options.nowMs ?? Date.now();
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const record = { token: randomUUID(), pid: process.pid, createdAtMs: nowMs };
  const bytes = new TextEncoder().encode(canonicalJson(record));
  if (!(await createAnchoredExclusive(job, "job", lockName, bytes))) {
    let existing: LockRecord | undefined;
    try {
      existing = parseLock(await readAnchoredText(job, "job", lockName));
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
    const stale = existing !== undefined
      && nowMs - existing.createdAtMs > staleAfterMs
      && !processIsAlive(existing.pid);
    if (!stale) throw new JobError("JOB_LOCKED", "another writer owns the job lock");
    const staleName = `.write.lock.stale.${record.token}`;
    try {
      await renameRemoveAnchored(job, lockName, staleName);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
    if (!(await createAnchoredExclusive(job, "job", lockName, bytes))) {
      throw new JobError("JOB_LOCKED", "another writer won stale-lock recovery");
    }
  }
  return {
    token: record.token,
    path: lockPath,
    release: async () => {
      let current: LockRecord | undefined;
      try {
        current = parseLock(await readAnchoredText(job, "job", lockName));
      } catch (error) {
        if (errorCode(error) === "ENOENT") return;
        throw error;
      }
      if (current?.token !== record.token) {
        throw new JobError("LOCK_OWNERSHIP_LOST", "refusing to remove a lock owned by another writer");
      }
      await removeAnchored(job, "job", lockName);
    }
  };
};
