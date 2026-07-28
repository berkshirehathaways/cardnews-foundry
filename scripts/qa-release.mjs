#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFile = promisify(execFileCallback);

export class ReleaseQaError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "ReleaseQaError";
    this.code = code;
    this.exitClass = 6;
    if (details !== undefined) this.details = details;
  }
}

const readOption = (args, name) => {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
};

const shortSha = (value) => value.slice(0, 12);

const hasHead = async (runCommand) => {
  const result = await runCommand("git", ["rev-parse", "--verify", "HEAD"], { cwd: repositoryRoot });
  if (result.code === 0) {
    const head = await runCommand("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot });
    if (head.code !== 0) {
      throw new ReleaseQaError("QA_RELEASE_HEAD_FAILED", "failed to resolve HEAD");
    }
    return { exists: true, sha: head.stdout.trim() };
  }
  if (result.code !== 128) {
    throw new ReleaseQaError("QA_RELEASE_HEAD_FAILED", "failed to probe HEAD");
  }
  return { exists: false, sha: undefined };
};

const runCommand = async (command, args, options = {}) => {
  try {
    const result = await execFile(command, args, {
      cwd: options.cwd ?? repositoryRoot,
      env: options.env ?? process.env,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    return {
      code: 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    return {
      code: error instanceof Error && typeof Reflect.get(error, "code") === "number"
        ? Reflect.get(error, "code")
        : 1,
      stdout: typeof Reflect.get(error, "stdout") === "string" ? Reflect.get(error, "stdout") : "",
      stderr: typeof Reflect.get(error, "stderr") === "string" ? Reflect.get(error, "stderr") : "",
      signal: typeof Reflect.get(error, "signal") === "string" ? Reflect.get(error, "signal") : undefined,
    };
  }
};

const parseSummary = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    throw new ReleaseQaError("QA_RELEASE_SUMMARY_INVALID", "verify:clean-clone returned malformed JSON");
  }
};

export const runReleaseQa = async ({
  evidenceRoot,
  sha: injectedSha,
  run = runCommand,
} = {}) => {
  const resolvedEvidenceRoot = path.resolve(
    evidenceRoot ?? process.env.CARDNEWS_QA_EVIDENCE_ROOT ?? path.join(repositoryRoot, ".omo", "evidence", "cardnews-foundry", "T15", "a1"),
  );
  await mkdir(resolvedEvidenceRoot, { recursive: true });
  const head = await hasHead(run);
  const sha = head.exists ? head.sha : injectedSha;
  if (!sha) {
    throw new ReleaseQaError("QA_RELEASE_SHA_REQUIRED", "an injected SHA is required before HEAD exists");
  }
  if (head.exists && injectedSha !== undefined && injectedSha.toLowerCase() !== head.sha.toLowerCase()) {
    throw new ReleaseQaError("QA_RELEASE_SHA_MISMATCH", "the injected SHA does not match HEAD");
  }

  const cleanCloneEvidenceRoot = path.join(resolvedEvidenceRoot, "clean-clone");
  const cleanClone = await run("corepack", [
    "pnpm", "verify:clean-clone", "--", "--evidence-dir", cleanCloneEvidenceRoot,
  ], { cwd: repositoryRoot });
  if (cleanClone.code !== 0) {
    throw new ReleaseQaError("QA_RELEASE_CLEAN_CLONE_FAILED", "verify:clean-clone failed");
  }

  const cleanCloneSummary = parseSummary(cleanClone.stdout);
  if (cleanCloneSummary.ok !== true) {
    throw new ReleaseQaError("QA_RELEASE_CLEAN_CLONE_FAILED", "verify:clean-clone did not report success");
  }

  const report = {
    schemaVersion: 1,
    ok: true,
    sha: sha.toLowerCase(),
    head: {
      exists: head.exists,
      source: head.exists ? "git-head" : "injected",
      commit: head.exists ? head.sha.toLowerCase() : undefined,
    },
    evidenceRoot: resolvedEvidenceRoot,
    cleanClone: {
      summaryPath: path.join(cleanCloneEvidenceRoot, "clean-clone-summary.json"),
      source: cleanCloneSummary.source,
      isolation: cleanCloneSummary.isolation,
      artifacts: cleanCloneSummary.artifacts,
      commands: cleanCloneSummary.commands,
      cleanup: cleanCloneSummary.cleanup,
    },
    gates: Array.isArray(cleanCloneSummary.commands)
      ? cleanCloneSummary.commands.map((entry) => entry.label)
      : [],
  };

  await writeFile(path.join(resolvedEvidenceRoot, "qa-release.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
};

const main = async () => {
  const args = process.argv.slice(2).filter((value) => value !== "--");
  try {
    const report = await runReleaseQa({
      evidenceRoot: readOption(args, "--evidence-dir"),
      sha: readOption(args, "--sha"),
    });
    process.stderr.write(
      `qa:release ok sha=${shortSha(report.sha)} head=${report.head.exists ? "present" : "injected"} gates=${report.gates.length}\n`
    );
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    const code = error instanceof Error && typeof Reflect.get(error, "code") === "string"
      ? Reflect.get(error, "code")
      : "QA_RELEASE_INTERNAL";
    process.stderr.write(`qa:release fail code=${code}\n`);
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code } })}\n`);
    process.exitCode = error instanceof ReleaseQaError && error.exitClass === 6 ? 6 : 1;
    if (error instanceof ReleaseQaError && error.code === "QA_RELEASE_USAGE") {
      process.exitCode = 2;
    }
  }
};

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
