import { loadThemeSystem, ThemeValidationError } from "../src/themes/index.mjs";

const expectedOutput = { codec: "png", mimeType: "image/png", colorSpace: "srgb", alpha: "opaque" };

const requireOutputContract = (target) => {
  if (target.output === null || typeof target.output !== "object" || Array.isArray(target.output)) {
    throw new ThemeValidationError("TARGET_OUTPUT_CONTRACT_MISSING", { output: target.output ?? null });
  }
  const outputMatches = Object.keys(target.output).length === Object.keys(expectedOutput).length
    && Object.entries(expectedOutput).every(([key, value]) => target.output[key] === value);
  if (!outputMatches) {
    throw new ThemeValidationError("TARGET_OUTPUT_CONTRACT_INVALID", { expected: expectedOutput, actual: target.output });
  }
};

const main = () => {
  const result = loadThemeSystem();
  requireOutputContract(result.target);
  const typographyRoles = result.themes.map((theme) => Object.keys(theme.tokens.typography).sort());
  return {
    schemaVersion: 1,
    ok: true,
    counts: { themes: result.themes.length, typographyRoles: typographyRoles[0]?.length ?? 0 },
    target: { id: result.target.targetId, schemaVersion: result.target.schemaVersion, dimensions: result.target.dimensions, output: result.target.output, safeArea: result.target.safeArea, cardCount: result.target.cardCount, digest: result.digests.target },
    themes: result.themes.map((theme, index) => ({ id: theme.themeId, schemaVersion: theme.schemaVersion, tokenGroups: Object.keys(theme.tokens).sort(), typographyRoles: typographyRoles[index], layoutVariantIds: theme.layoutVariants.map((variant) => variant.id), digest: result.digests.themes[index]?.sha256 }))
  };
};

try {
  process.stdout.write(`${JSON.stringify(main())}\n`);
} catch (error) {
  const code = error instanceof ThemeValidationError ? error.code : "THEME_VERIFIER_INTERNAL_ERROR";
  const details = error instanceof ThemeValidationError ? error.details : error instanceof Error ? { message: error.message } : { message: "unknown failure" };
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ok: false, error: { code, details } })}\n`);
  process.exitCode = 1;
}
