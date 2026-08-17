(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HealthAccessPolicy = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  const KNOWN_ROLES = Object.freeze(["commission", "institution", "insurance", "citizen", "county"]);
  const ALL_ROLES = Object.freeze([...KNOWN_ROLES]);
  const ROLE_LABELS = Object.freeze({
    commission: "卫生健康主管部门",
    institution: "医疗卫生机构",
    insurance: "医疗保障部门",
    citizen: "居民个人",
    county: "县域医共体"
  });
  const DEFAULT_HOMES = Object.freeze({
    commission: "index.html",
    institution: "institution.html",
    insurance: "insurance.html",
    citizen: "citizen.html",
    county: "county.html"
  });

  const manager = Object.freeze(["manager"]);
  const institutionAccounts = Object.freeze(["manager", "doctor", "nurse", "blood_technologist"]);
  const residentAccounts = Object.freeze(["resident", "guardian"]);

  function entry(label, roles, options = {}) {
    return Object.freeze({
      label,
      roles: Object.freeze([...(roles || [])]),
      public: Boolean(options.public),
      nav: options.nav !== false,
      accountTypes: Object.freeze([...(options.accountTypes || [])]),
      orgTypes: Object.freeze([...(options.orgTypes || [])]),
      permissions: Object.freeze([...(options.permissions || [])]),
      capabilities: Object.freeze([...(options.capabilities || [])]),
      group: options.group || "其他"
    });
  }

  // Every browser entry point is registered here. Unknown pages always fail closed.
  const PAGE_CATALOG = Object.freeze({
    "login.html": entry("登录", ALL_ROLES, { public: true, nav: false }),
    "about.html": entry("关于平台", ALL_ROLES, { public: true, nav: false }),
    "health-city.html": entry("平台总览", ALL_ROLES, { public: true, group: "总览" }),
    "index.html": entry("卫健管理", ["commission"], { group: "监管治理" }),
    "health-dashboard.html": entry("健康驾驶舱", ["commission"], { group: "监管治理" }),
    "health-dashboard-about.html": entry("驾驶舱说明", ["commission"], { nav: false }),
    "workbench.html": entry("协同工作台", ["commission"], { group: "监管治理" }),
    "platform.html": entry("全民健康平台", ["commission"], { group: "平台治理" }),
    "operations.html": entry("运行监测", ["commission"], { group: "平台治理" }),
    "operations-about.html": entry("运行说明", ["commission"], { nav: false }),
    "public-health.html": entry("公共卫生", ["commission"], { group: "公共卫生", capabilities: ["publicHealth"] }),
    "public-health-highlights.html": entry("公卫亮点", ["commission"], { group: "公共卫生", capabilities: ["publicHealth"] }),
    "immunization.html": entry("免疫规划", ["commission", "institution"], { group: "公共卫生", capabilities: ["immunization"] }),
    "maternal-child-about.html": entry("妇幼健康", ["commission", "institution", "citizen"], { nav: false, capabilities: ["maternalChild"] }),
    "quality-safety.html": entry("质量安全", ["commission", "institution", "county"], { group: "监管治理", capabilities: ["qualitySafety"] }),
    "quality-safety-about.html": entry("质量安全说明", ["commission", "institution", "county"], { nav: false }),
    "digital-hospital-standards.html": entry("数智医院标准", ["commission"], { group: "机构发展" }),
    "digital-hospital-self-assessment.html": entry("医院自评", ["commission", "institution"], { group: "机构发展" }),
    "digital-hospital-evaluation.html": entry("评价预评", ["commission", "institution"], { group: "机构发展" }),
    "regional-data-sharing.html": entry("区域共享", ["commission", "institution"], { group: "平台治理", capabilities: ["regionalSharing"] }),
    "regional-data-sharing-about.html": entry("共享说明", ["commission", "institution"], { nav: false }),
    "institution.html": entry("医疗机构", ["institution"], { group: "机构工作", accountTypes: institutionAccounts, orgTypes: ["medical_institution"] }),
    "doctor.html": entry("医生工作站", ["institution"], { group: "机构工作", accountTypes: ["doctor"], orgTypes: ["medical_institution"] }),
    "internet-nursing.html": entry("互联网护理", ["commission", "institution", "citizen", "county"], { group: "连续服务", capabilities: ["internetNursing"] }),
    "escort.html": entry("助医陪诊", ["commission", "institution"], { group: "连续服务", capabilities: ["escort"] }),
    "referral-teleconsultation-about.html": entry("转诊会诊", ["commission", "institution", "county"], { nav: false, capabilities: ["referral"] }),
    "imaging-cloud.html": entry("影像云", ["commission", "institution", "county", "citizen"], { group: "临床服务", capabilities: ["imagingCloud"] }),
    "emergency.html": entry("急救协同", ["commission", "institution", "county"], { group: "临床服务", capabilities: ["emergency"] }),
    "physical-examination.html": entry("健康体检", ["commission", "institution", "citizen"], { group: "临床服务", capabilities: ["physicalExamination"] }),
    "physical-examination-standalone.html": entry("体检独立门户", ["institution", "citizen"], { group: "临床服务", capabilities: ["physicalExamination"] }),
    "blood.html": entry("血液管理", ["commission", "institution"], { group: "临床服务", capabilities: ["blood"] }),
    "blood-business.html": entry("血液业务", ["commission", "institution"], { group: "临床服务", capabilities: ["blood"] }),
    "blood-go-live.html": entry("血液上线", ["commission", "institution"], { group: "临床服务", capabilities: ["blood"] }),
    "blood-innovation.html": entry("血液创新", ["commission", "institution"], { group: "临床服务", capabilities: ["blood"] }),
    "insurance.html": entry("医保管理", ["insurance"], { group: "医保支付" }),
    "disease-payment.html": entry("按病种支付", ["insurance", "institution"], { group: "医保支付", capabilities: ["diseasePayment"] }),
    "drug-consumable-about.html": entry("药耗管理", ["commission", "institution", "insurance"], { nav: false, capabilities: ["drugConsumable"] }),
    "county.html": entry("县域医共体", ["county"], { group: "医共体" }),
    "citizen.html": entry("居民服务", ["citizen"], { group: "居民服务", accountTypes: residentAccounts }),
    "mobile-preview.html": entry("手机预览", ["citizen"], { group: "居民服务", accountTypes: residentAccounts }),
    "resident-mini-program.html": entry("居民小程序", ["citizen"], { group: "居民服务", accountTypes: residentAccounts }),
    "research-sandbox-about.html": entry("科研沙箱", ["commission", "institution"], { nav: false, capabilities: ["researchSandbox"] }),
    "t10-specialty-cutover.html": entry("专科切换", ["commission", "institution"], { group: "平台治理" }),
    "digital-hospital-standard-platform/index.html": entry("数智医院标准平台", ["commission", "institution"], { group: "机构发展" })
  });

  function normalizePageName(value) {
    const raw = String(value || "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
    if (!raw) return "health-city.html";
    const withoutHash = raw.split("#")[0].split("?")[0];
    if (withoutHash.endsWith("digital-hospital-standard-platform/")) return "digital-hospital-standard-platform/index.html";
    const nested = withoutHash.match(/digital-hospital-standard-platform\/index\.html$/);
    if (nested) return nested[0];
    return withoutHash.split("/").pop() || "health-city.html";
  }

  function normalizeAccountType(user = {}) {
    const explicit = String(user.accountType || "").trim().toLowerCase();
    const aliases = { citizen: "resident", family_proxy: "guardian", family_proxy_guardian: "guardian", proxy: "guardian" };
    if (explicit) return aliases[explicit] || explicit;
    if (user.doctorId) return "doctor";
    if (user.nurseId) return "nurse";
    if (user.role === "citizen") return "resident";
    if (KNOWN_ROLES.includes(user.role)) return "manager";
    return "";
  }

  function normalizeSet(value) {
    if (!Array.isArray(value)) return null;
    return new Set(value.map((item) => String(item)));
  }

  function hasAll(required, available) {
    if (!required.length || available === null) return true;
    return required.every((item) => available.has(item));
  }

  function accessDecision(pageValue, user, context = {}) {
    const page = normalizePageName(pageValue);
    const policy = PAGE_CATALOG[page];
    if (!policy) return Object.freeze({ allowed: false, reason: "PAGE_NOT_REGISTERED", page });
    if (!user) return Object.freeze({ allowed: policy.public, reason: policy.public ? "PUBLIC_PAGE" : "LOGIN_REQUIRED", page, policy });
    const role = String(user.role || "").trim();
    if (!KNOWN_ROLES.includes(role)) return Object.freeze({ allowed: false, reason: "UNKNOWN_ROLE", page, policy });
    if (page === "login.html") return Object.freeze({ allowed: false, reason: "ALREADY_AUTHENTICATED", page, policy });
    if (!policy.roles.includes(role)) return Object.freeze({ allowed: false, reason: "ROLE_DENIED", page, policy });
    const accountType = normalizeAccountType(user);
    if (policy.accountTypes.length && !policy.accountTypes.includes(accountType)) {
      return Object.freeze({ allowed: false, reason: "ACCOUNT_TYPE_DENIED", page, policy });
    }
    if (policy.orgTypes.length && !policy.orgTypes.includes(String(user.orgType || ""))) {
      return Object.freeze({ allowed: false, reason: "ORGANIZATION_TYPE_DENIED", page, policy });
    }
    const permissions = normalizeSet(context.permissions || user.permissions);
    if (!hasAll(policy.permissions, permissions)) return Object.freeze({ allowed: false, reason: "PERMISSION_DENIED", page, policy });
    const capabilities = normalizeSet(context.regionalCapabilities || context.capabilities || user.regionalCapabilities);
    if (!hasAll(policy.capabilities, capabilities)) return Object.freeze({ allowed: false, reason: "REGIONAL_CAPABILITY_DISABLED", page, policy });
    return Object.freeze({ allowed: true, reason: "AUTHORIZED", page, policy });
  }

  function canAccessPage(page, user, context) {
    return accessDecision(page, user, context).allowed;
  }

  function pagesForUser(user, context = {}, options = {}) {
    return Object.entries(PAGE_CATALOG)
      .filter(([page, policy]) => policy.nav && canAccessPage(page, user, context))
      .map(([page, policy]) => Object.freeze({ page, href: `./${page}`, label: policy.label, group: policy.group }))
      .filter((item) => options.includeHome !== false || item.page !== homeForUser(user, context));
  }

  function homeForUser(user, context = {}) {
    if (!user || !KNOWN_ROLES.includes(user.role)) return "health-city.html";
    const preferred = normalizePageName(user.home || DEFAULT_HOMES[user.role]);
    if (canAccessPage(preferred, user, context)) return preferred;
    const first = pagesForUser(user, context, { includeHome: true })[0];
    return first?.page || "health-city.html";
  }

  function eligibleUsersForPage(page, users, context = {}) {
    return (Array.isArray(users) ? users : []).filter((user) => canAccessPage(page, user, context));
  }

  function rolesForPage(page) {
    const policy = PAGE_CATALOG[normalizePageName(page)];
    return policy ? [...policy.roles] : [];
  }

  function canUsePermission(permission, user, context = {}) {
    if (!user || !KNOWN_ROLES.includes(user.role) || !String(permission || "").trim()) return false;
    const permissions = normalizeSet(context.permissions || user.permissions);
    return permissions !== null && permissions.has(String(permission));
  }

  return Object.freeze({
    knownRoles: KNOWN_ROLES,
    roleLabels: ROLE_LABELS,
    defaultHomes: DEFAULT_HOMES,
    pageCatalog: PAGE_CATALOG,
    normalizePageName,
    normalizeAccountType,
    accessDecision,
    canAccessPage,
    canUsePermission,
    pagesForUser,
    homeForUser,
    eligibleUsersForPage,
    rolesForPage
  });
});
