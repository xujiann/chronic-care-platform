const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  authorizationState,
  buildAuthorizationRecord,
  diagnosticReportToRecord,
  imagingStudyToRecord,
  medicationPickupToRecord,
  mergeResidentClinicalRecords,
  mergeResidentImagingRecords,
  normalizeEmrRecord,
  projectAccessReviewPayload,
  projectRecord,
  projectResidentRecords,
  secureAttachmentToRecord,
  sourceTrust,
  summarizeResidentRecords
} = require("../citizen-records-v1");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("resident record projection keeps display fields and removes storage and identity internals", () => {
  const projected = projectRecord({
    id: "record-001",
    residentId: "r1",
    personIndex: "SHOULD-NOT-LEAVE-API-PROJECTION",
    category: "imaging",
    date: "2026-07-20",
    name: "胸部影像报告",
    result: "报告摘要",
    source: "医院 PACS",
    secret: "hidden",
    meta: {
      sourceSystem: "PACS",
      reportNo: "RPT-001",
      authorizationRequired: true,
      objectKey: "clinical/r1/original.dcm",
      uploadUrl: "https://storage.example/upload"
    }
  });

  assert.equal(projected.id, "record-001");
  assert.equal(projected.meta.sourceSystem, "PACS");
  assert.equal(projected.meta.authorizationRequired, true);
  assert.equal("personIndex" in projected, false);
  assert.equal("secret" in projected, false);
  assert.equal("objectKey" in projected.meta, false);
  assert.equal("uploadUrl" in projected.meta, false);
  assert.equal(projectRecord({ residentId: "r1", category: "internal-audit" }), null);
});

test("resident record projection is resident-scoped", () => {
  const records = [
    { id: "r1-emr", residentId: "r1", category: "emr", name: "R1" },
    { id: "r2-emr", residentId: "r2", category: "emr", name: "R2" }
  ];
  assert.deepEqual(projectResidentRecords(records, "r1").map((item) => item.id), ["r1-emr"]);
});

test("image cloud studies become minimized resident report records without storage internals", () => {
  const mapped = imagingStudyToRecord({
    id: "study-r1-ct",
    residentId: "r1",
    patientName: "不得返回的姓名",
    accessionNumber: "CT-20260722",
    studyInstanceUID: "1.2.840.113619.2.1",
    modality: "CT",
    bodyPart: "胸部",
    studyDate: "2026-07-22",
    institutionName: "试点医院",
    reportConclusion: "未见明确急性实变影。",
    reportStatus: "已审核",
    qcStatus: "质控通过",
    browserLevel: true,
    seriesCount: 4,
    imageCount: 286,
    objectPath: "oss://secret-bucket/r1/study",
    accessUrl: "https://storage.example/permanent-link"
  });

  assert.equal(mapped.name, "胸部 CT 影像报告");
  assert.equal(mapped.meta.imageCloudStudyId, "study-r1-ct");
  assert.equal(mapped.meta.authorizationRequired, true);
  assert.equal(mapped.meta.originalAvailable, true);
  assert.equal(mapped.meta.qcStatus, "质控通过");
  assert.equal("patientName" in mapped, false);
  assert.equal("objectPath" in mapped, false);
  assert.equal("accessUrl" in mapped, false);
  assert.doesNotMatch(JSON.stringify(mapped), /secret-bucket|storage\.example|不得返回的姓名/);
});

test("image cloud merge does not duplicate a study already linked to a resident record", () => {
  const existing = [{
    id: "existing-image",
    residentId: "r1",
    category: "imaging",
    meta: { imageCloudStudyId: "study-r1-ct" }
  }];
  const dashboard = {
    studies: [
      { id: "study-r1-ct", residentId: "r1" },
      { id: "study-r1-dr", residentId: "r1", modality: "DR", bodyPart: "胸部" }
    ]
  };
  const merged = mergeResidentImagingRecords(existing, dashboard);

  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((item) => item.meta.imageCloudStudyId), ["study-r1-ct", "study-r1-dr"]);
});

test("diagnostic reports expose a resident-readable summary without hashes or master indexes", () => {
  const mapped = diagnosticReportToRecord({
    id: "dr-ecg-r1",
    externalId: "ECG-20260722",
    residentId: "r1",
    item: "心电图",
    category: "electrocardiogram",
    sourceInstitution: "社区卫生服务中心",
    result: "窦性心律",
    conclusion: "未见急性改变",
    reportedAt: "2026-07-22",
    status: "recognized",
    reportPdfHash: "sha256:must-not-leave",
    personIndex: "identity-must-not-leave"
  });

  assert.equal(mapped.category, "labs");
  assert.equal(mapped.name, "心电图检查报告");
  assert.equal(mapped.result, "窦性心律；未见急性改变");
  assert.equal(mapped.meta.reportNo, "ECG-20260722");
  assert.equal(mapped.meta.mutualRecognitionStatus, "recognized");
  assert.doesNotMatch(JSON.stringify(mapped), /reportPdfHash|must-not-leave|personIndex/);
});

test("medication pickup becomes a service-status record rather than a prescription authority claim", () => {
  const mapped = medicationPickupToRecord({
    id: "pickup-r1",
    residentId: "r1",
    medication: "苯磺酸氨氯地平片",
    dosage: "每日 1 次",
    pharmacy: "社区药房",
    nextPickup: "2026-08-05",
    pharmacyStatus: "待取药",
    institutionReview: "已确认",
    insuranceReview: "已通过",
    coverage: "门诊慢特病",
    internalSettlementId: "must-not-leave"
  });

  assert.equal(mapped.category, "medications");
  assert.equal(mapped.meta.recordKind, "medication-service");
  assert.equal(mapped.meta.authority, "pharmacy-service");
  assert.equal(mapped.meta.originalAvailable, false);
  assert.match(mapped.result, /下次取药 2026-08-05/);
  assert.doesNotMatch(JSON.stringify(mapped), /internalSettlementId|must-not-leave/);
});

test("clinical source merge is idempotent by governed source record id", () => {
  const source = {
    diagnosticReports: [{ id: "report-r1", residentId: "r1", category: "lab", item: "肾功能" }],
    medicationPickups: [{ id: "pickup-r1", residentId: "r1", medication: "厄贝沙坦片" }]
  };
  const first = mergeResidentClinicalRecords([], source);
  const second = mergeResidentClinicalRecords(first, source);
  assert.equal(first.length, 2);
  assert.equal(second.length, 2);
});

test("system-ingested EMR is normalized as a clinical summary while identity internals stay excluded", () => {
  const mapped = normalizeEmrRecord({
    id: "emr-r1",
    residentId: "r1",
    category: "emr",
    date: "2026-07-20",
    name: "门诊病历摘要",
    source: "试点医院",
    createdBy: "system",
    personIndex: "must-not-leave",
    meta: { visitType: "门诊", exams: ["血压复测"] }
  });
  assert.equal(mapped.meta.recordKind, "emr-summary");
  assert.equal(mapped.meta.sourceSystem, "EMR");
  assert.equal(mapped.meta.sourceTrust, "clinical");
  assert.equal("personIndex" in mapped, false);
});

test("secure attachments expose scan and retention state without object storage credentials", () => {
  const mapped = secureAttachmentToRecord({
    id: "attachment-r1",
    residentId: "r1",
    filename: "门诊报告.pdf",
    contentType: "application/pdf",
    sizeBytes: 2048,
    status: "active",
    scanStatus: "clean",
    classification: "临床附件",
    retentionPolicy: "clinical-10y",
    immutable: true,
    objectKey: "clinical/r1/private.pdf",
    uploadId: "secret-upload-id",
    expectedChecksumSha256: "secret-checksum"
  });
  assert.equal(mapped.meta.recordKind, "secure-attachment");
  assert.equal(mapped.meta.originalAvailable, true);
  assert.equal(mapped.meta.scanStatus, "clean");
  assert.equal(mapped.meta.immutable, true);
  assert.doesNotMatch(JSON.stringify(mapped), /objectKey|private\.pdf|secret-upload-id|secret-checksum/);
});

test("access review projection removes audit-chain and resident identity internals", () => {
  const projected = projectAccessReviewPayload({
    authorizations: [{ id: "auth-r1", residentId: "r1", category: "authorizations", name: "家庭医生" }],
    accessLogs: [{
      id: "log-r1",
      residentId: "r1",
      actor: "试点医院",
      scope: "电子病历摘要",
      purpose: "复诊",
      result: "允许",
      personIndex: "must-not-leave",
      auditHash: "secret-audit-hash",
      previousAuditHash: "secret-previous-hash"
    }]
  }, "r1");
  assert.equal(projected.authorizations.length, 1);
  assert.equal(projected.accessLogs[0].actor, "试点医院");
  assert.doesNotMatch(JSON.stringify(projected), /personIndex|secret-audit-hash|secret-previous-hash/);
});

test("authorization model requires purpose scope expiry and evaluates active expired revoked states", () => {
  const record = buildAuthorizationRecord({
    residentId: "r1",
    granteeName: "家庭医生团队",
    granteeId: "team-family-doctor-r1",
    granteeType: "care-team",
    purpose: "高血压复诊",
    scopes: ["health-record-summary", "emr-summary", "emr-summary"],
    expiresAt: "2026-12-31",
    grantedAt: "2026-07-22T08:00:00.000Z"
  });

  assert.equal(record.category, "authorizations");
  assert.equal(record.meta.granteeId, "team-family-doctor-r1");
  assert.deepEqual(record.meta.scopes, ["health-record-summary", "emr-summary"]);
  assert.equal(record.meta.consentVersion, "resident-record-consent-v1");
  assert.equal(authorizationState(record, new Date("2026-07-22T09:00:00+08:00")).key, "active");
  assert.equal(authorizationState(record, new Date("2027-01-01T09:00:00+08:00")).key, "expired");
  assert.equal(authorizationState({ ...record, status: "已撤销", revokedAt: "2026-07-23T00:00:00.000Z" }).key, "revoked");
  assert.equal(authorizationState({ residentId: "r1", category: "authorizations", status: "pending" }).active, false);
  assert.equal(authorizationState({ residentId: "r1", category: "authorizations", status: "authorized" }).active, true);
  assert.equal(authorizationState({ ...record, status: "pending", meta: { ...record.meta, status: "pending" } }, new Date("2026-07-22T09:00:00+08:00")).active, false);
  assert.equal(authorizationState({ ...record, status: "active", meta: { ...record.meta, status: "pending" } }, new Date("2026-07-22T09:00:00+08:00")).active, false);
  assert.throws(() => buildAuthorizationRecord({ residentId: "r1", granteeName: "团队", purpose: "复诊", expiresAt: "2026-12-31" }), /范围/);
  assert.throws(() => buildAuthorizationRecord({ residentId: "r1", granteeName: "团队", granteeId: "team-r1", purpose: "复诊", scopes: ["emr-summary"], expiresAt: "not-a-date" }), /格式/);
  assert.throws(() => buildAuthorizationRecord({ residentId: "r1", granteeName: "团队", granteeId: "team-r1", purpose: "复诊", scopes: ["*"], expiresAt: "2026-12-31", grantedAt: "2026-07-22T08:00:00.000Z" }), /范围不受支持/);
  assert.throws(() => buildAuthorizationRecord({ residentId: "r1", granteeName: "团队", granteeId: "team-r1", purpose: "复诊", scopes: ["labs", "internal-all-records"], expiresAt: "2026-12-31", grantedAt: "2026-07-22T08:00:00.000Z" }), /范围不受支持/);
  assert.throws(() => buildAuthorizationRecord({ residentId: "r1", granteeName: "团队", granteeId: "team-r1", purpose: "复诊", scopes: ["labs"], expiresAt: "2026-07-21", grantedAt: "2026-07-22T08:00:00.000Z" }), /不能早于/);
});

test("resident summary separates authoritative and self-reported records", () => {
  const records = [
    { id: "emr-1", residentId: "r1", category: "emr", source: "医院 EMR", meta: { sourceSystem: "EMR" } },
    { id: "lab-self", residentId: "r1", category: "labs", source: "居民个人提供（待核验）", meta: { sourceTrust: "self-reported" } },
    { id: "img-1", residentId: "r1", category: "imaging", source: "医院 PACS", meta: { authorizationRequired: true } },
    buildAuthorizationRecord({ residentId: "r1", granteeName: "家庭医生", granteeId: "team-family-doctor", purpose: "复诊", scopes: ["emr-summary"], expiresAt: "2026-12-31", grantedAt: "2026-07-22T08:00:00.000Z" })
  ];
  records[3].id = "auth-1";

  assert.equal(sourceTrust(records[0]), "authoritative");
  assert.equal(sourceTrust(records[1]), "self-reported");
  assert.equal(sourceTrust({ source: "居民健康档案" }), "pending-verification");
  assert.deepEqual(summarizeResidentRecords(records, "r1", new Date("2026-07-22T09:00:00+08:00")), {
    records: 3,
    categories: 3,
    authoritative: 2,
    selfReported: 1,
    activeAuthorizations: 1,
    restrictedOriginals: 1
  });
});

test("resident UI uses the dedicated revoke route and exposes the V1 consent and accessibility contract", () => {
  const html = read("citizen.html");
  const js = read("citizen.js");
  const css = read("citizen.css");
  const revokeFunction = js.slice(js.indexOf("async function revokeAuthorization"), js.indexOf("let toastTimer"));

  assert.match(html, /id="resident-records-v1"/);
  assert.match(html, /name="purpose"/);
  assert.match(html, /name="granteeId"/);
  assert.match(html, /name="scopes"/);
  assert.match(html, /value="attachments"/);
  assert.match(html, /name="consentConfirmed"/);
  assert.match(html, /居民个人提供（待核验）/);
  assert.match(html, /citizen-records-v1\.js/);
  assert.match(revokeFunction, /\/authorizations\/\$\{encodeURIComponent\(id\)\}\/revoke/);
  assert.match(revokeFunction, /method: "POST"/);
  assert.doesNotMatch(revokeFunction, /method: "PATCH"/);
  assert.match(js, /sourceTrust: "self-reported"/);
  assert.match(js, /\/imaging-cloud\/studies\/\$\{encodeURIComponent\(studyId\)\}\/viewer/);
  assert.match(js, /进入受控影像调阅/);
  assert.match(js, /\/attachments\/\$\{encodeURIComponent\(attachmentId\)\}\/download-intent/);
  assert.match(js, /\/access-reviews\?residentId=/);
  assert.match(js, /取药服务状态不替代医嘱/);
  assert.match(js, /escapeHtml\(record\.result\)/);
  assert.match(css, /\.vault-tabs button \{[\s\S]*?min-height: 44px/);
  assert.match(css, /\.revoke-button \{[\s\S]*?min-height: 44px/);
  assert.match(css, /\.controlled-viewer-button \{[\s\S]*?min-height: 44px/);
});
