import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod, lstat, mkdir, open, readFile, realpath, rename, rm, stat
} from "node:fs/promises";
import path from "node:path";
import { createInflate, inflateSync } from "node:zlib";
import { canonicalJsonBytes, validateContract } from "#contracts";

const RIGHTS = ["generated", "user-provided", "licensed", "public-domain", "unknown"] as const;
export type AssetRights = (typeof RIGHTS)[number];
export type AssetMime = "image/png" | "image/jpeg";
export type AlphaState = "present" | "opaque";
export type AssetLimits = {
  readonly maxBytes: number;
  readonly maxDimension: number;
  readonly maxPixels: number;
};
export type AssetRecord = {
  readonly schemaVersion: 1;
  readonly assetDigest: string;
  readonly originalRelativePath: string;
  readonly byteCount: number;
  readonly detectedMime: AssetMime;
  readonly width: number;
  readonly height: number;
  readonly alpha: AlphaState;
  readonly rights: AssetRights;
  readonly originNote?: string;
  readonly importedAt: string;
  readonly binding: { readonly cardId: string; readonly slot: string };
  readonly publicEligible: boolean;
  readonly publicPackageBlockers: readonly string[];
};
export type ImportAssetInput = {
  readonly allowedRoot: string;
  readonly workspaceRoot: string;
  readonly file: string;
  readonly rights?: string;
  readonly originNote?: string;
  readonly importedAt: string;
  readonly recipe: unknown;
  readonly cardId: string;
  readonly slot: string;
  readonly limits?: AssetLimits;
  readonly failpoint?: "asset-before-rename";
  readonly hooks?: { readonly afterSourceStat?: (sourcePath: string) => Promise<void> };
};
export type ImportedAsset = {
  readonly record: AssetRecord;
  readonly artifactPath: string;
  readonly metadataPath: string;
};
type ImageInfo = {
  readonly mime: AssetMime;
  readonly width: number;
  readonly height: number;
  readonly alpha: AlphaState;
};
type ParsedPng = {
  readonly info: ImageInfo;
  readonly idatChunks: readonly Uint8Array[];
  readonly expectedBytes: number;
  readonly rowBytes: number;
};
type SlotMediaPolicy = {
  readonly mime: readonly AssetMime[];
  readonly alpha?: "present";
};
type StatIdentity = {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
};

export class AssetError extends Error {
  readonly name = "AssetError";
  readonly exitClass = 3;
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export const DEFAULT_ASSET_LIMITS: AssetLimits = {
  maxBytes: 10 * 1024 * 1024,
  maxDimension: 8192,
  maxPixels: 40_000_000
};
const SLOT_MEDIA_POLICIES: Readonly<Record<string, SlotMediaPolicy>> = {
  hero: { mime: ["image/png", "image/jpeg"] },
  background: { mime: ["image/png", "image/jpeg"] },
  illustration: { mime: ["image/png", "image/jpeg"] },
  photo: { mime: ["image/png", "image/jpeg"] },
  logo: { mime: ["image/png", "image/jpeg"] },
  texture: { mime: ["image/png", "image/jpeg"] },
  overlay: { mime: ["image/png"], alpha: "present" }
};

const filesystemCode = (error: unknown): unknown =>
  error instanceof Error && "code" in error ? error.code : undefined;
const within = (root: string, candidate: string): boolean =>
  candidate === root || candidate.startsWith(`${root}${path.sep}`);
const sameBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && left.every((byte, index) => right[index] === byte);
const readUint32 = (bytes: Uint8Array, offset: number): number =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);

const statIdentity = (value: unknown): StatIdentity => {
  if (
    typeof value !== "object" || value === null ||
    !("dev" in value) || typeof value.dev !== "number" ||
    !("ino" in value) || typeof value.ino !== "number" ||
    !("size" in value) || typeof value.size !== "number" ||
    !("mtimeMs" in value) || typeof value.mtimeMs !== "number"
  ) {
    throw new AssetError("ASSET_STAT_INVALID", "asset filesystem metadata is unavailable");
  }
  return { dev: value.dev, ino: value.ino, size: value.size, mtimeMs: value.mtimeMs };
};

const parseRights = (rights: string | undefined, originNote: string | undefined): AssetRights => {
  if (rights === undefined || rights.length === 0) {
    throw new AssetError("ASSET_RIGHTS_MISSING", "asset rights are required");
  }
  const parsed = RIGHTS.find((candidate) => candidate === rights);
  if (parsed === undefined) throw new AssetError("ASSET_RIGHTS_INVALID", "asset rights class is invalid");
  if (originNote !== undefined && originNote.trim().length === 0) {
    throw new AssetError("ASSET_ORIGIN_NOTE_INVALID", "asset origin note must contain text");
  }
  if (
    parsed !== "user-provided" &&
    originNote === undefined
  ) {
    throw new AssetError("ASSET_ORIGIN_NOTE_REQUIRED", "asset rights class requires an origin note");
  }
  return parsed;
};

const parseTimestamp = (timestamp: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(timestamp)) {
    throw new AssetError("ASSET_TIMESTAMP_INVALID", "asset import timestamp must be canonical UTC");
  }
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== timestamp) {
    throw new AssetError("ASSET_TIMESTAMP_INVALID", "asset import timestamp is invalid");
  }
  return timestamp;
};

const validateLimits = (limits: AssetLimits): void => {
  if (
    !Number.isSafeInteger(limits.maxBytes) || limits.maxBytes < 1 ||
    !Number.isSafeInteger(limits.maxDimension) || limits.maxDimension < 1 ||
    !Number.isSafeInteger(limits.maxPixels) || limits.maxPixels < 1
  ) {
    throw new AssetError("ASSET_LIMITS_INVALID", "asset limits must be positive safe integers");
  }
};

const enforceDimensions = (width: number, height: number, limits: AssetLimits): void => {
  if (width > limits.maxDimension || height > limits.maxDimension) {
    throw new AssetError("ASSET_DIMENSION_LIMIT", "asset dimensions exceed limit");
  }
  if (width * height > limits.maxPixels) {
    throw new AssetError("ASSET_PIXEL_LIMIT", "asset pixels exceed limit");
  }
};

const pngSignature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const hasPngSignature = (bytes: Uint8Array): boolean =>
  bytes.length >= 8 && pngSignature.every((byte, index) => bytes[index] === byte);
const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});
const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    const tableValue = crcTable[(crc ^ byte) & 0xff];
    if (tableValue === undefined) throw new AssetError("PNG_CRC_INTERNAL", "checksum lookup failed");
    crc = tableValue ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};
const pngDepths: Readonly<Record<number, readonly number[]>> = {
  0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16]
};

const pngChannels: Readonly<Record<number, number>> = {
  2: 3,
  6: 4
};

const validateDecodedPng = (
  bytes: Uint8Array,
  expectedBytes: number,
  rowBytes: number
): void => {
  if (bytes.byteLength > expectedBytes) {
    throw new AssetError("PNG_DECOMPRESSED_OVERRUN", "PNG decompressed data exceeds its IHDR size");
  }
  if (bytes.byteLength < expectedBytes) {
    throw new AssetError("PNG_DECOMPRESSED_TRUNCATED", "PNG decompressed data is shorter than its IHDR size");
  }
  const rowStride = rowBytes + 1;
  for (let offset = 0; offset < bytes.byteLength; offset += rowStride) {
    if ((bytes[offset] ?? 5) > 4) {
      throw new AssetError("PNG_FILTER_INVALID", "PNG scanline filter is invalid");
    }
  }
};

const validatePngIdat = async (
  chunks: readonly Uint8Array[],
  expectedBytes: number,
  rowBytes: number
): Promise<void> => new Promise((resolve, reject) => {
  const inflater = createInflate();
  const rowStride = rowBytes + 1;
  const compressedBytes = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  let emittedBytes = 0;
  let settled = false;
  const fail = (error: AssetError): void => {
    if (settled) return;
    settled = true;
    inflater.destroy();
    reject(error);
  };
  inflater.on("data", (chunk) => {
    for (let index = 0; index < chunk.byteLength; index += 1) {
      const outputIndex = emittedBytes + index;
      if (outputIndex >= expectedBytes) {
        fail(new AssetError("PNG_DECOMPRESSED_OVERRUN", "PNG decompressed data exceeds its IHDR size"));
        return;
      }
      if (outputIndex % rowStride === 0 && (chunk[index] ?? 5) > 4) {
        fail(new AssetError("PNG_FILTER_INVALID", "PNG scanline filter is invalid"));
        return;
      }
    }
    emittedBytes += chunk.byteLength;
  });
  inflater.once("error", () => {
    fail(new AssetError("PNG_IDAT_INVALID", "PNG IDAT zlib stream is invalid or truncated"));
  });
  inflater.once("end", () => {
    if (settled) return;
    if (inflater.bytesWritten !== compressedBytes) {
      fail(new AssetError("PNG_IDAT_INVALID", "PNG IDAT contains trailing compressed bytes"));
      return;
    }
    if (emittedBytes !== expectedBytes) {
      fail(new AssetError("PNG_DECOMPRESSED_TRUNCATED", "PNG decompressed data is shorter than its IHDR size"));
      return;
    }
    settled = true;
    resolve();
  });
  for (const chunk of chunks) {
    if (settled) break;
    inflater.write(chunk);
  }
  if (!settled) inflater.end();
});

const parsePng = (bytes: Uint8Array, limits: AssetLimits): ParsedPng => {
  let offset = 8;
  let width: number | undefined;
  let height: number | undefined;
  let rowBytes: number | undefined;
  let alpha = false;
  let imageData = false;
  let imageDataEnded = false;
  let chunkIndex = 0;
  const idatChunks: Uint8Array[] = [];
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) throw new AssetError("PNG_TRUNCATED", "PNG chunk is truncated");
    const length = readUint32(bytes, offset);
    const end = offset + 12 + length;
    if (end > bytes.length || end < offset) throw new AssetError("PNG_TRUNCATED", "PNG payload is truncated");
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = new TextDecoder("ascii", { fatal: true }).decode(typeBytes);
    if (!/^[A-Za-z]{4}$/u.test(type)) throw new AssetError("PNG_CHUNK_INVALID", "PNG chunk type is malformed");
    if (readUint32(bytes, offset + 8 + length) !== crc32(bytes.subarray(offset + 4, offset + 8 + length))) {
      throw new AssetError("PNG_CRC_MISMATCH", "PNG checksum does not match", type);
    }
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      if (chunkIndex !== 0 || width !== undefined || length !== 13) {
        throw new AssetError("PNG_IHDR_INVALID", "PNG requires one leading IHDR");
      }
      width = readUint32(data, 0);
      height = readUint32(data, 4);
      const depth = data[8];
      const color = data[9];
      const depths = color === undefined ? undefined : pngDepths[color];
      if (
        width === 0 || height === 0 || depth === undefined || depths === undefined ||
        !depths.includes(depth) || data[10] !== 0 || data[11] !== 0
      ) throw new AssetError("PNG_IHDR_INVALID", "PNG IHDR fields are impossible");
      if (data[12] !== 0) {
        throw new AssetError("PNG_INTERLACE_UNSUPPORTED", "interlaced PNG data is unsupported");
      }
      const channels = color === undefined ? undefined : pngChannels[color];
      if (depth !== 8 || channels === undefined) {
        throw new AssetError("PNG_VARIANT_UNSUPPORTED", "PNG color type or bit depth is unsupported");
      }
      enforceDimensions(width, height, limits);
      rowBytes = Math.ceil(width * channels * depth / 8);
      alpha = color === 4 || color === 6;
    } else if (width === undefined) {
      throw new AssetError("PNG_IHDR_INVALID", "PNG IHDR must be first");
    } else if (type === "tRNS") {
      if (imageData || alpha || data.byteLength !== 6) {
        throw new AssetError("PNG_TRANSPARENCY_INVALID", "PNG tRNS is malformed or misplaced");
      }
      alpha = true;
    } else if (type === "IDAT") {
      if (imageDataEnded) throw new AssetError("PNG_IDAT_ORDER_INVALID", "PNG IDAT chunks must be consecutive");
      imageData = true;
      idatChunks.push(data);
    } else if (type === "IEND") {
      if (length !== 0 || !imageData) throw new AssetError("PNG_IEND_INVALID", "PNG IEND is invalid");
      offset = end;
      if (offset !== bytes.length) throw new AssetError("PNG_TRAILING_BYTES", "PNG has trailing bytes");
      if (height === undefined || rowBytes === undefined) {
        throw new AssetError("PNG_IHDR_INVALID", "PNG dimensions are missing");
      }
      const expectedBytes = (rowBytes + 1) * height;
      if (!Number.isSafeInteger(expectedBytes)) {
        throw new AssetError("PNG_DECOMPRESSED_LIMIT", "PNG decompressed size is not safely bounded");
      }
      return {
        info: { mime: "image/png", width, height, alpha: alpha ? "present" : "opaque" },
        idatChunks,
        expectedBytes,
        rowBytes
      };
    } else if ((typeBytes[0] ?? 0) >= 65 && (typeBytes[0] ?? 0) <= 90) {
      throw new AssetError("PNG_CRITICAL_CHUNK_UNSUPPORTED", "PNG critical chunk is unsupported", type);
    }
    if (imageData && type !== "IDAT") imageDataEnded = true;
    offset = end;
    chunkIndex += 1;
  }
  throw new AssetError("PNG_TRUNCATED", "PNG ends before IEND");
};

const concatenate = (chunks: readonly Uint8Array[]): Uint8Array => {
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const inspectPng = (bytes: Uint8Array, limits: AssetLimits): ImageInfo => {
  const parsed = parsePng(bytes, limits);
  const compressed = concatenate(parsed.idatChunks);
  let inflated;
  try {
    inflated = inflateSync(compressed, {
      maxOutputLength: parsed.expectedBytes + 1,
      info: true
    });
  } catch (error) {
    if (filesystemCode(error) === "ERR_BUFFER_TOO_LARGE") {
      throw new AssetError("PNG_DECOMPRESSED_OVERRUN", "PNG decompressed data exceeds its IHDR size");
    }
    throw new AssetError("PNG_IDAT_INVALID", "PNG IDAT zlib stream is invalid or truncated");
  }
  if (inflated.engine.bytesWritten !== compressed.byteLength) {
    throw new AssetError("PNG_IDAT_INVALID", "PNG IDAT contains trailing compressed bytes");
  }
  validateDecodedPng(inflated.buffer, parsed.expectedBytes, parsed.rowBytes);
  return parsed.info;
};

const inspectPngForImport = async (bytes: Uint8Array, limits: AssetLimits): Promise<ImageInfo> => {
  const parsed = parsePng(bytes, limits);
  await validatePngIdat(parsed.idatChunks, parsed.expectedBytes, parsed.rowBytes);
  return parsed.info;
};

const hasJpegSignature = (bytes: Uint8Array): boolean =>
  bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
const jpegSegmentEnd = (bytes: Uint8Array, offset: number): number => {
  if (offset + 2 > bytes.length) throw new AssetError("JPEG_TRUNCATED", "JPEG length is truncated");
  const length = (bytes[offset] ?? 0) * 256 + (bytes[offset + 1] ?? 0);
  if (length < 2) throw new AssetError("JPEG_SEGMENT_INVALID", "JPEG segment length is invalid");
  if (offset + length > bytes.length) throw new AssetError("JPEG_TRUNCATED", "JPEG segment is truncated");
  return offset + length;
};
const scanMarker = (bytes: Uint8Array, start: number): number => {
  let offset = start;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    if (marker === undefined) throw new AssetError("JPEG_TRUNCATED", "JPEG scan is truncated");
    if (marker === 0 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 1;
      continue;
    }
    return offset - 1;
  }
  throw new AssetError("JPEG_TRUNCATED", "JPEG scan has no end marker");
};

const inspectJpeg = (bytes: Uint8Array, limits: AssetLimits): ImageInfo => {
  let offset = 2;
  let width: number | undefined;
  let height: number | undefined;
  let scanned = false;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) throw new AssetError("JPEG_MARKER_INVALID", "JPEG marker is malformed");
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    if (marker === undefined || marker === 0) throw new AssetError("JPEG_TRUNCATED", "JPEG marker is truncated");
    offset += 1;
    if (marker === 0xd9) {
      if (!scanned || width === undefined || height === undefined) {
        throw new AssetError("JPEG_TRUNCATED", "JPEG frame or scan is incomplete");
      }
      if (offset !== bytes.length) throw new AssetError("JPEG_TRAILING_BYTES", "JPEG has trailing bytes");
      return { mime: "image/jpeg", width, height, alpha: "opaque" };
    }
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const end = jpegSegmentEnd(bytes, offset);
    const sof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (sof) {
      if (![0xc0, 0xc1, 0xc2].includes(marker) || width !== undefined) {
        throw new AssetError("JPEG_SOF_UNSUPPORTED", "JPEG frame is unsupported or ambiguous");
      }
      const components = bytes[offset + 7];
      height = (bytes[offset + 3] ?? 0) * 256 + (bytes[offset + 4] ?? 0);
      width = (bytes[offset + 5] ?? 0) * 256 + (bytes[offset + 6] ?? 0);
      if (
        end - offset < 8 || bytes[offset + 2] !== 8 || width === 0 || height === 0 ||
        components === undefined || components < 1 || components > 4 ||
        end - offset !== 8 + components * 3
      ) throw new AssetError("JPEG_SOF_INVALID", "JPEG frame header is malformed");
      enforceDimensions(width, height, limits);
    }
    const isScan = marker === 0xda;
    offset = end;
    if (isScan) {
      if (width === undefined || height === undefined) throw new AssetError("JPEG_SOS_INVALID", "JPEG scan precedes frame");
      scanned = true;
      offset = scanMarker(bytes, offset);
    }
  }
  throw new AssetError("JPEG_TRUNCATED", "JPEG ends before EOI");
};

export const inspectImage = (
  bytes: Uint8Array,
  limits: AssetLimits = DEFAULT_ASSET_LIMITS
): ImageInfo => {
  validateLimits(limits);
  if (bytes.byteLength > limits.maxBytes) throw new AssetError("ASSET_BYTE_LIMIT", "asset exceeds byte limit");
  const image = hasPngSignature(bytes)
    ? inspectPng(bytes, limits)
    : hasJpegSignature(bytes)
      ? inspectJpeg(bytes, limits)
      : undefined;
  if (image === undefined) throw new AssetError("ASSET_SIGNATURE_UNSUPPORTED", "asset signature is unsupported");
  return image;
};

const inspectImageForImport = async (
  bytes: Uint8Array,
  limits: AssetLimits
): Promise<ImageInfo> => {
  validateLimits(limits);
  if (bytes.byteLength > limits.maxBytes) throw new AssetError("ASSET_BYTE_LIMIT", "asset exceeds byte limit");
  if (hasPngSignature(bytes)) return inspectPngForImport(bytes, limits);
  if (hasJpegSignature(bytes)) return inspectJpeg(bytes, limits);
  throw new AssetError("ASSET_SIGNATURE_UNSUPPORTED", "asset signature is unsupported");
};

const deviceName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const pathSegments = (file: string): readonly string[] => {
  if (file.length === 0 || path.isAbsolute(file) || /^[a-z]:[\\/]/iu.test(file)) {
    throw new AssetError("ASSET_PATH_ESCAPE", "asset file must be relative");
  }
  const segments = file.split(/[\\/]/u);
  if (segments.some((part) => part === "" || part === "." || part === "..")) {
    throw new AssetError("ASSET_PATH_ESCAPE", "asset path has an unsafe segment");
  }
  if (segments.some((part) => deviceName.test(part))) {
    throw new AssetError("ASSET_DEVICE_PATH", "device-like asset paths are forbidden");
  }
  return segments;
};

const validateDirectoryRoot = async (root: string): Promise<string> => {
  const rootStats = await lstat(root);
  if (rootStats.isSymbolicLink()) throw new AssetError("ASSET_SYMLINK_FORBIDDEN", "root must not be a symlink");
  if (!rootStats.isDirectory()) throw new AssetError("ASSET_NOT_REGULAR", "root must be a directory");
  return realpath(root);
};

const readSource = async (input: ImportAssetInput, limits: AssetLimits): Promise<{
  readonly bytes: Uint8Array;
  readonly relativePath: string;
}> => {
  const segments = pathSegments(input.file);
  const root = await validateDirectoryRoot(input.allowedRoot);
  let candidate = root;
  for (let index = 0; index < segments.length; index += 1) {
    const part = segments[index];
    if (part === undefined) throw new AssetError("ASSET_PATH_ESCAPE", "asset path is incomplete");
    candidate = path.join(candidate, part);
    let entry;
    try {
      entry = await lstat(candidate);
    } catch (error) {
      if (filesystemCode(error) === "ENOENT") throw new AssetError("ASSET_SOURCE_MISSING", "asset source is missing");
      throw error;
    }
    if (entry.isSymbolicLink()) throw new AssetError("ASSET_SYMLINK_FORBIDDEN", "asset path contains a symlink");
    const final = index === segments.length - 1;
    if ((final && !entry.isFile()) || (!final && !entry.isDirectory())) {
      throw new AssetError("ASSET_NOT_REGULAR", "asset source must be a regular file");
    }
  }
  const initialPath = await realpath(candidate);
  if (!within(root, initialPath)) throw new AssetError("ASSET_PATH_ESCAPE", "asset source escapes its root");
  const beforeStats = await stat(candidate);
  const before = statIdentity(beforeStats);
  if (!beforeStats.isFile()) throw new AssetError("ASSET_NOT_REGULAR", "asset source must be regular");
  if (before.size > limits.maxBytes) throw new AssetError("ASSET_BYTE_LIMIT", "asset exceeds byte limit");
  await input.hooks?.afterSourceStat?.(candidate);
  const bytes = await readFile(candidate);
  const after = statIdentity(await stat(candidate));
  if (
    before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs || bytes.byteLength !== after.size
  ) throw new AssetError("ASSET_SOURCE_CHANGED", "asset changed while being read");
  const finalPath = await realpath(candidate);
  if (finalPath !== initialPath || !within(root, finalPath)) {
    throw new AssetError("ASSET_SOURCE_CHANGED", "asset path changed while being read");
  }
  return { bytes, relativePath: segments.join("/") };
};

const validateBinding = (
  input: ImportAssetInput,
  digest: string,
  rights: AssetRights,
  image: ImageInfo
): void => {
  const recipe = validateContract("VisualRecipe", input.recipe);
  if (!recipe.ok) throw new AssetError("ASSET_RECIPE_INVALID", "VisualRecipe validation failed", recipe.issues);
  const slots = new Set<string>();
  for (const recipeCard of recipe.value.cards) {
    for (const candidate of recipeCard.assetBindings) {
      if (slots.has(candidate.slot)) {
        throw new AssetError("ASSET_SLOT_DUPLICATE", "VisualRecipe slot IDs must be globally unique");
      }
      slots.add(candidate.slot);
    }
  }
  const card = recipe.value.cards.find((candidate) => candidate.cardId === input.cardId);
  const binding = card?.assetBindings.find((candidate) => candidate.slot === input.slot);
  if (binding === undefined) throw new AssetError("ASSET_SLOT_MISSING", "VisualRecipe slot is missing");
  if (
    binding.assetDigest !== digest ||
    binding.rights !== rights ||
    binding.originNote !== input.originNote
  ) {
    throw new AssetError("ASSET_SLOT_BINDING_MISMATCH", "asset does not match its recipe binding");
  }
  const policy = SLOT_MEDIA_POLICIES[input.slot];
  if (policy === undefined) {
    throw new AssetError("ASSET_SLOT_CONSTRAINT_MISSING", "VisualRecipe slot has no runtime media policy");
  }
  if (!policy.mime.includes(image.mime) || (policy.alpha !== undefined && policy.alpha !== image.alpha)) {
    throw new AssetError("ASSET_SLOT_MEDIA_MISMATCH", "asset media does not satisfy its slot policy");
  }
};

const prepareAssetsRoot = async (workspaceRoot: string): Promise<string> => {
  const workspace = await validateDirectoryRoot(workspaceRoot);
  const assetsRoot = path.join(workspace, "assets");
  try {
    await mkdir(assetsRoot, { recursive: false, mode: 0o700 });
  } catch (error) {
    if (filesystemCode(error) !== "EEXIST") throw error;
    const entry = await lstat(assetsRoot);
    if (entry.isSymbolicLink()) throw new AssetError("ASSET_SYMLINK_FORBIDDEN", "assets root must not be a symlink");
    if (!entry.isDirectory()) throw new AssetError("ASSET_NOT_REGULAR", "assets root must be a directory");
  }
  const resolved = await realpath(assetsRoot);
  if (!within(workspace, resolved)) throw new AssetError("ASSET_PATH_ESCAPE", "assets root escapes workspace");
  return resolved;
};

const writeSynced = async (target: string, bytes: Uint8Array): Promise<void> => {
  const handle = await open(target, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(target, 0o400);
};

const existingAsset = async (
  target: string,
  record: AssetRecord,
  sourceBytes: Uint8Array,
  extension: string
): Promise<ImportedAsset> => {
  const metadataPath = path.join(target, "metadata.json");
  const artifactPath = path.join(target, `asset.${extension}`);
  const repairLeafSymlink = async (
    file: string,
    expectedBytes: Uint8Array,
    parentBefore: StatIdentity
  ): Promise<void> => {
    const temporary = path.join(target, `.${path.basename(file)}.${randomUUID()}.repair`);
    try {
      await writeSynced(temporary, expectedBytes);
      const parentReadyEntry = await lstat(target);
      if (parentReadyEntry.isSymbolicLink()) {
        throw new AssetError("ASSET_SYMLINK_FORBIDDEN", "digest destination parent changed during repair");
      }
      if (!parentReadyEntry.isDirectory()) {
        throw new AssetError("ASSET_NOT_REGULAR", "digest destination parent changed during repair");
      }
      const fileReadyEntry = await lstat(file);
      const parentReady = statIdentity(parentReadyEntry);
      if (
        parentBefore.dev !== parentReady.dev ||
        parentBefore.ino !== parentReady.ino ||
        !fileReadyEntry.isSymbolicLink()
      ) {
        throw new AssetError("ASSET_DIGEST_CONFLICT", "digest destination changed during repair");
      }
      await rename(temporary, file);
      const directory = await open(target, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } finally {
      await rm(temporary, { force: true });
    }
  };
  const readAcceptedFile = async (
    file: string,
    expectedBytes: Uint8Array
  ): Promise<Uint8Array> => {
    let parentEntry;
    let fileEntry;
    try {
      parentEntry = await lstat(target);
    } catch (error) {
      if (filesystemCode(error) === "ENOENT") {
        throw new AssetError("ASSET_DIGEST_CONFLICT", "digest directory is incomplete");
      }
      throw error;
    }
    if (parentEntry.isSymbolicLink()) {
      throw new AssetError("ASSET_SYMLINK_FORBIDDEN", "digest destination must not contain symlinks");
    }
    if (!parentEntry.isDirectory()) {
      throw new AssetError("ASSET_NOT_REGULAR", "digest destination must contain regular files");
    }
    const parentBefore = statIdentity(parentEntry);
    try {
      fileEntry = await lstat(file);
    } catch (error) {
      if (filesystemCode(error) === "ENOENT") {
        throw new AssetError("ASSET_DIGEST_CONFLICT", "digest directory is incomplete");
      }
      throw error;
    }
    if (fileEntry.isSymbolicLink()) {
      await repairLeafSymlink(file, expectedBytes, parentBefore);
      throw new AssetError("ASSET_SYMLINK_FORBIDDEN", "digest destination must not contain symlinks");
    }
    if (!fileEntry.isFile()) {
      throw new AssetError("ASSET_NOT_REGULAR", "digest destination must contain regular files");
    }
    const fileBefore = statIdentity(fileEntry);
    const parentReadyEntry = await lstat(target);
    const parentReady = statIdentity(parentReadyEntry);
    if (
      parentReadyEntry.isSymbolicLink() ||
      parentBefore.dev !== parentReady.dev ||
      parentBefore.ino !== parentReady.ino
    ) {
      throw new AssetError(
        parentReadyEntry.isSymbolicLink() ? "ASSET_SYMLINK_FORBIDDEN" : "ASSET_DIGEST_CONFLICT",
        "digest destination parent changed before reading"
      );
    }
    let handle;
    try {
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if (filesystemCode(error) === "ELOOP") {
        throw new AssetError("ASSET_SYMLINK_FORBIDDEN", "digest destination changed to a symlink");
      }
      if (filesystemCode(error) === "ENOENT") {
        throw new AssetError("ASSET_DIGEST_CONFLICT", "digest destination disappeared before reading");
      }
      throw error;
    }
    let bytes: Uint8Array;
    try {
      const openedBefore = await handle.stat();
      const openedIdentity = statIdentity(openedBefore);
      if (
        !openedBefore.isFile() ||
        openedIdentity.dev !== fileBefore.dev ||
        openedIdentity.ino !== fileBefore.ino
      ) {
        throw new AssetError("ASSET_DIGEST_CONFLICT", "digest destination changed before reading");
      }
      bytes = new Uint8Array(openedIdentity.size);
      let bytesRead = 0;
      while (bytesRead < bytes.byteLength) {
        const result = await handle.read(
          bytes,
          bytesRead,
          bytes.byteLength - bytesRead,
          bytesRead
        );
        if (result.bytesRead === 0) break;
        bytesRead += result.bytesRead;
      }
      if (bytesRead !== bytes.byteLength) {
        throw new AssetError("ASSET_DIGEST_CONFLICT", "digest destination ended while reading");
      }
      const openedAfter = statIdentity(await handle.stat());
      if (
        openedIdentity.dev !== openedAfter.dev ||
        openedIdentity.ino !== openedAfter.ino ||
        openedIdentity.size !== openedAfter.size ||
        openedIdentity.mtimeMs !== openedAfter.mtimeMs ||
        bytes.byteLength !== openedAfter.size
      ) {
        throw new AssetError("ASSET_DIGEST_CONFLICT", "digest destination changed while reading");
      }
    } finally {
      await handle.close();
    }
    let parentAfterEntry;
    let fileAfterEntry;
    try {
      parentAfterEntry = await lstat(target);
      if (parentAfterEntry.isSymbolicLink()) {
        throw new AssetError("ASSET_SYMLINK_FORBIDDEN", "digest destination changed to a symlink");
      }
      fileAfterEntry = await lstat(file);
    } catch (error) {
      if (error instanceof AssetError) throw error;
      if (filesystemCode(error) === "ENOENT") {
        throw new AssetError("ASSET_DIGEST_CONFLICT", "digest destination disappeared during reuse");
      }
      throw error;
    }
    if (fileAfterEntry.isSymbolicLink()) {
      throw new AssetError("ASSET_SYMLINK_FORBIDDEN", "digest destination changed to a symlink");
    }
    if (!parentAfterEntry.isDirectory() || !fileAfterEntry.isFile()) {
      throw new AssetError("ASSET_NOT_REGULAR", "digest destination changed to a non-regular node");
    }
    const parentAfter = statIdentity(parentAfterEntry);
    const fileAfter = statIdentity(fileAfterEntry);
    if (
      parentBefore.dev !== parentAfter.dev ||
      parentBefore.ino !== parentAfter.ino ||
      fileBefore.dev !== fileAfter.dev ||
      fileBefore.ino !== fileAfter.ino ||
      fileBefore.size !== fileAfter.size ||
      fileBefore.mtimeMs !== fileAfter.mtimeMs
    ) {
      throw new AssetError("ASSET_DIGEST_CONFLICT", "digest destination changed during reuse");
    }
    return bytes;
  };
  const metadata = await readAcceptedFile(metadataPath, canonicalJsonBytes(record));
  const artifact = await readAcceptedFile(artifactPath, sourceBytes);
  const artifactDigest = createHash("sha256").update(artifact).digest("hex");
  if (
    artifactDigest !== record.assetDigest ||
    !sameBytes(metadata, canonicalJsonBytes(record)) ||
    !sameBytes(artifact, sourceBytes)
  ) {
    throw new AssetError("ASSET_DIGEST_CONFLICT", "digest directory contains conflicting bytes");
  }
  return { record, artifactPath, metadataPath };
};

const storeAsset = async (
  input: ImportAssetInput,
  sourceBytes: Uint8Array,
  record: AssetRecord
): Promise<ImportedAsset> => {
  const assetsRoot = await prepareAssetsRoot(input.workspaceRoot);
  const target = path.join(assetsRoot, record.assetDigest);
  const extension = record.detectedMime === "image/png" ? "png" : "jpg";
  try {
    const entry = await lstat(target);
    if (entry.isSymbolicLink()) {
      throw new AssetError("ASSET_SYMLINK_FORBIDDEN", "digest address must not be a symlink");
    }
    if (!entry.isDirectory()) throw new AssetError("ASSET_NOT_REGULAR", "digest address must be a directory");
    return existingAsset(target, record, sourceBytes, extension);
  } catch (error) {
    if (error instanceof AssetError || filesystemCode(error) !== "ENOENT") throw error;
  }
  const temporary = path.join(assetsRoot, `.${record.assetDigest}.${randomUUID()}.tmp`);
  await mkdir(temporary, { recursive: false, mode: 0o700 });
  try {
    await writeSynced(path.join(temporary, `asset.${extension}`), sourceBytes);
    await writeSynced(path.join(temporary, "metadata.json"), canonicalJsonBytes(record));
    const tempDirectory = await open(temporary, "r");
    try {
      await tempDirectory.sync();
    } finally {
      await tempDirectory.close();
    }
    if (input.failpoint === "asset-before-rename") {
      throw new AssetError("ASSET_WRITE_INTERRUPTED", "asset write interrupted before acceptance");
    }
    try {
      await rename(temporary, target);
    } catch (error) {
      if (!["EEXIST", "ENOTEMPTY"].includes(String(filesystemCode(error)))) throw error;
      return existingAsset(target, record, sourceBytes, extension);
    }
    const directory = await open(assetsRoot, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    return {
      record,
      artifactPath: path.join(target, `asset.${extension}`),
      metadataPath: path.join(target, "metadata.json")
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
};

export const importAsset = async (input: ImportAssetInput): Promise<ImportedAsset> => {
  const rights = parseRights(input.rights, input.originNote);
  const importedAt = parseTimestamp(input.importedAt);
  const limits = input.limits ?? DEFAULT_ASSET_LIMITS;
  validateLimits(limits);
  const source = await readSource(input, limits);
  const image = await inspectImageForImport(source.bytes, limits);
  const digest = createHash("sha256").update(source.bytes).digest("hex");
  validateBinding(input, digest, rights, image);
  const unknown = rights === "unknown";
  const record: AssetRecord = {
    schemaVersion: 1,
    assetDigest: digest,
    originalRelativePath: source.relativePath,
    byteCount: source.bytes.byteLength,
    detectedMime: image.mime,
    width: image.width,
    height: image.height,
    alpha: image.alpha,
    rights,
    ...(input.originNote === undefined ? {} : { originNote: input.originNote }),
    importedAt,
    binding: { cardId: input.cardId, slot: input.slot },
    publicEligible: !unknown,
    publicPackageBlockers: unknown ? ["ASSET_RIGHTS_UNKNOWN"] : []
  };
  return storeAsset(input, source.bytes, record);
};

export const assertPublicPackageEligible = (record: AssetRecord): void => {
  if (!record.publicEligible || record.publicPackageBlockers.length !== 0) {
    throw new AssetError("ASSET_PUBLIC_PACKAGE_BLOCKED", "asset rights block public packaging", record.publicPackageBlockers);
  }
};
