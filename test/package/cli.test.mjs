import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  computeEvaluationIdentities,
  loadEvaluationInput
} from "../../src/evaluate/index.mjs";
import { createPrivateProjection } from "../../src/cli/projection.ts";
import { openJob } from "../../src/cli/job.ts";
import { inspectGeneratedBundle } from "../../src/package/index.mjs";
import {
  buildFixtureJob,
  runCardnews
} from "../../scripts/qa-fixture-job.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const runner = path.join(repositoryRoot, "bin", "cardnews");
const fixture = path.join(repositoryRoot, "fixtures", "synthetic");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("Given a private rendered job and two imported current verdicts, When package runs twice, Then the real CLI returns one immutable deterministic ZIP", async (context) => {
  // Given
  const workspace = await mkdtemp(path.join(os.tmpdir(), "cardnews-package-cli-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const built = await buildFixtureJob({
    runner,
    fixture,
    workspace,
    slug: "cli-package",
    through: "render"
  });
  await runCardnews(runner, workspace, [
    "evaluate", "--job", built.job, "--deterministic-only"
  ]);
  const previousCwd = process.cwd();
  process.chdir(workspace);
  let projection;
  let identities;
  try {
    const job = await openJob(built.job);
    projection = await createPrivateProjection(job);
    const input = await loadEvaluationInput({
      repositoryRoot,
      fixtureRoot: projection.root,
      renderRoot: path.join(workspace, built.job, "render", "accepted")
    });
    identities = computeEvaluationIdentities(input);
  } finally {
    await projection?.cleanup();
    process.chdir(previousCwd);
  }
  const capturedAt = new Date(identities.latestCaptureMtimeMs + 1_000).toISOString();
  const verdict = (pass) => ({
    schemaVersion: "1.0.0",
    verdictId: `t12-cli-pass-${pass.toLowerCase()}`,
    renderSetDigest: identities.renderSetDigest,
    captureSetDigest: identities.captureSetDigest,
    sourceRevision: identities.sourceRevision,
    reviewer: { id: `cli-reviewer-${pass.toLowerCase()}`, kind: "codex" },
    evidenceIdentity: { paths: identities.evidencePaths, capturedAt },
    category: pass === "A" ? "design-system" : "combined",
    differences: [],
    blockers: [],
    verdict: "PASS"
  });
  const passAPath = path.join(workspace, "t12-normalized-pass-a.json");
  const passBPath = path.join(workspace, "t12-normalized-pass-b.json");
  await writeFile(passAPath, JSON.stringify(verdict("A")));
  await writeFile(passBPath, JSON.stringify(verdict("B")));

  // When
  const args = [
    "package", "--job", built.job,
    "--visual-pass-a", passAPath,
    "--visual-pass-b", passBPath
  ];
  const first = await runCardnews(runner, workspace, args);
  const second = await runCardnews(runner, workspace, args);
  const zipPath = path.join(workspace, first.output.result.outputPath);
  const bytes = await readFile(zipPath);
  const inspected = inspectGeneratedBundle(bytes);

  // Then
  assert.equal(first.output.result.outputPath.endsWith("/cli-package-cardnews.zip"), true);
  assert.equal(second.output.result.outputPath, first.output.result.outputPath);
  assert.equal(second.output.result.sha256, sha256(bytes));
  assert.equal(second.output.result.reused, true);
  assert.equal(inspected.manifest.packageId, first.output.result.packageId);
  assert.equal((await stat(zipPath)).mode & 0o777, 0o444);
  assert.equal(
    (await stat(path.join(workspace, built.job, "reports", "visual-pass-a.json"))).mode & 0o777,
    0o400
  );
});

