import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { PackageError } from "./errors.mjs";

const execute = promisify(execFile);
const prohibitedExtension = /\.(?:env|har|key|p12|pem|sqlite(?:3)?|db|webarchive|zip|tar|tgz)$/iu;
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/u,
  /\b(?:api[_-]?key|access[_-]?token|secret[_-]?key|password)\s*[:=]\s*["']?[A-Za-z0-9/+_.-]{12,}/iu
];
const textExtension = /\.(?:c?js|mjs|ts|json|jsonl|md|txt|html|css|ya?ml|toml|xml|svg|sh|lock)$/iu;

const safePath = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  !path.isAbsolute(value) &&
  !/^[a-z]:[\\/]/iu.test(value) &&
  !value.includes("\\") &&
  !value.split("/").some((segment) => segment === "" || segment === "." || segment === "..");

const prohibitedPath = (value) => {
  const segments = value.toLowerCase().split("/");
  return segments.some((segment) =>
    segment === ".omo" ||
    segment === ".omx" ||
    segment === ".openchrome" ||
    segment === "browser" ||
    segment.includes("cookie") ||
    segment === "browser-state" ||
    segment === "browser-profile"
  ) ||
    segments.some((segment) => segment === ".env" || segment.startsWith(".env.")) ||
    /(?:^|\/)\.cardnews\/jobs\//u.test(value) ||
    /(?:^|\/)source\/(?:raw|extracted)(?:\/|$)/u.test(value) ||
    /(?:^|\/)(?:playwright|chrome|chromium)-(?:profile|state)(?:\/|$)/u.test(value);
};

const privateSourceSnapshot = (value) => {
  if (value === "fixtures/synthetic/source/article.html") return false;
  const lower = value.toLowerCase();
  if (lower.endsWith(".html")) return true;
  const segments = lower.split("/");
  return /\.(?:md|txt)$/u.test(lower) &&
    segments.some((segment) =>
      ["article", "articles", "content", "extracted", "raw", "snapshot", "snapshots"].includes(segment)
    );
};

const parseJson = (entry, code) => {
  try {
    return JSON.parse(entry.bytes.toString("utf8"));
  } catch {
    throw new PackageError(code, "release metadata JSON is malformed", entry.path);
  }
};

const verifyFontLicenses = (entries, byPath) => {
  const fonts = entries.filter((entry) => /\.(?:otf|ttf|woff2?)$/iu.test(entry.path));
  if (fonts.length === 0) return 0;
  const manifestEntry = byPath.get("fonts/manifest.json");
  if (manifestEntry === undefined) {
    throw new PackageError("RELEASE_FONT_LICENSE", "font manifest is missing");
  }
  const manifest = parseJson(manifestEntry, "RELEASE_FONT_LICENSE");
  const licenseFile = manifest?.license?.file;
  const spdx = manifest?.license?.spdx;
  const declaredFonts = Array.isArray(manifest?.fonts)
    ? new Set(manifest.fonts.map((font) => font?.file))
    : new Set();
  if (
    typeof licenseFile !== "string" ||
    typeof spdx !== "string" ||
    !byPath.has(licenseFile) ||
    fonts.some((font) => !declaredFonts.has(font.path))
  ) {
    throw new PackageError("RELEASE_FONT_LICENSE", "font license or manifest coverage is incomplete");
  }
  return 1;
};

const verifyImageRights = (entries, byPath) => {
  const assets = entries.filter((entry) =>
    /^fixtures\/synthetic\/assets\/[^/]+\/asset\.bin$/u.test(entry.path)
  );
  const undeclaredImages = entries.filter((entry) =>
    /\.(?:jpe?g|png|webp)$/iu.test(entry.path) &&
    !/^test\/assets\/fixtures\//u.test(entry.path)
  );
  if (undeclaredImages.length !== 0) {
    throw new PackageError("RELEASE_IMAGE_LICENSE", "production image rights metadata is missing");
  }
  for (const asset of assets) {
    const metadataPath = `${path.posix.dirname(asset.path)}/metadata.json`;
    const metadataEntry = byPath.get(metadataPath);
    if (metadataEntry === undefined) {
      throw new PackageError("RELEASE_IMAGE_LICENSE", "synthetic image rights metadata is missing");
    }
    const metadata = parseJson(metadataEntry, "RELEASE_IMAGE_LICENSE");
    if (
      !["generated", "licensed", "public-domain", "user-provided"].includes(metadata.rights) ||
      metadata.publicEligible !== true ||
      !Array.isArray(metadata.publicPackageBlockers) ||
      metadata.publicPackageBlockers.length !== 0
    ) {
      throw new PackageError("RELEASE_IMAGE_LICENSE", "image publication rights are unresolved");
    }
  }
  return assets.length;
};

export const inspectReleaseEntries = (rawEntries, { kind }) => {
  const entries = rawEntries.map((entry) => ({ path: entry.path, bytes: Buffer.from(entry.bytes) }));
  const byPath = new Map();
  for (const entry of entries) {
    if (!safePath(entry.path)) throw new PackageError("RELEASE_PATH_UNSAFE", "release path is unsafe");
    if (byPath.has(entry.path)) throw new PackageError("RELEASE_PATH_DUPLICATE", "release path is duplicated");
    if (prohibitedPath(entry.path)) {
      throw new PackageError("RELEASE_PATH_PROHIBITED", "release path contains private state", entry.path);
    }
    if (privateSourceSnapshot(entry.path)) {
      throw new PackageError("RELEASE_PRIVATE_SOURCE", "release contains a raw or full-text source snapshot", entry.path);
    }
    if (prohibitedExtension.test(entry.path)) {
      throw new PackageError("RELEASE_EXTENSION_PROHIBITED", "release file extension is prohibited", entry.path);
    }
    byPath.set(entry.path, entry);
    if (textExtension.test(entry.path) && entry.bytes.length <= 2 * 1024 * 1024) {
      const text = entry.bytes.toString("utf8");
      if (secretPatterns.some((pattern) => pattern.test(text))) {
        throw new PackageError("RELEASE_SECRET", "release text contains a credential pattern", entry.path);
      }
    }
  }
  return {
    ok: true,
    kind,
    entryCount: entries.length,
    fontLicensesVerified: verifyFontLicenses(entries, byPath),
    imageRightsVerified: verifyImageRights(entries, byPath)
  };
};

const gitOutput = async (root, args) => {
  const result = await execute("git", args, {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 16 * 1024 * 1024
  });
  return Buffer.from(result.stdout);
};

const hasHead = async (root) => {
  try {
    await gitOutput(root, ["rev-parse", "--verify", "HEAD"]);
    return true;
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, "code") === 128) return false;
    const stderr = error instanceof Error ? Reflect.get(error, "stderr") : undefined;
    if (Buffer.isBuffer(stderr) && stderr.toString("utf8").includes("Needed a single revision")) return false;
    return false;
  }
};

export const resolveSourceInventory = async (root) => {
  const tracked = await hasHead(root);
  const stdout = await gitOutput(root, tracked
    ? ["ls-files", "-z"]
    : ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
  const paths = stdout.toString("utf8")
    .split("\0")
    .filter((entry) => entry.length > 0)
    .sort((left, right) => left.localeCompare(right, "en"));
  return { mode: tracked ? "tracked-files" : "source-inventory", paths };
};

export const readSourceInventory = async (root) => {
  const inventory = await resolveSourceInventory(root);
  const entries = await Promise.all(inventory.paths.map(async (relativePath) => {
    const absolutePath = path.join(root, relativePath);
    const metadata = await lstat(absolutePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new PackageError("RELEASE_SOURCE_TYPE", "source inventory contains a non-regular file", relativePath);
    }
    return {
      path: relativePath,
      bytes: await readFile(absolutePath),
      mode: 0o100000 | (metadata.mode & 0o777)
    };
  }));
  return { ...inventory, entries };
};
