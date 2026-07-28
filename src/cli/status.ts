import { access } from "node:fs/promises";
import path from "node:path";
import { getJobStatus, type JobHandle, type StageName, type StageState } from "../jobs/index.ts";
import { displayPath } from "./job.ts";

const names: Readonly<Record<StageName, string>> = {
  source: "source",
  brief: "editorial-brief",
  storyboard: "storyboard",
  recipe: "visual-recipe",
  render: "render-spec",
  evaluate: "evaluate",
  package: "package"
};

const dependencies: Readonly<Record<string, readonly string[]>> = {
  source: [],
  "editorial-brief": ["source"],
  storyboard: ["editorial-brief"],
  "visual-recipe": ["storyboard"],
  "render-spec": ["visual-recipe"],
  render: ["render-spec", "assets"],
  evaluate: ["render"],
  package: ["evaluate"]
};

const exists = async (target: string): Promise<boolean> =>
  access(target).then(() => true).catch(() => false);

export type CliStatus = {
  readonly jobId: string;
  readonly revision: number;
  readonly stages: readonly {
    readonly stage: string;
    readonly state: StageState;
    readonly digest?: string;
  }[];
  readonly nextStage: string | null;
  readonly draftPath: string | null;
  readonly requiredDependencies: readonly string[];
  readonly nextCommand: string;
};

export const cliStatus = async (job: JobHandle): Promise<CliStatus> => {
  const status = await getJobStatus(job);
  const stages = status.stages.map((entry) => ({
    stage: names[entry.stage],
    state: entry.state,
    ...(entry.digest === undefined ? {} : { digest: entry.digest })
  }));
  const jobPath = displayPath(job.path);
  const first = stages.find((entry) => entry.state !== "valid");
  let nextStage = first?.stage ?? null;
  if (nextStage === "evaluate" && !(await exists(path.join(job.path, "render", "accepted", "render-manifest.json")))) {
    nextStage = "render";
  }
  let draftPath: string | null = null;
  let nextCommand = "cardnews status --job " + jobPath;
  if (nextStage === "source") {
    nextCommand = `cardnews ingest --job ${jobPath} --file <source> --allowed-root <root>`;
  } else if (["editorial-brief", "storyboard", "visual-recipe", "render-spec"].includes(nextStage ?? "")) {
    draftPath = displayPath(path.join(job.path, "drafts", `${nextStage}.json`));
    const draftExists = await exists(path.join(process.cwd(), draftPath));
    nextCommand = draftExists
      ? `cardnews commit-record --job ${jobPath} --stage ${nextStage} --input ${draftPath}`
      : `cardnews scaffold-record --job ${jobPath} --stage ${nextStage}`;
  } else if (nextStage === "render") {
    nextCommand = `cardnews render --job ${jobPath}`;
  } else if (nextStage === "evaluate") {
    nextCommand = `cardnews evaluate --job ${jobPath}`;
  } else if (nextStage === "package") {
    nextCommand = `cardnews package --job ${jobPath} --format zip`;
  } else if (nextStage === null) {
    nextCommand = `cardnews status --job ${jobPath}`;
  }
  return {
    jobId: status.jobId,
    revision: status.revision,
    stages,
    nextStage,
    draftPath,
    requiredDependencies: nextStage === null ? [] : dependencies[nextStage] ?? [],
    nextCommand
  };
};
