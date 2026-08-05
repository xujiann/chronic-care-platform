(function (root, factory) {
  const standards = typeof module === "object" && module.exports
    ? require("./physical-examination-standards")
    : root?.PhysicalExaminationStandards;
  const highlights = typeof module === "object" && module.exports
    ? require("./physical-examination-highlights")
    : root?.PhysicalExaminationHighlights;
  const regional = typeof module === "object" && module.exports
    ? require("./src/platform/regional/active-region").getActiveRegionalValues()
    : root?.HealthRegionalContext;
  const api = factory(standards, highlights, regional);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PhysicalExaminationService = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Standards, Highlights, Regional) {
  if (!Standards) throw new Error("PhysicalExaminationStandards is required");
  if (!Highlights) throw new Error("PhysicalExaminationHighlights is required");
  if (!Regional) throw new Error("HealthRegionalContext is required");
  const SOURCE_CONTRACTS = [
    {
      id: "exam-center-rest-v1",
      sourceType: "exam-center",
      name: "体检中心标准接入",
      systems: ["体检系统", "健康管理系统"],
      transport: "HTTPS REST / JSON",
      identity: "residentId 或 personIndex",
      required: ["externalId", "institutionId", "institutionName", "examDate", "summary"],
      profile: Standards.ADULT_EXAM_DOCUMENT_STANDARD,
      signatureStandard: Standards.DIGITAL_SIGNATURE_STANDARD,
      status: "standards-ready"
    },
    {
      id: "hospital-exam-v1",
      sourceType: "hospital",
      name: "医院体检结果接入",
      systems: ["HIS", "EMR", "LIS", "PACS"],
      transport: "HTTPS REST / JSON",
      identity: "residentId 或 personIndex",
      required: ["externalId", "institutionId", "institutionName", "examDate", "summary"],
      profile: Standards.ADULT_EXAM_DOCUMENT_STANDARD,
      signatureStandard: Standards.DIGITAL_SIGNATURE_STANDARD,
      status: "standards-ready"
    }
  ];

  const EXAM_PROGRAMS = Object.freeze([
    { id: "adult-general", name: "一般成人健康体检", archiveCategory: "physical-exam", route: "general-archive", residentVisible: true },
    { id: "occupational-health", name: "职业健康检查", archiveCategory: "occupational-health-exam", route: "specialized-profile", residentVisible: false },
    { id: "public-health-special", name: "公共卫生专项体检", archiveCategory: "public-health-exam", route: "specialized-profile", residentVisible: false },
    { id: "student-health", name: "学生健康体检", archiveCategory: "student-health-exam", route: "specialized-profile", residentVisible: false },
    { id: "conscription", name: "征兵体检", archiveCategory: "conscription-exam", route: "specialized-profile", residentVisible: false },
    { id: "driver-license", name: "驾驶人体检", archiveCategory: "driver-license-exam", route: "specialized-profile", residentVisible: false },
    { id: "food-service", name: "从业人员预防性健康检查", archiveCategory: "food-service-exam", route: "specialized-profile", residentVisible: false }
  ]);

  const ITEM_DICTIONARY = Object.freeze([
    { code: "BP", name: "血压", nationalCodes: ["DE04.10.174.00", "DE04.10.176.00"], standard: "WS/T 363.7-2023", secondaryCode: "LOINC 85354-9", valueType: "string", unit: "mmHg", abnormalRule: "systolic >= 140 or diastolic >= 90" },
    { code: "GLU", name: "空腹血糖", nationalCodes: ["DE04.50.038.00"], standard: "WS/T 363.9-2023", secondaryCode: "LOINC 1558-6", valueType: "number", unit: "mmol/L", abnormalRule: "value < 3.9 or value > 6.1" },
    { code: "HBA1C", name: "糖化血红蛋白", nationalCodes: ["DE04.50.083.00"], standard: "WS/T 363.9-2023", secondaryCode: "LOINC 4548-4", valueType: "number", unit: "%", abnormalRule: "value > 6.5" },
    { code: "BMI", name: "BMI", nationalCodes: [], standard: "本地计算指标（待项目字典评审）", secondaryCode: "LOINC 39156-5", valueType: "number", unit: "kg/m²", abnormalRule: "value < 18.5 or value >= 24" },
    { code: "CRE", name: "肌酐", nationalCodes: ["DE04.50.100.00"], standard: "WS/T 363.9-2023", secondaryCode: "LOINC 2160-0", valueType: "number", unit: "μmol/L", abnormalRule: "use institution reference range" },
    { code: "ECG", name: "心电图", nationalCodes: ["DE04.30.043.00"], standard: "WS/T 363.8-2023", secondaryCode: "", valueType: "text", unit: "", abnormalRule: "use signed conclusion" }
  ]);

  function seedRecords() {
    const examinationCenter = Regional.organization("examinationCenter");
    const centralHospital = Regional.organization("centralHospital");
    const universityHospital = Regional.organization("universityHospital");
    const districtHospital = Regional.organization("districtHospital");
    return [
      physicalRecord({
        id: "physical-exam-r1-2026-center",
        residentId: "r1",
        personIndex: "DEMO-ID-R1#DEMO-MOBILE-R1",
        sourceType: "exam-center",
        externalId: "DLEXAM-2026-R1-001",
        institutionId: examinationCenter.code,
        institutionName: examinationCenter.name,
        reportNo: "TJ202605180028",
        examDate: "2026-05-18",
        summary: "年度健康体检完成，血压偏高，其余主要项目未见明显异常。",
        findings: [
          { code: "BP", name: "血压", value: "156/92", unit: "mmHg", reference: "<140/90", abnormal: true },
          { code: "GLU", name: "空腹血糖", value: "5.8", unit: "mmol/L", reference: "3.9-6.1", abnormal: false },
          { code: "BMI", name: "BMI", value: "27.2", unit: "kg/m²", reference: "18.5-23.9", abnormal: true }
        ],
        recommendations: ["两周内复测血压", "继续家庭医生高血压随访", "控制体重并保持规律运动"],
        signature: demoSignature("SIG-DLEXAM-2026-R1-001")
      }),
      physicalRecord({
        id: "physical-exam-r1-2025-hospital",
        residentId: "r1",
        personIndex: "DEMO-ID-R1#DEMO-MOBILE-R1",
        sourceType: "hospital",
        externalId: "HIS-PE-2025-R1-009",
        institutionId: centralHospital.code,
        institutionName: centralHospital.name,
        reportNo: "ZYTJ202505090119",
        examDate: "2025-05-09",
        summary: "医院体检结果已归档，血压及体重指标需持续管理。",
        findings: [
          { code: "BP", name: "血压", value: "150/90", unit: "mmHg", reference: "<140/90", abnormal: true },
          { code: "ECG", name: "心电图", value: "窦性心律", unit: "", reference: "", abnormal: false }
        ],
        recommendations: ["心内科或家庭医生复诊", "记录家庭血压"],
        radiationExaminations: [{ modality: "DR", purpose: "胸部健康检查", justification: "体检方案经医师审核后实施", riskDisclosureRef: "DEMO-RAD-NOTICE-2025-R1", protectionOptimized: true, dose: 0.08, doseUnit: "mSv", pregnancyScreeningStatus: "not-applicable", operatorId: "DEMO-RAD-001", signedConclusionRef: "demo://radiology/TJ202505090119" }],
        signature: demoSignature("SIG-DLCENTRAL-2025-R1-009")
      }),
      physicalRecord({
        id: "physical-exam-r2-2026-hospital",
        residentId: "r2",
        personIndex: "DEMO-ID-R2#DEMO-MOBILE-R2",
        sourceType: "hospital",
        externalId: "HIS-PE-2026-R2-015",
        institutionId: universityHospital.code,
        institutionName: universityHospital.name,
        reportNo: "NFM202605120015",
        examDate: "2026-05-12",
        summary: "糖尿病年度体检完成，糖化血红蛋白偏高，建议内分泌专科复诊。",
        findings: [
          { code: "HBA1C", name: "糖化血红蛋白", value: "7.6", unit: "%", reference: "4.0-6.5", abnormal: true },
          { code: "CRE", name: "肌酐", value: "73", unit: "μmol/L", reference: "41-81", abnormal: false }
        ],
        recommendations: ["两周内内分泌科复诊", "复核用药依从性"],
        signature: demoSignature("SIG-DMU-2026-R2-015")
      }),
      physicalRecord({
        id: "physical-exam-r3-2025-center",
        residentId: "r3",
        personIndex: "DEMO-ID-R3#DEMO-MOBILE-R3",
        sourceType: "exam-center",
        externalId: "GJZ-PE-2025-R3-008",
        institutionId: districtHospital.code,
        institutionName: `${districtHospital.name}体检中心`,
        reportNo: "GJZTJ202512090008",
        examDate: "2025-12-09",
        summary: "年度体检完成，主要指标未见明显异常。",
        findings: [
          { code: "BP", name: "血压", value: "126/78", unit: "mmHg", reference: "<140/90", abnormal: false },
          { code: "GLU", name: "空腹血糖", value: "5.5", unit: "mmol/L", reference: "3.9-6.1", abnormal: false }
        ],
        recommendations: ["保持年度健康体检"],
        signature: demoSignature("SIG-GJZ-2025-R3-008")
      })
    ];
  }

  function seedAbnormalCases() {
    const centralHospital = Regional.organization("centralHospital");
    return [
      { id: "physical-exam-case-r1-2026-bp", reportId: "physical-exam-r1-2026-center", residentId: "r1", findingCodes: ["BP", "BMI"], classification: "important", level: "high", status: "followup-scheduled", confirmationStatus: "confirmed", owner: `${centralHospital.name}心内科/家庭医生`, dueAt: "2026-05-30", notificationStatus: "delivered", latestAction: "居民已收到提醒，家庭医生复测任务已安排。", actions: [{ action: "schedule", at: "2026-05-19T09:00:00.000Z", actor: "system", note: "安排两周内血压复测" }, { action: "confirm", at: "2026-05-18T10:00:00.000Z", actor: "system", note: "异常结果已由医师确认" }] },
      { id: "physical-exam-case-r2-2026-hba1c", reportId: "physical-exam-r2-2026-hospital", residentId: "r2", findingCodes: ["HBA1C"], classification: "important", level: "high", status: "specialist-review", confirmationStatus: "confirmed", owner: "内分泌科", dueAt: "2026-05-26", notificationStatus: "delivered", latestAction: "内分泌专科复诊待完成。", actions: [{ action: "assign", at: "2026-05-13T10:00:00.000Z", actor: "system", note: "分派内分泌科复诊" }, { action: "confirm", at: "2026-05-12T10:00:00.000Z", actor: "system", note: "异常结果已由医师确认" }] }
    ];
  }

  function seedJointTests() {
    const examinationCenter = Regional.organization("examinationCenter");
    const centralHospital = Regional.organization("centralHospital");
    return SOURCE_CONTRACTS.map((contract, index) => ({
      id: `physical-exam-joint-test-${contract.sourceType}`,
      institutionId: index === 0 ? examinationCenter.code : centralHospital.code,
      institutionName: index === 0 ? examinationCenter.name : centralHospital.name,
      sourceType: contract.sourceType,
      contractId: contract.id,
      status: "demo-passed",
      siteSignoff: false,
      siteSignoffVerified: false,
      signoffStatus: "not-submitted",
      signoffSubmission: null,
      signoffVerification: null,
      evidenceRefs: ["sample-request.json", "sample-response.json"],
      checks: [
        { id: "network", name: "HTTPS 专线/白名单", status: "site-pending" },
        { id: "mapping", name: "居民主索引与项目字典", status: "demo-passed" },
        { id: "signature", name: "HMAC 验签与报告电子签章", status: "demo-passed" },
        { id: "idempotency", name: "重复报文幂等", status: "demo-passed" },
        { id: "storage", name: "原报告存储与下载授权", status: "site-pending" },
        { id: "retry", name: "失败重试与死信补偿", status: "demo-passed" }
      ],
      actionHistory: []
    }));
  }

  function physicalRecord(input) {
    const findings = normalizeFindings(input.findings);
    const recommendations = normalizeStringList(input.recommendations);
    const abnormalCount = findings.filter((item) => item.abnormal).length;
    const mappedCount = findings.filter((item) => item.mappingStatus === "mapped").length;
    const meta = {
        physicalExam: true,
        sourceType: normalizeSourceType(input.sourceType),
        externalId: String(input.externalId || "").trim(),
        institutionId: String(input.institutionId || "").trim(),
        institutionName: String(input.institutionName || input.source || "").trim(),
        reportNo: String(input.reportNo || "").trim(),
        findings,
        abnormalCount,
        mappedCount,
        unmappedCount: findings.length - mappedCount,
        nationalMappedCount: findings.filter((item) => item.nationalMappingStatus === "mapped").length,
        qualityStatus: findings.length === mappedCount ? "passed" : "mapping-review",
        recommendations,
        signature: normalizeReportSignature(input.signature),
        sectionSignatures: Standards.normalizeSectionSignatures(input.sectionSignatures),
        documentProfile: Standards.normalizeDocumentProfile(input),
        institutionQualification: Standards.normalizeQualification(input),
        healthQuestionnaire: Standards.normalizeHealthQuestionnaire(input.healthQuestionnaire),
        radiationExaminations: Standards.normalizeRadiationExaminations(input.radiationExaminations),
        examCompletedAt: String(input.examCompletedAt || "").trim(),
        reportIssuedAt: String(input.reportIssuedAt || input.signature?.signedAt || "").trim(),
        stoolTestOrdered: input.stoolTestOrdered === true,
        stoolSampleCollected: input.stoolSampleCollected === true,
        stoolCollectionCaptured: Object.prototype.hasOwnProperty.call(input, "stoolTestOrdered") || Object.prototype.hasOwnProperty.call(input, "stoolSampleCollected"),
        ultrasoundWorkload: normalizeUltrasoundWorkload(input.ultrasoundWorkload),
        processingBasis: Standards.normalizeProcessingBasis(input),
        retentionPolicy: String(input.retentionPolicy || Standards.RETENTION_POLICY),
        retentionYears: Number(input.retentionYears || 15),
        dataElementStandard: Standards.DATA_ELEMENT_STANDARD,
        valueDomainStandard: Standards.VALUE_DOMAIN_STANDARD,
        secureAttachmentId: String(input.secureAttachmentId || "").trim(),
        documentUrl: safeDocumentUrl(input.documentUrl),
        standardVersion: "physical-exam-report-v2",
        archiveStatus: "synced",
        receivedAt: String(input.receivedAt || new Date().toISOString())
      };
    const record = {
      id: input.id || `physical-exam-${stableHash(`${input.sourceType}|${input.institutionId}|${input.externalId}`)}`,
      residentId: String(input.residentId || "").trim(),
      personIndex: String(input.personIndex || "").trim(),
      category: "physical-exam",
      date: normalizeDate(input.examDate || input.date),
      name: String(input.name || `${normalizeDate(input.examDate || input.date).slice(0, 4)}年度健康体检报告`).trim(),
      result: String(input.summary || input.result || "").trim(),
      source: String(input.institutionName || input.source || "").trim(),
      meta,
      createdBy: String(input.createdBy || "system"),
      createdByName: String(input.createdByName || "体检数据接入服务"),
      createdAt: String(input.createdAt || input.receivedAt || new Date().toISOString())
    };
    meta.standardCompliance = Standards.evaluateReport(record);
    return record;
  }

  function ingest(state, payload, context = {}) {
    const rows = Array.isArray(payload?.reports) ? payload.reports : [payload];
    if (!rows.length || rows.length > 100) throw inputError("每次应提交 1-100 份体检报告");
    if (!Array.isArray(state?.residents) || !Array.isArray(state?.personalRecords)) throw inputError("体检归档状态不可用");
    const created = [];
    const duplicates = [];
    const routed = [];
    const routedDuplicates = [];
    if (!Array.isArray(state.physicalExamSpecializedIntakes)) state.physicalExamSpecializedIntakes = [];
    const residentMap = new Map(state.residents.map((item) => [item.id, item]));
    const personIndexMap = new Map(state.residents.map((item) => [personIndexOf(item), item]).filter(([key]) => key));
    const existingKeys = new Map(state.personalRecords.filter(isPhysicalExamRecord).map((item) => [idempotencyKey(item), item]));
    const existingSpecializedKeys = new Map(state.physicalExamSpecializedIntakes.map((item) => [specializedIdempotencyKey(item), item]));

    rows.forEach((raw) => {
      const input = validateImport(raw);
      const resident = residentMap.get(input.residentId) || personIndexMap.get(input.personIndex);
      if (!resident) throw inputError(`无法匹配居民主索引：${input.residentId || input.personIndex || "未提供"}`);
      if (typeof context.canAccessResident === "function" && !context.canAccessResident(resident.id)) {
        const error = new Error(`无权向居民 ${resident.id} 归档体检报告`);
        error.statusCode = 403;
        throw error;
      }
      if (input.examProgramType !== "adult-general") {
        const specialized = buildSpecializedIntake(input, resident, context);
        const specializedKey = specializedIdempotencyKey(specialized);
        if (existingSpecializedKeys.has(specializedKey)) {
          routedDuplicates.push(existingSpecializedKeys.get(specializedKey));
          return;
        }
        state.physicalExamSpecializedIntakes.unshift(specialized);
        existingSpecializedKeys.set(specializedKey, specialized);
        routed.push(specialized);
        return;
      }
      const normalized = physicalRecord({
        ...input,
        residentId: resident.id,
        personIndex: personIndexOf(resident),
        createdBy: context.actor || "integration",
        createdByName: context.actorName || "体检数据接入服务",
        receivedAt: context.now || new Date().toISOString()
      });
      if (context.requireStandards === true && !normalized.meta.standardCompliance.compliant) {
        throw inputError(`报告未通过生产规范门禁：${normalized.meta.standardCompliance.gaps.join("、")}`);
      }
      const key = idempotencyKey(normalized);
      if (existingKeys.has(key)) {
        duplicates.push(existingKeys.get(key));
        return;
      }
      state.personalRecords.unshift(normalized);
      existingKeys.set(key, normalized);
      created.push(normalized);
      if (normalized.meta.abnormalCount > 0) {
        const cases = Array.isArray(state.physicalExamAbnormalCases) ? state.physicalExamAbnormalCases : seedAbnormalCases();
        if (!cases.some((item) => item.reportId === normalized.id)) {
          const abnormalFindings = normalized.meta.findings.filter((item) => item.abnormal);
          const highRisk = abnormalFindings.some((item) => item.riskClass === "A" || item.criticalValue === true);
          cases.unshift({
            id: `physical-exam-case-${stableHash(normalized.id)}`,
            reportId: normalized.id,
            residentId: normalized.residentId,
            findingCodes: abnormalFindings.map((item) => item.code),
            classification: highRisk ? "high-risk" : "important",
            level: highRisk ? "urgent" : "review",
            status: "pending-contact",
            confirmationStatus: "pending",
            owner: "",
            dueAt: addDays(normalized.date, highRisk ? 1 : 14),
            notificationStatus: "pending",
            latestAction: "异常体检报告已进入人工复核与随访队列。",
            actions: [{ action: "created", at: context.now || new Date().toISOString(), actor: context.actor || "integration", note: "系统自动生成异常处置任务" }]
          });
        }
        state.physicalExamAbnormalCases = cases;
      }
    });

    synchronizeCareLinks(state, {
      reportIds: created.map((item) => item.id),
      notify: true,
      actor: context.actor || "integration",
      now: context.now || new Date().toISOString()
    });

    return { created, duplicates, routed, routedDuplicates, total: rows.length };
  }

  function buildSpecializedIntake(input, resident, context = {}) {
    const program = EXAM_PROGRAMS.find((item) => item.id === input.examProgramType);
    if (!program || program.id === "adult-general") throw inputError("专项体检类型无效");
    const now = context.now || new Date().toISOString();
    return {
      id: `physical-exam-specialized-${stableHash(`${input.sourceType}|${input.institutionId}|${input.externalId}|${program.id}`)}`,
      residentId: resident.id,
      personIndex: personIndexOf(resident),
      sourceType: input.sourceType,
      externalId: input.externalId,
      institutionId: input.institutionId,
      institutionName: input.institutionName,
      reportNo: String(input.reportNo || "").trim(),
      examDate: input.examDate,
      examProgramType: program.id,
      examProgramName: program.name,
      targetArchiveCategory: program.archiveCategory,
      route: program.route,
      status: "awaiting-specialized-profile",
      restrictedData: true,
      payloadDigest: stableHash(JSON.stringify({ sourceType: input.sourceType, externalId: input.externalId, institutionId: input.institutionId, examDate: input.examDate, examProgramType: program.id })),
      routingReason: "专项体检不得混入一般成人健康体检档案，未生成慢病风险、家医建议或居民待办。",
      evidenceRefs: [],
      actionHistory: [{ action: "routed", at: now, actor: context.actor || "integration", note: "自动进入专项体检受限分流队列" }],
      createdAt: now,
      updatedAt: now
    };
  }

  function applySpecializedIntakeAction(state, intakeId, payload = {}, context = {}) {
    const intakes = Array.isArray(state?.physicalExamSpecializedIntakes) ? state.physicalExamSpecializedIntakes : [];
    const intake = intakes.find((item) => item.id === intakeId);
    if (!intake) throw notFoundError("专项体检分流记录不存在");
    const action = String(payload.action || "").trim();
    const evidenceRef = String(payload.evidenceRef || "").trim();
    const note = String(payload.note || "").trim();
    if (!["assign-profile", "return-source", "close"].includes(action)) throw inputError("专项体检操作仅支持 assign-profile、return-source 或 close");
    if (!evidenceRef) throw inputError("专项体检分流操作必须提供证据编号");
    if (action === "assign-profile") {
      const targetSystem = String(payload.targetSystem || "").trim();
      const profileId = String(payload.profileId || "").trim();
      if (!targetSystem || !profileId) throw inputError("分配专项画像必须提供 targetSystem 和 profileId");
      intake.targetSystem = targetSystem;
      intake.profileId = profileId;
      intake.status = "routed-to-specialized-system";
    } else if (action === "return-source") {
      intake.status = "returned-to-source";
    } else {
      if (!['routed-to-specialized-system', 'returned-to-source'].includes(intake.status)) throw conflictError("专项体检尚未完成分流或退回，不能关闭");
      intake.status = "closed";
    }
    intake.evidenceRefs = [...new Set([...(intake.evidenceRefs || []), evidenceRef])];
    intake.updatedAt = context.now || new Date().toISOString();
    intake.actionHistory = [...(intake.actionHistory || []), { action, at: intake.updatedAt, actor: context.actor || "system", note: note || evidenceRef, evidenceRef }];
    return intake;
  }

  function synchronizeCareLinks(state, options = {}) {
    if (!state || typeof state !== "object") return { linkedReports: [], screeningTasks: [], messages: [] };
    if (!Array.isArray(state.chronicScreeningTasks)) state.chronicScreeningTasks = [];
    if (!Array.isArray(state.taskMessages)) state.taskMessages = [];
    const selectedIds = options.reportIds?.length ? new Set(options.reportIds) : null;
    const reports = (state.personalRecords || []).filter(isPhysicalExamRecord)
      .filter((item) => !selectedIds || selectedIds.has(item.id))
      .filter((item) => Number(item.meta?.abnormalCount || 0) > 0);
    const residents = new Map((state.residents || []).map((item) => [item.id, item]));
    const contracts = Array.isArray(state.phase2FamilyDoctorContracts) ? state.phase2FamilyDoctorContracts : [];
    const linkedReports = [];
    const screeningTasks = [];
    const messages = [];

    reports.forEach((report) => {
      const resident = residents.get(report.residentId) || {};
      const activeContract = contracts.find((item) => item.residentId === report.residentId && /active|renewal|family-confirmed/i.test(String(item.status || "")));
      const existingLinkage = report.meta?.careLinkage || {};
      const stableNow = options.now
        || existingLinkage.generatedAt
        || existingLinkage.familyDoctorSuggestion?.generatedAt
        || report.createdAt
        || new Date().toISOString();
      const linkage = buildCareLinkage(report, resident, activeContract, { ...options, now: stableNow });
      if (!linkage) return;
      report.meta = { ...(report.meta || {}), careLinkage: linkage };
      linkedReports.push(report);
      const existingIndex = state.chronicScreeningTasks.findIndex((item) => item.id === linkage.screeningTask.id || item.sourceReportId === report.id);
      if (existingIndex >= 0) {
        state.chronicScreeningTasks[existingIndex] = {
          ...linkage.screeningTask,
          ...state.chronicScreeningTasks[existingIndex],
          triggerEvidence: linkage.screeningTask.triggerEvidence,
          familyDoctorSuggestion: linkage.familyDoctorSuggestion,
          riskScoreContribution: linkage.riskScoreContribution
        };
        screeningTasks.push(state.chronicScreeningTasks[existingIndex]);
      } else {
        state.chronicScreeningTasks.unshift(linkage.screeningTask);
        screeningTasks.push(linkage.screeningTask);
      }
      if (options.notify === true && !state.taskMessages.some((item) => item.meta?.physicalExamCareLink === true && item.sourceId === report.id)) {
        const message = buildCareLinkMessage(report, linkage, options);
        state.taskMessages.unshift(message);
        messages.push(message);
      }
    });
    return { linkedReports, screeningTasks, messages };
  }

  function buildCareLinkage(report, resident = {}, activeContract = null, options = {}) {
    const abnormalFindings = (report.meta?.findings || []).filter((item) => item.abnormal);
    if (!abnormalFindings.length) return null;
    const evidence = abnormalFindings.map(classifyAbnormalFinding);
    const highCount = evidence.filter((item) => item.severity === "high").length;
    const riskLevel = highCount ? "高危" : "中危";
    const riskScoreContribution = Math.min(30, evidence.reduce((sum, item) => sum + (item.severity === "high" ? 18 : 10), 0));
    const findingCodes = new Set(evidence.map((item) => item.code));
    const diabetes = findingCodes.has("GLU") || findingCodes.has("HBA1C");
    const hypertension = findingCodes.has("BP") || findingCodes.has("BMI");
    const suggestedPackageId = diabetes ? "p2fdp-diabetes" : hypertension ? "p2fdp-hypertension" : "p2fdp-basic";
    const diseaseType = diabetes && hypertension ? "心脑血管与糖代谢风险" : diabetes ? "糖尿病风险" : hypertension ? "高血压风险" : "综合慢病风险";
    const action = activeContract ? "review-existing-contract" : "recommend-contract";
    const suggestionText = activeContract
      ? `建议家庭医生复核现有签约服务包，将本次${riskLevel}体检异常纳入分层随访。`
      : `建议居民申请${diabetes ? "糖尿病" : hypertension ? "高血压" : "基础健康管理"}家庭医生服务包。`;
    const dueAt = addDays(report.date, riskLevel === "高危" ? 3 : 14);
    const taskId = `cst-pe-${stableHash(report.id)}`;
    const familyDoctorSuggestion = {
      action,
      status: "recommended",
      suggestedPackageId,
      existingContractId: activeContract?.id || "",
      reason: evidence.map((item) => `${item.name}${item.value ? ` ${item.value}${item.unit || ""}` : ""}`).join("、"),
      suggestion: suggestionText,
      sourceReportId: report.id,
      sourceReportNo: report.meta?.reportNo || "",
      generatedAt: options.now || new Date().toISOString()
    };
    const screeningTask = {
      id: taskId,
      residentId: report.residentId,
      personIndex: report.personIndex,
      diseaseType,
      taskName: "体检异常慢病风险复核",
      riskLevel,
      riskScoreContribution,
      priority: riskLevel === "高危" ? "high" : "medium",
      status: "待评估",
      due: dueAt,
      institution: resident.organization || report.source || "基层医疗机构",
      assignee: resident.familyDoctor || "家庭医生团队",
      nextStep: `${suggestionText} ${riskLevel === "高危" ? "3日内联系居民并复测/复诊。" : "14日内完成复核和健康指导。"}`,
      sourceType: "physical-exam",
      sourceReportId: report.id,
      sourceReportNo: report.meta?.reportNo || "",
      sourceExternalId: report.meta?.externalId || "",
      sourceInstitution: report.source,
      triggerEvidence: evidence,
      familyDoctorSuggestion,
      generatedAt: options.now || new Date().toISOString(),
      generatedBy: options.actor || "physical-examination-service"
    };
    return {
      status: "linked",
      riskLevel,
      riskScoreContribution,
      findingCodes: evidence.map((item) => item.code),
      triggerEvidence: evidence,
      screeningTaskId: taskId,
      residentTaskId: `chronicScreeningTasks:${taskId}`,
      dueAt,
      familyDoctorSuggestion,
      screeningTask,
      generatedAt: options.now || new Date().toISOString()
    };
  }

  function classifyAbnormalFinding(finding = {}) {
    const code = String(finding.code || "").toUpperCase();
    const numeric = Number.parseFloat(String(finding.value || "").replace(/[^0-9.-]/g, ""));
    let severity = "medium";
    let threshold = "体检机构标记异常，需家庭医生复核";
    if (code === "BP") {
      const [systolic, diastolic] = String(finding.value || "").split("/").map(Number);
      severity = systolic >= 160 || diastolic >= 100 ? "high" : "medium";
      threshold = `血压 ${systolic || "-"}/${diastolic || "-"} mmHg`;
    } else if (code === "GLU") {
      severity = numeric >= 7 || numeric < 3 ? "high" : "medium";
      threshold = "空腹血糖 >=7.0 或 <3.0 mmol/L 进入高风险复核";
    } else if (code === "HBA1C") {
      severity = numeric >= 7 ? "high" : "medium";
      threshold = "糖化血红蛋白 >=7.0% 进入高风险复核";
    } else if (code === "BMI") {
      severity = numeric >= 28 ? "high" : "medium";
      threshold = "BMI >=28 进入高风险复核";
    } else if (code === "ECG") {
      severity = "high";
      threshold = "异常心电图结论需优先复核";
    }
    return {
      code,
      name: finding.name,
      value: finding.value,
      unit: finding.unit,
      severity,
      threshold,
      standard: finding.standard || "",
      nationalCodes: finding.nationalCodes || []
    };
  }

  function buildCareLinkMessage(report, linkage, options = {}) {
    return {
      id: `msg-pe-${stableHash(report.id)}`,
      taskId: linkage.residentTaskId,
      collection: "chronicScreeningTasks",
      sourceId: report.id,
      residentId: report.residentId,
      targetRole: "citizen",
      channel: "in_app",
      title: `体检异常待复核（${linkage.riskLevel}）`,
      body: `${linkage.familyDoctorSuggestion.suggestion} 请在 ${linkage.dueAt || "规定时间"} 前查看体检报告并配合复测。`,
      status: "sent",
      receipts: [],
      createdAt: options.now || new Date().toISOString(),
      createdBy: options.actor || "physical-examination-service",
      createdByName: "体检慢病联动服务",
      meta: { physicalExamCareLink: true, reportId: report.id, riskLevel: linkage.riskLevel }
    };
  }

  function validateImport(raw = {}) {
    const sourceType = normalizeSourceType(raw.sourceType);
    if (!SOURCE_CONTRACTS.some((item) => item.sourceType === sourceType)) throw inputError("sourceType 仅支持 exam-center 或 hospital");
    const required = ["externalId", "institutionId", "institutionName", "examDate", "summary"];
    const missing = required.filter((key) => !String(raw[key] || "").trim());
    if (missing.length) throw inputError(`缺少必填字段：${missing.join("、")}`);
    if (!raw.residentId && !raw.personIndex) throw inputError("residentId 与 personIndex 至少提供一项");
    const examDate = normalizeDate(raw.examDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(examDate)) throw inputError("examDate 应为 YYYY-MM-DD");
    const examProgramType = normalizeExamProgramType(raw.examProgramType || raw.examScope || "adult-general");
    return {
      ...raw,
      sourceType,
      examDate,
      externalId: String(raw.externalId).trim(),
      institutionId: String(raw.institutionId).trim(),
      institutionName: String(raw.institutionName).trim(),
      summary: String(raw.summary).trim(),
      residentId: String(raw.residentId || "").trim(),
      personIndex: String(raw.personIndex || "").trim(),
      examProgramType
    };
  }

  function buildOverview(state, options = {}) {
    const allowedIds = options.residentIds ? new Set(options.residentIds) : null;
    const residentId = String(options.residentId || "").trim();
    const excludeDemoData = options.excludeDemoData === true;
    const residentMap = new Map((state?.residents || []).map((item) => [item.id, item]));
    const allReports = (state?.personalRecords || [])
      .filter(isPhysicalExamRecord)
      .filter((item) => !allowedIds || allowedIds.has(item.residentId))
      .filter((item) => !residentId || item.residentId === residentId);
    const reports = allReports
      .filter((item) => !excludeDemoData || !isDemoPhysicalExamRecord(item))
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    const reportIds = new Set(reports.map((item) => item.id));
    const institutions = new Set(reports.map((item) => item.meta?.institutionId || item.source).filter(Boolean));
    const residentIds = new Set(reports.map((item) => item.residentId));
    const abnormalReports = reports.filter((item) => Number(item.meta?.abnormalCount || 0) > 0);
    const years = [...new Set(reports.map((item) => String(item.date || "").slice(0, 4)).filter(Boolean))].sort().reverse();
    const cases = (state?.physicalExamAbnormalCases || seedAbnormalCases())
      .filter((item) => !allowedIds || allowedIds.has(item.residentId))
      .filter((item) => !residentId || item.residentId === residentId)
      .filter((item) => !excludeDemoData || reportIds.has(item.reportId))
      .sort((a, b) => String(a.dueAt || "").localeCompare(String(b.dueAt || "")));
    const attachments = new Map((state?.secureAttachments || []).map((item) => [item.id, item]));
    const jointTests = (state?.physicalExamJointTests || seedJointTests()).map((item) => ({ ...item, checks: Array.isArray(item.checks) ? item.checks : [] }));
    const specializedIntakes = (state?.physicalExamSpecializedIntakes || [])
      .filter((item) => !allowedIds || allowedIds.has(item.residentId))
      .filter((item) => !residentId || item.residentId === residentId)
      .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
    const gatewayEvents = (state?.integrationGatewayEvents || [])
      .filter((item) => item.contractId === "physical-exam-report-v1")
      .filter((item) => !excludeDemoData || item.simulated !== true);
    const unresolvedCases = cases.filter((item) => !["closed", "resolved"].includes(item.status));
    const mappingTotal = reports.reduce((total, item) => total + (item.meta?.findings?.length || 0), 0);
    const mappedTotal = reports.reduce((total, item) => total + Number(item.meta?.mappedCount || 0), 0);
    const nationalMappedTotal = reports.reduce((total, item) => total + Number(item.meta?.nationalMappedCount || 0), 0);
    const compliantReports = reports.filter((item) => item.meta?.standardCompliance?.compliant).length;
    const linkedReports = reports.filter((item) => item.meta?.careLinkage?.status === "linked");
    const careTasks = (state?.chronicScreeningTasks || [])
      .filter((item) => item.sourceType === "physical-exam")
      .filter((item) => !allowedIds || allowedIds.has(item.residentId))
      .filter((item) => !residentId || item.residentId === residentId)
      .filter((item) => !excludeDemoData || reportIds.has(item.sourceReportId));
    const qualityIndicators = buildQualityIndicators(reports, cases);
    const highlights = Highlights.build(state, reports, cases, { minimumAggregate: 3 });
    return {
      summary: {
        reports: reports.length,
        residents: residentIds.size,
        institutions: institutions.size,
        abnormalReports: abnormalReports.length,
        years: years.length,
        synced: reports.filter((item) => item.meta?.archiveStatus === "synced").length,
        signedReports: reports.filter((item) => item.meta?.signature?.status === "verified").length,
        standardCompliantReports: compliantReports,
        careLinkedReports: linkedReports.length,
        familyDoctorSuggestions: linkedReports.filter((item) => item.meta?.careLinkage?.familyDoctorSuggestion).length,
        residentRiskTasks: careTasks.length,
        storedReports: reports.filter((item) => item.meta?.secureAttachmentId && attachments.get(item.meta.secureAttachmentId)?.status === "active").length,
        productionStoredReports: reports.filter((item) => {
          const attachment = attachments.get(item.meta?.secureAttachmentId);
          return attachment?.status === "active" && attachment?.scanStatus === "clean";
        }).length,
        demoReportsExcluded: excludeDemoData ? allReports.filter(isDemoPhysicalExamRecord).length : 0,
        openAbnormalCases: unresolvedCases.length,
        mappingRate: mappingTotal ? Math.round((mappedTotal / mappingTotal) * 100) : 100,
        nationalMappingRate: mappingTotal ? Math.round((nationalMappedTotal / mappingTotal) * 100) : 100,
        deadLetters: gatewayEvents.filter((item) => item.deadLetter).length,
        specializedPending: specializedIntakes.filter((item) => !["closed", "returned-to-source"].includes(item.status)).length
      },
      qualityIndicators,
      highlights,
      sourceContracts: SOURCE_CONTRACTS.map((item) => ({ ...item })),
      examPrograms: EXAM_PROGRAMS.map((item) => ({ ...item })),
      specializedIntakes,
      residents: [...residentIds].map((id) => ({ id, name: residentMap.get(id)?.name || id })),
      years,
      reports: reports.map((item) => {
        const attachment = attachments.get(item.meta?.secureAttachmentId);
        return {
          ...item,
          residentName: residentMap.get(item.residentId)?.name || item.residentId,
          abnormalFindings: (item.meta?.findings || []).filter((finding) => finding.abnormal),
          abnormalCase: cases.find((caseItem) => caseItem.reportId === item.id) || null,
          attachment: attachment ? { id: attachment.id, filename: attachment.filename, status: attachment.status, scanStatus: attachment.scanStatus } : null
        };
      }),
      itemDictionary: ITEM_DICTIONARY.map((item) => ({ ...item })),
      standards: Standards.STANDARD_CATALOG.map((item) => ({ ...item })),
      abnormalCases: cases,
      careTasks,
      jointTests,
      gatewayEvents: gatewayEvents.slice(0, 30),
      archive: {
        collection: "personalRecords",
        category: "physical-exam",
        residentEntry: "citizen.html?client=app&page=health-record#service-health-record",
        api: "/api/physical-exams"
      }
    };
  }

  function buildQualityIndicators(reports = [], cases = []) {
    const seniorSigned = reports.filter((item) => Standards.seniorReviewerQualified(item.meta?.institutionQualification || {})).length;
    const questionnaires = reports.filter((item) => Standards.questionnaireComplete(item.meta?.healthQuestionnaire || {})).length;
    const stoolOrdered = reports.filter((item) => item.meta?.stoolTestOrdered === true).length;
    const stoolCollected = reports.filter((item) => item.meta?.stoolTestOrdered === true && item.meta?.stoolSampleCollected === true).length;
    const stoolCollectionCaptured = reports.some((item) => item.meta?.stoolCollectionCaptured === true);
    const ultrasoundRows = reports.map((item) => item.meta?.ultrasoundWorkload).filter((item) => item?.physicianPosts > 0 && item?.workingDays > 0);
    const ultrasoundSites = ultrasoundRows.reduce((total, item) => total + item.examSites, 0);
    const ultrasoundCapacity = ultrasoundRows.reduce((total, item) => total + (item.physicianPosts * item.workingDays), 0);
    const completionDays = reports.map((item) => elapsedDays(item.meta?.examCompletedAt, item.meta?.reportIssuedAt)).filter((item) => item !== null);
    const highRiskCases = cases.filter((item) => item.classification === "high-risk");
    const importantCases = cases.filter((item) => ["important", "high-risk"].includes(item.classification));
    const notifiedHighRisk = highRiskCases.filter((item) => item.notificationStatus === "delivered").length;
    const followedImportant = importantCases.filter((item) => ["followup-completed", "closed", "resolved"].includes(item.status) || (item.actions || []).some((action) => action.action === "followup")).length;
    return [
      qualityIndicator("HCHM-PR-01", "高级职称医师签署报告率", seniorSigned, reports.length, "ratio", reports.length > 0),
      qualityIndicator("HCHM-PR-02", "健康体检问卷完成率", questionnaires, reports.length, "ratio", reports.length > 0),
      qualityIndicator("HCHM-PR-03", "超声医师日均负担超声检查部位数", ultrasoundSites, ultrasoundCapacity, "average", ultrasoundRows.length > 0),
      qualityIndicator("HCHM-PR-04", "大便标本留取率", stoolCollected, stoolOrdered, "ratio", stoolCollectionCaptured),
      { code: "HCHM-PR-05", name: "健康体检报告平均完成时间", numerator: completionDays.reduce((sum, item) => sum + item, 0), denominator: completionDays.length, value: completionDays.length ? Math.round((completionDays.reduce((sum, item) => sum + item, 0) / completionDays.length) * 10) / 10 : null, unit: "天", collectable: completionDays.length > 0 },
      qualityIndicator("HCHM-OU-01", "高危异常结果通知率", notifiedHighRisk, highRiskCases.length, "ratio", true),
      qualityIndicator("HCHM-OU-02", "重要异常结果随访率", followedImportant, importantCases.length, "ratio", true)
    ];
  }

  function qualityIndicator(code, name, numerator, denominator, mode, collectable) {
    return {
      code,
      name,
      numerator,
      denominator,
      value: denominator > 0 ? Math.round((numerator / denominator) * (mode === "ratio" ? 1000 : 10)) / 10 : null,
      unit: mode === "ratio" ? "%" : "部位/医师工作日",
      collectable: collectable === true
    };
  }

  function elapsedDays(start, end) {
    const startAt = new Date(start || "");
    const endAt = new Date(end || "");
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt < startAt) return null;
    return Math.round(((endAt - startAt) / 86400000) * 10) / 10;
  }

  function applyAbnormalCaseAction(state, caseId, payload = {}, context = {}) {
    const cases = Array.isArray(state.physicalExamAbnormalCases) ? state.physicalExamAbnormalCases : seedAbnormalCases();
    const index = cases.findIndex((item) => item.id === caseId);
    if (index < 0) throw notFoundError("未找到体检异常处置记录");
    const action = String(payload.action || "").trim().toLowerCase();
    const transitions = {
      confirm: "confirmed",
      notify: "resident-notified",
      schedule: "followup-scheduled",
      assign: "specialist-review",
      followup: "followup-completed",
      close: "closed",
      reopen: "reopened"
    };
    if (!transitions[action]) throw inputError("异常处置动作仅支持 confirm、notify、schedule、assign、followup、close、reopen");
    const allowedActions = {
      "pending-contact": ["confirm", "notify"],
      confirmed: ["notify"],
      "resident-notified": ["schedule", "assign", "followup"],
      "followup-scheduled": ["notify", "assign", "followup"],
      "specialist-review": ["followup"],
      "followup-completed": ["close"],
      closed: ["reopen"],
      reopened: ["confirm", "notify"]
    };
    const note = String(payload.note || "").trim();
    if (note.length < 2) throw inputError("异常处置备注至少 2 个字符");
    const at = context.now || new Date().toISOString();
    if (action === "close" && (cases[index].notificationStatus !== "delivered" || !(cases[index].actions || []).some((item) => item.action === "followup"))) {
      throw conflictError("重要异常结果必须完成通知和随访记录后才能关闭");
    }
    const currentStatus = String(cases[index].status || "pending-contact");
    if (!(allowedActions[currentStatus] || []).includes(action)) {
      throw conflictError(`异常处置不允许从 ${currentStatus} 执行 ${action}`);
    }
    cases[index] = {
      ...cases[index],
      status: transitions[action],
      owner: String(payload.owner || cases[index].owner || "").trim(),
      dueAt: normalizeDate(payload.dueAt || cases[index].dueAt),
      confirmationStatus: action === "confirm" ? "confirmed" : cases[index].confirmationStatus,
      notificationStatus: action === "notify" ? "delivered" : cases[index].notificationStatus,
      latestAction: note,
      updatedAt: at,
      updatedBy: context.actor || "operator",
      actions: [{ action, note, at, actor: context.actor || "operator" }, ...(cases[index].actions || [])].slice(0, 30)
    };
    state.physicalExamAbnormalCases = cases;
    return cases[index];
  }

  function applyJointTestAction(state, jointTestId, payload = {}, context = {}) {
    const rows = Array.isArray(state.physicalExamJointTests) ? state.physicalExamJointTests : seedJointTests();
    const index = rows.findIndex((item) => item.id === jointTestId);
    if (index < 0) throw notFoundError("未找到体检机构联调记录");
    const action = String(payload.action || "").trim().toLowerCase();
    const note = String(payload.note || "").trim();
    if (note.length < 2) throw inputError("联调处置备注至少 2 个字符");
    const at = context.now || new Date().toISOString();
    if (action === "update-check") {
      const checkId = String(payload.checkId || "").trim();
      const status = String(payload.status || "").trim();
      const evidenceRef = String(payload.evidenceRef || "").trim();
      if (!checkId || !["demo-passed", "site-passed", "site-pending", "failed"].includes(status)) throw inputError("联调检查项或状态无效");
      if (status === "site-passed" && evidenceRef.length < 3) throw inputError("现场验收通过必须提供证据编号或附件引用");
      if (!rows[index].checks.some((item) => item.id === checkId)) throw notFoundError("未找到联调检查项");
      rows[index] = {
        ...rows[index],
        checks: rows[index].checks.map((item) => item.id === checkId ? { ...item, status, note, evidenceRef, updatedAt: at } : item),
        evidenceRefs: evidenceRef ? [...new Set([evidenceRef, ...(rows[index].evidenceRefs || [])])].slice(0, 30) : (rows[index].evidenceRefs || []),
        status: "site-testing",
        siteSignoff: false,
        siteSignoffVerified: false,
        signoffStatus: "checks-updated",
        signoffSubmission: null,
        signoffVerification: null
      };
    } else if (["signoff", "submit-signoff"].includes(action)) {
      const evidenceRef = String(payload.evidenceRef || "").trim();
      const evidenceDigest = normalizeEvidenceDigest(payload.evidenceDigest);
      const externalSigner = String(payload.externalSigner || "").trim();
      const signerOrganization = String(payload.signerOrganization || "").trim();
      const allSitePassed = rows[index].checks.every((item) => ["site-passed", "not-applicable"].includes(item.status));
      if (!allSitePassed) throw conflictError("仍有联调检查项未完成现场验收，不能签署上线确认");
      if (action === "signoff") throw conflictError("生产上线确认必须先提交证据，再由不同责任人独立核验");
      if (evidenceRef.length < 3) throw inputError("上线签署必须提供验收单编号或签字附件引用");
      if (!evidenceDigest) throw inputError("上线签署必须提供 64 位 SHA-256 证据摘要");
      if (externalSigner.length < 2 || signerOrganization.length < 2) throw inputError("上线签署必须登记外部签署人及所属机构");
      const submittedBy = String(context.actor || "").trim();
      if (!submittedBy) throw inputError("上线签署必须记录提交责任人");
      rows[index] = {
        ...rows[index],
        siteSignoff: false,
        siteSignoffVerified: false,
        status: "site-signoff-review",
        signoffStatus: "submitted-awaiting-independent-verification",
        signoffSubmission: { submittedAt: at, submittedBy, evidenceRef, evidenceDigest, externalSigner, signerOrganization },
        signoffVerification: null,
        evidenceRefs: [...new Set([evidenceRef, ...(rows[index].evidenceRefs || [])])].slice(0, 30)
      };
    } else if (["verify-signoff", "reject-signoff"].includes(action)) {
      const submission = rows[index].signoffSubmission;
      if (!submission) throw conflictError("尚未提交上线签署证据，不能执行独立核验");
      const reviewedBy = String(context.actor || "").trim();
      if (!reviewedBy) throw inputError("独立核验必须记录复核责任人");
      if (reviewedBy.toLowerCase() === String(submission.submittedBy || "").trim().toLowerCase()) throw conflictError("提交人不得核验本人提交的上线证据");
      if (context.role && context.role !== "commission") throw conflictError("上线证据独立核验仅允许卫生行政角色执行");
      const verificationRef = String(payload.verificationRef || payload.evidenceRef || "").trim();
      if (verificationRef.length < 3) throw inputError("独立核验必须提供复核记录编号或附件引用");
      const evidenceDigest = normalizeEvidenceDigest(payload.evidenceDigest);
      if (!evidenceDigest || evidenceDigest !== submission.evidenceDigest) throw conflictError("独立核验摘要与提交证据 SHA-256 不一致");
      const verified = action === "verify-signoff";
      rows[index] = {
        ...rows[index],
        siteSignoff: verified,
        siteSignoffVerified: verified,
        status: verified ? "site-verified" : "site-signoff-rejected",
        signoffStatus: verified ? "independently-verified" : "rejected",
        signedAt: verified ? at : "",
        signedBy: verified ? reviewedBy : "",
        signoffEvidenceRef: verified ? submission.evidenceRef : "",
        signoffVerification: { reviewedAt: at, reviewedBy, verificationRef, evidenceDigest, outcome: verified ? "verified" : "rejected", note },
        evidenceRefs: [...new Set([verificationRef, ...(rows[index].evidenceRefs || [])])].slice(0, 30)
      };
    } else {
      throw inputError("联调动作仅支持 update-check、submit-signoff、verify-signoff 或 reject-signoff");
    }
    rows[index] = { ...rows[index], actionHistory: [{ action, note, at, actor: context.actor || "operator" }, ...(rows[index].actionHistory || [])].slice(0, 30) };
    state.physicalExamJointTests = rows;
    return rows[index];
  }

  function linkSecureAttachment(record, attachment, context = {}) {
    if (!isPhysicalExamRecord(record)) throw inputError("仅体检报告可关联原报告附件");
    if (!attachment || attachment.status !== "active" || attachment.scanStatus !== "clean") throw conflictError("原报告附件必须完成校验并通过恶意文件扫描");
    if (record.residentId !== attachment.residentId) throw inputError("原报告附件与体检报告居民不一致");
    record.meta = { ...(record.meta || {}), secureAttachmentId: attachment.id, documentUrl: "", attachmentLinkedAt: context.now || new Date().toISOString(), attachmentLinkedBy: context.actor || "operator" };
    return record;
  }

  function mergeSeedRecords(personalRecords) {
    const merged = new Map(seedRecords().map((item) => [item.id, item]));
    (Array.isArray(personalRecords) ? personalRecords : []).forEach((item) => {
      if (!item?.id) return;
      const seeded = merged.get(item.id) || {};
      merged.set(item.id, { ...seeded, ...item, meta: { ...(seeded.meta || {}), ...(item.meta || {}) } });
    });
    return [...merged.values()];
  }

  function isPhysicalExamRecord(item) {
    return item?.category === "physical-exam" || item?.meta?.physicalExam === true;
  }

  function isDemoPhysicalExamRecord(item) {
    if (!isPhysicalExamRecord(item)) return false;
    const meta = item?.meta || {};
    return meta.signature?.mode === "demo"
      || String(meta.signature?.certificateSerial || "").toUpperCase().startsWith("DEMO-")
      || String(item.id || "").startsWith("physical-exam-r");
  }

  function normalizeEvidenceDigest(value) {
    const digest = String(value || "").trim().toLowerCase();
    return /^[a-f0-9]{64}$/.test(digest) ? digest : "";
  }

  function idempotencyKey(item) {
    const meta = item?.meta || item || {};
    return [normalizeSourceType(meta.sourceType), meta.institutionId, meta.externalId].map((value) => String(value || "").trim().toLowerCase()).join("|");
  }

  function normalizeSourceType(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (["exam-center", "physical-exam-center", "checkup-center", "体检中心"].includes(normalized)) return "exam-center";
    if (["hospital", "his", "emr", "医院"].includes(normalized)) return "hospital";
    return normalized;
  }

  function normalizeExamProgramType(value) {
    const raw = String(value || "adult-general").trim().toLowerCase();
    const aliases = { general: "adult-general", adult: "adult-general", occupational: "occupational-health", public: "public-health-special", student: "student-health", military: "conscription", driver: "driver-license", food: "food-service" };
    const normalized = aliases[raw] || raw;
    if (!EXAM_PROGRAMS.some((item) => item.id === normalized)) throw inputError(`examProgramType 不支持：${raw}`);
    return normalized;
  }

  function specializedIdempotencyKey(item) {
    return [item.sourceType, item.institutionId, item.externalId, item.examProgramType].map((value) => String(value || "").trim().toLowerCase()).join("|");
  }

  function normalizeFindings(findings) {
    return (Array.isArray(findings) ? findings : []).slice(0, 200).map((item, index) => {
      const dictionary = dictionaryItem(item?.code);
      return ({
      code: String(item?.code || `ITEM-${index + 1}`).trim(),
      name: String(item?.name || "未命名项目").trim(),
      value: String(item?.value ?? "").trim(),
      unit: String(item?.unit || "").trim(),
      reference: String(item?.reference || "").trim(),
      abnormal: item?.abnormal === true || item?.importantAbnormal === true || item?.criticalValue === true || /异常|偏高|偏低|阳性|critical|high|low/i.test(String(item?.status || "")),
      importantAbnormal: item?.importantAbnormal === true,
      criticalValue: item?.criticalValue === true,
      riskClass: String(item?.riskClass || "").trim().toUpperCase(),
      criticalReason: String(item?.criticalReason || "").trim(),
      standard: dictionary?.standard || "",
      nationalCodes: dictionary?.nationalCodes || [],
      secondaryCode: dictionary?.secondaryCode || "",
      mappingStatus: dictionary ? "mapped" : "unmapped",
      nationalMappingStatus: dictionary?.nationalCodes?.length ? "mapped" : "review"
    });
    });
  }

  function dictionaryItem(code) {
    const normalized = String(code || "").trim().toUpperCase();
    return ITEM_DICTIONARY.find((item) => item.code === normalized);
  }

  function normalizeUltrasoundWorkload(value = {}) {
    const raw = value && typeof value === "object" ? value : {};
    return {
      examSites: Math.max(0, Number(raw.examSites || 0)),
      physicianPosts: Math.max(0, Number(raw.physicianPosts || 0)),
      workingDays: Math.max(0, Number(raw.workingDays || 0))
    };
  }

  function normalizeReportSignature(signature = {}) {
    const normalized = Standards.normalizeSignature(signature);
    return { ...normalized, algorithm: [normalized.asymmetricAlgorithm, normalized.digestAlgorithm].filter(Boolean).join("/") };
  }

  function demoSignature(signatureNo) {
    return { standardCode: Standards.DIGITAL_SIGNATURE_STANDARD, status: "verified", mode: "demo", asymmetricAlgorithm: "SM2 demo", digestAlgorithm: "SM3 demo", format: "ES-T XML demo", signatureNo, signer: "体检机构总检医师", signedAt: "2026-05-18T08:30:00.000Z", certificateSerial: "DEMO-CERT", certificateChainVerified: true, revocationStatusVerified: true, timestamp: "2026-05-18T08:30:01.000Z", timestampVerified: true, digestValue: "demo-digest", signatureValueRef: `demo://${signatureNo}`, verifiedAt: "2026-05-18T08:31:00.000Z" };
  }

  function normalizeStringList(values) {
    if (Array.isArray(values)) return values.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 50);
    return String(values || "").split(/[\n；;]/).map((item) => item.trim()).filter(Boolean).slice(0, 50);
  }

  function normalizeDate(value) {
    return String(value || "").trim().slice(0, 10);
  }

  function addDays(value, days) {
    const date = new Date(`${normalizeDate(value)}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return "";
    date.setUTCDate(date.getUTCDate() + Number(days || 0));
    return date.toISOString().slice(0, 10);
  }

  function safeDocumentUrl(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    return /^(https:\/\/|\/api\/)/i.test(text) ? text : "";
  }

  function personIndexOf(resident) {
    return String(resident?.personIndex || resident?.identityIndex || `${resident?.idCard || ""}#${resident?.phone || ""}`).trim();
  }

  function stableHash(value) {
    let hash = 2166136261;
    for (const char of String(value || "")) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function inputError(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
  }

  function notFoundError(message) {
    const error = new Error(message);
    error.statusCode = 404;
    return error;
  }

  function conflictError(message) {
    const error = new Error(message);
    error.statusCode = 409;
    return error;
  }

  return {
    ITEM_DICTIONARY,
    EXAM_PROGRAMS,
    SOURCE_CONTRACTS,
    STANDARDS: Standards,
    applyAbnormalCaseAction,
    applyHighlightAction: Highlights.applyAction,
    applySpecializedIntakeAction,
    applyJointTestAction,
    buildOverview,
    buildQualityIndicators,
    ingest,
    isDemoPhysicalExamRecord,
    isPhysicalExamRecord,
    linkSecureAttachment,
    mergeSeedRecords,
    seedAbnormalCases,
    seedJointTests,
    seedRecords,
    synchronizeCareLinks,
    validateImport
  };
});
