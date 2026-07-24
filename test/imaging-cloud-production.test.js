const assert = require("node:assert/strict");
const test = require("node:test");
const Production = require("../imaging-cloud-production");

const submitter = { id: "imaging-site-owner", role: "institution", name: "试点医院接口负责人" };
const verifier = { id: "imaging-verifier", role: "commission", name: "卫健委独立复核人" };
const businessOwner = { id: "imaging-business-owner", role: "commission", name: "影像业务负责人" };
const technicalOwner = { id: "imaging-technical-owner", role: "commission", name: "影像技术负责人" };

function digest(index) {
  return `sha256:${index.toString(16).padStart(64, "a")}`;
}

function recordAllSyntheticChecks(data) {
  Production.ensure(data);
  data.imagingSyntheticChecks.forEach((item, index) => Production.recordSyntheticCheck(data, submitter, item.id, {
    confirmation: Production.SYNTHETIC_CONFIRMATION,
    dataClass: "synthetic-test-data",
    result: "passed",
    evidenceRef: `solution-a/synthetic/${index + 1}`
  }));
}

function probeAllEndpoints(data) {
  Production.ensure(data);
  data.imagingProductionEndpoints.forEach((item, index) => Production.probeEndpoint(data, verifier, item.id, {
    endpoint: item.id === "imaging-pacs-ris" ? "dicom-tls://pacs.example.test:2762" : `https://${item.id}.example.test`,
    environment: "production",
    result: "passed",
    credentialRef: `vault/imaging/${item.id}`,
    certificateFingerprint: digest(index + 1),
    latencyMs: 20 + index
  }));
}

function signAllRequirements(data) {
  data.imagingProductionRequirements.forEach((item, index) => {
    const evidenceDigest = digest(index + 20);
    Production.signRequirement(data, submitter, item.id, {
      action: "submit-evidence",
      confirmation: Production.SUBMIT_CONFIRMATION,
      evidenceRef: `site/imaging/${item.id}`,
      evidenceDigest,
      externalSigner: `外部责任人${index + 1}`,
      externalOrganization: item.owner
    });
    Production.signRequirement(data, verifier, item.id, {
      action: "verify-evidence",
      confirmation: Production.VERIFY_CONFIRMATION,
      evidenceDigest,
      verificationRef: `verification/imaging/${item.id}`
    });
  });
}

function receiptPayload(type, index) {
  const common = {
    confirmation: Production.SUBMIT_CONFIRMATION,
    contractVersion: "1.0",
    evidenceRef: `site/imaging/receipt/${type}`,
    evidenceDigest: digest(index + 60),
    externalSigner: `现场责任人${index + 1}`,
    externalOrganization: "试点医院/平台联合组"
  };
  const details = {
    "pacs-ris-dicom-tls": { transport: "DICOM-TLS", tlsMinimum: "TLS1.2", messageProfiles: ["C-STORE", "C-MOVE"], gatewayReceiptRef: "gateway-receipt-001" },
    "fhir-report-writeback": { fhirVersion: "R4", resources: ["Patient", "ImagingStudy", "DiagnosticReport"], writebackStatus: "accepted", callbackReceiptRef: "emr-callback-001" },
    "object-storage-authorization-audit": { storageRegion: "liaoning-in-province", encryptionAtRest: "enabled", authorizationMode: "authenticated-and-authorized", auditRetentionDays: 180, terminalPolicy: "no-original-dicom-on-mobile" },
    "mutual-recognition-appeal": { appealPolicyVersion: "1.0", independentReviewerRole: "county-or-commission", minimizedEvidenceOnly: true, appealReceiptRef: "appeal-review-001" },
    "failure-degradation-rollback": { failureScenarios: ["pacs-ris-unavailable", "fhir-writeback-failed", "object-storage-unavailable"], fallbackPath: "original-pacs-and-report-priority", reconciliationReceiptRef: "reconcile-001", rollbackDecisionRef: "rollback-001" }
  };
  return { ...common, ...details[type] };
}

function verifyAllSiteReceipts(data) {
  Production.SITE_RECEIPT_CONTRACTS.forEach((contract, index) => {
    const submitted = Production.submitSiteReceipt(data, submitter, contract.type, receiptPayload(contract.type, index));
    Production.verifySiteReceipt(data, verifier, contract.type, {
      confirmation: Production.VERIFY_CONFIRMATION,
      evidenceDigest: submitted.evidenceDigest,
      verificationRef: `verification/imaging/receipt/${contract.type}`
    });
  });
}

test("initial imaging state is ready for synthetic acceptance but formally blocked", () => {
  const result = Production.center({});
  assert.equal(result.functionalState, "ready-for-synthetic-acceptance");
  assert.equal(result.formalGoLiveState, "blocked-until-site-evidence-signed");
  assert.equal(result.productionReady, false);
  assert.equal(result.summary.syntheticChecks, 10);
  assert.equal(result.summary.endpoints, 5);
  assert.equal(result.summary.requirements, 7);
  assert.equal(result.summary.siteReceipts, 5);
  assert.equal(result.summary.drills, 4);
  assert.equal(result.routeContracts.length, 9);
});

test("T00 route contract declares role guards and domain handlers for every production action", () => {
  assert.equal(Production.ROUTE_CONTRACTS.length, 9);
  assert.ok(Production.ROUTE_CONTRACTS.every((route)=>Array.isArray(route.roles) && route.roles.length > 0));
  assert.ok(Production.ROUTE_CONTRACTS.every((route)=>route.handler.startsWith("ImagingCloudProduction.")));
  assert.deepEqual(Production.ROUTE_CONTRACTS.find((route) => route.path.includes("/receipts/:type/verify")).roles, ["commission"]);
});

test("synthetic acceptance requires explicit synthetic data evidence", () => {
  const data = {};
  Production.ensure(data);
  const id = data.imagingSyntheticChecks[0].id;
  assert.throws(() => Production.recordSyntheticCheck(data, submitter, id, {
    confirmation: Production.SYNTHETIC_CONFIRMATION,
    dataClass: "real-patient-data",
    result: "passed",
    evidenceRef: "unsafe"
  }), /synthetic-test-data/);
  recordAllSyntheticChecks(data);
  const result = Production.center(data);
  assert.equal(result.preflight.syntheticAcceptancePassed, true);
  assert.equal(result.functionalState, "ready-for-site-integration");
  assert.equal(result.formalGoLiveState, "blocked-until-site-evidence-signed");
});

test("production endpoint probes reject insecure or uncredentialed targets", () => {
  assert.throws(() => Production.probeEndpoint({}, verifier, "imaging-fhir", {
    endpoint: "http://fhir.example.test",
    environment: "production",
    result: "passed",
    credentialRef: "vault/fhir",
    certificateFingerprint: digest(1)
  }), /HTTPS or DICOM TLS/);
  assert.throws(() => Production.probeEndpoint({}, verifier, "imaging-fhir", {
    endpoint: "https://fhir.example.test",
    environment: "production",
    result: "passed"
  }), /credentialRef/);
});

test("site evidence needs external provenance, endpoint probes and an independent verifier", () => {
  const data = {};
  Production.ensure(data);
  const evidenceDigest = digest(30);
  const row = Production.signRequirement(data, submitter, "IMG-SITE-01", {
    action: "submit-evidence",
    confirmation: Production.SUBMIT_CONFIRMATION,
    evidenceRef: "site/imaging/pacs",
    evidenceDigest,
    externalSigner: "医院放射科负责人",
    externalOrganization: "试点医院"
  });
  assert.equal(row.status, "evidence-submitted");
  assert.throws(() => Production.signRequirement(data, submitter, "IMG-SITE-01", {
    action: "verify-evidence",
    confirmation: Production.VERIFY_CONFIRMATION,
    evidenceDigest,
    verificationRef: "self-review"
  }), /current role|independent/);
  assert.throws(() => Production.signRequirement(data, verifier, "IMG-SITE-01", {
    action: "verify-evidence",
    confirmation: Production.VERIFY_CONFIRMATION,
    evidenceDigest,
    verificationRef: "verification/pacs"
  }), /endpoint probe/);
  assert.equal(row.status, "evidence-submitted");
});

test("site receipt validators enforce protocol contracts and reject patient identifiers", () => {
  const data = {};
  assert.throws(() => Production.submitSiteReceipt(data, submitter, "pacs-ris-dicom-tls", {
    ...receiptPayload("pacs-ris-dicom-tls", 1),
    transport: "HTTPS"
  }), /DICOM-TLS/);
  assert.throws(() => Production.submitSiteReceipt(data, submitter, "fhir-report-writeback", {
    ...receiptPayload("fhir-report-writeback", 2),
    patientName: "不得写入现场回执"
  }), /patient-identifying/);
  const submitted = Production.submitSiteReceipt(data, submitter, "object-storage-authorization-audit", receiptPayload("object-storage-authorization-audit", 3));
  assert.equal(submitted.status, "evidence-submitted");
  assert.throws(() => Production.verifySiteReceipt(data, submitter, "object-storage-authorization-audit", {
    confirmation: Production.VERIFY_CONFIRMATION,
    evidenceDigest: submitted.evidenceDigest,
    verificationRef: "self-review"
  }), /current role|independent/);
  const verified = Production.verifySiteReceipt(data, verifier, "object-storage-authorization-audit", {
    confirmation: Production.VERIFY_CONFIRMATION,
    evidenceDigest: submitted.evidenceDigest,
    verificationRef: "verification/imaging/object-storage"
  });
  assert.equal(verified.status, "verified");
});

test("complete evidence opens the gate only after distinct dual approval", () => {
  const data = {};
  recordAllSyntheticChecks(data);
  probeAllEndpoints(data);
  signAllRequirements(data);
  verifyAllSiteReceipts(data);
  data.imagingProductionDrills.forEach((item) => Production.completeDrill(data, verifier, item.id, {
    result: "passed",
    evidenceRef: `drill/imaging/${item.id}`
  }));
  const beforeApproval = Production.center(data);
  assert.equal(beforeApproval.preflight.syntheticAcceptancePassed, true);
  assert.equal(beforeApproval.preflight.endpointsReady, true);
  assert.equal(beforeApproval.preflight.requirementsSigned, true);
  assert.equal(beforeApproval.preflight.siteReceiptsVerified, true);
  assert.equal(beforeApproval.preflight.drillsPassed, true);
  assert.equal(beforeApproval.productionReady, false);

  Production.signApproval(data, businessOwner, "imaging-approval-business", {
    confirmation: Production.CUTOVER_CONFIRMATION,
    evidenceRef: "approval/imaging/business"
  });
  assert.throws(() => Production.signApproval(data, businessOwner, "imaging-approval-technical", {
    confirmation: Production.CUTOVER_CONFIRMATION,
    evidenceRef: "approval/imaging/technical"
  }), /different signers/);
  Production.signApproval(data, technicalOwner, "imaging-approval-technical", {
    confirmation: Production.CUTOVER_CONFIRMATION,
    evidenceRef: "approval/imaging/technical"
  });

  const result = Production.center(data);
  assert.equal(result.productionReady, true);
  assert.equal(result.formalGoLiveState, "ready-for-production");
  assert.equal(result.summary.endpointsReady, 5);
  assert.equal(result.summary.requirementsSigned, 7);
  assert.equal(result.summary.siteReceiptsVerified, 5);
  assert.equal(result.summary.drillsPassed, 4);
  assert.equal(result.summary.approvalsSigned, 2);
  assert.ok(result.audit.length > 0);
  assert.match(result.audit[0].digest, /^sha256:[a-f0-9]{64}$/);
});

test("production audit entries form a tamper-evident digest chain", () => {
  const data = {};
  Production.recordSyntheticCheck(data, submitter, "imaging-syn-services", {
    confirmation: Production.SYNTHETIC_CONFIRMATION,
    dataClass: "synthetic-test-data",
    result: "passed",
    evidenceRef: "solution-a/synthetic/services"
  });
  const first = data.imagingProductionAudit[0];
  assert.equal(first.previousDigest, "GENESIS");
  Production.recordSyntheticCheck(data, submitter, "imaging-syn-fhir-patient", {
    confirmation: Production.SYNTHETIC_CONFIRMATION,
    dataClass: "synthetic-test-data",
    result: "passed",
    evidenceRef: "solution-a/synthetic/fhir-patient"
  });
  const [latest, previous] = data.imagingProductionAudit;
  assert.match(latest.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(latest.previousDigest, previous.digest);
});

test("standalone smoke remains no-go until site evidence is fully accepted and exposes rollback gate", () => {
  const smoke = Production.runStandaloneSmoke({});
  assert.equal(smoke.module, "regional-imaging-cloud");
  assert.equal(smoke.codeReady, true);
  assert.equal(smoke.releaseDecision, "no-go");
  assert.equal(smoke.formalGoLiveState, "blocked-until-site-evidence-signed");
  assert.equal(smoke.checks.some((item) => item.id === "rollback-gate" && item.passed), true);
  assert.equal(smoke.checks.some((item) => item.id === "site-receipt-contracts" && item.passed), true);
});
