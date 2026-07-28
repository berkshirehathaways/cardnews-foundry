import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { assertPublicPackageEligible, importAsset } from "../../src/assets/index.ts";
import { canonicalJson } from "../../src/contracts/index.ts";

const execFileAsync = promisify(execFile);
const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const importedAt = "2026-07-27T00:00:00.000Z";
const digestFile = async (file) =>
  createHash("sha256").update(await readFile(file)).digest("hex");
const codeOf = async (operation) => operation().then(
  () => "ACCEPTED",
  (error) => error instanceof Error && "code" in error ? error.code : "UNKNOWN_ERROR"
);
const recipeFor = (
  digest,
  rights = "generated",
  originNote = "Synthetic manual QA provenance",
  slot = "hero"
) => ({
  schemaVersion: "1.0.0",
  recipeId: "manual-recipe",
  storyboardDigest: "c".repeat(64),
  targetId: "instagram-portrait",
  themeId: "minimal",
  cards: [{
    cardId: "card-1",
    composition: "headline",
    mood: "Manual QA",
    emphasis: [],
    assetBindings: [{
      slot,
      assetDigest: digest,
      rights,
      ...(originNote === undefined ? {} : { originNote }),
      altText: "Synthetic manual QA image"
    }],
    accessibilityText: "Synthetic manual QA card"
  }]
});
const inputFor = async (incoming, workspaceRoot, file, {
  rights = "generated",
  originNote = "Synthetic manual QA provenance",
  slot = "hero",
  digest,
  recipeDigest,
  limits,
  failpoint
} = {}) => {
  const assetDigest = digest ?? await digestFile(path.join(incoming, file));
  return {
    allowedRoot: incoming,
    workspaceRoot,
    file,
    rights,
    originNote,
    importedAt,
    cardId: "card-1",
    slot,
    recipe: recipeFor(recipeDigest ?? assetDigest, rights, originNote, slot),
    ...(limits === undefined ? {} : { limits }),
    ...(failpoint === undefined ? {} : { failpoint })
  };
};
const acceptedEntries = async (workspace) => {
  const assetsRoot = path.join(workspace, "assets");
  return access(assetsRoot).then(
    async () => (await readdir(assetsRoot)).filter((name) => !name.startsWith(".")),
    () => []
  );
};

const run = async () => {
  const root = await mkdtemp("/tmp/cardnews-assets-manual-");
  const incoming = path.join(root, "incoming");
  const server = net.createServer();
  const workspaces = new Map();
  const workspace = async (name) => {
    const target = path.join(root, name);
    await mkdir(target);
    workspaces.set(name, target);
    return target;
  };
  let report;
  try {
    await cp(fixtures, incoming, { recursive: true });
    const generatedWorkspace = await workspace("generated");
    const userWorkspace = await workspace("user");
    const unknownWorkspace = await workspace("unknown");
    const generatedInput = await inputFor(
      incoming,
      generatedWorkspace,
      path.join("nested", "Alpha Card.weird")
    );
    const generated = await importAsset(generatedInput);
    const user = await importAsset(await inputFor(
      incoming,
      userWorkspace,
      "user-jpeg.bin",
      { rights: "user-provided", originNote: undefined }
    ));
    const unknown = await importAsset(await inputFor(
      incoming,
      unknownWorkspace,
      "opaque-png.bin",
      { rights: "unknown", originNote: "Manual rights review pending" }
    ));
    const unknownBlocker = await codeOf(async () => assertPublicPackageEligible(unknown.record));

    const rejectionInputs = new Map();
    for (const [name, file] of [
      ["mislabeled", "mislabeled-png.bin"],
      ["truncated", "truncated-png.bin"],
      ["invalidZlib", "invalid-zlib-png.bin"],
      ["truncatedZlib", "truncated-zlib-png.bin"],
      ["overrunZlib", "overrun-zlib-png.bin"],
      ["oversized", "opaque-png.bin"]
    ]) {
      const target = await workspace(name);
      rejectionInputs.set(name, await inputFor(
        incoming,
        target,
        file,
        name === "oversized"
          ? { limits: { maxBytes: 32, maxDimension: 8192, maxPixels: 40_000_000 } }
          : {}
      ));
    }
    const validDigest = await digestFile(path.join(incoming, "opaque-png.bin"));
    const traversalWorkspace = await workspace("traversal");
    const traversal = await inputFor(incoming, traversalWorkspace, "opaque-png.bin");
    traversal.file = "../outside.bin";
    rejectionInputs.set("traversal", traversal);
    const symlinkWorkspace = await workspace("symlink");
    await symlink("opaque-png.bin", path.join(incoming, "manual-link.bin"));
    const symlinkInput = await inputFor(incoming, symlinkWorkspace, "opaque-png.bin");
    symlinkInput.file = "manual-link.bin";
    rejectionInputs.set("symlink", symlinkInput);
    const missingRightsWorkspace = await workspace("missing-rights");
    const missingRights = await inputFor(incoming, missingRightsWorkspace, "opaque-png.bin");
    missingRights.rights = undefined;
    rejectionInputs.set("missingRights", missingRights);
    const slotWorkspace = await workspace("slot-mismatch");
    rejectionInputs.set("slotMismatch", await inputFor(
      incoming,
      slotWorkspace,
      "opaque-png.bin",
      { recipeDigest: "f".repeat(64) }
    ));
    const duplicateWorkspace = await workspace("duplicate-slot");
    const duplicateInput = await inputFor(incoming, duplicateWorkspace, "opaque-png.bin");
    duplicateInput.recipe.cards[0].assetBindings.push({
      ...duplicateInput.recipe.cards[0].assetBindings[0]
    });
    rejectionInputs.set("duplicateSlot", duplicateInput);

    const specialWorkspace = await workspace("special");
    const fifo = path.join(incoming, "manual.fifo");
    const socket = path.join(incoming, "manual.sock");
    await execFileAsync("mkfifo", [fifo]);
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(socket, resolve);
    });
    const fifoInput = await inputFor(incoming, specialWorkspace, "opaque-png.bin", { digest: validDigest });
    fifoInput.file = "manual.fifo";
    const socketInput = await inputFor(incoming, specialWorkspace, "opaque-png.bin", { digest: validDigest });
    socketInput.file = "manual.sock";
    rejectionInputs.set("fifo", fifoInput);
    rejectionInputs.set("socket", socketInput);

    const rejections = {};
    const noAcceptedFiles = {};
    for (const [name, input] of rejectionInputs) {
      rejections[name] = await codeOf(async () => importAsset(input));
      noAcceptedFiles[name] = (await acceptedEntries(input.workspaceRoot)).length === 0;
    }
    const destinationSymlinkWorkspace = await workspace("destination-child-symlink");
    const destinationSymlinkInput = await inputFor(
      incoming,
      destinationSymlinkWorkspace,
      "opaque-png.bin"
    );
    const destinationSymlinkImported = await importAsset(destinationSymlinkInput);
    const external = path.join(root, "external-symlink-target.png");
    const originalStoredBytes = await readFile(destinationSymlinkImported.artifactPath);
    await writeFile(external, originalStoredBytes);
    await chmod(path.dirname(destinationSymlinkImported.artifactPath), 0o700);
    await rm(destinationSymlinkImported.artifactPath);
    await symlink(external, destinationSymlinkImported.artifactPath);
    const destinationChildSymlink = await codeOf(async () => importAsset(destinationSymlinkInput));
    const destinationRepairedRegular = !(await lstat(destinationSymlinkImported.artifactPath)).isSymbolicLink();
    const externalUntouched = Buffer.compare(
      Buffer.from(await readFile(external)),
      Buffer.from(originalStoredBytes)
    ) === 0;
    await writeFile(external, Buffer.from("mutated external manual QA bytes"));
    const storedUnaffectedByExternalMutation = await digestFile(destinationSymlinkImported.artifactPath)
      === destinationSymlinkImported.record.assetDigest;

    const tamperWorkspace = await workspace("destination-tamper");
    const tamperInput = await inputFor(incoming, tamperWorkspace, "opaque-png.bin");
    const tamperImported = await importAsset(tamperInput);
    const tamperBytes = Buffer.from("tampered manual QA bytes");
    const tamperDirectory = path.dirname(tamperImported.artifactPath);
    await chmod(tamperDirectory, 0o700);
    await chmod(tamperImported.artifactPath, 0o600);
    await writeFile(tamperImported.artifactPath, tamperBytes);
    const destinationTamper = await codeOf(async () => importAsset(tamperInput));
    await rm(tamperDirectory, { recursive: true });
    const tamperRecovered = await importAsset(tamperInput);

    const interruptedWorkspace = await workspace("interrupted");
    const interrupted = await inputFor(incoming, interruptedWorkspace, "opaque-png.bin", {
      failpoint: "asset-before-rename"
    });
    const interruptions = [
      await codeOf(async () => importAsset(interrupted)),
      await codeOf(async () => importAsset(interrupted)),
      await codeOf(async () => importAsset(interrupted))
    ];
    const interruptionEntries = await readdir(path.join(interruptedWorkspace, "assets"));
    const recovered = await importAsset({ ...interrupted, failpoint: undefined });
    report = {
      schemaVersion: 1,
      ok: true,
      accepted: {
        generated: generated.record,
        userProvided: user.record,
        unknown: unknown.record
      },
      artifacts: {
        generatedDigestMatches: await digestFile(generated.artifactPath) === generated.record.assetDigest,
        userDigestMatches: await digestFile(user.artifactPath) === user.record.assetDigest,
        metadataMatches: canonicalJson(JSON.parse(await readFile(generated.metadataPath, "utf8")))
          === canonicalJson(generated.record)
      },
      unknownBlocker,
      rejections,
      noAcceptedFiles,
      destinationSecurity: {
        destinationChildSymlink,
        destinationRepairedRegular,
        externalUntouched,
        storedUnaffectedByExternalMutation,
        destinationTamper,
        tamperRecoveryDigest: tamperRecovered.record.assetDigest
      },
      interruptions,
      interruptionCleanup: interruptionEntries.length === 0,
      recoveryDigest: recovered.record.assetDigest
    };
    report.ok = Object.values(report.artifacts).every(Boolean)
      && Object.values(noAcceptedFiles).every(Boolean)
      && Object.values(rejections).every((code) => code !== "ACCEPTED")
      && rejections.duplicateSlot === "ASSET_SLOT_DUPLICATE"
      && rejections.invalidZlib === "PNG_IDAT_INVALID"
      && rejections.truncatedZlib === "PNG_IDAT_INVALID"
      && rejections.overrunZlib === "PNG_DECOMPRESSED_OVERRUN"
      && destinationChildSymlink === "ASSET_SYMLINK_FORBIDDEN"
      && destinationRepairedRegular
      && externalUntouched
      && storedUnaffectedByExternalMutation
      && destinationTamper === "ASSET_DIGEST_CONFLICT"
      && tamperRecovered.record.assetDigest === tamperImported.record.assetDigest
      && interruptions.every((code) => code === "ASSET_WRITE_INTERRUPTED")
      && report.interruptionCleanup
      && unknownBlocker === "ASSET_PUBLIC_PACKAGE_BLOCKED";
  } finally {
    if (server.listening) {
      await new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
    await rm(root, { recursive: true, force: true });
  }
  const rootRemoved = await access(root).then(() => false, () => true);
  return { ...report, cleanup: { rootRemoved, workspaces: workspaces.size, childProcesses: 0, specialNodes: 0 } };
};

try {
  const result = await run();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    ok: false,
    error: {
      code: error instanceof Error && "code" in error ? error.code : "MANUAL_QA_INTERNAL",
      message: error instanceof Error ? error.message : String(error)
    }
  })}\n`);
  process.exitCode = 1;
}
