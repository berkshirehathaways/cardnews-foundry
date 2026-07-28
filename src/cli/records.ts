import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  canonicalJson,
  canonicalSha256,
  validateContract,
  validateContractChain,
  type ContractName
} from "../contracts/index.ts";
import { commitStage, forceCommitStage, type JobHandle, type StageName } from "../jobs/index.ts";
import {
  createAnchoredExclusive,
  readAnchoredText,
  removeAnchored
} from "#jobs/anchored";
import { parseHead } from "#jobs/head";
import { parseCanonicalRecord } from "#jobs/records";
import { CliError } from "./errors.ts";

export const RECORD_STAGES = [
  "editorial-brief", "storyboard", "visual-recipe", "render-spec"
] as const;

export type RecordStage = (typeof RECORD_STAGES)[number];
export type CliStage = "source" | RecordStage;

type StageDefinition = {
  readonly jobStage: StageName;
  readonly contract: ContractName;
  readonly dependency?: { readonly stage: StageName; readonly field: string };
};

const definitions: Readonly<Record<CliStage, StageDefinition>> = {
  source: { jobStage: "source", contract: "SourceEnvelope" },
  "editorial-brief": {
    jobStage: "brief",
    contract: "EditorialBrief",
    dependency: { stage: "source", field: "sourceEnvelopeDigest" }
  },
  storyboard: {
    jobStage: "storyboard",
    contract: "Storyboard",
    dependency: { stage: "brief", field: "editorialBriefDigest" }
  },
  "visual-recipe": {
    jobStage: "recipe",
    contract: "VisualRecipe",
    dependency: { stage: "storyboard", field: "storyboardDigest" }
  },
  "render-spec": {
    jobStage: "render",
    contract: "RenderSpec",
    dependency: { stage: "recipe", field: "visualRecipeDigest" }
  }
};

export const parseRecordStage = (value: string): RecordStage => {
  const stage = RECORD_STAGES.find((candidate) => candidate === value);
  if (stage === undefined) {
    throw new CliError("usage", "INVALID_RECORD_STAGE", "record stage is invalid");
  }
  return stage;
};

export const parseCliStage = (value: string): CliStage =>
  value === "source" ? value : parseRecordStage(value);

export const definitionFor = (stage: CliStage): StageDefinition => definitions[stage];

export const acceptedValue = async (job: JobHandle, stage: StageName): Promise<unknown> => {
  const head = parseHead(await readAnchoredText(job, "job", "head.json"));
  const digest = head.stages[stage];
  if (digest === undefined) throw new CliError("usage", "MISSING_DEPENDENCY", "required checkpoint is missing");
  return parseCanonicalRecord(await readAnchoredText(job, "records", `${digest}.json`)).value;
};

export const acceptedDigest = async (job: JobHandle, stage: StageName): Promise<string> =>
  canonicalSha256(await acceptedValue(job, stage));

const draftTemplate = async (job: JobHandle, stage: RecordStage): Promise<Readonly<Record<string, unknown>>> => {
  const dependency = definitions[stage].dependency;
  if (dependency === undefined) throw new CliError("internal", "INTERNAL_ERROR", "record mapping is invalid");
  const digest = await acceptedDigest(job, dependency.stage);
  const base = { schemaVersion: "1.0.0", [dependency.field]: digest };
  switch (stage) {
    case "editorial-brief":
      return {
        ...base, briefId: "", audience: "", thesis: "", claims: [],
        exclusions: [], tone: "", cardCountIntent: 0
      };
    case "storyboard":
      return { ...base, storyboardId: "", cards: [] };
    case "visual-recipe":
      return { ...base, recipeId: "", targetId: "", themeId: "", cards: [] };
    case "render-spec":
      return {
        ...base,
        renderSpecId: "",
        target: { id: "", version: "1.0.0" },
        theme: { id: "", version: "1.0.0" },
        dimensions: { width: 0, height: 0 },
        codec: "png",
        cardOrder: [],
        environment: {
          platform: "", browser: "chromium", browserRevision: "",
          locale: "ko-KR", timezone: "Asia/Seoul", deviceScaleFactor: 1
        }
      };
  }
};

export const scaffoldDraft = async (
  job: JobHandle,
  stage: RecordStage
): Promise<{ readonly path: string; readonly value: Readonly<Record<string, unknown>> }> => {
  const target = path.join(job.path, "drafts", `${stage}.json`);
  const value = await draftTemplate(job, stage);
  const created = await createAnchoredExclusive(
    job,
    "drafts",
    `${stage}.json`,
    new TextEncoder().encode(`${canonicalJson(value)}\n`)
  );
  if (!created) throw new CliError("usage", "DRAFT_EXISTS", "draft already exists");
  return { path: target, value };
};

const validateValue = async (job: JobHandle, stage: CliStage, value: unknown): Promise<void> => {
  const definition = definitions[stage];
  const result = validateContract(definition.contract, value);
  if (!result.ok) throw new CliError("usage", "SCHEMA_INVALID", "record schema validation failed");
  const dependency = definition.dependency;
  if (dependency !== undefined) {
    const expected = await acceptedDigest(job, dependency.stage);
    const actual = typeof value === "object" && value !== null ? Reflect.get(value, dependency.field) : undefined;
    if (actual !== expected) throw new CliError("usage", "STALE_DEPENDENCY", "record dependency is stale");
  }
  if (stage === "storyboard") {
    const source = validateContract("SourceEnvelope", await acceptedValue(job, "source"));
    const editorial = validateContract("EditorialBrief", await acceptedValue(job, "brief"));
    const storyboard = validateContract("Storyboard", value);
    if (!source.ok || !editorial.ok || !storyboard.ok) {
      throw new CliError("usage", "SCHEMA_INVALID", "record schema validation failed");
    }
    const issues = validateContractChain({
      SourceEnvelope: source.value,
      EditorialBrief: editorial.value,
      Storyboard: storyboard.value
    });
    if (issues.length !== 0) throw new CliError("usage", "SEMANTIC_INVALID", "record semantic validation failed");
  }
};

export const commitRecordValue = async (
  job: JobHandle,
  stage: CliStage,
  value: unknown,
  force: boolean
): Promise<{ readonly job: JobHandle; readonly recordDigest: string; readonly contractDigest: string }> => {
  await validateValue(job, stage, value);
  const jobStage = definitions[stage].jobStage;
  if (force) {
    const committed = await forceCommitStage(job, { stage: jobStage, value });
    return {
      job: committed.job,
      recordDigest: committed.digest,
      contractDigest: canonicalSha256(value)
    };
  }
  return {
    job,
    recordDigest: await commitStage(job, { stage: jobStage, value }),
    contractDigest: canonicalSha256(value)
  };
};

export const replaceDraftWithReceipt = async (
  job: JobHandle,
  stage: RecordStage,
  recordDigest: string
): Promise<string> => {
  const receiptName = `${stage}.receipt.json`;
  const receipt = path.join(job.path, "drafts", receiptName);
  const created = await createAnchoredExclusive(
    job,
    "drafts",
    receiptName,
    new TextEncoder().encode(canonicalJson({
      schemaVersion: 1,
      stage,
      recordPath: `records/${recordDigest}.json`,
      recordDigest
    })),
    0o444
  );
  if (!created) throw new CliError("usage", "RECEIPT_EXISTS", "record receipt already exists");
  await removeAnchored(job, "drafts", `${stage}.json`);
  return receipt;
};

export const readInputJson = async (inputPath: string): Promise<unknown> =>
  JSON.parse(await readFile(inputPath, "utf8"));
