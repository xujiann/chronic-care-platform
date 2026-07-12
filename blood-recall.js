(function () {
  function getState() {
    return typeof bloodState === "undefined" ? null : bloodState;
  }

  function panel() {
    let element = document.querySelector("#recall-actions");
    if (element) return element;
    const safety = document.querySelector("#safety");
    if (!safety) return null;
    element = document.createElement("section");
    element.id = "recall-actions";
    element.className = "panel";
    element.innerHTML = '<div class="panel-header"><div><h2>召回机构确认</h2><p>确认库存冻结、去向核查和受影响患者处置，证据将写入审计链。</p></div></div><div class="standard-list" data-recall-list></div>';
    safety.insertBefore(element, safety.lastElementChild);
    return element;
  }

  function renderRecallActions() {
    const state = getState();
    const element = panel();
    if (!state || !element) return;
    const list = element.querySelector("[data-recall-list]");
    const recalls = state.api?.role === "institution" ? (state.api.recalls || []).filter((item) => item.status !== "closed") : [];
    list.innerHTML = recalls.length ? recalls.map((item) => `<div class="standard-item"><b>待确认</b><span>${item.id}<br><small>${item.reason} · ${(item.bloodUnitIds || []).length} 袋 · 待确认 ${(item.acknowledgementSummary?.pending ?? (item.affectedInstitutions || []).length)} 家</small></span><button class="blood-action" data-recall-action="${item.id}">确认处置</button></div>`).join("") : '<div class="standard-item"><b>已完成</b><span>当前机构没有待确认的召回通知。</span><span class="signal ok">无待办</span></div>';
  }

  async function acknowledgeRecall(recallId) {
    const state = getState();
    if (!state || location.protocol === "file:") {
      toast("静态预览不执行召回确认");
      return;
    }
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      if (!state.masterData) {
        const masterResponse = await request(`${location.origin}/api/blood-system/master-data`);
        if (masterResponse.ok) state.masterData = await masterResponse.json();
      }
      const disposition = state.masterData?.recallDispositions?.[0];
      const response = await request(`${location.origin}/api/blood-system/recalls/${encodeURIComponent(recallId)}/acknowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": `web-recall-${recallId}-${Date.now()}` },
        body: JSON.stringify({ disposition, note: "机构已完成库存冻结与血液去向核查", affectedPatientCount: 0 })
      });
      const result = await response.json();
      toast(response.ok ? "召回处置已确认，证据已记录" : result.message || "召回确认失败");
      await loadBloodSystem();
      render();
    } catch (error) {
      toast("召回确认服务暂不可用，请稍后重试");
    }
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-recall-action]");
    if (button) acknowledgeRecall(button.dataset.recallAction);
  });

  if (typeof render === "function") {
    const originalRender = render;
    render = function () {
      originalRender();
      renderRecallActions();
    };
  }
})();
