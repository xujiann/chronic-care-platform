(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HealthPlatformIdentityGovernanceUi = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  const ROLE_LABELS = Object.freeze({
    commission: "卫生健康主管部门",
    institution: "医疗卫生机构",
    insurance: "医疗保障部门",
    county: "县域医共体",
    citizen: "居民个人"
  });
  const ACCOUNT_TYPE_LABELS = Object.freeze({
    manager: "管理岗位",
    reviewer: "审核岗位",
    doctor: "医生岗位",
    nurse: "护士岗位",
    blood_quality: "血液质控岗位",
    blood_technologist: "输血技术岗位",
    resident: "居民账号",
    guardian: "监护代理账号"
  });
  const ACTIVE_STATES = new Set(["active", "enabled", "启用"]);
  const state = { query: "", role: "all", status: "all" };

  function value(input) {
    return String(input ?? "").trim();
  }

  function normalizedAccountType(account, policy) {
    return value(policy?.normalizeAccountType?.(account) || account.accountType || "");
  }

  function hasExternalIdentity(account) {
    if (value(account.externalIssuer) && value(account.externalSubject)) return true;
    return (Array.isArray(account.externalIdentities) ? account.externalIdentities : [])
      .some((identity) => value(identity?.issuer || identity?.externalIssuer) && value(identity?.subject || identity?.externalSubject));
  }

  function isEnabled(account) {
    return ACTIVE_STATES.has(value(account.status || "enabled").toLowerCase());
  }

  function assignedPages(account, policy) {
    if (!policy?.pagesForUser) return [];
    try {
      return policy.pagesForUser(account, {}, { includeHome: true }) || [];
    } catch {
      return [];
    }
  }

  function accountRisks(account, policy, pages, enabled, externalBound) {
    const risks = [];
    if (!enabled) risks.push("账号已停用");
    if (!value(account.accountCode)) risks.push("账号编码待补");
    if (account.role !== "citizen" && !value(account.orgCode)) risks.push("机构待绑定");
    if (enabled && !externalBound) risks.push("外部身份待绑定");
    if (account.catalogVisible === false) risks.push("兼容账号不展示");
    const preferredHome = policy?.normalizePageName?.(account.home);
    const effectiveHome = policy?.homeForUser?.(account);
    if (preferredHome && effectiveHome && preferredHome !== effectiveHome) risks.push("默认首页需复核");
    if (enabled && pages.length === 0) risks.push("未分配可访问功能");
    return risks;
  }

  function buildView(accounts, policy) {
    const rows = (Array.isArray(accounts) ? accounts : []).map((account) => {
      const pages = assignedPages(account, policy);
      const groups = new Set(pages.map((page) => value(page.group)).filter(Boolean));
      const enabled = isEnabled(account);
      const externalBound = hasExternalIdentity(account);
      const accountType = normalizedAccountType(account, policy);
      const risks = accountRisks(account, policy, pages, enabled, externalBound);
      const home = value(policy?.homeForUser?.(account) || account.home || "-");
      return Object.freeze({
        id: value(account.id || account.accountCode || account.username),
        accountCode: value(account.accountCode || "未编码"),
        username: value(account.username || "-"),
        name: value(account.name || "未命名账号"),
        role: value(account.role),
        roleLabel: value(account.roleName || ROLE_LABELS[account.role] || "未知角色"),
        accountType,
        accountTypeLabel: ACCOUNT_TYPE_LABELS[accountType] || accountType || "账号类型待补",
        orgCode: value(account.orgCode || "-"),
        orgName: value(account.orgName || "未绑定机构"),
        dataScope: value(account.dataScope || "数据范围待配置"),
        home,
        enabled,
        catalogVisible: account.catalogVisible !== false,
        externalBound,
        functionCount: enabled ? pages.length : 0,
        assignedFunctionCount: pages.length,
        groupCount: groups.size,
        risks
      });
    }).sort((left, right) => left.accountCode.localeCompare(right.accountCode, "zh-CN"));
    return Object.freeze({
      schemaVersion: "identity-account-governance-view-v1",
      summary: Object.freeze({
        total: rows.length,
        enabled: rows.filter((row) => row.enabled).length,
        disabled: rows.filter((row) => !row.enabled).length,
        externalBound: rows.filter((row) => row.externalBound).length,
        mappingReady: rows.filter((row) => row.enabled && row.assignedFunctionCount > 0).length,
        reviewRequired: rows.filter((row) => row.risks.length > 0).length
      }),
      accounts: Object.freeze(rows),
      productionReady: false,
      boundary: "账号台账用于核对岗位、机构、数据范围和功能映射；生产开通、提权、停用及外部身份绑定仍须独立审批和审计。"
    });
  }

  function element(documentRef, tagName, className, textContent) {
    const node = documentRef.createElement(tagName);
    if (className) node.className = className;
    if (textContent !== undefined) node.textContent = value(textContent);
    return node;
  }

  function metricCard(documentRef, label, amount, hint) {
    const card = element(documentRef, "article", "metric-card");
    card.append(
      element(documentRef, "span", "", label),
      element(documentRef, "strong", "", amount),
      element(documentRef, "small", "", hint)
    );
    return card;
  }

  function matches(row) {
    const query = state.query.toLocaleLowerCase("zh-CN");
    const searchable = [row.accountCode, row.username, row.name, row.roleLabel, row.accountTypeLabel, row.orgCode, row.orgName, row.dataScope]
      .join(" ").toLocaleLowerCase("zh-CN");
    if (query && !searchable.includes(query)) return false;
    if (state.role !== "all" && row.role !== state.role) return false;
    if (state.status === "enabled" && !row.enabled) return false;
    if (state.status === "disabled" && row.enabled) return false;
    if (state.status === "external-unbound" && (!row.enabled || row.externalBound)) return false;
    if (state.status === "review" && row.risks.length === 0) return false;
    return true;
  }

  function accountCard(documentRef, row, index) {
    const card = element(documentRef, "article", "priority-row identity-account-row");
    card.dataset.identityAccount = row.id;
    const rank = element(documentRef, "div", `priority-rank ${row.enabled ? "ok" : "danger"}`, index + 1);
    const main = element(documentRef, "div", "identity-account-main");
    main.append(
      element(documentRef, "h3", "", `${row.name} · ${row.accountCode}`),
      element(documentRef, "p", "", `${row.username} · ${row.roleLabel} · ${row.accountTypeLabel}`),
      element(documentRef, "small", "", `${row.orgName}（${row.orgCode}）`),
      element(documentRef, "small", "identity-account-scope", row.dataScope)
    );
    if (row.risks.length) {
      const risks = element(documentRef, "div", "identity-account-risks");
      row.risks.forEach((risk) => risks.append(element(documentRef, "span", "badge warn", risk)));
      main.append(risks);
    }
    const side = element(documentRef, "div", "capability-side identity-account-side");
    side.append(
      element(documentRef, "span", `badge ${row.enabled ? "info" : "danger"}`, row.enabled ? "启用" : "停用"),
      element(documentRef, "strong", "", `${row.functionCount} 项功能 · ${row.groupCount} 组`),
      element(documentRef, "small", "", `默认首页：${row.home}`),
      element(documentRef, "small", "", row.externalBound ? "外部身份已绑定" : "外部身份待绑定")
    );
    card.append(rank, main, side);
    return card;
  }

  function bindFilters(documentRef, rerender) {
    const search = documentRef.querySelector("#identity-account-search");
    const role = documentRef.querySelector("#identity-account-role-filter");
    const status = documentRef.querySelector("#identity-account-status-filter");
    [search, role, status].forEach((control) => {
      if (!control || control.dataset.identityGovernanceBound === "true") return;
      control.dataset.identityGovernanceBound = "true";
      control.addEventListener("input", () => {
        state.query = value(search?.value);
        state.role = value(role?.value || "all");
        state.status = value(status?.value || "all");
        rerender();
      });
      control.addEventListener("change", () => {
        state.query = value(search?.value);
        state.role = value(role?.value || "all");
        state.status = value(status?.value || "all");
        rerender();
      });
    });
  }

  function render(accounts, options = {}) {
    const documentRef = options.document || document;
    const policy = options.policy || globalThis.HealthAccessPolicy;
    const summaryTarget = documentRef.querySelector("#identity-account-summary");
    const listTarget = documentRef.querySelector("#identity-account-list");
    const statusTarget = documentRef.querySelector("#identity-account-filter-status");
    const boundaryTarget = documentRef.querySelector("#identity-account-boundary");
    if (!summaryTarget || !listTarget || !statusTarget) return null;
    const view = buildView(accounts, policy);
    const filtered = view.accounts.filter(matches);
    summaryTarget.replaceChildren(
      metricCard(documentRef, "账号总数", view.summary.total, `${view.summary.enabled} 个启用，${view.summary.disabled} 个停用`),
      metricCard(documentRef, "权限映射", `${view.summary.mappingReady}/${view.summary.enabled}`, "启用账号均须具备可访问功能"),
      metricCard(documentRef, "外部身份", `${view.summary.externalBound}/${view.summary.enabled}`, "仅显示绑定状态，不显示身份标识"),
      metricCard(documentRef, "待复核", view.summary.reviewRequired, "包含身份待绑定、停用和配置缺项")
    );
    listTarget.replaceChildren(...filtered.map((row, index) => accountCard(documentRef, row, index)));
    if (!filtered.length) listTarget.append(element(documentRef, "p", "muted identity-account-empty", "当前筛选条件下没有账号。"));
    statusTarget.textContent = `当前显示 ${filtered.length}/${view.summary.total} 个账号`;
    if (boundaryTarget) boundaryTarget.textContent = view.boundary;
    bindFilters(documentRef, () => render(accounts, options));
    return view;
  }

  return Object.freeze({ buildView, render });
});
