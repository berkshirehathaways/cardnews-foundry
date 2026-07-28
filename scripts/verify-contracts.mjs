import { Ajv2020 } from "ajv/dist/2020.js";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CanonicalJsonError,
  canonicalJson,
  canonicalSha256,
  validateContract,
  validateContractChain
} from "../src/contracts/index.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureFlag = process.argv.indexOf("--fixtures");
const fixtureDirectory = fixtureFlag === -1
  ? path.join(root, "test", "contracts", "fixtures")
  : path.resolve(process.argv[fixtureFlag + 1] ?? "");
const schemaFlag = process.argv.indexOf("--schemas");
const schemaDirectory = schemaFlag === -1
  ? path.join(root, "schemas")
  : path.resolve(process.argv[schemaFlag + 1] ?? "");
const publicDomainContracts = [
  { name: "SourceEnvelope", file: "source-envelope.schema.json", id: "https://stevenshin.github.io/cardnews-foundry/schemas/source-envelope.schema.json" },
  { name: "EditorialBrief", file: "editorial-brief.schema.json", id: "https://stevenshin.github.io/cardnews-foundry/schemas/editorial-brief.schema.json" },
  { name: "Storyboard", file: "storyboard.schema.json", id: "https://stevenshin.github.io/cardnews-foundry/schemas/storyboard.schema.json" },
  { name: "VisualRecipe", file: "visual-recipe.schema.json", id: "https://stevenshin.github.io/cardnews-foundry/schemas/visual-recipe.schema.json" },
  { name: "RenderSpec", file: "render-spec.schema.json", id: "https://stevenshin.github.io/cardnews-foundry/schemas/render-spec.schema.json" },
  { name: "RenderArtifact", file: "render-artifact.schema.json", id: "https://stevenshin.github.io/cardnews-foundry/schemas/render-artifact.schema.json" },
  { name: "EvaluationReport", file: "evaluation-report.schema.json", id: "https://stevenshin.github.io/cardnews-foundry/schemas/evaluation-report.schema.json" },
  { name: "VisualVerdictRecord", file: "visual-verdict-record.schema.json", id: "https://stevenshin.github.io/cardnews-foundry/schemas/visual-verdict-record.schema.json" },
  { name: "PackageManifest", file: "package-manifest.schema.json", id: "https://stevenshin.github.io/cardnews-foundry/schemas/package-manifest.schema.json" }
];
const schemaDraft = "https://json-schema.org/draft/2020-12/schema";
const infrastructureSchemaNamespace = "https://cardnews-foundry.example/schemas/";
const publicSchemaFiles = new Set(publicDomainContracts.map(({ file }) => file));
const expectedIds = new Map(publicDomainContracts.map(({ name, id }) => [name, id]));
const publicContractNames = publicDomainContracts.map(({ name }) => name);

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));
const requireCondition = (condition, code, details) => {
  if (!condition) {
    const error = new Error(code);
    error.code = code;
    error.details = details;
    throw error;
  }
};

const visitSchema = (node, visit) => {
  if (Array.isArray(node)) {
    for (const item of node) visitSchema(item, visit);
    return;
  }
  if (node === null || typeof node !== "object") return;
  visit(node);
  for (const value of Object.values(node)) visitSchema(value, visit);
};

const inspectSchemas = async () => {
  const files = (await readdir(schemaDirectory))
    .filter((file) => file.endsWith(".schema.json"))
    .sort();
  const schemas = new Map(await Promise.all(files.map(async (file) => [
    file,
    await readJson(path.join(schemaDirectory, file))
  ])));
  for (const file of files) {
    if (publicSchemaFiles.has(file)) continue;
    const schema = schemas.get(file);
    // Infrastructure means Draft 2020-12 with $id exactly equal to this namespace plus the schema filename.
    requireCondition(schema?.$id === `${infrastructureSchemaNamespace}${file}`, "SCHEMA_UNKNOWN_PUBLIC", {
      file,
      id: schema?.$id ?? null
    });
    requireCondition(schema.$schema === schemaDraft, "SCHEMA_DRAFT", { file, actual: schema.$schema });
  }
  for (const contract of publicDomainContracts) {
    requireCondition(files.includes(contract.file), "SCHEMA_MISSING_PUBLIC", contract);
  }
  const checks = [];
  const validators = new Map();
  const publicIds = new Set();
  for (const contract of publicDomainContracts) {
    const { name, file, id: expectedId } = contract;
    const schema = schemas.get(file);
    requireCondition(schema.$schema === schemaDraft, "SCHEMA_DRAFT", name);
    requireCondition(schema.$id === expectedId, "SCHEMA_ID", { name, actual: schema.$id, expected: expectedId });
    requireCondition(!publicIds.has(schema.$id), "SCHEMA_DUPLICATE_PUBLIC", { name, id: schema.$id });
    publicIds.add(schema.$id);
    visitSchema(schema, (entry) => {
      if (entry.type === "object") {
        requireCondition("additionalProperties" in entry, "OBJECT_STRICTNESS_UNDECLARED", { name, entry });
        if (entry.additionalProperties !== false) {
          requireCondition(typeof entry.description === "string", "EXTENSION_MAP_UNDOCUMENTED", { name, entry });
        }
      }
      if (typeof entry.$ref === "string") {
        requireCondition(entry.$ref.startsWith("#/"), "EXTERNAL_SCHEMA_REF", { name, ref: entry.$ref });
      }
    });
    validators.set(name, new Ajv2020({ allErrors: true, strict: true }).compile(schema));
    checks.push({ contract: name, id: schema.$id, status: "pass" });
  }
  return { checks, validators };
};

const inspectSemanticFields = async () => {
  const semantic = ["SourceEnvelope", "EditorialBrief", "Storyboard", "VisualRecipe"];
  const prohibited = new Set([
    "html", "css", "render", "renderHtml", "renderCss", "provider", "providerSdk",
    "model", "modelParameters", "temperature", "pixels"
  ]);
  const leaks = [];
  for (const name of semantic) {
    const file = expectedIds.get(name).split("/").at(-1);
    const schema = await readJson(path.join(schemaDirectory, file));
    visitSchema(schema, (entry) => {
      if (entry.properties !== null && typeof entry.properties === "object" && !Array.isArray(entry.properties)) {
        for (const key of Object.keys(entry.properties)) {
          if (prohibited.has(key)) leaks.push({ contract: name, field: key });
        }
      }
    });
  }
  requireCondition(leaks.length === 0, "SEMANTIC_FIELD_LEAK", leaks);
  return { checkedContracts: semantic.length, leaks, status: "pass" };
};

const inspectFixtures = async (selectedValidators) => {
  const results = [];
  for (const name of publicContractNames) {
    const file = expectedIds.get(name).split("/").at(-1).replace(".schema.json", ".json");
    const fixture = await readJson(path.join(fixtureDirectory, file));
    requireCondition(fixture.contract === name, "FIXTURE_CONTRACT_NAME", { name, file });
    const valid = validateContract(name, fixture.valid);
    const invalid = validateContract(name, fixture.invalid.data);
    const forward = validateContract(name, fixture.forwardMinor);
    const unsupported = validateContract(name, fixture.unsupportedMajor);
    const selected = selectedValidators.get(name);
    requireCondition(selected?.(fixture.valid) === true, "SELECTED_VALID_FIXTURE_REJECTED", {
      name, issues: selected?.errors ?? null
    });
    requireCondition(selected(fixture.invalid.data) === false, "SELECTED_INVALID_FIXTURE_ACCEPTED", name);
    requireCondition(selected(fixture.forwardMinor) === true, "SELECTED_FORWARD_MINOR_REJECTED", {
      name, issues: selected.errors
    });
    requireCondition(valid.ok, "VALID_FIXTURE_REJECTED", { name, issues: valid.issues });
    requireCondition(!invalid.ok, "INVALID_FIXTURE_ACCEPTED", name);
    requireCondition(invalid.issues.some((issue) => issue.code === fixture.invalid.expectedCode), "INVALID_REASON", {
      name, expected: fixture.invalid.expectedCode, actual: invalid.issues
    });
    requireCondition(forward.ok && forward.forwardMinor, "FORWARD_MINOR_REJECTED", { name, result: forward });
    requireCondition(!unsupported.ok && unsupported.issues[0]?.code === "UNSUPPORTED_SCHEMA_MAJOR", "MAJOR_ACCEPTED", name);
    results.push({ contract: name, valid: "accept", invalid: "reject", forwardMinor: "accept", unsupportedMajor: "reject" });
  }
  return results;
};

const captureCanonicalError = (value) => {
  try {
    canonicalJson(value);
  } catch (error) {
    if (error instanceof CanonicalJsonError) return error.code;
    throw error;
  }
  return "ACCEPTED";
};

const inspectCanonicalization = async () => {
  const fixture = await readJson(path.join(fixtureDirectory, "canonical-json.json"));
  const canonical = canonicalJson(fixture.input);
  const digest = canonicalSha256(fixture.input);
  const reorderedDigest = canonicalSha256(fixture.reordered);
  const changedDigest = canonicalSha256(fixture.changed);
  requireCondition(canonical === fixture.expectedCanonical, "CANONICAL_BYTES", { canonical });
  requireCondition(digest === fixture.expectedSha256, "CANONICAL_DIGEST", { digest });
  requireCondition(reorderedDigest === digest, "STALE_STATE_FALSE_POSITIVE", { digest, reorderedDigest });
  requireCondition(changedDigest !== digest, "STALE_STATE_FALSE_NEGATIVE", { digest, changedDigest });
  const arrayOrderDigest = canonicalSha256({ z: [1, 2] });
  const reversedArrayDigest = canonicalSha256({ z: [2, 1] });
  requireCondition(arrayOrderDigest !== reversedArrayDigest, "ARRAY_ORDER_LOST", { arrayOrderDigest, reversedArrayDigest });
  const unsafe = Object.create({ inherited: true });
  unsafe.value = "data";
  const sparse = [];
  sparse[1] = "x";
  const nonFinite = captureCanonicalError({ value: Number.POSITIVE_INFINITY });
  const unsafePrototype = captureCanonicalError(unsafe);
  const sparseArray = captureCanonicalError(sparse);
  requireCondition(nonFinite === "NON_FINITE_NUMBER", "NON_FINITE_ACCEPTED", nonFinite);
  requireCondition(unsafePrototype === "UNSAFE_PROTOTYPE", "UNSAFE_PROTOTYPE_ACCEPTED", unsafePrototype);
  requireCondition(sparseArray === "SPARSE_ARRAY", "SPARSE_ARRAY_ACCEPTED", sparseArray);
  return {
    canonical, digest, reorderedDigest, changedDigest, arrayOrderDigest, reversedArrayDigest,
    nonFinite, unsafePrototype, sparseArray, status: "pass"
  };
};

const inspectManualQa = async () => {
  const fixtures = new Map();
  for (const name of publicContractNames) {
    const file = expectedIds.get(name).split("/").at(-1).replace(".schema.json", ".json");
    fixtures.set(name, await readJson(path.join(fixtureDirectory, file)));
  }
  const source = structuredClone(fixtures.get("SourceEnvelope").valid);
  const brief = structuredClone(fixtures.get("EditorialBrief").valid);
  const storyboard = structuredClone(fixtures.get("Storyboard").valid);
  const duplicateSpan = structuredClone(source);
  duplicateSpan.spans.push({ ...duplicateSpan.spans[0] });
  const duplicateClaim = structuredClone(brief);
  duplicateClaim.claims.push({ ...duplicateClaim.claims[0] });
  const duplicateCard = structuredClone(storyboard);
  duplicateCard.cards.push({ ...duplicateCard.cards[0] });
  const danglingExtractedSpan = structuredClone(source);
  danglingExtractedSpan.provenance.extractedSpanIds = ["span-missing"];
  const duplicateExtractedSpan = structuredClone(source);
  duplicateExtractedSpan.provenance.extractedSpanIds = ["span-1", "span-1"];
  const chainIssues = validateContractChain({ SourceEnvelope: source, EditorialBrief: brief, Storyboard: storyboard });
  const brokenStoryboard = structuredClone(storyboard);
  brokenStoryboard.cards[0].sourceSpanIds = ["span-missing"];
  const brokenLinkIssues = validateContractChain({ SourceEnvelope: source, EditorialBrief: brief, Storyboard: brokenStoryboard });
  const providerLeak = structuredClone(storyboard);
  providerLeak.cards[0].html = "<div>forbidden</div>";
  const providerLeakResult = validateContract("Storyboard", providerLeak);
  const instruction = source.spans[0].text;
  const injectionAcceptedAsData = validateContract("SourceEnvelope", source);
  source.authority = true;
  source.tools = ["shell"];
  const authorityRejected = validateContract("SourceEnvelope", source);
  const misleading = structuredClone(fixtures.get("SourceEnvelope").valid);
  misleading.ok = true;
  misleading.status = "pass";
  const misleadingResult = validateContract("SourceEnvelope", misleading);
  const completeChain = publicContractNames.every((name) => validateContract(name, fixtures.get(name).valid).ok);
  const hasIssue = (result, code, path) =>
    !result.ok && result.issues.some((issue) => issue.code === code && issue.path === path);
  const cases = {
    completeMinimalChain: completeChain && chainIssues.length === 0 ? "accept" : "fail",
    unknownField: authorityRejected.ok ? "fail" : "reject",
    wrongType: validateContract("EditorialBrief", fixtures.get("EditorialBrief").invalid.data).ok ? "fail" : "reject",
    invalidVersion: validateContract("RenderSpec", fixtures.get("RenderSpec").invalid.data).ok ? "fail" : "reject",
    unsupportedMajor: validateContract("SourceEnvelope", fixtures.get("SourceEnvelope").unsupportedMajor).ok ? "fail" : "reject",
    sourceSpanLink: brokenLinkIssues.some((issue) => issue.code === "UNKNOWN_SOURCE_SPAN") ? "reject" : "fail",
    crlfAndKeyOrder: canonicalSha256({ b: "x\r\ny", a: 1 }) === canonicalSha256({ a: 1, b: "x\ny" }) ? "same-digest" : "fail",
    arrayOrder: canonicalSha256([1, 2]) !== canonicalSha256([2, 1]) ? "preserved" : "fail",
    semanticValueChange: canonicalSha256({ value: "a" }) !== canonicalSha256({ value: "b" }) ? "changed-digest" : "fail",
    nonFinite: captureCanonicalError({ value: Number.NaN }),
    unsafeObject: captureCanonicalError(Object.create({ unsafe: true })),
    providerRenderFieldLeak: providerLeakResult.ok ? "fail" : "reject",
    authorityAndToolFields: authorityRejected.ok ? "fail" : "reject",
    promptInjection: injectionAcceptedAsData.ok && instruction.includes("call tools") && !authorityRejected.ok ? "inert-data" : "fail",
    misleadingSuccessOutput: misleadingResult.ok ? "fail" : "reject",
    duplicateSourceSpanId: hasIssue(
      validateContract("SourceEnvelope", duplicateSpan),
      "DUPLICATE_SOURCE_SPAN_ID",
      "/spans/1/id"
    ) ? "reject" : "fail",
    duplicateClaimId: hasIssue(
      validateContract("EditorialBrief", duplicateClaim),
      "DUPLICATE_CLAIM_ID",
      "/claims/1/id"
    ) ? "reject" : "fail",
    duplicateCardId: hasIssue(
      validateContract("Storyboard", duplicateCard),
      "DUPLICATE_CARD_ID",
      "/cards/1/id"
    ) ? "reject" : "fail",
    danglingExtractedSpan: hasIssue(
      validateContract("SourceEnvelope", danglingExtractedSpan),
      "UNKNOWN_PROVENANCE_SOURCE_SPAN",
      "/provenance/extractedSpanIds/0"
    ) ? "reject" : "fail",
    duplicateExtractedSpan: hasIssue(
      validateContract("SourceEnvelope", duplicateExtractedSpan),
      "DUPLICATE_EXTRACTED_SOURCE_SPAN_ID",
      "/provenance/extractedSpanIds/1"
    ) ? "reject" : "fail"
  };
  requireCondition(!Object.values(cases).includes("fail"), "MANUAL_QA_FAILURE", cases);
  return cases;
};

const main = async () => {
  const { checks: schemas, validators } = await inspectSchemas();
  const [fixtures, semanticFields, canonicalization] = await Promise.all([
    inspectFixtures(validators), inspectSemanticFields(), inspectCanonicalization()
  ]);
  const manualQa = await inspectManualQa();
  return {
    schemaVersion: 1,
    ok: true,
    counts: { contracts: schemas.length, fixtureCases: fixtures.length * 4 },
    schemas,
    fixtures,
    semanticFields,
    canonicalization,
    manualQa
  };
};

try {
  console.log(JSON.stringify(await main()));
} catch (error) {
  console.log(JSON.stringify({
    schemaVersion: 1,
    ok: false,
    error: {
      code: typeof error?.code === "string" ? error.code : "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : String(error),
      details: error?.details ?? null
    }
  }));
  process.exitCode = 1;
}
