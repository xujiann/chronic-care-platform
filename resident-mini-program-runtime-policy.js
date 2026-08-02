(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports ? require("./resident-mini-program-core") : root.ResidentMiniProgramCore
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ResidentMiniProgramRuntimePolicy = api;
})(typeof window !== "undefined" ? window : globalThis, function (Core) {
  "use strict";

  const LOGIN_CODE_TTL_MS = 5 * 60 * 1000;
  const DEEP_LINK_TTL_MS = 5 * 60 * 1000;
  const CACHE_TTL_MS = 30 * 60 * 1000;
  const MAX_DEEP_LINK_PARAMETERS = 9;
  const MAX_DEEP_LINK_LENGTH = 1200;
  const MAX_RESPONSE_ROWS = 100;
  const CACHE_KEYS = new Set(["notification-consent", "service-navigation"]);
  const UNSIGNED_ROUTES = new Set(["home", "messages", "profile"]);
  const PLATFORM_MINIMUM_VERSIONS = Object.freeze({
    wechat: "2.27.0",
    alipay: "2.9.0",
    web: "1.0.0"
  });
  const SENSITIVE_CACHE_KEYS = /(?:token|code|secret|password|body|content|result|record|emr|diagnosis|prescription|objectkey|download|audithash|identity)/i;
  const FORBIDDEN_RESPONSE_KEYS = /^(?:token|accessToken|refreshToken|objectKey|downloadUrl|auditHash|secret)$/i;

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

  function compareVersions(left, right) {
    const normalize = (value) => clean(value, 40).split(".").slice(0, 4).map((item) => {
      const match = item.match(/^\d+/);
      return match ? Number(match[0]) : 0;
    });
    const a = normalize(left);
    const b = normalize(right);
    for (let index = 0; index < Math.max(a.length, b.length, 3); index += 1) {
      const difference = (a[index] || 0) - (b[index] || 0);
      if (difference) return difference > 0 ? 1 : -1;
    }
    return 0;
  }

  function platformCapabilityDecision(input = {}) {
    const runtime = ["wechat", "alipay", "web"].includes(input.runtime) ? input.runtime : "web";
    const minimumVersion = PLATFORM_MINIMUM_VERSIONS[runtime];
    const currentVersion = clean(input.currentVersion || (runtime === "web" ? "1.0.0" : ""), 40);
    const capabilities = {
      navigation: input.capabilities?.navigation === true,
      lifecycle: input.capabilities?.lifecycle === true,
      phoneCall: input.capabilities?.phoneCall === true,
      loginCode: input.capabilities?.loginCode === true
    };
    const permission = ["granted", "denied", "unknown"].includes(input.permission) ? input.permission : "unknown";
    const versionSupported = runtime === "web" || Boolean(currentVersion) && compareVersions(currentVersion, minimumVersion) >= 0;
    const essentialCapabilities = capabilities.navigation && capabilities.lifecycle;
    const supported = versionSupported && essentialCapabilities && permission !== "denied";
    return Object.freeze({
      runtime,
      currentVersion,
      minimumVersion,
      versionSupported,
      permission,
      capabilities: Object.freeze(capabilities),
      supported,
      status: !versionSupported ? "version-too-low" : !essentialCapabilities ? "capability-missing" : permission === "denied" ? "permission-denied" : "ready"
    });
  }

  function createReplayGuard(options = {}) {
    const maximum = Math.max(10, Math.min(Number(options.maximum || 200), 1000));
    const consumed = new Map();
    function prune(now = new Date()) {
      const timestamp = dateValue(now)?.getTime() || Date.now();
      for (const [key, expiresAt] of consumed.entries()) {
        if (expiresAt <= timestamp) consumed.delete(key);
      }
    }
    return Object.freeze({
      has(key, now = new Date()) {
        prune(now);
        return consumed.has(safeId(key, 240));
      },
      consume(key, expiresAt, now = new Date()) {
        prune(now);
        const normalized = safeId(key, 240);
        const expiry = dateValue(expiresAt)?.getTime() || 0;
        const timestamp = dateValue(now)?.getTime() || Date.now();
        if (!normalized || expiry <= timestamp || consumed.has(normalized)) return false;
        if (consumed.size >= maximum) return false;
        consumed.set(normalized, expiry);
        return true;
      },
      clear() {
        consumed.clear();
      },
      size() {
        prune();
        return consumed.size;
      }
    });
  }

  function validOneTimeCode(value) {
    const raw = String(value ?? "").trim();
    if (raw.length > 512) return false;
    const code = clean(raw, 512);
    return code.length >= 6 && code.length <= 512 && /^[A-Za-z0-9._~+/-]+$/.test(code);
  }

  function validateLoginExchangeReceipt(receipt = {}, context = {}, options = {}) {
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return { ok: false, reason: "invalid-receipt" };
    if (["code", "authCode", "token", "accessToken", "refreshToken"].some((key) => Object.hasOwn(receipt, key))) {
      return { ok: false, reason: "raw-credential-returned" };
    }
    const now = dateValue(options.now || new Date()) || new Date();
    const issuedAt = dateValue(receipt.issuedAt);
    const expiresAt = dateValue(receipt.expiresAt);
    const consumedAt = dateValue(receipt.consumedAt);
    const exchangeId = safeId(receipt.exchangeId, 240);
    const subjectKey = clean(receipt.subjectKey, 700);
    const expectedSubject = clean(context.subjectKey, 700);
    const platform = clean(receipt.platform, 20);
    const expectedPlatform = clean(context.platform, 20);
    if (!exchangeId || !subjectKey || subjectKey !== expectedSubject || platform !== expectedPlatform) {
      return { ok: false, reason: "subject-binding-mismatch" };
    }
    if (receipt.serverAccepted !== true || !issuedAt || !expiresAt || !consumedAt) {
      return { ok: false, reason: "server-consumption-required" };
    }
    if (expiresAt.getTime() <= now.getTime() || issuedAt.getTime() > now.getTime() + 30_000) {
      return { ok: false, reason: "login-code-expired" };
    }
    if (
      expiresAt.getTime() - issuedAt.getTime() > LOGIN_CODE_TTL_MS
      || consumedAt < issuedAt
      || consumedAt > expiresAt
      || consumedAt.getTime() > now.getTime() + 30_000
    ) {
      return { ok: false, reason: "invalid-login-code-window" };
    }
    const guard = options.replayGuard;
    if (!guard?.consume?.(`login:${exchangeId}`, expiresAt, now)) return { ok: false, reason: "login-code-replayed" };
    return Object.freeze({
      ok: true,
      exchangeId,
      platform,
      subjectKey,
      expiresAt: expiresAt.toISOString()
    });
  }

  function requestOriginDecision(input, context = {}) {
    const baseOrigin = clean(context.origin, 500);
    let target;
    try {
      target = new URL(input, baseOrigin);
    } catch (error) {
      return { ok: false, reason: "invalid-url" };
    }
    const localhost = ["127.0.0.1", "localhost", "::1"].includes(target.hostname);
    if (target.protocol !== "https:" && !(target.protocol === "http:" && localhost)) {
      return { ok: false, reason: "https-required" };
    }
    if (target.username || target.password || target.hash) return { ok: false, reason: "unsafe-url-components" };
    const allowedOrigins = new Set([baseOrigin, ...(Array.isArray(context.allowedOrigins) ? context.allowedOrigins : [])].filter(Boolean));
    if (!allowedOrigins.has(target.origin)) return { ok: false, reason: "origin-denied" };
    const sensitiveQuery = [...target.searchParams.keys()].some((key) => /token|code|secret|resident|account/i.test(key));
    if (sensitiveQuery) return { ok: false, reason: "sensitive-query-denied" };
    return { ok: true, url: `${target.pathname}${target.search}`, origin: target.origin };
  }

  function validateApiRequest(input, context = {}) {
    const originDecision = requestOriginDecision(input.url, context);
    if (!originDecision.ok) return originDecision;
    const method = clean(input.method || "GET", 12).toUpperCase();
    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) return { ok: false, reason: "method-denied" };
    const writes = !["GET"].includes(method);
    const idempotencyKey = clean(input.idempotencyKey, 240);
    if (writes && (!idempotencyKey || !/^[A-Za-z0-9._:-]{12,240}$/.test(idempotencyKey))) {
      return { ok: false, reason: "idempotency-key-required" };
    }
    return Object.freeze({ ok: true, method, url: originDecision.url, origin: originDecision.origin, idempotencyKey });
  }

  function createIdempotencyKey(operation, binding = {}) {
    const fields = [
      safeId(operation, 80),
      safeId(binding.accountId, 120),
      safeId(binding.residentId, 120),
      safeId(binding.resourceId, 180)
    ];
    if (fields.some((field) => !field)) return "";
    return `resident-write:${fields.join(":")}`.slice(0, 240);
  }

  function validateResidentRows(rows, allowedResidentIds, options = {}) {
    if (!Array.isArray(rows) || !(allowedResidentIds instanceof Set)) return { ok: false, reason: "invalid-resident-response", rows: [] };
    const maximum = Math.max(1, Math.min(Number(options.maximum || MAX_RESPONSE_ROWS), MAX_RESPONSE_ROWS));
    if (rows.length > maximum) return { ok: false, reason: "response-row-limit", rows: [] };
    const allowedKeys = options.allowedKeys instanceof Set ? options.allowedKeys : null;
    const projected = [];
    let rejectedCount = 0;
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) return { ok: false, reason: "invalid-response-row", rows: [] };
      const residentId = safeId(row.residentId || row.maternalResidentId, 120);
      if (!residentId || !allowedResidentIds.has(residentId)) {
        if (options.rejectEntireBatch !== false) return { ok: false, reason: "cross-resident-response", rows: [] };
        rejectedCount += 1;
        continue;
      }
      if (Object.keys(row).some((key) => FORBIDDEN_RESPONSE_KEYS.test(key))) return { ok: false, reason: "forbidden-response-field", rows: [] };
      if (allowedKeys) {
        projected.push(Object.fromEntries([...allowedKeys].filter((key) => Object.hasOwn(row, key)).map((key) => [key, row[key]])));
      } else {
        projected.push(row);
      }
    }
    return { ok: true, rows: projected, rejectedCount };
  }

  function normalizeDeepLinkInput(input) {
    let entries;
    if (typeof input === "string") {
      const text = clean(input, MAX_DEEP_LINK_LENGTH + 1);
      if (!text || text.length > MAX_DEEP_LINK_LENGTH || /(?:^[a-z][a-z0-9+.-]*:|[\\/]{2}|\\|%5c|%2f)/i.test(text)) return null;
      entries = [...new URLSearchParams(text.startsWith("?") ? text.slice(1) : text).entries()];
    } else if (input && typeof input === "object" && !Array.isArray(input)) {
      entries = Object.entries(input);
    } else {
      return null;
    }
    if (entries.length > MAX_DEEP_LINK_PARAMETERS) return null;
    const normalized = {};
    for (const [rawKey, rawValue] of entries) {
      const key = clean(rawKey, 40);
      const value = clean(rawValue, 240);
      if (!key || !/^[A-Za-z][A-Za-z0-9]*$/.test(key) || !value || Object.hasOwn(normalized, key)) return null;
      normalized[key] = value;
    }
    return normalized;
  }

  function canonicalDeepLink(candidate) {
    return Object.keys(candidate)
      .filter((key) => key !== "signature")
      .sort()
      .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(candidate[key])}`)
      .join("&");
  }

  async function validateSignedDeepLink(input, context = {}, options = {}) {
    const candidate = normalizeDeepLinkInput(input);
    if (!candidate) return { ok: false, route: "home", params: {}, reason: "malformed-signed-link" };
    const route = clean(candidate.page || candidate.route || "home", 80);
    const securityKeys = ["issuedAt", "expiresAt", "nonce", "signature"];
    const hasSecurityEnvelope = securityKeys.some((key) => Object.hasOwn(candidate, key));
    const businessKeys = Object.keys(candidate).filter((key) => !["page", "route"].includes(key));
    if (!hasSecurityEnvelope) {
      if (!UNSIGNED_ROUTES.has(route) || businessKeys.length) {
        return { ok: false, route: "home", params: {}, reason: "signed-link-required" };
      }
      return Core.validateDeepLink(candidate, context);
    }
    if (securityKeys.some((key) => !candidate[key])) return { ok: false, route: "home", params: {}, reason: "incomplete-signature-envelope" };
    if (!/^[A-Za-z0-9_-]{24,512}$/.test(candidate.signature) || !safeId(candidate.nonce, 160)) {
      return { ok: false, route: "home", params: {}, reason: "invalid-signature-envelope" };
    }
    const now = dateValue(options.now || new Date()) || new Date();
    const issuedAt = dateValue(candidate.issuedAt);
    const expiresAt = dateValue(candidate.expiresAt);
    if (!issuedAt || !expiresAt || issuedAt.getTime() > now.getTime() + 30_000 || expiresAt.getTime() <= now.getTime()) {
      return { ok: false, route: "home", params: {}, reason: "signed-link-expired" };
    }
    if (expiresAt.getTime() - issuedAt.getTime() > DEEP_LINK_TTL_MS) {
      return { ok: false, route: "home", params: {}, reason: "signed-link-window-too-long" };
    }
    if (safeId(candidate.residentId, 120) !== safeId(context.residentId, 120)) {
      return { ok: false, route: "home", params: {}, reason: "signed-link-resident-mismatch" };
    }
    const verifier = options.verifier;
    let verified = false;
    try {
      verified = typeof verifier === "function" && await verifier(canonicalDeepLink(candidate), candidate.signature) === true;
    } catch (error) {
      verified = false;
    }
    if (!verified) return { ok: false, route: "home", params: {}, reason: "signature-verification-failed" };
    const guard = options.replayGuard;
    if (!guard?.consume?.(`link:${candidate.nonce}`, expiresAt, now)) {
      return { ok: false, route: "home", params: {}, reason: "signed-link-replayed" };
    }
    const business = Object.fromEntries(
      Object.entries(candidate).filter(([key]) => !securityKeys.includes(key) && key !== "nonce")
    );
    return Core.validateDeepLink(business, context);
  }

  function containsSensitiveCacheData(value, depth = 0) {
    if (depth > 5) return true;
    if (Array.isArray(value)) return value.length > 20 || value.some((item) => containsSensitiveCacheData(item, depth + 1));
    if (!value || typeof value !== "object") return false;
    return Object.entries(value).some(([key, item]) => SENSITIVE_CACHE_KEYS.test(key) || containsSensitiveCacheData(item, depth + 1));
  }

  function createBoundCache(storage, options = {}) {
    const prefix = clean(options.prefix || "resident-mini-program-cache:", 100);
    const nowProvider = typeof options.now === "function" ? options.now : () => new Date();
    function storageKey(name) {
      return `${prefix}${name}`;
    }
    function bindingKey(binding = {}) {
      const accountId = safeId(binding.accountId, 120);
      const residentId = safeId(binding.residentId, 120);
      return accountId && residentId ? `${accountId}::${residentId}` : "";
    }
    function remove(name) {
      try {
        storage?.removeItem?.(storageKey(name));
      } catch (error) {
        // A cache removal failure never permits reading the stale value.
      }
    }
    return Object.freeze({
      write(name, payload, binding = {}, ttlMs = CACHE_TTL_MS) {
        if (!CACHE_KEYS.has(name) || !bindingKey(binding) || containsSensitiveCacheData(payload)) return false;
        const ttl = Math.max(1000, Math.min(Number(ttlMs || CACHE_TTL_MS), CACHE_TTL_MS));
        const now = dateValue(nowProvider()) || new Date();
        const record = {
          version: 1,
          binding: bindingKey(binding),
          expiresAt: new Date(now.getTime() + ttl).toISOString(),
          payload
        };
        try {
          storage?.setItem?.(storageKey(name), JSON.stringify(record));
          return true;
        } catch (error) {
          return false;
        }
      },
      read(name, binding = {}) {
        if (!CACHE_KEYS.has(name) || !bindingKey(binding)) return null;
        try {
          const record = JSON.parse(storage?.getItem?.(storageKey(name)) || "null");
          const expiresAt = dateValue(record?.expiresAt);
          const now = dateValue(nowProvider()) || new Date();
          if (record?.version !== 1 || record.binding !== bindingKey(binding) || !expiresAt || expiresAt <= now || containsSensitiveCacheData(record.payload)) {
            remove(name);
            return null;
          }
          return record.payload;
        } catch (error) {
          remove(name);
          return null;
        }
      },
      remove,
      clearAll() {
        CACHE_KEYS.forEach(remove);
      }
    });
  }

  function validateNotification(notification = {}, context = {}, options = {}) {
    if (context.consent !== true) return { ok: false, reason: "notification-consent-required" };
    const now = dateValue(options.now || new Date()) || new Date();
    const id = safeId(notification.id, 220);
    const residentId = safeId(notification.residentId, 120);
    const accountId = safeId(notification.accountId, 120);
    const createdAt = dateValue(notification.createdAt);
    const expiresAt = dateValue(notification.expiresAt);
    if (!id || residentId !== safeId(context.residentId, 120) || accountId !== safeId(context.accountId, 120)) {
      return { ok: false, reason: "notification-binding-mismatch" };
    }
    if (!createdAt || !expiresAt || createdAt > now || expiresAt <= now || expiresAt.getTime() - createdAt.getTime() > 7 * 24 * 60 * 60 * 1000) {
      return { ok: false, reason: "notification-expired" };
    }
    if (notification.revoked === true || ["withdrawn", "revoked", "cancelled"].includes(clean(notification.status, 40).toLowerCase())) {
      return { ok: false, reason: "notification-withdrawn" };
    }
    const guard = options.replayGuard;
    if (!guard?.consume?.(`notification:${id}`, expiresAt, now)) return { ok: false, reason: "notification-replayed" };
    return Object.freeze({
      ok: true,
      id,
      residentId,
      lockScreenTitle: "您有一条新的健康服务消息",
      lockScreenBody: "请打开居民健康服务安全查看",
      inAppTitle: Core.chineseBusinessText(notification.title, "居民健康服务通知"),
      inAppBody: Core.chineseBusinessText(notification.body, "请进入应用查看详情"),
      expiresAt: expiresAt.toISOString()
    });
  }

  return {
    CACHE_KEYS,
    CACHE_TTL_MS,
    DEEP_LINK_TTL_MS,
    LOGIN_CODE_TTL_MS,
    MAX_DEEP_LINK_LENGTH,
    MAX_DEEP_LINK_PARAMETERS,
    MAX_RESPONSE_ROWS,
    PLATFORM_MINIMUM_VERSIONS,
    canonicalDeepLink,
    compareVersions,
    containsSensitiveCacheData,
    createBoundCache,
    createIdempotencyKey,
    createReplayGuard,
    normalizeDeepLinkInput,
    platformCapabilityDecision,
    requestOriginDecision,
    validOneTimeCode,
    validateApiRequest,
    validateLoginExchangeReceipt,
    validateNotification,
    validateResidentRows,
    validateSignedDeepLink
  };
});
