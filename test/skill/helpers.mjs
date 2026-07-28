import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const lifecycleScript = path.join(repositoryRoot, "scripts", "skill-lifecycle.mjs");

export const run = (command, args, options = {}) =>
  spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
  });

export const git = (cwd, ...args) => {
  const result = run("git", args, { cwd });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

export const writeSkill = async (root, marker = "initial") => {
  const skill = path.join(root, "skill", "cardnews-foundry");
  await mkdir(path.join(skill, "agents"), { recursive: true });
  await writeFile(
    path.join(skill, "SKILL.md"),
    `---\nname: cardnews-foundry\ndescription: ${marker} cardnews workflow skill.\n---\n\n# Cardnews Foundry\n`,
  );
  await writeFile(
    path.join(skill, "agents", "openai.yaml"),
    'interface:\n  display_name: "Cardnews Foundry"\n  short_description: "Turn articles into validated local cardnews packages"\n  default_prompt: "Use $cardnews-foundry to create a cardnews package."\n',
  );
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "cardnews-foundry",
      version: "0.0.0",
      private: true,
      scripts: { build: "node -e \"process.stdout.write('built\\\\n')\"" },
    }),
  );
  await writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n");
  return skill;
};

export const initRepository = async (root, marker = "initial") => {
  await writeSkill(root, marker);
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Skill Test");
  git(root, "config", "user.email", "skill-test@example.invalid");
  git(root, "add", ".");
  git(root, "commit", "-m", marker);
};

export const createRemoteFixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cardnews-skill-remote-"));
  const bare = path.join(root, "remote.git");
  const seed = path.join(root, "seed");
  const work = path.join(root, "work");
  git(root, "init", "--bare", bare);
  await mkdir(seed);
  await initRepository(seed);
  git(seed, "remote", "add", "origin", bare);
  git(seed, "push", "-u", "origin", "main");
  git(bare, "symbolic-ref", "HEAD", "refs/heads/main");
  git(root, "clone", bare, work);
  git(work, "config", "user.name", "Skill Test");
  git(work, "config", "user.email", "skill-test@example.invalid");
  return { root, bare, seed, work };
};

export const linkTarget = async (repo, target) => {
  await mkdir(path.dirname(target), { recursive: true });
  await symlink(path.join(repo, "skill", "cardnews-foundry"), target);
};

export const invokeLifecycle = (command, target, env = {}) =>
  run(process.execPath, [lifecycleScript, command, "--", "--target", target, ...(command === "uninstall" ? ["--trash"] : [])], { env });

export const snapshot = async (repo) => ({
  head: git(repo, "rev-parse", "HEAD"),
  status: git(repo, "status", "--porcelain=v1", "--untracked-files=all"),
  refs: git(repo, "show-ref"),
  fetchHead: await readFile(path.join(repo, ".git", "FETCH_HEAD"), "utf8").catch((error) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }),
  skill: await readFile(path.join(repo, "skill", "cardnews-foundry", "SKILL.md"), "utf8"),
});
