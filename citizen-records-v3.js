(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports ? require("./citizen-records-v1") : root?.CitizenRecordsV1,
    typeof module === "object" && module.exports ? require("./citizen-records-v2") : root?.CitizenRecordsV2
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CitizenRecordsV3 = api;
})(typeof window !== "undefined" ? window : globalThis, function (CitizenRecordsV1, CitizenRecordsV2) {
  "use strict";

  const ACTIVE_INTEGRATION_STATES = new Set(["connected", "verified", "ready", "已连接", "已核验", "已就绪"]);
  const REQUIRED_INTEGRATIONS = Object.freeze([
    { key: "identity", label: "居民实名与主索引" },
    { key: "relationship", label: "家庭与监护关系" },
    { key: "clinical", label: "医院病历、检验和影像" },
    { key: "storage", label: "对象存储与安全扫描" },
    { key: "audit", label: "统一审计与安全监测" },
    { key: "legal", label: "授权文本与上线签字" }
  ]);
  const TRUSTED_SOURCES = new Set(["clinical", "clinical-service", "医疗机构可信来源", "医疗服务可信来源", "health-archive"]);
  const CLINICAL_SOURCE_SYSTEMS = Object.freeze({
    EMR: Object.freeze({ category: "emr", label: "电子病历系统" }),
    LIS: Object.freeze({ category: "labs", label: "检验信息系统" }),
    PACS: Object.freeze({ category: "imaging", label: "医学影像系统" })
  });
  const SENSITIVE_SOURCE_FIELD = /(?:token|secret|password|credential|object(?:key|path)|storage(?:key|path)|signedurl|downloadurl|sourceurl|audit(?:hash|payload)|personindex|masterpatientindex|studyinstanceuid)/i;
  const TERMINAL_TASK_STATES = new Set(["completed", "closed", "cancelled", "已完成", "已关闭", "已取消", "已取药"]);
  const GLOSSARY = Object.freeze([
    { pattern: /窦性心律/, explanation: "心脏节律由正常起搏点发出" },
    { pattern: /纹理增多/, explanation: "影像上肺部纹理较明显，需要结合症状和医生判断" },
    { pattern: /血压|收缩压|舒张压/, explanation: "反映血液流动时对血管壁形成的压力" },
    { pattern: /血糖|葡萄糖/, explanation: "反映血液中的葡萄糖水平" },
    { pattern: /阴性/, explanation: "本次检查未发现该项目所指的异常证据" },
    { pattern: /阳性/, explanation: "本次检查发现相关证据，需要由医生结合临床情况判断" }
  ]);
  const SAFE_ACTION_INTENTS = Object.freeze({
    "review-integration-boundary": Object.freeze({ targetSelector: ".resident-records-boundary", announcement: "已定位生产接入边界和现场依赖。", writes: false }),
    "review-provenance": Object.freeze({ targetSelector: "#citizen-provenance-cards", announcement: "已定位跨院档案来源明细。", writes: false }),
    "correct-conflict": Object.freeze({ targetSelector: "#citizen-correction-form", announcement: "已定位纠错申请。提交后只生成复核申请，不覆盖原始记录。", writes: false }),
    "manage-family-authorization": Object.freeze({
      dialogId: "auth-dialog",
      announcement: "已准备家庭代办授权，请核对对象、范围和有效期。",
      writes: false,
      authorizationDraft: Object.freeze({ granteeType: "guardian", purpose: "家庭成员协助健康管理", scopes: Object.freeze(["health-record-summary"]) })
    }),
    "manage-care-plan": Object.freeze({ page: "registration", announcement: "正在前往挂号服务处理复诊或随访安排。", writes: false }),
    "schedule-report-revisit": Object.freeze({ page: "registration", announcement: "正在前往挂号服务预约报告复诊。", writes: false }),
    "review-medications": Object.freeze({ targetSelector: "#citizen-medication-review", announcement: "已定位用药核对，请由医生或药师复核风险提示。", writes: false }),
    "prepare-emergency-authorization": Object.freeze({
      dialogId: "auth-dialog",
      announcement: "已准备紧急救治授权，仅预选最小健康摘要，请核对后再决定是否保存。",
      writes: false,
      authorizationDraft: Object.freeze({ granteeType: "institution", purpose: "紧急救治最小健康摘要", scopes: Object.freeze(["health-record-summary"]) })
    }),
    "review-operations": Object.freeze({ targetSelector: "#citizen-access-review-v2-summary", announcement: "已定位授权与访问复核记录。", writes: false })
  });

  function cleanText(value, maximum = 500) {
    return String(value ?? "").trim().slice(0, maximum);
  }

  function toDate(value) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function dateOnly(value) {
    return toDate(value)?.toISOString().slice(0, 10) || "";
  }

  function taskDateOnly(value) {
    const raw = cleanText(value, 80);
    const explicitDate = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (explicitDate) return explicitDate[1];
    const date = toDate(value);
    if (!date) return "";
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date).filter((item) => item.type !== "literal").map((item) => [item.type, item.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function calendarDayDistance(from, to) {
    const fromDate = taskDateOnly(from);
    const toDateValue = taskDateOnly(to);
    if (!fromDate || !toDateValue) return Number.POSITIVE_INFINITY;
    const dayNumber = (value) => {
      const [year, month, day] = value.split("-").map(Number);
      return Date.UTC(year, month - 1, day) / 86400000;
    };
    return dayNumber(toDateValue) - dayNumber(fromDate);
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function recordTrust(record = {}) {
    return cleanText(record.provenance?.trust || record.meta?.sourceTrust || record.sourceTrust || "来源待核验", 80);
  }

  function firstValue(source = {}, paths = []) {
    for (const path of paths) {
      const value = path.split(".").reduce((current, key) => current?.[key], source);
      if (value !== undefined && value !== null && cleanText(value, 2000)) return value;
    }
    return "";
  }

  function clinicalSourceSystem(sample = {}) {
    const source = cleanText(firstValue(sample, ["sourceSystem", "system", "meta.sourceSystem", "provenance.sourceSystem"]), 120).toUpperCase();
    if (/(^|[^A-Z])EMR([^A-Z]|$)/.test(source) || /电子病历/.test(source)) return "EMR";
    if (/(^|[^A-Z])LIS([^A-Z]|$)/.test(source) || /检验信息/.test(source)) return "LIS";
    if (/(^|[^A-Z])PACS([^A-Z]|$)/.test(source) || /医学影像/.test(source)) return "PACS";
    return "";
  }

  function collectSensitiveSourceFields(value, prefix = "", depth = 0, output = []) {
    if (!value || typeof value !== "object" || depth > 5) return output;
    for (const [key, item] of Object.entries(value).slice(0, 200)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (SENSITIVE_SOURCE_FIELD.test(key)) output.push(path);
      if (item && typeof item === "object") collectSensitiveSourceFields(item, path, depth + 1, output);
    }
    return unique(output).slice(0, 50);
  }

  function clinicalResultItems(sample = {}) {
    const value = firstValue(sample, ["results", "items", "observations", "meta.results", "meta.metrics"]);
    return Array.isArray(value) ? value.filter((item) => item && typeof item === "object").slice(0, 100) : [];
  }

  function validateClinicalSourceSample(sample = {}, expectedResidentId = "") {
    const system = clinicalSourceSystem(sample);
    const residentId = cleanText(firstValue(sample, ["residentId", "subject.residentId", "patient.residentId"]), 120);
    const sourceOrganization = cleanText(firstValue(sample, ["sourceOrganization", "institutionName", "sourceInstitution", "meta.sourceOrganization", "provenance.sourceOrganization"]), 200);
    const sourceRecordId = cleanText(firstValue(sample, ["sourceRecordId", "externalId", "reportNo", "accessionNumber", "meta.sourceRecordId", "provenance.sourceRecordId", "id"]), 160);
    const version = cleanText(firstValue(sample, ["version", "meta.version", "provenance.version"]), 40);
    const occurredAt = cleanText(firstValue(sample, ["occurredAt", "visitAt", "reportedAt", "studyDate", "date", "updatedAt"]), 60);
    const errors = [];
    if (!system) errors.push("来源系统必须明确为 EMR、LIS 或 PACS");
    if (!residentId) errors.push("缺少居民标识");
    if (expectedResidentId && residentId !== cleanText(expectedResidentId, 120)) errors.push("样例报文居民与当前居民不一致");
    if (!sourceOrganization) errors.push("缺少来源机构");
    if (!sourceRecordId) errors.push("缺少来源记录号");
    if (!version) errors.push("缺少记录版本");
    if (!toDate(occurredAt)) errors.push("缺少有效发生或报告时间");

    if (system === "EMR") {
      const diagnoses = firstValue(sample, ["diagnoses", "diagnosis", "meta.diagnoses", "meta.diagnosis"]);
      const summary = firstValue(sample, ["summary", "treatment", "result", "meta.treatment"]);
      const visitType = firstValue(sample, ["visitType", "encounterType", "meta.visitType"]);
      if (!cleanText(diagnoses, 2000)) errors.push("电子病历样例缺少诊断摘要");
      if (!cleanText(summary, 2000)) errors.push("电子病历样例缺少诊疗摘要");
      if (!cleanText(visitType, 200)) errors.push("电子病历样例缺少就诊类型");
    }
    if (system === "LIS") {
      if (!clinicalResultItems(sample).length) errors.push("检验样例缺少结构化结果项目");
      if (!cleanText(firstValue(sample, ["reportNo", "externalId", "meta.reportNo"]), 160)) errors.push("检验样例缺少报告号");
    }
    if (system === "PACS") {
      if (!cleanText(firstValue(sample, ["modality", "meta.modality"]), 80)) errors.push("影像样例缺少检查设备类型");
      if (!cleanText(firstValue(sample, ["conclusion", "reportConclusion", "result", "summary", "meta.findings"]), 2000)) errors.push("影像样例缺少报告结论");
      if (!cleanText(firstValue(sample, ["reportNo", "accessionNumber", "externalId", "meta.reportNo"]), 160)) errors.push("影像样例缺少报告号");
    }

    const ignoredSensitiveFields = collectSensitiveSourceFields(sample);
    return {
      valid: errors.length === 0,
      system,
      systemLabel: CLINICAL_SOURCE_SYSTEMS[system]?.label || "未知临床来源",
      residentId,
      sourceOrganization,
      sourceRecordId,
      version,
      occurredAt: toDate(occurredAt)?.toISOString() || "",
      errors,
      ignoredSensitiveFields,
      boundary: "校验只确认最小字段契约；居民投影会丢弃令牌、永久地址、对象键、审计载荷、主索引和影像内部标识。"
    };
  }

  function resultItemSummary(item = {}) {
    const name = cleanText(item.name || item.item || item.codeName || "检验项目", 120);
    const value = cleanText(item.value ?? item.result, 120);
    const unit = cleanText(item.unit, 40);
    const status = cleanText(item.status || item.abnormalFlag, 40);
    return [name, value, unit, status].filter(Boolean).join(" ");
  }

  function projectClinicalSourceSample(sample = {}, expectedResidentId = "") {
    const validation = validateClinicalSourceSample(sample, expectedResidentId);
    if (!validation.valid) throw new Error(`临床来源样例校验失败：${validation.errors.join("；")}`);
    const common = {
      id: `clinical-${validation.system.toLowerCase()}-${validation.sourceRecordId}`,
      residentId: validation.residentId,
      category: CLINICAL_SOURCE_SYSTEMS[validation.system].category,
      date: validation.occurredAt.slice(0, 10),
      source: validation.sourceOrganization,
      updatedAt: cleanText(firstValue(sample, ["updatedAt", "reportedAt", "occurredAt", "visitAt", "studyDate", "date"]), 60),
      status: cleanText(firstValue(sample, ["status", "reportStatus", "meta.status"]), 80),
      meta: {
        sourceSystem: validation.system,
        sourceOrganization: validation.sourceOrganization,
        sourceRecordId: validation.sourceRecordId,
        version: validation.version,
        sourceTrust: "clinical",
        authority: "clinical",
        dataQualityStatus: "样例契约已通过"
      }
    };
    if (validation.system === "EMR") {
      const diagnoses = firstValue(sample, ["diagnoses", "diagnosis", "meta.diagnoses", "meta.diagnosis"]);
      const diagnosisItems = Array.isArray(diagnoses) ? diagnoses.map((item) => cleanText(item, 160)).filter(Boolean).slice(0, 20) : [cleanText(diagnoses, 500)].filter(Boolean);
      return CitizenRecordsV1?.projectRecord({
        ...common,
        name: diagnosisItems.join("、") || "电子病历摘要",
        result: firstValue(sample, ["summary", "treatment", "result", "meta.treatment"]),
        meta: {
          ...common.meta,
          recordKind: "emr-summary",
          visitType: cleanText(firstValue(sample, ["visitType", "encounterType", "meta.visitType"]), 80),
          department: cleanText(firstValue(sample, ["department", "meta.department"]), 120),
          chiefComplaint: cleanText(firstValue(sample, ["chiefComplaint", "meta.chiefComplaint"]), 500),
          diagnoses: diagnosisItems,
          treatment: cleanText(firstValue(sample, ["treatment", "summary", "result", "meta.treatment"]), 1000),
          followupPlan: cleanText(firstValue(sample, ["followupPlan", "recommendations", "meta.followupPlan"]), 600)
        }
      });
    }
    if (validation.system === "LIS") {
      const results = clinicalResultItems(sample);
      return CitizenRecordsV1?.projectRecord({
        ...common,
        name: cleanText(firstValue(sample, ["item", "name", "title"]) || "检验报告", 200),
        result: results.map(resultItemSummary).filter(Boolean).slice(0, 20).join("；"),
        meta: {
          ...common.meta,
          recordKind: "diagnostic-report",
          reportNo: cleanText(firstValue(sample, ["reportNo", "externalId", "meta.reportNo"]), 120),
          metrics: results.slice(0, 20).map((item) => ({
            name: cleanText(item.name || item.item || item.codeName, 120),
            value: cleanText(item.value ?? item.result, 120),
            unit: cleanText(item.unit, 40),
            status: cleanText(item.status || item.abnormalFlag, 40)
          }))
        }
      });
    }
    return CitizenRecordsV1?.projectRecord({
      ...common,
      name: `${cleanText(firstValue(sample, ["bodyPart", "examMethod", "meta.bodyPart"]) || "影像", 100)}报告`,
      result: firstValue(sample, ["conclusion", "reportConclusion", "result", "summary", "meta.findings"]),
      meta: {
        ...common.meta,
        recordKind: "diagnostic-report",
        reportNo: cleanText(firstValue(sample, ["reportNo", "accessionNumber", "externalId", "meta.reportNo"]), 120),
        modality: cleanText(firstValue(sample, ["modality", "meta.modality"]), 40),
        bodyPart: cleanText(firstValue(sample, ["bodyPart", "examMethod", "meta.bodyPart"]), 100),
        reportStatus: cleanText(firstValue(sample, ["reportStatus", "status", "meta.reportStatus"]), 80),
        originalAvailable: false,
        authorizationRequired: true,
        accessMode: "受控调阅"
      }
    });
  }

  function buildClinicalSourceAcceptanceReport(samples = [], expectedResidentId = "") {
    const entries = (Array.isArray(samples) ? samples : []).slice(0, 500).map((sample, index) => {
      const validation = validateClinicalSourceSample(sample, expectedResidentId);
      let projected = null;
      if (validation.valid) projected = projectClinicalSourceSample(sample, expectedResidentId);
      return {
        sampleNumber: index + 1,
        system: validation.system || "UNKNOWN",
        systemLabel: validation.systemLabel,
        status: validation.valid ? "通过" : "拒绝",
        errors: [...validation.errors],
        ignoredSensitiveFieldCount: validation.ignoredSensitiveFields.length,
        projected
      };
    });
    const acceptedRecords = CitizenRecordsV2?.mergeInstitutionRecords(
      entries.map((item) => item.projected).filter(Boolean)
    ) || entries.map((item) => item.projected).filter(Boolean);
    const systems = Object.keys(CLINICAL_SOURCE_SYSTEMS).map((system) => {
      const scoped = entries.filter((item) => item.system === system);
      return {
        system,
        label: CLINICAL_SOURCE_SYSTEMS[system].label,
        total: scoped.length,
        accepted: scoped.filter((item) => item.status === "通过").length,
        rejected: scoped.filter((item) => item.status === "拒绝").length
      };
    });
    const rejectedCount = entries.filter((item) => item.status === "拒绝").length;
    return {
      total: entries.length,
      acceptedCount: entries.length - rejectedCount,
      rejectedCount,
      acceptedRecordCount: acceptedRecords.length,
      ignoredSensitiveFieldCount: entries.reduce((sum, item) => sum + item.ignoredSensitiveFieldCount, 0),
      contractReady: entries.length > 0 && rejectedCount === 0,
      systems,
      entries: entries.map(({ projected, ...item }) => item),
      acceptedRecords,
      productionReady: false,
      boundary: "批量报告只证明脱敏样例满足字段契约并可生成居民安全摘要；不包含被拒绝报文原文，也不代表正式连接、数据真实性或生产上线签字。"
    };
  }

  function qualityIssuePriority(issues = []) {
    if (issues.includes("居民范围不一致")) return "阻断";
    if (issues.some((issue) => ["来源机构待补", "来源系统待补", "来源记录号待补", "更新时间待补"].includes(issue))) return "优先复核";
    if (issues.length) return "常规复核";
    return "完整";
  }

  function qualityIssueAction(issues = []) {
    if (issues.includes("居民范围不一致")) return "隔离记录并核对居民归属";
    if (issues.some((issue) => ["来源机构待补", "来源系统待补", "来源记录号待补"].includes(issue))) return "联系来源机构补齐溯源字段";
    if (issues.includes("更新时间待补")) return "联系来源机构补齐更新时间";
    if (issues.includes("超过十八个月待复核")) return "申请来源机构复核更新时间";
    if (issues.includes("个人补充待机构核验")) return "提交机构核验并保留个人补充标识";
    if (issues.includes("来源可信度待核验")) return "核验来源可信度";
    return "无需处理";
  }

  function assessResidentRecordQuality(records = [], now = new Date(), expectedResidentId = "") {
    const referenceTime = toDate(now) || new Date();
    const categoryLabels = {
      emr: "电子病历",
      labs: "检验检查",
      imaging: "影像报告",
      medications: "用药记录",
      attachments: "附件资料",
      "physical-exam": "体检报告",
      allergies: "过敏信息",
      vaccines: "预防接种",
      admissions: "住院记录"
    };
    const items = (Array.isArray(records) ? records : [])
      .filter((record) => record && record.category !== "authorizations")
      .map((record) => {
        const sourceOrganization = cleanText(record.provenance?.sourceOrganization || record.meta?.sourceOrganization || record.source, 200);
        const sourceSystem = cleanText(record.provenance?.sourceSystem || record.meta?.sourceSystem, 120);
        const sourceRecordId = cleanText(record.provenance?.sourceRecordId || record.meta?.sourceRecordId, 160);
        const updatedAt = record.provenance?.lastSynchronizedAt || record.updatedAt || record.createdAt || record.date;
        const ageDays = calendarDayDistance(updatedAt, referenceTime);
        const trust = recordTrust(record);
        const selfReported = trust === "self-reported";
        const issues = [];
        if (expectedResidentId && cleanText(record.residentId, 120) !== cleanText(expectedResidentId, 120)) issues.push("居民范围不一致");
        if (!sourceOrganization || /待核验|未知|未提供/.test(sourceOrganization)) issues.push("来源机构待补");
        if (!selfReported && (!sourceSystem || /待核验|未知|未提供/.test(sourceSystem))) issues.push("来源系统待补");
        if (!selfReported && !sourceRecordId) issues.push("来源记录号待补");
        if (!toDate(updatedAt)) issues.push("更新时间待补");
        else if (ageDays > 548) issues.push("超过十八个月待复核");
        if (!TRUSTED_SOURCES.has(trust)) issues.push(selfReported ? "个人补充待机构核验" : "来源可信度待核验");
        const rawName = cleanText(record.name || record.title, 160);
        const displayName = !rawName || /^(已核验|已确认|待核验|已通过|verified|approved|confirmed)$/i.test(rawName)
          ? categoryLabels[record.category] || "健康资料"
          : rawName;
        return {
          id: cleanText(record.id, 160),
          name: displayName,
          category: cleanText(record.category, 60),
          sourceOrganization: sourceOrganization || "来源机构待补",
          updatedAt: taskDateOnly(updatedAt),
          ageDays: Number.isFinite(ageDays) ? ageDays : null,
          complete: issues.length === 0,
          issues,
          status: issues.length ? issues[0] : "来源与时效完整",
          priority: qualityIssuePriority(issues),
          action: qualityIssueAction(issues)
        };
      })
      .sort((a, b) => {
        const order = { 阻断: 0, 优先复核: 1, 常规复核: 2, 完整: 3 };
        return (order[a.priority] ?? 9) - (order[b.priority] ?? 9) || a.name.localeCompare(b.name, "zh-CN");
      });
    return {
      items,
      completeCount: items.filter((item) => item.complete).length,
      reviewCount: items.filter((item) => !item.complete).length,
      staleCount: items.filter((item) => item.issues.includes("超过十八个月待复核")).length,
      crossResidentCount: items.filter((item) => item.issues.includes("居民范围不一致")).length,
      blockedCount: items.filter((item) => item.priority === "阻断").length,
      highPriorityCount: items.filter((item) => item.priority === "优先复核").length,
      boundary: "质量状态用于提示来源、字段和更新时间是否齐全，不改变医疗机构原始内容，也不把个人补充资料提升为临床权威记录。"
    };
  }

  function nonPlaceholderEvidence(item = {}) {
    const evidence = cleanText(item.evidenceRef || item.evidence || item.receiptId || item.auditRef, 300);
    return Boolean(evidence) && !/demo|example|placeholder|待补|演示|示例/i.test(evidence);
  }

  function buildProductionIntegrationStatus(integrations = {}, now = new Date()) {
    const referenceTime = toDate(now) || new Date();
    const items = REQUIRED_INTEGRATIONS.map((definition) => {
      const input = integrations[definition.key] || {};
      const lastSuccessAt = toDate(input.lastSuccessAt || input.verifiedAt);
      const requestedMaximumAgeDays = Number(input.maximumAgeDays);
      const maximumAgeDays = Number.isFinite(requestedMaximumAgeDays) && requestedMaximumAgeDays > 0
        ? Math.min(requestedMaximumAgeDays, 30)
        : 7;
      const requestedClockSkewMinutes = Number(input.clockSkewMinutes);
      const clockSkewMinutes = Number.isFinite(requestedClockSkewMinutes) && requestedClockSkewMinutes >= 0
        ? Math.min(requestedClockSkewMinutes, 15)
        : 5;
      const ageMilliseconds = lastSuccessAt ? referenceTime.getTime() - lastSuccessAt.getTime() : Number.POSITIVE_INFINITY;
      const futureTimestamp = ageMilliseconds < -clockSkewMinutes * 60000;
      const fresh = Boolean(lastSuccessAt)
        && !futureTimestamp
        && ageMilliseconds <= maximumAgeDays * 86400000;
      const evidenceReady = nonPlaceholderEvidence(input);
      const connected = ACTIVE_INTEGRATION_STATES.has(cleanText(input.status, 40).toLowerCase());
      const ready = connected && fresh && evidenceReady;
      const status = ready
        ? "已核验"
        : !connected
          ? "待现场接入"
          : !evidenceReady
            ? "缺少正式证据"
            : !lastSuccessAt
              ? "缺少有效成功时间"
              : futureTimestamp
                ? "成功时间异常"
                : "连接证据已过期";
      return {
        ...definition,
        status,
        ready,
        lastSuccessAt: lastSuccessAt?.toISOString() || "",
        evidenceRef: evidenceReady ? cleanText(input.evidenceRef || input.evidence || input.receiptId || input.auditRef, 160) : ""
      };
    });
    return {
      items,
      readyCount: items.filter((item) => item.ready).length,
      productionReady: items.every((item) => item.ready),
      summary: items.every((item) => item.ready)
        ? "六类生产接入均已具备有效证据"
        : `${items.filter((item) => !item.ready).length} 类生产接入仍需现场核验`,
      boundary: "页面状态只反映带正式证据且成功时间有效的连接结果；演示数据、占位回执、过期或异常未来时间不能开启生产门禁。"
    };
  }

  function recordFingerprint(record = {}) {
    return [
      cleanText(record.category, 60).toLowerCase(),
      cleanText(record.name || record.title, 160).toLowerCase(),
      dateOnly(record.date || record.reportedAt || record.createdAt),
      cleanText(record.meta?.reportNo || record.reportNo, 100).toLowerCase()
    ].join("|");
  }

  function recordValueFingerprint(record = {}) {
    return cleanText(record.result || record.summary || record.value || record.meta?.findings, 500)
      .replace(/\s+/g, "")
      .toLowerCase();
  }

  function governCrossInstitutionRecords(records = []) {
    const sourceIds = new Map();
    const fingerprints = new Map();
    const provenance = [];
    for (const record of Array.isArray(records) ? records : []) {
      const sourceRecordId = cleanText(record.provenance?.sourceRecordId || record.meta?.sourceRecordId || record.id, 200);
      const sourceOrganization = cleanText(record.provenance?.sourceOrganization || record.meta?.sourceOrganization || record.source, 160) || "来源待核验";
      const sourceSystem = cleanText(record.provenance?.sourceSystem || record.meta?.sourceSystem, 100) || "系统待核验";
      const normalized = {
        id: cleanText(record.id, 200),
        name: cleanText(record.name || record.title || "健康资料", 160),
        category: cleanText(record.category, 60),
        date: dateOnly(record.date || record.reportedAt || record.createdAt),
        sourceRecordId,
        sourceOrganization,
        sourceSystem,
        trust: recordTrust(record),
        valueFingerprint: recordValueFingerprint(record),
        fingerprint: recordFingerprint(record)
      };
      provenance.push(normalized);
      if (sourceRecordId) {
        if (!sourceIds.has(sourceRecordId)) sourceIds.set(sourceRecordId, []);
        sourceIds.get(sourceRecordId).push(normalized);
      }
      if (!fingerprints.has(normalized.fingerprint)) fingerprints.set(normalized.fingerprint, []);
      fingerprints.get(normalized.fingerprint).push(normalized);
    }
    const duplicates = [...sourceIds.values()]
      .filter((items) => items.length > 1)
      .map((items) => ({
        sourceRecordId: items[0].sourceRecordId,
        recordIds: unique(items.map((item) => item.id)),
        label: items[0].name,
        action: "保留可信版本并关联重复来源"
      }));
    const conflicts = [...fingerprints.values()]
      .filter((items) => unique(items.map((item) => item.valueFingerprint)).length > 1)
      .map((items) => ({
        fingerprint: items[0].fingerprint,
        label: items[0].name,
        recordIds: unique(items.map((item) => item.id)),
        organizations: unique(items.map((item) => item.sourceOrganization)),
        action: "提交机构复核或居民纠错申请，原始版本均保留"
      }));
    return {
      provenance,
      sourceCount: new Set(provenance.map((item) => item.sourceOrganization).filter((item) => item !== "来源待核验")).size,
      duplicates,
      conflicts,
      trustedCount: provenance.filter((item) => TRUSTED_SOURCES.has(item.trust)).length,
      boundary: "重复和冲突仅生成治理提示，不自动覆盖医疗机构原始记录。"
    };
  }

  function authorizationActorMatch(record = {}, member = {}) {
    const meta = record.meta || {};
    const targets = [meta.granteeId, meta.granteeAccountId, meta.granteeResidentId].map((value) => cleanText(value, 160));
    return [member.id, member.accountId, member.residentId, member.username]
      .map((value) => cleanText(value, 160))
      .filter(Boolean)
      .some((value) => targets.includes(value));
  }

  function buildFamilyDelegationCenter(input = {}) {
    const now = toDate(input.now) || new Date();
    const authorizations = Array.isArray(input.authorizations) ? input.authorizations : [];
    const items = (Array.isArray(input.members) ? input.members : []).map((member) => {
      const self = /本人|self/i.test(cleanText(member.relation, 60));
      const relationship = self
        ? { active: true, label: "本人", reason: "self" }
        : CitizenRecordsV2?.relationshipAccessState(member, now) || { active: false, label: "关系待核验" };
      const matched = authorizations.filter((record) => authorizationActorMatch(record, member));
      const activeAuthorization = matched.find((record) => {
        const state = CitizenRecordsV1?.authorizationState(record, now);
        return state?.active && Array.isArray(record.meta?.scopes) && record.meta.scopes.length > 0;
      });
      return {
        residentId: cleanText(member.residentId, 120),
        name: cleanText(member.name || member.displayName || member.relation || "家庭成员", 100),
        relation: cleanText(member.relation || "关系待核验", 60),
        relationshipVerified: relationship.active,
        relationshipLabel: relationship.label,
        authorizationActive: self || Boolean(activeAuthorization),
        scopes: self ? ["本人居民可读摘要"] : unique(activeAuthorization?.meta?.scopes || []),
        expiresAt: self ? "" : cleanText(activeAuthorization?.meta?.expiresAt, 60),
        canAct: self || relationship.active && Boolean(activeAuthorization),
        action: self ? "本人访问" : relationship.active && activeAuthorization ? "按授权范围代办" : "补齐关系证据并重新授权"
      };
    });
    return {
      items,
      authorizedCount: items.filter((item) => item.canAct).length,
      blockedCount: items.filter((item) => !item.canAct).length,
      boundary: "家庭或监护关系只提供授权前提；代办还必须匹配受权主体、用途、范围、状态和有效期。"
    };
  }

  function taskDueState(dueAt, now) {
    const dueDate = taskDateOnly(dueAt);
    const daysRemaining = calendarDayDistance(now, dueAt);
    if (!dueDate || !Number.isFinite(daysRemaining)) {
      return { dueAt: "", daysRemaining: null, priority: "普通", dueLabel: "日期待核验" };
    }
    if (daysRemaining < 0) {
      return { dueAt: dueDate, daysRemaining, priority: "逾期", dueLabel: `已逾期 ${Math.abs(daysRemaining)} 天` };
    }
    if (daysRemaining === 0) return { dueAt: dueDate, daysRemaining, priority: "今日", dueLabel: "今日到期" };
    if (daysRemaining <= 3) return { dueAt: dueDate, daysRemaining, priority: "紧急", dueLabel: `${daysRemaining} 天后到期` };
    if (daysRemaining <= 14) return { dueAt: dueDate, daysRemaining, priority: "近期", dueLabel: `${daysRemaining} 天后到期` };
    return { dueAt: dueDate, daysRemaining, priority: "计划", dueLabel: `${daysRemaining} 天后到期` };
  }

  function buildProactiveCarePlan(input = {}) {
    const now = toDate(input.now) || new Date();
    const tasks = [];
    for (const item of Array.isArray(input.followups) ? input.followups : []) {
      if (TERMINAL_TASK_STATES.has(cleanText(item.status, 40))) continue;
      tasks.push({
        id: `followup:${cleanText(item.id, 120)}`,
        type: "随访",
        title: `${cleanText(item.diseaseType || item.title || "慢病")}随访`,
        ...taskDueState(item.plannedAt || item.dueAt, now),
        action: "完成自测并联系家庭医生"
      });
    }
    for (const item of Array.isArray(input.pickups) ? input.pickups : []) {
      if (TERMINAL_TASK_STATES.has(cleanText(item.status, 40))) continue;
      tasks.push({
        id: `pickup:${cleanText(item.id, 120)}`,
        type: "取药",
        title: `${cleanText(item.medication || "长期用药")}取药`,
        ...taskDueState(item.nextPickup || item.dueAt, now),
        action: "核对处方状态并按预约取药"
      });
    }
    for (const record of Array.isArray(input.records) ? input.records : []) {
      const followupPlan = cleanText(record.meta?.followupPlan || record.followupPlan, 200);
      const dueAt = record.meta?.followupAt || record.followupAt;
      if (!followupPlan || !dueAt) continue;
      tasks.push({
        id: `revisit:${cleanText(record.id, 120)}`,
        type: "复诊",
        title: followupPlan,
        ...taskDueState(dueAt, now),
        action: "查看报告并预约复诊"
      });
    }
    for (const authorization of Array.isArray(input.authorizations) ? input.authorizations : []) {
      const state = CitizenRecordsV1?.authorizationState(authorization, now);
      const expiresAt = authorization.meta?.expiresAt;
      const remaining = calendarDayDistance(now, expiresAt);
      if (!state?.active || remaining > 30) continue;
      tasks.push({
        id: `authorization:${cleanText(authorization.id, 120)}`,
        type: "授权",
        title: `${cleanText(authorization.name || "健康资料授权")}即将到期`,
        ...taskDueState(expiresAt, now),
        action: "核对受权人和用途后决定是否续授权"
      });
    }
    const order = { 逾期: 0, 今日: 1, 紧急: 2, 近期: 3, 计划: 4, 普通: 5 };
    tasks.sort((a, b) => (order[a.priority] ?? 9) - (order[b.priority] ?? 9) || a.dueAt.localeCompare(b.dueAt));
    const uniqueTasks = [...new Map(tasks.map((item) => [item.id, item])).values()];
    return {
      tasks: uniqueTasks,
      urgentCount: uniqueTasks.filter((item) => ["逾期", "今日", "紧急"].includes(item.priority)).length,
      overdueCount: uniqueTasks.filter((item) => item.priority === "逾期").length,
      todayCount: uniqueTasks.filter((item) => item.priority === "今日").length,
      nextSevenDaysCount: uniqueTasks.filter((item) => item.daysRemaining >= 1 && item.daysRemaining <= 7).length,
      boundary: "健康任务用于提醒和服务衔接，不自动生成诊断、处方或治疗决定。"
    };
  }

  function explainResidentReports(records = []) {
    const reports = (Array.isArray(records) ? records : [])
      .filter((record) => ["labs", "imaging"].includes(cleanText(record.category, 60)))
      .filter((record) => !/^(已核验|已确认|待核验|verified|approved|confirmed)$/i.test(cleanText(record.name || record.title, 80)))
      .filter((record) => !/^(已核验|已确认|待核验|verified|approved|confirmed)$/i.test(cleanText(record.result || record.summary, 80)))
      .map((record) => {
        const content = cleanText(record.result || record.summary || record.meta?.findings || "报告摘要待机构回传", 800);
        const explanations = unique(GLOSSARY
          .filter((item) => item.pattern.test(content))
          .map((item) => item.explanation));
        const severity = CitizenRecordsV2?.abnormalSeverity(record) || "normal";
        return {
          id: cleanText(record.id, 160),
          name: cleanText(record.name || "检查报告", 160),
          date: dateOnly(record.date || record.reportedAt),
          severity,
          level: severity === "critical" ? "危急提示" : severity === "abnormal" ? "异常提示" : "未识别到明确异常",
          plainSummary: content,
          explanations,
          nextStep: severity === "critical"
            ? "请尽快联系报告机构或按机构通知就医"
            : severity === "abnormal"
              ? "结合症状联系医生，确认是否需要复查或复诊"
              : "继续按医生安排保存并观察后续结果"
        };
      });
    return {
      reports,
      abnormalCount: reports.filter((item) => ["critical", "abnormal"].includes(item.severity)).length,
      boundary: "通俗说明只帮助理解报告文字，不确认诊断，也不替代医生解释。"
    };
  }

  function normalizedMedicationName(item = {}) {
    return cleanText(item.name || item.medication || item.drugName, 160)
      .replace(/片|胶囊|颗粒|注射液|缓释|控释|分散片/g, "")
      .replace(/\s+/g, "")
      .toLowerCase();
  }

  function assessMedicationSafety(input = {}) {
    const medications = (Array.isArray(input.medications) ? input.medications : [])
      .map((item) => ({
        id: cleanText(item.id, 120),
        name: cleanText(item.name || item.medication || item.drugName || "", 160),
        normalizedName: normalizedMedicationName(item),
        source: cleanText(item.source || item.meta?.sourceOrganization || "来源待核验", 160),
        status: cleanText(item.status || "状态待核验", 60)
      }))
      .filter((item) => item.name && !/^(已核验|已确认|待核验|verified|approved|confirmed|matched)$/i.test(item.name));
    const allergyText = (Array.isArray(input.allergies) ? input.allergies : [])
      .map((item) => cleanText(item.name || item.allergen || item.result, 160).toLowerCase())
      .join("|");
    const medicationGroups = new Map();
    for (const item of medications) {
      if (!medicationGroups.has(item.normalizedName)) medicationGroups.set(item.normalizedName, []);
      medicationGroups.get(item.normalizedName).push(item);
    }
    const duplicateGroups = [...medicationGroups.values()]
      .filter((items) => items[0].normalizedName && items.length > 1)
      .map((items) => ({ label: items[0].name, count: items.length, sources: unique(items.map((item) => item.source)) }));
    const allergyWarnings = medications
      .filter((item) => item.normalizedName.length >= 2 && allergyText.includes(item.normalizedName))
      .map((item) => ({ medication: item.name, warning: "与居民记录的过敏信息存在文字匹配，请医生或药师复核" }));
    const names = medications.map((item) => item.normalizedName).join("|");
    const interactionWarnings = [];
    if (/华法林/.test(names) && /阿司匹林/.test(names)) {
      interactionWarnings.push({ pair: "华法林与阿司匹林", warning: "合用可能增加出血风险，请医生或药师复核" });
    }
    if (/硝酸甘油/.test(names) && /西地那非/.test(names)) {
      interactionWarnings.push({ pair: "硝酸甘油与西地那非", warning: "存在严重相互作用风险，请立即由医生或药师复核" });
    }
    return {
      medications,
      duplicateGroups,
      allergyWarnings,
      interactionWarnings,
      warningCount: duplicateGroups.length + allergyWarnings.length + interactionWarnings.length,
      boundary: "用药安全提示只用于专业复核；居民不得据此自行停药、换药或调整剂量。"
    };
  }

  function buildEmergencyHealthPack(input = {}) {
    const resident = input.resident || {};
    const records = Array.isArray(input.records) ? input.records : [];
    const allergies = records.filter((item) => item.category === "allergies").slice(0, 10)
      .map((item) => cleanText(item.name || item.result, 160));
    const medications = records.filter((item) => item.category === "medications").slice(0, 10)
      .map((item) => cleanText(item.name || item.medication, 160));
    const diseases = (Array.isArray(input.diseases) ? input.diseases : []).slice(0, 10)
      .map((item) => cleanText(item.type || item.name, 160));
    const contacts = (Array.isArray(input.contacts) ? input.contacts : []).slice(0, 3)
      .map((item) => ({
        relation: cleanText(item.relation || "紧急联系人", 60),
        name: cleanText(item.name, 80),
        phone: cleanText(item.phone, 30).replace(/(\d{3})\d+(\d{2})$/, "$1****$2")
      }));
    const consent = input.consent || {};
    const consentState = CitizenRecordsV1?.authorizationState(consent, input.now || new Date());
    const ready = Boolean(consentState?.active && resident.id && contacts.length);
    return {
      status: ready ? "可按授权生成" : "待补齐紧急授权或联系人",
      ready,
      subject: {
        name: cleanText(resident.name, 80),
        gender: cleanText(resident.gender, 20),
        age: Number.isFinite(Number(resident.age)) ? Number(resident.age) : null,
        bloodType: cleanText(resident.bloodType || "待核验", 20)
      },
      allergies: unique(allergies),
      medications: unique(medications),
      diseases: unique(diseases),
      contacts,
      expiresAt: cleanText(consent.meta?.expiresAt, 60),
      boundary: "紧急资料包仅含救治所需最小摘要；每次调阅仍需身份核验、短时授权和审计。"
    };
  }

  function buildOperationsSnapshot(input = {}) {
    const now = toDate(input.now) || new Date();
    const integration = buildProductionIntegrationStatus(input.integrations || {}, now);
    const accessLogs = Array.isArray(input.accessLogs) ? input.accessLogs : [];
    const corrections = Array.isArray(input.corrections) ? input.corrections : [];
    const complaints = Array.isArray(input.complaints) ? input.complaints : [];
    const deniedAccess = accessLogs.filter((item) => /denied|blocked|拒绝|拦截/i.test(cleanText(item.status || item.result, 80))).length;
    const openCorrections = corrections.filter((item) => !/corrected|rejected|withdrawn|更正|拒绝|撤回/i.test(cleanText(item.status, 60))).length;
    const openComplaints = complaints.filter((item) => !/closed|resolved|已关闭|已解决/i.test(cleanText(item.status, 60))).length;
    const latestEvents = [...accessLogs, ...corrections, ...complaints]
      .map((item) => toDate(item.updatedAt || item.createdAt || item.accessedAt))
      .filter(Boolean)
      .sort((a, b) => b - a);
    return {
      metrics: [
        { label: "生产接入", value: `${integration.readyCount}/${integration.items.length}`, status: integration.productionReady ? "正常" : "待接入" },
        { label: "授权拦截", value: deniedAccess, status: deniedAccess ? "已记录" : "暂无" },
        { label: "纠错处理中", value: openCorrections, status: openCorrections ? "需跟进" : "暂无" },
        { label: "投诉处理中", value: openComplaints, status: openComplaints ? "需跟进" : "暂无" }
      ],
      latestEventAt: latestEvents[0]?.toISOString() || "",
      productionReady: integration.productionReady,
      boundary: "运营看板只展示居民范围汇总，不展示内部账号、对象键、令牌、审计哈希或其他居民信息。"
    };
  }

  function buildNextStageWorkspace(input = {}) {
    const records = Array.isArray(input.records) ? input.records : [];
    const authorizations = Array.isArray(input.authorizations)
      ? input.authorizations
      : records.filter((record) => record.category === "authorizations");
    const governance = governCrossInstitutionRecords(records);
    governance.quality = assessResidentRecordQuality(records, input.now, input.resident?.id);
    return {
      integration: buildProductionIntegrationStatus(input.integrations || {}, input.now),
      governance,
      family: buildFamilyDelegationCenter({ members: input.members, authorizations, now: input.now }),
      carePlan: buildProactiveCarePlan({
        records,
        followups: input.followups,
        pickups: input.pickups,
        authorizations,
        now: input.now
      }),
      explanations: explainResidentReports(records),
      medicationSafety: assessMedicationSafety({
        medications: records.filter((record) => record.category === "medications"),
        allergies: records.filter((record) => record.category === "allergies")
      }),
      emergencyPack: buildEmergencyHealthPack({
        resident: input.resident,
        records,
        diseases: input.diseases,
        contacts: input.contacts,
        consent: input.emergencyConsent,
        now: input.now
      }),
      operations: buildOperationsSnapshot({
        integrations: input.integrations,
        accessLogs: input.accessLogs,
        corrections: input.corrections,
        complaints: input.complaints,
        now: input.now
      })
    };
  }

  function buildSafeActionIntent(action) {
    const normalizedAction = cleanText(action, 80);
    const definition = SAFE_ACTION_INTENTS[normalizedAction];
    if (!definition) throw new Error("不支持的居民健康档案操作");
    return {
      action: normalizedAction,
      targetSelector: definition.targetSelector || "",
      dialogId: definition.dialogId || "",
      page: definition.page || "",
      announcement: definition.announcement,
      writes: false,
      authorizationDraft: definition.authorizationDraft
        ? {
          granteeType: definition.authorizationDraft.granteeType,
          purpose: definition.authorizationDraft.purpose,
          scopes: [...definition.authorizationDraft.scopes]
        }
        : null
    };
  }

  function buildCareTaskActionIntent(task = {}) {
    const type = cleanText(task.type, 20);
    const id = cleanText(task.id, 160);
    const definitions = {
      随访: { prefix: "followup:", page: "registration", buttonLabel: "安排随访", announcement: "正在前往挂号服务安排随访。" },
      复诊: { prefix: "revisit:", page: "registration", buttonLabel: "预约复诊", announcement: "正在前往挂号服务预约复诊。" },
      取药: { prefix: "pickup:", targetSelector: "#citizen-medication-review", buttonLabel: "核对用药", announcement: "已定位用药核对，请先确认药品和来源记录。" },
      授权: { prefix: "authorization:", buttonLabel: "重新授权", announcement: "已准备续授权，请重新核对范围、有效期并确认同意。" }
    };
    const definition = definitions[type];
    if (!definition || !id.startsWith(definition.prefix) || id.length <= definition.prefix.length) {
      throw new Error("主动健康任务类型或标识无效");
    }
    return {
      action: `care-task-${type}`,
      taskId: id,
      type,
      page: definition.page || "",
      targetSelector: definition.targetSelector || "",
      authorizationId: type === "授权" ? id.slice(definition.prefix.length) : "",
      buttonLabel: definition.buttonLabel,
      announcement: definition.announcement,
      writes: false
    };
  }

  return {
    REQUIRED_INTEGRATIONS,
    CLINICAL_SOURCE_SYSTEMS,
    SAFE_ACTION_INTENTS,
    buildProductionIntegrationStatus,
    validateClinicalSourceSample,
    projectClinicalSourceSample,
    buildClinicalSourceAcceptanceReport,
    assessResidentRecordQuality,
    governCrossInstitutionRecords,
    buildFamilyDelegationCenter,
    buildProactiveCarePlan,
    taskDueState,
    calendarDayDistance,
    explainResidentReports,
    assessMedicationSafety,
    buildEmergencyHealthPack,
    buildOperationsSnapshot,
    buildNextStageWorkspace,
    buildSafeActionIntent,
    buildCareTaskActionIntent
  };
});
