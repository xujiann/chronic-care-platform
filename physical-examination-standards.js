(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PhysicalExaminationStandards = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const ADULT_EXAM_DOCUMENT_STANDARD = "WS/T 483.16-2016";
  const DIGITAL_SIGNATURE_STANDARD = "WS/T 847-2024";
  const DATA_ELEMENT_STANDARD = "WS/T 363-2023";
  const VALUE_DOMAIN_STANDARD = "WS/T 364-2023";
  const RETENTION_POLICY = "outpatient-medical-record-15y";
  const QUALITY_INDICATOR_STANDARD = "国卫办医政函〔2023〕404号";
  const ADULT_EXAM_GUIDE = "国卫办医政函〔2025〕412号";
  const REQUIRED_SECTIONS = Object.freeze([
    "general-information",
    "physical-examination",
    "laboratory",
    "imaging",
    "positive-findings",
    "health-assessment",
    "recommendations"
  ]);

  const STANDARD_CATALOG = Object.freeze([
    { id: "health-exam-2009-77", level: "业务管理", code: "卫医政发〔2009〕77号", name: "健康体检管理暂行规定", mandatory: true, status: "现行适用", source: "https://www.nhc.gov.cn/zwgk/wtwj/201304/889eb3566368445a84701d24908b61a6.shtml" },
    { id: "adult-exam-guide-2025", level: "项目与风险筛查", code: ADULT_EXAM_GUIDE, name: "成人健康体检项目推荐指引（2025年版）", mandatory: false, status: "现行参照使用", source: "https://www.nhc.gov.cn/yzygj/c100068/202511/4feaeb6de63e44cb9fd4ac8f579ca279.shtml" },
    { id: "health-exam-quality-2023", level: "医疗质量", code: QUALITY_INDICATOR_STANDARD, name: "健康体检与管理专业医疗质量控制指标（2023年版）", mandatory: true, status: "现行质控依据", source: "https://www.nhc.gov.cn/yzygj/c100068/202311/610e3cc82270478f84eeb3c5ba788e23.shtml" },
    { id: "health-exam-quality-target-2026", level: "医疗质量", code: "国卫办医政函〔2026〕63号", name: "2026年健康体检与管理专业质控工作改进目标：提高重要异常结果随访率", mandatory: true, status: "2026年度改进目标", source: "https://www.nhc.gov.cn/yzygj/c100068/202603/9f642951b99c447f8cff9da8abb74dc3.shtml" },
    { id: "health-exam-radiation-2012", level: "放射检查", code: "卫办监督发〔2012〕148号", name: "关于规范健康体检应用放射检查技术的通知", mandatory: true, status: "现行适用", source: "https://www.nhc.gov.cn/zhjcj/c100093/201212/69d4b84e1d11482ba9b732936ef2f534.shtml" },
    { id: "wst-482-2016", level: "共享文档", code: "WS/T 482-2016", name: "卫生信息共享文档编制规范", mandatory: false, status: "现行", source: "https://www.nhc.gov.cn/fzs/c100048/201607/c9a505f0ae7f41d0a81f019515b1df9c.shtml" },
    { id: "wst-483-16-2016", level: "共享文档", code: ADULT_EXAM_DOCUMENT_STANDARD, name: "健康档案共享文档规范 第16部分：成人健康体检", mandatory: false, status: "现行", source: "https://www.nhc.gov.cn/wjw/s9497/201607/57f7bca9b7624074808009b8973ad0f4.shtml" },
    { id: "wst-363-2023", level: "数据元", code: DATA_ELEMENT_STANDARD, name: "卫生健康信息数据元目录（重点第2、7、8、9、10、11、12、14、15部分）", mandatory: false, status: "2024-04-01实施并替代2011版", source: "https://www.nhc.gov.cn/fzs/c100048/202310/16a32e2b1c0b42e99480b945ef10c0dc.shtml" },
    { id: "wst-364-2023", level: "值域", code: VALUE_DOMAIN_STANDARD, name: "卫生健康信息数据元值域代码（对应数据元部分）", mandatory: false, status: "2024-04-01实施并替代2011版", source: "https://www.nhc.gov.cn/fzs/c100048/202310/16a32e2b1c0b42e99480b945ef10c0dc.shtml" },
    { id: "wst-448-2014", level: "区域平台", code: "WS/T 448-2014", name: "基于居民健康档案的区域卫生信息平台技术规范", mandatory: false, status: "现行", source: "https://www.nhc.gov.cn/wjw/s9497/201406/5c7aec881f7948f9bd1557380841e5cd.shtml" },
    { id: "wst-790-2021", level: "区域交互", code: "WS/T 790-2021", name: "区域卫生信息平台交互标准", mandatory: false, status: "现行", source: "https://www.nhc.gov.cn/wjw/c100175/202111/d9b0f688a3394ef1afc903b05660bd26/files/1645425535256_33407.pdf" },
    { id: "wst-846-2024", level: "医院交互", code: "WS/T 846.1-11-2024", name: "医院信息平台交互标准", mandatory: false, status: "2025-04-01实施", source: "https://www.nhc.gov.cn/wjw/zcwjtg/202411/308603c60d554dd49052b5bfb3a9d391.shtml" },
    { id: "wst-847-2024", level: "数字签名", code: DIGITAL_SIGNATURE_STANDARD, name: "医学电子文档数字签名技术标准", mandatory: false, status: "2025-04-01实施", source: "https://www.nhc.gov.cn/wjw/s9497/202411/c7630ce5d0bf477fa606830fe8f05f5a.shtml" },
    { id: "emr-2017-8", level: "病历管理", code: "国卫办医发〔2017〕8号", name: "电子病历应用管理规范（试行）", mandatory: true, status: "现行适用", source: "https://www.nhc.gov.cn/wjw/c100175/201702/90f3de8ae03d488cbddf509dc958f75b.shtml" },
    { id: "medical-record-2013-31", level: "病历管理", code: "国卫医发〔2013〕31号", name: "医疗机构病历管理规定（2013年版）", mandatory: true, status: "现行适用", source: "https://www.nhc.gov.cn/yzygj/c100068/201312/c9955f0471c04450a9f9ab74648fbdd4.shtml" },
    { id: "emr-use-2025-262", level: "病历使用", code: "国卫办医政函〔2025〕262号", name: "进一步加强医疗机构电子病历信息使用管理", mandatory: true, status: "现行适用", source: "https://www.nhc.gov.cn/yzygj/c100068/202506/c68abee7c54b4651a774cd533761780b.shtml" },
    { id: "electronic-signature-law", level: "法律", code: "电子签名法（2019修正）", name: "中华人民共和国电子签名法", mandatory: true, status: "现行", source: "https://www.npc.gov.cn/zgrdw/npc/xinwen/2019-05/07/content_2086835.htm" },
    { id: "pipl", level: "法律", code: "个人信息保护法", name: "中华人民共和国个人信息保护法", mandatory: true, status: "现行", source: "https://www.npc.gov.cn/npc/c2/c30834/202108/t20210820_313088.html" },
    { id: "cybersecurity-law-2025", level: "法律", code: "网络安全法（2025修正）", name: "中华人民共和国网络安全法", mandatory: true, status: "2026-01-01施行现行修正版", source: "https://flk.npc.gov.cn/detail?fileId=&id=021e7d7684474107b8f3febbb1c4f8b5&type=" },
    { id: "data-security-law", level: "法律", code: "数据安全法", name: "中华人民共和国数据安全法", mandatory: true, status: "现行", source: "https://www.gov.cn/xinwen/2021-06/11/content_5616919.htm" },
    { id: "network-data-regulation", level: "行政法规", code: "国务院令第790号", name: "网络数据安全管理条例", mandatory: true, status: "2025-01-01施行", source: "https://www.cac.gov.cn/2024-09/30/c_1729384452307680.htm" },
    { id: "health-cybersecurity-2022", level: "行业管理", code: "国卫规划发〔2022〕29号", name: "医疗卫生机构网络安全管理办法", mandatory: true, status: "现行适用", source: "https://www.nhc.gov.cn/wjw/c100175/202208/95d3c3c2b1e343ca9607e0fd07725264.shtml" },
    { id: "gbt-22239-2019", level: "等保", code: "GB/T 22239-2019", name: "网络安全等级保护基本要求", mandatory: false, status: "2025复审继续有效", source: "https://std.samr.gov.cn/gb/search/gbDetailed?id=88F4E6DA63434198E05397BE0A0ADE2D" },
    { id: "gbt-28448-2019", level: "等保", code: "GB/T 28448-2019", name: "网络安全等级保护测评要求", mandatory: false, status: "2025复审继续有效", source: "https://std.samr.gov.cn/gb/search/gbDetailed?id=i3NYKMeGgMs%3D&mode=p" },
    { id: "gbt-39725-2020", level: "医疗数据安全", code: "GB/T 39725-2020", name: "健康医疗数据安全指南", mandatory: false, status: "现行", source: "https://std.samr.gov.cn/gb/search/gbDetailed?id=B691BB77876CD126E05397BE0A0AF3B3" },
    { id: "gbt-35273-2020", level: "个人信息安全", code: "GB/T 35273-2020", name: "个人信息安全规范", mandatory: false, status: "现行（2026年修订计划征求意见中）", source: "https://std.samr.gov.cn/gb/search/gbDetailed?id=F7BE709D9D2B6AF7E05397BE0A0AA8A6" },
    { id: "gbt-43697-2024", level: "数据分类分级", code: "GB/T 43697-2024", name: "数据分类分级规则", mandatory: false, status: "现行", source: "https://std.samr.gov.cn/gb/search/gbDetailed?id=14156507D2210337E06397BE0A0AE656" },
    { id: "gbt-39335-2020", level: "个人信息影响评估", code: "GB/T 39335-2020", name: "个人信息安全影响评估指南", mandatory: false, status: "现行", source: "https://std.samr.gov.cn/gb/search/gbDetailed?id=B4C25880C3DE1CB3E05397BE0A0A92D0" },
    { id: "gbt-37964-2019", level: "去标识化", code: "GB/T 37964-2019", name: "个人信息去标识化指南", mandatory: false, status: "2025复审继续有效", source: "https://std.samr.gov.cn/gb/search/gbDetailed?id=91890A0DA4AB80C6E05397BE0A0A065D" }
  ]);

  function normalizeDocumentProfile(input = {}) {
    const raw = input.documentProfile && typeof input.documentProfile === "object" ? input.documentProfile : {};
    return {
      standardCode: String(raw.standardCode || input.documentStandard || "").trim(),
      documentId: String(raw.documentId || input.documentId || input.externalId || "").trim(),
      version: String(raw.version || input.documentVersion || "1.0").trim(),
      format: String(raw.format || input.documentFormat || "JSON-projection").trim(),
      status: String(raw.status || input.documentStatus || "completed").trim(),
      sourceDocumentHash: String(raw.sourceDocumentHash || input.sourceDocumentHash || "").trim().toLowerCase(),
      sections: normalizeList(raw.sections || input.sections),
      performedSections: normalizeList(raw.performedSections || input.performedSections),
      authorId: String(raw.authorId || input.authorId || "").trim(),
      authorName: String(raw.authorName || input.authorName || "").trim(),
      custodianId: String(raw.custodianId || input.institutionId || "").trim(),
      custodianName: String(raw.custodianName || input.institutionName || "").trim()
    };
  }

  function normalizeQualification(input = {}) {
    const raw = input.institutionQualification && typeof input.institutionQualification === "object" ? input.institutionQualification : {};
    return {
      medicalInstitutionLicenseNo: String(raw.medicalInstitutionLicenseNo || input.medicalInstitutionLicenseNo || "").trim(),
      healthExamRegistered: raw.healthExamRegistered === true || input.healthExamRegistered === true,
      registeredDepartments: normalizeList(raw.registeredDepartments || input.registeredDepartments),
      registeredProjectCodes: normalizeList(raw.registeredProjectCodes || input.registeredProjectCodes),
      signerId: String(raw.signerId || input.signerId || "").trim(),
      signerName: String(raw.signerName || input.signerName || "").trim(),
      signerLicenseNo: String(raw.signerLicenseNo || input.signerLicenseNo || "").trim(),
      signerProfessionalTitle: String(raw.signerProfessionalTitle || input.signerProfessionalTitle || "").trim(),
      signerPracticeScope: String(raw.signerPracticeScope || input.signerPracticeScope || "").trim(),
      signerTrainingQualified: raw.signerTrainingQualified === true || input.signerTrainingQualified === true,
      verificationStatus: String(raw.verificationStatus || "pending").trim()
    };
  }

  function normalizeProcessingBasis(input = {}) {
    const raw = input.processingBasis && typeof input.processingBasis === "object" ? input.processingBasis : {};
    return {
      basis: String(raw.basis || "medical-health-service").trim(),
      purpose: String(raw.purpose || "health-record-archive-and-resident-access").trim(),
      noticeVersion: String(raw.noticeVersion || "").trim(),
      authorizationRef: String(raw.authorizationRef || "").trim(),
      separateConsentRef: String(raw.separateConsentRef || "").trim(),
      minimumNecessaryConfirmed: raw.minimumNecessaryConfirmed === true
    };
  }

  function normalizeSignature(signature = {}) {
    return {
      standardCode: String(signature.standardCode || "").trim(),
      status: String(signature.status || "pending").trim().toLowerCase(),
      mode: String(signature.mode || "external").trim(),
      asymmetricAlgorithm: String(signature.asymmetricAlgorithm || signature.algorithm || "").trim(),
      digestAlgorithm: String(signature.digestAlgorithm || "").trim(),
      format: String(signature.format || "").trim(),
      signatureNo: String(signature.signatureNo || "").trim(),
      signer: String(signature.signer || "").trim(),
      signedAt: String(signature.signedAt || "").trim(),
      certificateSerial: String(signature.certificateSerial || "").trim(),
      certificateChainVerified: signature.certificateChainVerified === true,
      revocationStatusVerified: signature.revocationStatusVerified === true,
      timestamp: String(signature.timestamp || signature.signedAt || "").trim(),
      timestampVerified: signature.timestampVerified === true,
      digestValue: String(signature.digestValue || "").trim(),
      signedDocumentHash: String(signature.signedDocumentHash || "").trim().toLowerCase(),
      signatureValueRef: String(signature.signatureValueRef || "").trim(),
      verifiedAt: String(signature.verifiedAt || "").trim(),
      failureReason: String(signature.failureReason || "").trim()
    };
  }

  function normalizeSectionSignatures(value) {
    return (Array.isArray(value) ? value : []).slice(0, 100).map((item) => ({
      sectionId: String(item?.sectionId || "").trim(),
      physicianId: String(item?.physicianId || "").trim(),
      physicianName: String(item?.physicianName || "").trim(),
      physicianLicenseNo: String(item?.physicianLicenseNo || "").trim(),
      practiceScope: String(item?.practiceScope || "").trim(),
      signedAt: String(item?.signedAt || "").trim(),
      signatureRef: String(item?.signatureRef || "").trim(),
      status: String(item?.status || "signed").trim().toLowerCase()
    }));
  }

  function normalizeHealthQuestionnaire(value = {}) {
    const raw = value && typeof value === "object" ? value : {};
    return {
      version: String(raw.version || "").trim(),
      completedAt: String(raw.completedAt || "").trim(),
      basicInformationCompleted: raw.basicInformationCompleted === true,
      healthHistoryCompleted: raw.healthHistoryCompleted === true,
      lifestyleCompleted: raw.lifestyleCompleted === true,
      mentalHealthCompleted: raw.mentalHealthCompleted === true
    };
  }

  function normalizeRadiationExaminations(value) {
    return (Array.isArray(value) ? value : []).slice(0, 50).map((item) => ({
      modality: String(item?.modality || "").trim().toUpperCase(),
      purpose: String(item?.purpose || "").trim(),
      justification: String(item?.justification || "").trim(),
      riskDisclosureRef: String(item?.riskDisclosureRef || "").trim(),
      protectionOptimized: item?.protectionOptimized === true,
      dose: Number.isFinite(Number(item?.dose)) ? Number(item.dose) : null,
      doseUnit: String(item?.doseUnit || "").trim(),
      pregnancyScreeningStatus: String(item?.pregnancyScreeningStatus || "not-applicable").trim(),
      operatorId: String(item?.operatorId || "").trim(),
      signedConclusionRef: String(item?.signedConclusionRef || "").trim()
    }));
  }

  function questionnaireComplete(questionnaire = {}) {
    return Boolean(questionnaire.completedAt && questionnaire.basicInformationCompleted && questionnaire.healthHistoryCompleted && questionnaire.lifestyleCompleted && questionnaire.mentalHealthCompleted);
  }

  function seniorReviewerQualified(qualification = {}) {
    return /副主任医师|主任医师/.test(qualification.signerProfessionalTitle || "")
      && /内科|外科/.test(qualification.signerPracticeScope || qualification.signerProfessionalTitle || "")
      && Boolean(qualification.signerId && qualification.signerLicenseNo && qualification.signerTrainingQualified);
  }

  function evaluateReport(record = {}) {
    const meta = record.meta || {};
    const profile = meta.documentProfile || normalizeDocumentProfile(meta);
    const signature = normalizeSignature(meta.signature || {});
    const qualification = meta.institutionQualification || normalizeQualification(meta);
    const processingBasis = meta.processingBasis || normalizeProcessingBasis(meta);
    const sectionSignatures = normalizeSectionSignatures(meta.sectionSignatures || []);
    const radiationExaminations = normalizeRadiationExaminations(meta.radiationExaminations || []);
    const sections = new Set(profile.sections || []);
    const signedSections = new Set(sectionSignatures.filter((item) => item.status === "signed" && item.physicianId && item.physicianLicenseNo && item.signedAt && item.signatureRef).map((item) => item.sectionId));
    const inferredSections = [...new Set((meta.findings || []).map((item) => sectionForFinding(item.code)).filter(Boolean))];
    const clinicalSections = (profile.performedSections?.length ? profile.performedSections : inferredSections).filter((item) => ["physical-examination", "laboratory", "imaging"].includes(item));
    const radiationReady = radiationExaminations.every((item) => Boolean(item.modality && item.purpose && item.justification && item.riskDisclosureRef && item.protectionOptimized && item.dose !== null && item.doseUnit && item.operatorId && item.signedConclusionRef));
    const checks = [
      result("document-standard", profile.standardCode === ADULT_EXAM_DOCUMENT_STANDARD, ADULT_EXAM_DOCUMENT_STANDARD),
      result("document-identity", Boolean(profile.documentId && profile.custodianId && profile.authorId), "文档、保管机构与作者标识"),
      result("document-sections", REQUIRED_SECTIONS.every((item) => sections.has(item)), REQUIRED_SECTIONS.join(",")),
      result("source-hash", /^[a-f0-9]{64}$/.test(profile.sourceDocumentHash), "SHA-256 source document hash"),
      result("institution-qualification", Boolean(qualification.medicalInstitutionLicenseNo && qualification.healthExamRegistered && qualification.registeredDepartments.length), "体检资质、许可、登记科目与项目范围"),
      result("section-physician-signatures", clinicalSections.every((item) => signedSections.has(item)), "体格、检验、影像分项结果均关联执业医师及签名"),
      result("final-reviewer-qualification", seniorReviewerQualified(qualification), "内科或外科副主任医师以上主检并完成培训"),
      result("signature-standard", signature.standardCode === DIGITAL_SIGNATURE_STANDARD, DIGITAL_SIGNATURE_STANDARD),
      result("signature-production", signature.mode === "production" || signature.mode === "external-production", "生产签名服务；演示签名不得计入合规"),
      result("signature-algorithm", /SM2/i.test(signature.asymmetricAlgorithm) && /SM3/i.test(signature.digestAlgorithm), "SM2 + SM3"),
      result("signature-format", /ES-T/i.test(signature.format) && Boolean(signature.timestamp), "ES-T + timestamp"),
      result("signature-validation", signature.status === "verified" && signature.certificateChainVerified && signature.revocationStatusVerified && signature.timestampVerified, "证书链、吊销状态、时间戳与摘要验证"),
      result("original-signature-binding", Boolean(profile.sourceDocumentHash && signature.signedDocumentHash === profile.sourceDocumentHash), "原文SHA-256与签名覆盖文档一一关联"),
      result("radiation-governance", radiationReady, "放射检查正当化、风险告知、防护最优化、剂量与签署结论"),
      result("processing-basis", Boolean(processingBasis.noticeVersion && processingBasis.minimumNecessaryConfirmed && (processingBasis.authorizationRef || processingBasis.separateConsentRef)), "告知、授权依据与最小必要"),
      result("retention", meta.retentionPolicy === RETENTION_POLICY && Number(meta.retentionYears || 0) >= 15, "门诊病历不少于15年")
    ];
    return {
      standardCode: ADULT_EXAM_DOCUMENT_STANDARD,
      signatureStandard: DIGITAL_SIGNATURE_STANDARD,
      passed: checks.filter((item) => item.passed).length,
      total: checks.length,
      compliant: checks.every((item) => item.passed),
      checks,
      gaps: checks.filter((item) => !item.passed).map((item) => item.id)
    };
  }

  function result(id, passed, requirement) {
    return { id, passed: Boolean(passed), requirement };
  }

  function sectionForFinding(code) {
    const value = String(code || "").trim().toUpperCase();
    if (["BP", "BMI", "HEIGHT", "WEIGHT", "WAIST", "PULSE"].includes(value)) return "physical-examination";
    if (["GLU", "HBA1C", "CRE", "CBC", "URINE", "STOOL", "LIPID", "ALT", "AST"].includes(value)) return "laboratory";
    if (["ECG", "XRAY", "DR", "CT", "MRI", "US", "ULTRASOUND"].includes(value)) return "imaging";
    return "";
  }

  function normalizeList(value) {
    if (Array.isArray(value)) return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
    return String(value || "").split(/[;,；\n]/).map((item) => item.trim()).filter(Boolean);
  }

  return {
    ADULT_EXAM_GUIDE,
    ADULT_EXAM_DOCUMENT_STANDARD,
    DATA_ELEMENT_STANDARD,
    DIGITAL_SIGNATURE_STANDARD,
    QUALITY_INDICATOR_STANDARD,
    REQUIRED_SECTIONS,
    RETENTION_POLICY,
    STANDARD_CATALOG,
    VALUE_DOMAIN_STANDARD,
    evaluateReport,
    normalizeHealthQuestionnaire,
    normalizeRadiationExaminations,
    normalizeSectionSignatures,
    normalizeDocumentProfile,
    normalizeProcessingBasis,
    normalizeQualification,
    normalizeSignature,
    questionnaireComplete,
    seniorReviewerQualified
  };
});
