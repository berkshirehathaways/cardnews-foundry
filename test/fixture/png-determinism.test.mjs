import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { makeSyntheticPng } from "../../fixtures/synthetic/png.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("synthetic PNG bytes do not depend on the host zlib implementation", () => {
  assert.equal(
    sha256(makeSyntheticPng(0)),
    "3daf4b20cf09ac9b7218f1f0506e1e9171b3114e92ae4a35b949996ebc189a3d",
  );
  assert.equal(
    sha256(makeSyntheticPng(1)),
    "c44bbd1f114b33171aa4b311b0ea1a566e0b3b73ea1848bac7621df6bbcfbd51",
  );
});
