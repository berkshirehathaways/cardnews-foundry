import Ajv2020 from "ajv/dist/2020.js";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { parseArgs } from "node:util";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const execFile = promisify(execFileCallback);
const expectedFontWeights = new Set(["Regular", "Bold"]);
const ignoredDirectories = new Set([".git", "node_modules"]);
const prohibitedDirectories = new Set([".cardnews", ".omo", ".omx", "playwright-report", "test-results"]);
const prohibitedExtensions = new Set([".zip", ".png", ".jpg", ".jpeg", ".webp"]);
const expectedPackageManager = "pnpm@11.15.1";

class VerificationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const relativePath = (absolutePath) => path.relative(repositoryRoot, absolutePath).split(path.sep).join("/");

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));

const checkDigest = async (root, entry) => {
  const filePath = path.resolve(root, entry.file);
  if (!filePath.startsWith(`${root}${path.sep}`)) {
    throw new VerificationError("FONT_PATH_ESCAPE", `font path escapes its root: ${entry.file}`);
  }

  if (!existsSync(filePath)) {
    throw new VerificationError("FONT_MISSING", `font file is missing: ${entry.file}`);
  }

  const actual = sha256(await readFile(filePath));
  if (actual !== entry.sha256) {
    throw new VerificationError("FONT_HASH_MISMATCH", `font hash does not match: ${entry.file}`);
  }

  return { file: entry.file, sha256: actual, status: "verified" };
};

const validateFontManifest = async (manifestPath) => {
  const schema = await readJson(path.join(repositoryRoot, "schemas", "font-manifest.schema.json"));
  const manifest = await readJson(manifestPath);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);

  if (!validate(manifest)) {
    throw new VerificationError("FONT_MANIFEST_INVALID", JSON.stringify(validate.errors));
  }

  if (!manifest.sourceArchive.url.startsWith("https://github.com/notofonts/noto-cjk/releases/download/")) {
    throw new VerificationError("FONT_SOURCE_NOT_OFFICIAL", "font archive must be a notofonts/noto-cjk release asset");
  }
  if (manifest.license.spdx !== "OFL-1.1") {
    throw new VerificationError("FONT_LICENSE_NOT_ALLOWLISTED", "font license must be SPDX OFL-1.1");
  }

  const weights = new Set(manifest.fonts.map((font) => font.weight));
  if (weights.size !== expectedFontWeights.size || [...weights].some((weight) => !expectedFontWeights.has(weight))) {
    throw new VerificationError("FONT_SET_INVALID", "font manifest must contain exactly Noto Sans CJK KR Regular and Bold");
  }

  return manifest;
};

const scanProductionArtifacts = async () => {
  const matches = [];
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const rel = relativePath(absolutePath);
      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) {
          continue;
        }
        if (prohibitedDirectories.has(entry.name)) {
          matches.push({ path: rel, reason: "private-or-generated-directory" });
          continue;
        }
        await visit(absolutePath);
        continue;
      }
      if (entry.isSymbolicLink()) {
        matches.push({ path: rel, reason: "symlink-not-allowed-in-bootstrap" });
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (prohibitedExtensions.has(path.extname(entry.name).toLowerCase())) {
        matches.push({ path: rel, reason: "production-artifact-extension" });
      }
    }
  };

  await visit(repositoryRoot);
  return { matches, status: matches.length === 0 ? "clear" : "blocked" };
};

const verifyPackageManager = async () => {
  const packageJson = await readJson(path.join(repositoryRoot, "package.json"));
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
  const userAgent = process.env.npm_config_user_agent;
  let actualPackageManager = null;
  if (userAgent !== undefined) {
    const match = /^pnpm\/([^\s]+)/u.exec(userAgent);
    actualPackageManager = match === null ? "unknown" : `pnpm@${match[1]}`;
  } else {
    try {
      const { stdout } = await execFile("corepack", ["pnpm", "--version"], {
        cwd: repositoryRoot,
        encoding: "utf8",
        maxBuffer: 1024,
        timeout: 5000
      });
      actualPackageManager = `pnpm@${stdout.trim()}`;
    } catch {
      actualPackageManager = "unavailable";
    }
  }
  const packageManagerStatus = packageJson.packageManager === expectedPackageManager && actualPackageManager === expectedPackageManager
    ? "verified"
    : "mismatch";
  const nodeStatus = nodeMajor === 24 ? "verified" : "mismatch";
  return {
    node: { actual: process.version, expectedMajor: 24, status: nodeStatus },
    packageManager: { declared: packageJson.packageManager, actual: actualPackageManager, expected: expectedPackageManager, status: packageManagerStatus }
  };
};

const verifyBrowser = async (toolchain) => {
  const playwrightPackagePath = require.resolve("playwright/package.json");
  const playwrightPackage = await readJson(playwrightPackagePath);
  const browsers = await readJson(path.join(path.dirname(playwrightPackagePath), "..", "playwright-core", "browsers.json"));
  const chromium = browsers.browsers.find((browser) => browser.name === "chromium");
  if (chromium === undefined) {
    throw new VerificationError("CHROMIUM_METADATA_MISSING", "Playwright does not declare Chromium metadata");
  }
  if (playwrightPackage.version !== toolchain.playwrightVersion) {
    throw new VerificationError("PLAYWRIGHT_VERSION_MISMATCH", "installed Playwright does not match toolchain metadata");
  }
  if (chromium.revision !== toolchain.chromiumRevision) {
    throw new VerificationError("CHROMIUM_REVISION_MISMATCH", "Playwright Chromium revision does not match toolchain metadata");
  }

  const { chromium: playwrightChromium } = await import("playwright");
  return {
    playwrightVersion: playwrightPackage.version,
    chromiumRevision: chromium.revision,
    status: existsSync(playwrightChromium.executablePath()) ? "installed" : "not-installed"
  };
};

const verifyFonts = async (manifestPath) => {
  const manifest = await validateFontManifest(manifestPath);
  const license = await checkDigest(repositoryRoot, manifest.license);
  const licenseText = await readFile(path.join(repositoryRoot, manifest.license.file), "utf8");
  if (!licenseText.includes("SIL OPEN FONT LICENSE Version 1.1")) {
    throw new VerificationError("FONT_LICENSE_TEXT_INVALID", "font license is not SIL Open Font License 1.1");
  }
  const fonts = await Promise.all(manifest.fonts.map((font) => checkDigest(repositoryRoot, font)));
  return {
    sourceArchive: manifest.sourceArchive,
    license: { ...license, spdx: manifest.license.spdx },
    fonts,
    status: "verified"
  };
};

const verify = async (options) => {
  const result = {
    schemaVersion: 1,
    ok: false,
    node: null,
    packageManager: null,
    browser: null,
    fonts: null,
    productionArtifactScan: null,
    rejections: []
  };

  try {
    const manifestPath = path.resolve(options.fontManifest ?? path.join(repositoryRoot, "fonts", "manifest.json"));
    const [packageManager, toolchain, fonts, productionArtifactScan] = await Promise.all([
      verifyPackageManager(),
      readJson(path.join(repositoryRoot, "toolchain.json")),
      verifyFonts(manifestPath),
      scanProductionArtifacts()
    ]);
    result.node = packageManager.node;
    result.packageManager = packageManager.packageManager;
    result.fonts = fonts;
    result.productionArtifactScan = productionArtifactScan;
    result.browser = options.only === "fonts" ? { status: "not-checked" } : await verifyBrowser(toolchain);
    if (result.node.status !== "verified") {
      throw new VerificationError("TOOLCHAIN_VERSION_MISMATCH", "Node version does not match the pin");
    }
    if (result.packageManager.status !== "verified") {
      throw new VerificationError("PACKAGE_MANAGER_RUNTIME_MISMATCH", "package manager runtime does not match the exact packageManager pin");
    }
    if (productionArtifactScan.status !== "clear") {
      throw new VerificationError("PRODUCTION_ARTIFACTS_FOUND", "repository contains prohibited production artifacts");
    }
    if (result.browser?.status === "not-installed") {
      throw new VerificationError("PLAYWRIGHT_CHROMIUM_NOT_INSTALLED", "Playwright Chromium executable is not installed");
    }
    result.ok = true;
  } catch (error) {
    if (error instanceof VerificationError) {
      result.rejections.push({ code: error.code, message: error.message });
    } else if (error instanceof Error) {
      result.rejections.push({ code: "UNEXPECTED", message: error.message });
    } else {
      result.rejections.push({ code: "UNEXPECTED", message: "unknown verification failure" });
    }
  }
  return result;
};

const main = async () => {
  const { values } = parseArgs({
    options: {
      "font-manifest": { type: "string" },
      only: { type: "string" }
    },
    strict: true
  });
  if (values.only !== undefined && values.only !== "fonts") {
    throw new VerificationError("INVALID_ARGUMENT", "--only supports only fonts");
  }
  const result = await verify({ fontManifest: values["font-manifest"], only: values.only });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 1;
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown command failure";
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ok: false, rejections: [{ code: "COMMAND_FAILURE", message }] })}\n`);
  process.exitCode = 1;
});
