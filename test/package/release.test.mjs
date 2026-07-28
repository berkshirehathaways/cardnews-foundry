import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import {
  inspectReleaseEntries,
  resolveSourceInventory
} from "../../src/package/index.mjs";

const violationCases = [
  ["secret", "src/config.ts", `const value = '${["ghp", "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"].join("_")}';`, "RELEASE_SECRET"],
  ["environment", ".env.production", "SAFE=value", "RELEASE_PATH_PROHIBITED"],
  ["browser state", "browser/cookies.json", "[]", "RELEASE_PATH_PROHIBITED"],
  ["agent state", ".omo/evidence.json", "{}", "RELEASE_PATH_PROHIBITED"],
  ["raw article", ".cardnews/jobs/demo/source/raw/article.html", "<p>private</p>", "RELEASE_PATH_PROHIBITED"],
  [
    "benignly named full article snapshot",
    "snapshots/article.html",
    "<article><h1>Complete article</h1><p>This is a full real article body.</p></article>",
    "RELEASE_PRIVATE_SOURCE"
  ],
  ["production image", "assets/production.png", "png", "RELEASE_IMAGE_LICENSE"],
  ["absolute archive path", "/Users/private/output.txt", "private", "RELEASE_PATH_UNSAFE"],
  ["prohibited extension", "captures/session.har", "{}", "RELEASE_EXTENSION_PROHIBITED"]
];

for (const [name, entryPath, text, code] of violationCases) {
  test(`Given a seeded ${name} entry, When release inspection runs, Then class 6 rejects it`, () => {
    // Given
    const entries = [{ path: entryPath, bytes: Buffer.from(text) }];

    // When / Then
    assert.throws(
      () => inspectReleaseEntries(entries, { kind: "source" }),
      (error) => error.code === code && error.exitClass === 6
    );
  });
}

test("Given an unborn repository, When source inventory resolves, Then Git inventory mode includes unignored source and excludes local browser state", async (context) => {
  // Given
  const root = await mkdtemp(path.join(os.tmpdir(), "cardnews-release-unborn-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: root });
  await writeFile(path.join(root, ".gitignore"), ".openchrome/\n");
  await writeFile(path.join(root, "package.json"), "{}\n");
  await writeFile(path.join(root, "source.txt"), "source\n");
  await mkdir(path.join(root, ".openchrome"));
  await writeFile(path.join(root, ".openchrome", "state.json"), "{}\n");

  // When
  const inventory = await resolveSourceInventory(root);

  // Then
  assert.equal(inventory.mode, "source-inventory");
  assert.equal(inventory.paths.includes("package.json"), true);
  assert.equal(inventory.paths.some((entry) => entry.startsWith(".openchrome/")), false);
});

test("Given a repository with a HEAD, When source inventory resolves, Then tracked-file mode is authoritative", async (context) => {
  // Given
  const root = await mkdtemp(path.join(os.tmpdir(), "cardnews-release-git-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: root });
  await writeFile(path.join(root, "tracked.txt"), "tracked");
  execFileSync("git", ["add", "tracked.txt"], { cwd: root });
  execFileSync("git", [
    "-c", "user.name=Release Test", "-c", "user.email=release@example.invalid",
    "commit", "-qm", "fixture"
  ], { cwd: root });
  await writeFile(path.join(root, "untracked.txt"), "untracked");

  // When
  const inventory = await resolveSourceInventory(root);

  // Then
  assert.equal(inventory.mode, "tracked-files");
  assert.deepEqual(inventory.paths, ["tracked.txt"]);
});

test("Given fonts and synthetic images with explicit licenses and publication rights, When release inspection runs, Then clean entries pass", () => {
  // Given
  const entries = [
    { path: "fonts/LICENSE-OFL-1.1.txt", bytes: Buffer.from("SIL OPEN FONT LICENSE Version 1.1") },
    { path: "fonts/manifest.json", bytes: Buffer.from(JSON.stringify({
      license: { spdx: "OFL-1.1", file: "fonts/LICENSE-OFL-1.1.txt" },
      fonts: [{ file: "fonts/demo.otf" }]
    })) },
    { path: "fonts/demo.otf", bytes: Buffer.from([0, 1, 0, 0]) },
    { path: "fixtures/synthetic/assets/demo/asset.bin", bytes: Buffer.from([137, 80, 78, 71]) },
    { path: "fixtures/synthetic/assets/demo/metadata.json", bytes: Buffer.from(JSON.stringify({
      rights: "generated", publicEligible: true, publicPackageBlockers: []
    })) }
  ];

  // When
  const report = inspectReleaseEntries(entries, { kind: "source" });

  // Then
  assert.equal(report.ok, true);
  assert.equal(report.fontLicensesVerified, 1);
  assert.equal(report.imageRightsVerified, 1);
});
