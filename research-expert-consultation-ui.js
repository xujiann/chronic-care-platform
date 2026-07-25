"use strict";

(() => {
  const state = {
    center: null,
    user: window.HealthCityAuth?.getUser?.() || null
  };
  const authFetch = (...args) => (window.HealthCityAuth?.authFetch || fetch)(...args);
  const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
  const feedback = document.getElementById("research-expert-feedback");

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
    const labels = {
      collecting: "回收中",
      finalized: "待复核",
      verified: "已复核",
      returned: "已退回"
    };
    const className = status === "verified" ? "info" : ["finalized", "returned"].includes(status) ? "warn" : "";
    return `<span class="badge ${className}">${escapeHtml(labels[status] || status)}</span>`;
  }

  function valueOrPending(value, suffix = "") {
    return value === null || value === undefined ? "待计算" : `${value}${suffix}`;
  }

  function renderSummary() {
    const { summary, aggregate } = state.center;
    const values = [
      ["咨询轮次", `${summary.verified}/${summary.rounds}`, "已复核 / 已建档"],
      ["匿名问卷", summary.responses, "仅存专家代号摘要"],
      ["积极系数", valueOrPending(aggregate.responseRate, "%"), "目标不低于80%"],
      ["最低 I-CVI", valueOrPending(aggregate.minimumICVI), "目标不低于0.78"],
      ["最大 AHP CR", valueOrPending(aggregate.maximumAHPCR), "目标小于0.10"]
    ];
    document.getElementById("research-expert-summary").innerHTML = values.map(([label, value, detail]) => (
      `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></div>`
    )).join("");
  }

  function renderRounds() {
    const rows = state.center.rounds.map((round) => {
      const statistics = round.statistics;
      const ahp = statistics.aggregateAHP;
      return `<tr>
        <td>第${round.roundNumber}轮<br><small>${escapeHtml(round.name)}</small></td>
        <td>${statusBadge(round.status)}</td>
        <td>${statistics.responses}/${statistics.invitedExperts}</td>
        <td>${statistics.responseRate}%</td>
        <td>${valueOrPending(statistics.minimumICVI)}</td>
        <td>${valueOrPending(ahp?.cr)}${ahp ? `<br><small>${ahp.consistent ? "一致性通过" : "一致性未通过"}</small>` : ""}</td>
        <td>${valueOrPending(statistics.individualAHPConsistencyRate, "%")}</td>
      </tr>`;
    }).join("");
    document.getElementById("research-expert-rounds").innerHTML = state.center.rounds.length
      ? `<table><thead><tr><th>轮次</th><th>状态</th><th>回收/邀请</th><th>积极系数</th><th>最低 I-CVI</th><th>聚合 CR</th><th>个体一致率</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<div class="empty-state">暂无专家咨询轮次</div>';
  }

  function renderRatings() {
    const target = document.getElementById("research-expert-ratings");
    if (target.childElementCount) return;
    target.innerHTML = state.center.indicators.map((indicator) => (
      `<label>${escapeHtml(indicator.name)}<select data-indicator-id="${escapeHtml(indicator.id)}" required>
        <option value="4">4 很相关</option>
        <option value="3">3 较相关</option>
        <option value="2">2 较不相关</option>
        <option value="1">1 不相关</option>
      </select></label>`
    )).join("");
  }

  function availableActions(round) {
    if (!round) return [];
    if (round.status === "collecting" && round.responses.length) return ["finalize-round"];
    if (round.status === "finalized" && state.user?.role === "commission") return ["verify-round", "return-round"];
    if (round.status === "returned") return ["reopen-round"];
    if (round.status === "verified" && state.user?.role === "commission") return ["revoke-round-verification"];
    return [];
  }

  function renderFormOptions() {
    const collecting = state.center.rounds.filter((round) => round.status === "collecting" && round.responses.length < round.invitedExperts);
    const responseSelect = document.getElementById("research-expert-response-round");
    const currentResponseRound = responseSelect.value;
    responseSelect.innerHTML = collecting.map((round) => `<option value="${escapeHtml(round.id)}">第${round.roundNumber}轮 / ${escapeHtml(round.name)}</option>`).join("");
    if (collecting.some((round) => round.id === currentResponseRound)) responseSelect.value = currentResponseRound;
    responseSelect.disabled = collecting.length === 0;
    document.querySelector("#research-expert-response-form button[type=submit]").disabled = collecting.length === 0;

    const actionable = state.center.rounds.filter((round) => availableActions(round).length);
    const actionRound = document.getElementById("research-expert-action-round");
    const currentActionRound = actionRound.value;
    actionRound.innerHTML = actionable.map((round) => `<option value="${escapeHtml(round.id)}">第${round.roundNumber}轮 / ${escapeHtml(round.name)} / ${escapeHtml(round.status)}</option>`).join("");
    if (actionable.some((round) => round.id === currentActionRound)) actionRound.value = currentActionRound;
    renderActionOptions();

    const nextRound = state.center.rounds.length ? Math.max(...state.center.rounds.map((round) => round.roundNumber)) + 1 : 1;
    const roundNumberInput = document.getElementById("research-expert-round-number");
    if (!roundNumberInput.value) roundNumberInput.value = nextRound;
  }

  function renderActionOptions() {
    const roundId = document.getElementById("research-expert-action-round").value;
    const round = state.center?.rounds.find((item) => item.id === roundId);
    const labels = {
      "finalize-round": "锁定问卷并定稿",
      "verify-round": "独立复核通过",
      "return-round": "退回补充",
      "reopen-round": "重新开放回收",
      "revoke-round-verification": "撤销复核结论"
    };
    const actions = availableActions(round);
    const actionSelect = document.getElementById("research-expert-round-action");
    actionSelect.innerHTML = actions.map((action) => `<option value="${action}">${labels[action]}</option>`).join("");
    actionSelect.disabled = actions.length === 0;
    document.querySelector("#research-expert-action-form button[type=submit]").disabled = actions.length === 0;
  }

  function renderAll() {
    renderSummary();
    renderRounds();
    renderRatings();
    renderFormOptions();
  }

  async function refresh() {
    state.center = await jsonRequest("/api/research-project/expert-consultation");
    renderAll();
  }

  async function applyResult(result, message) {
    state.center = result.center;
    renderAll();
    await window.refreshResearchProjectCenter?.();
    feedback.textContent = message;
  }

  document.getElementById("research-expert-action-round").addEventListener("change", renderActionOptions);

  document.getElementById("research-expert-round-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const payload = {
        roundNumber: document.getElementById("research-expert-round-number").value,
        name: document.getElementById("research-expert-round-name").value,
        invitedExperts: document.getElementById("research-expert-invited").value
      };
      const result = await jsonRequest("/api/research-project/expert-consultation/rounds", { method: "POST", body: JSON.stringify(payload) });
      event.currentTarget.reset();
      await applyResult(result, `已建立：${result.round.name}`);
    } catch (error) {
      feedback.textContent = error.message;
    }
  });

  document.getElementById("research-expert-response-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const roundId = document.getElementById("research-expert-response-round").value;
      const relevanceRatings = Object.fromEntries([...document.querySelectorAll("#research-expert-ratings select")].map((select) => [select.dataset.indicatorId, Number(select.value)]));
      const payload = {
        expertCode: document.getElementById("research-expert-code").value,
        noExpertPii: document.getElementById("research-expert-no-pii").checked,
        relevanceRatings,
        ahpJudgments: {
          standardVsOutcomes: document.getElementById("research-expert-ahp-standard-outcomes").value,
          standardVsSecurity: document.getElementById("research-expert-ahp-standard-security").value,
          outcomesVsSecurity: document.getElementById("research-expert-ahp-outcomes-security").value
        }
      };
      const result = await jsonRequest(`/api/research-project/expert-consultation/rounds/${encodeURIComponent(roundId)}/responses`, { method: "POST", body: JSON.stringify(payload) });
      document.getElementById("research-expert-code").value = "";
      await applyResult(result, `匿名问卷已登记：${result.response.id}`);
    } catch (error) {
      feedback.textContent = error.message;
    }
  });

  document.getElementById("research-expert-action-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const roundId = document.getElementById("research-expert-action-round").value;
      const payload = {
        action: document.getElementById("research-expert-round-action").value,
        note: document.getElementById("research-expert-action-note").value
      };
      const result = await jsonRequest(`/api/research-project/expert-consultation/rounds/${encodeURIComponent(roundId)}/actions`, { method: "POST", body: JSON.stringify(payload) });
      document.getElementById("research-expert-action-note").value = "";
      await applyResult(result, `轮次状态已更新：${result.round.status}`);
    } catch (error) {
      feedback.textContent = error.message;
    }
  });

  document.getElementById("research-expert-export").addEventListener("click", async () => {
    try {
      const response = await authFetch("/api/research-project/expert-consultation?format=markdown");
      if (!response.ok) throw new Error(`导出失败（${response.status}）`);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([await response.text()], { type: "text/markdown;charset=utf-8" }));
      link.download = "数智医院专家咨询统计报告.md";
      link.click();
      URL.revokeObjectURL(link.href);
      feedback.textContent = "专家咨询统计报告已生成。";
    } catch (error) {
      feedback.textContent = error.message;
    }
  });

  refresh().catch((error) => {
    feedback.textContent = error.message;
    document.getElementById("research-expert-rounds").innerHTML = '<div class="empty-state">无法读取专家咨询数据</div>';
  });
})();
