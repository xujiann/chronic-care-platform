(function () {
  const SESSION_KEY = "health-city-auth-session";
  const SCRIPT_READABLE_CREDENTIAL_FIELDS = new Set(["token", "accessToken", "refreshToken", "idToken", "bearerToken", "authorization"]);
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
  let volatileBearerToken = "";
  document.documentElement?.setAttribute("data-auth-resolved", "pending");
  const pendingStyle = document.createElement?.("style");
  if (pendingStyle && document.head) {
    pendingStyle.dataset.authPendingStyle = "";
    pendingStyle.textContent = 'html:not([data-auth-resolved="allowed"]) body:not([data-auth-page="login"]) { visibility: hidden !important; }';
    document.head.append(pendingStyle);
  }
  const demoUsers = [
    { id: "u-health", accountCode: "DEMO-HEALTH-ADMIN", catalogOrder: 10, username: "health", password: "123456", name: "卫生健康主管部门管理员（演示）", role: "commission", roleName: "卫生健康综合管理岗位", orgCode: "ORG-HEALTH-DL", orgName: "地区卫生健康主管部门", orgType: "health_admin", orgLevel: "市级", dataScope: "示范地区医疗资源、统计直报、公共卫生、分级诊疗和数据质量监管", home: "index.html", accountType: "manager" },
    { id: "u-city", accountCode: "DEMO-PLATFORM-OPS", catalogOrder: 20, username: "city", password: "123456", name: "平台运营管理员（演示）", role: "commission", roleName: "平台运营管理岗位", orgCode: "ORG-CITY-DL", orgName: "卫生健康信息平台运营中心", orgType: "city", orgLevel: "市级", dataScope: "示范地区全域运行监测与跨部门协同", home: "workbench.html", accountType: "manager" },
    { id: "u-district", accountCode: "DEMO-AREA-ADMIN", catalogOrder: 30, username: "district", password: "123456", name: "辖区卫生健康管理员（演示）", role: "commission", roleName: "辖区综合管理岗位", orgCode: "ORG-DIST-ZS", orgName: "示范区卫生健康管理中心", orgType: "district", orgLevel: "区县级", dataScope: "示范辖区居民、机构与公共卫生业务", home: "workbench.html", accountType: "manager" },
    { id: "u-blood-quality", accountCode: "DEMO-BLOOD-QUALITY", catalogOrder: 40, username: "blood_quality", password: "123456", name: "血液质量审核员（演示）", role: "commission", roleName: "血液冷链质控岗位", orgCode: "BLOOD-DL", orgName: "区域血液中心", orgType: "blood_center", orgLevel: "市级", dataScope: "冷链异常、质量处置与血液放行", home: "blood.html", accountType: "blood_quality", bloodPermissions: ["cold_chain_quality_review"] },
    { id: "u-nurse", accountCode: "DEMO-NURSE", catalogOrder: 110, username: "nurse", password: "123456", name: "互联网护理护士（演示）", role: "institution", roleName: "互联网护理岗位", orgCode: "MR1", orgName: "示范医院", orgType: "medical_institution", orgLevel: "三级医院", dataScope: "互联网护理订单与服务轨迹", home: "internet-nursing.html", nurseId: "inn-001", accountType: "nurse" },
    { id: "u-hospital", accountCode: "DEMO-HOSPITAL-ADMIN", catalogOrder: 120, username: "hospital", password: "123456", name: "医院管理员（演示）", role: "institution", roleName: "医院综合管理岗位", orgCode: "MR1", orgName: "示范医院", orgType: "medical_institution", orgLevel: "三级医院", dataScope: "本机构业务与管理数据", home: "institution.html", accountType: "manager" },
    { id: "u-community", accountCode: "DEMO-PRIMARY-ADMIN", catalogOrder: 130, username: "community", password: "123456", name: "基层机构管理员（演示）", role: "institution", roleName: "基层机构管理岗位", orgCode: "MR3", orgName: "基层医疗机构", orgType: "medical_institution", orgLevel: "基层医疗机构", dataScope: "本机构与签约居民", home: "institution.html", accountType: "manager" },
    { id: "u2", accountCode: "DEMO-PRIMARY-DOCTOR", catalogOrder: 140, username: "doctor", password: "123456", name: "基层全科医生（演示）", role: "institution", roleName: "基层医生岗位", orgCode: "MR3", orgName: "基层医疗机构", orgType: "medical_institution", orgLevel: "基层医疗机构", dataScope: "签约居民、随访、长期处方和多点执业申请", home: "doctor.html", doctorId: "doc-liu", accountType: "doctor" },
    { id: "u-doctor-wang", accountCode: "DEMO-HOSPITAL-DOCTOR", catalogOrder: 150, username: "doctor_wang", password: "123456", name: "医院临床医生（演示）", role: "institution", roleName: "医院医生岗位", orgCode: "MR1", orgName: "示范医院", orgType: "medical_institution", orgLevel: "三级医院", dataScope: "本机构诊疗、转诊接诊和多点执业备案", home: "doctor.html", doctorId: "doc-wang", accountType: "doctor" },
    { id: "u-blood-tech-1", accountCode: "DEMO-BLOOD-MATCH", catalogOrder: 160, username: "blood_tech_1", password: "123456", name: "输血科配血复核员（演示）", role: "institution", roleName: "输血科配血复核岗位", orgCode: "MR1", orgName: "示范医院", orgType: "medical_institution", orgLevel: "三级医院", dataScope: "本机构交叉配血复核", home: "blood.html", accountType: "blood_technologist", bloodPermissions: ["compatibility_review"] },
    { id: "u-blood-tech-2", accountCode: "DEMO-BLOOD-ISSUE", catalogOrder: 170, username: "blood_tech_2", password: "123456", name: "输血科发血复核员（演示）", role: "institution", roleName: "输血科发血复核岗位", orgCode: "MR1", orgName: "示范医院", orgType: "medical_institution", orgLevel: "三级医院", dataScope: "本机构发血复核", home: "blood.html", accountType: "blood_technologist", bloodPermissions: ["compatibility_review"] },
    { id: "u-mi", accountCode: "DEMO-INSURANCE-ADMIN", catalogOrder: 210, username: "mi", password: "123456", name: "医疗保障主管部门管理员（演示）", role: "insurance", roleName: "医疗保障综合管理岗位", orgCode: "ORG-MI-DL", orgName: "地区医疗保障主管部门", orgType: "insurance_bureau", orgLevel: "市级", dataScope: "医保政策、基金监管、待遇管理和辖区监督", home: "insurance.html", accountType: "manager" },
    { id: "u3", accountCode: "DEMO-INSURANCE-REVIEW", catalogOrder: 220, username: "insurance", password: "123456", name: "医疗保障经办审核员（演示）", role: "insurance", roleName: "医疗保障经办审核岗位", orgCode: "ORG-MI-CENTER-DL", orgName: "地区医疗保障经办中心", orgType: "insurance_center", orgLevel: "市级", dataScope: "医保结算、凭证核验、固定取药审核和经办留痕", home: "insurance.html", accountType: "reviewer" },
    { id: "u-mi-district", accountCode: "DEMO-AREA-INSURANCE", catalogOrder: 230, username: "district_mi", password: "123456", name: "辖区医疗保障管理员（演示）", role: "insurance", roleName: "辖区医疗保障管理岗位", orgCode: "ORG-MI-DIST-ZS", orgName: "示范区医疗保障管理部门", orgType: "district_insurance_bureau", orgLevel: "区县级", dataScope: "示范辖区基金、机构和慢病待遇协同", home: "insurance.html", accountType: "manager" },
    { id: "u5", accountCode: "DEMO-CONSORTIUM-ADMIN", catalogOrder: 310, username: "county", password: "123456", name: "医共体协同管理员（演示）", role: "county", roleName: "医共体协同管理岗位", orgCode: "ORG-CONSORTIUM-ZS", orgName: "示范县域医共体", orgType: "county_consortium", orgLevel: "区县级", dataScope: "医共体成员机构与协同业务", home: "county.html", accountType: "manager" },
    { id: "u4", accountCode: "DEMO-RESIDENT", catalogOrder: 410, username: "citizen", password: "123456", phone: "DEMO-MOBILE-R1", smsCode: DEMO_SMS_CODE, name: "居民用户（演示）", role: "citizen", roleName: "居民个人岗位", orgCode: "PERSON-R1", orgName: "演示家庭账户", orgType: "citizen", orgLevel: "个人", dataScope: "本人及经授权的家庭成员", home: "citizen.html", residentId: "r1", accountId: "a1", accountType: "resident" },
    { id: "u1", accountCode: "LEGACY-WHJW", catalogOrder: 999, catalogVisible: false, legacyAliasFor: "health", username: "whjw", password: "123456", name: "卫生健康主管部门兼容账号", role: "commission", roleName: "兼容别名（不展示）", orgCode: "ORG-HEALTH-DL", orgName: "地区卫生健康主管部门", orgType: "health_admin", orgLevel: "市级", dataScope: "兼容历史自动化调用", home: "index.html", accountType: "manager" }
  ];

  const accessPolicy = window.HealthAccessPolicy;
  if (API_BASE) clearStoredBrowserCredentials();

  function readStoredSession() {
    const saved = localStorage.getItem(SESSION_KEY);
    if (!saved) return null;
    const session = JSON.parse(saved);
    return session && typeof session === "object" ? session : null;
  }

  function withoutScriptReadableCredentials(session = {}) {
    const safe = { ...session };
    SCRIPT_READABLE_CREDENTIAL_FIELDS.forEach((field) => delete safe[field]);
    return safe;
  }

  function persistBrowserSession(session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(withoutScriptReadableCredentials(session)));
  }

  function clearStoredBrowserCredentials() {
    try {
      const session = readStoredSession();
      if (!session) return;
      const safe = withoutScriptReadableCredentials(session);
      if (JSON.stringify(safe) !== JSON.stringify(session)) persistBrowserSession(safe);
    } catch (error) {
      localStorage.removeItem(SESSION_KEY);
    }
  }

  function clearBrowserSession() {
    volatileBearerToken = "";
    localStorage.removeItem(SESSION_KEY);
  }

  async function establishServerSession(payload, authMode) {
    const bearerOnly = payload.transport === "bearer";
    volatileBearerToken = bearerOnly ? String(payload.token || "") : "";
    const session = {
      ...payload.user,
      expiresAt: payload.expiresAt,
      loginAt: new Date().toISOString(),
      authMode: bearerOnly ? "server-bearer" : authMode
    };
    persistBrowserSession(session);
    const context = payload.authorizationContext;
    if (context?.user && [context.permissions, context.regionalCapabilities, context.pages, context.menus].every(Array.isArray)) {
      const established = {
        ...session,
        ...context.user,
        permissions: context.permissions,
        regionalCapabilities: context.regionalCapabilities,
        authorizedPages: context.pages,
        authorizedMenus: context.menus,
        regionalAuthorization: context.regional || null,
        policyVersion: context.policy?.version || context.policy?.schemaVersion || "",
        productionReady: context.productionReady === true,
        authContextVersion: context.version || context.schemaVersion || "auth-context-v1"
      };
      persistBrowserSession(established);
      authContextState = "ready";
      volatileBearerToken = "";
      return { ok: true, user: established };
    }
    const contextResult = await refreshAuthContext({ useBearer: bearerOnly });
    if (!contextResult.ok) {
      clearBrowserSession();
      return { ok: false, message: "授权上下文初始化失败，已阻止进入系统" };
    }
    return { ok: true, user: contextResult.user };
  }

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
          return establishServerSession(payload, "server-cookie");
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
    persistBrowserSession(session);
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
          return establishServerSession(payload, "server-cookie-phone");
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
    persistBrowserSession(session);
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
      const user = readStoredSession();
      return user && window.HealthRegionalContext ? window.HealthRegionalContext.localize(user) : user;
    } catch (error) {
      return null;
    }
  }

  function getToken() {
    return API_BASE ? volatileBearerToken : "";
  }

  function readCookie(name) {
    const prefix = `${encodeURIComponent(name)}=`;
    const row = String(document.cookie || "").split(";").map((item) => item.trim()).find((item) => item.startsWith(prefix));
    return row ? decodeURIComponent(row.slice(prefix.length)) : "";
  }

  function authHeaders(extra = {}) {
    const headers = new Headers(extra);
    const token = getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return headers;
  }

  function authFetch(url, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const headers = authHeaders(options.headers || {});
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      const csrfToken = readCookie("health_platform_csrf_v2");
      if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
    }
    return fetch(url, {
      ...options,
      credentials: options.credentials || "same-origin",
      headers
    });
  }

  async function refreshAuthContext(options = {}) {
    if (!API_BASE) return { ok: true, user: getUser(), source: "demo" };
    const useBearer = options.useBearer === true && Boolean(volatileBearerToken);
    if (!useBearer) {
      volatileBearerToken = "";
      clearStoredBrowserCredentials();
    }
    try {
      // Context hydration intentionally relies on the HttpOnly browser session.
      // A stale legacy bearer in localStorage must never override a valid cookie.
      const response = useBearer
        ? await authFetch(`${API_BASE}/auth/context`, { method: "GET" })
        : await fetch(`${API_BASE}/auth/context`, { method: "GET", credentials: "same-origin" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok || !payload.user) {
        authContextState = "failed";
        clearBrowserSession();
        return { ok: false, status: response.status };
      }
      if (![payload.permissions, payload.regionalCapabilities, payload.pages, payload.menus].every(Array.isArray)) {
        authContextState = "failed";
        clearBrowserSession();
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
        authMode: useBearer ? "server-bearer" : "server-cookie"
      };
      // The context endpoint upgrades the browser to the HttpOnly cookie session.
      // Do not keep a script-readable bearer token after that hand-off.
      persistBrowserSession(session);
      authContextState = "ready";
      return { ok: true, user: session, source: "server" };
    } catch (error) {
      authContextState = "failed";
      clearBrowserSession();
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
    clearBrowserSession();
    navigateInternal(localHref("login.html"), "assign");
  }

  function localHref(page) {
    const prefix = /\/digital-hospital-standard-platform\//.test(location.pathname) ? "../" : "./";
    return `${prefix}${String(page || "").replace(/^\.\//, "")}`;
  }

  function safeUrlPort() {
    if (!window.HealthBrowserSafeUrl) {
      const error = new Error("browser safe URL policy is unavailable");
      error.code = "SAFE_URL_POLICY_UNAVAILABLE";
      throw error;
    }
    return window.HealthBrowserSafeUrl;
  }

  function internalUrlOptions() {
    return { capability: "internal-navigation", baseUrl: location.href };
  }

  function navigateInternal(target, mode) {
    return safeUrlPort().navigate(target, { ...internalUrlOptions(), mode });
  }

  function setInternalHref(element, target) {
    return safeUrlPort().setElementUrl(element, "href", target, internalUrlOptions());
  }

  async function getLoginAccountCatalog() {
    const fallback = demoUsers
      .filter((user) => user.catalogVisible !== false)
      .map(sanitizeUser)
      .sort((left, right) => Number(left.catalogOrder || 999) - Number(right.catalogOrder || 999));
    if (!API_BASE || !isDemoMode()) return fallback;
    try {
      const response = await fetch(`${API_BASE}/auth/login-catalog`, { method: "GET", credentials: "same-origin" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok || !Array.isArray(payload.accounts)) return fallback;
      return payload.accounts.filter((user) => user?.username && user?.role && user?.home);
    } catch {
      return fallback;
    }
  }

  function ensureNavigationStyles() {
    if (!document.head || document.querySelector("#health-navigation-shell-styles")) return;
    const link = document.createElement("link");
    link.id = "health-navigation-shell-styles";
    link.rel = "stylesheet";
    setInternalHref(link, localHref("navigation-shell.css"));
    document.head.append(link);
  }

  function requireRole(roles) {
    // Legacy inline guards run in <head>. The server static guard has already
    // authenticated this request; the central policy decides after cookie hydration.
    if (API_BASE && authContextState === "pending") return true;
    const allowed = Array.isArray(roles) ? roles : [roles];
    const user = getUser();
    if (!user) {
      navigateInternal(`${localHref("login.html")}?redirect=${encodeURIComponent(currentPage())}`, "replace");
      return false;
    }
    if (user.expiresAt && new Date(user.expiresAt).getTime() < Date.now()) {
      clearBrowserSession();
      navigateInternal(`${localHref("login.html")}?redirect=${encodeURIComponent(currentPage())}&expired=1`, "replace");
      return false;
    }
    if (!allowed.includes(user.role) || !canAccessPage(currentPage(), user)) {
      const target = accessPolicy?.homeForUser(user) || "health-city.html";
      navigateInternal(`${localHref(target)}?denied=${encodeURIComponent(currentPage())}`, "replace");
      return false;
    }
    return true;
  }

  function requireAccountType(types) {
    if (API_BASE && authContextState === "pending") return true;
    const allowed = Array.isArray(types) ? types : [types];
    const user = getUser();
    if (!user) {
      navigateInternal(`${localHref("login.html")}?redirect=${encodeURIComponent(currentPage())}`, "replace");
      return false;
    }
    if (!allowed.includes(normalizeAccountType(user)) || !canAccessPage(currentPage(), user)) {
      const target = accessPolicy?.homeForUser(user) || "health-city.html";
      navigateInternal(`${localHref(target)}?denied=${encodeURIComponent(currentPage())}`, "replace");
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
    const denied = params.get("denied");
    const deniedPage = denied ? accessPolicy?.normalizePageName(denied) : "";
    const deniedQuery = deniedPage ? `?denied=${encodeURIComponent(deniedPage)}` : "";
    navigateInternal(`${localHref(target)}${deniedQuery}`, "assign");
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
      navigateInternal(`${localHref("login.html")}?redirect=${encodeURIComponent(currentPage())}`, "replace");
      return false;
    }
    const target = accessPolicy?.homeForUser(user) || "health-city.html";
    navigateInternal(`${localHref(target)}?denied=${encodeURIComponent(currentPage())}`, "replace");
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
        clearBrowserSession();
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
      if (pageName.endsWith(".html") && !canAccessPage(pageName, user)) {
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
    const shell = document.querySelector(".portal-shell, .citizen-shell, .app, .app-shell, .mini-app, .preview-shell, main");
    if (!shell || document.querySelector(".auth-bar")) return;
    const user = getUser();
    const current = accessPolicy?.normalizePageName(location.pathname) || "";
    const bar = document.createElement("aside");
    bar.className = "auth-bar navigation-sidebar";
    bar.id = "health-navigation-sidebar";
    bar.setAttribute("aria-label", "分级功能导航");

    const brand = document.createElement("div");
    brand.className = "navigation-brand";
    const brandMark = document.createElement("span");
    brandMark.className = "navigation-brand-mark";
    brandMark.setAttribute("aria-hidden", "true");
    brandMark.textContent = "健";
    const brandCopy = document.createElement("div");
    const brandTitle = document.createElement("strong");
    const brandDetail = document.createElement("span");
    brandTitle.textContent = "卫生健康信息平台";
    brandDetail.textContent = "统一功能导航";
    brandCopy.append(brandTitle, brandDetail);
    brand.append(brandMark, brandCopy);

    const identity = document.createElement("div");
    identity.className = "navigation-identity";
    const name = document.createElement("strong");
    const detail = document.createElement("span");
    identity.append(name, detail);

    const nav = document.createElement("nav");
    nav.className = "navigation-primary";
    nav.setAttribute("aria-label", "平台功能");
    const menuTree = accessPolicy?.menuTreeForUser?.(user, {}, { includeHome: true }) || [];
    const menuPages = new Set();
    const appendMenuLink = (container, item, level) => {
      const link = document.createElement("a");
      setInternalHref(link, localHref(item.page));
      link.textContent = item.label;
      link.dataset.navigationLevel = String(level);
      link.dataset.navigationPage = item.page;
      menuPages.add(item.page);
      if (item.page === current) link.setAttribute("aria-current", "page");
      container.append(link);
      (item.children || []).forEach((child) => appendMenuLink(container, child, level + 1));
    };

    menuTree.forEach((group, index) => {
      const details = document.createElement("details");
      details.className = "navigation-group";
      const containsCurrent = group.items.some((item) => item.page === current || item.children.some((child) => child.page === current));
      details.open = containsCurrent || (!current && index === 0);
      const summary = document.createElement("summary");
      summary.textContent = group.label;
      const links = document.createElement("div");
      links.className = "navigation-group-links";
      group.items.forEach((item) => appendMenuLink(links, item, 2));
      details.append(summary, links);
      nav.append(details);
    });

    if (user) {
      name.textContent = displayAuthText(user.name);
      detail.textContent = `${displayAuthText(user.roleName)} · ${displayAuthText(user.orgName || "未绑定机构")} · ${displayAuthText(user.dataScope || "默认范围")}`;
      const logoutButton = document.createElement("button");
      logoutButton.type = "button";
      logoutButton.dataset.logout = "";
      logoutButton.textContent = "退出";
      identity.append(logoutButton);
    } else {
      name.textContent = "未登录";
      detail.textContent = "登录后显示与身份匹配的完整功能";
      const loginLink = document.createElement("a");
      setInternalHref(loginLink, `${localHref("login.html")}?redirect=${encodeURIComponent(currentPage())}`);
      loginLink.textContent = "登录";
      loginLink.className = "navigation-login-link";
      identity.append(loginLink);
    }

    const localNavigation = document.createElement("div");
    localNavigation.className = "navigation-local";
    bar.append(brand, localNavigation, nav, identity);
    document.body.append(bar);
    installNavigationToggle(bar);
    relocatePageNavigation(bar, localNavigation, menuPages);
    document.documentElement.setAttribute("data-navigation-shell", "ready");
    bar.querySelector("[data-logout]")?.addEventListener("click", logout);
    filterRoleLinks();
    filterRoleFeatures();
  }

  function installNavigationToggle(sidebar) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "navigation-toggle";
    toggle.setAttribute("aria-controls", sidebar.id);
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "打开功能导航");
    toggle.textContent = "菜单";

    const scrim = document.createElement("button");
    scrim.type = "button";
    scrim.className = "navigation-scrim";
    scrim.setAttribute("aria-label", "关闭功能导航");

    const setOpen = (open) => {
      document.documentElement.setAttribute("data-navigation-open", open ? "true" : "false");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "关闭功能导航" : "打开功能导航");
    };
    toggle.addEventListener("click", () => setOpen(toggle.getAttribute("aria-expanded") !== "true"));
    scrim.addEventListener("click", () => setOpen(false));
    sidebar.addEventListener("click", (event) => {
      if (event.target.closest("a, button") && window.matchMedia("(max-width: 900px)").matches) setOpen(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") setOpen(false);
    });
    document.body.append(toggle, scrim);
  }

  function relocatePageNavigation(sidebar, localNavigation, menuPages) {
    const labels = new Map([
      ["nav", "当前工作台"],
      ["dashboard-section-nav", "驾驶舱分区"],
      ["nursing-role-nav", "护理工作台"],
      ["blood-nav", "血液业务"],
      ["top-nav", "专科切换"],
      ["service-tabs", "居民服务"],
      ["bottom-nav", "居民小程序"],
      ["nav-list", "标准平台功能"]
    ]);
    const moved = new Set();
    const moveNavigation = (source, label) => {
      if (!source || moved.has(source) || source.closest(".navigation-sidebar")) return;
      moved.add(source);
      const section = document.createElement("details");
      section.className = "navigation-local-group";
      section.open = true;
      const summary = document.createElement("summary");
      summary.textContent = label;
      section.append(summary, source);
      localNavigation.append(section);
    };

    document.querySelectorAll("body > .sidebar .nav, .dashboard-section-nav, .nursing-role-nav, .blood-nav, .top-nav, .service-tabs, .bottom-nav, .app-shell > .side-nav .nav-list").forEach((source) => {
      const matchedClass = [...labels.keys()].find((className) => source.classList.contains(className));
      moveNavigation(source, labels.get(matchedClass) || "本页功能");
    });

    document.querySelectorAll("header nav").forEach((source) => {
      if (source.closest(".navigation-sidebar")) return;
      source.querySelectorAll("a[href]").forEach((link) => {
        const page = normalizePageName(link.getAttribute("href"));
        if (page && menuPages.has(page)) {
          link.hidden = true;
          link.classList.add("navigation-duplicate-link");
        }
      });
      if (source.querySelector("a:not([hidden]), button:not([hidden])")) moveNavigation(source, "页面快捷入口");
      else source.hidden = true;
    });

    document.querySelectorAll(".citizen-header .header-actions > a[href], .topbar-actions > a[href]").forEach((link) => {
      const page = normalizePageName(link.getAttribute("href"));
      if (page && menuPages.has(page)) {
        link.hidden = true;
        link.classList.add("navigation-duplicate-link");
      }
    });

    sidebar.querySelectorAll("nav a[aria-current='page']").forEach((link) => link.closest("details")?.setAttribute("open", ""));
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
    getLoginAccountCatalog,
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

  ensureNavigationStyles();
  const startPageAccess = () => { initializePageAccess().catch(() => enforceCurrentPageAccess()); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startPageAccess);
  else startPageAccess();
})();
