import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type {
  Contract,
  ContractName,
  EditorialBrief,
  EvaluationReport,
  PackageManifest,
  RenderArtifact,
  RenderSpec,
  SourceEnvelope,
  Storyboard,
  VisualRecipe,
  VisualVerdictRecord
} from "./types.js";

export type {
  Contract,
  ContractMap,
  ContractName,
  EditorialBrief,
  EvaluationReport,
  PackageManifest,
  RenderArtifact,
  RenderSpec,
  SourceEnvelope,
  Storyboard,
  VisualRecipe,
  VisualVerdictRecord
} from "./types.js";

export type ContractIssue = {
  readonly code: string;
  readonly path: string;
  readonly message: string;
};

export class CanonicalJsonError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string, message: string) {
    super(message);
    this.name = "CanonicalJsonError";
    this.code = code;
    this.path = path;
  }
}

export const CURRENT_SCHEMA_VERSION = "1.0.0";
export const SUPPORTED_SCHEMA_MAJOR = 1;
export const CONTRACT_NAMES = [
  "SourceEnvelope", "EditorialBrief", "Storyboard", "VisualRecipe", "RenderSpec",
  "RenderArtifact", "EvaluationReport", "VisualVerdictRecord", "PackageManifest"
] as const satisfies readonly ContractName[];

const schemaFiles: Readonly<Record<ContractName, string>> = {
  SourceEnvelope: "source-envelope.schema.json",
  EditorialBrief: "editorial-brief.schema.json",
  Storyboard: "storyboard.schema.json",
  VisualRecipe: "visual-recipe.schema.json",
  RenderSpec: "render-spec.schema.json",
  RenderArtifact: "render-artifact.schema.json",
  EvaluationReport: "evaluation-report.schema.json",
  VisualVerdictRecord: "visual-verdict-record.schema.json",
  PackageManifest: "package-manifest.schema.json"
};
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const unpairedSurrogate = /(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF]))|(?:(?<![\uD800-\uDBFF])[\uDC00-\uDFFF])/u;

export type VersionSupport =
  | { readonly ok: true; readonly version: string; readonly forwardMinor: boolean }
  | { readonly ok: false; readonly issues: readonly ContractIssue[] };

export const checkSchemaVersion = (value: unknown): VersionSupport => {
  if (typeof value !== "string") {
    return { ok: false, issues: [{ code: "SCHEMA_VERSION_TYPE", path: "/schemaVersion", message: "must be a string" }] };
  }
  const match = versionPattern.exec(value);
  const majorText = match?.[1];
  const minorText = match?.[2];
  if (majorText === undefined || minorText === undefined) {
    return { ok: false, issues: [{ code: "SCHEMA_VERSION_FORMAT", path: "/schemaVersion", message: "must be major.minor.patch" }] };
  }
  const major = Number.parseInt(majorText, 10);
  if (major !== SUPPORTED_SCHEMA_MAJOR) {
    return {
      ok: false,
      issues: [{ code: "UNSUPPORTED_SCHEMA_MAJOR", path: "/schemaVersion", message: "supported schema major is 1" }]
    };
  }
  return { ok: true, version: value, forwardMinor: Number.parseInt(minorText, 10) > 0 };
};

const primitiveJson = (value: string | number): string => {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new CanonicalJsonError("UNSUPPORTED_JSON_VALUE", "$", "value is not JSON");
  }
  return serialized;
};

const canonicalValue = (value: unknown, location: string, ancestors: WeakSet<object>): string => {
  if (value === null) return "null";
  if (typeof value === "string") {
    if (unpairedSurrogate.test(value)) {
      throw new CanonicalJsonError("UNPAIRED_SURROGATE", location, "string is not valid Unicode");
    }
    return primitiveJson(value.replace(/\r\n?/gu, "\n"));
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new CanonicalJsonError("NON_FINITE_NUMBER", location, "numbers must be finite");
    }
    return primitiveJson(value);
  }
  if (typeof value !== "object") {
    throw new CanonicalJsonError("UNSUPPORTED_JSON_VALUE", location, `unsupported type: ${typeof value}`);
  }
  if (ancestors.has(value)) throw new CanonicalJsonError("CYCLIC_VALUE", location, "cycles are not JSON");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new CanonicalJsonError("SPARSE_ARRAY", `${location}[${index}]`, "array holes are not JSON");
      }
      return `[${value.map((item, index) => canonicalValue(item, `${location}[${index}]`, ancestors)).join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new CanonicalJsonError("UNSAFE_PROTOTYPE", location, "object prototype is not JSON-safe");
    }
    if (Object.getOwnPropertySymbols(value).length !== 0) {
      throw new CanonicalJsonError("SYMBOL_KEY", location, "symbol keys are not JSON");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const members = Object.keys(descriptors).sort().map((key) => {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
        throw new CanonicalJsonError("UNSAFE_PROPERTY", `${location}.${key}`, "property is not JSON-safe");
      }
      return `${primitiveJson(key)}:${canonicalValue(descriptor.value, `${location}.${key}`, ancestors)}`;
    });
    return `{${members.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
};

export const canonicalJson = (value: unknown): string => canonicalValue(value, "$", new WeakSet());
export const canonicalJsonBytes = (value: unknown): Uint8Array => new TextEncoder().encode(canonicalJson(value));
export const canonicalSha256 = (value: unknown): string =>
  createHash("sha256").update(canonicalJsonBytes(value)).digest("hex");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const compile = <T>(name: ContractName): ValidateFunction<T> => {
  const parsed: unknown = JSON.parse(readFileSync(new URL(`../../schemas/${schemaFiles[name]}`, import.meta.url), "utf8"));
  if (!isRecord(parsed)) throw new TypeError(`schema is not an object: ${name}`);
  return new Ajv2020({ allErrors: true, strict: true }).compile<T>(parsed);
};

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T; readonly forwardMinor: boolean }
  | { readonly ok: false; readonly issues: readonly ContractIssue[] };
const schemaIssues = (errors: readonly ErrorObject[] | null | undefined): readonly ContractIssue[] =>
  (errors ?? []).map((error) => ({
    code: `SCHEMA_${error.keyword.toUpperCase()}`,
    path: error.instancePath,
    message: error.message ?? "schema validation failed"
  }));
const validateWith = <T>(validator: ValidateFunction<T>, data: unknown): ValidationResult<T> => {
  const version = checkSchemaVersion(isRecord(data) ? data["schemaVersion"] : undefined);
  if (!version.ok) return version;
  if (!validator(data)) return { ok: false, issues: schemaIssues(validator.errors) };
  return { ok: true, value: data, forwardMinor: version.forwardMinor };
};

const duplicateIdIssues = (ids: readonly string[], collectionPath: string, code: string): ContractIssue[] => {
  const seen = new Set<string>();
  return ids.flatMap((id, index) => {
    if (seen.has(id)) return [{ code, path: `${collectionPath}/${index}`, message: id }];
    seen.add(id);
    return [];
  });
};
const duplicateEntityIdIssues = (entries: readonly { readonly id: string }[], collectionPath: string, code: string) =>
  duplicateIdIssues(entries.map((entry) => entry.id), collectionPath, code).map((issue) => ({ ...issue, path: `${issue.path}/id` }));
const sourceEnvelopeIssues = (source: SourceEnvelope): ContractIssue[] => {
  const spanIds = source.spans.map((span) => span.id);
  const extractedSpanIds = source.provenance.extractedSpanIds;
  const knownSpanIds = new Set(spanIds);
  return [
    ...duplicateEntityIdIssues(source.spans, "/spans", "DUPLICATE_SOURCE_SPAN_ID"),
    ...duplicateIdIssues(extractedSpanIds, "/provenance/extractedSpanIds", "DUPLICATE_EXTRACTED_SOURCE_SPAN_ID"),
    ...extractedSpanIds.flatMap((spanId, index) => knownSpanIds.has(spanId) ? [] : [{ code: "UNKNOWN_PROVENANCE_SOURCE_SPAN", path: `/provenance/extractedSpanIds/${index}`, message: spanId }])
  ];
};
const editorialBriefIssues = (brief: EditorialBrief): ContractIssue[] =>
  duplicateEntityIdIssues(brief.claims, "/claims", "DUPLICATE_CLAIM_ID");
const storyboardIssues = (storyboard: Storyboard): ContractIssue[] =>
  duplicateEntityIdIssues(storyboard.cards, "/cards", "DUPLICATE_CARD_ID");
const validateWithSemanticIssues = <T>(validator: ValidateFunction<T>, data: unknown, semanticIssues: (value: T) => readonly ContractIssue[]): ValidationResult<T> => {
  const result = validateWith(validator, data);
  if (!result.ok) return result;
  const issues = semanticIssues(result.value);
  return issues.length === 0 ? result : { ok: false, issues };
};

export function validateContract(name: "SourceEnvelope", data: unknown): ValidationResult<SourceEnvelope>;
export function validateContract(name: "EditorialBrief", data: unknown): ValidationResult<EditorialBrief>;
export function validateContract(name: "Storyboard", data: unknown): ValidationResult<Storyboard>;
export function validateContract(name: "VisualRecipe", data: unknown): ValidationResult<VisualRecipe>;
export function validateContract(name: "RenderSpec", data: unknown): ValidationResult<RenderSpec>;
export function validateContract(name: "RenderArtifact", data: unknown): ValidationResult<RenderArtifact>;
export function validateContract(name: "EvaluationReport", data: unknown): ValidationResult<EvaluationReport>;
export function validateContract(name: "VisualVerdictRecord", data: unknown): ValidationResult<VisualVerdictRecord>;
export function validateContract(name: "PackageManifest", data: unknown): ValidationResult<PackageManifest>;
export function validateContract(name: ContractName, data: unknown): ValidationResult<Contract>;
export function validateContract(name: ContractName, data: unknown): ValidationResult<Contract> {
  switch (name) {
    case "SourceEnvelope": return validateWithSemanticIssues(compile<SourceEnvelope>(name), data, sourceEnvelopeIssues);
    case "EditorialBrief": return validateWithSemanticIssues(compile<EditorialBrief>(name), data, editorialBriefIssues);
    case "Storyboard": return validateWithSemanticIssues(compile<Storyboard>(name), data, storyboardIssues);
    case "VisualRecipe": return validateWith(compile<VisualRecipe>(name), data);
    case "RenderSpec": return validateWith(compile<RenderSpec>(name), data);
    case "RenderArtifact": return validateWith(compile<RenderArtifact>(name), data);
    case "EvaluationReport": return validateWith(compile<EvaluationReport>(name), data);
    case "VisualVerdictRecord": return validateWith(compile<VisualVerdictRecord>(name), data);
    case "PackageManifest": return validateWith(compile<PackageManifest>(name), data);
  }
}

export type ContractChain = {
  readonly SourceEnvelope: SourceEnvelope;
  readonly EditorialBrief: EditorialBrief;
  readonly Storyboard: Storyboard;
};
export const validateContractChain = (chain: ContractChain): readonly ContractIssue[] => {
  const spans = new Set(chain.SourceEnvelope.spans.map((span) => span.id));
  const claims = new Set(chain.EditorialBrief.claims.map((claim) => claim.id));
  const issues: ContractIssue[] = [
    ...sourceEnvelopeIssues(chain.SourceEnvelope),
    ...editorialBriefIssues(chain.EditorialBrief),
    ...storyboardIssues(chain.Storyboard)
  ];
  for (const claim of chain.EditorialBrief.claims) {
    for (const span of claim.sourceSpanIds) {
      if (!spans.has(span)) issues.push({ code: "UNKNOWN_SOURCE_SPAN", path: `/claims/${claim.id}`, message: span });
    }
  }
  for (const card of chain.Storyboard.cards) {
    for (const claim of card.claimIds) {
      if (!claims.has(claim)) issues.push({ code: "UNKNOWN_CLAIM", path: `/cards/${card.id}`, message: claim });
    }
    for (const span of card.sourceSpanIds) {
      if (!spans.has(span)) issues.push({ code: "UNKNOWN_SOURCE_SPAN", path: `/cards/${card.id}`, message: span });
    }
  }
  return issues;
};
