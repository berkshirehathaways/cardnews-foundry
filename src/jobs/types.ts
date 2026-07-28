export const JOB_STAGES = [
  "source",
  "brief",
  "storyboard",
  "recipe",
  "render",
  "evaluate",
  "package"
] as const;

export type StageName = (typeof JOB_STAGES)[number];
export type StageState = "valid" | "missing" | "stale";

export type JobHandle = {
  readonly root: string;
  readonly path: string;
  readonly id: string;
  readonly slug: string;
  readonly revision: number;
};

export type StageRecord = {
  readonly schemaVersion: 1;
  readonly stage: StageName;
  readonly value: unknown;
  readonly dependencies: Readonly<Record<string, string>>;
};

export type JobHead = {
  readonly schemaVersion: 1;
  readonly jobId: string;
  readonly slug: string;
  readonly revision: number;
  readonly parentJobId?: string;
  readonly stages: Readonly<Partial<Record<StageName, string>>>;
};

export type StageStatus = {
  readonly stage: StageName;
  readonly state: StageState;
  readonly digest?: string;
  readonly path: string;
};

export type ResumeSelection =
  | { readonly action: "commit"; readonly stage: StageName; readonly path: string }
  | { readonly action: "complete"; readonly path: string };

export type JobStatus = {
  readonly jobId: string;
  readonly revision: number;
  readonly stages: readonly StageStatus[];
  readonly resume: ResumeSelection;
};

export type JobLock = {
  readonly token: string;
  readonly path: string;
  readonly release: () => Promise<void>;
};
