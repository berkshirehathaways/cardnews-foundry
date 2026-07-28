import assert from "node:assert/strict";
import test from "node:test";
import {
  freshCreateOutcomePassed,
  selectForwardContextSpecs,
} from "../../scripts/qa-forward.mjs";

const completedChecks = {
  statusExit: true,
  acceptedStages: true,
  sevenCurrentCards: true,
  contactSheet: true,
  renderInventoryCurrent: true,
  evaluationAccepted: true,
  packageBoundary: false,
};

test("Given the fresh-create selector, When forward contexts are selected, Then exactly one fresh Codex workflow runs", () => {
  // Given
  const specs = [
    { scenario: "fresh-create" },
    { scenario: "interrupted-resume" },
  ];

  // When
  const selected = selectForwardContextSpecs(specs, "fresh-create");

  // Then
  assert.deepEqual(selected, [{ scenario: "fresh-create" }]);
});

test("Given no forward context selector, When forward contexts are selected, Then all existing contexts remain enabled", () => {
  // Given
  const specs = [{ scenario: "fresh-create" }, { scenario: "interrupted-resume" }];

  // When
  const selected = selectForwardContextSpecs(specs);

  // Then
  assert.deepEqual(selected, specs);
});

test("Given the skip selector, When forward contexts are selected, Then no fresh Codex workflow runs", () => {
  // Given
  const specs = [{ scenario: "fresh-create" }, { scenario: "interrupted-resume" }];

  // When
  const selected = selectForwardContextSpecs(specs, "skip");

  // Then
  assert.deepEqual(selected, []);
});

test("Given a fully accepted fresh-create job with a completed package, When its F4 filesystem outcome is assessed, Then the seven-card evaluation passes", () => {
  // Given
  const outcome = {
    candidateCount: 1,
    candidates: [{ packageExit: 0, checks: completedChecks }],
  };

  // When
  const passed = freshCreateOutcomePassed(outcome);

  // Then
  assert.equal(passed, true);
});

test("Given a fresh-create job without an accepted evaluation, When its F4 filesystem outcome is assessed, Then it fails", () => {
  // Given
  const outcome = {
    candidateCount: 1,
    candidates: [{
      packageExit: 0,
      checks: { ...completedChecks, evaluationAccepted: false },
    }],
  };

  // When
  const passed = freshCreateOutcomePassed(outcome);

  // Then
  assert.equal(passed, false);
});

test("Given one recovered accepted job beside an incomplete fresh attempt, When its F4 filesystem outcome is assessed, Then the completed job passes", () => {
  // Given
  const outcome = {
    candidateCount: 2,
    candidates: [
      { packageExit: 0, checks: completedChecks },
      {
        packageExit: 6,
        checks: {
          statusExit: true,
          acceptedStages: false,
          sevenCurrentCards: false,
          contactSheet: false,
          renderInventoryCurrent: false,
          evaluationAccepted: false,
          packageBoundary: false,
        },
      },
    ],
  };

  // When
  const passed = freshCreateOutcomePassed(outcome);

  // Then
  assert.equal(passed, true);
});

test("Given two fully accepted fresh-create jobs, When their F4 filesystem outcome is assessed, Then the contaminated workspace fails", () => {
  // Given
  const outcome = {
    candidateCount: 2,
    candidates: [
      { packageExit: 0, checks: completedChecks },
      { packageExit: 0, checks: completedChecks },
    ],
  };

  // When
  const passed = freshCreateOutcomePassed(outcome);

  // Then
  assert.equal(passed, false);
});

test("Given an accepted fresh-create job without a completed package, When its F4 filesystem outcome is assessed, Then the incomplete prompt fails", () => {
  // Given
  const outcome = {
    candidateCount: 1,
    candidates: [{ packageExit: 6, checks: completedChecks }],
  };

  // When
  const passed = freshCreateOutcomePassed(outcome);

  // Then
  assert.equal(passed, false);
});
