import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const jobs = await import("../../src/jobs/index.ts");

const exists = async (target) => {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
};

const writeRevision = async (root, id, { slug, revision, parentJobId }) => {
  await mkdir(path.join(root, id, "records"), { recursive: true });
  await mkdir(path.join(root, id, "source"), { recursive: true });
  await mkdir(path.join(root, id, "render", "cards"), { recursive: true });
  await mkdir(path.join(root, id, "assets"), { recursive: true });
  await mkdir(path.join(root, id, "package"), { recursive: true });
  await writeFile(path.join(root, id, "records", "storyboard.json"), "{}");
  await writeFile(path.join(root, id, "source", "envelope.json"), "{}");
  await writeFile(path.join(root, id, "render", "cards", "card-1.png"), "png");
  await writeFile(path.join(root, id, "assets", "asset.png"), "img");
  await writeFile(path.join(root, id, "package", "bundle.zip"), "zip");
  const head = {
    schemaVersion: 1,
    jobId: id,
    slug,
    revision,
    ...(parentJobId === undefined ? {} : { parentJobId }),
    stages: {}
  };
  await writeFile(path.join(root, id, "head.json"), JSON.stringify(head));
};

const lineage = async (context, prefix) => {
  const root = await mkdtemp(path.join(os.tmpdir(), `cardnews-prune-${prefix}-`));
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeRevision(root, "story-aaa", { slug: "story", revision: 0 });
  await writeRevision(root, "story-bbb", { slug: "story", revision: 1, parentJobId: "story-aaa" });
  await writeRevision(root, "story-ccc", { slug: "story", revision: 2, parentJobId: "story-bbb" });
  return root;
};

test("Given a revision lineage, When superseded revisions are pruned, Then only tip working artifacts survive while lineage records stay", async (context) => {
  // Given
  const root = await lineage(context, "linear");

  // When
  const result = await jobs.pruneSupersededRevisions({ root, slug: "story" });

  // Then
  assert.equal(result.dryRun, false);
  assert.deepEqual(result.pruned.map((entry) => entry.jobId).sort(), ["story-aaa", "story-bbb"]);
  assert.deepEqual(result.keptRevisions, ["story-ccc"]);
  for (const entry of result.pruned) {
    assert.deepEqual([...entry.removed].sort(), ["assets", "render"]);
  }
  // superseded revisions lose regenerable working artifacts
  assert.equal(await exists(path.join(root, "story-aaa", "render")), false);
  assert.equal(await exists(path.join(root, "story-aaa", "assets")), false);
  assert.equal(await exists(path.join(root, "story-bbb", "render")), false);
  // durable lineage and the published bundle are preserved
  assert.equal(await exists(path.join(root, "story-aaa", "records", "storyboard.json")), true);
  assert.equal(await exists(path.join(root, "story-aaa", "source", "envelope.json")), true);
  assert.equal(await exists(path.join(root, "story-aaa", "head.json")), true);
  assert.equal(await exists(path.join(root, "story-aaa", "package", "bundle.zip")), true);
  // the tip revision keeps everything
  assert.equal(await exists(path.join(root, "story-ccc", "render", "cards", "card-1.png")), true);
  assert.equal(await exists(path.join(root, "story-ccc", "assets", "asset.png")), true);
});

test("Given a dry run, When superseded revisions are reported, Then nothing is deleted", async (context) => {
  // Given
  const root = await lineage(context, "dryrun");

  // When
  const result = await jobs.pruneSupersededRevisions({ root, slug: "story", dryRun: true });

  // Then
  assert.equal(result.dryRun, true);
  assert.deepEqual(result.pruned.map((entry) => entry.jobId).sort(), ["story-aaa", "story-bbb"]);
  assert.equal(await exists(path.join(root, "story-aaa", "render")), true);
  assert.equal(await exists(path.join(root, "story-bbb", "assets")), true);
});

test("Given a forked lineage, When pruned, Then every childless tip is retained", async (context) => {
  // Given
  const root = await mkdtemp(path.join(os.tmpdir(), "cardnews-prune-fork-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeRevision(root, "story-root", { slug: "story", revision: 0 });
  await writeRevision(root, "story-tipa", { slug: "story", revision: 1, parentJobId: "story-root" });
  await writeRevision(root, "story-tipb", { slug: "story", revision: 1, parentJobId: "story-root" });

  // When
  const result = await jobs.pruneSupersededRevisions({ root, slug: "story" });

  // Then
  assert.deepEqual(result.pruned.map((entry) => entry.jobId), ["story-root"]);
  assert.deepEqual(result.keptRevisions.sort(), ["story-tipa", "story-tipb"]);
  assert.equal(await exists(path.join(root, "story-tipa", "render")), true);
  assert.equal(await exists(path.join(root, "story-tipb", "assets")), true);
  assert.equal(await exists(path.join(root, "story-root", "render")), false);
});

test("Given unrelated slugs in one root, When scoped to one slug, Then other stories are untouched", async (context) => {
  // Given
  const root = await mkdtemp(path.join(os.tmpdir(), "cardnews-prune-scope-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeRevision(root, "alpha-aaa", { slug: "alpha", revision: 0 });
  await writeRevision(root, "alpha-bbb", { slug: "alpha", revision: 1, parentJobId: "alpha-aaa" });
  await writeRevision(root, "beta-aaa", { slug: "beta", revision: 0 });
  await writeRevision(root, "beta-bbb", { slug: "beta", revision: 1, parentJobId: "beta-aaa" });

  // When
  const result = await jobs.pruneSupersededRevisions({ root, slug: "alpha" });

  // Then
  assert.deepEqual(result.pruned.map((entry) => entry.jobId), ["alpha-aaa"]);
  assert.equal(await exists(path.join(root, "alpha-aaa", "render")), false);
  assert.equal(await exists(path.join(root, "beta-aaa", "render")), true);
});
