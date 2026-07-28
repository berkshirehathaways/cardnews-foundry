import { access, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { computeRendererSourceRevision } from "../src/render/input.mjs";
import { buildShowcaseHtml } from "../src/render/showcase.mjs";
import { inspectShowcasePage, validateShowcaseCapture } from "../src/render/showcase-audit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argument = process.argv.slice(2).find((value) => value !== "--");
const evidenceDir = path.resolve(argument ?? path.join(root, ".cardnews", "showcase-qa"));
const capturesDir = path.join(evidenceDir, "captures");
const compositorSafeHeight = 12_000;
await mkdir(capturesDir, { recursive: true });

const html = await buildShowcaseHtml({ repositoryRoot: root });
const sourceRevision = await computeRendererSourceRevision(root);
const renderSourceNames = (await readdir(path.join(root, "src", "render")))
  .filter((name) => name.endsWith(".mjs"));
const sourceStats = await Promise.all([
  stat(path.join(root, "DESIGN.md")),
  ...renderSourceNames.map((name) => stat(path.join(root, "src", "render", name)))
]);
const latestSourceMtime = Math.max(...sourceStats.map((entry) => entry.mtimeMs));

const pageSegments = async (page, capture) => {
  if (!capture.zoomSegments) {
    return page.evaluate((name) => [{
      name,
      x: 0,
      y: 0,
      width: document.documentElement.clientWidth,
      height: document.documentElement.scrollHeight
    }], capture.name);
  }
  return page.evaluate(({ maximumHeight, zoom }) => {
    const ink = document.querySelector('[data-theme="ink-paper"]');
    const signal = document.querySelector('[data-theme="signal-night"]');
    const pageHeight = Math.floor(document.documentElement.getBoundingClientRect().bottom);
    const width = document.documentElement.clientWidth;
    const inkTop = Math.floor(ink.getBoundingClientRect().top + scrollY);
    const signalTop = Math.floor(signal.getBoundingClientRect().top + scrollY);
    const segments = [
      { name: "zoom-intro-controls", x: 0, y: 0, width, height: inkTop, pageBottom: pageHeight },
      { name: "zoom-ink-panel", x: 0, y: inkTop, width, height: signalTop - inkTop, pageBottom: pageHeight },
      { name: "zoom-signal-panel", x: 0, y: signalTop, width, height: pageHeight - signalTop, pageBottom: pageHeight }
    ];
    if (segments.some((segment) => segment.height < 1 || segment.height * zoom > maximumHeight)) {
      throw new Error("compositor-safe segment bound violated");
    }
    return segments;
  }, { maximumHeight: compositorSafeHeight, zoom: capture.zoom });
};

const captureSuite = async ({ executablePath, label, cases }) => {
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--force-color-profile=srgb", "--disable-background-networking"]
  });
  const reports = [];
  const browserVersion = browser.version();
  try {
    for (const capture of cases) {
      const context = await browser.newContext({
        viewport: { width: capture.width / capture.zoom, height: 900 / capture.zoom },
        deviceScaleFactor: capture.zoom,
        locale: "ko-KR",
        timezoneId: "Asia/Seoul",
        colorScheme: "light",
        reducedMotion: capture.reducedMotion ? "reduce" : "no-preference",
        serviceWorkers: "block"
      });
      const requests = [];
      const errors = [];
      await context.route("**/*", async (route) => {
        requests.push("<redacted-non-data-request>");
        await route.abort("blockedbyclient");
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await page.setContent(html, { waitUntil: "load", timeout: 20_000 });
      const inspection = await page.evaluate(inspectShowcasePage);
      await page.keyboard.press("Tab");
      const focus = await page.evaluate(() => ({
        tag: document.activeElement?.tagName ?? "",
        type: document.activeElement?.getAttribute("type") ?? "",
        visible: document.activeElement instanceof HTMLElement
          ? getComputedStyle(document.activeElement).outlineStyle !== "none"
          : false
      }));
      const transitionDuration = await page.locator(".theme-panel").first().evaluate(
        (element) => getComputedStyle(element).transitionDuration
      );
      const segments = await pageSegments(page, capture);
      for (const segment of segments) {
        const file = path.join(capturesDir, `showcase-${label}-${segment.name}.png`);
        const screenshotClip = {
          x: segment.x,
          y: 0,
          width: segment.width,
          height: segment.height
        };

        await page.setViewportSize({ width: segment.width, height: segment.height });
        if (segment.y !== 0) {
          await page.evaluate((offset) => {
            document.documentElement.style.overflow = "hidden";
            document.body.style.transform = `translateY(${-offset}px)`;
            document.body.style.transformOrigin = "top left";
          }, segment.y);
        }
        let bytes;
        try {
          bytes = await page.screenshot({
            path: file,
            type: "png",
            animations: "disabled",
            caret: "hide",
            captureBeyondViewport: true,
            clip: screenshotClip
          });
        } catch (error) {
          throw new Error(`showcase capture failed: ${label}/${segment.name} ${JSON.stringify(segment)}`, {
            cause: error
          });
        }
        if (segment.y !== 0) {
          await page.evaluate(() => {
            document.documentElement.style.overflow = "";
            document.body.style.transform = "";
            document.body.style.transformOrigin = "";
          });
        }
        const captureStat = await stat(file);
        reports.push({
          name: segment.name,
          width: capture.width,
          zoom: capture.zoom,
          reducedMotion: capture.reducedMotion,
          file,
          browser: label,
          browserVersion,
          clip: segment,
          partition: capture.zoomSegments ? "zoom-three-segment-complete-partition" : "complete-page",
          validation: validateShowcaseCapture({
            bytes,
            expectedWidth: segment.width * capture.zoom,
            expectedHeight: segment.height * capture.zoom,
            fresh: captureStat.mtimeMs >= latestSourceMtime
          }),
          requests,
          errors,
          focus,
          transitionDuration,
          inspection
        });
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return { browserVersion, reports };
};

const pinned = await captureSuite({
  executablePath: chromium.executablePath(),
  label: "pinned",
  cases: [
    { name: "375", width: 375, zoom: 1, reducedMotion: false, zoomSegments: false },
    { name: "768", width: 768, zoom: 1, reducedMotion: false, zoomSegments: false },
    { name: "1280", width: 1280, zoom: 1, reducedMotion: false, zoomSegments: false },
    { name: "zoom-200", width: 1280, zoom: 2, reducedMotion: true, zoomSegments: true }
  ]
});

const stablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let stable = { browserVersion: "unavailable", reports: [] };
try {
  await access(stablePath);
  stable = await captureSuite({
    executablePath: stablePath,
    label: "chrome-stable",
    cases: [{ name: "1280", width: 1280, zoom: 1, reducedMotion: false, zoomSegments: false }]
  });
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

const captures = [...pinned.reports, ...stable.reports];
const zoom = captures.filter((entry) => entry.partition === "zoom-three-segment-complete-partition");
const zoomPartition = {
  captureCount: zoom.length,
  contiguous: zoom.length === 3 && zoom.every((entry, index) =>
    index === 0 || zoom[index - 1].clip.y + zoom[index - 1].clip.height === entry.clip.y
  ),
  startsAtPageTop: zoom[0]?.clip.y === 0,
  endsAtPageBottom: zoom.length === 3 &&
    zoom[2].clip.y + zoom[2].clip.height === zoom[2].clip.pageBottom,
  belowCompositorLimit: zoom.every((entry) => entry.clip.height * entry.zoom <= compositorSafeHeight)
};
const failures = captures.flatMap((entry) => {
  const issues = [];
  if (entry.requests.length !== 0) issues.push("network");
  if (entry.errors.length !== 0) issues.push("runtime-errors");
  if (entry.inspection.horizontalOverflow) issues.push("horizontal-overflow");
  if (!entry.inspection.stableLayout) issues.push("layout-shift");
  if (entry.inspection.contrastChecks.some((check) => !check.passed)) issues.push("contrast");
  if (entry.inspection.images.some((image) => !image.complete || image.naturalWidth === 0)) issues.push("image-readiness");
  if (entry.inspection.semantics.main !== 1 || entry.inspection.semantics.sections !== 2) issues.push("semantic-structure");
  if (entry.inspection.semantics.unlabeledImages !== 0) issues.push("image-alt");
  if (entry.inspection.exactFontFaces.flat().some((face) => face.family !== "Noto Sans CJK KR" || face.status !== "loaded")) issues.push("font-exactness");
  if (entry.inspection.primitiveGeometry.some((primitive) => primitive.clipped)) issues.push("primitive-clipping");
  if (entry.inspection.overlaps.length !== 0) issues.push("primitive-overlap");
  if (entry.inspection.phraseLines.some((phrase) => phrase.lineCount !== 1)) issues.push("korean-phrase-line");
  if (entry.inspection.namedPhraseLines.some((phrase) => phrase.lineCount !== 1)) issues.push("korean-named-line");
  if (entry.reducedMotion && entry.transitionDuration !== "0s") issues.push("reduced-motion");
  if (!entry.focus.visible) issues.push("focus-visible");
  if (!entry.validation.passed) issues.push("capture-validation");
  return issues.map((issue) => ({ capture: entry.name, browser: entry.browser, issue }));
});
if (!Object.values(zoomPartition).every((value) => value === true || value === 3)) {
  failures.push({ capture: "zoom-partition", browser: "pinned", issue: "partition-integrity" });
}

const report = {
  schemaVersion: 1,
  sourceRevision,
  surface: "primitive-showcase",
  lighthouse: {
    status: "N/A",
    reason: "Fixed offline artifact renderer; no hosted, navigable, or indexable public page exists."
  },
  browsers: {
    pinnedChromium: pinned.browserVersion,
    chromeStable: stable.browserVersion
  },
  captureCount: captures.length,
  captures,
  zoomPartition,
  checks: {
    zeroNetwork: captures.every((entry) => entry.requests.length === 0),
    zeroRuntimeErrors: captures.every((entry) => entry.errors.length === 0),
    noHorizontalOverflow: captures.every((entry) => !entry.inspection.horizontalOverflow),
    zeroLayoutShiftAfterReadiness: captures.every((entry) => entry.inspection.stableLayout),
    contrast: captures.every((entry) => entry.inspection.contrastChecks.every((check) => check.passed)),
    exactFonts: captures.every((entry) => entry.inspection.exactFontFaces.flat().every(
      (face) => face.family === "Noto Sans CJK KR" && face.status === "loaded"
    )),
    semanticStructure: captures.every((entry) => entry.inspection.semantics.main === 1),
    primitiveGeometry: captures.every((entry) =>
      entry.inspection.primitiveGeometry.every((primitive) => !primitive.clipped) &&
      entry.inspection.overlaps.length === 0
    ),
    koreanLineGrouping: captures.every((entry) =>
      entry.inspection.phraseLines.every((phrase) => phrase.lineCount === 1) &&
      entry.inspection.namedPhraseLines.every((phrase) => phrase.lineCount === 1)
    ),
    focusVisible: captures.every((entry) => entry.focus.visible),
    reducedMotion: captures.filter((entry) => entry.reducedMotion).every((entry) => entry.transitionDuration === "0s"),
    captureIntegrity: captures.every((entry) => entry.validation.passed),
    completeZoomPartition: zoomPartition.contiguous && zoomPartition.startsAtPageTop &&
      zoomPartition.endsAtPageBottom && zoomPartition.belowCompositorLimit
  },
  failures,
  passed: failures.length === 0,
  cleanup: { browserClosed: true, serverStarted: false, processesRemaining: 0 }
};
await writeFile(path.join(evidenceDir, "showcase-qa.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report)}\n`);
if (!report.passed) process.exitCode = 1;
