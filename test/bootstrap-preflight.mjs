import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(repositoryRoot, "fonts", "manifest.json");

const runVerifier = (fontManifest, env = {}) => {
  const result = spawnSync(process.execPath, ["scripts/verify-bootstrap.mjs", "--font-manifest", fontManifest], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
  return { status: result.status, evidence: JSON.parse(result.stdout) };
};

test("Given pinned font metadata, When bootstrap preflight is inspected, Then the licensed files are present", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  await access(path.join(repositoryRoot, manifest.license.file));
  for (const font of manifest.fonts) {
    await access(path.join(repositoryRoot, font.file));
    assert.match(font.sha256, /^[a-f0-9]{64}$/u);
  }
});

test("Given an unlicensed font manifest, When bootstrap preflight runs, Then it rejects the exact license violation", () => {
  const fixturePath = path.join(repositoryRoot, "test", "fixtures", "unlicensed-font-manifest.json");
  const { status, evidence } = runVerifier(fixturePath);

  assert.notEqual(status, 0);
  assert.equal(evidence.ok, false);
  assert.deepEqual(evidence.rejections, [{ code: "FONT_LICENSE_NOT_ALLOWLISTED", message: "font license must be SPDX OFL-1.1" }]);
});

test("Given a stale font digest, When bootstrap preflight reruns, Then it rejects the changed digest", () => {
  const fixturePath = path.join(repositoryRoot, "test", "fixtures", "hash-mismatched-font-manifest.json");
  const { status, evidence } = runVerifier(fixturePath);

  assert.notEqual(status, 0);
  assert.equal(evidence.ok, false);
  assert.deepEqual(evidence.rejections, [{ code: "FONT_HASH_MISMATCH", message: "font hash does not match: fonts/NotoSansCJKkr-Regular.otf" }]);
});

test("Given an empty Playwright browser cache, When bootstrap preflight runs, Then it rejects missing Chromium", async (t) => {
  const browserPath = await mkdtemp(path.join(os.tmpdir(), "cardnews-empty-browser-"));
  t.after(() => rm(browserPath, { recursive: true, force: true }));

  const { status, evidence } = runVerifier(manifestPath, { PLAYWRIGHT_BROWSERS_PATH: browserPath });

  assert.notEqual(status, 0);
  assert.equal(evidence.ok, false);
  assert.equal(evidence.browser.status, "not-installed");
  assert.equal(evidence.rejections[0].code, "PLAYWRIGHT_CHROMIUM_NOT_INSTALLED");
});

test("Given a mismatched pnpm user agent, When bootstrap preflight runs, Then it rejects the runtime package-manager mismatch", () => {
  const { status, evidence } = runVerifier(manifestPath, {
    npm_config_user_agent: "pnpm/0.0.0 node/v24.18.0",
  });

  assert.notEqual(status, 0);
  assert.equal(evidence.ok, false);
  assert.equal(evidence.rejections[0].code, "PACKAGE_MANAGER_RUNTIME_MISMATCH");
  assert.equal(evidence.packageManager.actual, "pnpm@0.0.0");
});

test("Given a prohibited image in dist, When bootstrap preflight runs, Then it rejects the exact production artifact", async (t) => {
  const distPath = path.join(repositoryRoot, "dist");
  const probePath = path.join(distPath, "__bootstrap-probe.png");
  const distExisted = await access(distPath).then(() => true, () => false);
  await mkdir(distPath, { recursive: true });
  await writeFile(probePath, "bootstrap probe");
  t.after(async () => {
    await rm(probePath, { force: true });
    if (!distExisted) {
      await rm(distPath, { recursive: true, force: true });
    }
  });

  const { status, evidence } = runVerifier(manifestPath);

  assert.notEqual(status, 0);
  assert.equal(evidence.ok, false);
  assert.equal(evidence.rejections[0].code, "PRODUCTION_ARTIFACTS_FOUND");
  assert.deepEqual(evidence.productionArtifactScan.matches, [
    { path: "dist/__bootstrap-probe.png", reason: "production-artifact-extension" },
  ]);
});
