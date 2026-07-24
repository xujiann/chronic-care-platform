const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Production = require("../physical-examination-production");
const Standards = require("../physical-examination-standards");
const { buildReport, renderMarkdown } = require("../scripts/physical-examination-standalone-readiness");

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);

function signedReport() {
  return {
    id: "report-production-001",
    residentId: "resident-001",
    documentProfile: {
      standardCode: Standards.ADULT_EXAM_DOCUMENT_STANDARD,
      documentId: "DOC-001",
      version: "1",
      sections: [...Standards.REQUIRED_SECTIONS],
      authorId: "doctor-final-001",
      custodianId: "hospital-001",
      sourceDocumentHash: DIGEST_A
    },
    sectionSignatures: ["physical-examination", "laboratory", "imaging"].map((sectionId) => ({
      sectionId,
      physicianId: `doctor-${sectionId}`,
      physicianLicenseNo: `LICENSE-${sectionId}`,
      signedAt: "2026-07-24T08:00:00.000Z",
      status: "signed",
      signatureRef: `signature://${sectionId}`
    })),
    signature: {
      standardCode: Standards.DIGITAL_SIGNATURE_STANDARD,
      status: "verified",
      mode: "external-production",
      asymmetricAlgorithm: "SM2",
      digestAlgorithm: "SM3",
      format: "ES-T XML",
      signatureNo: "SIGN-001",
      signer: "总检医师",
      signedAt: "2026-07-24T08:00:00.000Z",
      certificateSerial: "CA-PRODUCTION-001",
      certificateChainVerified: true,
      revocationStatusVerified: true,
      timestamp: "2026-07-24T08:00:01.000Z",
      timestampVerified: true,
      digestValue: DIGEST_A,
      signedDocumentHash: DIGEST_A,
      signatureValueRef: "signature://SIGN-001",
      verifiedAt: "2026-07-24T08:01:00.000Z"
    }
  };
}

function mappingEvidence(profileId, sourceSystem) {
  const profile = Production.SOURCE_MAPPING_PROFILES[profileId];
  return {
    profileId,
    profileVersion: profile.version,
    sourceSystem,
    endpointId: `${sourceSystem}-production-endpoint`,
    fieldDictionaryVersion: "2026.07",
    sampleRequestRef: `${sourceSystem}-request-001`,
    sampleResponseRef: `${sourceSystem}-response-001`,
    evidenceRef: `${sourceSystem}-mapping-evidence-001`,
    payloadSha256: DIGEST_B,
    mappingStatus: "mapped"
  };
}

function integrationReceipt(sourceSystem, sequence) {
  return {
    eventId: `event-${sequence}`,
    idempotencyKey: `idempotency-${sequence}`,
    sourceSystem,
    receiptRef: `receipt-${sequence}`,
    acceptedAt: "2026-07-24T08:10:00.000Z",
    payloadSha256: DIGEST_B,
    signatureVerified: true,
    mappingStatus: "mapped",
    landingStatus: "landed",
    responseCode: 202,
    simulated: false,
    productionEvidence: true
  };
}

function archiveEvidence(scanStatus = "clean") {
  return {
    reportId: "report-production-001",
    objectId: "object-001",
    objectVersionId: "version-001",
    sha256: DIGEST_A,
    mimeType: "application/pdf",
    sizeBytes: 102400,
    scanStatus,
    scanEngine: "production-malware-scanner",
    scanEngineVersion: "2026.07",
    scanCompletedAt: "2026-07-24T08:05:00.000Z",
    checksumVerified: true,
    immutable: true,
    retentionYears: 15,
    encryptionAtRest: true,
    evidenceRef: "archive-receipt-001"
  };
}

function closedWorkflow() {
  const workflow = Production.createAbnormalClosure({
    id: "report-production-001",
    residentId: "resident-001",
    examDate: "2026-07-24",
    findings: [{ code: "BP", name: "血压", abnormal: true, value: "152/92" }]
  }, { actor: "system", now: "2026-07-24T08:00:00.000Z" });
  const caseId = workflow.cases[0].id;
  Production.applyAbnormalClosureAction(workflow, caseId, { action: "confirm", physicianId: "doctor-001", evidenceRef: "confirm-001" }, { actor: "doctor-001", now: "2026-07-24T08:10:00.000Z" });
  Production.applyAbnormalClosureAction(workflow, caseId, { action: "notify", evidenceRef: "notice-001", deliveryReceipt: { receiptId: "delivery-001", channel: "sms", status: "delivered", deliveredAt: "2026-07-24T08:12:00.000Z" } }, { actor: "operator-001", now: "2026-07-24T08:12:00.000Z" });
  Production.applyAbnormalClosureAction(workflow, caseId, { action: "schedule-review", evidenceRef: "appointment-evidence-001", appointmentRef: "appointment-001", targetOrganization: "hospital-001", dueAt: "2026-07-31" }, { actor: "operator-001", now: "2026-07-24T08:15:00.000Z" });
  Production.applyAbnormalClosureAction(workflow, caseId, { action: "family-doctor-followup", evidenceRef: "followup-evidence-001", followupRef: "followup-001", familyDoctorTeam: "family-doctor-team-001", outcome: "居民已完成复查，进入持续血压管理" }, { actor: "family-doctor-001", now: "2026-07-31T09:00:00.000Z" });
  Production.applyAbnormalClosureAction(workflow, caseId, { action: "close", evidenceRef: "closure-001" }, { actor: "doctor-001", now: "2026-07-31T09:10:00.000Z" });
  return workflow;
}

function siteSignoff(sequence) {
  return {
    submittedBy: `institution-operator-${sequence}`,
    verifiedBy: `commission-reviewer-${sequence}`,
    externalSigner: `机构负责人${sequence}`,
    signerOrganization: sequence === 1 ? "体检中心" : "医院",
    submissionRef: `site-submission-${sequence}`,
    verificationRef: `site-verification-${sequence}`,
    evidenceDigest: DIGEST_C,
    verifiedDigest: DIGEST_C,
    status: "independently-verified",
    submittedAt: "2026-07-24T10:00:00.000Z",
    verifiedAt: "2026-07-24T11:00:00.000Z"
  };
}

function smokeEvidence() {
  return {
    moduleId: "physical-examination",
    entry: "physical-examination-standalone.html",
    loadedModules: ["physical-examination-standards", "physical-examination-production", "physical-examination-standalone"],
    requiredFiles: [...Production.REQUIRED_STANDALONE_FILES],
    probes: ["static-entry", "field-mapping", "signature-contract", "archive-scan", "care-closure"].map((id) => ({ id, passed: true, evidenceRef: `smoke-${id}-001` })),
    executedAt: "2026-07-24T12:00:00.000Z",
    evidenceRef: "standalone-smoke-001"
  };
}

function rollbackEvidence() {
  return {
    currentVersion: Production.VERSION,
    previousVersion: "physical-examination-production-v0",
    artifactSha256: DIGEST_B,
    snapshotRef: "snapshot-001",
    rehearsalRef: "rollback-rehearsal-001",
    rehearsedAt: "2026-07-24T12:30:00.000Z",
    targetRtoMinutes: 30,
    restoreDurationMinutes: 12,
    reconciliationPassed: true,
    preparedBy: "ops-a",
    approvedBy: "ops-b",
    approved: true
  };
}

test("体检中心和医院源字段映射为统一报告并生成映射回执", () => {
  const center = Production.mapSourceReport({
    person: { index: "MPI-001" },
    checkupId: "CENTER-001",
    organization: { code: "CENTER", name: "健康体检中心" },
    checkupNo: "TJ-001",
    checkupDate: "2026-07-24",
    conclusion: "体检完成",
    items: [{ itemCode: "BP", itemName: "血压", result: "152/92", resultUnit: "mmHg", isAbnormal: true }],
    _evidence: { payloadSha256: DIGEST_B, sourceSystem: "center-prod" }
  }, "exam-center-v1");
  assert.equal(center.ok, true);
  assert.equal(center.canonical.sourceType, "exam-center");
  assert.equal(center.canonical.personIndex, "MPI-001");
  assert.equal(center.canonical.findings[0].abnormal, true);
  assert.equal(center.receipt.status, "mapped");

  const hospital = Production.mapSourceReport({
    MPI_ID: "MPI-002",
    DOCUMENT_ID: "DOC-H-001",
    ORG_CODE: "HOSPITAL",
    ORG_NAME: "市中心医院",
    REPORT_NO: "TJ-H-001",
    EXAM_DATE: "2026-07-24",
    CONCLUSION: "医院体检完成",
    ITEMS: [{ ITEM_CODE: "GLU", ITEM_NAME: "空腹血糖", RESULT_VALUE: "7.1", RESULT_UNIT: "mmol/L", ABNORMAL_FLAG: "Y" }],
    _evidence: { payloadSha256: DIGEST_B, sourceSystem: "hospital-prod" }
  }, "hospital-v1");
  assert.equal(hospital.ok, true);
  assert.equal(hospital.canonical.findings[0].code, "GLU");
  assert.equal(hospital.canonical.findings[0].abnormal, true);
});

test("报告签名契约拒绝演示签名并验证原文摘要绑定", () => {
  const valid = Production.validateReportSignatureContract(signedReport());
  assert.equal(valid.ok, true);
  const demo = signedReport();
  demo.signature.mode = "demo";
  demo.signature.signedDocumentHash = DIGEST_B;
  const invalid = Production.validateReportSignatureContract(demo);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.issues.includes("signature-not-production"), true);
  assert.equal(invalid.issues.includes("signature-document-binding-mismatch"), true);
});

test("异常通知、复查预约和家医随访必须按顺序留存真实回执", () => {
  const workflow = Production.createAbnormalClosure({
    id: "report-production-001",
    residentId: "resident-001",
    examDate: "2026-07-24",
    findings: [{ code: "HBA1C", abnormal: true, value: "7.2" }]
  }, { actor: "system" });
  const caseId = workflow.cases[0].id;
  assert.equal(workflow.cases[0].familyDoctorSuggestion.packageId, "diabetes-risk-review");
  assert.equal(workflow.cases[0].familyDoctorSuggestion.autoSign, false);
  assert.throws(() => Production.applyAbnormalClosureAction(workflow, caseId, { action: "notify", evidenceRef: "notice" }, { actor: "operator" }), /医师确认/);
  Production.applyAbnormalClosureAction(workflow, caseId, { action: "confirm", physicianId: "doctor-001", evidenceRef: "confirm-001" }, { actor: "doctor-001" });
  assert.throws(() => Production.applyAbnormalClosureAction(workflow, caseId, { action: "notify", evidenceRef: "notice-001", deliveryReceipt: { status: "sent" } }, { actor: "operator" }), /真实送达回执/);
  assert.equal(Production.validateAbnormalClosure(workflow).ok, false);
  assert.equal(Production.validateAbnormalClosure(closedWorkflow()).ok, true);
});

test("原件归档必须通过校验和、恶意文件扫描和十五年不可变留存", () => {
  assert.equal(Production.validateArchiveEvidence(archiveEvidence()).ok, true);
  const infected = Production.validateArchiveEvidence(archiveEvidence("infected"));
  assert.equal(infected.ok, false);
  assert.equal(infected.issues.includes("malware-scan-not-clean"), true);
  const mutable = archiveEvidence();
  mutable.immutable = false;
  mutable.retentionYears = 5;
  assert.equal(Production.validateArchiveEvidence(mutable).issues.includes("retention-less-than-15-years"), true);
});

test("独立模块冒烟拒绝急救、用血或影像依赖，回退门禁要求独立批准", () => {
  assert.equal(Production.validateStandaloneSmoke(smokeEvidence()).ok, true);
  const coupled = smokeEvidence();
  coupled.loadedModules.push("emergency-service");
  assert.equal(Production.validateStandaloneSmoke(coupled).issues.includes("forbidden-cross-domain-dependency"), true);
  assert.equal(Production.validateRollbackGate(rollbackEvidence()).ok, true);
  const selfApproved = rollbackEvidence();
  selfApproved.approvedBy = selfApproved.preparedBy;
  assert.equal(Production.validateRollbackGate(selfApproved).issues.includes("rollback-independent-approval-invalid"), true);
});

test("现场证据未签收时保持 NO-GO，全部真实证据齐备才允许生产切换", () => {
  const incomplete = Production.buildGoLiveDecision({ environment: "production" });
  assert.equal(incomplete.decision, "NO-GO");
  assert.equal(incomplete.goLiveReady, false);
  assert.equal(incomplete.blockers.length > 0, true);

  const complete = Production.buildGoLiveDecision({
    environment: "production",
    enabledSourceTypes: ["exam-center", "hospital"],
    mappingEvidence: [mappingEvidence("exam-center-v1", "center-prod"), mappingEvidence("hospital-v1", "hospital-prod")],
    integrationReceipts: [integrationReceipt("center-prod", 1), integrationReceipt("hospital-prod", 2)],
    reports: [signedReport()],
    archiveEvidence: [archiveEvidence()],
    workflows: [closedWorkflow()],
    siteSignoffs: [siteSignoff(1), siteSignoff(2)],
    smoke: smokeEvidence(),
    rollback: rollbackEvidence()
  });
  assert.equal(complete.decision, "GO");
  assert.equal(complete.goLiveReady, true);
  assert.equal(complete.checks.every((item) => item.ok), true);

  const staging = Production.buildGoLiveDecision({ ...complete, environment: "staging" });
  assert.equal(staging.decision, "NO-GO");
});

test("独立就绪脚本只引用体检域文件并输出可集成清单", () => {
  const report = buildReport();
  assert.equal(report.ok, true);
  assert.equal(report.codeReady, true);
  assert.equal(report.goLiveReady, false);
  assert.equal(report.summary.failed, 0);
  assert.equal(report.integrationFiles.every((item) => /physical-examination|体检/.test(item)), true);
  assert.match(renderMarkdown(report), /NO-GO/);
  const html = fs.readFileSync(path.join(__dirname, "..", "physical-examination-standalone.html"), "utf8");
  const scripts = [...html.matchAll(/<script src="\.\/([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(scripts, ["physical-examination-standards.js", "physical-examination-production.js", "physical-examination-standalone.js"]);
  assert.equal(scripts.some((item) => /(emergency|blood|imaging)/i.test(item)), false);
});
