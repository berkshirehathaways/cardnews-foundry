import assert from "node:assert/strict";
import { access, lstat, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createRemoteFixture,
  git,
  initRepository,
  invokeLifecycle,
  lifecycleScript,
  linkTarget,
  repositoryRoot,
  run,
  snapshot,
} from "./helpers.mjs";

test("install creates one repository skill symlink and refuses a silent overwrite", async (context) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "cardnews-skill-install-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const target = path.join(home, ".codex", "skills", "cardnews-foundry");

  const installed = invokeLifecycle("install", target);
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(installed.stdout, /^installed /u);
  assert.equal(await readlink(target), path.join(repositoryRoot, "skill", "cardnews-foundry"));

  const repeated = invokeLifecycle("install", target);
  assert.notEqual(repeated.status, 0);
  assert.match(repeated.stderr, /already exists/u);
  assert.equal(await readlink(target), path.join(repositoryRoot, "skill", "cardnews-foundry"));
});

test("status discovers a committed repository and reports its exact resolved SHA", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cardnews-skill-status-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo");
  const target = path.join(root, "skills", "cardnews-foundry");
  await initRepository(repo);
  await linkTarget(repo, target);

  const result = invokeLifecycle("status", target);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^discovered /mu);
  assert.match(result.stdout, new RegExp(`resolved repository SHA ${git(repo, "rev-parse", "HEAD")}`, "u"));
});

test("status reports a deterministic content identity before the first commit", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cardnews-skill-unborn-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo");
  const target = path.join(root, "skills", "cardnews-foundry");
  await import("./helpers.mjs").then(({ writeSkill }) => writeSkill(repo));
  git(repo, "init", "-b", "main");
  await linkTarget(repo, target);

  const first = invokeLifecycle("status", target);
  const second = invokeLifecycle("status", target);

  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.match(first.stdout, /resolved repository content sha256:[a-f0-9]{64}/u);
  assert.equal(first.stdout, second.stdout);
});

test("installed runner resolves through the skill symlink and invokes the repository CLI", async (context) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "cardnews-skill-runner-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const target = path.join(home, ".codex", "skills", "cardnews-foundry");
  const installed = invokeLifecycle("install", target);
  assert.equal(installed.status, 0, installed.stderr);

  const result = run(path.join(target, "scripts", "cardnews.mjs"), ["--help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Usage: cardnews <command>/u);
  assert.match(result.stdout, /scaffold-record/u);
});

test("update fast-forwards a clean tracking checkout then runs frozen install, build, and skill validation", async (context) => {
  const fixture = await createRemoteFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const target = path.join(fixture.root, "skills", "cardnews-foundry");
  await linkTarget(fixture.work, target);
  await writeFile(path.join(fixture.seed, "skill", "cardnews-foundry", "SKILL.md"), `${await readFile(path.join(fixture.seed, "skill", "cardnews-foundry", "SKILL.md"), "utf8")}\nUpdated.\n`);
  git(fixture.seed, "add", ".");
  git(fixture.seed, "commit", "-m", "remote update");
  git(fixture.seed, "push");
  const expected = git(fixture.seed, "rev-parse", "HEAD");

  const result = invokeLifecycle("update", target);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /updated /u);
  assert.match(result.stdout, /frozen install: passed/u);
  assert.match(result.stdout, /build: passed/u);
  assert.match(result.stdout, /skill validation: passed/u);
  assert.equal(git(fixture.work, "rev-parse", "HEAD"), expected);
  context.diagnostic(JSON.stringify({
    scenario: "temporary local bare remote fast-forward",
    invocation: `node ${lifecycleScript} update --target ${target}`,
    before: git(fixture.work, "rev-parse", "HEAD^"),
    after: expected,
    observable: "frozen install, build, validation, and fast-forward all passed",
  }));
});

test("update rejects dirty, remote-less, and divergent repositories without changing HEAD or worktree", async (context) => {
  const fixture = await createRemoteFixture();
  const remoteLess = path.join(fixture.root, "remote-less");
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const target = path.join(fixture.root, "skills", "cardnews-foundry");
  await linkTarget(fixture.work, target);

  await writeFile(path.join(fixture.work, "dirty.txt"), "dirty");
  const dirtyBefore = await snapshot(fixture.work);
  const dirty = invokeLifecycle("update", target);
  assert.notEqual(dirty.status, 0);
  assert.match(dirty.stderr, /dirty/u);
  assert.deepEqual(await snapshot(fixture.work), dirtyBefore);
  context.diagnostic(JSON.stringify({
    scenario: "dirty checkout rejection",
    before: dirtyBefore,
    after: await snapshot(fixture.work),
    observable: "nonzero exit with identical HEAD, status, and skill bytes",
  }));
  await rm(path.join(fixture.work, "dirty.txt"));

  await initRepository(remoteLess);
  const remoteLessTarget = path.join(fixture.root, "remote-less-skills", "cardnews-foundry");
  await linkTarget(remoteLess, remoteLessTarget);
  const remoteLessBefore = await snapshot(remoteLess);
  const missingRemote = invokeLifecycle("update", remoteLessTarget);
  assert.notEqual(missingRemote.status, 0);
  assert.match(missingRemote.stderr, /tracking remote/u);
  assert.deepEqual(await snapshot(remoteLess), remoteLessBefore);
  context.diagnostic(JSON.stringify({
    scenario: "remote-less checkout rejection",
    before: remoteLessBefore,
    after: await snapshot(remoteLess),
    observable: "nonzero exit with identical HEAD, status, and skill bytes",
  }));

  await writeFile(path.join(fixture.work, "local.txt"), "local");
  git(fixture.work, "add", ".");
  git(fixture.work, "commit", "-m", "local");
  await writeFile(path.join(fixture.seed, "remote.txt"), "remote");
  git(fixture.seed, "add", ".");
  git(fixture.seed, "commit", "-m", "remote");
  git(fixture.seed, "push");
  const divergentBefore = await snapshot(fixture.work);
  const divergent = invokeLifecycle("update", target);
  assert.notEqual(divergent.status, 0);
  assert.match(divergent.stderr, /fast-forward/u);
  assert.deepEqual(await snapshot(fixture.work), divergentBefore);
  context.diagnostic(JSON.stringify({
    scenario: "divergent checkout rejection",
    before: divergentBefore,
    after: await snapshot(fixture.work),
    observable: "nonzero exit with identical HEAD, status, and skill bytes",
  }));
});

test("uninstall trashes only a verified symlink and preserves repository jobs", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cardnews-skill-uninstall-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo");
  const target = path.join(root, "home", ".codex", "skills", "cardnews-foundry");
  const jobs = path.join(repo, ".cardnews", "jobs", "keep.txt");
  await initRepository(repo);
  await writeFile(jobs, "keep", { flag: "w" }).catch(async () => {
    await import("node:fs/promises").then(({ mkdir }) => mkdir(path.dirname(jobs), { recursive: true }));
    await writeFile(jobs, "keep");
  });
  await linkTarget(repo, target);

  const result = invokeLifecycle("uninstall", target, { HOME: path.join(root, "home") });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^uninstalled /u);
  await assert.rejects(lstat(target), { code: "ENOENT" });
  assert.equal(await readFile(jobs, "utf8"), "keep");
  const trashPath = result.stdout.trim().replace(/^uninstalled to /u, "");
  assert.equal((await lstat(trashPath)).isSymbolicLink(), true);
  assert.equal(await readlink(trashPath), path.join(repo, "skill", "cardnews-foundry"));
  context.diagnostic(JSON.stringify({
    scenario: "trash uninstall",
    trashPath,
    repositoryJob: jobs,
    observable: "verified symlink moved and repository job bytes remained keep",
  }));
});

test("uninstall refuses regular files and unrelated symlinks", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cardnews-skill-refuse-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const regular = path.join(root, "regular");
  const unrelated = path.join(root, "unrelated");
  await writeFile(regular, "keep");
  await import("node:fs/promises").then(({ symlink }) => symlink(regular, unrelated));

  for (const target of [regular, unrelated]) {
    const result = run(process.execPath, [lifecycleScript, "uninstall", "--target", target, "--trash"], {
      env: { HOME: root },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /verified cardnews-foundry skill symlink/u);
    await access(target);
  }
});
