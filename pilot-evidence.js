(() => {
  const state = {
    center: null,
    batch: null,
    filter: "all",
    user: null
  };

  const groupLabels = {
    "site-task": "现场任务",
    "interface-receipt": "接口回执",
    "alert-route": "告警路由",
    "four-party-signoff": "四方签字"
  };

  const statusLabels = {
    pending: "待提交",
    submitted: "待复核",
    verified: "已通过",
    rejected: "已退回",
    frozen: "已冻结"
  };

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);

  function toast(message) {
    const node = document.querySelector("#pilot-evidence-toast");
    node.textContent = String(message || "");
    node.classList.add("visible");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove("visible"), 2800);
  }

  async function request(pathname, options = {}) {
    const fetcher = window.HealthCityAuth?.authFetch || fetch;
    const response = await fetcher(`${location.origin}${pathname}`, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });
    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      const error = new Error(body?.message || `请求失败：HTTP ${response.status}`);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }

  function activeArtifact(requirement) {
    return (state.batch?.artifacts || []).find((item) => item.id === requirement.activeArtifactId) || null;
  }

  function renderBatches() {
    const node = document.querySelector("#pilot-evidence-batches");
    const batches = state.center?.batches || [];
    if (!batches.length) {
      node.innerHTML = '<p class="empty-state">尚未建立试点验收批次。</p>';
      return;
    }
    node.innerHTML = batches.map((batch) => `
      <button type="button" class="batch-item ${state.batch?.id === batch.id ? "active" : ""}" data-batch-id="${escapeHtml(batch.id)}">
        <strong>${escapeHtml(batch.hospitalName)}</strong>
        <span>${escapeHtml(batch.pilotId)} · ${escapeHtml(statusLabels[batch.status] || batch.status)}</span>
        <span>${escapeHtml(batch.verified)}/${escapeHtml(batch.total)} 已复核 · rev ${escapeHtml(batch.revision)}</span>
      </button>
    `).join("");
  }

  function metric(label, value) {
    return `<div class="metric"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
  }

  function renderMetrics() {
    const requirements = state.batch.requirements || [];
    document.querySelector("#pilot-evidence-metrics").innerHTML = [
      metric("全部要求", requirements.length),
      metric("已通过", requirements.filter((item) => item.status === "verified").length),
      metric("待复核", requirements.filter((item) => item.status === "submitted").length),
      metric("待提交/退回", requirements.filter((item) => ["pending", "rejected"].includes(item.status)).length),
      metric("审计事件", (state.batch.auditEvents || []).length)
    ].join("");
  }

  function actionButtons(requirement, artifact) {
    const frozen = state.batch.status === "frozen";
    const commission = state.user?.role === "commission";
    const buttons = [];
    if (!frozen) {
      buttons.push(`<button type="button" data-register-requirement="${escapeHtml(requirement.id)}">登记附件</button>`);
    }
    if (!frozen && commission && artifact?.status === "submitted") {
      buttons.push(`<button type="button" data-review-artifact="${escapeHtml(artifact.id)}">独立复核</button>`);
    }
    if (artifact) {
      buttons.push(`<button type="button" data-record-access="${escapeHtml(artifact.id)}">访问留痕</button>`);
    }
    return buttons.join("");
  }

  function renderRequirements() {
    const rows = (state.batch.requirements || []).filter((item) => state.filter === "all" || item.group === state.filter);
    document.querySelector("#pilot-evidence-requirements").innerHTML = rows.map((requirement) => {
      const artifact = activeArtifact(requirement);
      const artifactLabel = artifact
        ? `${escapeHtml(artifact.filename)}<br><span class="digest-value">${escapeHtml(artifact.checksumSha256.slice(0, 12))}...</span>`
        : '<span class="empty-state">未登记</span>';
      return `
        <tr>
          <td>${escapeHtml(requirement.id)}</td>
          <td><strong>${escapeHtml(requirement.title)}</strong><br><span class="empty-state">${escapeHtml(groupLabels[requirement.group])}</span></td>
          <td><span class="status ${escapeHtml(requirement.status)}">${escapeHtml(statusLabels[requirement.status] || requirement.status)}</span></td>
          <td>${artifactLabel}</td>
          <td>${artifact ? `v${escapeHtml(artifact.version)} · ${escapeHtml(artifact.objectVersion)}` : "-"}</td>
          <td><div class="row-actions">${actionButtons(requirement, artifact)}</div></td>
        </tr>
      `;
    }).join("");
  }

  function renderAudit() {
    const events = [...(state.batch.auditEvents || [])].reverse().slice(0, 12);
    document.querySelector("#pilot-evidence-audit").innerHTML = events.map((event) => `
      <div class="audit-event">
        <time>${escapeHtml(new Date(event.at).toLocaleString("zh-CN", { hour12: false }))}</time>
        <span>${escapeHtml(event.action)} · ${escapeHtml(event.actorId)} · ${escapeHtml(event.target)}</span>
      </div>
    `).join("") || '<p class="empty-state">暂无审计事件。</p>';
    const tail = state.batch.auditEvents?.at(-1)?.chainHash || "";
    document.querySelector("#pilot-evidence-audit-tail").textContent = tail ? `tail ${tail.slice(0, 16)}...` : "";
  }

  function renderDetail() {
    const empty = document.querySelector("#pilot-evidence-empty");
    const detail = document.querySelector("#pilot-evidence-detail");
    if (!state.batch) {
      empty.hidden = false;
      detail.hidden = true;
      renderBatches();
      return;
    }
    empty.hidden = true;
    detail.hidden = false;
    document.querySelector("#pilot-evidence-pilot-id").textContent = state.batch.pilotId;
    document.querySelector("#pilot-evidence-title").textContent = state.batch.title;
    document.querySelector("#pilot-evidence-hospital").textContent = `${state.batch.hospitalName} · ${statusLabels[state.batch.status] || state.batch.status}`;
    document.querySelector("#pilot-evidence-revision").textContent = `revision ${state.batch.revision}`;
    const frozen = state.batch.status === "frozen";
    const commission = state.user?.role === "commission";
    document.querySelector("#pilot-evidence-freeze").hidden = !commission || frozen;
    document.querySelector("#pilot-evidence-export").disabled = !frozen;
    renderMetrics();
    renderRequirements();
    renderAudit();
    renderBatches();
  }

  async function loadCenter(preferredBatchId) {
    state.center = await request("/api/pilot-evidence");
    const batchId = preferredBatchId || state.batch?.id || state.center.batches?.[0]?.id;
    if (batchId) {
      const result = await request(`/api/pilot-evidence/batches/${encodeURIComponent(batchId)}`);
      state.batch = result.batch;
    } else {
      state.batch = null;
    }
    renderDetail();
  }

  async function createBatch(event) {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const result = await request("/api/pilot-evidence/batches", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      event.currentTarget.reset();
      state.batch = result.batch;
      await loadCenter(result.batch.id);
      toast("验收批次已建立");
    } catch (error) {
      toast(error.message);
    }
  }

  function openArtifactDialog(requirementId) {
    const requirement = state.batch.requirements.find((item) => item.id === requirementId);
    const dialog = document.querySelector("#pilot-evidence-artifact-dialog");
    const form = document.querySelector("#pilot-evidence-artifact-form");
    form.elements.requirementId.value = requirement.id;
    form.elements.requirementTitle.value = requirement.title;
    form.elements.expectedRevision.value = state.batch.revision;
    form.elements.attachmentId.value = "";
    dialog.showModal();
  }

  async function submitArtifact(event) {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    payload.expectedRevision = Number(payload.expectedRevision);
    try {
      const result = await request(`/api/pilot-evidence/batches/${encodeURIComponent(state.batch.id)}/artifacts`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      state.batch = result.batch;
      document.querySelector("#pilot-evidence-artifact-dialog").close();
      await loadCenter(state.batch.id);
      toast("证据版本已登记");
    } catch (error) {
      toast(error.message);
    }
  }

  function openReviewDialog(artifactId) {
    const artifact = state.batch.artifacts.find((item) => item.id === artifactId);
    const dialog = document.querySelector("#pilot-evidence-review-dialog");
    const form = document.querySelector("#pilot-evidence-review-form");
    form.elements.artifactId.value = artifact.id;
    form.elements.expectedRevision.value = state.batch.revision;
    form.elements.evidenceDigest.value = artifact.checksumSha256;
    form.elements.outcome.value = "verified";
    form.elements.note.value = "";
    dialog.showModal();
  }

  async function submitReview(event) {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    payload.expectedRevision = Number(payload.expectedRevision);
    const artifactId = payload.artifactId;
    delete payload.artifactId;
    try {
      const result = await request(`/api/pilot-evidence/batches/${encodeURIComponent(state.batch.id)}/artifacts/${encodeURIComponent(artifactId)}/review`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      state.batch = result.batch;
      document.querySelector("#pilot-evidence-review-dialog").close();
      await loadCenter(state.batch.id);
      toast("独立复核已记录");
    } catch (error) {
      toast(error.message);
    }
  }

  async function recordAccess(artifactId) {
    try {
      await request(`/api/pilot-evidence/batches/${encodeURIComponent(state.batch.id)}/artifacts/${encodeURIComponent(artifactId)}/access`, {
        method: "POST",
        body: JSON.stringify({ purpose: "验收台账核验", expectedRevision: state.batch.revision })
      });
      await loadCenter(state.batch.id);
      toast("访问审计已登记");
    } catch (error) {
      toast(error.message);
    }
  }

  async function freezeBatch() {
    if (!window.confirm("冻结后当前批次不能继续登记或复核，确认冻结？")) return;
    try {
      const result = await request(`/api/pilot-evidence/batches/${encodeURIComponent(state.batch.id)}/freeze`, {
        method: "POST",
        body: JSON.stringify({ expectedRevision: state.batch.revision })
      });
      state.batch = result.batch;
      await loadCenter(state.batch.id);
      toast("验收批次已冻结");
    } catch (error) {
      toast(error.message);
    }
  }

  async function exportPack() {
    try {
      const fetcher = window.HealthCityAuth?.authFetch || fetch;
      const response = await fetcher(`${location.origin}/api/pilot-evidence/batches/${encodeURIComponent(state.batch.id)}/acceptance-pack?download=1`);
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.message || "验收包导出失败");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `pilot-evidence-${state.batch.id}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast("验收包已导出");
    } catch (error) {
      toast(error.message);
    }
  }

  function bindEvents() {
    document.querySelector("#pilot-evidence-batch-form").addEventListener("submit", createBatch);
    document.querySelector("#pilot-evidence-artifact-form").addEventListener("submit", submitArtifact);
    document.querySelector("#pilot-evidence-review-form").addEventListener("submit", submitReview);
    document.querySelector("#pilot-evidence-refresh").addEventListener("click", () => loadCenter().catch((error) => toast(error.message)));
    document.querySelector("#pilot-evidence-freeze").addEventListener("click", freezeBatch);
    document.querySelector("#pilot-evidence-export").addEventListener("click", exportPack);
    document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
    document.querySelector("#pilot-evidence-batches").addEventListener("click", (event) => {
      const button = event.target.closest("[data-batch-id]");
      if (button) loadCenter(button.dataset.batchId).catch((error) => toast(error.message));
    });
    document.querySelector("#pilot-evidence-requirements").addEventListener("click", (event) => {
      const registerButton = event.target.closest("[data-register-requirement]");
      if (registerButton) openArtifactDialog(registerButton.dataset.registerRequirement);
      const reviewButton = event.target.closest("[data-review-artifact]");
      if (reviewButton) openReviewDialog(reviewButton.dataset.reviewArtifact);
      const accessButton = event.target.closest("[data-record-access]");
      if (accessButton) recordAccess(accessButton.dataset.recordAccess);
    });
    document.querySelector("#pilot-evidence-filters").addEventListener("click", (event) => {
      const button = event.target.closest("[data-filter]");
      if (!button) return;
      state.filter = button.dataset.filter;
      document.querySelectorAll("#pilot-evidence-filters [data-filter]").forEach((item) => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-selected", String(active));
      });
      renderRequirements();
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    if (!window.HealthCityAuth?.requireRole(["commission", "institution"])) return;
    state.user = window.HealthCityAuth.getUser();
    bindEvents();
    try {
      await loadCenter();
    } catch (error) {
      toast(error.message);
      document.querySelector("#pilot-evidence-batches").innerHTML = '<p class="empty-state">证据仓服务暂不可用。</p>';
    }
  });
})();
