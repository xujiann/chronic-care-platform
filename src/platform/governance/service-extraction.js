"use strict";

const scorecard = require("../../../config/service-extraction-scorecard.json");

function evaluateCandidate(candidate, policy = scorecard) {
  const dimensions = policy.dimensions || [];
  const scores = candidate?.scores || {};
  const invalid = dimensions.filter((name) => !Number.isInteger(scores[name]) || scores[name] < 0 || scores[name] > 5);
  if (invalid.length > 0) throw new TypeError(`invalid service extraction scores: ${invalid.join(", ")}`);
  const total = dimensions.reduce((sum, name) => sum + scores[name], 0);
  const minimumsMet = Object.entries(policy.minimumDimensions || {})
    .every(([name, minimum]) => scores[name] >= minimum);
  const blockers = Array.isArray(candidate.blockers) ? candidate.blockers : [];
  const eligible = total >= policy.decisionThreshold && minimumsMet && blockers.length === 0;
  return Object.freeze({
    domain: candidate.domain,
    total,
    eligible,
    recommendation: eligible ? "extract-service" : "modular-monolith",
    blockers: Object.freeze([...blockers])
  });
}

function validateScorecard(policy = scorecard) {
  if (!Array.isArray(policy.dimensions) || policy.dimensions.length < 3) {
    throw new TypeError("service extraction policy requires dimensions");
  }
  const results = (policy.candidates || []).map((candidate) => evaluateCandidate(candidate, policy));
  results.forEach((result, index) => {
    if (policy.candidates[index].decision !== result.recommendation) {
      throw new Error(`service extraction decision drift: ${result.domain}`);
    }
  });
  return Object.freeze(results);
}

module.exports = { evaluateCandidate, validateScorecard };
