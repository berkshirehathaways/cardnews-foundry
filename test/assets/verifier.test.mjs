import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("Given the public asset verifier, When its isolated filesystem scenario runs, Then all acceptance, rejection, and cleanup cases pass", async () => {
  // Given
  const command = path.join(root, "scripts", "verify-assets.mjs");

  // When
  const { stdout } = await execFileAsync(process.execPath, [command], {
    cwd: root,
    encoding: "utf8"
  });
  const result = JSON.parse(stdout);

  // Then
  assert.equal(result.ok, true);
  assert.equal(Object.values(result.cases).every(Boolean), true);
  assert.deepEqual(result.cleanup, {
    rootRemoved: true,
    temporaryFiles: 0,
    acceptedPartials: 0,
    specialNodes: 0,
    childProcesses: 0
  });
  assert.deepEqual(result.rejections, {
    mislabeled: "ASSET_SIGNATURE_UNSUPPORTED",
    traversal: "ASSET_PATH_ESCAPE",
    missingRights: "ASSET_RIGHTS_MISSING",
    slotMismatch: "ASSET_SLOT_BINDING_MISMATCH",
    interruption: "ASSET_WRITE_INTERRUPTED",
    publicUnknown: "ASSET_PUBLIC_PACKAGE_BLOCKED",
    duplicateSlot: "ASSET_SLOT_DUPLICATE",
    corruptIdat: "PNG_IDAT_INVALID",
    destinationSymlink: "ASSET_SYMLINK_FORBIDDEN",
    destinationTamper: "ASSET_DIGEST_CONFLICT"
  });
});
