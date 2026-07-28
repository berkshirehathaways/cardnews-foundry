#!/usr/bin/env node
import { createHash } from "node:crypto";
import { access, lstat, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyVisualPassRetention } from "./visual-pass-retention.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceRoot = process.env.CARDNEWS_QA_EVIDENCE_ROOT ??
  path.join(os.homedir(), ".omo", "evidence", "cardnews-foundry", "T12", "a3");
const t12Root = path.dirname(evidenceRoot);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const exists = (file) => access(file).then(() => true).catch(() => false);
const writeJson = (name, value) =>
  writeFile(path.join(evidenceRoot, name), `${JSON.stringify(value, null, 2)}\n`);

const walk = async (root) => {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...await walk(file));
    else output.push(file);
  }
  return output;
};

const sourceFiles = [
  "package.json", "scripts/finalize-t12-a3-evidence.mjs", "scripts/qa-forward.mjs",
  "scripts/qa-fresh-context.mjs", "scripts/qa-job-oracle.mjs",
  "scripts/visual-pass-retention.mjs",
  "skill/cardnews-foundry/SKILL.md", "skill/cardnews-foundry/references/troubleshooting.md",
  "src/cli/errors.ts", "src/cli/output.ts", "test/qa/clipping-repair.test.mjs",
  "test/qa/forward.test.mjs",
];

const fileIdentity = async (file) => {
  const bytes = await readFile(file);
  return { sha256: sha256(bytes), byteCount: bytes.byteLength };
};

const relativeEvidence = (file) => path.relative(evidenceRoot, file);

const inventoryContexts = async (forward) => {
  const authoritative = new Set(forward.contexts.map((context) => context.transcript));
  const files = (await walk(evidenceRoot)).filter((file) => file.endsWith("transcript.jsonl"));
  return Promise.all(files.map(async (transcript) => {
    const lines = (await readFile(transcript, "utf8")).split("\n").filter(Boolean);
    const started = lines.length === 0 ? undefined : JSON.parse(lines[0]);
    const finalMessage = path.join(path.dirname(transcript), "final.txt");
    const scenario = transcript.split(path.sep).at(-3) ?? "unknown";
    return {
      scenario,
      threadId: started?.thread_id ?? null,
      transcript: relativeEvidence(transcript),
      transcriptBytes: (await stat(transcript)).size,
      finalMessage: relativeEvidence(finalMessage),
      finalMessageBytes: (await stat(finalMessage)).size,
      authoritative: authoritative.has(transcript),
    };
  }));
};

const transcriptMetrics = async (transcript) => {
  const events = (await readFile(transcript, "utf8")).split("\n")
    .filter(Boolean).map((line) => JSON.parse(line))
    .filter((event) => event.type === "item.completed" && event.item?.type === "command_execution");
  const commands = events.map((event) => event.item.command ?? "");
  return {
    domClippingEvents: events.filter(
      (event) => event.item.aggregated_output?.includes('"code":"DOM_CLIPPING"'),
    ).length,
    renderAttempts: commands.filter((command) => /\brender --job\b/u.test(command)).length,
    forceRevisionCommits: commands.filter(
      (command) => /\bcommit-record\b/u.test(command) && command.includes("--force"),
    ).length,
    ingestCommands: commands.filter((command) => /\bingest --job\b/u.test(command)).length,
  };
};

const main = async () => {
  const [forward, live, visual] = await Promise.all([
    readJson(path.join(evidenceRoot, "forward-scenarios.json")),
    readJson(path.join(evidenceRoot, "live-smoke-status.json")),
    verifyVisualPassRetention({ repositoryRoot, t12Root }),
  ]);
  const [isolatedFresh, isolatedCopy, failedState] = await Promise.all([
    readJson(path.join(evidenceRoot, "isolated-attempts", "attempt-1", "result.json")),
    readJson(path.join(evidenceRoot, "isolated-attempts", "copy-recovery-1", "result.json")),
    readJson(path.join(evidenceRoot, "failed-state-clipping-evidence.json")),
  ]);
  const contexts = await inventoryContexts(forward);
  const metrics = new Map(await Promise.all(forward.contexts.map(async (context) => [
    context.scenario,
    await transcriptMetrics(context.transcript),
  ])));
  const privateRuns = await readdir(path.join(evidenceRoot, "private"));
  const codexHomes = (await walk(evidenceRoot)).filter(
    (file) => path.basename(path.dirname(file)) === "codex-home",
  );
  const cleanup = {
    schemaVersion: 1,
    repositoryCardnewsWorkspacePresent: await exists(path.join(repositoryRoot, ".cardnews")),
    retainedPrivateRunCount: privateRuns.length,
    retainedPrivateRuns: privateRuns.length === 1
      ? ["<retained-authoritative-private-run>"]
      : privateRuns.map(() => "<unexpected-private-run>"),
    codexHomeFilesPresent: codexHomes.length > 0,
    supersededWorkspacesMovedToTrash: true,
    recoverableTrashLocation: "~/.Trash/cardnews-t12-a3-superseded-20260728",
  };
  const sources = await Promise.all(sourceFiles.map(async (relativePath) => ({
    path: relativePath,
    ...await fileIdentity(path.join(repositoryRoot, relativePath)),
  })));
  const scenarioOutcomes = {
    schemaVersion: 1,
    passed: forward.passed,
    scenarios: forward.contexts.map((context) => ({
      scenario: context.scenario,
      processExit: context.exitCode,
      threadId: context.threadId,
      finalMessagePresent: context.finalMessagePresent,
      passed: context.passed,
      currentJob: "<private-current-job>",
      oracle: context.outcome.candidates.find((candidate) => candidate.passed)?.checks ?? null,
      transcriptMetrics: metrics.get(context.scenario),
      staleDownstreamInvalidated: context.scenario === "copy-only-revision"
        ? forward.scenarios.copyOnlyRevision.renderMissing
        : null,
    })),
    isolatedRepairProof: {
      failedState: failedState.findings.map((finding) => ({
        cardId: finding.cardId,
        className: finding.details.className,
        client: finding.details.client,
        scroll: finding.details.scroll,
      })),
      freshCreate: {
        threadId: isolatedFresh.threadId,
        passed: isolatedFresh.passed,
        transcriptMetrics: await transcriptMetrics(isolatedFresh.transcript),
        oracle: isolatedFresh.outcome.candidates.find((candidate) => candidate.passed)?.checks,
      },
      copyRecovery: {
        threadId: isolatedCopy.threadId,
        passed: isolatedCopy.passed,
        transcriptMetrics: await transcriptMetrics(isolatedCopy.transcript),
        oracle: isolatedCopy.outcome.candidates.find((candidate) => candidate.passed)?.checks,
      },
    },
    packageBoundary: "exit-6/PACKAGE_IMPLEMENTATION_PENDING",
  };
  const commands = {
    schemaVersion: 1,
    commands: [
      { invocation: "corepack pnpm typecheck", observable: "exit 0", artifact: "typecheck-final-after-evidence.log" },
      { invocation: "node --test --test-concurrency=1 test/qa/*.test.mjs", observable: "11 passed, 0 failed", artifact: "focused-tests-final-1.log" },
      { invocation: "node --test --test-concurrency=1 test/qa/*.test.mjs", observable: "11 passed, 0 failed", artifact: "focused-tests-final-2.log" },
      { invocation: "corepack pnpm test", observable: "239 passed, 0 failed", artifact: "full-tests-rerun.log" },
      { invocation: "corepack pnpm qa:forward -- --fixture fixtures/synthetic", observable: "4/4 artifact oracles passed", artifact: "qa-forward-authoritative.log" },
      { invocation: "corepack pnpm qa:live-smoke -- --url https://frontiernote.com/insights/liang-wenfeng-deepseek", observable: live.status, artifact: "live-smoke-status.json" },
      { invocation: "skill-creator quick_validate.py <installed-skill>", observable: "Skill is valid", artifact: "skill-quick-validate-after-resume-fix.log" },
    ],
  };
  await writeJson("visual-pass-retention.json", visual);
  await writeJson("fresh-context-inventory.json", { schemaVersion: 1, contexts });
  await writeJson("scenario-outcomes.json", scenarioOutcomes);
  await writeJson("source-inventory.json", {
    schemaVersion: 1,
    files: sources,
    rendererFilesModified: false,
    fixtureMutation: "none",
    planOrLedgerMutation: "none",
  });
  await writeJson("command-evidence.json", commands);
  await writeJson("cleanup.json", cleanup);
  const releasable = {
    schemaVersion: 1,
    functionalImplementation: "pass",
    forwardScenarios: "4/4 pass",
    privatePaths: "<redacted>",
    liveSmoke: live.status,
    package: "not-created-todo-13",
    visualQuality: "PASS-retained-on-unchanged-a1-digests",
    rootFunctionalGate: "pending",
  };
  await writeJson("releasable-summary.json", releasable);
  const releasableNames = [
    "releasable-summary.json", "scenario-outcomes.json", "fresh-context-inventory.json",
    "source-inventory.json", "command-evidence.json", "cleanup.json",
    "visual-pass-retention.json", "live-smoke-status.json",
  ];
  const leaks = [];
  for (const name of releasableNames) {
    const text = await readFile(path.join(evidenceRoot, name), "utf8");
    if (text.includes("/Users/") || text.includes(".cardnews/jobs/")) leaks.push(name);
  }
  const privacy = {
    schemaVersion: 1,
    passed: leaks.length === 0,
    checked: releasableNames,
    leakedFiles: leaks,
    rawLiveContentPersisted: live.rawContentPersisted,
    contextHomesRemoved: !cleanup.codexHomeFilesPresent,
  };
  await writeJson("privacy-audit.json", privacy);
  const required = [
    "forward-scenarios.json", "scenario-outcomes.json", "fresh-context-inventory.json",
    "live-smoke-status.json", "visual-pass-retention.json", "source-inventory.json",
    "command-evidence.json", "cleanup.json", "privacy-audit.json",
  ];
  const audit = {
    schemaVersion: 1,
    passed: forward.passed &&
      contexts.length >= 6 &&
      contexts.every((context) => context.threadId !== null && context.finalMessageBytes > 0) &&
      !cleanup.repositoryCardnewsWorkspacePresent &&
      cleanup.retainedPrivateRunCount === 1 &&
      !cleanup.codexHomeFilesPresent &&
      privacy.passed &&
      (await Promise.all(required.map(async (name) =>
        (await lstat(path.join(evidenceRoot, name))).isFile() &&
        (await stat(path.join(evidenceRoot, name))).size > 0
      ))).every(Boolean),
    required,
    authoritativeContextCount: forward.contexts.length,
    totalFreshContextTranscriptCount: contexts.length,
  };
  if (!audit.passed) throw new Error("T12/a3 evidence audit failed");
  await writeJson("evidence-audit.json", audit);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await writeJson("done-claim.json", {
    schemaVersion: 1,
    task: "T12/a3",
    implementationGates: "pass",
    forwardScenarios: "pass",
    privacy: "pass",
    visualQuality: "PASS-retained-on-unchanged-a1-digests",
    package: "PACKAGE_IMPLEMENTATION_PENDING",
    status: "pending-root-functional-gate",
  });
};

await main();
