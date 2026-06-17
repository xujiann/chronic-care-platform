(function () {
  const SESSION_KEY = "health-city-auth-session";
  const API_BASE = isStaticPreview() ? "" : "/api";
  const demoUsers = [
    { id: "u-city", username: "city", password: "123456", name: "市级管理员", role: "commission", roleName: "市级健康城市管理", orgCode: "ORG-CITY-DL", orgName: "大连市健康城市平台", orgType: "city", orgLevel: "市级", dataScope: "全市", home: "workbench.html" },
    { id: "u-district", username: "district", password: "123456", name: "区市县管理员", role: "commission", roleName: "区市县管理端", orgCode: "ORG-DIST-ZS", orgName: "中山区健康城市平台", orgType: "district", orgLevel: "区市县", dataScope: "中山区", home: "workbench.html" },
    { id: "u-health", username: "health", password: "123456", name: "卫健行政管理员", role: "commission", roleName: "卫生健康行政部门", orgCode: "ORG-HEALTH-DL", orgName: "大连市卫生健康委", orgType: "health_admin", orgLevel: "市级", dataScope: "卫生健康行政管理", home: "index.html" },
    { id: "u-mi", username: "mi", password: "123456", name: "医保局管理员", role: "insurance", roleName: "医保局管理端", orgCode: "ORG-MI-DL", orgName: "大连市医保局", orgType: "insurance_bureau", orgLevel: "市级", dataScope: "医保结算与基金监管", home: "insurance.html" },
    { id: "u-hospital", username: "hospital", password: "123456", name: "医疗机构管理员", role: "institution", roleName: "医疗机构端", orgCode: "MR1", orgName: "大连市中心医院", orgType: "medical_institution", orgLevel: "三级医院", dataScope: "本机构", home: "institution.html" },
    { id: "u-community", username: "community", password: "123456", name: "基层机构管理员", role: "institution", roleName: "基层医疗机构端", orgCode: "MR3", orgName: "青泥洼桥社区卫生服务中心", orgType: "medical_institution", orgLevel: "基层医疗机构", dataScope: "本机构与签约居民", home: "institution.html" },
    { id: "u1", username: "whjw", password: "123456", name: "卫健委管理员", role: "commission", roleName: "卫生健康委端", orgCode: "ORG-HEALTH-DL", orgName: "大连市卫生健康委", orgType: "health_admin", orgLevel: "市级", dataScope: "全市", home: "index.html" },
    { id: "u2", username: "doctor", password: "123456", name: "刘医生", role: "institution", roleName: "医疗机构端", orgCode: "MR3", orgName: "青泥洼桥社区卫生服务中心", orgType: "medical_institution", orgLevel: "基层医疗机构", dataScope: "签约居民", home: "institution.html" },
    { id: "u3", username: "insurance", password: "123456", name: "医保审核员", role: "insurance", roleName: "医保端", orgCode: "ORG-MI-DL", orgName: "大连市医保局", orgType: "insurance_bureau", orgLevel: "市级", dataScope: "医保审核", home: "insurance.html" },
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
    if (!allowed.includes(user.role) && user.role !== "commission") {
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

  function renderSessionBar() {
    if (document.body?.dataset.authPage === "login") return;
    const shell = document.querySelector(".portal-shell, .citizen-shell, .app");
    if (!shell || document.querySelector(".auth-bar")) return;
    const user = getUser();
    const bar = document.createElement("section");
    bar.className = "auth-bar";
    if (user) {
      bar.innerHTML = `
        <div>
          <strong>${user.name}</strong>
          <span>${user.roleName} · ${user.orgName || "未绑定机构"} · ${user.dataScope || "默认范围"} · ${user.authMode === "server" ? "后端会话" : "本地演示"} · ${new Date(user.loginAt || Date.now()).toLocaleString("zh-CN")}</span>
        </div>
        <nav>
          <a href="./health-city.html">总览</a>
          <a href="./workbench.html">工作台</a>
          <a href="./index.html">卫健委</a>
          <a href="./institution.html">医疗机构</a>
          <a href="./insurance.html">医保</a>
          <a href="./county.html">医共体</a>
          <a href="./citizen.html">个人</a>
          <button type="button" data-logout>退出</button>
        </nav>`;
    } else {
      bar.innerHTML = `
        <div>
          <strong>未登录</strong>
          <span>请先选择角色进入健康城市系统</span>
        </div>
        <nav><a href="./login.html?redirect=${encodeURIComponent(currentPage())}">登录</a></nav>`;
    }
    shell.prepend(bar);
    bar.querySelector("[data-logout]")?.addEventListener("click", logout);
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
    renderSessionBar
  };

  document.addEventListener("DOMContentLoaded", renderSessionBar);
})();
