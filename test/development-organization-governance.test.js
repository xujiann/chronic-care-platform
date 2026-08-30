"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  EXPECTED_CLINICAL_SUBDOMAIN_IDS,
  EXPECTED_PRIMARY_DOMAIN_IDS,
  EXPECTED_PRODUCT_LINE_IDS,
  validateDevelopmentOrganization
} = require("../src/platform/governance/development-organization");

const ROOT = path.resolve(__dirname, "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

test("development organization defines nine primary domains and five nested clinical subdomains", () => {
  const report = validateDevelopmentOrganization(ROOT);

  assert.deepEqual(report.issues, []);
  assert.equal(report.ok, true);
  assert.equal(report.primaryDevelopmentDomainCount, 9);
  assert.equal(report.productLineCount, 1);
  assert.deepEqual(report.productLineIds, ["insurance-payment"]);
  assert.equal(report.clinicalSubdomainCount, 5);
  assert.equal(report.governedDevelopmentUnitCount, 14);
  assert.equal(report.integrationUnit, "T00");
  assert.equal(report.repositoryBoundary, "single-repository");
  assert.equal(report.runtimeBoundary, "shared-node-runtime");
  assert.equal(report.deploymentBoundary, "modular-monolith");
  assert.equal(report.independentDeploymentAuthorized, false);
});

test("insurance payment is the established independent development product line under T07", () => {
  const organization = readJson("config/development-organization.json");
  const processes = readJson("config/process-workstreams.json");
  const productLine = organization.productLines[0];

  assert.deepEqual(organization.productLines.map((item) => item.id), EXPECTED_PRODUCT_LINE_IDS);
  assert.equal(productLine.processId, "T07");
  assert.equal(productLine.name, processes.processes.T07.name);
  assert.equal(productLine.id, processes.processes.T07.slug);
  assert.equal(productLine.developmentMode, "independent-product-line");
  assert.equal(productLine.autonomy.release, "main-through-t00");
  assert.equal(productLine.topology.independentDeploymentAuthorized, false);
  assert.equal(productLine.topology.productionReady, false);
});

test("organization composition stays aligned with the two existing ownership authorities", () => {
  const organization = readJson("config/development-organization.json");
  const processes = readJson("config/process-workstreams.json");
  const clinical = readJson("config/clinical-subdomains.json");

  assert.deepEqual(organization.primaryDevelopmentDomainIds, EXPECTED_PRIMARY_DOMAIN_IDS);
  assert.deepEqual(Object.keys(processes.processes), ["T00", ...EXPECTED_PRIMARY_DOMAIN_IDS]);
  assert.deepEqual(organization.nestedDevelopmentGroups[0].memberIds, EXPECTED_CLINICAL_SUBDOMAIN_IDS);
  assert.deepEqual(clinical.subdomains.map((item) => item.id), EXPECTED_CLINICAL_SUBDOMAIN_IDS);
});

test("organization gate rejects inflated domain counts and deployment authorization", () => {
  const organization = readJson("config/development-organization.json");
  const changed = structuredClone(organization);
  changed.primaryDevelopmentDomainIds = ["T00", ...EXPECTED_PRIMARY_DOMAIN_IDS.slice(0, -1)];
  changed.nestedDevelopmentGroups[0].memberIds = EXPECTED_CLINICAL_SUBDOMAIN_IDS.slice(0, -1);
  changed.developmentPolicy.repositoryBoundary = "multiple-repositories";
  changed.developmentPolicy.independentDeploymentAuthorized = true;
  changed.productLines[0].topology.repositoryBoundary = "multiple-repositories";
  changed.productLines[0].topology.independentDeploymentAuthorized = true;
  changed.productLines[0].topology.productionReady = true;

  const report = validateDevelopmentOrganization(ROOT, { organization: changed });
  const issues = report.issues.join("\n");

  assert.equal(report.ok, false);
  assert.match(issues, /primary development domains must be exactly T01-T09/);
  assert.match(issues, /clinical-five must remain nested under T06/);
  assert.match(issues, /must not imply repository, runtime or deployment separation/);
  assert.match(issues, /product line must preserve the shared repository, runtime, deployment and NO-GO topology/);
});

test("organization gate rejects product-line owner and autonomy drift", () => {
  const organization = readJson("config/development-organization.json");
  const changed = structuredClone(organization);
  changed.productLines[0].processId = "T08";
  changed.productLines[0].scopeAuthority = "config/process-workstreams.json#processes.T08";
  changed.productLines[0].autonomy.release = "independent-release";

  const report = validateDevelopmentOrganization(ROOT, { organization: changed });
  const issues = report.issues.join("\n");

  assert.equal(report.ok, false);
  assert.match(issues, /must remain bound to the authoritative T07 process/);
  assert.match(issues, /must preserve roadmap, backlog, worktree, tests and T00 integration/);
});

test("organization gate rejects drift in the authoritative process and clinical registries", () => {
  const processes = readJson("config/process-workstreams.json");
  const clinical = readJson("config/clinical-subdomains.json");
  const changedProcesses = structuredClone(processes);
  const changedClinical = structuredClone(clinical);
  delete changedProcesses.processes.T09;
  changedClinical.subdomains[0].owner = "T05/emergency";

  const report = validateDevelopmentOrganization(ROOT, {
    processes: changedProcesses,
    clinical: changedClinical
  });
  const issues = report.issues.join("\n");

  assert.equal(report.ok, false);
  assert.match(issues, /process authority must contain exactly T00 plus T01-T09/);
  assert.match(issues, /clinical authority owners must use the T06 member namespace/);
});

test("governance CI executes the organization verifier and architecture test", () => {
  const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
  const packageJson = readJson("package.json");

  assert.match(workflow, /Verify nine plus five development organization[\s\S]*npm run development-organization:verify/);
  assert.equal(packageJson.scripts["development-organization:verify"], "node scripts/development-organization-governance.js");
  assert.match(packageJson.scripts["architecture:test"], /test\/development-organization-governance\.test\.js/);
});
