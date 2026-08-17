(function () {
  const SESSION_KEY = "health-city-auth-session";
  const API_BASE = isStaticPreview() ? "" : "/api";
  const DEMO_SMS_CODE = "888888";
  const DELEGATION_SENSITIVE_PERMISSIONS = new Set([
    "resident.record.export",
    "resident.identity.update",
    "payment.submit",
    "delegation.manage"
  ]);
  const ACCEPTED_STEP_UP_LEVELS = new Set(["aal2", "aal3", "substantial", "high", "l2", "l3"]);
  const DEFAULT_STEP_UP_MAX_AGE_MS = 15 * 60 * 1000;
  let authContextState = API_BASE ? "pending" : "ready";
  document.documentElement?.setAttribute("data-auth-resolved", "pending");
  const pendingStyle = document.createElement?.("style");
  if (pendingStyle && document.head) {
    pendingStyle.dataset.authPendingStyle = "";
    pendingStyle.textContent = 'html:not([data-auth-resolved="allowed"]) body:not([data-auth-page="login"]) { visibility: hidden !important; }';
    document.head.append(pendingStyle);
  }
  const demoUsers = [
    { id: "u-nurse", username: "nurse", password: "123456", name: "互联网护理演示护士", role: "institution", roleName: "护士工作站", orgCode: "MR1", orgName: "区域中心医院", orgType: "medical_institution", orgLevel: "三级医院", dataScope: "互联网护理订单与服务轨迹", home: "internet-nursing.html", nurseId: "inn-001", accountType: "nurse" },
    { id: "u-blood-quality", username: "blood_quality", password: "123456", name: "血液中心质控审核员", role: "commission", roleName: "血液中心冷链质控", orgCode: "BLOOD-DL", orgName: "区域血液中心", orgType: "blood_center", orgLevel: "市级", dataScope: "冷链异常、质量处置与血液放行", home: "blood.html", accountType: "blood_quality", bloodPermissions: ["cold_chain_quality_review"] },
    { id: "u-blood-tech-1", username: "blood_tech_1", password: "123456", name: "输血科配血复核员甲", role: "institution", roleName: "输血科检验技师", orgCode: "MR1", orgName: "区域中心医院", orgType: "medical_institution", orgLevel: "三级医院", dataScope: "本机构交叉配血与发血复核", home: "blood.html", accountType: "blood_technologist", bloodPermissions: ["compatibility_review"] },
    { id: "u-blood-tech-2", username: "blood_tech_2", password: "123456", name: "输血科配血复核员乙", role: "institution", roleName: "输血科检验技师", orgCode: "MR1", orgName: "区域中心医院", orgType: "medical_institution", orgLevel: "三级医院", dataScope: "本机构交叉配血与发血复核", home: "blood.html", accountType: "blood_technologist", bloodPermissions: ["compatibility_review"] },
    { id: "u-city", username: "city", password: "123456", name: "市级管理员", role: "commission", roleName: "市级健康城市管理", orgCode: "ORG-CITY-DL", orgName: "区域健康城市平台", orgType: "city", orgLevel: "市级", dataScope: "全市", home: "workbench.html" },
    { id: "u-district", username: "district", password: "123456", name: "区市县管理员", role: "commission", roleName: "区市县管理端", orgCode: "ORG-DIST-ZS", orgName: "中山区健康城市平台", orgType: "district", orgLevel: "区市县", dataScope: "中山区", home: "workbench.html" },
    { id: "u-health", username: "health", password: "123456", name: "区域卫生健康委管理员", role: "commission", roleName: "区域卫生健康委", orgCode: "ORG-HEALTH-DL", orgName: "区域卫生健康委", orgType: "health_admin", orgLevel: "市级", dataScope: "医疗资源、统计直报、公共卫生、分级诊疗和数据质量监管", home: "index.html" },
    { id: "u-mi", username: "mi", password: "123456", name: "区域医保局管理员", role: "insurance", roleName: "区域医保局管理端", orgCode: "ORG-MI-DL", orgName: "区域医保局", orgType: "insurance_bureau", orgLevel: "市级", dataScope: "医保政策、基金监管、待遇管理和跨区县监督", home: "insurance.html" },
    { id: "u-hospital", username: "hospital", password: "123456", name: "医疗机构管理员", role: "institution", roleName: "医疗机构端", orgCode: "MR1", orgName: "区域中心医院", orgType: "medical_institution", orgLevel: "三级医院", dataScope: "本机构", home: "institution.html" },
    { id: "u-community", username: "community", password: "123456", name: "基层机构管理员", role: "institution", roleName: "基层医疗机构端", orgCode: "MR3", orgName: "青泥洼桥社区卫生服务中心", orgType: "medical_institution", orgLevel: "基层医疗机构", dataScope: "本机构与签约居民", home: "institution.html" },
    { id: "u1", username: "whjw", password: "123456", name: "区域卫生健康委管理员", role: "commission", roleName: "区域卫生健康委", orgCode: "ORG-HEALTH-DL", orgName: "区域卫生健康委", orgType: "health_admin", orgLevel: "市级", dataScope: "医疗资源、统计直报、公共卫生、分级诊疗和数据质量监管", home: "index.html" },
    { id: "u2", username: "doctor", password: "123456", name: "刘医生", role: "institution", roleName: "医生账户", orgCode: "MR3", orgName: "青泥洼桥社区卫生服务中心", orgType: "medical_institution", orgLevel: "基层医疗机构", dataScope: "签约居民、随访、长期处方、多点执业申请", home: "doctor.html", doctorId: "doc-liu", accountType: "doctor" },
    { id: "u-doctor-wang", username: "doctor_wang", password: "123456", name: "王医生", role: "institution", roleName: "医生账户", orgCode: "MR1", orgName: "区域中心医院", orgType: "medical_institution", orgLevel: "三级医院", dataScope: "本机构诊疗、转诊接诊、多点执业备案", home: "doctor.html", doctorId: "doc-wang", accountType: "doctor" },
    { id: "u3", username: "insurance", password: "123456", name: "区域医保中心审核员", role: "insurance", roleName: "区域医保中心经办端", orgCode: "ORG-MI-CENTER-DL", orgName: "区域医保中心", orgType: "insurance_center", orgLevel: "市级", dataScope: "医保结算经办、凭证核验、固定取药审核和经办留痕", home: "insurance.html" },
    { id: "u-mi-district", username: "district_mi", password: "123456", name: "区市县医保局管理员", role: "insurance", roleName: "区市县医保局管理端", orgCode: "ORG-MI-DIST-ZS", orgName: "中山区医保局", orgType: "district_insurance_bureau", orgLevel: "区市县", dataScope: "本区医保基金监管、机构监管和慢病待遇协同", home: "insurance.html" },
    { id: "u4", username: "citizen", password: "123456", phone: "DEMO-MOBILE-R1", smsCode: DEMO_SMS_CODE, name: "演示居民A", role: "citizen", roleName: "个人端", orgCode: "PERSON-R1", orgName: "演示居民A家庭", orgType: "citizen", orgLevel: "个人", dataScope: "本人及家庭授权成员", home: "citizen.html", residentId: "r1", accountId: "a1" },
    { id: "u5", username: "county", password: "123456", name: "医共体办公室", role: "county", roleName: "县域医共体平台", orgCode: "ORG-CONSORTIUM-ZS", orgName: "中山区县域医共体", orgType: "county_consortium", orgLevel: "区市县", dataScope: "医共体成员机构", home: "county.html" }
  ];

  const accessPolicy = window.HealthAccessPolicy;

  async function login(username, password) {
    if (API_BASE) {
      try {
        const response = await fetch(`${API_BASE}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ username, password })
        });
        const payload = await response.json().catch(() => ({}));
        if (response.ok && payload.ok) {
          const session = {
            ...payload.user,
            token: payload.token,
            expiresAt: payload.expiresAt,
            loginAt: new Date().toISOString(),
            authMode: "server"
          };
          localStorage.setItem(SESSION_KEY, JSON.stringify(session));
          const contextResult = await refreshAuthContext();
          if (!contextResult.ok) {
            localStorage.removeItem(SESSION_KEY);
            return { ok: false, message: "授权上下文初始化失败，已阻止进入系统" };
          }
          return { ok: true, user: contextResult.user };
        }
        if (response.status === 401 || response.status === 403) {
          return { ok: false, message: payload.message || "账号或密码不正确" };
        }
        return { ok: false, message: payload.message || "认证服务暂不可用，请稍后重试" };
      } catch (error) {
        return { ok: false, message: "认证服务暂不可用，请稍后重试" };
      }
    }
    if (!isDemoMode()) return { ok: false, message: "正式环境未配置可用身份源" };
    const user = demoUsers.find((item) => item.username === username && item.password === password);
    if (!user) return { ok: false, message: "账号或密码不正确" };
    const session = sanitizeUser(user);
    session.loginAt = new Date().toISOString();
    session.authMode = "local";
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return { ok: true, user: session };
  }

  async function loginByPhone(phone, code) {
    const normalizedPhone = normalizePhone(phone);
    const normalizedCode = String(code || "").trim();
    if (API_BASE) {
      try {
        const response = await fetch(`${API_BASE}/auth/phone-login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ phone: normalizedPhone, code: normalizedCode })
        });
        const payload = await response.json().catch(() => ({}));
        if (response.ok && payload.ok) {
          const session = {
            ...payload.user,
            token: payload.token,
            expiresAt: payload.expiresAt,
            loginAt: new Date().toISOString(),
            authMode: "server-phone"
          };
          localStorage.setItem(SESSION_KEY, JSON.stringify(session));
          const contextResult = await refreshAuthContext();
          if (!contextResult.ok) {
            localStorage.removeItem(SESSION_KEY);
            return { ok: false, message: "授权上下文初始化失败，已阻止进入系统" };
          }
          return { ok: true, user: contextResult.user };
        }
        if (response.status === 401 || response.status === 403 || response.status === 404 || response.status === 423) {
          return { ok: false, message: payload.message || "手机号或验证码不正确" };
        }
        return { ok: false, message: payload.message || "认证服务暂不可用，请稍后重试" };
      } catch (error) {
        return { ok: false, message: "认证服务暂不可用，请稍后重试" };
      }
    }
    if (!isDemoMode()) return { ok: false, message: "正式环境未配置可用身份源" };
    const user = demoUsers.find((item) => item.role === "citizen" && normalizePhone(item.phone) === normalizedPhone && normalizedCode === (item.smsCode || DEMO_SMS_CODE));
    if (!user) return { ok: false, message: "手机号或验证码不正确" };
    const session = sanitizeUser(user);
    session.loginAt = new Date().toISOString();
    session.authMode = "local-phone";
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return { ok: true, user: session };
  }

  async function sendPhoneCode(phone) {
    const normalizedPhone = normalizePhone(phone);
    if (API_BASE) {
      try {
        const response = await fetch(`${API_BASE}/auth/phone-code`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ phone: normalizedPhone })
        });
        const payload = await response.json().catch(() => ({}));
        if (response.ok && payload.ok) return { ok: true, ...payload };
        return { ok: false, message: payload.message || "验证码发送失败", retryAfterSeconds: payload.retryAfterSeconds || 0 };
      } catch (error) {
        return { ok: false, message: "认证服务暂不可用，请稍后重试", retryAfterSeconds: 0 };
      }
    }
    if (!isDemoMode()) return { ok: false, message: "正式环境未配置短信身份源" };
    const user = demoUsers.find((item) => item.role === "citizen" && normalizePhone(item.phone) === normalizedPhone);
    if (!user) return { ok: false, message: "手机号未绑定居民账号" };
    return {
      ok: true,
      channel: "local-demo",
      phone: normalizedPhone,
      demoCode: user.smsCode || DEMO_SMS_CODE,
      retryAfterSeconds: 60,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
    };
  }

  function normalizePhone(phone) {
    return String(phone || "").replace(/\s+/g, "").trim();
  }

  function sanitizeUser(user) {
    const { password, ...safeUser } = user;
    return window.HealthRegionalContext?.localize(safeUser) || safeUser;
  }

  function normalizeAccountType(user = {}) {
    const raw = String(user.accountType || "").trim().toLowerCase();
    const aliases = {
      citizen: "resident",
      family_proxy: "guardian",
      family_proxy_guardian: "guardian",
      proxy: "guardian"
    };
    if (raw) return aliases[raw] || raw;
    if (user.doctorId) return "doctor";
    if (user.nurseId) return "nurse";
    if (user.role === "citizen") return "resident";
    if (["commission", "institution", "insurance", "county"].includes(user.role)) return "manager";
    return "";
  }

  function buildExternalIdentityKey(identity = {}) {
    const issuer = String(identity.externalIssuer || identity.issuer || identity.iss || "").trim();
    const subject = String(identity.externalSubject || identity.subject || identity.sub || "").trim();
    if (!issuer || !subject) return "";
    return `${encodeURIComponent(issuer)}::${encodeURIComponent(subject)}`;
  }

  function timestampMs(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function hasRecentStepUp(user = {}, options = {}) {
    const level = String(user.assuranceLevel || user.acr || "").trim().toLowerCase();
    if (!ACCEPTED_STEP_UP_LEVELS.has(level)) return false;
    const authenticatedAt = timestampMs(user.stepUpAt || user.authTime || user.auth_time);
    const nowMs = timestampMs(options.now) || Date.now();
    const maxAgeMs = Number(options.maxAgeMs || DEFAULT_STEP_UP_MAX_AGE_MS);
    return authenticatedAt > 0 && maxAgeMs > 0 && authenticatedAt <= nowMs && nowMs - authenticatedAt <= maxAgeMs;
  }

  function delegationDenied(reason, detail = "") {
    return { ok: false, reason, detail, clientHintOnly: true };
  }

  function validateDelegation(delegation, user, subjectResidentId, permission, options = {}) {
    const actorAccountId = String(user.accountId || user.id || "").trim();
    const requiredAuditFields = ["id", "actorAccountId", "relationship", "legalBasis"];
    const missingAuditFields = requiredAuditFields.filter((field) => !String(delegation[field] || "").trim());
    if (missingAuditFields.length) {
      return delegationDenied("DELEGATION_AUDIT_FIELDS_REQUIRED", `missing auditable delegation fields: ${missingAuditFields.join(", ")}`);
    }
    if (String(delegation.actorAccountId).trim() !== actorAccountId) {
      return delegationDenied("DELEGATION_ACTOR_MISMATCH", "delegation belongs to another actor account");
    }
    if (String(delegation.status || "").toLowerCase() !== "active") {
      return delegationDenied("DELEGATION_NOT_ACTIVE", "delegation status must be active");
    }
    const validFrom = timestampMs(delegation.validFrom);
    const validUntil = timestampMs(delegation.validUntil);
    const nowMs = timestampMs(options.now) || Date.now();
    if (!validFrom || !validUntil || validUntil <= validFrom) {
      return delegationDenied("DELEGATION_VALIDITY_INVALID", "delegation requires a valid start and end time");
    }
    if (nowMs < validFrom) return delegationDenied("DELEGATION_NOT_STARTED", "delegation is not active yet");
    if (nowMs >= validUntil) return delegationDenied("DELEGATION_EXPIRED", "delegation has expired");
    const permissions = Array.isArray(delegation.permissions) ? delegation.permissions.map(String) : [];
    if (permissions.includes("*")) return delegationDenied("DELEGATION_WILDCARD_FORBIDDEN", "delegated permissions must be explicit");
    if (!permissions.includes(permission)) return delegationDenied("DELEGATION_PERMISSION_DENIED", "permission is outside the delegated scope");
    if (DELEGATION_SENSITIVE_PERMISSIONS.has(permission) && !hasRecentStepUp(user, options)) {
      return delegationDenied("DELEGATION_STEP_UP_REQUIRED", "sensitive delegated actions require recent strong authentication");
    }
    return {
      ok: true,
      mode: "delegated",
      actorAccountId,
      actorUserId: String(user.id || ""),
      subjectResidentId,
      permission,
      delegationId: String(delegation.id || ""),
      relationship: String(delegation.relationship || ""),
      legalBasis: String(delegation.legalBasis || ""),
      authorizedAt: new Date(nowMs).toISOString(),
      clientHintOnly: true
    };
  }

  function authorizeDelegatedResidentAccess(subjectResidentId, permission, options = {}) {
    // This fails closed for browser routing only; every API must independently authorize actor, subject and scope.
    const user = options.user || getUser();
    if (!user) return delegationDenied("AUTHENTICATION_REQUIRED", "no authenticated actor session");
    if (normalizeAccountType(user) !== "guardian") {
      return delegationDenied("GUARDIAN_ACCOUNT_REQUIRED", "delegated resident access requires a guardian account");
    }
    const subject = String(subjectResidentId || "").trim();
    const requestedPermission = String(permission || "").trim();
    if (!subject) return delegationDenied("DELEGATION_SUBJECT_REQUIRED", "delegated resident subject is required");
    if (!requestedPermission) return delegationDenied("DELEGATION_PERMISSION_REQUIRED", "delegated permission is required");
    const candidates = (Array.isArray(user.delegations) ? user.delegations : [])
      .filter((item) => String(item.subjectResidentId || "").trim() === subject);
    if (!candidates.length) return delegationDenied("DELEGATION_NOT_FOUND", "no delegation exists for the resident subject");
    const failures = [];
    for (const delegation of candidates) {
      const result = validateDelegation(delegation, user, subject, requestedPermission, options);
      if (result.ok) return result;
      failures.push(result);
    }
    return failures[0] || delegationDenied("DELEGATION_NOT_FOUND", "no usable delegation exists");
  }

  function isStaticPreview() {
    return location.protocol === "file:" || location.hostname.endsWith("github.io");
  }

  function isDemoMode() {
    const configured = window.__HEALTH_CITY_CONFIG__?.demoMode;
    if (typeof configured === "boolean") return configured;
    return isStaticPreview() || ["localhost", "127.0.0.1", "::1"].includes(location.hostname);
  }

  function getUser() {
    try {
      const saved = localStorage.getItem(SESSION_KEY);
      const user = saved ? JSON.parse(saved) : null;
      return user && window.HealthRegionalContext ? window.HealthRegionalContext.localize(user) : user;
    } catch (error) {
      return null;
    }
  }

  function getToken() {
    return getUser()?.token || "";
  }

  function readCookie(name) {
    const prefix = `${encodeURIComponent(name)}=`;
    const row = String(document.cookie || "").split(";").map((item) => item.trim()).find((item) => item.startsWith(prefix));
    return row ? decodeURIComponent(row.slice(prefix.length)) : "";
  }

  function authHeaders(extra = {}) {
    const token = getToken();
    return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
  }

  function authFetch(url, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const headers = authHeaders(options.headers || {});
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      const csrfToken = readCookie("health_platform_csrf");
      if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
    }
    return fetch(url, {
      ...options,
      credentials: options.credentials || "same-origin",
      headers
    });
  }

  async function refreshAuthContext() {
    if (!API_BASE) return { ok: true, user: getUser(), source: "demo" };
    try {
      // Context hydration intentionally relies on the HttpOnly browser session.
      // A stale legacy bearer in localStorage must never override a valid cookie.
      const response = await fetch(`${API_BASE}/auth/context`, { method: "GET", credentials: "same-origin" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok || !payload.user) return { ok: false, status: response.status };
      if (![payload.permissions, payload.regionalCapabilities, payload.pages, payload.menus].every(Array.isArray)) {
        return { ok: false, status: response.status, reason: "INVALID_AUTH_CONTEXT" };
      }
      const previous = getUser() || {};
      const session = {
        ...previous,
        ...payload.user,
        permissions: payload.permissions,
        regionalCapabilities: payload.regionalCapabilities,
        authorizedPages: payload.pages,
        authorizedMenus: payload.menus,
        regionalAuthorization: payload.regional || previous.regionalAuthorization || null,
        policyVersion: payload.policy?.version || payload.policy?.schemaVersion || previous.policyVersion || "",
        productionReady: payload.productionReady === true,
        expiresAt: payload.expiresAt || payload.user.expiresAt || previous.expiresAt,
        authContextVersion: payload.version || payload.schemaVersion || "auth-context-v1",
        authMode: "server-cookie"
      };
      // The context endpoint upgrades the browser to the HttpOnly cookie session.
      // Do not keep a script-readable bearer token after that hand-off.
      delete session.token;
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      authContextState = "ready";
      return { ok: true, user: session, source: "server" };
    } catch (error) {
      authContextState = "failed";
      return { ok: false, status: 0 };
    }
  }

  async function logout() {
    if (API_BASE) {
      try {
        await authFetch(`${API_BASE}/auth/logout`, { method: "POST" });
      } catch (error) {
        // Local session state must still be cleared when the server is unavailable.
      }
    }
    localStorage.removeItem(SESSION_KEY);
    window.location.href = localHref("login.html");
  }

  function localHref(page) {
    const prefix = /\/digital-hospital-standard-platform\//.test(location.pathname) ? "../" : "./";
    return `${prefix}${String(page || "").replace(/^\.\//, "")}`;
  }

  function requireRole(roles) {
    // Legacy inline guards run in <head>. The server static guard has already
    // authenticated this request; the central policy decides after cookie hydration.
    if (API_BASE && authContextState === "pending") return true;
    const allowed = Array.isArray(roles) ? roles : [roles];
    const user = getUser();
    if (!user) {
      window.location.replace(`${localHref("login.html")}?redirect=${encodeURIComponent(currentPage())}`);
      return false;
    }
    if (user.expiresAt && new Date(user.expiresAt).getTime() < Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      window.location.replace(`${localHref("login.html")}?redirect=${encodeURIComponent(currentPage())}&expired=1`);
      return false;
    }
    if (!allowed.includes(user.role) || !canAccessPage(currentPage(), user)) {
      const target = accessPolicy?.homeForUser(user) || "health-city.html";
      window.location.replace(`${localHref(target)}?denied=${encodeURIComponent(currentPage())}`);
      return false;
    }
    return true;
  }

  function requireAccountType(types) {
    if (API_BASE && authContextState === "pending") return true;
    const allowed = Array.isArray(types) ? types : [types];
    const user = getUser();
    if (!user) {
      window.location.replace(`${localHref("login.html")}?redirect=${encodeURIComponent(currentPage())}`);
      return false;
    }
    if (!allowed.includes(normalizeAccountType(user)) || !canAccessPage(currentPage(), user)) {
      const target = accessPolicy?.homeForUser(user) || "health-city.html";
      window.location.replace(`${localHref(target)}?denied=${encodeURIComponent(currentPage())}`);
      return false;
    }
    return true;
  }

  function currentPage() {
    const name = accessPolicy?.normalizePageName(location.pathname) || location.pathname.split("/").pop() || "health-city.html";
    return `${name}${location.search || ""}`;
  }

  function redirectAfterLogin(fallback) {
    const params = new URLSearchParams(location.search);
    const user = getUser();
    const requested = params.get("redirect") || fallback || user?.home || "health-city.html";
    const page = accessPolicy?.normalizePageName(requested) || "";
    const target = canAccessPage(page, user)
      ? page
      : (accessPolicy?.homeForUser(user) || "health-city.html");
    window.location.href = localHref(target);
  }

  function normalizePageName(href) {
    const raw = String(href || "").trim();
    if (!raw || raw.startsWith("#") || /^(mailto:|tel:|javascript:)/i.test(raw)) return "";
    try {
      const url = new URL(href, location.href);
      if (url.origin !== location.origin) return "";
      return accessPolicy?.normalizePageName(url.pathname) || "";
    } catch (error) {
      return "";
    }
  }

  function canAccessPage(pageName, user = getUser(), context = {}) {
    if (!accessPolicy) return false;
    return accessPolicy.canAccessPage(pageName, user, context);
  }

  function enforceCurrentPageAccess() {
    if (document.body?.dataset.authPage === "login") return true;
    const page = accessPolicy?.normalizePageName(location.pathname) || "";
    const user = getUser();
    const decision = accessPolicy?.accessDecision(page, user);
    if (decision?.allowed) {
      document.documentElement?.setAttribute("data-auth-resolved", "allowed");
      return true;
    }
    if (!user || decision?.reason === "LOGIN_REQUIRED") {
      window.location.replace(`${localHref("login.html")}?redirect=${encodeURIComponent(currentPage())}`);
      return false;
    }
    const target = accessPolicy?.homeForUser(user) || "health-city.html";
    window.location.replace(`${localHref(target)}?denied=${encodeURIComponent(currentPage())}`);
    return false;
  }

  async function initializePageAccess() {
    if (document.body?.dataset.authPage === "login") {
      document.documentElement?.setAttribute("data-auth-resolved", "allowed");
      return true;
    }
    if (API_BASE) {
      const contextResult = await refreshAuthContext();
      if (!contextResult.ok) {
        authContextState = "failed";
        localStorage.removeItem(SESSION_KEY);
      }
    }
    if (!enforceCurrentPageAccess()) return false;
    renderSessionBar();
    filterRoleLinks();
    filterRoleFeatures();
    return true;
  }

  function filterRoleLinks() {
    if (document.body?.dataset.authPage === "login") return;
    const user = getUser();
    document.querySelectorAll("a[href]").forEach((link) => {
      const pageName = normalizePageName(link.getAttribute("href"));
      if (pageName && !canAccessPage(pageName, user)) {
        link.remove();
      }
    });
  }

  function filterRoleFeatures() {
    if (document.body?.dataset.authPage === "login") return;
    const user = getUser();
    document.querySelectorAll("[data-permission], [data-role], [data-account-type], [data-regional-capability]").forEach((element) => {
      const roles = String(element.dataset.role || "").split(/[\s,]+/).filter(Boolean);
      const accountTypes = String(element.dataset.accountType || "").split(/[\s,]+/).filter(Boolean);
      const capability = String(element.dataset.regionalCapability || "").trim();
      const permission = String(element.dataset.permission || "").trim();
      const allowed = Boolean(user)
        && (!roles.length || roles.includes(user.role))
        && (!accountTypes.length || accountTypes.includes(normalizeAccountType(user)))
        && (!capability || (Array.isArray(user.regionalCapabilities) && user.regionalCapabilities.includes(capability)))
        && (!permission || accessPolicy?.canUsePermission(permission, user));
      if (!allowed) element.remove();
    });
  }

  function renderSessionBar() {
    if (document.body?.dataset.authPage === "login") return;
    const shell = document.querySelector(".portal-shell, .citizen-shell, .app");
    if (!shell || document.querySelector(".auth-bar")) return;
    const user = getUser();
    const bar = document.createElement("section");
    bar.className = "auth-bar";

    const identity = document.createElement("div");
    const name = document.createElement("strong");
    const detail = document.createElement("span");
    identity.append(name, detail);

    const nav = document.createElement("nav");
    if (user) {
      name.textContent = displayAuthText(user.name);
      detail.textContent = `${displayAuthText(user.roleName)} · ${displayAuthText(user.orgName || "未绑定机构")} · ${displayAuthText(user.dataScope || "默认范围")} · ${String(user.authMode || "").startsWith("server") ? "安全服务端会话" : "本地演示"} · ${new Date(user.loginAt || Date.now()).toLocaleString("zh-CN")}`;
      (accessPolicy?.pagesForUser(user) || []).forEach(({ page: href, label }) => {
        const link = document.createElement("a");
        link.href = localHref(href);
        link.textContent = label;
        nav.append(link);
      });
      const logoutButton = document.createElement("button");
      logoutButton.type = "button";
      logoutButton.dataset.logout = "";
      logoutButton.textContent = "退出";
      nav.append(logoutButton);
    } else {
      name.textContent = "未登录";
      detail.textContent = "请先选择角色进入健康城市系统";
      const loginLink = document.createElement("a");
      loginLink.href = `${localHref("login.html")}?redirect=${encodeURIComponent(currentPage())}`;
      loginLink.textContent = "登录";
      nav.append(loginLink);
    }
    bar.append(identity, nav);
    shell.prepend(bar);
    bar.querySelector("[data-logout]")?.addEventListener("click", logout);
    filterRoleLinks();
    filterRoleFeatures();
  }

  function displayAuthText(value) {
    const text = window.HealthRegionalContext?.localizeText(value) || String(value || "");
    const labels = {
      "Internet nursing demo nurse": "互联网护理演示护士",
      "Nurse workstation": "护士工作站",
      "Regional Central Hospital": "区域中心医院",
      "tertiary hospital": "三级医院",
      "Internet nursing orders and service traces": "互联网护理订单与服务轨迹"
    };
    return labels[text] || text;
  }

  window.HealthCityAuth = {
    demoUsers: isDemoMode() ? demoUsers.map(sanitizeUser) : [],
    demoSmsCode: isDemoMode() ? DEMO_SMS_CODE : "",
    isDemoMode,
    login,
    loginByPhone,
    sendPhoneCode,
    normalizeAccountType,
    buildExternalIdentityKey,
    hasRecentStepUp,
    authorizeDelegatedResidentAccess,
    logout,
    getUser,
    getToken,
    readCookie,
    authHeaders,
    authFetch,
    refreshAuthContext,
    requireRole,
    requireAccountType,
    canAccessPage,
    enforceCurrentPageAccess,
    initializePageAccess,
    redirectAfterLogin,
    renderSessionBar,
    filterRoleLinks,
    filterRoleFeatures
  };

  const startPageAccess = () => { initializePageAccess().catch(() => enforceCurrentPageAccess()); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startPageAccess);
  else startPageAccess();
})();
