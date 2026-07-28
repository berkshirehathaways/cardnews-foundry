import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import * as boundaryModule from "../../scripts/fixture-verifier-boundary.mjs";
import { makeFixtureCopy, manifest, stageEntry } from "./helpers.mjs";

const { createFileBoundary } = boundaryModule;

test("validated descriptor bytes remain bound to the checked inode after a path swap", async (context) => {
  const root = await makeFixtureCopy(context);
  const issues = [];
  const boundary = createFileBoundary({
    repositoryRoot: await realpath(root),
    issue: (code, subject) => issues.push({ code, subject })
  });
  const fixtureRoot = await boundary.resolveDirectory({
    relativePath: "fixtures/synthetic",
    subject: "fixture-root"
  });
  const fixtureManifest = await manifest(root);
  const entry = stageEntry(fixtureManifest, "EditorialBrief");
  const snapshot = await boundary.resolveFile({
    relativePath: entry.path,
    subject: entry.key,
    approvedRoot: fixtureRoot
  });
  assert.equal(Buffer.isBuffer(snapshot?.bytes), true, JSON.stringify(issues));
  const moved = path.join(root, "schemas/editorial-after-check.json");
  await rename(path.join(root, entry.path), moved);
  await symlink("../../../schemas/editorial-after-check.json", path.join(root, entry.path));
  assert.equal(createHash("sha256").update(snapshot.bytes).digest("hex"), entry.sha256);
  assert.deepEqual(issues, []);
});

for (const [scenario, mutatePath] of [
  ["replacement", async (file) => {
    await rename(file, `${file}.captured`);
    await writeFile(file, "{}");
  }],
  ["unlink", (file) => rm(file)],
  ["permission denial", (file) => chmod(file, 0)]
]) {
  test(`Given a validated snapshot with an absolute path, When the pathname undergoes ${scenario} before final audit, Then the captured bytes are still rejected`, async (context) => {
    const root = await makeFixtureCopy(context);
    const issues = [];
    const boundary = createFileBoundary({
      repositoryRoot: await realpath(root),
      issue: (code, subject) => issues.push({ code, subject })
    });
    const fixtureRoot = await boundary.resolveDirectory({
      relativePath: "fixtures/synthetic",
      subject: "fixture-root"
    });
    const relativePath = "fixtures/synthetic/records/editorial-brief.json";
    const file = path.join(root, relativePath);
    await writeFile(file, '{"path":"/tmp/private"}');
    const snapshot = await boundary.resolveFile({
      relativePath,
      subject: "record:EditorialBrief",
      approvedRoot: fixtureRoot
    });
    assert.equal(Buffer.isBuffer(snapshot?.bytes), true, JSON.stringify(issues));
    await mutatePath(file);

    assert.equal(typeof boundaryModule.auditAbsolutePaths, "function",
      "the final audit must accept validated snapshots instead of reopening paths");
    boundaryModule.auditAbsolutePaths({ snapshots: [snapshot], issue: (code, subject) => issues.push({ code, subject }) });

    assert.deepEqual(issues, [{ code: "ABSOLUTE_PATH_FORBIDDEN", subject: relativePath }]);
  });
}
