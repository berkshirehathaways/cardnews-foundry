import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  CleanCloneError,
  createCleanCheckout,
} from "../../scripts/clean-clone-source.mjs";
import {
  CLEAN_CLONE_SETUP_RESERVE_MS,
  boundedFailureExcerpt,
  createCleanCloneCommands,
  createCleanCloneTemporaryRoot,
  createIsolatedEnvironment,
  createShortTemporaryRoot,
  invokeBounded,
  publishArtifact,
  publishText,
} from "../../scripts/verify-clean-clone.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const workflowPath = path.join(repositoryRoot, ".github", "workflows", "ci.yml");

const git = (root, ...args) => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

const writeFixture = async (root) => {
  await writeFile(path.join(root, ".gitignore"), "node_modules/\n.cardnews/\n.omo/\n.omx/\nevidence/\n");
  await writeFile(path.join(root, "package.json"), "{}\n");
  await mkdir(path.join(root, "bin"));
  await writeFile(path.join(root, "bin", "tool"), "#!/bin/sh\nexit 0\n");
  await chmod(path.join(root, "bin", "tool"), 0o755);
};

test("Given the runtime clean-clone command table, When its CI budget is audited, Then the 25-minute test step and every command fit inside the workflow deadline", async () => {
  const commands = createCleanCloneCommands({
    artifacts: "/isolated/artifacts",
    skillTarget: "/isolated/skill",
    sourceArchive: "/isolated/source.zip",
    hasLint: true,
    platform: "linux",
    nodeExecutable: "/isolated/node",
  });
  const testCommand = commands.find(([label]) => label === "06-tests");
  const workflow = await readFile(workflowPath, "utf8");
  const workflowMinutes = Number(workflow.match(/^\s+timeout-minutes:\s*(\d+)$/mu)?.[1]);
  const commandBudget = commands.reduce((total, command) => total + command[3], 0);

  assert.deepEqual(testCommand, [
    "06-tests", "/isolated/corepack", ["pnpm", "test:all"], 25 * 60 * 1_000,
  ]);
  assert.equal(commands[0][1], "/isolated/corepack");
  assert.ok(
    workflowMinutes * 60 * 1_000 >= commandBudget + CLEAN_CLONE_SETUP_RESERVE_MS,
    "workflow timeout must cover every child timeout plus action setup reserve",
  );
});

test("Given a caller environment containing secrets, When the clean-clone environment is built, Then only non-secret execution metadata survives under isolated roots", () => {
  const environment = createIsolatedEnvironment({
    source: {
      PATH: "/attacker-controlled/bin",
      CI: "true",
      GITHUB_ACTIONS: "true",
      SECRET_TOKEN: "must-not-cross",
      AWS_SECRET_ACCESS_KEY: "must-not-cross",
      HOME: "/Users/private",
    },
    isolatedRoot: "/isolated",
    nodeExecutable: "/trusted/node/bin/node",
    platform: "linux",
  });

  assert.equal(
    environment.PATH,
    ["/trusted/node/bin", "/usr/local/bin", "/usr/bin", "/bin"].join(path.delimiter),
  );
  assert.doesNotMatch(environment.PATH, /attacker-controlled/u);
  assert.equal(environment.CI, "true");
  assert.equal(environment.GITHUB_ACTIONS, "true");
  assert.equal(environment.SECRET_TOKEN, undefined);
  assert.equal(environment.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(environment.HOME, path.join("/isolated", "home"));
  assert.equal(environment.TMPDIR, path.join("/isolated", "tmp"));
});

test("Given a POSIX verifier under a custom temp policy, When the workspace and socket roots are allocated, Then executables honor the policy while sockets stay below 104 bytes", async (context) => {
  const policyRoot = await mkdtemp(path.join(os.tmpdir(), "cardnews-policy-"));
  const temporaryRoot = await createCleanCloneTemporaryRoot({
    systemTemporaryDirectory: policyRoot,
  });
  const policyTemporaryDirectory = path.join(temporaryRoot, "isolated", "tmp");
  await mkdir(policyTemporaryDirectory, { recursive: true });
  const shortTemporaryRoot = await createShortTemporaryRoot({
    platform: "darwin",
    target: policyTemporaryDirectory,
  });
  context.after(() => Promise.all([
    rm(policyRoot, { recursive: true, force: true }),
    rm(shortTemporaryRoot.root, { recursive: true, force: true }),
  ]));
  const environment = createIsolatedEnvironment({
    source: { PATH: process.env.PATH },
    isolatedRoot: path.join(temporaryRoot, "isolated"),
    temporaryDirectory: shortTemporaryRoot.temporaryDirectory,
    nodeExecutable: "/trusted/node/bin/node",
    platform: "darwin",
  });
  const socketPath = path.join(
    environment.TMPDIR,
    "cardnews-verify-ingest-XXXXXX",
    "socket.md",
  );

  assert.equal(temporaryRoot.startsWith(`${policyRoot}${path.sep}`), true);
  assert.equal(environment.PLAYWRIGHT_BROWSERS_PATH.startsWith(`${temporaryRoot}${path.sep}`), true);
  assert.equal(environment.TMPDIR, shortTemporaryRoot.temporaryDirectory);
  assert.equal(
    await realpath(shortTemporaryRoot.temporaryDirectory),
    await realpath(policyTemporaryDirectory),
  );
  assert.ok(Buffer.byteLength(socketPath) < 104, socketPath);
});

test("Given a child that ignores graceful termination, When its deadline expires, Then the verifier escalates to a hard bounded stop", { skip: process.platform === "win32" }, async () => {
  const startedAt = Date.now();
  const result = await invokeBounded(process.execPath, [
    "-e",
    "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)",
  ], {
    cwd: repositoryRoot,
    env: createIsolatedEnvironment({
      source: { PATH: process.env.PATH },
      isolatedRoot: path.join(os.tmpdir(), "cardnews-invoke-test"),
      nodeExecutable: process.execPath,
      platform: process.platform,
    }),
    timeoutMs: 100,
    hardKillGraceMs: 100,
    maxOutputBytes: 1024,
  });

  assert.equal(result.timedOut, true);
  assert.equal(result.signal, "SIGKILL");
  assert.ok(Date.now() - startedAt < 2_000);
});

test("Given a child that floods output, When the combined output limit is exceeded, Then capture stays bounded and the child is stopped", async () => {
  const result = await invokeBounded(process.execPath, [
    "-e",
    "process.stdout.write('x'.repeat(8192)); setInterval(() => {}, 1000)",
  ], {
    cwd: repositoryRoot,
    env: createIsolatedEnvironment({
      source: { PATH: process.env.PATH },
      isolatedRoot: path.join(os.tmpdir(), "cardnews-output-test"),
      nodeExecutable: process.execPath,
      platform: process.platform,
    }),
    timeoutMs: 5_000,
    hardKillGraceMs: 100,
    maxOutputBytes: 1024,
  });

  assert.equal(result.outputLimitExceeded, true);
  assert.ok(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) <= 1024);
});

test("Given a long failed command log, When its diagnostic is formatted, Then only a bounded tail is exposed", () => {
  const beginning = "BEGINNING_SHOULD_BE_OMITTED";
  const ending = "ENDING_SHOULD_REMAIN";
  const excerpt = boundedFailureExcerpt(
    `${beginning}${"x".repeat(9_000)}${ending}`,
    "stderr-tail",
  );

  assert.equal(excerpt.includes(beginning), false);
  assert.equal(excerpt.includes(ending), true);
  assert.equal(excerpt.includes("stderr-tail"), true);
  assert.match(excerpt, /^\[\d+ earlier characters omitted\]\n/);
  assert.ok(excerpt.length < 8_300);
});

test("Given an unborn repository with ignored private residue, When a clean checkout is created, Then source files and executable bits survive while residue is absent", async (context) => {
  // Given
  const root = await mkdtemp(path.join(os.tmpdir(), "cardnews-clean-unborn-"));
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "cardnews-clean-work-"));
  context.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(temporaryRoot, { recursive: true, force: true }),
  ]));
  git(root, "init", "-q");
  await writeFixture(root);
  for (const relative of ["node_modules/hidden", ".cardnews/jobs/private", ".omo/evidence", "evidence/log"]) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), "private\n");
  }

  // When
  const prepared = await createCleanCheckout({ repositoryRoot: root, temporaryRoot });

  // Then
  assert.equal(prepared.mode, "pre-head-snapshot");
  assert.match(prepared.sourceCommit, /^[a-f0-9]{40}$/u);
  assert.equal(await readFile(path.join(prepared.checkoutRoot, "package.json"), "utf8"), "{}\n");
  assert.notEqual((await stat(path.join(prepared.checkoutRoot, "bin", "tool"))).mode & 0o111, 0);
  for (const relative of ["node_modules/hidden", ".cardnews/jobs/private", ".omo/evidence", "evidence/log"]) {
    await assert.rejects(stat(path.join(prepared.checkoutRoot, relative)), { code: "ENOENT" });
  }
});

test("Given a clean repository with HEAD and ignored local caches, When a clean checkout is created, Then it is detached at the exact tracked commit", async (context) => {
  // Given
  const root = await mkdtemp(path.join(os.tmpdir(), "cardnews-clean-head-"));
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "cardnews-clean-work-"));
  context.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(temporaryRoot, { recursive: true, force: true }),
  ]));
  git(root, "init", "-q", "-b", "main");
  await writeFixture(root);
  git(root, "add", ".");
  git(root, "-c", "user.name=Clean Clone Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture");
  const expected = git(root, "rev-parse", "HEAD");
  await mkdir(path.join(root, "node_modules"));
  await writeFile(path.join(root, "node_modules", "hidden"), "cache\n");

  // When
  const prepared = await createCleanCheckout({ repositoryRoot: root, temporaryRoot });

  // Then
  assert.equal(prepared.mode, "tracked-head");
  assert.equal(prepared.sourceCommit, expected);
  assert.equal(git(prepared.checkoutRoot, "rev-parse", "HEAD"), expected);
  assert.equal(git(prepared.checkoutRoot, "status", "--porcelain=v1"), "");
  await assert.rejects(stat(path.join(prepared.checkoutRoot, "node_modules", "hidden")), { code: "ENOENT" });
});

for (const [name, mutate] of [
  ["modified tracked file", (root) => writeFile(path.join(root, "package.json"), "{\"dirty\":true}\n")],
  ["untracked releasable file", (root) => writeFile(path.join(root, "publish-me.txt"), "untracked\n")],
]) {
  test(`Given HEAD with a ${name}, When clean checkout preparation runs, Then it fails closed`, async (context) => {
    // Given
    const root = await mkdtemp(path.join(os.tmpdir(), "cardnews-clean-dirty-"));
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "cardnews-clean-work-"));
    context.after(() => Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(temporaryRoot, { recursive: true, force: true }),
    ]));
    git(root, "init", "-q", "-b", "main");
    await writeFixture(root);
    git(root, "add", ".");
    git(root, "-c", "user.name=Clean Clone Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture");
    await mutate(root);

    // When / Then
    await assert.rejects(
      createCleanCheckout({ repositoryRoot: root, temporaryRoot }),
      (error) => error instanceof CleanCloneError && error.code === "CLEAN_CLONE_DIRTY",
    );
  });
}

test("Given a prior read-only clean-clone artifact, When publication reruns, Then it replaces the exact artifact bytes", async (context) => {
  // Given
  const root = await mkdtemp(path.join(os.tmpdir(), "cardnews-clean-publish-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source.zip");
  const destination = path.join(root, "synthetic-cardnews.zip");
  const expected = Buffer.from("second deterministic synthetic artifact");
  await writeFile(source, expected);
  await writeFile(destination, "first artifact");
  await chmod(destination, 0o444);

  // When
  await publishArtifact(source, destination);

  // Then
  assert.deepEqual(await readFile(destination), expected);
  assert.deepEqual((await readdir(root)).filter((entry) => entry.startsWith(".publish-")), []);
});

test("Given an attacker-controlled evidence symlink, When publication reruns, Then it replaces the link without changing its target", async (context) => {
  // Given
  const root = await mkdtemp(path.join(os.tmpdir(), "cardnews-clean-publish-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source.zip");
  const destination = path.join(root, "synthetic-cardnews.zip");
  const target = path.join(root, "attacker-target.zip");
  const expected = Buffer.from("replacement deterministic synthetic artifact");
  await writeFile(source, expected);
  await writeFile(target, "attacker-owned bytes");
  await symlink(target, destination);

  // When
  await publishArtifact(source, destination);

  // Then
  assert.deepEqual(await readFile(destination), expected);
  assert.equal(await readFile(target, "utf8"), "attacker-owned bytes");
  assert.equal((await lstat(destination)).isSymbolicLink(), false);
  assert.deepEqual((await readdir(root)).filter((entry) => entry.startsWith(".publish-")), []);
});

test("Given an attacker-controlled JSON evidence symlink, When text publication reruns, Then it replaces the link without changing its target", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cardnews-clean-publish-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const destination = path.join(root, "qa-release.json");
  const target = path.join(root, "attacker-target.json");
  const expected = "{\"ok\":true}\n";
  await writeFile(target, "attacker-owned bytes");
  await symlink(target, destination);

  await publishText(expected, destination);

  assert.equal(await readFile(destination, "utf8"), expected);
  assert.equal(await readFile(target, "utf8"), "attacker-owned bytes");
  assert.equal((await lstat(destination)).isSymbolicLink(), false);
  assert.deepEqual((await readdir(root)).filter((entry) => entry.startsWith(".publish-")), []);
});
