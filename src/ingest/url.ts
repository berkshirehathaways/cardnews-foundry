import { createHash } from "node:crypto";
import {
  brotliDecompressSync,
  gunzipSync,
  inflateSync
} from "node:zlib";
import { createBodyReader } from "#ingest/body";
import { createRequestDeadline } from "#ingest/deadline";
import { IngestSecurityError, errorCode } from "#ingest/errors";
import { buildEnvelope } from "#ingest/extract";
import { requestPinned, resolveAndPin, responseHeader } from "#ingest/http";
import { detectMime, mapDecompressionError, parseDeclaredMime } from "#ingest/mime";
import type {
  IngestNetwork,
  IngestResult,
  NetworkResponse,
  UrlIngestOptions
} from "#ingest/types";

const MAX_TRANSFER_BYTES = 5 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const DEFAULT_DEADLINE_MS = 15_000;

const parseUrl = (locator: string): URL => {
  let url: URL;
  try {
    url = new URL(locator);
  } catch (error) {
    throw new IngestSecurityError("INVALID_URL", "source URL is malformed", {
      cause: error instanceof Error ? error : undefined
    });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new IngestSecurityError("URL_SCHEME_FORBIDDEN", "only HTTP and HTTPS source URLs are allowed");
  }
  if (url.username !== "" || url.password !== "") {
    throw new IngestSecurityError("URL_CREDENTIALS_FORBIDDEN", "source URL credentials are forbidden");
  }
  return url;
};

const decompress = (bytes: Uint8Array, encodingHeader: string | undefined): Uint8Array => {
  const encoding = encodingHeader?.trim().toLowerCase() ?? "identity";
  if (encoding === "" || encoding === "identity") return bytes;
  if (encoding !== "gzip" && encoding !== "deflate" && encoding !== "br") {
    throw new IngestSecurityError("CONTENT_ENCODING_FORBIDDEN", "source content encoding is not allowed");
  }
  try {
    const options = { maxOutputLength: MAX_DECOMPRESSED_BYTES + 1 };
    const decoded = encoding === "gzip"
      ? gunzipSync(bytes, options)
      : encoding === "deflate"
        ? inflateSync(bytes, options)
        : brotliDecompressSync(bytes, options);
    if (decoded.byteLength > MAX_DECOMPRESSED_BYTES) {
      throw new IngestSecurityError("DECOMPRESSED_TOO_LARGE", "decompressed source exceeds 10 MiB");
    }
    return decoded;
  } catch (error) {
    if (error instanceof IngestSecurityError) throw error;
    return mapDecompressionError(error);
  }
};

type Retrieved = {
  readonly finalUrl: URL;
  readonly redirectChain: readonly string[];
  readonly response: NetworkResponse;
};

const retrieve = async (
  initial: URL,
  network: IngestNetwork,
  signal: AbortSignal
): Promise<Retrieved> => {
  let current = initial;
  const redirectChain: string[] = [];
  while (true) {
    const address = await resolveAndPin(current, network);
    const response = await requestPinned(current, address, network, signal);
    if (response.statusCode >= 300 && response.statusCode < 400) {
      const location = responseHeader(response.headers, "location");
      if (location === undefined) {
        response.close?.();
        throw new IngestSecurityError("REDIRECT_LOCATION_MISSING", "redirect response omitted Location");
      }
      if (redirectChain.length >= MAX_REDIRECTS) {
        response.close?.();
        throw new IngestSecurityError("REDIRECT_LIMIT", "source exceeded five redirects");
      }
      const next = parseUrl(new URL(location, current).href);
      if (current.protocol === "https:" && next.protocol !== "https:") {
        response.close?.();
        throw new IngestSecurityError("PROTOCOL_DOWNGRADE", "HTTPS source redirected to insecure HTTP");
      }
      response.close?.();
      redirectChain.push(next.href);
      current = next;
      continue;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      response.close?.();
      throw new IngestSecurityError("HTTP_STATUS_REJECTED", "source response was not successful");
    }
    return { finalUrl: current, redirectChain, response };
  }
};

export const ingestUrl = async (
  locator: string,
  options: UrlIngestOptions = {}
): Promise<IngestResult> => {
  const initial = parseUrl(locator);
  const deadline = createRequestDeadline(
    options.deadlineMs ?? DEFAULT_DEADLINE_MS,
    options.signal
  );
  try {
    const retrieved = await deadline.run(() =>
      retrieve(initial, options.network ?? {}, deadline.signal)
    );
    const body = createBodyReader(retrieved.response);
    try {
      const declaredMime = await deadline.run(() =>
        parseDeclaredMime(responseHeader(retrieved.response.headers, "content-type"))
      );
      const transferBytes = await body.read(deadline, MAX_TRANSFER_BYTES);
      const bytes = await deadline.run(() =>
        decompress(transferBytes, responseHeader(retrieved.response.headers, "content-encoding"))
      );
      const detected = await deadline.run(() => detectMime(bytes, declaredMime));
      await deadline.run(() => options.onAcceptedBytes?.(bytes) ?? Promise.resolve());
      return await deadline.run(() =>
        buildEnvelope(detected.text, detected.mime, {
          originalLocator: initial.href,
          finalLocator: retrieved.finalUrl.href,
          redirectChain: retrieved.redirectChain,
          retrievedAt: (options.now ?? (() => new Date()))().toISOString(),
          rawSha256: createHash("sha256").update(bytes).digest("hex"),
          rawByteCount: bytes.byteLength,
          declaredMime,
          detectedMime: detected.mime,
          transformations: [
            ...(bytes.byteLength === transferBytes.byteLength ? [] : ["content-decompression"]),
            "utf8-decode",
            "offline-extraction"
          ]
        })
      );
    } catch (error) {
      body.cancel();
      throw error;
    }
  } catch (error) {
    if (error instanceof IngestSecurityError) throw error;
    if (deadline.signal.aborted || errorCode(error) === "ABORT_ERR") {
      throw new IngestSecurityError("INGEST_ABORTED", "source ingestion was aborted", {
        cause: error instanceof Error ? error : undefined
      });
    }
    if (errorCode(error) === "ECONNRESET") {
      throw new IngestSecurityError("INCOMPLETE_RESPONSE", "source response ended before completion", {
        cause: error instanceof Error ? error : undefined
      });
    }
    throw new IngestSecurityError("NETWORK_FAILURE", "source request failed", {
      cause: error instanceof Error ? error : undefined
    });
  } finally {
    deadline.dispose();
  }
};
