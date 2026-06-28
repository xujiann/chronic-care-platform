const NURSING_API_BASE = location.protocol === "file:" ? "" : "/api";
let nursingDashboard = null;

document.addEventListener("DOMContentLoaded", async () => {
  bindNursingAppointmentForm();
  document.querySelector("#nursing-nurse-select")?.addEventListener("change", () => {
    renderNurseQueue(nursingDashboard?.orders || []);
    renderMobileNurseCards(nursingDashboard?.orders || []);
  });
  document.querySelector("#nursing-institution-select")?.addEventListener("change", () => renderServiceItemSelect(nursingDashboard?.institutions || []));
  await loadInternetNursingDashboard();
});

async function loadInternetNursingDashboard() {
  nursingDashboard = await fetchInternetNursingDashboard();
  renderInternetNursingDashboard(nursingDashboard);
}

async function fetchInternetNursingDashboard() {
  if (NURSING_API_BASE) {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${NURSING_API_BASE}/internet-nursing/dashboard`);
    if (response.ok) return response.json();
  }
  const response = await fetch("./data/db.json");
  const state = response.ok ? await response.json() : {};
  return buildStaticInternetNursingDashboard(state);
}

function buildStaticInternetNursingDashboard(state) {
  const institutions = state.internetNursingInstitutions?.length ? state.internetNursingInstitutions : defaultNursingInstitutions();
  const nurses = state.internetNursingNurses?.length ? state.internetNursingNurses : defaultNursingNurses();
  const orders = (state.internetNursingOrders?.length ? state.internetNursingOrders : defaultNursingOrders()).map(enrichStaticNursingOrder);
  const institutionById = new Map(institutions.map((item) => [item.id, item]));
  const nurseById = new Map(nurses.map((item) => [item.id, item]));
  const policy = state.internetNursingPolicy || defaultNursingPolicy();
  return {
    ok: true,
    policy,
    summary: {
      institutions: institutions.length,
      publishedInstitutions: institutions.filter((item) => item.published).length,
      nurses: nurses.length,
      qualifiedNurses: nurses.filter(isQualifiedNurse).length,
      orders: orders.length,
      openOrders: orders.filter((item) => !["completed", "closed", "cancelled"].includes(item.status)).length,
      pendingAssessment: orders.filter((item) => item.firstVisitAssessment !== "passed").length,
      consentPending: orders.filter((item) => item.informedConsent !== "signed").length,
      highRisk: orders.filter((item) => item.riskLevel === "high").length,
      trackingActive: orders.filter((item) => item.locationTrace === "tracking").length
    },
    institutions,
    nurses,
    orders: orders.map((item) => ({ ...item, institution: institutionById.get(item.institutionId), nurse: nurseById.get(item.nurseId) })),
    nurseQueue: orders,
    riskQueue: orders.filter((item) => item.riskLevel === "high")
  };
}

function enrichStaticNursingOrder(item) {
  const signedConsent = item.informedConsent === "signed";
  return {
    ...item,
    consentAttachment: item.consentAttachment || (signedConsent
      ? { status: "signed", version: "internet-nursing-consent-v1", signerName: item.residentName || "居民电子签名", signedAt: item.createdAt || new Date().toISOString(), attachmentName: `internet-nursing-informed-consent-${item.id}.pdf` }
      : { status: "pending", required: true, version: "internet-nursing-consent-v1" }),
    locationTracePoints: Array.isArray(item.locationTracePoints) ? item.locationTracePoints : []
  };
}

function renderInternetNursingDashboard(dashboard) {
  renderNursingMetrics(dashboard.summary || {});
  renderRiskGuidance(dashboard.orders || [], dashboard.riskQueue || []);
  renderInstitutionSelect(dashboard.institutions || []);
  renderServiceItemSelect(dashboard.institutions || []);
  renderNurseSelect(dashboard.nurses || []);
  renderMobileAppointmentStatus(dashboard.orders || []);
  renderMobileNurseCards(dashboard.orders || []);
  renderHospitalOrders(dashboard.orders || []);
  renderNurseQueue(dashboard.orders || []);
  renderPolicyControls(dashboard.policy || {});
  const citizenSummary = document.querySelector("#nursing-citizen-summary");
  if (citizenSummary) citizenSummary.textContent = `${dashboard.summary?.publishedInstitutions || 0} 家已发布机构`;
  const nurseSummary = document.querySelector("#nursing-nurse-summary");
  if (nurseSummary) nurseSummary.textContent = `${dashboard.summary?.qualifiedNurses || 0}/${dashboard.summary?.nurses || 0} 名护士合格`;
}

function renderNursingMetrics(summary) {
  const metrics = [
    ["试点机构", summary.institutions || 0, `${summary.publishedInstitutions || 0} 家已发布`],
    ["合格护士", summary.qualifiedNurses || 0, `共 ${summary.nurses || 0} 名`],
    ["服务订单", summary.orders || 0, `${summary.openOrders || 0} 单待处理`],
    ["首诊评估", summary.pendingAssessment || 0, "待评估"],
    ["知情同意", summary.consentPending || 0, "待签署"],
    ["服务轨迹", summary.trackingActive || 0, "进行中轨迹"]
  ];
  document.querySelector("#nursing-metrics").innerHTML = metrics.map(([label, value, hint]) => `
    <article class="metric-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(hint)}</small>
    </article>
  `).join("");
}

function renderRiskGuidance(items, riskQueue) {
  const target = document.querySelector("#nursing-risk-guidance");
  if (!target) return;
  const highRiskIds = new Set((riskQueue || []).map((item) => item.id));
  const guidance = (items || [])
    .map((item) => ({ item, nextAction: nextNursingAction(item, highRiskIds.has(item.id)) }))
    .filter((row) => row.nextAction)
    .sort((a, b) => nursingPriorityWeight(b.item, b.nextAction) - nursingPriorityWeight(a.item, a.nextAction))
    .slice(0, 5);
  const summary = document.querySelector("#nursing-risk-summary");
  if (summary) summary.textContent = guidance.length ? `${guidance.length} 项待处置` : "暂无待处置风险";
  target.innerHTML = guidance.length ? guidance.map(({ item, nextAction }) => `
    <div>
      <strong>${escapeHtml(displayText(item.residentName || item.residentId || ""))} · ${escapeHtml(displayText(item.serviceItem || ""))}</strong>
      <span>${escapeHtml(nextAction)}</span>
    </div>
  `).join("") : `
    <div>
      <strong>暂无高风险待办</strong>
      <span>当前订单评估、知情同意、服务轨迹和质量回访未发现需要优先处置的异常。</span>
    </div>
  `;
}

function nextNursingAction(item, isHighRisk) {
  if (item.firstVisitAssessment !== "passed") return `${isHighRisk ? "高风险订单，" : ""}先完成首诊评估，确认是否适合上门护理。`;
  if (item.informedConsent !== "signed") return "补齐知情同意后再安排护士上门。";
  if (!item.nurseId) return "选择合格护士并完成医院派单。";
  if (item.status === "dispatched") return "护士待接单，接单后应开启服务位置轨迹。";
  if (item.status === "accepted" && item.locationTrace !== "tracking") return "已接单但未开启轨迹，请核验定位设备。";
  if (item.serviceRecordStatus !== "completed" && ["in-service", "accepted"].includes(item.status)) return "服务进行中，需及时补全护理记录。";
  if (item.status === "completed" && item.qualityCallback !== "closed") return "护理记录已完成，等待机构质量回访。";
  if (isHighRisk) return "高风险订单已进入处置链路，持续关注回访和服务记录。";
  return "";
}

function nursingPriorityWeight(item, nextAction) {
  const risk = item.riskLevel === "high" ? 100 : item.riskLevel === "medium" ? 50 : 10;
  const stage = item.firstVisitAssessment !== "passed" ? 40 : item.informedConsent !== "signed" ? 35 : !item.nurseId ? 30 : nextAction.includes("轨迹") ? 25 : 15;
  return risk + stage;
}

function consentAttachmentText(item) {
  const attachment = item?.consentAttachment || {};
  if (attachment.status !== "signed") return "知情同意附件待签署";
  const signer = displayText(attachment.signerName || "居民电子签名");
  const version = attachment.version || "internet-nursing-consent-v1";
  const signedAt = attachment.signedAt ? String(attachment.signedAt).slice(0, 16).replace("T", " ") : "待核验";
  return `电子签名 ${signer} / ${version} / ${signedAt}`;
}

function locationTraceSummary(item) {
  const points = Array.isArray(item?.locationTracePoints) ? item.locationTracePoints : [];
  if (!points.length) return "轨迹点待采集";
  const latest = points[points.length - 1] || {};
  const stage = displayText(latest.stage || "location-check");
  return `轨迹点 ${points.length} 个 / 最近 ${stage}`;
}

function renderInstitutionSelect(institutions) {
  const select = document.querySelector("#nursing-institution-select");
  if (!select) return;
  select.innerHTML = institutions
    .filter((item) => item.published !== false)
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(displayText(item.name))} / ${escapeHtml(displayText(item.district || ""))}</option>`)
    .join("");
}

function renderServiceItemSelect(institutions) {
  const select = document.querySelector("#nursing-service-select");
  const institutionId = document.querySelector("#nursing-institution-select")?.value || "";
  if (!select) return;
  const current = select.value;
  const institution = institutions.find((item) => item.id === institutionId) || institutions.find((item) => item.published !== false) || {};
  const items = Array.isArray(institution.serviceItems) && institution.serviceItems.length ? institution.serviceItems : [
    "vital signs measurement",
    "blood glucose measurement",
    "wound care",
    "tube care",
    "postpartum care",
    "infant care",
    "PICC maintenance"
  ];
  select.innerHTML = items.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(displayText(item))}</option>`).join("");
  if (items.includes(current)) select.value = current;
}

function renderNurseSelect(nurses) {
  const select = document.querySelector("#nursing-nurse-select");
  if (!select) return;
  const sessionNurseId = currentNursingUser().nurseId;
  select.innerHTML = nurses.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(displayText(item.name))} / ${escapeHtml(displayText(item.title || ""))}</option>`).join("");
  if (sessionNurseId && nurses.some((item) => item.id === sessionNurseId)) select.value = sessionNurseId;
  select.disabled = Boolean(sessionNurseId);
}

function renderHospitalOrders(items) {
  const target = document.querySelector("#nursing-orders");
  const user = currentNursingUser();
  const canManage = ["commission", "institution"].includes(user.role) && user.accountType !== "nurse";
  target.innerHTML = `
    <table>
      <thead><tr><th>订单</th><th>居民</th><th>服务</th><th>机构</th><th>护士</th><th>证据</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${items.map((item) => `
        <tr>
          <td><strong>${escapeHtml(item.id)}</strong><br><small>${escapeHtml(item.preferredAt || "")}</small></td>
          <td>${escapeHtml(displayText(item.residentName || item.residentId || ""))}<br><small>${escapeHtml(displayText(item.serviceObject || ""))}</small></td>
          <td>${escapeHtml(displayText(item.serviceItem || ""))}<br><small>${escapeHtml(displayText(item.address || ""))}</small></td>
          <td>${escapeHtml(displayText(item.institution?.name || item.institutionName || ""))}<br><small>${escapeHtml(item.institutionCode || "")}</small></td>
          <td>${escapeHtml(displayText(item.nurse?.name || item.nurseName || "pending"))}<br><small>${escapeHtml(displayText(item.nurse?.registrationStatus || ""))}</small></td>
          <td>${statusBadge(item.firstVisitAssessment)} ${statusBadge(item.informedConsent)} ${statusBadge(item.locationTrace)}<br><small>${escapeHtml(consentAttachmentText(item))}</small><br><small>${escapeHtml(locationTraceSummary(item))}</small></td>
          <td>${statusBadge(item.status)} ${statusBadge(item.riskLevel)}<br><small>${escapeHtml(displayText(item.qualityCallback || ""))}</small></td>
          <td>
            ${canManage ? `
            <button class="inline-action" type="button" data-nursing-action="${escapeHtml(item.id)}" data-action-kind="assessment">评估</button>
            <button class="inline-action" type="button" data-nursing-action="${escapeHtml(item.id)}" data-action-kind="dispatch">派单</button>
            <button class="inline-action" type="button" data-nursing-action="${escapeHtml(item.id)}" data-action-kind="review">回访</button>
            ` : `<span class="badge info">仅查看</span>`}
          </td>
        </tr>
      `).join("")}</tbody>
    </table>
  `;
  target.querySelectorAll("[data-nursing-action]").forEach((button) => {
    button.addEventListener("click", () => updateNursingOrder(button.dataset.nursingAction, hospitalActionPayload(button.dataset.actionKind)));
  });
}

function renderNurseQueue(items) {
  const nurseId = document.querySelector("#nursing-nurse-select")?.value || "";
  const user = currentNursingUser();
  const canAct = user.accountType === "nurse" || ["commission", "institution"].includes(user.role);
  const queue = items.filter((item) => !nurseId || !item.nurseId || item.nurseId === nurseId);
  document.querySelector("#nursing-nurse-queue").innerHTML = `
    <table>
      <thead><tr><th>订单</th><th>上门时间</th><th>居民</th><th>证据</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${queue.map((item) => `
        <tr>
          <td><strong>${escapeHtml(item.id)}</strong><br><small>${escapeHtml(displayText(item.serviceItem || ""))}</small></td>
          <td>${escapeHtml(item.preferredAt || "")}<br><small>${escapeHtml(displayText(item.address || ""))}</small></td>
          <td>${escapeHtml(displayText(item.residentName || item.residentId || ""))}<br><small>${escapeHtml(displayText(item.serviceObject || ""))}</small></td>
          <td>${statusBadge(item.locationTrace)} ${statusBadge(item.serviceRecordStatus)} ${statusBadge(item.qualityCallback)}<br><small>${escapeHtml(locationTraceSummary(item))}</small></td>
          <td>${statusBadge(item.status)} ${statusBadge(item.riskLevel)}</td>
          <td>
            ${nurseActionButtons(item, canAct)}
          </td>
        </tr>
      `).join("")}</tbody>
    </table>
  `;
  bindNurseActionButtons(document.querySelector("#nursing-nurse-queue"));
}

function renderMobileAppointmentStatus(items) {
  const target = document.querySelector("#nursing-mobile-appointment");
  if (!target) return;
  const residentId = currentNursingUser().residentId || document.querySelector("#nursing-appointment-form [name='residentId']")?.value || "";
  const residentItems = items
    .filter((item) => !residentId || item.residentId === residentId)
    .sort((a, b) => String(b.preferredAt || "").localeCompare(String(a.preferredAt || "")))
    .slice(0, 3);
  target.innerHTML = residentItems.length ? residentItems.map((item) => `
    <article class="nursing-mobile-card">
      <header>
        <div>
          <strong>${escapeHtml(displayText(item.serviceItem || ""))}</strong>
          <span>${escapeHtml(item.preferredAt || "")} · ${escapeHtml(displayText(item.institution?.name || item.institutionName || ""))}</span>
        </div>
        ${statusBadge(item.status)}
      </header>
      <p>${escapeHtml(displayText(item.address || ""))}</p>
      <div class="nursing-mobile-evidence">
        ${statusBadge(item.firstVisitAssessment)}
        ${statusBadge(item.informedConsent)}
        ${statusBadge(item.riskLevel)}
      </div>
      <small>${escapeHtml(consentAttachmentText(item))}</small>
      <small>${escapeHtml(nextNursingAction(item, item.riskLevel === "high") || "等待服务闭环更新。")}</small>
    </article>
  `).join("") : `
    <article class="nursing-mobile-card empty">
      <header>
        <div>
          <strong>暂无预约记录</strong>
          <span>手机端提交后将同步到医院端评估派单。</span>
        </div>
      </header>
    </article>
  `;
}

function renderMobileNurseCards(items) {
  const target = document.querySelector("#nursing-nurse-mobile");
  if (!target) return;
  const nurseId = document.querySelector("#nursing-nurse-select")?.value || "";
  const user = currentNursingUser();
  const canAct = user.accountType === "nurse" || ["commission", "institution"].includes(user.role);
  const queue = items
    .filter((item) => !nurseId || !item.nurseId || item.nurseId === nurseId)
    .sort((a, b) => nursingMobileSortWeight(b) - nursingMobileSortWeight(a))
    .slice(0, 6);
  target.innerHTML = queue.length ? queue.map((item) => `
    <article class="nursing-mobile-card" data-mobile-order="${escapeHtml(item.id)}">
      <header>
        <div>
          <strong>${escapeHtml(displayText(item.residentName || item.residentId || ""))}</strong>
          <span>${escapeHtml(displayText(item.serviceItem || ""))} · ${escapeHtml(item.preferredAt || "")}</span>
        </div>
        ${statusBadge(item.status)}
      </header>
      <p>${escapeHtml(displayText(item.address || ""))}</p>
      <div class="nursing-mobile-evidence">
        ${statusBadge(item.locationTrace)}
        ${statusBadge(item.serviceRecordStatus)}
        ${statusBadge(item.riskLevel)}
      </div>
      <small>${escapeHtml(locationTraceSummary(item))}</small>
      <div class="nursing-mobile-actions">
        ${nurseActionButtons(item, canAct)}
      </div>
    </article>
  `).join("") : `
    <article class="nursing-mobile-card empty">
      <header>
        <div>
          <strong>暂无接单任务</strong>
          <span>医院派单后将在手机端出现。</span>
        </div>
      </header>
    </article>
  `;
  bindNurseActionButtons(target);
}

function bindNurseActionButtons(root = document) {
  root?.querySelectorAll("[data-nurse-action]").forEach((button) => {
    button.addEventListener("click", () => updateNursingOrder(button.dataset.nurseAction, nurseActionPayload(button.dataset.actionKind)));
  });
}

function nursingMobileSortWeight(item) {
  const actionable = !item.nurseId || ["dispatched", "accepted", "in-service"].includes(item.status) ? 100 : 0;
  const risk = item.riskLevel === "high" ? 30 : item.riskLevel === "medium" ? 15 : 0;
  const stage = item.status === "dispatched" ? 30 : item.status === "accepted" ? 20 : item.status === "in-service" ? 10 : 0;
  return actionable + risk + stage;
}

function nurseActionButtons(item, canAct) {
  if (!canAct) return `<span class="badge info">需医院派单</span>`;
  const actions = [];
  if (!item.nurseId || ["requested", "dispatched"].includes(item.status)) actions.push(["accept", "接单"]);
  if (item.status === "accepted") actions.push(["start", "开始服务"]);
  if (item.status === "in-service") actions.push(["complete", "完成记录"]);
  return actions.length
    ? actions.map(([kind, label]) => `<button class="inline-action" type="button" data-nurse-action="${escapeHtml(item.id)}" data-action-kind="${kind}">${label}</button>`).join("")
    : `<span class="badge info">暂无可操作</span>`;
}

function renderPolicyControls(policy) {
  const rows = [
    ["服务对象", (policy.serviceObjects || []).map(displayText).join("、")],
    ["服务目录", (policy.serviceCatalog || []).map(displayText).join("、")],
    ["证据要求", (policy.requiredEvidence || []).map(displayText).join("、")],
    ["风险控制", (policy.riskControls || []).map(displayText).join("、")],
    ["平台要求", (policy.platformRequirements || []).map(displayText).join("、")]
  ];
  document.querySelector("#nursing-policy").innerHTML = rows.map(([label, value]) => `
    <div>
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(value)}</span>
    </div>
  `).join("");
  const summary = document.querySelector("#nursing-policy-summary");
  if (summary) summary.textContent = displayText(policy.source || "pilot policy");
}

function currentNursingUser() {
  return window.HealthCityAuth?.getUser?.() || {};
}

function bindNursingAppointmentForm() {
  const form = document.querySelector("#nursing-appointment-form");
  if (!form) return;
  const dateInput = form.querySelector("input[name='preferredAt']");
  if (dateInput && !dateInput.value) dateInput.value = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    values.sourceChannel = "internet-nursing-mobile";
    try {
      if (NURSING_API_BASE) {
        const request = window.HealthCityAuth?.authFetch || fetch;
        const response = await request(`${NURSING_API_BASE}/internet-nursing/orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values)
        });
        if (!response.ok) throw new Error(`互联网护理预约提交失败：${response.status}`);
      } else {
        nursingDashboard.orders.unshift({ ...values, id: `ino-local-${crypto.randomUUID()}`, status: "requested", firstVisitAssessment: "pending", informedConsent: "pending", consentAttachment: { status: "pending", required: true, version: "internet-nursing-consent-v1" }, locationTrace: "pending", locationTracePoints: [], serviceRecordStatus: "pending", qualityCallback: "pending" });
      }
      form.reset();
      if (dateInput) dateInput.value = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      showNursingMessage("预约已提交，医院端将进行首诊评估。");
      await loadInternetNursingDashboard();
    } catch (error) {
      showNursingMessage(error.message || "预约提交失败，请稍后重试。", "danger");
    }
  });
}

function hospitalActionPayload(kind) {
  const nurseId = document.querySelector("#nursing-nurse-select")?.value || "";
  if (kind === "assessment") {
    return {
      firstVisitAssessment: "passed",
      informedConsent: "signed",
      consentAttachment: { status: "signed", type: "electronic-informed-consent", version: "internet-nursing-consent-v1", signerName: "居民电子签名", attachmentName: "internet-nursing-informed-consent.pdf" },
      status: "assessed",
      action: "first-visit-assessment",
      note: "已完成首诊评估和知情同意。"
    };
  }
  if (kind === "dispatch") return { nurseId, status: "dispatched", action: "dispatch-qualified-nurse", note: "医院已派出合格护士。" };
  return { qualityCallback: "closed", status: "closed", action: "quality-review", note: "质量回访已关闭。" };
}

function nurseActionPayload(kind) {
  const nurseId = document.querySelector("#nursing-nurse-select")?.value || "";
  if (kind === "accept") return { nurseId, status: "accepted", locationTrace: "tracking", tracePoint: { stage: "nurse-accept", lat: 38.914, lng: 121.614, source: "nurse-mobile" }, action: "nurse-accept", note: "护士已接单，位置轨迹已开启。" };
  if (kind === "start") return { nurseId, status: "in-service", locationTrace: "tracking", serviceRecordStatus: "in-progress", tracePoint: { stage: "service-start", lat: 38.915, lng: 121.616, source: "nurse-mobile" }, action: "service-start", note: "上门护理服务已开始。" };
  return { nurseId, status: "completed", serviceRecordStatus: "completed", qualityCallback: "pending", tracePoint: { stage: "service-complete", lat: 38.916, lng: 121.617, source: "nurse-mobile" }, action: "service-complete", note: "护理记录已完成，等待质量回访。" };
}

async function updateNursingOrder(id, payload) {
  try {
    if (NURSING_API_BASE) {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${NURSING_API_BASE}/internet-nursing/orders/${encodeURIComponent(id)}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.message || `订单更新失败：${response.status}`);
      }
    } else {
      const item = nursingDashboard.orders.find((row) => row.id === id);
      if (item) Object.assign(item, applyStaticNursingOrderAction(item, payload));
    }
    showNursingMessage("订单状态已更新。");
    await loadInternetNursingDashboard();
  } catch (error) {
    showNursingMessage(error.message || "订单更新失败，请稍后重试。", "danger");
  }
}

function applyStaticNursingOrderAction(item, payload) {
  const updates = { ...payload };
  if (payload.informedConsent === "signed" || payload.action === "first-visit-assessment") {
    updates.consentAttachment = {
      ...(item.consentAttachment || {}),
      ...(payload.consentAttachment || {}),
      status: "signed",
      signedAt: payload.consentAttachment?.signedAt || new Date().toISOString()
    };
  }
  if (payload.tracePoint) {
    updates.locationTracePoints = [...(Array.isArray(item.locationTracePoints) ? item.locationTracePoints : []), payload.tracePoint].slice(-30);
  }
  delete updates.tracePoint;
  return updates;
}

function showNursingMessage(message, type = "info") {
  const target = document.querySelector("#nursing-operation-message");
  if (!target) return;
  target.hidden = false;
  target.textContent = message;
  target.dataset.status = type;
}

function defaultNursingPolicy() {
  return {
    source: "辽宁省互联网+护理服务试点实施方案",
    serviceObjects: ["elderly or disabled people", "rehabilitation patients", "terminal-stage patients", "maternal and infant people"],
    serviceCatalog: ["daily living ability assessment", "vital signs measurement", "blood glucose measurement", "wound care", "tube care", "postpartum care", "infant care", "PICC maintenance"],
    requiredEvidence: ["identity authentication", "first diagnosis assessment", "signed informed consent", "nurse practice certificate", "service location trace", "nursing record", "quality callback"],
    riskControls: ["emergency plan", "one-click alert", "liability insurance", "medical accident insurance", "service recorder"],
    platformRequirements: ["grade-3 security protection", "privacy protection", "medical record storage", "traceable service behavior", "workload statistics"]
  };
}

function defaultNursingInstitutions() {
  return [
    { id: "inh-mr1", institutionCode: "MR1", name: "大连市中心医院", district: "中山区", published: true, serviceItems: ["wound care", "PICC maintenance", "blood glucose measurement"], dailyCapacity: 18 },
    { id: "inh-mr3", institutionCode: "MR3", name: "青泥洼桥社区卫生服务中心", district: "中山区", published: true, serviceItems: ["vital signs measurement", "tube care"], dailyCapacity: 10 }
  ];
}

function defaultNursingNurses() {
  return [
    { id: "inn-001", name: "孙护士", institutionId: "inh-mr1", institutionCode: "MR1", title: "主管护师", yearsClinical: 9, registrationStatus: "verified", badPracticeRecord: "none", trainingStatus: "passed", insuranceStatus: "covered", status: "available" },
    { id: "inn-002", name: "赵护士", institutionId: "inh-mr3", institutionCode: "MR3", title: "专科护士", yearsClinical: 6, registrationStatus: "verified", badPracticeRecord: "none", trainingStatus: "passed", insuranceStatus: "covered", status: "available" }
  ];
}

function defaultNursingOrders() {
  return [
    { id: "ino-001", residentId: "r1", residentName: "演示居民A", institutionId: "inh-mr1", institutionCode: "MR1", institutionName: "大连市中心医院", nurseId: "inn-001", nurseName: "孙护士", serviceItem: "wound care", serviceObject: "mobility-limited chronic disease patient", preferredAt: new Date(Date.now() + 86400000).toISOString().slice(0, 10), address: "中山区示例地址", firstVisitAssessment: "passed", informedConsent: "signed", riskLevel: "medium", status: "dispatched", locationTrace: "pending", serviceRecordStatus: "pending", qualityCallback: "pending" },
    { id: "ino-002", residentId: "r2", residentName: "演示居民B", institutionId: "inh-mr3", institutionCode: "MR3", institutionName: "青泥洼桥社区卫生服务中心", nurseId: "inn-002", nurseName: "赵护士", serviceItem: "blood glucose measurement", serviceObject: "elderly or disabled people", preferredAt: new Date().toISOString().slice(0, 10), address: "青泥洼桥示例家庭地址", firstVisitAssessment: "passed", informedConsent: "signed", riskLevel: "low", status: "accepted", locationTrace: "tracking", serviceRecordStatus: "in-progress", qualityCallback: "pending" }
  ];
}

function isQualifiedNurse(item) {
  return Number(item.yearsClinical || 0) >= 5 && item.registrationStatus === "verified" && item.badPracticeRecord === "none" && item.trainingStatus === "passed" && item.insuranceStatus === "covered";
}

function statusBadge(status) {
  const text = String(status ?? "unknown");
  const danger = ["high", "blocked", "overdue"].includes(text);
  const warn = ["medium", "pending", "requested", "assessed", "dispatched", "accepted", "in-service", "tracking"].includes(text);
  const type = danger ? "danger" : warn ? "warn" : "info";
  return `<span class="badge ${type}">${escapeHtml(displayText(text))}</span>`;
}

function displayText(value) {
  const text = String(value ?? "");
  const labels = {
    "Liaoning Internet+ Nursing pilot implementation plan": "辽宁省互联网+护理服务试点实施方案",
    "pilot policy": "试点政策",
    "Dalian Central Hospital": "大连市中心医院",
    "Qingniwaqiao Community Health Service Center": "青泥洼桥社区卫生服务中心",
    "Ganjingzi District People's Hospital": "甘井子区人民医院",
    "Zhongshan": "中山区",
    "Ganjingzi": "甘井子区",
    "Nurse Sun": "孙护士",
    "Nurse Zhao": "赵护士",
    "Nurse Liu": "刘护士",
    "Demo resident A": "演示居民A",
    "Demo resident B": "演示居民B",
    "Demo resident C": "演示居民C",
    "Zhongshan district demo address": "中山区示例地址",
    "Qingniwaqiao demo home": "青泥洼桥示例家庭地址",
    "Shahekou demo address": "沙河口区示例地址",
    "daily living ability assessment": "日常生活能力评估",
    "vital signs measurement": "生命体征测量",
    "blood glucose measurement": "血糖测量",
    "wound care": "伤口护理",
    "tube care": "管路护理",
    "postpartum care": "产后护理",
    "infant care": "婴幼儿护理",
    "PICC maintenance": "PICC 维护",
    "elderly or disabled people": "老年人或失能人群",
    "rehabilitation patient": "康复期患者",
    "rehabilitation patients": "康复期患者",
    "terminal-stage patients": "终末期患者",
    "maternal and infant people": "母婴人群",
    "mobility-limited chronic disease patient": "行动不便慢病患者",
    "mobility-limited chronic disease patients": "行动不便慢病患者",
    "identity authentication": "身份认证",
    "first diagnosis assessment": "首诊评估",
    "signed informed consent": "已签署知情同意",
    "nurse practice certificate": "护士执业证书",
    "service location trace": "服务位置轨迹",
    "nursing record": "护理记录",
    "quality callback": "质量回访",
    "grade-3 security protection": "等保三级防护",
    "privacy protection": "隐私保护",
    "medical record storage": "病历资料留存",
    "traceable service behavior": "服务行为可追溯",
    "workload statistics": "工作量统计",
    "emergency plan": "应急预案",
    "one-click alert": "一键报警",
    "liability insurance": "责任保险",
    "medical accident insurance": "医疗事故保险",
    "service recorder": "服务记录仪",
    "senior nurse": "主管护师",
    "nurse practitioner": "专科护士",
    "specialist nurse": "专科护士",
    "verified": "已核验",
    "none": "无",
    "passed": "已通过",
    "signed": "已签署",
    "pending": "待处理",
    "requested": "已申请",
    "assessed": "已评估",
    "dispatched": "已派单",
    "accepted": "已接单",
    "in-service": "服务中",
    "completed": "已完成",
    "closed": "已关闭",
    "tracking": "轨迹开启",
    "in-progress": "进行中",
    "high": "高风险",
    "medium": "中风险",
    "low": "低风险",
    "unknown": "未知"
  };
  return labels[text] || text;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}
