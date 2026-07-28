import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { computeRendererSourceRevision } from "../src/render/input.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const identity = async (file) => {
  const bytes = await readFile(file);
  return { sha256: sha256(bytes), byteCount: bytes.byteLength };
};

export const verifyVisualPassRetention = async ({ repositoryRoot, t12Root }) => {
  const prep = await readJson(path.join(t12Root, "a1", "visual-qa-prep.json"));
  const [passA, passB] = await Promise.all([
    readJson(path.join(t12Root, "a2", "pass-a", "visual-pass-a.json")),
    readJson(path.join(t12Root, "a2", "pass-b", "visual-pass-b.json")),
  ]);
  const captures = await Promise.all(prep.captures.map(async (capture) => {
    const bytes = await readFile(capture.path);
    const currentSha256 = sha256(bytes);
    return {
      id: capture.id,
      expectedSha256: capture.sha256,
      currentSha256,
      signature: bytes.subarray(0, 8).toString("hex"),
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
      bytesUnchanged: currentSha256 === capture.sha256,
    };
  }));
  const sourceInventory = await Promise.all(prep.sourceInventory.map(async (source) => ({
    path: path.relative(repositoryRoot, source.path),
    expectedSha256: source.sha256,
    currentSha256: (await identity(source.path)).sha256,
  })));
  const captureSetDigest = sha256(Buffer.from(
    captures.map((capture) => `${capture.id}:${capture.currentSha256}`).join("\n"),
  ));
  const renderManifest = await identity(prep.renderManifest.path);
  const currentRenderSetDigest = await computeRendererSourceRevision(repositoryRoot);
  const checks = {
    rendererSourceUnchanged: sourceInventory.every(
      (source) => source.expectedSha256 === source.currentSha256,
    ),
    renderManifestUnchanged: renderManifest.sha256 === prep.renderManifest.sha256,
    renderSetDigestUnchanged: currentRenderSetDigest === prep.renderSetDigest,
    captureBytesUnchanged: captures.every((capture) => capture.bytesUnchanged),
    captureSetDigestUnchanged: captureSetDigest === prep.captureSetDigest,
    signaturesAndDimensionsUnchanged: captures.every((capture, index) =>
      capture.signature === "89504e470d0a1a0a" &&
      capture.width === prep.captures[index].width &&
      capture.height === prep.captures[index].height
    ),
    passABound: passA.verdict === "PASS" &&
      passA.renderSetDigest === currentRenderSetDigest &&
      passA.captureSetDigest === captureSetDigest,
    passBBound: passB.verdict === "PASS" &&
      passB.renderSetDigest === currentRenderSetDigest &&
      passB.captureSetDigest === captureSetDigest,
  };
  if (!Object.values(checks).every(Boolean)) throw new Error("visual PASS binding changed");
  return {
    schemaVersion: 1,
    retained: true,
    newVisualPacketCreated: false,
    reason: "renderer, manifest, and all eight a1 capture bytes are unchanged",
    renderSetDigest: currentRenderSetDigest,
    captureSetDigest,
    sourceInventory,
    captures,
    passA: { verdict: passA.verdict, artifact: "T12/a2/pass-a/visual-pass-a.json" },
    passB: { verdict: passB.verdict, artifact: "T12/a2/pass-b/visual-pass-b.json" },
    checks,
  };
};
