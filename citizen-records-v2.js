(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports
      ? require("./citizen-records-v1")
      : root?.CitizenRecordsV1
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CitizenRecordsV2 = api;
})(typeof window !== "undefined" ? window : globalThis, function (CitizenRecordsV1) {
  "use strict";

  const ACCESS_SCOPES = new Set([
    "health-record-summary",
    "emr-summary",
    "labs",
    "medications",
    "imaging-report",
    "attachments"
  ]);
  const ACTIVE_RELATIONSHIP_STATUSES = new Set(["verified", "confirmed", "核验通过", "已核验"]);
  const CORRECTION_STATUSES = new Set(["submitted", "accepted", "processing", "corrected", "rejected", "withdrawn"]);
  const SHARE_PACKAGE_STATUSES = new Set(["active", "revoked", "expired"]);
  const DEFAULT_COMPLETENESS_ITEMS = Object.freeze([
    { key: "identity", label: "实名与主索引", categories: [] },
    { key: "health-summary", label: "基础健康摘要", categories: ["physical-exam"] },
    { key: "emr", label: "电子病历", categories: ["emr"] },
    { key: "labs", label: "检验检查", categories: ["labs"] },
    { key: "medications", label: "用药记录", categories: ["medications"] },
    { key: "allergies", label: "过敏史", categories: ["allergies"] },
    { key: "imaging", label: "影像报告", categories: ["imaging"] },
    { key: "vaccines", label: "免疫接种", categories: ["vaccines"] }
  ]);

  function cleanText(value, maximum = 500) {
    return String(value ?? "").trim().slice(0, maximum);
  }

  function toDate(value) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function dateOnly(value) {
    const date = toDate(value);
    return date ? date.toISOString().slice(0, 10) : "";
  }

  function safeIdentifier(value, maximum = 160) {
    return cleanText(value, maximum).replace(/[^a-zA-Z0-9._:-]/g, "-");
  }

  function scopeForCategory(category) {
    const scopes = {
      emr: "emr-summary",
      labs: "labs",
      medications: "medications",
      imaging: "imaging-report",
      attachments: "attachments"
    };
    return scopes[cleanText(category, 60)] || "health-record-summary";
  }

  function authorizationTargetsActor(authorization = {}, actor = {}) {
    const meta = authorization.meta || {};
    const targets = new Set([
      meta.granteeId,
      meta.granteeAccountId,
      meta.granteeResidentId
    ].map((item) => cleanText(item, 160)).filter(Boolean));
    return [actor.id, actor.username, actor.accountId, actor.residentId]
      .map((item) => cleanText(item, 160))
      .filter(Boolean)
      .some((item) => targets.has(item));
  }

  function authorizationAllowsScope(authorization = {}, scope) {
    const requested = cleanText(scope, 100);
    const scopes = Array.isArray(authorization.meta?.scopes)
      ? authorization.meta.scopes.map((item) => cleanText(item, 100)).filter(Boolean)
      : [];
    return ACCESS_SCOPES.has(requested)
      && scopes.length > 0
      && scopes.every((item) => ACCESS_SCOPES.has(item))
      && scopes.includes(requested);
  }

  function relationshipAccessState(relationship = {}, now = new Date()) {
    const referenceTime = toDate(now) || new Date();
    const status = cleanText(
      relationship.relationshipStatus || relationship.verificationStatus || relationship.status,
      60
    ).toLowerCase();
    if (!relationship.residentId) return { active: false, reason: "resident-required", label: "缺少关联居民" };
    if (!ACTIVE_RELATIONSHIP_STATUSES.has(status)) {
      return { active: false, reason: "verification-required", label: "关系尚未权威核验" };
    }
    if (!relationship.verifiedAt || !cleanText(relationship.evidenceSource || relationship.evidenceId, 200)) {
      return { active: false, reason: "evidence-required", label: "核验证据不完整" };
    }
    const expiresAt = toDate(relationship.expiresAt);
    if (relationship.expiresAt && !expiresAt) {
      return { active: false, reason: "invalid-expiry", label: "关系有效期格式异常" };
    }
    if (expiresAt && expiresAt.getTime() < referenceTime.getTime()) {
      return { active: false, reason: "expired", label: "关系核验已过期" };
    }
    if (relationship.subjectBecameAdultAt) {
      const adulthood = toDate(relationship.subjectBecameAdultAt);
      const relation = cleanText(relationship.relation, 80);
      if (adulthood && adulthood.getTime() <= referenceTime.getTime() && /监护|guardian/i.test(relation)) {
        return { active: false, reason: "adult-transition-review", label: "成年转换后需重新授权" };
      }
    }
    return { active: true, reason: "verified", label: "关系核验有效" };
  }

  function evaluateProtectedAccess(input = {}) {
    const now = toDate(input.now || new Date()) || new Date();
    const actor = input.actor || {};
    const record = input.record || {};
    const residentId = cleanText(input.residentId || record.residentId, 120);
    const scope = cleanText(input.scope || scopeForCategory(record.category), 100);
    const base = {
      allowed: false,
      residentId,
      scope,
      purpose: cleanText(input.purpose, 300),
      auditRequired: true
    };
    if (actor.role && actor.role !== "citizen") return { ...base, reason: "citizen-role-required" };
    if (!residentId || !actor.residentId) return { ...base, reason: "identity-required" };
    if (!ACCESS_SCOPES.has(scope)) return { ...base, reason: "unsupported-scope" };
    if (actor.residentId === residentId) return { ...base, allowed: true, reason: "self" };
    const relationship = relationshipAccessState(input.relationship, now);
    if (!relationship.active) return { ...base, reason: relationship.reason };
    const authorization = input.authorization || {};
    const state = CitizenRecordsV1?.authorizationState
      ? CitizenRecordsV1.authorizationState(authorization, now)
      : { active: false };
    if (!state.active) return { ...base, reason: "active-authorization-required" };
    if (!authorizationTargetsActor(authorization, actor)) return { ...base, reason: "grantee-mismatch" };
    if (!authorizationAllowsScope(authorization, scope)) return { ...base, reason: "scope-denied" };
    return { ...base, allowed: true, reason: "relationship-and-authorization" };
  }

  function buildControlledAccessIntent(input = {}) {
    if (!input.accessDecision?.allowed) throw new Error("受控资源访问未获授权");
    const resourceId = safeIdentifier(input.resourceId);
    const resourceType = cleanText(input.resourceType, 60);
    const purpose = cleanText(input.purpose || input.accessDecision.purpose, 300);
    if (!resourceId || !["attachment", "imaging"].includes(resourceType) || !purpose) {
      throw new Error("资源、类型和用途均不能为空");
    }
    const requestedTtl = Number(input.ttlSeconds || 300);
    const ttlSeconds = Math.max(30, Math.min(Number.isFinite(requestedTtl) ? requestedTtl : 300, 300));
    return {
      residentId: cleanText(input.accessDecision.residentId, 120),
      resourceId,
      resourceType,
      purpose,
      scope: input.accessDecision.scope,
      ttlSeconds,
      oneTime: true,
      auditRequired: true,
      credentialStatus: "pending-server-issuance"
    };
  }

  function sourceKey(record = {}) {
    const meta = record.meta || {};
    const residentId = cleanText(record.residentId, 120);
    const system = cleanText(meta.sourceSystem || record.sourceSystem || record.source, 120).toLowerCase();
    const id = cleanText(meta.sourceRecordId || record.sourceRecordId || record.externalId || record.id, 160);
    return residentId && system && id ? `${residentId}::${system}::${id}` : "";
  }

  function recordVersionTime(record = {}) {
    return toDate(record.updatedAt || record.versionAt || record.createdAt || record.date)?.getTime() || 0;
  }

  function mergeInstitutionRecords(records = []) {
    const bySource = new Map();
    (Array.isArray(records) ? records : []).forEach((record) => {
      const key = sourceKey(record);
      if (!key) return;
      const previous = bySource.get(key);
      if (!previous || recordVersionTime(record) >= recordVersionTime(previous)) bySource.set(key, record);
    });
    return [...bySource.values()].map((record) => ({
      ...record,
      provenance: {
        sourceSystem: cleanText(record.meta?.sourceSystem || record.sourceSystem || record.source, 120),
        sourceOrganization: cleanText(record.meta?.sourceOrganization || record.sourceOrganization || record.source, 200),
        sourceRecordId: cleanText(record.meta?.sourceRecordId || record.sourceRecordId || record.externalId || record.id, 160),
        version: cleanText(record.meta?.version || record.version || "1", 40),
        lastSynchronizedAt: cleanText(record.updatedAt || record.versionAt || record.createdAt, 60),
        trust: cleanText(record.meta?.sourceTrust || record.sourceTrust || "pending-verification", 60)
      }
    }));
  }

  function abnormalSeverity(record = {}) {
    const meta = record.meta || {};
    const explicit = cleanText(meta.severity || meta.abnormalLevel, 40).toLowerCase();
    if (["critical", "urgent", "危急", "危急值"].includes(explicit)) return "critical";
    if (["high", "warning", "abnormal", "高", "异常"].includes(explicit)) return "warning";
    const text = `${record.status || ""} ${record.result || ""} ${meta.findings || ""}`;
    if (/未见(?:明显)?异常|无异常|结果正常|status[:：]?\s*normal/i.test(text) || /^(正常|normal)$/i.test(cleanText(record.status, 40))) return "";
    if (/危急|危重|critical/i.test(text)) return "critical";
    if (/异常|偏高|偏低|阳性|warning|abnormal/i.test(text)) return "warning";
    return "";
  }

  function buildAbnormalCareTasks(records = [], now = new Date()) {
    const createdAt = toDate(now) || new Date();
    return (Array.isArray(records) ? records : [])
      .map((record) => ({ record, severity: abnormalSeverity(record) }))
      .filter((item) => item.severity)
      .map(({ record, severity }) => {
        const sourceId = safeIdentifier(record.id || record.meta?.sourceRecordId || `${record.category}-${record.date}`);
        const dueDays = severity === "critical" ? 0 : 7;
        const dueAt = new Date(createdAt.getTime() + dueDays * 86400000);
        return {
          id: `care-task-${sourceId}`,
          residentId: cleanText(record.residentId, 120),
          recordId: cleanText(record.id, 160),
          title: cleanText(`${record.name || "健康指标"}需复核`, 240),
          summary: cleanText(record.result || "存在异常结果，请按报告建议联系医疗机构。", 600),
          severity,
          status: "pending-resident",
          dueAt: dueAt.toISOString(),
          actions: severity === "critical"
            ? ["联系报告机构", "必要时及时就医", "记录处置结果"]
            : ["查看报告", "联系医生", "预约复诊", "完成随访"],
          clinicalBoundary: "仅转述医疗机构结果，不由居民端生成诊断或治疗建议。"
        };
      });
  }

  function structuredEmrSummary(record = {}) {
    if (record.category && record.category !== "emr") return null;
    const meta = record.meta || {};
    const diagnoses = Array.isArray(meta.diagnoses)
      ? meta.diagnoses.map((item) => cleanText(item, 160)).filter(Boolean).slice(0, 20)
      : cleanText(meta.diagnosis || record.diagnosis, 500).split(/[、,，;]/).map((item) => item.trim()).filter(Boolean);
    const orders = Array.isArray(meta.orders)
      ? meta.orders.map((item) => cleanText(item, 200)).filter(Boolean).slice(0, 20)
      : [];
    return {
      id: cleanText(record.id, 160),
      residentId: cleanText(record.residentId, 120),
      visitAt: cleanText(record.date || record.occurredAt, 60),
      visitType: cleanText(meta.visitType || record.visitType || "诊疗记录", 80),
      institution: cleanText(meta.sourceOrganization || record.source || "来源待核验", 200),
      department: cleanText(meta.department || record.department, 120),
      chiefComplaint: cleanText(meta.chiefComplaint || record.chiefComplaint, 500),
      diagnoses,
      treatment: cleanText(meta.treatment || record.result || record.summary, 1000),
      orders,
      followupPlan: cleanText(meta.followupPlan || meta.recommendations, 600),
      correctedVersion: cleanText(meta.version || record.version || "1", 40),
      sourceRecordId: cleanText(meta.sourceRecordId || record.sourceRecordId || record.id, 160),
      authority: cleanText(meta.authority || "pending-verification", 60)
    };
  }

  function medicationName(item = {}) {
    return cleanText(item.ingredient || item.genericName || item.name || item.medication, 160)
      .toLowerCase()
      .replace(/[片胶囊注射液颗粒\s()[\]（）]/g, "");
  }

  function reconcileMedicationList(medications = [], allergies = []) {
    const normalized = (Array.isArray(medications) ? medications : [])
      .map((item) => ({
        id: cleanText(item.id, 160),
        name: cleanText(item.name || item.medication || "未命名药品", 200),
        normalizedName: medicationName(item),
        dosage: cleanText(item.meta?.dosage || item.dosage, 200),
        source: cleanText(item.source, 200),
        authority: cleanText(item.meta?.authority || item.authority || "pending-verification", 80),
        status: cleanText(item.status || item.meta?.pharmacyStatus || "使用中", 80)
      }))
      .filter((item) => item.normalizedName);
    const counts = normalized.reduce((map, item) => map.set(item.normalizedName, (map.get(item.normalizedName) || 0) + 1), new Map());
    const allergyTerms = (Array.isArray(allergies) ? allergies : [])
      .flatMap((item) => [item.name, item.result, item.allergen])
      .map((item) => medicationName({ name: item }))
      .filter(Boolean);
    const items = normalized.map((item) => {
      const flags = [];
      if ((counts.get(item.normalizedName) || 0) > 1) flags.push("duplicate-source");
      if (/resident|self|居民/i.test(item.authority)) flags.push("self-reported-review");
      if (allergyTerms.some((term) => term && (item.normalizedName.includes(term) || term.includes(item.normalizedName)))) {
        flags.push("allergy-review");
      }
      return { ...item, flags };
    });
    return {
      items,
      reviewRequired: items.some((item) => item.flags.length),
      flags: [...new Set(items.flatMap((item) => item.flags))],
      clinicalBoundary: "仅提示核对线索；停药、换药或剂量调整须由医生或药师确认。"
    };
  }

  function buildCorrectionRequest(input = {}) {
    const recordId = cleanText(input.recordId, 160);
    const residentId = cleanText(input.residentId, 120);
    const field = cleanText(input.field, 100);
    const reason = cleanText(input.reason, 800);
    const requestedValue = cleanText(input.requestedValue, 1000);
    if (!recordId || !residentId || !field || !reason) throw new Error("记录、字段和纠错原因均不能为空");
    const submittedAt = toDate(input.submittedAt || new Date());
    if (!submittedAt) throw new Error("提交时间格式不正确");
    return {
      id: `correction-${safeIdentifier(recordId)}-${submittedAt.getTime()}`,
      recordId,
      residentId,
      field,
      requestedValue,
      reason,
      status: "submitted",
      submittedAt: submittedAt.toISOString(),
      sourceVersion: cleanText(input.sourceVersion || "1", 40),
      overwriteOriginal: false
    };
  }

  function transitionCorrectionRequest(request = {}, nextStatus, at = new Date()) {
    const current = cleanText(request.status, 40);
    const next = cleanText(nextStatus, 40);
    const allowed = {
      submitted: new Set(["accepted", "rejected", "withdrawn"]),
      accepted: new Set(["processing", "rejected"]),
      processing: new Set(["corrected", "rejected"]),
      corrected: new Set(),
      rejected: new Set(),
      withdrawn: new Set()
    };
    if (!CORRECTION_STATUSES.has(current) || !allowed[current]?.has(next)) {
      throw new Error("纠错状态流转不允许");
    }
    return { ...request, status: next, updatedAt: toDate(at)?.toISOString() || new Date().toISOString() };
  }

  function buildMetricTrends(records = [], metricKeys = []) {
    const selected = new Set((Array.isArray(metricKeys) ? metricKeys : []).map((item) => cleanText(item, 80)));
    const series = new Map();
    (Array.isArray(records) ? records : []).forEach((record) => {
      const metrics = record.meta?.metrics || record.metrics || {};
      Object.entries(metrics).forEach(([key, raw]) => {
        if (selected.size && !selected.has(key)) return;
        const value = Number(typeof raw === "object" ? raw.value : raw);
        if (!Number.isFinite(value)) return;
        if (!series.has(key)) series.set(key, []);
        series.get(key).push({
          at: cleanText(record.date || record.occurredAt, 40),
          value,
          sourceTrust: cleanText(record.meta?.sourceTrust || record.sourceTrust || "pending-verification", 60)
        });
      });
    });
    return [...series.entries()].map(([key, points]) => ({
      key,
      points: points.sort((a, b) => a.at.localeCompare(b.at)),
      latest: points.sort((a, b) => a.at.localeCompare(b.at)).at(-1)?.value
    }));
  }

  function buildDiseaseTopic(disease = {}, records = []) {
    const terms = [disease.type, disease.name, disease.code].map((item) => cleanText(item, 100).toLowerCase()).filter(Boolean);
    const related = (Array.isArray(records) ? records : []).filter((record) => {
      const tags = [
        record.name,
        record.result,
        record.meta?.diagnosis,
        ...(Array.isArray(record.meta?.diagnoses) ? record.meta.diagnoses : [])
      ].map((item) => cleanText(item, 500).toLowerCase());
      return terms.some((term) => tags.some((tag) => tag.includes(term)));
    });
    return {
      id: cleanText(disease.id || disease.code || disease.type, 160),
      title: cleanText(disease.type || disease.name || "疾病专题", 160),
      status: cleanText(disease.status || "待核验", 80),
      diagnosedAt: cleanText(disease.diagnosedAt, 40),
      recordIds: related.map((item) => cleanText(item.id, 160)).filter(Boolean),
      categories: [...new Set(related.map((item) => cleanText(item.category, 60)).filter(Boolean))],
      latestAt: related.map((item) => cleanText(item.date, 40)).sort().at(-1) || ""
    };
  }

  function assessRecordCompleteness(input = {}) {
    const records = (Array.isArray(input.records) ? input.records : []).filter((record) => (
      !input.residentId || record.residentId === input.residentId
    ));
    const resident = input.resident || {};
    const now = toDate(input.now || new Date()) || new Date();
    const items = (input.items || DEFAULT_COMPLETENESS_ITEMS).map((item) => {
      const matching = item.key === "identity"
        ? Boolean(resident.id && (resident.personIndex || resident.identityVerified || resident.phone))
        : records.filter((record) => item.categories.includes(record.category));
      const available = Array.isArray(matching) ? matching.length > 0 : matching;
      const latest = Array.isArray(matching)
        ? matching.map((record) => toDate(record.updatedAt || record.date)).filter(Boolean).sort((a, b) => b - a)[0]
        : null;
      const stale = Boolean(latest && now.getTime() - latest.getTime() > 548 * 86400000);
      return {
        key: item.key,
        label: item.label,
        available,
        stale,
        latestAt: latest?.toISOString() || "",
        reminder: !available ? `待补齐${item.label}` : stale ? `${item.label}超过18个月未更新` : ""
      };
    });
    const score = Math.round(items.filter((item) => item.available).length / items.length * 100);
    return {
      score,
      items,
      reminders: items.filter((item) => item.reminder).map((item) => item.reminder)
    };
  }

  function buildSharePackage(input = {}) {
    const residentId = cleanText(input.residentId, 120);
    const granteeId = cleanText(input.granteeId, 160);
    const purpose = cleanText(input.purpose, 300);
    const scopes = [...new Set((Array.isArray(input.scopes) ? input.scopes : []).map((item) => cleanText(item, 100)).filter(Boolean))];
    const now = toDate(input.createdAt || new Date());
    const expiresAt = toDate(input.expiresAt);
    if (!residentId || !granteeId || !purpose || !scopes.length || !now || !expiresAt) {
      throw new Error("居民、访问对象、用途、范围和有效期均不能为空");
    }
    if (scopes.some((scope) => !ACCESS_SCOPES.has(scope))) throw new Error("资料包范围不受支持");
    if (expiresAt.getTime() <= now.getTime() || expiresAt.getTime() - now.getTime() > 7 * 86400000) {
      throw new Error("资料包有效期必须在未来7天内");
    }
    const packageId = `share-${safeIdentifier(residentId)}-${now.getTime()}`;
    return {
      id: packageId,
      residentId,
      granteeId,
      purpose,
      scopes,
      status: "active",
      oneTimeCodeRequired: true,
      accessRef: safeIdentifier(input.accessRef || `HP-${now.getTime().toString(36).toUpperCase()}`, 80),
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      revokedAt: "",
      auditRequired: true
    };
  }

  function sharePackageState(item = {}, now = new Date()) {
    const referenceTime = toDate(now) || new Date();
    const status = cleanText(item.status, 40).toLowerCase();
    if (!SHARE_PACKAGE_STATUSES.has(status)) return { active: false, key: "invalid", label: "状态异常" };
    if (status === "revoked" || item.revokedAt) return { active: false, key: "revoked", label: "已撤销" };
    const expiry = toDate(item.expiresAt);
    if (!expiry || expiry.getTime() <= referenceTime.getTime()) return { active: false, key: "expired", label: "已过期" };
    return { active: true, key: "active", label: `有效期至 ${expiry.toISOString().slice(0, 16).replace("T", " ")}` };
  }

  function revokeSharePackage(item = {}, at = new Date()) {
    if (!sharePackageState(item, at).active) throw new Error("资料包已失效");
    return { ...item, status: "revoked", revokedAt: toDate(at)?.toISOString() || new Date().toISOString() };
  }

  function buildIdempotentAction(input = {}) {
    const operation = safeIdentifier(input.operation, 60);
    const residentId = safeIdentifier(input.residentId, 120);
    const nonce = safeIdentifier(input.nonce, 100);
    const requestedAt = toDate(input.requestedAt || new Date());
    if (!operation || !residentId || !nonce || !requestedAt) {
      throw new Error("操作、居民、请求标识和请求时间均不能为空");
    }
    const idempotencyKey = `citizen-${operation}-${residentId}-${requestedAt.getTime()}-${nonce}`.slice(0, 240);
    return {
      ...(input.payload && typeof input.payload === "object" ? input.payload : {}),
      idempotencyKey,
      requestedAt: requestedAt.toISOString()
    };
  }

  function projectActionReceipt(payload = {}, expected = {}) {
    const expectedResidentId = cleanText(expected.residentId, 120);
    const expectedResourceId = cleanText(expected.resourceId || expected.recordId || expected.id, 160);
    const payloadResidentId = cleanText(payload.residentId, 120);
    const payloadResourceId = cleanText(payload.resourceId || payload.recordId, 160);
    if (payloadResidentId && expectedResidentId && payloadResidentId !== expectedResidentId) {
      throw new Error("操作回执居民不匹配");
    }
    if (payloadResourceId && expectedResourceId && payloadResourceId !== expectedResourceId) {
      throw new Error("操作回执资源不匹配");
    }
    const receiptId = cleanText(payload.receiptId || payload.requestId, 160);
    const auditRef = cleanText(payload.auditRef || payload.auditReference || payload.auditId, 160);
    if (!receiptId || !auditRef) throw new Error("操作回执缺少受理编号或审计关联号");
    return {
      receiptId,
      auditRef,
      acceptedAt: cleanText(payload.acceptedAt || payload.updatedAt || payload.createdAt, 60),
      syncStatus: cleanText(payload.syncStatus || "accepted", 40)
    };
  }

  function projectCorrectionReceipt(payload = {}, request = {}) {
    const allowedStatuses = new Set(["submitted", "accepted", "processing", "corrected", "rejected", "withdrawn"]);
    const status = cleanText(payload.status || request.status, 40);
    if (!allowedStatuses.has(status)) throw new Error("纠错回执状态不受支持");
    return {
      ...request,
      status,
      ...projectActionReceipt(payload, { residentId: request.residentId, recordId: request.recordId }),
      id: cleanText(request.id, 200)
    };
  }

  function projectSharePackageReceipt(payload = {}, packageRecord = {}) {
    const status = cleanText(payload.status || packageRecord.status, 40);
    if (status !== "active") throw new Error("资料包创建回执状态不受支持");
    return {
      ...packageRecord,
      status: "active",
      ...projectActionReceipt(payload, { residentId: packageRecord.residentId, id: packageRecord.id }),
      id: cleanText(packageRecord.id, 200),
      residentId: cleanText(packageRecord.residentId, 120),
      granteeId: cleanText(packageRecord.granteeId, 160),
      purpose: cleanText(packageRecord.purpose, 300),
      scopes: [...packageRecord.scopes],
      expiresAt: cleanText(packageRecord.expiresAt, 60),
      accessRef: cleanText(payload.accessRef || packageRecord.accessRef, 80)
    };
  }

  function validateControlledCredential(payload = {}, intent = {}, options = {}) {
    const nested = payload.credential || payload.downloadIntent || payload.viewerIntent || {};
    const candidate = { ...payload, ...nested };
    const rawUrl = cleanText(candidate.viewerUrl || candidate.downloadUrl || candidate.url, 2000);
    const expiresAt = toDate(candidate.expiresAt);
    const now = toDate(options.now || new Date()) || new Date();
    const maximumTtl = Math.min(Number(intent.ttlSeconds || 300), 300);
    const auditRef = cleanText(candidate.auditRef || candidate.auditReference || candidate.auditId, 160);
    if (!rawUrl || !expiresAt || candidate.oneTime !== true || !auditRef) {
      throw new Error("短时凭据缺少地址、有效期、单次标识或审计关联号");
    }
    const ttlSeconds = (expiresAt.getTime() - now.getTime()) / 1000;
    if (ttlSeconds <= 0 || ttlSeconds > maximumTtl + 5) throw new Error("短时凭据有效期不符合要求");
    const credentialResourceId = cleanText(candidate.resourceId, 160);
    if (credentialResourceId && credentialResourceId !== cleanText(intent.resourceId, 160)) {
      throw new Error("短时凭据资源不匹配");
    }
    const credentialScope = cleanText(candidate.scope, 100);
    if (credentialScope && credentialScope !== cleanText(intent.scope, 100)) {
      throw new Error("短时凭据范围不匹配");
    }
    const baseUrl = cleanText(options.baseUrl || "https://resident.invalid/", 1000);
    let parsed;
    try {
      parsed = new URL(rawUrl, baseUrl);
    } catch {
      throw new Error("短时凭据地址格式不正确");
    }
    const localhostHttp = parsed.protocol === "http:" && /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(parsed.hostname);
    if (parsed.protocol !== "https:" && !(options.allowHttpLocalhost && localhostHttp)) {
      throw new Error("短时凭据地址必须使用 HTTPS");
    }
    const baseOrigin = new URL(baseUrl).origin;
    const allowedOrigins = new Set(
      (Array.isArray(options.allowedOrigins) && options.allowedOrigins.length ? options.allowedOrigins : [baseOrigin])
        .map((item) => {
          try {
            return new URL(item, baseUrl).origin;
          } catch {
            return "";
          }
        })
        .filter(Boolean)
    );
    if (!allowedOrigins.has(parsed.origin)) throw new Error("短时凭据地址不在允许域名内");
    return {
      url: parsed.href,
      expiresAt: expiresAt.toISOString(),
      oneTime: true,
      auditRef,
      resourceId: cleanText(intent.resourceId, 160),
      scope: cleanText(intent.scope, 100)
    };
  }

  function normalizeAccessibilityPreferences(input = {}) {
    const textScale = Math.max(1, Math.min(Number(input.textScale) || 1, 1.5));
    return {
      simpleMode: Boolean(input.simpleMode),
      highContrast: Boolean(input.highContrast),
      textScale: Math.round(textScale * 10) / 10,
      readAloud: Boolean(input.readAloud),
      confirmSensitiveActions: input.confirmSensitiveActions !== false,
      currentSubjectBanner: input.currentSubjectBanner !== false
    };
  }

  function projectCareWorkspacePayload(payload = {}, residentId = "") {
    const owner = cleanText(residentId, 120);
    const corrections = (Array.isArray(payload.corrections) ? payload.corrections : [])
      .filter((item) => !owner || item?.residentId === owner)
      .map((item) => {
        const status = cleanText(item.status, 40);
        if (!item.id || !item.recordId || !CORRECTION_STATUSES.has(status)) return null;
        return {
          id: cleanText(item.id, 200),
          residentId: cleanText(item.residentId, 120),
          recordId: cleanText(item.recordId, 160),
          field: cleanText(item.field, 100),
          requestedValue: cleanText(item.requestedValue, 1000),
          reason: cleanText(item.reason, 800),
          status,
          submittedAt: cleanText(item.submittedAt, 60),
          updatedAt: cleanText(item.updatedAt, 60),
          sourceVersion: cleanText(item.sourceVersion || "1", 40),
          overwriteOriginal: false,
          receiptId: cleanText(item.receiptId, 160),
          auditRef: cleanText(item.auditRef, 160),
          syncStatus: "server-synced"
        };
      })
      .filter(Boolean);
    const sharePackages = (Array.isArray(payload.sharePackages) ? payload.sharePackages : [])
      .filter((item) => !owner || item?.residentId === owner)
      .map((item) => {
        const scopes = (Array.isArray(item.scopes) ? item.scopes : []).map((scope) => cleanText(scope, 100)).filter(Boolean);
        const status = cleanText(item.status, 40);
        if (!item.id || !item.granteeId || !SHARE_PACKAGE_STATUSES.has(status) || !scopes.length || scopes.some((scope) => !ACCESS_SCOPES.has(scope))) {
          return null;
        }
        return {
          id: cleanText(item.id, 200),
          residentId: cleanText(item.residentId, 120),
          granteeId: cleanText(item.granteeId, 160),
          purpose: cleanText(item.purpose, 300),
          scopes: [...new Set(scopes)],
          status,
          oneTimeCodeRequired: true,
          accessRef: cleanText(item.accessRef, 80),
          createdAt: cleanText(item.createdAt, 60),
          updatedAt: cleanText(item.updatedAt, 60),
          expiresAt: cleanText(item.expiresAt, 60),
          revokedAt: cleanText(item.revokedAt, 60),
          auditRequired: true,
          receiptId: cleanText(item.receiptId, 160),
          auditRef: cleanText(item.auditRef, 160),
          syncStatus: "server-synced"
        };
      })
      .filter(Boolean);
    const rawTaskUpdates = Array.isArray(payload.taskUpdates)
      ? payload.taskUpdates
      : Object.entries(payload.taskUpdates || {}).map(([id, item]) => ({ id, ...(item || {}) }));
    const taskUpdates = Object.fromEntries(rawTaskUpdates
      .filter((item) => !owner || !item?.residentId || item.residentId === owner)
      .map((item) => {
        const id = cleanText(item.id || item.taskId, 200);
        const status = cleanText(item.status, 40);
        if (!id || !["pending-resident", "in-progress", "completed", "closed"].includes(status)) return null;
        return [id, {
          status,
          completedAt: cleanText(item.completedAt, 60),
          updatedAt: cleanText(item.updatedAt, 60),
          receiptId: cleanText(item.receiptId, 160),
          auditRef: cleanText(item.auditRef, 160),
          syncStatus: "server-synced"
        }];
      })
      .filter(Boolean));
    return {
      recordCorrections: corrections,
      recordSharePackages: sharePackages,
      careTaskUpdates: taskUpdates,
      sync: {
        syncedAt: cleanText(payload.syncedAt, 60),
        cursor: cleanText(payload.cursor, 200),
        schemaVersion: cleanText(payload.schemaVersion || "citizen-care-v1", 60)
      }
    };
  }

  function mergeCareWorkspaceState(current = {}, incoming = {}) {
    function versionTime(item = {}) {
      return toDate(item.updatedAt || item.acceptedAt || item.completedAt || item.submittedAt || item.createdAt)?.getTime() || 0;
    }
    function mergeRows(localRows, remoteRows) {
      const byId = new Map((Array.isArray(localRows) ? localRows : []).filter((item) => item?.id).map((item) => [item.id, item]));
      (Array.isArray(remoteRows) ? remoteRows : []).forEach((remote) => {
        const local = byId.get(remote.id);
        if (!local || versionTime(remote) >= versionTime(local) || remote.syncStatus === "server-synced") byId.set(remote.id, remote);
      });
      return [...byId.values()].sort((a, b) => versionTime(b) - versionTime(a));
    }
    const taskUpdates = { ...(current.careTaskUpdates || {}) };
    Object.entries(incoming.careTaskUpdates || {}).forEach(([id, remote]) => {
      const local = taskUpdates[id];
      if (!local || versionTime(remote) >= versionTime(local) || remote.syncStatus === "server-synced") taskUpdates[id] = remote;
    });
    return {
      recordCorrections: mergeRows(current.recordCorrections, incoming.recordCorrections),
      recordSharePackages: mergeRows(current.recordSharePackages, incoming.recordSharePackages),
      careTaskUpdates: taskUpdates,
      sync: { ...(current.sync || {}), ...(incoming.sync || {}) }
    };
  }

  function buildCarePreviewMetadata(now = new Date(), retentionHours = 24) {
    const savedAt = toDate(now);
    const hours = Math.max(1, Math.min(Number(retentionHours) || 24, 24));
    if (!savedAt) throw new Error("演示留存时间格式不正确");
    return {
      schemaVersion: "citizen-care-preview-v1",
      savedAt: savedAt.toISOString(),
      expiresAt: new Date(savedAt.getTime() + hours * 3600000).toISOString()
    };
  }

  function isCarePreviewExpired(metadata = {}, now = new Date()) {
    const expiry = toDate(metadata.expiresAt);
    const reference = toDate(now) || new Date();
    return !expiry || expiry.getTime() <= reference.getTime();
  }

  function summarizeCareWorkspace(input = {}) {
    const records = mergeInstitutionRecords(input.records || []);
    const completeness = assessRecordCompleteness({ ...input, records });
    const careTasks = buildAbnormalCareTasks(records, input.now);
    const emr = records.map(structuredEmrSummary).filter(Boolean);
    const medications = reconcileMedicationList(
      records.filter((item) => item.category === "medications"),
      records.filter((item) => item.category === "allergies")
    );
    const diseaseTopics = (Array.isArray(input.diseases) ? input.diseases : [])
      .map((disease) => buildDiseaseTopic(disease, records));
    return { records, completeness, careTasks, emr, medications, diseaseTopics };
  }

  return {
    ACCESS_SCOPES,
    ACTIVE_RELATIONSHIP_STATUSES,
    CORRECTION_STATUSES,
    SHARE_PACKAGE_STATUSES,
    DEFAULT_COMPLETENESS_ITEMS,
    scopeForCategory,
    authorizationTargetsActor,
    authorizationAllowsScope,
    relationshipAccessState,
    evaluateProtectedAccess,
    buildControlledAccessIntent,
    mergeInstitutionRecords,
    abnormalSeverity,
    buildAbnormalCareTasks,
    structuredEmrSummary,
    reconcileMedicationList,
    buildCorrectionRequest,
    transitionCorrectionRequest,
    buildMetricTrends,
    buildDiseaseTopic,
    assessRecordCompleteness,
    buildSharePackage,
    sharePackageState,
    revokeSharePackage,
    buildIdempotentAction,
    projectActionReceipt,
    projectCorrectionReceipt,
    projectSharePackageReceipt,
    validateControlledCredential,
    normalizeAccessibilityPreferences,
    projectCareWorkspacePayload,
    mergeCareWorkspaceState,
    buildCarePreviewMetadata,
    isCarePreviewExpired,
    summarizeCareWorkspace
  };
});
