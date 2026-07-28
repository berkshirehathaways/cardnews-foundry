import { randomUUID } from "node:crypto";
import { chmod, link, open, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { PackageError } from "./errors.mjs";

const sameBytes = (left, right) =>
  left.length === right.length && left.every((byte, index) => byte === right[index]);

export const publishImmutable = async ({ target, bytes, failpoint }) => {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o400);
  let closed = false;
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    closed = true;
    if (failpoint === "before-publish") {
      throw new PackageError("PACKAGE_WRITE_INTERRUPTED", "package publication was interrupted");
    }
    try {
      await link(temporary, target);
      await chmod(target, 0o444);
      return { reused: false };
    } catch (error) {
      if (error instanceof Error && Reflect.get(error, "code") === "EEXIST") {
        if (sameBytes(await readFile(target), bytes)) return { reused: true };
        throw new PackageError("PACKAGE_IMMUTABLE", "accepted package bytes are immutable");
      }
      throw error;
    }
  } finally {
    if (!closed) await handle.close();
    await rm(temporary, { force: true });
  }
};

