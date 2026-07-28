import path from "node:path";
import { canonicalSha256, validateContract } from "../contracts/index.ts";

const allowed = /^(?:cards\/[a-z][a-z0-9-]{0,63}\.(?:png|jpe?g)|contact-sheet\.png|metadata\/(?:attribution|source-summary)\.json|reports\/evaluation-summary\.json)$/u;
const privateContent = /(?:\/Users\/|\/home\/|\.cardnews\/jobs\/|source\/raw\/|(?:^|\/)\.env(?:\/|$)|cookies?|credentials?)/iu;
const relativeSafe = (value) =>
  !path.isAbsolute(value) && !value.includes("\\") && !value.split("/").includes("..");

export const buildPackageCandidate = (input) => {
  const artifacts = input.render.manifest.artifacts;
  const contact = input.render.manifest.contactSheet;
  return {
    schemaVersion: "1.0.0",
    packageId: `package-${input.render.manifest.sourceRevision.slice(0, 12)}`,
    files: [
      ...artifacts.map((artifact) => ({
        relativePath: artifact.contract.relativePath,
        size: artifact.byteCount,
        mediaType: artifact.contract.mediaType,
        sha256: artifact.contract.sha256
      })),
      {
        relativePath: contact.relativePath,
        size: contact.byteCount,
        mediaType: contact.mediaType,
        sha256: contact.sha256
      }
    ],
    recordDigests: [
      canonicalSha256(input.records.source),
      canonicalSha256(input.records.editorial),
      canonicalSha256(input.records.storyboard),
      canonicalSha256(input.records.visualRecipe),
      canonicalSha256(input.records.renderSpec)
    ],
    dependencyVersions: {
      "cardnews-foundry": "0.0.0",
      renderer: input.render.manifest.rendererVersion
    }
  };
};

export const packageGates = (input) => {
  const candidate = input.package?.manifest;
  const files = candidate?.files ?? [];
  return [
    ["package-schema", () => candidate !== undefined && validateContract("PackageManifest", candidate).ok],
    ["package-allowlist", () => candidate !== undefined && files.every((file) => allowed.test(file.relativePath))],
    ["package-relative-paths", () =>
      candidate !== undefined && files.every((file) => relativeSafe(file.relativePath))],
    ["package-digests", () => candidate !== undefined && files.every((file) => {
      const actual = input.package.files[file.relativePath];
      return actual !== undefined && actual.sha256 === file.sha256 && actual.size === file.size;
    })],
    ["package-prohibited-content", () => candidate !== undefined && files.every((file) => {
      const actual = input.package.files[file.relativePath];
      return !privateContent.test(file.relativePath) && !privateContent.test(actual?.text ?? "");
    })]
  ];
};
