import { spawn } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export class QaCommandError extends Error {
  constructor(args, result) {
    super(`cardnews ${args.join(" ")} exited ${result.code}`);
    this.name = "QaCommandError";
    this.args = args;
    this.result = result;
  }
}

export const runCommand = async (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({
      code: code ?? 1,
      signal,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    }));
  });

export const runCardnews = async (runner, cwd, args, expectedCode = 0) => {
  const result = await runCommand(runner, [...args, "--json"], { cwd });
  if (result.code !== expectedCode) throw new QaCommandError(args, result);
  const output = JSON.parse(result.stdout);
  return { result, output };
};

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

const commitFixtureRecord = async ({
  runner,
  workspace,
  fixture,
  job,
  stage,
  fixtureName,
  dependencyField,
  dependencyDigest,
}) => {
  const scaffold = await runCardnews(runner, workspace, [
    "scaffold-record", "--job", job, "--stage", stage,
  ]);
  const draft = path.join(workspace, scaffold.output.result.draftPath);
  const value = await readJson(path.join(fixture, "records", fixtureName));
  value[dependencyField] = dependencyDigest;
  await writeFile(draft, `${JSON.stringify(value)}\n`);
  const committed = await runCardnews(runner, workspace, [
    "commit-record", "--job", job, "--stage", stage,
    "--input", scaffold.output.result.draftPath,
  ]);
  return { value, digest: committed.output.result.contractDigest };
};

export const buildFixtureJob = async ({
  runner,
  fixture,
  workspace,
  slug,
  through = "evaluate",
}) => {
  await mkdir(workspace, { recursive: true });
  const inputRoot = path.join(workspace, "inputs");
  await mkdir(inputRoot);
  const source = path.join(inputRoot, "article.html");
  const hero = path.join(inputRoot, "seed-orbit.bin");
  const illustration = path.join(inputRoot, "record-grid.bin");
  await Promise.all([
    cp(path.join(fixture, "source", "article.html"), source),
    cp(path.join(fixture, "assets", "seed-orbit", "asset.bin"), hero),
    cp(path.join(fixture, "assets", "record-grid", "asset.bin"), illustration),
  ]);
  const initialized = await runCardnews(runner, workspace, [
    "init", "--slug", slug, "--target", "portrait-social-1080x1350", "--cards", "7",
  ]);
  const job = initialized.output.result.jobPath;
  const ingested = await runCardnews(runner, workspace, [
    "ingest", "--job", job, "--file", source, "--allowed-root", inputRoot,
  ]);
  const brief = await commitFixtureRecord({
    runner, workspace, fixture, job, stage: "editorial-brief",
    fixtureName: "editorial-brief.json", dependencyField: "sourceEnvelopeDigest",
    dependencyDigest: ingested.output.result.contractDigest,
  });
  const storyboard = await commitFixtureRecord({
    runner, workspace, fixture, job, stage: "storyboard",
    fixtureName: "storyboard.json", dependencyField: "editorialBriefDigest",
    dependencyDigest: brief.digest,
  });
  const recipe = await commitFixtureRecord({
    runner, workspace, fixture, job, stage: "visual-recipe",
    fixtureName: "visual-recipe.json", dependencyField: "storyboardDigest",
    dependencyDigest: storyboard.digest,
  });
  const renderSpec = await commitFixtureRecord({
    runner, workspace, fixture, job, stage: "render-spec",
    fixtureName: "render-spec.json", dependencyField: "visualRecipeDigest",
    dependencyDigest: recipe.digest,
  });
  const assets = await Promise.all([
    runCardnews(runner, workspace, [
      "import-asset", "--job", job, "--file", hero, "--allowed-root", inputRoot,
      "--rights", "generated", "--origin-note", "frozen synthetic generated asset", "--slot", "hero",
    ]),
    runCardnews(runner, workspace, [
      "import-asset", "--job", job, "--file", illustration, "--allowed-root", inputRoot,
      "--rights", "generated", "--origin-note", "frozen synthetic generated asset", "--slot", "illustration",
    ]),
  ]);
  await runCardnews(runner, workspace, ["validate", "--job", job, "--stage", "render-spec"]);
  if (through === "render-ready") {
    return { workspace, job, source, assets, brief, storyboard, recipe, renderSpec, ingested };
  }
  const rendered = await runCardnews(runner, workspace, ["render", "--job", job]);
  if (through === "render") {
    return {
      workspace, job, source, assets, brief, storyboard, recipe, renderSpec, ingested, rendered,
    };
  }
  const evaluated = await runCardnews(runner, workspace, [
    "evaluate", "--job", job, "--deterministic-only",
  ]);
  const packaged = await runCardnews(runner, workspace, ["package", "--job", job], 6);
  return {
    workspace, job, source, assets, brief, storyboard, recipe, renderSpec,
    ingested, rendered, evaluated, packaged,
  };
};
