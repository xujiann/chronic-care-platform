const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildProductionReleaseScopeReport,
  loadDefaultAuthorities
} = require("../src/platform/governance/production-release-scope");

function defaults() {
  return loadDefaultAuthorities();
}

test("production release scope freezes the priority-eight inventory while remaining NO-GO", () => {
  const report = buildProductionReleaseScopeReport(defaults());

  assert.equal(report.ok, true);
  assert.equal(report.status, "FROZEN-NO-GO");
  assert.equal(report.scopeFingerprint, "sha256:ec33706d5806e5bcf3c210a289ca124e188ff236dafc60ac2f4f1d538f5acca3");
  assert.equal(report.productionReady, false);
  assert.equal(report.externalEvidenceRequired, true);
  assert.deepEqual(report.summary, {
    applications: 8,
    pages: 9,
    apis: 32,
    collections: 38,
    workers: 7,
    externalDependencies: 14,
    applicationEvidence: 16,
    cutoverActions: 14
  });
  assert.equal(report.repositoryReview.apiReviewRequired.length, 5);
  assert.equal(report.repositoryReview.collectionReviewRequired.length, 0);
  assert.equal(report.repositoryReview.collectionProductionWriteBlocked.length, 21);
  assert.equal(report.inventories.apis.items.every((key) => /^(GET|POST|PUT|PATCH|DELETE) \/api\//.test(key)), true);
  assert.equal(report.blockers.some((item) => item.includes("production NO-GO")), true);
});

test("production release scope fails closed on authority drift or forged readiness", () => {
  const authorities = defaults();
  const missingApplication = structuredClone(authorities.scope);
  missingApplication.applicationIds.pop();
  const missingApplicationReport = buildProductionReleaseScopeReport({ ...authorities, scope: missingApplication });
  assert.equal(missingApplicationReport.ok, false);
  assert.equal(missingApplicationReport.checks.some((item) => item.id === "scope:applications" && !item.passed), true);

  const forgedReady = structuredClone(authorities.scope);
  forgedReady.productionReady = true;
  const forgedReadyReport = buildProductionReleaseScopeReport({ ...authorities, scope: forgedReady });
  assert.equal(forgedReadyReport.ok, false);
  assert.equal(forgedReadyReport.productionReady, false);
  assert.equal(forgedReadyReport.checks.some((item) => item.id === "scope:production-boundary" && !item.passed), true);

  const workerDrift = structuredClone(authorities.workerRegistry);
  workerDrift.profiles = workerDrift.profiles.filter((item) => item.id !== "referral-delivery");
  const workerDriftReport = buildProductionReleaseScopeReport({ ...authorities, workerRegistry: workerDrift });
  assert.equal(workerDriftReport.ok, false);
  assert.equal(workerDriftReport.checks.some((item) => item.id === "scope:workers" && !item.passed), true);

  const forgedBindingOwner = structuredClone(authorities.scope);
  forgedBindingOwner.collectionSourceBindings.referrals.ownerProcess = "T04";
  const forgedBindingOwnerReport = buildProductionReleaseScopeReport({ ...authorities, scope: forgedBindingOwner });
  assert.equal(forgedBindingOwnerReport.ok, false);
  assert.equal(forgedBindingOwnerReport.checks.some((item) => item.id === "scope:collection-source-bindings" && !item.passed), true);

  const forgedReadModel = structuredClone(authorities.scope);
  forgedReadModel.collectionSourceBindings.operationsReadiness.export = "missingExport";
  const forgedReadModelReport = buildProductionReleaseScopeReport({ ...authorities, scope: forgedReadModel });
  assert.equal(forgedReadModelReport.ok, false);
  assert.equal(forgedReadModelReport.checks.some((item) => item.id === "scope:collection-source-bindings" && !item.passed), true);

  const reopenedOwnerReview = structuredClone(authorities.collectionGovernance);
  const scopedOwnerReview = reopenedOwnerReview.collections.find((item) => item.name === "chronicAcceptanceLedger");
  scopedOwnerReview.governanceStatus = "review-required";
  const reopenedOwnerReviewReport = buildProductionReleaseScopeReport({
    ...authorities,
    collectionGovernance: reopenedOwnerReview
  });
  assert.deepEqual(reopenedOwnerReviewReport.repositoryReview.collectionReviewRequired, ["chronicAcceptanceLedger"]);
});

test("production release scope validates deployment package fingerprint binding", () => {
  const authorities = defaults();
  const report = buildProductionReleaseScopeReport(authorities);
  const deploymentPackage = {
    processContract: {
      productionReleaseScope: {
        contract: "production-release-scope.v1",
        scopeId: report.scopeId,
        scopeFingerprint: report.scopeFingerprint,
        productionReady: false
      }
    }
  };
  assert.equal(buildProductionReleaseScopeReport({ ...authorities, deploymentPackage }).ok, true);

  deploymentPackage.processContract.productionReleaseScope.scopeFingerprint = "sha256:forged";
  const failed = buildProductionReleaseScopeReport({ ...authorities, deploymentPackage });
  assert.equal(failed.ok, false);
  assert.equal(failed.checks.some((item) => item.id === "scope:deployment-package-binding" && !item.passed), true);
});
