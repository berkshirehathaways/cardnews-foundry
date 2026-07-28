import { inflateRawSync } from "node:zlib";
import yazl from "yazl";
import { PackageError } from "./errors.mjs";

const FIXED_MTIME = new Date("1980-01-01T00:00:00.000Z");
const FILE_MODE = 0o100444;
const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const DEFAULT_LIMITS = {
  maxEntries: 512,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxCompressionRatio: 200
};

const safePath = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  !value.startsWith("/") &&
  !/^[a-z]:\//iu.test(value) &&
  !value.includes("\\") &&
  !value.split("/").some((segment) => segment === "" || segment === "." || segment === "..");

const crcTable = Array.from({ length: 256 }, (_, initial) => {
  let value = initial;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

const crc32 = (bytes) => {
  let value = 0xffffffff;
  for (const byte of bytes) {
    const next = crcTable[(value ^ byte) & 0xff];
    if (next === undefined) throw new PackageError("ARCHIVE_CRC_INTERNAL", "CRC lookup failed");
    value = next ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
};

const collectOutput = (zip) => new Promise((resolve, reject) => {
  const chunks = [];
  zip.outputStream.on("data", (chunk) => chunks.push(chunk));
  zip.outputStream.once("error", reject);
  zip.outputStream.once("end", () => resolve(Buffer.concat(chunks)));
});

export const createDeterministicZip = async (entries) => {
  const ordered = [...entries].sort((left, right) => left.path.localeCompare(right.path, "en"));
  if (ordered.length === 0) throw new PackageError("ARCHIVE_EMPTY", "archive requires at least one entry");
  const seen = new Set();
  const zip = new yazl.ZipFile();
  for (const entry of ordered) {
    if (!safePath(entry.path)) {
      throw new PackageError("ARCHIVE_PATH_UNSAFE", "archive entry path is unsafe", entry.path);
    }
    if (seen.has(entry.path)) throw new PackageError("ARCHIVE_PATH_DUPLICATE", "archive entry path is duplicated");
    seen.add(entry.path);
    const mode = entry.mode ?? FILE_MODE;
    if ((mode & 0o170000) !== 0o100000) {
      throw new PackageError("ARCHIVE_SPECIAL_NODE", "archive entries must be regular files");
    }
    zip.addBuffer(Buffer.from(entry.bytes), entry.path, {
      mtime: FIXED_MTIME,
      mode,
      compress: true,
      compressionLevel: 9,
      forceZip64Format: false,
      forceDosTimestamp: false
    });
  }
  const output = collectOutput(zip);
  zip.end({ forceZip64Format: false });
  return output;
};

const findEocd = (bytes) => {
  const lower = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= lower; offset -= 1) {
    if (bytes.readUInt32LE(offset) === EOCD) return offset;
  }
  throw new PackageError("ARCHIVE_EOCD_MISSING", "ZIP end record is missing");
};

const timestampFromExtra = (extra, dosDate, dosTime) => {
  let offset = 0;
  while (offset + 4 <= extra.length) {
    const id = extra.readUInt16LE(offset);
    const size = extra.readUInt16LE(offset + 2);
    if (offset + 4 + size > extra.length) break;
    if (id === 0x5455 && size >= 5 && (extra[offset + 4] & 1) === 1) {
      return new Date(extra.readUInt32LE(offset + 5) * 1000).toISOString();
    }
    offset += 4 + size;
  }
  const year = 1980 + ((dosDate >>> 9) & 0x7f);
  const month = (dosDate >>> 5) & 0x0f;
  const day = dosDate & 0x1f;
  const hour = (dosTime >>> 11) & 0x1f;
  const minute = (dosTime >>> 5) & 0x3f;
  const second = (dosTime & 0x1f) * 2;
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second)).toISOString();
};

const decompressed = (method, compressed, expected) => {
  const bytes = method === 0
    ? compressed
    : method === 8
      ? inflateRawSync(compressed, { maxOutputLength: expected + 1 })
      : undefined;
  if (bytes === undefined) throw new PackageError("ARCHIVE_COMPRESSION_UNSUPPORTED", "ZIP method is unsupported");
  if (bytes.length !== expected) throw new PackageError("ARCHIVE_SIZE_MISMATCH", "ZIP entry size does not match");
  return bytes;
};

export const inspectZip = (input, limits = {}) => {
  const bytes = Buffer.from(input);
  const policy = { ...DEFAULT_LIMITS, ...limits };
  const eocd = findEocd(bytes);
  const disk = bytes.readUInt16LE(eocd + 4);
  const centralDisk = bytes.readUInt16LE(eocd + 6);
  const count = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  if (disk !== 0 || centralDisk !== 0) throw new PackageError("ARCHIVE_MULTIDISK", "multi-disk ZIP is forbidden");
  if (count > policy.maxEntries) throw new PackageError("ARCHIVE_ENTRY_LIMIT", "ZIP entry count exceeds limit");
  if (centralOffset + centralSize > eocd) throw new PackageError("ARCHIVE_CENTRAL_INVALID", "ZIP directory is invalid");
  const entries = [];
  const seen = new Set();
  let offset = centralOffset;
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== CENTRAL) {
      throw new PackageError("ARCHIVE_CENTRAL_INVALID", "ZIP directory entry is invalid");
    }
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const dosTime = bytes.readUInt16LE(offset + 12);
    const dosDate = bytes.readUInt16LE(offset + 14);
    const expectedCrc = bytes.readUInt32LE(offset + 16);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const size = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const mode = bytes.readUInt32LE(offset + 38) >>> 16;
    const localOffset = bytes.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    const extraEnd = nameEnd + extraLength;
    if (extraEnd + commentLength > bytes.length) {
      throw new PackageError("ARCHIVE_CENTRAL_INVALID", "ZIP directory lengths are invalid");
    }
    const entryPath = bytes.subarray(nameStart, nameEnd).toString("utf8");
    if (!safePath(entryPath)) throw new PackageError("ARCHIVE_PATH_UNSAFE", "ZIP entry path is unsafe");
    if (seen.has(entryPath)) throw new PackageError("ARCHIVE_PATH_DUPLICATE", "ZIP entry path is duplicated");
    seen.add(entryPath);
    const fileType = mode & 0o170000;
    if (fileType !== 0 && fileType !== 0o100000) {
      throw new PackageError("ARCHIVE_SPECIAL_NODE", "ZIP special nodes are forbidden");
    }
    if ((flags & 1) !== 0) throw new PackageError("ARCHIVE_ENCRYPTED", "encrypted ZIP entries are forbidden");
    if (size > policy.maxEntryBytes) throw new PackageError("ARCHIVE_ENTRY_SIZE", "ZIP entry exceeds size limit");
    total += size;
    if (total > policy.maxTotalBytes) throw new PackageError("ARCHIVE_TOTAL_SIZE", "ZIP expansion exceeds limit");
    const ratio = compressedSize === 0 ? (size === 0 ? 1 : Number.POSITIVE_INFINITY) : size / compressedSize;
    if (ratio > policy.maxCompressionRatio) {
      throw new PackageError("ARCHIVE_COMPRESSION_RATIO", "ZIP compression ratio exceeds limit");
    }
    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== LOCAL) {
      throw new PackageError("ARCHIVE_LOCAL_INVALID", "ZIP local entry is invalid");
    }
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > centralOffset) throw new PackageError("ARCHIVE_DATA_INVALID", "ZIP entry data is out of bounds");
    const content = decompressed(method, bytes.subarray(dataStart, dataEnd), size);
    if (crc32(content) !== expectedCrc) throw new PackageError("ARCHIVE_CRC_MISMATCH", "ZIP entry CRC differs");
    entries.push({
      path: entryPath,
      bytes: content,
      size,
      compressedSize,
      mode,
      modifiedAt: timestampFromExtra(bytes.subarray(nameEnd, extraEnd), dosDate, dosTime)
    });
    offset = extraEnd + commentLength;
  }
  if (offset !== centralOffset + centralSize) {
    throw new PackageError("ARCHIVE_CENTRAL_INVALID", "ZIP directory size differs");
  }
  return { entries, totalBytes: total };
};
