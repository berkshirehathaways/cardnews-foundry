import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { canonicalJsonBytes, validateContract } from "../contracts/index.ts";
import { EvaluationError } from "./errors.mjs";
import { GATE_IDS } from "./matrix.mjs";

const within = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`);
const sameBytes = (left, right) =>
  left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);

const confinedTarget = async (jobRoot, target) => {
  const root = await realpath(jobRoot);
  const relative = path.relative(path.resolve(jobRoot), path.resolve(target));
  if (relative === "" || path.isAbsolute(relative) || relative.split(path.sep).includes("..")) {
    throw new EvaluationError("REPORT_PATH_ESCAPE", "report path escapes the job root");
  }
  const lexical = path.join(root, relative);
  let ancestor = path.dirname(lexical);
  while (true) {
    try {
      const resolved = await realpath(ancestor);
      if (!within(root, resolved)) {
        throw new EvaluationError("REPORT_PATH_ESCAPE", "report parent resolves outside the job root");
      }
      break;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
  await mkdir(path.dirname(lexical), { recursive: true });
  const parent = await realpath(path.dirname(lexical));
  if (!within(root, parent)) {
    throw new EvaluationError("REPORT_PATH_ESCAPE", "report parent resolves outside the job root");
  }
  try {
    if ((await lstat(lexical)).isSymbolicLink()) {
      throw new EvaluationError("REPORT_PATH_ESCAPE", "report target must not be a symbolic link");
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  return lexical;
};

const atomicPublish = async (jobRoot, target, bytes, failpoint, allowMatchingExisting = false) => {
  const confined = await confinedTarget(jobRoot, target);
  const temporary = path.join(path.dirname(confined), `.${path.basename(confined)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  let closed = false;
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    closed = true;
    if (failpoint === "before-publish") {
      throw new EvaluationError("ATOMIC_WRITE_INTERRUPTED", "accepted report publication was interrupted");
    }
    try {
      await link(temporary, confined);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        if (allowMatchingExisting && sameBytes(await readFile(confined), bytes)) return;
        throw new EvaluationError("REPORT_IMMUTABLE", "an accepted evaluation artifact already exists");
      }
      throw error;
    }
  } finally {
    if (!closed) await handle.close();
    await rm(temporary, { force: true });
  }
};

const validateCompleteReport = (report) => {
  const validation = validateContract("EvaluationReport", report);
  if (!validation.ok) {
    throw new EvaluationError("REPORT_MALFORMED", "evaluation report does not match its contract", validation.issues);
  }
  if (report.blocking || report.gates.some((gate) => gate.status !== "pass")) {
    throw new EvaluationError("REPORT_BLOCKING", "blocking evaluation reports cannot be accepted");
  }
  const ids = report.gates.map((gate) => gate.id);
  if (ids.length !== GATE_IDS.length || ids.some((id, index) => id !== GATE_IDS[index])) {
    throw new EvaluationError("REPORT_MATRIX_INCOMPLETE", "accepted reports require the exact complete gate matrix");
  }
};

const evidenceRecord = (report, gate) => ({
  schemaVersion: 1,
  gateId: gate.id,
  status: gate.status,
  renderSetDigest: report.renderSetDigest
});

const evidenceTarget = (jobRoot, relativePath) => path.resolve(jobRoot, relativePath);

export const writeEvaluationGateEvidence = async ({ report, jobRoot }) => {
  validateCompleteReport(report);
  for (const gate of report.gates) {
    for (const relativePath of gate.evidencePaths) {
      await atomicPublish(
        jobRoot,
        evidenceTarget(jobRoot, relativePath),
        canonicalJsonBytes(evidenceRecord(report, gate)),
        undefined,
        true
      );
    }
  }
};

export const writeAcceptedEvaluationReport = async ({ report, jobRoot, outputPath, failpoint }) => {
  validateCompleteReport(report);
  for (const gate of report.gates) {
    for (const relativePath of gate.evidencePaths) {
      const target = await confinedTarget(jobRoot, evidenceTarget(jobRoot, relativePath));
      let actual;
      try {
        actual = JSON.parse(await readFile(target, "utf8"));
      } catch {
        throw new EvaluationError("REPORT_EVIDENCE_MISSING", "accepted report gate evidence is unavailable");
      }
      if (!sameBytes(canonicalJsonBytes(actual), canonicalJsonBytes(evidenceRecord(report, gate)))) {
        throw new EvaluationError("REPORT_EVIDENCE_MISMATCH", "accepted report gate evidence does not match");
      }
    }
  }
  await atomicPublish(jobRoot, outputPath, canonicalJsonBytes(report), failpoint);
  return outputPath;
};
