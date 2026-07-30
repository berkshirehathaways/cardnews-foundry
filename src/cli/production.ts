import { access, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { importAsset } from "../assets/index.ts";
import { canonicalJson, validateContract, type EvaluationReport } from "../contracts/index.ts";
import { evaluateGateMatrix, GATE_IDS, loadEvaluationInput } from "../evaluate/index.mjs";
import { commitStage, getJobStatus, pruneSupersededRevisions } from "../jobs/index.ts";
import {
  createAnchoredExclusive,
  readAnchoredText,
  removeAnchored
} from "#jobs/anchored";
import { packagePrivateJob } from "../package/index.mjs";
import { renderFixture } from "../render/index.mjs";
import type { ParsedArgs } from "./args.ts";
import { booleanOption, optionalString, requiredString } from "./args.ts";
import { CliError } from "./errors.ts";
import { displayPath, openJob, repositoryRoot } from "./job.ts";
import { createPrivateProjection } from "./projection.ts";
import {
  acceptedValue,
  commitRecordValue,
  parseCliStage,
  parseRecordStage,
  readInputJson,
  replaceDraftWithReceipt,
  scaffoldDraft
} from "./records.ts";
import { prepareRecordRevision } from "./revision.ts";

export const scaffoldRecordCommand = async (args: ParsedArgs): Promise<unknown> => {
  const job = await openJob(requiredString(args, "job"));
  const stage = parseRecordStage(requiredString(args, "stage"));
  const draft = await scaffoldDraft(job, stage);
  return {
    jobId: job.id,
    stage,
    draftPath: displayPath(draft.path)
  };
};

export const commitRecordCommand = async (args: ParsedArgs): Promise<unknown> => {
  const job = await openJob(requiredString(args, "job"));
  const stage = parseCliStage(requiredString(args, "stage"));
  const input = path.resolve(process.cwd(), requiredString(args, "input"));
  if (stage !== "source") {
    const expected = path.join(job.path, "drafts", `${stage}.json`);
    if (input !== expected) {
      throw new CliError("security", "DRAFT_PATH_INVALID", "record input must be the fixed draft path");
    }
  }
  const value = stage === "source"
    ? await readInputJson(input)
    : JSON.parse(await readAnchoredText(job, "drafts", `${stage}.json`));
  const committed = await commitRecordValue(job, stage, value, booleanOption(args, "force"));
  if (committed.job.id !== job.id) {
    await prepareRecordRevision(job, committed.job);
  }
  if (stage !== "source" && committed.job.id !== job.id) {
    const name = `${stage}.json`;
    const created = await createAnchoredExclusive(
      committed.job,
      "drafts",
      name,
      new TextEncoder().encode(await readAnchoredText(job, "drafts", name))
    );
    if (!created) throw new CliError("usage", "DRAFT_EXISTS", "revision draft already exists");
    await removeAnchored(job, "drafts", name);
  }
  const receipt = stage === "source"
    ? undefined
    : await replaceDraftWithReceipt(committed.job, stage, committed.recordDigest);
  return {
    jobId: committed.job.id,
    jobPath: displayPath(committed.job.path),
    revision: committed.job.revision,
    stage,
    recordPath: displayPath(path.join(committed.job.path, "records", `${committed.recordDigest}.json`)),
    recordDigest: committed.recordDigest,
    contractDigest: committed.contractDigest,
    ...(receipt === undefined ? {} : { receiptPath: displayPath(receipt) })
  };
};

const findAssetBinding = (recipe: unknown, slot: string) => {
  if (typeof recipe !== "object" || recipe === null || !("cards" in recipe) || !Array.isArray(recipe.cards)) {
    throw new CliError("security", "VISUAL_RECIPE_INVALID", "visual recipe is invalid");
  }
  const matches = recipe.cards.flatMap((card) => {
    if (
      typeof card !== "object" || card === null ||
      !("id" in card) && !("cardId" in card) ||
      !("assetBindings" in card) || !Array.isArray(card.assetBindings)
    ) return [];
    const cardId = "cardId" in card ? card.cardId : card.id;
    if (typeof cardId !== "string") return [];
    const bindings: readonly unknown[] = card.assetBindings;
    return bindings
      .filter((binding: unknown) =>
        typeof binding === "object" && binding !== null &&
        "slot" in binding && binding.slot === slot
      )
      .map(() => cardId);
  });
  if (matches.length !== 1) {
    throw new CliError("security", "ASSET_SLOT_AMBIGUOUS", "asset slot must identify exactly one recipe binding");
  }
  const cardId = matches[0];
  if (cardId === undefined) throw new CliError("internal", "INTERNAL_ERROR", "asset binding resolution failed");
  return cardId;
};

export const importAssetCommand = async (args: ParsedArgs): Promise<unknown> => {
  const job = await openJob(requiredString(args, "job"));
  const file = requiredString(args, "file");
  const slot = requiredString(args, "slot");
  const recipe = await acceptedValue(job, "recipe");
  const originNote = optionalString(args, "origin-note");
  const allowedRoot = path.resolve(
    process.cwd(),
    optionalString(args, "allowed-root") ?? path.dirname(path.resolve(process.cwd(), file))
  );
  const assetFile = path.isAbsolute(file) ? path.relative(allowedRoot, file) : file;
  const imported = await importAsset({
    allowedRoot,
    workspaceRoot: job.path,
    file: assetFile,
    rights: requiredString(args, "rights"),
    ...(originNote === undefined ? {} : { originNote }),
    importedAt: new Date().toISOString(),
    recipe,
    cardId: findAssetBinding(recipe, slot),
    slot
  });
  return {
    jobId: job.id,
    assetDigest: imported.record.assetDigest,
    metadataPath: displayPath(imported.metadataPath),
    artifactPath: displayPath(imported.artifactPath),
    rights: imported.record.rights,
    slot
  };
};

export const renderCommand = async (args: ParsedArgs): Promise<unknown> => {
  const job = await openJob(requiredString(args, "job"));
  const outputRoot = path.join(job.path, "render", "accepted");
  const renderDirectory = path.dirname(outputRoot);
  for (const name of await readdir(renderDirectory)) {
    if (name.startsWith(".accepted.") && name.endsWith(".tmp")) {
      await rm(path.join(renderDirectory, name), { recursive: true, force: true });
    }
  }
  let projection;
  const ownedRenderTemps = new Set<string>();
  try {
    projection = await createPrivateProjection(job, async () => {
      await Promise.all([...ownedRenderTemps].map(
        (temporary) => rm(temporary, { recursive: true, force: true })
      ));
    });
    const rendered = await renderFixture({
      repositoryRoot,
      fixtureRoot: projection.root,
      outputRoot,
      validatedFixture: true,
      onTemporaryOutput: (temporary) => {
        ownedRenderTemps.add(temporary);
      }
    });
    return {
      jobId: job.id,
      outputPath: displayPath(outputRoot),
      cardsPath: displayPath(path.join(outputRoot, "cards")),
      contactSheetPath: displayPath(path.join(outputRoot, "contact-sheet.png")),
      cardIds: rendered.cardIds
    };
  } catch (error) {
    if (error instanceof CliError && error.errorClass === "usage") {
      throw new CliError("render", error.code, "render inputs are incomplete");
    }
    throw error;
  } finally {
    await projection?.cleanup();
  }
};

const deterministicReport = (report: EvaluationReport): EvaluationReport => {
  const visualIndex = GATE_IDS.indexOf("visual-pass-a");
  const deterministic = report.gates.slice(0, visualIndex);
  return {
    ...report,
    blocking: deterministic.some((gate) => gate.status === "fail"),
    gates: deterministic
  };
};

export const evaluateCommand = async (args: ParsedArgs): Promise<unknown> => {
  const job = await openJob(requiredString(args, "job"));
  const renderRoot = path.join(job.path, "render", "accepted");
  await access(path.join(renderRoot, "render-manifest.json")).catch(() => {
    throw new CliError("qa", "RENDER_MISSING", "accepted render output is missing");
  });
  let projection;
  try {
    projection = await createPrivateProjection(job);
    const input = await loadEvaluationInput({
      repositoryRoot,
      fixtureRoot: projection.root,
      renderRoot
    });
    const evaluated = await evaluateGateMatrix(input);
    const report = booleanOption(args, "deterministic-only")
      ? deterministicReport(evaluated.report)
      : evaluated.report;
    if (report.blocking) {
      const failed = report.gates
        .filter((gate) => gate.status === "fail")
        .map((gate) => gate.id)
        .join(",");
      throw new CliError("qa", "QA_BLOCKING", `evaluation has blocking gates: ${failed}`);
    }
    const validation = validateContract("EvaluationReport", report);
    if (!validation.ok) throw new CliError("qa", "REPORT_INVALID", "evaluation report is invalid");
    const reportPath = path.join(job.path, "reports", "evaluation-report.json");
    const created = await createAnchoredExclusive(
      job,
      "reports",
      "evaluation-report.json",
      new TextEncoder().encode(canonicalJson(report)),
      0o400
    );
    if (!created) throw new CliError("qa", "REPORT_EXISTS", "evaluation report already exists");
    let digest: string;
    try {
      digest = await commitStage(job, { stage: "evaluate", value: report });
    } catch (error) {
      const accepted = (await getJobStatus(job)).stages.find(
        (stage) => stage.stage === "evaluate" && stage.state === "valid"
      );
      if (accepted?.digest === undefined) {
        await removeAnchored(job, "reports", "evaluation-report.json", true);
        throw error;
      }
      digest = accepted.digest;
    }
    return {
      jobId: job.id,
      reportPath: displayPath(reportPath),
      recordDigest: digest,
      blocking: false,
      deterministicOnly: booleanOption(args, "deterministic-only"),
      gateCount: report.gates.length
    };
  } finally {
    await projection?.cleanup();
  }
};

export const packageCommand = async (args: ParsedArgs): Promise<unknown> => {
  const job = await openJob(requiredString(args, "job"));
  const format = optionalString(args, "format") ?? "zip";
  if (format !== "zip") throw new CliError("usage", "PACKAGE_FORMAT_INVALID", "package format must be zip");
  const passAPath = path.resolve(
    process.cwd(),
    optionalString(args, "visual-pass-a") ?? path.join(job.path, "reports", "visual-pass-a.json")
  );
  const passBPath = path.resolve(
    process.cwd(),
    optionalString(args, "visual-pass-b") ?? path.join(job.path, "reports", "visual-pass-b.json")
  );
  const result = await packagePrivateJob({
    job,
    repositoryRoot,
    passAPath,
    passBPath
  });
  // A freshly packaged revision is the lineage tip; reclaim the regenerable
  // working artifacts of any revisions it superseded so the workspace stays lean.
  const pruned = await pruneSupersededRevisions({ root: job.root, slug: job.slug });
  return {
    ...result,
    outputPath: displayPath(result.outputPath),
    prunedSupersededRevisions: pruned.pruned.map((entry) => entry.jobId)
  };
};
