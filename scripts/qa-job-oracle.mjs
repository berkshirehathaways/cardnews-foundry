import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeRendererSourceRevision } from "../src/render/input.mjs";
import { verifyRenderInventory } from "../src/render/verify.mjs";
import { runCommand } from "./qa-fixture-job.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const readJson = async (file) => {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    const code = error instanceof Error ? Reflect.get(error, "code") : undefined;
    if (code === "ENOENT" || error instanceof SyntaxError) return undefined;
    throw error;
  }
};

const readDirectory = async (directory) => {
  try {
    return await readdir(directory);
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, "code") === "ENOENT") return [];
    throw error;
  }
};

const readJobDirectories = async (workspace) => {
  const jobsRoot = path.join(workspace, ".cardnews", "jobs");
  try {
    return (await readdir(jobsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(".cardnews", "jobs", entry.name));
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, "code") === "ENOENT") return [];
    throw error;
  }
};

const currentJobLeaves = async (workspace, requestedJob) => {
  const jobs = await readJobDirectories(workspace);
  const heads = new Map(await Promise.all(jobs.map(async (job) => [
    job,
    await readJson(path.join(workspace, job, "head.json")),
  ])));
  const requested = path.relative(workspace, path.resolve(workspace, requestedJob));
  const descendants = new Set([requested]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [job, head] of heads) {
      const parent = head?.parentJobId;
      if (
        typeof parent === "string" &&
        [...descendants].some((candidate) => path.basename(candidate) === parent) &&
        !descendants.has(job)
      ) {
        descendants.add(job);
        changed = true;
      }
    }
  }
  const parentIds = new Set(
    [...descendants]
      .map((job) => heads.get(job)?.parentJobId)
      .filter((parent) => typeof parent === "string"),
  );
  return [...descendants].filter((job) => !parentIds.has(path.basename(job)));
};

const isRegularFile = async (file) => {
  try {
    return (await stat(file)).isFile();
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, "code") === "ENOENT") return false;
    throw error;
  }
};

const runJson = async (runner, workspace, args) => {
  const result = await runCommand(runner, [...args, "--json"], { cwd: workspace });
  let output;
  try {
    output = JSON.parse(result.stdout);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  return { result, output };
};

const stageIsValid = (status, stage) =>
  Array.isArray(status?.result?.stages) &&
  status.result.stages.some((entry) => entry.stage === stage && entry.state === "valid");

export const inspectJobOutcome = async ({ runner, workspace, job }) => {
  const relativeJob = path.relative(workspace, path.resolve(workspace, job));
  const jobRoot = path.resolve(workspace, relativeJob);
  const renderRoot = path.join(jobRoot, "render", "accepted");
  const [status, packaged, manifest, report, cardNames, contactSheet, currentSourceRevision] =
    await Promise.all([
      runJson(runner, workspace, ["status", "--job", relativeJob]),
      runJson(runner, workspace, ["package", "--job", relativeJob]),
      readJson(path.join(renderRoot, "render-manifest.json")),
      readJson(path.join(jobRoot, "reports", "evaluation-report.json")),
      readDirectory(path.join(renderRoot, "cards")),
      isRegularFile(path.join(renderRoot, "contact-sheet.png")),
      computeRendererSourceRevision(repositoryRoot),
    ]);
  let inventoryCurrent = false;
  let inventoryError = null;
  if (manifest !== undefined) {
    try {
      await verifyRenderInventory({ outputRoot: renderRoot, manifest });
      inventoryCurrent = true;
    } catch (error) {
      inventoryError = error instanceof Error ? Reflect.get(error, "code") ?? error.name : "unknown";
    }
  }
  const cardOrder = Array.isArray(manifest?.cardOrder) ? manifest.cardOrder : [];
  const artifactIds = Array.isArray(manifest?.artifacts)
    ? manifest.artifacts.map((entry) => entry?.contract?.cardId)
    : [];
  const expectedCardNames = cardOrder.map((cardId) => `${cardId}.png`).sort();
  const checks = {
    statusExit: status.result.code === 0 && status.output?.ok === true,
    acceptedStages: ["source", "editorial-brief", "storyboard", "visual-recipe", "render-spec", "evaluate"]
      .every((stage) => stageIsValid(status.output, stage)),
    sevenCurrentCards: cardOrder.length === 7 &&
      new Set(cardOrder).size === 7 &&
      artifactIds.length === 7 &&
      artifactIds.every((cardId, index) => cardId === cardOrder[index]) &&
      JSON.stringify(cardNames.filter((name) => name.endsWith(".png")).sort()) ===
        JSON.stringify(expectedCardNames),
    contactSheet,
    renderInventoryCurrent: inventoryCurrent && manifest?.sourceRevision === currentSourceRevision,
    evaluationAccepted: report?.blocking === false &&
      Array.isArray(report?.gates) &&
      report.gates.length > 0 &&
      report.gates.every((gate) => gate.status === "pass"),
    packageBoundary: packaged.result.code === 6 &&
      packaged.output?.error?.class === "package" &&
      packaged.output.error.code === "VISUAL_VERDICT_MISSING",
  };
  return {
    job: relativeJob,
    passed: Object.values(checks).every(Boolean),
    checks,
    inventoryError,
    cardCount: cardOrder.length,
    packageExit: packaged.result.code,
    packageCode: packaged.output?.error?.code ?? null,
    currentSourceRevision,
    renderSourceRevision: manifest?.sourceRevision ?? null,
  };
};

export const inspectWorkspaceOutcome = async ({ runner, workspace, job }) => {
  const jobs = job === undefined
    ? await readJobDirectories(workspace)
    : await currentJobLeaves(workspace, job);
  const candidates = await Promise.all(jobs.map(
    (candidate) => inspectJobOutcome({ runner, workspace, job: candidate }),
  ));
  const completed = candidates.filter((candidate) => candidate.passed);
  return {
    passed: completed.length === 1,
    completedJob: completed[0]?.job ?? null,
    candidateCount: candidates.length,
    candidates,
  };
};
