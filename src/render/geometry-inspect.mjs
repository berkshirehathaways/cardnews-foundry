export const inspectCardPage = async (expected) => {
  await document.fonts.ready;
  const regular = await document.fonts.load('400 34px "Noto Sans CJK KR"', "한글 관찰 기록");
  const bold = await document.fonts.load('700 62px "Noto Sans CJK KR"', "한글 관찰 기록");
  const images = [...document.images];
  await Promise.all(images.map((image) => image.complete
    ? Promise.resolve()
    : new Promise((resolve, reject) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", reject, { once: true });
    })));

  const rectangle = (element) => {
    const value = element.getBoundingClientRect();
    return {
      left: value.left,
      top: value.top,
      right: value.right,
      bottom: value.bottom
    };
  };
  const textRectangles = (element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return [...range.getClientRects()]
      .filter((value) => value.width > 0 && value.height > 0)
      .map((value) => ({
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom
      }));
  };
  const measurePhrase = (phrase) => {
    const root = document.querySelector(".safe-area") ?? document.body;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let content = "";
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const start = content.length;
      content += node.textContent ?? "";
      nodes.push({ node, start, end: content.length });
    }
    const start = content.replaceAll("\u00a0", " ").indexOf(phrase);
    const end = start + phrase.length;
    const first = nodes.find((entry) => entry.start <= start && entry.end > start);
    const last = nodes.find((entry) => entry.start < end && entry.end >= end);
    if (start < 0 || first === undefined || last === undefined) return { phrase, lineCount: 0, rectangles: [] };
    const range = document.createRange();
    range.setStart(first.node, start - first.start);
    range.setEnd(last.node, end - last.start);
    const rectangles = [...range.getClientRects()].map((value) => ({
      left: value.left,
      top: value.top,
      right: value.right,
      bottom: value.bottom
    }));
    return {
      phrase,
      lineCount: new Set(rectangles.map((value) => Math.round(value.top * 10) / 10)).size,
      rectangles
    };
  };
  const snapshot = () => [...document.querySelectorAll("[data-box]")]
    .map((element) => Object.values(rectangle(element)));
  const first = await new Promise((resolve) => requestAnimationFrame(() => resolve(snapshot())));
  const second = await new Promise((resolve) => requestAnimationFrame(() => resolve(snapshot())));
  const safeElement = document.querySelector(".safe-area");
  const safe = safeElement === null ? null : rectangle(safeElement);
  const containers = ".safe-area,.card-content,.hero-region,.split-region,.split-support,.diagram";
  const boxes = [...document.querySelectorAll("[data-box]")].map((element) => {
    let container = element.parentElement;
    while (container !== null && !container.matches(containers)) container = container.parentElement;
    return {
      className: String(element.className),
      rectangle: rectangle(element),
      textRectangles: textRectangles(element),
      containerClassName: container === null ? null : String(container.className),
      containerRectangle: container === null ? null : rectangle(container),
      client: { width: element.clientWidth, height: element.clientHeight },
      scroll: { width: element.scrollWidth, height: element.scrollHeight }
    };
  });
  const flowSelectors = [
    ".sequence-marker", ".eyebrow", ".headline-block h1", ".hero-region", ".split-region",
    ".card-content > .quote-block", ".safe-area > .quote-block", ".card-content > .callout-block",
    ".safe-area > .callout-block", ".diagram", ".accent-rule", ".closing-statement",
    ".card-content > .body-block", ".safe-area > .body-block", ".provenance-footer"
  ].join(",");
  const flow = [...document.querySelectorAll(flowSelectors)].map((element) => {
    const painted = textRectangles(element);
    return {
      name: element.matches(".sequence-marker") ? "sequence" :
        element.matches(".eyebrow") ? "eyebrow" :
          element.matches("h1") ? "headline" :
            element.matches(".provenance-footer") ? "footer" :
              String(element.className),
      rectangle: rectangle(element),
      paintRectangles: painted.length === 0 ? [rectangle(element)] : painted
    };
  });
  const diagramElement = document.querySelector(".diagram");
  const diagram = diagramElement === null ? null : {
    rectangle: rectangle(diagramElement),
    items: [...diagramElement.children].map((element) => ({
      name: element.tagName,
      rectangle: rectangle(element)
    }))
  };
  const footerElement = document.querySelector(".provenance-footer");
  const footer = footerElement === null ? null : {
    rectangle: rectangle(footerElement),
    textRectangles: textRectangles(footerElement)
  };
  const lineGroups = [...document.querySelectorAll("[data-keep-phrase]")].map((element) => {
    const rectangles = textRectangles(element);
    return {
      phrase: element.textContent ?? "",
      lineCount: new Set(rectangles.map((value) => Math.round(value.top * 10) / 10)).size,
      rectangles
    };
  });
  return {
    fonts: {
      regular: regular.map((face) => ({ family: face.family, weight: face.weight, status: face.status })),
      bold: bold.map((face) => ({ family: face.family, weight: face.weight, status: face.status }))
    },
    images: images.map((image) => ({ complete: image.complete, naturalWidth: image.naturalWidth, alt: image.alt })),
    semantics: {
      language: document.documentElement.lang,
      articles: document.querySelectorAll("article").length,
      headings: document.querySelectorAll("h1").length,
      figures: document.querySelectorAll("figure").length,
      footers: document.querySelectorAll("footer").length
    },
    safe,
    boxes,
    flow,
    diagram,
    footer,
    lineGroups,
    namedPhraseLines: (expected.namedPhrases ?? []).map(measurePhrase),
    viewport: {
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight
    },
    stableLayout: JSON.stringify(first) === JSON.stringify(second),
    compromised: globalThis.compromised === true,
    expected
  };
};
