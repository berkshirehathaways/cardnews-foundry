import { chromium } from "playwright";
import { RenderError } from "./errors.mjs";
import { assertCardGeometry } from "./geometry.mjs";
import { inspectCardPage } from "./geometry-inspect.mjs";

const redactedRequest = () => "<redacted-url>";

export const createRendererBrowser = async (input) => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--force-color-profile=srgb",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-domain-reliability",
      "--disable-sync"
    ]
  });
  const context = await browser.newContext({
    viewport: input.spec.dimensions,
    deviceScaleFactor: input.spec.environment.deviceScaleFactor,
    locale: input.spec.environment.locale,
    timezoneId: input.spec.environment.timezone,
    colorScheme: "light",
    reducedMotion: "reduce",
    serviceWorkers: "block"
  });
  const requests = [];
  await context.route("**/*", async (route) => {
    requests.push(redactedRequest());
    await route.abort("blockedbyclient");
  });
  const renderHtml = async (html) => {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    try {
      await page.setContent(html, { waitUntil: "load", timeout: 20_000 });
      const report = await page.evaluate(inspectCardPage, {
        width: input.target.dimensions.width,
        height: input.target.dimensions.height,
        safe: input.target.safeArea
      });
      if (requests.length !== 0) throw new RenderError("NETWORK_REQUEST_BLOCKED", "outbound request blocked", requests);
      if (errors.length !== 0) throw new RenderError("RUNTIME_ERROR", "browser runtime emitted errors", errors);
      assertCardGeometry(report, input.target);
      const png = await page.screenshot({ type: "png", animations: "disabled", caret: "hide" });
      return { png, report, compromised: report.compromised };
    } finally {
      await page.close();
    }
  };
  const renderStaticDocument = async (html, dimensions) => {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    try {
      await page.setViewportSize(dimensions);
      await page.setContent(html, { waitUntil: "load", timeout: 20_000 });
      const report = await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map((image) => image.decode()));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return {
          fontsReady: document.fonts.status,
          images: [...document.images].map((image) => ({
            complete: image.complete,
            naturalWidth: image.naturalWidth,
            alt: image.alt
          })),
          viewport: {
            width: innerWidth,
            height: innerHeight,
            scrollWidth: document.documentElement.scrollWidth,
            scrollHeight: document.documentElement.scrollHeight
          }
        };
      });
      if (requests.length !== 0) throw new RenderError("NETWORK_REQUEST_BLOCKED", "outbound request blocked", requests);
      if (errors.length !== 0) throw new RenderError("RUNTIME_ERROR", "browser runtime emitted errors", errors);
      if (
        report.fontsReady !== "loaded" ||
        report.images.some((image) => !image.complete || image.naturalWidth < 1 || image.alt.trim().length === 0)
      ) {
        throw new RenderError("CONTACT_SHEET_READINESS_FAILED", "contact sheet resources did not settle", report);
      }
      if (
        report.viewport.width !== dimensions.width ||
        report.viewport.height !== dimensions.height ||
        report.viewport.scrollWidth > dimensions.width ||
        report.viewport.scrollHeight > dimensions.height
      ) {
        throw new RenderError("DOM_OVERFLOW", "contact sheet exceeds page boundary", report.viewport);
      }
      return { png: await page.screenshot({ type: "png", animations: "disabled", caret: "hide" }), report };
    } finally {
      await page.close();
    }
  };
  return {
    browser,
    context,
    requests,
    version: browser.version(),
    renderHtml,
    renderStaticDocument,
    close: async () => browser.close()
  };
};
