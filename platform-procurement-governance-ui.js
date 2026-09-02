(function (root) {
  "use strict";

  const PAGE_SIZE = 20;
  const state = { page: 0, planningPage: 0, evidencePage: 0, reviewStatus: "all", report: null, refresh: null };
  const REVIEW_LABELS = Object.freeze({ "pending-review": "待复核", accepted: "已采纳", "revision-required": "待补充", rejected: "本期不纳入" });
  const DELIVERY_LABELS = Object.freeze({ "awaiting-plan": "待规划", planned: "已规划", "in-delivery": "实施中", "evidence-review": "证据核验中", "repository-verified": "仓库证据已核验", "acceptance-review": "待独立交付验收", "acceptance-returned": "已退回整改", "delivery-accepted": "仓库交付验收通过", "source-stale": "来源已变化，计划失效" });
  const ACCEPTANCE_LABELS = Object.freeze({ "not-requested": "未申请验收", pending: "等待独立验收", returned: "已退回整改", accepted: "仓库交付验收通过" });
  const STRATEGY_LABELS = Object.freeze({ REUSE_WITH_REGRESSION: "复用并回归验证", VERIFY_REPOSITORY_EVIDENCE: "补充仓库证据", BUILD_MINIMUM_CAPABILITY_SLICE: "建设最小能力切片", ENHANCE_EXISTING_CAPABILITY: "增强现有能力", PREPARE_CONFIGURATION_PACKAGE: "形成配置包", PREPARE_DEPLOYMENT_VERIFICATION: "形成部署核验项", PREPARE_SITE_ACCEPTANCE: "准备现场验收清单" });
  const EVIDENCE_LABELS = Object.freeze({ implementation: "实现证据", test: "测试证据", review: "独立复核证据" });

  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]); }
  function metric(label, value) { return `<article class="metric"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></article>`; }
  function safeCount(value) { return Number.isSafeInteger(value) && value >= 0 ? value : 0; }
  function safeEnum(value, values, fallback) { return values.includes(value) ? value : fallback; }
  function textList(value, fallback = "未登记") { return Array.isArray(value) && value.length ? value.map(String).join("、") : fallback; }
  function validLogicalId(value) { return /^REQ-[A-F0-9]{12}$/.test(String(value || "")) ? String(value) : ""; }
  function validSeriesId(value) { return /^SRC-[A-F0-9]{12}$/.test(String(value || "")) ? String(value) : ""; }
  function validCandidateId(value) { return /^[A-Za-z0-9]+(?:[._:-][A-Za-z0-9]+)*$/.test(String(value || "")) ? String(value) : ""; }
  function validCapabilityIds(value) { return Array.isArray(value) ? value.filter((id) => /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(String(id))) : []; }
  function validDigest(value) { return /^sha256:[a-f0-9]{64}$/.test(String(value || "")) ? String(value) : null; }
  function announcement(text) { const target = document.querySelector("#platform-procurement-governance-announcement"); if (target) target.textContent = text; }
  function requirementChangeLabel(value) { return ({ baseline: "初始基线", added: "新增", changed: "变更", unchanged: "无变化", withdrawn: "撤回" })[value] || "待确认"; }
  async function refreshCenter() { if (typeof state.refresh === "function") await state.refresh(); }

  function pageSlice(items, pageName) {
    const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    state[pageName] = Math.min(Math.max(0, state[pageName]), pages - 1);
    return { items: items.slice(state[pageName] * PAGE_SIZE, (state[pageName] + 1) * PAGE_SIZE), page: state[pageName], pages };
  }

  function pagination(documentRef, result, pageName, label) {
    const navigation = documentRef.createElement("div"); navigation.className = "action-row";
    const previous = documentRef.createElement("button"); previous.type = "button"; previous.className = "secondary-button"; previous.textContent = `上一页${label}`; previous.disabled = result.page === 0; previous.addEventListener("click", () => { state[pageName] -= 1; renderProcurementCenter(state.report); });
    const page = documentRef.createElement("span"); page.className = "muted"; page.textContent = `${label}第 ${result.page + 1} / ${result.pages} 页，本页 ${result.items.length} 条`;
    const next = documentRef.createElement("button"); next.type = "button"; next.className = "secondary-button"; next.textContent = `下一页${label}`; next.disabled = result.page + 1 >= result.pages; next.addEventListener("click", () => { state[pageName] += 1; renderProcurementCenter(state.report); });
    navigation.append(previous, page, next);
    return navigation;
  }

  function actionButton(documentRef, label, action, item) {
    const button = documentRef.createElement("button");
    const commandKey = root.HealthPlatformApi?.newCorrelationId?.() || `review-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    button.type = "button"; button.className = action === "accept" ? "primary-button" : "secondary-button"; button.textContent = label;
    button.addEventListener("click", async () => {
      if (!root.HealthPlatformApi || button.disabled) return;
      button.disabled = true; button.textContent = "正在提交…";
      try {
        await root.HealthPlatformApi.createClient().post(`/platform/productization/requirements/${encodeURIComponent(item.id)}/actions`, { action, expectedVersion: item.version || 0, note: action === "accept" ? "经治理工作台人工复核，采用当前能力映射建议" : action === "reject" ? "经治理工作台人工复核，本期不纳入平台范围" : "经治理工作台人工复核，需要补充来源证据或映射" }, { headers: { "Idempotency-Key": commandKey } });
        announcement("复核结果已保存。"); await refreshCenter();
      } catch (error) { button.textContent = error?.status === 409 ? "数据已更新，请重新确认" : "操作未完成，请重试"; button.disabled = false; }
    });
    return button;
  }

  function renderRequirementFilters(governance, target) {
    if (!target) return;
    const documentRef = target.ownerDocument || document;
    const select = documentRef.createElement("select"); select.setAttribute?.("aria-label", "按复核状态筛选");
    for (const [value, label] of [["all", "全部状态"], ...Object.entries(REVIEW_LABELS)]) { const option = documentRef.createElement("option"); option.value = value; option.textContent = label; option.selected = state.reviewStatus === value; select.append(option); }
    select.addEventListener("change", () => { state.reviewStatus = select.value; state.page = 0; renderProcurementCenter(state.report); });
    const count = documentRef.createElement("span");
    const items = Array.isArray(governance?.items) ? governance.items : [];
    const filtered = state.reviewStatus === "all" ? items : items.filter((item) => item.reviewStatus === state.reviewStatus);
    count.className = "muted"; count.textContent = `当前筛选 ${filtered.length} / 全部 ${items.length}`;
    target.replaceChildren(select, count);
  }

  function renderRequirementGovernance(governance, target) {
    if (!target) return;
    const documentRef = target.ownerDocument || document;
    const allItems = Array.isArray(governance?.items) ? governance.items : [];
    const filtered = state.reviewStatus === "all" ? allItems : allItems.filter((item) => item.reviewStatus === state.reviewStatus);
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)); state.page = Math.min(state.page, pages - 1);
    const items = filtered.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);
    if (!items.length) { const empty = documentRef.createElement("p"); empty.className = "muted"; empty.textContent = "暂无待治理的招标需求。"; target.replaceChildren(empty); return; }
    const cards = items.map((item) => {
      const logicalId = validLogicalId(item.logicalRequirementId); const seriesId = validSeriesId(item.seriesId); const candidateId = validCandidateId(item.id); const reviewStatus = safeEnum(item.reviewStatus, Object.keys(REVIEW_LABELS), "pending-review");
      const card = documentRef.createElement("article"); card.className = "evidence-card"; if (candidateId) card.dataset.procurementRequirement = candidateId;
      const title = documentRef.createElement("h3"); title.textContent = logicalId ? `需求候选 ${logicalId.slice(4)}` : "需求候选 未登记";
      const source = documentRef.createElement("p"); source.textContent = `来源：${seriesId ? `需求来源 ${seriesId.slice(4)}` : "中性来源未登记"}；修订：R${Number.isSafeInteger(item.sourceRevision) && item.sourceRevision > 0 ? item.sourceRevision : "?"}；变化：${requirementChangeLabel(item.change)}`;
      const mapping = documentRef.createElement("p"); mapping.className = "muted"; mapping.textContent = `建议：${safeEnum(item.decision, ["REUSE", "ENHANCE", "BUILD", "CONFIGURE", "DEPLOY"], "待决策")}；优先级：${safeEnum(item.priority, ["P0", "P1", "P2"], "待分级")}；能力：${textList(validCapabilityIds(item.targetCapabilityIds))}`;
      const evidence = documentRef.createElement("p"); evidence.className = "muted"; evidence.textContent = `受控定位：第${Number.isSafeInteger(item.sourceAnchor?.pageStart) ? item.sourceAnchor.pageStart : "?"}-${Number.isSafeInteger(item.sourceAnchor?.pageEnd) ? item.sourceAnchor.pageEnd : "?"}页（不展示原文）；复核：${REVIEW_LABELS[reviewStatus]}；证据绑定：${item.evidenceBindingStatus === "invalidated" ? "已失效，需重审" : "受控"}`;
      card.append(title, source, mapping, evidence);
      const definitions = !candidateId ? [] : reviewStatus === "pending-review" ? [["确认采纳", "accept"], ["退回补充", "request-revision"], ["本期不纳入", "reject"]] : reviewStatus === "revision-required" ? [["确认采纳", "accept"], ["本期不纳入", "reject"]] : [["重新打开复核", "request-revision"]];
      if (definitions.length) { const actions = documentRef.createElement("div"); actions.className = "action-row"; actions.append(...definitions.map(([label, action]) => actionButton(documentRef, label, action, item))); card.append(actions); }
      return card;
    });
    const navigation = documentRef.createElement("div"); navigation.className = "action-row";
    const previous = documentRef.createElement("button"); previous.type = "button"; previous.className = "secondary-button"; previous.textContent = "上一页"; previous.disabled = state.page === 0; previous.addEventListener("click", () => { state.page -= 1; renderProcurementCenter(state.report); });
    const page = documentRef.createElement("span"); page.className = "muted"; page.textContent = `第 ${state.page + 1} / ${pages} 页，本页 ${items.length} 条`;
    const next = documentRef.createElement("button"); next.type = "button"; next.className = "secondary-button"; next.textContent = "下一页"; next.disabled = state.page + 1 >= pages; next.addEventListener("click", () => { state.page += 1; renderProcurementCenter(state.report); }); navigation.append(previous, page, next);
    target.replaceChildren(navigation, ...cards);
  }

  function renderRevisionComparisons(governance, target) {
    if (!target) return;
    const documentRef = target.ownerDocument || document; const comparisons = Array.isArray(governance?.revisionComparisons) ? governance.revisionComparisons : [];
    if (!comparisons.length) { const empty = documentRef.createElement("p"); empty.className = "muted"; empty.textContent = "当前来源均为首个修订。"; target.replaceChildren(empty); return; }
    target.replaceChildren(...comparisons.map((item) => {
      const card = documentRef.createElement("article"); card.className = "evidence-card";
      const title = documentRef.createElement("h3"); const seriesId = validSeriesId(item.seriesId); title.textContent = `${seriesId ? `需求来源 ${seriesId.slice(4)}` : "中性来源未登记"}：R${safeCount(item.fromRevision)} → R${safeCount(item.toRevision)}`;
      const summary = documentRef.createElement("p"); summary.textContent = `新增 ${safeCount(item.summary?.added)} · 变更 ${safeCount(item.summary?.changed)} · 撤回 ${safeCount(item.summary?.withdrawn)} · 未变化 ${safeCount(item.summary?.unchanged)}`;
      const affected = documentRef.createElement("p"); affected.className = "muted"; affected.textContent = `受影响需求：${textList([...(item.added || []), ...(item.changed || []), ...(item.withdrawn || [])].map((entry) => validLogicalId(entry.logicalRequirementId)).filter(Boolean))}；撤回不会自动删除平台能力。`;
      card.append(title, summary, affected); return card;
    }));
  }

  async function postLifecycle(item, payload, commandKey) {
    return root.HealthPlatformApi.createClient().post(`/platform/productization/requirements/${encodeURIComponent(item.requirementId)}/lifecycle-actions`, { expectedVersion: item.version || 0, ...payload }, { headers: { "Idempotency-Key": commandKey } });
  }

  function lifecycleButton(documentRef, label, item, payload) {
    const button = documentRef.createElement("button"); const commandKey = root.HealthPlatformApi?.newCorrelationId?.() || `delivery-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    button.type = "button"; button.className = payload.action === "plan" || payload.action === "start-delivery" ? "primary-button" : "secondary-button"; button.textContent = label;
    button.addEventListener("click", async () => { if (!root.HealthPlatformApi || button.disabled) return; button.disabled = true; button.textContent = "正在提交…"; try { await postLifecycle(item, payload, commandKey); announcement("产品计划或交付证据状态已保存。"); await refreshCenter(); } catch (error) { button.textContent = error?.status === 409 ? "状态已变化，请重新确认" : "操作未完成，请重试"; button.disabled = false; } });
    return button;
  }

  function renderDelivery(delivery, planningTarget, evidenceTarget) {
    if (!planningTarget || !evidenceTarget) return;
    const documentRef = planningTarget.ownerDocument || document; const items = Array.isArray(delivery?.items) ? delivery.items : [];
    if (!items.length) { for (const target of [planningTarget, evidenceTarget]) { const empty = documentRef.createElement("p"); empty.className = "muted"; empty.textContent = "暂无已采纳需求，完成复核后可进入产品规划。"; target.replaceChildren(empty); } return; }
    const planningResult = pageSlice(items, "planningPage");
    const planning = planningResult.items.map((item) => {
      const card = documentRef.createElement("article"); card.className = "evidence-card"; const id = validLogicalId(item.logicalRequirementId);
      const title = documentRef.createElement("h3"); title.textContent = id ? `产品计划 ${id.slice(4)}` : "产品计划 未登记";
      const status = documentRef.createElement("p"); status.textContent = `${DELIVERY_LABELS[item.status] || "待确认"} · ${ACCEPTANCE_LABELS[item.acceptanceStatus] || "验收状态待确认"} · ${STRATEGY_LABELS[item.recommendation?.strategyCode] || "补充受控开发建议"}`;
      const scope = documentRef.createElement("p"); scope.className = "muted"; scope.textContent = `优先级：${safeEnum(item.recommendation?.priority, ["P0", "P1", "P2"], "待分级")}；责任流程：${/^T\d{2}$/.test(String(item.recommendation?.ownerProcess || "")) ? item.recommendation.ownerProcess : "待分派"}；目标能力：${textList(validCapabilityIds(item.recommendation?.targetCapabilityIds))}`;
      card.append(title, status, scope); const actions = documentRef.createElement("div"); actions.className = "action-row";
      const actionAllowed = item.actionAllowed !== false && item.status !== "source-stale";
      if (actionAllowed && item.status === "awaiting-plan") actions.append(lifecycleButton(documentRef, "纳入下一版本", item, { action: "plan", releaseWindow: "next-release" }));
      if (actionAllowed && item.status === "planned") actions.append(lifecycleButton(documentRef, "开始实施", item, { action: "start-delivery" }));
      if (actionAllowed && item.status === "repository-verified") actions.append(lifecycleButton(documentRef, "申请交付验收", item, { action: "request-acceptance" }));
      if (actionAllowed && item.status === "acceptance-review") {
        const independence = documentRef.createElement("p"); independence.className = "muted"; independence.textContent = "验收结论须由不同于申请人的授权账号执行；平台仅保存身份摘要。"; card.append(independence);
        actions.append(lifecycleButton(documentRef, "确认验收通过", item, { action: "accept-delivery" }), lifecycleButton(documentRef, "退回补充交付证据", item, { action: "return-delivery" }));
      }
      if (actionAllowed && item.status === "acceptance-returned") actions.append(lifecycleButton(documentRef, "整改后重新提交", item, { action: "resubmit-delivery" }));
      if (!actionAllowed) { const stale = documentRef.createElement("p"); stale.className = "muted"; stale.textContent = "来源需求或复核结论已变化，请重新复核并建立新计划；当前计划不可操作。"; card.append(stale); }
      if ((actions.children || []).length) card.append(actions); return card;
    });
    const evidenceResult = pageSlice(items, "evidencePage");
    const evidenceCards = evidenceResult.items.map((item) => {
      const card = documentRef.createElement("article"); card.className = "evidence-card"; const id = validLogicalId(item.logicalRequirementId);
      const title = documentRef.createElement("h3"); title.textContent = id ? `交付证据 ${id.slice(4)}` : "交付证据 未登记";
      const status = documentRef.createElement("p"); status.textContent = `${DELIVERY_LABELS[item.status] || "待确认"} · ${ACCEPTANCE_LABELS[item.acceptanceStatus] || "验收状态待确认"} · 已核验 ${safeCount(item.verifiedEvidence)} / ${safeCount(item.requiredEvidence)}`; card.append(title, status);
      const actionAllowed = item.actionAllowed !== false && item.status !== "source-stale";
      for (const evidence of Array.isArray(item.evidence) ? item.evidence : []) { const row = documentRef.createElement("p"); row.className = "muted"; row.textContent = `${EVIDENCE_LABELS[evidence.type] || "受控证据"}：${evidence.status === "verified" ? "已独立核验" : evidence.status === "submitted" ? "待独立核验" : "待提交"}`; card.append(row); if (actionAllowed && evidence.status === "submitted") card.append(lifecycleButton(documentRef, `核验${EVIDENCE_LABELS[evidence.type] || "证据"}`, item, { action: "verify-evidence", evidenceType: evidence.type })); }
      if (actionAllowed && ["in-delivery", "evidence-review", "acceptance-returned"].includes(item.status)) {
        const form = documentRef.createElement("div"); form.className = "action-row"; const type = documentRef.createElement("select");
        for (const evidenceType of ["implementation", "test", "review"]) { const option = documentRef.createElement("option"); option.value = evidenceType; option.textContent = EVIDENCE_LABELS[evidenceType]; type.append(option); }
        const input = documentRef.createElement("input"); input.type = "text"; input.placeholder = "sha256: 后跟 64 位小写摘要"; input.setAttribute?.("aria-label", "证据摘要");
        const submit = documentRef.createElement("button"); const commandKey = root.HealthPlatformApi?.newCorrelationId?.() || `evidence-${Date.now()}-${Math.random().toString(16).slice(2)}`; submit.type = "button"; submit.className = "secondary-button"; submit.textContent = "提交证据摘要";
        submit.addEventListener("click", async () => { if (!/^sha256:[a-f0-9]{64}$/.test(input.value || "")) { announcement("请输入有效的 SHA-256 证据摘要。"); return; } submit.disabled = true; try { await postLifecycle(item, { action: "submit-evidence", evidenceType: type.value, evidenceDigest: input.value }, commandKey); announcement("证据摘要已提交，等待独立核验。"); await refreshCenter(); } catch (error) { announcement(error?.status === 409 ? "状态已变化，请重新确认。" : "证据提交未完成，请重试。"); submit.disabled = false; } });
        form.append(type, input, submit); card.append(form);
      }
      return card;
    });
    planningTarget.replaceChildren(pagination(documentRef, planningResult, "planningPage", "产品规划"), ...planning);
    evidenceTarget.replaceChildren(pagination(documentRef, evidenceResult, "evidencePage", "交付证据"), ...evidenceCards);
  }

  function safeExportBundle(bundle) {
    if (!bundle || bundle.schemaVersion !== "procurement-requirement-governance-export-v1" || bundle.productionReady !== false) return null;
    const summaryKeys = ["documents", "sourceSeries", "documentRevisions", "historicalRevisions", "revisionComparisons", "added", "changed", "withdrawn", "candidates", "pendingReview", "accepted", "revisionRequired", "rejected", "coveredInRepository", "gaps", "planned", "repositoryVerified", "acceptanceReview", "acceptanceReturned", "deliveryAccepted", "stalePlans"];
    const summary = Object.fromEntries(summaryKeys.map((key) => [key, safeCount(bundle.summary?.[key])]));
    const requirements = (Array.isArray(bundle.requirements) ? bundle.requirements : []).flatMap((item) => {
      const logicalRequirementId = validLogicalId(item?.logicalRequirementId); const seriesId = validSeriesId(item?.seriesId);
      if (!logicalRequirementId || !seriesId) return [];
      const evidence = (Array.isArray(item.evidence) ? item.evidence : []).flatMap((entry) => {
        const type = safeEnum(entry?.type, Object.keys(EVIDENCE_LABELS), ""); const status = safeEnum(entry?.status, ["missing", "submitted", "verified"], "");
        if (!type || !status) return [];
        return [{ type, status, digest: validDigest(entry?.digest) }];
      });
      return [{
        logicalRequirementId,
        seriesId,
        sourceRevision: Number.isSafeInteger(item.sourceRevision) && item.sourceRevision > 0 ? item.sourceRevision : 0,
        status: safeEnum(item.status, Object.keys(DELIVERY_LABELS), "awaiting-plan"),
        priorStatus: safeEnum(item.priorStatus, ["", ...Object.keys(DELIVERY_LABELS).filter((status) => status !== "source-stale")], ""),
        sourceCurrent: item.sourceCurrent === true,
        acceptanceStatus: safeEnum(item.acceptanceStatus, Object.keys(ACCEPTANCE_LABELS), "not-requested"),
        releaseWindow: safeEnum(item.releaseWindow, ["", "current-release", "next-release", "backlog"], ""),
        strategyCode: safeEnum(item.strategyCode, Object.keys(STRATEGY_LABELS), "VERIFY_REPOSITORY_EVIDENCE"),
        ownerProcess: /^T\d{2}$/.test(String(item.ownerProcess || "")) ? String(item.ownerProcess) : "",
        priority: safeEnum(item.priority, ["P0", "P1", "P2"], "P2"),
        targetCapabilityIds: validCapabilityIds(item.targetCapabilityIds),
        evidence
      }];
    });
    const generated = new Date(bundle.generatedAt || 0);
    return {
      schemaVersion: "procurement-requirement-governance-export-v1",
      generatedAt: Number.isNaN(generated.getTime()) ? new Date().toISOString() : generated.toISOString(),
      productionReady: false,
      summary,
      requirements,
      boundary: "台账证明本地需求治理、仓库证据核验和独立交付验收闭环；不包含招标原文、路径或地域机构信息，生产授权仍保持关闭。"
    };
  }

  function downloadExport(bundle) {
    const safeBundle = safeExportBundle(bundle);
    if (!safeBundle || typeof root.Blob !== "function" || !root.URL?.createObjectURL) return;
    const link = document.createElement("a"); const url = root.URL.createObjectURL(new root.Blob([`${JSON.stringify(safeBundle, null, 2)}\n`], { type: "application/json;charset=utf-8" }));
    if (root.HealthBrowserSafeUrl?.setElementUrl) root.HealthBrowserSafeUrl.setElementUrl(link, "href", url, { capability: "blob-download", baseUrl: root.location }); else link.href = url;
    link.download = `招标需求治理台账-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.json`; link.click(); root.URL.revokeObjectURL?.(url);
  }

  function bindStaticControls() {
    const exportButton = document.querySelector("#export-platform-procurement-governance"); if (exportButton && exportButton.dataset.bound !== "true") { exportButton.dataset.bound = "true"; exportButton.addEventListener("click", () => downloadExport(state.report?.requirementDelivery?.exportBundle)); }
    const input = document.querySelector("#platform-procurement-import-artifact");
    const importTrigger = document.querySelector("#platform-procurement-import-trigger"); if (input && importTrigger && importTrigger.dataset.bound !== "true") { importTrigger.dataset.bound = "true"; importTrigger.addEventListener("click", () => input.click()); }
    if (input && input.dataset.bound !== "true") { input.dataset.bound = "true"; input.addEventListener("change", async () => { const file = input.files?.[0]; if (!file || file.size > 2 * 1024 * 1024) { announcement("请选择不超过 2MB 的脱敏 JSON 文件。"); return; } try { const artifact = JSON.parse(await file.text()); await root.HealthPlatformApi.createClient().post("/platform/productization/requirement-batches", { expectedVersion: safeCount(state.report?.requirementGovernance?.catalogRegistrationVersion), artifact }); announcement("脱敏导入文件已登记，新候选已进入需求池。"); input.value = ""; await refreshCenter(); } catch (error) { announcement(error?.status === 409 ? "目录已更新，请刷新后重新登记。" : "导入文件未通过受控校验。"); } }); }
  }

  function renderProcurementCenter(report, options = {}) {
    if (!report) return; state.report = report; if (typeof options.refresh === "function") state.refresh = options.refresh;
    const governance = report.requirementGovernance || { summary: {}, items: [], revisionComparisons: [] }; const delivery = report.requirementDelivery || { summary: {}, items: [] };
    const version = document.querySelector("#platform-procurement-requirement-version"); const metrics = document.querySelector("#platform-procurement-governance-metrics");
    if (version) { version.textContent = governance.schemaVersion === "procurement-requirement-governance-view-v2" && delivery.schemaVersion === "procurement-requirement-delivery-view-v1" ? "完整治理闭环已就绪 · 生产未授权" : "治理视图未登记 · 生产未授权"; version.dataset.productionReady = "false"; }
    if (metrics) metrics.innerHTML = [metric("来源系列", safeCount(governance.summary?.sourceSeries)), metric("候选需求", safeCount(governance.summary?.candidates)), metric("待人工复核", safeCount(governance.summary?.pendingReview)), metric("已采纳", safeCount(governance.summary?.accepted)), metric("待规划", safeCount(delivery.summary?.awaitingPlan)), metric("实施中", safeCount(delivery.summary?.inDelivery)), metric("证据待补", safeCount(delivery.summary?.evidenceMissing)), metric("仓库证据已核验", safeCount(delivery.summary?.repositoryVerified)), metric("待独立验收", safeCount(delivery.summary?.acceptanceReview)), metric("验收已退回", safeCount(delivery.summary?.acceptanceReturned)), metric("交付验收通过", safeCount(delivery.summary?.deliveryAccepted)), metric("来源失效计划", safeCount(delivery.summary?.stalePlans))].join("");
    renderRequirementFilters(governance, document.querySelector("#platform-procurement-governance-filters")); renderRequirementGovernance(governance, document.querySelector("#platform-procurement-requirement-workbench")); renderRevisionComparisons(governance, document.querySelector("#platform-procurement-revision-comparisons")); renderDelivery(delivery, document.querySelector("#platform-procurement-product-planning"), document.querySelector("#platform-procurement-delivery-evidence"));
    const boundary = document.querySelector("#platform-procurement-governance-boundary"); if (boundary) boundary.textContent = delivery.boundary || governance.boundary || "仓库交付验收闭环已受控，生产授权仍保持关闭。"; bindStaticControls();
  }

  root.HealthPlatformProcurementGovernanceUi = Object.freeze({ downloadExport, render: renderProcurementCenter, renderDelivery, renderRequirementGovernance, renderRevisionComparisons, safeExportBundle });
})(typeof globalThis === "object" ? globalThis : this);
