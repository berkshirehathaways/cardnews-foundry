import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  CleanCloneError,
  createCleanCheckout,
} from "../../scripts/clean-clone-source.mjs";
import { publishArtifact } from "../../scripts/verify-clean-clone.mjs";

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
