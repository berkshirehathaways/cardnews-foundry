import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildFixtureJob, runCardnews } from "../../scripts/qa-fixture-job.mjs";
import {
  inspectJobOutcome,
  inspectWorkspaceOutcome,
} from "../../scripts/qa-job-oracle.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = path.join(repositoryRoot, "fixtures", "synthetic");
const runner = path.join(repositoryRoot, "skill", "cardnews-foundry", "scripts", "cardnews.mjs");
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

const commitRecipeRevision = async ({ workspace, job, storyboardDigest, clipping }) => {
  const scaffold = await runCardnews(runner, workspace, [
    "scaffold-record", "--job", job, "--stage", "visual-recipe",
  ]);
  const recipe = await readJson(path.join(fixture, "records", "visual-recipe.json"));
  recipe.storyboardDigest = storyboardDigest;
  if (clipping) {
    recipe.cards[3].mood =
      "손에서 손으로 관찰 기록이 오래 이어지는 다정하고 역동적이며 세밀한 돌봄의 분위기";
    recipe.cards[3].emphasis = [
      "발아 날짜와 물 준 횟수",
      "다음 사람의 화분에 맞는 돌봄 선택",
      "관찰 기록을 오래 이어 가는 순환",
    ];
  }
  await writeFile(
    path.join(workspace, scaffold.output.result.draftPath),
    `${JSON.stringify(recipe)}\n`,
  );
  return runCardnews(runner, workspace, [
    "commit-record", "--job", job, "--stage", "visual-recipe",
    "--input", scaffold.output.result.draftPath, "--force",
  ]);
};

const commitRenderSpec = async ({ workspace, job, recipeDigest }) => {
  const scaffold = await runCardnews(runner, workspace, [
    "scaffold-record", "--job", job, "--stage", "render-spec",
  ]);
  const spec = await readJson(path.join(fixture, "records", "render-spec.json"));
  spec.visualRecipeDigest = recipeDigest;
  await writeFile(
    path.join(workspace, scaffold.output.result.draftPath),
    `${JSON.stringify(spec)}\n`,
  );
  return runCardnews(runner, workspace, [
    "commit-record", "--job", job, "--stage", "render-spec",
    "--input", scaffold.output.result.draftPath,
  ]);
};

test("Given the failed fresh-create clipping shape, When a bounded downstream copy revision repairs the typed box, Then seven cards evaluate and stop honestly at Todo 13", async (context) => {
  // Given
  const workspace = await mkdtemp(path.join(os.tmpdir(), "cardnews-clipping-repair-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const baseline = await buildFixtureJob({
    runner,
    fixture,
    workspace,
    slug: "clipping-repair",
    through: "render-ready",
  });
  const brokenRecipe = await commitRecipeRevision({
    workspace,
    job: baseline.job,
    storyboardDigest: baseline.storyboard.digest,
    clipping: true,
  });
  const brokenJob = brokenRecipe.output.result.jobPath;
  await commitRenderSpec({
    workspace,
    job: brokenJob,
    recipeDigest: brokenRecipe.output.result.contractDigest,
  });

  // When
  const clipped = await runCardnews(runner, workspace, ["render", "--job", brokenJob], 4);
  const clippedOutcome = await inspectJobOutcome({ runner, workspace, job: brokenJob });
  const repairedRecipe = await commitRecipeRevision({
    workspace,
    job: brokenJob,
    storyboardDigest: baseline.storyboard.digest,
    clipping: false,
  });
  const repairedJob = repairedRecipe.output.result.jobPath;
  await commitRenderSpec({
    workspace,
    job: repairedJob,
    recipeDigest: repairedRecipe.output.result.contractDigest,
  });
  const rendered = await runCardnews(runner, workspace, ["render", "--job", repairedJob]);
  const evaluated = await runCardnews(runner, workspace, [
    "evaluate", "--job", repairedJob, "--deterministic-only",
  ]);
  const packaged = await runCardnews(runner, workspace, ["package", "--job", repairedJob], 6);
  const status = await runCardnews(runner, workspace, ["status", "--job", repairedJob]);
  const repairedOutcome = await inspectJobOutcome({ runner, workspace, job: repairedJob });
  const currentLineageOutcome = await inspectWorkspaceOutcome({
    runner,
    workspace,
    job: brokenJob,
  });

  // Then
  assert.equal(clipped.output.error.code, "DOM_CLIPPING");
  assert.equal(clipped.output.error.details.kind, "dom-clipping");
  assert.equal(clipped.output.error.details.className, "diagram");
  assert.equal(clipped.output.error.details.scrollHeight > clipped.output.error.details.clientHeight, true);
  assert.equal(clippedOutcome.passed, false);
  assert.equal(repairedRecipe.output.result.revision, 2);
  assert.equal(rendered.output.result.cardIds.length, 7);
  assert.equal(evaluated.output.result.blocking, false);
  assert.equal(packaged.output.error.code, "VISUAL_VERDICT_MISSING");
  assert.equal(repairedOutcome.passed, true);
  assert.equal(currentLineageOutcome.passed, true);
  assert.equal(currentLineageOutcome.completedJob, repairedJob);
  assert.deepEqual(
    status.output.result.stages.slice(0, 6).map(({ state }) => state),
    ["valid", "valid", "valid", "valid", "valid", "valid"],
  );
});
