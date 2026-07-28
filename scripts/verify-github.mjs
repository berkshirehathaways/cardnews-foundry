#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFile = promisify(execFileCallback);

export class GithubVerificationError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "GithubVerificationError";
    this.code = code;
    this.exitClass = 6;
    if (details !== undefined) this.details = details;
  }
}

const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const shaPattern = /^[a-f0-9]{40}$/iu;

const safeWorkflowPath = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  !path.isAbsolute(value) &&
  !value.includes("\\") &&
  !value.split("/").some((segment) => segment === "" || segment === "." || segment === "..");

const readOption = (args, name) => {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
};

const requireOption = (args, name) => {
  const value = readOption(args, name);
  if (value === undefined) {
    throw new GithubVerificationError("GITHUB_USAGE", `usage: verify-github.mjs --repo <owner/name> --sha <full-sha> --workflow-file <path>`);
  }
  return value;
};

const shortSha = (value) => value.slice(0, 12);

const ghApi = async (endpoint, { cwd = repositoryRoot, env = process.env } = {}) => {
  try {
    const result = await execFile("gh", ["api", endpoint, "-H", "Accept: application/vnd.github+json"], {
      cwd,
      env,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    try {
      return JSON.parse(result.stdout || "{}");
    } catch {
      throw new GithubVerificationError("GITHUB_RESPONSE_INVALID", "gh api returned malformed JSON", endpoint);
    }
  } catch (error) {
    if (error instanceof GithubVerificationError) throw error;
    throw new GithubVerificationError("GITHUB_COMMAND_FAILED", `gh api failed for ${endpoint}`, {
      command: "gh api",
    });
  }
};

const normalizeRepo = (value) => {
  if (!repoPattern.test(value)) {
    throw new GithubVerificationError("GITHUB_USAGE", "usage: verify-github.mjs --repo <owner/name> --sha <full-sha> --workflow-file <path>");
  }
  return value;
};

const normalizeSha = (value) => {
  if (!shaPattern.test(value)) {
    throw new GithubVerificationError("GITHUB_USAGE", "usage: verify-github.mjs --repo <owner/name> --sha <full-sha> --workflow-file <path>");
  }
  return value.toLowerCase();
};

const normalizeWorkflowFile = (value) => {
  if (!safeWorkflowPath(value)) {
    throw new GithubVerificationError("GITHUB_USAGE", "usage: verify-github.mjs --repo <owner/name> --sha <full-sha> --workflow-file <path>");
  }
  return value;
};

const verifyVisibility = (repo, repoInfo) => {
  const visibility = typeof repoInfo.visibility === "string" ? repoInfo.visibility : undefined;
  const privateRepo = repoInfo.private === true || repoInfo.isPrivate === true;
  if (visibility !== "public" || privateRepo) {
    throw new GithubVerificationError("GITHUB_REPO_VISIBILITY", `repository must be public: ${repo}`);
  }
  return visibility;
};

const verifyWorkflowRuns = (workflow, defaultBranch, sha, runPayload) => {
  const runs = Array.isArray(runPayload?.workflow_runs) ? runPayload.workflow_runs : [];
  if (runs.length === 0) {
    throw new GithubVerificationError("GITHUB_RUNS_MISSING", "no completed workflow runs matched the requested SHA");
  }
  for (const run of runs) {
    if (run.status !== "completed") {
      throw new GithubVerificationError("GITHUB_RUN_STATE", "workflow runs must be completed");
    }
    if (run.head_sha !== sha) {
      throw new GithubVerificationError("GITHUB_RUN_SHA", "workflow runs did not match the requested SHA");
    }
    if (run.head_branch !== undefined && run.head_branch !== defaultBranch) {
      throw new GithubVerificationError("GITHUB_RUN_BRANCH", "workflow runs did not match the default branch");
    }
    if (run.path !== undefined && run.path !== workflow.path) {
      throw new GithubVerificationError("GITHUB_RUN_WORKFLOW", "workflow runs resolved a different workflow path");
    }
  }
  const successfulRuns = runs.filter((run) => run.conclusion === "success");
  if (successfulRuns.length === 0) {
    throw new GithubVerificationError("GITHUB_RUNS_NOT_SUCCESS", "no successful workflow run matched the requested SHA");
  }
  return { runs, successfulRuns };
};

export const verifyGithub = async ({
  repo,
  sha,
  workflowFile,
  gh = ghApi,
} = {}) => {
  const normalizedRepo = normalizeRepo(repo ?? "");
  const normalizedSha = normalizeSha(sha ?? "");
  const normalizedWorkflowFile = normalizeWorkflowFile(workflowFile ?? "");

  const repoInfo = await gh(`repos/${normalizedRepo}`);
  const visibility = verifyVisibility(normalizedRepo, repoInfo);
  const defaultBranch = typeof repoInfo.default_branch === "string" && repoInfo.default_branch.length > 0
    ? repoInfo.default_branch
    : (() => { throw new GithubVerificationError("GITHUB_DEFAULT_BRANCH_MISSING", "repository default branch is missing"); })();

  const commit = await gh(`repos/${normalizedRepo}/commits/${encodeURIComponent(defaultBranch)}`);
  if (typeof commit?.sha !== "string" || commit.sha.toLowerCase() !== normalizedSha) {
    throw new GithubVerificationError("GITHUB_DEFAULT_BRANCH_SHA_MISMATCH", "default branch commit does not match the requested SHA");
  }

  const workflow = await gh(`repos/${normalizedRepo}/actions/workflows/${encodeURIComponent(normalizedWorkflowFile)}`);
  if (typeof workflow?.id !== "number" && typeof workflow?.id !== "string") {
    throw new GithubVerificationError("GITHUB_WORKFLOW_ID_MISSING", "workflow id is missing");
  }
  if (workflow.path !== normalizedWorkflowFile) {
    throw new GithubVerificationError("GITHUB_WORKFLOW_PATH_MISMATCH", "workflow path did not match the requested file");
  }
  if (workflow.state !== "active") {
    throw new GithubVerificationError("GITHUB_WORKFLOW_INACTIVE", "workflow is not active");
  }

  const runs = await gh(
    `repos/${normalizedRepo}/actions/workflows/${workflow.id}/runs?branch=${encodeURIComponent(defaultBranch)}&head_sha=${encodeURIComponent(normalizedSha)}&status=completed&per_page=100`
  );
  const { runs: matchedRuns, successfulRuns } = verifyWorkflowRuns(workflow, defaultBranch, normalizedSha, runs);

  return {
    ok: true,
    repo: normalizedRepo,
    visibility,
    defaultBranch,
    requestedSha: normalizedSha,
    defaultBranchCommit: commit.sha.toLowerCase(),
    workflow: {
      id: workflow.id,
      path: workflow.path,
      state: workflow.state,
    },
    runs: {
      totalCount: matchedRuns.length,
      successCount: successfulRuns.length,
      conclusions: matchedRuns.map((run) => run.conclusion),
    },
  };
};

const main = async () => {
  const args = process.argv.slice(2).filter((value) => value !== "--");
  try {
    const report = await verifyGithub({
      repo: requireOption(args, "--repo"),
      sha: requireOption(args, "--sha"),
      workflowFile: requireOption(args, "--workflow-file"),
    });
    process.stderr.write(
      `verify:github ok repo=${report.repo} branch=${report.defaultBranch} sha=${shortSha(report.requestedSha)} workflow=${report.workflow.path} runs=${report.runs.successCount}/${report.runs.totalCount}\n`
    );
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    const code = error instanceof Error && typeof Reflect.get(error, "code") === "string"
      ? Reflect.get(error, "code")
      : "GITHUB_INTERNAL";
    process.stderr.write(`verify:github fail code=${code}\n`);
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code } })}\n`);
    process.exitCode = error instanceof GithubVerificationError && error.exitClass === 6 ? 6 : 1;
    if (error instanceof GithubVerificationError && error.code === "GITHUB_USAGE") {
      process.exitCode = 2;
    }
  }
};

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
