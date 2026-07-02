const fallbackState = { countyConsortium: null, countyProjectBlueprint: null, countyCollaborationOrders: [], countyAiDiagnosisCases: [], countyMutualRecognitionRecords: [], referralTeleconsultations: [], referralTeleconsultationSignoffs: [], referralTeleconsultationJointTestPack: null, residents: [], medicalResources: [], personalRecords: [], taskMessages: [], integrationContracts: [], integrationGatewayEvents: [] };
let platformState = null;

document.addEventListener("DOMContentLoaded", async () => {
  const state = await loadPlatformState(fallbackState);
  await loadCountyTeleconsultationJointTestPack(state);
  platformState = state;
  const county = state.countyConsortium || buildCountyConsortiumDefaults(state);
  renderCountyMetrics(county, state);
  renderCountyAudit(state, county);
  renderCountyNetwork(county);
  renderCountyProjectBlueprint(state);
  renderCountyBusinessOperations(state);
  renderCountyTeleconsultationLoop(state);
  renderCapabilityFilter(county);
  renderCountyCapabilities(county, "all");
  renderCountyTasks(county);
  renderCountyWorkflows(county);
  renderCountyReferral(state);
  renderCountyIndicators(county);
  renderCountyGovernance(county);
  bindCountyActions();
});

async function loadCountyTeleconsultationJointTestPack(state) {
  if (!API_BASE) return null;
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${API_BASE}/referral-teleconsultations/joint-test-pack`);
    if (!response.ok) return null;
    const pack = await response.json();
    state.referralTeleconsultationJointTestPack = pack;
    return pack;
  } catch (error) {
    return null;
  }
}

function renderCountyMetrics(county, state) {
  const capabilities = county.capabilities || [];
  const live = capabilities.filter((item) => item.status === "运行中").length;
  const warning = capabilities.filter((item) => item.risk === "需推进").length;
  document.querySelector("#county-metrics").innerHTML = [
    ["医共体成员", county.organizations.length, "县、乡、村、公卫机构"],
    ["功能清单", capabilities.length, "指引 36 项"],
    ["运行中模块", live, "已形成协同能力"],
    ["待推进模块", warning, "建设缺口跟踪"],
    ["个人健康档案", state.residents.length, "与健康城市系统贯通"],
    ["共享数据集", 8, "档案、病历、医技、医保、公卫"]
  ].map(([label, value, hint]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong><small>${hint}</small></article>`).join("");
}

function renderCountyAudit(state, county) {
  const auditEl = document.querySelector("#county-audit-grid");
  if (!auditEl) return;
  const ordersOpen = (state.countyCollaborationOrders || []).filter((item) => !["已回传", "已完成"].includes(item.status)).length;
  const recognitionOpen = (state.countyMutualRecognitionRecords || []).filter((item) => item.status !== "已互认").length;
  const aiOpen = (state.countyAiDiagnosisCases || []).filter((item) => item.status !== "已完成").length;
  const newApps = state.countyProjectBlueprint?.newApps?.length || 0;
  const warningCapabilities = (county.capabilities || []).filter((item) => item.risk === "需推进").length;
  auditEl.innerHTML = [
    ["协同工单", `${ordersOpen} 项`, ordersOpen ? "仍需中心诊断、报告回传或跨机构确认。" : "协同工单已闭环。"],
    ["互认闭环", `${recognitionOpen} 项`, recognitionOpen ? "仍需质控通过、不互认原因或医保调阅回写。" : "互认记录已闭环。"],
    ["基层 AI", `${aiOpen} 项`, aiOpen ? "仍需医生采纳、转诊跟踪或病历质检。" : "AI 辅诊病例已闭环。"],
    ["新建应用", `${newApps} 个`, "消毒供应、合理用药、绩效、人财物等仍需排期建设。"],
    ["待推进模块", `${warningCapabilities} 个`, "功能清单中待启动模块需要形成责任单位和验收指标。"]
  ].map(([label, value, hint]) => `<article class="metric-card">
    <span>${label}</span>
    <strong>${value}</strong>
    <small>${hint}</small>
  </article>`).join("");
}

function renderCountyNetwork(county) {
  document.querySelector("#county-network").innerHTML = county.organizations.map((org) => `<article>
    <span>${org.level}</span>
    <strong>${org.name}</strong>
    <p>${org.role}</p>
    <small>${org.systems.join("、")}</small>
  </article>`).join("");
}

function renderCountyProjectBlueprint(state) {
  const blueprint = state.countyProjectBlueprint || {};
  const coverage = blueprint.coverage || [];
  const centers = blueprint.centers || [];
  const ai = blueprint.grassrootsAi || {};
  const dataResources = blueprint.dataResources || {};
  const totalHospitals = coverage.reduce((sum, item) => sum + Number(item.hospitals || 0), 0);
  const totalPrimary = coverage.reduce((sum, item) => sum + Number(item.primaryCenters || 0), 0);

  const sourceEl = document.querySelector("#county-blueprint-source");
  if (sourceEl) {
    sourceEl.textContent = blueprint.source || "";
  }

  const modelEl = document.querySelector("#county-16255");
  if (modelEl) {
    modelEl.innerHTML = (blueprint.modelItems || []).map((item) => `<article class="capability-row">
      <div class="capability-index">${item.code}</div>
      <div>
        <h3>${item.name}</h3>
        <p>${item.detail}</p>
      </div>
      <div class="capability-side">
        <span class="badge info">${blueprint.model || "16255"}</span>
      </div>
    </article>`).join("");
  }

  const coverageEl = document.querySelector("#county-coverage");
  if (coverageEl) {
    coverageEl.innerHTML = [
      { region: "合计", consortiums: coverage.reduce((sum, item) => sum + Number(item.consortiums || 0), 0), hospitals: totalHospitals, primaryCenters: totalPrimary },
      ...coverage
    ].map((item) => `<section class="item">
      <div>
        <h3>${item.region}</h3>
        <p>${item.consortiums} 个医共体 / ${item.hospitals} 家医院 / ${item.primaryCenters} 家乡镇卫生院</p>
      </div>
      <span class="badge info">${item.primaryCenters}</span>
    </section>`).join("");
  }

  const appsEl = document.querySelector("#county-apps");
  if (appsEl) {
    appsEl.innerHTML = [
      ["复用全民健康信息平台", blueprint.reusedApps || []],
      ["新建医共体专项应用", blueprint.newApps || []],
      ["数据资源与安全", [`${dataResources.catalogs || 0} 项目录`, dataResources.sharing, dataResources.network, ...(dataResources.security || [])].filter(Boolean)]
    ].map(([title, items]) => `<div>
      <strong>${title}</strong>
      <span>${items.join("、")}</span>
    </div>`).join("");
  }

  const aiEl = document.querySelector("#county-grassroots-ai");
  if (aiEl) {
    aiEl.innerHTML = [
      ["覆盖范围", ai.coverage || "待配置"],
      ["辅助能力", (ai.functions || []).join("、")],
      ["运行监测", (ai.indicators || []).join("、")]
    ].map(([title, text]) => `<div><strong>${title}</strong><span>${text}</span></div>`).join("");
  }

  const centersEl = document.querySelector("#county-resource-centers");
  if (centersEl) {
    centersEl.innerHTML = centers.map((item) => `<article>
      <strong>${item.name}</strong>
      <div class="flow-steps">
        <span>1. 接入：${item.integration}</span>
        <span>2. 流程：${item.workflow}</span>
      </div>
    </article>`).join("");
  }
}

function renderCountyBusinessOperations(state) {
  const orderEl = document.querySelector("#county-collaboration-orders");
  if (orderEl) {
    orderEl.innerHTML = `<table>
      <thead><tr><th>中心</th><th>区县</th><th>居民</th><th>工单</th><th>流向</th><th>时限</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${(state.countyCollaborationOrders || []).map((item) => {
        const resident = residentOf(state, item.residentId);
        return `<tr>
          <td>${item.center}</td>
          <td>${item.region}</td>
          <td>${resident?.name || "未知居民"}</td>
          <td>${item.orderType}<br><small>${item.result}</small></td>
          <td>${item.fromInstitution} -> ${item.toInstitution}</td>
          <td>${item.due}</td>
          <td><span class="badge ${item.priority === "高" ? "danger" : "info"}">${item.status}</span></td>
          <td>
            ${countyActionButton("countyCollaborationOrders", item.id, "中心接收", { status: "中心已接收", result: "已进入中心处理队列" })}
            ${countyActionButton("countyCollaborationOrders", item.id, "报告回传", { status: "已回传", result: "报告已回传并进入互认" })}
          </td>
        </tr>`;
      }).join("")}</tbody>
    </table>`;
  }

  const recogEl = document.querySelector("#county-mutual-recognition");
  if (recogEl) {
    recogEl.innerHTML = (state.countyMutualRecognitionRecords || []).map((item) => {
      const resident = residentOf(state, item.residentId);
      return `<section class="item">
        <div>
          <h3>${resident?.name || "未知居民"} · ${item.item}</h3>
          <p>${item.sourceInstitution} -> ${item.targetInstitution}</p>
          <p>${item.reason} · 预计减少重复费用 ${money(item.savedCost)}</p>
          ${countyActionButton("countyMutualRecognitionRecords", item.id, "互认通过", { status: "已互认", reason: "质控通过，结果已互认" })}
          ${countyActionButton("countyMutualRecognitionRecords", item.id, "退回复核", { status: "退回复核", reason: "质控未通过，退回复核" })}
        </div>
        <span class="badge ${item.status === "已互认" ? "info" : "warn"}">${item.status}</span>
      </section>`;
    }).join("");
  }

  const aiEl = document.querySelector("#county-ai-cases");
  if (aiEl) {
    aiEl.innerHTML = (state.countyAiDiagnosisCases || []).map((item, index) => {
      const resident = residentOf(state, item.residentId);
      return `<article class="capability-row">
        <div class="capability-index">${index + 1}</div>
        <div>
          <h3>${item.region} · ${item.institution}</h3>
          <p>${resident?.name || "未知居民"}：${item.chiefComplaint}</p>
          <p>${item.suggestion}</p>
          <div class="standard-tags">
            <span class="badge info">${item.quality}</span>
            <span class="badge ${item.status === "已完成" ? "info" : "warn"}">${item.status}</span>
          </div>
        </div>
        <div class="capability-side">
          ${countyActionButton("countyAiDiagnosisCases", item.id, "医生采纳", { status: "已完成", doctorAction: "已采纳", quality: "病历质检通过" })}
          ${countyActionButton("countyAiDiagnosisCases", item.id, "转诊跟踪", { status: "转诊中", doctorAction: "已上转", quality: "重点病例" })}
        </div>
      </article>`;
    }).join("");
  }
}

function renderCountyTeleconsultationLoop(state) {
  const rows = filterCountyTeleconsultations(state.referralTeleconsultations || []);
  const countEl = document.querySelector("#county-teleconsultation-count");
  const tableEl = document.querySelector("#county-teleconsultation-loop");
  const performanceEl = document.querySelector("#county-teleconsultation-performance");
  if (!countEl || !tableEl) return;
  const allRows = state.referralTeleconsultations || [];
  const escalations = buildReferralTeleconsultationEscalations(rows);
  countEl.textContent = `${rows.length}/${allRows.length} 项`;
  if (performanceEl) {
    const reportReturned = rows.filter((item) => item.reportStatus === "returned" || item.status === "report-returned").length;
    const avgResponse = averagePerformance(rows, "responseHours");
    const avgReportReturn = averagePerformance(rows, "reportReturnHours");
    performanceEl.innerHTML = [
      ["报告回传", `${reportReturned}/${rows.length || 0}`, rows.length ? `${Math.round((reportReturned / rows.length) * 100)}% 回传率` : "暂无筛选记录"],
      ["平均响应", Number.isFinite(avgResponse) ? `${avgResponse.toFixed(1)}h` : "-", "接诊反馈时效"],
      ["平均回传", Number.isFinite(avgReportReturn) ? `${avgReportReturn.toFixed(1)}h` : "-", "报告回调时效"],
      ["SLA 风险", `${escalations.length}`, `SLA risks：${escalations.filter((item) => item.severity === "high").length} 个高风险待跟进`],
      ["已确认", allRows.filter((item) => item.slaDisposition?.status && item.slaDisposition.status !== "pending-ack").length, "机构或医共体 SLA 处置记录"],
      ["高优先级", rows.filter((item) => item.priority === "high").length, "医共体跟进队列"]
    ].map(([label, value, hint]) => `<article class="claim-card"><strong>${label}</strong><span>${value}<br>${hint}</span></article>`).join("");
  }
  renderCountyTeleconsultationCutoverReadiness(state, rows);
  renderCountyTeleconsultationJointLedger(state, rows);
  renderCountyTeleconsultationRiskBoard(state, rows, escalations);
  renderCountyTeleconsultationSignoff(state, rows);
  const escalationMap = new Map(escalations.map((item) => [item.teleconsultationId, item]));
  tableEl.innerHTML = `<table>
    <thead><tr><th>居民</th><th>路径</th><th>临床问题</th><th>状态</th><th>绩效</th><th>SLA</th><th>督办</th><th>报告</th><th>操作</th></tr></thead>
    <tbody>${rows.map((item) => {
      const resident = residentOf(state, item.residentId);
      const responseHours = Number(item.performance?.responseHours);
      const reportReturnHours = Number(item.performance?.reportReturnHours);
      const escalation = escalationMap.get(item.id);
      const reminderSent = escalation && hasReferralEscalationReminder(state, item.id, escalation.severity);
      return `<tr>
        <td>${resident?.name || item.residentId || "未知居民"}</td>
        <td>${item.sourceInstitution || "-"} → ${item.targetInstitution || "-"}<br><small>${item.department || item.type || ""}</small></td>
        <td>${item.clinicalQuestion || item.receivingFeedback || item.reportSummary || "-"}</td>
        <td><span class="badge ${item.priority === "high" ? "danger" : "info"}">${countyTeleconsultationStatusLabel(item.status)}</span></td>
        <td>响应 ${Number.isFinite(responseHours) ? `${responseHours}h` : "-"}<br><small>报告 ${Number.isFinite(reportReturnHours) ? `${reportReturnHours}h` : "-"} · ${item.performance?.insurancePaymentPath || "支付路径待确认"}</small></td>
        <td>${escalation ? `<span class="badge ${escalation.severity === "high" ? "danger" : "warn"}">${escalation.severity}</span><br><small>${escalation.reasons.join("; ")}</small>` : `<span class="badge info">正常</span>`}</td>
        <td>${item.countySupervision?.status || item.slaDisposition?.status || "待处置"}<br><small>${item.slaDisposition?.action || item.countySupervision?.reason || "-"}</small></td>
        <td>${item.reportStatus || "待回传"}</td>
        <td>
          ${escalation ? countyEscalationButton(item.id, reminderSent ? "已提醒" : "发送 SLA 提醒", reminderSent) : ""}
          ${item.slaDisposition?.status !== "closed" ? countySlaAckButton(item.id, item.slaDisposition?.status === "acknowledged" ? "关闭督办" : "确认督办") : ""}
          ${countyActionButton("referralTeleconsultations", item.id, "医共体跟进", { status: "feedback-returned", receivingFeedback: "医共体办公室已跟进接诊反馈。" })}
          ${countyActionButton("referralTeleconsultations", item.id, "确认回传", { status: "report-returned", reportStatus: "returned", reportSummary: "医共体办公室确认报告回传证据。" })}
        </td>
      </tr>`;
    }).join("")}</tbody>
  </table>`;
}

function renderCountyTeleconsultationCutoverReadiness(state, rows) {
  const el = document.querySelector("#county-teleconsultation-cutover");
  if (!el) return;
  const readiness = buildCountyTeleconsultationCutoverReadiness(state, rows);
  const planSummary = buildCountyTeleconsultationPlanSummary(readiness.nextDevelopmentPlan);
  el.innerHTML = [
    `<article data-referral-cutover-readiness>
      <div><span class="badge ${readiness.readyForProductionCutover ? "info" : "warn"}">Cutover gate</span></div>
      <h3>${readiness.readyForProductionCutover ? "Ready for module cutover" : "Blocked before production cutover"}</h3>
      <p>${readiness.contractReplay} callback contracts replayed; ${readiness.onsiteSignedRoles}/${readiness.totalRoles} onsite roles signed.</p>
      <footer>
        <small>${readiness.nextAction}</small>
        <small>Evidence source: ${readiness.evidenceSource}</small>
      </footer>
    </article>`,
    `<article data-referral-cutover-plan-summary>
      <div><span class="badge ${planSummary.pendingPhases ? "warn" : "info"}">Next plan</span></div>
      <h3>${planSummary.readyPhases}/${planSummary.totalPhases} phases ready</h3>
      <p>${planSummary.pendingPhases ? `${planSummary.pendingPhases} phases still need onsite evidence.` : "All listed phases have readiness evidence."}</p>
      <footer>
        <small>Next phase: ${planSummary.nextPhase}</small>
        <small>Owners: ${planSummary.owners.join(", ") || "county-command"}</small>
      </footer>
    </article>`,
    ...readiness.blockers.map((item) => `<article data-referral-cutover-blocker="${item.id}">
      <div><span class="badge warn">${item.owner}</span></div>
      <h3>${item.id}</h3>
      <p>${item.detail}</p>
    </article>`),
    ...readiness.nextDevelopmentPlan.map((item) => `<article data-referral-cutover-plan="${item.phase}">
      <div><span class="badge ${item.status === "ready" ? "info" : "warn"}">${item.statusLabel}</span><span class="badge info">${item.owner}</span></div>
      <h3>${item.phase}</h3>
      <p>${item.objective}</p>
      <footer>
        <small>${item.acceptance}</small>
        <small>Dependencies: ${item.dependencies.join(", ") || "onsite evidence"}</small>
      </footer>
    </article>`)
  ].join("");
}

function renderCountyTeleconsultationSignoff(state, rows) {
  const el = document.querySelector("#county-teleconsultation-signoff");
  if (!el) return;
  const signoffRows = buildCountyTeleconsultationSignoffRows(state, rows);
  el.innerHTML = signoffRows.map((item) => `<article data-referral-signoff-status="${item.role}">
    <div><span class="badge ${item.localEvidence ? "info" : "warn"}">${item.institutionType}</span><span class="badge warn">现场待签</span></div>
    <h3>${item.title}</h3>
    <p>${item.responsibility}</p>
    <footer>
      <small>${item.localEvidence ? "本地证据已就绪" : "本地证据待补齐"}：${item.evidence}</small>
      <small>${item.nextAction}</small>
      ${item.onsiteEvidence ? `<small>Signed by ${item.onsiteEvidence.signerName} · ${item.onsiteEvidence.signerOrg}</small>` : ""}
      <button class="inline-action" type="button" data-referral-signoff-submit data-role="${item.role}" ${item.onsiteEvidence ? "disabled" : ""}>Archive signoff</button>
    </footer>
  </article>`).join("");
}

function renderCountyTeleconsultationJointLedger(state, rows) {
  const el = document.querySelector("#county-teleconsultation-joint-ledger");
  if (!el) return;
  const ledgerRows = buildCountyTeleconsultationJointLedger(state, rows);
  const matchedContracts = ledgerRows.filter((item) => item.type === "callback" && item.matched > 0).length;
  const pendingRows = ledgerRows.filter((item) => !["matched", "signed"].includes(item.status));
  const jointTasks = new Map((state.taskMessages || [])
    .filter((message) => message.jointTestKey || message.notificationKey)
    .map((message) => [message.jointTestKey || message.notificationKey, message]));
  const jointTaskKeys = new Set(jointTasks.keys());
  const assignedTasks = pendingRows.filter((item) => jointTaskKeys.has(`referralTeleconsultations:joint-test:${item.role}`)).length;
  const completedTasks = pendingRows.filter((item) => {
    const task = jointTasks.get(`referralTeleconsultations:joint-test:${item.role}`);
    return task && /completed|closed|signed|read/i.test(String(task.status || ""));
  }).length;
  el.innerHTML = [
    `<article data-referral-joint-ledger-summary>
      <div><span class="badge info">Joint test ledger</span></div>
      <h3>${matchedContracts}/3 callback contracts replayed</h3>
      <p>${ledgerRows.filter((item) => item.localEvidence).length}/${ledgerRows.length} rows have local demo evidence; site signoff is tracked below.</p>
      <footer>
        <small>Use this before onsite signoff to reconcile callback replay, SLA supervision, payment policy, and archived signatures.</small>
        <small>${assignedTasks}/${pendingRows.length} owner tasks assigned; ${completedTasks}/${pendingRows.length} completed.</small>
        <button class="inline-action" type="button" data-referral-joint-ledger-tasks>Sync tasks</button>
      </footer>
    </article>`,
    ...ledgerRows.map((item) => {
      const task = jointTasks.get(`referralTeleconsultations:joint-test:${item.role}`);
      const taskClosed = task && /completed|closed|signed|read/i.test(String(task.status || ""));
      return `<article data-referral-joint-ledger="${item.role}">
        <div><span class="badge ${item.status === "matched" || item.status === "signed" ? "info" : "warn"}">${item.role}</span><span class="badge ${item.localEvidence ? "info" : "warn"}">${item.status}</span></div>
        <h3>${item.title}</h3>
        <p>${item.evidence}</p>
        <footer>
          <small>${item.type === "callback" ? `${item.matched} gateway events / ${item.matchedTargets} teleconsultations` : item.siteStatus}</small>
          <small>${item.nextAction}</small>
          <small>${task ? `Task ${task.status || "sent"}` : "Task not assigned"}</small>
          ${task ? `<button class="inline-action" type="button" data-referral-joint-ledger-complete data-role="${item.role}" ${taskClosed ? "disabled" : ""}>Complete task</button>` : ""}
        </footer>
      </article>`;
    })
  ].join("");
}

function buildCountyTeleconsultationJointLedger(state, rows) {
  const signoffByRole = new Map((state.referralTeleconsultationSignoffs || [])
    .filter((item) => item.status === "signed")
    .map((item) => [item.role, item]));
  const events = (state.integrationGatewayEvents || []).filter((item) => ["referral-feedback-callback-v1", "referral-schedule-callback-v1", "referral-report-callback-v1"].includes(item.contractId));
  const archivedReportIds = new Set((state.personalRecords || [])
    .filter((item) => item.category === "teleconsultation-report" && item.teleconsultationId)
    .map((item) => item.teleconsultationId));
  const callbacks = [
    {
      role: "referral-center",
      title: "Feedback callback replay",
      contractId: "referral-feedback-callback-v1",
      localEvidence: rows.some((item) => item.receivingFeedback),
      evidence: "receivingFeedback, feedback taskMessages, and gateway feedback callback"
    },
    {
      role: "receiving-hospital",
      title: "Schedule callback replay",
      contractId: "referral-schedule-callback-v1",
      localEvidence: rows.some((item) => item.meetingWindow && item.receivingDoctor),
      evidence: "meetingWindow, receivingDoctor, and gateway schedule callback"
    },
    {
      role: "hospital-it",
      title: "Report callback replay",
      contractId: "referral-report-callback-v1",
      localEvidence: rows.some((item) => item.reportStatus === "returned" || item.status === "report-returned") && rows.filter((item) => item.reportStatus === "returned" || item.status === "report-returned").every((item) => archivedReportIds.has(item.id)),
      evidence: "report callback, teleconsultation-report archive, and resident notification"
    }
  ].map((item) => {
    const matched = events.filter((event) => event.contractId === item.contractId && event.status === "matched");
    const matchedTargets = new Set(matched.map((event) => event.targetId).filter(Boolean));
    return {
      ...item,
      type: "callback",
      matched: matched.length,
      matchedTargets: matchedTargets.size,
      siteStatus: signoffByRole.has(item.role) ? "signed" : "pending-site-signoff",
      status: matched.length ? "matched" : (item.localEvidence ? "local-evidence-ready" : "pending-evidence"),
      nextAction: matched.length ? "Archive onsite signoff after replay evidence is reviewed." : "Replay the signed callback against the onsite integration gateway."
    };
  });
  const governance = [
    {
      role: "county-performance",
      type: "governance",
      title: "SLA supervision and performance ledger",
      localEvidence: rows.every((item) => item.countySupervision?.status && item.slaDisposition?.status),
      evidence: "countySupervision, slaDisposition, reminders, and performance settlement evidence"
    },
    {
      role: "insurance",
      type: "policy",
      title: "Payment and repeat-exam policy ledger",
      localEvidence: rows.every((item) => item.performance?.insurancePaymentPath && item.performance?.repeatExamControl),
      evidence: "insurancePaymentPath, repeatExamControl, and performance-policy endpoint"
    }
  ].map((item) => ({
    ...item,
    matched: signoffByRole.has(item.role) ? 1 : 0,
    matchedTargets: signoffByRole.has(item.role) ? 1 : 0,
    siteStatus: signoffByRole.has(item.role) ? "signed" : "pending-site-signoff",
    status: signoffByRole.has(item.role) ? "signed" : (item.localEvidence ? "local-evidence-ready" : "pending-evidence"),
    nextAction: signoffByRole.has(item.role) ? "Keep the signed evidence pack with the release record." : "Confirm onsite owner and archive signoff evidence."
  }));
  return [...callbacks, ...governance];
}

function buildCountyTeleconsultationCutoverReadiness(state, rows) {
  const apiReadiness = state.referralTeleconsultationJointTestPack?.cutoverReadiness;
  if (apiReadiness) {
    const readiness = {
      readyForProductionCutover: Boolean(apiReadiness.readyForProductionCutover),
      contractReplay: apiReadiness.contractReplay || "0/3",
      finalReadyRoles: Number(apiReadiness.finalSignoffReadyRoles || 0),
      onsiteSignedRoles: Number(apiReadiness.onsiteSignedRoles || 0),
      totalRoles: 5,
      blockers: Array.isArray(apiReadiness.blockers) ? apiReadiness.blockers : [],
      nextAction: apiReadiness.nextAction || "Review the joint-test pack before production cutover.",
      evidenceSource: "joint-test-pack API"
    };
    return {
      ...readiness,
      nextDevelopmentPlan: normalizeCountyTeleconsultationNextPlan(state.referralTeleconsultationJointTestPack?.nextDevelopmentPlan, readiness)
    };
  }
  const ledgerRows = buildCountyTeleconsultationJointLedger(state, rows);
  const signoffRows = buildCountyTeleconsultationSignoffRows(state, rows);
  const replayedContracts = ledgerRows.filter((item) => item.type === "callback" && item.matched > 0).length;
  const completedTaskRoles = new Set((state.taskMessages || [])
    .filter((message) =>
      String(message.jointTestKey || message.notificationKey || "").startsWith("referralTeleconsultations:joint-test:")
      && /completed|closed|signed|read/i.test(String(message.status || ""))
    )
    .map((message) => String(message.jointTestKey || message.notificationKey || "").replace("referralTeleconsultations:joint-test:", "")));
  const onsiteSignedRoles = signoffRows.filter((item) => item.onsiteEvidence).length;
  const finalReadyRoles = ledgerRows.filter((item) => item.localEvidence && (item.status === "matched" || item.status === "signed" || completedTaskRoles.has(item.role))).length;
  const blockers = [
    replayedContracts < 3 ? {
      id: "callback-replay-pending",
      owner: "institution-integration",
      detail: "Replay feedback, schedule, and report callbacks with signed payloads from the target site."
    } : null,
    finalReadyRoles < signoffRows.length ? {
      id: "owner-task-pending",
      owner: "county-command",
      detail: "Complete owner task receipts for all joint-test ledger rows before onsite signoff."
    } : null,
    onsiteSignedRoles < signoffRows.length ? {
      id: "onsite-signoff-pending",
      owner: "county-command",
      detail: "Archive signed onsite evidence for referral center, receiving hospital, hospital IT, county performance, and insurance."
    } : null
  ].filter(Boolean);
  const readiness = {
    readyForProductionCutover: blockers.length === 0,
    contractReplay: `${replayedContracts}/3`,
    finalReadyRoles,
    onsiteSignedRoles,
    totalRoles: signoffRows.length,
    blockers,
    nextAction: blockers[0]?.detail || "Module cutover evidence is complete; continue with platform environment gates.",
    evidenceSource: "local county state"
  };
  return {
    ...readiness,
    nextDevelopmentPlan: normalizeCountyTeleconsultationNextPlan([], readiness)
  };
}

function normalizeCountyTeleconsultationNextPlan(plan, readiness = {}) {
  const fallback = [
    {
      phase: "field-interface-replay",
      owner: "institution-integration",
      objective: "Replay referral feedback, schedule, and report callbacks with signed payloads.",
      dependencies: ["signed callback payloads", "target gateway"],
      acceptance: "All three callback contracts have matched gateway events."
    },
    {
      phase: "onsite-signoff-archive",
      owner: "county-command",
      objective: "Archive onsite signed evidence for referral center, receiving hospital, hospital IT, county performance, and insurance.",
      dependencies: ["signed screenshots", "onsite signer list"],
      acceptance: "All five roles have signed evidence in the signoff summary."
    }
  ];
  const replay = parseCountyTeleconsultationProgress(readiness.contractReplay, 3);
  const rows = Array.isArray(plan) && plan.length ? plan : fallback;
  return rows.slice(0, 4).map((item) => ({
    phase: item.phase || "next-step",
    owner: item.owner || "county-command",
    objective: item.objective || item.target || "Confirm the next onsite cutover action.",
    dependencies: Array.isArray(item.dependencies) ? item.dependencies.slice(0, 4) : [],
    acceptance: item.acceptance || "Acceptance evidence is attached to the joint-test pack.",
    ...buildCountyTeleconsultationPlanStatus(item.phase || "next-step", readiness, replay)
  }));
}

function parseCountyTeleconsultationProgress(value, fallbackTotal) {
  const match = String(value || "").match(/(\d+)\s*\/\s*(\d+)/);
  return match
    ? { done: Number(match[1]), total: Number(match[2]) }
    : { done: 0, total: fallbackTotal };
}

function buildCountyTeleconsultationPlanStatus(phase, readiness, replay) {
  const normalizedPhase = String(phase || "").toLowerCase();
  if (normalizedPhase.includes("field-interface")) {
    return replay.done >= replay.total ? { status: "ready", statusLabel: "ready" } : { status: "pending", statusLabel: "replay pending" };
  }
  if (normalizedPhase.includes("onsite-signoff")) {
    return Number(readiness.onsiteSignedRoles || 0) >= Number(readiness.totalRoles || 5)
      ? { status: "ready", statusLabel: "signed" }
      : { status: "pending", statusLabel: "signoff pending" };
  }
  if (normalizedPhase.includes("insurance")) {
    return Number(readiness.finalReadyRoles || 0) >= Number(readiness.totalRoles || 5)
      ? { status: "ready", statusLabel: "policy ready" }
      : { status: "pending", statusLabel: "policy pending" };
  }
  return readiness.readyForProductionCutover
    ? { status: "ready", statusLabel: "cutover ready" }
    : { status: "pending", statusLabel: "cutover pending" };
}

function buildCountyTeleconsultationPlanSummary(plan) {
  const rows = Array.isArray(plan) ? plan : [];
  const readyPhases = rows.filter((item) => item.status === "ready").length;
  const next = rows.find((item) => item.status !== "ready") || rows[0] || {};
  return {
    totalPhases: rows.length,
    readyPhases,
    pendingPhases: Math.max(rows.length - readyPhases, 0),
    nextPhase: next.phase || "field-interface-replay",
    owners: [...new Set(rows.map((item) => item.owner).filter(Boolean))]
  };
}

function buildCountyTeleconsultationSignoffRows(state, rows) {
  const messages = (state.taskMessages || []).filter((item) => item.collection === "referralTeleconsultations");
  const signoffByRole = new Map((state.referralTeleconsultationSignoffs || [])
    .filter((item) => item.status === "signed")
    .map((item) => [item.role, item]));
  const contractIds = new Set((state.integrationContracts || []).map((item) => item.id));
  const archivedReportIds = new Set((state.personalRecords || [])
    .filter((item) => item.category === "teleconsultation-report" && item.teleconsultationId)
    .map((item) => item.teleconsultationId));
  const reportReturned = rows.filter((item) => item.reportStatus === "returned" || item.status === "report-returned");
  const hasSlaDispositionEvidence = rows.some((item) => {
    const status = String(item.slaDisposition?.status || item.countySupervision?.status || "").toLowerCase();
    return status && status !== "pending-ack" && (status.includes("acknowledged") || status.includes("closed") || status.includes("已确认") || status.includes("已闭环"));
  });
  const signoffRows = [
    {
      role: "referral-center",
      institutionType: "转诊中心",
      title: "转诊单与反馈",
      responsibility: "转诊单接收、分诊意见和接诊反馈回调。",
      localEvidence: contractIds.has("referral-feedback-callback-v1") && messages.some((item) => item.notificationKey?.includes(":feedback:")) && rows.some((item) => item.receivingFeedback),
      evidence: "feedback-callback、receivingFeedback、反馈消息",
      blocker: "真实转诊单号和失败补偿队列"
    },
    {
      role: "receiving-hospital",
      institutionType: "接诊医院",
      title: "排期与会诊资源",
      responsibility: "会诊排期、号源/床位/视频间和接诊医生确认。",
      localEvidence: contractIds.has("referral-schedule-callback-v1") && rows.some((item) => item.meetingWindow && item.receivingDoctor),
      evidence: "schedule-callback、meetingWindow、receivingDoctor",
      blocker: "真实号源、床位和视频系统"
    },
    {
      role: "hospital-it",
      institutionType: "信息中心",
      title: "报告回传归档",
      responsibility: "HIS/EMR/PACS/LIS 报告回传、签名校验和归档。",
      localEvidence: contractIds.has("referral-report-callback-v1") && reportReturned.length > 0 && reportReturned.every((item) => archivedReportIds.has(item.id)),
      evidence: "report-callback、teleconsultation-report 归档",
      blocker: "真实报告编号、附件地址和签名密钥"
    },
    {
      role: "county-performance",
      institutionType: "医共体办公室",
      title: "督办与绩效",
      responsibility: "SLA 督办、协同工单跟踪、绩效归集和闭环确认。",
      localEvidence: rows.every((item) => item.countySupervision?.status && item.slaDisposition?.status) && (messages.some((item) => item.escalationKey) || hasSlaDispositionEvidence),
      evidence: "countySupervision、slaDisposition、SLA 消息",
      blocker: "值班人、升级渠道和签收截图"
    },
    {
      role: "insurance",
      institutionType: "医保/绩效",
      title: "支付与互认口径",
      responsibility: "支付路径、报告互认控费、重复检查控制和结算口径确认。",
      localEvidence: rows.every((item) => item.performance?.insurancePaymentPath && item.performance?.repeatExamControl),
      evidence: "insurancePaymentPath、repeatExamControl、绩效策略",
      blocker: "统筹区支付细则和结算公式"
    }
  ];
  return signoffRows.map((item) => ({
    ...item,
    onsiteEvidence: signoffByRole.get(item.role) || null,
    nextAction: item.localEvidence ? `现场签收：${item.blocker}` : `补齐证据：${item.evidence}`
  }));
}

function renderCountyTeleconsultationRiskBoard(state, rows, escalations) {
  const board = document.querySelector("#county-teleconsultation-risk-board");
  if (!board) return;
  const reportPending = rows.filter((item) => item.reportStatus !== "returned");
  const messageRows = rows.filter((item) => (state.taskMessages || []).some((message) => message.collection === "referralTeleconsultations" && message.sourceId === item.id));
  const noEscalation = !escalations.length && rows.length;
  const topEscalations = escalations.slice(0, 2);
  board.innerHTML = [
    {
      badge: "医共体督办",
      title: "SLA 风险队列",
      body: topEscalations.length
        ? topEscalations.map((item) => `${item.teleconsultationId}：${item.reasons.join("；")}`).join("；")
        : (noEscalation ? "当前筛选范围未发现逾期或高优先级风险。" : "暂无筛选记录。"),
      footer: `${escalations.filter((item) => item.severity === "high").length} 个高风险 · ${escalations.length} 个待跟进`
    },
    {
      badge: "报告回传",
      title: "未回传闭环",
      body: reportPending.map((item) => item.targetInstitution || item.id).slice(0, 3).join("、") || "当前筛选范围报告已完成回传。",
      footer: `${reportPending.length}/${rows.length || 0} 项需报告证据`
    },
    {
      badge: "消息触达",
      title: "机构/居民通知",
      body: messageRows.map((item) => item.id).slice(0, 3).join("、") || "待生成提醒或居民触达消息。",
      footer: `${messageRows.length} 项已有 taskMessages 留痕`
    },
    {
      badge: "绩效支付",
      title: "互认与结算口径",
      body: [...new Set(rows.map((item) => item.performance?.repeatExamControl).filter(Boolean))].join("；") || "待医保和医共体确认重复检查控制口径。",
      footer: "用于县域绩效与医保审核"
    }
  ].map((item) => `<article data-referral-risk-board>
    <div><span class="badge info">${item.badge}</span></div>
    <h3>${item.title}</h3>
    <p>${item.body}</p>
    <footer><small>${item.footer}</small></footer>
  </article>`).join("");
}

function countyTeleconsultationStatusLabel(status) {
  return {
    requested: "已申请",
    accepted: "已接诊",
    scheduled: "已排期",
    "feedback-returned": "已反馈",
    "report-returned": "报告已回传",
    closed: "已闭环"
  }[status] || status || "待处理";
}

function filterCountyTeleconsultations(rows) {
  const status = document.querySelector("#county-teleconsultation-status-filter")?.value || "all";
  const priority = document.querySelector("#county-teleconsultation-priority-filter")?.value || "all";
  return rows.filter((item) => {
    const statusMatched = status === "all" || item.status === status;
    const priorityMatched = priority === "all" || item.priority === priority;
    return statusMatched && priorityMatched;
  });
}

function parseReferralDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildReferralTeleconsultationEscalations(rows) {
  const now = new Date();
  return (Array.isArray(rows) ? rows : [])
    .filter((item) => item.reportStatus !== "returned" && item.status !== "closed")
    .map((item) => {
      const dueDate = parseReferralDate(item.due);
      const requestedAt = parseReferralDate(item.requestedAt || item.createdAt);
      const daysOverdue = dueDate ? Math.floor((now.getTime() - dueDate.getTime()) / 86400000) : 0;
      const ageDays = requestedAt ? Math.floor((now.getTime() - requestedAt.getTime()) / 86400000) : 0;
      const responseHours = Number(item.performance?.responseHours);
      const reportReturnHours = Number(item.performance?.reportReturnHours);
      const reasons = [];
      if (daysOverdue > 0) reasons.push(`逾期 ${daysOverdue} 天`);
      if (item.priority === "high") reasons.push("高优先级报告未回传");
      if (Number.isFinite(responseHours) && responseHours > 4) reasons.push(`响应 ${responseHours}h`);
      if (Number.isFinite(reportReturnHours) && reportReturnHours > 24) reasons.push(`报告 ${reportReturnHours}h`);
      if (!item.meetingWindow) reasons.push("缺少会诊窗口");
      if (!reasons.length && ageDays >= 2) reasons.push(`开放 ${ageDays} 天`);
      if (!reasons.length) return null;
      return {
        teleconsultationId: item.id,
        severity: item.priority === "high" || daysOverdue > 0 ? "high" : "medium",
        reasons,
        daysOverdue: Math.max(0, daysOverdue)
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.daysOverdue - a.daysOverdue);
}

function averagePerformance(rows, field) {
  const values = rows.map((item) => Number(item.performance?.[field])).filter(Number.isFinite);
  if (!values.length) return Number.NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function bindCountyActions() {
  document.querySelector("#county-teleconsultation-status-filter")?.addEventListener("change", () => renderCountyTeleconsultationLoop(platformState));
  document.querySelector("#county-teleconsultation-priority-filter")?.addEventListener("change", () => renderCountyTeleconsultationLoop(platformState));
  document.addEventListener("click", async (event) => {
    const reminderButton = event.target.closest("[data-referral-escalation]");
    if (reminderButton && platformState) {
      reminderButton.disabled = true;
      const result = await runReferralEscalation(platformState, reminderButton.dataset.id);
      reminderButton.textContent = result.ok ? `Reminder ${result.created}` : "Retry reminder";
      renderCountyTeleconsultationLoop(platformState);
      return;
    }
    const ackButton = event.target.closest("[data-county-sla-ack]");
    if (ackButton && platformState) {
      ackButton.disabled = true;
      await acknowledgeCountySla(platformState, ackButton.dataset.id, ackButton.dataset.mode || "acknowledged");
      renderCountyTeleconsultationLoop(platformState);
      return;
    }
    const signoffButton = event.target.closest("[data-referral-signoff-submit]");
    if (signoffButton && platformState) {
      signoffButton.disabled = true;
      await archiveReferralSignoff(platformState, signoffButton.dataset.role);
      renderCountyTeleconsultationLoop(platformState);
      return;
    }
    const jointTaskButton = event.target.closest("[data-referral-joint-ledger-tasks]");
    if (jointTaskButton && platformState) {
      jointTaskButton.disabled = true;
      const result = await createReferralJointLedgerTasks(platformState);
      jointTaskButton.textContent = `Tasks ${result.created}`;
      renderCountyTeleconsultationLoop(platformState);
      return;
    }
    const jointTaskCompleteButton = event.target.closest("[data-referral-joint-ledger-complete]");
    if (jointTaskCompleteButton && platformState) {
      jointTaskCompleteButton.disabled = true;
      await completeReferralJointLedgerTask(platformState, jointTaskCompleteButton.dataset.role);
      renderCountyTeleconsultationLoop(platformState);
      return;
    }
    const button = event.target.closest("[data-county-action]");
    if (!button || !platformState) return;
    const updates = JSON.parse(button.dataset.updates || "{}");
    const result = await updateWorkflowAction(platformState, button.dataset.collection, button.dataset.id, updates, button.dataset.note || "县域医共体更新业务状态");
    if (!result.ok) return;
    renderCountyBusinessOperations(platformState);
    renderCountyTeleconsultationLoop(platformState);
  });
}

async function runReferralEscalation(state, teleconsultationId) {
  if (API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${API_BASE}/referral-teleconsultations/escalations/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teleconsultationId })
      });
      if (response.ok) {
        const payload = await response.json();
        state.taskMessages = [...(payload.messages || []), ...(state.taskMessages || [])].slice(0, 300);
        return { ok: true, created: payload.summary?.created ?? 0 };
      }
    } catch (error) {
      // Static preview falls back to a local in-app reminder below.
    }
  }
  const item = (state.referralTeleconsultations || []).find((row) => row.id === teleconsultationId);
  if (!item) return { ok: false, created: 0 };
  const key = `referralTeleconsultations:${item.id}:sla:local`;
  const existing = (state.taskMessages || []).some((message) => message.escalationKey === key);
  if (!existing) {
    state.taskMessages = [{
      id: `msg-${Date.now()}`,
      taskId: `referralTeleconsultations:${item.id}`,
      collection: "referralTeleconsultations",
      sourceId: item.id,
      residentId: item.residentId || "",
      targetRole: "institution",
      channel: "in_app",
      title: "Referral teleconsultation SLA reminder",
      body: `${item.targetInstitution || "Receiving institution"} needs report callback follow-up.`,
      status: "sent",
      escalationKey: key,
      createdAt: new Date().toISOString(),
      createdBy: "county-preview"
    }, ...(state.taskMessages || [])].slice(0, 300);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
  return { ok: true, created: existing ? 0 : 1 };
}

function hasReferralEscalationReminder(state, id, severity) {
  return (state.taskMessages || []).some((message) =>
    message.escalationKey === `referralTeleconsultations:${id}:sla:${severity}` ||
    message.escalationKey === `referralTeleconsultations:${id}:sla:local`
  );
}

async function acknowledgeCountySla(state, id, mode) {
  const status = mode === "closed" ? "closed" : "acknowledged";
  const action = status === "closed"
    ? "County office closed SLA supervision after report evidence review."
    : "County office acknowledged SLA supervision and assigned institution follow-up.";
  if (API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${API_BASE}/referral-teleconsultations/${encodeURIComponent(id)}/escalations/ack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, action })
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
        slaDisposition: { status, action, owner: "county-preview", updatedAt: now },
        countySupervision: { ...(item.countySupervision || {}), status: status === "closed" ? "已闭环" : "已确认", action, updatedAt: now }
      }
    : item);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  return { ok: true };
}

async function archiveReferralSignoff(state, role) {
  const payload = {
    signerName: "现场联调负责人",
    signerOrg: "中山区县域医共体",
    evidenceNote: `${role} onsite signoff archived from county command board`,
    attachmentName: `${role}-signoff-screenshot.png`,
    evidenceType: "onsite-signoff"
  };
  if (API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${API_BASE}/referral-teleconsultations/signoff-summary/${encodeURIComponent(role)}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (response.ok) {
        const result = await response.json();
        state.referralTeleconsultationSignoffs = [
          result.signoff,
          ...(state.referralTeleconsultationSignoffs || []).filter((item) => !(item.role === role && item.status === "signed"))
        ].slice(0, 50);
        return { ok: true };
      }
    } catch (error) {
      // Static preview falls back to local signoff below.
    }
  }
  const now = new Date().toISOString();
  const signoff = {
    id: `local-signoff-${role}`,
    role,
    status: "signed",
    signerName: payload.signerName,
    signerOrg: payload.signerOrg,
    evidenceNote: payload.evidenceNote,
    attachmentName: payload.attachmentName,
    evidenceType: payload.evidenceType,
    signedAt: now,
    submittedAt: now,
    submittedBy: "county-preview"
  };
  state.referralTeleconsultationSignoffs = [
    signoff,
    ...(state.referralTeleconsultationSignoffs || []).filter((item) => !(item.role === role && item.status === "signed"))
  ].slice(0, 50);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  return { ok: true };
}

async function createReferralJointLedgerTasks(state) {
  if (API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${API_BASE}/referral-teleconsultations/joint-test-ledger/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      if (response.ok) {
        const result = await response.json();
        state.taskMessages = [
          ...(result.messages || []),
          ...(state.taskMessages || []).filter((message) => !(message.jointTestKey && (result.messages || []).some((item) => item.jointTestKey === message.jointTestKey)))
        ].slice(0, 300);
        return { ok: true, created: result.summary?.created ?? 0 };
      }
    } catch (error) {
      // Static preview falls back to local task creation below.
    }
  }
  const existingKeys = new Set((state.taskMessages || []).map((message) => message.jointTestKey || message.notificationKey).filter(Boolean));
  const rows = buildCountyTeleconsultationJointLedger(state, state.referralTeleconsultations || [])
    .filter((row) => !["matched", "signed"].includes(row.status));
  const now = new Date().toISOString();
  const messages = rows.map((row) => {
    const key = `referralTeleconsultations:joint-test:${row.role}`;
    if (existingKeys.has(key)) return null;
    const targetRole = row.role === "insurance" ? "insurance" : row.role === "county-performance" ? "county" : "institution";
    return {
      id: `msg-joint-${row.role}-${Date.now()}`,
      taskId: `referralTeleconsultations:joint-test:${row.role}`,
      collection: "referralTeleconsultations",
      sourceId: row.role,
      residentId: "",
      targetRole,
      channel: "in_app",
      title: `Referral teleconsultation joint-test follow-up: ${row.role}`,
      body: `${row.title}: ${row.nextAction}`,
      status: "sent",
      notificationKey: key,
      jointTestKey: key,
      receipts: [],
      createdAt: now,
      createdBy: "county-preview",
      createdByName: "County preview"
    };
  }).filter(Boolean);
  state.taskMessages = [...messages, ...(state.taskMessages || [])].slice(0, 300);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  return { ok: true, created: messages.length };
}

async function completeReferralJointLedgerTask(state, role) {
  if (API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${API_BASE}/referral-teleconsultations/joint-test-ledger/tasks/${encodeURIComponent(role)}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed", note: `${role} joint-test owner confirmed evidence follow-up.` })
      });
      if (response.ok) {
        const result = await response.json();
        state.taskMessages = [
          result.message,
          ...(state.taskMessages || []).filter((message) => message.id !== result.message.id)
        ].slice(0, 300);
        return { ok: true };
      }
    } catch (error) {
      // Static preview falls back to local task completion below.
    }
  }
  const key = `referralTeleconsultations:joint-test:${role}`;
  const now = new Date().toISOString();
  state.taskMessages = (state.taskMessages || []).map((message) => {
    if (message.jointTestKey !== key && message.notificationKey !== key) return message;
    return {
      ...message,
      status: "completed",
      jointTestCompletedAt: now,
      jointTestCompletedBy: "county-preview",
      jointTestCompletionNote: `${role} joint-test owner confirmed evidence follow-up.`,
      receipts: [{
        at: now,
        by: "county-preview",
        byName: "County preview",
        role: "county",
        status: "completed",
        note: `${role} joint-test owner confirmed evidence follow-up.`
      }, ...(Array.isArray(message.receipts) ? message.receipts : [])].slice(0, 20)
    };
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  return { ok: true };
}

function countyActionButton(collection, id, label, updates) {
  return `<button class="inline-action" type="button" data-county-action data-collection="${collection}" data-id="${id}" data-updates='${JSON.stringify(updates)}' data-note="${label}">${label}</button>`;
}

function countyEscalationButton(id, label, disabled = false) {
  return `<button class="inline-action" type="button" data-referral-escalation data-id="${id}" ${disabled ? "disabled" : ""}>${label}</button>`;
}

function countySlaAckButton(id, label) {
  const mode = label.includes("Close") || label.includes("关闭") ? "closed" : "acknowledged";
  return `<button class="inline-action" type="button" data-county-sla-ack data-id="${id}" data-mode="${mode}">${label}</button>`;
}

function residentOf(state, id) {
  return (state.residents || []).find((item) => item.id === id);
}

function renderCapabilityFilter(county) {
  const select = document.querySelector("#capability-filter");
  const domains = [...new Set(county.capabilities.map((item) => item.domain))];
  select.innerHTML = [`<option value="all">全部功能域</option>`, ...domains.map((domain) => `<option value="${domain}">${domain}</option>`)].join("");
  select.addEventListener("change", () => renderCountyCapabilities(county, select.value));
}

function renderCountyCapabilities(county, domain) {
  const items = county.capabilities.filter((item) => domain === "all" || item.domain === domain);
  document.querySelector("#county-capabilities").innerHTML = items.map((item) => {
    const badge = item.status === "运行中" ? "" : item.status === "建设中" ? "info" : "warn";
    return `<article class="capability-row">
      <div class="capability-index">${item.no}</div>
      <div>
        <h3>${item.name}</h3>
        <p>${item.summary}</p>
        <div class="standard-tags">
          ${item.functions.map((fn) => `<span class="badge info">${fn}</span>`).join("")}
        </div>
      </div>
      <div class="capability-side">
        <span class="badge ${badge}">${item.status}</span>
        <small>${item.owner}</small>
      </div>
    </article>`;
  }).join("");
}

function renderCountyTasks(county) {
  const tasks = county.tasks || [];
  document.querySelector("#county-task-count").textContent = `${tasks.length} 项`;
  document.querySelector("#county-tasks").innerHTML = tasks.map((task) => `<section class="item">
    <div>
      <h3>${task.title}</h3>
      <p>${task.owner} · ${task.due}</p>
      <p>${task.action}</p>
    </div>
    <span class="badge ${task.level === "高" ? "danger" : task.status === "进行中" ? "info" : "warn"}">${task.status}</span>
  </section>`).join("");
}

function renderCountyWorkflows(county) {
  document.querySelector("#county-workflows").innerHTML = county.workflows.map((flow) => `<article>
    <strong>${flow.name}</strong>
    <div class="flow-steps">
      ${flow.steps.map((step, index) => `<span>${index + 1}. ${step}</span>`).join("")}
    </div>
  </article>`).join("");
}

function renderCountyReferral(state) {
  const referral = state.referralSystem || {};
  const referrals = referral.referrals || [];
  const blocks = [
    {
      name: "紧密型医联体协同",
      steps: referral.goals || ["以紧密型医联体为抓手完善分级诊疗协同机制"]
    },
    {
      name: "转诊中心运行",
      steps: referrals.map((item) => `${item.type}：${item.from} → ${item.to} · ${item.status}`)
    },
    {
      name: "预留资源",
      steps: (referral.reservedResources || []).map((item) => `${item.institution}${item.department}：号源 ${item.outpatientSlots}，床位 ${item.beds}`)
    },
    {
      name: "医保与长期处方",
      steps: (referral.insuranceGuidance || []).map((item) => `${item.item}：${item.status}`)
    }
  ];
  document.querySelector("#county-referral").innerHTML = blocks.map((flow) => `<article>
    <strong>${flow.name}</strong>
    <div class="flow-steps">
      ${(flow.steps.length ? flow.steps : ["待配置"]).map((step, index) => `<span>${index + 1}. ${step}</span>`).join("")}
    </div>
  </article>`).join("");
}

function renderCountyIndicators(county) {
  document.querySelector("#county-indicators").innerHTML = county.indicators.map((item) => `<section class="item">
    <div>
      <h3>${item.name}</h3>
      <p>${item.source} · ${item.target}</p>
    </div>
    <span class="badge ${item.trend === "预警" ? "warn" : "info"}">${item.value}</span>
  </section>`).join("");
}

function renderCountyGovernance(county) {
  document.querySelector("#county-governance").innerHTML = county.governance.map((item) => `<div>
    <strong>${item.title}</strong>
    <span>${item.detail}</span>
  </div>`).join("");
}

function buildCountyConsortiumDefaults(state) {
  return {
    organizations: [
      { name: "县域医共体总医院", level: "牵头医院", role: "统一医技中心、远程会诊、质控、绩效和运营管理", systems: ["HIS", "EMR", "医技共享", "运营监管"] },
      { name: "县中医医院", level: "专科牵头", role: "中医智能辅诊、中药共享药房、中医适宜技术推广", systems: ["中医知识库", "中药房", "远程中医"] },
      { name: "乡镇卫生院", level: "成员单位", role: "基层首诊、签约服务、慢病随访、样本采集和转诊申请", systems: ["基层医疗", "公卫", "家医签约"] },
      { name: "村卫生室", level: "网底机构", role: "健康监测、随访提醒、取药登记、检查申请和居民服务触点", systems: ["移动随访", "电子健康卡"] },
      { name: "疾控/妇幼/急救中心", level: "公共卫生", role: "疾控协同、妇幼保健、疫苗接种、应急指挥和院前急救", systems: ["疾控", "妇幼", "急救"] }
    ],
    capabilities: countyCapabilities(),
    tasks: [
      { title: "检验检查结果互认规则上线", owner: "医共体办公室", due: "2026-07-15", action: "统一互认项目、质控标准和不互认理由填报。", status: "进行中", level: "高" },
      { title: "基层缺药登记与药物配供闭环", owner: "总医院药学中心", due: "2026-07-30", action: "接入固定取药、延伸处方、中心药房配送状态。", status: "进行中", level: "中" },
      { title: "家庭医生签约履约评价", owner: "基层医疗卫生机构", due: "2026-08-10", action: "把签约、咨询、随访、转诊和满意度纳入绩效。", status: "待启动", level: "中" },
      { title: "医疗废弃物追溯监管", owner: "后勤安全中心", due: "2026-08-30", action: "建设收集、暂存、交接、转运、处置追溯台账。", status: "待启动", level: "中" }
    ],
    workflows: [
      { name: "影像/心电/检验共享", steps: ["基层申请", "数据采集", "中心诊断", "报告回传", "结果互认", "医保/质控监管"] },
      { name: "双向转诊预约", steps: ["基层评估", "电子病历调阅", "转诊申请", "号源/床位预约", "接诊反馈", "下转随访"] },
      { name: "互联网+慢病", steps: ["筛查建档", "风险评估", "分级分组", "干预随访", "转诊复诊", "长期用药监测"] },
      { name: "公共卫生应急", steps: ["多源监测", "智能预警", "指挥调度", "资源联动", "处置反馈", "复盘评估"] }
    ],
    indicators: [
      { name: "县域内就诊率", value: "82.4%", target: "逐季提升", source: "HIS/医保结算", trend: "正常" },
      { name: "基层首诊率", value: "61.8%", target: "提升基层能力", source: "预约与门诊记录", trend: "正常" },
      { name: "检验检查互认率", value: "46.2%", target: "减少重复检查", source: "医技共享中心", trend: "预警" },
      { name: "慢病规范管理率", value: "73.5%", target: "防筛诊治管闭环", source: "健康档案/随访", trend: "正常" },
      { name: "家庭医生履约率", value: "68.9%", target: "按服务包评价", source: "签约服务系统", trend: "预警" },
      { name: "医保协同审核通过率", value: "91.6%", target: "结算合规", source: "医保中心", trend: "正常" }
    ],
    governance: [
      { title: "省市统筹、县域落地", detail: "依托全民健康信息平台，统一网络、标准、接口和安全要求，避免重复建设。" },
      { title: "一平台一中心一张图", detail: "建设医共体基础平台、大数据中心和运营监管驾驶舱，支撑县乡村一体化治理。" },
      { title: "数据安全与最小授权", detail: "健康档案、电子病历、医保、药品、绩效和人财物数据分级授权、访问留痕。" },
      { title: "信创与网络安全", detail: "预留信创适配、专网接入、边界防护、入侵检测、容灾备份和数据质控能力。" }
    ]
  };
}

function countyCapabilities() {
  const groups = {
    "区域医疗服务协同": [
      ["医学影像诊断资源共享中心", "基层检查、上级诊断、影像报告回传与互认。", "总医院影像中心", "运行中", ["申请管理", "影像质控", "报告发布", "危急值"]],
      ["心电诊断资源共享中心", "基层采集心电波形，县级中心诊断并回传报告。", "总医院心电中心", "运行中", ["心电采集", "任务分配", "移动诊断", "危急值"]],
      ["医学检验资源共享中心", "基层采样、冷链转运、中心检测、报告实时查阅。", "医学检验中心", "运行中", ["检验申请", "样本运输", "结果审核", "质控"]],
      ["病理诊断资源共享中心", "县域机构申请病理诊断，牵头医院审核出具报告。", "病理中心", "建设中", ["标本核收", "诊断分析", "图文报告", "权限管理"]],
      ["远程会诊资源共享中心", "向上联通省市医院，向下连接基层机构，实现会诊全过程管理。", "远程会诊中心", "运行中", ["会诊申请", "病历调阅", "健康档案调阅", "评估"]],
      ["消毒供应资源共享中心", "复用器械清洗、消毒、灭菌、配送和全流程追溯。", "消毒供应中心", "建设中", ["物品申领", "追溯", "配送监管", "成本核算"]],
      ["县域智慧医疗急救中心", "院前院内急救信息共享，救护车定位和生命体征实时传输。", "急救中心", "建设中", ["急救病历", "车辆定位", "联合质控", "指挥调度"]]
    ],
    "便民惠民服务协同": [
      ["电子健康卡应用", "统一身份主索引，一码通用，跨机构统一认证。", "数字健康中心", "运行中", ["实名认证", "授权", "一码通", "主索引"]],
      ["互联网+诊疗服务", "咨询、复诊、续方、支付、报告查询、护理服务一体化。", "互联网医院", "建设中", ["在线咨询", "复诊续方", "在线支付", "处方流转"]],
      ["互联网+慢病协同管理", "为高血压、糖尿病、慢阻肺等人群提供线上线下一体化管理。", "慢病中心", "运行中", ["筛查", "建档", "评估", "随访"]],
      ["互联网+家庭医生签约", "线上签约、健康咨询、随访、转诊和履约评价。", "基层机构", "建设中", ["协议管理", "服务包", "满意度", "绩效"]],
      ["预约诊疗服务", "挂号、检查、检验、体检、住院、转诊预约统一管理。", "预约转诊中心", "运行中", ["资源同步", "转诊申请", "接诊", "结案"]],
      ["中医智能辅诊服务", "智能辨证、体质辨识、中医处方推荐和知识库支持。", "县中医医院", "待启动", ["智能问诊", "辅助诊疗", "体质辨识", "知识库"]],
      ["中药智能药学服务", "共享中药房，中药库存、调剂、煎药、配送和追溯。", "共享中药房", "待启动", ["库存", "调剂", "煎药", "配送"]],
      ["基层缺药登记服务", "基层缺药登记、采购申请、配送到登记机构。", "药物配供中心", "建设中", ["药品登记", "采购申请", "使用管理", "统计"]],
      ["居民用药监测服务", "形成居民用药地图、用药画像和供应风险评估。", "药学中心", "建设中", ["自动采集", "用药提醒", "供应评估", "统计"]]
    ],
    "医疗管理服务协同": [
      ["检验检查结果互认服务", "医共体内检查检验结果互认、参保人查询、医保调阅。", "医技质控中心", "建设中", ["互认规则", "不互认理由", "互认监管", "统计"]],
      ["合理用药审核及药事管理", "前置审方、药师审方、处方点评和用药跟踪。", "审方中心", "建设中", ["智能审方", "药师审方", "处方点评", "知识库"]],
      ["医保业务协同服务", "医保结算、异地转诊、特殊病种和双通道申报协同。", "医保管理中心", "运行中", ["医保结算", "转诊证明", "特殊病种", "监测"]],
      ["远程医学教育", "在线直播、课程点播、疑难病案讨论和培训考核。", "医教科研中心", "待启动", ["课程", "直播", "考核", "统计"]],
      ["县域中医药适宜技术推广", "技术库、师资库、培训交流、远程指导和考核评估。", "中医药推广中心", "待启动", ["教学", "实训", "技术库", "考核"]]
    ],
    "公共卫生服务协同": [
      ["慢性病业务协同服务", "防、筛、诊、治、管全流程慢病协同管理。", "医防融合中心", "运行中", ["筛查", "分级分组", "预警", "转诊"]],
      ["老年健康业务协同服务", "预防、筛查、诊治、护理、康复、安宁疗护一体管理。", "老年健康中心", "建设中", ["自理评估", "体检", "预警", "指导"]],
      ["妇幼保健业务协同服务", "妇女儿童全生命周期健康服务与数据共享。", "妇幼保健机构", "建设中", ["孕产保健", "儿童保健", "高危管理", "统计"]],
      ["疫苗接种业务协同服务", "接种史、禁忌、异常反应和免疫规划信息共享。", "疾控中心", "建设中", ["接种查询", "禁忌评估", "异常反应", "分析"]],
      ["突发公共卫生事件应急指挥", "多渠道数据整合、智能预警、指挥调度和处置反馈。", "应急指挥中心", "运行中", ["监测", "预警", "调度", "复盘"]],
      ["基层医疗与公卫业务协同", "把预防融入临床诊治全过程，诊间建档、签约、随访。", "基层机构", "运行中", ["诊间建档", "诊间随访", "公卫提醒", "协同"]],
      ["其他卫生业务协同服务", "营养、环境、职业、放射、学校卫生等业务协同。", "公共卫生机构", "待启动", ["数据共享", "监测", "填报", "统计"]]
    ],
    "基层医疗卫生综合管理": [
      ["综合决策统一可视化展示", "医共体运营监管驾驶舱，医疗、医保、医药、公卫一图统览。", "医共体办公室", "运行中", ["驾驶舱", "预警", "资源配置", "绩效"]],
      ["人力资源统一协同管理", "组织、人员、变动、合同、岗位、薪酬和排班统筹。", "人力资源中心", "建设中", ["组织机构", "人员档案", "排班", "薪酬"]],
      ["财务统一协同管理", "统一管理、集中核算、预算执行、成本和绩效分析。", "财务审计中心", "建设中", ["集中核算", "预算", "成本", "报表"]],
      ["物资统一协同管理", "非医疗设备、办公用品分类、编码、采购、库存和调拨。", "后勤中心", "建设中", ["分类编码", "采购", "库存", "调拨"]],
      ["药品耗材统一协同管理", "药品耗材集中采购、入库、调拨、盘点、出库和追溯。", "药耗管理中心", "建设中", ["采购", "调拨", "盘点", "追溯"]],
      ["行政统一协同管理", "一体化办公、流程、公文、会议、信息发布和督办。", "行政管理中心", "待启动", ["门户", "流程", "公文", "督办"]],
      ["医共体绩效统一协同管理", "工作指标、质量、效率、服务、费用和满意度综合评价。", "绩效考核中心", "建设中", ["指标", "考核", "分配", "分析"]],
      ["医疗废弃物统一协同管理", "医废收集、暂存、交接、转运和处置全过程追溯。", "后勤安全中心", "待启动", ["追溯码", "交接", "转运", "监管"]]
    ]
  };
  let no = 1;
  return Object.entries(groups).flatMap(([domain, items]) =>
    items.map(([name, summary, owner, status, functions]) => ({
      no: no++,
      domain,
      name,
      summary,
      owner,
      status,
      functions,
      risk: status === "待启动" ? "需推进" : "正常"
    }))
  );
}
