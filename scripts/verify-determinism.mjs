import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyDeterminism } from "../src/render/determinism.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const positional = process.argv.slice(2).filter((argument) => argument !== "--");
const fixture = path.resolve(root, positional[0] ?? "fixtures/synthetic");
const outputParent = await mkdtemp(path.join(os.tmpdir(), "cardnews-determinism-"));

try {
  const result = await verifyDeterminism({ repositoryRoot: root, fixtureRoot: fixture, outputParent });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.equal || !result.canonicalProfileEqual || !result.nativeEnvironmentEqual) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error instanceof Error && "code" in error ? error.code : "DETERMINISM_FAILED",
    message: error instanceof Error ? error.message : "unknown determinism failure"
  })}\n`);
  process.exitCode = 1;
} finally {
  await rm(outputParent, { recursive: true, force: true });
}
