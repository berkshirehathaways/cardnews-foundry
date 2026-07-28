import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalJson } from "../contracts/index.ts";
import type { JobHandle } from "../jobs/index.ts";
import { JobError } from "../jobs/index.ts";
import { readAnchoredText } from "#jobs/anchored";
import { parseHead } from "#jobs/head";
import { resolveConfinedPath } from "#jobs/paths";
import { CliError } from "./errors.ts";

export type JobMetadata = {
  readonly schemaVersion: 1;
  readonly slug: string;
  readonly target: string;
  readonly cardCount: number;
  readonly revision: number;
};

export const repositoryRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  ".."
);

export const displayPath = (target: string): string => {
  const relative = path.relative(process.cwd(), target);
  if (relative.length === 0) return ".";
  return relative.startsWith("..") || path.isAbsolute(relative)
    ? path.basename(target)
    : relative.split(path.sep).join("/");
};

export const openJob = async (jobArgument: string): Promise<JobHandle> => {
  const requested = path.resolve(process.cwd(), jobArgument);
  const resolved = await realpath(requested).catch((error: unknown) => {
    if (error instanceof Error && Reflect.get(error, "code") === "ENOENT") {
      throw new CliError("usage", "JOB_NOT_FOUND", "job does not exist");
    }
    throw error;
  });
  const root = path.dirname(resolved);
  const id = path.basename(resolved);
  const confined = await resolveConfinedPath(root, id);
  if (confined !== resolved) throw new JobError("PATH_ESCAPE", "job path is not confined");
  const candidate: JobHandle = { root, path: resolved, id, slug: id, revision: 0 };
  const head = parseHead(await readAnchoredText(candidate, "job", "head.json"));
  if (head.jobId !== id) throw new JobError("MALFORMED_HEAD", "job identifier does not match its path");
  return {
    root,
    path: resolved,
    id,
    slug: head.slug,
    revision: head.revision
  };
};

export const writeJobMetadata = async (job: JobHandle, metadata: JobMetadata): Promise<void> => {
  await writeFile(path.join(job.path, "job.json"), canonicalJson(metadata), {
    encoding: "utf8",
    flag: "wx",
    mode: 0o444
  });
};

export const readJobMetadata = async (job: JobHandle): Promise<JobMetadata> => {
  const value: unknown = JSON.parse(await readFile(path.join(job.path, "job.json"), "utf8"));
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    !("schemaVersion" in value) || value.schemaVersion !== 1 ||
    !("slug" in value) || typeof value.slug !== "string" ||
    !("target" in value) || typeof value.target !== "string" ||
    !("cardCount" in value) || typeof value.cardCount !== "number" ||
    !("revision" in value) || typeof value.revision !== "number"
  ) {
    throw new CliError("usage", "JOB_METADATA_INVALID", "job metadata is invalid");
  }
  return {
    schemaVersion: 1,
    slug: value.slug,
    target: value.target,
    cardCount: value.cardCount,
    revision: value.revision
  };
};

export const ensureJobDirectories = async (job: JobHandle): Promise<void> => {
  for (const name of ["drafts", "source/raw", "source/extracted", "assets", "render", "reports", "package"]) {
    await mkdir(path.join(job.path, name), { recursive: true });
  }
};
