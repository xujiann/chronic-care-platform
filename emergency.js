const EMERGENCY_API = location.protocol === "file:" ? "" : "/api/emergency";
const FLOW_LABELS = { accepted:"已受理", dispatched:"已派车", departed:"车辆出发", "arrived-scene":"到达现场", "patient-contact":"接触患者", transporting:"转运中", "hospital-confirmed":"医院已接收", "arrived-hospital":"已到院", "handover-completed":"交接完成", closed:"质控关闭" };
let emergencyDashboard;
let emergencyProductionCenter;
let emergencyEvidencePackage;
let emergencyAedMap;

function emergencySafeUrlPort() {
  if (!window.HealthBrowserSafeUrl) throw Object.assign(new Error("browser safe URL policy is unavailable"), { code: "SAFE_URL_POLICY_UNAVAILABLE" });
  return window.HealthBrowserSafeUrl;
}

function openEmergencyTelephone(target) {
  return emergencySafeUrlPort().navigate(target, {
    capability: "tel",
    allowedPhoneNumbers: ["120"],
    mode: "assign"
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  ["emergency-call-form","emergency-sos-form","dispatch-form","vehicle-form","clinical-form","hospital-form","handover-form"].forEach((id) => document.querySelector(`#${id}`)?.addEventListener("submit", submitForm));
  document.querySelector("#aed-map-form")?.addEventListener("submit", loadAedMap);
  ["endpoint-probe-form","drill-complete-form","requirement-evidence-form","requirement-verify-form","quality-validate-form","quality-resolve-form","alert-action-form","cutover-approval-form","handoff-accept-form","command-brief-form","observation-record-form","launch-incident-form","incident-resolve-form"].forEach((id)=>document.querySelector(`#${id}`)?.addEventListener("submit",submitProductionForm));
  document.querySelector("#emergency-events")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-evidence-event]");
    if (button) await loadEvidencePackage(button.dataset.evidenceEvent);
  });
  document.querySelector("#emergency-evidence-package")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-evidence-export]");
    if (button) await downloadEvidencePackage(button.dataset.evidenceExport, button.dataset.evidenceFormat || "json");
  });
  await loadDashboard();
  await loadAedMap();
  await loadProductionCenter();
});

async function request(path, options = {}) {
  const authFetch = window.HealthCityAuth?.authFetch || fetch;
  const response = await authFetch(`${EMERGENCY_API}${path}`, { headers:{ "Content-Type":"application/json", ...(options.headers || {}) }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || "操作失败");
  return body;
}

async function loadProductionCenter(){
  if(!EMERGENCY_API)return;
  try{emergencyProductionCenter=await request("/production-center");renderProductionCenter();}
  catch(error){document.querySelector("#production-state").textContent="当前角色不可查看或服务不可用";}
}

async function submitProductionForm(event){
  event.preventDefault();const form=event.currentTarget,payload=Object.fromEntries(new FormData(form).entries()),id=payload.id;delete payload.id;
  if(form.id==="requirement-evidence-form")payload.action="submit-evidence";if(form.id==="requirement-verify-form")payload.action="verify-evidence";
  const pathByForm={"endpoint-probe-form":`/production/endpoints/${encodeURIComponent(id)}/probe`,"drill-complete-form":`/production/drills/${encodeURIComponent(id)}/complete`,"requirement-evidence-form":`/production/requirements/${encodeURIComponent(id)}/sign`,"requirement-verify-form":`/production/requirements/${encodeURIComponent(id)}/sign`,"quality-validate-form":`/production/quality/events/${encodeURIComponent(id)}/validate`,"quality-resolve-form":`/production/quality/issues/${encodeURIComponent(id)}/resolve`,"alert-action-form":`/production/alerts/${encodeURIComponent(id)}/actions`,"cutover-approval-form":`/production/approvals/${encodeURIComponent(id)}/sign`,"handoff-accept-form":`/production/handoffs/${encodeURIComponent(id)}/accept`,"command-brief-form":`/production/command-briefs/${encodeURIComponent(id)}/actions`,"observation-record-form":`/production/observations/${encodeURIComponent(id)}/record`,"launch-incident-form":"/production/incidents","incident-resolve-form":`/production/incidents/${encodeURIComponent(id)}/resolve`};
  try{await request(pathByForm[form.id],{method:"POST",body:JSON.stringify(payload)});showMessage("生产前证据已记录",false);await loadProductionCenter();}
  catch(error){showMessage(error.message,true);}
}

function renderProductionCenter(){
  const center=emergencyProductionCenter,s=center.summary;
  document.querySelector("#production-state").textContent=`${center.formalGoLiveState} · ${center.productionReady?"可提交切换审批":"禁止正式切换"}`;
  document.querySelector("#production-metrics").innerHTML=[["接口就绪",`${s.endpointsReady}/${s.endpoints}`],["消息积压",s.queuePending],["死信",s.deadLetters],["演练通过",`${s.drillsPassed}/${s.drillsTotal}`],["P0质量问题",s.openP0Quality],["关键告警",s.openCriticalAlerts],["现场签署",`${s.requirementsSigned}/${s.requirementsTotal}`],["最终审批",`${s.approvalsSigned}/${s.approvalsTotal}`],["切换阻塞",s.cutoverBlockers]].map(([label,value])=>`<article class="metric-card"><span>${label}</span><strong>${value}</strong></article>`).join("");
  document.querySelector("#production-endpoints").innerHTML=center.endpoints.map((row)=>productionRow(row.name,row.status,`${row.owner} · ${row.contract}`)).join("");
  document.querySelector("#production-queue").innerHTML=center.queue.map((row)=>productionRow(`${row.channel} · ${row.eventId}`,row.status,`attempts ${row.attempts}/${row.maxAttempts} · ${row.idempotencyKey}`)).join("")||"<p>队列为空</p>";
  document.querySelector("#production-drills").innerHTML=center.drills.map((row)=>productionRow(row.title,row.status,`${row.owner} · ${row.evidenceRef||"待提交证据"}`)).join("");
  document.querySelector("#production-requirements").innerHTML=center.requirements.map((row)=>productionRow(`${row.id} · ${row.title}`,row.status,`${row.owner} · ${row.status==="evidence-submitted"?`待独立核验 · ${row.externalOrganization||"外部机构"}`:row.evidenceRef||"现场待签"}`)).join("");
  const qualityRows=[...center.dataQuality.issues.filter((row)=>row.status!=="resolved").map((row)=>productionRow(`${row.ruleId} · ${row.eventId}`,row.severity,row.missingFields.join(", "))),...center.alerts.filter((row)=>row.status!=="resolved").map((row)=>productionRow(row.title,row.status,`${row.severity} · ${row.owner||"待认领"}`))];document.querySelector("#production-quality").innerHTML=qualityRows.join("")||productionRow("数据质量与关键告警","ready","当前无未解决P0问题");
  document.querySelector("#production-approvals").innerHTML=[...center.dutyShifts.map((row)=>productionRow(`${row.name} ${row.startsAt}-${row.endsAt}`,row.status,`${row.commandOwner} / ${row.platformOwner}`)),...center.approvals.map((row)=>productionRow(row.title,row.status,row.signedBy||"等待不同责任人签署"))].join("");
  document.querySelector("#production-handoffs").innerHTML=[...center.handoffs.map((row)=>productionRow(row.title,row.status,`${row.owner} → ${row.receiver}`)),...center.commandBriefs.map((row)=>productionRow(row.title,row.status,`${row.acknowledgements.length}/${row.expectedRecipients.length} 已确认`))].join("");
  document.querySelector("#production-observations").innerHTML=[...center.observations.map((row)=>productionRow(`观察窗口 ${row.window}`,row.status,`${row.owner} · ${row.evidenceRef||"待执行"}`)),...center.incidents.filter((row)=>row.status!=="resolved").map((row)=>productionRow(row.title,row.severity,`${row.owner} · ${row.rollbackRecommended?"建议评估回滚":"继续处置"}`)),productionRow(`回滚预案 ${center.rollbackPlan.version}`,center.rollbackPlan.status,`${center.rollbackPlan.triggers.length}项触发条件`)].join("");
  fill("endpoint-probe-select",center.endpoints,(row)=>`${row.name} · ${row.status}`);fill("drill-select",center.drills.filter((row)=>!row.productionEvidence),(row)=>row.title);fill("requirement-evidence-select",center.requirements.filter((row)=>row.status!=="signed"),(row)=>`${row.id} · ${row.title}`);fill("requirement-verify-select",center.requirements.filter((row)=>row.status==="evidence-submitted"),(row)=>`${row.id} · ${row.title}`);fill("quality-event-select",emergencyDashboard.events,(row)=>`${row.eventNo} · ${row.status}`);fill("approval-select",center.approvals.filter((row)=>row.status!=="signed"),(row)=>row.title);fill("handoff-select",center.handoffs.filter((row)=>row.status!=="accepted"),(row)=>row.title);fill("command-brief-select",center.commandBriefs,(row)=>`${row.title} · ${row.status}`);fill("observation-select",center.observations.filter((row)=>row.status==="planned"),(row)=>`${row.window} · ${row.owner}`);
  fill("quality-issue-select",center.dataQuality.issues.filter((row)=>row.status!=="resolved"),(row)=>`${row.severity} / ${row.ruleId} / ${row.eventId}`);
  fill("alert-select",center.alerts.filter((row)=>row.status!=="resolved"),(row)=>`${row.severity} / ${row.title}`);
  fill("command-recipient-select",center.commandBriefs.flatMap((row)=>row.expectedRecipients.map((recipient)=>({id:recipient,recipient,brief:row.title}))),(row)=>`${row.recipient} / ${row.brief}`);
  fill("incident-resolve-select",center.incidents.filter((row)=>row.status!=="resolved"),(row)=>`${row.severity} / ${row.title}`);
}

function productionRow(title,status,detail){return `<div class="production-row"><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></div><span class="production-status ${escapeHtml(status)}">${escapeHtml(status)}</span></div>`;}

async function loadDashboard() {
  if (EMERGENCY_API) emergencyDashboard = await request("/dashboard");
  else emergencyDashboard = staticDashboard();
  renderDashboard();
}

async function loadAedMap(event) {
  event?.preventDefault();
  const form = document.querySelector("#aed-map-form");
  const payload = form ? Object.fromEntries(new FormData(form).entries()) : { latitude:38.92, longitude:121.65 };
  try {
    const query = `?latitude=${encodeURIComponent(payload.latitude)}&longitude=${encodeURIComponent(payload.longitude)}`;
    emergencyAedMap = EMERGENCY_API ? await request(`/aed-map${query}`) : staticAedMap(payload);
    renderAedMap();
  } catch (error) {
    showMessage(error.message, true);
  }
}

function renderAedMap() {
  const node = document.querySelector("#emergency-aed-map");
  if (!node) return;
  const item = emergencyAedMap;
  if (!item?.sites?.length) {
    node.innerHTML = "<p>No AED reference is available for this location.</p>";
    return;
  }
  const nearest = item.nearestAvailable;
  node.innerHTML = [
    nearest ? `<p class="aed-highlight">Nearest available AED: <strong>${escapeHtml(nearest.name)}</strong> (${escapeHtml(nearest.distanceMeters)} m)</p>` : "<p class=\"aed-highlight aed-unavailable\">No available AED is currently listed in this search range.</p>",
    `<div class="aed-map-grid">${item.sites.map((site) => `<article class="aed-site-card ${site.availableForUse ? "available" : "unavailable"}"><h3>${escapeHtml(site.name)}</h3><p>${escapeHtml(site.distanceMeters)} m · ${escapeHtml(site.status)}</p><p>${escapeHtml(site.address)}</p><small>${escapeHtml(site.access)} · ${escapeHtml(site.guidance)}</small></article>`).join("")}</div>`,
    `<p class="aed-safety">${escapeHtml(item.safetyNote)}</p>`
  ].join("");
}

async function loadEvidencePackage(eventId) {
  if (!eventId) return;
  try {
    emergencyEvidencePackage = EMERGENCY_API ? await request(`/events/${encodeURIComponent(eventId)}/evidence-package`) : staticEvidencePackage(eventId);
    renderEvidencePackage();
  } catch (error) {
    showMessage(error.message, true);
  }
}

async function downloadEvidencePackage(eventId, format) {
  if (!EMERGENCY_API) return showMessage("Evidence export requires the platform API.", true);
  try {
    const authFetch = window.HealthCityAuth?.authFetch || fetch;
    const response = await authFetch(`${EMERGENCY_API}/events/${encodeURIComponent(eventId)}/evidence-package/export?format=${encodeURIComponent(format)}`);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message || "Evidence export failed");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    emergencySafeUrlPort().setElementUrl(link, "href", url, {
      capability: "blob-download",
      baseUrl: location.href
    });
    link.download = `${emergencyEvidencePackage?.eventNo || eventId}-evidence-package.${format === "markdown" ? "md" : "json"}`;
    link.click();
    URL.revokeObjectURL(url);
    showMessage("Evidence package exported with SHA-256 integrity digest.", false);
  } catch (error) {
    showMessage(error.message, true);
  }
}

async function submitForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form).entries());
  try {
    if (form.id === "emergency-call-form") {
      await request("/calls", { method:"POST", body:JSON.stringify(payload) });
      openEmergencyTelephone("tel:120");
    } else if (form.id === "emergency-sos-form") {
      const result = await request("/sos", { method:"POST", body:JSON.stringify(payload) });
      showMessage("Confirmed SOS submitted. Confirm the system call to reach 120.", false);
      await loadDashboard();
      await loadAedMap();
      if (result.callInstruction?.telUri) openEmergencyTelephone(result.callInstruction.telUri);
      return;
    } else {
      const eventId = payload.eventId; delete payload.eventId;
      const actionByForm = { "dispatch-form":"dispatch", "vehicle-form":"vehicle-update", "clinical-form":"clinical-update", "hospital-form":"hospital-confirm", "handover-form":"handover" };
      payload.action = actionByForm[form.id];
      await request(`/events/${encodeURIComponent(eventId)}/actions`, { method:"POST", body:JSON.stringify(payload) });
    }
    showMessage("操作已记录并同步到协同主链", false);
    await loadDashboard();
  } catch (error) { showMessage(error.message, true); }
}

function renderDashboard() {
  const s = emergencyDashboard.summary;
  document.querySelector("#emergency-metrics").innerHTML = [["进行中",s.active],["P1事件",s.p1],["可用车辆",s.availableAmbulances],["可接诊医院",s.hospitalsAvailable],["待交接",s.pendingHandover]].map(([label,value]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong></article>`).join("");
  document.querySelector("#event-count").textContent = `${emergencyDashboard.events.length}个事件`;
  document.querySelector("#emergency-events").innerHTML = emergencyDashboard.events.map(renderEvent).join("") || "<p>暂无事件</p>";
  fill("dispatch-event", emergencyDashboard.events.filter((e)=>e.status==="accepted"), (e)=>`${e.eventNo} · ${e.chiefComplaint}`);
  fill("dispatch-ambulance", emergencyDashboard.resources.filter((r)=>r.status==="available"), (r)=>`${r.callSign} · ${r.station}`);
  fill("vehicle-event", emergencyDashboard.events.filter((e)=>["dispatched","departed","arrived-scene","patient-contact","hospital-confirmed"].includes(e.status)), (e)=>`${e.eventNo} · ${FLOW_LABELS[e.status]}`);
  fill("clinical-event", emergencyDashboard.events.filter((e)=>e.mission && !["handover-completed","closed"].includes(e.status)), (e)=>e.eventNo);
  fill("hospital-event", emergencyDashboard.events.filter((e)=>e.status==="transporting"), (e)=>e.eventNo);
  fill("hospital-select", emergencyDashboard.hospitals.filter((h)=>h.emergencyStatus==="available"), (h)=>`${h.name} · ETA ${h.etaMinutes}分钟`);
  fill("handover-event", emergencyDashboard.events.filter((e)=>e.status==="arrived-hospital"), (e)=>e.eventNo);
  renderBloodCoordination(emergencyDashboard.bloodCoordination || {});
}

function renderBloodCoordination(coordination) {
  const target = document.querySelector("#emergency-blood-coordination");
  if (!target) return;
  const rows = coordination.projections || [];
  target.innerHTML = rows.length ? rows.map((item) => productionRow(`${item.eventType} / ${item.subjectId}`, item.severity, `${item.category} / ${item.workflow}`)).join("") : productionRow("区域血液保障", "pending", "尚无血液事件投影，请由血液中心发布当前态势");
}

function renderEvent(event) {
  const latestVital = event.clinical?.vitals?.at(-1);
  return `<article class="emergency-event"><header><div><h3>${escapeHtml(event.eventNo)} · ${escapeHtml(event.chiefComplaint)}</h3><p>${escapeHtml(event.location?.address)} · ${escapeHtml(event.patient?.name || "待核实")}</p></div><span class="emergency-badge">${escapeHtml(event.triageLevel)} / ${FLOW_LABELS[event.status] || event.status}</span></header>
    <p>车辆：${escapeHtml(event.mission?.ambulanceId || "待派")}　接诊：${escapeHtml(event.hospitalResponse?.hospitalId || "待确认")}　生命体征：${latestVital ? `BP ${latestVital.systolic}/${latestVital.diastolic} HR ${latestVital.heartRate} SpO₂ ${latestVital.spo2}%` : "待采集"}</p>
    <div class="emergency-timeline">${(event.timeline||[]).map((step)=>`<div class="emergency-step"><strong>${FLOW_LABELS[step.status]||step.status}</strong><br>${escapeHtml(step.actor)}<br>${new Date(step.at).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})}</div>`).join("")}</div></article>`;
}

function fill(id, rows, label) { const node=document.querySelector(`#${id}`); if(!node)return; node.innerHTML=rows.length?rows.map((row)=>`<option value="${escapeHtml(row.id)}">${escapeHtml(label(row))}</option>`).join(""):"<option value=''>暂无可处理项</option>"; }
function showMessage(text, error){const node=document.querySelector("#emergency-message");node.hidden=false;node.textContent=text;node.style.color=error?"#b91c1c":"#166534";}
function escapeHtml(value){return String(value??"").replace(/[&<>'"]/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));}
function staticDashboard(){return {summary:{total:0,active:0,p1:0,availableAmbulances:0,hospitalsAvailable:0,pendingHandover:0},events:[],resources:[],hospitals:[]};}
function staticAedMap(payload){return { origin:{latitude:Number(payload.latitude),longitude:Number(payload.longitude)}, sites:[], nearestAvailable:null, safetyNote:"AED map requires the platform API." };}

function renderEvent(event) {
  const latestVital = event.clinical?.vitals?.at(-1);
  return `<article class="emergency-event"><header><div><h3>${escapeHtml(event.eventNo)} / ${escapeHtml(event.chiefComplaint)}</h3><p>${escapeHtml(event.location?.address)} / ${escapeHtml(event.patient?.name || "pending patient")}</p></div><span class="emergency-badge">${escapeHtml(event.triageLevel)} / ${escapeHtml(FLOW_LABELS[event.status] || event.status)}</span></header>
    <p>Ambulance: ${escapeHtml(event.mission?.ambulanceId || "pending")} / Hospital: ${escapeHtml(event.hospitalResponse?.hospitalId || "pending")} / Vitals: ${latestVital ? `BP ${latestVital.systolic}/${latestVital.diastolic} HR ${latestVital.heartRate} SpO2 ${latestVital.spo2}%` : "pending"}</p>
    <button type="button" class="secondary" data-evidence-event="${escapeHtml(event.id)}">Open evidence package</button>
    <div class="emergency-timeline">${(event.timeline||[]).map((step)=>`<div class="emergency-step"><strong>${escapeHtml(FLOW_LABELS[step.status]||step.status)}</strong><br>${escapeHtml(step.actor)}<br>${new Date(step.at).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})}</div>`).join("")}</div></article>`;
}

function renderEvidencePackage() {
  const node = document.querySelector("#emergency-evidence-package");
  if (!node) return;
  const item = emergencyEvidencePackage;
  if (!item) {
    node.innerHTML = "<p>Select an emergency event to inspect its evidence package.</p>";
    return;
  }
  node.innerHTML = [
    productionRow(`${item.eventNo} / ${item.packageId}`, item.completeness.ready ? "ready" : "incomplete", `${item.completeness.complete}/${item.completeness.total} complete; missing: ${item.completeness.missing.join(", ") || "none"}`),
    `<p class="action-row"><button type="button" class="secondary" data-evidence-export="${escapeHtml(item.eventId)}" data-evidence-format="json">Download JSON</button><button type="button" class="secondary" data-evidence-export="${escapeHtml(item.eventId)}" data-evidence-format="markdown">Download Markdown</button></p>`,
    `<div class="production-list">${item.sections.map(evidenceRow).join("")}</div>`,
    `<details><summary>Timeline and audit</summary><pre>${escapeHtml(JSON.stringify({ timeline:item.timeline, audit:item.audit }, null, 2))}</pre></details>`
  ].join("");
}

function evidenceRow(section) {
  const detail = section.records.map((record) => `${record.label}: ${record.value}`).join(" / ") || "pending";
  return productionRow(section.title, section.status, detail);
}

function staticEvidencePackage(eventId){return {ok:true,packageId:`static-${eventId}`,eventId,eventNo:eventId,completeness:{total:7,complete:0,missing:["api-unavailable"],ready:false},sections:[],timeline:[],audit:[]};}
