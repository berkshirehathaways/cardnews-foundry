#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDeterministicZip,
  inspectGeneratedBundle,
  inspectReleaseEntries,
  inspectZip,
  readSourceInventory
} from "../src/package/index.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const rejected = async (name, action) => {
  try {
    await action();
    return { name, rejected: false, exitClass: 0, code: "NOT_REJECTED" };
  } catch (error) {
    return {
      name,
      rejected: error instanceof Error,
      exitClass: error instanceof Error ? Reflect.get(error, "exitClass") : undefined,
      code: error instanceof Error ? Reflect.get(error, "code") : undefined
    };
  }
};

const patchSpecialNode = (archive) => {
  const bytes = Buffer.from(archive);
  for (let offset = 0; offset + 46 <= bytes.length; offset += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) continue;
    bytes.writeUInt32LE((0o120777 * 0x10000) >>> 0, offset + 38);
    return bytes;
  }
  throw new TypeError("seed archive has no central entry");
};

const seedViolations = async () => {
  const direct = [
    ["secret", "src/config.ts", Buffer.from(
      `const token = '${["ghp", "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"].join("_")}';`
    )],
    ["absolute-path", "/Users/private/file.txt", Buffer.from("private")],
    ["environment", ".env.production", Buffer.from("VALUE=unsafe")],
    ["browser-state", "browser/cookies.json", Buffer.from("{}")],
    ["agent-state", ".omx/state.json", Buffer.from("{}")],
    ["private-source", ".cardnews/jobs/demo/source/raw/article.html", Buffer.from("private")],
    ["full-article-snapshot", "snapshots/article.html", Buffer.from("<article>full article body</article>")],
    ["prohibited-extension", "session.har", Buffer.from("{}")]
  ];
  const results = await Promise.all(direct.map(([name, entryPath, bytes]) =>
    rejected(name, () => inspectReleaseEntries([{ path: entryPath, bytes }], { kind: "source" }))
  ));
  results.push(await rejected("font-license", () => inspectReleaseEntries([
    { path: "fonts/unlicensed.otf", bytes: Buffer.from([0, 1, 0, 0]) }
  ], { kind: "source" })));
  results.push(await rejected("image-rights", () => inspectReleaseEntries([
    {
      path: "fixtures/synthetic/assets/demo/asset.bin",
      bytes: Buffer.from([137, 80, 78, 71])
    },
    {
      path: "fixtures/synthetic/assets/demo/metadata.json",
      bytes: Buffer.from(JSON.stringify({
        rights: "unknown",
        publicEligible: false,
        publicPackageBlockers: ["rights"]
      }))
    }
  ], { kind: "source" })));
  const bomb = await createDeterministicZip([
    { path: "metadata/source-summary.json", bytes: Buffer.alloc(1024 * 1024, 0x20) }
  ]);
  results.push(await rejected("zip-bomb", () => inspectZip(bomb, { maxCompressionRatio: 10 })));
  const regular = await createDeterministicZip([
    { path: "metadata/source-summary.json", bytes: Buffer.from("{}") }
  ]);
  results.push(await rejected("special-node", () => inspectZip(patchSpecialNode(regular))));
  const privateSource = await createDeterministicZip([
    { path: "source/raw/article.html", bytes: Buffer.from("private") }
  ]);
  results.push(await rejected("generated-private-source", () =>
    inspectGeneratedBundle(privateSource)
  ));
  return results;
};

const dryRun = async (packagePath, archiveOutput) => {
  const inventory = await readSourceInventory(repositoryRoot);
  const source = inspectReleaseEntries(inventory.entries, { kind: "source" });
  const archiveBytes = await createDeterministicZip(inventory.entries);
  const extracted = inspectZip(archiveBytes);
  const sourceArchive = {
    ...inspectReleaseEntries(extracted.entries, { kind: "source-archive" }),
    sha256: sha256(archiveBytes),
    bytes: archiveBytes.length,
    executablePaths: extracted.entries
      .filter((entry) => (entry.mode & 0o111) !== 0)
      .map((entry) => entry.path)
  };
  if (archiveOutput !== undefined) await writeFile(path.resolve(archiveOutput), archiveBytes);
  const generatedPackage = packagePath === undefined
    ? undefined
    : inspectGeneratedBundle(await readFile(path.resolve(packagePath)));
  return {
    ok: true,
    inventory: { mode: inventory.mode, count: inventory.paths.length },
    source,
    sourceArchive,
    ...(generatedPackage === undefined
      ? {}
      : { generatedPackage: { ok: true, paths: generatedPackage.paths } })
  };
};

const args = process.argv.slice(2).filter((value) => value !== "--");
const packageIndex = args.indexOf("--package");
const packagePath = packageIndex === -1 ? undefined : args[packageIndex + 1];
const archiveIndex = args.indexOf("--archive-output");
const archiveOutput = archiveIndex === -1 ? undefined : args[archiveIndex + 1];

try {
  if (args.includes("--seed-violations")) {
    const seeded = await seedViolations();
    if (seeded.some((entry) => !entry.rejected || entry.exitClass !== 6)) {
      process.stdout.write(`${JSON.stringify({ ok: false, seeded })}\n`);
      process.exitCode = 6;
    } else {
      process.stdout.write(`${JSON.stringify({ ok: true, seeded })}\n`);
    }
  } else if (args.includes("--dry-run")) {
    process.stdout.write(`${JSON.stringify(await dryRun(packagePath, archiveOutput))}\n`);
  } else {
    process.stderr.write("usage: verify-release.mjs --dry-run [--package <zip>] | --seed-violations\n");
    process.exitCode = 2;
  }
} catch (error) {
  const code = error instanceof Error ? Reflect.get(error, "code") : "RELEASE_INTERNAL";
  process.stderr.write(`${JSON.stringify({ ok: false, error: { code } })}\n`);
  process.exitCode = error instanceof Error && Reflect.get(error, "exitClass") === 6 ? 6 : 1;
}
