#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "./qa-fixture-job.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export const dimensionsMatchManifest = (images, manifest) => {
  const expected = new Map(manifest.artifacts.map((artifact) => [
    artifact.contract.cardId,
    { width: artifact.contract.width, height: artifact.contract.height },
  ]));
  expected.set("contact-sheet", {
    width: manifest.contactSheet.width,
    height: manifest.contactSheet.height,
  });
  return images.every((image) => {
    const dimensions = expected.get(image.id);
    return dimensions !== undefined &&
      image.width === dimensions.width &&
      image.height === dimensions.height;
  });
};

export const prepareVisualQa = async ({ job, evidenceRoot }) => {
  const resolvedJob = path.resolve(job);
  const renderRoot = path.join(resolvedJob, "render", "accepted");
  const captureEvidence = path.join(evidenceRoot, "visual");
  await mkdir(captureEvidence, { recursive: true });
  const manual = await runCommand(process.execPath, [
    path.join(repositoryRoot, "scripts", "manual-qa-render.mjs"),
    renderRoot,
    captureEvidence,
  ], { cwd: repositoryRoot });
  await writeFile(path.join(captureEvidence, "manual-qa.log"), manual.stdout);
  const stderrPath = path.join(captureEvidence, "manual-qa.stderr.log");
  if (manual.stderr === "") {
    await rm(stderrPath, { force: true });
  } else {
    await writeFile(stderrPath, manual.stderr);
  }
  if (manual.code !== 0) throw new Error("manual visual capture gate failed");
  const inventoryPath = path.join(captureEvidence, "render-inventory.json");
  const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
  const manifestPath = path.join(renderRoot, "render-manifest.json");
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  const sourceFiles = [
    "src/render/card.mjs",
    "src/render/design.mjs",
    "src/render/contact-sheet.mjs",
    "themes/ink-paper.json",
    "targets/portrait-social-1080x1350.json",
  ].map((relativePath) => path.join(repositoryRoot, relativePath));
  const sourceInventory = await Promise.all(sourceFiles.map(async (file) => {
    const bytes = await readFile(file);
    return { path: file, sha256: sha256(bytes), byteCount: bytes.byteLength };
  }));
  const imageStats = await Promise.all(inventory.images.map(async (image) => ({
    ...image,
    mtimeMs: (await stat(image.path)).mtimeMs,
  })));
  const captureSetDigest = sha256(Buffer.from(
    imageStats.map((image) => `${image.id}:${image.sha256}`).join("\n"),
  ));
  const packet = {
    schemaVersion: 1,
    purpose: "Root dispatch input for fresh independent visual Pass A and Pass B.",
    surface: "seven-card offline web render plus contact sheet",
    expectedCaptureCount: 8,
    actualCaptureCount: imageStats.length,
    cardCount: 7,
    renderManifest: {
      path: manifestPath,
      sha256: sha256(manifestBytes),
      byteCount: manifestBytes.byteLength,
    },
    renderSetDigest: inventory.sourceRevision,
    captureSetDigest,
    captures: imageStats,
    sourceInventory,
    deterministicChecks: {
      signature: imageStats.every((image) => image.signature === "89504e470d0a1a0a"),
      dimensions: dimensionsMatchManifest(imageStats, manifest),
      freshness: imageStats.every((image) => image.fresh),
      complete: imageStats.length === 8,
      manualQaPassed: true,
    },
    passA: {
      charter: "functional integrity, completeness, dimensions, fonts, overflow, reusable layout, and design-system consistency",
      status: "pending-root-dispatch",
    },
    passB: {
      charter: "direct inspection of all captures for Korean line breaks, clipping, hierarchy, pacing, and consistency",
      status: "pending-root-dispatch",
    },
    selfCertifiedVisualQuality: false,
    visualQuality: "pending-root-dual-oracle",
    completeForDispatch: imageStats.length === 8 &&
      imageStats.every((image) => image.fresh && image.signature === "89504e470d0a1a0a"),
  };
  if (!Object.values(packet.deterministicChecks).every(Boolean) || !packet.completeForDispatch) {
    throw new Error("visual packet deterministic gates failed");
  }
  const packetPath = path.join(evidenceRoot, "visual-qa-prep.json");
  await writeFile(packetPath, `${JSON.stringify(packet, null, 2)}\n`);
  return { packetPath, packet };
};

const isMain = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2).filter((value) => value !== "--");
  const jobIndex = args.indexOf("--job");
  if (jobIndex === -1 || args[jobIndex + 1] === undefined) {
    process.stderr.write("usage: qa-visual.mjs --job <job-path>\n");
    process.exitCode = 2;
  } else {
    const evidenceRoot = process.env.CARDNEWS_QA_EVIDENCE_ROOT ??
      path.join(os.homedir(), ".omo", "evidence", "cardnews-foundry", "T12", "a1");
    const result = await prepareVisualQa({ job: args[jobIndex + 1], evidenceRoot });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      packet: result.packetPath,
      captureCount: result.packet.actualCaptureCount,
      visualQuality: result.packet.visualQuality,
    })}\n`);
  }
}
