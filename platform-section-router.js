(function initPlatformSectionRouter(root) {
  "use strict";

  const HASH_PREFIX = "#platform-view=";
  const DEFAULT_VIEW = "overview";
  const CATEGORIES = Object.freeze([
    Object.freeze({ key: "overview", label: "建设总览" }),
    Object.freeze({ key: "requirements", label: "需求治理" }),
    Object.freeze({ key: "identity", label: "身份账号" }),
    Object.freeze({ key: "operations", label: "数据与运行" }),
    Object.freeze({ key: "release", label: "安全与发布" }),
    Object.freeze({ key: "evidence", label: "证据报告" }),
    Object.freeze({ key: "all", label: "显示全部" })
  ]);
  const CATEGORY_KEYS = new Set(CATEGORIES.map((item) => item.key));
  const ID_CATEGORIES = Object.freeze({
    "platform-metrics": "overview",
    "platform-capability-map-panel": "overview",
    "platform-productization-panel": "overview",
    "platform-procurement-governance-center": "requirements",
    "identity-lifecycle-center": "identity",
    "regional-cutover-workbench-panel": "operations",
    "platform-standards-ledgers-panel": "operations",
    "platform-capability-operations-center": "operations",
    "financial-gateway-operations-center": "operations",
    "production-database-cutover-center": "operations",
    "citizen-operations-center": "operations",
    "platform-go-live-slices-panel": "release",
    "commercial-crypto-center": "release",
    "production-security-acceptance": "release",
    "production-go-no-go-center": "release",
    "pilot-acceptance-center": "release"
  });
  const TITLE_CATEGORIES = new Map([
    ["建设范围", "overview"],
    ["存量整合", "overview"],
    ["统一应用目录", "overview"],
    ["开发批次", "overview"],
    ["医院互联互通管理职能", "requirements"],
    ["接口衔接清单", "operations"],
    ["同源数据", "operations"],
    ["数据治理底座", "operations"],
    ["二期数据与服务目录", "operations"],
    ["二期最小联调样板", "operations"],
    ["二期慢病报病协同", "operations"],
    ["二期临床治疗辅助", "operations"],
    ["二期家庭医生签约监管", "operations"],
    ["医疗机构信用评价", "operations"],
    ["安全信创验收台账", "release"],
    ["P0 生产部署路径", "release"],
    ["科研数据集与专病库治理", "evidence"],
    ["移动适老化与无障碍", "evidence"],
    ["验收证据库", "evidence"],
    ["最近维护记录", "evidence"],
    ["周报素材", "evidence"]
  ]);
  const state = { active: DEFAULT_VIEW, mounted: false, sections: [], buttons: new Map(), announcement: null };

  function parseHash(value = root.location?.hash || "") {
    const text = String(value || "");
    if (!text.startsWith(HASH_PREFIX)) return DEFAULT_VIEW;
    try {
      const key = decodeURIComponent(text.slice(HASH_PREFIX.length));
      return CATEGORY_KEYS.has(key) ? key : DEFAULT_VIEW;
    } catch {
      return DEFAULT_VIEW;
    }
  }

  function classifySection(section) {
    if (ID_CATEGORIES[section?.id]) return ID_CATEGORIES[section.id];
    const title = String(section?.querySelector?.("h2")?.textContent || "").trim();
    return TITLE_CATEGORIES.get(title) || "evidence";
  }

  function updateHash(key) {
    const next = `${HASH_PREFIX}${encodeURIComponent(key)}`;
    if (root.location?.hash === next) return;
    if (root.history?.pushState) root.history.pushState(null, "", next);
    else if (root.location) root.location.hash = next;
  }

  function activate(key, options = {}) {
    const selected = CATEGORY_KEYS.has(key) ? key : DEFAULT_VIEW;
    state.active = selected;
    for (const entry of state.sections) {
      const hidden = selected !== "all" && entry.category !== selected;
      if (hidden) entry.element.setAttribute("data-platform-view-hidden", "true");
      else entry.element.removeAttribute("data-platform-view-hidden");
    }
    for (const [buttonKey, button] of state.buttons) {
      const current = buttonKey === selected;
      button.setAttribute("aria-pressed", current ? "true" : "false");
      button.tabIndex = current ? 0 : -1;
      button.classList.toggle("is-active", current);
    }
    const category = CATEGORIES.find((item) => item.key === selected);
    if (state.announcement) state.announcement.textContent = selected === "all" ? "已显示全部平台功能区。" : `已切换到${category?.label || "建设总览"}任务视图。`;
    if (options.updateHash !== false) updateHash(selected);
    return selected;
  }

  function moveFocus(currentKey, command) {
    const keys = CATEGORIES.map((item) => item.key);
    const currentIndex = Math.max(0, keys.indexOf(currentKey));
    const nextIndex = command === "Home" ? 0 : command === "End" ? keys.length - 1 : command === "ArrowLeft" ? (currentIndex - 1 + keys.length) % keys.length : (currentIndex + 1) % keys.length;
    state.buttons.get(keys[nextIndex])?.focus();
  }

  function createRouter(documentRef) {
    const wrapper = documentRef.createElement("section");
    wrapper.id = "platform-section-router";
    wrapper.className = "platform-section-router";
    wrapper.setAttribute("aria-labelledby", "platform-section-router-title");
    const heading = documentRef.createElement("div");
    heading.className = "platform-section-router-heading";
    const title = documentRef.createElement("h2");
    title.id = "platform-section-router-title";
    title.textContent = "平台任务视图";
    const description = documentRef.createElement("p");
    description.textContent = "按工作目标切换功能区；业务区块标识、数据加载和操作流程保持不变。";
    heading.append(title, description);
    const tabs = documentRef.createElement("div");
    tabs.className = "platform-section-router-tabs";
    tabs.setAttribute("role", "toolbar");
    tabs.setAttribute("aria-label", "平台任务视图分类");
    CATEGORIES.forEach((category) => {
      const button = documentRef.createElement("button");
      button.type = "button";
      button.className = "platform-section-router-button";
      button.dataset.platformView = category.key;
      button.textContent = category.label;
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => activate(category.key));
      button.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        moveFocus(category.key, event.key);
      });
      state.buttons.set(category.key, button);
      tabs.append(button);
    });
    const announcement = documentRef.createElement("p");
    announcement.className = "platform-section-router-announcement";
    announcement.setAttribute("aria-live", "polite");
    state.announcement = announcement;
    wrapper.append(heading, tabs, announcement);
    return wrapper;
  }

  function mount(documentRef = root.document) {
    if (!documentRef || state.mounted) return state.mounted;
    const header = documentRef.querySelector("main.portal-shell > .portal-header");
    const sections = [...documentRef.querySelectorAll("main.portal-shell > section")].filter((section) => section.id !== "platform-section-router");
    if (!header || !sections.length || !header.parentNode) return false;
    state.sections = sections.map((section) => {
      const category = classifySection(section);
      section.dataset.platformViewCategory = category;
      return Object.freeze({ element: section, category });
    });
    const router = createRouter(documentRef);
    header.parentNode.insertBefore(router, header.nextSibling);
    state.mounted = true;
    activate(parseHash(), { updateHash: false });
    root.addEventListener?.("hashchange", () => activate(parseHash(), { updateHash: false }));
    root.addEventListener?.("popstate", () => activate(parseHash(), { updateHash: false }));
    documentRef.documentElement?.setAttribute("data-platform-section-router", "ready");
    return true;
  }

  root.HealthPlatformSectionRouter = Object.freeze({ CATEGORIES, activate, classifySection, mount, parseHash });
  if (root.document?.readyState === "loading") root.document.addEventListener("DOMContentLoaded", () => mount(), { once: true });
  else mount();
})(typeof globalThis === "object" ? globalThis : this);
