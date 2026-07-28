import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path, { extname, relative } from "node:path";
import { buildEnvelope } from "#ingest/extract";
import { IngestSecurityError, errorCode } from "#ingest/errors";
import { detectMime, type SourceMime } from "#ingest/mime";
import type { IngestResult, LocalIngestInput } from "#ingest/types";

const MAX_DECODED_BYTES = 10 * 1024 * 1024;
const extensionMimes: Readonly<Record<string, SourceMime>> = {
  ".html": "text/html",
  ".htm": "text/html",
  ".md": "text/markdown",
  ".txt": "text/plain"
};

const within = (root: string, target: string): boolean =>
  target === root || target.startsWith(`${root}${path.sep}`);

type ReadHandle = {
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null
  ): Promise<{ readonly bytesRead: number }>;
};

const readBounded = async (handle: ReadHandle): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const chunk = new Uint8Array(64 * 1024);
    const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > MAX_DECODED_BYTES) {
      throw new IngestSecurityError("DECODED_TOO_LARGE", "local source exceeds 10 MiB");
    }
    chunks.push(chunk.slice(0, bytesRead));
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const resolveInputPath = (realRoot: string, file: string): string => {
  if (!path.isAbsolute(file) && file.split(/[\\/]/u).some((segment) => segment === "..")) {
    throw new IngestSecurityError("PATH_TRAVERSAL", "local source path contains traversal");
  }
  return path.isAbsolute(file) ? path.resolve(file) : path.resolve(realRoot, file);
};

export const ingestLocal = async (input: LocalIngestInput): Promise<IngestResult> => {
  if (input.allowedRoot === undefined || input.allowedRoot.length === 0) {
    throw new IngestSecurityError("MISSING_ALLOWED_ROOT", "local ingestion requires an explicit allowed root");
  }
  const realRoot = await realpath(input.allowedRoot);
  const candidate = resolveInputPath(realRoot, input.file);
  const initial = await lstat(candidate);
  if (initial.isSymbolicLink()) {
    throw new IngestSecurityError("SYMLINK_ESCAPE", "local source must not be a symbolic link");
  }
  if (!initial.isFile()) {
    throw new IngestSecurityError("NON_REGULAR_FILE", "local source must be a regular file");
  }
  const initialIdentity = fileIdentity(initial);
  const realFile = await realpath(candidate);
  if (!within(realRoot, realFile)) {
    throw new IngestSecurityError("PATH_ESCAPE", "local source resolves outside the allowed root");
  }
  const extension = extname(realFile).toLowerCase();
  const declaredMime = extensionMimes[extension];
  if (declaredMime === undefined) {
    throw new IngestSecurityError("LOCAL_EXTENSION_FORBIDDEN", "local source extension is not allowed");
  }
  const noFollow = Reflect.get(constants, "O_NOFOLLOW");
  if (typeof noFollow !== "number") {
    throw new IngestSecurityError("NOFOLLOW_UNAVAILABLE", "platform cannot safely open local sources");
  }

  const handle = await open(realFile, noFollow).catch((error: unknown) => {
    if (errorCode(error) === "ELOOP") {
      throw new IngestSecurityError("SYMLINK_ESCAPE", "local source changed to a symbolic link", {
        cause: error instanceof Error ? error : undefined
      });
    }
    throw error;
  });
  try {
    const before = await handle.stat();
    if (!before.isFile()) {
      throw new IngestSecurityError("NON_REGULAR_FILE", "local source must be a regular file");
    }
    const beforeIdentity = fileIdentity(before);
    if (
      initialIdentity.dev !== beforeIdentity.dev
      || initialIdentity.ino !== beforeIdentity.ino
      || initialIdentity.size !== beforeIdentity.size
    ) {
      throw new IngestSecurityError("SOURCE_CHANGED_DURING_OPEN", "local source changed before it was opened");
    }
    if (beforeIdentity.size > MAX_DECODED_BYTES) {
      throw new IngestSecurityError("DECODED_TOO_LARGE", "local source exceeds 10 MiB");
    }
    const bytes = await readBounded(handle);
    const after = await handle.stat();
    const afterIdentity = fileIdentity(after);
    if (
      beforeIdentity.dev !== afterIdentity.dev
      || beforeIdentity.ino !== afterIdentity.ino
      || beforeIdentity.size !== afterIdentity.size
      || bytes.byteLength !== afterIdentity.size
    ) {
      throw new IngestSecurityError("SOURCE_CHANGED_DURING_READ", "local source changed while being read");
    }
    const detected = detectMime(bytes, declaredMime);
    await input.onAcceptedBytes?.(bytes);
    const locator = relative(realRoot, realFile).split(path.sep).join("/");
    return buildEnvelope(detected.text, detected.mime, {
      originalLocator: locator,
      finalLocator: locator,
      redirectChain: [],
      retrievedAt: (input.now ?? (() => new Date()))().toISOString(),
      rawSha256: createHash("sha256").update(bytes).digest("hex"),
      rawByteCount: bytes.byteLength,
      declaredMime,
      detectedMime: detected.mime,
      transformations: ["realpath-confined", "nofollow-open", "utf8-decode", "offline-extraction"]
    });
  } finally {
    await handle.close();
  }
};

const fileIdentity = (stats: object): { readonly dev: number; readonly ino: number; readonly size: number } => {
  const dev = Reflect.get(stats, "dev");
  const ino = Reflect.get(stats, "ino");
  const size = Reflect.get(stats, "size");
  if (typeof dev !== "number" || typeof ino !== "number" || typeof size !== "number") {
    throw new IngestSecurityError("FILE_IDENTITY_UNAVAILABLE", "platform omitted local file identity");
  }
  return { dev, ino, size };
};
