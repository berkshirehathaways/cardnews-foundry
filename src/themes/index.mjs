import Ajv2020 from "ajv/dist/2020.js";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const targetSchemaPath = path.join(root, "schemas", "target-profile.schema.json");
const themeSchemaPath = path.join(root, "schemas", "theme-pack.schema.json");
const fontManifestPath = path.join(root, "fonts", "manifest.json");
const fontManifestSchemaPath = path.join(root, "schemas", "font-manifest.schema.json");
const remoteReference = /^(?:https?:|\/\/|data:|file:)/iu;

export class ThemeValidationError extends Error {
  constructor(code, details) {
    super(code);
    this.name = "ThemeValidationError";
    this.code = code;
    this.details = details;
  }
}

const parseJson = (filePath, code) => {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown JSON read failure";
    throw new ThemeValidationError(code, { filePath, message });
  }
};

const schemaValidator = (schemaPath) => new Ajv2020({ allErrors: true, strict: true }).compile(parseJson(schemaPath, "SCHEMA_UNREADABLE"));

const validateSchema = (validator, value, code, filePath) => {
  if (!validator(value)) throw new ThemeValidationError(code, { filePath, issues: validator.errors ?? [] });
};

const scanReferences = (value, location = "$") => {
  if (typeof value === "string") {
    if (remoteReference.test(value)) throw new ThemeValidationError("REMOTE_REFERENCE", { location, value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanReferences(item, `${location}[${index}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) scanReferences(entry, `${location}.${key}`);
  }
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const schemaMajor = (version) => Number.parseInt(version.split(".")[0], 10);

const validateTarget = (target) => {
  const { dimensions, safeArea, cardCount } = target;
  const expectedWidth = dimensions.width - safeArea.insets.left - safeArea.insets.right;
  const expectedHeight = dimensions.height - safeArea.insets.top - safeArea.insets.bottom;
  if (safeArea.content.width !== expectedWidth || safeArea.content.height !== expectedHeight) {
    throw new ThemeValidationError("SAFE_AREA_ARITHMETIC", { expectedWidth, expectedHeight, content: safeArea.content });
  }
  if (cardCount.minimum < 3 || cardCount.maximum > 10 || cardCount.minimum > cardCount.maximum) {
    throw new ThemeValidationError("CARD_COUNT_RANGE", { cardCount });
  }
};

const approvedFonts = (manifest) => {
  if (manifest.license.spdx !== "OFL-1.1") throw new ThemeValidationError("FONT_LICENSE_NOT_APPROVED", { license: manifest.license.spdx });
  const approved = new Map();
  for (const font of manifest.fonts) {
    const filePath = path.resolve(root, font.file);
    if (!filePath.startsWith(`${root}${path.sep}`) || !existsSync(filePath)) throw new ThemeValidationError("FONT_FILE_MISSING", { file: font.file });
    if (sha256(readFileSync(filePath)) !== font.sha256) throw new ThemeValidationError("FONT_DIGEST_MISMATCH", { file: font.file });
    approved.set(`${font.file}:${font.weight}`, font);
  }
  return approved;
};

const validateTheme = (theme, target, approved) => {
  if (theme.targetCompatibility.targetSchemaMajor !== schemaMajor(target.schemaVersion) || !theme.targetCompatibility.targetIds.includes(target.targetId)) {
    throw new ThemeValidationError("TARGET_INCOMPATIBLE", { themeId: theme.themeId, targetId: target.targetId });
  }
  for (const role of Object.values(theme.tokens.typography)) {
    const font = role.font;
    if (font.license !== "OFL-1.1" || !approved.has(`${font.file}:${font.weight}`)) throw new ThemeValidationError("FONT_NOT_APPROVED", { themeId: theme.themeId, font });
  }
};

export const loadThemeSystem = ({
  targetPath = path.join(root, "targets", "portrait-social-1080x1350.json"),
  themePaths = [path.join(root, "themes", "ink-paper.json"), path.join(root, "themes", "signal-night.json")],
  approvedFontManifestPath = fontManifestPath
} = {}) => {
  const targetValidator = schemaValidator(targetSchemaPath);
  const themeValidator = schemaValidator(themeSchemaPath);
  const fontValidator = schemaValidator(fontManifestSchemaPath);
  const target = parseJson(targetPath, "TARGET_UNREADABLE");
  scanReferences(target);
  validateSchema(targetValidator, target, "TARGET_SCHEMA_INVALID", targetPath);
  validateTarget(target);
  const manifest = parseJson(approvedFontManifestPath, "FONT_MANIFEST_UNREADABLE");
  validateSchema(fontValidator, manifest, "FONT_MANIFEST_INVALID", approvedFontManifestPath);
  const approved = approvedFonts(manifest);
  const themes = themePaths.map((themePath) => {
    const theme = parseJson(themePath, "THEME_UNREADABLE");
    scanReferences(theme);
    validateSchema(themeValidator, theme, "THEME_SCHEMA_INVALID", themePath);
    validateTheme(theme, target, approved);
    return theme;
  });
  const ids = new Set(themes.map((theme) => theme.themeId));
  if (ids.size !== themes.length) throw new ThemeValidationError("DUPLICATE_THEME_ID", { themeIds: themes.map((theme) => theme.themeId) });
  return { target, themes, digests: { target: sha256(JSON.stringify(target)), themes: themes.map((theme) => ({ id: theme.themeId, sha256: sha256(JSON.stringify(theme)) })) } };
};
