(function () {
  const SESSION_KEY = "health-city-auth-session";
  const API_BASE = location.protocol === "file:" ? "" : "/api";
  const demoUsers = [
    { id: "u1", username: "whjw", password: "123456", name: "卫健委管理员", role: "commission", roleName: "卫生健康委端", home: "index.html" },
    { id: "u2", username: "doctor", password: "123456", name: "刘医生", role: "institution", roleName: "医疗机构端", home: "institution.html" },
    { id: "u3", username: "insurance", password: "123456", name: "医保审核员", role: "insurance", roleName: "医保端", home: "insurance.html" },
    { id: "u4", username: "citizen", password: "123456", name: "王建国", role: "citizen", roleName: "个人端", home: "citizen.html", residentId: "r1", accountId: "a1" },
    { id: "u5", username: "county", password: "123456", name: "医共体办公室", role: "county", roleName: "县域医共体平台", home: "county.html" }
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
        return { ok: false, message: payload.message || "账号或密码不正确" };
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
          <span>${user.roleName} · ${user.authMode === "server" ? "后端会话" : "本地演示"} · ${new Date(user.loginAt || Date.now()).toLocaleString("zh-CN")}</span>
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
