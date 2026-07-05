const regionalState = {
  data: null,
  handoffReport: null,
  handoffReportMessage: "",
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

const regionalFunctionRoadmap = [
  {
    title: "共享包编目",
    priority: "P0",
    priorityLabel: "P0 上线前必须",
    owner: "市级平台数据治理组、各医疗机构信息科",
    implemented: "已按居民、来源机构、接收机构、诊疗资料和互认依据生成共享包。",
    acceptance: "每个共享包均可追溯居民主索引、来源机构、目标机构、记录引用、互认依据和质控状态。",
    next: "接入正式居民主索引、院内主数据和批量质量核验。"
  },
  {
    title: "角色权限裁剪",
    priority: "P0",
    priorityLabel: "P0 上线前必须",
    owner: "市卫生健康委信息化处、机构管理员、安全管理岗",
    implemented: "已支持管理端查看区域总览，机构端按来源或目标机构查看共享包。",
    acceptance: "管理端、来源机构、目标机构和无关机构分别验证可见范围，拒绝访问必须进入审计日志。",
    next: "接入统一认证、机构目录、医生身份源和细粒度授权策略。"
  },
  {
    title: "联调检查与交接清单",
    priority: "P1",
    priorityLabel: "P1 试点联调",
    owner: "接口联调组、转诊中心、试点医疗机构",
    implemented: "已按接口契约、居民授权、数据质控、记录引用和审计留痕生成核验清单。",
    next: "对接真实报文样例、字段映射签字、接收医师确认和异常重放记录。"
  },
  {
    title: "调阅审计与发布证据",
    priority: "P2",
    priorityLabel: "P2 生产加固",
    owner: "安全管理岗、平台运维、数据平台",
    implemented: "已登记调阅目的、结论、操作者和机构范围，并纳入区域专项报告。",
    next: "接入审计留存、监控告警、备份恢复演练和现场签字归档。"
  }
];

const regionalRoadmapPrioritySummary = "优先级排序：P0 共享包编目、角色权限裁剪；P1 联调检查与交接清单；P2 调阅审计与发布证据。";

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
  document.querySelector("#regional-handoff-report-action")?.addEventListener("click", generateRegionalHandoffReport);
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
  renderRegionalLaunchReadiness(data.summary || {}, packages);
  renderRegionalSiteIntegration(data.summary || {}, packages);
  renderRegionalScopeSelfTest(data);
  renderRegionalFunctionRoadmap();
  renderRegionalLoop(data.summary || {});
  renderRegionalBoundary(data.scope || {});
  renderRegionalSnapshots(data.snapshots || {});
  renderRegionalPackages(packages);
  renderSelectedPackage(packages);
  renderRegionalReadinessChecklist(packages);
  renderRegionalReferralHandoff(packages, data.accessReviews || []);
  renderRegionalHandoffReport();
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

function renderRegionalLaunchReadiness(summary = {}, packages = []) {
  const panel = document.querySelector("#regional-launch-readiness");
  const target = document.querySelector("#regional-launch-readiness-summary");
  if (!panel || !target) return;
  const total = summary.totalPackages || packages.length;
  const ready = summary.ready || 0;
  const handoffReady = summary.referralHandoffReady || packages.filter((item) => item.referralHandoff?.ready).length;
  const accessReviews = summary.accessReviews || 0;
  const pendingEvidence = packages.reduce((sum, item) => {
    const evidence = item.referralHandoff?.evidence || [];
    return sum + evidence.filter((entry) => !entry.ready).length;
  }, 0);
  const operationalReady = total > 0 && ready === total && handoffReady === total && pendingEvidence === 0 && accessReviews > 0;
  target.textContent = operationalReady ? "演示闭环已齐备，等待现场生产签字" : `${handoffReady}/${total} 个共享包可交接，${pendingEvidence} 项证据待补齐`;
  const cards = [
    {
      title: "已实现能力",
      status: total > 0 ? "已具备" : "待装载",
      detail: `共享包 ${total} 个、可共享 ${ready} 个、调阅留痕 ${accessReviews} 条，已接入角色裁剪、调阅审计和交接清单。`
    },
    {
      title: "交接证据",
      status: handoffReady === total && total > 0 ? "已齐备" : "需补证",
      detail: `${handoffReady}/${total} 个共享包达到转诊会诊交接条件，仍有 ${pendingEvidence} 项诊疗资料、互认依据、授权质控或审计证据待补。`
    },
    {
      title: "待开发项",
      status: "上线前",
      detail: "正式数据库适配、迁移回滚、生产统一认证 OIDC/SAML、审计保全导出或 SIEM 接入仍需在现场环境完成。"
    },
    {
      title: "待联调项",
      status: "现场签字",
      detail: "HIS、EMR、LIS、PACS、医保结算、电子证照、统计交换、监控值守和灾备演练需取得签字证据。"
    }
  ];
  panel.innerHTML = cards.map((item) => `
    <article class="capability-card">
      <strong>${item.title}</strong>
      <span class="badge ${item.status === "已具备" || item.status === "已齐备" ? "success" : "warn"}">${item.status}</span>
      <span>${item.detail}</span>
    </article>
  `).join("");
}

function renderRegionalSiteIntegration(summary = {}, packages = []) {
  const panel = document.querySelector("#regional-site-integration");
  const target = document.querySelector("#regional-site-integration-summary");
  if (!panel || !target) return;
  const total = summary.totalPackages || packages.length;
  const handoffReady = summary.referralHandoffReady || packages.filter((item) => item.referralHandoff?.ready).length;
  const lanes = [
    {
      title: "身份与权限",
      owner: "统一认证/机构目录",
      status: "待现场接入",
      sample: "使用管理端和机构端账号验证角色裁剪。",
      evidence: "OIDC/SAML 参数、回调地址、机构医生映射和拒绝访问审计。",
      nextAction: "确认统一认证客户端、机构目录和医生身份源映射。"
    },
    {
      title: "院内接口",
      owner: "HIS/EMR/LIS/PACS 联调组",
      status: handoffReady > 0 ? "已有样例" : "待签字",
      sample: `${handoffReady}/${total} 个共享包可作为转诊会诊交接样例。`,
      evidence: "真实报文样例、字段映射、幂等签名和接收医师确认。",
      nextAction: "选择试点机构完成 HIS、EMR、LIS、PACS 联合测试记录。"
    },
    {
      title: "审计留存",
      owner: "安全管理岗",
      status: "待配置",
      sample: `${summary.accessReviews || 0} 条调阅留痕可用于导出校验。`,
      evidence: "审计导出路径或安全平台地址、留存年限、导出权限和哈希校验。",
      nextAction: "配置审计导出路径或安全日志平台地址，并完成导出复核。"
    },
    {
      title: "监控灾备",
      owner: "平台运维/数据平台",
      status: "待演练",
      sample: "复用健康检查、运行指标接口和发布门禁结果。",
      evidence: "健康检查、指标监控、告警路由、恢复目标和恢复演练签字。",
      nextAction: "完成告警值班、备份恢复和 RTO/RPO 演练签字。"
    }
  ];
  target.textContent = `${lanes.length} 条现场责任域，${handoffReady}/${total} 个共享包可作为联调样例，0 项生产签字已归档`;
  panel.innerHTML = lanes.map((item) => `
    <article class="capability-card">
      <strong>${item.title}</strong>
      <span class="badge ${item.status === "已有样例" ? "success" : "warn"}">${item.status}</span>
      <span>${item.owner}</span>
      <small>联调样例：${item.sample}</small>
      <small>验收证据：${item.evidence}</small>
      <small>下一步：${item.nextAction}</small>
    </article>
  `).join("");
}

function renderRegionalScopeSelfTest(data = {}) {
  const panel = document.querySelector("#regional-scope-self-test");
  const target = document.querySelector("#regional-scope-self-test-summary");
  if (!panel || !target) return;
  const user = window.HealthCityAuth?.getUser?.() || {};
  const packages = data.packages || [];
  const reviews = data.accessReviews || [];
  const sourceMatches = packages.filter((item) => item.sourceOrgCode === user.orgCode).length;
  const targetMatches = packages.filter((item) => (item.targetOrgCodes || []).includes(user.orgCode)).length;
  const deniedReviews = reviews.filter((item) => item.decision === "denied" || item.status === "denied").length;
  const packageScope = user.role === "commission" ? "管理端全域共享包" : "机构端仅来源或接收共享包";
  target.textContent = `${user.roleName || "当前账号"} · ${packageScope} · 可见 ${packages.length} 个共享包`;
  const cards = [
    {
      title: "当前账号范围",
      status: user.role === "commission" ? "全域" : "机构",
      detail: `${user.orgName || "未绑定机构"} · ${user.dataScope || packageScope}`
    },
    {
      title: "共享包可见性",
      status: packages.length > 0 ? "已裁剪" : "待核验",
      detail: `当前视图返回 ${packages.length} 个共享包；来源命中 ${sourceMatches} 个，接收命中 ${targetMatches} 个。`
    },
    {
      title: "拒绝审计证据",
      status: deniedReviews > 0 ? "已有拒绝" : "脚本覆盖",
      detail: `当前可见范围内暂不调阅 ${deniedReviews} 条；越权拒绝由后端安全事件留痕，并由 API 测试覆盖。`
    },
    {
      title: "现场复核动作",
      status: "P0",
      detail: "分别使用管理端、来源机构、目标机构和无关机构账号复核可见范围，截图与拒绝审计一并归档。"
    }
  ];
  panel.innerHTML = cards.map((item) => `
    <article class="capability-card">
      <strong>${item.title}</strong>
      <span class="badge ${item.status === "P0" || item.status === "脚本覆盖" ? "warn" : "success"}">${item.status}</span>
      <span>${item.detail}</span>
    </article>
  `).join("");
}

function renderRegionalFunctionRoadmap() {
  const panel = document.querySelector("#regional-function-roadmap");
  const target = document.querySelector("#regional-function-roadmap-summary");
  if (!panel || !target) return;
  target.textContent = regionalRoadmapPrioritySummary;
  panel.innerHTML = regionalFunctionRoadmap.map((item) => `
    <article class="capability-card">
      <strong>${item.title}</strong>
      <span class="badge ${item.priority === "P0" ? "danger" : item.priority === "P1" ? "warn" : "info"}">${item.priorityLabel}</span>
      <span>责任部门：${item.owner}</span>
      <small>已实现：${item.implemented}</small>
      ${item.acceptance ? `<small>P0 验收口径：${item.acceptance}</small>` : ""}
      <small>下一步计划开发功能：${item.next}</small>
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
        ${catalogSummaryHtml(item)}
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
    `<p><strong>授权/质量</strong><span>${consentLabel(packageItem.consentStatus)} / ${qualityLabel(packageItem.qualityStatus)}</span></p>`,
    `<div class="catalog-checks">${buildRegionalCatalogChecks(packageItem).checks.map((item) => `
      <span class="${item.passed ? "is-ready" : "needs-review"}">${item.label}</span>
    `).join("")}</div>`
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

function renderRegionalHandoffReport() {
  const panel = document.querySelector("#regional-handoff-report");
  const summary = document.querySelector("#regional-handoff-report-summary");
  if (!panel || !summary) return;
  const report = regionalState.handoffReport;
  if (!report) {
    summary.textContent = regionalState.handoffReportMessage || "按当前角色权限生成现场核验清单";
    panel.innerHTML = "";
    return;
  }
  const packages = report.packages || [];
  summary.textContent = `已生成 ${packages.length} 个共享包清单，${report.summary?.handoffReady || 0} 个可交接`;
  panel.innerHTML = [
    `<div class="handoff-report-head">
      <strong>区域共享-转诊会诊交接清单</strong>
      <span>${report.reportId || "清单未编号"} · ${report.actor?.organization || report.actor?.role || "当前账号"} · ${formatDateTime(report.generatedAt)}</span>
    </div>`,
    `<div class="handoff-report-summary">
      <span>证据进度 ${report.summary?.evidenceReady || 0}/${report.summary?.evidenceTotal || 0}</span>
      <span>调阅留痕 ${report.summary?.accessReviews || 0} 条</span>
      <span>${report.scope?.packageScope || "当前权限范围"}</span>
    </div>`,
    `<div class="handoff-report-list">${packages.map((item) => `
      <article>
        <div>
          <strong>${item.title}</strong>
          <span class="badge ${item.handoffReady ? "success" : "warn"}">${item.readyCount}/${item.total}</span>
        </div>
        <p>${item.residentName || item.residentId} · ${item.sourceInstitution || "来源机构未配置"} → ${(item.targetInstitutions || []).join("、") || "接收机构未配置"}</p>
        <small>${item.pendingEvidence?.length ? `待补：${item.pendingEvidence.join("、")}` : "交接证据已齐备"}</small>
      </article>
    `).join("")}</div>`,
    `<p class="handoff-report-boundary">${report.scope?.runtimeBoundary || ""}</p>`
  ].join("");
}

async function generateRegionalHandoffReport() {
  const button = document.querySelector("#regional-handoff-report-action");
  if (button) {
    button.disabled = true;
    button.textContent = "生成中";
  }
  const response = await regionalAuthFetch("/api/regional-data-sharing/handoff-report");
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    regionalState.handoffReport = null;
    regionalState.handoffReportMessage = body.message || "交接清单生成失败";
    renderRegionalHandoffReport();
  } else {
    regionalState.handoffReport = await response.json();
    regionalState.handoffReportMessage = "";
    renderRegionalHandoffReport();
  }
  if (button) {
    button.disabled = false;
    button.textContent = "生成交接清单";
  }
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
      detail: relatedReviews.length
        ? `本包已有 ${relatedReviews.length} 条调阅留痕`
        : packageItem.lastAccessReviewId || packageItem.lastSharedAt
          ? `已有共享或留痕记录 ${packageItem.lastAccessReviewId || packageItem.lastSharedAt}`
          : "转诊接诊前需登记调阅目的"
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
      `共享 ${["residents", "personalRecords", "diagnosticReports", "countyMutualRecognitionRecords", "integrationContracts", "dataAccessLogs"].map(labelCollection).join("、")} 作为接诊前证据。`,
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

function buildRegionalCatalogChecks(packageItem) {
  const collections = new Set(packageItem.sharedCollections || []);
  const checks = [
    { label: "居民主索引", passed: Boolean(packageItem.residentId && packageItem.personIndex) },
    { label: "来源机构", passed: Boolean(packageItem.sourceOrgCode && packageItem.sourceInstitution) },
    { label: "接收机构", passed: (packageItem.targetOrgCodes || []).length > 0 && (packageItem.targetInstitutions || []).length > 0 },
    { label: "诊疗资料", passed: collections.has("personalRecords") || collections.has("diagnosticReports") },
    { label: "记录引用", passed: (packageItem.recordRefs || []).length > 0 },
    { label: "接口契约", passed: (packageItem.contractRefs || []).length > 0 },
    { label: "授权质控", passed: packageItem.consentStatus === "active" && packageItem.qualityStatus === "passed" }
  ];
  return {
    checks,
    ready: checks.filter((item) => item.passed).length,
    total: checks.length
  };
}

function catalogSummaryHtml(packageItem) {
  const catalog = buildRegionalCatalogChecks(packageItem);
  const pending = catalog.checks.filter((item) => !item.passed).map((item) => item.label);
  return `<p class="catalog-summary">编目完整度 ${catalog.ready}/${catalog.total} · ${pending.length ? `待补：${pending.join("、")}` : "关键字段已齐备"}</p>`;
}

function renderRegionalReviews(reviews) {
  const packages = regionalState.data?.packages || [];
  document.querySelector("#regional-sharing-reviews").innerHTML = reviews.slice(0, 10).map((item) => `
    <div class="priority-row ${item.id === regionalState.lastReviewId ? "is-selected" : ""}">
      <span class="badge ${item.decision === "approved" ? "success" : "warning"}">${decisionLabel(item.decision)}</span>
      <div>
        <strong>${packageTitle(item.packageId, packages)}${item.id === regionalState.lastReviewId ? " · 最新" : ""}</strong>
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

function packageTitle(packageId, packages = []) {
  return packages.find((item) => item.id === packageId)?.title || packageId || "共享包";
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
  regionalState.feedback = `已登记 ${packageTitle(payload.packageId, regionalState.data?.packages || [])} 调阅审计，留痕编号 ${regionalState.lastReviewId || "已生成"}`;
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

function formatDateTime(value) {
  if (!value) return "时间未记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
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
