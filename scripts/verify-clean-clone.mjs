#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
  access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCleanCheckout } from "./clean-clone-source.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const evidenceDirectory = () => {
  const args = process.argv.slice(2).filter((value) => value !== "--");
  const index = args.indexOf("--evidence-dir");
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || args.length !== 2) {
    throw new TypeError("usage: verify-clean-clone.mjs [--evidence-dir <path>]");
  }
  return path.resolve(value);
};

const invoke = (command, args, options) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  const timer = setTimeout(() => child.kill("SIGTERM"), options.timeoutMs);
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  child.once("error", (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.once("close", (code, signal) => {
    clearTimeout(timer);
    resolve({
      code: code ?? 1,
      signal,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    });
  });
});

const run = async ({ label, command, args, checkoutRoot, environment, logs, timeoutMs }) => {
  const startedAt = new Date().toISOString();
  const result = await invoke(command, args, {
    cwd: checkoutRoot,
    env: environment,
    timeoutMs,
  });
  const log = [
    `$ ${command} ${args.join(" ")}`,
    result.stdout,
    result.stderr,
    `exit=${result.code} signal=${result.signal ?? "none"}`,
  ].join("\n");
  await writeFile(path.join(logs, `${label}.log`), log);
  if (result.code !== 0) {
    throw new Error(`${label} failed with exit ${result.code}`);
  }
  return {
    label,
    command: [command, ...args],
    startedAt,
    completedAt: new Date().toISOString(),
    exitCode: result.code,
    stdout: result.stdout,
  };
};

const absent = async (target) => access(target).then(() => false).catch((error) => {
  if (error instanceof Error && error.code === "ENOENT") return true;
  throw error;
});

const verify = async () => {
  const requestedEvidence = evidenceDirectory();
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "cardnews-clean-clone-"));
  const durableRoot = requestedEvidence ?? path.join(temporaryRoot, "evidence");
  const logs = path.join(durableRoot, "logs");
  await mkdir(logs, { recursive: true });
  const summary = {
    schemaVersion: 1,
    ok: false,
    source: null,
    isolation: null,
    commands: [],
    artifacts: null,
    cleanup: { temporaryRoot, removed: false },
  };
  try {
    const prepared = await createCleanCheckout({ repositoryRoot, temporaryRoot });
    summary.source = {
      mode: prepared.mode,
      commit: prepared.sourceCommit,
      checkoutRoot: prepared.checkoutRoot,
    };
    const excluded = [
      "node_modules", ".cardnews", ".omo", ".omx", ".openchrome", "evidence",
    ];
    const exclusionsAbsent = (await Promise.all(excluded.map(
      (entry) => absent(path.join(prepared.checkoutRoot, entry)),
    ))).every(Boolean);
    if (!exclusionsAbsent) throw new Error("clean checkout contains ignored or private residue");
    const isolatedRoot = path.join(temporaryRoot, "isolated");
    const artifacts = path.join(temporaryRoot, "artifacts");
    const skillTarget = path.join(isolatedRoot, "codex", "skills", "cardnews-foundry");
    const sourceArchive = path.join(artifacts, "source-archive.zip");
    await Promise.all([mkdir(isolatedRoot), mkdir(artifacts)]);
    const environment = {
      ...process.env,
      COREPACK_HOME: path.join(isolatedRoot, "corepack"),
      PNPM_HOME: path.join(isolatedRoot, "pnpm"),
      XDG_CACHE_HOME: path.join(isolatedRoot, "cache"),
      XDG_DATA_HOME: path.join(isolatedRoot, "data"),
      XDG_STATE_HOME: path.join(isolatedRoot, "state"),
      PLAYWRIGHT_BROWSERS_PATH: path.join(isolatedRoot, "playwright"),
      CODEX_HOME: path.join(isolatedRoot, "codex"),
    };
    summary.isolation = {
      checkoutInitiallyExcludedResidue: exclusionsAbsent,
      cachesRootedInTemporaryDirectory: true,
      browserRootedInTemporaryDirectory: true,
      skillRootedInTemporaryDirectory: true,
    };
    const commands = [
      ["01-frozen-install", "corepack", ["pnpm", "install", "--frozen-lockfile"], 600_000],
      [
        "02-browser-install", "corepack",
        ["pnpm", "exec", "playwright", "install", ...(process.platform === "linux" ? ["--with-deps"] : []), "chromium"],
        900_000,
      ],
      ["03-bootstrap", "corepack", ["pnpm", "verify:bootstrap"], 180_000],
      ["04-build", "corepack", ["pnpm", "build"], 180_000],
      ["05-typecheck", "corepack", ["pnpm", "typecheck"], 180_000],
      ["06-tests", "corepack", ["pnpm", "test:all"], 900_000],
      ["07-synthetic-contracts", "corepack", ["pnpm", "verify:synthetic"], 300_000],
      [
        "08-synthetic-full", "corepack",
        ["pnpm", "verify:synthetic-full", "--", "--output-dir", artifacts],
        480_000,
      ],
      ["09-two-canonical-renders", "corepack", ["pnpm", "verify:determinism"], 480_000],
      ["10-skill-validation", "corepack", ["pnpm", "verify:skill"], 60_000],
      ["10a-skill-lifecycle-tests", "corepack", ["pnpm", "test:skill"], 300_000],
      [
        "11-skill-install", "corepack",
        ["pnpm", "skill:install", "--", "--target", skillTarget],
        60_000,
      ],
      [
        "12-skill-discovery", "corepack",
        ["pnpm", "skill:status", "--", "--target", skillTarget],
        60_000,
      ],
      [
        "13-installed-runner", process.execPath,
        [path.join(skillTarget, "scripts", "cardnews.mjs"), "--help"],
        60_000,
      ],
      [
        "14-release-dry-run", "corepack",
        [
          "pnpm", "verify:release", "--", "--dry-run",
          "--package", path.join(artifacts, "synthetic-cardnews.zip"),
          "--archive-output", sourceArchive,
        ],
        300_000,
      ],
    ];
    const manifest = JSON.parse(await readFile(path.join(prepared.checkoutRoot, "package.json"), "utf8"));
    if (typeof manifest.scripts?.lint === "string") {
      commands.splice(3, 0, ["03a-lint", "corepack", ["pnpm", "lint"], 180_000]);
    }
    for (const [label, command, args, timeoutMs] of commands) {
      const result = await run({
        label, command, args, checkoutRoot: prepared.checkoutRoot,
        environment, logs, timeoutMs,
      });
      summary.commands.push({
        label: result.label,
        command: result.command,
        startedAt: result.startedAt,
        completedAt: result.completedAt,
        exitCode: result.exitCode,
      });
    }
    const synthetic = JSON.parse(summary.commands.length === 0
      ? "{}"
      : (await readFile(path.join(logs, "08-synthetic-full.log"), "utf8"))
        .split("\n").find((line) => line.startsWith("{\"ok\":true")) ?? "{}");
    const releaseLog = await readFile(path.join(logs, "14-release-dry-run.log"), "utf8");
    const release = JSON.parse(
      releaseLog.split("\n").find((line) => line.startsWith("{\"ok\":true")) ?? "{}",
    );
    if (
      synthetic.ok !== true ||
      release.ok !== true ||
      release.generatedPackage?.ok !== true ||
      release.sourceArchive?.executablePaths?.includes("bin/cardnews") !== true
    ) {
      throw new Error("artifact reports do not prove package and source archive verification");
    }
    summary.artifacts = {
      syntheticPackageSha256: synthetic.packageSha256,
      sourceArchiveSha256: release.sourceArchive.sha256,
      canonicalRenderDigestMatched: true,
      generatedPackageInspected: true,
      executablePathPreserved: "bin/cardnews",
    };
    if (requestedEvidence !== undefined) {
      await Promise.all([
        copyFile(path.join(artifacts, "synthetic-cardnews.zip"), path.join(durableRoot, "synthetic-cardnews.zip")),
        copyFile(sourceArchive, path.join(durableRoot, "source-archive.zip")),
      ]);
    }
    summary.ok = true;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
    summary.cleanup.removed = true;
    if (requestedEvidence !== undefined) {
      await writeFile(path.join(durableRoot, "clean-clone-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    }
  }
  return summary;
};

try {
  process.stdout.write(`${JSON.stringify(await verify())}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: "CLEAN_CLONE_FAILED",
    message: error instanceof Error ? error.message : "unknown failure",
  })}\n`);
  process.exitCode = 1;
}
