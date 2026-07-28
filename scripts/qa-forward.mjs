#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import {
  access, cp, mkdir, readFile, writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFixtureJob, runCardnews } from "./qa-fixture-job.mjs";
import { createDisclosureEnvelope, runFreshContext } from "./qa-fresh-context.mjs";
import { inspectWorkspaceOutcome } from "./qa-job-oracle.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runner = path.join(
  os.homedir(), ".codex", "skills", "cardnews-foundry", "scripts", "cardnews.mjs",
);

const reviseCopyOnly = async ({ fixture, baseline }) => {
  const scaffold = await runCardnews(runner, baseline.workspace, [
    "scaffold-record", "--job", baseline.job, "--stage", "storyboard",
  ]);
  const draft = path.join(baseline.workspace, scaffold.output.result.draftPath);
  const storyboard = JSON.parse(await readFile(path.join(fixture, "records", "storyboard.json"), "utf8"));
  storyboard.editorialBriefDigest = baseline.brief.digest;
  storyboard.cards[6].headline = "관찰은 이어집니다";
  storyboard.cards[6].body =
    "가장 오래 이어진 봉투처럼, 목적은 경쟁이 아니라 관찰을 다음 사람에게 전하는 일입니다.";
  await writeFile(draft, `${JSON.stringify(storyboard)}\n`);
  const committed = await runCardnews(runner, baseline.workspace, [
    "commit-record", "--job", baseline.job, "--stage", "storyboard",
    "--input", scaffold.output.result.draftPath, "--force",
  ]);
  const revisedJob = committed.output.result.jobPath;
  const status = await runCardnews(runner, baseline.workspace, ["status", "--job", revisedJob]);
  const renderMissing = await access(
    path.join(baseline.workspace, revisedJob, "render", "accepted", "render-manifest.json"),
  ).then(() => false).catch(() => true);
  const oldRenderPresent = await access(
    path.join(baseline.workspace, baseline.job, "render", "accepted", "render-manifest.json"),
  ).then(() => true).catch(() => false);
  return {
    job: revisedJob,
    revision: committed.output.result.revision,
    sourceReused: status.output.result.stages[0].state === "valid",
    briefReused: status.output.result.stages[1].state === "valid",
    downstreamStates: status.output.result.stages.slice(2).map(({ stage, state }) => ({ stage, state })),
    nextStage: status.output.result.nextStage,
    renderMissing,
    oldRenderPresent,
  };
};

export const selectForwardContextSpecs = (contextSpecs, selection) => {
  if (selection === "skip") return [];
  if (selection === "fresh-create") {
    return contextSpecs.filter(({ scenario }) => scenario === "fresh-create");
  }
  return contextSpecs;
};

export const freshCreateOutcomePassed = (outcome) => {
  const requiredChecks = [
    "statusExit",
    "acceptedStages",
    "sevenCurrentCards",
    "contactSheet",
    "renderInventoryCurrent",
    "evaluationAccepted",
  ];
  const completed = outcome.candidates.filter((candidate) =>
    candidate.packageExit === 0 &&
    requiredChecks.every((check) => candidate.checks[check] === true));
  return completed.length === 1;
};

export const runForwardQa = async ({ fixture, evidenceRoot }) => {
  const runRoot = path.join(evidenceRoot, "private", `forward-${randomUUID()}`);
  await mkdir(runRoot, { recursive: true });
  const baseline = await buildFixtureJob({
    runner, fixture, workspace: path.join(runRoot, "fresh-create"),
    slug: "forward-fresh-create",
  });
  const interrupted = await buildFixtureJob({
    runner, fixture, workspace: path.join(runRoot, "interrupted"),
    slug: "forward-interrupted", through: "render-ready",
  });
  const beforeResume = await runCardnews(runner, interrupted.workspace, [
    "status", "--job", interrupted.job,
  ]);
  const resume = await runCardnews(runner, interrupted.workspace, [
    "resume", "--job", interrupted.job,
  ]);
  const resumedRender = await runCardnews(runner, interrupted.workspace, [
    "render", "--job", interrupted.job,
  ]);
  await runCardnews(runner, interrupted.workspace, [
    "evaluate", "--job", interrupted.job, "--deterministic-only",
  ]);
  const resumedPackage = await runCardnews(
    runner, interrupted.workspace, ["package", "--job", interrupted.job], 6,
  );
  const copyOnly = await reviseCopyOnly({ fixture, baseline });
  const noImageGeneration = await buildFixtureJob({
    runner, fixture, workspace: path.join(runRoot, "no-image-generation"),
    slug: "forward-provided-assets",
  });
  const installedSkill = path.dirname(path.dirname(runner));
  const rawCreateRoot = path.join(runRoot, "fresh-context-create-input");
  await mkdir(rawCreateRoot);
  const rawCreate = path.join(rawCreateRoot, "article.html");
  await cp(path.join(fixture, "source", "article.html"), rawCreate);
  const contextSpecs = [
    {
      scenario: "fresh-create",
      cwd: rawCreateRoot,
      prompt: `이 로컬 HTML(${rawCreate})로 7장 카드뉴스 작업을 새로 만들어 주세요. 설치된 cardnews-foundry 스킬을 사용하고 현재 지원되는 범위까지 실제로 진행한 뒤, 완료할 수 없다면 보존된 작업 경로와 정확한 다음 명령을 알려 주세요.`,
      rawInputs: [rawCreate],
      jobInputs: [],
      expectedJob: undefined,
    },
    {
      scenario: "interrupted-resume",
      cwd: interrupted.workspace,
      prompt: `중단된 카드뉴스 작업 ${interrupted.job}을 설치된 cardnews-foundry 스킬로 상태 확인하고 재개해 주세요. 현재 지원되는 범위까지 진행하고 안전한 다음 작업을 알려 주세요.`,
      rawInputs: [],
      jobInputs: [path.join(interrupted.workspace, interrupted.job)],
      expectedJob: interrupted.job,
    },
    {
      scenario: "copy-only-revision",
      cwd: baseline.workspace,
      prompt: `카피만 수정해 새 revision이 된 카드뉴스 작업 ${copyOnly.job}을 설치된 cardnews-foundry 스킬로 확인해 주세요. 원문을 다시 ingest하지 말고, 기존 렌더나 캡처를 재사용하지 않은 채 정확한 다음 작업까지 진행해 주세요.`,
      rawInputs: [],
      jobInputs: [path.join(baseline.workspace, copyOnly.job)],
      expectedJob: copyOnly.job,
    },
    {
      scenario: "provided-assets-no-image-generation",
      cwd: noImageGeneration.workspace,
      prompt: `이미지 생성 기능 없이 제공된 generated-rights 자산으로 만든 카드뉴스 작업 ${noImageGeneration.job}을 설치된 cardnews-foundry 스킬로 확인해 주세요. 실제 상태와 현재 가능한 최종 산물 또는 정확한 다음 작업을 알려 주세요.`,
      rawInputs: [
        path.join(noImageGeneration.workspace, "inputs", "seed-orbit.bin"),
        path.join(noImageGeneration.workspace, "inputs", "record-grid.bin"),
      ],
      jobInputs: [path.join(noImageGeneration.workspace, noImageGeneration.job)],
      expectedJob: noImageGeneration.job,
    },
  ];
  const contextSelection = process.env.CARDNEWS_FORWARD_CONTEXTS;
  const contexts = await Promise.all(selectForwardContextSpecs(
    contextSpecs, contextSelection,
  ).map((spec) => runFreshContext({
        ...spec,
        evidenceRoot,
        envelope: createDisclosureEnvelope({ ...spec, installedSkill }),
        verifyOutcome: async () => {
          const outcome = await inspectWorkspaceOutcome({
            runner,
            workspace: spec.cwd,
            job: spec.expectedJob,
          });
          return contextSelection === "fresh-create"
            ? { ...outcome, passed: freshCreateOutcomePassed(outcome) }
            : outcome;
        },
      })));
  const scenarios = {
    freshCreate: {
      workingArtifact: path.join(baseline.workspace, baseline.rendered.output.result.outputPath),
      cardCount: baseline.rendered.output.result.cardIds.length,
      packageExit: baseline.packaged.result.code,
      safeNextAction: baseline.packaged.output.error.code,
    },
    interruptedResume: {
      statusNextCommand: beforeResume.output.result.nextCommand,
      resumeNextCommand: resume.output.result.nextCommand,
      commandsEqual: beforeResume.output.result.nextCommand === resume.output.result.nextCommand,
      cardCount: resumedRender.output.result.cardIds.length,
      packageExit: resumedPackage.result.code,
      safeNextAction: resumedPackage.output.error.code,
    },
    copyOnlyRevision: copyOnly,
    noImageGeneration: {
      imageGenerationUsed: false,
      assetRights: noImageGeneration.assets.map((entry) => entry.output.result.rights),
      cardCount: noImageGeneration.rendered.output.result.cardIds.length,
      workingArtifact: path.join(
        noImageGeneration.workspace, noImageGeneration.rendered.output.result.outputPath,
      ),
      safeNextAction: noImageGeneration.packaged.output.error.code,
    },
  };
  const passed = scenarios.freshCreate.cardCount === 7 &&
    scenarios.interruptedResume.commandsEqual &&
    scenarios.copyOnlyRevision.revision > 0 &&
    scenarios.copyOnlyRevision.sourceReused &&
    scenarios.copyOnlyRevision.briefReused &&
    scenarios.copyOnlyRevision.renderMissing &&
    scenarios.copyOnlyRevision.oldRenderPresent &&
    scenarios.noImageGeneration.assetRights.every((rights) => rights === "generated") &&
    (contexts.length === 0 || contexts.every((context) => context.passed));
  const summary = {
    schemaVersion: 1,
    passed,
    fixture,
    privateRunRoot: runRoot,
    visualJob: path.join(baseline.workspace, baseline.job),
    scenarios,
    contexts,
  };
  await writeFile(
    path.join(evidenceRoot, "forward-scenarios.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  if (!passed) throw new Error("forward QA scenarios did not all pass");
  return summary;
};

const isMain = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2).filter((value) => value !== "--");
  const fixtureIndex = args.indexOf("--fixture");
  if (fixtureIndex === -1 || args[fixtureIndex + 1] === undefined) {
    process.stderr.write("usage: qa-forward.mjs --fixture <fixture-root>\n");
    process.exitCode = 2;
  } else {
    const evidenceRoot = process.env.CARDNEWS_QA_EVIDENCE_ROOT ??
      path.join(os.homedir(), ".omo", "evidence", "cardnews-foundry", "T12", "a1");
    await mkdir(evidenceRoot, { recursive: true });
    const result = await runForwardQa({
      fixture: path.resolve(args[fixtureIndex + 1]),
      evidenceRoot,
    });
    process.stdout.write(`${JSON.stringify({
      passed: result.passed,
      visualJob: result.visualJob,
      evidence: path.join(evidenceRoot, "forward-scenarios.json"),
    })}\n`);
  }
}
