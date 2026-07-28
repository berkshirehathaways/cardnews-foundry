import assert from "node:assert/strict";
import test from "node:test";
import { verifyGithub } from "../../scripts/verify-github.mjs";

const repo = "owner/cardnews-foundry";
const sha = "0123456789abcdef0123456789abcdef01234567";
const workflowFile = ".github/workflows/ci.yml";

const createGhStub = () => {
  const calls = [];
  const gh = async (endpoint) => {
    calls.push(endpoint);
    if (endpoint === `repos/${repo}`) {
      return {
        visibility: "public",
        private: false,
        default_branch: "main",
      };
    }
    if (endpoint === `repos/${repo}/commits/main`) {
      return { sha };
    }
    if (endpoint === `repos/${repo}/actions/workflows/${encodeURIComponent(workflowFile)}`) {
      return {
        id: 17,
        path: workflowFile,
        state: "active",
      };
    }
    if (endpoint === `repos/${repo}/actions/workflows/17/runs?branch=main&head_sha=${sha}&status=completed&per_page=100`) {
      return {
        total_count: 2,
        workflow_runs: [
          {
            id: 1,
            head_branch: "main",
            head_sha: sha,
            status: "completed",
            conclusion: "success",
            path: workflowFile,
          },
          {
            id: 2,
            head_branch: "main",
            head_sha: sha,
            status: "completed",
            conclusion: "cancelled",
            path: workflowFile,
          },
        ],
      };
    }
    throw new Error(`unexpected gh endpoint: ${endpoint}`);
  };
  return { gh, calls };
};

test("verifyGithub resolves a public repository, exact default branch SHA, active workflow, and successful completed run", async () => {
  const { gh, calls } = createGhStub();

  const report = await verifyGithub({ repo, sha, workflowFile, gh });

  assert.equal(report.ok, true);
  assert.equal(report.repo, repo);
  assert.equal(report.visibility, "public");
  assert.equal(report.defaultBranch, "main");
  assert.equal(report.requestedSha, sha);
  assert.equal(report.defaultBranchCommit, sha);
  assert.equal(report.workflow.path, workflowFile);
  assert.equal(report.runs.successCount, 1);
  assert.deepEqual(calls, [
    `repos/${repo}`,
    `repos/${repo}/commits/main`,
    `repos/${repo}/actions/workflows/${encodeURIComponent(workflowFile)}`,
    `repos/${repo}/actions/workflows/17/runs?branch=main&head_sha=${sha}&status=completed&per_page=100`,
  ]);
});

test("verifyGithub fails closed when repository visibility is private", async () => {
  const calls = [];
  const gh = async (endpoint) => {
    calls.push(endpoint);
    if (endpoint === `repos/${repo}`) {
      return {
        visibility: "private",
        private: true,
        default_branch: "main",
      };
    }
    throw new Error(`unexpected gh endpoint: ${endpoint}`);
  };

  await assert.rejects(
    () => verifyGithub({ repo, sha, workflowFile, gh }),
    (error) => error.code === "GITHUB_REPO_VISIBILITY" && error.exitClass === 6,
  );
  assert.deepEqual(calls, [`repos/${repo}`]);
});

test("verifyGithub fails closed when no successful completed workflow run matches the requested SHA", async () => {
  const gh = async (endpoint) => {
    if (endpoint === `repos/${repo}`) {
      return {
        visibility: "public",
        private: false,
        default_branch: "main",
      };
    }
    if (endpoint === `repos/${repo}/commits/main`) {
      return { sha };
    }
    if (endpoint === `repos/${repo}/actions/workflows/${encodeURIComponent(workflowFile)}`) {
      return {
        id: 17,
        path: workflowFile,
        state: "active",
      };
    }
    if (endpoint === `repos/${repo}/actions/workflows/17/runs?branch=main&head_sha=${sha}&status=completed&per_page=100`) {
      return {
        total_count: 1,
        workflow_runs: [
          {
            id: 1,
            head_branch: "main",
            head_sha: sha,
            status: "completed",
            conclusion: "failure",
            path: workflowFile,
          },
        ],
      };
    }
    throw new Error(`unexpected gh endpoint: ${endpoint}`);
  };

  await assert.rejects(
    () => verifyGithub({ repo, sha, workflowFile, gh }),
    (error) => error.code === "GITHUB_RUNS_NOT_SUCCESS" && error.exitClass === 6,
  );
});
