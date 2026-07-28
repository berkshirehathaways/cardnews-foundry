import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { renderFixture } from "./index.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const filesBelow = async (root, relative = "") => {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(root, child));
    else if (entry.isFile()) files.push(child.split(path.sep).join("/"));
  }
  return files;
};
const hashSet = async (root) => {
  const files = await filesBelow(root);
  return Promise.all(files.map(async (relativePath) => ({
    relativePath,
    byteCount: (await readFile(path.join(root, relativePath))).byteLength,
    sha256: sha256(await readFile(path.join(root, relativePath)))
  })));
};

export const verifyDeterminism = async ({ repositoryRoot, fixtureRoot, outputParent }) => {
  const firstRoot = path.join(outputParent, "canonical-run-a");
  const secondRoot = path.join(outputParent, "canonical-run-b");
  const firstRender = await renderFixture({ repositoryRoot, fixtureRoot, outputRoot: firstRoot });
  const secondRender = await renderFixture({ repositoryRoot, fixtureRoot, outputRoot: secondRoot });
  const [firstHashes, secondHashes] = await Promise.all([hashSet(firstRoot), hashSet(secondRoot)]);
  const equal = JSON.stringify(firstHashes) === JSON.stringify(secondHashes);
  return {
    schemaVersion: 1,
    equal,
    first: { outputRoot: firstRoot, hashes: firstHashes },
    second: { outputRoot: secondRoot, hashes: secondHashes },
    canonicalRenderProfile: firstRender.canonicalRenderProfile,
    canonicalProfileEqual: JSON.stringify(firstRender.canonicalRenderProfile) === JSON.stringify(secondRender.canonicalRenderProfile),
    nativeEnvironment: firstRender.nativeEnvironment,
    nativeEnvironmentEqual: JSON.stringify(firstRender.nativeEnvironment) === JSON.stringify(secondRender.nativeEnvironment),
    crossOsByteIdentity: "deferred-to-t14-ci"
  };
};
