const test = require("node:test");
const assert = require("node:assert/strict");
const Standards = require("../physical-examination-standards");
const Service = require("../physical-examination-service");

function compliantPayload() {
  return {
    sourceType: "hospital",
    residentId: "r1",
    externalId: "PE-STANDARD-001",
    institutionId: "hospital-standard",
    institutionName: "标准测试医院",
    reportNo: "PE-001",
    examDate: "2026-07-15",
    summary: "成人健康体检完成。",
    findings: [{ code: "GLU", name: "空腹血糖", value: "5.2", unit: "mmol/L" }],
    documentProfile: {
      standardCode: Standards.ADULT_EXAM_DOCUMENT_STANDARD,
      documentId: "DOC-PE-001",
      version: "1.0",
      format: "JSON-projection",
      status: "completed",
      sourceDocumentHash: "a".repeat(64),
      sections: Standards.REQUIRED_SECTIONS,
      performedSections: ["physical-examination", "laboratory", "imaging"],
      authorId: "doctor-001",
      authorName: "总检医师",
      custodianId: "hospital-standard",
      custodianName: "标准测试医院"
    },
    institutionQualification: {
      medicalInstitutionLicenseNo: "LICENSE-001",
      healthExamRegistered: true,
      registeredDepartments: ["健康体检", "内科", "外科", "医学检验", "医学影像"],
      signerId: "doctor-001",
      signerName: "总检医师",
      signerLicenseNo: "PHYSICIAN-001",
      signerProfessionalTitle: "内科副主任医师",
      signerPracticeScope: "内科",
      signerTrainingQualified: true,
      verificationStatus: "verified"
    },
    sectionSignatures: ["physical-examination", "laboratory", "imaging"].map((sectionId) => ({
      sectionId,
      physicianId: `doctor-${sectionId}`,
      physicianName: "分项医师",
      physicianLicenseNo: `LICENSE-${sectionId}`,
      practiceScope: sectionId,
      signedAt: "2026-07-15T07:30:00.000Z",
      signatureRef: `signature://${sectionId}`,
      status: "signed"
    })),
    processingBasis: {
      basis: "medical-health-service",
      purpose: "health-record-archive-and-resident-access",
      noticeVersion: "privacy-notice-2026-01",
      authorizationRef: "AUTH-001",
      minimumNecessaryConfirmed: true
    },
    signature: {
      standardCode: Standards.DIGITAL_SIGNATURE_STANDARD,
      status: "verified",
      mode: "production",
      asymmetricAlgorithm: "SM2",
      digestAlgorithm: "SM3",
      format: "ES-T XML",
      signatureNo: "SIG-001",
      signer: "总检医师",
      signedAt: "2026-07-15T08:00:00.000Z",
      certificateSerial: "CERT-001",
      certificateChainVerified: true,
      revocationStatusVerified: true,
      timestamp: "2026-07-15T08:00:01.000Z",
      timestampVerified: true,
      digestValue: "digest-value",
      signedDocumentHash: "a".repeat(64),
      signatureValueRef: "signature://SIG-001",
      verifiedAt: "2026-07-15T08:00:02.000Z"
    }
  };
}

test("规范目录覆盖业务、共享文档、数据元、签名、隐私和安全", () => {
  assert.equal(Standards.STANDARD_CATALOG.length >= 29, true);
  for (const code of ["WS/T 483.16-2016", "WS/T 847-2024", "个人信息保护法", "GB/T 39725-2020", "国卫办医政函〔2023〕404号", "国卫办医政函〔2025〕412号", "国卫办医政函〔2026〕63号"]) {
    assert.equal(Standards.STANDARD_CATALOG.some((item) => item.code === code), true);
  }
});

test("报告主检、分项医师、原文签名和放射治理均属于生产门禁", () => {
  const payload = compliantPayload();
  payload.radiationExaminations = [{ modality: "DR", purpose: "胸部检查", justification: "风险评估后需要", riskDisclosureRef: "NOTICE-001", protectionOptimized: true, dose: 0.1, doseUnit: "mSv", pregnancyScreeningStatus: "not-applicable", operatorId: "radio-001", signedConclusionRef: "signature://imaging" }];
  const report = Service.ingest({ residents: [{ id: "r1" }], personalRecords: [] }, payload, { canAccessResident: () => true, requireStandards: true }).created[0];
  assert.equal(report.meta.standardCompliance.compliant, true);
  assert.equal(report.meta.standardCompliance.checks.some((item) => item.id === "radiation-governance" && item.passed), true);
  const incomplete = compliantPayload();
  incomplete.sectionSignatures = incomplete.sectionSignatures.filter((item) => item.sectionId !== "laboratory");
  assert.throws(() => Service.ingest({ residents: [{ id: "r1" }], personalRecords: [] }, incomplete, { canAccessResident: () => true, requireStandards: true }), /section-physician-signatures/);
});

test("七项健康体检医疗质控指标均可计算或明确标记待采集", () => {
  const reports = Service.seedRecords();
  const indicators = Service.buildQualityIndicators(reports, Service.seedAbnormalCases());
  assert.deepEqual(indicators.map((item) => item.code), ["HCHM-PR-01", "HCHM-PR-02", "HCHM-PR-03", "HCHM-PR-04", "HCHM-PR-05", "HCHM-OU-01", "HCHM-OU-02"]);
  assert.equal(indicators.some((item) => item.collectable === false), true);
});

test("演示签名即使显示核验通过也不能计入生产合规", () => {
  const report = Service.seedRecords()[0];
  assert.equal(report.meta.signature.status, "verified");
  assert.equal(report.meta.signature.mode, "demo");
  assert.equal(report.meta.standardCompliance.compliant, false);
  assert.equal(report.meta.standardCompliance.gaps.includes("signature-production"), true);
});

test("完整生产文档通过全部规范门禁", () => {
  const state = { residents: [{ id: "r1", name: "居民甲" }], personalRecords: [] };
  const result = Service.ingest(state, compliantPayload(), { canAccessResident: () => true, requireStandards: true });
  assert.equal(result.created.length, 1);
  assert.equal(result.created[0].meta.standardCompliance.compliant, true);
  assert.equal(result.created[0].meta.standardCompliance.passed, result.created[0].meta.standardCompliance.total);
});

test("生产接入拒绝缺少文档、资质、授权和真实签名的报告", () => {
  const state = { residents: [{ id: "r1", name: "居民甲" }], personalRecords: [] };
  const payload = compliantPayload();
  payload.signature.mode = "demo";
  assert.throws(() => Service.ingest(state, payload, { canAccessResident: () => true, requireStandards: true }), /signature-production/);
});

test("项目字典以国家卫生健康数据元为主并保留辅助编码", () => {
  const bp = Service.ITEM_DICTIONARY.find((item) => item.code === "BP");
  assert.deepEqual(bp.nationalCodes, ["DE04.10.174.00", "DE04.10.176.00"]);
  assert.match(bp.standard, /WS\/T 363\.7-2023/);
  assert.match(bp.secondaryCode, /LOINC/);
  const bmi = Service.ITEM_DICTIONARY.find((item) => item.code === "BMI");
  assert.deepEqual(bmi.nationalCodes, []);
});
