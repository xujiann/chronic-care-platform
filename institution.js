const fallbackState = { residents: [], diseases: [], followups: [], personalRecords: [], careOrders: [], insuranceClaims: [], referralSystem: null, referralTeleconsultations: [], registrationSchedules: [], registrationOrders: [], registrationWaitlistEntries: [], medicationPickups: [], chronicScreeningTasks: [], chronicManagementPlans: [], chronicQualityMetrics: [], chronicComorbidityPlans: [], chronicSelfManagement: [], diseaseRegistryModels: [], chronicFollowupStatusPolicy: {}, deathCertificates: [], deathCertificateForms: [], deathStatistics: {}, birthCertificates: [], birthCertificateForms: [], birthCertificateDocuments: [], birthStatistics: {}, doctorProfiles: [], multiPracticeApplications: [], multiPracticePolicy: {}, taskMessages: [], phase2FamilyDoctorTemplates: [], phase2FamilyDoctorTeams: [], phase2FamilyDoctorServicePackages: [], phase2FamilyDoctorApplications: [], phase2FamilyDoctorContracts: [], phase2FamilyDoctorFulfillments: [] };
const institutionApiBase = location.protocol === "file:" || location.hostname.endsWith("github.io") ? "" : "/api";
let platformState = fallbackState;
let institutionRegistrationDashboard = null;

document.addEventListener("DOMContentLoaded", async () => {
  platformState = await loadPlatformState(fallbackState);
  const [followupSummary, launchCore, publicHealthLoop, referralContinuity, archiveStandardization, pathwayQuality, pharmacyInsuranceClosure, productionSafety, productionSafetyEvidence, interoperabilityProfiles, registrationDashboard] = await Promise.all([loadChronicFollowupSummary(), loadChronicLaunchCore(), loadChronicPublicHealthLoop(), loadChronicReferralContinuity(), loadChronicArchiveStandardization(), loadChronicPathwayQuality(), loadChronicPharmacyInsuranceClosure(), loadChronicProductionSafety(), loadChronicProductionSafetyEvidence(), loadChronicInteroperabilityProfiles(), loadRegistrationJourneyDashboard()]);
  platformState.chronicFollowupSummary = followupSummary;
  platformState.chronicLaunchCore = launchCore;
  platformState.chronicPublicHealthLoop = publicHealthLoop;
  platformState.chronicReferralContinuity = referralContinuity;
  platformState.chronicArchiveStandardization = archiveStandardization;
  platformState.chronicPathwayQuality = pathwayQuality;
  platformState.chronicPharmacyInsuranceClosure = pharmacyInsuranceClosure;
  platformState.chronicProductionSafety = productionSafety;
  platformState.chronicProductionSafetyEvidence = productionSafetyEvidence;
  platformState.chronicInteroperabilityProfiles = interoperabilityProfiles;
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

async function loadChronicReferralContinuity() {
  if (!institutionApiBase) return null;
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${institutionApiBase}/chronic/referral-continuity`);
    if (response.ok) return await response.json();
  } catch (error) {
    // Static preview uses the referral and archive snapshot.
  }
  return null;
}

async function loadChronicArchiveStandardization() {
  if (!institutionApiBase) return null;
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${institutionApiBase}/chronic/archive-standard`);
    if (response.ok) return await response.json();
  } catch (error) {
    // Static preview derives field coverage from the local snapshot.
  }
  return null;
}

async function loadChronicPathwayQuality() {
  if (!institutionApiBase) return null;
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${institutionApiBase}/chronic/pathway-quality`);
    if (response.ok) return await response.json();
  } catch (error) {
    // Static preview derives a minimal pathway inventory from the local snapshot.
  }
  return null;
}

async function loadChronicPharmacyInsuranceClosure() {
  if (!institutionApiBase) return null;
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${institutionApiBase}/chronic/pharmacy-insurance-closure`);
    if (response.ok) return await response.json();
  } catch (error) {
    // Static preview derives only local pickup evidence.
  }
  return null;
}

async function loadChronicProductionSafety() {
  if (!institutionApiBase) return null;
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${institutionApiBase}/chronic/production-safety`);
    if (response.ok) return await response.json();
  } catch (error) {
    // Static preview remains explicit that production evidence is unavailable.
  }
  return null;
}

async function loadChronicProductionSafetyEvidence() {
  if (!institutionApiBase) return null;
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${institutionApiBase}/chronic/production-safety-evidence`);
    if (response.ok) return await response.json();
  } catch (error) {
    // Static preview remains explicit that verified site evidence is unavailable.
  }
  return null;
}

async function loadChronicInteroperabilityProfiles() {
  if (!institutionApiBase) return null;
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${institutionApiBase}/chronic/interoperability-profiles`);
    if (response.ok) return await response.json();
  } catch (error) {
    // Static preview shows the standard baseline but cannot validate live interface messages.
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
    journey: { status: "static-preview", productionReady: 0, onsiteBlockers: 4, boundary: "当前为预约流程静态预览，生产环境仍需完成真实接口联调。" }
  };
}

async function refreshChronicRuntimeState() {
  const [followupSummary, launchCore, publicHealthLoop, referralContinuity, archiveStandardization, pathwayQuality, pharmacyInsuranceClosure, productionSafety, productionSafetyEvidence, interoperabilityProfiles] = await Promise.all([loadChronicFollowupSummary(), loadChronicLaunchCore(), loadChronicPublicHealthLoop(), loadChronicReferralContinuity(), loadChronicArchiveStandardization(), loadChronicPathwayQuality(), loadChronicPharmacyInsuranceClosure(), loadChronicProductionSafety(), loadChronicProductionSafetyEvidence(), loadChronicInteroperabilityProfiles()]);
  if (followupSummary) platformState.chronicFollowupSummary = followupSummary;
  if (launchCore) platformState.chronicLaunchCore = launchCore;
  if (publicHealthLoop) platformState.chronicPublicHealthLoop = publicHealthLoop;
  if (referralContinuity) platformState.chronicReferralContinuity = referralContinuity;
  if (archiveStandardization) platformState.chronicArchiveStandardization = archiveStandardization;
  if (pathwayQuality) platformState.chronicPathwayQuality = pathwayQuality;
  if (pharmacyInsuranceClosure) platformState.chronicPharmacyInsuranceClosure = pharmacyInsuranceClosure;
  if (productionSafety) platformState.chronicProductionSafety = productionSafety;
  if (productionSafetyEvidence) platformState.chronicProductionSafetyEvidence = productionSafetyEvidence;
  if (interoperabilityProfiles) platformState.chronicInteroperabilityProfiles = interoperabilityProfiles;
}

function renderAll(state) {
  renderChronicLaunchCore(state);
  renderChronicPublicHealthLoop(state);
  renderChronicFollowupWorkbench(state);
  renderChronicReferralContinuity(state);
  renderChronicArchiveStandardization(state);
  renderChronicPathwayQuality(state);
  renderChronicPharmacyInsuranceClosure(state);
  renderChronicProductionSafety(state);
  renderChronicInteroperabilityProfiles(state);
  renderPhase2FamilyDoctorContracts(state);
  populateBirthCertificateForm(state);
  populateMultiPracticeForm(state);
  populateTeleconsultationForm(state);
  renderMetrics(state);
  renderDoctorAccounts(state);
  renderMultiPracticePolicy(state);
  renderMultiPracticeApplications(state);
  renderCareOrders(state);
  renderAuthorizedRecords(state);
  renderClaimLinks(state);
  renderInstitutionDrugConsumableSupervision(institutionDrugConsumableState, state);
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
      const referralContinuityButton = event.target.closest("[data-chronic-referral-continuity]");
      const familyDoctorReviewButton = event.target.closest("[data-family-doctor-review]");
      const familyDoctorFulfillmentButton = event.target.closest("[data-family-doctor-fulfillment]");
      const registrationJourneyButton = event.target.closest("[data-registration-institution-action]");
      const registrationDisruptionButton = event.target.closest("[data-registration-disruption-action]");
      const registrationWaitlistButton = event.target.closest("[data-registration-waitlist-action]");
      const registrationIntegrationRetryButton = event.target.closest("[data-registration-integration-retry]");
      const registrationReconciliationButton = event.target.closest("[data-registration-reconciliation-action]");
      if (registrationWaitlistButton) {
        const entryRow = registrationWaitlistButton.closest("[data-registration-waitlist-entry]");
        const field = (selector) => entryRow?.querySelector(selector)?.value || "";
        registrationWaitlistButton.disabled = true;
        await runInstitutionRegistrationWaitlistAction(
          registrationWaitlistButton.dataset.registrationWaitlistId,
          registrationWaitlistButton.dataset.registrationWaitlistAction,
          {
            offerMinutes: field("[data-registration-waitlist-offer-minutes]"),
            note: field("[data-registration-waitlist-note]") || "机构处理预约候补队列"
          }
        );
        registrationWaitlistButton.disabled = false;
        return;
      }
      if (registrationDisruptionButton) {
        const orderRow = registrationDisruptionButton.closest("[data-registration-journey-order]");
        const field = (selector) => orderRow?.querySelector(selector)?.value || "";
        registrationDisruptionButton.disabled = true;
        await runInstitutionRegistrationDisruptionAction(
          registrationDisruptionButton.dataset.registrationId,
          registrationDisruptionButton.dataset.registrationDisruptionAction,
          {
            type: field("[data-registration-disruption-type]"),
            replacementScheduleId: field("[data-registration-disruption-schedule]"),
            acknowledgementDueAt: field("[data-registration-disruption-due]"),
            reason: field("[data-registration-disruption-reason]"),
            note: field("[data-registration-disruption-note]")
          }
        );
        registrationDisruptionButton.disabled = false;
        return;
      }
      if (registrationReconciliationButton) {
        const eventRow = registrationReconciliationButton.closest("[data-registration-integration-event]");
        const field = (selector) => eventRow?.querySelector(selector)?.value || "";
        registrationReconciliationButton.disabled = true;
        await runInstitutionRegistrationReconciliationAction(
          registrationReconciliationButton.dataset.registrationReconciliationEvent,
          registrationReconciliationButton.dataset.registrationReconciliationAction,
          {
            owner: field("[data-registration-reconciliation-owner]"),
            dueAt: field("[data-registration-reconciliation-due]"),
            priority: field("[data-registration-reconciliation-priority]"),
            note: field("[data-registration-reconciliation-note]"),
            resolution: field("[data-registration-reconciliation-resolution]"),
            evidenceRef: field("[data-registration-reconciliation-evidence]")
          }
        );
        registrationReconciliationButton.disabled = false;
        return;
      }
      if (registrationIntegrationRetryButton) {
        const eventRow = registrationIntegrationRetryButton.closest("[data-registration-integration-event]");
        const note = eventRow?.querySelector("[data-registration-integration-note]")?.value || "";
        registrationIntegrationRetryButton.disabled = true;
        await runInstitutionRegistrationIntegrationRetry(registrationIntegrationRetryButton.dataset.registrationIntegrationRetry, note);
        registrationIntegrationRetryButton.disabled = false;
        return;
      }
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
      if (referralContinuityButton) {
        referralContinuityButton.disabled = true;
        const result = await recordChronicReferralContinuity(referralContinuityButton.dataset.chronicReferralContinuity);
        referralContinuityButton.disabled = false;
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

async function loadInstitutionDrugConsumableSupervision(state = platformState) {
  if (!institutionApiBase) {
    const rows = (state.drugConsumableSupervisions || []).map((item) => ({
      ...item,
      normalizedStatus: /closed|complete|done|passed/i.test(String(item.status || "")) ? "closed" : "open",
      auditCount: Array.isArray(item.auditTrail) ? item.auditTrail.length : 0
    }));
    return {
      rows,
      boundaries: [],
      summary: {
        total: rows.length,
        open: rows.filter((item) => item.normalizedStatus !== "closed").length,
        highRisk: rows.filter((item) => item.riskLevel === "high").length
      }
    };
  }
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${institutionApiBase}/drug-consumable-supervision`);
    if (!response.ok) return { boundaries: [], rows: [], summary: {} };
    return response.json();
  } catch {
    return { boundaries: [], rows: [], summary: {} };
  }
}

async function postInstitutionDrugConsumableAction(id, action, body) {
  if (!institutionApiBase) return false;
  const request = window.HealthCityAuth?.authFetch || fetch;
  const response = await request(`${institutionApiBase}/drug-consumable-supervision/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) return false;
  institutionDrugConsumableState = await loadInstitutionDrugConsumableSupervision(platformState);
  platformState = await loadPlatformState(fallbackState);
  renderAll(platformState);
  return true;
}

async function postInstitutionDrugConsumableRemediation(id, body) {
  return postInstitutionDrugConsumableAction(id, "remediation", body);
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
  return closed.some((item) => String(status || "").includes(item) || String(item || "").includes(String(status || ""))) || /已完成|已取药|已评估|已复核|completed|picked|handled|closed|read/i.test(String(status || ""));
}

function chronicDaysUntil(dateText) {
  if (!dateText) return 999;
  const date = new Date(`${String(dateText).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 999;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - today.getTime()) / 86400000);
}

function buildChronicFollowupAlertQueue(state) {
  const normalize = (item) => {
    const days = chronicDaysUntil(item.dueAt);
    const riskText = `${item.status || ""} ${item.risk || ""}`;
    const priority = String(riskText).includes("逾期") || days < 0 ? "critical" : /高危|预警|high|alert/i.test(riskText) || days <= 3 ? "high" : days <= 7 ? "medium" : "low";
    return {
      id: `${item.collection}:${item.sourceId}`,
      ...item,
      daysUntil: days,
      dueBucket: String(riskText).includes("逾期") || days < 0 ? "overdue" : days === 0 ? "due-today" : days <= 7 ? "due-soon" : "scheduled",
      priority
    };
  };
  return [
    ...(state.followups || []).filter((item) => !chronicClosed(state, item.status)).map((item) => normalize({ collection: "followups", sourceId: item.id, residentId: item.residentId, dueAt: item.plannedAt, status: item.status, risk: item.diseaseType })),
    ...(state.medicationPickups || []).filter((item) => !chronicClosed(state, item.status || item.pharmacyStatus)).map((item) => normalize({ collection: "medicationPickups", sourceId: item.id, residentId: item.residentId, dueAt: item.nextPickup, status: item.status || item.pharmacyStatus, risk: item.medication })),
    ...(state.chronicManagementPlans || []).filter((item) => !chronicClosed(state, item.status)).map((item) => normalize({ collection: "chronicManagementPlans", sourceId: item.id, residentId: item.residentId, dueAt: item.nextReview, status: item.status, risk: item.grade })),
    ...(state.chronicScreeningTasks || []).filter((item) => !chronicClosed(state, item.status)).map((item) => normalize({ collection: "chronicScreeningTasks", sourceId: item.id, residentId: item.residentId, dueAt: item.due, status: item.status, risk: item.riskLevel })),
    ...(state.taskMessages || []).filter((item) => item.chronicFollowup && item.targetRole === "institution" && !["read", "handled"].includes(String(item.status || "").toLowerCase())).map((item) => normalize({ collection: item.collection || "taskMessages", sourceId: item.sourceId || item.id, residentId: item.residentId, dueAt: String(item.createdAt || "").slice(0, 10), status: item.status || "sent", risk: "feedback" }))
  ].sort((a, b) => ({ critical: 0, high: 1, medium: 2, low: 3 }[a.priority] ?? 9) - ({ critical: 0, high: 1, medium: 2, low: 3 }[b.priority] ?? 9) || a.daysUntil - b.daysUntil);
}

function buildChronicFollowupPolicyAlignment(state) {
  const feedback = (state.personalRecords || []).filter((item) => item.category === "chronic-feedback" || item.meta?.followupFeedback);
  return [
    ["咨询筛查与风险发现", (state.chronicScreeningTasks || []).filter((item) => item.residentId && item.riskLevel && item.nextStep).length],
    ["分类分级管理", (state.chronicManagementPlans || []).filter((item) => item.residentId && item.grade && item.nextReview).length],
    ["院后随访与健康指导", (state.followups || []).filter((item) => item.residentId && item.plannedAt && item.assignee).length],
    ["长期处方与用药保障", (state.medicationPickups || []).filter((item) => item.residentId && item.nextPickup && item.pharmacyStatus).length],
    ["家庭医生协同", (state.residents || []).filter((resident) => resident.familyDoctor).length + (state.chronicManagementPlans || []).filter((item) => item.owner).length],
    ["居民自我管理与反馈", feedback.length],
    ["信息流转与处置闭环", (state.taskMessages || []).filter((item) => item.chronicFollowup && item.residentId && item.targetRole).length]
  ].map(([policy, count]) => ({ policy, count, covered: count > 0 }));
}

function fallbackChronicLaunchCore(state) {
  const items = [
    ["institution-systems", "机构系统联调", "chronicExternalIntegrations", "institution-integration"],
    ["identity-scope", "身份与机构范围", "chronicIdentityScopes", "identity-integration"],
    ["message-channels", "消息回执升级", "chronicMessageChannels", "message-platform"],
    ["quality-model", "质控模型版本", "chronicModelGovernance", "chronic-quality-office"],
    ["pharmacy-insurance", "药房医保闭环", "chronicPharmacyInsuranceLinks", "pharmacy-insurance"]
  ].map(([id, title, collection, owner]) => {
    const rows = state[collection] || [];
    return {
      id,
      title,
      owner,
      collection,
      ready: rows.length > 0,
      collectionEvidence: { rows: rows.length, readyRows: rows.length }
    };
  });
  return {
    ok: items.every((item) => item.ready),
    summary: {
      items: items.length,
      readyItems: items.filter((item) => item.ready).length,
      evidenceRows: items.reduce((sum, item) => sum + item.collectionEvidence.rows, 0)
    },
    items
  };
}

function renderChronicLaunchCoreLegacy(state) {
  const summaryEl = document.querySelector("#chronic-launch-core-summary");
  const gridEl = document.querySelector("#chronic-launch-core");
  if (!summaryEl || !gridEl) return;
  const report = state.chronicLaunchCore || fallbackChronicLaunchCore(state);
  summaryEl.textContent = `${report.summary.readyItems}/${report.summary.items} 项就绪 · ${report.summary.evidenceRows} 条证据`;
  gridEl.innerHTML = (report.items || []).map((item) => {
    const rows = item.collectionEvidence || {};
    return `<article class="claim-card">
      <strong>${item.title}</strong>
      <span>${item.ready ? "PASS" : "PENDING"}<br>${item.collection} · ${rows.readyRows || 0}/${rows.rows || 0}<br>${item.owner}</span>
    </article>`;
  }).join("");
}

function renderChronicLaunchCore(state) {
  const summaryEl = document.querySelector("#chronic-launch-core-summary");
  const gridEl = document.querySelector("#chronic-launch-core");
  if (!summaryEl || !gridEl) return;
  const report = state.chronicLaunchCore || fallbackChronicLaunchCore(state);
  const signoffs = report.summary.signoffs || 0;
  const signedSignoffs = report.summary.signedSignoffs || 0;
  summaryEl.textContent = `${report.summary.readyItems}/${report.summary.items} ready - ${report.summary.closureRows || 0} closure rows - ${signedSignoffs}/${signoffs} signoffs`;
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
  const payload = {
    itemId,
    rowId,
    action: "site closure confirmation",
    completionStatus: "closed",
    receiptStatus: "accepted",
    reviewStatus: "approved",
    signoffStatus: "signed",
    note: "institution launch core closure recorded from portal"
  };
  if (!institutionApiBase) {
    const report = platformState.chronicLaunchCore || fallbackChronicLaunchCore(platformState);
    const item = (report.items || []).find((entry) => entry.id === itemId);
    if (item) {
      item.ready = true;
      item.closureReady = true;
      item.closureEvidence = {
        ...(item.closureEvidence || {}),
        rows: Math.max(item.closureEvidence?.rows || 0, 1),
        readyRows: Math.max(item.closureEvidence?.readyRows || 0, 1)
      };
    }
    platformState.chronicLaunchCore = report;
    return { ok: true };
  }
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${institutionApiBase}/chronic/launch-core/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`launch core action failed: ${response.status}`);
    const saved = await response.json();
    platformState.chronicLaunchCore = saved.launchCore || await loadChronicLaunchCore();
    return { ok: true, saved };
  } catch (error) {
    alert(error.message || "launch core action failed");
    return { ok: false };
  }
}

function chronicPriorityRank(priority) {
  return { critical: 0, high: 1, medium: 2, low: 3 }[priority] ?? 9;
}

function chronicWorkbenchFilters() {
  return {
    priority: document.querySelector("#chronic-priority-filter")?.value || "all",
    type: document.querySelector("#chronic-type-filter")?.value || "all",
    search: String(document.querySelector("#chronic-search")?.value || "").trim().toLowerCase(),
    sort: document.querySelector("#chronic-sort")?.value || "priority"
  };
}

function decorateChronicWorkbenchRows(rows, alertQueue) {
  const alerts = new Map((alertQueue || []).map((item) => [`${item.collection}:${item.sourceId}`, item]));
  return rows.map((item) => {
    const alert = alerts.get(`${item.collection}:${item.id}`) || alerts.get(`${item.collection}:${item.sourceId}`);
    const resident = residentOf(platformState, item.residentId);
    return {
      ...item,
      alert,
      priority: alert?.priority || item.priority || "low",
      dueBucket: alert?.dueBucket || "scheduled",
      residentName: resident?.name || "",
      searchText: [resident?.name, item.title, item.collection, item.status, item.due, item.assignee, item.owner, item.pharmacy, item.nextStep, item.intervention, item.advice, item.result].filter(Boolean).join(" ").toLowerCase()
    };
  });
}

function filterChronicWorkbenchRows(rows, filters) {
  return rows.filter((item) => {
    if (filters.priority !== "all" && item.priority !== filters.priority) return false;
    if (filters.type !== "all" && item.collection !== filters.type) return false;
    if (filters.search && !item.searchText.includes(filters.search)) return false;
    return true;
  }).sort((a, b) => {
    if (filters.sort === "due") return chronicDaysUntil(a.due) - chronicDaysUntil(b.due) || chronicPriorityRank(a.priority) - chronicPriorityRank(b.priority);
    if (filters.sort === "resident") return String(a.residentName || "").localeCompare(String(b.residentName || ""), "zh-CN") || chronicPriorityRank(a.priority) - chronicPriorityRank(b.priority);
    return chronicPriorityRank(a.priority) - chronicPriorityRank(b.priority) || chronicDaysUntil(a.due) - chronicDaysUntil(b.due);
  });
}

function renderChronicFollowupWorkbenchLegacy(state) {
  const summaryEl = document.querySelector("#chronic-followup-summary");
  const metricsEl = document.querySelector("#chronic-followup-metrics");
  const listEl = document.querySelector("#chronic-followup-workbench");
  if (!summaryEl || !metricsEl || !listEl) return;
  const feedback = (state.personalRecords || []).filter((item) => item.category === "chronic-feedback" || item.meta?.followupFeedback);
  const openFollowups = (state.followups || []).filter((item) => !chronicClosed(state, item.status));
  const openPlans = (state.chronicManagementPlans || []).filter((item) => !chronicClosed(state, item.status));
  const openScreenings = (state.chronicScreeningTasks || []).filter((item) => !chronicClosed(state, item.status));
  const pendingMedication = (state.medicationPickups || []).filter((item) => !chronicClosed(state, item.status || item.pharmacyStatus));
  const followupMessages = (state.taskMessages || []).filter((item) => item.chronicFollowup && item.targetRole === "institution" && !["read", "handled"].includes(String(item.status || "").toLowerCase()));
  const policyAlignment = buildChronicFollowupPolicyAlignment(state);
  const policyCovered = policyAlignment.filter((item) => item.covered).length;
  const alertQueue = state.chronicFollowupSummary?.alertQueue || buildChronicFollowupAlertQueue(state);
  const alertSummary = state.chronicFollowupSummary?.summary || {};
  summaryEl.textContent = `${openFollowups.length + openPlans.length + openScreenings.length + followupMessages.length} 项待处置`;
  summaryEl.textContent += ` · ${alertQueue.length} 项风险提醒`;
  metricsEl.innerHTML = [
    ["筛查分级", openScreenings.length, "高风险发现与分级评估"],
    ["管理计划", openPlans.length, "复核、升级预警、下次随访"],
    ["院后随访", openFollowups.length, "逾期、待随访、复诊提醒"],
    ["用药依从", pendingMedication.length, "固定取药与长处方闭环"],
    ["随访消息", followupMessages.length, "居民反馈到机构处置提醒"],
    ["居民反馈", feedback.length, "居民端主动回填"],
    ["提醒队列", alertQueue.length, `${alertSummary.highPriorityAlerts || alertQueue.filter((item) => ["critical", "high"].includes(item.priority)).length} 项高优先级`],
    ["政策对照", `${policyCovered}/${policyAlignment.length}`, "国卫基层发〔2025〕15号"]
  ].map(([label, value, hint]) => `<article class="claim-card"><strong>${label}</strong><span>${value}<br>${hint}</span></article>`).join("");

  const rows = [
    ...openScreenings.map((item) => ({ ...item, collection: "chronicScreeningTasks", title: item.taskName, due: item.due, primary: "完成评估", updates: { status: "已评估", result: "已生成风险分级和干预建议" } })),
    ...openPlans.map((item) => ({ ...item, collection: "chronicManagementPlans", title: `${item.diseaseType}管理计划`, due: item.nextReview, primary: "复核完成", updates: { status: "已复核", intervention: "已完成阶段复核并更新管理方案" } })),
    ...openFollowups.map((item) => ({ ...item, collection: "followups", title: `${item.diseaseType}随访`, due: item.plannedAt, primary: "完成随访", updates: { status: "已完成", result: "已完成院后随访并同步居民反馈" } })),
    ...pendingMedication.map((item) => ({ ...item, collection: "medicationPickups", title: item.medication, due: item.nextPickup, primary: "确认依从", updates: { status: "已完成", pharmacyStatus: "已取药" } }))
  ].slice(0, 12);
  listEl.innerHTML = rows.map((item) => {
    const resident = residentOf(state, item.residentId);
    const latestFeedback = feedback.find((record) => record.residentId === item.residentId);
    const latestMessage = followupMessages.find((message) => message.residentId === item.residentId);
    return `<section class="item">
      <div>
        <h3>${resident?.name || "未知居民"} · ${item.title || item.id}</h3>
        <p>${item.collection} · ${item.status || "待处理"} · ${item.due || "待排期"} · ${item.assignee || item.owner || item.pharmacy || "责任人待定"}</p>
        <p>${item.nextStep || item.intervention || item.advice || item.result || "按慢病随访计划处置"}</p>
        <p>居民反馈：${latestFeedback ? `${latestFeedback.result} · ${latestFeedback.meta?.nextRequest || ""}` : "暂无新增反馈"}</p>
        <p>随访消息：${latestMessage ? `${latestMessage.title} · ${latestMessage.body || ""}` : "暂无待处理消息"}</p>
        <div class="action-row">
          ${chronicDispatchButton(item.collection, item.id, item.primary, item.updates, `慢病随访处置：${item.primary}`)}
          ${item.collection === "chronicManagementPlans" ? chronicDispatchButton(item.collection, item.id, "升级预警", { status: "预警中", intervention: "已升级家庭医生重点管理" }, "慢病管理计划升级预警") : ""}
        </div>
      </div>
      <span class="badge ${String(item.status || "").includes("逾期") || String(item.status || "").includes("预警") ? "danger" : "warn"}">${item.status || "待处理"}</span>
    </section>`;
  }).join("") || `<p class="muted">暂无待处置慢病随访事项。</p>`;
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
    ["Screening", openScreenings.length, "risk discovery and grading"],
    ["Plans", openPlans.length, "review and escalation"],
    ["Follow-ups", openFollowups.length, "post-discharge queue"],
    ["Medication", pendingMedication.length, "pickup and adherence"],
    ["Messages", followupMessages.length, "resident feedback tasks"],
    ["Feedback", feedback.length, "resident submitted records"],
    ["Alert queue", alertQueue.length, `${alertSummary.highPriorityAlerts || alertQueue.filter((item) => ["critical", "high"].includes(item.priority)).length} high priority`],
    ["Policy", `${policyCovered}/${policyAlignment.length}`, "service boundary coverage"]
  ].map(([label, value, hint]) => `<article class="claim-card chronic-metric-card"><strong>${label}</strong><span>${value}<br>${hint}</span></article>`).join("");

  const rows = filterChronicWorkbenchRows([
    ...openScreenings.map((item) => ({ ...item, collection: "chronicScreeningTasks", title: item.taskName, due: item.due, primary: "完成评估", updates: { status: "已评估", result: "已生成风险分级和干预建议" } })),
    ...openPlans.map((item) => ({ ...item, collection: "chronicManagementPlans", title: `${item.diseaseType}管理计划`, due: item.nextReview, primary: "复核完成", updates: { status: "已复核", intervention: "已完成阶段复核并更新管理方案" } })),
    ...openFollowups.map((item) => ({ ...item, collection: "followups", title: `${item.diseaseType}随访`, due: item.plannedAt, primary: "完成随访", updates: { status: "已完成", result: "已完成院后随访并同步居民反馈" } })),
    ...pendingMedication.map((item) => ({ ...item, collection: "medicationPickups", title: item.medication, due: item.nextPickup, primary: "确认依从", updates: { status: "已完成", pharmacyStatus: "已取药" } }))
  ], state).slice(0, 12);
  listEl.innerHTML = rows.map((item) => {
    const resident = residentOf(state, item.residentId);
    const latestFeedback = feedback.find((record) => record.residentId === item.residentId);
    const latestMessage = followupMessages.find((message) => message.residentId === item.residentId);
    const statusText = item.status || item.pharmacyStatus || "pending";
    const priorityClass = item.priority === "critical" ? "danger" : item.priority === "high" ? "warn" : "info";
    return `<section class="item chronic-workbench-row priority-${item.priority}">
      <div>
        <h3>${resident?.name || "Unknown resident"} - ${item.title || item.id}</h3>
        <div class="chronic-row-meta">
          <span class="badge ${priorityClass}">${item.priority}</span>
          <span>${item.dueBucket}</span>
          <span>${item.collection}</span>
          <span>${item.due || "no due date"}</span>
        </div>
        <p>${statusText} - ${item.assignee || item.owner || item.pharmacy || "owner pending"}</p>
        <p>${item.nextStep || item.intervention || item.advice || item.result || "Follow the chronic care plan and close the loop after disposition."}</p>
        <p>Feedback: ${latestFeedback ? `${latestFeedback.result} - ${latestFeedback.meta?.nextRequest || ""}` : "no new resident feedback"}</p>
        <p>Message: ${latestMessage ? `${latestMessage.title} - ${latestMessage.body || ""}` : "no open institution message"}</p>
        <div class="action-row">
          ${chronicDispatchButton(item.collection, item.id, item.primary, item.updates, `慢病随访处置：${item.primary}`)}
          ${item.collection === "chronicManagementPlans" ? chronicDispatchButton(item.collection, item.id, "升级预警", { status: "预警中", intervention: "已升级家庭医生重点管理" }, "慢病管理计划升级预警") : ""}
          ${["critical", "high"].includes(item.itemPriority) ? chronicEscalationButton(item.collection, item.id, `priority ${item.itemPriority} chronic follow-up escalation`) : ""}
        </div>
      </div>
      <span class="badge ${priorityClass}">${statusText}</span>
    </section>`;
  }).join("") || `<p class="muted chronic-empty-state">No chronic follow-up items match the current filters.</p>`;
}

function fallbackChronicReferralContinuity(state) {
  const referrals = state.referralSystem?.referrals || [];
  const records = state.personalRecords || [];
  const consultations = state.referralTeleconsultations || [];
  const rows = referrals.map((item) => {
      const continuity = records.find((record) => record.category === "chronic-referral-continuity" && record.meta?.referralId === item.id);
      const consultation = consultations.find((row) => row.referralId === item.id);
      const primaryCareAccepted = Boolean(continuity?.meta?.primaryCareAccepted || /基层承接|承接/.test(String(item.status || "")));
      const reportReturned = /returned|回传/.test(`${consultation?.status || ""}${consultation?.reportStatus || ""}`);
      const archiveAvailable = records.some((record) => record.residentId === item.residentId && ["emr", "labs", "physical-exam"].includes(record.category));
      const archiveUpdated = Boolean(continuity?.meta?.archiveUpdated);
      const familyRiskPrompted = Boolean(continuity?.meta?.familyRiskPrompted);
      const followupPlanned = Boolean(continuity?.meta?.nextFollowupAt || (state.followups || []).some((row) => row.residentId === item.residentId));
      return { referralId: item.id, residentId: item.residentId, type: item.type, diseaseType: item.diseaseType, status: item.status, primaryCareAccepted, reportReturned, archiveAvailable, archiveUpdated, familyRiskPrompted, followupPlanned, nextFollowupAt: continuity?.meta?.nextFollowupAt || "", ready: primaryCareAccepted && reportReturned && archiveAvailable && followupPlanned };
    });
  return {
    summary: {
      referrals: rows.length,
      ready: rows.filter((item) => item.ready).length,
      archivedHandoffs: rows.filter((item) => item.archiveUpdated).length,
      familyRiskPrompts: rows.filter((item) => item.familyRiskPrompted).length
    },
    rows
  };
}

function renderChronicReferralContinuity(state) {
  const summaryEl = document.querySelector("#chronic-referral-continuity-summary");
  const listEl = document.querySelector("#chronic-referral-continuity");
  if (!summaryEl || !listEl) return;
  const report = state.chronicReferralContinuity || fallbackChronicReferralContinuity(state);
  const rows = report.rows || [];
  const ready = report.summary?.ready ?? rows.filter((item) => item.ready).length;
  summaryEl.textContent = `${ready}/${rows.length} referral handoffs ready`;
  listEl.innerHTML = rows.map((item) => `<section class="item">
    <div>
      <h3>${residentOf(state, item.residentId)?.name || item.residentId} · ${item.diseaseType || "chronic referral"}</h3>
      <p>${item.type || "referral"} · ${item.status || "pending"} · report ${item.reportReturned ? "returned" : "pending"} · primary care ${item.primaryCareAccepted ? "accepted" : "pending"}</p>
      <p>Archive ${item.archiveUpdated ? "updated" : "pending"} · standard map ${item.archiveMapping ? `${item.archiveMapping.mappedDimensions}/${item.archiveMapping.totalDimensions}` : "not calculated"} · family risk ${item.familyRiskPrompted ? "prompted" : "pending"} · next follow-up ${item.nextFollowupAt || "pending"}</p>
      <div class="action-row">${item.ready ? "" : `<button class="inline-action" type="button" data-chronic-referral-continuity="${item.referralId}">Record handoff</button>`}</div>
    </div>
    <span class="badge ${item.ready ? "info" : "warn"}">${item.ready ? "ready" : "needs closure"}</span>
  </section>`).join("") || `<p class="muted">No chronic referral handoffs in the current scope.</p>`;
}

function fallbackChronicArchiveStandardization(state) {
  const residents = state.residents || [];
  const hasRecord = (residentId, categories) => (state.personalRecords || []).some((item) => item.residentId === residentId && categories.includes(item.category));
  const definitions = [
    ["identity", "Resident identification", "WS/T 363.2-2023 / WS/T 364.2-2023", "residents", ["residentId", "personIndex"], (resident) => Boolean(resident.personIndex)],
    ["health-history", "Health history and chronic problems", "WS/T 363.4-2023 / WS/T 364.4-2023", "diseases", ["diseaseType", "diagnosisDate"], (resident) => (state.diseases || []).some((item) => item.residentId === resident.id && (item.type || item.diagnosis))],
    ["risk-factors", "Health risk factors", "WS/T 363.5-2023 / WS/T 364.5-2023", "chronicScreeningTasks", ["riskLevel", "screenedAt", "sourceIndicator"], (resident) => (state.chronicScreeningTasks || []).some((item) => item.residentId === resident.id && (item.riskLevel || item.risk))],
    ["physical-lab", "Physical examination and laboratory evidence", "WS/T 363.7-2023 / WS/T 363.9-2023", "personalRecords", ["measurement", "result", "reportedAt"], (resident) => hasRecord(resident.id, ["physical-exam", "labs"])],
    ["diagnosis", "Diagnosis", "WS/T 363.10-2023 / WS/T 364.10-2023", "diseases", ["diagnosis", "icdCode", "diagnosisDate"], (resident) => (state.diseases || []).some((item) => item.residentId === resident.id && (item.type || item.diagnosis))],
    ["assessment", "Assessment and stratification", "WS/T 363.11-2023 / WS/T 364.11-2023", "chronicManagementPlans", ["grade", "assessment", "nextReview"], (resident) => (state.chronicManagementPlans || []).some((item) => item.residentId === resident.id && (item.grade || item.riskLevel || item.risk))],
    ["intervention", "Plan and intervention", "WS/T 363.12-2023 / WS/T 364.12-2023", "chronicManagementPlans / followups", ["intervention", "plannedAt", "assignee"], (resident) => (state.chronicManagementPlans || []).some((item) => item.residentId === resident.id && item.intervention) || (state.followups || []).some((item) => item.residentId === resident.id && item.plannedAt)],
    ["health-management", "Health management continuity", "WS/T 363.17-2023 / WS/T 364.17-2023", "personalRecords", ["followupFeedback", "referralId", "nextFollowupAt"], (resident) => hasRecord(resident.id, ["chronic-feedback", "chronic-referral-continuity"])]
  ];
  const dimensions = definitions.map(([id, title, standard, source, fields, covered]) => {
    const missingResidentIds = residents.filter((resident) => !covered(resident)).map((resident) => resident.id);
    return { id, title, standard, source, fields, coveredResidents: residents.length - missingResidentIds.length, totalResidents: residents.length, missingResidentIds, status: missingResidentIds.length ? "needs-source-mapping" : "mapped" };
  });
  return { ok: true, standardVersion: "WS/T 363/364-2023", summary: { residents: residents.length, dimensions: dimensions.length, mappedDimensions: dimensions.filter((item) => item.status === "mapped").length, dimensionsWithGaps: dimensions.filter((item) => item.status !== "mapped").length }, dimensions };
}

function renderChronicArchiveStandardization(state) {
  const summaryEl = document.querySelector("#chronic-archive-standard-summary");
  const listEl = document.querySelector("#chronic-archive-standard");
  if (!summaryEl || !listEl) return;
  const report = state.chronicArchiveStandardization || fallbackChronicArchiveStandardization(state);
  const dimensions = report.dimensions || [];
  const mapped = report.summary?.mappedDimensions ?? dimensions.filter((item) => item.status === "mapped").length;
  summaryEl.textContent = `${mapped}/${dimensions.length} archive dimensions mapped`;
  listEl.innerHTML = dimensions.map((item) => `<section class="item">
    <div>
      <h3>${item.title}</h3>
      <p>${item.standard} · ${item.source}</p>
      <p>${item.coveredResidents}/${item.totalResidents} residents · fields: ${(item.fields || []).join(", ")}</p>
      ${item.missingResidentIds?.length ? `<p>Source mapping pending: ${item.missingResidentIds.join(", ")}</p>` : ""}
    </div>
    <span class="badge ${item.status === "mapped" ? "info" : "warn"}">${item.status}</span>
  </section>`).join("") || `<p class="muted">No chronic archive data in the current scope.</p>`;
}

function fallbackChronicPathwayQuality(state) {
  const diseasePathways = (state.diseaseRegistryModels || []).map((item) => ({
    modelId: item.id,
    diseaseType: item.diseaseType,
    version: item.version,
    threshold: item.threshold,
    registered: 0,
    managementPlans: 0,
    followups: 0,
    medicationClosed: 0,
    qualitySampling: "static-preview",
    status: "static-preview"
  }));
  return { summary: { activeDiseasePathways: 0, evidenceCompletePathways: 0 }, diseasePathways, indicators: [] };
}

function renderChronicPathwayQuality(state) {
  const summaryEl = document.querySelector("#chronic-pathway-quality-summary");
  const indicatorsEl = document.querySelector("#chronic-pathway-quality-indicators");
  const pathwaysEl = document.querySelector("#chronic-pathway-quality-pathways");
  if (!summaryEl || !indicatorsEl || !pathwaysEl) return;
  const report = state.chronicPathwayQuality || fallbackChronicPathwayQuality(state);
  const summary = report.summary || {};
  summaryEl.textContent = `${summary.evidenceCompletePathways || 0}/${summary.activeDiseasePathways || 0} active pathways evidence complete`;
  indicatorsEl.innerHTML = (report.indicators || []).map((item) => `<article class="claim-card"><strong>${item.metric}</strong><span>${item.value === null ? "N/A" : `${item.value}%`}<br>${item.evidence}</span></article>`).join("") || `<p class="muted">Quality indicators require the runtime API.</p>`;
  pathwaysEl.innerHTML = (report.diseasePathways || []).map((item) => `<section class="item"><div><h3>${item.diseaseType} · ${item.version}</h3><p>registered ${item.registered} · plans ${item.managementPlans} · follow-ups ${item.followups} · medication closure ${item.medicationClosed}</p><p>threshold ${item.threshold || "pending"} · quality sampling ${item.qualitySampling || "pending"}</p></div><span class="badge ${item.status === "evidence-complete" ? "info" : "warn"}">${item.status}</span></section>`).join("") || `<p class="muted">No disease pathways are available in the current scope.</p>`;
}

function fallbackChronicPharmacyInsuranceClosure(state) {
  const rows = (state.medicationPickups || []).map((item) => ({
    medicationPickupId: item.id,
    residentId: item.residentId,
    medication: item.medication,
    pharmacy: item.pharmacy,
    prescriptionConfirmed: Boolean(item.institutionReview),
    insuranceApproved: Boolean(item.insuranceReview),
    settlementReceipt: false,
    inventoryConfirmed: Boolean(item.inventoryStatus),
    pharmacyCallback: Boolean(item.callbackExternalId || item.pickupConfirmedAt),
    closed: false,
    closureStatus: "static-preview",
    missing: ["runtime reconciliation evidence"]
  }));
  return { summary: { pickups: rows.length, closed: 0, exceptions: rows.length }, rows };
}

function renderChronicPharmacyInsuranceClosure(state) {
  const summaryEl = document.querySelector("#chronic-pharmacy-insurance-summary");
  const metricsEl = document.querySelector("#chronic-pharmacy-insurance-metrics");
  const rowsEl = document.querySelector("#chronic-pharmacy-insurance-rows");
  if (!summaryEl || !metricsEl || !rowsEl) return;
  const report = state.chronicPharmacyInsuranceClosure || fallbackChronicPharmacyInsuranceClosure(state);
  const summary = report.summary || {};
  summaryEl.textContent = `${summary.closed || 0}/${summary.pickups || 0} medication closures complete`;
  metricsEl.innerHTML = [
    ["Prescription", summary.prescriptionsConfirmed || 0],
    ["Insurance", summary.insuranceApproved || 0],
    ["Settlement", summary.settlementReceipts || 0],
    ["Pharmacy callback", summary.pharmacyCallbacks || 0]
  ].map(([label, value]) => `<article class="claim-card"><strong>${label}</strong><span>${value}<br>authorized evidence rows</span></article>`).join("");
  rowsEl.innerHTML = (report.rows || []).map((item) => `<section class="item"><div><h3>${item.residentName || residentOf(state, item.residentId)?.name || item.residentId} 路 ${item.medication}</h3><p>${item.pharmacy || "pharmacy pending"} 路 long prescription ${item.longPrescription || "pending"} 路 claim ${item.claimId || "unlinked"}</p><p>Prescription ${item.prescriptionConfirmed ? "confirmed" : "pending"} 路 insurance ${item.insuranceApproved ? "approved" : "pending"} 路 settlement ${item.settlementReceipt ? "received" : "pending"} 路 callback ${item.pharmacyCallback ? "received" : "pending"}</p><p>${item.closed ? "Closure evidence retained" : `Next: ${(item.missing || []).join(", ")}`}</p></div><span class="badge ${item.closed ? "info" : "warn"}">${item.closed ? "closed" : item.closureStatus || "open"}</span></section>`).join("") || `<p class="muted">No medication closure records are available in the current scope.</p>`;
}

function fallbackChronicProductionSafety() {
  return {
    functionalState: "static-preview",
    formalGoLiveState: "site-evidence-pending",
    summary: { controls: 0, controlsPassed: 0, blockers: 1 },
    checks: [],
    blockers: [{ name: "Runtime production evidence", nextAction: "Open the Node API with an authorized institution or commission account to view environment and cutover controls." }]
  };
}

function renderChronicProductionSafety(state) {
  const summaryEl = document.querySelector("#chronic-production-safety-summary");
  const checksEl = document.querySelector("#chronic-production-safety-checks");
  const blockersEl = document.querySelector("#chronic-production-safety-blockers");
  const evidenceEl = document.querySelector("#chronic-production-safety-evidence");
  if (!summaryEl || !checksEl || !blockersEl || !evidenceEl) return;
  const report = state.chronicProductionSafety || fallbackChronicProductionSafety();
  const summary = report.summary || {};
  summaryEl.textContent = `${report.formalGoLiveState || "site-evidence-pending"} 路 ${summary.controlsPassed || 0}/${summary.controls || 0} controls`;
  checksEl.innerHTML = [
    ["Functional state", report.functionalState || "pending"],
    ["Formal go-live", report.formalGoLiveState || "pending"],
    ["Controls passed", `${summary.controlsPassed || 0}/${summary.controls || 0}`],
    ["Open blockers", summary.blockers || 0]
  ].map(([label, value]) => `<article class="claim-card"><strong>${label}</strong><span>${value}<br>no secret values exposed</span></article>`).join("");
  blockersEl.innerHTML = (report.blockers || []).map((item) => `<section class="item"><div><h3>${item.name}</h3><p>${item.source || "production control"}</p><p>${item.nextAction || "complete and retain acceptance evidence"}</p></div><span class="badge warn">pending</span></section>`).join("") || `<p class="muted">No unresolved production-safety controls are reported. Formal approval remains a separate governance decision.</p>`;
  const evidence = state.chronicProductionSafetyEvidence || { summary: { evidenceVerified: 0, requirements: 0 }, rows: [] };
  const evidenceSummary = evidence.summary || {};
  evidenceEl.innerHTML = `<section class="item"><div><h3>Verified site evidence bridge</h3><p>${evidenceSummary.evidenceVerified || 0}/${evidenceSummary.requirements || 0} chronic safety evidence requirements have verified site material.</p><p>${evidence.boundary || "Verified evidence supports traceability only; formal production approval remains separate."}</p></div><span class="badge ${(evidenceSummary.evidencePending || 0) ? "warn" : "info"}">${(evidenceSummary.evidencePending || 0) ? "evidence pending" : "evidence mapped"}</span></section>${(evidence.rows || []).filter((item) => !item.evidenceVerified).map((item) => `<section class="item"><div><h3>${item.name}</h3><p>${item.owner || "site-launch-owner"}</p><p>${item.nextAction}</p></div><span class="badge warn">pending</span></section>`).join("")}`;
}

function renderChronicInteroperabilityProfiles(state) {
  const summaryEl = document.querySelector("#chronic-interoperability-summary");
  const profilesEl = document.querySelector("#chronic-interoperability-profiles");
  const evidenceEl = document.querySelector("#chronic-interoperability-evidence");
  if (!summaryEl || !profilesEl || !evidenceEl) return;
  const report = state.chronicInteroperabilityProfiles || { summary: { profiles: 0, dataElementProfiles: 0, interactionProfiles: 0, signatureProfiles: 0 }, profiles: [], boundary: "Open the authorized Node API to view the live interoperability standard baseline." };
  const summary = report.summary || {};
  summaryEl.textContent = `${summary.profiles || 0} profiles / WS/T 363/364 + 846 + 847`;
  profilesEl.innerHTML = [
    ["Data elements", summary.dataElementProfiles || 0, "WS/T 363/364"],
    ["Interactions", summary.interactionProfiles || 0, "WS/T 846"],
    ["Signatures", summary.signatureProfiles || 0, "WS/T 847"]
  ].map(([label, value, standard]) => `<article class="claim-card"><strong>${label}</strong><span>${value}<br>${standard}</span></article>`).join("");
  evidenceEl.innerHTML = (report.profiles || []).map((item) => `<section class="item"><div><h3>${item.name}</h3><p>${(item.standards || []).join(" / ")}</p><p>Required: ${(item.requiredFields || []).join(", ")}</p><p>Production evidence: ${(item.productionEvidence || []).join(", ")}</p></div><span class="badge warn">prevalidation</span></section>`).join("") || `<p class="muted">${report.boundary}</p>`;
}

async function recordChronicReferralContinuity(referralId) {
  const referral = (platformState.referralSystem?.referrals || []).find((item) => item.id === referralId) || {};
  const resident = residentOf(platformState, referral.residentId) || {};
  const occurredAt = new Date().toISOString();
  const payload = {
    referralId,
    externalId: `institution-handoff-${referralId}-${new Date().toISOString().slice(0, 10)}`,
    standardsProfile: "chronic-referral-return-v1",
    personIndex: resident.personIndex || "",
    sourceSystem: "institution-workbench",
    occurredAt,
    returnStatus: "returned-to-primary-care",
    diagnosis: referral.diseaseType || referral.reason || "chronic disease",
    primaryCareAccepted: true,
    archiveUpdated: true,
    familyRiskPrompted: true,
    nextFollowupAt: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    receivingFeedback: "primary-care institution confirmed receipt of referral plan",
    result: "institution workbench recorded chronic referral primary-care handoff"
  };
  if (!institutionApiBase) {
    platformState.personalRecords = [{ id: `local-referral-${Date.now()}`, residentId: referral.residentId, category: "chronic-referral-continuity", meta: payload }, ...(platformState.personalRecords || [])];
    platformState.chronicReferralContinuity = fallbackChronicReferralContinuity(platformState);
    return { ok: true };
  }
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${institutionApiBase}/chronic/referral-continuity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`referral continuity failed: ${response.status}`);
    await response.json();
    await refreshChronicRuntimeState();
    return { ok: true };
  } catch (error) {
    alert(error.message || "Unable to record chronic referral handoff");
    return { ok: false };
  }
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

function populateTeleconsultationForm(state) {
  const form = document.querySelector("#teleconsultation-form");
  if (!form) return;
  const authSelect = form.querySelector("select[name='residentAuthorizationId']");
  const referralSelect = form.querySelector("select[name='referralId']");
  const authorizations = (state.personalRecords || [])
    .filter((item) => item.category === "authorizations" && item.status !== "revoked" && item.meta?.status !== "revoked");
  authSelect.innerHTML = authorizations.map((record) => {
    const resident = residentOf(state, record.residentId);
    return `<option value="${record.id}" data-resident-id="${record.residentId}">${resident?.name || record.residentId} · ${record.name || "authorization"}</option>`;
  }).join("");
  const referrals = state.referralSystem?.referrals || [];
  referralSelect.innerHTML = [`<option value="">No linked referral</option>`, ...referrals.map((item) => {
    const resident = residentOf(state, item.residentId);
    return `<option value="${item.id}">${resident?.name || item.residentId} · ${item.type || "referral"} · ${item.status || ""}</option>`;
  })].join("");
  const target = form.querySelector("input[name='targetInstitution']");
  const targetCode = form.querySelector("input[name='targetInstitutionCode']");
  const department = form.querySelector("input[name='department']");
  if (target && !target.value) target.value = "Dalian Central Hospital";
  if (targetCode && !targetCode.value) targetCode.value = "MR1";
  if (department && !department.value) department.value = "Cardiology";
}

async function submitTeleconsultation(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const selected = form.querySelector("select[name='residentAuthorizationId']")?.selectedOptions?.[0];
  const formData = Object.fromEntries(new FormData(form));
  const doctor = (platformState.doctorProfiles || [])[0] || {};
  const payload = {
    ...formData,
    residentId: selected?.dataset.residentId || "",
    sourceInstitution: doctor.primaryInstitution || "",
    sourceInstitutionCode: doctor.primaryInstitutionId || "",
    applicantDoctor: doctor.id || "",
    type: "teleconsultation",
    status: "requested",
    materials: ["EMR summary", "resident authorization", "primary care note"],
    note: "Created from institution teleconsultation form"
  };
  const submit = form.querySelector("button[type='submit']");
  submit.disabled = true;
  try {
    let saved;
    if (institutionApiBase) {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${institutionApiBase}/referral-teleconsultations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || `Teleconsultation creation failed: ${response.status}`);
      }
      saved = await response.json();
    } else {
      saved = {
        ...payload,
        id: `rtc-local-${Date.now()}`,
        authorizationStatus: "authorized",
        reportStatus: "pending-return",
        receivingFeedback: "",
        reportSummary: "",
        auditTrail: [{ at: new Date().toISOString(), actor: "local-preview", action: "created", note: payload.note }],
        performance: { responseHours: 0, reportReturnHours: 0, satisfaction: "pending" },
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
      };
    }
    platformState.referralTeleconsultations = [saved, ...(platformState.referralTeleconsultations || [])];
    form.reset();
    populateTeleconsultationForm(platformState);
    renderTeleconsultationLoop(platformState);
  } catch (error) {
    alert(error.message || "Teleconsultation creation failed. Check resident authorization and role scope.");
  } finally {
    submit.disabled = false;
  }
}

async function submitTeleconsultationAction(event) {
  const form = event.target.closest(".teleconsultation-action-form");
  if (!form) return;
  event.preventDefault();
  const formData = Object.fromEntries(new FormData(form));
  const updates = {
    status: formData.status,
    receivingFeedback: formData.receivingFeedback,
    reportSummary: formData.reportSummary
  };
  if (formData.status === "report-returned") updates.reportStatus = "returned";
  Object.keys(updates).forEach((key) => {
    if (!updates[key]) delete updates[key];
  });
  const submit = form.querySelector("button[type='submit']");
  submit.disabled = true;
  const result = await updateWorkflowAction(
    platformState,
    "referralTeleconsultations",
    form.dataset.id,
    updates,
    formData.note || "Referral teleconsultation feedback updated"
  );
  submit.disabled = false;
  if (result.ok) renderAll(platformState);
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

function institutionRegistrationIntegrationLabel(value) {
  return {
    "payment-succeeded": "支付成功回调",
    "payment-failed": "支付失败回调",
    "his-confirmed": "HIS 确认回调",
    "insurance-confirmed": "医保确认回调",
    "checked-in": "报到回调",
    completed: "完诊回调",
    "refund-completed": "退费完成回调",
    "refund-failed": "退费失败回调",
    matched: "已匹配",
    pending: "待对账",
    failed: "失败",
    rejected: "已拒绝",
    "dead-letter": "死信",
    retrying: "重试中",
    "manual-review": "人工对账中",
    "manual-resolved": "人工已结案",
    "manual-closure": "人工结案",
    assigned: "已分派",
    resolved: "已结案",
    "manual-compensation": "人工补偿完成",
    "duplicate-confirmed": "确认重复回调",
    "upstream-cancelled": "上游已撤销",
    landed: "已入库",
    "callback-received-demo": "已收到回调",
    "callback-exception-open": "回调异常待处理"
  }[value] || value || "待处理";
}

function institutionRegistrationIntegrationReason(value) {
  const reason = String(value || "").trim();
  if (reason.startsWith("role ") && reason.includes(" cannot submit ")) return "当前角色无权提交该预约回调。";
  return {
    "unsupported appointment callback eventType": "不支持的预约回调类型。",
    "orderNo is required": "回调缺少预约订单号。",
    "occurredAt is required": "回调缺少业务发生时间。",
    "registration order not found for callback": "未找到与回调匹配的预约订单。",
    "registration callback scope denied": "回调不属于当前机构。",
    "payment callback is not allowed after closure": "订单关闭后不能再接收支付成功回调。",
    "payment failure is not allowed after closure": "订单关闭后不能再接收支付失败回调。",
    "HIS confirmation requires an open order with payment evidence": "HIS 确认要求订单未关闭且已有支付凭据。",
    "check-in callback requires an open order with payment and HIS confirmation": "报到回调要求订单未关闭，且支付与 HIS 确认均已完成。",
    "completion callback requires an open checked-in order": "完诊回调要求订单未关闭且已完成报到。",
    "refund callback requires a cancelled refund-pending order": "退费完成回调要求订单已取消且处于待退费状态。",
    "refund failure requires a cancelled refund-pending order": "退费失败回调要求订单已取消且处于待退费状态。"
  }[reason] || reason;
}

function institutionRegistrationAllowedActions(order) {
  if (Array.isArray(order.allowedActions)) return order.allowedActions;
  if (order.disruption?.status === "pending-resident") return [];
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

function institutionRegistrationDisruptionLabel(value) {
  return {
    "doctor-unavailable": "医生停诊",
    "schedule-adjustment": "排班调整",
    "clinic-suspended": "门诊暂停",
    "pending-resident": "待居民确认",
    accepted: "改签已确认",
    cancelled: "居民选择退号",
    withdrawn: "通知已撤回",
    "supplement-pending": "待补缴差额",
    "partial-refund-pending": "待退差额",
    "not-required": "无需补退"
  }[value] || value || "待处理";
}

function institutionRegistrationWaitlistLabel(value) {
  return {
    waiting: "候补排队中",
    "offer-pending": "待居民确认",
    accepted: "候补已转预约",
    declined: "居民已拒绝",
    withdrawn: "居民已退出",
    expired: "确认已超时"
  }[value] || value || "待处理";
}

function institutionRegistrationWaitlistTime(value) {
  const parsed = new Date(value || "");
  return Number.isNaN(parsed.getTime()) ? String(value || "待确认") : parsed.toLocaleString("zh-CN", { hour12: false });
}

function renderRegistrationDisruptionControls(order, schedules = []) {
  const disruption = order.disruption && typeof order.disruption === "object" ? order.disruption : null;
  const disruptionActions = Array.isArray(order.disruptionActions) ? order.disruptionActions : [];
  const alternatives = schedules.filter((schedule) =>
    schedule.id !== order.scheduleId &&
    schedule.status !== "closed" &&
    Number(schedule.remaining || 0) > 0 &&
    (!order.hospitalCode || schedule.hospitalCode === order.hospitalCode) &&
    (!order.departmentCode || schedule.departmentCode === order.departmentCode)
  );
  if (!disruption && disruptionActions.includes("notify")) {
    if (!alternatives.length) return `<small>同院同科暂无可用替代号源，暂不能发起改签通知。</small>`;
    const defaultDue = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
    return `<div class="action-row registration-disruption-form" data-registration-disruption-form="notify">
      <select class="inline-action-select" aria-label="停诊变更类型" data-registration-disruption-type><option value="doctor-unavailable">医生停诊</option><option value="schedule-adjustment">排班调整</option><option value="clinic-suspended">门诊暂停</option></select>
      <select class="inline-action-select" aria-label="替代预约号源" data-registration-disruption-schedule>${alternatives.map((schedule) => `<option value="${institutionEscapeHtml(schedule.id)}">${institutionEscapeHtml(schedule.date)} ${institutionEscapeHtml(schedule.period)} · ${institutionEscapeHtml(schedule.doctor || "医生待确认")} · 余号 ${Number(schedule.remaining || 0)}</option>`).join("")}</select>
      <input class="inline-action-input" type="datetime-local" value="${defaultDue}" aria-label="居民确认时限" data-registration-disruption-due>
      <input class="inline-action-input" type="text" maxlength="200" aria-label="停诊改签原因" data-registration-disruption-reason placeholder="填写停诊或排班变更原因">
      <button type="button" class="inline-action" data-registration-id="${institutionEscapeHtml(order.id)}" data-registration-disruption-action="notify">发送改签通知</button>
    </div>`;
  }
  if (!disruption) return "";
  const proposed = disruption.proposedSchedule || {};
  const dueTime = Date.parse(disruption.acknowledgementDueAt || "");
  const overdue = disruption.status === "pending-resident" && Number.isFinite(dueTime) && dueTime < Date.now();
  const summary = `<div class="registration-disruption-summary"><small>${institutionEscapeHtml(institutionRegistrationDisruptionLabel(disruption.type))} · ${institutionEscapeHtml(institutionRegistrationDisruptionLabel(disruption.status))}${overdue ? " · 已逾期" : ""}</small><small>原预约 ${institutionEscapeHtml(disruption.originalSchedule?.appointmentDate || "待确认")} ${institutionEscapeHtml(disruption.originalSchedule?.period || "")} → 建议 ${institutionEscapeHtml(proposed.appointmentDate || "待确认")} ${institutionEscapeHtml(proposed.period || "")} · ${institutionEscapeHtml(proposed.doctor || "医生待确认")}</small><small>原因 ${institutionEscapeHtml(disruption.reason || "未登记")} · 居民确认时限 ${institutionEscapeHtml(disruption.acknowledgementDueAt || "未设置")}</small></div>`;
  if (disruption.status === "pending-resident" && disruptionActions.includes("withdraw")) {
    return `${summary}<div class="action-row" data-registration-disruption-form="withdraw"><input class="inline-action-input" type="text" maxlength="200" aria-label="撤回改签通知原因" data-registration-disruption-note placeholder="填写撤回原因"><button type="button" class="inline-action" data-registration-id="${institutionEscapeHtml(order.id)}" data-registration-disruption-action="withdraw">撤回改签通知</button></div>`;
  }
  if (disruption.status === "accepted") {
    return `${summary}<small>费用差额 ${Number(disruption.feeDifference || 0).toFixed(2)} 元 · ${institutionEscapeHtml(institutionRegistrationDisruptionLabel(disruption.paymentAdjustmentStatus))} · 新号源仍待 HIS 确认</small>`;
  }
  return summary;
}

function renderRegistrationJourneyWorkbench(state) {
  const metricsTarget = document.querySelector("#registration-journey-metrics");
  const ordersTarget = document.querySelector("#registration-journey-orders");
  const boundaryTarget = document.querySelector("#registration-journey-boundary");
  if (!metricsTarget || !ordersTarget || !boundaryTarget) return;
  const dashboard = institutionRegistrationDashboard || { orders: state.registrationOrders || [], journey: {} };
  const orders = dashboard.orders || [];
  const schedules = dashboard.schedules || [];
  const metrics = [
    ["本院预约", orders.length, "HIS/互联网医院"],
    ["待医院确认", orders.filter((item) => ["paid", "paid-demo", "waived"].includes(item.paymentStatus) && !["confirmed", "confirmed-demo"].includes(item.hisConfirmationStatus)).length, "支付后处理"],
    ["已报到", orders.filter((item) => ["checked-in", "checked-in-demo"].includes(item.checkInStatus)).length, "等待完诊"],
    ["待退款", orders.filter((item) => item.refundStatus === "refund-pending").length, "退款闭环"],
    ["待居民确认", orders.filter((item) => item.disruption?.status === "pending-resident").length, "停诊改签"],
    ["改签已确认", orders.filter((item) => item.disruption?.status === "accepted").length, "重新锁号"]
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
        ${renderRegistrationDisruptionControls(order, schedules)}
      </div>
      <div class="capability-side"><span class="badge ${actions.length ? "warn" : "info"}">${institutionEscapeHtml(institutionRegistrationStatus(order.status))}</span><small>生产：否</small></div>
    </article>`;
  }).join("") || `<p class="muted">本机构暂无预约就诊订单。</p>`;
  boundaryTarget.textContent = dashboard.journey?.boundary || "本工作台动作仅为本地业务闭环证据，生产仍需 HIS、支付退款和医保结算接口。";
  renderRegistrationWaitlistWorkbench(dashboard.waitlist || {});
  renderRegistrationIntegrationCenter(dashboard.integrationCenter || {});
}

function renderRegistrationWaitlistWorkbench(center = {}) {
  const statusTarget = document.querySelector("#registration-waitlist-status");
  const metricsTarget = document.querySelector("#registration-waitlist-metrics");
  const entriesTarget = document.querySelector("#registration-waitlist-entries");
  const boundaryTarget = document.querySelector("#registration-waitlist-boundary");
  if (!statusTarget || !metricsTarget || !entriesTarget || !boundaryTarget) return;
  const summary = center.summary || {};
  const entries = center.entries || [];
  statusTarget.textContent = `${Number(summary.waiting || 0)} 人候补 · ${Number(summary.offers || 0)} 人待确认`;
  const metrics = [
    ["候补排队", summary.waiting || 0, "FIFO 队列"],
    ["待居民确认", summary.offers || 0, "限时占号"],
    ["确认超时", summary.overdueOffers || 0, "释放递补"],
    ["已转预约", summary.accepted || 0, "闭环订单"]
  ];
  metricsTarget.innerHTML = metrics.map(([name, value, detail]) => `<article class="metric-card"><span>${name}</span><strong>${Number(value || 0)}</strong><small>${detail}</small></article>`).join("");
  entriesTarget.innerHTML = entries.map((entry) => {
    const actions = Array.isArray(entry.allowedActions) ? entry.allowedActions : [];
    const schedule = entry.schedule || {};
    const offerControls = actions.includes("promote") ? `<div class="action-row">
      <select class="inline-action-select" aria-label="候补确认时限" data-registration-waitlist-offer-minutes><option value="15">15 分钟</option><option value="30" selected>30 分钟</option><option value="60">60 分钟</option></select>
      <input class="inline-action-input" type="text" maxlength="200" aria-label="候补补位说明" data-registration-waitlist-note value="释放号源按 FIFO 顺序自动补位">
      <button type="button" class="inline-action" data-registration-waitlist-id="${institutionEscapeHtml(entry.id)}" data-registration-waitlist-action="promote">发送候补号源</button>
    </div>` : "";
    const expireControls = actions.includes("expire") ? `<div class="action-row"><input class="inline-action-input" type="text" maxlength="200" aria-label="候补超时释放说明" data-registration-waitlist-note value="居民确认超时，释放号源并递补下一位"><button type="button" class="inline-action" data-registration-waitlist-id="${institutionEscapeHtml(entry.id)}" data-registration-waitlist-action="expire">释放并递补</button></div>` : "";
    return `<section class="item" data-registration-waitlist-entry="${institutionEscapeHtml(entry.id)}">
      <div>
        <h3>${institutionEscapeHtml(entry.residentName || entry.residentId)} · ${institutionEscapeHtml(schedule.department || entry.department || "门诊")}</h3>
        <p>${institutionEscapeHtml(schedule.date || entry.appointmentDate || "待确认")} ${institutionEscapeHtml(schedule.period || entry.period || "")} · ${institutionEscapeHtml(schedule.doctor || entry.doctor || "医生待确认")} · 余号 ${Number(schedule.remaining || 0)}</p>
        <small>${entry.position ? `候补第 ${Number(entry.position)} 位 · ` : ""}${institutionEscapeHtml(institutionRegistrationWaitlistLabel(entry.status))}${entry.offerExpiresAt ? ` · 确认截止 ${institutionEscapeHtml(institutionRegistrationWaitlistTime(entry.offerExpiresAt))}` : ""}</small>
        ${offerControls}${expireControls}
      </div>
      <span class="badge ${entry.offerExpired ? "danger" : entry.status === "offer-pending" ? "warn" : entry.status === "accepted" ? "info" : ""}">${institutionEscapeHtml(institutionRegistrationWaitlistLabel(entry.status))}</span>
    </section>`;
  }).join("") || `<p class="muted">本机构暂无预约候补记录。</p>`;
  boundaryTarget.textContent = center.boundary || "候补补位仅形成本地号源占用与通知证据，生产仍需 HIS 锁号和正式送达回执。";
}

function renderRegistrationReconciliationControls(event) {
  const retryCount = Number(event.retryCount || 0);
  const item = event.manualReconciliation && typeof event.manualReconciliation === "object" ? event.manualReconciliation : null;
  const eventId = institutionEscapeHtml(event.id);
  if (!item && event.deadLetter && retryCount >= 3) {
    const defaultDue = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return `<div class="action-row" data-registration-reconciliation-form="assign">
      <input class="inline-action-input" type="text" maxlength="80" aria-label="人工对账责任人" data-registration-reconciliation-owner placeholder="责任人">
      <input class="inline-action-input" type="date" value="${defaultDue}" aria-label="人工对账处理时限" data-registration-reconciliation-due>
      <select class="inline-action-select" aria-label="人工对账优先级" data-registration-reconciliation-priority><option value="P0">P0</option><option value="P1" selected>P1</option><option value="P2">P2</option></select>
      <input class="inline-action-input" type="text" maxlength="200" aria-label="人工对账分派备注" data-registration-reconciliation-note placeholder="分派与处置说明">
      <button type="button" class="inline-action" data-registration-reconciliation-event="${eventId}" data-registration-reconciliation-action="assign">转人工对账</button>
    </div>`;
  }
  if (!item) return "";
  const dueTime = /^\d{4}-\d{2}-\d{2}$/.test(String(item.dueAt || "")) ? Date.parse(`${item.dueAt}T23:59:59`) : Date.parse(item.dueAt || "");
  const overdue = item.status === "assigned" && Number.isFinite(dueTime) && dueTime < Date.now();
  const summary = `<small>人工工单 ${institutionEscapeHtml(item.id)} · ${institutionEscapeHtml(item.priority || "P1")} · ${institutionEscapeHtml(item.owner || "责任人待定")} · 时限 ${institutionEscapeHtml(item.dueAt || "待设置")}${overdue ? " · 已逾期" : ""}</small>`;
  if (item.status === "assigned") {
    return `${summary}<div class="action-row" data-registration-reconciliation-form="resolve">
      <select class="inline-action-select" aria-label="人工对账结论" data-registration-reconciliation-resolution><option value="">选择结案结论</option><option value="manual-compensation">人工补偿完成</option><option value="duplicate-confirmed">确认重复回调</option><option value="upstream-cancelled">上游已撤销</option></select>
      <input class="inline-action-input" type="text" maxlength="240" aria-label="人工对账证据引用" data-registration-reconciliation-evidence placeholder="补偿回执或证据引用">
      <input class="inline-action-input" type="text" maxlength="200" aria-label="人工对账结案备注" data-registration-reconciliation-note placeholder="结案说明">
      <button type="button" class="inline-action" data-registration-reconciliation-event="${eventId}" data-registration-reconciliation-action="resolve">登记结案</button>
    </div>`;
  }
  if (item.status === "resolved") {
    return `${summary}<small>结论 ${institutionEscapeHtml(institutionRegistrationIntegrationLabel(item.resolution))} · 证据 ${institutionEscapeHtml(item.evidenceRef || "未登记")}</small><div class="action-row" data-registration-reconciliation-form="reopen">
      <input class="inline-action-input" type="text" maxlength="200" aria-label="人工对账重开备注" data-registration-reconciliation-note placeholder="重新打开原因">
      <button type="button" class="inline-action" data-registration-reconciliation-event="${eventId}" data-registration-reconciliation-action="reopen">重新打开</button>
    </div>`;
  }
  return summary;
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
    ["死信", summary.deadLetters || 0, "重试补偿"],
    ["人工工单", summary.manualCases || 0, "累计建单"],
    ["待人工", summary.openManualCases || 0, "责任人处置"],
    ["人工结案", summary.resolvedManualCases || 0, "证据归档"],
    ["逾期工单", summary.overdueManualCases || 0, "SLA 预警"]
  ];
  metricsTarget.innerHTML = metrics.map(([name, value, detail]) => `<article class="metric-card"><span>${name}</span><strong>${value}</strong><small>${detail}</small></article>`).join("");
  sourcesTarget.innerHTML = sources.map((source) => `<section class="item" data-registration-integration-source="${institutionEscapeHtml(source.id)}">
    <div>
      <h3>${institutionEscapeHtml(source.hospital || source.hospitalCode || source.id)}</h3>
      <p>${institutionEscapeHtml((source.sourceSystems || []).join(" / ") || "预约源")}</p>
      <small>回调 ${Number(source.callbacks || 0)} · 匹配 ${Number(source.matchedCallbacks || 0)} · 生产：否</small>
    </div>
    <span class="badge ${source.matchedCallbacks ? "info" : "warn"}">${institutionEscapeHtml(institutionRegistrationIntegrationLabel(source.jointTestStatus || "pending-site-callback"))}</span>
  </section>`).join("") || `<p class="muted">尚未登记预约号源。</p>`;
  eventsTarget.innerHTML = events.map((event) => {
    const retryCount = Number(event.retryCount || 0);
    const retryable = Boolean(event.deadLetter) && retryCount < 3;
    return `<section class="item" data-registration-integration-event="${institutionEscapeHtml(event.id)}">
      <div>
        <h3>${institutionEscapeHtml(institutionRegistrationIntegrationLabel(event.eventType || "callback"))} · ${institutionEscapeHtml(event.orderNo || event.orderId || "未匹配订单")}</h3>
        <p>${institutionEscapeHtml(event.hospitalCode || event.sourceInstitution || "external-provider")} · ${institutionEscapeHtml(event.receivedAt || event.updatedAt || "pending")}</p>
        <small>签名 ${event.signatureVerified ? "通过" : "待核验"} · 对账 ${institutionEscapeHtml(institutionRegistrationIntegrationLabel(event.reconciliationStatus || "pending"))} · 幂等键 ${institutionEscapeHtml(event.idempotencyKey || "缺失")}</small>
        <small>重试 ${retryCount}/3${event.lastRetryNote ? ` · 最近处理：${institutionEscapeHtml(event.lastRetryNote)}` : ""}</small>
        ${event.deadLetterReason ? `<small class="danger-text">${institutionEscapeHtml(institutionRegistrationIntegrationReason(event.deadLetterReason))}</small>` : ""}
        ${retryable ? `<div class="action-row"><input class="inline-action-input" type="text" maxlength="200" aria-label="回调重试处理备注" data-registration-integration-note placeholder="填写处理备注"><button type="button" class="inline-action" data-registration-integration-retry="${institutionEscapeHtml(event.id)}">重试回调</button></div>` : ""}
        ${event.deadLetter && !retryable && !event.manualReconciliation ? `<small class="danger-text">已达到重试上限，请转人工对账。</small>` : ""}
        ${renderRegistrationReconciliationControls(event)}
      </div>
      <span class="badge ${event.deadLetter ? "danger" : event.reconciliationStatus === "matched" ? "info" : "warn"}">${institutionEscapeHtml(institutionRegistrationIntegrationLabel(event.landingStatus || event.status || "pending"))}</span>
    </section>`;
  }).join("") || `<p class="muted">尚未收到预约回调，等待现场联调。</p>`;
  boundaryTarget.textContent = center.boundary || "本地签名回调仅证明契约、幂等、落库和对账能力；生产仍需真实端点、凭据、字典和现场签字。";
}

async function runInstitutionRegistrationIntegrationRetry(eventId, note) {
  const boundaryTarget = document.querySelector("#registration-integration-boundary");
  const normalizedNote = String(note || "").trim();
  if (normalizedNote.length < 2) {
    if (boundaryTarget) boundaryTarget.textContent = "请填写至少 2 个字符的回调重试处理备注。";
    return { ok: false, message: "处理备注不完整" };
  }
  if (!institutionApiBase) {
    if (boundaryTarget) boundaryTarget.textContent = "静态预览不提交回调重试动作。";
    return { ok: false, message: "静态预览不可重试" };
  }
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${institutionApiBase}/registrations/integration-events/${encodeURIComponent(eventId)}/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: normalizedNote })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
    institutionRegistrationDashboard = payload.dashboard || await loadRegistrationJourneyDashboard();
    renderRegistrationJourneyWorkbench(platformState);
    const refreshedBoundary = document.querySelector("#registration-integration-boundary");
    if (refreshedBoundary) {
      refreshedBoundary.textContent = payload.event?.deadLetter
        ? `第 ${Number(payload.event.retryCount || 0)} 次重试仍未通过，已保留死信并等待人工对账。`
        : `回调重试成功，事件已匹配入库；生产就绪仍为否。`;
    }
    return { ok: !payload.event?.deadLetter, event: payload.event };
  } catch (error) {
    if (boundaryTarget) boundaryTarget.textContent = error.message || "预约回调重试失败。";
    return { ok: false, message: error.message };
  }
}

async function runInstitutionRegistrationReconciliationAction(eventId, action, fields = {}) {
  const boundaryTarget = document.querySelector("#registration-integration-boundary");
  if (!institutionApiBase) {
    if (boundaryTarget) boundaryTarget.textContent = "静态预览不提交人工对账动作。";
    return { ok: false, message: "静态预览不可操作" };
  }
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${institutionApiBase}/registrations/integration-events/${encodeURIComponent(eventId)}/reconciliation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...fields })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
    institutionRegistrationDashboard = payload.dashboard || await loadRegistrationJourneyDashboard();
    renderRegistrationJourneyWorkbench(platformState);
    const refreshedBoundary = document.querySelector("#registration-integration-boundary");
    if (refreshedBoundary) {
      const messages = {
        assign: "人工对账工单已分派，SLA 与责任人已记录；生产就绪仍为否。",
        resolve: "人工对账工单已凭证结案，原预约订单未被改写；生产就绪仍为否。",
        reopen: "人工对账工单已重新打开并恢复待处置状态。"
      };
      refreshedBoundary.textContent = messages[action] || "人工对账动作已记录。";
    }
    return { ok: true, event: payload.event };
  } catch (error) {
    if (boundaryTarget) boundaryTarget.textContent = error.message || "预约人工对账操作失败。";
    return { ok: false, message: error.message };
  }
}

async function runInstitutionRegistrationJourneyAction(orderId, action) {
  const boundaryTarget = document.querySelector("#registration-journey-boundary");
  if (!institutionApiBase) return { ok: false, message: "静态预览不提交机构业务动作。" };
  const notes = {
    "confirm-his-demo": "Institution confirmed the local HIS appointment evidence; live HIS callback remains required.",
    "check-in-demo": "机构端已记录本地报到证据，生产运行仍需接入二维码或 HIS 报到接口。",
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

async function runInstitutionRegistrationDisruptionAction(orderId, action, fields = {}) {
  const boundaryTarget = document.querySelector("#registration-journey-boundary");
  if (!institutionApiBase) {
    if (boundaryTarget) boundaryTarget.textContent = "静态预览不提交停诊改签操作。";
    return { ok: false, message: "静态预览不可操作" };
  }
  const payload = {
    action,
    type: fields.type,
    replacementScheduleId: fields.replacementScheduleId,
    acknowledgementDueAt: fields.acknowledgementDueAt,
    reason: fields.reason,
    note: fields.note || fields.reason
  };
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${institutionApiBase}/registrations/orders/${encodeURIComponent(orderId)}/disruption`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
    institutionRegistrationDashboard = result.dashboard || await loadRegistrationJourneyDashboard();
    renderRegistrationJourneyWorkbench(platformState);
    const refreshedBoundary = document.querySelector("#registration-journey-boundary");
    if (refreshedBoundary) {
      refreshedBoundary.textContent = action === "notify"
        ? "停诊改签通知已发送，原号源暂时保留，等待居民确认后再转移库存；生产就绪仍为否。"
        : "停诊改签通知已撤回，原预约继续有效；生产就绪仍为否。";
    }
    return { ok: true, order: result.order };
  } catch (error) {
    if (boundaryTarget) boundaryTarget.textContent = error.message || "停诊改签操作失败。";
    return { ok: false, message: error.message };
  }
}

async function runInstitutionRegistrationWaitlistAction(entryId, action, fields = {}) {
  const boundaryTarget = document.querySelector("#registration-waitlist-boundary");
  if (!institutionApiBase) {
    if (boundaryTarget) boundaryTarget.textContent = "静态预览不提交候补补位操作。";
    return { ok: false, message: "静态预览不可操作" };
  }
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${institutionApiBase}/registrations/waitlist/${encodeURIComponent(entryId)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, note: fields.note, offerMinutes: Number(fields.offerMinutes || 30) })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
    institutionRegistrationDashboard = payload.dashboard || await loadRegistrationJourneyDashboard();
    renderRegistrationJourneyWorkbench(platformState);
    const refreshedBoundary = document.querySelector("#registration-waitlist-boundary");
    if (refreshedBoundary) refreshedBoundary.textContent = action === "promote"
      ? "候补号源已按 FIFO 顺序发送并进入限时占号；生产就绪仍为否。"
      : "超时候补已释放，系统已尝试自动递补下一位；生产就绪仍为否。";
    return { ok: true, entry: payload.entry };
  } catch (error) {
    if (boundaryTarget) boundaryTarget.textContent = error.message || "候补队列操作失败。";
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
  countEl.textContent = `${rows.length} 项`;
  listEl.innerHTML = rows.map((item) => {
    const resident = residentOf(state, item.residentId);
    const badge = item.priority === "high" ? "danger" : item.reportStatus === "returned" ? "info" : "warn";
    return `<section class="item teleconsultation-card">
      <div>
        <h3>${resident?.name || "未知居民"} · ${item.department || item.diseaseType || "远程会诊"}</h3>
        <p>${item.sourceInstitution || "-"} -> ${item.targetInstitution || "-"} · ${item.meetingWindow || item.due || "-"}</p>
        <p>${item.clinicalQuestion || item.receivingFeedback || item.reportSummary || "待补充临床说明"}</p>
        <p>授权：${item.authorizationStatus || "待确认"} · 报告：${item.reportStatus || "待回传"}</p>
        <div class="action-row">
          ${item.status === "requested" ? actionButton("referralTeleconsultations", item.id, "接收会诊", { status: "accepted", receivingFeedback: "接收机构已确认远程会诊。" }, "接收转诊会诊") : ""}
          ${item.reportStatus !== "returned" ? actionButton("referralTeleconsultations", item.id, "回传报告", { status: "report-returned", reportStatus: "returned", reportSummary: "会诊报告已回传至发起机构。" }, "回传会诊报告") : ""}
          ${item.status !== "closed" ? actionButton("referralTeleconsultations", item.id, "关闭闭环", { status: "closed" }, "关闭转诊会诊闭环") : ""}
        </div>
      </div>
      <span class="badge ${badge}">${teleconsultationStatusLabel(item.status)}</span>
    </section>`;
  }).join("") || `<p class="muted">暂无转诊会诊任务。</p>`;
}

async function acknowledgeTeleconsultationSla(state, id) {
  const action = "Institution acknowledged SLA reminder and started report callback reconciliation.";
  if (institutionApiBase) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${institutionApiBase}/referral-teleconsultations/${encodeURIComponent(id)}/escalations/ack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "acknowledged", action })
      });
      if (response.ok) {
        const payload = await response.json();
        state.referralTeleconsultations = (state.referralTeleconsultations || []).map((item) => item.id === id ? payload.teleconsultation : item);
        state.taskMessages = [
          ...(payload.messages || []),
          ...(state.taskMessages || []).filter((message) => !(message.collection === "referralTeleconsultations" && message.sourceId === id))
        ].slice(0, 300);
        return { ok: true };
      }
    } catch (error) {
      // Static preview falls back to local acknowledgement below.
    }
  }
  const now = new Date().toISOString();
  state.referralTeleconsultations = (state.referralTeleconsultations || []).map((item) => item.id === id
    ? {
        ...item,
        slaDisposition: { status: "acknowledged", action, owner: "institution-preview", updatedAt: now },
        countySupervision: { ...(item.countySupervision || {}), status: "已确认", action, updatedAt: now }
      }
    : item);
  state.taskMessages = (state.taskMessages || []).map((message) => message.collection === "referralTeleconsultations" && message.sourceId === id && message.escalationKey
    ? { ...message, status: "acknowledged", receipts: [{ at: now, by: "institution-preview", action }, ...(message.receipts || [])] }
    : message);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  return { ok: true };
}

function teleconsultationAckButton(id) {
  return `<button class="inline-action" type="button" data-teleconsultation-ack data-id="${id}">确认 SLA</button>`;
}

function teleconsultationStatusLabel(status) {
  return {
    requested: "已申请",
    accepted: "已接诊",
    scheduled: "已排期",
    "feedback-returned": "已反馈",
    "report-returned": "报告已回传",
    closed: "已闭环"
  }[status] || status || "待处理";
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
