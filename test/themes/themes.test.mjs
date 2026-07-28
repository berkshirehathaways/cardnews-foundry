import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const targetPath = path.join(root, "targets", "portrait-social-1080x1350.json");
const themePaths = [
  path.join(root, "themes", "ink-paper.json"),
  path.join(root, "themes", "signal-night.json")
];

const load = async (options = {}) => {
  const themes = await import("../../src/themes/index.mjs");
  return themes.loadThemeSystem({ targetPath, themePaths, ...options });
};

const copyThemeFixture = async (context) => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "cardnews-themes-"));
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  await Promise.all([
    cp(path.join(root, "targets"), path.join(fixtureRoot, "targets"), { recursive: true }),
    cp(path.join(root, "themes"), path.join(fixtureRoot, "themes"), { recursive: true })
  ]);
  return fixtureRoot;
};

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));

test("Given Todo 6 schemas are absent, When their public files are checked, Then the target and theme contracts are required", async () => {
  // Given
  const schemaPaths = [
    path.join(root, "schemas", "target-profile.schema.json"),
    path.join(root, "schemas", "theme-pack.schema.json")
  ];

  // When
  const schemas = await Promise.all(schemaPaths.map(readJson));

  // Then
  assert.deepEqual(schemas.map((schema) => schema.$schema), [
    "https://json-schema.org/draft/2020-12/schema",
    "https://json-schema.org/draft/2020-12/schema"
  ]);
});

test("Given no theme loader exists, When target and theme files are loaded, Then the public loader validates them", async () => {
  // Given / When
  const result = await load();

  // Then
  assert.equal(result.themes.length, 2);
});

test("Given approved target and theme packs, When the loader parses them, Then independent target and theme versions are accepted", async () => {
  // Given / When
  const result = await load();

  // Then
  assert.deepEqual(
    {
      targetVersion: result.target.schemaVersion,
      themeVersions: result.themes.map((theme) => theme.schemaVersion),
      targetId: result.target.targetId
    },
    {
      targetVersion: "1.0.0",
      themeVersions: ["2.0.0", "2.0.0"],
      targetId: "portrait-social-1080x1350"
    }
  );
});

test("Given the portrait target, When safe areas and card range are loaded, Then their arithmetic and practical range are enforced", async () => {
  // Given / When
  const { target } = await load();

  // Then
  assert.deepEqual(target.dimensions, { width: 1080, height: 1350 });
  assert.deepEqual(target.output, { codec: "png", mimeType: "image/png", colorSpace: "srgb", alpha: "opaque" });
  assert.deepEqual(target.safeArea.content, { width: 888, height: 1110 });
  assert.deepEqual(target.cardCount, { minimum: 3, maximum: 10, rationale: "Three cards preserve a hook, context, and close; ten caps swipe fatigue while allowing evidence-led stories." });
});

test("Given two reusable theme packs, When the loader parses semantic primitives, Then each pack has complete tokens and distinct visual systems", async () => {
  // Given / When
  const { themes } = await load();

  // Then
  assert.deepEqual(themes.map((theme) => theme.themeId), ["ink-paper", "signal-night"]);
  assert.equal(themes.every((theme) => Object.keys(theme.tokens.colors).length >= 6), true);
  assert.equal(themes.every((theme) => Object.keys(theme.tokens.typography).length === 4), true);
  assert.equal(themes.every((theme) => theme.tokens.spacing.length >= 5), true);
  assert.notDeepEqual(themes[0]?.tokens.colors, themes[1]?.tokens.colors);
  assert.notDeepEqual(themes[0]?.layoutVariants, themes[1]?.layoutVariants);
});

test("Given a theme with an unsafe area, When the loader parses it, Then it rejects the incompatible safe-area arithmetic", async (context) => {
  // Given
  const fixtureRoot = await copyThemeFixture(context);
  const unsafeTargetPath = path.join(fixtureRoot, "targets", "portrait-social-1080x1350.json");
  const target = await readJson(unsafeTargetPath);
  target.safeArea.content.width += 1;
  await writeFile(unsafeTargetPath, `${JSON.stringify(target)}\n`, "utf8");

  // When
  const rejected = () => load({ targetPath: unsafeTargetPath });

  // Then
  await assert.rejects(rejected, (error) => error.code === "SAFE_AREA_ARITHMETIC");
});

test("Given a target with an incompatible card range, When the loader parses it, Then it rejects that range", async (context) => {
  // Given
  const fixtureRoot = await copyThemeFixture(context);
  const incompatibleTargetPath = path.join(fixtureRoot, "targets", "portrait-social-1080x1350.json");
  const target = await readJson(incompatibleTargetPath);
  target.cardCount.maximum = 2;
  await writeFile(incompatibleTargetPath, `${JSON.stringify(target)}\n`, "utf8");

  // When
  const rejected = () => load({ targetPath: incompatibleTargetPath });

  // Then
  await assert.rejects(rejected, (error) => error.code === "CARD_COUNT_RANGE");
});

test("Given a target with incompatible contract fields, When the loader parses it, Then strict validation rejects it", async (context) => {
  // Given
  const fixtureRoot = await copyThemeFixture(context);
  const incompatibleTargetPath = path.join(fixtureRoot, "targets", "portrait-social-1080x1350.json");
  const baseline = await readJson(incompatibleTargetPath);
  const mutations = [
    (target) => { delete target.output; },
    (target) => { target.output.codec = "jpeg"; target.output.mimeType = "image/jpeg"; },
    (target) => { target.output.colorSpace = "display-p3"; target.output.alpha = "premultiplied"; },
    (target) => { target.output.metadataPolicy = "preserve"; }
  ];

  // When
  const rejected = async () => {
    for (const mutate of mutations) {
      const target = structuredClone(baseline);
      mutate(target);
      await writeFile(incompatibleTargetPath, `${JSON.stringify(target)}\n`, "utf8");
      await assert.rejects(() => load({ targetPath: incompatibleTargetPath }), (error) => error.code === "TARGET_SCHEMA_INVALID");
    }
  };

  // Then
  await rejected();
});

test("Given a theme with a missing semantic token, When the loader parses it, Then strict validation rejects it", async (context) => {
  // Given
  const fixtureRoot = await copyThemeFixture(context);
  const missingTokenPath = path.join(fixtureRoot, "themes", "ink-paper.json");
  const theme = await readJson(missingTokenPath);
  delete theme.tokens.colors.accent;
  await writeFile(missingTokenPath, `${JSON.stringify(theme)}\n`, "utf8");

  // When
  const rejected = () => load({ themePaths: [missingTokenPath, themePaths[1]] });

  // Then
  await assert.rejects(rejected, (error) => error.code === "THEME_SCHEMA_INVALID");
});

test("Given a theme with a missing approved font, When the loader parses it, Then it rejects the unresolved manifest entry", async (context) => {
  // Given
  const fixtureRoot = await copyThemeFixture(context);
  const missingFontPath = path.join(fixtureRoot, "themes", "ink-paper.json");
  const theme = await readJson(missingFontPath);
  theme.tokens.typography.display.font.weight = "Black";
  await writeFile(missingFontPath, `${JSON.stringify(theme)}\n`, "utf8");

  // When
  const rejected = () => load({ themePaths: [missingFontPath, themePaths[1]] });

  // Then
  await assert.rejects(rejected, (error) => error.code === "FONT_NOT_APPROVED");
});

test("Given a theme with a remote asset URL, When the loader parses it, Then it rejects the reference before theme use", async (context) => {
  // Given
  const fixtureRoot = await copyThemeFixture(context);
  const remoteThemePath = path.join(fixtureRoot, "themes", "ink-paper.json");
  const theme = await readJson(remoteThemePath);
  theme.assets = { sourcePolicy: "local-none", logo: "https://cdn.example.test/logo.svg" };
  await writeFile(remoteThemePath, `${JSON.stringify(theme)}\n`, "utf8");

  // When
  const rejected = () => load({ themePaths: [remoteThemePath, themePaths[1]] });

  // Then
  await assert.rejects(rejected, (error) => error.code === "REMOTE_REFERENCE");
});

test("Given a theme with a hidden per-card override, When the loader parses it, Then strict schema validation rejects it", async (context) => {
  // Given
  const fixtureRoot = await copyThemeFixture(context);
  const overrideThemePath = path.join(fixtureRoot, "themes", "ink-paper.json");
  const theme = await readJson(overrideThemePath);
  theme.cards = [{ id: "card-1", css: "color: red" }];
  await writeFile(overrideThemePath, `${JSON.stringify(theme)}\n`, "utf8");

  // When
  const rejected = () => load({ themePaths: [overrideThemePath, themePaths[1]] });

  // Then
  await assert.rejects(rejected, (error) => error.code === "THEME_SCHEMA_INVALID");
});

test("Given a target or theme version mismatch, When the loader parses it, Then each incompatible version is rejected independently", async (context) => {
  // Given
  const fixtureRoot = await copyThemeFixture(context);
  const incompatibleTargetPath = path.join(fixtureRoot, "targets", "portrait-social-1080x1350.json");
  const target = await readJson(incompatibleTargetPath);
  target.schemaVersion = "2.0.0";
  await writeFile(incompatibleTargetPath, `${JSON.stringify(target)}\n`, "utf8");
  const incompatibleThemePath = path.join(fixtureRoot, "themes", "ink-paper.json");
  const theme = await readJson(incompatibleThemePath);
  theme.schemaVersion = "1.0.0";
  await writeFile(incompatibleThemePath, `${JSON.stringify(theme)}\n`, "utf8");

  // When
  const targetRejected = () => load({ targetPath: incompatibleTargetPath });
  const themeRejected = () => load({ themePaths: [incompatibleThemePath, themePaths[1]] });

  // Then
  await assert.rejects(targetRejected, (error) => error.code === "TARGET_SCHEMA_INVALID");
  await assert.rejects(themeRejected, (error) => error.code === "THEME_SCHEMA_INVALID");
});

test("Given a changed target payload, When target and theme versions stay independent, Then the target digest changes without changing theme versions", async (context) => {
  // Given
  const fixtureRoot = await copyThemeFixture(context);
  const changedTargetPath = path.join(fixtureRoot, "targets", "portrait-social-1080x1350.json");
  const target = await readJson(changedTargetPath);
  target.safeArea.documentation = `${target.safeArea.documentation} Revised.`;
  await writeFile(changedTargetPath, `${JSON.stringify(target)}\n`, "utf8");
  const baseline = await load();

  // When
  const changed = await load({ targetPath: changedTargetPath });

  // Then
  assert.notEqual(changed.digests.target, baseline.digests.target);
  assert.deepEqual(changed.themes.map((theme) => theme.schemaVersion), baseline.themes.map((theme) => theme.schemaVersion));
});

test("Given the machine verifier, When it runs twice, Then it emits deterministic JSON coverage for target, themes, and fonts", async () => {
  // Given
  const command = path.join(root, "scripts", "verify-themes.mjs");

  // When
  const [first, second] = await Promise.all([
    execFileAsync(process.execPath, [command], { cwd: root, encoding: "utf8" }),
    execFileAsync(process.execPath, [command], { cwd: root, encoding: "utf8" })
  ]);
  const firstSummary = JSON.parse(first.stdout);
  const secondSummary = JSON.parse(second.stdout);

  // Then
  assert.deepEqual(firstSummary, secondSummary);
  assert.deepEqual(
    { ok: firstSummary.ok, themes: firstSummary.counts.themes, dimensions: firstSummary.target.dimensions },
    { ok: true, themes: 2, dimensions: { width: 1080, height: 1350 } }
  );
});
