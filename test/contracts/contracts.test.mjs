import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("Given a SourceEnvelope record, When the public contract validator parses it, Then it accepts the typed record", async () => {
  // Given
  const contracts = await import("../../src/contracts/index.ts");
  const record = {
    schemaVersion: "1.0.0",
    sourceId: "source-synthetic",
    title: "Synthetic source",
    spans: [{ id: "span-1", text: "Evidence", order: 0 }],
    provenance: {
      originalLocator: "https://example.test/article",
      finalLocator: "https://example.test/article",
      redirectChain: [],
      retrievedAt: "2026-01-01T00:00:00.000Z",
      rawSha256: "a".repeat(64),
      rawByteCount: 8,
      declaredMime: "text/plain",
      detectedMime: "text/plain",
      parser: { name: "synthetic", version: "1.0.0" },
      extractedSpanIds: ["span-1"],
      rightsStatus: "user-provided",
      transformations: ["line-ending-normalization"]
    }
  };

  // When
  const result = contracts.validateContract("SourceEnvelope", record);

  // Then
  assert.equal(result.ok, true);
});

test("Given compatibility fixtures, When the public verifier runs, Then all contract and version cases pass", async () => {
  // Given
  const command = path.join(root, "scripts", "verify-contracts.mjs");

  // When
  const { stdout } = await execFileAsync(process.execPath, [command], { cwd: root, encoding: "utf8" });
  const summary = JSON.parse(stdout);

  // Then
  assert.deepEqual(
    { ok: summary.ok, contracts: summary.counts.contracts, fixtureCases: summary.counts.fixtureCases },
    { ok: true, contracts: 9, fixtureCases: 36 }
  );
});

test("Given a novel schema with an infrastructure identity, When the verifier runs, Then only the nine public contracts are reported", async (context) => {
  // Given
  const schemaRoot = await mkdtemp(path.join(os.tmpdir(), "cardnews-schema-inventory-"));
  context.after(async () => rm(schemaRoot, { recursive: true, force: true }));
  const sourceSchemas = path.join(root, "schemas");
  const sourceFiles = await readdir(sourceSchemas);
  const publicFiles = [];
  for (const file of sourceFiles.filter((candidate) => candidate.endsWith(".schema.json"))) {
    const schema = JSON.parse(await readFile(path.join(sourceSchemas, file), "utf8"));
    if (schema.$id.startsWith("https://stevenshin.github.io/cardnews-foundry/schemas/")) {
      publicFiles.push(file);
    }
  }
  await Promise.all(publicFiles.map((file) => cp(path.join(sourceSchemas, file), path.join(schemaRoot, file))));
  await writeFile(path.join(schemaRoot, "layout-catalog.schema.json"), `${JSON.stringify({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://cardnews-foundry.example/schemas/layout-catalog.schema.json",
    type: "object",
    additionalProperties: false,
    properties: { schemaVersion: { type: "string", const: "1.0.0" } },
    required: ["schemaVersion"]
  })}\n`, "utf8");

  // When
  const { stdout } = await execFileAsync(process.execPath, [
    path.join(root, "scripts", "verify-contracts.mjs"), "--schemas", schemaRoot
  ], { cwd: root, encoding: "utf8" });
  const summary = JSON.parse(stdout);

  // Then
  assert.equal(summary.ok, true);
  assert.equal(summary.counts.contracts, publicFiles.length);
  assert.deepEqual(summary.schemas.map((schema) => schema.contract).sort(), [
    "EditorialBrief", "EvaluationReport", "PackageManifest", "RenderArtifact", "RenderSpec",
    "SourceEnvelope", "Storyboard", "VisualRecipe", "VisualVerdictRecord"
  ]);
  assert.equal(summary.schemas.some((schema) => schema.id.includes("cardnews-foundry.example")), false);
});

test("Given an arbitrary schema outside the infrastructure identity namespace, When the verifier runs, Then it fails closed", async (context) => {
  // Given
  const schemaRoot = await mkdtemp(path.join(os.tmpdir(), "cardnews-schema-unknown-"));
  context.after(async () => rm(schemaRoot, { recursive: true, force: true }));
  await cp(path.join(root, "schemas"), schemaRoot, { recursive: true });
  await writeFile(path.join(schemaRoot, "arbitrary.schema.json"), `${JSON.stringify({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://unrelated.example/schemas/arbitrary.schema.json",
    type: "object",
    additionalProperties: false
  })}\n`, "utf8");

  // When
  const error = await execFileAsync(process.execPath, [
    path.join(root, "scripts", "verify-contracts.mjs"), "--schemas", schemaRoot
  ], { cwd: root, encoding: "utf8" }).then(() => null, (failure) => failure);
  const summary = JSON.parse(error?.stdout ?? "{}");

  // Then
  assert.deepEqual(
    { exitCode: error?.code, ok: summary.ok, code: summary.error.code },
    { exitCode: 1, ok: false, code: "SCHEMA_UNKNOWN_PUBLIC" }
  );
});

test("Given a required public schema is missing, When the verifier runs, Then it fails with a missing-public-schema result", async (context) => {
  // Given
  const schemaRoot = await mkdtemp(path.join(os.tmpdir(), "cardnews-schema-missing-"));
  context.after(async () => rm(schemaRoot, { recursive: true, force: true }));
  await cp(path.join(root, "schemas"), schemaRoot, { recursive: true });
  await rm(path.join(schemaRoot, "source-envelope.schema.json"));

  // When
  const error = await execFileAsync(process.execPath, [
    path.join(root, "scripts", "verify-contracts.mjs"), "--schemas", schemaRoot
  ], { cwd: root, encoding: "utf8" }).then(() => null, (failure) => failure);
  const summary = JSON.parse(error?.stdout ?? "{}");

  // Then
  assert.deepEqual(
    { exitCode: error?.code, ok: summary.ok, code: summary.error.code },
    { exitCode: 1, ok: false, code: "SCHEMA_MISSING_PUBLIC" }
  );
});

test("Given a required public schema is substituted, When the verifier runs, Then it fails with an exact-schema result", async (context) => {
  // Given
  const schemaRoot = await mkdtemp(path.join(os.tmpdir(), "cardnews-schema-substituted-"));
  context.after(async () => rm(schemaRoot, { recursive: true, force: true }));
  await cp(path.join(root, "schemas"), schemaRoot, { recursive: true });
  const sourcePath = path.join(schemaRoot, "source-envelope.schema.json");
  const substitutedPath = path.join(schemaRoot, "source-envelope-substituted.schema.json");
  await cp(path.join(schemaRoot, "target-profile.schema.json"), substitutedPath);
  await rm(sourcePath);

  // When
  const error = await execFileAsync(process.execPath, [
    path.join(root, "scripts", "verify-contracts.mjs"), "--schemas", schemaRoot
  ], { cwd: root, encoding: "utf8" }).then(() => null, (failure) => failure);
  const summary = JSON.parse(error?.stdout ?? "{}");

  // Then
  assert.deepEqual(
    { exitCode: error?.code, ok: summary.ok, code: summary.error.code },
    { exitCode: 1, ok: false, code: "SCHEMA_UNKNOWN_PUBLIC" }
  );
});

test("Given a corrupted canonical fixture, When the public verifier runs, Then JSON output reports failure and exit is nonzero", async (context) => {
  // Given
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "cardnews-contracts-"));
  context.after(async () => rm(fixtureRoot, { recursive: true, force: true }));
  await cp(path.join(root, "test/contracts/fixtures"), fixtureRoot, { recursive: true });
  const canonicalPath = path.join(fixtureRoot, "canonical-json.json");
  const canonicalFixture = JSON.parse(await readFile(canonicalPath, "utf8"));
  canonicalFixture.expectedSha256 = "0".repeat(64);
  await writeFile(canonicalPath, `${JSON.stringify(canonicalFixture)}\n`, "utf8");

  // When
  const error = await execFileAsync(process.execPath, [
    path.join(root, "scripts", "verify-contracts.mjs"), "--fixtures", fixtureRoot
  ], { cwd: root, encoding: "utf8" }).then(
    () => null,
    (failure) => failure
  );
  const summary = JSON.parse(error?.stdout ?? "{}");

  // Then
  assert.deepEqual(
    { exitCode: error?.code, ok: summary.ok, code: summary.error.code },
    { exitCode: 1, ok: false, code: "CANONICAL_DIGEST" }
  );
});

test("Given canonical JSON fixtures, When values differ only by key order or line ending, Then bytes and digest stay stable", async () => {
  // Given
  const contracts = await import("../../src/contracts/index.ts");
  const fixture = JSON.parse(await readFile(path.join(root, "test/contracts/fixtures/canonical-json.json"), "utf8"));

  // When
  const canonical = contracts.canonicalJson(fixture.input);
  const inputDigest = contracts.canonicalSha256(fixture.input);
  const reorderedDigest = contracts.canonicalSha256(fixture.reordered);

  // Then
  assert.deepEqual(
    { canonical, inputDigest, reorderedDigest },
    {
      canonical: fixture.expectedCanonical,
      inputDigest: fixture.expectedSha256,
      reorderedDigest: fixture.expectedSha256
    }
  );
});

test("Given non-JSON runtime values, When canonical serialization runs, Then it rejects unsafe representations", async () => {
  // Given
  const contracts = await import("../../src/contracts/index.ts");
  const unsafe = Object.create({ inherited: true });
  unsafe.value = "data";

  // When
  const nonFinite = () => contracts.canonicalJson({ value: Number.NaN });
  const unsafePrototype = () => contracts.canonicalJson(unsafe);

  // Then
  assert.throws(nonFinite, (error) => error.code === "NON_FINITE_NUMBER");
  assert.throws(unsafePrototype, (error) => error.code === "UNSAFE_PROTOTYPE");
});

test("Given a sparse array, When canonical serialization runs, Then it rejects the array hole with a stable error", async () => {
  // Given
  const contracts = await import("../../src/contracts/index.ts");
  const sparse = [];
  sparse[1] = "x";

  // When
  const serialize = () => contracts.canonicalJson(sparse);

  // Then
  assert.throws(serialize, (error) => error.code === "SPARSE_ARRAY" && error.path === "$[0]");
});

test("Given duplicate source span IDs, When SourceEnvelope validation runs, Then it rejects the duplicate with a stable issue", async () => {
  // Given
  const contracts = await import("../../src/contracts/index.ts");
  const fixture = JSON.parse(await readFile(path.join(root, "test/contracts/fixtures/source-envelope.json"), "utf8"));
  fixture.valid.spans.push({ ...fixture.valid.spans[0] });

  // When
  const result = contracts.validateContract("SourceEnvelope", fixture.valid);

  // Then
  assert.deepEqual(result, {
    ok: false,
    issues: [{ code: "DUPLICATE_SOURCE_SPAN_ID", path: "/spans/1/id", message: "span-1" }]
  });
});

test("Given duplicate editorial claim IDs, When EditorialBrief validation runs, Then it rejects the duplicate with a stable issue", async () => {
  // Given
  const contracts = await import("../../src/contracts/index.ts");
  const fixture = JSON.parse(await readFile(path.join(root, "test/contracts/fixtures/editorial-brief.json"), "utf8"));
  fixture.valid.claims.push({ ...fixture.valid.claims[0] });

  // When
  const result = contracts.validateContract("EditorialBrief", fixture.valid);

  // Then
  assert.deepEqual(result, {
    ok: false,
    issues: [{ code: "DUPLICATE_CLAIM_ID", path: "/claims/1/id", message: "claim-1" }]
  });
});

test("Given duplicate storyboard card IDs, When Storyboard validation runs, Then it rejects the duplicate with a stable issue", async () => {
  // Given
  const contracts = await import("../../src/contracts/index.ts");
  const fixture = JSON.parse(await readFile(path.join(root, "test/contracts/fixtures/storyboard.json"), "utf8"));
  fixture.valid.cards.push({ ...fixture.valid.cards[0] });

  // When
  const result = contracts.validateContract("Storyboard", fixture.valid);

  // Then
  assert.deepEqual(result, {
    ok: false,
    issues: [{ code: "DUPLICATE_CARD_ID", path: "/cards/1/id", message: "card-1" }]
  });
});

test("Given a dangling extracted source span, When SourceEnvelope validation runs, Then it rejects the provenance reference with a stable issue", async () => {
  // Given
  const contracts = await import("../../src/contracts/index.ts");
  const fixture = JSON.parse(await readFile(path.join(root, "test/contracts/fixtures/source-envelope.json"), "utf8"));
  fixture.valid.provenance.extractedSpanIds = ["span-missing"];

  // When
  const result = contracts.validateContract("SourceEnvelope", fixture.valid);

  // Then
  assert.deepEqual(result, {
    ok: false,
    issues: [{ code: "UNKNOWN_PROVENANCE_SOURCE_SPAN", path: "/provenance/extractedSpanIds/0", message: "span-missing" }]
  });
});

test("Given duplicate extracted source span IDs, When SourceEnvelope validation runs, Then it rejects the duplicate with a stable issue", async () => {
  // Given
  const contracts = await import("../../src/contracts/index.ts");
  const fixture = JSON.parse(await readFile(path.join(root, "test/contracts/fixtures/source-envelope.json"), "utf8"));
  fixture.valid.provenance.extractedSpanIds = ["span-1", "span-1"];

  // When
  const result = contracts.validateContract("SourceEnvelope", fixture.valid);

  // Then
  assert.deepEqual(result, {
    ok: false,
    issues: [{ code: "DUPLICATE_EXTRACTED_SOURCE_SPAN_ID", path: "/provenance/extractedSpanIds/1", message: "span-1" }]
  });
});

test("Given cross-record source links, When chain validation runs, Then an unknown source span fails closed", async () => {
  // Given
  const contracts = await import("../../src/contracts/index.ts");
  const fixtureNames = ["source-envelope", "editorial-brief", "storyboard"];
  const [source, brief, storyboard] = await Promise.all(fixtureNames.map(async (name) =>
    JSON.parse(await readFile(path.join(root, `test/contracts/fixtures/${name}.json`), "utf8"))
  ));
  storyboard.valid.cards[0].sourceSpanIds = ["span-missing"];

  // When
  const issues = contracts.validateContractChain({
    SourceEnvelope: source.valid,
    EditorialBrief: brief.valid,
    Storyboard: storyboard.valid
  });

  // Then
  assert.equal(issues.some((issue) => issue.code === "UNKNOWN_SOURCE_SPAN"), true);
});
