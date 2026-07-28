import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

const defaultIgnorables = /[\p{Default_Ignorable_Code_Point}\u202a-\u202e\u2066-\u2069]/gu;
const separators = /[\p{P}\p{S}\p{Z}\s]+/gu;
const singleTokenIdentities = new Set(["deepseek", "liangwenfeng", "량원펑", "리앙원펑", "梁文锋"]);
const identityContext = new Set(["ai", "copy", "identity", "model", "name", "project", "reference", "repo", "repository"]);
const namedSequences = [["liang", "wenfeng"], ["cardnews", "liang"]];

const normalizedTokens = (value) => value.normalize("NFKC").toLocaleLowerCase("en-US")
  .replace(defaultIgnorables, "").replace(separators, " ").trim().split(" ").filter(Boolean);
const containsSequence = (tokens, sequence) =>
  tokens.some((_, index) => sequence.every((token, offset) => tokens[index + offset] === token));

export const hasProhibitedValue = (value) => {
  const tokens = normalizedTokens(value);
  if (tokens.some((token) => singleTokenIdentities.has(token))) return true;
  if (namedSequences.some((sequence) => containsSequence(tokens, sequence))) return true;
  return tokens.some((token, index) => token === "deep" && tokens[index + 1] === "seek"
    && (tokens.length === 2 || identityContext.has(tokens[index - 1]) || identityContext.has(tokens[index + 2])));
};

export const hasProhibitedFilename = (relativePath) =>
  relativePath.split(/[\\/]/u).some((segment) => segment.split(".").some(hasProhibitedValue));

const absolutePathPattern = /(?:^|[\s"'(])\/(?:users|tmp|var|home)\//iu;
const windowsPathPattern = /[a-z]:[\\/]/iu;

export const auditAbsolutePaths = ({ snapshots, issue }) => {
  for (const snapshot of snapshots) {
    if (!/\.(?:json|html)$/u.test(snapshot.relativePath)) continue;
    const text = snapshot.bytes.toString("utf8");
    if (absolutePathPattern.test(text) || windowsPathPattern.test(text)) {
      issue("ABSOLUTE_PATH_FORBIDDEN", snapshot.relativePath);
    }
  }
};

export const stringValues = function* (value) {
  if (typeof value === "string") { yield value; return; }
  if (Array.isArray(value)) {
    for (const entry of value) yield* stringValues(entry);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value)) yield* stringValues(entry);
  }
};

export const scanProhibitedFiles = async ({ candidates, issue }) => {
  const reported = new Set();
  for (const { relativePath, bytes, parsed } of candidates) {
    let prohibited = hasProhibitedFilename(relativePath);
    if (bytes !== undefined && /\.json$/iu.test(relativePath)) {
      let value = parsed;
      if (value === undefined) {
        try { value = JSON.parse(bytes.toString("utf8")); }
        catch (error) { if (!(error instanceof SyntaxError)) throw error; }
      }
      prohibited ||= value !== undefined && [...stringValues(value)].some(hasProhibitedValue);
    } else if (bytes !== undefined && /\.(?:html|txt|md)$/iu.test(relativePath)) {
      prohibited ||= bytes.toString("utf8").split(/\r?\n/u).some(hasProhibitedValue);
    }
    if (prohibited && !reported.has(relativePath)) {
      issue("PROHIBITED_CONTENT", relativePath);
      reported.add(relativePath);
    }
  }
};

export const validateManifestRecords = ({ entries, stages, repositoryRoot, issue }) => {
  let valid = entries.length === stages.length;
  if (!valid) issue("MANIFEST_RECORD_COUNT_MISMATCH", "manifest.records");
  const seen = { stage: new Set(), key: new Set(), path: new Set() };
  for (const [index, entry] of entries.entries()) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      issue("MANIFEST_RECORD_INVALID", `manifest.records/${index}`);
      valid = false;
      continue;
    }
    const expected = stages[index];
    if (!stages.includes(entry.stage)) { issue("MANIFEST_RECORD_STAGE_UNKNOWN", entry.stage ?? `manifest.records/${index}`); valid = false; }
    if (entry.stage !== expected) { issue("MANIFEST_RECORD_ORDER_MISMATCH", entry.stage ?? `manifest.records/${index}`); valid = false; }
    if (expected !== undefined && entry.key !== `record:${expected}`) { issue("MANIFEST_RECORD_KEY_MISMATCH", entry.key ?? `manifest.records/${index}`); valid = false; }
    for (const [field, code] of [["stage", "MANIFEST_RECORD_STAGE_DUPLICATE"], ["key", "MANIFEST_RECORD_KEY_DUPLICATE"], ["path", "MANIFEST_RECORD_PATH_DUPLICATE"]]) {
      const value = entry[field];
      const identity = field === "path" && typeof value === "string" ? path.resolve(repositoryRoot, value) : value;
      if (seen[field].has(identity)) { issue(code, value ?? `manifest.records/${index}`); valid = false; }
      else seen[field].add(identity);
    }
  }
  return valid;
};

const isInside = (target, approvedRoot) =>
  target === approvedRoot || target.startsWith(`${approvedRoot}${path.sep}`);
const isRelativePath = (value) => typeof value === "string" && !path.isAbsolute(value)
  && !/^[a-z]:[\\/]/iu.test(value) && !value.split(/[\\/]/u).includes("..");

export const createFileBoundary = ({ repositoryRoot, issue }) => {
  const identities = new Map();

  const inspectComponents = async ({ target, subject, finalKind }) => {
    const relative = path.relative(repositoryRoot, target);
    let current = repositoryRoot;
    for (const [index, component] of relative.split(path.sep).entries()) {
      current = path.join(current, component);
      let stats;
      try {
        stats = await lstat(current);
      } catch (error) {
        issue("FILE_MISSING", subject, error instanceof Error ? error.message : undefined);
        return undefined;
      }
      if (stats.isSymbolicLink()) {
        issue("SYMLINK_FORBIDDEN", subject, current);
        return undefined;
      }
      const final = index === relative.split(path.sep).length - 1;
      if ((!final && !stats.isDirectory()) || (final && finalKind === "file" && !stats.isFile())
        || (final && finalKind === "directory" && !stats.isDirectory())) {
        issue(finalKind === "file" ? "FILE_NOT_REGULAR" : "PATH_COMPONENT_INVALID", subject, current);
        return undefined;
      }
    }
    return lstat(target);
  };

  const lexicalTarget = (relativePath, subject, approvedRoot) => {
    if (!isRelativePath(relativePath)) {
      issue(path.isAbsolute(relativePath ?? "") || /^[a-z]:[\\/]/iu.test(relativePath ?? "")
        ? "ABSOLUTE_PATH_FORBIDDEN" : "PATH_ESCAPE", subject);
      return undefined;
    }
    const target = path.resolve(repositoryRoot, relativePath);
    if (!isInside(target, approvedRoot)) {
      issue("PATH_ESCAPE", subject);
      return undefined;
    }
    return target;
  };

  const resolveDirectory = async ({ relativePath, subject }) => {
    const target = lexicalTarget(relativePath, subject, repositoryRoot);
    if (target === undefined) return undefined;
    if (await inspectComponents({ target, subject, finalKind: "directory" }) === undefined) return undefined;
    const resolved = await realpath(target);
    if (!isInside(resolved, await realpath(repositoryRoot))) {
      issue("REALPATH_ESCAPE", subject);
      return undefined;
    }
    return resolved;
  };

  const resolveFile = async ({ relativePath, subject, approvedRoot }) => {
    const target = lexicalTarget(relativePath, subject, approvedRoot);
    if (target === undefined) return undefined;
    const stats = await inspectComponents({ target, subject, finalKind: "file" });
    if (stats === undefined) return undefined;
    if (stats.nlink !== 1) {
      issue("FILE_IDENTITY_ALIAS", subject, { linkCount: stats.nlink });
      return undefined;
    }
    const [resolved, approvedResolved] = await Promise.all([realpath(target), realpath(approvedRoot)]);
    if (!isInside(resolved, approvedResolved)) {
      issue("REALPATH_ESCAPE", subject);
      return undefined;
    }
    let handle;
    try {
      handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      issue("FILE_READ_FAILED", subject, error instanceof Error ? error.message : undefined);
      return undefined;
    }
    let bytes;
    try {
      const openedStats = await handle.stat();
      if (!openedStats.isFile() || openedStats.dev !== stats.dev || openedStats.ino !== stats.ino || openedStats.nlink !== 1) {
        issue("FILE_CHANGED_DURING_VERIFICATION", subject);
        return undefined;
      }
      bytes = await handle.readFile();
    } catch (error) {
      issue("FILE_READ_FAILED", subject, error instanceof Error ? error.message : undefined);
      return undefined;
    } finally {
      await handle.close();
    }
    const identityKeys = [`path:${resolved}`, `inode:${stats.dev}:${stats.ino}`];
    const alias = identityKeys.map((key) => identities.get(key)).find((owner) => owner !== undefined && owner !== subject);
    if (alias !== undefined) {
      issue("FILE_IDENTITY_ALIAS", subject, { alias });
      return undefined;
    }
    for (const key of identityKeys) identities.set(key, subject);
    return Object.freeze({ bytes, path: resolved, relativePath });
  };

  return { resolveDirectory, resolveFile };
};

export const resolveManifestFiles = async ({ boundary, manifest, fixturePath, repositoryRoot }) => {
  const resourceList = [manifest.resources?.target, manifest.resources?.theme,
    manifest.resources?.fontManifest, ...(manifest.resources?.fonts ?? [])];
  const metadataEntries = manifest.assets.map((asset) => ({
    key: asset.metadataKey, path: asset.metadataPath,
    sha256: asset.metadataSha256, byteCount: asset.metadataByteCount
  }));
  const registrations = [
    { entry: manifest.source, approvedRoot: fixturePath, identity: "source" },
    ...manifest.records.map((entry, index) => ({ entry, approvedRoot: fixturePath, identity: `record:${index}` })),
    ...manifest.assets.flatMap((asset, index) => [
      { entry: asset, approvedRoot: fixturePath, identity: `asset:${index}` },
      { entry: metadataEntries[index], approvedRoot: fixturePath, identity: `asset-metadata:${index}` }
    ]),
    { entry: manifest.resources?.target, approvedRoot: path.join(repositoryRoot, "targets"), identity: "resource:target" },
    { entry: manifest.resources?.theme, approvedRoot: path.join(repositoryRoot, "themes"), identity: "resource:theme" },
    { entry: manifest.resources?.fontManifest, approvedRoot: path.join(repositoryRoot, "fonts"), identity: "resource:font-manifest" },
    ...(manifest.resources?.fonts ?? []).map((entry, index) => ({
      entry, approvedRoot: path.join(repositoryRoot, "fonts"), identity: `font:${index}`
    }))
  ];
  const files = new Map();
  for (const registration of registrations) {
    const target = await boundary.resolveFile({
      relativePath: registration.entry?.path,
      subject: registration.identity,
      approvedRoot: registration.approvedRoot
    });
    if (target !== undefined) files.set(registration.entry.key, target);
  }
  const candidates = registrations.map(({ entry }) => files.get(entry?.key) ?? {
    relativePath: typeof entry?.path === "string" ? entry.path : ""
  });
  return { candidates, files, metadataEntries, resourceList };
};
