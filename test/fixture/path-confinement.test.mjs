import assert from "node:assert/strict";
import { chmod, link, mkdir, rename, symlink } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  errorCodes,
  makeFixtureCopy,
  manifest,
  runVerifier,
  stageEntry,
  writeCanonicalJson
} from "./helpers.mjs";

const expectPathFailure = (result, code) => {
  assert.equal(result.status, 1, result.stdout);
  assert.equal(errorCodes(result).has(code), true, result.stdout);
};

test("record symlink resolving outside the fixture is rejected", async (context) => {
  const root = await makeFixtureCopy(context);
  const relative = "fixtures/synthetic/records/editorial-brief.json";
  const outside = "schemas/t07-editorial-brief.json";
  await rename(path.join(root, relative), path.join(root, outside));
  await symlink("../../../schemas/t07-editorial-brief.json", path.join(root, relative));
  expectPathFailure(runVerifier(root), "SYMLINK_FORBIDDEN");
});

test("record symlink resolving inside the fixture is rejected", async (context) => {
  const root = await makeFixtureCopy(context);
  const relative = "fixtures/synthetic/records/editorial-brief.json";
  const target = "fixtures/synthetic/records/editorial-brief-real.json";
  await rename(path.join(root, relative), path.join(root, target));
  await symlink("editorial-brief-real.json", path.join(root, relative));
  expectPathFailure(runVerifier(root), "SYMLINK_FORBIDDEN");
});

test("symlinked parent directory in a record path is rejected", async (context) => {
  const root = await makeFixtureCopy(context);
  const records = path.join(root, "fixtures/synthetic/records");
  const target = path.join(root, "fixtures/synthetic/record-files");
  await rename(records, target);
  await symlink("record-files", records);
  expectPathFailure(runVerifier(root), "SYMLINK_FORBIDDEN");
});

test("two manifest record paths cannot alias the same inode through hard links", async (context) => {
  const root = await makeFixtureCopy(context);
  const fixtureManifest = await manifest(root);
  const editorial = stageEntry(fixtureManifest, "EditorialBrief");
  const storyboard = stageEntry(fixtureManifest, "Storyboard");
  const alias = "fixtures/synthetic/records/editorial-hard-alias.json";
  await link(path.join(root, editorial.path), path.join(root, alias));
  storyboard.path = alias;
  storyboard.sha256 = editorial.sha256;
  storyboard.byteCount = editorial.byteCount;
  await writeCanonicalJson(root, "fixtures/synthetic/manifest.json", fixtureManifest);
  expectPathFailure(runVerifier(root), "FILE_IDENTITY_ALIAS");
});

test("a manifest record cannot hard-link to a file outside the fixture", async (context) => {
  const root = await makeFixtureCopy(context);
  const relative = "fixtures/synthetic/records/editorial-brief.json";
  const outside = "schemas/t07-editorial-hard-link.json";
  await rename(path.join(root, relative), path.join(root, outside));
  await link(path.join(root, outside), path.join(root, relative));
  expectPathFailure(runVerifier(root), "FILE_IDENTITY_ALIAS");
});

test("manifest resource paths reject symlink files", async (context) => {
  const root = await makeFixtureCopy(context);
  const fixtureManifest = await manifest(root);
  const theme = fixtureManifest.resources.theme;
  const original = path.join(root, theme.path);
  const real = original.replace(".json", "-real.json");
  await rename(original, real);
  await symlink(path.basename(real), original);
  expectPathFailure(runVerifier(root), "SYMLINK_FORBIDDEN");
});

test("manifest descriptors must resolve to regular files", async (context) => {
  const root = await makeFixtureCopy(context);
  const fixtureManifest = await manifest(root);
  const directory = "fixtures/synthetic/not-a-file";
  await mkdir(path.join(root, directory));
  fixtureManifest.source.path = directory;
  await writeCanonicalJson(root, "fixtures/synthetic/manifest.json", fixtureManifest);
  expectPathFailure(runVerifier(root), "FILE_NOT_REGULAR");
});

test("Given a required descriptor cannot be read, When the public verifier runs, Then it fails with FILE_READ_FAILED", async (context) => {
  const root = await makeFixtureCopy(context);
  const fixtureManifest = await manifest(root);
  const record = stageEntry(fixtureManifest, "EditorialBrief");
  await chmod(path.join(root, record.path), 0);

  expectPathFailure(runVerifier(root), "FILE_READ_FAILED");
});
