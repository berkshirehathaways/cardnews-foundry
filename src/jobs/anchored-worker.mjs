import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";

const [jobId, scope, operation, name = "", optionsText = "{}"] = process.argv.slice(2);

class WorkerFailure extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const fail = (code, message, details) => {
  throw new WorkerFailure(code, message, details);
};

const safeName = (value) => {
  if (value.length === 0 || value === "." || value === ".." || value.includes("/") || value.includes("\\")) {
    fail("PATH_ESCAPE", "anchored file name must be a single safe segment", value);
  }
  return value;
};

const readNoFollow = (target) => {
  const descriptor = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
};

try {
  const scopeSegments = scope === "job" ? [] : scope.split("/");
  if (scopeSegments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    fail("PATH_ESCAPE", "anchored directory scope is invalid", scope);
  }
  const headTarget = `${"../".repeat(scopeSegments.length)}head.json`;
  let head;
  try {
    head = JSON.parse(readNoFollow(headTarget).toString("utf8"));
  } catch (error) {
    if (error?.code === "ELOOP") fail("SYMLINK_ESCAPE", "job head must not be a symbolic link");
    fail(error?.code ?? "JOB_IDENTITY_MISMATCH", "failed to verify anchored job identity");
  }
  if (head?.jobId !== jobId) {
    fail("JOB_IDENTITY_MISMATCH", "anchored directory belongs to a different job", {
      expected: jobId,
      actual: head?.jobId
    });
  }
  const options = JSON.parse(optionsText);
  if (operation === "read") {
    process.stdout.write(readNoFollow(safeName(name)));
  } else if (operation === "list") {
    process.stdout.write(JSON.stringify(readdirSync(".")));
  } else if (operation === "create-exclusive") {
    const target = safeName(name);
    const temporary = `.${target}.${randomUUID()}.tmp`;
    const descriptor = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      typeof options.mode === "number" ? options.mode : 0o600
    );
    let closed = false;
    try {
      writeFileSync(descriptor, readFileSync(0));
      fsyncSync(descriptor);
      closeSync(descriptor);
      closed = true;
      try {
        linkSync(temporary, target);
        process.stdout.write("created");
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        process.stdout.write("exists");
      }
    } finally {
      if (!closed) closeSync(descriptor);
      rmSync(temporary, { force: true });
    }
  } else if (operation === "atomic-write") {
    const target = safeName(name);
    const temporary = `.${target}.${randomUUID()}.tmp`;
    const descriptor = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    );
    let closed = false;
    try {
      writeFileSync(descriptor, readFileSync(0));
      fsyncSync(descriptor);
      closeSync(descriptor);
      closed = true;
      if (options.boundary !== undefined && options.failpoint === options.boundary) {
        fail("ATOMIC_WRITE_INTERRUPTED", "write interrupted before acceptance", options.boundary);
      }
      renameSync(temporary, target);
      const directory = openSync(".", constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    } finally {
      if (!closed) closeSync(descriptor);
      rmSync(temporary, { force: true });
    }
  } else if (operation === "remove") {
    rmSync(safeName(name), { force: options.force === true });
  } else if (operation === "mkdir") {
    const target = safeName(name);
    try {
      mkdirSync(target, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const stats = lstatSync(target);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        fail("SYMLINK_ESCAPE", "anchored directory target must be a real directory", target);
      }
    }
  } else if (operation === "rename-remove") {
    const target = safeName(name);
    const temporary = safeName(options.temporary);
    renameSync(target, temporary);
    rmSync(temporary, { force: true });
  } else {
    fail("UNSUPPORTED_ANCHORED_OPERATION", "unknown anchored filesystem operation", operation);
  }
} catch (error) {
  const code = error?.code === "ELOOP" ? "SYMLINK_ESCAPE" : error?.code ?? "ANCHORED_IO_FAILED";
  const message = error?.code === "ELOOP"
    ? "anchored file must not be a symbolic link"
    : error instanceof Error ? error.message : "anchored I/O failed";
  process.stderr.write(JSON.stringify({
    code,
    message,
    details: error instanceof WorkerFailure ? error.details : name
  }));
  process.exitCode = 1;
}
