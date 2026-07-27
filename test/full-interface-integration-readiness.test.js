const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildFullInterfaceIntegrationReadiness,
  parseArgs,
  renderMarkdown
} = require("../scripts/full-interface-integration-readiness");

test("full readiness is handoff-ready while T00 hooks and site evidence remain pending", () => {
  const report = buildFullInterfaceIntegrationReadiness();
  assert.equal(report.ok, true);
  assert.equal(report.handoffReady, true);
  assert.equal(report.productionReady, false);
  assert.equal(report.checks.every((item) => item.passed), true);
  assert.equal(report.integrationHooks.domainImportsReady, false);
  assert.equal(report.blockers.some((item) => /T00/.test(item)), true);
  assert.match(renderMarkdown(report), /Production ready: no/);
});

test("shared hook wiring alone never opens the production gate", () => {
  const serverSource = [
    "interface-domain-integration",
    "financial-domain-integration",
    "ingestInterfaceEvent(",
    "applyFinancialCallbackAndSync(",
    "/api/public-health/direct-report/callback",
    "retryInboundLanding(",
    "retryFinancialProjection("
  ].join("\n");
  const report = buildFullInterfaceIntegrationReadiness({ serverSource });
  assert.equal(Object.values(report.integrationHooks).every(Boolean), true);
  assert.equal(report.handoffReady, true);
  assert.equal(report.productionReady, false);
  assert.equal(report.blockers.some((item) => /real site evidence/.test(item)), true);
});

test("full readiness fails if financial compensation support disappears", () => {
  const report = buildFullInterfaceIntegrationReadiness({ financialSource: "applyFinancialCallbackAndSync projectInsurance projectCertificate pending-reconciliation" });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "fullInterface:financialProjection" && !item.passed), true);
});

test("full readiness fails if institution or keyed-reference security markers disappear", () => {
  const missingInstitutionGuard = buildFullInterfaceIntegrationReadiness({
    interfaceSource: "his-patient-v1 emr-summary-v1 pacs-report-v1 ingestInterfaceEvent retryInboundLanding INTERFACE_IDEMPOTENCY_PAYLOAD_CONFLICT"
  });
  assert.equal(missingInstitutionGuard.ok, false);
  assert.equal(missingInstitutionGuard.checks.some((item) => item.id === "fullInterface:medicalLanding" && !item.passed), true);
  const missingKeyedReference = buildFullInterfaceIntegrationReadiness({
    connectorSource: "PUBLIC_HEALTH_DIRECT_REPORT_URL PUBLIC_HEALTH_REFERENCE_SECRET HMAC-SHA256 verifyDirectReportCallback"
  });
  assert.equal(missingKeyedReference.ok, false);
  assert.equal(missingKeyedReference.checks.some((item) => item.id === "fullInterface:lisPublicHealth" && !item.passed), true);
  const missingIssuedCapability = buildFullInterfaceIntegrationReadiness({
    securityContextSource: "issueCrossInstitutionAuthorization isIssuedCrossInstitutionAuthorization"
  });
  assert.equal(missingIssuedCapability.ok, false);
  assert.equal(missingIssuedCapability.checks.some((item) => item.id === "fullInterface:institutionAuthorization" && !item.passed), true);
});

test("full readiness CLI parser supports non-writing verification", () => {
  const flags = parseArgs(["--write=false", "--output=tmp/readiness.json"]);
  assert.equal(flags.write, "false");
  assert.equal(flags.output, "tmp/readiness.json");
});
