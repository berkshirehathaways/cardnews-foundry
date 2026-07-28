import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  canonicalJsonBytes,
  canonicalSha256,
  validateContract
} from "../contracts/index.ts";
import { evaluateGateMatrix, GATE_IDS } from "../evaluate/index.mjs";
import { createDeterministicZip, inspectZip } from "./archive.mjs";
import { PackageError } from "./errors.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const allowedPath = /^(?:cards\/[a-z][a-z0-9-]{0,63}\.(?:png|jpe?g)|contact-sheet\.png|metadata\/(?:attribution|source-summary)\.json|reports\/evaluation-summary\.json)$/u;
const prohibitedText = /(?:\/Users\/|\/home\/|[A-Za-z]:\\|\.cardnews\/jobs\/|source\/raw\/|source\/extracted\/|(?:^|\/)\.env(?:\/|$)|cookies?|credentials?|authorization\s*:|private[-_ ]?key)/iu;

const mediaType = (relativePath) => {
  if (relativePath.endsWith(".png")) return "image/png";
  if (relativePath.endsWith(".jpg") || relativePath.endsWith(".jpeg")) return "image/jpeg";
  return "application/json";
};

const publicationRights = (input) => {
  const sourceRights = input.records.source.provenance.rightsStatus;
  if (sourceRights === "unknown") {
    throw new PackageError("PUBLICATION_RIGHTS_UNKNOWN", "source publication rights are unresolved");
  }
  for (const asset of input.assetMetadata) {
    if (
      asset.rights === "unknown" ||
      asset.publicEligible !== true ||
      !Array.isArray(asset.publicPackageBlockers) ||
      asset.publicPackageBlockers.length !== 0
    ) {
      throw new PackageError("ASSET_PUBLICATION_RIGHTS", "an image is not eligible for publication");
    }
  }
};

const attribution = (input) => {
  const provenance = input.records.source.provenance;
  const locator = /^https:\/\//u.test(provenance.finalLocator)
    ? provenance.finalLocator
    : input.records.source.sourceId;
  return {
    schemaVersion: 1,
    source: {
      title: input.records.source.title,
      locator,
      rights: provenance.rightsStatus,
      retrievedAt: provenance.retrievedAt
    },
    images: [...input.assetMetadata]
      .sort((left, right) => left.assetDigest.localeCompare(right.assetDigest, "en"))
      .map((asset) => ({
        sha256: asset.assetDigest,
        rights: asset.rights,
        ...(typeof asset.originNote === "string" ? { originNote: asset.originNote } : {})
      }))
  };
};

const sourceSummary = (input) => ({
  schemaVersion: 1,
  sourceId: input.records.source.sourceId,
  title: input.records.source.title,
  summary: input.records.editorial.thesis,
  claimCount: input.records.editorial.claims.length
});

const evaluationSummary = (report, verdicts) => ({
  schemaVersion: 1,
  evaluationId: report.evaluationId,
  renderSetDigest: report.renderSetDigest,
  blocking: false,
  gates: report.gates
    .filter((gate) => !gate.id.startsWith("package-"))
    .map((gate) => ({ id: gate.id, status: gate.status })),
  visual: {
    passA: {
      verdictId: verdicts.passA.verdictId,
      reviewerKind: verdicts.passA.reviewer.kind,
      verdict: verdicts.passA.verdict
    },
    passB: {
      verdictId: verdicts.passB.verdictId,
      reviewerKind: verdicts.passB.reviewer.kind,
      verdict: verdicts.passB.verdict
    }
  }
});

const renderEntries = async (input) => {
  const descriptors = [
    ...input.render.manifest.artifacts.map((artifact) => ({
      relativePath: artifact.contract.relativePath,
      expectedSha256: artifact.contract.sha256,
      expectedSize: artifact.byteCount
    })),
    {
      relativePath: input.render.manifest.contactSheet.relativePath,
      expectedSha256: input.render.manifest.contactSheet.sha256,
      expectedSize: input.render.manifest.contactSheet.byteCount
    }
  ];
  return Promise.all(descriptors.map(async (descriptor) => {
    const bytes = await readFile(path.join(input.renderRoot, descriptor.relativePath));
    if (sha256(bytes) !== descriptor.expectedSha256 || bytes.length !== descriptor.expectedSize) {
      throw new PackageError("RENDER_ARTIFACT_STALE", "render artifact differs from its current manifest");
    }
    return { path: descriptor.relativePath, bytes };
  }));
};

const manifestFile = (entry) => ({
  relativePath: entry.path,
  size: entry.bytes.length,
  mediaType: mediaType(entry.path),
  sha256: sha256(entry.bytes)
});

const requirePrePackagePass = (report) => {
  const packageIndex = GATE_IDS.indexOf("package-schema");
  const required = report.gates.slice(0, packageIndex);
  if (required.length !== packageIndex || required.some((gate) => gate.status !== "pass")) {
    throw new PackageError(
      "PACKAGE_PRECONDITION_FAILED",
      "current deterministic and independent visual evaluation must pass"
    );
  }
};

export const buildGeneratedBundle = async ({ slug, input, verdicts }) => {
  publicationRights(input);
  const evaluationInput = structuredClone(input);
  evaluationInput.verdicts = verdicts;
  evaluationInput.package = undefined;
  const preliminary = (await evaluateGateMatrix(evaluationInput)).report;
  requirePrePackagePass(preliminary);
  const metadata = [
    { path: "metadata/attribution.json", bytes: canonicalJsonBytes(attribution(input)) },
    { path: "metadata/source-summary.json", bytes: canonicalJsonBytes(sourceSummary(input)) },
    {
      path: "reports/evaluation-summary.json",
      bytes: canonicalJsonBytes(evaluationSummary(preliminary, verdicts))
    }
  ];
  const payload = [...await renderEntries(input), ...metadata]
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  const manifest = {
    schemaVersion: "1.0.0",
    packageId: `package-${canonicalSha256({
      slug,
      renderSetDigest: preliminary.renderSetDigest
    }).slice(0, 12)}`,
    files: payload.map(manifestFile),
    recordDigests: [
      canonicalSha256(input.records.source),
      canonicalSha256(input.records.editorial),
      canonicalSha256(input.records.storyboard),
      canonicalSha256(input.records.visualRecipe),
      canonicalSha256(input.records.renderSpec)
    ],
    dependencyVersions: {
      "cardnews-foundry": "0.0.0",
      node: process.versions.node,
      renderer: input.render.manifest.rendererVersion
    }
  };
  const validation = validateContract("PackageManifest", manifest);
  if (!validation.ok) throw new PackageError("PACKAGE_MANIFEST_INVALID", "generated manifest is invalid");
  evaluationInput.package = {
    manifest,
    files: Object.fromEntries(payload.map((entry) => [
      entry.path,
      {
        sha256: sha256(entry.bytes),
        size: entry.bytes.length,
        text: entry.path.endsWith(".json") ? entry.bytes.toString("utf8") : ""
      }
    ]))
  };
  const report = (await evaluateGateMatrix(evaluationInput)).report;
  if (report.blocking || report.gates.some((gate) => gate.status !== "pass")) {
    throw new PackageError("PACKAGE_EVALUATION_BLOCKING", "current package evaluation has blocking gates");
  }
  const entries = [
    ...payload,
    { path: "manifest.json", bytes: canonicalJsonBytes(manifest) }
  ];
  const bytes = await createDeterministicZip(entries);
  inspectGeneratedBundle(bytes);
  return { bytes, manifest, report };
};

export const inspectGeneratedBundle = (bytes, options = {}) => {
  const archive = inspectZip(bytes);
  const paths = archive.entries.map((entry) => entry.path);
  const sorted = [...paths].sort((left, right) => left.localeCompare(right, "en"));
  if (paths.some((entry, index) => entry !== sorted[index])) {
    throw new PackageError("PACKAGE_ORDER_INVALID", "ZIP entries are not lexicographically ordered");
  }
  const manifestEntry = archive.entries.find((entry) => entry.path === "manifest.json");
  if (manifestEntry === undefined) throw new PackageError("PACKAGE_MANIFEST_MISSING", "manifest.json is required");
  let manifest;
  try {
    manifest = JSON.parse(manifestEntry.bytes.toString("utf8"));
  } catch {
    throw new PackageError("PACKAGE_MANIFEST_INVALID", "manifest.json is malformed");
  }
  const validation = validateContract("PackageManifest", manifest);
  if (!validation.ok || !manifestEntry.bytes.equals(canonicalJsonBytes(manifest))) {
    throw new PackageError("PACKAGE_MANIFEST_INVALID", "manifest.json is invalid or non-canonical");
  }
  if (
    options.expectedManifest !== undefined &&
    canonicalSha256(options.expectedManifest) !== canonicalSha256(manifest)
  ) {
    throw new PackageError("PACKAGE_DIGEST_MISMATCH", "ZIP manifest differs from expected manifest");
  }
  const payload = archive.entries.filter((entry) => entry.path !== "manifest.json");
  const declared = new Map(manifest.files.map((file) => [file.relativePath, file]));
  if (declared.size !== payload.length || payload.some((entry) => !declared.has(entry.path))) {
    throw new PackageError("PACKAGE_INVENTORY_MISMATCH", "manifest and ZIP inventories differ");
  }
  for (const entry of payload) {
    const file = declared.get(entry.path);
    if (
      file === undefined ||
      !allowedPath.test(entry.path) ||
      file.size !== entry.bytes.length ||
      file.sha256 !== sha256(entry.bytes) ||
      file.mediaType !== mediaType(entry.path)
    ) {
      throw new PackageError("PACKAGE_DIGEST_MISMATCH", "a ZIP entry differs from its manifest");
    }
  }
  const text = archive.entries
    .filter((entry) => entry.path.endsWith(".json"))
    .map((entry) => entry.bytes.toString("utf8"))
    .join("\n");
  if (prohibitedText.test(text)) {
    throw new PackageError("PACKAGE_PROHIBITED_CONTENT", "ZIP contains private or prohibited content");
  }
  for (const required of [
    "metadata/attribution.json",
    "metadata/source-summary.json",
    "reports/evaluation-summary.json"
  ]) {
    if (!declared.has(required)) throw new PackageError("PACKAGE_METADATA_MISSING", "ZIP metadata is incomplete");
  }
  return { paths, manifest, text };
};

