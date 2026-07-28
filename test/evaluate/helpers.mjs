import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

const segments = (location) => location.split(".");

const parentAt = (value, location) => {
  const parts = segments(location);
  const key = parts.pop();
  let parent = value;
  for (const part of parts) parent = parent[part];
  return { parent, key };
};

const valueAt = (value, location) => {
  let current = value;
  for (const part of segments(location)) current = current[part];
  return current;
};

export const applyBrokenFixture = (input, fixture) => {
  if (fixture.score !== undefined) input.score = fixture.score;
  if (fixture.operation === "set-package-text") {
    input.package.files[fixture.relativePath].text = fixture.value;
    return;
  }
  const { parent, key } = parentAt(input, fixture.path);
  switch (fixture.operation) {
    case "set":
      parent[key] = fixture.value;
      return;
    case "delete":
      delete parent[key];
      return;
    case "append":
      parent[key].push(fixture.value);
      return;
    case "remove-first":
      parent[key].shift();
      return;
    case "remove-last":
      parent[key].pop();
      return;
    case "reverse":
      parent[key].reverse();
      return;
    case "copy":
      parent[key] = valueAt(input, fixture.from);
      return;
    default:
      throw new TypeError(`unsupported fixture operation: ${fixture.operation}`);
  }
};

export const packageFilesFromRender = async (renderRoot, manifest) => {
  const paths = [
    ...manifest.artifacts.map((artifact) => artifact.contract.relativePath),
    manifest.contactSheet.relativePath
  ];
  return Object.fromEntries(await Promise.all(paths.map(async (relativePath) => {
    const bytes = await readFile(path.join(renderRoot, relativePath));
    const metadata = await stat(path.join(renderRoot, relativePath));
    return [relativePath, {
      sha256: sha256(bytes),
      size: bytes.byteLength,
      text: "",
      mtimeMs: metadata.mtimeMs
    }];
  })));
};
