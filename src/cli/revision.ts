import type { JobHandle } from "../jobs/index.ts";
import {
  createAnchoredExclusive,
  listAnchored,
  mkdirAnchored,
  readAnchoredBytes,
  readAnchoredText
} from "#jobs/anchored";
import {
  ensureJobDirectories,
  readJobMetadata,
  writeJobMetadata
} from "./job.ts";

const copyAssets = async (original: JobHandle, revision: JobHandle): Promise<void> => {
  for (const digest of await listAnchored(original, "assets")) {
    if (!/^[a-f0-9]{64}$/u.test(digest)) throw new Error("asset directory is malformed");
    const scope = `assets/${digest}` as const;
    const names = [...await listAnchored(original, scope)].sort();
    const assetNames = names.filter((name) => /^asset\.(?:jpg|png)$/u.test(name));
    if (
      names.length !== 2 ||
      !names.includes("metadata.json") ||
      assetNames.length !== 1
    ) {
      throw new Error("asset inventory is malformed");
    }
    await mkdirAnchored(revision, "assets", digest);
    for (const name of names) {
      const created = await createAnchoredExclusive(
        revision,
        scope,
        name,
        await readAnchoredBytes(original, scope, name),
        0o400
      );
      if (!created) throw new Error("revision asset already exists");
    }
  }
};

const copySourceEvidence = async (original: JobHandle, revision: JobHandle): Promise<void> => {
  const evidence = await readAnchoredText(original, "source", "evidence.json");
  const parsed: unknown = JSON.parse(evidence);
  if (
    typeof parsed !== "object" || parsed === null ||
    !("rawPath" in parsed) || typeof parsed.rawPath !== "string"
  ) {
    throw new Error("source evidence is malformed");
  }
  const rawMatch = /^source\/raw\/([a-f0-9]{64})\.bin$/u.exec(parsed.rawPath);
  if (rawMatch === null) throw new Error("source evidence path is malformed");
  const rawName = `${rawMatch[1]}.bin`;
  const created = await Promise.all([
    createAnchoredExclusive(
      revision,
      "source/raw",
      rawName,
      await readAnchoredBytes(original, "source/raw", rawName),
      0o400
    ),
    createAnchoredExclusive(
      revision,
      "source/extracted",
      "source-envelope.json",
      new TextEncoder().encode(
        await readAnchoredText(original, "source/extracted", "source-envelope.json")
      ),
      0o400
    ),
    createAnchoredExclusive(
      revision,
      "source",
      "evidence.json",
      new TextEncoder().encode(evidence),
      0o400
    )
  ]);
  if (created.some((accepted) => !accepted)) throw new Error("revision source evidence already exists");
};

export const prepareRecordRevision = async (
  original: JobHandle,
  revision: JobHandle
): Promise<void> => {
  const metadata = await readJobMetadata(original);
  await ensureJobDirectories(revision);
  await writeJobMetadata(revision, { ...metadata, revision: revision.revision });
  await copySourceEvidence(original, revision);
  await copyAssets(original, revision);
};
