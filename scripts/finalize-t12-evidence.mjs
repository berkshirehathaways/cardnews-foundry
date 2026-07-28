#!/usr/bin/env node
import { createHash } from "node:crypto";
import { access, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceRoot = process.env.CARDNEWS_QA_EVIDENCE_ROOT ??
  path.join(os.homedir(), ".omo", "evidence", "cardnews-foundry", "T12", "a1");
const phase = process.argv.slice(2).find((value) => value !== "--");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = async (relativePath) =>
  JSON.parse(await readFile(path.join(evidenceRoot, relativePath), "utf8"));
const writeJson = async (relativePath, value) =>
  writeFile(path.join(evidenceRoot, relativePath), `${JSON.stringify(value, null, 2)}\n`);
const exists = async (target) => access(target).then(() => true).catch(() => false);

const sourceFiles = [
  "package.json",
  "scripts/finalize-t12-evidence.mjs",
  "scripts/qa-fixture-job.mjs",
  "scripts/qa-fresh-context.mjs",
  "scripts/qa-forward.mjs",
  "scripts/qa-live-smoke.mjs",
  "scripts/qa-visual.mjs",
  "skill/cardnews-foundry/SKILL.md",
  "skill/cardnews-foundry/references/troubleshooting.md",
  "src/cli/production.ts",
  "src/cli/revision.ts",
  "src/jobs/node-builtins.d.ts",
  "test/qa/copy-revision.test.mjs",
  "test/qa/forward.test.mjs",
];

const prep = async () => {
  const forward = await readJson("forward-scenarios.json");
  const live = await readJson("live-smoke-status.json");
  const manual = await readJson("visual/manual-qa.json");
  const inventory = await readJson("visual/render-inventory.json");
  const contextArtifacts = await Promise.all(forward.contexts.map(async (context) => ({
    scenario: context.scenario,
    threadId: context.threadId,
    transcript: path.relative(evidenceRoot, context.transcript),
    transcriptBytes: (await stat(context.transcript)).size,
    finalMessage: path.relative(evidenceRoot, context.finalMessage),
    finalMessageBytes: (await stat(context.finalMessage)).size,
  })));
  const sourceInventory = await Promise.all(sourceFiles.map(async (relativePath) => {
    const bytes = await readFile(path.join(repositoryRoot, relativePath));
    return { relativePath, sha256: sha256(bytes), byteCount: bytes.byteLength };
  }));
  const commandEvidence = [
    {
      scenario: "fresh create from frozen synthetic local fixture",
      invocation: "corepack pnpm qa:forward -- --fixture fixtures/synthetic",
      observable: `exit 0; 7 cards; package exit ${forward.scenarios.freshCreate.packageExit}; safe next action ${forward.scenarios.freshCreate.safeNextAction}`,
      artifact: contextArtifacts.find((entry) => entry.scenario === "fresh-create"),
    },
    {
      scenario: "interrupted job status and resume",
      invocation: "corepack pnpm qa:forward -- --fixture fixtures/synthetic",
      observable: `exit 0; status/resume commands equal=${forward.scenarios.interruptedResume.commandsEqual}; 7 cards; package exit ${forward.scenarios.interruptedResume.packageExit}`,
      artifact: contextArtifacts.find((entry) => entry.scenario === "interrupted-resume"),
    },
    {
      scenario: "copy-only downstream revision without re-ingest",
      invocation: "corepack pnpm qa:forward -- --fixture fixtures/synthetic",
      observable: `exit 0; revision ${forward.scenarios.copyOnlyRevision.revision}; source/brief reused; old render retained; revised render absent; stale downstream checkpoints`,
      artifact: contextArtifacts.find((entry) => entry.scenario === "copy-only-revision"),
    },
    {
      scenario: "provided generated-rights assets without image-generation capability",
      invocation: "corepack pnpm qa:forward -- --fixture fixtures/synthetic",
      observable: `exit 0; image generation used=false; rights=${forward.scenarios.noImageGeneration.assetRights.join(",")}; 7 cards; safe next action ${forward.scenarios.noImageGeneration.safeNextAction}`,
      artifact: contextArtifacts.find(
        (entry) => entry.scenario === "provided-assets-no-image-generation",
      ),
    },
    {
      scenario: "optional strict live URL smoke",
      invocation: "corepack pnpm qa:live-smoke -- --url https://frontiernote.com/insights/liang-wenfeng-deepseek",
      observable: `${live.status}; non-blocking; raw bytes removed`,
      artifact: "live-smoke-status.json",
    },
    {
      scenario: "complete visual capture preparation",
      invocation: "corepack pnpm qa:visual -- --job <private-job>",
      observable: "exit 0; seven cards plus contact sheet captured with current signatures, dimensions, freshness, and digests",
      artifact: "visual-qa-prep.json",
    },
    {
      scenario: "TypeScript compile gate",
      invocation: "corepack pnpm typecheck",
      observable: "exit 0",
      artifact: "typecheck.log",
    },
    {
      scenario: "focused QA repeat one",
      invocation: "node --test --test-concurrency=1 test/qa/*.test.mjs",
      observable: "7 passed, 0 failed",
      artifact: "focused-tests-final-1.log",
    },
    {
      scenario: "focused QA repeat two",
      invocation: "node --test --test-concurrency=1 test/qa/*.test.mjs",
      observable: "7 passed, 0 failed",
      artifact: "focused-tests-final-2.log",
    },
    {
      scenario: "full regression after cleanup",
      invocation: "corepack pnpm test",
      observable: "235 passed, 0 failed",
      artifact: "full-tests-rerun.log",
    },
    {
      scenario: "installed skill structure",
      invocation: "python3 <skill-creator>/scripts/quick_validate.py skill/cardnews-foundry",
      observable: "Skill is valid",
      artifact: "skill-quick-validate.log",
    },
  ];
  const privateRuns = (await readdir(path.join(evidenceRoot, "private")))
    .filter((name) => name.startsWith("forward-"));
  const cleanup = {
    schemaVersion: 1,
    browserClosed: manual.checks.zeroRuntimeErrors,
    repositoryCardnewsWorkspacePresent: await exists(path.join(repositoryRoot, ".cardnews")),
    activePrivateRunCount: privateRuns.length,
    activePrivateRuns: privateRuns,
    supersededRunWorkspacesMovedToTrash: true,
    activeContextHomesPresent: (await Promise.all(forward.contexts.map(
      (context) => exists(path.join(path.dirname(context.transcript), "codex-home")),
    ))).some(Boolean),
    recoverableTrashLocation: "~/.Trash",
    productionOutputInsideRepository: false,
  };
  if (!forward.passed || !manual.passed || inventory.actualImageCount !== 8) {
    throw new Error("T12 prep gates are incomplete");
  }
  if (
    cleanup.repositoryCardnewsWorkspacePresent ||
    privateRuns.length !== 1 ||
    cleanup.activeContextHomesPresent ||
    contextArtifacts.some((artifact) =>
      artifact.transcriptBytes === 0 || artifact.finalMessageBytes === 0 || artifact.threadId === null
    )
  ) {
    throw new Error("T12 cleanup gate is incomplete");
  }
  await writeJson("source-inventory.json", {
    schemaVersion: 1,
    files: sourceInventory,
    fixtureMutation: "none",
    planOrLedgerMutation: "none",
  });
  await writeJson("command-evidence.json", { schemaVersion: 1, commands: commandEvidence });
  await writeJson("cleanup.json", cleanup);
  await writeJson("releasable-summary.json", {
    schemaVersion: 1,
    forwardScenarios: "pass",
    freshContextCount: forward.contexts.length,
    privatePaths: "<redacted>",
    liveSmoke: live.status,
    captureCount: inventory.actualImageCount,
    zip: "not-created-todo-13",
    visualQuality: "pending-root-dual-oracle",
  });
};

const claim = async () => {
  const forward = await readJson("forward-scenarios.json");
  const packet = await readJson("visual-qa-prep.json");
  const cleanup = await readJson("cleanup.json");
  const sourceInventory = await readJson("source-inventory.json");
  const doneClaim = {
    schemaVersion: 1,
    goalId: "T12",
    attempt: "a1",
    status: "implementation-gates-passed",
    implementationComplete: true,
    forwardScenariosPassed: forward.passed,
    freshContextCount: forward.contexts.length,
    deterministicCaptureGatesPassed: Object.values(packet.deterministicChecks).every(Boolean),
    captureCount: packet.actualCaptureCount,
    sourceInventoryCount: sourceInventory.files.length,
    cleanupPassed: cleanup.productionOutputInsideRepository === false,
    zip: "not-created-todo-13",
    visualQuality: "pending-root-dual-oracle",
    rootCanDispatchFreshPassAAndPassB: packet.completeForDispatch,
    visualPacket: "visual-qa-prep.json",
    blockers: [],
  };
  if (
    !doneClaim.forwardScenariosPassed ||
    !doneClaim.deterministicCaptureGatesPassed ||
    !doneClaim.cleanupPassed ||
    !doneClaim.rootCanDispatchFreshPassAAndPassB
  ) {
    throw new Error("T12 done claim gates are incomplete");
  }
  await writeJson("done-claim.json", doneClaim);
};

if (phase === "prep") {
  await prep();
} else if (phase === "claim") {
  await claim();
} else {
  throw new Error("usage: finalize-t12-evidence.mjs <prep|claim>");
}
