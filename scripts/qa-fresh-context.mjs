import { randomUUID } from "node:crypto";
import {
  mkdir, readFile, rm, symlink, writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommand } from "./qa-fixture-job.mjs";

export const createDisclosureEnvelope = ({
  scenario,
  installedSkill,
  rawInputs,
  jobInputs,
}) => ({
  schemaVersion: 1,
  scenario,
  disclosureKinds: ["installed-skill", "raw-input", "job-state"],
  disclosedPaths: [installedSkill, ...rawInputs, ...jobInputs],
  prohibitedContext: [
    "expected-answers", "implementation-plan", "intended-fixes", "prior-diagnosis",
  ],
});

const freshCodexHome = async (root) => {
  const home = path.join(root, "codex-home");
  await mkdir(path.join(home, "skills"), { recursive: true });
  await symlink(path.join(os.homedir(), ".codex", "skills", "cardnews-foundry"), path.join(
    home, "skills", "cardnews-foundry",
  ));
  await symlink(path.join(os.homedir(), ".codex", "auth.json"), path.join(home, "auth.json"));
  return home;
};

export const createCodexArgs = ({ cwd, finalMessage, prompt }) => [
  "exec", "--ephemeral", "--ignore-rules", "--skip-git-repo-check",
  "--sandbox", "danger-full-access", "--json", "--cd", cwd,
  "--output-last-message", finalMessage, prompt,
];

export const createContextRoot = (evidenceRoot, scenario, runId) =>
  path.join(evidenceRoot, "fresh-contexts", scenario, runId);

export const contextSucceeded = ({
  exitCode,
  threadId,
  finalMessagePresent,
  outcomePassed,
}) => exitCode === 0 &&
  typeof threadId === "string" &&
  finalMessagePresent &&
  outcomePassed;

export const runFreshContext = async ({
  scenario,
  cwd,
  prompt,
  evidenceRoot,
  envelope,
  verifyOutcome,
}) => {
  const contextRoot = createContextRoot(evidenceRoot, scenario, randomUUID());
  await mkdir(contextRoot, { recursive: true });
  const codexHome = await freshCodexHome(contextRoot);
  const transcript = path.join(contextRoot, "transcript.jsonl");
  const finalMessage = path.join(contextRoot, "final.txt");
  await writeFile(
    path.join(contextRoot, "disclosure.json"),
    `${JSON.stringify(envelope, null, 2)}\n`,
  );
  try {
    const result = await runCommand("codex", createCodexArgs({ cwd, finalMessage, prompt }), {
      cwd,
      env: { ...process.env, CODEX_HOME: codexHome },
    });
    await writeFile(transcript, result.stdout);
    if (result.stderr !== "") await writeFile(path.join(contextRoot, "stderr.log"), result.stderr);
    const first = result.stdout.split("\n").find((line) => line.trim() !== "");
    const started = first === undefined ? undefined : JSON.parse(first);
    const final = await readFile(finalMessage, "utf8").catch(() => "");
    const outcome = await verifyOutcome();
    const finalMessagePresent = final.trim().length > 0;
    return {
      scenario,
      exitCode: result.code,
      threadId: started?.thread_id ?? null,
      transcript,
      finalMessage,
      finalMessagePresent,
      outcome,
      passed: contextSucceeded({
        exitCode: result.code,
        threadId: started?.thread_id,
        finalMessagePresent,
        outcomePassed: outcome.passed,
      }),
    };
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
};
