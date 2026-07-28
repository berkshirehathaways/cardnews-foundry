import { cp, readdir } from "node:fs/promises";
import path from "node:path";
import type { JobHandle } from "../jobs/index.ts";
import {
  ensureJobDirectories,
  readJobMetadata,
  writeJobMetadata
} from "./job.ts";

const copyDirectoryEntries = async (source: string, destination: string): Promise<void> => {
  for (const name of await readdir(source)) {
    await cp(path.join(source, name), path.join(destination, name), {
      recursive: true,
      errorOnExist: true
    });
  }
};

export const prepareRecordRevision = async (
  original: JobHandle,
  revision: JobHandle
): Promise<void> => {
  const metadata = await readJobMetadata(original);
  await ensureJobDirectories(revision);
  await writeJobMetadata(revision, { ...metadata, revision: revision.revision });
  await copyDirectoryEntries(path.join(original.path, "source"), path.join(revision.path, "source"));
  await copyDirectoryEntries(path.join(original.path, "assets"), path.join(revision.path, "assets"));
};
