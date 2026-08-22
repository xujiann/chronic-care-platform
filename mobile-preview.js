const frame = document.querySelector("#citizen-preview-frame");
const serviceButtons = document.querySelectorAll("[data-preview-service]");
const clientButtons = document.querySelectorAll("[data-preview-client]");
const previewParams = new URLSearchParams(location.search);
const previewLocalUrl = document.querySelector("#preview-local-url");
const previewLanUrl = document.querySelector("#preview-lan-url");
const previewStatus = document.querySelector("#preview-status");
const previewHandoffCard = document.querySelector("#preview-handoff-card");
const previewDirectEntry = document.querySelector("#preview-direct-entry");
const previewBirthEntry = document.querySelector("#preview-birth-entry");
const previewCopyEntry = document.querySelector("#preview-copy-entry");
const previewCopySummary = document.querySelector("#preview-copy-summary");
const previewEntryUrl = document.querySelector("#preview-entry-url");
const previewAcceptanceSummary = document.querySelector("#preview-acceptance-summary");
const previewCompactToggle = document.querySelector("#preview-compact-toggle");
const previewToolbar = document.querySelector(".preview-toolbar");
const previewDevice = document.querySelector(".preview-device");
const previewServiceSelect = document.querySelector("#preview-service-select");
const previewPrevService = document.querySelector("#preview-prev-service");
const previewNextService = document.querySelector("#preview-next-service");
const previewServicePosition = document.querySelector("#preview-service-position");
const previewServiceProgress = document.querySelector("#preview-service-progress");
const previewReadinessClient = document.querySelector("#preview-readiness-client");
const previewReadinessService = document.querySelector("#preview-readiness-service");
const previewReadinessFrame = document.querySelector("#preview-readiness-frame");
const previewReadinessLink = document.querySelector("#preview-readiness-link");
const previewReadinessSummary = document.querySelector("#preview-readiness-summary");
const previewReadinessMethod = document.querySelector("#preview-readiness-method");
const phoneFrame = document.querySelector(".phone-frame");
const previewServices = [...serviceButtons].map((button) => button.dataset.previewService);
const previewServiceLabels = {
  "health-record": "健康档案",
  emr: "电子病历",
  nursing: "护理",
  escort: "陪诊",
  registration: "挂号"
};
const previewClientLabels = {
  "mini-program": "小程序",
  app: "手机应用"
};
const previewServiceMeta = {
  "health-record": { status: "已实现", count: 7, boundary: "生产需接入主索引、公卫档案和居民实名关系核验" },
  emr: { status: "已实现", count: 5, boundary: "生产需接入 EMR/LIS/PACS 和文档存储授权" },
  nursing: { status: "已实现", count: 3, boundary: "生产需补齐护士资质、电子签名、定位轨迹和长护险接入" },
  escort: { status: "已实现", count: 2, boundary: "生产需对接医院接诊回执、保险保障和服务主体监管" },
  registration: { status: "已实现", count: 3, boundary: "生产需替换真实 HIS 号源、支付、医保电子凭证和短信网关" }
};
const copyTextWithFallback = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
};
const requestedPreviewService = previewParams.get("service") || previewParams.get("page");
let activePreviewService = previewServices.includes(requestedPreviewService) ? requestedPreviewService : "health-record";
let activePreviewClient = ["mini-program", "app"].includes(previewParams.get("client")) ? previewParams.get("client") : "mini-program";
const requestedCompactPreview = previewParams.get("compact");
let isCompactPreview = requestedCompactPreview === "1";
let touchStartX = 0;
let touchStartY = 0;
const previewSwipeTargets = new WeakSet();
function citizenPreviewSrc(service) {
  return `./citizen.html?preview=mobile-nav&client=${activePreviewClient}&page=${service}&launch=1#service-${service}`;
}
function birthHealthPreviewSrc() {
  return `./citizen.html?preview=mobile-nav&client=${activePreviewClient}&page=health-record&launch=1#birth-health-summary-strip`;
}
function activePreviewServicePosition() {
  const activeIndex = Math.max(0, previewServices.indexOf(activePreviewService));
  return { activeIndex, label: `${activeIndex + 1}/${previewServices.length} 个服务` };
}
function alignFocusPreview() {
  if (!isCompactPreview) return;
  window.requestAnimationFrame(() => {
    const targetTop = previewDevice.getBoundingClientRect().top + window.scrollY - 12;
    window.scrollTo({ top: Math.max(0, targetTop), left: 0, behavior: "auto" });
  });
}
const renderPreviewDirectEntry = () => {
  const entryUrl = citizenPreviewSrc(activePreviewService);
  const absoluteEntryUrl = new URL(entryUrl, location.href).href;
  const birthEntryUrl = birthHealthPreviewSrc();
  window.HealthBrowserSafeUrl.setElementUrl(previewBirthEntry, "href", birthEntryUrl, {
    capability: "internal-navigation",
    baseUrl: location.href
  });
  previewBirthEntry.dataset.previewEntry = new URL(birthEntryUrl, location.href).href;
  previewBirthEntry.textContent = `${previewClientLabels[activePreviewClient]} · 出生健康直达`;
  previewBirthEntry.setAttribute("aria-label", previewBirthEntry.textContent);
  window.HealthBrowserSafeUrl.setElementUrl(previewDirectEntry, "href", entryUrl, {
    capability: "internal-navigation",
    baseUrl: location.href
  });
  previewEntryUrl.value = absoluteEntryUrl;
  previewCopyEntry.dataset.previewEntry = absoluteEntryUrl;
  previewCopyEntry.textContent = "复制入口";
  previewCopySummary.textContent = "复制验收摘要";
  previewAcceptanceSummary.value = previewAcceptanceSummaryText();
  previewAcceptanceSummary.classList.remove("is-visible");
  previewDirectEntry.textContent = isCompactPreview ? "打开当前页" : `打开${previewClientLabels[activePreviewClient]} · ${previewServiceLabels[activePreviewService]}`;
  previewReadinessLink.textContent = "入口：当前与出生健康已同步";
};
const previewAcceptanceSummaryText = () => {
  const servicePosition = activePreviewServicePosition();
  const entryUrl = previewCopyEntry.dataset.previewEntry || new URL(citizenPreviewSrc(activePreviewService), location.href).href;
  const meta = previewServiceMeta[activePreviewService];
  return [
    "居民端手机验收摘要",
    `端型：${previewClientLabels[activePreviewClient]}`,
    `服务：${previewServiceLabels[activePreviewService]}（${servicePosition.label}）`,
    `状态：${meta.status}，${meta.count}项已实现能力`,
    `入口：${entryUrl}`,
    "登录：DEMO-MOBILE-R1 / 888888",
    "验收方式：点击、方向键、滑动、复制入口",
    `生产化提示：${meta.boundary}`,
    "上线材料：手机预览已带 launch=1，可显示 P0 材料、责任方和验收口径"
  ].join("\n");
};
const renderPreviewHandoffCard = () => {
  const servicePosition = activePreviewServicePosition();
  const meta = previewServiceMeta[activePreviewService];
  const entryUrl = previewCopyEntry.dataset.previewEntry || new URL(citizenPreviewSrc(activePreviewService), location.href).href;
  previewHandoffCard.innerHTML = `
    <strong>${previewServiceLabels[activePreviewService]}</strong>
    <span>${previewClientLabels[activePreviewClient]} · ${servicePosition.label} · ${meta.status}</span>
    <small>${meta.count}项已实现能力；${meta.boundary}</small>
    <code>${entryUrl}</code>
  `;
};
const renderPreviewReadiness = () => {
  const servicePosition = activePreviewServicePosition();
  const meta = previewServiceMeta[activePreviewService];
  previewReadinessClient.textContent = `端型：${previewClientLabels[activePreviewClient]}`;
  previewReadinessService.textContent = `服务：${previewServiceLabels[activePreviewService]}（${servicePosition.label}，${meta.status}）`;
  previewReadinessSummary.textContent = `验收摘要：${previewClientLabels[activePreviewClient]} · ${previewServiceLabels[activePreviewService]} · ${servicePosition.label} · ${isCompactPreview ? "精简" : "完整"}`;
  renderPreviewHandoffCard();
};
const renderPreviewStatus = () => {
  previewStatus.textContent = isCompactPreview
    ? `${previewClientLabels[activePreviewClient]} · 390px 手机视口`
    : `${previewClientLabels[activePreviewClient]} · ${previewServiceLabels[activePreviewService]} · 390px 手机视口`;
  renderPreviewDirectEntry();
  renderPreviewReadiness();
};
const syncPreviewServiceControls = () => {
  serviceButtons.forEach((button) => button.classList.toggle("active", button.dataset.previewService === activePreviewService));
  previewServiceSelect.value = activePreviewService;
  const { activeIndex, label: servicePositionLabel } = activePreviewServicePosition();
  const previousService = previewServices[activeIndex - 1];
  const nextService = previewServices[activeIndex + 1];
  previewServicePosition.textContent = servicePositionLabel;
  previewServicePosition.setAttribute("aria-label", `当前第 ${activeIndex + 1} 个服务，共 ${previewServices.length} 个`);
  previewServiceProgress.innerHTML = previewServices
    .map((service, index) => `<button type="button" class="${service === activePreviewService ? "active" : ""}" data-preview-progress="${service}" aria-label="切换到${previewServiceLabels[service]}，第 ${index + 1} 个服务">${index + 1}</button>`)
    .join("");
  previewPrevService.disabled = activeIndex <= 0;
  previewNextService.disabled = activeIndex >= previewServices.length - 1;
  previewPrevService.textContent = previousService ? `上一个：${previewServiceLabels[previousService]}` : "上一个";
  previewNextService.textContent = nextService ? `下一个：${previewServiceLabels[nextService]}` : "下一个";
  previewPrevService.setAttribute("aria-label", previousService ? `切换到${previewServiceLabels[previousService]}` : "已经是第一个服务");
  previewNextService.setAttribute("aria-label", nextService ? `切换到${previewServiceLabels[nextService]}` : "已经是最后一个服务");
  previewPrevService.title = previousService ? `切换到${previewServiceLabels[previousService]}` : "已经是第一个服务";
  previewNextService.title = nextService ? `切换到${previewServiceLabels[nextService]}` : "已经是最后一个服务";
};
const stepPreviewService = (offset) => {
  const activeIndex = previewServices.indexOf(activePreviewService);
  const nextIndex = Math.min(previewServices.length - 1, Math.max(0, activeIndex + offset));
  if (nextIndex !== activeIndex) setPreviewService(previewServices[nextIndex]);
};
const handlePreviewSwipe = (event) => {
  const touch = event.changedTouches?.[0];
  if (!touch) return;
  const deltaX = touch.clientX - touchStartX;
  const deltaY = touch.clientY - touchStartY;
  if (Math.abs(deltaX) < 54 || Math.abs(deltaX) < Math.abs(deltaY) * 1.4) return;
  stepPreviewService(deltaX < 0 ? 1 : -1);
};
const recordPreviewSwipeStart = (event) => {
  const touch = event.changedTouches?.[0];
  if (!touch) return;
  touchStartX = touch.clientX;
  touchStartY = touch.clientY;
};
const bindPreviewSwipeTarget = (target) => {
  if (!target || previewSwipeTargets.has(target)) return;
  previewSwipeTargets.add(target);
  target.addEventListener("touchstart", recordPreviewSwipeStart, { passive: true });
  target.addEventListener("touchend", handlePreviewSwipe, { passive: true });
};
const renderPreviewUrls = () => {
  const previewPort = location.port ? `:${location.port}` : "";
  const previewPath = `${location.pathname}${location.search}`;
  previewLocalUrl.textContent = `${location.origin}${previewPath}`;
  previewLanUrl.textContent = `${location.protocol}//本机局域网IP${previewPort}${previewPath}`;
};
const syncPreviewUrl = () => {
  const params = new URLSearchParams(location.search);
  params.set("client", activePreviewClient);
  params.set("service", activePreviewService);
  params.set("page", activePreviewService);
  params.set("compact", isCompactPreview ? "1" : "0");
  history.replaceState({ previewClient: activePreviewClient, previewService: activePreviewService }, "", `${location.pathname}?${params.toString()}`);
  renderPreviewUrls();
  renderPreviewStatus();
};
const renderCompactPreview = () => {
  document.body.classList.toggle("preview-focus-mode", isCompactPreview);
  previewToolbar.classList.toggle("compact", isCompactPreview);
  previewCompactToggle.setAttribute("aria-pressed", String(isCompactPreview));
  previewCompactToggle.textContent = isCompactPreview ? "完整预览" : "精简预览";
  previewCompactToggle.setAttribute("aria-label", isCompactPreview ? "退出手机验收模式" : "进入手机验收模式");
  alignFocusPreview();
};
const setPreviewService = (service, options = {}) => {
  activePreviewService = service;
  syncPreviewServiceControls();
  if (options.syncUrl !== false) syncPreviewUrl();
  if (options.syncUrl === false) renderPreviewStatus();
  if (options.reload !== false) {
    previewReadinessFrame.textContent = "手机框：加载中";
    window.HealthBrowserSafeUrl.setElementUrl(frame, "src", citizenPreviewSrc(service), {
      capability: "internal-navigation",
      baseUrl: location.href
    });
  }
};
const setPreviewClient = (client, options = {}) => {
  activePreviewClient = client;
  clientButtons.forEach((button) => button.classList.toggle("active", button.dataset.previewClient === client));
  if (options.syncUrl !== false) {
    syncPreviewUrl();
  }
  if (options.syncUrl === false) renderPreviewStatus();
  setPreviewService(activePreviewService, { syncUrl: false });
};
frame.addEventListener("load", () => {
  previewReadinessFrame.textContent = "手机框：已加载";
  try {
    bindPreviewSwipeTarget(frame.contentDocument);
    bindPreviewSwipeTarget(frame.contentDocument?.body);
    previewReadinessFrame.textContent = "手机框：已加载，滑动切换已启用";
  } catch (error) {
    previewReadinessFrame.textContent = "手机框：已加载，滑动切换请使用手机框外层";
  }
  frame.contentWindow?.postMessage({ type: "set-service-tab", service: activePreviewService }, location.origin);
});
window.addEventListener("message", (event) => {
  if (event.origin !== location.origin || event.source !== frame.contentWindow || event.data?.type !== "citizen-service-changed") return;
  if (!previewServices.includes(event.data.service)) return;
  setPreviewService(event.data.service, { reload: false });
});
serviceButtons.forEach((button) => {
  button.addEventListener("click", () => setPreviewService(button.dataset.previewService));
});
previewServiceProgress.addEventListener("click", (event) => {
  const service = event.target?.dataset?.previewProgress;
  if (previewServices.includes(service)) setPreviewService(service);
});
previewServiceSelect.addEventListener("change", () => setPreviewService(previewServiceSelect.value));
previewPrevService.addEventListener("click", () => stepPreviewService(-1));
previewNextService.addEventListener("click", () => stepPreviewService(1));
bindPreviewSwipeTarget(phoneFrame);
window.addEventListener("keydown", (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (["INPUT", "SELECT", "TEXTAREA"].includes(event.target?.tagName)) return;
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    stepPreviewService(-1);
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    stepPreviewService(1);
  }
});
clientButtons.forEach((button) => {
  button.addEventListener("click", () => setPreviewClient(button.dataset.previewClient));
});
document.querySelector("#preview-refresh").addEventListener("click", () => {
  previewReadinessFrame.textContent = "手机框：加载中";
  window.HealthBrowserSafeUrl.setElementUrl(frame, "src", frame.getAttribute("src") || citizenPreviewSrc(activePreviewService), {
    capability: "internal-navigation",
    baseUrl: location.href
  });
});
previewCompactToggle.addEventListener("click", () => {
  isCompactPreview = !isCompactPreview;
  renderCompactPreview();
  syncPreviewUrl();
});
previewCopyEntry.addEventListener("click", async () => {
  const entryUrl = previewCopyEntry.dataset.previewEntry || previewDirectEntry.href;
  const copied = await copyTextWithFallback(entryUrl);
  if (copied) {
    previewCopyEntry.textContent = "已复制";
    previewReadinessLink.textContent = "入口：已复制";
  } else {
    previewCopyEntry.textContent = "手动复制";
    previewEntryUrl.focus();
    previewEntryUrl.select();
    previewStatus.textContent = `请手动复制：${entryUrl}`;
    previewReadinessLink.textContent = "入口：需手动复制";
  }
});
previewCopySummary.addEventListener("click", async () => {
  const summaryText = previewAcceptanceSummaryText();
  previewAcceptanceSummary.value = summaryText;
  previewAcceptanceSummary.classList.add("is-visible");
  const copied = await copyTextWithFallback(summaryText);
  if (copied) {
    previewCopySummary.textContent = "摘要已复制";
    previewReadinessMethod.textContent = "验收方式：摘要已复制，可粘贴到现场工单";
  } else {
    previewCopySummary.textContent = "手动复制摘要";
    previewAcceptanceSummary.focus();
    previewAcceptanceSummary.select();
    previewStatus.textContent = "请手动复制验收摘要";
    previewReadinessMethod.textContent = "验收方式：请手动复制当前入口和验收摘要";
  }
});
renderPreviewUrls();
renderCompactPreview();
setPreviewClient(activePreviewClient, { syncUrl: false });
