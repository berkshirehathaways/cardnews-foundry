import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  canonicalJson,
  canonicalSha256
} from "../contracts/index.ts";
import {
  createJob,
  createJobRevision,
  type JobHandle
} from "../jobs/index.ts";
import { JobError } from "../jobs/index.ts";
import { createAnchoredExclusive } from "#jobs/anchored";
import { ingestLocal, ingestUrl } from "../ingest/index.ts";
import type { ParsedArgs } from "./args.ts";
import { booleanOption, optionalString, requiredString } from "./args.ts";
import { CliError } from "./errors.ts";
import {
  displayPath,
  ensureJobDirectories,
  openJob,
  readJobMetadata,
  repositoryRoot,
  writeJobMetadata,
  type JobMetadata
} from "./job.ts";
import { commitRecordValue } from "./records.ts";
import { cliStatus } from "./status.ts";

type TargetProfile = {
  readonly targetId: string;
  readonly cardCount: { readonly minimum: number; readonly maximum: number };
};

const targetProfile = async (targetId: string): Promise<TargetProfile> => {
  if (!/^[a-z][a-z0-9-]{0,63}$/u.test(targetId)) {
    throw new CliError("usage", "TARGET_INVALID", "target identifier is invalid");
  }
  const value: unknown = JSON.parse(
    await readFile(path.join(repositoryRoot, "targets", `${targetId}.json`), "utf8")
      .catch((error: unknown) => {
        if (error instanceof Error && Reflect.get(error, "code") === "ENOENT") {
          throw new CliError("usage", "TARGET_NOT_FOUND", "target profile does not exist");
        }
        throw error;
      })
  );
  if (
    typeof value !== "object" || value === null ||
    !("targetId" in value) || value.targetId !== targetId ||
    !("cardCount" in value) || typeof value.cardCount !== "object" || value.cardCount === null ||
    !("minimum" in value.cardCount) || typeof value.cardCount.minimum !== "number" ||
    !("maximum" in value.cardCount) || typeof value.cardCount.maximum !== "number"
  ) {
    throw new CliError("usage", "TARGET_INVALID", "target profile is invalid");
  }
  return {
    targetId,
    cardCount: { minimum: value.cardCount.minimum, maximum: value.cardCount.maximum }
  };
};

const requestedCardCount = (args: ParsedArgs, profile: TargetProfile): number => {
  const raw = optionalString(args, "cards");
  const count = raw === undefined ? 7 : Number(raw);
  if (
    !Number.isSafeInteger(count) ||
    count < profile.cardCount.minimum ||
    count > profile.cardCount.maximum
  ) {
    throw new CliError("usage", "CARD_COUNT_INVALID", "card count is outside the target range");
  }
  return count;
};

const metadataFor = (
  slug: string,
  target: string,
  cardCount: number,
  revision: number
): JobMetadata => ({ schemaVersion: 1, slug, target, cardCount, revision });

export const initCommand = async (args: ParsedArgs): Promise<unknown> => {
  const slug = requiredString(args, "slug");
  const target = requiredString(args, "target");
  const profile = await targetProfile(target);
  const cardCount = requestedCardCount(args, profile);
  const seed = { slug, target, cardCount };
  let job: JobHandle;
  try {
    job = await createJob({ slug, seed });
  } catch (error) {
    if (!(error instanceof JobError) || error.code !== "JOB_EXISTS" || !booleanOption(args, "force")) {
      throw error;
    }
    const id = typeof error.details === "string" ? error.details : "";
    const original = await openJob(path.join(".cardnews", "jobs", id));
    job = await createJobRevision(original);
  }
  await ensureJobDirectories(job);
  await writeJobMetadata(job, metadataFor(job.slug, target, cardCount, job.revision));
  return {
    jobId: job.id,
    jobPath: displayPath(job.path),
    revision: job.revision,
    target: profile.targetId,
    cardCount
  };
};

const storeSourceEvidence = async (
  job: JobHandle,
  bytes: Uint8Array,
  source: unknown
): Promise<void> => {
  const digest = createSourceDigest(source);
  const rawRelative = `source/raw/${digest}.bin`;
  const rawCreated = await createAnchoredExclusive(job, "source/raw", `${digest}.bin`, bytes, 0o400);
  const envelopeCreated = await createAnchoredExclusive(
    job,
    "source/extracted",
    "source-envelope.json",
    new TextEncoder().encode(canonicalJson(source)),
    0o400
  );
  const evidenceCreated = await createAnchoredExclusive(
    job,
    "source",
    "evidence.json",
    new TextEncoder().encode(canonicalJson({ schemaVersion: 1, rawPath: rawRelative })),
    0o400
  );
  if (!rawCreated || !envelopeCreated || !evidenceCreated) {
    throw new CliError("security", "SOURCE_EVIDENCE_EXISTS", "source evidence already exists");
  }
};

const createSourceDigest = (source: unknown): string => {
  if (
    typeof source !== "object" || source === null ||
    !("provenance" in source) || typeof source.provenance !== "object" || source.provenance === null ||
    !("rawSha256" in source.provenance) || typeof source.provenance.rawSha256 !== "string"
  ) {
    throw new CliError("internal", "SOURCE_RESULT_INVALID", "source result is invalid");
  }
  return source.provenance.rawSha256;
};

const prepareRevisionMetadata = async (original: JobHandle, revision: JobHandle): Promise<void> => {
  const metadata = await readJobMetadata(original);
  await ensureJobDirectories(revision);
  await writeJobMetadata(revision, { ...metadata, revision: revision.revision });
};

export const ingestCommand = async (args: ParsedArgs): Promise<unknown> => {
  const job = await openJob(requiredString(args, "job"));
  const url = optionalString(args, "url");
  const file = optionalString(args, "file");
  if ((url === undefined) === (file === undefined)) {
    throw new CliError("usage", "SOURCE_SELECTION_INVALID", "provide exactly one of --url or --file");
  }
  if (file !== undefined && optionalString(args, "allowed-root") === undefined) {
    throw new CliError("usage", "MISSING_ALLOWED_ROOT", "local ingestion requires --allowed-root");
  }
  let acceptedBytes: Uint8Array | undefined;
  const onAcceptedBytes = async (bytes: Uint8Array): Promise<void> => {
    acceptedBytes = bytes.slice();
  };
  const ingested = url === undefined
    ? await ingestLocal({
        file: file ?? "",
        allowedRoot: requiredString(args, "allowed-root"),
        onAcceptedBytes
      })
    : await ingestUrl(url, { onAcceptedBytes });
  const source = url === undefined
    ? {
        ...ingested,
        provenance: {
          ...ingested.provenance,
          rightsStatus: "user-provided" as const,
          transformations: [...ingested.provenance.transformations, "cli-local-user-provided"]
        }
      }
    : ingested;
  if (acceptedBytes === undefined) {
    throw new CliError("internal", "SOURCE_BYTES_MISSING", "source bytes were not captured");
  }
  const committed = await commitRecordValue(job, "source", source, booleanOption(args, "force"));
  if (committed.job.id !== job.id) await prepareRevisionMetadata(job, committed.job);
  await storeSourceEvidence(committed.job, acceptedBytes, source);
  return {
    jobId: committed.job.id,
    jobPath: displayPath(committed.job.path),
    revision: committed.job.revision,
    recordPath: displayPath(path.join(committed.job.path, "records", `${committed.recordDigest}.json`)),
    recordDigest: committed.recordDigest,
    contractDigest: canonicalSha256(source)
  };
};

export const statusCommand = async (args: ParsedArgs): Promise<unknown> =>
  cliStatus(await openJob(requiredString(args, "job")));

export const resumeCommand = statusCommand;

export const validateCommand = async (args: ParsedArgs): Promise<unknown> => {
  const job = await openJob(requiredString(args, "job"));
  const status = await cliStatus(job);
  const requested = optionalString(args, "stage");
  const selected = requested === undefined
    ? status.stages
    : status.stages.filter((stage) => stage.stage === requested);
  if (selected.length === 0) throw new CliError("usage", "INVALID_STAGE", "validation stage is invalid");
  const valid = selected.every((stage) => stage.state === "valid");
  if (!valid) throw new CliError("usage", "VALIDATION_FAILED", "job validation failed");
  return { valid, stages: selected };
};
