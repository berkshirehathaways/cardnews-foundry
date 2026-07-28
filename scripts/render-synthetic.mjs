import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderFixture } from "../src/render/index.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const positional = process.argv.slice(2).filter((argument) => argument !== "--");
const temporaryParent = positional[0] === undefined
  ? await mkdtemp(path.join(os.tmpdir(), "cardnews-synthetic-render-"))
  : path.resolve(positional[0]);
const outputRoot = positional[1] === undefined ? path.join(temporaryParent, "render") : path.resolve(positional[1]);

try {
  const result = await renderFixture({
    repositoryRoot: root,
    fixtureRoot: path.join(root, "fixtures", "synthetic"),
    outputRoot
  });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    outputRoot: result.outputRoot,
    cardIds: result.cardIds,
    contactSheet: result.contactSheet.relativePath,
    nativeEnvironment: result.nativeEnvironment,
    canonicalRenderProfile: result.canonicalRenderProfile
  })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error instanceof Error && "code" in error ? error.code : "RENDER_FAILED",
    message: error instanceof Error ? error.message : "unknown render failure"
  })}\n`);
  process.exitCode = 1;
}
