(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports ? require("./resident-mini-program-core") : root.ResidentMiniProgramCore
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ResidentMiniProgramDeliveryPolicy = api;
})(typeof window !== "undefined" ? window : globalThis, function (Core) {
  "use strict";

  const RELEASE_VERSION = "1.0.0-rc.4";
  const MINIMUM_PLATFORM_VERSIONS = Object.freeze({ wechat: "2.27.0", alipay: "2.9.0" });
  const REQUIRED_PAGES = Object.freeze([
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
  const OBSERVABILITY_EVENTS = new Set([
    "app_start",
    "page_ready",
    "request_failed",
    "operation_failed",
    "session_expiring"
  ]);
  const OBSERVABILITY_FIELDS = new Set([
    "durationMs",
    "statusCode",
    "errorKind",
    "route",
    "platform",
    "occurredAt"
  ]);
  const SENSITIVE_FIELD = /(?:resident|identity|idcard|身份证|phone|mobile|手机号|record|病历|diagnosis|prescription|token|code|secret|password|body|content|objectkey|download|audithash|name|address)/i;
  const SENSITIVE_VALUE = /(?:\b1[3-9]\d{9}\b|\b\d{17}[\dXx]\b|bearer\s+\S+|(?:token|code|secret)[=:]\s*\S+)/i;
  const PLACEHOLDER = /(?:^$|__.+__|待配置|placeholder|example(?:\.|$)|replace[-_]?me)/i;
  const QUEUE_TTL_MS = 15 * 60 * 1000;
  const QUEUE_LIMIT = 20;
  const BATCH_READ_LIMIT = 20;

  function clean(value, maximum = 500) {
    return String(value ?? "").trim().slice(0, maximum);
  }

  function safeId(value, maximum = 220) {
    const text = clean(value, maximum);
    return text && /^[A-Za-z0-9._:-]+$/.test(text) ? text : "";
  }

  function dateValue(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function isPlaceholder(value) {
    return PLACEHOLDER.test(clean(value, 500));
  }

  function validHttpsOrigin(value) {
    try {
      const target = new URL(value);
      return target.protocol === "https:"
        && !target.username
        && !target.password
        && !target.hash
        && !["localhost", "127.0.0.1", "::1"].includes(target.hostname)
        && !isPlaceholder(target.hostname);
    } catch (error) {
      return false;
    }
  }

  function validatePlatformShell(config = {}) {
    const platform = ["wechat", "alipay"].includes(config.platform) ? config.platform : "";
    const blockers = [];
    if (!platform) blockers.push("平台类型未配置");
    const expectedMinimum = MINIMUM_PLATFORM_VERSIONS[platform];
    if (!expectedMinimum || clean(config.minimumVersion, 40) !== expectedMinimum) blockers.push("最低兼容版本不匹配");
    const appId = clean(config.appId, 80);
    const validAppId = platform === "wechat" ? /^wx[a-f0-9]{16}$/i.test(appId) : /^\d{16}$/.test(appId);
    if (!validAppId || isPlaceholder(appId)) blockers.push("正式应用标识未配置");
    if (config.configurationVerified !== true || !safeId(config.configurationEvidenceId, 120) || isPlaceholder(config.configurationEvidenceId)) {
      blockers.push("平台配置尚未取得现场核验凭据");
    }
    if (!validHttpsOrigin(config.apiOrigin)) blockers.push("正式接口域名未配置为安全地址");
    if (!validHttpsOrigin(config.businessOrigin)) blockers.push("正式业务域名未配置为安全地址");
    const pages = Array.isArray(config.pages) ? config.pages.map((item) => clean(item, 80)) : [];
    if (pages.length !== REQUIRED_PAGES.length || REQUIRED_PAGES.some((page) => !pages.includes(page))) {
      blockers.push("页面清单不完整");
    }
    const permissions = Array.isArray(config.permissions) ? config.permissions.map((item) => clean(item, 80)) : [];
    const privacy = config.privacy && typeof config.privacy === "object" ? config.privacy : {};
    if (permissions.some((permission) => !clean(privacy[permission], 200) || isPlaceholder(privacy[permission]))) {
      blockers.push("权限用途与隐私声明未完整映射");
    }
    if (config.debug === true) blockers.push("调试开关未关闭");
    if (config.grayReleaseEnabled === true && !clean(config.grayReleaseRuleId, 120)) blockers.push("灰度规则标识缺失");
    return Object.freeze({
      ok: blockers.length === 0,
      platform: platform || "unknown",
      blockers: Object.freeze(blockers)
    });
  }

  function sessionLifecycleDecision(identity = {}, options = {}) {
    const now = dateValue(options.now || new Date()) || new Date();
    const expiresAt = dateValue(identity.expiresAt);
    const expectedSubject = clean(options.subjectKey, 700);
    const subject = clean(identity.subjectKey, 700);
    if (!expiresAt || !expectedSubject || subject !== expectedSubject) {
      return { action: "reauthenticate", reason: "登录主体不匹配，必须重新认证" };
    }
    const remainingMs = expiresAt.getTime() - now.getTime();
    if (remainingMs <= 0) return { action: "reauthenticate", reason: "登录已过期，必须重新认证" };
    if (remainingMs <= 5 * 60 * 1000) return { action: "renew", reason: "登录即将到期，需要服务端续期", remainingMs };
    return { action: "continue", reason: "登录状态有效", remainingMs };
  }

  function beginMemberSwitch(input = {}) {
    const currentResidentId = safeId(input.currentResidentId, 120);
    const targetResidentId = safeId(input.targetResidentId, 120);
    if (input.inProgress === true) return { ok: false, reason: "成员切换正在处理中" };
    if (!currentResidentId || !targetResidentId || currentResidentId === targetResidentId) {
      return { ok: false, reason: "请选择其他可访问家庭成员" };
    }
    if (!(input.allowedResidentIds instanceof Set) || !input.allowedResidentIds.has(targetResidentId)) {
      return { ok: false, reason: "家庭关系或授权已失效，请重新申请" };
    }
    return Object.freeze({
      ok: true,
      transaction: Object.freeze({
        currentResidentId,
        targetResidentId,
        startedAt: clean(input.startedAt || new Date().toISOString(), 60)
      })
    });
  }

  function finishMemberSwitch(transaction = {}, response = {}) {
    const currentResidentId = safeId(transaction.currentResidentId, 120);
    const targetResidentId = safeId(transaction.targetResidentId, 120);
    const allowedIds = response.allowedResidentIds;
    if (
      response.ok !== true
      || !(allowedIds instanceof Set)
      || !allowedIds.has(targetResidentId)
      || safeId(response.residentId, 120) !== targetResidentId
    ) {
      return { ok: false, residentId: currentResidentId, reason: "切换未完成，已恢复原居民页面" };
    }
    return { ok: true, residentId: targetResidentId, reason: "家庭成员已安全切换" };
  }

  function createBatchReadIntent(messages = [], residentId = "") {
    const owner = safeId(residentId, 120);
    const ids = [];
    for (const message of Array.isArray(messages) ? messages : []) {
      if (
        ids.length >= BATCH_READ_LIMIT
        || message?.residentId !== owner
        || message.expired
        || message.isRead
        || !safeId(message.id, 220)
      ) continue;
      if (!ids.includes(message.id)) ids.push(message.id);
    }
    if (!owner || !ids.length) return { ok: false, reason: "当前没有可批量处理的未读消息", messageIds: [] };
    return Object.freeze({
      ok: true,
      residentId: owner,
      messageIds: Object.freeze(ids),
      idempotencyKey: `resident-message-batch-read:${owner}:${ids.join(".")}`.slice(0, 240)
    });
  }

  function reconcileBatchRead(originalMessages = [], intent = {}, receipts = []) {
    if (!intent.ok || !Array.isArray(receipts)) return { ok: false, messages: originalMessages, reason: "批量回执无效，全部保持未读" };
    const byId = new Map(receipts.map((receipt) => [safeId(receipt?.id, 220), receipt]));
    const complete = intent.messageIds.every((id) => {
      const receipt = byId.get(id);
      return receipt?.residentId === intent.residentId && ["read", "已读"].includes(clean(receipt.status, 40).toLowerCase());
    });
    if (!complete) return { ok: false, messages: originalMessages, reason: "部分回执失败，全部保持未读" };
    return {
      ok: true,
      messages: originalMessages.map((message) => intent.messageIds.includes(message.id)
        ? { ...message, status: "已读", isRead: true, isUnread: false }
        : message),
      reason: "服务端已确认全部消息为已读"
    };
  }

  function redactTelemetry(value, depth = 0) {
    if (depth > 5) return "[已脱敏]";
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactTelemetry(item, depth + 1));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_FIELD.test(key) ? "[已脱敏]" : redactTelemetry(item, depth + 1)
      ]));
    }
    const text = typeof value === "string" ? clean(value, 300) : value;
    return typeof text === "string" && SENSITIVE_VALUE.test(text) ? "[已脱敏]" : text;
  }

  function minimizeTelemetryEvent(event = {}) {
    const name = clean(event.name, 80);
    if (!OBSERVABILITY_EVENTS.has(name)) return null;
    const fields = {};
    for (const key of OBSERVABILITY_FIELDS) {
      if (!Object.hasOwn(event, key)) continue;
      const value = redactTelemetry(event[key]);
      if (value !== "" && value !== undefined && value !== null) fields[key] = value;
    }
    return Object.freeze({ name, fields: Object.freeze(fields) });
  }

  function createObservabilityQueue(storage, options = {}) {
    const storageKey = clean(options.storageKey || "resident-mini-program-observability", 100);
    const nowProvider = typeof options.now === "function" ? options.now : () => new Date();
    let consent = false;
    function binding(value) {
      return safeId(value, 160);
    }
    function clear() {
      try {
        storage?.removeItem?.(storageKey);
      } catch (error) {
        // Failure to remove never permits reading the old queue.
      }
    }
    function read(accountBinding) {
      if (!consent || !binding(accountBinding)) return [];
      try {
        const record = JSON.parse(storage?.getItem?.(storageKey) || "null");
        const now = dateValue(nowProvider()) || new Date();
        if (record?.version !== 1 || record.binding !== binding(accountBinding) || !Array.isArray(record.events)) {
          clear();
          return [];
        }
        const events = record.events.filter((item) => {
          const expiresAt = dateValue(item.expiresAt);
          return expiresAt && expiresAt > now && minimizeTelemetryEvent(item.event);
        }).slice(-QUEUE_LIMIT);
        if (events.length !== record.events.length) {
          storage?.setItem?.(storageKey, JSON.stringify({ ...record, events }));
        }
        return events.map((item) => item.event);
      } catch (error) {
        clear();
        return [];
      }
    }
    return Object.freeze({
      setConsent(value) {
        consent = value === true;
        if (!consent) clear();
        return consent;
      },
      enqueue(event, accountBinding) {
        if (!consent || !binding(accountBinding)) return false;
        const minimized = minimizeTelemetryEvent(event);
        if (!minimized) return false;
        const now = dateValue(nowProvider()) || new Date();
        const existing = read(accountBinding);
        const events = [...existing, minimized].slice(-QUEUE_LIMIT).map((item) => ({
          event: item,
          expiresAt: new Date(now.getTime() + QUEUE_TTL_MS).toISOString()
        }));
        try {
          storage?.setItem?.(storageKey, JSON.stringify({ version: 1, binding: binding(accountBinding), events }));
          return true;
        } catch (error) {
          return false;
        }
      },
      read,
      clear,
      isEnabled: () => consent
    });
  }

  function releaseDecision(input = {}) {
    const shells = Array.isArray(input.shells) ? input.shells.map(validatePlatformShell) : [];
    const blockers = shells.flatMap((shell) => shell.blockers.map((reason) => `${shell.platform}：${reason}`));
    if (shells.length !== 2) blockers.push("微信与支付宝平台壳未同时提供");
    const version = clean(input.version || RELEASE_VERSION, 40);
    const buildNumber = clean(input.buildNumber, 40);
    if (!/^\d+\.\d+\.\d+(?:-rc\.\d+)?$/.test(version)) blockers.push("发布版本号不符合约定");
    if (!/^\d{8}\.\d+$/.test(buildNumber) || isPlaceholder(buildNumber)) blockers.push("正式构建号未配置");
    const services = input.services && typeof input.services === "object" ? input.services : {};
    for (const [key, label] of Object.entries({
      identity: "统一身份与会话服务未就绪",
      residentScope: "居民关系与授权服务未就绪",
      messageReceipt: "消息回执与幂等服务未就绪",
      deepLinkSignature: "安全深链签名服务未就绪",
      notification: "通知订阅与撤回服务未就绪"
    })) {
      if (services[key] !== true) blockers.push(label);
    }
    if (input.emergencyStop === true) blockers.push("紧急停用开关已开启");
    return Object.freeze({
      softwareCandidate: shells.length === 2,
      productionReady: blockers.length === 0,
      version,
      buildNumber,
      grayReleaseEnabled: input.grayReleaseEnabled === true,
      emergencyStop: input.emergencyStop === true,
      blockers: Object.freeze(blockers)
    });
  }

  function serviceViewDecision(input = {}) {
    if (input.loading === true) return { state: "loading", message: "正在安全加载此项服务，请稍候" };
    if (input.permission === false) return { state: "forbidden", message: "当前居民未获得此项服务权限，可返回后重新申请授权" };
    if (input.network === "offline") return { state: "offline", message: "当前网络不可用，请恢复网络后重试" };
    if (input.error === true) return { state: "error", message: "服务加载失败，请稍后重试" };
    if (!Array.isArray(input.rows) || input.rows.length === 0) return { state: "empty", message: "当前居民暂无此项服务记录" };
    return { state: "ready", message: "服务内容已安全加载" };
  }

  return {
    BATCH_READ_LIMIT,
    MINIMUM_PLATFORM_VERSIONS,
    QUEUE_LIMIT,
    QUEUE_TTL_MS,
    RELEASE_VERSION,
    REQUIRED_PAGES,
    beginMemberSwitch,
    createBatchReadIntent,
    createObservabilityQueue,
    finishMemberSwitch,
    isPlaceholder,
    minimizeTelemetryEvent,
    reconcileBatchRead,
    redactTelemetry,
    releaseDecision,
    serviceViewDecision,
    sessionLifecycleDecision,
    validatePlatformShell,
    validHttpsOrigin
  };
});
