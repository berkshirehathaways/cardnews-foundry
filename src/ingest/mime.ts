import { IngestSecurityError, errorCode } from "#ingest/errors";

export const SOURCE_MIMES = [
  "text/html",
  "application/xhtml+xml",
  "text/plain",
  "text/markdown"
] as const;

export type SourceMime = typeof SOURCE_MIMES[number];

export const parseDeclaredMime = (header: string | undefined): SourceMime => {
  if (header === undefined) {
    throw new IngestSecurityError("MISSING_CONTENT_TYPE", "source response omitted Content-Type");
  }
  const mime = header.split(";", 1)[0]?.trim().toLowerCase();
  const allowedMime = SOURCE_MIMES.find((allowed) => allowed === mime);
  if (allowedMime === undefined) {
    throw new IngestSecurityError("MIME_NOT_ALLOWED", "declared source MIME is not allowed");
  }
  return allowedMime;
};

export const decodeUtf8 = (bytes: Uint8Array): string => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/u, "");
  } catch (error) {
    if (error instanceof TypeError) {
      throw new IngestSecurityError("INVALID_TEXT_ENCODING", "source must be valid UTF-8", { cause: error });
    }
    throw error;
  }
};

const looksLikeHtml = (text: string): boolean =>
  /^\s*(?:<!doctype\s+html|<\?xml[\s\S]*?<|<(?:html|head|body|main|article|title|h[1-6]|p)\b)/iu.test(text);

const hasBinarySignature = (bytes: Uint8Array): boolean => {
  if (bytes.includes(0)) return true;
  const signatures: readonly (readonly number[])[] = [
    [0x89, 0x50, 0x4e, 0x47],
    [0xff, 0xd8, 0xff],
    [0x25, 0x50, 0x44, 0x46],
    [0x50, 0x4b, 0x03, 0x04]
  ];
  return signatures.some((signature) => signature.every((value, index) => bytes[index] === value));
};

export const detectMime = (
  bytes: Uint8Array,
  expected: SourceMime
): { readonly mime: SourceMime; readonly text: string } => {
  if (hasBinarySignature(bytes)) {
    throw new IngestSecurityError("MIME_SIGNATURE_MISMATCH", "source bytes have a forbidden binary signature");
  }
  const text = decodeUtf8(bytes);
  const html = looksLikeHtml(text);
  if (expected === "text/html" || expected === "application/xhtml+xml") {
    if (!html) {
      throw new IngestSecurityError("MIME_SIGNATURE_MISMATCH", "declared markup source does not contain markup");
    }
    return { mime: expected, text };
  }
  if (html) {
    throw new IngestSecurityError("MIME_SIGNATURE_MISMATCH", "text source unexpectedly contains HTML markup");
  }
  return { mime: expected, text };
};

export const mapDecompressionError = (error: unknown): never => {
  if (errorCode(error) === "ERR_BUFFER_TOO_LARGE") {
    throw new IngestSecurityError("DECOMPRESSED_TOO_LARGE", "decompressed source exceeds 10 MiB", { cause: error });
  }
  throw new IngestSecurityError("DECOMPRESSION_FAILED", "source content encoding is corrupt", {
    cause: error instanceof Error ? error : undefined
  });
};
