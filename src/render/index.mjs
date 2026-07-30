import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalJsonBytes, canonicalSha256, validateContract } from "../contracts/index.ts";
import { createRendererBrowser } from "./browser.mjs";
import { buildCardHtml } from "./card.mjs";
import { buildContactSheetHtml } from "./contact-sheet.mjs";
import { RenderError } from "./errors.mjs";
import { loadRenderInput } from "./input.mjs";
import { inspectPng } from "./png.mjs";
import { verifyRenderInventory } from "./verify.mjs";

export { RenderError } from "./errors.mjs";
export { inspectPng } from "./png.mjs";
export { verifyRenderInventory } from "./verify.mjs";

export const RENDERER_VERSION = "1.0.0";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const exists = async (target) => {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
};
const interrupt = (failpoint, boundary) => {
  if (failpoint === boundary) throw new RenderError("RENDER_INTERRUPTED", `interrupted at ${boundary}`);
};

export const renderFixture = async (options) => {
  if (await exists(options.outputRoot)) throw new RenderError("OUTPUT_IMMUTABLE", "accepted render output already exists");
  if (typeof options.injectedCss === "string" && /(?:https?:|\/\/|file:)/iu.test(options.injectedCss)) {
    throw new RenderError("NETWORK_REQUEST_BLOCKED", "external CSS reference rejected: <redacted-url>");
  }
  const input = await loadRenderInput(options);
  const parent = path.dirname(options.outputRoot);
  await mkdir(parent, { recursive: true });
  const temporary = path.join(parent, `.${path.basename(options.outputRoot)}.${randomUUID()}.tmp`);
  options.onTemporaryOutput?.(temporary);
  const retainHtml = options.retainHtml === true;
  await mkdir(path.join(temporary, "cards"), { recursive: true });
  if (retainHtml) await mkdir(path.join(temporary, "html"), { recursive: true });
  await mkdir(path.join(temporary, "records"), { recursive: true });
  const renderer = await createRendererBrowser(input);
  const cards = [];
  let accepted = false;
  try {
    const recipeByCard = new Map(input.recipe.cards.map((card) => [card.cardId, card]));
    for (const cardId of input.spec.cardOrder) {
      const card = input.storyboard.cards.find((candidate) => candidate.id === cardId);
      const recipeCard = recipeByCard.get(cardId);
      if (card === undefined || recipeCard === undefined) throw new RenderError("CARD_BINDING_MISSING", cardId);
      const html = buildCardHtml({
        card,
        recipeCard,
        input,
        injectedCss: options.injectedCss,
        semanticTextTransform: options.semanticTextTransform
      });
      if (retainHtml) await writeFile(path.join(temporary, "html", `${cardId}.html`), html, { flag: "wx" });
      interrupt(options.failpoint, "after-html");
      const rendered = await renderer.renderHtml(html);
      const inspection = inspectPng(rendered.png);
      if (
        inspection.width !== input.target.dimensions.width ||
        inspection.height !== input.target.dimensions.height
      ) throw new RenderError("DIMENSIONS_MISMATCH", cardId, inspection);
      if (!inspection.opaque) throw new RenderError("PNG_ALPHA_INVALID", cardId);
      const relativePath = `cards/${cardId}.png`;
      await writeFile(path.join(temporary, relativePath), rendered.png, { flag: "wx" });
      interrupt(options.failpoint, "after-card");
      const canonicalRenderProfile = {
        viewport: input.spec.dimensions,
        deviceScaleFactor: input.spec.environment.deviceScaleFactor,
        locale: input.spec.environment.locale,
        timezone: input.spec.environment.timezone,
        colorScheme: "light",
        browser: input.spec.environment.browser,
        browserPackageRevision: input.spec.environment.browserRevision,
        browserVersion: renderer.version,
        fontDigests: [input.fonts.regular.entry.sha256, input.fonts.bold.entry.sha256],
        rendererVersion: RENDERER_VERSION
      };
      const environmentDigest = canonicalSha256(canonicalRenderProfile);
      const contract = {
        schemaVersion: "1.0.0",
        artifactId: `${cardId}-render`,
        renderSpecDigest: input.renderSpecDigest,
        cardId,
        relativePath,
        mediaType: "image/png",
        mediaSignature: inspection.signature,
        width: inspection.width,
        height: inspection.height,
        sha256: sha256(rendered.png),
        dependencyDigests: [...input.dependencyDigests, environmentDigest].sort()
      };
      const validation = validateContract("RenderArtifact", contract);
      if (!validation.ok) throw new RenderError("RENDER_ARTIFACT_INVALID", cardId, validation.issues);
      const artifact = {
        contract,
        cardOrder: card.order,
        byteCount: rendered.png.byteLength,
        alpha: "opaque",
        colorSpace: inspection.colorSpace,
        sourceRevision: input.sourceRevision,
        rendererVersion: RENDERER_VERSION,
        htmlSource: {
          ...(retainHtml ? { relativePath: `html/${cardId}.html` } : {}),
          sha256: sha256(Buffer.from(html)),
          byteCount: Buffer.byteLength(html)
        },
        dependencyIdentities: {
          records: input.manifest.records.map((entry) => ({ key: entry.key, sha256: entry.sha256 })),
          assets: recipeCard.assetBindings.map((binding) => ({
            slot: binding.slot,
            sha256: binding.assetDigest
          })),
          theme: { id: input.theme.themeId, sha256: input.manifest.resources.theme.sha256 },
          target: { id: input.target.targetId, sha256: input.manifest.resources.target.sha256 },
          fonts: [
            { weight: "Regular", sha256: input.fonts.regular.entry.sha256 },
            { weight: "Bold", sha256: input.fonts.bold.entry.sha256 }
          ],
          environment: { sha256: environmentDigest }
        },
        nativeEnvironment: input.nativeEnvironment,
        canonicalRenderProfile,
        canonicalRenderProfileDigest: environmentDigest,
        renderSpecRequestedPlatform: input.spec.environment.platform,
        geometry: rendered.report
      };
      await writeFile(
        path.join(temporary, "records", `${cardId}.render-artifact.json`),
        canonicalJsonBytes(artifact),
        { flag: "wx" }
      );
      interrupt(options.failpoint, "after-record");
      cards.push({ cardId, png: rendered.png, artifact });
    }
    const contactDimensions = { width: 1080, height: 1480 };
    const contactHtml = buildContactSheetHtml({ input, cards });
    const contactRendered = await renderer.renderStaticDocument(contactHtml, contactDimensions);
    const contactInspection = inspectPng(contactRendered.png);
    if (retainHtml) await writeFile(path.join(temporary, "contact-sheet.html"), contactHtml, { flag: "wx" });
    await writeFile(path.join(temporary, "contact-sheet.png"), contactRendered.png, { flag: "wx" });
    const manifest = {
      schemaVersion: 1,
      rendererVersion: RENDERER_VERSION,
      sourceRevision: input.sourceRevision,
      cardOrder: input.spec.cardOrder,
      artifacts: cards.map(({ artifact }) => artifact),
      contactSheet: {
        relativePath: "contact-sheet.png",
        ...(retainHtml ? { htmlRelativePath: "contact-sheet.html" } : {}),
        mediaType: "image/png",
        mediaSignature: contactInspection.signature,
        width: contactInspection.width,
        height: contactInspection.height,
        byteCount: contactRendered.png.byteLength,
        sha256: sha256(contactRendered.png),
        alpha: contactInspection.opaque ? "opaque" : "present",
        colorSpace: contactInspection.colorSpace,
        cardIds: input.spec.cardOrder
      },
      nativeEnvironment: input.nativeEnvironment,
      canonicalRenderProfile: cards[0]?.artifact.canonicalRenderProfile,
      canonicalRenderProfileDigest: cards[0]?.artifact.canonicalRenderProfileDigest,
      crossOsByteIdentity: "deferred-to-t14-ci"
    };
    await writeFile(path.join(temporary, "render-manifest.json"), canonicalJsonBytes(manifest), { flag: "wx" });
    interrupt(options.failpoint, "before-rename");
    await renderer.close();
    await rename(temporary, options.outputRoot);
    accepted = true;
    await verifyRenderInventory({ outputRoot: options.outputRoot, manifest });
    return {
      outputRoot: options.outputRoot,
      cardIds: input.spec.cardOrder,
      artifacts: manifest.artifacts,
      contactSheet: manifest.contactSheet,
      networkRequests: renderer.requests,
      runtime: { compromised: cards.some((card) => card.artifact.geometry.compromised) },
      nativeEnvironment: input.nativeEnvironment,
      canonicalRenderProfile: manifest.canonicalRenderProfile
    };
  } catch (error) {
    await renderer.close();
    throw error;
  } finally {
    if (!accepted) await rm(temporary, { recursive: true, force: true });
  }
};

export const readRenderManifest = async (outputRoot) =>
  JSON.parse(await readFile(path.join(outputRoot, "render-manifest.json"), "utf8"));
