const fallbackState = { residents: [], diseases: [], followups: [], personalRecords: [], careOrders: [], insuranceClaims: [], referralTeleconsultations: [], registrationSchedules: [], registrationOrders: [], medicationPickups: [], chronicScreeningTasks: [], chronicManagementPlans: [], chronicFollowupStatusPolicy: {}, deathCertificates: [], deathCertificateForms: [], deathStatistics: {}, birthCertificates: [], birthCertificateForms: [], birthCertificateDocuments: [], birthStatistics: {}, doctorProfiles: [], multiPracticeApplications: [], multiPracticePolicy: {}, taskMessages: [], phase2FamilyDoctorTemplates: [], phase2FamilyDoctorTeams: [], phase2FamilyDoctorServicePackages: [], phase2FamilyDoctorApplications: [], phase2FamilyDoctorContracts: [], phase2FamilyDoctorFulfillments: [] };
const institutionApiBase = location.protocol === "file:" || location.hostname.endsWith("github.io") ? "" : "/api";
let platformState = fallbackState;
let institutionRegistrationDashboard = null;

document.addEventListener("DOMContentLoaded", async () => {
  platformState = await loadPlatformState(fallbackState);
  const [followupSummary, launchCore, publicHealthLoop, registrationDashboard] = await Promise.all([loadChronicFollowupSummary(), loadChronicLaunchCore(), loadChronicPublicHealthLoop(), loadRegistrationJourneyDashboard()]);
  platformState.chronicFollowupSummary = followupSummary;
  platformState.chronicLaunchCore = launchCore;
  platformState.chronicPublicHealthLoop = publicHealthLoop;
  institutionRegistrationDashboard = registrationDashboard;
  bindInstitutionActions();
  renderAll(platformState);
});

async function loadChronicFollowupSummary() {
  if (!institutionApiBase) return null;
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${institutionApiBase}/chronic/followup-summary`);
    if (response.ok) return await response.json();
  } catch (error) {
    // Static preview falls back to local snapshot evidence.
  }
  return null;
}

async function loadChronicLaunchCore() {
  if (!institutionApiBase) return null;
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${institutionApiBase}/chronic/launch-core`);
    if (response.ok) return await response.json();
  } catch (error) {
    // Static preview falls back to local snapshot evidence.
  }
  return null;
}

async function loadChronicPublicHealthLoop() {
  if (!institutionApiBase) return null;
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${institutionApiBase}/chronic/public-health-loop`);
    if (response.ok) return await response.json();
  } catch (error) {
    // Static preview falls back to local snapshot evidence.
  }
  return null;
}

async function loadRegistrationJourneyDashboard() {
  if (institutionApiBase) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${institutionApiBase}/registrations/dashboard`);
      if (response.ok) return await response.json();
    } catch (error) {
      // Static preview uses the scoped registration collections.
    }
  }
  return {
    ok: true,
    schedules: platformState.registrationSchedules || [],
    orders: platformState.registrationOrders || [],
    journey: { status: "static-preview", productionReady: 0, onsiteBlockers: 4, boundary: "Static registration journey preview; production integrations remain required." }
  };
}

async function refreshChronicRuntimeState() {
  const [followupSummary, launchCore, publicHealthLoop] = await Promise.all([loadChronicFollowupSummary(), loadChronicLaunchCore(), loadChronicPublicHealthLoop()]);
  if (followupSummary) platformState.chronicFollowupSummary = followupSummary;
  if (launchCore) platformState.chronicLaunchCore = launchCore;
  if (publicHealthLoop) platformState.chronicPublicHealthLoop = publicHealthLoop;
}

function renderAll(state) {
  renderChronicLaunchCore(state);
  renderChronicPublicHealthLoop(state);
  renderChronicFollowupWorkbench(state);
  renderPhase2FamilyDoctorContracts(state);
  populateBirthCertificateForm(state);
  populateMultiPracticeForm(state);
  renderMetrics(state);
  renderDoctorAccounts(state);
  renderMultiPracticePolicy(state);
  renderMultiPracticeApplications(state);
  renderCareOrders(state);
  renderAuthorizedRecords(state);
  renderClaimLinks(state);
  renderReferralCenter(state);
  renderRegistrationJourneyWorkbench(state);
  renderTeleconsultationLoop(state);
  renderReservedResources(state);
  renderIntegratedProfiles(state);
  renderStandardArchiveProfiles(state);
  renderInstitutionAudit(state);
  renderPickups(state);
  renderDeathCertificates(state);
  renderBirthCertificates(state);
}

function bindInstitutionActions() {
  document.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-workflow-action]");
      const launchCoreButton = event.target.closest("[data-launch-core-action]");
      const integrationButton = event.target.closest("[data-chronic-integration]");
      const familyDoctorReviewButton = event.target.closest("[data-family-doctor-review]");
      const familyDoctorFulfillmentButton = event.target.closest("[data-family-doctor-fulfillment]");
      const registrationJourneyButton = event.target.closest("[data-registration-institution-action]");
      if (registrationJourneyButton) {
        registrationJourneyButton.disabled = true;
        const result = await runInstitutionRegistrationJourneyAction(registrationJourneyButton.dataset.registrationId, registrationJourneyButton.dataset.registrationInstitutionAction);
        registrationJourneyButton.disabled = false;
        if (result.ok) renderAll(platformState);
        return;
      }
      if (familyDoctorReviewButton) {
        familyDoctorReviewButton.disabled = true;
        const result = await reviewFamilyDoctorApplication(familyDoctorReviewButton.dataset.applicationId, familyDoctorReviewButton.dataset.familyDoctorReview || "approved");
        familyDoctorReviewButton.disabled = false;
        if (result.ok) renderAll(platformState);
        return;
      }
      if (familyDoctorFulfillmentButton) {
        familyDoctorFulfillmentButton.disabled = true;
        const result = await recordFamilyDoctorFulfillment(familyDoctorFulfillmentButton.dataset.contractId);
        familyDoctorFulfillmentButton.disabled = false;
        if (result.ok) renderAll(platformState);
        return;
      }
      if (launchCoreButton) {
        launchCoreButton.disabled = true;
        const result = await recordLaunchCoreAction(launchCoreButton.dataset.itemId, launchCoreButton.dataset.rowId);
        launchCoreButton.disabled = false;
        if (result.ok) renderAll(platformState);
        return;
      }
      if (integrationButton) {
        integrationButton.disabled = true;
        const result = await runChronicIntegrationDemo(integrationButton.dataset.chronicIntegration);
        integrationButton.disabled = false;
        if (result.ok) renderAll(platformState);
        return;
      }
      if (!button) return;
    if (button.dataset.chronicDispatch) {
      button.disabled = true;
      const result = await dispatchChronicFollowup(button.dataset.collection, button.dataset.id, JSON.parse(button.dataset.updates || "{}"), button.dataset.note || "chronic follow-up disposition");
      button.disabled = false;
      if (result.ok) renderAll(platformState);
      return;
    }
    if (button.dataset.chronicEscalation) {
      button.disabled = true;
      const result = await escalateChronicFollowup(button.dataset.collection, button.dataset.id, button.dataset.reason || "chronic follow-up escalation");
      button.disabled = false;
      if (result.ok) renderAll(platformState);
      return;
    }
    const updates = JSON.parse(button.dataset.updates || "{}");
    button.disabled = true;
    const result = await updateWorkflowAction(platformState, button.dataset.collection, button.dataset.id, updates, button.dataset.note || "机构端更新业务状态");
    button.disabled = false;
    if (result.ok) renderAll(platformState);
  });
  document.querySelector("#birth-certificate-form")?.addEventListener("submit", submitBirthCertificate);
  document.querySelector("#birth-status-filter")?.addEventListener("change", () => renderBirthCertificates(platformState));
  document.querySelector("#birth-risk-filter")?.addEventListener("change", () => renderBirthCertificates(platformState));
  document.querySelector("#multi-practice-form")?.addEventListener("submit", submitMultiPracticeApplication);
  document.querySelector("#chronic-priority-filter")?.addEventListener("change", () => renderChronicFollowupWorkbench(platformState));
  document.querySelector("#chronic-type-filter")?.addEventListener("change", () => renderChronicFollowupWorkbench(platformState));
  document.querySelector("#chronic-sort")?.addEventListener("change", () => renderChronicFollowupWorkbench(platformState));
  document.querySelector("#chronic-search")?.addEventListener("input", () => renderChronicFollowupWorkbench(platformState));
  document.querySelector("#chronic-clear-filters")?.addEventListener("click", () => {
    const priority = document.querySelector("#chronic-priority-filter");
    const type = document.querySelector("#chronic-type-filter");
    const sort = document.querySelector("#chronic-sort");
    const search = document.querySelector("#chronic-search");
    if (priority) priority.value = "all";
    if (type) type.value = "all";
    if (sort) sort.value = "priority";
    if (search) search.value = "";
    renderChronicFollowupWorkbench(platformState);
  });
}

function actionButton(collection, id, label, updates, note) {
  return `<button class="inline-action" type="button" data-workflow-action data-collection="${collection}" data-id="${id}" data-updates='${JSON.stringify(updates)}' data-note="${note || label}">${label}</button>`;
}

function chronicDispatchButton(collection, id, label, updates, note) {
  return `<button class="inline-action" type="button" data-workflow-action data-chronic-dispatch="true" data-collection="${collection}" data-id="${id}" data-updates='${JSON.stringify(updates)}' data-note="${note || label}">${label}</button>`;
}

function chronicEscalationButton(collection, id, reason) {
  return `<button class="inline-action" type="button" data-workflow-action data-chronic-escalation="true" data-collection="${collection}" data-id="${id}" data-reason="${reason || "priority chronic follow-up escalation"}">升级处置</button>`;
}

function fallbackChronicLaunchCore(state) {
  const items = [
    ["institution-systems", "Institution systems", "chronicExternalIntegrations", "institution-integration"],
    ["identity-scope", "Identity scope", "chronicIdentityScopes", "identity-integration"],
    ["message-channels", "Message channels", "chronicMessageChannels", "message-platform"],
    ["quality-model", "Quality model", "chronicModelGovernance", "chronic-quality-office"],
    ["pharmacy-insurance", "Pharmacy insurance", "chronicPharmacyInsuranceLinks", "pharmacy-insurance"]
  ].map(([id, title, collection, owner]) => {
    const rows = state[collection] || [];
    return {
      id,
      title,
      owner,
      collection,
      ready: rows.length > 0,
      collectionEvidence: { rows: rows.length, readyRows: rows.length },
      closureEvidence: { rows: rows.length, readyRows: rows.length, rowsDetail: rows.slice(0, 2) }
    };
  });
  return {
    ok: items.every((item) => item.ready),
    summary: {
      items: items.length,
      readyItems: items.filter((item) => item.ready).length,
      closureRows: items.reduce((sum, item) => sum + (item.closureEvidence?.rows || 0), 0),
      signoffs: (state.chronicLaunchCoreSignoffs || []).length,
      signedSignoffs: (state.chronicLaunchCoreSignoffs || []).filter((item) => String(item.signoffStatus || "").toLowerCase() === "signed").length
    },
    items
  };
}

function launchCoreActionButton(item) {
  const row = (item.closureEvidence?.rowsDetail || [])[0] || {};
  const rowId = row.id || row.itemId || item.id;
  return `<button class="inline-action" type="button" data-launch-core-action data-item-id="${item.id}" data-row-id="${rowId}">Record closure</button>`;
}

function renderChronicLaunchCore(state) {
  const summaryEl = document.querySelector("#chronic-launch-core-summary");
  const gridEl = document.querySelector("#chronic-launch-core");
  if (!summaryEl || !gridEl) return;
  const report = state.chronicLaunchCore || fallbackChronicLaunchCore(state);
  const signoffs = report.summary?.signoffs || 0;
  const signedSignoffs = report.summary?.signedSignoffs || 0;
  summaryEl.textContent = `${report.summary?.readyItems || 0}/${report.summary?.items || 0} ready - ${report.summary?.closureRows || 0} closure rows - ${signedSignoffs}/${signoffs} signoffs`;
  gridEl.innerHTML = (report.items || []).map((item) => {
    const rows = item.collectionEvidence || {};
    const closure = item.closureEvidence || {};
    return `<article class="claim-card">
      <strong>${item.title}</strong>
      <span>${item.ready ? "PASS" : "PENDING"}<br>${item.collection} - ${rows.readyRows || 0}/${rows.rows || 0}<br>closure - ${closure.readyRows || 0}/${closure.rows || 0}<br>${item.owner}</span>
      <div class="action-row">${launchCoreActionButton(item)}</div>
    </article>`;
  }).join("");
}

async function recordLaunchCoreAction(itemId, rowId) {
  if (!institutionApiBase) {
    platformState.chronicLaunchCore = fallbackChronicLaunchCore(platformState);
    return { ok: true };
  }
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${institutionApiBase}/chronic/launch-core/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemId,
        rowId,
        action: "site closure confirmation",
        completionStatus: "closed",
        receiptStatus: "accepted",
        reviewStatus: "approved",
        signoffStatus: "signed",
        note: "institution launch core closure recorded from portal"
      })
    });
    if (!response.ok) throw new Error(`launch core action failed: ${response.status}`);
    const saved = await response.json();
    platformState.chronicLaunchCore = saved.launchCore || await loadChronicLaunchCore();
    return { ok: true };
  } catch (error) {
    alert(error.message || "launch core action failed");
    return { ok: false };
  }
}

function chronicClosed(state, status) {
  const closed = state.chronicFollowupStatusPolicy?.statusGroups?.closed || [];
  return closed.some((item) => String(status || "").includes(item) || String(item || "").includes(String(status || "")));
}

function chronicPriority(item) {
  const status = `${item.status || ""} ${item.riskLevel || ""} ${item.grade || ""}`.toLowerCase();
  const due = item.due ? new Date(`${String(item.due).slice(0, 10)}T00:00:00`) : null;
  const days = due && !Number.isNaN(due.getTime()) ? Math.round((due.getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000) : 999;
  if (/overdue|alert|high|critical/.test(status) || String(item.status || "").includes("閫炬湡") || days < 0) return "critical";
  if (days <= 3 || /warning/.test(status) || String(item.status || "").includes("棰勮")) return "high";
  if (days <= 7) return "medium";
  return "low";
}

function filterChronicWorkbenchRows(rows, state) {
  const priority = document.querySelector("#chronic-priority-filter")?.value || "all";
  const type = document.querySelector("#chronic-type-filter")?.value || "all";
  const search = String(document.querySelector("#chronic-search")?.value || "").trim().toLowerCase();
  const sort = document.querySelector("#chronic-sort")?.value || "priority";
  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  return rows.map((item) => {
    const resident = residentOf(state, item.residentId);
    const itemPriority = chronicPriority(item);
    return {
      ...item,
      itemPriority,
      searchText: [resident?.name, item.title, item.collection, item.status, item.due, item.assignee, item.owner, item.pharmacy, item.nextStep, item.intervention, item.advice, item.result].filter(Boolean).join(" ").toLowerCase()
    };
  }).filter((item) =>
    (priority === "all" || item.itemPriority === priority) &&
    (type === "all" || item.collection === type) &&
    (!search || item.searchText.includes(search))
  ).sort((a, b) => {
    if (sort === "resident") return String(residentOf(state, a.residentId)?.name || "").localeCompare(String(residentOf(state, b.residentId)?.name || ""));
    if (sort === "due") return String(a.due || "").localeCompare(String(b.due || ""));
    return (rank[a.itemPriority] ?? 9) - (rank[b.itemPriority] ?? 9) || String(a.due || "").localeCompare(String(b.due || ""));
  });
}

function renderChronicFollowupWorkbench(state) {
  const summaryEl = document.querySelector("#chronic-followup-summary");
  const metricsEl = document.querySelector("#chronic-followup-metrics");
  const listEl = document.querySelector("#chronic-followup-workbench");
  if (!summaryEl || !metricsEl || !listEl) return;
  const feedback = (state.personalRecords || []).filter((item) => item.category === "chronic-feedback" || item.meta?.followupFeedback);
  const openFollowups = (state.followups || []).filter((item) => !chronicClosed(state, item.status));
  const openPlans = (state.chronicManagementPlans || []).filter((item) => !chronicClosed(state, item.status));
  const openScreenings = (state.chronicScreeningTasks || []).filter((item) => !chronicClosed(state, item.status));
  const pendingMedication = (state.medicationPickups || []).filter((item) => !chronicClosed(state, item.status || item.pharmacyStatus));
  summaryEl.textContent = `${openFollowups.length + openPlans.length + openScreenings.length} 项待处置`;
  const apiSummary = state.chronicFollowupSummary?.summary || {};
  if (apiSummary.alerts !== undefined) {
    summaryEl.textContent = `${openFollowups.length + openPlans.length + openScreenings.length} 项待处置 · ${apiSummary.highPriorityAlerts || 0} 项高优先级 · ${apiSummary.policyAligned || 0}/${apiSummary.policyItems || 0} 政策覆盖`;
  }
  metricsEl.innerHTML = [
    ["筛查分级", openScreenings.length, "高风险发现与分级评估"],
    ["管理计划", openPlans.length, "复核、升级预警、下次随访"],
    ["院后随访", openFollowups.length, "逾期、待随访、复诊提醒"],
    ["用药依从", pendingMedication.length, "固定取药与长处方闭环"],
    ["居民反馈", feedback.length, "居民端主动回填"]
  ].map(([label, value, hint]) => `<article class="claim-card"><strong>${label}</strong><span>${value}<br>${hint}</span></article>`).join("");

  const rows = filterChronicWorkbenchRows([
    ...openScreenings.map((item) => ({ ...item, collection: "chronicScreeningTasks", title: item.taskName, due: item.due, primary: "完成评估", updates: { status: "已评估", result: "已生成风险分级和干预建议" } })),
    ...openPlans.map((item) => ({ ...item, collection: "chronicManagementPlans", title: `${item.diseaseType}管理计划`, due: item.nextReview, primary: "复核完成", updates: { status: "已复核", intervention: "已完成阶段复核并更新管理方案" } })),
    ...openFollowups.map((item) => ({ ...item, collection: "followups", title: `${item.diseaseType}随访`, due: item.plannedAt, primary: "完成随访", updates: { status: "已完成", result: "已完成院后随访并同步居民反馈" } })),
    ...pendingMedication.map((item) => ({ ...item, collection: "medicationPickups", title: item.medication, due: item.nextPickup, primary: "确认依从", updates: { status: "已完成", pharmacyStatus: "已取药" } }))
  ], state).slice(0, 12);
  listEl.innerHTML = rows.map((item) => {
    const resident = residentOf(state, item.residentId);
    const latestFeedback = feedback.find((record) => record.residentId === item.residentId);
    return `<section class="item">
      <div>
        <h3>${resident?.name || "未知居民"} · ${item.title || item.id}</h3>
        <p>${item.collection} · ${item.status || "待处理"} · ${item.due || "待排期"} · ${item.assignee || item.owner || item.pharmacy || "责任人待定"}</p>
        <p>${item.nextStep || item.intervention || item.advice || item.result || "按慢病随访计划处置"}</p>
        <p>居民反馈：${latestFeedback ? `${latestFeedback.result} · ${latestFeedback.meta?.nextRequest || ""}` : "暂无新增反馈"}</p>
        <div class="action-row">
          ${chronicDispatchButton(item.collection, item.id, item.primary, item.updates, `慢病随访处置：${item.primary}`)}
          ${item.collection === "chronicManagementPlans" ? chronicDispatchButton(item.collection, item.id, "升级预警", { status: "预警中", intervention: "已升级家庭医生重点管理" }, "慢病管理计划升级预警") : ""}
          ${["critical", "high"].includes(item.itemPriority) ? chronicEscalationButton(item.collection, item.id, `priority ${item.itemPriority} chronic follow-up escalation`) : ""}
        </div>
      </div>
      <span class="badge ${String(item.status || "").includes("逾期") || String(item.status || "").includes("预警") ? "danger" : "warn"}">${item.status || "待处理"}</span>
    </section>`;
  }).join("") || `<p class="muted">暂无待处置慢病随访事项。</p>`;
}

function familyDoctorPackageName(state, packageId) {
  const item = (state.phase2FamilyDoctorServicePackages || []).find((row) => row.id === packageId);
  return item?.name || packageId || "服务包待确认";
}

function familyDoctorTeamName(state, teamId) {
  const item = (state.phase2FamilyDoctorTeams || []).find((row) => row.id === teamId);
  return item?.teamName || item?.institutionName || teamId || "团队待确认";
}

function renderPhase2FamilyDoctorContracts(state) {
  const summaryEl = document.querySelector("#phase2-family-doctor-summary");
  const gridEl = document.querySelector("#phase2-family-doctor-contracts");
  const applicationsEl = document.querySelector("#phase2-family-doctor-applications");
  const fulfillmentsEl = document.querySelector("#phase2-family-doctor-fulfillments");
  if (!summaryEl || !gridEl || !applicationsEl || !fulfillmentsEl) return;
  const teams = state.phase2FamilyDoctorTeams || [];
  const packages = state.phase2FamilyDoctorServicePackages || [];
  const applications = state.phase2FamilyDoctorApplications || [];
  const contracts = state.phase2FamilyDoctorContracts || [];
  const fulfillments = state.phase2FamilyDoctorFulfillments || [];
  const pendingApplications = applications.filter((item) => /pending|submitted|review/i.test(`${item.reviewStatus || ""} ${item.status || ""}`));
  const activeContracts = contracts.filter((item) => /active|renewal/i.test(String(item.status || "")));
  const avgFulfillment = contracts.length ? Math.round(contracts.reduce((sum, item) => sum + Number(item.fulfillmentPercent || 0), 0) / contracts.length) : 0;
  summaryEl.textContent = `${packages.length} 个服务包 · ${applications.length} 条申请 · ${pendingApplications.length} 条待审 · ${activeContracts.length} 份合同 · 平均履约 ${avgFulfillment}%`;
  gridEl.innerHTML = [
    ["签约团队", teams.length, teams.map((item) => item.teamName || item.id).join(" / ") || "暂无团队"],
    ["服务包", packages.length, packages.map((item) => item.name || item.id).join(" / ") || "暂无服务包"],
    ["待审申请", pendingApplications.length, "居民申请、续约和知情确认"],
    ["合同履约", `${avgFulfillment}%`, `${fulfillments.length} 条履约记录`]
  ].map(([label, value, hint]) => `<article class="claim-card"><strong>${label}</strong><span>${value}<br>${hint}</span></article>`).join("");
  applicationsEl.innerHTML = applications.map((item) => `<section class="item">
    <div>
      <h3>${item.residentName || residentOf(state, item.residentId)?.name || item.residentId} · ${familyDoctorPackageName(state, item.packageId)}</h3>
      <p>${familyDoctorTeamName(state, item.teamId)} · ${item.applicationType || "new-contract"} · ${item.consentStatus || "consent pending"}</p>
      <p>${item.lastAction || "等待机构审核"} · ${item.desiredStartDate || item.submittedAt || "日期待确认"}</p>
      <div class="action-row">
        ${/pending|submitted|review/i.test(`${item.reviewStatus || ""} ${item.status || ""}`) ? `<button class="inline-action" type="button" data-family-doctor-review="approved" data-application-id="${item.id}">审核通过</button><button class="inline-action" type="button" data-family-doctor-review="rejected" data-application-id="${item.id}">退回补充</button>` : ""}
      </div>
    </div>
    <span class="badge ${item.reviewStatus === "approved" ? "info" : item.reviewStatus === "rejected" ? "danger" : "warn"}">${item.reviewStatus || item.status || "pending"}</span>
  </section>`).join("") || `<p class="muted">暂无家庭医生签约申请。</p>`;
  fulfillmentsEl.innerHTML = contracts.map((contract) => {
    const rows = fulfillments.filter((item) => item.contractId === contract.id);
    return `<section class="item">
      <div>
        <h3>${contract.residentName || residentOf(state, contract.residentId)?.name || contract.residentId} · ${familyDoctorPackageName(state, contract.packageId)}</h3>
        <p>${familyDoctorTeamName(state, contract.teamId)} · ${contract.startDate || ""} 至 ${contract.endDate || ""} · 履约 ${contract.fulfillmentPercent || 0}%</p>
        <p>续约 ${contract.renewalStatus || "not-due"} · 满意度 ${contract.satisfactionScore || "待回访"} · 下次服务 ${contract.nextServiceAt || "待排期"}</p>
        <p>${rows.slice(0, 3).map((row) => `${row.serviceItem || row.serviceType}/${row.status}`).join("；") || "暂无履约记录"}</p>
        <div class="action-row"><button class="inline-action" type="button" data-family-doctor-fulfillment data-contract-id="${contract.id}">登记履约</button></div>
      </div>
      <span class="badge info">${contract.status || "active"}</span>
    </section>`;
  }).join("") || `<p class="muted">暂无家庭医生签约合同。</p>`;
}

function syncFamilyDoctorOverview(overview) {
  if (!overview) return;
  platformState.phase2FamilyDoctorTemplates = overview.templates || platformState.phase2FamilyDoctorTemplates || [];
  platformState.phase2FamilyDoctorTeams = overview.teams || platformState.phase2FamilyDoctorTeams || [];
  platformState.phase2FamilyDoctorServicePackages = overview.packages || platformState.phase2FamilyDoctorServicePackages || [];
  platformState.phase2FamilyDoctorApplications = overview.applications || platformState.phase2FamilyDoctorApplications || [];
  platformState.phase2FamilyDoctorContracts = overview.contracts || platformState.phase2FamilyDoctorContracts || [];
  platformState.phase2FamilyDoctorFulfillments = overview.fulfillments || platformState.phase2FamilyDoctorFulfillments || [];
}

async function reviewFamilyDoctorApplication(applicationId, decision) {
  if (!institutionApiBase) {
    const rows = platformState.phase2FamilyDoctorApplications || [];
    const application = rows.find((item) => item.id === applicationId);
    if (application) Object.assign(application, { reviewStatus: decision, status: decision, reviewer: "local-institution", reviewedAt: new Date().toISOString() });
    return { ok: true };
  }
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${institutionApiBase}/phase2/family-doctor-contracts/applications/${encodeURIComponent(applicationId)}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, comment: decision === "approved" ? "机构端审核通过" : "机构端退回补充" })
    });
    if (!response.ok) throw new Error(`family doctor review failed: ${response.status}`);
    const result = await response.json();
    syncFamilyDoctorOverview(result.overview);
    return { ok: true, result };
  } catch (error) {
    alert(error.message || "家庭医生签约审核失败，请检查登录状态和网络连接");
    return { ok: false };
  }
}

async function recordFamilyDoctorFulfillment(contractId) {
  const payload = { serviceType: "institution-followup", serviceItem: "机构端登记家庭医生履约", serviceDate: new Date().toISOString().slice(0, 10), status: "completed", fulfillmentValue: 8, satisfaction: "pending" };
  if (!institutionApiBase) {
    const contracts = platformState.phase2FamilyDoctorContracts || [];
    const contract = contracts.find((item) => item.id === contractId);
    if (contract) contract.fulfillmentPercent = Math.min(100, Number(contract.fulfillmentPercent || 0) + payload.fulfillmentValue);
    platformState.phase2FamilyDoctorFulfillments = [{ id: `p2fdf-local-${Date.now()}`, contractId, ...payload }, ...(platformState.phase2FamilyDoctorFulfillments || [])];
    return { ok: true };
  }
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${institutionApiBase}/phase2/family-doctor-contracts/contracts/${encodeURIComponent(contractId)}/fulfillments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`family doctor fulfillment failed: ${response.status}`);
    const result = await response.json();
    syncFamilyDoctorOverview(result.overview);
    return { ok: true, result };
  } catch (error) {
    alert(error.message || "家庭医生履约登记失败，请检查登录状态和网络连接");
    return { ok: false };
  }
}

async function dispatchChronicFollowup(collection, id, updates, note) {
  if (!institutionApiBase) {
    Object.assign((platformState[collection] || []).find((item) => item.id === id) || {}, updates, { lastUpdated: new Date().toISOString() });
    return { ok: true };
  }
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${institutionApiBase}/chronic/followup-dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collection, id, updates, status: updates.status, note })
    });
    if (!response.ok) throw new Error(`dispatch failed: ${response.status}`);
    const saved = await response.json();
    const rows = platformState[collection] || [];
    const index = rows.findIndex((item) => item.id === id);
    if (index >= 0) rows[index] = saved;
    await refreshChronicRuntimeState();
    return { ok: true, saved };
  } catch (error) {
    alert(error.message || "慢病随访处置失败，请检查登录状态和网络连接");
    return { ok: false };
  }
}

function renderChronicPublicHealthLoop(state) {
  const summaryEl = document.querySelector("#public-health-loop-summary");
  const stageEl = document.querySelector("#public-health-loop-stages");
  const integrationEl = document.querySelector("#public-health-loop-integrations");
  const cdcSummaryEl = document.querySelector("#public-health-cdc-summary");
  const queueEl = document.querySelector("#public-health-loop-queue");
  if (!summaryEl || !stageEl || !queueEl) return;
  const loop = state.chronicPublicHealthLoop;
  const stages = loop?.stages || [
    { id: "monitor", name: "监测", count: (state.chronicScreeningTasks || []).filter((item) => item.riskLevel === "高危").length, evidence: "chronicScreeningTasks", owner: "疾控中心/基层慢病健康管理中心", ready: true },
    { id: "alert", name: "预警", count: state.chronicFollowupSummary?.summary?.highPriorityAlerts || 0, evidence: "followupSummary.alertQueue", owner: "疾控中心/卫健监管", ready: true },
    { id: "dispatch", name: "派单", count: (state.taskMessages || []).filter((item) => item.chronicFollowup && item.targetRole === "institution").length, evidence: "taskMessages", owner: "基层机构管理员", ready: true },
    { id: "intervention", name: "干预", count: (state.personalRecords || []).filter((item) => item.category === "chronic-family-doctor-note" || item.meta?.familyDoctorClosure).length, evidence: "familyDoctorActions", owner: "家庭医生团队", ready: true },
    { id: "followup", name: "随访", count: (state.followups || []).filter((item) => chronicClosed(state, item.status)).length, evidence: "followups", owner: "基层随访团队", ready: true },
    { id: "summary", name: "汇总", count: state.chronicFollowupSummary?.summary?.policyAligned || 0, evidence: "policyAlignment", owner: "卫健委/疾控中心", ready: true }
  ];
  const queue = loop?.queue || [];
  summaryEl.textContent = loop
    ? `${loop.summary.readyStages}/${loop.summary.stages} 环节就绪 · ${loop.summary.highRiskResidents} 名重点人群 · ${loop.summary.immunizationReminders || 0} 条免疫提醒 · ${loop.summary.infectiousSignals || 0} 条传染病信号`
    : "静态快照：监测-预警-派单-干预-随访-汇总闭环已入模";
  stageEl.innerHTML = stages.map((item) => `<article class="claim-card" data-public-health-stage="${item.id}">
    <strong>${item.name}</strong>
    <span>${item.count}<br>${item.owner}<br>${item.evidence}</span>
  </article>`).join("");
  if (integrationEl) {
    const immunization = loop?.immunizationPlanning?.summary || {};
    const infectious = loop?.infectiousDiseaseReporting?.summary || {};
    const cdc = loop?.cdcSummary?.summary || {};
    integrationEl.innerHTML = [
      { id: "immunization-planning", title: "免疫规划联动", value: immunization.dueReminders || 0, detail: `${immunization.targets || 0} 名对象 · ${immunization.completedRecords || 0} 条接种记录` },
      { id: "infectious-reporting", title: "传染病前置报告", value: infectious.signals || 0, detail: `${infectious.infectiousDeaths || 0} 条死亡证线索 · ${infectious.feverClinicSignals || 0} 条发热门诊信号` },
      { id: "cdc-command-summary", title: "疾控汇总视图", value: cdc.commandRows || 0, detail: `${cdc.chronicQueue || 0} 条慢病队列 · ${cdc.infectiousSignals || 0} 条公卫信号` }
    ].map((item) => `<article class="claim-card" data-public-health-integration="${item.id}">
      <strong>${item.title}</strong>
      <span>${item.value}<br>${item.detail}</span>
    </article>`).join("");
  }
  if (cdcSummaryEl) {
    const commandRows = loop?.cdcSummary?.commandRows || [];
    cdcSummaryEl.innerHTML = commandRows.slice(0, 5).map((item) => `<section class="item" data-cdc-command-row="${item.institution}">
      <div>
        <h3>${item.institution}</h3>
        <p>慢病队列 ${item.chronicQueue} · 免疫提醒 ${item.immunizationQueue} · 传染病信号 ${item.infectiousSignals}</p>
      </div>
      <span class="badge ${item.priority === "high" ? "danger" : ""}">${item.priority}</span>
    </section>`).join("") || `<p class="muted">暂无疾控汇总指挥行。</p>`;
  }
  queueEl.innerHTML = queue.slice(0, 6).map((item) => `<section class="item" data-public-health-loop-row="${item.residentId}">
    <div>
      <h3>${item.residentName || "重点居民"} · ${item.warningLevel || "high"}</h3>
      <p>${item.organization || "基层机构"} · ${item.owner || item.dispatchTarget || "责任团队待定"} · ${item.followupDue || "随访时间待定"}</p>
      <p>监测：${item.monitorSignal || "高危/逾期信号"}；派单：${item.dispatchTarget || "基层随访团队"}；干预：${item.intervention || "家庭医生复核"}</p>
      <p>汇总：${item.summaryStatus || "awaiting-feedback"}</p>
    </div>
    <span class="badge danger">公卫预警</span>
  </section>`).join("") || `<p class="muted">暂无公卫高危闭环队列。</p>`;
}
async function escalateChronicFollowup(collection, id, reason) {
  if (!institutionApiBase) {
    Object.assign((platformState[collection] || []).find((item) => item.id === id) || {}, {
      escalationStatus: "escalated",
      escalationReason: reason,
      escalatedAt: new Date().toISOString()
    });
    return { ok: true };
  }
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${institutionApiBase}/chronic/followup-escalations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collection, id, reason })
    });
    if (!response.ok) throw new Error(`escalation failed: ${response.status}`);
    const saved = await response.json();
    const rows = platformState[collection] || [];
    const index = rows.findIndex((item) => item.id === id);
    if (index >= 0 && saved.item) rows[index] = saved.item;
    await refreshChronicRuntimeState();
    return { ok: true, saved };
  } catch (error) {
    alert(error.message || "慢病随访升级失败，请检查登录状态和网络连接");
    return { ok: false };
  }
}

function chronicIntegrationPayload(type) {
  const resident = (platformState.residents || []).find((item) => item.id === "r1") || (platformState.residents || [])[0] || {};
  const pickup = (platformState.medicationPickups || []).find((item) => item.residentId === resident.id) || (platformState.medicationPickups || [])[0] || {};
  const message = (platformState.taskMessages || []).find((item) => item.chronicFollowup && item.targetRole === "institution" && item.residentId === resident.id) || {};
  const residentId = resident.id || pickup.residentId || "r1";
  const today = new Date().toISOString().slice(0, 10);
  if (type === "device") {
    return { path: "/chronic/device-measurements", body: { residentId, externalId: `demo-device-${residentId}-${today}`, deviceId: "bp-device-demo", deviceType: "blood pressure monitor", measurementType: "remote blood pressure", measurementValue: "151/91 mmHg high", medicationTaken: true, note: "device gateway demo upload" } };
  }
  if (type === "pharmacy") {
    return { path: "/chronic/pharmacy-callbacks", body: { medicationPickupId: pickup.id || "mp1", externalId: `demo-pharmacy-${pickup.id || "mp1"}-${today}`, status: "picked_up", pharmacyStatus: "picked_up", medicationTaken: true, inventoryStatus: "dispensed", note: "pharmacy callback demo confirmed" } };
  }
  if (type === "familyDoctor") {
    return { path: "/chronic/family-doctor-actions", body: { residentId, messageId: message.id || "", taskId: message.taskId || "", action: "family doctor phone review", result: "family doctor reviewed resident self-monitoring and updated plan", nextAction: "continue home monitoring for 7 days", servicePack: "hypertension follow-up pack" } };
  }
  return { path: "/chronic/reminder-outreach", body: { residentId, channel: "sms", reminderType: "chronic medication and follow-up reminder", reason: "send pickup and follow-up reminder to resident/family", status: "scheduled" } };
}

async function runChronicIntegrationDemo(type) {
  const status = document.querySelector("#chronic-integration-status");
  const demo = chronicIntegrationPayload(type);
  try {
    if (institutionApiBase) {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${institutionApiBase}${demo.path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(demo.body)
      });
      if (!response.ok) throw new Error(`integration demo failed: ${response.status}`);
      await response.json();
      await refreshChronicRuntimeState();
    }
    if (type === "device") {
      platformState.personalRecords = [{ id: `local-device-${Date.now()}`, residentId: demo.body.residentId, category: "chronic-self-checkin", result: demo.body.measurementValue, source: "device gateway" }, ...(platformState.personalRecords || [])];
    }
    if (type === "pharmacy") {
      const pickup = (platformState.medicationPickups || []).find((item) => item.id === demo.body.medicationPickupId);
      if (pickup) Object.assign(pickup, { status: demo.body.status, pharmacyStatus: demo.body.pharmacyStatus, callbackExternalId: demo.body.externalId });
    }
    if (status) status.textContent = `${type} integration evidence recorded`;
    return { ok: true };
  } catch (error) {
    if (status) status.textContent = error.message || "integration demo failed";
    return { ok: false };
  }
}

function residentOf(state, id) {
  return state.residents.find((item) => item.id === id);
}

function populateMultiPracticeForm(state) {
  const form = document.querySelector("#multi-practice-form");
  const select = form?.querySelector("select[name='doctorId']");
  if (!form || !select) return;
  const doctors = state.doctorProfiles || [];
  select.innerHTML = doctors.map((doctor) => `<option value="${doctor.id}">${doctor.name} · ${doctor.title} · ${doctor.primaryInstitution}</option>`).join("");
  const doctor = doctors[0];
  if (!doctor) return;
  const scopeInput = form.querySelector("input[name='practiceScope']");
  if (scopeInput && !scopeInput.value) scopeInput.value = doctor.practiceScope || "";
  const responsibility = form.querySelector("input[name='responsibility']");
  if (responsibility && !responsibility.value) responsibility.value = "由当事医疗机构和医师按协议依法承担医疗责任";
  const compensation = form.querySelector("input[name='compensation']");
  if (compensation && !compensation.value) compensation.value = "按实际工作时间、工作量和绩效协商结算";
  const insurance = form.querySelector("input[name='insurance']");
  if (insurance && !insurance.value) insurance.value = "已购买医师个人医疗执业保险";
}

async function submitMultiPracticeApplication(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = Object.fromEntries(new FormData(form));
  const payload = {
    ...formData,
    scheduleConflict: form.querySelector("input[name='scheduleConflict']")?.checked || false,
    publicVisible: form.querySelector("input[name='publicVisible']")?.checked !== false
  };
  const submit = form.querySelector("button[type='submit']");
  submit.disabled = true;
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    if (!institutionApiBase) throw new Error("静态预览模式暂不支持提交多点执业申请，请使用本地服务或部署 API");
    const response = await request(`${institutionApiBase}/multi-practice-applications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `多点执业申请提交失败：${response.status}`);
    }
    const saved = await response.json();
    platformState.multiPracticeApplications = [saved, ...(platformState.multiPracticeApplications || [])];
    form.reset();
    populateMultiPracticeForm(platformState);
    renderMultiPracticeApplications(platformState);
  } catch (error) {
    alert(error.message || "多点执业申请提交失败，请检查登录角色和网络连接");
  } finally {
    submit.disabled = false;
  }
}

function formatBirthDateTime(value) {
  if (!value) return new Date().toLocaleString("zh-CN", { hour12: false });
  return String(value).replace("T", " ");
}

function birthCertificateNo() {
  const year = new Date().getFullYear();
  const count = (platformState.birthCertificates || []).length + 1;
  return `B${year}${String(count).padStart(6, "0")}`;
}

function populateBirthCertificateForm(state) {
  const select = document.querySelector("#birth-certificate-form select[name='maternalResidentId']");
  if (!select) return;
  select.innerHTML = (state.residents || []).map((resident) => `<option value="${resident.id}">${resident.name} · ${resident.idCard || resident.phone || resident.organization}</option>`).join("");
  const dateInput = document.querySelector("#birth-certificate-form input[name='birthDateTime']");
  if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().slice(0, 16);
}

async function submitBirthCertificate(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = Object.fromEntries(new FormData(form));
  const mother = residentOf(platformState, formData.maternalResidentId);
  const weight = Number(formData.birthWeight || 0);
  const payload = {
    certificateNo: birthCertificateNo(),
    certificateVersion: "第七版",
    issueType: formData.issueType || "首次签发",
    maternalResidentId: formData.maternalResidentId,
    motherName: mother?.name || "待核验",
    fatherName: formData.fatherName || "待核验",
    newbornName: formData.newbornName || "未命名新生儿",
    newbornGender: formData.newbornGender || "待确认",
    birthDateTime: formatBirthDateTime(formData.birthDateTime),
    birthWeight: weight,
    birthLength: Number(formData.birthLength || 0),
    birthPlace: "医疗卫生机构",
    issuingInstitution: mother?.organization || "本机构",
    issuingPhysician: formData.issuingPhysician || "签发医师待确认",
    materials: ["父母有效身份证件", "分娩信息核验", "首次签发登记表"],
    status: formData.status || "待签发",
    electronicLicenseStatus: formData.status === "已签发" ? "已生成" : "待生成",
    publicSecuritySync: "未共享",
    maternalChildSync: "待入册",
    healthManagementStatus: weight > 0 && weight < 2500 ? "低体重儿专案待建档" : "待建档",
    qualityCheck: "待质控",
    nextService: formData.nextService || (weight > 0 && weight < 2500 ? "低体重儿专案随访与喂养指导" : "新生儿访视、出生缺陷筛查和接种提醒")
  };
  form.querySelector("button[type='submit']").disabled = true;
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    if (!institutionApiBase) throw new Error("静态预览模式暂不支持登记出生医学证明，请使用本地服务或部署 API");
    const response = await request(`${institutionApiBase}/birth-certificates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`出生证明登记失败：${response.status}`);
    await response.json();
    platformState = await loadPlatformState(fallbackState);
    form.reset();
    populateBirthCertificateForm(platformState);
    renderAll(platformState);
  } catch (error) {
    alert(error.message || "出生证明登记失败，请检查登录角色和网络连接");
  } finally {
    form.querySelector("button[type='submit']").disabled = false;
  }
}

function renderDoctorAccounts(state) {
  const doctors = state.doctorProfiles || [];
  const countEl = document.querySelector("#doctor-account-count");
  const listEl = document.querySelector("#doctor-accounts");
  if (!countEl || !listEl) return;
  countEl.textContent = `${doctors.length} 个账户`;
  listEl.innerHTML = doctors.map((doctor) => {
    const registry = doctor.electronicRegistrationVerification || doctor.electronicRegistration || {};
    const registryOk = registry.verificationStatus === "已核验" || registry.verificationStatus === "verified";
    return `<section class="item">
    <div>
      <h3>${doctor.name} · ${doctor.title} · ${doctor.specialty}</h3>
      <p>${doctor.primaryInstitution} · ${doctor.department} · ${doctor.practiceScope}</p>
      <p>执业证号：${doctor.licenseNo} · 注册有效期至 ${doctor.registrationValidUntil} · 考核 ${doctor.assessmentRecords?.slice(-2).join("、") || "待补齐"}</p>
      <p>电子化注册：${registry.sourceSystem || "医师电子化注册系统"} · ${registry.registryId || "待同步"} · ${registry.verificationStatus || "待核验"} · 签章 ${registry.signatureNo || "待签章"}</p>
      <p>关联功能：${(doctor.functions || []).join("、")}</p>
    </div>
    <span class="badge ${doctor.accountStatus === "启用" && registryOk ? "info" : "warn"}">${registryOk ? doctor.accountStatus || "启用" : "注册待核验"}</span>
  </section>`;
  }).join("") || `<p class="muted">暂无医生账户档案。</p>`;
}

function renderMultiPracticePolicy(state) {
  const policy = state.multiPracticePolicy || {};
  const el = document.querySelector("#multi-practice-policy");
  if (!el) return;
  const rules = [
    ["定义", policy.definition || "两个或两个以上医疗机构定期执业"],
    ["资格", (policy.qualificationRules || []).slice(0, 3).join("；")],
    ["协议字段", (policy.agreementFields || []).join("、")],
    ["管理", (policy.managementRules || []).slice(0, 3).join("；")]
  ];
  el.innerHTML = rules.map(([title, detail]) => `<div>
    <strong>${title}</strong>
    <span>${detail || "待配置"}</span>
  </div>`).join("");
}

function renderMultiPracticeApplications(state) {
  const applications = state.multiPracticeApplications || [];
  const messages = state.taskMessages || [];
  const countEl = document.querySelector("#multi-practice-count");
  const listEl = document.querySelector("#multi-practice-applications");
  if (!countEl || !listEl) return;
  countEl.textContent = `${applications.length} 条`;
  listEl.innerHTML = applications.map((item) => {
    const checks = item.compliance || {};
    const documents = item.documentChecks || {};
    const riskFlags = Array.isArray(item.riskFlags) ? item.riskFlags : [];
    const electronic = item.electronicRegistrationVerification || {};
    const confirmation = item.primaryPracticeConfirmation || {};
    const conflictEvidence = Array.isArray(item.scheduleConflictEvidence) ? item.scheduleConflictEvidence : [];
    const externalSync = item.externalSync || {};
    const applicationMessages = messages
      .filter((message) => message.collection === "multiPracticeApplications" && message.sourceId === item.id)
      .slice(0, 3);
    const passed = Object.entries(checks).filter(([key, value]) => key !== "publicHospitalLeaderRestricted" && value).length;
    const total = Object.entries(checks).filter(([key]) => key !== "publicHospitalLeaderRestricted").length || 6;
    const documentBlocked = Object.values(documents).some((value) => value === false) || documents.scheduleConflict === true;
    const blocked = checks.publicHospitalLeaderRestricted || Object.entries(checks).some(([key, value]) => key !== "publicHospitalLeaderRestricted" && !value) || documentBlocked || riskFlags.length > 0;
    const badge = item.status?.includes("待") ? "warn" : item.status?.includes("退回") || blocked ? "danger" : "info";
    return `<section class="item multi-practice-item">
      <div>
        <h3>${item.doctorName} · ${item.primaryInstitution} → ${item.targetInstitution}</h3>
        <p>${item.targetDepartment || "科室待定"} · ${item.period || "期限待定"} · ${item.schedule || "时间待定"}</p>
        <p>任务：${item.tasks || "待补充"} · 范围：${item.practiceScope || "待核验"}</p>
        <p>协议：${item.responsibility || "责任待约定"} · ${item.compensation || "薪酬待约定"} · ${item.insurance || "保险待补充"}</p>
        <div class="standard-tags">
          <span class="badge ${checks.titleQualified ? "info" : "warn"}">职称${checks.titleQualified ? "符合" : "待核"}</span>
          <span class="badge ${checks.fiveYears ? "info" : "warn"}">年限${checks.fiveYears ? "符合" : "待核"}</span>
          <span class="badge ${checks.assessmentQualified ? "info" : "warn"}">考核${checks.assessmentQualified ? "合格" : "待核"}</span>
          <span class="badge ${checks.electronicRegistrationVerified ? "info" : "warn"}">电子注册${checks.electronicRegistrationVerified ? "已核" : "待核"}</span>
          <span class="badge ${checks.registrationInForce ? "info" : "warn"}">注册有效${checks.registrationInForce ? "期内" : "待复核"}</span>
          <span class="badge ${checks.scopeMatched ? "info" : "warn"}">范围${checks.scopeMatched ? "一致" : "待核"}</span>
          <span class="badge ${checks.agreementCompleted ? "info" : "warn"}">协议${checks.agreementCompleted ? "完整" : "待补"}</span>
        </div>
        <div class="standard-tags">
          <span class="badge ${documents.firstPracticeConsent ? "info" : "warn"}">第一执业地点${documents.firstPracticeConsent ? "已确认" : "待确认"}</span>
          <span class="badge ${documents.cooperationAgreement ? "info" : "warn"}">劳务协议${documents.cooperationAgreement ? "完整" : "待补"}</span>
          <span class="badge ${documents.liabilityInsurance ? "info" : "warn"}">责任保险${documents.liabilityInsurance ? "已核" : "待补"}</span>
          <span class="badge ${documents.scheduleConflict ? "danger" : "info"}">排班${documents.scheduleConflict ? "冲突" : "正常"}</span>
          <span class="badge ${documents.publicDisclosure ? "info" : "warn"}">公开${documents.publicDisclosure ? "已纳入" : "未公开"}</span>
        </div>
        ${riskFlags.length ? `<p class="muted">补正提示：${riskFlags.join("、")}</p>` : ""}
        ${conflictEvidence.length ? `<p class="muted">排班冲突：${conflictEvidence.map((row) => `${row.targetInstitution || "其他机构"} ${row.schedule || ""}`).join("；")}</p>` : ""}
        <p>电子化注册：${electronic.registryId || "待同步"} · ${electronic.verificationStatus || "待核验"} · 有效期 ${electronic.validUntil || "待同步"}</p>
        <p>第一执业地点电子确认：${confirmation.status || item.primaryConsent || "待确认"} · ${confirmation.confirmedByOrg || item.primaryInstitution || "第一执业地点"} · 签章 ${confirmation.signatureNo || "待签章"}</p>
        <p>外部同步：电子注册 ${externalSync.electronicRegistration?.status || "待同步"} · 电子签章 ${externalSync.eSignature?.status || "待签"} · HIS/HR ${externalSync.hisHr?.status || "待映射"}</p>
        ${applicationMessages.length ? `<div class="list compact">${applicationMessages.map((message) => `<p><strong>${message.title}</strong>：${message.body || "待处理"} · ${String(message.createdAt || "").slice(0, 16)}</p>`).join("")}</div>` : ""}
        <p>第一执业地点：${item.primaryConsent || "待确认"} · ${item.registrationMode || "注册管理"} · 信息公开：${item.publicVisible ? "公开" : "不公开"} · 校验 ${passed}/${total}</p>
        <div class="action-row">
          ${item.primaryConsent !== "已同意" ? actionButton("multiPracticeApplications", item.id, "同意/报备", { primaryConsent: "已同意", status: "待卫健审核" }, "第一执业地点同意多点执业") : ""}
          ${item.status !== "已备案" ? actionButton("multiPracticeApplications", item.id, "备案通过", { status: "已备案", publicVisible: true }, "多点执业备案通过并公开") : ""}
          ${!String(item.status || "").includes("退回") ? actionButton("multiPracticeApplications", item.id, "退回补正", { action: "return-correction", correctionRequired: "请补齐协议、责任保险或第一执业地点意见" }, "医院端退回补正") : ""}
          ${!String(item.status || "").includes("暂停") ? actionButton("multiPracticeApplications", item.id, "暂停执业", { action: "suspend" }, "排班冲突或监管要求暂停执业") : ""}
          ${!String(item.status || "").includes("撤回") ? actionButton("multiPracticeApplications", item.id, "撤回申请", { action: "withdraw" }, "医生或机构撤回多点执业申请") : ""}
          ${!String(item.status || "").includes("终止") ? actionButton("multiPracticeApplications", item.id, "终止备案", { action: "terminate" }, "终止多点执业备案并退出公开") : ""}
        </div>
      </div>
      <span class="badge ${badge}">${item.status || "待处理"}</span>
    </section>`;
  }).join("") || `<p class="muted">暂无多点执业申请。</p>`;
}

function renderBirthCertificates(state) {
  const certificates = state.birthCertificates || [];
  const forms = state.birthCertificateForms || [];
  const certificateDocuments = state.birthCertificateDocuments || [];
  const statistics = state.birthStatistics || {};
  const metrics = statistics.metrics || {};
  const countEl = document.querySelector("#birth-certificate-count");
  const metricEl = document.querySelector("#birth-certificate-metrics");
  const listEl = document.querySelector("#birth-certificate-list");
  const formsEl = document.querySelector("#birth-certificate-forms");
  const alertsEl = document.querySelector("#birth-certificate-alerts");
  const documentsEl = document.querySelector("#birth-certificate-documents");
  if (!countEl || !metricEl || !listEl || !formsEl) return;

  const statusFilter = document.querySelector("#birth-status-filter")?.value || "";
  const riskFilter = document.querySelector("#birth-risk-filter")?.value || "";
  const filtered = certificates.filter((item) => {
    const statusMatched = !statusFilter || item.status === statusFilter;
    const riskMatched = !riskFilter
      || (riskFilter === "low-weight" && Number(item.birthWeight || 0) > 0 && Number(item.birthWeight || 0) < 2500)
      || (riskFilter === "pending-sync" && (item.publicSecuritySync !== "已共享" || item.maternalChildSync !== "已入册"));
    return statusMatched && riskMatched;
  });
  const metricValue = (key, fallback) => {
    const value = Number(metrics[key]);
    return Number.isFinite(value) ? value : fallback;
  };
  const pendingPublicSecuritySync = metricValue("pendingPublicSecuritySync", certificates.filter((item) => item.publicSecuritySync !== "已共享").length);
  const pendingMaternalChildSync = metricValue("pendingMaternalChildSync", certificates.filter((item) => item.maternalChildSync !== "已入册").length);
  const qualityPending = metricValue("qualityPending", certificates.filter((item) => ["待质控", "待复核", "待补正"].includes(item.qualityCheck)).length);
  const alerts = [
    ["待签发", metricValue("pending", certificates.filter((item) => item.status === "待签发").length), "签发医师、材料和证件编号需核验"],
    ["公安待共享", pendingPublicSecuritySync, "户籍出生登记依据未完成推送"],
    ["妇幼待入册", pendingMaternalChildSync, "妇幼健康管理档案未闭环"],
    ["低体重儿", metricValue("lowBirthWeight", certificates.filter((item) => Number(item.birthWeight || 0) > 0 && Number(item.birthWeight || 0) < 2500).length), "需纳入专案访视和喂养指导"],
    ["质控补正", qualityPending, "材料、编号、签章或共享状态需复核"]
  ];

  countEl.textContent = `${filtered.length}/${certificates.length} 张证明`;
  if (alertsEl) {
    alertsEl.innerHTML = alerts.map(([label, value, hint]) => `<article class="claim-card">
      <strong>${label}</strong>
      <span>${value}<br>${hint}</span>
    </article>`).join("");
  }
  metricEl.innerHTML = [
    ["首次签发", metricValue("firstIssued", certificates.filter((item) => item.issueType === "首次签发").length), "机构内出生直接签发"],
    ["电子证照", metricValue("electronicLicenses", certificates.filter((item) => String(item.electronicLicenseStatus || "").includes("已生成")).length), "第七版编号/条形码"],
    ["公安共享", metricValue("publicSecuritySynced", certificates.filter((item) => String(item.publicSecuritySync || "").includes("已共享")).length), "户口出生登记依据"],
    ["妇幼入册", metricValue("maternalChildSynced", certificates.filter((item) => String(item.maternalChildSync || "").includes("已入册")).length), "新生儿健康管理接续"],
    ["待处理", metricValue("pending", certificates.filter((item) => ["待签发", "待上报"].includes(item.status)).length), "补正、签发或上报"]
  ].map(([label, value, hint]) => `<article class="claim-card">
    <strong>${label}</strong>
    <span>${value}<br>${hint}</span>
  </article>`).join("");

  if (documentsEl) {
    documentsEl.innerHTML = certificateDocuments.map((item) => `<article class="claim-card">
      <strong>${item.name || item.category}</strong>
      <span>${item.serialRange || "待登记"}<br>${(item.controlPoints || []).join("、")}<br>${item.owner || "待明确"} · ${item.status || "待处理"}</span>
    </article>`).join("") || `<p class="muted">暂无出生证明证件文书台账。</p>`;
  }

  listEl.innerHTML = filtered.map((item) => {
    const resident = residentOf(state, item.maternalResidentId || item.residentId);
    const badge = item.status === "待签发" || item.status === "待上报" ? "warn" : item.qualityCheck === "待补正" ? "danger" : "info";
    return `<section class="item">
      <div>
        <h3>${item.newbornName || "未命名新生儿"} · ${item.certificateNo}</h3>
        <p>${item.certificateVersion || "第七版"} · ${item.issueType || "首次签发"} · ${item.birthDateTime} · ${item.newbornGender || "性别待确认"}</p>
        <p>母亲：${item.motherName || resident?.name || "待核验"} · 父亲：${item.fatherName || "待核验"} · 出生体重 ${item.birthWeight || "-"}g</p>
        <p>签发：${item.issuingInstitution || "待明确"} · ${item.issuingPhysician || "待签名"} · 材料 ${Array.isArray(item.materials) ? item.materials.join("、") : "待补齐"}</p>
        <p>共享：电子证照 ${item.electronicLicenseStatus || "待生成"} · 公安 ${item.publicSecuritySync || "未共享"} · 妇幼 ${item.maternalChildSync || "待入册"}</p>
        <p>健康管理：${item.healthManagementStatus || "待建档"} · ${item.nextService || "新生儿访视与接种提醒"}</p>
        <div class="action-row">
          ${item.status === "待签发" ? actionButton("birthCertificates", item.id, "签发", { status: "已签发", electronicLicenseStatus: "已生成", qualityCheck: "通过" }, "签发出生医学证明") : ""}
          ${item.status !== "已上报" && item.maternalChildSync !== "已入册" ? actionButton("birthCertificates", item.id, "上报入册", { status: "已上报", maternalChildSync: "已入册", publicSecuritySync: "已共享", healthManagementStatus: "已建档" }, "出生证明上报并纳入妇幼管理") : ""}
        </div>
      </div>
      <span class="badge ${badge}">${item.status || "待处理"}</span>
    </section>`;
  }).join("") || `<p class="muted">暂无出生医学证明记录。</p>`;

  const documentCards = certificateDocuments.map((item) => `<article class="claim-card">
    <strong>${item.name || item.category}</strong>
    <span>${item.serialRange || "编号范围待登记"}<br>${(item.evidence || []).slice(0, 4).join("、")}<br>${item.owner || "责任方待确认"} · ${item.status || "待处理"}</span>
  </article>`);
  formsEl.innerHTML = [
    ...forms.map((form) => `<article class="claim-card">
      <strong>${form.name}</strong>
      <span>${form.scope}<br>${(form.keyFields || []).slice(0, 4).join("、")}<br>${form.status}</span>
    </article>`),
    ...documentCards
  ].join("") || `<p class="muted">暂无出生证明材料模板。</p>`;
}

function renderMetrics(state) {
  const highRisk = state.residents.filter((item) => assessRisk(item) === "高危").length;
  const pending = state.careOrders.filter((item) => item.status !== "已完成").length;
  const emr = state.personalRecords.filter((item) => item.category === "emr").length;
  const claims = state.insuranceClaims.length;
  document.querySelector("#institution-metrics").innerHTML = [
    ["协同患者", state.residents.length, "来自基层和居民授权"],
    ["高危患者", highRisk, "需专科关注"],
    ["待处理任务", pending, "转诊/复诊/随访"],
    ["医保结算", claims, "与医保中心经办贯通"]
  ].map(([label, value, hint]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong><small>${hint}</small></article>`).join("");
}

function renderCareOrders(state) {
  document.querySelector("#order-count").textContent = `${state.careOrders.length} 项`;
  document.querySelector("#care-orders").innerHTML = state.careOrders.map((order) => {
    const resident = residentOf(state, order.residentId);
    const risk = resident ? assessRisk(resident) : "未知";
    const badge = order.priority === "高" ? "danger" : order.status === "已接诊" ? "" : "warn";
    return `<section class="item">
      <div>
        <h3>${resident?.name || "未知居民"} · ${order.type}</h3>
        <p>${order.institution} · ${order.department} · ${order.date}</p>
        <p>${order.summary}</p>
        <div class="action-row">
          ${order.status === "待接诊" ? actionButton("careOrders", order.id, "接诊", { status: "已接诊", institutionReview: "已接诊" }, "医疗机构接诊协同任务") : ""}
          ${order.status !== "已完成" ? actionButton("careOrders", order.id, "完成", { status: "已完成", result: "已完成诊疗协同" }, "医疗机构完成协同任务") : ""}
        </div>
      </div>
      <div>
        <span class="badge ${badge}">${order.status}</span>
        <span class="badge info">${risk}</span>
      </div>
    </section>`;
  }).join("");
}

function renderAuthorizedRecords(state) {
  const authorized = state.personalRecords.filter((item) => item.category === "authorizations" && item.meta?.status !== "revoked");
  document.querySelector("#authorized-records").innerHTML = authorized.map((record) => {
    const resident = residentOf(state, record.residentId);
    return `<section class="item">
      <div>
        <h3>${resident?.name || "未知居民"} · ${record.name}</h3>
        <p>${record.result}</p>
        <p>${record.date} · ${record.source}</p>
      </div>
    </section>`;
  }).join("") || `<p class="muted">暂无有效授权。</p>`;
}

function renderClaimLinks(state) {
  document.querySelector("#claim-links").innerHTML = state.insuranceClaims.map((claim) => {
    const resident = residentOf(state, claim.residentId);
    return `<article class="claim-card">
      <strong>${resident?.name || "未知居民"} · ${claim.claimType}</strong>
      <span>${claim.institution}<br>${money(claim.totalAmount)} · ${claim.status}</span>
    </article>`;
  }).join("");
}

function institutionEscapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function institutionRegistrationStatus(value) {
  return {
    confirmed: "已预约",
    completed: "已完诊",
    cancelled: "已取消",
    pending: "待处理",
    waived: "免预付",
    paid: "已支付回调",
    failed: "支付失败",
    "paid-demo": "演示支付已记录",
    "pending-demo": "待医院确认",
    "confirmed-demo": "演示确认",
    "checked-in": "已报到回调",
    "checked-in-demo": "已演示报到",
    "not-checked-in": "未报到",
    "refund-pending": "待退款",
    "refund-failed": "退款回调失败",
    refunded: "已退款回调",
    "refunded-demo": "演示退款完成",
    prechecked: "医保已预核验"
  }[value] || value || "待处理";
}

function institutionRegistrationAllowedActions(order) {
  if (Array.isArray(order.allowedActions)) return order.allowedActions;
  if (order.status === "cancelled") return order.refundStatus === "refund-pending" ? ["refund-demo"] : [];
  if (["completed", "closed"].includes(order.status)) return [];
  const actions = [];
  const paymentReady = ["paid", "paid-demo", "waived"].includes(order.paymentStatus);
  const confirmed = ["confirmed", "confirmed-demo"].includes(order.hisConfirmationStatus);
  if (paymentReady && !confirmed) actions.push("confirm-his-demo");
  if (paymentReady && confirmed && !["checked-in", "checked-in-demo"].includes(order.checkInStatus)) actions.push("check-in-demo");
  if (["checked-in", "checked-in-demo"].includes(order.checkInStatus)) actions.push("complete-demo");
  return actions;
}

function renderRegistrationJourneyWorkbench(state) {
  const metricsTarget = document.querySelector("#registration-journey-metrics");
  const ordersTarget = document.querySelector("#registration-journey-orders");
  const boundaryTarget = document.querySelector("#registration-journey-boundary");
  if (!metricsTarget || !ordersTarget || !boundaryTarget) return;
  const dashboard = institutionRegistrationDashboard || { orders: state.registrationOrders || [], journey: {} };
  const orders = dashboard.orders || [];
  const metrics = [
    ["本院预约", orders.length, "HIS/互联网医院"],
    ["待医院确认", orders.filter((item) => ["paid", "paid-demo", "waived"].includes(item.paymentStatus) && !["confirmed", "confirmed-demo"].includes(item.hisConfirmationStatus)).length, "支付后处理"],
    ["已报到", orders.filter((item) => ["checked-in", "checked-in-demo"].includes(item.checkInStatus)).length, "等待完诊"],
    ["待退款", orders.filter((item) => item.refundStatus === "refund-pending").length, "退款闭环"]
  ];
  metricsTarget.innerHTML = metrics.map(([name, value, detail]) => `<article class="metric-card"><span>${name}</span><strong>${value}</strong><small>${detail}</small></article>`).join("");
  const actionLabels = {
    "confirm-his-demo": "确认 HIS 预约",
    "check-in-demo": "登记报到",
    "complete-demo": "登记完诊",
    "refund-demo": "登记退款"
  };
  ordersTarget.innerHTML = orders.map((order, index) => {
    const resident = residentOf(state, order.residentId);
    const actions = institutionRegistrationAllowedActions(order).filter((action) => actionLabels[action]);
    return `<article class="priority-row" data-registration-journey-order="${institutionEscapeHtml(order.id)}">
      <div class="priority-rank ${order.status === "cancelled" ? "danger" : actions.length ? "warn" : "info"}">${index + 1}</div>
      <div>
        <h3>${institutionEscapeHtml(resident?.name || order.residentName || order.residentId)} · ${institutionEscapeHtml(order.department || "门诊")}</h3>
        <p>${institutionEscapeHtml(order.appointmentDate)} ${institutionEscapeHtml(order.period)} · ${institutionEscapeHtml(order.doctor || "医生待确认")} · 队列 ${institutionEscapeHtml(order.queueNo || order.registrationNo || "待回执")}</p>
        <small>支付 ${institutionEscapeHtml(institutionRegistrationStatus(order.paymentStatus))} · 医院 ${institutionEscapeHtml(institutionRegistrationStatus(order.hisConfirmationStatus))} · 报到 ${institutionEscapeHtml(institutionRegistrationStatus(order.checkInStatus))} · 退款 ${institutionEscapeHtml(institutionRegistrationStatus(order.refundStatus))}</small>
        <div class="action-row">${actions.map((action) => `<button type="button" class="inline-action" data-registration-institution-action="${action}" data-registration-id="${institutionEscapeHtml(order.id)}">${actionLabels[action]}</button>`).join("")}</div>
      </div>
      <div class="capability-side"><span class="badge ${actions.length ? "warn" : "info"}">${institutionEscapeHtml(institutionRegistrationStatus(order.status))}</span><small>生产：否</small></div>
    </article>`;
  }).join("") || `<p class="muted">本机构暂无预约就诊订单。</p>`;
  boundaryTarget.textContent = dashboard.journey?.boundary || "本工作台动作仅为本地业务闭环证据，生产仍需 HIS、支付退款和医保结算接口。";
  renderRegistrationIntegrationCenter(dashboard.integrationCenter || {});
}

function renderRegistrationIntegrationCenter(center = {}) {
  const statusTarget = document.querySelector("#registration-integration-status");
  const metricsTarget = document.querySelector("#registration-integration-metrics");
  const sourcesTarget = document.querySelector("#registration-integration-sources");
  const eventsTarget = document.querySelector("#registration-integration-events");
  const boundaryTarget = document.querySelector("#registration-integration-boundary");
  if (!statusTarget || !metricsTarget || !sourcesTarget || !eventsTarget || !boundaryTarget) return;
  const summary = center.summary || {};
  const sources = center.sources || [];
  const events = center.events || [];
  statusTarget.textContent = center.contract?.id || "appointment-order-v1";
  const metrics = [
    ["回调总数", summary.callbacks || 0, "签名网关"],
    ["匹配入库", summary.matched || 0, "订单对账"],
    ["待对账", summary.pendingReconciliation || 0, "人工复核"],
    ["死信", summary.deadLetters || 0, "重试补偿"]
  ];
  metricsTarget.innerHTML = metrics.map(([name, value, detail]) => `<article class="metric-card"><span>${name}</span><strong>${value}</strong><small>${detail}</small></article>`).join("");
  sourcesTarget.innerHTML = sources.map((source) => `<section class="item" data-registration-integration-source="${institutionEscapeHtml(source.id)}">
    <div>
      <h3>${institutionEscapeHtml(source.hospital || source.hospitalCode || source.id)}</h3>
      <p>${institutionEscapeHtml((source.sourceSystems || []).join(" / ") || "预约源")}</p>
      <small>回调 ${Number(source.callbacks || 0)} · 匹配 ${Number(source.matchedCallbacks || 0)} · 生产：否</small>
    </div>
    <span class="badge ${source.matchedCallbacks ? "info" : "warn"}">${institutionEscapeHtml(source.jointTestStatus || "pending-site-callback")}</span>
  </section>`).join("") || `<p class="muted">尚未登记预约号源。</p>`;
  eventsTarget.innerHTML = events.map((event) => `<section class="item" data-registration-integration-event="${institutionEscapeHtml(event.id)}">
    <div>
      <h3>${institutionEscapeHtml(event.eventType || "callback")} · ${institutionEscapeHtml(event.orderNo || event.orderId || "unmatched")}</h3>
      <p>${institutionEscapeHtml(event.hospitalCode || event.sourceInstitution || "external-provider")} · ${institutionEscapeHtml(event.receivedAt || event.updatedAt || "pending")}</p>
      <small>签名 ${event.signatureVerified ? "通过" : "待核验"} · 对账 ${institutionEscapeHtml(event.reconciliationStatus || "pending")} · 幂等键 ${institutionEscapeHtml(event.idempotencyKey || "missing")}</small>
      ${event.deadLetterReason ? `<small class="danger-text">${institutionEscapeHtml(event.deadLetterReason)}</small>` : ""}
    </div>
    <span class="badge ${event.deadLetter ? "danger" : event.reconciliationStatus === "matched" ? "info" : "warn"}">${institutionEscapeHtml(event.landingStatus || event.status || "pending")}</span>
  </section>`).join("") || `<p class="muted">尚未收到预约回调，等待现场联调。</p>`;
  boundaryTarget.textContent = center.boundary || "本地签名回调仅证明契约、幂等、落库和对账能力；生产仍需真实端点、凭据、字典和现场签字。";
}

async function runInstitutionRegistrationJourneyAction(orderId, action) {
  const boundaryTarget = document.querySelector("#registration-journey-boundary");
  if (!institutionApiBase) return { ok: false, message: "静态预览不提交机构业务动作。" };
  const notes = {
    "confirm-his-demo": "Institution confirmed the local HIS appointment evidence; live HIS callback remains required.",
    "check-in-demo": "Institution recorded local check-in evidence; production QR or HIS check-in remains required.",
    "complete-demo": "Institution recorded local consultation completion; EMR completion callback remains required.",
    "refund-demo": "Institution recorded local refund evidence; certified payment gateway receipt remains required."
  };
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${institutionApiBase}/registrations/orders/${encodeURIComponent(orderId)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, note: notes[action] || "Institution registration journey action." })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
    institutionRegistrationDashboard = payload.dashboard || await loadRegistrationJourneyDashboard();
    if (boundaryTarget) boundaryTarget.textContent = `${notes[action]} 生产就绪仍为否。`;
    return { ok: true, order: payload.order };
  } catch (error) {
    if (boundaryTarget) boundaryTarget.textContent = error.message || "预约就诊动作失败。";
    return { ok: false, message: error.message };
  }
}

function renderReferralCenter(state) {
  const referrals = state.referralSystem?.referrals || [];
  document.querySelector("#referral-center-count").textContent = `${referrals.length} 条`;
  document.querySelector("#referral-center").innerHTML = referrals.map((item) => {
    const resident = residentOf(state, item.residentId);
    const badge = item.priority === "高" ? "danger" : item.status.includes("待") ? "warn" : "info";
    return `<section class="item">
      <div>
        <h3>${resident?.name || "未知居民"} · ${item.type} · ${item.diseaseType}</h3>
        <p>${item.from} → ${item.to} · ${item.date}</p>
        <p>${item.reason}</p>
        <p>资源安排：${item.reservedResource} · 医保衔接：${item.insurancePolicy}</p>
        <div class="action-row">
          ${item.status === "待接诊" ? actionButton("referrals", item.id, "接诊", { status: "已接诊" }, "医疗机构接诊转诊") : ""}
          ${item.type === "下转" && item.status !== "基层承接" ? actionButton("referrals", item.id, "基层承接", { status: "基层承接" }, "基层承接下转患者") : ""}
          ${item.status !== "已完成" ? actionButton("referrals", item.id, "结案", { status: "已完成" }, "转诊闭环结案") : ""}
        </div>
      </div>
      <span class="badge ${badge}">${item.status}</span>
    </section>`;
  }).join("") || `<p class="muted">暂无转诊中心任务。</p>`;
}

function renderTeleconsultationLoop(state) {
  const rows = state.referralTeleconsultations || [];
  const countEl = document.querySelector("#teleconsultation-count");
  const listEl = document.querySelector("#teleconsultation-loop");
  if (!countEl || !listEl) return;
  countEl.textContent = `${rows.length} items`;
  listEl.innerHTML = rows.map((item) => {
    const resident = residentOf(state, item.residentId);
    const badge = item.priority === "high" ? "danger" : item.reportStatus === "returned" ? "info" : "warn";
    return `<section class="item">
      <div>
        <h3>${resident?.name || "Unknown resident"} · ${item.department || item.diseaseType || "Teleconsultation"}</h3>
        <p>${item.sourceInstitution || "-"} -> ${item.targetInstitution || "-"} · ${item.meetingWindow || item.due || "-"}</p>
        <p>${item.clinicalQuestion || item.receivingFeedback || item.reportSummary || "待补充临床说明"}</p>
        <p>授权：${item.authorizationStatus || "待确认"} · 报告：${item.reportStatus || "待回传"}</p>
        <div class="action-row">
          ${item.status === "requested" ? actionButton("referralTeleconsultations", item.id, "接收会诊", { status: "accepted", receivingFeedback: "接收机构已确认远程会诊。" }, "接收转诊会诊") : ""}
          ${item.reportStatus !== "returned" ? actionButton("referralTeleconsultations", item.id, "回传报告", { status: "report-returned", reportStatus: "returned", reportSummary: "会诊报告已回传至发起机构。" }, "回传会诊报告") : ""}
          ${item.status !== "closed" ? actionButton("referralTeleconsultations", item.id, "关闭闭环", { status: "closed" }, "关闭转诊会诊闭环") : ""}
        </div>
      </div>
      <span class="badge ${badge}">${item.status}</span>
    </section>`;
  }).join("") || `<p class="muted">No referral teleconsultation tasks.</p>`;
}

function renderReservedResources(state) {
  const resources = state.referralSystem?.reservedResources || [];
  document.querySelector("#reserved-resources").innerHTML = resources.map((item) => `<article class="claim-card">
    <strong>${item.institution} · ${item.department}</strong>
    <span>号源 ${item.outpatientSlots} · 床位 ${item.beds}<br>${item.forPrimaryReferral} · ${item.status}</span>
  </article>`).join("") || `<p class="muted">暂无预留号源床位配置。</p>`;
}

function renderIntegratedProfiles(state) {
  const authorizedResidentIds = [...new Set(state.personalRecords
    .filter((item) => item.category === "authorizations" && item.meta?.status !== "revoked")
    .map((item) => item.residentId))];
  document.querySelector("#integrated-profile-count").textContent = `${authorizedResidentIds.length} 人`;
  document.querySelector("#integrated-profiles").innerHTML = authorizedResidentIds.map((residentId) => {
    const resident = residentOf(state, residentId);
    const diseases = state.diseases.filter((item) => item.residentId === residentId).map((item) => item.type).join("、") || "暂无慢病";
    const emrs = state.personalRecords.filter((item) => item.residentId === residentId && item.category === "emr").sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    const labs = state.personalRecords.filter((item) => item.residentId === residentId && item.category === "labs").length;
    const latest = emrs[0];
    return `<section class="item">
      <div>
        <h3>${resident?.name || "未知居民"} · ${diseases}</h3>
        <p>${resident ? `血压 ${resident.metrics.systolic}/${resident.metrics.diastolic} · 血糖 ${resident.metrics.glucose} · BMI ${resident.metrics.bmi}` : "健康指标待补充"}</p>
        <p>最新病历：${latest ? `${latest.date} · ${latest.name} · ${latest.source}` : "暂无电子病历"} · 检查检验 ${labs} 条</p>
      </div>
      <span class="badge info">${resident?.personIndex || "待索引"}</span>
    </section>`;
  }).join("") || `<p class="muted">暂无可贯通的授权档案。</p>`;
}

function renderStandardArchiveProfiles(state) {
  const authorizedResidentIds = getAuthorizedResidentIds(state);
  document.querySelector("#standard-profile-count").textContent = `${authorizedResidentIds.length} 人`;
  document.querySelector("#standard-profiles").innerHTML = authorizedResidentIds.map((residentId) => {
    const coverage = getStandardCoverage(state, residentId);
    const resident = coverage.resident;
    const ready = coverage.datasets.filter((item) => item.status === "已归集").slice(0, 5);
    const missing = coverage.datasets.filter((item) => item.status === "待补齐").slice(0, 4);
    return `<section class="item standard-item">
      <div>
        <h3>${resident?.name || "未知居民"} · ${coverage.lifeStage || "生命阶段待识别"} · ${coverage.risk || "风险待评估"}</h3>
        <p>健康问题：${coverage.problems.join("、")} · 适用数据集归集度 ${coverage.score}% (${coverage.applicableCompleted}/${coverage.applicableTotal})</p>
        <div class="model-grid standard-dimensions">
          ${coverage.activities.map((activity) => `<div><strong>${activity.title}</strong><span>${activity.detail}</span></div>`).join("")}
        </div>
        <div class="standard-tags">
          ${ready.map((item) => `<span class="badge">${item.code} ${item.name}</span>`).join("")}
          ${missing.map((item) => `<span class="badge warn">待补齐 ${item.code}</span>`).join("")}
        </div>
        <p>医生查看重点：基础身份和主索引、慢病管理、门诊病历、检查检验、用药处方、固定取药与授权审计。</p>
      </div>
      <div class="score-badge">
        <strong>${coverage.score}%</strong>
        <span>标准档案</span>
      </div>
    </section>`;
  }).join("") || `<p class="muted">暂无可按标准查看的授权健康档案。</p>`;
}

function getAuthorizedResidentIds(state) {
  return [...new Set(state.personalRecords
    .filter((item) => item.category === "authorizations" && item.meta?.status !== "revoked")
    .map((item) => item.residentId))];
}

function getStandardCoverage(state, residentId) {
  if (window.HealthArchiveStandard) {
    return window.HealthArchiveStandard.getResidentCoverage(state, residentId);
  }
  return { datasets: [], activities: [], problems: [], score: 0, applicableCompleted: 0, applicableTotal: 0 };
}

function renderInstitutionAudit(state) {
  const logs = state.dataAccessLogs || [];
  const institutionLogs = logs.filter((item) => ["医疗机构", "家庭医生"].includes(item.role));
  document.querySelector("#audit-link-count").textContent = `${institutionLogs.length} 条`;
  document.querySelector("#institution-audit").innerHTML = institutionLogs.map((log) => {
    const resident = residentOf(state, log.residentId);
    const badge = log.result === "拒绝" ? "danger" : "info";
    return `<section class="item">
      <div>
        <h3>${resident?.name || "未知居民"} · ${log.scope}</h3>
        <p>${log.actor} · ${log.role} · ${log.at}</p>
        <p>${log.purpose} · ${log.personIndex || "未生成统一索引"}</p>
      </div>
      <span class="badge ${badge}">${log.result}</span>
    </section>`;
  }).join("") || `<p class="muted">暂无机构端访问审计记录。</p>`;
}

function renderPickups(state) {
  const pickups = state.medicationPickups || [];
  document.querySelector("#pickup-count").textContent = `${pickups.length} 项`;
  document.querySelector("#pickup-list").innerHTML = pickups.map((item) => {
    const resident = residentOf(state, item.residentId);
    const badge = item.status === "待取药" ? "warn" : item.status === "已预约" ? "info" : "";
    return `<section class="item">
      <div>
        <h3>${resident?.name || "未知居民"} · ${item.medication}</h3>
        <p>${item.pharmacy} · 每月 ${item.pickupDay} 日 · 下次 ${item.nextPickup}</p>
        <p>${item.dosage} · ${item.coverage}</p>
        <p>机构确认：${item.institutionReview || "待确认"} · 医保审核：${item.insuranceReview || "待审核"} · ${item.deliveryMode || "社区药房自取"}</p>
        <div class="action-row">
          ${item.institutionReview !== "已确认" ? actionButton("medicationPickups", item.id, "确认处方", { institutionReview: "已确认", status: "待医保审核" }, "医疗机构确认固定取药处方") : ""}
          ${item.status !== "已完成" && item.insuranceReview === "已通过" ? actionButton("medicationPickups", item.id, "完成取药", { status: "已完成", pharmacyStatus: "已取药" }, "药房完成固定取药") : ""}
        </div>
      </div>
      <span class="badge ${badge}">${item.status}</span>
    </section>`;
  }).join("") || `<p class="muted">暂无固定取药计划。</p>`;
}

function renderDeathCertificates(state) {
  const certificates = state.deathCertificates || [];
  const forms = state.deathCertificateForms || [];
  const statistics = state.deathStatistics || {};
  const metrics = statistics.metrics || {};
  const countEl = document.querySelector("#death-certificate-count");
  const metricEl = document.querySelector("#death-certificate-metrics");
  const listEl = document.querySelector("#death-certificate-list");
  const formsEl = document.querySelector("#death-certificate-forms");
  if (!countEl || !metricEl || !listEl || !formsEl) return;

  countEl.textContent = `${certificates.length} 张证明`;
  metricEl.innerHTML = [
    ["已签发", metrics.signed || certificates.filter((item) => item.status === "已签发").length, "1 日内签发"],
    ["已上报", metrics.reported || certificates.filter((item) => String(item.cdcReportStatus || "").includes("已上报")).length, "人口死亡信息登记"],
    ["电子证照", metrics.electronicLicenses || certificates.filter((item) => String(item.electronicLicenseStatus || "").includes("已生成")).length, "省级平台/国家平台"],
    ["待处理", metrics.pending || certificates.filter((item) => ["待签发", "待上报"].includes(item.status)).length, "补正、签发或上报"]
  ].map(([label, value, hint]) => `<article class="claim-card">
    <strong>${label}</strong>
    <span>${value}<br>${hint}</span>
  </article>`).join("");

  listEl.innerHTML = certificates.map((item) => {
    const resident = residentOf(state, item.residentId);
    const badge = item.status === "待签发" || item.status === "待上报" ? "warn" : item.qualityCheck === "待补正" ? "danger" : "info";
    return `<section class="item">
      <div>
        <h3>${item.deceasedName || resident?.name || "未知居民"} · ${item.certificateNo}</h3>
        <p>${item.deathDateTime} · ${item.deathPlace} · ${item.deathType} · ${item.deathReasonType}</p>
        <p>死因：${item.immediateCause || "待填"} / 根本死因 ${item.underlyingCause || "待编码"} · ICD ${item.icd10 || "待编码"}</p>
        <p>签发：${item.issuingInstitution || "待明确"} · ${item.issuingPhysician || "待签名"} · 材料 ${Array.isArray(item.materials) ? item.materials.join("、") : "待补齐"}</p>
        <p>上报：${item.reportChannel || "人口死亡信息登记系统"} · ${item.cdcReportStatus || "未上报"} · 国家平台 ${item.nationalPlatformStatus || "待提交"}</p>
        <p>共享：公安 ${item.publicSecuritySync || "未共享"} · 民政 ${item.civilAffairsSync || "未共享"} · 质控 ${item.qualityCheck || "待复核"}</p>
        <div class="action-row">
          ${item.status === "待签发" ? actionButton("deathCertificates", item.id, "签发", { status: "已签发", qualityCheck: "通过", electronicLicenseStatus: "已生成" }, "签发死亡医学证明") : ""}
          ${item.status !== "已上报" && item.cdcReportStatus !== "已上报" ? actionButton("deathCertificates", item.id, "上报共享", { status: "已上报", cdcReportStatus: "已上报", nationalPlatformStatus: "已同步", publicSecuritySync: "已共享", civilAffairsSync: "已共享" }, "死亡证明上报并共享") : ""}
        </div>
      </div>
      <span class="badge ${badge}">${item.status || "待处理"}</span>
    </section>`;
  }).join("") || `<p class="muted">暂无居民死亡医学证明记录。</p>`;

  formsEl.innerHTML = forms.map((form) => `<article class="claim-card">
    <strong>${form.name}</strong>
    <span>${form.scope}<br>${(form.keyFields || []).slice(0, 4).join("、")}<br>${form.status}</span>
  </article>`).join("") || `<p class="muted">暂无死亡证明材料模板。</p>`;
}
