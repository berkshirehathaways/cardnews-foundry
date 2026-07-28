import { createHash } from "node:crypto";
import { inspectPng } from "./png.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export const inspectShowcasePage = async () => {
  await document.fonts.ready;
  const exactFonts = [
    await document.fonts.load('400 24px "Noto Sans CJK KR"', "한글"),
    await document.fonts.load('700 24px "Noto Sans CJK KR"', "한글")
  ];
  const layout = () => [...document.querySelectorAll("[data-primitive]")].map((element) => {
    const rectangle = element.getBoundingClientRect();
    return [rectangle.x, rectangle.y, rectangle.width, rectangle.height];
  });
  const firstLayout = layout();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const secondLayout = layout();
  const channel = (value) => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (color) => {
    const normalizedColor = color.trim();
    const values = normalizedColor.startsWith("#")
      ? [
          Number.parseInt(normalizedColor.slice(1, 3), 16),
          Number.parseInt(normalizedColor.slice(3, 5), 16),
          Number.parseInt(normalizedColor.slice(5, 7), 16)
        ]
      : normalizedColor.match(/\d+/gu)?.slice(0, 3).map(Number) ?? [0, 0, 0];
    return 0.2126 * channel(values[0]) + 0.7152 * channel(values[1]) + 0.0722 * channel(values[2]);
  };
  const ratio = (left, right) => {
    const first = luminance(left);
    const second = luminance(right);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  };
  const contrastChecks = [...document.querySelectorAll(".theme-panel")].flatMap((panel) => {
    const style = getComputedStyle(panel);
    return [
      { pair: `${panel.dataset.theme}:primary-canvas`, ratio: ratio(style.getPropertyValue("--color-text-primary"), style.getPropertyValue("--color-canvas")), threshold: 4.5 },
      { pair: `${panel.dataset.theme}:secondary-surface`, ratio: ratio(style.getPropertyValue("--color-text-secondary"), style.getPropertyValue("--color-surface")), threshold: 4.5 },
      { pair: `${panel.dataset.theme}:accent-large-canvas`, ratio: ratio(style.getPropertyValue("--color-accent"), style.getPropertyValue("--color-canvas")), threshold: 3 }
    ];
  }).map((entry) => ({ ...entry, passed: entry.ratio >= entry.threshold }));
  const primitiveGeometry = [...document.querySelectorAll(".theme-panel")].flatMap((panel) =>
    [...panel.querySelectorAll("[data-primitive]")].map((element) => {
      const rectangle = element.getBoundingClientRect();
      return {
        theme: panel.dataset.theme,
        primitive: element.dataset.primitive,
        state: element.dataset.state ?? null,
        variant: element.dataset.variant ?? null,
        rectangle: {
          left: rectangle.left,
          top: rectangle.top,
          right: rectangle.right,
          bottom: rectangle.bottom
        },
        client: { width: element.clientWidth, height: element.clientHeight },
        scroll: { width: element.scrollWidth, height: element.scrollHeight },
        clipped: element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1
      };
    })
  );
  const overlaps = [...document.querySelectorAll(".theme-panel")].flatMap((panel) =>
    [...panel.querySelectorAll(".primitive-card,.contact-sheet-tile")].flatMap((container, cardIndex) => {
      const issues = [];
      const direct = [...container.children];
      for (let index = 1; index < direct.length; index += 1) {
        if (direct[index - 1].getBoundingClientRect().bottom > direct[index].getBoundingClientRect().top + 1) {
          issues.push({ theme: panel.dataset.theme, cardIndex, kind: "direct-flow" });
        }
      }
      for (const figure of container.querySelectorAll(".media-frame")) {
        const children = [...figure.children];
        if (figure.scrollWidth > figure.clientWidth + 1 || figure.scrollHeight > figure.clientHeight + 1) {
          issues.push({ theme: panel.dataset.theme, cardIndex, kind: "media-scroll" });
        }
        for (let index = 1; index < children.length; index += 1) {
          if (children[index - 1].getBoundingClientRect().bottom > children[index].getBoundingClientRect().top + 1) {
            issues.push({ theme: panel.dataset.theme, cardIndex, kind: "media-flow" });
          }
        }
      }
      return issues;
    })
  );
  const phraseLines = [...document.querySelectorAll("[data-keep-phrase]")].map((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return {
      phrase: element.textContent ?? "",
      lineCount: new Set([...range.getClientRects()].map((rectangle) => Math.round(rectangle.top * 10) / 10)).size
    };
  });
  const measureNamedPhrase = (expected) => {
    const root = document.querySelector(".theme-panel");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let content = "";
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const start = content.length;
      content += node.textContent ?? "";
      nodes.push({ node, start, end: content.length });
    }
    const start = content.replaceAll("\u00a0", " ").indexOf(expected);
    const end = start + expected.length;
    const first = nodes.find((entry) => entry.start <= start && entry.end > start);
    const last = nodes.find((entry) => entry.start < end && entry.end >= end);
    if (start < 0 || first === undefined || last === undefined) return { phrase: expected, lineCount: 0 };
    const range = document.createRange();
    range.setStart(first.node, start - first.start);
    range.setEnd(last.node, end - last.start);
    return {
      phrase: expected,
      lineCount: new Set([...range.getClientRects()].map((rectangle) => Math.round(rectangle.top * 10) / 10)).size
    };
  };
  const images = [...document.images].map((image) => ({
    complete: image.complete,
    naturalWidth: image.naturalWidth,
    alt: image.getAttribute("alt")
  }));
  return {
    exactFontFaces: exactFonts.map((faces) => faces.map((face) => ({
      family: face.family,
      status: face.status,
      weight: face.weight
    }))),
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    stableLayout: JSON.stringify(firstLayout) === JSON.stringify(secondLayout),
    contrastChecks,
    primitiveGeometry,
    overlaps,
    phraseLines,
    namedPhraseLines: ["가구", "기록을"].map(measureNamedPhrase),
    images,
    semantics: {
      main: document.querySelectorAll("main").length,
      sections: document.querySelectorAll("section[aria-labelledby]").length,
      figures: document.querySelectorAll("figure").length,
      fieldsets: document.querySelectorAll("fieldset").length,
      unlabeledImages: images.filter((image) => image.alt === null).length
    },
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    clientWidth: document.documentElement.clientWidth,
    runtimeCompromised: globalThis.compromised === true
  };
};

export const validateShowcaseCapture = ({ bytes, expectedWidth, expectedHeight, fresh }) => {
  const png = inspectPng(bytes);
  return {
    signature: png.signature,
    width: png.width,
    height: png.height,
    opaque: png.opaque,
    colorSpace: png.colorSpace,
    byteCount: bytes.byteLength,
    sha256: sha256(bytes),
    dimensionsMatch: png.width === expectedWidth && png.height === expectedHeight,
    fresh,
    passed:
      png.signature === "89504e470d0a1a0a" &&
      png.width === expectedWidth &&
      png.height === expectedHeight &&
      png.opaque &&
      png.colorSpace === "srgb" &&
      fresh
  };
};
