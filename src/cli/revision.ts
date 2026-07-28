import { cp, readdir } from "node:fs/promises";
import path from "node:path";
import type { JobHandle } from "../jobs/index.ts";
import {
  createAnchoredExclusive,
  readAnchoredBytes,
  readAnchoredText
} from "#jobs/anchored";
import { resolveJobTarget } from "#jobs/paths";
import {
  ensureJobDirectories,
  readJobMetadata,
  writeJobMetadata
} from "./job.ts";

const copyDirectoryEntries = async (
  original: JobHandle,
  relativeDirectory: string,
  destination: string
): Promise<void> => {
  const source = await resolveJobTarget(original, relativeDirectory);
  for (const name of await readdir(source)) {
    await resolveJobTarget(original, path.join(relativeDirectory, name));
    await cp(path.join(source, name), path.join(destination, name), {
      recursive: true,
      errorOnExist: true
    });
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
  await copyDirectoryEntries(original, "assets", path.join(revision.path, "assets"));
};
