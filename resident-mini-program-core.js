(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports ? require("./citizen-records-policy") : root.CitizenRecordsPolicy,
    typeof module === "object" && module.exports ? require("./citizen-records-v1") : root.CitizenRecordsV1,
    typeof module === "object" && module.exports ? require("./citizen-records-v2") : root.CitizenRecordsV2
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ResidentMiniProgramCore = api;
})(typeof window !== "undefined" ? window : globalThis, function (CitizenRecordsPolicy, CitizenRecordsV1, CitizenRecordsV2) {
  "use strict";

  const APP_ROUTES = new Set([
    "home",
    "messages",
    "profile",
    "health-record",
    "emr",
    "registration",
    "nursing",
    "escort",
    "family-doctor",
    "emergency",
    "tasks"
  ]);

  const ROUTE_PARAMETER_ALLOWLIST = Object.freeze({
    home: new Set(),
    messages: new Set(["messageId"]),
    profile: new Set(),
    "health-record": new Set(["recordId"]),
    emr: new Set(["recordId", "sourceId"]),
    registration: new Set(["sourceId"]),
    nursing: new Set(["sourceId"]),
    escort: new Set(["sourceId"]),
    "family-doctor": new Set(["sourceId"]),
    emergency: new Set(),
    tasks: new Set(["sourceId"])
  });
  const MAX_MESSAGE_BATCH = 100;
  const DEFAULT_MESSAGE_PAGE_SIZE = 10;
  const MAX_MESSAGE_PAGE_SIZE = 30;
  const MAX_MESSAGE_AGE_DAYS = 180;

  const RESIDENT_COLLECTIONS = Object.freeze([
    "diseases",
    "followups",
    "personalRecords",
    "careOrders",
    "medicationPickups",
    "seniorServices",
    "escortServiceOrders",
    "registrationOrders",
    "registrationWaitlistEntries",
    "internetNursingOrders",
    "serviceOrders",
    "taskMessages",
    "citizenLifecycleActions",
    "phase2FamilyDoctorApplications",
    "phase2FamilyDoctorContracts",
    "phase2FamilyDoctorFulfillments"
  ]);

  const STATUS_LABELS = Object.freeze({
    active: "服务中",
    approved: "已通过",
    authorized: "已授权",
    cancelled: "已取消",
    canceled: "已取消",
    closed: "已关闭",
    completed: "已完成",
    confirmed: "已确认",
    delivered: "已送达",
    failed: "处理失败",
    high: "高",
    in_app: "站内消息",
    inactive: "未启用",
    low: "低",
    medium: "中",
    new: "新消息",
    open: "待处理",
    paid: "已支付",
    pending: "待处理",
    read: "已读",
    rejected: "未通过",
    requested: "已申请",
    sent: "未读",
    signed: "已签署",
    suspended: "已暂停",
    unread: "未读",
    verified: "已核验",
    "cancel-requested": "取消申请已提交",
    "not-due": "暂不需续约",
    "self-pay": "自费",
    "resident-confirm": "居民确认",
    "followup-feedback": "随访反馈"
  });

  const ENGLISH_COPY_RULES = Object.freeze([
    [/Teleconsultation feedback returned/gi, "远程会诊反馈已返回"],
    [/Teleconsultation report returned/gi, "远程会诊报告已返回"],
    [/Teleconsultation SLA reminder/gi, "远程会诊时限提醒"],
    [/Chronic follow-up feedback requires review/gi, "慢病随访反馈待复核"],
    [/High-risk chronic follow-up feedback received/gi, "高风险慢病随访反馈已收到"],
    [/Receiving feedback from Dalian Central Hospital/gi, "大连市中心医院已返回接诊反馈"],
    [/Report returned from Dalian Medical University Hospital/gi, "大连医科大学附属医院已返回报告"],
    [/Resident feedback and self-monitoring have been delivered to the family doctor team/gi, "居民反馈和自测记录已送达家庭医生团队"],
    [/Specialist slot reserved/gi, "专家号源已预留"],
    [/review current prescription before video consultation/gi, "请在视频会诊前复核当前处方"],
    [/Recheck HbA1c in three months/gi, "请于三个月后复查糖化血红蛋白"],
    [/primary institution continues diet and exercise intervention/gi, "由基层机构继续开展饮食和运动干预"],
    [/waiting for the video consultation report/gi, "正在等待视频会诊报告"],
    [/System/gi, "系统"],
    [/sent/gi, "未读"],
    [/delivered/gi, "已送达"],
    [/pending/gi, "待处理"],
    [/active/gi, "服务中"],
    [/completed/gi, "已完成"]
  ]);

  function cleanText(value, maximum = 500) {
    return String(value ?? "").trim().slice(0, maximum);
  }

  function safeId(value, maximum = 180) {
    return cleanText(value, maximum).replace(/[^A-Za-z0-9._:-]/g, "");
  }

  function toDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function sessionSubjectKey(session = {}) {
    const fields = ["id", "accountId", "residentId", "role"];
    if (fields.some((field) => !cleanText(session[field], 160))) return "";
    return fields.map((field) => safeId(session[field], 160)).join("::");
  }

  function statusLabel(value, fallback = "待核验") {
    const key = cleanText(value, 80).toLowerCase();
    if (STATUS_LABELS[key]) return STATUS_LABELS[key];
    const candidate = cleanText(value, 80);
    return candidate && !/[A-Za-z]{2,}/.test(candidate) ? candidate : fallback;
  }

  function chineseBusinessText(value, fallback = "消息内容待核验") {
    let text = cleanText(value, 1000);
    if (!text) return fallback;
    ENGLISH_COPY_RULES.forEach(([pattern, replacement]) => {
      text = text.replace(pattern, replacement);
    });
    if (/[A-Za-z]{2,}/.test(text)) return fallback;
    return text;
  }

  function findEnglishBusinessCopy(values = []) {
    return (Array.isArray(values) ? values : [])
      .map((value) => cleanText(value, 1000))
      .filter(Boolean)
      .filter((value) => /[A-Za-z]{2,}/.test(
        value
          .replace(/https?:\/\/\S+/gi, "")
          .replace(/\b(?=[A-Za-z0-9._:-]*\d)[A-Za-z][A-Za-z0-9._:-]*\b/g, "")
      ));
  }

  function isProductionSession(session, now = new Date()) {
    if (!session || typeof session !== "object") return { ok: false, reason: "missing-session", message: "请先安全登录" };
    if (session.role !== "citizen") return { ok: false, reason: "citizen-required", message: "当前账号不是居民账号" };
    if (!safeId(session.id) || !safeId(session.accountId) || !safeId(session.residentId)) {
      return { ok: false, reason: "identity-incomplete", message: "居民身份信息不完整，请重新登录" };
    }
    if (!cleanText(session.token, 4096) || !/^server(?:-|$)/.test(cleanText(session.authMode, 80))) {
      return { ok: false, reason: "server-session-required", message: "未取得服务端安全会话，请重新登录" };
    }
    const expiresAt = toDate(session.expiresAt);
    if (!expiresAt || expiresAt.getTime() <= toDate(now).getTime()) {
      return { ok: false, reason: "session-expired", message: "登录已过期，请重新登录" };
    }
    return { ok: true, expiresAt: expiresAt.toISOString() };
  }

  function validateServerIdentity(session, payload, now = new Date()) {
    const local = isProductionSession(session, now);
    if (!local.ok) return local;
    if (!payload?.ok || !payload.user || payload.user.role !== "citizen") {
      return { ok: false, reason: "server-identity-invalid", message: "服务端未确认居民身份" };
    }
    const fields = ["id", "accountId", "residentId"];
    if (fields.some((field) => safeId(payload.user[field]) !== safeId(session[field]))) {
      return { ok: false, reason: "subject-mismatch", message: "登录主体不一致，已阻断访问" };
    }
    const expiresAt = toDate(payload.expiresAt);
    if (!expiresAt || expiresAt.getTime() <= toDate(now).getTime()) {
      return { ok: false, reason: "server-session-expired", message: "服务端会话已过期，请重新登录" };
    }
    return {
      ok: true,
      expiresAt: expiresAt.toISOString(),
      user: {
        id: safeId(payload.user.id),
        accountId: safeId(payload.user.accountId),
        residentId: safeId(payload.user.residentId),
        role: "citizen",
        name: cleanText(payload.user.name, 80)
      }
    };
  }

  function minimalResident(resident = {}) {
    return {
      id: safeId(resident.id, 120),
      name: cleanText(resident.name || "居民", 80),
      gender: chineseBusinessText(resident.gender, "未填写"),
      birthDate: cleanText(resident.birthDate, 20),
      organization: cleanText(resident.organization || "签约机构待核验", 160),
      familyDoctor: cleanText(resident.familyDoctor || "家庭医生待签约", 120),
      metrics: {
        systolic: Number.isFinite(Number(resident.metrics?.systolic)) ? Number(resident.metrics.systolic) : null,
        diastolic: Number.isFinite(Number(resident.metrics?.diastolic)) ? Number(resident.metrics.diastolic) : null,
        glucose: Number.isFinite(Number(resident.metrics?.glucose)) ? Number(resident.metrics.glucose) : null,
        bmi: Number.isFinite(Number(resident.metrics?.bmi)) ? Number(resident.metrics.bmi) : null
      }
    };
  }

  function fallbackResidentDecision(data, user, residentId, now) {
    if (residentId === user.residentId) return { allowed: true, reason: "self" };
    const account = (Array.isArray(data.accounts) ? data.accounts : []).find((item) => item.id === user.accountId);
    const member = (Array.isArray(account?.members) ? account.members : []).find((item) => item.residentId === residentId);
    if (!member || !CitizenRecordsV2?.relationshipAccessState) {
      return { allowed: false, reason: "verified-relationship-required" };
    }
    const relationship = CitizenRecordsV2.relationshipAccessState(member, now);
    if (!relationship.active) return { allowed: false, reason: relationship.reason || "verified-relationship-required" };
    return { allowed: false, reason: "active-scoped-authorization-required" };
  }

  function residentDecision(data, user, residentId, now = new Date()) {
    if (CitizenRecordsPolicy?.evaluateCitizenResidentRead) {
      return CitizenRecordsPolicy.evaluateCitizenResidentRead(data, user, residentId, {
        now,
        scope: "health-record-summary"
      });
    }
    return fallbackResidentDecision(data, user, residentId, now);
  }

  function reasonLabel(reason) {
    const labels = {
      self: "本人",
      "verified-relationship-and-authorization": "关系与授权均有效",
      "verified-relationship-required": "家庭关系尚未完成核验",
      "active-scoped-authorization-required": "缺少有效的健康档案授权",
      "citizen-role-required": "当前账号不是居民账号",
      "resident-id-required": "居民标识缺失"
    };
    return labels[reason] || "当前不可访问";
  }

  function deriveResidentScope(data = {}, user = {}, now = new Date()) {
    if (!data || user.role !== "citizen") {
      return { allowed: [], blocked: [], allowedIds: new Set(), reason: "citizen-role-required" };
    }
    const account = (Array.isArray(data.accounts) ? data.accounts : []).find((item) => item.id === user.accountId);
    if (!account) return { allowed: [], blocked: [], allowedIds: new Set(), reason: "account-mismatch" };
    const residentById = new Map((Array.isArray(data.residents) ? data.residents : []).map((resident) => [resident.id, resident]));
    const candidates = [
      { residentId: user.residentId, relation: "本人" },
      ...(Array.isArray(account.members) ? account.members : [])
    ];
    const seen = new Set();
    const allowed = [];
    const blocked = [];
    candidates.forEach((member) => {
      const residentId = safeId(member.residentId, 120);
      if (!residentId || seen.has(residentId)) return;
      seen.add(residentId);
      const resident = residentById.get(residentId);
      const decision = resident ? residentDecision(data, user, residentId, now) : { allowed: false, reason: "resident-not-returned" };
      const row = {
        residentId,
        name: resident ? cleanText(resident.name, 80) : "家庭成员",
        relation: residentId === user.residentId ? "本人" : cleanText(member.relation || "家庭成员", 40),
        reason: decision.reason,
        reasonLabel: reasonLabel(decision.reason)
      };
      if (decision.allowed && resident) allowed.push({ ...row, resident: minimalResident(resident) });
      else blocked.push(row);
    });
    return { allowed, blocked, allowedIds: new Set(allowed.map((item) => item.residentId)), reason: allowed.length ? "ok" : "no-accessible-resident" };
  }

  function rowBelongsToResident(row, residentId) {
    return row?.residentId === residentId || row?.maternalResidentId === residentId;
  }

  function projectPersonalRecord(record, residentId) {
    if (!rowBelongsToResident(record, residentId)) return null;
    const projected = CitizenRecordsV1?.projectRecord ? CitizenRecordsV1.projectRecord(record) : null;
    if (!projected) return null;
    return {
      id: projected.id,
      residentId: projected.residentId,
      category: projected.category,
      date: projected.date,
      name: chineseBusinessText(projected.name, "健康资料"),
      result: chineseBusinessText(projected.result, "内容待医疗机构核验"),
      source: chineseBusinessText(projected.source, "来源待核验"),
      status: statusLabel(projected.status, "已归集"),
      updatedAt: projected.updatedAt,
      meta: projected.meta
    };
  }

  function projectRow(row = {}, residentId = "") {
    if (!rowBelongsToResident(row, residentId)) return null;
    return {
      id: safeId(row.id, 180),
      residentId,
      title: chineseBusinessText(row.title || row.name || row.serviceItem || row.diseaseType, "居民服务事项"),
      summary: chineseBusinessText(row.summary || row.result || row.action || row.advice || row.note || row.lastAction, "详情待核验"),
      status: statusLabel(row.status || row.reviewStatus, "待核验"),
      priority: statusLabel(row.priority || row.riskLevel, ""),
      date: cleanText(row.createdAt || row.plannedAt || row.appointmentAt || row.due || row.date || row.nextServiceAt, 60),
      taskId: safeId(row.taskId, 220),
      collection: safeId(row.collection, 100),
      sourceId: safeId(row.sourceId, 180)
    };
  }

  function projectDataForAllowedResidents(data = {}, scope = {}) {
    const allowedIds = scope.allowedIds instanceof Set ? scope.allowedIds : new Set();
    const projected = {
      residents: scope.allowed.map((item) => item.resident),
      relationships: scope.allowed.map(({ residentId, name, relation, reasonLabel: accessLabel }) => ({ residentId, name, relation, accessLabel })),
      blockedRelationships: scope.blocked.map(({ residentId, name, relation, reasonLabel: accessLabel }) => ({ residentId, name, relation, accessLabel })),
      phase2FamilyDoctorTeams: (Array.isArray(data.phase2FamilyDoctorTeams) ? data.phase2FamilyDoctorTeams : []).slice(0, 30).map((team) => ({
        id: safeId(team.id),
        name: chineseBusinessText(team.teamName || team.name, "家庭医生团队"),
        institutionName: chineseBusinessText(team.institutionName, "基层医疗机构")
      })),
      phase2FamilyDoctorServicePackages: (Array.isArray(data.phase2FamilyDoctorServicePackages) ? data.phase2FamilyDoctorServicePackages : []).slice(0, 30).map((item) => ({
        id: safeId(item.id),
        name: chineseBusinessText(item.name, "家庭医生服务包"),
        serviceItems: (Array.isArray(item.serviceItems) ? item.serviceItems : []).slice(0, 12).map((value) => chineseBusinessText(value, "健康服务"))
      }))
    };
    RESIDENT_COLLECTIONS.filter((collection) => collection !== "taskMessages").forEach((collection) => {
      const rows = Array.isArray(data[collection]) ? data[collection] : [];
      projected[collection] = rows.flatMap((row) => {
        const residentId = safeId(row?.residentId || row?.maternalResidentId, 120);
        if (!allowedIds.has(residentId)) return [];
        if (collection === "personalRecords") {
          const record = projectPersonalRecord(row, residentId);
          return record ? [record] : [];
        }
        const item = projectRow(row, residentId);
        return item ? [item] : [];
      });
    });
    projected.taskMessages = scope.allowed
      .flatMap(({ residentId }) => buildMessageBatch(data.taskMessages, residentId, {
        limit: MAX_MESSAGE_BATCH
      }).items)
      .slice(0, MAX_MESSAGE_BATCH);
    return projected;
  }

  function routeForMessage(message = {}) {
    const collection = cleanText(message.collection, 100);
    const routes = {
      personalRecords: "health-record",
      diagnosticReports: "emr",
      followups: "tasks",
      chronicFollowup: "tasks",
      citizenLifecycleActions: "tasks",
      registrationOrders: "registration",
      registrationWaitlistEntries: "registration",
      internetNursingOrders: "nursing",
      escortServiceOrders: "escort",
      phase2FamilyDoctorApplications: "family-doctor",
      phase2FamilyDoctorContracts: "family-doctor",
      referralTeleconsultations: "emr",
      emergencyEvents: "emergency"
    };
    return routes[collection] || "messages";
  }

  function projectMessage(message = {}, residentId = "", options = {}) {
    if (!message?.id || !rowBelongsToResident(message, residentId)) return null;
    if (cleanText(message.targetRole, 80) && message.targetRole !== "citizen") return null;
    const status = cleanText(message.status, 80).toLowerCase();
    const now = toDate(options.now || new Date()) || new Date();
    const createdAt = toDate(message.createdAt);
    const expiresAt = toDate(message.expiresAt);
    const explicitExpiry = Boolean(message.expiresAt);
    const staleAt = createdAt ? new Date(createdAt.getTime() + MAX_MESSAGE_AGE_DAYS * 24 * 60 * 60 * 1000) : null;
    const expired = Boolean(
      (explicitExpiry && (!expiresAt || expiresAt.getTime() <= now.getTime()))
      || (staleAt && staleAt.getTime() <= now.getTime())
    );
    const isRead = ["read", "acknowledged", "已读"].includes(status);
    return {
      id: safeId(message.id, 220),
      residentId,
      title: chineseBusinessText(message.title, "居民服务通知"),
      body: chineseBusinessText(message.body || message.message, "消息内容待核验"),
      status: expired ? "已过期" : statusLabel(status, "未读"),
      isRead,
      isUnread: !expired && !isRead,
      expired,
      createdAt: cleanText(message.createdAt, 60),
      expiresAt: expiresAt?.toISOString() || "",
      route: routeForMessage(message),
      collection: safeId(message.collection, 100),
      sourceId: safeId(message.sourceId, 180)
    };
  }

  function stableMessageRows(messages = [], residentId = "", options = {}) {
    const byId = new Map();
    (Array.isArray(messages) ? messages : []).slice(0, 500).forEach((message) => {
      const projected = projectMessage(message, residentId, options);
      if (!projected?.id) return;
      const previous = byId.get(projected.id);
      if (!previous || `${projected.createdAt}::${projected.id}` > `${previous.createdAt}::${previous.id}`) {
        byId.set(projected.id, projected);
      }
    });
    return [...byId.values()].sort((a, b) => (
      `${b.createdAt}::${b.id}`.localeCompare(`${a.createdAt}::${a.id}`)
    ));
  }

  function buildMessageBatch(messages = [], residentId = "", options = {}) {
    const requestedLimit = Number(options.limit || DEFAULT_MESSAGE_PAGE_SIZE);
    const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : DEFAULT_MESSAGE_PAGE_SIZE, MAX_MESSAGE_BATCH));
    const requestedOffset = Number(options.cursor || 0);
    const offset = Math.max(0, Number.isFinite(requestedOffset) ? Math.floor(requestedOffset) : 0);
    const rows = stableMessageRows(messages, residentId, options).slice(0, MAX_MESSAGE_BATCH);
    const items = rows.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    return {
      items,
      total: rows.length,
      unreadCount: rows.filter((item) => item.isUnread).length,
      expiredCount: rows.filter((item) => item.expired).length,
      nextCursor: nextOffset < rows.length ? String(nextOffset) : ""
    };
  }

  function projectMessages(messages = [], residentId = "", options = {}) {
    return buildMessageBatch(messages, residentId, {
      ...options,
      limit: options.limit || MAX_MESSAGE_BATCH
    }).items;
  }

  function countUnreadMessages(messages = [], residentId = "", options = {}) {
    const unique = new Map();
    (Array.isArray(messages) ? messages : []).forEach((message) => {
      if (message?.residentId !== residentId || !message?.id) return;
      unique.set(message.id, message);
    });
    return [...unique.values()].filter((message) => (
      message.isUnread === true
      || (!message.expired && message.isRead === false)
    )).length;
  }

  function createSensitiveState(residentId = "") {
    return {
      residentId: safeId(residentId, 120),
      route: "home",
      filters: {},
      selectedRecordId: "",
      selectedMessageId: "",
      formDraft: null,
      pendingAction: null,
      transientNotice: ""
    };
  }

  function switchResident(currentState = {}, residentId, allowedIds) {
    const target = safeId(residentId, 120);
    if (!(allowedIds instanceof Set) || !allowedIds.has(target)) {
      return { ok: false, state: createSensitiveState(""), reason: "resident-scope-denied" };
    }
    return { ok: true, state: createSensitiveState(target) };
  }

  function routeName(value) {
    const route = cleanText(value, 80);
    return APP_ROUTES.has(route) ? route : "home";
  }

  function normalizeDeepLinkInput(input) {
    if (typeof input === "string") {
      const text = cleanText(input, 1000);
      if (!text || /(?:^[a-z][a-z0-9+.-]*:|[\\/]{2}|\\|%5c|%2f)/i.test(text)) return null;
      const query = text.startsWith("?") ? text.slice(1) : text;
      return Object.fromEntries(new URLSearchParams(query));
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    return Object.fromEntries(Object.entries(input).map(([key, value]) => [cleanText(key, 80), cleanText(value, 240)]));
  }

  function validateDeepLink(input, context = {}) {
    const candidate = normalizeDeepLinkInput(input);
    if (!candidate) return { ok: false, route: "home", params: {}, reason: "unsafe-link" };
    const route = cleanText(candidate.page || candidate.route || "home", 80);
    if (!APP_ROUTES.has(route)) return { ok: false, route: "home", params: {}, reason: "unknown-page" };
    const allowedKeys = ROUTE_PARAMETER_ALLOWLIST[route] || new Set();
    const inputKeys = Object.keys(candidate).filter((key) => !["page", "route", "residentId"].includes(key));
    if (inputKeys.some((key) => !allowedKeys.has(key))) {
      return { ok: false, route: "home", params: {}, reason: "unknown-parameter" };
    }
    const currentResidentId = safeId(context.residentId, 120);
    const requestedResidentId = safeId(candidate.residentId, 120);
    if (requestedResidentId && requestedResidentId !== currentResidentId) {
      return { ok: false, route: "home", params: {}, reason: "cross-resident-parameter" };
    }
    if (requestedResidentId && (!(context.allowedResidentIds instanceof Set) || !context.allowedResidentIds.has(requestedResidentId))) {
      return { ok: false, route: "home", params: {}, reason: "resident-scope-denied" };
    }
    const params = {};
    for (const key of inputKeys) {
      const value = safeId(candidate[key], 220);
      if (!value || value !== candidate[key]) return { ok: false, route: "home", params: {}, reason: "unsafe-parameter" };
      params[key] = value;
    }
    if (params.messageId) {
      const message = (Array.isArray(context.messages) ? context.messages : []).find((item) => item.id === params.messageId);
      if (!message || message.residentId !== currentResidentId || message.expired) {
        return { ok: false, route: "home", params: {}, reason: "message-scope-denied" };
      }
      if (!["messages", message.route].includes(route)) {
        return { ok: false, route: "home", params: {}, reason: "message-route-mismatch" };
      }
    }
    return { ok: true, route, params, reason: "allowed" };
  }

  function messageDeepLink(message = {}, context = {}) {
    if (!message?.id || message.expired) return { ok: false, route: "messages", params: {}, reason: "message-unavailable" };
    const input = {
      page: message.route,
      residentId: message.residentId
    };
    if (message.route === "messages") input.messageId = message.id;
    else if (["health-record", "emr"].includes(message.route) && message.sourceId) input.recordId = message.sourceId;
    else if (message.sourceId && ROUTE_PARAMETER_ALLOWLIST[message.route]?.has("sourceId")) input.sourceId = message.sourceId;
    return validateDeepLink(input, {
      ...context,
      residentId: context.residentId || message.residentId,
      messages: context.messages || [message]
    });
  }

  function messageReadIntent(message = {}, residentId = "") {
    const messageId = safeId(message.id, 220);
    const owner = safeId(residentId, 120);
    if (!messageId || message.residentId !== owner || message.expired) {
      return { ok: false, reason: "message-read-denied" };
    }
    return {
      ok: true,
      messageId,
      residentId: owner,
      status: "read",
      idempotencyKey: `resident-message-read-${messageId}`.slice(0, 240)
    };
  }

  function confirmMessageReceipt(payload = {}, expectedMessageId = "", options = {}) {
    if (safeId(payload.id, 220) !== safeId(expectedMessageId, 220)) {
      return { ok: false, reason: "receipt-subject-mismatch" };
    }
    if (options.residentId && safeId(payload.residentId, 120) !== safeId(options.residentId, 120)) {
      return { ok: false, reason: "receipt-resident-mismatch" };
    }
    const status = cleanText(payload.status, 80).toLowerCase();
    const receipts = Array.isArray(payload.receipts) ? payload.receipts : [];
    const latest = receipts.find((item) => ["read", "acknowledged", "已读"].includes(cleanText(item?.status, 80).toLowerCase()));
    if (!["read", "acknowledged", "已读"].includes(status) || !latest?.at) {
      return { ok: false, reason: "server-receipt-required" };
    }
    return {
      ok: true,
      idempotent: Boolean(options.currentMessage?.isRead),
      message: projectMessage({ ...payload, targetRole: payload.targetRole || "citizen" }, payload.residentId, options)
    };
  }

  function summarizeResident(data = {}, residentId = "") {
    const count = (key, predicate = () => true) => (Array.isArray(data[key]) ? data[key] : []).filter((item) => item.residentId === residentId && predicate(item)).length;
    const records = (Array.isArray(data.personalRecords) ? data.personalRecords : []).filter((item) => item.residentId === residentId);
    const messages = (Array.isArray(data.taskMessages) ? data.taskMessages : []).filter((item) => item.residentId === residentId);
    const tasks = [
      ...(Array.isArray(data.followups) ? data.followups : []),
      ...(Array.isArray(data.citizenLifecycleActions) ? data.citizenLifecycleActions : [])
    ].filter((item) => item.residentId === residentId && !/已完成|已关闭|completed|closed/i.test(item.status));
    return {
      recordCount: records.length,
      emrCount: records.filter((item) => item.category === "emr").length,
      unreadCount: countUnreadMessages(messages, residentId),
      taskCount: tasks.length,
      registrationCount: count("registrationOrders"),
      nursingCount: count("internetNursingOrders"),
      escortCount: count("escortServiceOrders"),
      familyDoctorCount: count("phase2FamilyDoctorContracts")
    };
  }

  return {
    APP_ROUTES,
    DEFAULT_MESSAGE_PAGE_SIZE,
    MAX_MESSAGE_BATCH,
    MAX_MESSAGE_PAGE_SIZE,
    ROUTE_PARAMETER_ALLOWLIST,
    RESIDENT_COLLECTIONS,
    STATUS_LABELS,
    buildMessageBatch,
    chineseBusinessText,
    cleanText,
    confirmMessageReceipt,
    countUnreadMessages,
    createSensitiveState,
    deriveResidentScope,
    findEnglishBusinessCopy,
    isProductionSession,
    messageDeepLink,
    messageReadIntent,
    minimalResident,
    projectDataForAllowedResidents,
    projectMessage,
    projectMessages,
    reasonLabel,
    routeForMessage,
    routeName,
    safeId,
    sessionSubjectKey,
    statusLabel,
    summarizeResident,
    switchResident,
    validateDeepLink,
    validateServerIdentity
  };
});
