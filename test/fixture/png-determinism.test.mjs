import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { makeSyntheticPng } from "../../fixtures/synthetic/png.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("synthetic PNG bytes do not depend on the host zlib implementation", () => {
  assert.equal(
    sha256(makeSyntheticPng(0)),
    "554a2698b99addfd629a64dccf696da9ed4f4cd7f17c01b984ff2a679d92290b",
  );
  assert.equal(
    sha256(makeSyntheticPng(1)),
    "b6baa3052899c6707fca66b9532e764921425aad4b4e51b419fd9a318950ff5f",
  );
});
