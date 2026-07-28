import { execFile as execFileCallback } from "node:child_process";
import { copyFile, lstat, mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export class CleanCloneError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CleanCloneError";
    this.code = code;
  }
}

const git = async (root, args, options = {}) => {
  try {
    const result = await execFile("git", args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      ...options,
    });
    return result.stdout.trim();
  } catch (error) {
    const detail = error instanceof Error && typeof error.stderr === "string"
      ? error.stderr.trim()
      : "git command failed";
    throw new CleanCloneError("CLEAN_CLONE_GIT", detail);
  }
};

const hasHead = async (root) => {
  try {
    await execFile("git", ["rev-parse", "--verify", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 1024,
    });
    return true;
  } catch (error) {
    if (error instanceof Error && error.code === 128) return false;
    throw error;
  }
};

const inventory = async (root) => {
  const output = await git(root, [
    "ls-files", "--cached", "--others", "--exclude-standard", "-z",
  ]);
  return output.split("\0").filter((entry) => entry.length > 0);
};

const copyInventory = async (sourceRoot, snapshotRoot) => {
  const files = await inventory(sourceRoot);
  if (files.length === 0) {
    throw new CleanCloneError("CLEAN_CLONE_EMPTY", "source inventory is empty");
  }
  for (const relative of files) {
    const source = path.join(sourceRoot, relative);
    const metadata = await lstat(source);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new CleanCloneError(
        "CLEAN_CLONE_SOURCE_TYPE",
        `source inventory must contain regular files only: ${relative}`,
      );
    }
    const destination = path.join(snapshotRoot, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
};

const commitSnapshot = async (repositoryRoot, snapshotRoot) => {
  await mkdir(snapshotRoot, { recursive: true });
  await git(snapshotRoot, ["init", "-q", "-b", "snapshot"]);
  await copyInventory(repositoryRoot, snapshotRoot);
  await git(snapshotRoot, ["add", "--all"]);
  const identity = [
    "-c", "user.name=cardnews-foundry clean clone",
    "-c", "user.email=clean-clone@example.invalid",
  ];
  await git(snapshotRoot, [
    ...identity,
    "commit", "-qm", "Create clean-clone source snapshot",
  ], {
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
    },
  });
  return git(snapshotRoot, ["rev-parse", "HEAD"]);
};

const requireCleanHead = async (repositoryRoot) => {
  const status = await git(repositoryRoot, [
    "status", "--porcelain=v1", "--untracked-files=all",
  ]);
  if (status !== "") {
    throw new CleanCloneError(
      "CLEAN_CLONE_DIRTY",
      "tracked HEAD verification requires no modified or untracked releasable files",
    );
  }
  return git(repositoryRoot, ["rev-parse", "HEAD"]);
};

const cloneCommit = async ({ sourceRoot, checkoutRoot, sourceCommit }) => {
  await git(path.dirname(checkoutRoot), [
    "clone", "--quiet", "--no-hardlinks", "--no-checkout", sourceRoot, checkoutRoot,
  ]);
  await git(checkoutRoot, ["checkout", "--quiet", "--detach", sourceCommit]);
  const actual = await git(checkoutRoot, ["rev-parse", "HEAD"]);
  if (actual !== sourceCommit) {
    throw new CleanCloneError("CLEAN_CLONE_SHA", "clean checkout does not match its source commit");
  }
};

export const createCleanCheckout = async ({ repositoryRoot, temporaryRoot }) => {
  const tracked = await hasHead(repositoryRoot);
  const sourceRoot = tracked ? repositoryRoot : path.join(temporaryRoot, "source-snapshot");
  const sourceCommit = tracked
    ? await requireCleanHead(repositoryRoot)
    : await commitSnapshot(repositoryRoot, sourceRoot);
  const checkoutRoot = path.join(temporaryRoot, "checkout");
  await cloneCommit({ sourceRoot, checkoutRoot, sourceCommit });
  return {
    mode: tracked ? "tracked-head" : "pre-head-snapshot",
    sourceCommit,
    checkoutRoot,
  };
};
