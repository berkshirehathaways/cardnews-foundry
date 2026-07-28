import { createHash } from "node:crypto";
import { lstat, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  canonicalJsonBytes,
  canonicalSha256,
  validateContract
} from "../contracts/index.ts";
import { loadEvaluationInput, GATE_IDS } from "../evaluate/index.mjs";
import { commitStage } from "../jobs/index.ts";
import { createPrivateProjection } from "../cli/projection.ts";
import { acceptedValue } from "../cli/records.ts";
import { buildGeneratedBundle } from "./bundle.mjs";
import { PackageError } from "./errors.mjs";
import { publishImmutable } from "./publish.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const MAX_VERDICT_BYTES = 1024 * 1024;

const readVerdict = async (file) => {
  let metadata;
  try {
    metadata = await lstat(file);
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, "code") === "ENOENT") {
      throw new PackageError("VISUAL_VERDICT_MISSING", "current visual verdict evidence is missing");
    }
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_VERDICT_BYTES) {
    throw new PackageError("VISUAL_VERDICT_FILE_INVALID", "visual verdict must be a bounded regular file");
  }
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new PackageError("VISUAL_VERDICT_FILE_INVALID", "visual verdict JSON is malformed");
  }
};

const requireAcceptedEvaluation = async (job) => {
  let value;
  try {
    value = await acceptedValue(job, "evaluate");
  } catch {
    throw new PackageError("PACKAGE_PRECONDITION_FAILED", "accepted deterministic evaluation is required");
  }
  const validation = validateContract("EvaluationReport", value);
  const visualIndex = GATE_IDS.indexOf("visual-pass-a");
  if (
    !validation.ok ||
    validation.value.blocking ||
    validation.value.gates.length < visualIndex ||
    validation.value.gates.slice(0, visualIndex).some((gate, index) =>
      gate.id !== GATE_IDS[index] || gate.status !== "pass"
    )
  ) {
    throw new PackageError("PACKAGE_PRECONDITION_FAILED", "accepted deterministic evaluation is incomplete");
  }
  return validation.value;
};

const persistedVerdict = async (job, name, source) => {
  const target = path.join(job.path, "reports", name);
  const result = await publishImmutable({ target, bytes: canonicalJsonBytes(source) });
  if (!result.reused) await import("node:fs/promises").then(({ chmod }) => chmod(target, 0o400));
  return target;
};

const acceptedPackageValue = async (job) => {
  try {
    return await acceptedValue(job, "package");
  } catch {
    return undefined;
  }
};

export const packagePrivateJob = async ({
  job,
  repositoryRoot,
  passAPath,
  passBPath,
  failpoint
}) => {
  const acceptedEvaluation = await requireAcceptedEvaluation(job);
  const packageRoot = path.join(job.path, "package");
  const renderRoot = path.join(job.path, "render", "accepted");
  await mkdir(packageRoot, { recursive: true });
  const [passA, passB] = await Promise.all([
    readVerdict(passAPath),
    readVerdict(passBPath)
  ]);
  let projection;
  try {
    projection = await createPrivateProjection(job);
    const input = await loadEvaluationInput({
      repositoryRoot,
      fixtureRoot: projection.root,
      renderRoot
    });
    const bundle = await buildGeneratedBundle({
      slug: job.slug,
      input,
      verdicts: { passA, passB }
    });
    if (bundle.report.renderSetDigest !== acceptedEvaluation.renderSetDigest) {
      throw new PackageError("PACKAGE_EVALUATION_STALE", "accepted evaluation targets a different render set");
    }
    const outputPath = path.join(packageRoot, `${job.slug}-cardnews.zip`);
    const digest = sha256(bundle.bytes);
    const value = {
      schemaVersion: 1,
      filename: path.basename(outputPath),
      sha256: digest,
      manifestDigest: canonicalSha256(bundle.manifest),
      evaluationDigest: canonicalSha256(bundle.report),
      visualVerdictDigests: [canonicalSha256(passA), canonicalSha256(passB)]
    };
    const prior = await acceptedPackageValue(job);
    if (prior !== undefined && canonicalSha256(prior) !== canonicalSha256(value)) {
      throw new PackageError("PACKAGE_IMMUTABLE", "accepted package requires a new upstream revision");
    }
    const published = await publishImmutable({ target: outputPath, bytes: bundle.bytes, failpoint });
    await Promise.all([
      persistedVerdict(job, "visual-pass-a.json", passA),
      persistedVerdict(job, "visual-pass-b.json", passB)
    ]);
    if (prior === undefined) await commitStage(job, { stage: "package", value });
    return {
      outputPath,
      packageId: bundle.manifest.packageId,
      sha256: digest,
      manifestDigest: value.manifestDigest,
      reused: published.reused,
      entryCount: bundle.manifest.files.length + 1
    };
  } finally {
    await projection?.cleanup();
  }
};
