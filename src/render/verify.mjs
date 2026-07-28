import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { inspectPng } from "./png.mjs";
import { RenderError } from "./errors.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export const verifyRenderInventory = async ({ outputRoot, manifest }) => {
  const expected = manifest.cardOrder;
  const actual = manifest.artifacts.map((artifact) => artifact.contract.cardId);
  if (new Set(actual).size !== expected.length || actual.length !== expected.length) {
    throw new RenderError("CARD_SET_MISMATCH", "rendered card set is incomplete or duplicated", { expected, actual });
  }
  if (actual.some((cardId, index) => cardId !== expected[index])) {
    throw new RenderError("CARD_ORDER_MISMATCH", "rendered card order differs", { expected, actual });
  }
  for (const artifact of manifest.artifacts) {
    const bytes = await readFile(path.join(outputRoot, artifact.contract.relativePath));
    const png = inspectPng(bytes);
    if (sha256(bytes) !== artifact.contract.sha256) {
      throw new RenderError("CARD_DIGEST_MISMATCH", artifact.contract.cardId);
    }
    if (
      png.width !== artifact.contract.width ||
      png.height !== artifact.contract.height ||
      png.signature !== artifact.contract.mediaSignature ||
      !png.opaque ||
      artifact.byteCount !== bytes.byteLength ||
      artifact.alpha !== "opaque" ||
      artifact.colorSpace !== "srgb"
    ) {
      throw new RenderError("CARD_MEDIA_MISMATCH", artifact.contract.cardId, png);
    }
  }
  const contactBytes = await readFile(path.join(outputRoot, manifest.contactSheet.relativePath));
  const contact = inspectPng(contactBytes);
  if (sha256(contactBytes) !== manifest.contactSheet.sha256) {
    throw new RenderError("CONTACT_SHEET_DIGEST_MISMATCH", "contact sheet digest differs");
  }
  if (!contact.opaque) throw new RenderError("CONTACT_SHEET_ALPHA_INVALID", "contact sheet is not opaque");
  if (
    manifest.contactSheet.cardIds.length !== expected.length ||
    manifest.contactSheet.cardIds.some((cardId, index) => cardId !== expected[index])
  ) {
    throw new RenderError("CONTACT_SHEET_CARD_MISMATCH", "contact sheet inventory differs");
  }
  return { ok: true, cardIds: actual, contactSheet: contact };
};
