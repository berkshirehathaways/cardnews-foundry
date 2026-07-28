import { createHash } from "node:crypto";
import type { SourceEnvelope } from "#contracts";
import type { SourceMime } from "#ingest/mime";

type SourceSpan = {
  readonly id: string;
  readonly text: string;
  readonly order: number;
};

const normalizeText = (value: string): string =>
  value.replace(/\r\n?/gu, "\n").replace(/\s+/gu, " ").trim();

const decodeEntity = (entity: string): string => {
  const named: Readonly<Record<string, string>> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\""
  };
  if (entity.startsWith("#x")) {
    const value = Number.parseInt(entity.slice(2), 16);
    return Number.isFinite(value) && value <= 0x10ffff ? String.fromCodePoint(value) : "\uFFFD";
  }
  if (entity.startsWith("#")) {
    const value = Number.parseInt(entity.slice(1), 10);
    return Number.isFinite(value) && value <= 0x10ffff ? String.fromCodePoint(value) : "\uFFFD";
  }
  return named[entity.toLowerCase()] ?? `&${entity};`;
};

const stripMarkup = (value: string): string => normalizeText(
  value
    .replace(/<[^>]*>/gu, " ")
    .replace(/&([a-z]+|#\d+|#x[0-9a-f]+);/giu, (_match, entity: string) => decodeEntity(entity))
);

const removeUnsafeHtml = (html: string): string => {
  let safe = html.replace(/<!--[\s\S]*?-->/gu, " ");
  const excludedTags = "script|style|form|nav|header|footer|aside|noscript|template|svg|canvas";
  const excluded = new RegExp(`<(${excludedTags})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, "giu");
  for (let pass = 0; pass < 4; pass += 1) safe = safe.replace(excluded, " ");
  safe = safe.replace(
    /<([a-z][a-z0-9:-]*)\b(?=[^>]*(?:\bhidden\b|\baria-hidden\s*=\s*["']?true|(?:class|id)\s*=\s*["'][^"']*(?:nav|menu|sidebar|cookie|banner|chrome|footer|header)[^"']*["']))[^>]*>[\s\S]*?<\/\1\s*>/giu,
    " "
  );
  return safe.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/giu, " ");
};

const htmlTitle = (html: string): string => {
  const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/iu.exec(html)?.[1];
  const heading = /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/iu.exec(html)?.[1];
  return stripMarkup(title ?? heading ?? "Untitled source");
};

const htmlParagraphs = (html: string): readonly string[] => {
  const safe = removeUnsafeHtml(html);
  const blocks = [...safe.matchAll(/<(h[1-6]|p|li|blockquote|pre)\b[^>]*>([\s\S]*?)<\/\1\s*>/giu)]
    .map((match) => stripMarkup(match[2] ?? ""))
    .filter((text) => text.length > 0);
  return blocks.length > 0 ? blocks : [stripMarkup(safe)].filter((text) => text.length > 0);
};

const markdownParagraphs = (markdown: string): readonly string[] =>
  markdown.replace(/\r\n?/gu, "\n").split(/\n\s*\n/gu).map((paragraph) => normalizeText(
    paragraph
      .replace(/^\s{0,3}#{1,6}\s+/gu, "")
      .replace(/^\s*[-*+]\s+/gmu, "")
      .replace(/^\s*>\s?/gmu, "")
      .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
      .replace(/[*_~`]/gu, "")
  )).filter((paragraph) => paragraph.length > 0);

const plainParagraphs = (text: string): readonly string[] =>
  text.replace(/\r\n?/gu, "\n").split(/\n\s*\n/gu)
    .map(normalizeText)
    .filter((paragraph) => paragraph.length > 0);

const digest = (value: string): string =>
  createHash("sha256").update(new TextEncoder().encode(value)).digest("hex");

const sourceSpans = (paragraphs: readonly string[]): readonly SourceSpan[] => {
  const occurrences = new Map<string, number>();
  return paragraphs.map((text, order) => {
    const occurrence = occurrences.get(text) ?? 0;
    occurrences.set(text, occurrence + 1);
    return {
      id: `span-${digest(`${text}\u0000${occurrence}`).slice(0, 24)}`,
      text,
      order
    };
  });
};

export type EnvelopeMetadata = {
  readonly originalLocator: string;
  readonly finalLocator: string;
  readonly redirectChain: readonly string[];
  readonly retrievedAt: string;
  readonly rawSha256: string;
  readonly rawByteCount: number;
  readonly declaredMime: SourceMime;
  readonly detectedMime: SourceMime;
  readonly transformations: readonly string[];
};

export const buildEnvelope = (
  text: string,
  mime: SourceMime,
  metadata: EnvelopeMetadata
): SourceEnvelope => {
  const markup = mime === "text/html" || mime === "application/xhtml+xml";
  const paragraphs = markup
    ? htmlParagraphs(text)
    : mime === "text/markdown"
      ? markdownParagraphs(text)
      : plainParagraphs(text);
  const title = markup
    ? htmlTitle(text)
    : paragraphs[0] ?? "Untitled source";
  const spans = sourceSpans(paragraphs);
  const semanticDigest = digest(JSON.stringify({ title, paragraphs }));
  return {
    schemaVersion: "1.0.0",
    sourceId: `source-${semanticDigest.slice(0, 24)}`,
    title,
    spans,
    provenance: {
      ...metadata,
      parser: { name: markup ? "offline-html" : "offline-text", version: "1.0.0" },
      extractedSpanIds: spans.map((span) => span.id),
      rightsStatus: "unknown"
    }
  };
};
