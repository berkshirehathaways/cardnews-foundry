import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { JobError } from "#jobs/errors";
import type { JobHandle } from "#jobs/types";

export const DEFAULT_JOB_ROOT = ".cardnews/jobs";

const deviceName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;

const validateRelative = (relativePath: string): readonly string[] => {
  if (relativePath.length === 0 || path.isAbsolute(relativePath) || /^[a-z]:[\\/]/iu.test(relativePath)) {
    throw new JobError("PATH_ESCAPE", "job path must be non-empty and relative", relativePath);
  }
  const segments = relativePath.split(/[\\/]/u);
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new JobError("PATH_ESCAPE", "job path contains an unsafe segment", relativePath);
  }
  if (segments.some((segment) => deviceName.test(segment))) {
    throw new JobError("DEVICE_PATH", "device-like job targets are forbidden", relativePath);
  }
  return segments;
};

const within = (root: string, candidate: string): boolean =>
  candidate === root || candidate.startsWith(`${root}${path.sep}`);

export const prepareRoot = async (root: string): Promise<string> => {
  await mkdir(root, { recursive: true });
  return realpath(root);
};

export const resolveConfinedPath = async (root: string, relativePath: string): Promise<string> => {
  const segments = validateRelative(relativePath);
  const realRoot = await realpath(root);
  let parent = realRoot;
  for (const segment of segments.slice(0, -1)) {
    const candidate = path.join(parent, segment);
    try {
      parent = await realpath(candidate);
    } catch (error) {
      if (!(errorCode(error) === "ENOENT")) throw error;
      parent = candidate;
    }
    if (!within(realRoot, path.resolve(parent))) {
      throw new JobError("SYMLINK_ESCAPE", "job path resolves outside its root", relativePath);
    }
  }
  const resolved = path.resolve(parent, segments.at(-1) ?? "");
  if (!within(realRoot, resolved)) {
    throw new JobError("PATH_ESCAPE", "job path resolves outside its root", relativePath);
  }
  try {
    const stats = await lstat(resolved);
    if (stats.isSymbolicLink()) {
      throw new JobError("SYMLINK_ESCAPE", "job target must not be a symbolic link", relativePath);
    }
    if (!stats.isFile() && !stats.isDirectory()) {
      throw new JobError("NON_REGULAR_PATH", "job target must be a regular file or directory", relativePath);
    }
    const realTarget = await realpath(resolved);
    if (!within(realRoot, realTarget)) {
      throw new JobError("SYMLINK_ESCAPE", "job target resolves outside its root", relativePath);
    }
  } catch (error) {
    if (error instanceof JobError || errorCode(error) !== "ENOENT") throw error;
  }
  return resolved;
};

export const resolveJobTarget = async (job: JobHandle, relativePath: string): Promise<string> => {
  const expectedJobPath = await resolveConfinedPath(job.root, job.id);
  if (path.resolve(job.path) !== expectedJobPath) {
    throw new JobError("PATH_ESCAPE", "job handle path does not match its confined identifier", job.path);
  }
  return resolveConfinedPath(job.root, path.join(job.id, relativePath));
};

const errorCode = (error: unknown): unknown =>
  error instanceof Error && "code" in error ? error.code : undefined;

export const safeSlug = (slug: string): string => {
  const normalized = slug.trim().toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-").replaceAll(/^-|-$/gu, "");
  if (normalized.length === 0 || deviceName.test(normalized)) {
    throw new JobError("INVALID_JOB_SLUG", "job slug has no safe path representation", slug);
  }
  return normalized.slice(0, 64);
};
