import { canonicalSha256 } from "#contracts";
import path from "node:path";
import { errorCode, JobError } from "#jobs/errors";
import { headPath, readHead } from "#jobs/head";
import { resolveJobTarget } from "#jobs/paths";
import { readRecord, recordPath, STAGE_DEPENDENCIES } from "#jobs/records";
import { JOB_STAGES, type JobHandle, type JobStatus, type StageState, type StageStatus } from "#jobs/types";

const inspectStage = async (
  job: JobHandle,
  stage: (typeof JOB_STAGES)[number],
  digest: string | undefined,
  states: ReadonlyMap<string, StageState>,
  headStages: Readonly<Partial<Record<(typeof JOB_STAGES)[number], string>>>
): Promise<StageStatus> => {
  const target = digest === undefined
    ? path.join(job.path, "records", `${stage}.pending.json`)
    : recordPath(job.path, digest);
  if (digest === undefined) return { stage, state: "missing", path: target };
  try {
    await resolveJobTarget(job, path.join("records", `${digest}.json`));
    const record = await readRecord(job.path, digest);
    const dependencies = STAGE_DEPENDENCIES[stage];
    const staleDependency = dependencies.some((dependency) =>
      states.get(dependency) !== "valid" || record.dependencies[dependency] !== headStages[dependency]
    );
    const valid = record.stage === stage && canonicalSha256(record) === digest && !staleDependency;
    return { stage, state: valid ? "valid" : "stale", digest, path: target };
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { stage, state: "missing", digest, path: target };
    if (error instanceof JobError || error instanceof SyntaxError) {
      return { stage, state: "stale", digest, path: target };
    }
    throw error;
  }
};

export const getJobStatus = async (job: JobHandle): Promise<JobStatus> => {
  await resolveJobTarget(job, "head.json");
  const head = await readHead(job.path);
  const statuses: StageStatus[] = [];
  const states = new Map<string, StageState>();
  for (const stage of JOB_STAGES) {
    const status = await inspectStage(job, stage, head.stages[stage], states, head.stages);
    statuses.push(status);
    states.set(stage, status.state);
  }
  const next = statuses.find((status) => status.state !== "valid");
  return {
    jobId: head.jobId,
    revision: head.revision,
    stages: statuses,
    resume: next === undefined
      ? { action: "complete", path: headPath(job.path) }
      : { action: "commit", stage: next.stage, path: next.path }
  };
};
