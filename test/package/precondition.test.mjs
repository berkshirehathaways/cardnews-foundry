import assert from "node:assert/strict";
import test from "node:test";
import { GATE_IDS } from "../../src/evaluate/index.mjs";
import { isAcceptedDeterministicReport } from "../../src/package/job.mjs";

const visualIndex = GATE_IDS.indexOf("visual-pass-a");
const deterministicGates = GATE_IDS.slice(0, visualIndex).map((id) => ({
  id,
  status: "pass",
}));

test("Given the exact passing deterministic gate prefix, When package eligibility is checked, Then the baseline report is accepted", () => {
  // Given
  const report = { blocking: false, gates: deterministicGates };

  // When
  const accepted = isAcceptedDeterministicReport(report);

  // Then
  assert.equal(accepted, true);
});

test("Given an extra visual gate in the accepted evaluation record, When package eligibility is checked, Then the non-deterministic record is rejected", () => {
  // Given
  const report = {
    blocking: false,
    gates: [
      ...deterministicGates,
      { id: "visual-pass-a", status: "pass" },
    ],
  };

  // When
  const accepted = isAcceptedDeterministicReport(report);

  // Then
  assert.equal(accepted, false);
});
