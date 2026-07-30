import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { assertCardGeometry } from "../src/render/geometry.mjs";
import { inspectCardPage } from "../src/render/geometry-inspect.mjs";
import { inspectPng } from "../src/render/png.mjs";
import { verifyRenderInventory } from "../src/render/verify.mjs";
import { writeManualQaEvidence } from "./manual-qa-evidence.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const positional = process.argv.slice(2).filter((value) => value !== "--");
if (positional.length < 2) throw new Error("usage: manual-qa-render.mjs <render-root> <evidence-root>");
const outputRoot = path.resolve(positional[0]);
const evidenceRoot = path.resolve(positional[1]);
const capturesRoot = path.join(evidenceRoot, "captures");
await mkdir(capturesRoot, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(outputRoot, "render-manifest.json"), "utf8"));
const target = JSON.parse(await readFile(path.join(root, "targets", "portrait-social-1080x1350.json"), "utf8"));
await verifyRenderInventory({ outputRoot, manifest });
const htmlRetained = manifest.artifacts.every((artifact) => typeof artifact.htmlSource?.relativePath === "string")
  && typeof manifest.contactSheet.htmlRelativePath === "string";
if (!htmlRetained) {
  throw new Error("manual QA re-render requires retained render HTML; production render output omits the large inline HTML to stay lean — re-render the job with retainHtml enabled before running manual QA");
}
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const browser = await chromium.launch({
  headless: true,
  args: ["--force-color-profile=srgb", "--disable-background-networking", "--disable-component-update"]
});
const browserVersion = browser.version();
const reports = [];
let browserClosed = false;
try {
  const capture = async ({ id, htmlPath, expectedPath, dimensions, namedPhrases = [], cardGeometry = true }) => {
    const context = await browser.newContext({
      viewport: dimensions,
      deviceScaleFactor: 1,
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
      colorScheme: "light",
      reducedMotion: "reduce",
      serviceWorkers: "block"
    });
    const requests = [];
    const errors = [];
    await context.route("**/*", async (route) => {
      requests.push("<redacted-url>");
      await route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const html = await readFile(htmlPath, "utf8");
    const started = performance.now();
    await page.setContent(html, { waitUntil: "load", timeout: 20_000 });
    const metrics = cardGeometry
      ? await page.evaluate(inspectCardPage, { namedPhrases })
      : await page.evaluate(async () => {
        await document.fonts.ready;
        const fonts = [
          ...(await document.fonts.load('400 32px "Noto Sans CJK KR"', "한글")),
          ...(await document.fonts.load('700 62px "Noto Sans CJK KR"', "한글"))
        ];
        await Promise.all([...document.images].map((image) => image.decode()));
        const snapshot = () => [document.documentElement.scrollWidth, document.documentElement.scrollHeight];
        const first = snapshot();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return {
          fonts: fonts.map((face) => ({ family: face.family, weight: face.weight, status: face.status })),
          images: [...document.images].map((image) => ({
            complete: image.complete,
            naturalWidth: image.naturalWidth,
            alt: image.alt
          })),
          semantics: {
            language: document.documentElement.lang,
            articles: document.querySelectorAll("article").length,
            headings: document.querySelectorAll("h1").length,
            figures: document.querySelectorAll("figure").length,
            footers: document.querySelectorAll("footer").length
          },
          lineGroups: [],
          namedPhraseLines: [],
          viewport: {
            width: innerWidth,
            height: innerHeight,
            scrollWidth: document.documentElement.scrollWidth,
            scrollHeight: document.documentElement.scrollHeight
          },
          stableLayout: JSON.stringify(first) === JSON.stringify(snapshot())
        };
      });
    if (cardGeometry) assertCardGeometry(metrics, target);
    const geometryPassed = cardGeometry || (
      metrics.viewport.scrollWidth <= metrics.viewport.width &&
      metrics.viewport.scrollHeight <= metrics.viewport.height
    );
    const renderMilliseconds = Math.round((performance.now() - started) * 100) / 100;
    const capturePath = path.join(capturesRoot, `${id}.png`);
    const bytes = await page.screenshot({ path: capturePath, type: "png", animations: "disabled", caret: "hide" });
    const expected = await readFile(expectedPath);
    const png = inspectPng(bytes);
    await context.close();
    return {
      id,
      capturePath,
      sourceHtml: path.relative(outputRoot, htmlPath),
      expectedImage: path.relative(outputRoot, expectedPath),
      captureSha256: sha256(bytes),
      expectedSha256: sha256(expected),
      byteIdenticalToAcceptedRender: sha256(bytes) === sha256(expected),
      byteCount: bytes.byteLength,
      png,
      renderMilliseconds,
      boundedRenderTime: renderMilliseconds < 10_000,
      requests,
      errors,
      metrics,
      geometryPassed
    };
  };
  const namedPhrasesByCard = new Map([
    ["card-2", ["세 개씩"]],
    ["card-4", ["기록은 답안지가 아니라"]],
    ["card-5", ["실행할 명령"]],
    ["card-6", ["스물네 집 중 열여덟 집이"]],
    ["card-7", ["목적은 경쟁이 아니라"]]
  ]);
  for (const artifact of manifest.artifacts) {
    reports.push(await capture({
      id: artifact.contract.cardId,
      htmlPath: path.join(outputRoot, artifact.htmlSource.relativePath),
      expectedPath: path.join(outputRoot, artifact.contract.relativePath),
      dimensions: { width: artifact.contract.width, height: artifact.contract.height },
      namedPhrases: namedPhrasesByCard.get(artifact.contract.cardId) ?? []
    }));
  }
  reports.push(await capture({
    id: "contact-sheet",
    htmlPath: path.join(outputRoot, manifest.contactSheet.htmlRelativePath),
    expectedPath: path.join(outputRoot, manifest.contactSheet.relativePath),
    dimensions: { width: manifest.contactSheet.width, height: manifest.contactSheet.height },
    cardGeometry: false
  }));
} finally {
  await browser.close();
  browserClosed = true;
}

const { manualQa, inventory } = await writeManualQaEvidence({
  root,
  evidenceRoot,
  outputRoot,
  manifest,
  reports,
  browserVersion,
  browserClosed
});
process.stdout.write(`${JSON.stringify({ passed: manualQa.passed, inventory, checks: manualQa.checks })}\n`);
if (!manualQa.passed) process.exitCode = 1;
