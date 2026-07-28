import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  EvaluationError,
  GATE_IDS,
  writeEvaluationGateEvidence,
  writeAcceptedEvaluationReport
} from "../../src/evaluate/index.mjs";

const missing = async (file) => access(file).then(() => false, () => true);

test("Given a fully passing report, When acceptance is interrupted before publication, Then no partial report is observable and retry publishes canonical JSON", async (context) => {
  // Given
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cardnews-evaluate-report-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const outputPath = path.join(temporary, "reports", "evaluation-report.json");
  const report = {
    schemaVersion: "1.0.0",
    evaluationId: "evaluation-accepted",
    renderSetDigest: "1".repeat(64),
    blocking: false,
    gates: GATE_IDS.map((id) => ({
      id,
      status: "pass",
      evidencePaths: [`reports/gates/${id}.json`]
    })),
    evaluatorVersions: { "deterministic-qa": "1.0.0" }
  };

  // When / Then
  await writeEvaluationGateEvidence({ report, jobRoot: temporary });
  await assert.rejects(
    () => writeAcceptedEvaluationReport({
      report,
      jobRoot: temporary,
      outputPath,
      failpoint: "before-publish"
    }),
    (error) => error instanceof EvaluationError && error.code === "ATOMIC_WRITE_INTERRUPTED"
  );
  assert.equal(await missing(outputPath), true);
  await writeAcceptedEvaluationReport({ report, jobRoot: temporary, outputPath });
  assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), report);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(temporary, "reports", "gates", "source-schema.json"), "utf8")),
    {
      schemaVersion: 1,
      gateId: "source-schema",
      status: "pass",
      renderSetDigest: "1".repeat(64)
    }
  );
});

test("Given a blocking report, When accepted-report publication is requested, Then no file is written", async (context) => {
  // Given
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cardnews-evaluate-blocked-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const outputPath = path.join(temporary, "evaluation-report.json");
  const report = {
    schemaVersion: "1.0.0",
    evaluationId: "evaluation-blocked",
    renderSetDigest: "1".repeat(64),
    blocking: true,
    gates: [{ id: "source-schema", status: "fail", evidencePaths: ["reports/gates/source-schema.json"] }],
    evaluatorVersions: { "deterministic-qa": "1.0.0" }
  };

  // When / Then
  await assert.rejects(
    () => writeAcceptedEvaluationReport({ report, jobRoot: temporary, outputPath }),
    (error) => error instanceof EvaluationError && error.code === "REPORT_BLOCKING"
  );
  assert.equal(await missing(outputPath), true);
});

test("Given a schema-valid report with only one passing gate, When publication is requested, Then incomplete self-certification is rejected", async (context) => {
  // Given
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cardnews-evaluate-incomplete-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const report = {
    schemaVersion: "1.0.0",
    evaluationId: "evaluation-incomplete",
    renderSetDigest: "1".repeat(64),
    blocking: false,
    gates: [{ id: "source-schema", status: "pass", evidencePaths: ["reports/gates/source-schema.json"] }],
    evaluatorVersions: { "deterministic-qa": "1.0.0" }
  };

  // When / Then
  await assert.rejects(
    () => writeAcceptedEvaluationReport({
      report,
      jobRoot: temporary,
      outputPath: path.join(temporary, "reports", "evaluation-report.json")
    }),
    (error) => error instanceof EvaluationError && error.code === "REPORT_MATRIX_INCOMPLETE"
  );
});

test("Given a reports directory symlinked outside the job root, When publication is requested, Then no outside report is created", async (context) => {
  // Given
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cardnews-evaluate-symlink-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "cardnews-evaluate-outside-"));
  context.after(() => Promise.all([
    rm(temporary, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true })
  ]));
  await mkdir(path.join(outside, "gates"));
  await symlink(outside, path.join(temporary, "reports"));
  const report = {
    schemaVersion: "1.0.0",
    evaluationId: "evaluation-symlink",
    renderSetDigest: "1".repeat(64),
    blocking: false,
    gates: GATE_IDS.map((id) => ({
      id,
      status: "pass",
      evidencePaths: [`reports/gates/${id}.json`]
    })),
    evaluatorVersions: { "deterministic-qa": "1.0.0" }
  };

  // When / Then
  await assert.rejects(
    () => writeEvaluationGateEvidence({ report, jobRoot: temporary }),
    (error) => error instanceof EvaluationError && error.code === "REPORT_PATH_ESCAPE"
  );
  assert.equal(await missing(path.join(outside, "evaluation-report.json")), true);
});
