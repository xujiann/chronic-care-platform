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
  const NAVIGATION_GROUPS = Object.freeze([
    Object.freeze({ id: "overview", label: "平台总览", groups: Object.freeze(["总览"]) }),
    Object.freeze({ id: "governance", label: "治理与监管", groups: Object.freeze(["监管治理", "平台治理"]) }),
    Object.freeze({ id: "public-health", label: "公共卫生", groups: Object.freeze(["公共卫生"]) }),
    Object.freeze({ id: "institution", label: "机构与临床", groups: Object.freeze(["机构发展", "机构工作", "临床服务"]) }),
    Object.freeze({ id: "care", label: "连续健康服务", groups: Object.freeze(["连续服务", "医共体"]) }),
    Object.freeze({ id: "payment", label: "医保支付", groups: Object.freeze(["医保支付"]) }),
    Object.freeze({ id: "resident", label: "居民服务", groups: Object.freeze(["居民服务"]) }),
    Object.freeze({ id: "other", label: "其他功能", groups: Object.freeze(["其他"]) })
  ]);

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
      group: options.group || "其他",
      parent: options.parent || ""
    });
  }

  // Every browser entry point is registered here. Unknown pages always fail closed.
  const PAGE_CATALOG = Object.freeze({
    "login.html": entry("登录", ALL_ROLES, { public: true, nav: false }),
    "about.html": entry("关于平台", ALL_ROLES, { public: true, group: "总览" }),
    "health-city.html": entry("平台总览", ALL_ROLES, { public: true, group: "总览" }),
    "index.html": entry("卫健管理", ["commission"], { group: "监管治理", accountTypes: manager }),
    "health-dashboard.html": entry("健康驾驶舱", ["commission"], { group: "监管治理", accountTypes: manager }),
    "health-dashboard-about.html": entry("驾驶舱说明", ["commission"], { nav: false, accountTypes: manager }),
    "workbench.html": entry("协同工作台", ["commission"], { group: "监管治理", accountTypes: manager }),
    "unified-work-center.html": entry("统一待办与消息", ["commission", "institution", "insurance", "county"], { group: "监管治理" }),
    "platform.html": entry("全民健康平台", ["commission"], { group: "平台治理", accountTypes: manager }),
    "account-lifecycle.html": entry("账号生命周期", ["commission"], { group: "平台治理", accountTypes: manager }),
    "operations.html": entry("运行监测", ["commission"], { group: "平台治理", accountTypes: manager }),
    "operations-about.html": entry("运行说明", ["commission"], { nav: false, accountTypes: manager }),
    "public-health.html": entry("公共卫生", ["commission"], { group: "公共卫生", accountTypes: manager, capabilities: ["publicHealth"] }),
    "public-health-highlights.html": entry("公卫亮点", ["commission"], { group: "公共卫生", parent: "public-health.html", accountTypes: manager, capabilities: ["publicHealth"] }),
    "public-health-supervision.html": entry("卫生监督闭环", ["commission", "institution"], { group: "公共卫生", parent: "public-health.html", accountTypes: manager, capabilities: ["publicHealth"] }),
    "public-health-supervision-cases.html": entry("监督案件协同", ["commission", "institution"], { group: "公共卫生", parent: "public-health-supervision.html", accountTypes: manager, capabilities: ["publicHealth"] }),
    "immunization.html": entry("免疫规划", ["commission", "institution", "citizen"], { group: "公共卫生", parent: "public-health.html", accountTypes: ["manager", "doctor", "nurse", "resident", "guardian"], capabilities: ["immunization"] }),
    "maternal-child.html": entry("妇幼健康", ["commission", "institution"], { group: "公共卫生", parent: "public-health.html", accountTypes: ["manager", "doctor", "nurse"], capabilities: ["maternalChild"] }),
    "maternal-child-about.html": entry("妇幼健康说明", ["commission", "institution", "citizen"], { nav: false, accountTypes: ["manager", "doctor", "nurse", "resident", "guardian"], capabilities: ["maternalChild"] }),
    "quality-safety.html": entry("质量安全", ["commission", "institution", "county"], { group: "监管治理", accountTypes: ["manager", "quality_officer"], capabilities: ["qualitySafety"] }),
    "quality-safety-about.html": entry("质量安全说明", ["commission", "institution", "county"], { nav: false, accountTypes: ["manager", "quality_officer"] }),
    "clinical-ai-cdss.html": entry("临床决策支持安全", ["commission", "institution"], { group: "监管治理", parent: "quality-safety.html", accountTypes: ["manager", "doctor", "quality_officer"] }),
    "digital-hospital-standards.html": entry("数智医院标准", ["commission"], { group: "机构发展", accountTypes: manager }),
    "digital-hospital-self-assessment.html": entry("医院自评", ["commission", "institution"], { group: "机构发展", parent: "digital-hospital-standards.html", accountTypes: manager }),
    "digital-hospital-evaluation.html": entry("评价预评", ["commission", "institution"], { group: "机构发展", parent: "digital-hospital-standards.html", accountTypes: manager }),
    "regional-data-sharing.html": entry("区域共享", ["commission", "institution"], { group: "平台治理", accountTypes: ["manager", "doctor"], capabilities: ["regionalSharing"] }),
    "regional-data-sharing-about.html": entry("共享说明", ["commission", "institution"], { nav: false, accountTypes: ["manager", "doctor"] }),
    "regional-clinical-documents.html": entry("区域医疗文书", ["commission", "institution"], { group: "平台治理", parent: "regional-data-sharing.html", accountTypes: ["manager", "doctor"] }),
    "institution.html": entry("医疗机构", ["institution"], { group: "机构工作", accountTypes: institutionAccounts, orgTypes: ["medical_institution"] }),
    "doctor.html": entry("医生工作站", ["institution"], { group: "机构工作", parent: "institution.html", accountTypes: ["doctor"], orgTypes: ["medical_institution"] }),
    "internet-nursing.html": entry("互联网护理", ["commission", "institution", "citizen", "county"], { group: "连续服务", accountTypes: ["manager", "doctor", "nurse", "resident", "guardian"], capabilities: ["internetNursing"] }),
    "escort.html": entry("助医陪诊", ["commission", "institution"], { group: "连续服务", accountTypes: manager, capabilities: ["escort"] }),
    "referral-teleconsultation.html": entry("转诊会诊", ["commission", "institution", "county"], { group: "连续服务", accountTypes: ["manager", "doctor", "coordinator", "clinician"], capabilities: ["referral"] }),
    "referral-teleconsultation-about.html": entry("转诊会诊说明", ["commission", "institution", "county"], { nav: false, accountTypes: ["manager", "doctor", "coordinator", "clinician"], capabilities: ["referral"] }),
    "imaging-cloud.html": entry("影像云", ["commission", "institution", "county", "citizen"], { group: "临床服务", accountTypes: ["manager", "doctor", "resident", "guardian", "coordinator", "clinician"], capabilities: ["imagingCloud"] }),
    "emergency.html": entry("急救协同", ["commission", "institution", "citizen"], { group: "临床服务", accountTypes: ["manager", "doctor", "nurse", "resident", "guardian"], capabilities: ["emergency"] }),
    "physical-examination.html": entry("健康体检", ["commission", "institution", "citizen"], { group: "临床服务", accountTypes: ["manager", "doctor", "nurse", "resident", "guardian"], capabilities: ["physicalExamination"] }),
    "physical-examination-standalone.html": entry("体检独立门户", ["institution", "citizen"], { group: "临床服务", parent: "physical-examination.html", accountTypes: ["manager", "doctor", "nurse", "resident", "guardian"], capabilities: ["physicalExamination"] }),
    "blood.html": entry("血液管理", ["commission", "institution"], { group: "临床服务", accountTypes: ["manager", "blood_quality", "blood_technologist"], capabilities: ["blood"] }),
    "blood-business.html": entry("血液业务", ["commission", "institution"], { group: "临床服务", parent: "blood.html", accountTypes: ["manager", "blood_quality", "blood_technologist"], capabilities: ["blood"] }),
    "blood-go-live.html": entry("血液上线", ["commission", "institution"], { group: "临床服务", parent: "blood.html", accountTypes: ["manager", "blood_quality", "blood_technologist"], capabilities: ["blood"] }),
    "blood-innovation.html": entry("血液创新", ["commission", "institution"], { group: "临床服务", parent: "blood.html", accountTypes: ["manager", "blood_quality", "blood_technologist"], capabilities: ["blood"] }),
    "insurance.html": entry("医保管理", ["insurance"], { group: "医保支付", accountTypes: ["manager", "reviewer", "settlement"] }),
    "medical-payment.html": entry("医疗付费一件事", ["commission", "institution", "insurance"], { group: "医保支付", parent: "insurance.html", accountTypes: ["manager", "reviewer", "settlement", "doctor"] }),
    "disease-payment.html": entry("按病种支付", ["insurance", "commission", "institution"], { group: "医保支付", parent: "insurance.html", accountTypes: ["manager", "reviewer", "settlement", "doctor"], capabilities: ["diseasePayment"] }),
    "drug-consumable.html": entry("药耗管理", ["commission", "institution", "insurance"], { group: "医保支付", accountTypes: ["manager", "reviewer", "settlement", "doctor", "pharmacist"], capabilities: ["drugConsumable"] }),
    "drug-consumable-about.html": entry("药耗管理说明", ["commission", "institution", "insurance"], { nav: false, accountTypes: ["manager", "reviewer", "settlement", "doctor", "pharmacist"], capabilities: ["drugConsumable"] }),
    "county.html": entry("县域医共体", ["county"], { group: "医共体", accountTypes: ["manager", "coordinator", "clinician"] }),
    "citizen.html": entry("居民服务", ["citizen"], { group: "居民服务", accountTypes: residentAccounts }),
    "mobile-preview.html": entry("手机预览", ["citizen"], { group: "居民服务", parent: "citizen.html", accountTypes: residentAccounts }),
    "resident-mini-program.html": entry("居民小程序", ["citizen"], { group: "居民服务", parent: "citizen.html", accountTypes: residentAccounts }),
    "research-sandbox.html": entry("科研沙箱", ["commission", "institution"], { group: "平台治理", accountTypes: manager, capabilities: ["researchSandbox"] }),
    "research-sandbox-about.html": entry("科研沙箱说明", ["commission", "institution"], { nav: false, accountTypes: manager, capabilities: ["researchSandbox"] }),
    "t10-specialty-cutover.html": entry("专科切换", ["commission", "institution", "county"], { group: "平台治理", accountTypes: manager }),
    "digital-hospital-standard-platform/index.html": entry("数智医院标准平台", ["commission", "institution"], { group: "机构发展", parent: "digital-hospital-standards.html", accountTypes: manager })
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
    const authorizedPages = normalizeSet(context.pages || context.authorizedPages || user.authorizedPages);
    if (authorizedPages !== null && !authorizedPages.has(page)) {
      return Object.freeze({ allowed: false, reason: "SERVER_PAGE_DENIED", page, policy });
    }
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
      .map(([page, policy]) => Object.freeze({ page, href: `./${page}`, label: policy.label, group: policy.group, parent: policy.parent }))
      .filter((item) => options.includeHome !== false || item.page !== homeForUser(user, context));
  }

  function menuTreeForUser(user, context = {}, options = {}) {
    const pages = pagesForUser(user, context, { ...options, includeHome: options.includeHome !== false });
    const availablePages = new Set(pages.map((item) => item.page));
    const grouped = new Map(NAVIGATION_GROUPS.map((item) => [item.id, { id: item.id, label: item.label, items: [] }]));
    const pageNodes = new Map(pages.map((item) => [item.page, { ...item, children: [] }]));

    pages.forEach((item) => {
      const node = pageNodes.get(item.page);
      if (item.parent && availablePages.has(item.parent)) {
        pageNodes.get(item.parent).children.push(node);
        return;
      }
      const definition = NAVIGATION_GROUPS.find((candidate) => candidate.groups.includes(item.group)) || NAVIGATION_GROUPS[NAVIGATION_GROUPS.length - 1];
      grouped.get(definition.id).items.push(node);
    });

    function freezeNode(node) {
      return Object.freeze({
        ...node,
        children: Object.freeze(node.children.map(freezeNode))
      });
    }

    return Object.freeze(NAVIGATION_GROUPS
      .map((definition) => grouped.get(definition.id))
      .filter((group) => group.items.length)
      .map((group) => Object.freeze({
        id: group.id,
        label: group.label,
        items: Object.freeze(group.items.map(freezeNode))
      })));
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
    navigationGroups: NAVIGATION_GROUPS,
    pageCatalog: PAGE_CATALOG,
    normalizePageName,
    normalizeAccountType,
    accessDecision,
    canAccessPage,
    canUsePermission,
    pagesForUser,
    menuTreeForUser,
    homeForUser,
    eligibleUsersForPage,
    rolesForPage
  });
});
