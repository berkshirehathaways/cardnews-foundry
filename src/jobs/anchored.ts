import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JobError } from "#jobs/errors";
import { resolveJobTarget } from "#jobs/paths";
import type { AtomicWriteOptions } from "#jobs/atomic";
import type { JobHandle } from "#jobs/types";

export type AnchoredDirectory =
  | "job"
  | "records"
  | "drafts"
  | "source"
  | "source/raw"
  | "source/extracted"
  | "reports"
  | "assets"
  | `assets/${string}`;
type Operation =
  | "read"
  | "list"
  | "create-exclusive"
  | "atomic-write"
  | "remove"
  | "mkdir"
  | "rename-remove";

type WorkerError = {
  readonly code?: unknown;
  readonly message?: unknown;
  readonly details?: unknown;
};

const workerPath = fileURLToPath(new URL("./anchored-worker.mjs", import.meta.url));

const run = async (
  job: JobHandle,
  scope: AnchoredDirectory,
  operation: Operation,
  name = "",
  input?: Uint8Array,
  options: Readonly<Record<string, unknown>> = {}
): Promise<Uint8Array> => {
  const directory = scope === "job" ? "" : scope;
  const relativeTarget = path.join(directory, name.length === 0 ? ".probe" : name);
  await resolveJobTarget(job, relativeTarget);
  const cwd = scope === "job" ? job.path : path.join(job.path, ...scope.split("/"));
  const result = spawnSync(
    process.execPath,
    [workerPath, job.id, scope, operation, name, JSON.stringify(options)],
    input === undefined ? {
      cwd,
      maxBuffer: 128 * 1024 * 1024
    } : {
      cwd,
      input,
      maxBuffer: 128 * 1024 * 1024
    }
  );
  if (result.error !== undefined) throw result.error;
  if (result.status === 0) return result.stdout;
  let parsed: WorkerError = {};
  try {
    parsed = JSON.parse(new TextDecoder().decode(result.stderr)) as WorkerError;
  } catch {}
  const code = typeof parsed.code === "string" ? parsed.code : "ANCHORED_IO_FAILED";
  const message = typeof parsed.message === "string"
    ? parsed.message
    : `anchored filesystem worker exited with status ${String(result.status)}`;
  throw new JobError(code, message, parsed.details);
};

export const readAnchoredText = async (
  job: JobHandle,
  scope: AnchoredDirectory,
  name: string
): Promise<string> => new TextDecoder().decode(await run(job, scope, "read", name));

export const readAnchoredBytes = async (
  job: JobHandle,
  scope: AnchoredDirectory,
  name: string
): Promise<Uint8Array> => run(job, scope, "read", name);

export const listAnchored = async (job: JobHandle, scope: AnchoredDirectory): Promise<readonly string[]> =>
  JSON.parse(new TextDecoder().decode(await run(job, scope, "list"))) as string[];

export const createAnchoredExclusive = async (
  job: JobHandle,
  scope: AnchoredDirectory,
  name: string,
  bytes: Uint8Array,
  mode = 0o600
): Promise<boolean> =>
  new TextDecoder().decode(
    await run(job, scope, "create-exclusive", name, bytes, { mode })
  ) === "created";

export const atomicWriteAnchored = async (
  job: JobHandle,
  scope: AnchoredDirectory,
  name: string,
  bytes: Uint8Array,
  options: AtomicWriteOptions = {}
): Promise<void> => {
  await run(job, scope, "atomic-write", name, bytes, options);
};

export const removeAnchored = async (
  job: JobHandle,
  scope: AnchoredDirectory,
  name: string,
  force = false
): Promise<void> => {
  await run(job, scope, "remove", name, undefined, { force });
};

export const mkdirAnchored = async (
  job: JobHandle,
  parent: AnchoredDirectory,
  name: string
): Promise<void> => {
  await run(job, parent, "mkdir", name);
};

export const renameRemoveAnchored = async (
  job: JobHandle,
  name: string,
  temporary: string
): Promise<void> => {
  await run(job, "job", "rename-remove", name, undefined, { temporary });
};
