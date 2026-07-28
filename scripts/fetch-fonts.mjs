import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { access, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

class FetchError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const main = async () => {
  const args = process.argv.slice(2).filter((argument) => argument !== "--");
  const { values } = parseArgs({
    args,
    options: {
      archive: { type: "string" },
      force: { type: "boolean", default: false }
    },
    strict: true
  });
  const manifest = JSON.parse(await readFile(path.join(repositoryRoot, "fonts", "manifest.json"), "utf8"));
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "cardnews-fonts-"));
  try {
    let archive;
    if (values.archive === undefined) {
      const response = await fetch(manifest.sourceArchive.url, { signal: AbortSignal.timeout(180_000) });
      if (!response.ok) {
        throw new FetchError("FONT_DOWNLOAD_FAILED", `official font archive download returned ${response.status}`);
      }
      archive = Buffer.from(await response.arrayBuffer());
    } else {
      archive = await readFile(path.resolve(values.archive));
    }
    if (sha256(archive) !== manifest.sourceArchive.sha256) {
      throw new FetchError("FONT_ARCHIVE_HASH_MISMATCH", "official font archive hash does not match its pin");
    }
    const archivePath = path.join(temporaryDirectory, "noto.zip");
    await writeFile(archivePath, archive);
    await execFileAsync("unzip", ["-q", "-j", archivePath, "NotoSansCJKkr-Regular.otf", "NotoSansCJKkr-Bold.otf", "LICENSE", "-d", temporaryDirectory]);
    const candidates = [
      { source: "LICENSE", target: "LICENSE-OFL-1.1.txt", expected: manifest.license.sha256 },
      ...manifest.fonts.map((font) => ({ source: path.basename(font.file), target: path.basename(font.file), expected: font.sha256 }))
    ];
    for (const candidate of candidates) {
      const source = path.join(temporaryDirectory, candidate.source);
      const target = path.join(repositoryRoot, "fonts", candidate.target);
      const bytes = await readFile(source);
      if (sha256(bytes) !== candidate.expected) {
        throw new FetchError("FONT_EXTRACT_HASH_MISMATCH", `extracted font hash does not match: ${candidate.target}`);
      }
      if (existsSync(target) && !values.force) {
        const existing = await readFile(target);
        if (sha256(existing) === candidate.expected) {
          continue;
        }
        throw new FetchError("FONT_TARGET_EXISTS", `refusing to overwrite mismatched font: ${candidate.target}`);
      }
      const stagedTarget = `${target}.staged`;
      await rm(stagedTarget, { force: true });
      await writeFile(stagedTarget, bytes, { mode: 0o644 });
      await rename(stagedTarget, target);
    }
    await access(path.join(repositoryRoot, "fonts", "LICENSE-OFL-1.1.txt"));
    process.stdout.write(`${JSON.stringify({ ok: true, sourceArchiveSha256: manifest.sourceArchive.sha256, status: "installed-or-verified" })}\n`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown font fetch failure";
  const code = error instanceof FetchError ? error.code : "UNEXPECTED";
  process.stdout.write(`${JSON.stringify({ ok: false, rejection: { code, message } })}\n`);
  process.exitCode = 1;
});
