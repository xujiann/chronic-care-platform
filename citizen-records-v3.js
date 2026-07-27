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

  function daysBetween(from, to) {
    if (!from || !to) return Number.POSITIVE_INFINITY;
    return Math.floor((to.getTime() - from.getTime()) / 86400000);
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function recordTrust(record = {}) {
    return cleanText(record.provenance?.trust || record.meta?.sourceTrust || record.sourceTrust || "来源待核验", 80);
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
      const fresh = Boolean(lastSuccessAt) && daysBetween(lastSuccessAt, referenceTime) <= Number(input.maximumAgeDays || 7);
      const evidenceReady = nonPlaceholderEvidence(input);
      const connected = ACTIVE_INTEGRATION_STATES.has(cleanText(input.status, 40).toLowerCase());
      const ready = connected && fresh && evidenceReady;
      return {
        ...definition,
        status: ready ? "已核验" : connected ? evidenceReady ? "连接证据已过期" : "缺少正式证据" : "待现场接入",
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
      boundary: "页面状态只反映带正式证据的连接结果；演示数据、环境变量或占位回执不能开启生产门禁。"
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

  function taskPriority(dueAt, now) {
    const due = toDate(dueAt);
    if (!due) return "普通";
    const days = daysBetween(now, due);
    if (days < 0) return "逾期";
    if (days <= 3) return "紧急";
    if (days <= 14) return "近期";
    return "计划";
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
        dueAt: dateOnly(item.plannedAt || item.dueAt),
        priority: taskPriority(item.plannedAt || item.dueAt, now),
        action: "完成自测并联系家庭医生"
      });
    }
    for (const item of Array.isArray(input.pickups) ? input.pickups : []) {
      if (TERMINAL_TASK_STATES.has(cleanText(item.status, 40))) continue;
      tasks.push({
        id: `pickup:${cleanText(item.id, 120)}`,
        type: "取药",
        title: `${cleanText(item.medication || "长期用药")}取药`,
        dueAt: dateOnly(item.nextPickup || item.dueAt),
        priority: taskPriority(item.nextPickup || item.dueAt, now),
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
        dueAt: dateOnly(dueAt),
        priority: taskPriority(dueAt, now),
        action: "查看报告并预约复诊"
      });
    }
    for (const authorization of Array.isArray(input.authorizations) ? input.authorizations : []) {
      const state = CitizenRecordsV1?.authorizationState(authorization, now);
      const expiresAt = authorization.meta?.expiresAt;
      const remaining = daysBetween(now, toDate(expiresAt));
      if (!state?.active || remaining > 30) continue;
      tasks.push({
        id: `authorization:${cleanText(authorization.id, 120)}`,
        type: "授权",
        title: `${cleanText(authorization.name || "健康资料授权")}即将到期`,
        dueAt: dateOnly(expiresAt),
        priority: taskPriority(expiresAt, now),
        action: "核对受权人和用途后决定是否续授权"
      });
    }
    const order = { 逾期: 0, 紧急: 1, 近期: 2, 计划: 3, 普通: 4 };
    tasks.sort((a, b) => (order[a.priority] ?? 9) - (order[b.priority] ?? 9) || a.dueAt.localeCompare(b.dueAt));
    return {
      tasks: [...new Map(tasks.map((item) => [item.id, item])).values()],
      urgentCount: tasks.filter((item) => ["逾期", "紧急"].includes(item.priority)).length,
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
    return {
      integration: buildProductionIntegrationStatus(input.integrations || {}, input.now),
      governance: governCrossInstitutionRecords(records),
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

  return {
    REQUIRED_INTEGRATIONS,
    SAFE_ACTION_INTENTS,
    buildProductionIntegrationStatus,
    governCrossInstitutionRecords,
    buildFamilyDelegationCenter,
    buildProactiveCarePlan,
    explainResidentReports,
    assessMedicationSafety,
    buildEmergencyHealthPack,
    buildOperationsSnapshot,
    buildNextStageWorkspace,
    buildSafeActionIntent
  };
});
