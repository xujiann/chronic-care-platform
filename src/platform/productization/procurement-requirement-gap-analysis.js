"use strict";

const defaultRegistry = require("../../../config/platform-capability-registry.json");
const { validateCapabilityRegistry } = require("./procurement-requirement-contracts");

const GAP_BY_COVERAGE = Object.freeze({
  "repository-verified": "covered-in-repository",
  "declared-only": "unverified",
  missing: "missing",
  "external-evidence-required": "external-evidence-required"
});

function analyzeRequirementGap(requirement, registry = defaultRegistry, options = {}) {
  validateCapabilityRegistry(registry, options);
  const capabilities = new Map(registry.capabilities.map((item) => [item.id, item]));
  const mappings = requirement.targetCapabilityIds.map((id) => {
    const capability = capabilities.get(id);
    return Object.freeze({
      capabilityId: id,
      capabilityTitle: capability?.title || "未登记能力",
      coverage: capability?.coverage || "missing",
      gap: GAP_BY_COVERAGE[capability?.coverage] || "missing",
      evidenceCount: capability?.evidence?.length || 0,
      productionReady: false
    });
  });
  const gaps = new Set(mappings.map((item) => item.gap));
  const overall = gaps.has("missing") ? "missing"
    : gaps.has("unverified") ? "unverified"
      : gaps.has("external-evidence-required") ? "external-evidence-required"
        : "covered-in-repository";
  return Object.freeze({
    requirementId: requirement.id,
    overall,
    mappings: Object.freeze(mappings),
    productionReady: false
  });
}

module.exports = { GAP_BY_COVERAGE, analyzeRequirementGap };
