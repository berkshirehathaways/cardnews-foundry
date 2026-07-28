export type EvaluationGate = {
  readonly id: string;
  readonly status: "pass" | "fail";
  readonly evidencePaths: readonly string[];
};

export type EvaluationReportValue = {
  readonly schemaVersion: "1.0.0";
  readonly evaluationId: string;
  readonly renderSetDigest: string;
  readonly blocking: boolean;
  readonly gates: readonly EvaluationGate[];
  readonly evaluatorVersions: Readonly<Record<string, string>>;
};

export function loadEvaluationInput(options: {
  readonly repositoryRoot: string;
  readonly fixtureRoot: string;
  readonly renderRoot: string;
}): Promise<unknown>;

export function evaluateGateMatrix(input: unknown): Promise<{
  readonly report: EvaluationReportValue;
}>;

export const GATE_IDS: readonly string[];
