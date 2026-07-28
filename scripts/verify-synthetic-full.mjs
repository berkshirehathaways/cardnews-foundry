#!/usr/bin/env node
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeEvaluationIdentities,
  loadEvaluationInput,
} from "../src/evaluate/index.mjs";
import { createPrivateProjection } from "../src/cli/projection.ts";
import { openJob } from "../src/cli/job.ts";
import { inspectGeneratedBundle } from "../src/package/index.mjs";
import { buildFixtureJob, runCardnews } from "./qa-fixture-job.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runner = path.join(repositoryRoot, "bin", "cardnews");
const fixture = path.join(repositoryRoot, "fixtures", "synthetic");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const outputDirectory = () => {
  const args = process.argv.slice(2).filter((value) => value !== "--");
  const index = args.indexOf("--output-dir");
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || args.length !== 2) {
    throw new TypeError("usage: verify-synthetic-full.mjs [--output-dir <path>]");
  }
  return path.resolve(value);
};

const identitiesFor = async (workspace, relativeJob) => {
  const previous = process.cwd();
  process.chdir(workspace);
  let projection;
  try {
    const job = await openJob(relativeJob);
    projection = await createPrivateProjection(job);
    const input = await loadEvaluationInput({
      repositoryRoot,
      fixtureRoot: projection.root,
      renderRoot: path.join(workspace, relativeJob, "render", "accepted"),
    });
    return computeEvaluationIdentities(input);
  } finally {
    await projection?.cleanup();
    process.chdir(previous);
  }
};

const verdict = (pass, identities) => ({
  schemaVersion: "1.0.0",
  verdictId: `synthetic-clean-clone-pass-${pass.toLowerCase()}`,
  renderSetDigest: identities.renderSetDigest,
  captureSetDigest: identities.captureSetDigest,
  sourceRevision: identities.sourceRevision,
  reviewer: {
    id: `synthetic-fixture-reviewer-${pass.toLowerCase()}`,
    kind: "external-adapter",
  },
  evidenceIdentity: {
    paths: identities.evidencePaths,
    capturedAt: new Date(Math.max(identities.latestCaptureMtimeMs, Date.now() - 1)).toISOString(),
  },
  category: pass === "A" ? "design-system" : "combined",
  differences: [],
  blockers: [],
  verdict: "PASS",
});

const run = async () => {
  const requestedOutput = outputDirectory();
  const workspace = await mkdtemp(path.join(os.tmpdir(), "cardnews-synthetic-full-"));
  const artifactRoot = requestedOutput ?? await mkdtemp(path.join(os.tmpdir(), "cardnews-synthetic-artifact-"));
  try {
    const built = await buildFixtureJob({
      runner,
      fixture,
      workspace,
      slug: "clean-clone-synthetic",
      through: "render",
    });
    await runCardnews(runner, workspace, [
      "evaluate", "--job", built.job, "--deterministic-only",
    ]);
    const identities = await identitiesFor(workspace, built.job);
    const passA = path.join(workspace, "synthetic-pass-a.json");
    const passB = path.join(workspace, "synthetic-pass-b.json");
    await Promise.all([
      writeFile(passA, `${JSON.stringify(verdict("A", identities))}\n`),
      writeFile(passB, `${JSON.stringify(verdict("B", identities))}\n`),
    ]);
    const packaged = await runCardnews(runner, workspace, [
      "package", "--job", built.job,
      "--visual-pass-a", passA,
      "--visual-pass-b", passB,
    ]);
    const sourcePackage = path.join(workspace, packaged.output.result.outputPath);
    const packagePath = path.join(artifactRoot, "synthetic-cardnews.zip");
    await copyFile(sourcePackage, packagePath);
    const bytes = await readFile(packagePath);
    const inspected = inspectGeneratedBundle(bytes);
    return {
      ok: true,
      scenario: "synthetic CLI init-to-package with fixture-bound visual adapter records",
      job: built.job,
      cardCount: built.rendered.output.result.cardIds.length,
      packagePath,
      packageSha256: sha256(bytes),
      packageId: inspected.manifest.packageId,
      renderSetDigest: identities.renderSetDigest,
      captureSetDigest: identities.captureSetDigest,
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
    if (requestedOutput === undefined) {
      await rm(artifactRoot, { recursive: true, force: true });
    }
  }
};

try {
  process.stdout.write(`${JSON.stringify(await run())}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: "SYNTHETIC_FULL_FAILED",
    message: error instanceof Error ? error.message : "unknown failure",
  })}\n`);
  process.exitCode = 1;
}

