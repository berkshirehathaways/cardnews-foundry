import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { inspectPng } from "../render/png.mjs";
import { computeRendererSourceRevision } from "../render/input.mjs";
import { EvaluationError } from "./errors.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const parse = (bytes) => JSON.parse(bytes.toString("utf8"));
const within = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`);

const confinedPath = async (rootPath, relativePath) => {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    relativePath.includes("\\") ||
    relativePath.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new EvaluationError("EVALUATION_INPUT_PATH_ESCAPE", "evaluation input path must be confined");
  }
  const root = await realpath(rootPath);
  const target = path.resolve(root, relativePath);
  let resolved;
  try {
    resolved = await realpath(target);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") throw error;
    throw new EvaluationError("EVALUATION_INPUT_PATH_ESCAPE", "evaluation input path cannot be resolved safely");
  }
  if (!within(root, resolved)) {
    throw new EvaluationError("EVALUATION_INPUT_PATH_ESCAPE", "evaluation input path escapes the repository");
  }
  return resolved;
};

export const readConfinedRepositoryFile = async (repositoryRoot, relativePath) =>
  readFile(await confinedPath(repositoryRoot, relativePath));

const fileIdentity = async (root, relativePath) => {
  const file = await confinedPath(root, relativePath);
  const bytes = await readFile(file);
  const metadata = await stat(file);
  const png = inspectPng(bytes);
  return {
    relativePath,
    sha256: sha256(bytes),
    size: bytes.byteLength,
    signature: png.signature,
    width: png.width,
    height: png.height,
    opaque: png.opaque,
    colorSpace: png.colorSpace,
    mtimeMs: metadata.mtimeMs
  };
};

const listedFiles = (manifest) => [
  manifest.source.path,
  ...manifest.records.map((entry) => entry.path),
  manifest.resources.target.path,
  manifest.resources.theme.path,
  manifest.resources.fontManifest.path,
  ...manifest.resources.fonts.map((entry) => entry.path),
  ...manifest.assets.flatMap((entry) => [entry.path, entry.metadataPath])
];

const latestEvaluatedSourceEdit = async (repositoryRoot, manifest) => {
  const renderRoot = path.join(repositoryRoot, "src", "render");
  const renderSources = (await readdir(renderRoot))
    .filter((name) => name.endsWith(".mjs"))
    .map((name) => path.join(renderRoot, name));
  const repositoryFiles = [
    path.join(repositoryRoot, "DESIGN.md"),
    ...renderSources
  ];
  const manifestFiles = await Promise.all(listedFiles(manifest).map((name) =>
    confinedPath(repositoryRoot, name)
  ));
  return Math.max(...await Promise.all(
    [...repositoryFiles, ...manifestFiles].map(async (file) => (await stat(file)).mtimeMs)
  ));
};

const requiredDigests = (manifest) => [...new Set([
  manifest.source.sha256,
  ...manifest.records.map((entry) => entry.sha256),
  manifest.resources.target.sha256,
  manifest.resources.theme.sha256,
  manifest.resources.fontManifest.sha256,
  ...manifest.resources.fonts.map((entry) => entry.sha256),
  ...manifest.assets.flatMap((entry) => [entry.sha256, entry.metadataSha256])
])].sort();

export const loadEvaluationInput = async ({ repositoryRoot, fixtureRoot, renderRoot }) => {
  const fixtureRelative = path.relative(repositoryRoot, path.join(fixtureRoot, "manifest.json"));
  const fixtureManifest = parse(await readConfinedRepositoryFile(repositoryRoot, fixtureRelative));
  const record = async (stage) => {
    const entry = fixtureManifest.records.find((candidate) => candidate.stage === stage);
    if (entry === undefined) throw new TypeError(`missing fixture record: ${stage}`);
    return parse(await readConfinedRepositoryFile(repositoryRoot, entry.path));
  };
  const [source, editorial, storyboard, visualRecipe, renderSpec, renderManifest] = await Promise.all([
    record("SourceEnvelope"),
    record("EditorialBrief"),
    record("Storyboard"),
    record("VisualRecipe"),
    record("RenderSpec"),
    readFile(path.join(renderRoot, "render-manifest.json")).then(parse)
  ]);
  const captures = Object.fromEntries(await Promise.all(renderManifest.artifacts.map(async (artifact) => {
    const relativePath = artifact.contract.relativePath;
    return [artifact.contract.cardId, await fileIdentity(renderRoot, relativePath)];
  })));
  const sourceBytes = await readConfinedRepositoryFile(repositoryRoot, fixtureManifest.source.path);
  const assetMetadata = await Promise.all(fixtureManifest.assets.map(async (entry) =>
    parse(await readConfinedRepositoryFile(repositoryRoot, entry.metadataPath))
  ));
  const [target, theme, currentSourceRevision, latestSourceEditMs] = await Promise.all([
    readConfinedRepositoryFile(repositoryRoot, fixtureManifest.resources.target.path).then(parse),
    readConfinedRepositoryFile(repositoryRoot, fixtureManifest.resources.theme.path).then(parse),
    computeRendererSourceRevision(repositoryRoot),
    latestEvaluatedSourceEdit(repositoryRoot, fixtureManifest)
  ]);
  return {
    repositoryRoot,
    fixtureRoot,
    renderRoot,
    records: { source, editorial, storyboard, visualRecipe, renderSpec },
    target,
    theme,
    assetMetadata,
    sourceFile: { sha256: sha256(sourceBytes), size: sourceBytes.byteLength },
    requiredDependencyDigests: requiredDigests(fixtureManifest),
    latestSourceEditMs,
    currentSourceRevision,
    nowMs: Date.now(),
    score: undefined,
    verdicts: undefined,
    package: undefined,
    render: {
      manifest: renderManifest,
      captures,
      contactCapture: await fileIdentity(renderRoot, renderManifest.contactSheet.relativePath),
      networkRequests: [],
      runtime: { compromised: false }
    }
  };
};
