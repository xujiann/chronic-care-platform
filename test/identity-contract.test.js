const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildIdentityContract,
  canonicalOrganizationLevel,
  parseArgs,
  renderMarkdown,
  validateOrganizationHierarchy,
  writeOutput
} = require("../scripts/identity-contract");

const ROOT = path.resolve(__dirname, "..");

test("identity contract validates required claims, roles and sample mappings", () => {
  const contract = buildIdentityContract();
  assert.equal(contract.ok, true);
  assert.equal(contract.checks.every((item) => item.passed), true);
  assert.equal(contract.requiredClaims.some((item) => item.claim === "sub" && item.required), true);
  assert.equal(contract.requiredClaims.some((item) => item.claim === "issuer" && item.required), true);
  assert.equal(contract.requiredClaims.some((item) => item.claim === "orgCode" && item.required), true);
  assert.equal(contract.roleCoverage.commission.users >= 1, true);
  assert.equal(contract.roleCoverage.institution.users >= 1, true);
  assert.equal(contract.roleCoverage.insurance.users >= 1, true);
  assert.equal(contract.roleCoverage.citizen.users >= 1, true);
  assert.equal(contract.roleCoverage.county.users >= 1, true);
  assert.equal(contract.sampleMappings.every((item) => item.passed), true);
  assert.equal(contract.checks.some((item) => item.id === "identity:sampleClaimCompleteness" && item.passed), true);
  assert.equal(contract.sampleMappings.find((item) => item.id === "identity-institution").mappedHome, "doctor.html");
  assert.equal(Object.values(contract.adapterContracts.oidc).every(Boolean), true);
  assert.equal(Object.values(contract.adapterContracts.sms).every(Boolean), true);
  assert.equal(contract.checks.some((item) => item.id === "identity:oidcRuntimeAdapter" && item.passed), true);
  assert.equal(contract.checks.some((item) => item.id === "identity:oidcLifecycle" && item.passed), true);
  assert.equal(contract.checks.some((item) => item.id === "identity:smsRuntimeAdapter" && item.passed), true);
  assert.equal(Object.values(contract.adapterContracts.oidcLifecycle).every(Boolean), true);
  assert.equal(Object.values(contract.adapterContracts.productionSecurity).every(Boolean), true);
  assert.equal(contract.adapterContracts.productionSecurity.sessionRetention, true);
  assert.equal(contract.adapterContracts.productionSecurity.centralizedSessionStore, true);
  assert.equal(contract.checks.some((item) => item.id === "identity:productionSecurityBoundary" && item.passed), true);
  assert.equal(contract.checks.some((item) => item.id === "identity:browserIdentityContext" && item.passed), true);
  assert.equal(Object.values(contract.adapterContracts.browserIdentityContext).every(Boolean), true);
  assert.equal(contract.productionReady, false);
  assert.equal(contract.productionBlockers.some((item) => /SAML runtime/.test(item)), true);
});

test("identity v2 documents organization hierarchy, least privilege and delegated identity controls", () => {
  const contract = buildIdentityContract();
  assert.equal(contract.referenceOrganizationTopology.valid, true);
  assert.deepEqual(contract.referenceOrganizationTopology.missingTargetLevels, []);
  assert.equal(contract.currentOrganizationTopology.valid, true);
  assert.equal(contract.currentOrganizationTopology.missingTargetLevels.includes("township-street"), true);
  assert.equal(contract.permissionMatrixStatus.valid, true);
  assert.equal(contract.permissionMatrixStatus.defaultPolicy, "deny");
  assert.equal(contract.permissionMatrix.some((item) => item.accountType === "doctor"), true);
  assert.equal(contract.permissionMatrix.some((item) => item.accountType === "nurse"), true);
  assert.equal(contract.permissionMatrix.some((item) => item.accountType === "guardian"), true);
  assert.equal(contract.permissionMatrix.find((item) => item.actor === "guardian-proxy").permissions.some((item) => item.startsWith("identity.")), false);
  assert.equal(contract.protocolMappingStatus.complete, true);
  assert.equal(contract.protocolMappingStatus.subjectNamespaced, true);
  assert.equal(contract.protocolMappingStatus.unknownRolePolicy, "deny");
  assert.equal(contract.runtimeIdentityAlignment.issuerScopedSubject, true);
  assert.equal(contract.runtimeIdentityAlignment.unknownRoleFailClosed, true);
  assert.equal(contract.runtimeIdentityAlignment.liveAccountValidation, true);
  assert.equal(contract.runtimeIdentityAlignment.cookieCsrfAndStepUp, true);
  assert.equal(contract.protocolClaimMappings.some((item) => item.field === "orgCode" && item.oidc.includes("org_code")), true);
  assert.equal(contract.protocolClaimMappings.some((item) => item.field === "externalSubject" && item.saml.includes("persistent NameID")), true);
  assert.equal(contract.adapterContracts.saml.runtime, false);
  assert.equal(contract.realNameWorkflow.controls.includes("master-index-match"), true);
  assert.equal(contract.guardianDelegationWorkflow.requiredFields.includes("actorAccountId"), true);
  assert.equal(contract.guardianDelegationWorkflow.requiredFields.includes("subjectResidentId"), true);
  assert.equal(contract.guardianDelegationWorkflow.controls.includes("actor-subject-audit"), true);
  assert.equal(contract.identityReviewCoverage.guardianCases >= 1, true);
});

test("login provisioning owner markers preserve readiness compatibility", () => {
  const login = fs.readFileSync(path.join(ROOT, "login.html"), "utf8");
  [
    "居民主索引管理员",
    "试点机构护理部",
    "平台账号管理员",
    "医政部门",
    "平台身份管理员",
    "居民服务窗口"
  ].forEach((marker) => assert.match(login, new RegExp(marker)));
});

test("organization hierarchy validation rejects missing parents and cycles", () => {
  const valid = validateOrganizationHierarchy([
    { orgCode: "CITY", orgLevel: "市级", orgType: "city", parentCode: "" },
    { orgCode: "DIST", orgLevel: "区市县", orgType: "district", parentCode: "CITY" },
    { orgCode: "TOWN", orgLevel: "乡镇街道", orgType: "township", parentCode: "DIST" },
    { orgCode: "ORG", orgLevel: "基层医疗机构", orgType: "medical_institution", parentCode: "TOWN" }
  ]);
  assert.equal(valid.valid, true);
  assert.equal(canonicalOrganizationLevel({ orgLevel: "乡镇街道", orgType: "township" }), "township-street");

  const missingParent = validateOrganizationHierarchy([{ orgCode: "ORG", parentCode: "MISSING" }]);
  assert.equal(missingParent.valid, false);
  assert.deepEqual(missingParent.missingParents, [{ orgCode: "ORG", parentCode: "MISSING" }]);

  const cycle = validateOrganizationHierarchy([
    { orgCode: "A", parentCode: "B" },
    { orgCode: "B", parentCode: "A" }
  ]);
  assert.equal(cycle.valid, false);
  assert.equal(cycle.cycles.length > 0, true);
});

test("identity contract renders and writes release artifacts", (t) => {
  const outputDir = path.join(ROOT, "tmp", "identity-contract-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const contract = buildIdentityContract();
  const markdown = renderMarkdown(contract);
  assert.match(markdown, /Identity integration contract/);
  assert.match(markdown, /Required external claims/);
  assert.match(markdown, /Sample mappings/);
  assert.match(markdown, /Production runtime adapters/);
  assert.match(markdown, /Target organization hierarchy/);
  assert.match(markdown, /Least-privilege permission matrix/);
  assert.match(markdown, /OIDC and SAML claim mappings/);
  assert.match(markdown, /Guardian delegation workflow/);
  assert.match(markdown, /Production ready: NO/);
  assert.match(markdown, /foundation-ready/);

  writeOutput(contract, {
    output: path.join("tmp", "identity-contract-test", "identity-contract.json"),
    markdown: path.join("tmp", "identity-contract-test", "identity-contract.md")
  });

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "identity-contract.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "identity-contract.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.match(writtenMarkdown, /identity-commission/);
});

test("identity contract CLI parser keeps output flags", () => {
  const parsed = parseArgs(["--output=release/identity-contract.json", "--markdown=release/identity-contract.md"]);
  assert.equal(parsed.output, "release/identity-contract.json");
  assert.equal(parsed.markdown, "release/identity-contract.md");
});
