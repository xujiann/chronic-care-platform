(function () {
  function getState() {
    return typeof bloodState === "undefined" ? null : bloodState;
  }

  function panel() {
    let panelElement = document.querySelector("#recall-actions");
    if (panelElement) return panelElement;
    const safety = document.querySelector("#safety");
    if (!safety) return null;
    panelElement = document.createElement("section");
    panelElement.id = "recall-actions";
    panelElement.className = "panel";
    panelElement.replaceChildren(
      element("div", { className: "panel-header" }, element("div", {}, [
        element("h2", { text: "召回机构确认" }),
        element("p", { text: "确认库存冻结、去向核查和受影响患者处置，证据将写入审计链。" })
      ])),
      element("div", { className: "standard-list", dataset: { recallList: "" } })
    );
    safety.insertBefore(panelElement, safety.lastElementChild);
    return panelElement;
  }

  function recallItem(item) {
    const pending = item.acknowledgementSummary?.pending ?? (item.affectedInstitutions || []).length;
    return standardItem(
      "待确认",
      detail(item.id, `${String(item.reason ?? "")} · ${(item.bloodUnitIds || []).length} 袋 · 待确认 ${String(pending ?? "")} 家`),
      actionButton("确认处置", { recallAction: item.id })
    );
  }

  function emptyRecallItem() {
    return standardItem("已完成", "当前机构没有待确认的召回通知。", signal("无待办"));
  }

  function renderRecallActions() {
    const state = getState();
    const element = panel();
    if (!state || !element) return;
    const list = element.querySelector("[data-recall-list]");
    const recalls = state.api?.role === "institution" ? (state.api.recalls || []).filter((item) => item.status !== "closed") : [];
    list.replaceChildren(...(recalls.length ? recalls.map(recallItem) : [emptyRecallItem()]));
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
