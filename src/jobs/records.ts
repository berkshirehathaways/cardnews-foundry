import { readFile } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, canonicalSha256 } from "#contracts";
import { JobError } from "#jobs/errors";
import { JOB_STAGES, type StageName, type StageRecord } from "#jobs/types";

export const STAGE_DEPENDENCIES: Readonly<Record<StageName, readonly StageName[]>> = {
  source: [],
  brief: ["source"],
  storyboard: ["brief"],
  recipe: ["storyboard"],
  render: ["recipe"],
  evaluate: ["render"],
  package: ["evaluate"]
};

export const isStageName = (value: unknown): value is StageName =>
  typeof value === "string" && JOB_STAGES.some((stage) => stage === value);

const parseDependencies = (value: unknown): Readonly<Record<string, string>> | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const dependencies: Record<string, string> = {};
  for (const [key, digest] of Object.entries(value)) {
    if (typeof digest !== "string") return undefined;
    dependencies[key] = digest;
  }
  return dependencies;
};

export const parseRecord = (text: string): StageRecord => {
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new JobError("MALFORMED_RECORD", "stage record must be an object");
  }
  if (!("schemaVersion" in value) || value.schemaVersion !== 1) {
    throw new JobError("MALFORMED_RECORD", "unsupported stage record version");
  }
  if (!("stage" in value) || !isStageName(value.stage) || !("value" in value) || !("dependencies" in value)) {
    throw new JobError("MALFORMED_RECORD", "stage record fields are invalid");
  }
  const dependencies = parseDependencies(value.dependencies);
  if (dependencies === undefined) throw new JobError("MALFORMED_RECORD", "stage dependencies are invalid");
  const expectedDependencies = STAGE_DEPENDENCIES[value.stage];
  const dependencyNames = Object.keys(dependencies);
  if (dependencyNames.length !== expectedDependencies.length
    || expectedDependencies.some((dependency) => !(dependency in dependencies))) {
    throw new JobError("MALFORMED_RECORD", "stage dependency graph is invalid");
  }
  return { schemaVersion: 1, stage: value.stage, value: value.value, dependencies };
};

export const recordDigest = (record: StageRecord): string => canonicalSha256(record);
export const recordBytes = (record: StageRecord): Uint8Array => new TextEncoder().encode(canonicalJson(record));
export const recordPath = (jobPath: string, digest: string): string =>
  path.join(jobPath, "records", `${digest}.json`);
export const parseCanonicalRecord = (text: string): StageRecord => {
  const record = parseRecord(text);
  if (text !== canonicalJson(record)) {
    throw new JobError("NON_CANONICAL_RECORD", "stage record bytes are not canonical");
  }
  return record;
};
export const readRecord = async (jobPath: string, digest: string): Promise<StageRecord> =>
  parseCanonicalRecord(await readFile(recordPath(jobPath, digest), "utf8"));
