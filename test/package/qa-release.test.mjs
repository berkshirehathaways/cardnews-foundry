import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolveEvidenceRoot, runReleaseQa } from "../../scripts/qa-release.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const injectedSha = "abcdef0123456789abcdef0123456789abcdef01";

const prepareRepo = async (withHead) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cardnews-qa-release-"));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "cardnews-foundry" }));
  await writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.name", "QA Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "qa@example.invalid"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  if (withHead) {
    execFileSync("git", ["commit", "-qm", "seed"], { cwd: root });
  }
  return root;
};

const createRunner = ({ headExists, headSha, cleanCloneSummary }) => {
  const calls = [];
  const run = async (command, args, options = {}) => {
    calls.push({ command, args, cwd: options.cwd, timeoutMs: options.timeoutMs });
    if (command === "git" && args[0] === "rev-parse" && args[1] === "--verify" && args[2] === "HEAD") {
      return headExists
        ? { code: 0, stdout: `${headSha}\n`, stderr: "" }
        : { code: 128, stdout: "", stderr: "fatal: Needed a single revision\n" };
    }
    if (command === "git" && args[0] === "rev-parse" && args[1] === "HEAD") {
      return { code: 0, stdout: `${headSha}\n`, stderr: "" };
    }
    if (command === "corepack" && args[0] === "pnpm" && args[1] === "verify:clean-clone") {
      assert.equal(args[2], "--");
      assert.equal(args[3], "--evidence-dir");
      assert.match(args[4], /clean-clone$/u);
      return { code: 0, stdout: `${JSON.stringify(cleanCloneSummary)}\n`, stderr: "" };
    }
    throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
  };
  return { run, calls };
};

test("resolveEvidenceRoot selects the environment override before the external home fallback without filesystem writes", () => {
  const homeDirectory = path.join(os.tmpdir(), "cardnews-qa-home-not-created");
  const override = path.join(os.tmpdir(), "cardnews-qa-override-not-created");
  const fallback = path.join(
    homeDirectory,
    ".omo",
    "evidence",
    "cardnews-foundry",
    "T15",
    "a1",
  );
  const repositoryEvidenceRoot = path.resolve(repositoryRoot, ".omo");

  assert.equal(resolveEvidenceRoot({ environment: {}, homeDirectory }), fallback);
  assert.equal(
    resolveEvidenceRoot({
      environment: { CARDNEWS_QA_EVIDENCE_ROOT: override },
      homeDirectory,
    }),
    override,
  );
  assert.equal(fallback.startsWith(`${repositoryEvidenceRoot}${path.sep}`), false);
  assert.equal(override.startsWith(`${repositoryEvidenceRoot}${path.sep}`), false);
});

test("runReleaseQa binds an unborn repository to the injected SHA and writes evidence", async (context) => {
  const root = await prepareRepo(false);
  context.after(() => rm(root, { recursive: true, force: true }));
  const cleanCloneSummary = {
    ok: true,
    source: { mode: "pre-head-snapshot", commit: "snapshotsha" },
    isolation: { cachesRootedInTemporaryDirectory: true },
    artifacts: { sourceArchiveSha256: "00".repeat(32) },
    commands: [
      { label: "04-build" },
      { label: "05-typecheck" },
      { label: "06-tests" },
      { label: "07-synthetic-contracts" },
      { label: "08-synthetic-full" },
      { label: "09-two-canonical-renders" },
      { label: "10-skill-validation" },
      { label: "10a-skill-lifecycle-tests" },
      { label: "11-skill-install" },
      { label: "12-skill-discovery" },
      { label: "13-installed-runner" },
      { label: "14-release-dry-run" },
    ],
    cleanup: { removed: true },
  };
  const { run, calls } = createRunner({ headExists: false, headSha: "unused", cleanCloneSummary });
  const evidenceRoot = path.join(root, "evidence");

  const report = await runReleaseQa({ evidenceRoot, sha: injectedSha, run });

  assert.equal(report.ok, true);
  assert.equal(report.sha, injectedSha);
  assert.equal(report.head.exists, false);
  assert.equal(report.head.source, "injected");
  assert.equal(report.cleanClone.source.commit, "snapshotsha");
  assert.equal(report.gates.at(-1), "14-release-dry-run");
  assert.equal(await import("node:fs/promises").then(({ readFile }) => readFile(path.join(evidenceRoot, "qa-release.json"), "utf8")).then((text) => JSON.parse(text).sha), injectedSha);
  assert.equal(calls[0].command, "git");
  assert.equal(calls.find((call) => call.command === "corepack")?.timeoutMs, 120 * 60 * 1_000);
});

test("runReleaseQa replaces a symlinked JSON report without changing its target", async (context) => {
  const root = await prepareRepo(false);
  context.after(() => rm(root, { recursive: true, force: true }));
  const evidenceRoot = path.join(root, "evidence");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(evidenceRoot));
  const target = path.join(root, "attacker-target.json");
  const reportPath = path.join(evidenceRoot, "qa-release.json");
  await writeFile(target, "attacker-owned bytes");
  await symlink(target, reportPath);
  const { run } = createRunner({
    headExists: false,
    headSha: "unused",
    cleanCloneSummary: {
      ok: true,
      source: { mode: "pre-head-snapshot", commit: "snapshotsha" },
      isolation: { cachesRootedInTemporaryDirectory: true },
      artifacts: { sourceArchiveSha256: "00".repeat(32) },
      commands: [{ label: "14-release-dry-run" }],
      cleanup: { removed: true },
    },
  });

  await runReleaseQa({ evidenceRoot, sha: injectedSha, run });

  assert.equal(await readFile(target, "utf8"), "attacker-owned bytes");
  assert.equal((await lstat(reportPath)).isSymbolicLink(), false);
  assert.equal(JSON.parse(await readFile(reportPath, "utf8")).sha, injectedSha);
});

test("runReleaseQa binds a repository with HEAD to the exact commit SHA and rejects mismatched injection", async (context) => {
  const root = await prepareRepo(true);
  context.after(() => rm(root, { recursive: true, force: true }));
  const headSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const { run } = createRunner({
    headExists: true,
    headSha,
    cleanCloneSummary: {
      ok: true,
      source: { mode: "tracked-head", commit: headSha },
      isolation: { cachesRootedInTemporaryDirectory: true },
      artifacts: { sourceArchiveSha256: "11".repeat(32) },
      commands: [{ label: "14-release-dry-run" }],
      cleanup: { removed: true },
    },
  });

  await assert.rejects(
    () => runReleaseQa({ evidenceRoot: path.join(root, "evidence"), sha: injectedSha, run }),
    (error) => error.code === "QA_RELEASE_SHA_MISMATCH" && error.exitClass === 6,
  );
});

test("runReleaseQa rejects a successful clean-clone summary whose source commit is stale", async (context) => {
  const root = await prepareRepo(true);
  context.after(() => rm(root, { recursive: true, force: true }));
  const headSha = "1234567890abcdef1234567890abcdef12345678";
  const { run } = createRunner({
    headExists: true,
    headSha,
    cleanCloneSummary: {
      ok: true,
      source: { mode: "tracked-head", commit: "fedcba9876543210fedcba9876543210fedcba98" },
      isolation: { cachesRootedInTemporaryDirectory: true },
      artifacts: { sourceArchiveSha256: "22".repeat(32) },
      commands: [{ label: "14-release-dry-run" }],
      cleanup: { removed: true },
    },
  });

  await assert.rejects(
    () => runReleaseQa({ evidenceRoot: path.join(root, "evidence"), sha: headSha, run }),
    (error) => error.code === "QA_RELEASE_CLEAN_CLONE_SHA_MISMATCH" && error.exitClass === 6,
  );
});
