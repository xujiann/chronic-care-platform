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

function formalGroupingReviewFixture() {
  return {
    reviewId: "forged-formal-grouping-review",
    key: "POST /api/disease-payment/formal-grouping/jobs",
    method: "POST",
    path: "/api/disease-payment/formal-grouping/jobs",
    owner: "T07",
    domain: "insurance-payment",
    missingProof: ["resource-scope"],
    evidence: [{
      file: "src/http/routes/insurance-payment.js",
      anchors: ["function formalGroupingCreateScopeAllowed"]
    }],
    productionReady: false
  };
}

test("idempotency evidence registry validates only directly proven endpoint and action-slice contracts", () => {
  assert.deepEqual(validateEvidenceRegistry(), []);
  assert.equal(DEFAULT_REGISTRY.contracts.length, 42);
  assert.equal(endpointEvidenceContracts().length, 40);
  assert.equal(actionSliceEvidenceContracts().length, 2);
  assert.equal(proofRequiredReviews().length, 0);
  const smsContract = DEFAULT_REGISTRY.contracts.find((contract) => contract.key === "POST /api/auth/sms-delivery-callback");
  assert.equal(smsContract.owner, "T01");
  assert.equal(DEFAULT_REGISTRY.contracts.every((contract) => contract.productionReady === false), true);
  assert.equal(DEFAULT_REGISTRY.contracts.every((contract) => contract.idempotency.distributedExactlyOnceClaimed === false), true);
  assert.deepEqual(DEFAULT_REGISTRY.contracts.filter((contract) => contract.customAuthenticationEvidence).map((contract) => contract.key), [
    "POST /api/auth/sms-delivery-callback"
  ]);
  assert.deepEqual(DEFAULT_REGISTRY.contracts.map((contract) => contract.key), [
    "POST /api/ai-governance/rules/:id/actions",
    "POST /api/platform/productization/requirement-batches",
    "POST /api/platform/productization/requirements/:id/lifecycle-actions",
    "POST /api/platform/productization/requirements/:id/actions",
    "POST /api/auth/sms-delivery-callback",
    "POST /api/regional-data-sharing/access-reviews",
    "POST /api/referrals/:id/actions",
    "POST /api/workflow-actions",
    "POST /api/tasks/:id/actions",
    "POST /api/research/compliant-exports/:id/actions",
    "POST /api/online-payments/refunds",
    "POST /api/financial-gateways/dispatch",
    "POST /api/financial-gateways/reconciliation-runs",
    "POST /api/security/controls/:id/actions",
    "POST /api/quality-operations-governance/items/:id/actions",
    "POST /api/disease-payment/formal-grouping/jobs",
    "POST /api/operations/dispatch",
    "POST /api/operations/reconciliation/:id/review",
    "POST /api/quality-safety/issues/:id/dispatch",
    "POST /api/quality-safety/rectifications/:id/feedback",
    "POST /api/quality-safety/rectifications/:id/review",
    "POST /api/public-health/highlights/signals",
    "POST /api/drug-consumable-supervision/:id/review",
    "POST /api/drug-consumable-supervision/:id/remediation",
    "POST /api/drug-consumable-supervision/:id/insurance-sync",
    "POST /api/research/datasets/:id/approval",
    "POST /api/research/datasets/:id/evidence",
    "POST /api/research/datasets/:id/compliant-exports",
    "POST /api/research/datasets/:id/outcomes",
    "POST /api/research/datasets/:id/sandbox-access",
    "PATCH /api/chronic-management-plans/:id",
    "POST /api/chronic/followup-feedback",
    "POST /api/referral-teleconsultations",
    "POST /api/referral-teleconsultations/:id/actions",
    "POST /api/emergency-signals/deliveries/:eventId/replay",
    "PATCH /api/emergency-signals/:id",
    "POST /api/public-health/supervision/subjects",
    "POST /api/public-health/supervision/inspection-tasks",
    "POST /api/public-health/supervision/inspection-tasks/:id/actions",
    "POST /api/public-health/supervision/findings/:id/actions",
    "POST /api/physical-exams/specialized-intakes/:id/actions",
    "POST /api/access-reviews/:accessLogId/acknowledge"
  ]);
});

test("resident access acknowledgement has executable endpoint evidence without production or distributed claims", () => {
  const key = "POST /api/access-reviews/:accessLogId/acknowledge";
  const contract = DEFAULT_REGISTRY.contracts.find((candidate) => candidate.key === key);
  assert.ok(contract);
  assert.equal(contract.contractId, "citizen-chronic.resident-access-acknowledgement.v1");
  assert.equal(contract.method, "POST");
  assert.equal(contract.path, "/api/access-reviews/:accessLogId/acknowledge");
  assert.equal(contract.owner, "T04");
  assert.equal(contract.domain, "citizen-chronic");
  assert.equal(contract.customAuthenticationEvidence, false);
  assert.equal(contract.authentication.required, true);
  assert.deepEqual(contract.authentication, { required: true, mechanism: "bearer-or-cookie-session", principalType: "platform-user" });
  assert.equal(contract.authorization.model, "live-session-citizen-self-and-exact-access-event");
  assert.equal(contract.authorization.dataScope, "current authenticated resident only; no household proxy; original access audit and authorization remain unchanged");
  assert.deepEqual(contract.authorization.roles, ["citizen"]);
  assert.deepEqual(contract.coverage, { level: "endpoint", selector: "entire-route", actions: ["access-acknowledge"], unverifiedRemainder: false });
  assert.equal(contract.concurrency.cas.required, true);
  assert.equal(contract.concurrency.cas.field, "raw-snapshot SQLite collection versions; JSON authority digest under a same-process collection lock");
  assert.deepEqual(contract.concurrency.cas.conflictCodes, ["CARE_ACCESS_ACK_STORAGE_CONFLICT"]);
  assert.equal(contract.idempotency.distributedExactlyOnceClaimed, false);
  assert.equal(contract.productionReady, false);
  assert.equal(contract.externalEvidenceRequired, true);
  assert.equal(contract.idempotency.key, "header:Idempotency-Key and body:idempotencyKey must both be present, identical and 1-240 characters");
  assert.deepEqual(contract.idempotency.payloadBinding, ["actorId", "actorResidentId", "actorRole", "schemaVersion", "action", "accessLogId", "id", "residentId", "decision", "status", "acknowledgedAt", "requestedAt"]);
  assert.equal(contract.idempotency.conflictingReuse, "CARE_ACCESS_ACK_IDEMPOTENCY_CONFLICT");
  assert.equal(contract.idempotency.exactReplay, "revalidates non-production environment, current session, self scope and original event integrity before returning the persisted public receipt with status 200 and no declaration or command audit write; new declarations are refused at 2000, valid replay remains allowed and historical over-capacity is preserved without eviction");
  assert.deepEqual(contract.audit, {
    accepted: "adds one resident knowledge declaration, server-generated receipt and security audit; leaves dataAccessLogs and personalRecords unchanged",
    replay: "returns the original public receipt without another declaration, command audit or state write",
    rejected: "command-level rejection writes no declaration or command audit; existing authentication-layer rejection audit is preserved; commit failures preserve prior authoritative state"
  });
  assert.deepEqual(contract.testEvidence.map((item) => item.file).sort(), [
    "test/citizen-access-acknowledgement-api.test.js",
    "test/citizen-access-acknowledgement.test.js",
    "test/resident-access-acknowledgement-runtime.test.js"
  ]);
  for (const [file, anchors] of [
    ["test/citizen-access-acknowledgement.test.js", [
      "same-process concurrent replay creates one declaration and audit",
      "full 240-character keys work and distinct tails cannot alias"
    ]],
    ["test/citizen-access-acknowledgement-api.test.js", [
      "exact replay and duplicate/conflict preserve the first durable receipt",
      "a real SQLite writer racing the raw snapshot is rejected by persisted CAS",
      "SQLite injected failures roll back declaration, receipt and audit source together"
    ]],
    ["test/resident-access-acknowledgement-runtime.test.js", [
      "JSON runtime atomically persists one declaration and audit, then replays without replacing file",
      "a JSON writer after the authority snapshot is preserved and causes an explicit conflict"
    ]]
  ]) {
    const evidence = contract.testEvidence.find((item) => item.file === file);
    for (const anchor of anchors) assert.equal(evidence.anchors.includes(anchor), true, `${file}:${anchor}`);
  }
});

test("acknowledgement registry mutations are rejected by actual validator rules", () => {
  const key = "POST /api/access-reviews/:accessLogId/acknowledge";
  for (const [mutate, message] of [
    [(row) => { row.testEvidence[0].anchors.push("nonexistent acknowledgement executable assertion"); }, /missing evidence anchor/],
    [(row) => { row.testEvidence = []; }, /implementation and test evidence required/],
    [(row) => { delete row.concurrency.cas.field; }, /CAS field and conflict codes required/],
    [(row) => { delete row.idempotency.exactReplay; }, /replay and conflict behavior required/],
    [(row) => { delete row.idempotency.conflictingReuse; }, /replay and conflict behavior required/],
    [(row) => { delete row.audit.replay; }, /audit behavior contract required/],
    [(row) => { row.productionReady = true; }, /production fail closed/],
    [(row) => { row.externalEvidenceRequired = false; }, /production fail closed/],
    [(row) => { row.idempotency.distributedExactlyOnceClaimed = true; }, /distributed exactly-once must remain unclaimed/]
  ]) {
    const altered = clone(DEFAULT_REGISTRY);
    const row = altered.contracts.find((candidate) => candidate.key === key);
    assert.ok(row);
    mutate(row);
    assert.match(validateEvidenceRegistry(altered).join("\n"), message);
  }
});

test("specialized examination intake actions are promoted only as one complete three-action endpoint", () => {
  const key = "POST /api/physical-exams/specialized-intakes/:id/actions";
  const contract = DEFAULT_REGISTRY.contracts.find((candidate) => candidate.key === key);
  const entry = buildProductionApiCatalog().entries.find((candidate) => candidate.key === key);
  assert.equal(contract.contractId, "physical-examination.specialized-intake-action-command.v2");
  assert.deepEqual(contract.coverage.actions, ["assign-profile", "return-source", "close"]);
  assert.equal(contract.coverage.level, "endpoint");
  assert.equal(contract.coverage.unverifiedRemainder, false);
  assert.equal(contract.idempotency.distributedExactlyOnceClaimed, false);
  assert.equal(contract.productionReady, false);
  assert.equal(entry.idempotency.behaviorEvidence.status, "behavior-verified");
  assert.equal(entry.production.repositoryReview, "catalogued");
  assert.equal(entry.production.productionReady, false);
  assert.equal(entry.production.status, "NO-GO");
});

test("formal grouping create replaces the final reviewed T07 proof gap with endpoint evidence", () => {
  const key = "POST /api/disease-payment/formal-grouping/jobs";
  assert.equal(proofRequiredReviews().some((review) => review.key === key), false);
  const catalog = buildProductionApiCatalog();
  const contract = DEFAULT_REGISTRY.contracts.find((candidate) => candidate.key === key);
  const entry = catalog.entries.find((candidate) => candidate.key === key);
  assert.equal(contract.contractId, "insurance-payment.formal-grouping-create-command.v1");
  assert.equal(contract.idempotency.distributedExactlyOnceClaimed, false);
  assert.equal(entry.idempotency.behaviorEvidence.status, "behavior-verified");
  assert.equal(entry.production.repositoryReview, "catalogued");
  assert.equal(entry.production.status, "NO-GO");
});

test("procurement requirement review is promoted by stable endpoint behavior evidence", () => {
  const key = "POST /api/platform/productization/requirements/:id/actions";
  assert.deepEqual(proofRequiredReviews(), []);
  const contract = DEFAULT_REGISTRY.contracts.find((candidate) => candidate.key === key);
  assert.equal(contract.contractId, "platform-governance.procurement-requirement-review-command.v1");
  assert.equal(contract.coverage.level, "endpoint");
  const entry = buildProductionApiCatalog().entries.find((candidate) => candidate.key === key);
  assert.equal(entry.idempotency.behaviorEvidence.status, "behavior-verified");
  assert.equal(entry.production.repositoryReview, "catalogued");
  assert.equal(entry.production.productionReady, false);
});

test("catalog promotes only whole endpoints and retains generic action routes as review-required", () => {
  const catalog = buildProductionApiCatalog();
  assert.equal(catalog.summary.writeIdempotencyBehaviorVerified, 40);
  assert.equal(catalog.summary.writeIdempotencyActionSlicesVerified, 2);
  assert.equal(catalog.summary.writeIdempotencyBehaviorProofRequired,
    catalog.summary.writeRoutes - catalog.summary.writeIdempotencyBehaviorVerified);
  assert.equal(catalog.summary.reviewRequired,
    catalog.summary.writeIdempotencyBehaviorProofRequired + catalog.summary.writeIdempotencyActionSlicesVerified);
  assert.equal(catalog.summary.writeIdempotencyBehaviorProofRequired >= 308, true);

  for (const key of [
    "POST /api/ai-governance/rules/:id/actions",
    "POST /api/platform/productization/requirement-batches",
    "POST /api/platform/productization/requirements/:id/lifecycle-actions",
    "POST /api/platform/productization/requirements/:id/actions",
    "POST /api/auth/sms-delivery-callback",
    "POST /api/regional-data-sharing/access-reviews",
    "POST /api/referrals/:id/actions",
    "POST /api/research/compliant-exports/:id/actions",
    "POST /api/online-payments/refunds",
    "POST /api/financial-gateways/dispatch",
    "POST /api/financial-gateways/reconciliation-runs",
    "POST /api/security/controls/:id/actions",
    "POST /api/quality-operations-governance/items/:id/actions",
    "POST /api/disease-payment/formal-grouping/jobs",
    "POST /api/operations/dispatch",
    "POST /api/operations/reconciliation/:id/review",
    "POST /api/quality-safety/issues/:id/dispatch",
    "POST /api/quality-safety/rectifications/:id/feedback",
    "POST /api/quality-safety/rectifications/:id/review",
    "POST /api/public-health/highlights/signals",
    "POST /api/drug-consumable-supervision/:id/review",
    "POST /api/drug-consumable-supervision/:id/remediation",
    "POST /api/drug-consumable-supervision/:id/insurance-sync",
    "POST /api/research/datasets/:id/approval",
    "POST /api/research/datasets/:id/compliant-exports",
    "POST /api/research/datasets/:id/evidence",
    "POST /api/research/datasets/:id/outcomes",
    "POST /api/research/datasets/:id/sandbox-access",
    "PATCH /api/chronic-management-plans/:id",
    "POST /api/chronic/followup-feedback",
    "POST /api/referral-teleconsultations",
    "POST /api/referral-teleconsultations/:id/actions",
    "POST /api/emergency-signals/deliveries/:eventId/replay",
    "PATCH /api/emergency-signals/:id",
    "POST /api/public-health/supervision/subjects",
    "POST /api/public-health/supervision/inspection-tasks",
    "POST /api/public-health/supervision/inspection-tasks/:id/actions",
    "POST /api/public-health/supervision/findings/:id/actions",
    "POST /api/access-reviews/:accessLogId/acknowledge"
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
  assert.equal(researchCreate.idempotency.behaviorEvidence.status, "behavior-verified");
  assert.deepEqual(researchCreate.idempotency.behaviorEvidence.verifiedActionContracts, []);
  const refund = catalog.entries.find((entry) => entry.key === "POST /api/online-payments/refunds");
  assert.equal(refund.production.repositoryReview, "review-required");
  assert.equal(refund.production.blockers.includes("runtime-role-policy-not-resolved"), true);
  const reconciliation = catalog.entries.find((entry) => entry.key === "POST /api/financial-gateways/reconciliation-runs");
  assert.equal(reconciliation.idempotency.behaviorEvidence.contractId, "insurance-payment.financial-reconciliation-command.v1");
  assert.equal(reconciliation.production.repositoryReview, "catalogued");
  assert.equal(reconciliation.production.status, "NO-GO");
  const dispatch = catalog.entries.find((entry) => entry.key === "POST /api/financial-gateways/dispatch");
  assert.equal(dispatch.idempotency.behaviorEvidence.contractId, "insurance-payment.financial-dispatch-command.v1");
  assert.equal(dispatch.production.repositoryReview, "catalogued");
  assert.equal(dispatch.production.status, "NO-GO");
  const securityControl = catalog.entries.find((entry) => entry.key === "POST /api/security/controls/:id/actions");
  assert.equal(securityControl.idempotency.behaviorEvidence.contractId, "identity-security.security-control-action-command.v1");
  assert.deepEqual(securityControl.authorization.roles, ["commission"]);
  assert.equal(securityControl.production.repositoryReview, "catalogued");
  assert.equal(securityControl.production.status, "NO-GO");
  const qualityGovernance = catalog.entries.find((entry) => entry.key === "POST /api/quality-operations-governance/items/:id/actions");
  assert.equal(qualityGovernance.idempotency.behaviorEvidence.contractId, "platform-governance.quality-operations-item-action-command.v1");
  assert.deepEqual(qualityGovernance.authorization.roles, ["commission", "institution", "insurance"]);
  assert.equal(qualityGovernance.production.repositoryReview, "catalogued");
  assert.equal(qualityGovernance.production.status, "NO-GO");
  const formalGrouping = catalog.entries.find((entry) => entry.key === "POST /api/disease-payment/formal-grouping/jobs");
  assert.equal(formalGrouping.idempotency.behaviorEvidence.contractId, "insurance-payment.formal-grouping-create-command.v1");
  assert.deepEqual(formalGrouping.authorization.roles, ["commission", "insurance"]);
  assert.equal(formalGrouping.production.repositoryReview, "catalogued");
  assert.equal(formalGrouping.production.status, "NO-GO");
  const publicHealthSignal = catalog.entries.find((entry) => entry.key === "POST /api/public-health/highlights/signals");
  assert.equal(publicHealthSignal.idempotency.behaviorEvidence.contractId, "public-health.highlight-signal-intake-command.v1");
  assert.deepEqual(publicHealthSignal.authorization.roles, ["commission"]);
  assert.equal(publicHealthSignal.production.repositoryReview, "catalogued");
  assert.equal(publicHealthSignal.production.status, "NO-GO");
  const emergencyDeliveryReplay = catalog.entries.find((entry) => entry.key === "POST /api/emergency-signals/deliveries/:eventId/replay");
  assert.equal(emergencyDeliveryReplay.idempotency.behaviorEvidence.contractId, "clinical-specialties.emergency-signal-delivery-replay-command.v1");
  assert.deepEqual(emergencyDeliveryReplay.authorization.roles, ["commission"]);
  assert.equal(emergencyDeliveryReplay.production.repositoryReview, "catalogued");
  assert.equal(emergencyDeliveryReplay.production.status, "NO-GO");
  const emergencySignalUpdate = catalog.entries.find((entry) => entry.key === "PATCH /api/emergency-signals/:id");
  assert.equal(emergencySignalUpdate.idempotency.behaviorEvidence.contractId, "clinical-specialties.emergency-signal-update-command.v1");
  assert.deepEqual(emergencySignalUpdate.authorization.roles, ["commission", "county", "institution"]);
  assert.equal(emergencySignalUpdate.production.repositoryReview, "catalogued");
  assert.equal(emergencySignalUpdate.production.status, "NO-GO");
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
  forgedReviewedPromotion.reviewedProofRequired.push(formalGroupingReviewFixture());
  assert.match(validateEvidenceRegistry(forgedReviewedPromotion).join("\n"), /cannot coexist with behavior contract/);

  const missingReviewReason = clone(DEFAULT_REGISTRY);
  missingReviewReason.reviewedProofRequired.push(formalGroupingReviewFixture());
  missingReviewReason.reviewedProofRequired[0].missingProof = [];
  assert.match(validateEvidenceRegistry(missingReviewReason).join("\n"), /invalid proof-required review reasons/);

  const missingReviewAnchor = clone(DEFAULT_REGISTRY);
  missingReviewAnchor.reviewedProofRequired.push(formalGroupingReviewFixture());
  missingReviewAnchor.reviewedProofRequired[0].evidence[0].anchors.push("this reviewed proof anchor does not exist");
  assert.match(validateEvidenceRegistry(missingReviewAnchor).join("\n"), /missing evidence anchor/);
});
