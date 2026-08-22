const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const PhysicalExaminationService = require("../physical-examination-service");
const { buildReport, renderMarkdown } = require("../scripts/physical-examination-readiness");

function demoState() {
  return {
    residents: [
      { id: "r1", name: "居民甲", idCard: "ID-R1", phone: "PHONE-R1" },
      { id: "r2", name: "居民乙", personIndex: "INDEX-R2" }
    ],
    personalRecords: PhysicalExaminationService.seedRecords(),
    physicalExamAbnormalCases: PhysicalExaminationService.seedAbnormalCases(),
    physicalExamJointTests: PhysicalExaminationService.seedJointTests(),
    physicalExamSpecializedIntakes: [],
    secureAttachments: [],
    integrationGatewayEvents: []
  };
}

test("体检服务同时覆盖体检中心、医院和跨年度历史报告", () => {
  const overview = PhysicalExaminationService.buildOverview(demoState());
  assert.equal(overview.sourceContracts.some((item) => item.sourceType === "exam-center"), true);
  assert.equal(overview.sourceContracts.some((item) => item.sourceType === "hospital"), true);
  assert.equal(overview.reports.length >= 4, true);
  assert.deepEqual(overview.years, ["2026", "2025"]);
  assert.equal(overview.reports.every((item) => item.category === "physical-exam" && item.meta.physicalExam), true);
});

test("体检导入匹配居民主索引并按来源机构与外部标识幂等去重", () => {
  const state = demoState();
  const payload = {
    sourceType: "hospital",
    personIndex: "INDEX-R2",
    externalId: "HIS-NEW-001",
    institutionId: "hospital-new",
    institutionName: "测试医院",
    reportNo: "TJ-NEW-001",
    examDate: "2026-07-15",
    summary: "体检完成，血压偏高。",
    findings: [{ code: "BP", name: "血压", value: "150/90", unit: "mmHg", status: "偏高" }],
    recommendations: ["复测血压"]
  };
  const first = PhysicalExaminationService.ingest(state, payload, { actor: "hospital", canAccessResident: () => true, now: "2026-07-15T08:00:00.000Z" });
  const second = PhysicalExaminationService.ingest(state, payload, { actor: "hospital", canAccessResident: () => true, now: "2026-07-15T08:01:00.000Z" });
  assert.equal(first.created.length, 1);
  assert.equal(first.created[0].residentId, "r2");
  assert.equal(first.created[0].meta.abnormalCount, 1);
  assert.equal(first.created[0].meta.mappingStatus, undefined);
  assert.equal(first.created[0].meta.careLinkage.riskLevel, "中危");
  assert.equal(first.created[0].meta.careLinkage.familyDoctorSuggestion.suggestedPackageId, "p2fdp-hypertension");
  assert.equal(state.chronicScreeningTasks.filter((item) => item.sourceReportId === first.created[0].id).length, 1);
  assert.equal(state.taskMessages.filter((item) => item.meta?.physicalExamCareLink && item.sourceId === first.created[0].id).length, 1);
  assert.equal(state.physicalExamAbnormalCases.some((item) => item.reportId === first.created[0].id && item.status === "pending-contact"), true);
  assert.equal(second.created.length, 0);
  assert.equal(second.duplicates.length, 1);
  assert.equal(state.chronicScreeningTasks.filter((item) => item.sourceReportId === first.created[0].id).length, 1);
  assert.equal(state.taskMessages.filter((item) => item.meta?.physicalExamCareLink && item.sourceId === first.created[0].id).length, 1);
});

test("体检异常同步到慢病分层、家医建议和居民待办并保持可解释", () => {
  const state = demoState();
  state.chronicScreeningTasks = [];
  state.taskMessages = [];
  state.phase2FamilyDoctorContracts = [{ id: "contract-r1", residentId: "r1", packageId: "p2fdp-hypertension", status: "active" }];
  const result = PhysicalExaminationService.synchronizeCareLinks(state, { notify: true, now: "2026-07-16T08:00:00.000Z" });
  assert.equal(result.linkedReports.length, 3);
  assert.equal(result.screeningTasks.length, 3);
  assert.equal(result.messages.length, 3);
  const diabetesTask = state.chronicScreeningTasks.find((item) => item.sourceReportId === "physical-exam-r2-2026-hospital");
  assert.equal(diabetesTask.riskLevel, "高危");
  assert.equal(diabetesTask.priority, "high");
  assert.equal(diabetesTask.triggerEvidence.some((item) => item.code === "HBA1C" && item.severity === "high"), true);
  const contracted = state.personalRecords.find((item) => item.id === "physical-exam-r1-2026-center");
  assert.equal(contracted.meta.careLinkage.familyDoctorSuggestion.action, "review-existing-contract");
  assert.equal(contracted.meta.careLinkage.residentTaskId.startsWith("chronicScreeningTasks:"), true);
  const repeat = PhysicalExaminationService.synchronizeCareLinks(state, { notify: true, now: "2026-07-16T08:01:00.000Z" });
  assert.equal(repeat.messages.length, 0);
  assert.equal(state.chronicScreeningTasks.length, 3);
});

test("体检项目字典、异常闭环、原件归档与联调证据形成上线门禁", () => {
  const state = demoState();
  const overview = PhysicalExaminationService.buildOverview(state);
  assert.equal(overview.summary.mappingRate, 100);
  assert.equal(overview.summary.signedReports, overview.summary.reports);
  assert.equal(overview.itemDictionary.some((item) => item.code === "BP" && /WS\/T 363\.7-2023/.test(item.standard) && /LOINC/.test(item.secondaryCode)), true);

  const abnormalCase = PhysicalExaminationService.applyAbnormalCaseAction(state, "physical-exam-case-r1-2026-bp", { action: "notify", note: "居民提醒已送达" }, { actor: "hospital" });
  assert.equal(abnormalCase.notificationStatus, "delivered");
  assert.equal(abnormalCase.status, "resident-notified");
  assert.throws(() => PhysicalExaminationService.applyAbnormalCaseAction(state, abnormalCase.id, { action: "close", note: "直接关闭" }, { actor: "hospital" }), /通知和随访记录/);
  const followed = PhysicalExaminationService.applyAbnormalCaseAction(state, abnormalCase.id, { action: "followup", note: "已回收居民复诊结果" }, { actor: "hospital" });
  assert.equal(followed.status, "followup-completed");
  const closed = PhysicalExaminationService.applyAbnormalCaseAction(state, abnormalCase.id, { action: "close", note: "证据完整，完成关闭" }, { actor: "hospital" });
  assert.equal(closed.status, "closed");
  assert.throws(() => PhysicalExaminationService.applyAbnormalCaseAction(state, abnormalCase.id, { action: "notify", note: "非法重复通知" }, { actor: "hospital" }), /不允许从 closed/);
  const reopened = PhysicalExaminationService.applyAbnormalCaseAction(state, abnormalCase.id, { action: "reopen", note: "复发后重新建单" }, { actor: "hospital" });
  assert.equal(reopened.status, "reopened");
  assert.throws(() => PhysicalExaminationService.applyAbnormalCaseAction(state, abnormalCase.id, { action: "close", note: "禁止重开后直接关闭" }, { actor: "hospital" }), /不允许从 reopened/);
  assert.equal(closed.status, "closed");

  const report = state.personalRecords.find((item) => item.id === "physical-exam-r1-2026-center");
  const attachment = { id: "att-report", residentId: "r1", status: "active", scanStatus: "clean" };
  PhysicalExaminationService.linkSecureAttachment(report, attachment, { actor: "hospital" });
  assert.equal(report.meta.secureAttachmentId, "att-report");

  assert.throws(() => PhysicalExaminationService.applyJointTestAction(state, "physical-exam-joint-test-hospital", { action: "update-check", checkId: "network", status: "site-passed", note: "现场通过" }), /证据编号/);
  const jointTest = PhysicalExaminationService.applyJointTestAction(state, "physical-exam-joint-test-hospital", { action: "update-check", checkId: "network", status: "site-passed", note: "现场通过", evidenceRef: "UAT-HOSPITAL-001" }, { actor: "health" });
  assert.equal(jointTest.checks.find((item) => item.id === "network").evidenceRef, "UAT-HOSPITAL-001");
  assert.throws(() => PhysicalExaminationService.applyJointTestAction(state, jointTest.id, { action: "signoff", note: "签署确认", evidenceRef: "SIGN-001" }), /未完成现场验收/);
});

test("生产体检视图隔离演示报告、演示异常和模拟网关事件", () => {
  const state = demoState();
  const productionRecord = JSON.parse(JSON.stringify(state.personalRecords[0]));
  productionRecord.id = "physical-exam-production-001";
  productionRecord.meta.externalId = "PRODUCTION-001";
  productionRecord.meta.signature.mode = "external-production";
  productionRecord.meta.signature.certificateSerial = "CA-PRODUCTION-001";
  state.personalRecords.push(productionRecord);
  state.integrationGatewayEvents = [
    { id: "event-demo", contractId: "physical-exam-report-v1", simulated: true },
    { id: "event-production", contractId: "physical-exam-report-v1", simulated: false, productionEvidence: true }
  ];
  const overview = PhysicalExaminationService.buildOverview(state, { excludeDemoData: true });
  assert.deepEqual(overview.reports.map((item) => item.id), ["physical-exam-production-001"]);
  assert.equal(overview.summary.demoReportsExcluded, 4);
  assert.equal(overview.abnormalCases.every((item) => item.reportId === productionRecord.id), true);
  assert.deepEqual(overview.gatewayEvents.map((item) => item.id), ["event-production"]);
  assert.equal(PhysicalExaminationService.isDemoPhysicalExamRecord(state.personalRecords[0]), true);
  assert.equal(PhysicalExaminationService.isDemoPhysicalExamRecord(productionRecord), false);
});

test("机构上线证据必须由不同责任人按同一 SHA-256 摘要四眼核验", () => {
  const state = demoState();
  const jointTestId = "physical-exam-joint-test-hospital";
  const row = state.physicalExamJointTests.find((item) => item.id === jointTestId);
  row.checks = row.checks.map((item) => ({ ...item, status: "site-passed", evidenceRef: `UAT-${item.id}` }));
  const digest = "a".repeat(64);
  assert.throws(() => PhysicalExaminationService.applyJointTestAction(state, jointTestId, { action: "submit-signoff", note: "提交验收", evidenceRef: "SIGN-001", evidenceDigest: "bad", externalSigner: "王主任", signerOrganization: "测试医院" }, { actor: "hospital-a", role: "institution" }), /64 位 SHA-256/);
  const submitted = PhysicalExaminationService.applyJointTestAction(state, jointTestId, { action: "submit-signoff", note: "提交验收", evidenceRef: "SIGN-001", evidenceDigest: digest, externalSigner: "王主任", signerOrganization: "测试医院" }, { actor: "hospital-a", role: "institution", now: "2026-07-18T08:00:00.000Z" });
  assert.equal(submitted.signoffStatus, "submitted-awaiting-independent-verification");
  assert.equal(submitted.siteSignoff, false);
  assert.throws(() => PhysicalExaminationService.applyJointTestAction(state, jointTestId, { action: "verify-signoff", note: "复核通过", evidenceDigest: digest, verificationRef: "REVIEW-001" }, { actor: "hospital-a", role: "commission" }), /不得核验本人/);
  assert.throws(() => PhysicalExaminationService.applyJointTestAction(state, jointTestId, { action: "verify-signoff", note: "复核通过", evidenceDigest: "b".repeat(64), verificationRef: "REVIEW-001" }, { actor: "health-b", role: "commission" }), /摘要与提交证据/);
  assert.throws(() => PhysicalExaminationService.applyJointTestAction(state, jointTestId, { action: "verify-signoff", note: "复核通过", evidenceDigest: digest, verificationRef: "REVIEW-001" }, { actor: "hospital-b", role: "institution" }), /卫生行政角色/);
  const verified = PhysicalExaminationService.applyJointTestAction(state, jointTestId, { action: "verify-signoff", note: "复核通过", evidenceDigest: digest, verificationRef: "REVIEW-001" }, { actor: "health-b", role: "commission", now: "2026-07-18T09:00:00.000Z" });
  assert.equal(verified.siteSignoff, true);
  assert.equal(verified.siteSignoffVerified, true);
  assert.equal(verified.signoffVerification.reviewedBy, "health-b");
  const invalidated = PhysicalExaminationService.applyJointTestAction(state, jointTestId, { action: "update-check", checkId: "network", status: "site-passed", note: "切换后重新验证", evidenceRef: "UAT-network-v2" }, { actor: "hospital-a" });
  assert.equal(invalidated.siteSignoffVerified, false);
  assert.equal(invalidated.signoffSubmission, null);
});

test("体检导入拒绝未知来源、缺失主索引和越权居民", () => {
  const base = { externalId: "x", institutionId: "i", institutionName: "机构", examDate: "2026-07-15", summary: "完成" };
  assert.throws(() => PhysicalExaminationService.ingest(demoState(), { ...base, sourceType: "unknown", residentId: "r1" }), /sourceType/);
  assert.throws(() => PhysicalExaminationService.ingest(demoState(), { ...base, sourceType: "hospital" }), /至少提供一项/);
  assert.throws(() => PhysicalExaminationService.ingest(demoState(), { ...base, sourceType: "hospital", residentId: "r1" }, { canAccessResident: () => false }), /无权/);
});

test("专项体检自动进入受限分流队列且不污染一般体检健康档案", () => {
  const state = demoState();
  state.chronicScreeningTasks = [];
  state.taskMessages = [];
  const beforeRecords = state.personalRecords.length;
  const payload = { sourceType: "hospital", examProgramType: "occupational-health", residentId: "r1", externalId: "OCC-001", institutionId: "occ-hospital", institutionName: "职业健康检查机构", reportNo: "OCC-R-001", examDate: "2026-07-17", summary: "职业健康检查完成", findings: [{ code: "BP", name: "血压", value: "160/95", abnormal: true }] };
  const first = PhysicalExaminationService.ingest(state, payload, { actor: "hospital", canAccessResident: () => true, now: "2026-07-17T01:00:00.000Z" });
  const repeat = PhysicalExaminationService.ingest(state, payload, { actor: "hospital", canAccessResident: () => true, now: "2026-07-17T01:01:00.000Z" });
  assert.equal(first.created.length, 0);
  assert.equal(first.routed.length, 1);
  assert.equal(first.routed[0].restrictedData, true);
  assert.equal(state.personalRecords.length, beforeRecords);
  assert.equal(state.chronicScreeningTasks.some((item) => item.sourceReportId === first.routed[0].id || item.sourceExternalId === payload.externalId), false);
  assert.equal(state.taskMessages.some((item) => item.sourceId === first.routed[0].id), false);
  assert.equal(repeat.routedDuplicates.length, 1);
  assert.throws(() => PhysicalExaminationService.applySpecializedIntakeAction(state, first.routed[0].id, { action: "assign-profile", targetSystem: "occ-system", profileId: "occ-v1" }), /证据编号/);
  const routed = PhysicalExaminationService.applySpecializedIntakeAction(state, first.routed[0].id, { action: "assign-profile", targetSystem: "occ-system", profileId: "occ-v1", evidenceRef: "ROUTE-OCC-001" }, { actor: "health", now: "2026-07-17T01:02:00.000Z" });
  assert.equal(routed.status, "routed-to-specialized-system");
  assert.equal(routed.targetArchiveCategory, "occupational-health-exam");
});

test("体检系统就绪报告核对 API、界面和居民健康档案证据", () => {
  const report = buildReport();
  assert.equal(report.ok, true);
  assert.equal(report.summary.sourceContracts, 2);
  assert.equal(report.checks.every((item) => item.passed), true);
  assert.match(renderMarkdown(report), /居民健康档案/);
  assert.match(renderMarkdown(report), /POST \/api\/physical-exams\/import/);
});

test("体检系统静态入口包含角色守卫与健康档案同步提示", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "physical-examination.html"), "utf8");
  const citizen = fs.readFileSync(path.join(root, "citizen.html"), "utf8");
  assert.match(html, /page-auth-bootstrap\.js/);
  assert.match(html, /data-roles="commission,institution,citizen"/);
  assert.match(html, /physical-exam-import-form/);
  assert.match(html, /physical-exam-readiness/);
  assert.match(html, /机构联调验收/);
  assert.match(html, /专项体检隔离与分流/);
  assert.match(citizen, /physical-examination\.html/);
  assert.match(citizen, /option value="physical-exam"/);
});
