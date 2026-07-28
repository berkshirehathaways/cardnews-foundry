#!/usr/bin/env node
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCardnews } from "./qa-fixture-job.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runner = path.join(repositoryRoot, "skill", "cardnews-foundry", "scripts", "cardnews.mjs");

export const runLiveSmoke = async ({ url, evidenceRoot }) => {
  await mkdir(evidenceRoot, { recursive: true });
  const workspace = await mkdtemp(path.join(os.tmpdir(), "cardnews-live-smoke-"));
  let status;
  try {
    const initialized = await runCardnews(runner, workspace, [
      "init", "--slug", "optional-live-smoke", "--target", "portrait-social-1080x1350",
      "--cards", "7",
    ]);
    const job = initialized.output.result.jobPath;
    const ingested = await runCardnews(runner, workspace, [
      "ingest", "--job", job, "--url", url,
    ]);
    const next = await runCardnews(runner, workspace, ["status", "--job", job]);
    status = {
      schemaVersion: 1,
      status: "reachable",
      blocking: false,
      urlOrigin: new URL(url).origin,
      rawContentPersisted: false,
      privateWorkspaceRemoved: true,
      sourceDigest: ingested.output.result.contractDigest,
      nextStage: next.output.result.nextStage,
      nextCommand: next.output.result.nextCommand.replace(job, "<private-job>"),
    };
  } catch (error) {
    status = {
      schemaVersion: 1,
      status: "unavailable",
      blocking: false,
      urlOrigin: new URL(url).origin,
      rawContentPersisted: false,
      privateWorkspaceRemoved: true,
      reasonCode: error instanceof Error && "result" in error
        ? "SOURCE_UNAVAILABLE_OR_REJECTED"
        : "LIVE_SMOKE_INTERNAL_UNAVAILABLE",
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
  await writeFile(
    path.join(evidenceRoot, "live-smoke-status.json"),
    `${JSON.stringify(status, null, 2)}\n`,
  );
  return status;
};

const isMain = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2).filter((value) => value !== "--");
  const urlIndex = args.indexOf("--url");
  if (urlIndex === -1 || args[urlIndex + 1] === undefined) {
    process.stderr.write("usage: qa-live-smoke.mjs --url <public-http-url>\n");
    process.exitCode = 2;
  } else {
    const evidenceRoot = process.env.CARDNEWS_QA_EVIDENCE_ROOT ??
      path.join(os.homedir(), ".omo", "evidence", "cardnews-foundry", "T12", "a1");
    const result = await runLiveSmoke({ url: args[urlIndex + 1], evidenceRoot });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}
