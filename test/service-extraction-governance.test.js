"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const scorecard = require("../config/service-extraction-scorecard.json");
const { evaluateCandidate, validateScorecard } = require("../src/platform/governance/service-extraction");

test("current service candidates remain inside the modular monolith", () => {
  const results = validateScorecard();
  assert.equal(results.length, 3);
  assert.equal(results.every((item) => item.recommendation === "modular-monolith"), true);
});

test("service extraction requires score minimums and zero blockers", () => {
  const eligible = evaluateCandidate({
    domain: "example",
    scores: Object.fromEntries(scorecard.dimensions.map((name) => [name, 4])),
    blockers: []
  });
  assert.equal(eligible.eligible, true);
  assert.equal(eligible.recommendation, "extract-service");

  const blocked = evaluateCandidate({
    domain: "example",
    scores: Object.fromEntries(scorecard.dimensions.map((name) => [name, 5])),
    blockers: ["production-evidence-incomplete"]
  });
  assert.equal(blocked.eligible, false);
});
