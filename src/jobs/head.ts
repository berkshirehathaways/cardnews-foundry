import { readFile } from "node:fs/promises";
import path from "node:path";
import { canonicalJson } from "#contracts";
import { JobError } from "#jobs/errors";
import { isStageName } from "#jobs/records";
import type { JobHead, StageName } from "#jobs/types";

export const headPath = (jobPath: string): string => path.join(jobPath, "head.json");
export const headBytes = (head: JobHead): Uint8Array => new TextEncoder().encode(canonicalJson(head));

export const parseHead = (text: string): JobHead => {
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new JobError("MALFORMED_HEAD", "job head must be an object");
  }
  if (!("schemaVersion" in value) || value.schemaVersion !== 1
    || !("jobId" in value) || typeof value.jobId !== "string"
    || !("slug" in value) || typeof value.slug !== "string"
    || !("revision" in value) || typeof value.revision !== "number" || !Number.isInteger(value.revision)
    || !("stages" in value) || typeof value.stages !== "object" || value.stages === null || Array.isArray(value.stages)) {
    throw new JobError("MALFORMED_HEAD", "job head fields are invalid");
  }
  const stages: Partial<Record<StageName, string>> = {};
  for (const [stage, digest] of Object.entries(value.stages)) {
    if (!isStageName(stage) || typeof digest !== "string") {
      throw new JobError("MALFORMED_HEAD", "job head stage is invalid", stage);
    }
    stages[stage] = digest;
  }
  const head: JobHead = {
    schemaVersion: 1,
    jobId: value.jobId,
    slug: value.slug,
    revision: value.revision,
    stages
  };
  if (!("parentJobId" in value)) return head;
  if (typeof value.parentJobId !== "string") {
    throw new JobError("MALFORMED_HEAD", "job parent identifier is invalid");
  }
  return { ...head, parentJobId: value.parentJobId };
};

export const readHead = async (jobPath: string): Promise<JobHead> =>
  parseHead(await readFile(headPath(jobPath), "utf8"));
