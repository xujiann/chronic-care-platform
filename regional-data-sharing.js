const regionalState = {
  data: null,
  selectedPackageId: "",
  feedback: "",
  lastReviewId: "",
  filters: {
    status: "",
    keyword: ""
  }
};

const collectionLabels = {
  residents: "居民主索引",
  personalRecords: "个人健康档案",
  diagnosticReports: "诊断检查报告",
  countyMutualRecognitionRecords: "县域互认记录",
  integrationContracts: "接口契约",
  hospitalInteroperabilityFunctions: "院内互联功能",
  platformEvidence: "平台证据",
  dataAccessLogs: "访问日志",
  securityEvents: "安全事件",
  followups: "随访记录",
  integrationGatewayEvents: "接口网关事件"
};

const contractLabels = {
  "his-patient-v1": "HIS 就诊信息",
  "emr-summary-v1": "EMR 病历摘要",
  "lis-report-v1": "LIS 检验报告",
  "pacs-report-v1": "PACS 影像报告"
};

const decisionLabels = {
  approved: "已调阅",
  denied: "暂不调阅"
};

const consentLabels = {
  active: "授权有效",
  pending: "授权待确认",
  revoked: "授权已撤销"
};

const qualityLabels = {
  passed: "质控通过",
  manual_review: "人工复核",
  failed: "质控未通过"
};

const recordTypeLabels = {
  diagnosticReports: "诊断报告",
  personalRecords: "健康档案",
  countyMutualRecognitionRecords: "互认记录"
};

document.addEventListener("DOMContentLoaded", () => {
  document.querySelector("#regional-status-filter")?.addEventListener("change", (event) => {
    regionalState.filters.status = event.target.value;
    renderRegionalSharing();
  });
  document.querySelector("#regional-keyword-filter")?.addEventListener("input", (event) => {
    regionalState.filters.keyword = event.target.value.trim().toLowerCase();
    renderRegionalSharing();
  });
  document.querySelector("#regional-access-form")?.addEventListener("submit", submitRegionalAccessReview);
  document.querySelector("#regional-sharing-packages")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-package-id]");
    if (!button) return;
    selectRegionalPackage(button.dataset.packageId);
  });
  loadRegionalSharing();
});

async function loadRegionalSharing() {
  const response = await regionalAuthFetch("/api/regional-data-sharing");
  if (!response.ok) {
    document.querySelector("#regional-sharing-packages").innerHTML = `<div class="muted">区域共享数据加载失败。</div>`;
    return;
  }
  regionalState.data = await response.json();
  const packages = regionalState.data.packages || [];
  if (!regionalState.selectedPackageId && packages.length) {
    regionalState.selectedPackageId = packages[0].id;
  }
  renderRegionalSharing();
}

function renderRegionalSharing() {
  const data = regionalState.data;
  if (!data) return;
  const packages = data.packages || [];
  renderRegionalMetrics(data.summary || {});
  renderRegionalLoop(data.summary || {});
  renderRegionalBoundary(data.scope || {});
  renderRegionalSnapshots(data.snapshots || {});
  renderRegionalPackages(packages);
  renderSelectedPackage(packages);
  renderRegionalReadinessChecklist(packages);
  renderRegionalReferralHandoff(packages, data.accessReviews || []);
  renderAccessFeedback();
  renderRegionalReviews(data.accessReviews || []);
  fillPackageOptions(packages);
}

function renderRegionalMetrics(summary) {
  const items = [
    ["共享包", summary.totalPackages],
    ["可共享", summary.ready],
    ["待复核", summary.pendingReview],
    ["机构数", summary.institutions],
    ["接口契约", summary.contracts],
    ["调阅留痕", summary.accessReviews]
  ];
  document.querySelector("#regional-sharing-metrics").innerHTML = items.map(([label, value]) => `
    <article>
      <strong>${value ?? 0}</strong>
      <span>${label}</span>
    </article>
  `).join("");
}

function renderRegionalLoop(summary = {}) {
  const ready = summary.ready || 0;
  const total = summary.totalPackages || 0;
  const pending = summary.pendingReview || 0;
  const reviews = summary.accessReviews || 0;
  const complete = total > 0 && ready > 0 && reviews > 0;
  const steps = [
    { label: "共享包编目", value: total, done: total > 0 },
    { label: "授权可调阅", value: ready, done: ready > 0 },
    { label: "待复核处置", value: pending, done: pending === 0 },
    { label: "调阅留痕", value: reviews, done: reviews > 0 }
  ];
  document.querySelector("#regional-loop-summary").textContent = complete ? "已形成闭环" : "持续治理中";
  document.querySelector("#regional-sharing-loop").innerHTML = steps.map((step, index) => `
    <article class="${step.done ? "is-done" : ""}">
      <span>${index + 1}</span>
      <strong>${step.label}</strong>
      <small>${step.value ?? 0}</small>
    </article>
  `).join("");
}

function renderRegionalBoundary(scope) {
  const boundary = scope.boundary || [];
  const exclusions = scope.exclusions || [];
  const reused = scope.reusedCollections || [];
  document.querySelector("#regional-sharing-scope").textContent = `${boundary.length} 项范围 / ${exclusions.length} 项不做事项`;
  document.querySelector("#regional-sharing-boundary").innerHTML = [
    sectionList("业务范围", boundary),
    sectionList("不做事项", exclusions),
    sectionList("复用集合", reused.map(labelCollection))
  ].join("");
}

function renderRegionalSnapshots(snapshot) {
  const fields = Object.entries(snapshot.fields || {});
  const statuses = Object.entries(snapshot.statusNorms || {});
  document.querySelector("#regional-sharing-snapshots").innerHTML = [
    `<h3>字段</h3>`,
    ...fields.map(([key, value]) => `<p><strong>${fieldLabel(key)}</strong><span>${value}</span></p>`),
    `<h3>状态</h3>`,
    ...statuses.map(([key, value]) => `<p><strong>${statusLabel(key)}</strong><span>${value}</span></p>`)
  ].join("");
}

function renderRegionalPackages(packages) {
  const filtered = packages.filter(matchesPackageFilters);
  document.querySelector("#regional-sharing-packages").innerHTML = filtered.map((item) => `
    <div class="priority-row ${item.id === regionalState.selectedPackageId ? "is-selected" : ""}">
      <span class="badge ${badgeClass(item.status)}">${statusLabel(item.status)}</span>
      <div>
        <strong>${item.title}</strong>
        <p>${item.resident?.name || item.residentId} · ${item.sourceInstitution} → ${(item.targetInstitutions || []).join("、")}</p>
        <p>${(item.contracts || []).map((contract) => contractLabels[contract.id] || contract.id).join(" / ")} · ${evidenceText(item.evidenceCounts)}</p>
        <p>${(item.latestRecords || []).map((record) => `${recordTypeLabels[record.type] || record.type}：${record.name || record.id}`).join("；") || "暂无记录摘要"}</p>
      </div>
      <div class="capability-side">
        <small>${consentLabel(item.consentStatus)}</small>
        <small>${item.lastSharedAt ? new Date(item.lastSharedAt).toLocaleString("zh-CN", { hour12: false }) : "待共享"}</small>
        <button class="inline-action" type="button" data-package-id="${item.id}">调阅</button>
      </div>
    </div>
  `).join("") || `<div class="muted">没有符合条件的共享包。</div>`;
}

function renderSelectedPackage(packages) {
  const packageItem = packages.find((item) => item.id === regionalState.selectedPackageId) || packages[0];
  const panel = document.querySelector("#regional-selected-package");
  const status = document.querySelector("#regional-selected-package-status");
  if (!packageItem) {
    status.textContent = "";
    panel.innerHTML = `<div class="muted">暂无可调阅共享包。</div>`;
    return;
  }
  status.textContent = statusLabel(packageItem.status);
  panel.innerHTML = [
    `<h3>${packageItem.title}</h3>`,
    `<p><strong>居民</strong><span>${packageItem.resident?.name || packageItem.residentId}</span></p>`,
    `<p><strong>来源机构</strong><span>${packageItem.sourceInstitution || packageItem.sourceOrgCode}</span></p>`,
    `<p><strong>接收机构</strong><span>${(packageItem.targetInstitutions || packageItem.targetOrgCodes || []).join("、")}</span></p>`,
    `<p><strong>共享集合</strong><span>${(packageItem.sharedCollections || []).map(labelCollection).join("、")}</span></p>`,
    `<p><strong>授权/质量</strong><span>${consentLabel(packageItem.consentStatus)} / ${qualityLabel(packageItem.qualityStatus)}</span></p>`
  ].join("");
}

function renderRegionalReadinessChecklist(packages) {
  const packageItem = packages.find((item) => item.id === regionalState.selectedPackageId) || packages[0];
  const panel = document.querySelector("#regional-readiness-checklist");
  const summary = document.querySelector("#regional-readiness-summary");
  if (!panel || !summary) return;
  if (!packageItem) {
    summary.textContent = "";
    panel.innerHTML = `<div class="muted">暂无共享包可检查。</div>`;
    return;
  }
  const checks = buildRegionalReadinessChecks(packageItem);
  const passed = checks.filter((item) => item.passed).length;
  summary.textContent = `${passed}/${checks.length} 项就绪`;
  panel.innerHTML = checks.map((item) => `
    <article class="${item.passed ? "is-ready" : "needs-review"}">
      <span>${item.passed ? "已就绪" : "待处理"}</span>
      <div>
        <strong>${item.label}</strong>
        <p>${item.detail}</p>
      </div>
    </article>
  `).join("");
}

function renderRegionalReferralHandoff(packages, reviews) {
  const packageItem = packages.find((item) => item.id === regionalState.selectedPackageId) || packages[0];
  const panel = document.querySelector("#regional-referral-handoff");
  const boundary = document.querySelector("#regional-referral-boundary");
  const summary = document.querySelector("#regional-referral-handoff-summary");
  if (!panel || !boundary || !summary) return;
  if (!packageItem) {
    summary.textContent = "";
    panel.innerHTML = `<div class="muted">暂无共享包可形成转诊会诊交接。</div>`;
    boundary.innerHTML = "";
    return;
  }
  const handoff = packageItem.referralHandoff || buildRegionalReferralHandoff(packageItem, reviews);
  const readyCount = handoff.evidence.filter((item) => item.ready).length;
  summary.textContent = `${readyCount}/${handoff.evidence.length} 项证据可交接`;
  panel.innerHTML = [
    `<div class="handoff-head">
      <div>
        <strong>${packageItem.title}</strong>
        <p>${packageItem.resident?.name || packageItem.residentId} · ${packageItem.sourceInstitution || packageItem.sourceOrgCode} → ${(packageItem.targetInstitutions || packageItem.targetOrgCodes || []).join("、")}</p>
      </div>
      <span class="badge ${handoff.ready ? "success" : "warn"}">${handoff.ready ? "可交接" : "需补证"}</span>
    </div>`,
    `<div class="handoff-grid">${handoff.evidence.map((item) => `
      <article class="${item.ready ? "is-ready" : "needs-review"}">
        <span>${item.ready ? "已具备" : "待补齐"}</span>
        <strong>${item.label}</strong>
        <p>${item.detail}</p>
      </article>
    `).join("")}</div>`,
    `<div class="handoff-note">${handoff.note}</div>`
  ].join("");
  boundary.innerHTML = [
    sectionList("可以合并", handoff.mergeItems),
    sectionList("不合并运行时", handoff.runtimeBoundaries)
  ].join("");
}

function buildRegionalReferralHandoff(packageItem, reviews) {
  const collections = new Set(packageItem.sharedCollections || []);
  const evidenceCounts = packageItem.evidenceCounts || {};
  const relatedReviews = (reviews || []).filter((item) => item.packageId === packageItem.id);
  const targetCount = (packageItem.targetOrgCodes || packageItem.targetInstitutions || []).length;
  const evidence = [
    {
      label: "诊疗资料",
      ready: collections.has("personalRecords") && collections.has("diagnosticReports") && evidenceCounts.personalRecords > 0 && evidenceCounts.diagnosticReports > 0,
      detail: `档案 ${evidenceCounts.personalRecords || 0} 条，报告 ${evidenceCounts.diagnosticReports || 0} 条`
    },
    {
      label: "互认依据",
      ready: collections.has("countyMutualRecognitionRecords") && evidenceCounts.mutualRecognitionRecords > 0,
      detail: `互认记录 ${evidenceCounts.mutualRecognitionRecords || 0} 条，可支撑检查检验结果复用`
    },
    {
      label: "接口契约",
      ready: (packageItem.contractRefs || []).length > 0 && (packageItem.contracts || []).every((item) => item.status === "ready"),
      detail: (packageItem.contracts || []).map((item) => contractLabels[item.id] || item.id).join("、") || "未绑定契约"
    },
    {
      label: "授权与质控",
      ready: packageItem.consentStatus === "active" && packageItem.qualityStatus === "passed",
      detail: `${consentLabel(packageItem.consentStatus)} / ${qualityLabel(packageItem.qualityStatus)}`
    },
    {
      label: "调阅审计",
      ready: relatedReviews.length > 0 || Boolean(packageItem.lastAccessReviewId || packageItem.lastSharedAt),
      detail: relatedReviews.length ? `本包已有 ${relatedReviews.length} 条调阅留痕` : "转诊接诊前需登记调阅目的"
    },
    {
      label: "接收范围",
      ready: targetCount > 0,
      detail: `目标机构 ${targetCount} 个；仅允许来源或目标机构在授权范围内调阅`
    }
  ];
  return {
    ready: evidence.every((item) => item.ready),
    evidence,
    note: "交接只证明资料可调阅、可追溯、可用于接诊判断；转诊单、号源床位、服务时限督办和绩效结算仍由转诊会诊模块负责。",
    mergeItems: [
      "共享 residents、personalRecords、diagnosticReports、countyMutualRecognitionRecords、integrationContracts、dataAccessLogs 作为接诊前证据。",
      "现场验收报告合并呈现：区域共享证明资料可调阅，转诊会诊证明业务可流转。",
      "转诊回传报告进入诊断报告或健康档案后，可再次被共享包编目。"
    ],
    runtimeBoundaries: [
      "不把区域共享包当作转诊单主表。",
      "不在区域共享入口改写号源、床位、接诊反馈或服务时限状态。",
      "不绕过居民授权、机构范围和调阅审计。"
    ]
  };
}

function buildRegionalReadinessChecks(packageItem) {
  const contracts = packageItem.contracts || [];
  const contractRefs = packageItem.contractRefs || [];
  const recordRefs = packageItem.recordRefs || [];
  const latestRecords = packageItem.latestRecords || [];
  const evidenceCounts = packageItem.evidenceCounts || {};
  return [
    {
      label: "接口契约",
      passed: contractRefs.length > 0 && contractRefs.every((id) => contracts.some((item) => item.id === id)),
      detail: contractRefs.length ? contractRefs.map((id) => contractLabels[id] || id).join("、") : "未绑定接口契约"
    },
    {
      label: "居民授权",
      passed: packageItem.consentStatus === "active",
      detail: consentLabel(packageItem.consentStatus)
    },
    {
      label: "数据质控",
      passed: packageItem.qualityStatus === "passed",
      detail: qualityLabel(packageItem.qualityStatus)
    },
    {
      label: "记录引用",
      passed: recordRefs.length > 0 && latestRecords.length > 0,
      detail: `已引用 ${recordRefs.length} 条记录，摘要 ${latestRecords.length} 条`
    },
    {
      label: "审计留痕",
      passed: Boolean(packageItem.lastAccessReviewId || packageItem.lastSharedAt || evidenceCounts.dataAccessLogs),
      detail: packageItem.lastAccessReviewId ? `最近留痕 ${packageItem.lastAccessReviewId}` : "调阅后自动写入数据访问日志"
    }
  ];
}

function renderRegionalReviews(reviews) {
  document.querySelector("#regional-sharing-reviews").innerHTML = reviews.slice(0, 10).map((item) => `
    <div class="priority-row ${item.id === regionalState.lastReviewId ? "is-selected" : ""}">
      <span class="badge ${item.decision === "approved" ? "success" : "warning"}">${decisionLabel(item.decision)}</span>
      <div>
        <strong>${item.packageId}${item.id === regionalState.lastReviewId ? " · 最新" : ""}</strong>
        <p>${item.organization || item.actor} · ${item.purpose}</p>
        <p>${item.note || "已登记调阅审计。"}</p>
      </div>
      <div class="capability-side">
        <small>${item.actor}</small>
        <small>${item.at ? new Date(item.at).toLocaleString("zh-CN", { hour12: false }) : ""}</small>
      </div>
    </div>
  `).join("") || `<div class="muted">暂无调阅审计。</div>`;
}

function renderAccessFeedback() {
  const target = document.querySelector("#regional-access-feedback");
  if (!target) return;
  target.textContent = regionalState.feedback || "";
}

function fillPackageOptions(packages) {
  const select = document.querySelector("#regional-access-form select[name='packageId']");
  if (!select) return;
  const current = regionalState.selectedPackageId || select.value;
  select.innerHTML = packages.map((item) => `<option value="${item.id}">${item.title} · ${statusLabel(item.status)}</option>`).join("");
  if (packages.some((item) => item.id === current)) {
    select.value = current;
    regionalState.selectedPackageId = current;
  }
}

function selectRegionalPackage(packageId) {
  const packages = regionalState.data?.packages || [];
  const packageItem = packages.find((item) => item.id === packageId);
  if (!packageItem) return;
  regionalState.selectedPackageId = packageItem.id;
  regionalState.feedback = `已选中 ${packageItem.title}，可登记本次调阅目的。`;
  const form = document.querySelector("#regional-access-form");
  if (form) {
    form.elements.namedItem("packageId").value = packageItem.id;
    form.elements.namedItem("purpose").value = `调阅 ${packageItem.title} 支撑本次诊疗协同`;
    form.elements.namedItem("note").value = `来源：${packageItem.sourceInstitution || packageItem.sourceOrgCode}；状态：${statusLabel(packageItem.status)}`;
  }
  renderRegionalSharing();
}

async function submitRegionalAccessReview(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form));
  const response = await regionalAuthFetch("/api/regional-data-sharing/access-reviews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    regionalState.feedback = body.message || "调阅登记失败";
    renderAccessFeedback();
    return;
  }
  const body = await response.json().catch(() => ({}));
  regionalState.lastReviewId = body.review?.id || "";
  regionalState.feedback = `已登记 ${payload.packageId} 调阅审计，留痕编号 ${regionalState.lastReviewId || "已生成"}`;
  form.elements.namedItem("note").value = "";
  await loadRegionalSharing();
}

async function regionalAuthFetch(url, options = {}) {
  const response = await (window.HealthCityAuth?.authFetch || fetch)(url, options).catch(() => null);
  if (response?.ok || (response && ![401, 403].includes(response.status))) return response;
  const session = readRegionalSession();
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {})
    }
  });
}

function readRegionalSession() {
  try {
    return JSON.parse(localStorage.getItem("health-city-auth-session") || "null");
  } catch (error) {
    return null;
  }
}

function matchesPackageFilters(item) {
  if (regionalState.filters.status && item.status !== regionalState.filters.status) return false;
  if (!regionalState.filters.keyword) return true;
  const text = [
    item.title,
    item.resident?.name,
    item.sourceInstitution,
    ...(item.targetInstitutions || []),
    ...(item.contractRefs || [])
  ].join(" ").toLowerCase();
  return text.includes(regionalState.filters.keyword);
}

function sectionList(title, items) {
  return [
    `<h3>${title}</h3>`,
    ...(items || []).map((item) => `<p><strong>${typeof item === "string" ? item : item.role || item.name}</strong><span>${typeof item === "string" ? "" : (item.permissions || []).join("、")}</span></p>`)
  ].join("");
}

function badgeClass(status) {
  return {
    ready: "success",
    pending_review: "warning",
    blocked: "danger",
    archived: "info"
  }[status] || "info";
}

function statusLabel(status) {
  return {
    ready: "可共享",
    pending_review: "待复核",
    blocked: "暂缓",
    archived: "归档"
  }[status] || status || "未知";
}

function consentLabel(status) {
  return consentLabels[status] || status || "授权待确认";
}

function qualityLabel(status) {
  return qualityLabels[status] || status || "质量待确认";
}

function decisionLabel(decision) {
  return decisionLabels[decision] || decision || "待确认";
}

function labelCollection(key) {
  return collectionLabels[key] || key;
}

function fieldLabel(key) {
  return {
    packageId: "共享包编号",
    residentId: "居民编号",
    sourceOrgCode: "来源机构代码",
    targetOrgCodes: "接收机构代码",
    status: "共享状态",
    consentStatus: "授权状态",
    qualityStatus: "质量状态",
    contractRefs: "接口契约",
    recordRefs: "记录引用"
  }[key] || key;
}

function evidenceText(counts = {}) {
  return `报告 ${counts.diagnosticReports || 0} · 档案 ${counts.personalRecords || 0} · 互认 ${counts.mutualRecognitionRecords || 0}`;
}
