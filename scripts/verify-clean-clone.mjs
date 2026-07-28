#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
  access, copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCleanCheckout } from "./clean-clone-source.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const minute = 60 * 1_000;
const defaultHardKillGraceMs = 10_000;
const defaultMaxOutputBytes = 16 * 1024 * 1024;

export const CLEAN_CLONE_SETUP_RESERVE_MS = 15 * minute;

export const createCleanCloneTemporaryRoot = ({
  platform = process.platform,
  systemTemporaryDirectory = os.tmpdir(),
} = {}) => mkdtemp(path.join(
  platform === "win32" ? systemTemporaryDirectory : "/tmp",
  "cardnews-clean-clone-",
));

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

const signalChild = (child, signal, platform) => {
  try {
    if (platform !== "win32" && child.pid !== undefined) {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch (error) {
    if (!(error instanceof Error && error.code === "ESRCH")) throw error;
  }
};

export const invokeBounded = (command, args, options) => new Promise((resolve, reject) => {
  const platform = options.platform ?? process.platform;
  const hardKillGraceMs = options.hardKillGraceMs ?? defaultHardKillGraceMs;
  const maxOutputBytes = options.maxOutputBytes ?? defaultMaxOutputBytes;
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    detached: platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  let capturedBytes = 0;
  let hardKillTimer;
  let terminationStarted = false;
  let timedOut = false;
  let outputLimitExceeded = false;
  const terminate = () => {
    if (terminationStarted) return;
    terminationStarted = true;
    signalChild(child, "SIGTERM", platform);
    hardKillTimer = setTimeout(
      () => signalChild(child, "SIGKILL", platform),
      hardKillGraceMs,
    );
  };
  const capture = (target, chunk) => {
    const remaining = Math.max(0, maxOutputBytes - capturedBytes);
    if (remaining > 0) {
      const captured = chunk.subarray(0, remaining);
      target.push(captured);
      capturedBytes += captured.byteLength;
    }
    if (chunk.byteLength > remaining) {
      outputLimitExceeded = true;
      terminate();
    }
  };
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    terminate();
  }, options.timeoutMs);
  child.stdout.on("data", (chunk) => capture(stdout, chunk));
  child.stderr.on("data", (chunk) => capture(stderr, chunk));
  child.once("error", (error) => {
    clearTimeout(timeoutTimer);
    clearTimeout(hardKillTimer);
    reject(error);
  });
  child.once("close", (code, signal) => {
    clearTimeout(timeoutTimer);
    clearTimeout(hardKillTimer);
    resolve({
      code: code ?? 1,
      signal,
      timedOut,
      outputLimitExceeded,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    });
  });
});

const run = async ({ label, command, args, checkoutRoot, environment, logs, timeoutMs }) => {
  const startedAt = new Date().toISOString();
  const result = await invokeBounded(command, args, {
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
  await publishText(log, path.join(logs, `${label}.log`));
  if (result.timedOut) {
    throw new Error(`${label} timed out after ${timeoutMs}ms`);
  }
  if (result.outputLimitExceeded) {
    throw new Error(`${label} exceeded the ${defaultMaxOutputBytes}-byte output limit`);
  }
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

export const publishArtifact = async (source, destination) => {
  const temporaryDirectory = await mkdtemp(path.join(path.dirname(destination), ".publish-"));
  const temporaryArtifact = path.join(temporaryDirectory, path.basename(destination));
  try {
    await copyFile(source, temporaryArtifact);
    await rename(temporaryArtifact, destination);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
};

export const publishText = async (value, destination) => {
  const temporaryDirectory = await mkdtemp(path.join(path.dirname(destination), ".publish-"));
  const temporaryArtifact = path.join(temporaryDirectory, path.basename(destination));
  try {
    await writeFile(temporaryArtifact, value, { flag: "wx" });
    await rename(temporaryArtifact, destination);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
};

export const createIsolatedEnvironment = ({
  source = process.env,
  isolatedRoot,
  platform = process.platform,
}) => {
  const environment = {};
  const allowed = platform === "win32"
    ? ["PATH", "CI", "GITHUB_ACTIONS", "RUNNER_OS", "RUNNER_ARCH", "SYSTEMROOT", "COMSPEC", "PATHEXT", "WINDIR"]
    : ["PATH", "CI", "GITHUB_ACTIONS", "RUNNER_OS", "RUNNER_ARCH"];
  for (const name of allowed) {
    if (source[name] !== undefined) environment[name] = source[name];
  }
  const home = path.join(isolatedRoot, "home");
  const temporary = path.join(isolatedRoot, "tmp");
  return {
    ...environment,
    HOME: home,
    USERPROFILE: home,
    TMPDIR: temporary,
    TMP: temporary,
    TEMP: temporary,
    COREPACK_HOME: path.join(isolatedRoot, "corepack"),
    PNPM_HOME: path.join(isolatedRoot, "pnpm"),
    XDG_CACHE_HOME: path.join(isolatedRoot, "cache"),
    XDG_CONFIG_HOME: path.join(isolatedRoot, "config"),
    XDG_DATA_HOME: path.join(isolatedRoot, "data"),
    XDG_STATE_HOME: path.join(isolatedRoot, "state"),
    PLAYWRIGHT_BROWSERS_PATH: path.join(isolatedRoot, "playwright"),
    CODEX_HOME: path.join(isolatedRoot, "codex"),
  };
};

export const createCleanCloneCommands = ({
  artifacts,
  skillTarget,
  sourceArchive,
  hasLint,
  platform = process.platform,
  nodeExecutable = process.execPath,
}) => {
  const commands = [
    ["01-frozen-install", "corepack", ["pnpm", "install", "--frozen-lockfile"], 10 * minute],
    [
      "02-browser-install", "corepack",
      ["pnpm", "exec", "playwright", "install", ...(platform === "linux" ? ["--with-deps"] : []), "chromium"],
      15 * minute,
    ],
    ["03-bootstrap", "corepack", ["pnpm", "verify:bootstrap"], 3 * minute],
    ["04-build", "corepack", ["pnpm", "build"], 3 * minute],
    ["05-typecheck", "corepack", ["pnpm", "typecheck"], 3 * minute],
    ["06-tests", "corepack", ["pnpm", "test:all"], 25 * minute],
    ["07-synthetic-contracts", "corepack", ["pnpm", "verify:synthetic"], 5 * minute],
    [
      "08-synthetic-full", "corepack",
      ["pnpm", "verify:synthetic-full", "--", "--output-dir", artifacts],
      8 * minute,
    ],
    ["09-two-canonical-renders", "corepack", ["pnpm", "verify:determinism"], 8 * minute],
    ["10-skill-validation", "corepack", ["pnpm", "verify:skill"], minute],
    ["10a-skill-lifecycle-tests", "corepack", ["pnpm", "test:skill"], 5 * minute],
    [
      "11-skill-install", "corepack",
      ["pnpm", "skill:install", "--", "--target", skillTarget],
      minute,
    ],
    [
      "12-skill-discovery", "corepack",
      ["pnpm", "skill:status", "--", "--target", skillTarget],
      minute,
    ],
    [
      "13-installed-runner", nodeExecutable,
      [path.join(skillTarget, "scripts", "cardnews.mjs"), "--help"],
      minute,
    ],
    [
      "14-release-dry-run", "corepack",
      [
        "pnpm", "verify:release", "--", "--dry-run",
        "--package", path.join(artifacts, "synthetic-cardnews.zip"),
        "--archive-output", sourceArchive,
      ],
      5 * minute,
    ],
  ];
  if (hasLint) {
    commands.splice(3, 0, ["03a-lint", "corepack", ["pnpm", "lint"], 3 * minute]);
  }
  return commands;
};

const verify = async () => {
  const requestedEvidence = evidenceDirectory();
  const temporaryRoot = await createCleanCloneTemporaryRoot();
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
    const environment = createIsolatedEnvironment({ isolatedRoot });
    await Promise.all([
      mkdir(artifacts),
      mkdir(environment.HOME, { recursive: true }),
      mkdir(environment.TMPDIR, { recursive: true }),
    ]);
    summary.isolation = {
      checkoutInitiallyExcludedResidue: exclusionsAbsent,
      cachesRootedInTemporaryDirectory: true,
      browserRootedInTemporaryDirectory: true,
      skillRootedInTemporaryDirectory: true,
      environmentAllowlisted: true,
      homeRootedInTemporaryDirectory: true,
    };
    const manifest = JSON.parse(await readFile(path.join(prepared.checkoutRoot, "package.json"), "utf8"));
    const commands = createCleanCloneCommands({
      artifacts,
      skillTarget,
      sourceArchive,
      hasLint: typeof manifest.scripts?.lint === "string",
    });
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
        publishArtifact(path.join(artifacts, "synthetic-cardnews.zip"), path.join(durableRoot, "synthetic-cardnews.zip")),
        publishArtifact(sourceArchive, path.join(durableRoot, "source-archive.zip")),
      ]);
    }
    summary.ok = true;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
    summary.cleanup.removed = true;
    if (requestedEvidence !== undefined) {
      await publishText(
        `${JSON.stringify(summary, null, 2)}\n`,
        path.join(durableRoot, "clean-clone-summary.json"),
      );
    }
  }
  return summary;
};

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
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
}
