"use strict";

(function exposeAccountLifecycleCore(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.HealthAccountLifecycleCore = api;
})(typeof window !== "undefined" ? window : globalThis, function createAccountLifecycleCore() {
  const REQUEST_TYPES = Object.freeze({
    open: "账号开通",
    change: "账号变更",
    deactivate: "账号停用",
    restore: "账号恢复",
    temporaryGrant: "临时授权"
  });
  const CONFLICT_PAIRS = Object.freeze([
    ["payment.submit", "payment.review", "支付提交与支付复核不得由同一账号兼任"],
    ["account.request", "account.approve", "账号申请与账号审批不得由同一账号兼任"],
    ["audit.write", "audit.verify", "审计记录维护与审计验证不得由同一账号兼任"]
  ]);
  const SERVER_TYPE_ALIASES = Object.freeze({ create: "open", disable: "deactivate", "temporary-grant": "temporaryGrant" });

  function text(value, fallback = "") {
    const normalized = String(value ?? "").trim();
    return normalized || fallback;
  }

  function permissionList(value) {
    if (Array.isArray(value)) return [...new Set(value.map((item) => text(item)).filter(Boolean))];
    return [...new Set(text(value).split(/[，,\n]/).map((item) => item.trim()).filter(Boolean))];
  }

  function checkConflicts(input = {}, accounts = [], currentUser = {}) {
    const conflicts = [];
    const type = text(input.type);
    const username = text(input.username).toLowerCase();
    const accountId = text(input.accountId);
    const permissions = permissionList(input.permissions);
    if (!REQUEST_TYPES[type]) conflicts.push({ code: "TYPE_REQUIRED", level: "error", message: "请选择账号生命周期操作" });
    if (type === "open" && !username) conflicts.push({ code: "USERNAME_REQUIRED", level: "error", message: "账号开通必须填写登录名" });
    if (type !== "open" && !accountId) conflicts.push({ code: "ACCOUNT_REQUIRED", level: "error", message: "请选择目标账号" });
    if (type === "open" && accounts.some((item) => text(item.username).toLowerCase() === username)) {
      conflicts.push({ code: "DUPLICATE_USERNAME", level: "error", message: "登录名已存在，不能重复开通" });
    }
    if (type === "deactivate" && [text(currentUser.id), text(currentUser.username)].includes(accountId)) {
      conflicts.push({ code: "SELF_DEACTIVATION", level: "error", message: "不能提交停用当前登录账号的申请" });
    }
    if (type === "temporaryGrant") {
      const start = Date.parse(input.validFrom || "");
      const end = Date.parse(input.validUntil || "");
      if (!permissions.length) conflicts.push({ code: "PERMISSION_REQUIRED", level: "error", message: "临时授权必须填写权限项" });
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        conflicts.push({ code: "INVALID_VALIDITY", level: "error", message: "临时授权的结束时间必须晚于开始时间" });
      }
    }
    for (const [left, right, message] of CONFLICT_PAIRS) {
      if (permissions.includes(left) && permissions.includes(right)) conflicts.push({ code: "SEGREGATION_OF_DUTIES", level: "error", message });
    }
    if (text(input.reason).length < 8) conflicts.push({ code: "REASON_TOO_SHORT", level: "error", message: "申请原因至少填写 8 个字符" });
    return conflicts;
  }

  function buildRequest(input = {}, actor = {}, accounts = []) {
    const conflicts = checkConflicts(input, accounts, actor);
    if (conflicts.some((item) => item.level === "error")) {
      const error = new TypeError(conflicts.map((item) => item.message).join("；"));
      error.conflicts = conflicts;
      throw error;
    }
    const type = text(input.type);
    return {
      type,
      accountId: text(input.accountId),
      username: text(input.username),
      displayName: text(input.displayName),
      role: text(input.role),
      orgCode: text(input.orgCode),
      permissions: permissionList(input.permissions),
      validFrom: text(input.validFrom),
      validUntil: text(input.validUntil),
      reason: text(input.reason),
      requesterId: text(actor.id || actor.username),
      requesterName: text(actor.name || actor.username, "当前申请人"),
      requestedAction: REQUEST_TYPES[type]
    };
  }

  function canReview(request = {}, reviewer = {}) {
    const reviewerId = text(reviewer.id || reviewer.username);
    const requesterId = text(request.requesterId || request.createdBy);
    if (!reviewerId) return { allowed: false, reason: "无法识别复核人" };
    if (reviewerId === requesterId) return { allowed: false, reason: "申请人与复核人必须为不同账号" };
    if (!["pending-review", "pending", "待复核"].includes(text(request.status, "pending-review"))) {
      return { allowed: false, reason: "该申请当前不处于待复核状态" };
    }
    return { allowed: true, reason: "可执行独立复核" };
  }

  function normalizeRequest(request = {}) {
    const type = SERVER_TYPE_ALIASES[text(request.type)] || text(request.type);
    return {
      ...request,
      id: text(request.id),
      type,
      typeLabel: REQUEST_TYPES[type] || type || "账号申请",
      status: text(request.status, "pending-review"),
      accountId: text(request.accountId),
      username: text(request.username),
      requesterName: text(request.requesterName || request.createdByName, "未知申请人"),
      createdAt: text(request.createdAt),
      timeline: Array.isArray(request.timeline) ? request.timeline : []
    };
  }

  function createClient(options = {}) {
    const fetchImpl = options.fetchImpl;
    if (typeof fetchImpl !== "function") throw new TypeError("账号生命周期工作台需要可用的请求实现");
    const base = text(options.base, "/api").replace(/\/$/, "");
    const commandId = () => globalThis.crypto?.randomUUID?.() || `account-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    async function request(path, requestOptions = {}) {
      const response = await fetchImpl(`${base}${path}`, requestOptions);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.message || `请求失败（HTTP ${response.status}）`);
        error.status = response.status;
        error.payload = payload;
        throw error;
      }
      return payload;
    }
    const jsonPost = (path, payload, idempotent = false) => request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(idempotent ? { "Idempotency-Key": commandId() } : {}) },
      body: JSON.stringify(payload)
    });
    return {
      lifecycle: () => request("/auth/identity-lifecycle"),
      state: () => request("/state"),
      listRequests: () => request("/auth/account-lifecycle-requests"),
      submit: (payload) => jsonPost("/auth/account-lifecycle-requests", payload, true),
      review: (id, payload) => jsonPost(`/auth/account-lifecycle-requests/${encodeURIComponent(id)}/reviews`, payload, true),
      directoryPreview: () => jsonPost("/auth/identity-directory/preview", {}),
      directoryBind: (payload) => jsonPost("/auth/identity-directory/bind", payload),
      directoryApply: (payload) => jsonPost("/auth/identity-directory/apply", payload)
    };
  }

  return { REQUEST_TYPES, CONFLICT_PAIRS, SERVER_TYPE_ALIASES, permissionList, checkConflicts, buildRequest, canReview, normalizeRequest, createClient };
});
