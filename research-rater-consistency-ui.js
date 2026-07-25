"use strict";

(() => {
  const state = { center: null, user: window.HealthCityAuth?.getUser?.() || null };
  const authFetch = (...args) => (window.HealthCityAuth?.authFetch || fetch)(...args);
  const feedback = document.getElementById("research-rater-feedback");
  const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  async function jsonRequest(url, options = {}) {
    const response = await authFetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `请求失败（${response.status}）`);
    return payload;
  }

  function statusBadge(status) {
    const labels = { collecting: "评价中", finalized: "待复核", verified: "已复核", returned: "已退回" };
    const className = status === "verified" ? "info" : ["finalized", "returned"].includes(status) ? "warn" : "";
    return `<span class="badge ${className}">${escapeHtml(labels[status] || status)}</span>`;
  }

  function methodName(id) {
    return state.center.methods.find((method) => method.id === id)?.name || id;
  }

  function displayValue(value) {
    return value === null || value === undefined ? "待计算" : value;
  }

  function renderSummary() {
    const { summary, aggregate } = state.center;
    const stats = [
      ["研究批次", `${summary.verified}/${summary.batches}`, "已复核 / 已建档"],
      ["匿名评价", summary.submissions, "案例与评价者均摘要化"],
      ["Kappa批次", aggregate.categoricalBatches, "已复核分类评价"],
      ["ICC批次", aggregate.continuousBatches, "已复核连续评分"],
      ["最低系数", displayValue(aggregate.minimumCoefficient), "验收目标不低于0.75"]
    ];
    document.getElementById("research-rater-summary").innerHTML = stats.map(([label, value, detail]) => (
      `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></div>`
    )).join("");
  }

  function renderBatches() {
    const rows = state.center.batches.map((batch) => `<tr>
      <td>第${batch.batchNumber}批<br><small>${escapeHtml(batch.name)}</small></td>
      <td>${escapeHtml(methodName(batch.method))}</td>
      <td>${batch.cases.length}</td>
      <td>${batch.submissions.length}/${batch.expectedRaters}</td>
      <td>${escapeHtml(displayValue(batch.statistics.coefficient))}</td>
      <td>${batch.statistics.meetsTarget === null ? "待评价" : batch.statistics.meetsTarget ? "达标" : "未达标"}</td>
      <td>${statusBadge(batch.status)}</td>
    </tr>`).join("");
    document.getElementById("research-rater-batches").innerHTML = rows
      ? `<table><thead><tr><th>批次</th><th>方法</th><th>案例</th><th>评价者</th><th>系数</th><th>目标判定</th><th>状态</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<div class="empty-state">暂无评价一致性研究批次</div>';
  }

  function updateMethodFields() {
    const continuous = document.getElementById("research-rater-method").value === "icc-a1";
    document.getElementById("research-rater-categories").disabled = continuous;
    document.getElementById("research-rater-score-min").disabled = !continuous;
    document.getElementById("research-rater-score-max").disabled = !continuous;
  }

  function availableActions(batch) {
    if (!batch) return [];
    if (batch.status === "collecting" && batch.submissions.length === batch.expectedRaters) return ["finalize-batch"];
    if (batch.status === "finalized" && state.user?.role === "commission") return ["verify-batch", "return-batch"];
    if (batch.status === "returned") return ["reopen-batch"];
    if (batch.status === "verified" && state.user?.role === "commission") return ["revoke-batch-verification"];
    return [];
  }

  function renderRatingCases() {
    const batchId = document.getElementById("research-rater-rating-batch").value;
    const batch = state.center?.batches.find((item) => item.id === batchId);
    const target = document.getElementById("research-rater-case-ratings");
    if (!batch) {
      target.innerHTML = "";
      return;
    }
    target.innerHTML = batch.cases.map((item, index) => {
      const control = batch.method === "fleiss-kappa"
        ? `<select data-case-index="${index}" required>${batch.categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}</select>`
        : `<input data-case-index="${index}" type="number" min="${batch.scoreMin}" max="${batch.scoreMax}" step="any" required />`;
      return `<label>案例${String(index + 1).padStart(2, "0")}${control}</label>`;
    }).join("");
  }

  function renderActionOptions() {
    const batchId = document.getElementById("research-rater-action-batch").value;
    const batch = state.center?.batches.find((item) => item.id === batchId);
    const labels = {
      "finalize-batch": "锁定评分并定稿",
      "verify-batch": "独立复核通过",
      "return-batch": "退回补充",
      "reopen-batch": "重新开放评价",
      "revoke-batch-verification": "撤销复核结论"
    };
    const actions = availableActions(batch);
    const select = document.getElementById("research-rater-action");
    select.innerHTML = actions.map((action) => `<option value="${action}">${labels[action]}</option>`).join("");
    select.disabled = actions.length === 0;
    document.querySelector("#research-rater-action-form button[type=submit]").disabled = actions.length === 0;
  }

  function renderFormOptions() {
    const collecting = state.center.batches.filter((batch) => batch.status === "collecting" && batch.submissions.length < batch.expectedRaters);
    const ratingSelect = document.getElementById("research-rater-rating-batch");
    const previousRatingBatch = ratingSelect.value;
    ratingSelect.innerHTML = collecting.map((batch) => `<option value="${escapeHtml(batch.id)}">第${batch.batchNumber}批 / ${escapeHtml(batch.name)}</option>`).join("");
    if (collecting.some((batch) => batch.id === previousRatingBatch)) ratingSelect.value = previousRatingBatch;
    ratingSelect.disabled = collecting.length === 0;
    document.querySelector("#research-rater-rating-form button[type=submit]").disabled = collecting.length === 0;
    renderRatingCases();

    const actionable = state.center.batches.filter((batch) => availableActions(batch).length);
    const actionSelect = document.getElementById("research-rater-action-batch");
    const previousActionBatch = actionSelect.value;
    actionSelect.innerHTML = actionable.map((batch) => `<option value="${escapeHtml(batch.id)}">第${batch.batchNumber}批 / ${escapeHtml(batch.name)} / ${escapeHtml(batch.status)}</option>`).join("");
    if (actionable.some((batch) => batch.id === previousActionBatch)) actionSelect.value = previousActionBatch;
    renderActionOptions();

    const nextBatch = state.center.batches.length ? Math.max(...state.center.batches.map((batch) => batch.batchNumber)) + 1 : 1;
    const numberInput = document.getElementById("research-rater-batch-number");
    if (!numberInput.value) numberInput.value = nextBatch;
    updateMethodFields();
  }

  function renderAll() {
    renderSummary();
    renderBatches();
    renderFormOptions();
  }

  async function refresh() {
    state.center = await jsonRequest("/api/research-project/rater-consistency");
    renderAll();
  }

  async function applyResult(result, message) {
    state.center = result.center;
    renderAll();
    await window.refreshResearchProjectCenter?.();
    feedback.textContent = message;
  }

  document.getElementById("research-rater-method").addEventListener("change", updateMethodFields);
  document.getElementById("research-rater-rating-batch").addEventListener("change", renderRatingCases);
  document.getElementById("research-rater-action-batch").addEventListener("change", renderActionOptions);

  document.getElementById("research-rater-batch-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const method = document.getElementById("research-rater-method").value;
      const payload = {
        batchNumber: document.getElementById("research-rater-batch-number").value,
        name: document.getElementById("research-rater-batch-name").value,
        method,
        expectedRaters: document.getElementById("research-rater-expected").value,
        caseCodes: document.getElementById("research-rater-case-codes").value.split(/[\n,，]+/).map((item) => item.trim()).filter(Boolean),
        categories: document.getElementById("research-rater-categories").value.split(/[,，]+/).map((item) => item.trim()).filter(Boolean),
        scoreMin: document.getElementById("research-rater-score-min").value,
        scoreMax: document.getElementById("research-rater-score-max").value
      };
      const result = await jsonRequest("/api/research-project/rater-consistency/batches", { method: "POST", body: JSON.stringify(payload) });
      event.currentTarget.reset();
      document.getElementById("research-rater-expected").value = "2";
      document.getElementById("research-rater-categories").value = "通过,不通过";
      document.getElementById("research-rater-score-min").value = "0";
      document.getElementById("research-rater-score-max").value = "100";
      await applyResult(result, `已建立：${result.batch.name}`);
    } catch (error) {
      feedback.textContent = error.message;
    }
  });

  document.getElementById("research-rater-rating-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const batchId = document.getElementById("research-rater-rating-batch").value;
      const batch = state.center.batches.find((item) => item.id === batchId);
      const controls = [...document.querySelectorAll("#research-rater-case-ratings [data-case-index]")];
      const ratings = controls.map((control) => batch.method === "icc-a1" ? Number(control.value) : control.value);
      const payload = {
        raterCode: document.getElementById("research-rater-code").value,
        ratings,
        noRaterPii: document.getElementById("research-rater-no-pii").checked
      };
      const result = await jsonRequest(`/api/research-project/rater-consistency/batches/${encodeURIComponent(batchId)}/ratings`, { method: "POST", body: JSON.stringify(payload) });
      document.getElementById("research-rater-code").value = "";
      await applyResult(result, `匿名评价已登记：${result.submission.id}`);
    } catch (error) {
      feedback.textContent = error.message;
    }
  });

  document.getElementById("research-rater-action-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const batchId = document.getElementById("research-rater-action-batch").value;
      const payload = {
        action: document.getElementById("research-rater-action").value,
        note: document.getElementById("research-rater-action-note").value
      };
      const result = await jsonRequest(`/api/research-project/rater-consistency/batches/${encodeURIComponent(batchId)}/actions`, { method: "POST", body: JSON.stringify(payload) });
      document.getElementById("research-rater-action-note").value = "";
      await applyResult(result, `批次状态已更新：${result.batch.status}`);
    } catch (error) {
      feedback.textContent = error.message;
    }
  });

  document.getElementById("research-rater-export").addEventListener("click", async () => {
    try {
      const response = await authFetch("/api/research-project/rater-consistency?format=markdown");
      if (!response.ok) throw new Error(`导出失败（${response.status}）`);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([await response.text()], { type: "text/markdown;charset=utf-8" }));
      link.download = "数智医院评价者间一致性统计报告.md";
      link.click();
      URL.revokeObjectURL(link.href);
      feedback.textContent = "评价一致性统计报告已生成。";
    } catch (error) {
      feedback.textContent = error.message;
    }
  });

  refresh().catch((error) => {
    feedback.textContent = error.message;
    document.getElementById("research-rater-batches").innerHTML = '<div class="empty-state">无法读取评价一致性数据</div>';
  });
})();
