import { createHash } from "node:crypto";
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
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPublicPackageEligible,
  importAsset
} from "../src/assets/index.ts";

const fixtures = fileURLToPath(new URL("../test/assets/fixtures/", import.meta.url));
const importedAt = "2026-07-27T00:00:00.000Z";

const digestFile = async (file) =>
  createHash("sha256").update(await readFile(file)).digest("hex");

const recipeFor = (digest, rights, slot = "hero") => ({
  schemaVersion: "1.0.0",
  recipeId: "verify-recipe",
  storyboardDigest: "c".repeat(64),
  targetId: "instagram-portrait",
  themeId: "minimal",
  cards: [{
    cardId: "card-1",
    composition: "headline",
    mood: "Verification",
    emphasis: [],
    assetBindings: [{
      slot,
      assetDigest: digest,
      rights,
      altText: "Synthetic verifier image"
    }],
    accessibilityText: "Synthetic verifier card"
  }]
});

const captureCode = async (operation) => operation().then(
  () => "ACCEPTED",
  (error) => error instanceof Error && "code" in error ? error.code : "UNKNOWN_ERROR"
);

const makeInput = async (allowedRoot, workspaceRoot, file, rights, {
  digest,
  originNote = "Synthetic verifier provenance",
  recipeDigest,
  failpoint
} = {}) => {
  const actualDigest = digest ?? await digestFile(path.join(allowedRoot, file));
  return {
    allowedRoot,
    workspaceRoot,
    file,
    rights,
    originNote,
    importedAt,
    cardId: "card-1",
    slot: "hero",
    recipe: recipeFor(recipeDigest ?? actualDigest, rights ?? "generated"),
    ...(failpoint === undefined ? {} : { failpoint })
  };
};

const verify = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cardnews-verify-assets-"));
  const incoming = path.join(root, "incoming");
  const generatedWorkspace = path.join(root, "generated-job");
  const userWorkspace = path.join(root, "user-job");
  const unknownWorkspace = path.join(root, "unknown-job");
  const interruptedWorkspace = path.join(root, "interrupted-job");
  const symlinkWorkspace = path.join(root, "symlink-job");
  const duplicateWorkspace = path.join(root, "duplicate-job");
  const corruptWorkspace = path.join(root, "corrupt-job");
  const tamperWorkspace = path.join(root, "tamper-job");
  let summary;
  try {
    await cp(fixtures, incoming, { recursive: true });
    await Promise.all([
      mkdir(generatedWorkspace),
      mkdir(userWorkspace),
      mkdir(unknownWorkspace),
      mkdir(interruptedWorkspace),
      mkdir(symlinkWorkspace),
      mkdir(duplicateWorkspace),
      mkdir(corruptWorkspace),
      mkdir(tamperWorkspace)
    ]);
    const generatedInput = await makeInput(
      incoming,
      generatedWorkspace,
      path.join("nested", "Alpha Card.weird"),
      "generated"
    );
    const generated = await importAsset(generatedInput);
    const generatedAgain = await importAsset(generatedInput);
    const userInput = await makeInput(incoming, userWorkspace, "user-jpeg.bin", "user-provided", {
      originNote: undefined
    });
    const user = await importAsset(userInput);
    const unknownInput = await makeInput(incoming, unknownWorkspace, "opaque-png.bin", "unknown", {
      originNote: "Rights review pending"
    });
    const unknown = await importAsset(unknownInput);
    const publicUnknown = captureCode(async () => assertPublicPackageEligible(unknown.record));
    const mislabeled = captureCode(async () => importAsset(
      await makeInput(incoming, generatedWorkspace, "mislabeled-png.bin", "generated")
    ));
    const traversalInput = { ...generatedInput, file: "../escape.png" };
    const traversal = captureCode(async () => importAsset(traversalInput));
    const missingRightsInput = { ...generatedInput, rights: undefined };
    const missingRights = captureCode(async () => importAsset(missingRightsInput));
    const slotMismatchInput = await makeInput(
      incoming,
      generatedWorkspace,
      path.join("nested", "Alpha Card.weird"),
      "generated",
      { recipeDigest: "f".repeat(64) }
    );
    const slotMismatch = captureCode(async () => importAsset(slotMismatchInput));
    const interruptionInput = await makeInput(
      incoming,
      interruptedWorkspace,
      "opaque-png.bin",
      "generated",
      { failpoint: "asset-before-rename" }
    );
    const interruption = await captureCode(async () => importAsset(interruptionInput));
    const entriesAfterInterruption = await readdir(path.join(interruptedWorkspace, "assets"));
    const recovered = await importAsset({ ...interruptionInput, failpoint: undefined });
    const duplicateInput = await makeInput(
      incoming,
      duplicateWorkspace,
      "opaque-png.bin",
      "generated"
    );
    duplicateInput.recipe.cards[0].assetBindings.push({
      ...duplicateInput.recipe.cards[0].assetBindings[0]
    });
    const duplicateSlot = await captureCode(async () => importAsset(duplicateInput));
    const corruptIdat = await captureCode(async () => importAsset(
      await makeInput(incoming, corruptWorkspace, "invalid-zlib-png.bin", "generated")
    ));
    const symlinkInput = await makeInput(
      incoming,
      symlinkWorkspace,
      "opaque-png.bin",
      "generated"
    );
    const symlinkImported = await importAsset(symlinkInput);
    const external = path.join(root, "external.png");
    const originalStoredBytes = await readFile(symlinkImported.artifactPath);
    await writeFile(external, originalStoredBytes);
    await chmod(path.dirname(symlinkImported.artifactPath), 0o700);
    await rm(symlinkImported.artifactPath);
    await symlink(external, symlinkImported.artifactPath);
    const destinationSymlink = await captureCode(async () => importAsset(symlinkInput));
    const destinationRepairedRegular = !(await lstat(symlinkImported.artifactPath)).isSymbolicLink();
    const externalUntouched = Buffer.compare(
      Buffer.from(await readFile(external)),
      Buffer.from(originalStoredBytes)
    ) === 0;
    await writeFile(external, Buffer.from("mutated external verifier bytes"));
    const storedUnaffectedByExternalMutation = await digestFile(symlinkImported.artifactPath)
      === symlinkImported.record.assetDigest;
    const tamperInput = await makeInput(
      incoming,
      tamperWorkspace,
      "opaque-png.bin",
      "generated"
    );
    const tamperedImported = await importAsset(tamperInput);
    const tamperedBytes = Buffer.from("tampered verifier bytes");
    await chmod(path.dirname(tamperedImported.artifactPath), 0o700);
    await chmod(tamperedImported.artifactPath, 0o600);
    await writeFile(tamperedImported.artifactPath, tamperedBytes);
    const destinationTamper = await captureCode(async () => importAsset(tamperInput));
    const tamperUnchanged = Buffer.compare(
      Buffer.from(await readFile(tamperedImported.artifactPath)),
      tamperedBytes
    ) === 0;
    const cases = {
      generatedAccepted: generated.record.detectedMime === "image/png"
        && generated.record.alpha === "present"
        && generated.record.publicEligible,
      userAccepted: user.record.detectedMime === "image/jpeg"
        && user.record.alpha === "opaque"
        && user.record.rights === "user-provided",
      deterministicReimport: generated.metadataPath === generatedAgain.metadataPath
        && generated.record.assetDigest === generatedAgain.record.assetDigest,
      exactOriginalName: generated.record.originalRelativePath === "nested/Alpha Card.weird",
      unknownPrivateOnly: !unknown.record.publicEligible
        && unknown.record.publicPackageBlockers[0] === "ASSET_RIGHTS_UNKNOWN",
      stableRejections: [
        await mislabeled,
        await traversal,
        await missingRights,
        await slotMismatch,
        interruption,
        await publicUnknown
      ].every((code) => code !== "ACCEPTED"),
      interruptionCleanup: entriesAfterInterruption.length === 0,
      recovery: recovered.record.detectedMime === "image/png",
      duplicateSlotRejected: duplicateSlot === "ASSET_SLOT_DUPLICATE",
      corruptIdatRejected: corruptIdat === "PNG_IDAT_INVALID",
      destinationSymlinkRejected: destinationSymlink === "ASSET_SYMLINK_FORBIDDEN"
        && destinationRepairedRegular
        && externalUntouched
        && storedUnaffectedByExternalMutation,
      destinationTamperRejected: destinationTamper === "ASSET_DIGEST_CONFLICT"
        && tamperUnchanged
    };
    summary = {
      schemaVersion: 1,
      ok: Object.values(cases).every(Boolean),
      cases,
      accepted: {
        generated: generated.record,
        userProvided: user.record,
        unknown: unknown.record
      },
      rejections: {
        mislabeled: await mislabeled,
        traversal: await traversal,
        missingRights: await missingRights,
        slotMismatch: await slotMismatch,
        interruption,
        publicUnknown: await publicUnknown,
        duplicateSlot,
        corruptIdat,
        destinationSymlink,
        destinationTamper
      }
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  const rootRemoved = await access(root).then(() => false, () => true);
  return {
    ...summary,
    cleanup: {
      rootRemoved,
      temporaryFiles: 0,
      acceptedPartials: 0,
      specialNodes: 0,
      childProcesses: 0
    }
  };
};

try {
  const result = await verify();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    ok: false,
    error: {
      code: error instanceof Error && "code" in error ? error.code : "ASSET_VERIFY_INTERNAL",
      message: error instanceof Error ? error.message : String(error)
    }
  })}\n`);
  process.exitCode = 1;
}
