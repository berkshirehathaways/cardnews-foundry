import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, rmdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, validateContract, validateContractChain } from "../contracts/index.ts";
import type { JobHandle } from "../jobs/index.ts";
import { readAnchoredBytes, readAnchoredText } from "#jobs/anchored";
import { CliError } from "./errors.ts";
import { ownInterruptCleanup } from "./interruption.ts";
import { acceptedValue } from "./records.ts";
import { repositoryRoot } from "./job.ts";

type Descriptor = {
  readonly key: string;
  readonly path: string;
  readonly sha256: string;
  readonly byteCount: number;
};

type AssetDescriptor = Descriptor & {
  readonly id: string;
  readonly metadataKey: string;
  readonly metadataPath: string;
  readonly metadataSha256: string;
  readonly metadataByteCount: number;
};

export type PrivateProjection = {
  readonly root: string;
  readonly cleanup: () => Promise<void>;
};

const removeEmpty = async (target: string): Promise<void> => {
  try {
    await rmdir(target);
  } catch (error) {
    const code = error instanceof Error ? Reflect.get(error, "code") : undefined;
    if (code !== "ENOENT" && code !== "ENOTEMPTY") throw error;
  }
};

const cleanupProjection = async (root: string): Promise<void> => {
  await rm(root, { recursive: true, force: true });
  const projectionParent = path.dirname(root);
  await removeEmpty(projectionParent);
  await removeEmpty(path.dirname(projectionParent));
};

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const relative = (target: string): string =>
  path.relative(repositoryRoot, target).split(path.sep).join("/");

const descriptor = async (key: string, target: string): Promise<Descriptor> => {
  const bytes = await readFile(target);
  return { key, path: relative(target), sha256: sha256(bytes), byteCount: bytes.byteLength };
};

const writeCanonical = async (target: string, value: unknown): Promise<Descriptor> => {
  await writeFile(target, canonicalJson(value), { encoding: "utf8", flag: "wx", mode: 0o600 });
  return descriptor("", target);
};

const resourceDescriptors = async (targetId: string, themeId: string) => {
  const target = await descriptor("resource:target", path.join(repositoryRoot, "targets", `${targetId}.json`));
  const theme = await descriptor("resource:theme", path.join(repositoryRoot, "themes", `${themeId}.json`));
  const fontManifest = await descriptor("resource:font-manifest", path.join(repositoryRoot, "fonts", "manifest.json"));
  const fonts = [
    await descriptor("font:regular", path.join(repositoryRoot, "fonts", "NotoSansCJKkr-Regular.otf")),
    await descriptor("font:bold", path.join(repositoryRoot, "fonts", "NotoSansCJKkr-Bold.otf"))
  ];
  return { target, theme, fontManifest, fonts };
};

const assetDescriptors = async (
  job: JobHandle,
  projectionRoot: string,
  recipe: unknown
): Promise<readonly AssetDescriptor[]> => {
  if (typeof recipe !== "object" || recipe === null || !("cards" in recipe) || !Array.isArray(recipe.cards)) {
    throw new CliError("render", "VISUAL_RECIPE_INVALID", "visual recipe is invalid");
  }
  const bindings = recipe.cards.flatMap((card) => {
    if (
      typeof card !== "object" || card === null ||
      !("assetBindings" in card) || !Array.isArray(card.assetBindings)
    ) return [];
    return card.assetBindings;
  });
  const assets: AssetDescriptor[] = [];
  for (const binding of bindings) {
    if (typeof binding !== "object" || binding === null || !("assetDigest" in binding)) continue;
    const digest = binding.assetDigest;
    if (typeof digest !== "string") continue;
    const sourceDirectory = path.join(job.path, "assets", digest);
    const names = await readdir(sourceDirectory).catch((error: unknown) => {
      if (error instanceof Error && Reflect.get(error, "code") === "ENOENT") {
        throw new CliError("render", "ASSET_MISSING", "a bound asset has not been imported");
      }
      throw error;
    });
    const assetName = names.find((name) => /^asset\.(?:png|jpg)$/u.test(name));
    if (assetName === undefined) throw new CliError("render", "ASSET_MISSING", "asset bytes are missing");
    const destination = path.join(projectionRoot, "assets", digest);
    await mkdir(destination, { recursive: true });
    const assetTarget = path.join(destination, "asset.bin");
    const metadataTarget = path.join(destination, "metadata.json");
    await copyFile(path.join(sourceDirectory, assetName), assetTarget);
    await copyFile(path.join(sourceDirectory, "metadata.json"), metadataTarget);
    const asset = await descriptor(`asset:${digest}`, assetTarget);
    const metadata = await descriptor(`asset-metadata:${digest}`, metadataTarget);
    assets.push({
      ...asset,
      id: digest,
      metadataKey: metadata.key,
      metadataPath: metadata.path,
      metadataSha256: metadata.sha256,
      metadataByteCount: metadata.byteCount
    });
  }
  return assets;
};

const dependency = (entry: Descriptor): { readonly key: string; readonly sha256: string } => ({
  key: entry.key,
  sha256: entry.sha256
});

export const createPrivateProjection = async (
  job: JobHandle,
  additionalCleanup?: () => Promise<void>
): Promise<PrivateProjection> => {
  const root = path.join(
    repositoryRoot,
    ".cardnews",
    "private-cli-fixtures",
    `${job.id}-${randomUUID()}`
  );
  const cleanup = ownInterruptCleanup(async () => {
    await additionalCleanup?.();
    await cleanupProjection(root);
  });
  try {
    await mkdir(path.join(root, "records"), { recursive: true });
    await mkdir(path.join(root, "assets"), { recursive: true });
    const [source, editorial, storyboard, recipe, spec] = await Promise.all([
      acceptedValue(job, "source"),
      acceptedValue(job, "brief"),
      acceptedValue(job, "storyboard"),
      acceptedValue(job, "recipe"),
      acceptedValue(job, "render")
    ]);
    const sourceResult = validateContract("SourceEnvelope", source);
    const editorialResult = validateContract("EditorialBrief", editorial);
    const storyboardResult = validateContract("Storyboard", storyboard);
    if (!sourceResult.ok || !editorialResult.ok || !storyboardResult.ok) {
      throw new CliError("render", "RECORD_CHAIN_INVALID", "record chain is invalid");
    }
    const chainIssues = validateContractChain({
      SourceEnvelope: sourceResult.value,
      EditorialBrief: editorialResult.value,
      Storyboard: storyboardResult.value
    });
    if (chainIssues.length !== 0) {
      throw new CliError("render", "RECORD_CHAIN_INVALID", "record chain is invalid");
    }
    if (
      typeof recipe !== "object" || recipe === null ||
      !("targetId" in recipe) || typeof recipe.targetId !== "string" ||
      !("themeId" in recipe) || typeof recipe.themeId !== "string"
    ) {
      throw new CliError("render", "VISUAL_RECIPE_INVALID", "visual recipe is invalid");
    }
    const evidence: unknown = JSON.parse(await readAnchoredText(job, "source", "evidence.json"));
    if (
      typeof evidence !== "object" || evidence === null ||
      !("rawPath" in evidence) || typeof evidence.rawPath !== "string"
    ) {
      throw new CliError("render", "SOURCE_EVIDENCE_MISSING", "source evidence is missing");
    }
    const rawMatch = /^source\/raw\/([a-f0-9]{64})\.bin$/u.exec(evidence.rawPath);
    if (rawMatch === null) {
      throw new CliError("security", "SOURCE_EVIDENCE_INVALID", "source evidence path is invalid");
    }
    const sourceTarget = path.join(root, "source.bin");
    await writeFile(
      sourceTarget,
      await readAnchoredBytes(job, "source/raw", `${rawMatch[1]}.bin`),
      { flag: "wx", mode: 0o400 }
    );
    const sourceEntry = await descriptor("source:article", sourceTarget);
    const values = [
      ["SourceEnvelope", source],
      ["EditorialBrief", editorial],
      ["Storyboard", storyboard],
      ["VisualRecipe", recipe],
      ["RenderSpec", spec]
    ] as const;
    const records: Descriptor[] = [];
    for (const [name, value] of values) {
      const target = path.join(root, "records", `${name}.json`);
      const written = await writeCanonical(target, value);
      records.push({ ...written, key: `record:${name}` });
    }
    const resources = await resourceDescriptors(recipe.targetId, recipe.themeId);
    const assets = await assetDescriptors(job, root, recipe);
    const byKey = new Map(records.map((entry) => [entry.key, entry]));
    const assetDependencies = assets.flatMap((entry) => [
      dependency(entry),
      { key: entry.metadataKey, sha256: entry.metadataSha256 }
    ]);
    const recordManifest = records.map((entry, index) => {
      const stage = values[index]?.[0];
      if (stage === undefined) throw new CliError("internal", "INTERNAL_ERROR", "record projection failed");
      const previous = records.slice(0, index).map(dependency);
      const dependencies = stage === "SourceEnvelope"
        ? [dependency(sourceEntry)]
        : stage === "EditorialBrief" || stage === "Storyboard"
          ? previous
          : stage === "VisualRecipe"
            ? [
                ...previous,
                dependency(resources.target),
                dependency(resources.theme),
                ...assetDependencies
              ]
            : [
                ...previous,
                dependency(resources.target),
                dependency(resources.theme),
                dependency(resources.fontManifest),
                ...resources.fonts.map(dependency),
                ...assetDependencies
              ];
      return { ...entry, stage, dependencies };
    });
    if (byKey.size !== 5) throw new CliError("internal", "INTERNAL_ERROR", "record projection failed");
    const manifest = {
      schemaVersion: 1,
      fixtureId: job.id,
      source: sourceEntry,
      records: recordManifest,
      assets,
      resources
    };
    const manifestPath = path.join(root, "manifest.json");
    await writeFile(manifestPath, canonicalJson(manifest), { encoding: "utf8", flag: "wx", mode: 0o600 });
    const epoch = new Date(0);
    for (const file of [
      manifestPath,
      sourceTarget,
      ...records.map((entry) => path.join(repositoryRoot, entry.path)),
      ...assets.flatMap((entry) => [
        path.join(repositoryRoot, entry.path),
        path.join(repositoryRoot, entry.metadataPath)
      ])
    ]) {
      await utimes(file, epoch, epoch);
    }
    return { root, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
};
