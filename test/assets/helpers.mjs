import { createHash } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const fixtureRoot = fileURLToPath(new URL("./fixtures/", import.meta.url));
export const fixedTimestamp = "2026-07-27T00:00:00.000Z";

export const digestFile = async (file) =>
  createHash("sha256").update(await readFile(file)).digest("hex");

export const recipeFor = (assetDigest, {
  cardId = "card-1",
  slot = "hero",
  rights = "generated"
} = {}) => ({
  schemaVersion: "1.0.0",
  recipeId: "recipe-1",
  storyboardDigest: "c".repeat(64),
  targetId: "instagram-portrait",
  themeId: "minimal",
  cards: [{
    cardId,
    composition: "headline",
    mood: "Focused",
    emphasis: [],
    assetBindings: [{
      slot,
      assetDigest,
      rights,
      altText: "Synthetic test image"
    }],
    accessibilityText: "Synthetic test card"
  }]
});

export const makeSandbox = async (context, prefix = "cardnews-assets-") => {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  const allowedRoot = path.join(root, "incoming");
  const workspaceRoot = path.join(root, "job");
  await cp(fixtureRoot, allowedRoot, { recursive: true });
  await mkdir(workspaceRoot);
  context.after(async () => rm(root, { recursive: true, force: true }));
  return { root, allowedRoot, workspaceRoot };
};

export const importInput = async ({
  root: _testRoot,
  allowedRoot,
  workspaceRoot,
  file = path.join("nested", "Alpha Card.weird"),
  rights = "generated",
  originNote = "Generated locally for deterministic test use",
  cardId = "card-1",
  slot = "hero",
  recipe,
  ...extra
}) => {
  const digest = await digestFile(path.join(allowedRoot, file));
  return {
    allowedRoot,
    workspaceRoot,
    file,
    rights,
    originNote,
    importedAt: fixedTimestamp,
    cardId,
    slot,
    recipe: recipe ?? recipeFor(digest, { cardId, slot, rights }),
    ...extra
  };
};
