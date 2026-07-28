import { open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { JobError } from "#jobs/errors";

export type AtomicBoundary =
  | "record-before-rename"
  | "head-before-rename"
  | "revision-head-before-rename";

export type AtomicWriteOptions = {
  readonly boundary?: AtomicBoundary;
  readonly failpoint?: AtomicBoundary | undefined;
};

export const atomicWrite = async (
  target: string,
  bytes: Uint8Array,
  options: AtomicWriteOptions = {}
): Promise<void> => {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  let closed = false;
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    closed = true;
    if (options.boundary !== undefined && options.failpoint === options.boundary) {
      throw new JobError("ATOMIC_WRITE_INTERRUPTED", "write interrupted before acceptance", options.boundary);
    }
    await rename(temporary, target);
    const directory = await open(path.dirname(target), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    if (!closed) await handle.close();
    await rm(temporary, { force: true });
  }
};
