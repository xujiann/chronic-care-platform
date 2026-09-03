(function (root) {
  "use strict";

  const auth = root.HealthCityAuth;
  const policy = root.HealthAccessPolicy;
  if (!auth || !policy) return;

  const byId = (id) => document.getElementById(id);
  const demoMode = auth.isDemoMode();
  const params = new URLSearchParams(location.search);
  const requestedPage = policy.normalizePageName(params.get("redirect") || "");
  const requestedPolicy = policy.pageCatalog[requestedPage];
  let allAccounts = (auth.demoUsers || []).filter((user) => user.catalogVisible !== false);
  let accounts = requestedPolicy && requestedPage !== "health-city.html"
    ? policy.eligibleUsersForPage(requestedPage, allAccounts)
    : allAccounts;
  let selectedRole = accounts[0]?.role || "";
  let selectedUsername = accounts[0]?.username || "";
  let phoneCodeTimer = 0;

  function escapeText(value) {
    return String(value || "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    })[character]);
  }

  function accountTypeLabel(user) {
    const labels = {
      manager: "管理岗位", doctor: "医生", nurse: "护士", pharmacist: "药师", technician: "医技人员",
      blood_technologist: "输血技师", blood_quality: "血液质控", reviewer: "经办审核",
      settlement: "结算经办", coordinator: "协同岗位", clinician: "临床岗位", resident: "居民", guardian: "监护代办"
    };
    return labels[policy.normalizeAccountType(user)] || user.roleName || "授权岗位";
  }

  function renderRequestedScope() {
    const note = byId("login-scope-note");
    if (!requestedPage || requestedPage === "health-city.html") return;
    note.hidden = false;
    if (!requestedPolicy) {
      note.innerHTML = "<strong>目标功能未登记</strong><span>该页面不在平台授权清单中，登录后不会跳转，系统将进入当前身份首页。</span>";
      return;
    }
    const labels = policy.rolesForPage(requestedPage).map((role) => policy.roleLabels[role]).join("、");
    note.innerHTML = `<strong>申请进入：${escapeText(requestedPolicy.label)}</strong><span>允许身份：${escapeText(labels || "无")}。不符合条件的账号不会显示，也不能通过直链绕过。</span>`;
  }

  function renderIdentityTypes() {
    const roles = [...new Set(accounts.map((user) => user.role))];
    byId("identity-type-grid").innerHTML = roles.map((role) => {
      const count = accounts.filter((user) => user.role === role).length;
      return `<button type="button" role="tab" data-identity-role="${escapeText(role)}" aria-selected="${role === selectedRole}"><strong>${escapeText(policy.roleLabels[role] || role)}</strong><span>${count} 个可用岗位</span></button>`;
    }).join("");
    document.querySelectorAll("[data-identity-role]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedRole = button.dataset.identityRole;
        selectedUsername = accounts.find((user) => user.role === selectedRole)?.username || "";
        renderIdentityTypes();
        renderAccountCards();
        selectAccount(selectedUsername);
      });
    });
  }

  function renderAccountCards() {
    const roleAccounts = accounts.filter((user) => user.role === selectedRole);
    byId("demo-accounts").innerHTML = roleAccounts.map((user) => {
      const functionCount = policy.pagesForUser(user, {}, { includeHome: true }).length;
      return `<button type="button" data-user="${escapeText(user.username)}" aria-pressed="${user.username === selectedUsername}"><strong>${escapeText(accountTypeLabel(user))}</strong><span>${escapeText(user.roleName)}</span><small>${escapeText(user.orgName || "未绑定机构")} · ${escapeText(user.username)}</small><em>${functionCount} 项授权功能</em></button>`;
    }).join("");
    document.querySelectorAll("[data-user]").forEach((button) => button.addEventListener("click", () => selectAccount(button.dataset.user)));
  }

  function renderAccessPreview(user) {
    const preview = byId("login-access-preview");
    if (!user) { preview.hidden = true; return; }
    preview.hidden = false;
    byId("access-preview-role").textContent = `${policy.roleLabels[user.role]} · ${accountTypeLabel(user)}`;
    byId("access-preview-organization").textContent = `所属机构：${user.orgName || "未绑定机构"}`;
    byId("access-preview-scope").textContent = `数据范围：${user.dataScope || "未授予"}`;
    const pages = policy.pagesForUser(user, {}, { includeHome: true });
    const visiblePages = pages.slice(0, 12);
    const home = policy.pageCatalog[policy.homeForUser(user)]?.label || "身份首页";
    const groups = new Set(pages.map((item) => item.group));
    byId("access-preview-summary").textContent = `共 ${pages.length} 项功能 · ${groups.size} 个功能分组 · 首页：${home}`;
    byId("access-preview-functions").innerHTML = visiblePages.length
      ? `${visiblePages.map((item) => `<span>${escapeText(item.label)}</span>`).join("")}${pages.length > visiblePages.length ? `<span>还有 ${pages.length - visiblePages.length} 项</span>` : ""}`
      : "<em>该账号没有可用业务功能</em>";
  }

  function selectAccount(username) {
    const user = accounts.find((item) => item.username === username);
    if (!user) return;
    selectedUsername = user.username;
    selectedRole = user.role;
    byId("login-user").value = user.username;
    byId("login-password").value = "123456";
    if (user.phone) byId("login-phone").value = user.phone;
    document.querySelectorAll("[data-user]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.user === user.username)));
    renderAccessPreview(user);
  }

  function configureMode() {
    byId("login-environment-banner").hidden = !demoMode;
    byId("login-mode-label").textContent = demoMode ? "本地演示 · 非生产" : "正式身份认证";
    byId("identity-selector").hidden = !demoMode;
    byId("demo-account-field").hidden = !demoMode;
    byId("formal-account-field").hidden = demoMode;
    byId("login-username").required = !demoMode;
    byId("login-user").required = demoMode;
    byId("account-login-hint").textContent = demoMode
      ? "演示账号统一密码为 123456，仅用于本地样例环境。"
      : "请使用所属机构分配的实名账号登录；本页面不会展示测试账号或统一密码。";
    byId("phone-code-hint").textContent = demoMode
      ? "演示居民验证码为 888888，仅用于本地样例环境。"
      : "验证码仅发送至已完成实名绑定的手机号。";
    if (demoMode) {
      renderAccountCatalog();
      auth.getLoginAccountCatalog().then((catalog) => {
        if (!Array.isArray(catalog) || !catalog.length) return;
        allAccounts = catalog;
        accounts = requestedPolicy && requestedPage !== "health-city.html"
          ? policy.eligibleUsersForPage(requestedPage, allAccounts)
          : allAccounts;
        selectedRole = accounts.some((user) => user.role === selectedRole) ? selectedRole : (accounts[0]?.role || "");
        selectedUsername = accounts.some((user) => user.username === selectedUsername)
          ? selectedUsername
          : (accounts.find((user) => user.role === selectedRole)?.username || accounts[0]?.username || "");
        renderAccountCatalog();
      });
    }
  }

  function renderAccountCatalog() {
    byId("login-user").innerHTML = accounts.map((user) => `<option value="${escapeText(user.username)}">${escapeText(user.roleName)} · ${escapeText(user.orgName || user.name)} · ${escapeText(user.username)}</option>`).join("");
    renderIdentityTypes();
    renderAccountCards();
    selectAccount(selectedUsername);
  }

  function setPhoneCodeCooldown(seconds) {
    const button = document.querySelector("[data-send-phone-code]");
    clearInterval(phoneCodeTimer);
    let remaining = Number(seconds || 0);
    const render = () => {
      button.disabled = remaining > 0;
      button.textContent = remaining > 0 ? `${remaining--}秒` : "获取验证码";
      if (remaining < 0) clearInterval(phoneCodeTimer);
    };
    render();
    phoneCodeTimer = setInterval(render, 1000);
  }

  document.querySelectorAll("[data-login-method]").forEach((button) => button.addEventListener("click", () => {
    const phone = button.dataset.loginMethod === "phone";
    document.querySelectorAll("[data-login-method]").forEach((item) => {
      item.classList.toggle("active", item === button);
      item.setAttribute("aria-selected", String(item === button));
    });
    byId("login-form").hidden = phone;
    byId("phone-login-form").hidden = !phone;
  }));

  byId("login-user").addEventListener("change", (event) => selectAccount(event.target.value));
  document.querySelector("[data-send-phone-code]").addEventListener("click", async () => {
    const result = await auth.sendPhoneCode(byId("login-phone").value);
    byId("phone-code-hint").textContent = result.ok ? `验证码已发送至 ${result.phone || byId("login-phone").value}。` : (result.message || "验证码发送失败");
    if (demoMode && result.demoCode) byId("login-phone-code").value = result.demoCode;
    setPhoneCodeCooldown(result.retryAfterSeconds || (result.ok ? 60 : 5));
  });

  byId("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type=submit]");
    const username = demoMode ? byId("login-user").value : byId("login-username").value.trim();
    button.disabled = true;
    button.textContent = "正在核验身份";
    const result = await auth.login(username, byId("login-password").value);
    button.disabled = false;
    button.textContent = "安全登录";
    if (!result.ok) { byId("login-error").textContent = result.message || "登录失败"; return; }
    if (requestedPage && !policy.canAccessPage(requestedPage, result.user)) byId("login-error").textContent = "当前身份无权进入目标功能，已转到授权首页。";
    auth.redirectAfterLogin(result.user.home);
  });

  byId("phone-login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await auth.loginByPhone(byId("login-phone").value, byId("login-phone-code").value);
    if (!result.ok) { byId("phone-login-error").textContent = result.message || "登录失败"; return; }
    auth.redirectAfterLogin(result.user.home);
  });

  renderRequestedScope();
  configureMode();
  // Avoid an expected anonymous 401 probe on a fresh login page. Existing
  // browser sessions still refresh and return to their authorized home.
  if (auth.getUser()) {
    auth.refreshAuthContext().then((result) => {
      if (result.ok && result.source === "server" && result.user) auth.redirectAfterLogin(result.user.home);
    });
  }
})(typeof globalThis === "object" ? globalThis : this);
