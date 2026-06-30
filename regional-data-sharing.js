const regionalState = {
  data: null,
  filters: {
    status: "",
    keyword: ""
  }
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
  loadRegionalSharing();
});

async function loadRegionalSharing() {
  const request = window.HealthCityAuth?.authFetch || fetch;
  const response = await request("/api/regional-data-sharing");
  if (!response.ok) {
    document.querySelector("#regional-sharing-packages").innerHTML = `<div class="muted">区域共享数据加载失败。</div>`;
    return;
  }
  regionalState.data = await response.json();
  renderRegionalSharing();
}

function renderRegionalSharing() {
  const data = regionalState.data;
  if (!data) return;
  renderRegionalMetrics(data.summary);
  renderRegionalBoundary(data.scope);
  renderRegionalSnapshots(data.snapshots);
  renderRegionalPackages(data.packages || []);
  renderRegionalReviews(data.accessReviews || []);
  fillPackageOptions(data.packages || []);
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

function renderRegionalBoundary(scope) {
  const boundary = scope?.boundary || [];
  const exclusions = scope?.exclusions || [];
  const reused = scope?.reusedCollections || [];
  document.querySelector("#regional-sharing-scope").textContent = `${boundary.length} 项范围 / ${exclusions.length} 项不做事项`;
  document.querySelector("#regional-sharing-boundary").innerHTML = [
    sectionList("业务范围", boundary),
    sectionList("不做事项", exclusions),
    sectionList("复用集合", reused)
  ].join("");
}

function renderRegionalSnapshots(snapshot) {
  const fields = Object.entries(snapshot?.fields || {});
  const statuses = Object.entries(snapshot?.statusNorms || {});
  document.querySelector("#regional-sharing-snapshots").innerHTML = [
    `<h3>字段</h3>`,
    ...fields.map(([key, value]) => `<p><strong>${key}</strong><span>${value}</span></p>`),
    `<h3>状态</h3>`,
    ...statuses.map(([key, value]) => `<p><strong>${key}</strong><span>${value}</span></p>`)
  ].join("");
}

function renderRegionalPackages(packages) {
  const filtered = packages.filter(matchesPackageFilters);
  document.querySelector("#regional-sharing-packages").innerHTML = filtered.map((item) => `
    <div class="priority-row">
      <span class="badge ${badgeClass(item.status)}">${statusLabel(item.status)}</span>
      <div>
        <strong>${item.title}</strong>
        <p>${item.resident?.name || item.residentId} · ${item.sourceInstitution} -> ${(item.targetInstitutions || []).join("、")}</p>
        <p>${(item.contracts || []).map((contract) => contract.id).join(" / ")} · ${evidenceText(item.evidenceCounts)}</p>
        <p>${(item.latestRecords || []).map((record) => `${record.type}:${record.name || record.id}`).join("；") || "暂无记录摘要"}</p>
      </div>
      <div class="capability-side">
        <small>${item.consentStatus || "consent-pending"}</small>
        <small>${item.lastSharedAt ? new Date(item.lastSharedAt).toLocaleString("zh-CN", { hour12: false }) : "待共享"}</small>
      </div>
    </div>
  `).join("") || `<div class="muted">没有符合条件的共享包。</div>`;
}

function renderRegionalReviews(reviews) {
  document.querySelector("#regional-sharing-reviews").innerHTML = reviews.slice(0, 10).map((item) => `
    <div class="priority-row">
      <span class="badge ${item.decision === "approved" ? "success" : "warning"}">${item.decision}</span>
      <div>
        <strong>${item.packageId}</strong>
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

function fillPackageOptions(packages) {
  const select = document.querySelector("#regional-access-form select[name='packageId']");
  if (!select) return;
  const current = select.value;
  select.innerHTML = packages.map((item) => `<option value="${item.id}">${item.title} · ${statusLabel(item.status)}</option>`).join("");
  if (packages.some((item) => item.id === current)) select.value = current;
}

async function submitRegionalAccessReview(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form));
  const request = window.HealthCityAuth?.authFetch || fetch;
  const response = await request("/api/regional-data-sharing/access-reviews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    window.alert(body.message || "登记失败");
    return;
  }
  form.elements.namedItem("note").value = "";
  await loadRegionalSharing();
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

function evidenceText(counts = {}) {
  return `报告 ${counts.diagnosticReports || 0} · 档案 ${counts.personalRecords || 0} · 互认 ${counts.mutualRecognitionRecords || 0}`;
}
