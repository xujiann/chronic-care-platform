(function () {
  const SESSION_KEY = "health-city-auth-session";
  const API_BASE = isStaticPreview() ? "" : "/api";
  const demoUsers = [
    { id: "u-city", username: "city", password: "123456", name: "市级管理员", role: "commission", roleName: "市级健康城市管理", orgCode: "ORG-CITY-DL", orgName: "大连市健康城市平台", orgType: "city", orgLevel: "市级", dataScope: "全市", home: "workbench.html" },
    { id: "u-district", username: "district", password: "123456", name: "区市县管理员", role: "commission", roleName: "区市县管理端", orgCode: "ORG-DIST-ZS", orgName: "中山区健康城市平台", orgType: "district", orgLevel: "区市县", dataScope: "中山区", home: "workbench.html" },
    { id: "u-health", username: "health", password: "123456", name: "大连市卫生健康委管理员", role: "commission", roleName: "大连市卫生健康委", orgCode: "ORG-HEALTH-DL", orgName: "大连市卫生健康委", orgType: "health_admin", orgLevel: "市级", dataScope: "医疗资源、统计直报、公共卫生、分级诊疗和数据质量监管", home: "index.html" },
    { id: "u-mi", username: "mi", password: "123456", name: "大连市医保局管理员", role: "insurance", roleName: "大连市医保局管理端", orgCode: "ORG-MI-DL", orgName: "大连市医保局", orgType: "insurance_bureau", orgLevel: "市级", dataScope: "医保政策、基金监管、待遇管理和跨区县监督", home: "insurance.html" },
    { id: "u-hospital", username: "hospital", password: "123456", name: "医疗机构管理员", role: "institution", roleName: "医疗机构端", orgCode: "MR1", orgName: "大连市中心医院", orgType: "medical_institution", orgLevel: "三级医院", dataScope: "本机构", home: "institution.html" },
    { id: "u-community", username: "community", password: "123456", name: "基层机构管理员", role: "institution", roleName: "基层医疗机构端", orgCode: "MR3", orgName: "青泥洼桥社区卫生服务中心", orgType: "medical_institution", orgLevel: "基层医疗机构", dataScope: "本机构与签约居民", home: "institution.html" },
    { id: "u1", username: "whjw", password: "123456", name: "大连市卫生健康委管理员", role: "commission", roleName: "大连市卫生健康委", orgCode: "ORG-HEALTH-DL", orgName: "大连市卫生健康委", orgType: "health_admin", orgLevel: "市级", dataScope: "医疗资源、统计直报、公共卫生、分级诊疗和数据质量监管", home: "index.html" },
    { id: "u2", username: "doctor", password: "123456", name: "刘医生", role: "institution", roleName: "医生账户", orgCode: "MR3", orgName: "青泥洼桥社区卫生服务中心", orgType: "medical_institution", orgLevel: "基层医疗机构", dataScope: "签约居民、随访、长期处方、多点执业申请", home: "institution.html", doctorId: "doc-liu", accountType: "doctor" },
    { id: "u-doctor-wang", username: "doctor_wang", password: "123456", name: "王医生", role: "institution", roleName: "医生账户", orgCode: "MR1", orgName: "大连市中心医院", orgType: "medical_institution", orgLevel: "三级医院", dataScope: "本机构诊疗、转诊接诊、多点执业备案", home: "institution.html", doctorId: "doc-wang", accountType: "doctor" },
    { id: "u3", username: "insurance", password: "123456", name: "大连市医保中心审核员", role: "insurance", roleName: "大连市医保中心经办端", orgCode: "ORG-MI-CENTER-DL", orgName: "大连市医保中心", orgType: "insurance_center", orgLevel: "市级", dataScope: "医保结算经办、凭证核验、固定取药审核和经办留痕", home: "insurance.html" },
    { id: "u-mi-district", username: "district_mi", password: "123456", name: "区市县医保局管理员", role: "insurance", roleName: "区市县医保局管理端", orgCode: "ORG-MI-DIST-ZS", orgName: "中山区医保局", orgType: "district_insurance_bureau", orgLevel: "区市县", dataScope: "本区医保基金监管、机构监管和慢病待遇协同", home: "insurance.html" },
    { id: "u4", username: "citizen", password: "123456", name: "演示居民A", role: "citizen", roleName: "个人端", orgCode: "PERSON-R1", orgName: "演示居民A家庭", orgType: "citizen", orgLevel: "个人", dataScope: "本人及家庭授权成员", home: "citizen.html", residentId: "r1", accountId: "a1" },
    { id: "u5", username: "county", password: "123456", name: "医共体办公室", role: "county", roleName: "县域医共体平台", orgCode: "ORG-CONSORTIUM-ZS", orgName: "中山区县域医共体", orgType: "county_consortium", orgLevel: "区市县", dataScope: "医共体成员机构", home: "county.html" }
  ];

  const roleHome = {
    commission: "index.html",
    institution: "institution.html",
    insurance: "insurance.html",
    citizen: "citizen.html",
    county: "county.html"
  };

  const routeAccess = {
    "index.html": ["commission"],
    "health-dashboard.html": ["commission"],
    "workbench.html": ["commission"],
    "platform.html": ["commission"],
    "institution.html": ["institution"],
    "insurance.html": ["insurance"],
    "county.html": ["county"],
    "citizen.html": ["citizen"],
    "mobile-preview.html": ["citizen"],
    "health-city.html": ["commission", "institution", "insurance", "citizen", "county"],
    "login.html": ["commission", "institution", "insurance", "citizen", "county"]
  };

  const roleLinks = {
    commission: [["health-dashboard.html", "综合驾驶舱"], ["platform.html", "全民健康平台"], ["health-city.html", "总览"], ["about.html", "关于"], ["workbench.html", "工作台"], ["index.html", "卫健管理"]],
    institution: [["health-city.html", "总览"], ["about.html", "关于"], ["institution.html", "医疗机构"]],
    insurance: [["health-city.html", "总览"], ["about.html", "关于"], ["insurance.html", "医保"]],
    citizen: [["health-city.html", "总览"], ["about.html", "关于"], ["citizen.html", "个人端"], ["mobile-preview.html", "手机预览"]],
    county: [["health-city.html", "总览"], ["about.html", "关于"], ["county.html", "医共体"]]
  };

  async function login(username, password) {
    if (API_BASE) {
      try {
        const response = await fetch(`${API_BASE}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
          return { ok: true, user: session };
        }
        if (response.status === 401 || response.status === 403) {
          return { ok: false, message: payload.message || "账号或密码不正确" };
        }
      } catch (error) {
        // Static preview and offline demos fall back to local demo users.
      }
    }
    const user = demoUsers.find((item) => item.username === username && item.password === password);
    if (!user) return { ok: false, message: "账号或密码不正确" };
    const session = sanitizeUser(user);
    session.loginAt = new Date().toISOString();
    session.authMode = "local";
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return { ok: true, user: session };
  }

  function sanitizeUser(user) {
    const { password, ...safeUser } = user;
    return safeUser;
  }

  function isStaticPreview() {
    return location.protocol === "file:" || location.hostname.endsWith("github.io");
  }

  function getUser() {
    try {
      const saved = localStorage.getItem(SESSION_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch (error) {
      return null;
    }
  }

  function authHeaders(extra = {}) {
    const user = getUser();
    return user?.token ? { ...extra, Authorization: `Bearer ${user.token}` } : extra;
  }

  function authFetch(url, options = {}) {
    return fetch(url, {
      ...options,
      headers: authHeaders(options.headers || {})
    });
  }

  function logout() {
    const user = getUser();
    if (API_BASE && user?.token) {
      fetch(`${API_BASE}/auth/logout`, {
        method: "POST",
        headers: authHeaders()
      }).catch(() => {});
    }
    localStorage.removeItem(SESSION_KEY);
    window.location.href = "./login.html";
  }

  function requireRole(roles) {
    const allowed = Array.isArray(roles) ? roles : [roles];
    const user = getUser();
    if (!user) {
      window.location.replace(`./login.html?redirect=${encodeURIComponent(currentPage())}`);
      return false;
    }
    if (user.expiresAt && new Date(user.expiresAt).getTime() < Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      window.location.replace(`./login.html?redirect=${encodeURIComponent(currentPage())}&expired=1`);
      return false;
    }
    if (!allowed.includes(user.role)) {
      const target = roleHome[user.role] || "health-city.html";
      window.location.replace(`./${target}?denied=${encodeURIComponent(currentPage())}`);
      return false;
    }
    return true;
  }

  function currentPage() {
    const name = location.pathname.split("/").pop() || "health-city.html";
    return `${name}${location.search || ""}`;
  }

  function redirectAfterLogin(fallback) {
    const params = new URLSearchParams(location.search);
    const redirect = params.get("redirect") || fallback || getUser()?.home || "health-city.html";
    window.location.href = redirect.startsWith("http") ? "./health-city.html" : `./${redirect.replace(/^\.\//, "")}`;
  }

  function normalizePageName(href) {
    try {
      const url = new URL(href, location.href);
      if (url.origin !== location.origin) return "";
      return url.pathname.split("/").pop() || "health-city.html";
    } catch (error) {
      return "";
    }
  }

  function canAccessPage(pageName, user) {
    if (!pageName || pageName.startsWith("#")) return true;
    if (!user) return pageName === "login.html" || pageName === "health-city.html" || pageName === "about.html";
    if (pageName === "login.html") return false;
    const allowed = routeAccess[pageName];
    return !allowed || allowed.includes(user.role);
  }

  function filterRoleLinks() {
    if (document.body?.dataset.authPage === "login") return;
    const user = getUser();
    document.querySelectorAll("a[href]").forEach((link) => {
      const pageName = normalizePageName(link.getAttribute("href"));
      if (!canAccessPage(pageName, user)) {
        link.remove();
      }
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
      name.textContent = user.name;
      detail.textContent = `${user.roleName} · ${user.orgName || "未绑定机构"} · ${user.dataScope || "默认范围"} · ${user.authMode === "server" ? "后端会话" : "本地演示"} · ${new Date(user.loginAt || Date.now()).toLocaleString("zh-CN")}`;
      (roleLinks[user.role] || [["health-city.html", "总览"]]).forEach(([href, label]) => {
        const link = document.createElement("a");
        link.href = `./${href}`;
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
      loginLink.href = `./login.html?redirect=${encodeURIComponent(currentPage())}`;
      loginLink.textContent = "登录";
      nav.append(loginLink);
    }
    bar.append(identity, nav);
    shell.prepend(bar);
    bar.querySelector("[data-logout]")?.addEventListener("click", logout);
    filterRoleLinks();
  }

  window.HealthCityAuth = {
    demoUsers: demoUsers.map(sanitizeUser),
    login,
    logout,
    getUser,
    authHeaders,
    authFetch,
    requireRole,
    redirectAfterLogin,
    renderSessionBar,
    filterRoleLinks
  };

  document.addEventListener("DOMContentLoaded", () => {
    renderSessionBar();
    filterRoleLinks();
  });
})();
