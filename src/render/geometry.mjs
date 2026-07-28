import { RenderError } from "./errors.mjs";

export const assertCardGeometry = (report, target) => {
  const epsilon = 0.1;
  const contains = (outer, inner) =>
    inner.left >= outer.left - epsilon &&
    inner.top >= outer.top - epsilon &&
    inner.right <= outer.right + epsilon &&
    inner.bottom <= outer.bottom + epsilon;
  const intersects = (left, right) =>
    left.right > right.left + epsilon &&
    right.right > left.left + epsilon &&
    left.bottom > right.top + epsilon &&
    right.bottom > left.top + epsilon;
  const page = { left: 0, top: 0, right: target.dimensions.width, bottom: target.dimensions.height };
  const faceList = [...report.fonts.regular, ...report.fonts.bold];
  if (
    faceList.length !== 2 ||
    faceList.some((face) => face.family !== "Noto Sans CJK KR" || face.status !== "loaded") ||
    report.fonts.regular[0]?.weight !== "400" ||
    report.fonts.bold[0]?.weight !== "700"
  ) {
    throw new RenderError("FONT_LOAD_FAILED", "exact Noto font faces did not load", report.fonts);
  }
  if (report.images.some((image) => !image.complete || image.naturalWidth < 1)) {
    throw new RenderError("ASSET_LOAD_FAILED", "bound image did not decode");
  }
  if (report.images.some((image) => image.alt.trim().length === 0)) {
    throw new RenderError("ASSET_ALT_MISSING", "meaningful media requires alt text");
  }
  if (!report.stableLayout) throw new RenderError("LAYOUT_UNSTABLE", "layout changed after readiness");
  const safe = report.safe;
  const expected = target.safeArea.insets;
  if (
    safe === null ||
    Math.abs(safe.left - expected.left) > 0.01 ||
    Math.abs(safe.top - expected.top) > 0.01 ||
    Math.abs(safe.right - (target.dimensions.width - expected.right)) > 0.01 ||
    Math.abs(safe.bottom - (target.dimensions.height - expected.bottom)) > 0.01
  ) {
    throw new RenderError("SAFE_AREA_VIOLATION", "safe area moved outside the target contract", safe);
  }
  if (
    report.viewport.width !== target.dimensions.width ||
    report.viewport.height !== target.dimensions.height ||
    report.viewport.scrollWidth > report.viewport.width ||
    report.viewport.scrollHeight > report.viewport.height
  ) {
    throw new RenderError("DOM_OVERFLOW", "page exceeds the target boundary", report.viewport);
  }
  if (report.diagram !== null) {
    if (
      !contains(safe, report.diagram.rectangle) ||
      !contains(page, report.diagram.rectangle) ||
      report.diagram.items.some((item) => !contains(report.diagram.rectangle, item.rectangle))
    ) {
      throw new RenderError("DIAGRAM_GEOMETRY", "diagram item leaves its container", report.diagram);
    }
    for (let left = 0; left < report.diagram.items.length; left += 1) {
      for (let right = left + 1; right < report.diagram.items.length; right += 1) {
        if (intersects(report.diagram.items[left].rectangle, report.diagram.items[right].rectangle)) {
          throw new RenderError("DIAGRAM_GEOMETRY", "diagram items overlap", { left, right, diagram: report.diagram });
        }
      }
    }
  }
  for (const box of report.boxes) {
    if (!contains(page, box.rectangle)) {
      throw new RenderError("DOM_OVERFLOW", "declared box exceeds page boundary", box);
    }
    if (box.scroll.width > box.client.width + 1 || box.scroll.height > box.client.height + 1) {
      throw new RenderError("DOM_CLIPPING", "declared box clips its content", box);
    }
  }
  for (let index = 1; index < report.flow.length; index += 1) {
    const before = report.flow[index - 1];
    const after = report.flow[index];
    if (before.paintRectangles.some((left) => after.paintRectangles.some((right) => intersects(left, right)))) {
      throw new RenderError("DOM_PAINT_OVERLAP", "ordered flow regions paint over each other", { before, after });
    }
    const beforeBottom = Math.max(...before.paintRectangles.map((value) => value.bottom));
    const afterTop = Math.min(...after.paintRectangles.map((value) => value.top));
    if (beforeBottom > afterTop + epsilon) {
      throw new RenderError("DOM_PAINT_OVERLAP", "ordered flow regions reverse paint order", { before, after });
    }
  }
  if (
    report.footer === null ||
    !contains(safe, report.footer.rectangle) ||
    !contains(page, report.footer.rectangle) ||
    report.footer.textRectangles.some((painted) => !contains(safe, painted) || !contains(page, painted))
  ) {
    throw new RenderError("FOOTER_CLIPPING", "provenance footer leaves safe paint bounds", report.footer);
  }
  for (const box of report.boxes) {
    if (box.containerRectangle !== null && !contains(box.containerRectangle, box.rectangle)) {
      throw new RenderError("DOM_CONTAINMENT", "declared box leaves its layout container", box);
    }
    if (box.textRectangles.some((painted) => !contains(box.rectangle, painted))) {
      throw new RenderError("DOM_CLIPPING", "text paint exceeds its declared box", box);
    }
  }
  const brokenPhrase = report.lineGroups.find((group) => group.lineCount !== 1);
  if (brokenPhrase !== undefined) {
    throw new RenderError("KOREAN_LINE_BREAK", "protected Korean phrase spans multiple lines", brokenPhrase);
  }
};
