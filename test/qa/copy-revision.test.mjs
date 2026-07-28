import assert from "node:assert/strict";
import { access, lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildFixtureJob, runCardnews } from "../../scripts/qa-fixture-job.mjs";
import { openJob } from "../../src/cli/job.ts";
import { prepareRecordRevision } from "../../src/cli/revision.ts";
import { createJobRevision } from "../../src/jobs/index.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = path.join(repositoryRoot, "fixtures", "synthetic");
const runner = path.join(repositoryRoot, "skill", "cardnews-foundry", "scripts", "cardnews.mjs");

test("Given an accepted storyboard receipt, When copy changes with force, Then the new revision owns the new receipt", async (context) => {
  // Given
  const workspace = await mkdtemp(path.join(os.tmpdir(), "cardnews-copy-revision-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const baseline = await buildFixtureJob({
    runner,
    fixture,
    workspace,
    slug: "copy-revision-receipt",
    through: "render-ready",
  });
  const scaffold = await runCardnews(runner, workspace, [
    "scaffold-record", "--job", baseline.job, "--stage", "storyboard",
  ]);
  const draft = path.join(workspace, scaffold.output.result.draftPath);
  const storyboard = JSON.parse(await readFile(path.join(fixture, "records", "storyboard.json"), "utf8"));
  storyboard.editorialBriefDigest = baseline.brief.digest;
  storyboard.cards[6].headline = "관찰은 이어집니다";
  await writeFile(draft, `${JSON.stringify(storyboard)}\n`);

  // When
  const revised = await runCardnews(runner, workspace, [
    "commit-record", "--job", baseline.job, "--stage", "storyboard",
    "--input", scaffold.output.result.draftPath, "--force",
  ]);

  // Then
  assert.equal(revised.output.result.revision, 1);
  const revisionReceipt = path.join(
    workspace,
    revised.output.result.jobPath,
    "drafts",
    "storyboard.receipt.json",
  );
  assert.equal(JSON.parse(await readFile(revisionReceipt, "utf8")).stage, "storyboard");
  await access(path.join(workspace, revised.output.result.jobPath, "source", "evidence.json"));
  for (const asset of baseline.assets) {
    await access(path.join(
      workspace,
      revised.output.result.jobPath,
      "assets",
      asset.output.result.assetDigest,
      "metadata.json",
    ));
  }
});

test("Given an asset leaf replaced by an escaping symlink, When revision state is copied, Then no link or outside bytes enter the revision", async (context) => {
  // Given
  const workspace = await mkdtemp(path.join(os.tmpdir(), "cardnews-copy-asset-link-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const baseline = await buildFixtureJob({
    runner,
    fixture,
    workspace,
    slug: "copy-asset-link",
    through: "render-ready",
  });
  const original = await openJob(path.join(workspace, baseline.job));
  const revision = await createJobRevision(original);
  const assetDigest = baseline.assets[0].output.result.assetDigest;
  const originalAssetDirectory = path.join(original.path, "assets", assetDigest);
  const assetName = (await readdir(originalAssetDirectory)).find(
    (name) => /^asset\.(?:jpg|png)$/u.test(name),
  );
  assert.notEqual(assetName, undefined);
  const outside = path.join(workspace, "outside-asset.bin");
  const outsideBytes = Buffer.from("outside asset must remain outside");
  await writeFile(outside, outsideBytes);
  await rm(path.join(originalAssetDirectory, assetName));
  await symlink(outside, path.join(originalAssetDirectory, assetName));

  // When
  const copying = prepareRecordRevision(original, revision);

  // Then
  await assert.rejects(copying, (error) => error.code === "SYMLINK_ESCAPE");
  assert.deepEqual(await readFile(outside), outsideBytes);
  await assert.rejects(
    lstat(path.join(revision.path, "assets", assetDigest, assetName)),
    (error) => error.code === "ENOENT",
  );
});
