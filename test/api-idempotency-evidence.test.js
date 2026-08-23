"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DEFAULT_REGISTRY,
  actionSliceEvidenceContracts,
  endpointEvidenceContracts,
  proofRequiredReviews,
  validateEvidenceRegistry
} = require("../scripts/api-idempotency-evidence");
const { buildProductionApiCatalog } = require("../scripts/production-api-catalog");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("idempotency evidence registry validates only directly proven endpoint and action-slice contracts", () => {
  assert.deepEqual(validateEvidenceRegistry(), []);
  assert.equal(DEFAULT_REGISTRY.contracts.length, 8);
  assert.equal(endpointEvidenceContracts().length, 6);
  assert.equal(actionSliceEvidenceContracts().length, 2);
  assert.equal(proofRequiredReviews().length, 2);
  assert.equal(DEFAULT_REGISTRY.contracts[0].key, "POST /api/auth/sms-delivery-callback");
  assert.equal(DEFAULT_REGISTRY.contracts[0].owner, "T01");
  assert.equal(DEFAULT_REGISTRY.contracts.every((contract) => contract.productionReady === false), true);
  assert.equal(DEFAULT_REGISTRY.contracts.every((contract) => contract.idempotency.distributedExactlyOnceClaimed === false), true);
  assert.deepEqual(DEFAULT_REGISTRY.contracts.filter((contract) => contract.customAuthenticationEvidence).map((contract) => contract.key), [
    "POST /api/auth/sms-delivery-callback"
  ]);
  assert.deepEqual(DEFAULT_REGISTRY.contracts.map((contract) => contract.key), [
    "POST /api/auth/sms-delivery-callback",
    "POST /api/regional-data-sharing/access-reviews",
    "POST /api/referrals/:id/actions",
    "POST /api/workflow-actions",
    "POST /api/tasks/:id/actions",
    "POST /api/research/compliant-exports/:id/actions",
    "POST /api/online-payments/refunds",
    "POST /api/financial-gateways/reconciliation-runs"
  ]);
});

test("remaining reviewed T07 candidates stay proof-required after reconciliation closure", () => {
  const expected = [
    "POST /api/financial-gateways/dispatch",
    "POST /api/disease-payment/formal-grouping/jobs"
  ];
  assert.deepEqual(proofRequiredReviews().map((review) => review.key), expected);

  const catalog = buildProductionApiCatalog();
  for (const key of expected) {
    assert.equal(DEFAULT_REGISTRY.contracts.some((contract) => contract.key === key), false, key);
    const entry = catalog.entries.find((candidate) => candidate.key === key);
    assert.ok(entry, key);
    assert.equal(entry.idempotency.behaviorEvidence.status, "behavior-proof-required", key);
    assert.equal(entry.production.repositoryReview, "review-required", key);
    assert.equal(entry.production.status, "NO-GO", key);
  }
});

test("catalog promotes only whole endpoints and retains generic action routes as review-required", () => {
  const catalog = buildProductionApiCatalog();
  assert.equal(catalog.summary.writeIdempotencyBehaviorVerified, 6);
  assert.equal(catalog.summary.writeIdempotencyActionSlicesVerified, 2);
  assert.equal(catalog.summary.writeIdempotencyBehaviorProofRequired, 327);
  assert.equal(catalog.summary.reviewRequired, 329);

  for (const key of [
    "POST /api/auth/sms-delivery-callback",
    "POST /api/regional-data-sharing/access-reviews",
    "POST /api/referrals/:id/actions",
    "POST /api/research/compliant-exports/:id/actions",
    "POST /api/online-payments/refunds",
    "POST /api/financial-gateways/reconciliation-runs"
  ]) {
    const entry = catalog.entries.find((candidate) => candidate.key === key);
    assert.equal(entry.idempotency.behaviorEvidence.status, "behavior-verified", key);
    assert.equal(entry.production.status, "NO-GO", key);
    assert.equal(entry.production.externalEvidenceRequired, true, key);
  }

  for (const key of ["POST /api/workflow-actions", "POST /api/tasks/:id/actions"]) {
    const entry = catalog.entries.find((candidate) => candidate.key === key);
    assert.equal(entry.idempotency.behaviorEvidence.status, "behavior-proof-required", key);
    assert.equal(entry.idempotency.behaviorEvidence.verifiedActionContracts.length, 1, key);
    assert.equal(entry.production.repositoryReview, "review-required", key);
    assert.equal(entry.production.blockers.includes("idempotency-behavior-proof-required"), true, key);
  }

  const regional = catalog.entries.find((entry) => entry.key === "POST /api/regional-data-sharing/access-reviews");
  assert.equal(regional.owner, "T02");
  assert.equal(regional.highRisk, true);
  const researchCreate = catalog.entries.find((entry) => entry.key === "POST /api/research/datasets/:id/compliant-exports");
  assert.equal(researchCreate.idempotency.behaviorEvidence.status, "behavior-proof-required");
  assert.deepEqual(researchCreate.idempotency.behaviorEvidence.verifiedActionContracts, []);
  const refund = catalog.entries.find((entry) => entry.key === "POST /api/online-payments/refunds");
  assert.equal(refund.production.repositoryReview, "review-required");
  assert.equal(refund.production.blockers.includes("runtime-role-policy-not-resolved"), true);
  const reconciliation = catalog.entries.find((entry) => entry.key === "POST /api/financial-gateways/reconciliation-runs");
  assert.equal(reconciliation.idempotency.behaviorEvidence.contractId, "insurance-payment.financial-reconciliation-command.v1");
  assert.equal(reconciliation.production.repositoryReview, "catalogued");
  assert.equal(reconciliation.production.status, "NO-GO");
  for (const runtimePolicy of catalog.entries.filter((entry) => entry.owner === "T07" && entry.routeResolution === "runtime-policy" && entry.idempotency.required)) {
    assert.equal(runtimePolicy.idempotency.behaviorEvidence.status, "behavior-proof-required", runtimePolicy.key);
    assert.deepEqual(runtimePolicy.idempotency.behaviorEvidence.verifiedActionContracts, [], runtimePolicy.key);
  }
});

test("idempotency evidence registry rejects marker promotion, production promotion and missing executable evidence", () => {
  const markerPromotion = clone(DEFAULT_REGISTRY);
  markerPromotion.policy.sourceMarkersAreBehaviorProof = true;
  assert.match(validateEvidenceRegistry(markerPromotion).join("\n"), /source markers must not be behavior proof/);

  const productionPromotion = clone(DEFAULT_REGISTRY);
  productionPromotion.contracts[0].productionReady = true;
  assert.match(validateEvidenceRegistry(productionPromotion).join("\n"), /production fail closed/);

  const missingTestAnchor = clone(DEFAULT_REGISTRY);
  missingTestAnchor.contracts[0].testEvidence[0].anchors.push("this executable assertion does not exist");
  assert.match(validateEvidenceRegistry(missingTestAnchor).join("\n"), /missing evidence anchor/);

  const duplicate = clone(DEFAULT_REGISTRY);
  duplicate.contracts.push(clone(duplicate.contracts[0]));
  assert.match(validateEvidenceRegistry(duplicate).join("\n"), /duplicate or missing contract id|duplicate or invalid evidence key/);

  const forgedEndpointCoverage = clone(DEFAULT_REGISTRY);
  forgedEndpointCoverage.contracts.find((contract) => contract.key === "POST /api/workflow-actions").coverage = {
    level: "endpoint",
    selector: "entire-route",
    actions: ["all"],
    unverifiedRemainder: true
  };
  assert.match(validateEvidenceRegistry(forgedEndpointCoverage).join("\n"), /endpoint evidence cannot retain an unverified remainder/);

  const missingCas = clone(DEFAULT_REGISTRY);
  delete missingCas.contracts.find((contract) => contract.key === "POST /api/referrals/:id/actions").concurrency.cas.field;
  assert.match(validateEvidenceRegistry(missingCas).join("\n"), /CAS field and conflict codes required/);

  const missingAudit = clone(DEFAULT_REGISTRY);
  delete missingAudit.contracts.find((contract) => contract.key === "POST /api/research/compliant-exports/:id/actions").audit.replay;
  assert.match(validateEvidenceRegistry(missingAudit).join("\n"), /audit behavior contract required/);

  const missingRefundConflict = clone(DEFAULT_REGISTRY);
  delete missingRefundConflict.contracts.find((contract) => contract.key === "POST /api/online-payments/refunds").idempotency.conflictingReuse;
  assert.match(validateEvidenceRegistry(missingRefundConflict).join("\n"), /replay and conflict behavior required/);

  const forgedReviewedPromotion = clone(DEFAULT_REGISTRY);
  forgedReviewedPromotion.contracts.push({
    ...clone(forgedReviewedPromotion.contracts[0]),
    contractId: "forged-reviewed-promotion",
    key: "POST /api/financial-gateways/dispatch",
    method: "POST",
    path: "/api/financial-gateways/dispatch"
  });
  assert.match(validateEvidenceRegistry(forgedReviewedPromotion).join("\n"), /cannot coexist with behavior contract/);

  const missingReviewReason = clone(DEFAULT_REGISTRY);
  missingReviewReason.reviewedProofRequired[0].missingProof = [];
  assert.match(validateEvidenceRegistry(missingReviewReason).join("\n"), /invalid proof-required review reasons/);

  const missingReviewAnchor = clone(DEFAULT_REGISTRY);
  missingReviewAnchor.reviewedProofRequired[0].evidence[0].anchors.push("this reviewed proof anchor does not exist");
  assert.match(validateEvidenceRegistry(missingReviewAnchor).join("\n"), /missing evidence anchor/);
});
