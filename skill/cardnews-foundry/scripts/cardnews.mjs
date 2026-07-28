#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { accessSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const realScript = realpathSync(fileURLToPath(import.meta.url));
const repository = path.resolve(path.dirname(realScript), "../../..");
const executable = path.join(repository, "bin", "cardnews");

try {
  accessSync(path.join(repository, "package.json"));
  accessSync(executable);
} catch {
  process.stderr.write(
    "Cardnews Foundry repository CLI is unavailable. Reinstall the skill from the repository and run corepack pnpm install --frozen-lockfile there.\n",
  );
  process.exit(1);
}

const result = spawnSync(process.execPath, [executable, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});
if (result.error !== undefined) {
  process.stderr.write(`Cardnews Foundry CLI failed to start: ${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
