#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

class LifecycleError extends Error {}

const sourceRepository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceSkill = path.join(sourceRepository, "skill", "cardnews-foundry");
const excludedIdentityNames = new Set([".cardnews", ".git", ".openchrome", "node_modules"]);

const parseArguments = () => {
  const command = process.argv[2];
  let target;
  let replace = false;
  let trash = false;
  for (let index = 3; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (argument === "--") {
      continue;
    } else if (argument === "--target") {
      target = process.argv[index + 1];
      index += 1;
    } else if (argument === "--replace") {
      replace = true;
    } else if (argument === "--trash") {
      trash = true;
    } else {
      throw new LifecycleError(`unknown argument: ${argument}`);
    }
  }
  if (!["install", "status", "update", "uninstall"].includes(command ?? "")) {
    throw new LifecycleError("usage: skill-lifecycle.mjs install|status|update|uninstall --target <path>");
  }
  if (target === undefined) {
    throw new LifecycleError("--target is required");
  }
  return { command, target: path.resolve(target), replace, trash };
};

const pathState = async (target) => {
  try {
    return await lstat(target);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
};

const run = (command, args, cwd, label, accepted = [0]) => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (!accepted.includes(result.status ?? 1)) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    throw new LifecycleError(`${label}: ${detail}`);
  }
  return result.stdout.trim();
};

const inspectVerifiedTarget = async (target) => {
  const state = await pathState(target);
  if (state === undefined || !state.isSymbolicLink()) {
    throw new LifecycleError(`${target} is not a verified cardnews-foundry skill symlink`);
  }
  let skill;
  try {
    skill = await realpath(target);
  } catch {
    throw new LifecycleError(`${target} is not a verified cardnews-foundry skill symlink`);
  }
  const repository = path.resolve(skill, "../..");
  const expectedSkill = path.join(repository, "skill", "cardnews-foundry");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(repository, "package.json"), "utf8"));
    await readFile(path.join(skill, "SKILL.md"), "utf8");
  } catch {
    throw new LifecycleError(`${target} is not a verified cardnews-foundry skill symlink`);
  }
  if (skill !== expectedSkill || manifest.name !== "cardnews-foundry") {
    throw new LifecycleError(`${target} is not a verified cardnews-foundry skill symlink`);
  }
  return { repository, skill };
};

const install = async ({ target, replace }) => {
  const state = await pathState(target);
  if (state !== undefined) {
    if (!replace) throw new LifecycleError(`${target} already exists; refusing to overwrite`);
    const verified = await inspectVerifiedTarget(target);
    if (verified.skill !== await realpath(sourceSkill)) {
      throw new LifecycleError(`${target} does not point to this repository skill; refusing to replace`);
    }
    await unlink(target);
  }
  await mkdir(path.dirname(target), { recursive: true });
  await symlink(await realpath(sourceSkill), target);
  process.stdout.write(`installed ${target}\n`);
};

const identityFiles = async (root, relative = "") => {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (excludedIdentityNames.has(entry.name)) continue;
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await identityFiles(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
};

const repositoryIdentity = async (repository) => {
  const head = spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: repository, encoding: "utf8" });
  if (head.status === 0) return `SHA ${head.stdout.trim()}`;
  const hash = createHash("sha256");
  for (const relative of await identityFiles(repository)) {
    hash.update(relative);
    hash.update("\0");
    hash.update(await readFile(path.join(repository, relative)));
    hash.update("\0");
  }
  return `content sha256:${hash.digest("hex")}`;
};

const status = async ({ target }) => {
  const verified = await inspectVerifiedTarget(target);
  process.stdout.write(`discovered ${target}\nresolved repository ${await repositoryIdentity(verified.repository)}\n`);
};

const update = async ({ target }) => {
  const { repository, skill } = await inspectVerifiedTarget(target);
  const dirty = run("git", ["status", "--porcelain=v1", "--untracked-files=all"], repository, "inspect worktree");
  if (dirty !== "") throw new LifecycleError("repository is dirty; update made no branch or worktree change");
  const branch = run("git", ["symbolic-ref", "--short", "HEAD"], repository, "read current branch");
  const upstream = run(
    "git",
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    repository,
    "tracking remote is required",
  );
  const remote = upstream.split("/", 1)[0];
  const mergeReference = run("git", ["config", `branch.${branch}.merge`], repository, "read tracking branch");
  const remoteUrl = run("git", ["remote", "get-url", remote], repository, "read tracking remote");
  const localHead = run("git", ["rev-parse", "HEAD"], repository, "read local SHA");
  const preflightRoot = await mkdtemp(path.join(os.tmpdir(), "cardnews-update-preflight-"));
  const preflightRepository = path.join(preflightRoot, "repository.git");
  let remoteHead;
  try {
    run("git", ["init", "--bare", preflightRepository], repository, "initialize update preflight");
    run("git", ["fetch", repository, localHead], preflightRepository, "copy local update base");
    run("git", ["update-ref", "refs/heads/local", localHead], preflightRepository, "set local update base");
    run("git", ["fetch", remoteUrl, mergeReference], preflightRepository, "inspect tracking remote");
    remoteHead = run("git", ["rev-parse", "FETCH_HEAD"], preflightRepository, "read tracking SHA");
    const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", localHead, remoteHead], {
      cwd: preflightRepository,
      encoding: "utf8",
    });
    if (ancestor.status !== 0) {
      throw new LifecycleError("tracking branch cannot be applied as a fast-forward; repository metadata and worktree were preserved");
    }
  } finally {
    await rm(preflightRoot, { recursive: true, force: true });
  }
  run("git", ["fetch", remote, `${remoteHead}:refs/remotes/${upstream}`], repository, "fetch verified fast-forward");
  run("git", ["merge", "--ff-only", remoteHead], repository, "fast-forward update");
  run("corepack", ["pnpm", "install", "--frozen-lockfile"], repository, "frozen install");
  process.stdout.write("frozen install: passed\n");
  run("corepack", ["pnpm", "build"], repository, "build");
  process.stdout.write("build: passed\n");
  const validator = path.join(sourceRepository, "scripts", "validate-skill.mjs");
  run(process.execPath, [validator, skill], repository, "skill validation");
  process.stdout.write(`skill validation: passed\nupdated ${repository} to ${run("git", ["rev-parse", "HEAD"], repository, "read updated SHA")}\n`);
};

const uninstall = async ({ target, trash }) => {
  await inspectVerifiedTarget(target);
  if (!trash) throw new LifecycleError("uninstall requires --trash for recoverable removal");
  const trashDirectory = path.join(os.homedir(), ".Trash");
  await mkdir(trashDirectory, { recursive: true });
  const destination = path.join(trashDirectory, `cardnews-foundry-${Date.now()}-${process.pid}`);
  await rename(target, destination);
  process.stdout.write(`uninstalled to ${destination}\n`);
};

const main = async () => {
  const options = parseArguments();
  if (options.command === "install") await install(options);
  else if (options.command === "status") await status(options);
  else if (options.command === "update") await update(options);
  else await uninstall(options);
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
