import { validateContract } from "../contracts/index.ts";
import { computeEvaluationIdentities } from "./identity.mjs";
import { GATE_IDS } from "./matrix.mjs";
import { normalizeVisualVerdict, normalizeVisualVerdictPair } from "./verdicts.mjs";
import { packageGates } from "./package-gates.mjs";
import { sourceAndStoryGates } from "./source-gates.mjs";
import { visualAndRenderGates } from "./visual-render-gates.mjs";

const runGate = (id, check) => {
  try {
    return {
      id,
      status: check() ? "pass" : "fail",
      evidencePaths: [`reports/gates/${id}.json`]
    };
  } catch {
    return { id, status: "fail", evidencePaths: [`reports/gates/${id}.json`] };
  }
};

const visualGates = (input, identities) => {
  const expected = { ...identities, nowMs: input.nowMs };
  const passA = () => {
    if (input.verdicts?.passA === undefined) return false;
    return normalizeVisualVerdict(input.verdicts.passA, { ...expected, pass: "A" }).verdict === "PASS";
  };
  const passB = () => {
    if (input.verdicts?.passB === undefined) return false;
    return normalizeVisualVerdict(input.verdicts.passB, { ...expected, pass: "B" }).verdict === "PASS";
  };
  const pair = () => {
    if (input.verdicts === undefined) return false;
    const normalized = normalizeVisualVerdictPair(input.verdicts, expected);
    return normalized.passA.verdict === "PASS" && normalized.passB.verdict === "PASS";
  };
  return [
    ["visual-pass-a", passA],
    ["visual-pass-b", passB],
    ["visual-pair-identity", pair]
  ];
};

export const evaluateGateMatrix = async (input) => {
  const identities = computeEvaluationIdentities(input);
  const checks = [
    ...sourceAndStoryGates(input),
    ...visualAndRenderGates(input),
    ...visualGates(input, identities),
    ...packageGates(input)
  ];
  const gates = checks.map(([id, check]) => runGate(id, check));
  const packageReady = gates.every((gate) => gate.status === "pass");
  gates.push(runGate("package-preconditions", () => packageReady));
  const ordered = GATE_IDS.map((id) => gates.find((gate) => gate.id === id));
  if (ordered.some((gate) => gate === undefined) || ordered.length !== gates.length) {
    throw new TypeError("evaluation gate matrix and implementation differ");
  }
  const report = {
    schemaVersion: "1.0.0",
    evaluationId: `evaluation-${identities.renderSetDigest.slice(0, 12)}`,
    renderSetDigest: identities.renderSetDigest,
    blocking: ordered.some((gate) => gate.status === "fail"),
    gates: ordered,
    evaluatorVersions: {
      "deterministic-qa": "1.0.0",
      "visual-adapter": "1.0.0"
    }
  };
  const validation = validateContract("EvaluationReport", report);
  if (!validation.ok) throw new TypeError("evaluation report generation violated its contract");
  return { report, identities };
};
