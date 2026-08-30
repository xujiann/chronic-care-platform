"use strict";

const fs = require("node:fs");
const path = require("node:path");

const EXPECTED_PRIMARY_DOMAIN_IDS = Object.freeze([
  "T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08", "T09"
]);
const EXPECTED_CLINICAL_SUBDOMAIN_IDS = Object.freeze([
  "emergency", "blood", "imaging", "physical-examination", "quality-safety"
]);
const EXPECTED_PRODUCT_LINE_IDS = Object.freeze(["insurance-payment"]);
const AUTHORITY_PATHS = Object.freeze({
  processOwnership: "config/process-workstreams.json",
  clinicalSubdomains: "config/clinical-subdomains.json",
  dataOwnership: "config/domain-data-ownership.json",
  serviceExtraction: "config/service-extraction-scorecard.json"
});

function loadJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function sameValues(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function validateDevelopmentOrganization(root, overrides = {}) {
  const organization = overrides.organization || loadJson(root, "config/development-organization.json");
  const processes = overrides.processes || loadJson(root, AUTHORITY_PATHS.processOwnership);
  const clinical = overrides.clinical || loadJson(root, AUTHORITY_PATHS.clinicalSubdomains);
  const dataOwnership = overrides.dataOwnership || loadJson(root, AUTHORITY_PATHS.dataOwnership);
  const serviceExtraction = overrides.serviceExtraction || loadJson(root, AUTHORITY_PATHS.serviceExtraction);
  const issues = [];

  if (organization.schemaVersion !== "development-organization-v1") {
    issues.push("development organization schema must be development-organization-v1");
  }
  if (organization.model !== "nine-primary-development-domains-plus-five-clinical-subdomains"
    || organization.status !== "accepted") {
    issues.push("development organization model and status must remain accepted 9+5");
  }
  if (!sameValues(organization.authorities, AUTHORITY_PATHS)) {
    issues.push("development organization authorities must reference the existing owner registries exactly");
  }

  const processIds = Object.keys(processes.processes || {});
  const expectedProcessIds = ["T00", ...EXPECTED_PRIMARY_DOMAIN_IDS];
  if (!sameValues(processIds, expectedProcessIds)) {
    issues.push("process authority must contain exactly T00 plus T01-T09 in order");
  }
  if (!sameValues(organization.primaryDevelopmentDomainIds, EXPECTED_PRIMARY_DOMAIN_IDS)) {
    issues.push("primary development domains must be exactly T01-T09 in order");
  }
  if (organization.integrationUnit?.processId !== "T00"
    || organization.integrationUnit?.countsAsPrimaryDevelopmentDomain !== false
    || organization.integrationUnit?.responsibility !== "integration-governance") {
    issues.push("T00 must remain the non-primary integration governance unit");
  }

  const productLines = Array.isArray(organization.productLines) ? organization.productLines : [];
  const productLineIds = productLines.map((item) => item.id);
  if (!sameValues(productLineIds, EXPECTED_PRODUCT_LINE_IDS)) {
    issues.push("development product lines must contain exactly insurance-payment");
  }
  const insurancePayment = productLines[0] || {};
  const insuranceProcess = processes.processes?.T07 || {};
  if (insurancePayment.name !== "医保支付"
    || insurancePayment.processId !== "T07"
    || insurancePayment.status !== "established"
    || insurancePayment.developmentMode !== "independent-product-line"
    || insurancePayment.scopeAuthority !== "config/process-workstreams.json#processes.T07"
    || insuranceProcess.name !== insurancePayment.name
    || insuranceProcess.slug !== insurancePayment.id) {
    issues.push("insurance-payment product line must remain bound to the authoritative T07 process");
  }
  if (!sameValues(insurancePayment.autonomy, {
    roadmap: "independent-product-roadmap",
    backlog: "independent-product-backlog",
    worktree: "independent-process-worktree",
    tests: "domain-tests-plus-shared-gates",
    release: "main-through-t00"
  })) {
    issues.push("insurance-payment product-line autonomy must preserve roadmap, backlog, worktree, tests and T00 integration");
  }

  const groups = Array.isArray(organization.nestedDevelopmentGroups)
    ? organization.nestedDevelopmentGroups
    : [];
  if (groups.length !== 1) {
    issues.push("development organization must contain exactly one nested development group");
  }
  const clinicalGroup = groups[0] || {};
  if (clinicalGroup.id !== "clinical-five"
    || clinicalGroup.parentProcessId !== "T06"
    || clinicalGroup.ownerNamespace !== "T06"
    || !sameValues(clinicalGroup.memberIds, EXPECTED_CLINICAL_SUBDOMAIN_IDS)) {
    issues.push("clinical-five must remain nested under T06 with exactly five ordered members");
  }

  const clinicalIds = (clinical.subdomains || []).map((item) => item.id);
  const clinicalOwners = (clinical.subdomains || []).map((item) => item.owner);
  if (!sameValues(clinicalIds, EXPECTED_CLINICAL_SUBDOMAIN_IDS)) {
    issues.push("clinical authority must contain the same five ordered subdomains");
  }
  if (!sameValues(clinicalOwners, EXPECTED_CLINICAL_SUBDOMAIN_IDS.map((id) => `T06/${id}`))) {
    issues.push("clinical authority owners must use the T06 member namespace");
  }

  const policy = organization.developmentPolicy || {};
  if (policy.integrationBranch !== processes.integrationBranch
    || policy.integrationBranch !== "main"
    || policy.crossDomainChangeOwner !== processes.developmentPolicy?.integrationOwner
    || policy.crossDomainChangeOwner !== "T00") {
    issues.push("development policy must use main integration and T00 cross-domain ownership");
  }
  if (policy.repositoryBoundary !== "single-repository"
    || policy.runtimeBoundary !== clinical.deploymentBoundary
    || policy.runtimeBoundary !== "shared-node-runtime"
    || policy.deploymentBoundary !== clinical.architecture
    || policy.deploymentBoundary !== "modular-monolith"
    || policy.independentDeploymentAuthorized !== false
    || clinical.independentDeploymentAuthorized !== false) {
    issues.push("development autonomy must not imply repository, runtime or deployment separation");
  }
  if (!sameValues(insurancePayment.topology, {
    repositoryBoundary: policy.repositoryBoundary,
    runtimeBoundary: policy.runtimeBoundary,
    deploymentBoundary: policy.deploymentBoundary,
    independentDeploymentAuthorized: false,
    productionReady: false
  })) {
    issues.push("insurance-payment product line must preserve the shared repository, runtime, deployment and NO-GO topology");
  }
  if (policy.planningBoundary !== "independent-domain-plan"
    || policy.worktreeBoundary !== "independent-process-worktree"
    || policy.sourceOwnership !== "delegated-by-authority"
    || policy.testBoundary !== "domain-tests-plus-shared-gates") {
    issues.push("development autonomy policy drifted from the approved planning, ownership and test model");
  }
  if (!(serviceExtraction.candidates || []).every((candidate) => candidate.decision === "modular-monolith")) {
    issues.push("service extraction authority must not authorize an independent service");
  }
  if (dataOwnership.storagePolicy?.production?.authoritative !== "postgresql"
    || dataOwnership.storagePolicy?.production?.fallbackWrite !== false
    || !sameValues(dataOwnership.nonOwningDomains, ["shared", "state-data"])) {
    issues.push("data authority must preserve PostgreSQL ownership and non-owning shared boundaries");
  }

  return Object.freeze({
    ok: issues.length === 0,
    schemaVersion: organization.schemaVersion,
    model: organization.model,
    primaryDevelopmentDomainCount: organization.primaryDevelopmentDomainIds?.length || 0,
    productLineCount: productLines.length,
    productLineIds: Object.freeze(productLineIds),
    clinicalSubdomainCount: clinicalGroup.memberIds?.length || 0,
    governedDevelopmentUnitCount: (organization.primaryDevelopmentDomainIds?.length || 0)
      + (clinicalGroup.memberIds?.length || 0),
    integrationUnit: organization.integrationUnit?.processId || null,
    repositoryBoundary: policy.repositoryBoundary || null,
    runtimeBoundary: policy.runtimeBoundary || null,
    deploymentBoundary: policy.deploymentBoundary || null,
    independentDeploymentAuthorized: policy.independentDeploymentAuthorized,
    issues: Object.freeze(issues)
  });
}

module.exports = {
  AUTHORITY_PATHS,
  EXPECTED_CLINICAL_SUBDOMAIN_IDS,
  EXPECTED_PRIMARY_DOMAIN_IDS,
  EXPECTED_PRODUCT_LINE_IDS,
  validateDevelopmentOrganization
};
