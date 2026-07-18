const { randomUUID, createHash } = require("node:crypto");

const REQUIREMENT_CONFIRMATION = "CONFIRM EMERGENCY SITE EVIDENCE";

function timestamp() { return new Date().toISOString(); }
function text(value, max = 500) { return String(value || "").trim().slice(0, max); }
function hash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

function seed() {
  return {
    emergencyIntegrationEndpoints: [
      { id:"emg-int-cti", name:"120 CTI and recording", category:"cti", owner:"120急救中心", mode:"bidirectional", status:"configuration-required", required:true, lastProbeAt:"", latencyMs:null, contract:"call/recording/seat/acceptance", productionReady:false },
      { id:"emg-int-location", name:"Mobile location and SMS", category:"location", owner:"通信运营商", mode:"api", status:"configuration-required", required:true, lastProbeAt:"", latencyMs:null, contract:"location/confidence/sms-fallback", productionReady:false },
      { id:"emg-int-device", name:"Ambulance device gateway", category:"device", owner:"车载设备厂商", mode:"mTLS-stream", status:"configuration-required", required:true, lastProbeAt:"", latencyMs:null, contract:"vitals/ecg/device-identity", productionReady:false },
      { id:"emg-int-hospital", name:"Hospital emergency gateway", category:"hospital", owner:"试点医院", mode:"mTLS-event", status:"configuration-required", required:true, lastProbeAt:"", latencyMs:null, contract:"pre-registration/green-channel/handover/outcome", productionReady:false },
      { id:"emg-int-rhip", name:"Regional health platform", category:"regional-platform", owner:"市卫生健康信息中心", mode:"WS/T-790", status:"configuration-required", required:true, lastProbeAt:"", latencyMs:null, contract:"MPI/org/provider/document/audit", productionReady:false }
    ],
    emergencyDeliveryQueue: [
      { id:"emg-msg-demo-001", eventId:"emg-demo-001", channel:"hospital-prealert", idempotencyKey:"emg-demo-001:hospital-prealert:v1", status:"delivered", attempts:1, maxAttempts:5, createdAt:"2026-07-15T07:44:30.000Z", deliveredAt:"2026-07-15T07:45:00.000Z", lastError:"", payloadDigest:"demo" }
    ],
    emergencyDrills: [
      { id:"emg-drill-network", title:"车载弱网与断网补传", owner:"急救中心运维", scenario:"断开车载网络，离线记录节点与生命体征，恢复后按幂等键补传", status:"planned", result:"", evidenceRef:"", executedAt:"", productionEvidence:false },
      { id:"emg-drill-cti", title:"CTI故障电话降级", owner:"120调度值班长", scenario:"CTI不可用时启用备用电话、手工受理和恢复对账", status:"planned", result:"", evidenceRef:"", executedAt:"", productionEvidence:false },
      { id:"emg-drill-hospital", title:"医院接口中断降级", owner:"医院接口责任人", scenario:"医院接口中断时电话预警、纸质交接，恢复后补传归档", status:"planned", result:"", evidenceRef:"", executedAt:"", productionEvidence:false },
      { id:"emg-drill-dr", title:"数据库与消息服务灾备切换", owner:"平台运维", scenario:"主节点故障，切换灾备并验证RPO/RTO和消息不丢失", status:"planned", result:"", evidenceRef:"", executedAt:"", productionEvidence:false },
      { id:"emg-drill-security", title:"敏感数据泄露响应", owner:"安全责任部门", scenario:"模拟敏感位置和医疗数据泄露，验证阻断、取证、报告与通知", status:"planned", result:"", evidenceRef:"", executedAt:"", productionEvidence:false }
    ],
    emergencyLaunchRequirements: [
      { id:"EMG-SITE-01", title:"CTI和录音系统双向接口联调签署", owner:"120急救中心", status:"site-pending", cutoverBlocker:true, evidenceRef:"", evidenceDigest:"", externalSigner:"", externalOrganization:"", submittedBy:"", submittedAt:"", verifiedBy:"", verifiedAt:"", verificationRef:"", signedBy:"", signedAt:"", note:"" },
      { id:"EMG-SITE-02", title:"手机定位、短信和弱网降级验收", owner:"通信运营商/地图服务方", status:"site-pending", cutoverBlocker:true, evidenceRef:"", evidenceDigest:"", externalSigner:"", externalOrganization:"", submittedBy:"", submittedAt:"", verifiedBy:"", verifiedAt:"", verificationRef:"", signedBy:"", signedAt:"", note:"" },
      { id:"EMG-SITE-03", title:"真实车辆终端、监护仪和心电设备接入", owner:"急救中心车管与设备厂商", status:"site-pending", cutoverBlocker:true, evidenceRef:"", evidenceDigest:"", externalSigner:"", externalOrganization:"", submittedBy:"", submittedAt:"", verifiedBy:"", verifiedAt:"", verificationRef:"", signedBy:"", signedAt:"", note:"" },
      { id:"EMG-SITE-04", title:"急诊预建档、绿色通道和电子病历归档联调", owner:"试点医院", status:"site-pending", cutoverBlocker:true, evidenceRef:"", evidenceDigest:"", externalSigner:"", externalOrganization:"", submittedBy:"", submittedAt:"", verifiedBy:"", verifiedAt:"", verificationRef:"", signedBy:"", signedAt:"", note:"" },
      { id:"EMG-SITE-05", title:"等保定级、个保影响评估、密码和灾备验收", owner:"网信与安全责任部门", status:"site-pending", cutoverBlocker:true, evidenceRef:"", evidenceDigest:"", externalSigner:"", externalOrganization:"", submittedBy:"", submittedAt:"", verifiedBy:"", verifiedAt:"", verificationRef:"", signedBy:"", signedAt:"", note:"" },
      { id:"EMG-SITE-06", title:"区域全民健康信息平台主索引、机构人员、文档与审计联调签署", owner:"市卫生健康信息中心", status:"site-pending", cutoverBlocker:true, evidenceRef:"", evidenceDigest:"", externalSigner:"", externalOrganization:"", submittedBy:"", submittedAt:"", verifiedBy:"", verifiedAt:"", verificationRef:"", signedBy:"", signedAt:"", note:"" }
    ],
    emergencyDataQualityRules: [
      { id:"emg-dq-required", name:"急救事件核心字段完整", severity:"P0", fields:["eventNo","source","location.address","chiefComplaint","status","createdAt"], enabled:true },
      { id:"emg-dq-timeline", name:"状态与时间线一致", severity:"P0", fields:["status","timeline"], enabled:true },
      { id:"emg-dq-mission", name:"派车后任务与车辆完整", severity:"P0", fields:["mission.id","mission.ambulanceId","mission.dispatchedAt"], enabled:true },
      { id:"emg-dq-clinical", name:"转运事件具备院前病历", severity:"P1", fields:["clinical.preliminaryDiagnosis","clinical.vitals"], enabled:true },
      { id:"emg-dq-handover", name:"交接记录符合WS/T 621", severity:"P0", fields:["handover.hospitalVisitId","handover.hospitalSigner","handover.standard"], enabled:true }
    ],
    emergencyDataQualityIssues: [],
    emergencyOperationalAlerts: [
      { id:"emg-alert-demo-001", source:"delivery-queue", severity:"P2", title:"医院预警链路演示告警", status:"resolved", detectedAt:"2026-07-15T07:46:00.000Z", acknowledgedAt:"2026-07-15T07:47:00.000Z", resolvedAt:"2026-07-15T07:49:00.000Z", owner:"平台值班", note:"演示告警已闭环" }
    ],
    emergencyDutyShifts: [
      { id:"emg-duty-day", name:"上线日班", startsAt:"08:00", endsAt:"20:00", commandOwner:"120调度值班长", platformOwner:"平台运维负责人", hospitalOwner:"试点医院急诊负责人", securityOwner:"安全值班负责人", status:"roster-ready", handoverNote:"" },
      { id:"emg-duty-night", name:"上线夜班", startsAt:"20:00", endsAt:"08:00", commandOwner:"120夜班值班长", platformOwner:"平台夜间值班", hospitalOwner:"试点医院总值班", securityOwner:"安全夜间值班", status:"roster-ready", handoverNote:"" }
    ],
    emergencyCutoverApprovals: [
      { id:"emg-approval-business", lane:"business", title:"120业务切换批准", requiredRole:"commission", status:"pending", signedBy:"", signedAt:"", evidenceRef:"", note:"" },
      { id:"emg-approval-technical", lane:"technical", title:"平台技术切换批准", requiredRole:"commission", status:"pending", signedBy:"", signedAt:"", evidenceRef:"", note:"" }
    ],
    emergencyProductionHandoffs: [
      { id:"emg-handoff-command", lane:"120-command", title:"120调度生产交接", owner:"120调度值班长", receiver:"上线日班", status:"pending", checklist:["坐席和CTI状态","车辆和站点状态","未结急救事件","备用电话"], acceptedAt:"", evidenceRef:"" },
      { id:"emg-handoff-platform", lane:"platform", title:"平台与接口生产交接", owner:"平台项目负责人", receiver:"平台运维值班", status:"pending", checklist:["版本和配置清单","接口凭据引用","监控告警","回滚包"], acceptedAt:"", evidenceRef:"" },
      { id:"emg-handoff-hospital", lane:"hospital", title:"试点医院生产交接", owner:"医院项目负责人", receiver:"医院急诊总值班", status:"pending", checklist:["接诊资源状态","绿色通道联系人","HIS/EMR接口","纸质降级表单"], acceptedAt:"", evidenceRef:"" }
    ],
    emergencyLaunchCommandBriefs: [
      { id:"emg-brief-cutover", title:"急救系统正式切换指令", issuedBy:"上线总指挥", status:"draft", effectiveAt:"", message:"确认前置检查、双人审批和生产交接后执行切换", expectedRecipients:["120调度值班长","平台运维负责人","试点医院总值班","安全值班负责人"], acknowledgements:[], evidenceRef:"" }
    ],
    emergencyGoLiveObservations: [
      { id:"emg-observe-0-2h", window:"0-2h", owner:"平台与120联合值班", status:"planned", requiredMetrics:["呼叫受理","派车回执","医院预警","消息积压","错误率"], result:"", observedAt:"", evidenceRef:"" },
      { id:"emg-observe-2-8h", window:"2-8h", owner:"上线日班", status:"planned", requiredMetrics:["到场时间","生命体征上报","电子交接","接口时延"], result:"", observedAt:"", evidenceRef:"" },
      { id:"emg-observe-8-24h", window:"8-24h", owner:"上线夜班", status:"planned", requiredMetrics:["跨班交接","告警闭环","数据质量","灾备复制"], result:"", observedAt:"", evidenceRef:"" },
      { id:"emg-observe-24-72h", window:"24-72h", owner:"急救上线复盘组", status:"planned", requiredMetrics:["SLO趋势","医院反馈","质控问题","遗留风险"], result:"", observedAt:"", evidenceRef:"" }
    ],
    emergencyLaunchIncidents: [],
    emergencyRollbackPlan: { version:"emergency-rollback-v1", owner:"上线总指挥", status:"ready", triggers:["120受理主链不可用超过5分钟","调度指令无法可靠送达","P0数据泄露或越权","关键数据不可恢复","两家以上试点医院同时无法接收预警"], steps:["停止互联网辅助入口写入","切换备用电话和手工调度","冻结消息队列并保存证据","回退应用与配置版本","核对未结事件并人工补偿","经总指挥批准后恢复"], evidence:["deployment package","database backup","configuration snapshot","duty roster"] },
    emergencyProductionAudit: []
  };
}

function ensure(data) {
  const defaults = seed();
  for (const [key, value] of Object.entries(defaults)) if (!Array.isArray(data[key])) data[key] = value;
  return data;
}

function audit(data, user, action, target, detail) {
  const row = { id:randomUUID(), at:timestamp(), actor:user.name || user.username || user.id, role:user.role, action, target, detail:text(detail), digest:"" };
  row.digest = hash({ ...row, digest:undefined, previous:data.emergencyProductionAudit[0]?.digest || "GENESIS" });
  data.emergencyProductionAudit.unshift(row);
  data.emergencyProductionAudit = data.emergencyProductionAudit.slice(0, 2000);
}

function buildCenter(input) {
  const data = ensure(input);
  const endpoints = data.emergencyIntegrationEndpoints;
  const queue = data.emergencyDeliveryQueue;
  const drills = data.emergencyDrills;
  const requirements = data.emergencyLaunchRequirements;
  const qualityIssues = data.emergencyDataQualityIssues;
  const alerts = data.emergencyOperationalAlerts;
  const approvals = data.emergencyCutoverApprovals;
  const handoffs = data.emergencyProductionHandoffs;
  const briefs = data.emergencyLaunchCommandBriefs;
  const observations = data.emergencyGoLiveObservations;
  const incidents = data.emergencyLaunchIncidents;
  const blocking = requirements.filter((item)=>item.cutoverBlocker && item.status !== "signed");
  const openP0Quality = qualityIssues.filter((item)=>item.severity === "P0" && item.status !== "resolved");
  const openCriticalAlerts = alerts.filter((item)=>["P0","P1"].includes(item.severity) && item.status !== "resolved");
  const preflight = {
    endpointsReady:endpoints.filter((item)=>item.required).every((item)=>item.productionReady),
    queueHealthy:queue.every((item)=>item.status !== "dead-letter"),
    drillsPassed:drills.every((item)=>item.productionEvidence),
    requirementsSigned:blocking.length === 0,
    dataQualityReady:openP0Quality.length === 0,
    alertsClear:openCriticalAlerts.length === 0,
    dutyRosterReady:data.emergencyDutyShifts.length >= 2 && data.emergencyDutyShifts.every((item)=>item.status === "roster-ready")
  };
  preflight.productionHandoffsAccepted=handoffs.length>=3&&handoffs.every((item)=>item.status==="accepted");
  preflight.ready = Object.values(preflight).every(Boolean);
  const approvalsSigned = approvals.length >= 2 && approvals.every((item)=>item.status === "signed");
  return {
    generatedAt:timestamp(),
    functionalReady:true,
    productionReady:preflight.ready && approvalsSigned,
    formalGoLiveState:blocking.length ? "blocked-until-site-evidence-signed" : !preflight.ready ? "blocked-by-cutover-preflight" : !approvalsSigned ? "awaiting-dual-cutover-approval" : "ready-for-production",
    summary:{ endpoints:endpoints.length, endpointsReady:endpoints.filter((item)=>item.productionReady).length, queuePending:queue.filter((item)=>["queued","retrying"].includes(item.status)).length, deadLetters:queue.filter((item)=>item.status === "dead-letter").length, drillsPassed:drills.filter((item)=>item.productionEvidence).length, drillsTotal:drills.length, requirementsSigned:requirements.filter((item)=>item.status === "signed").length, requirementsTotal:requirements.length, cutoverBlockers:blocking.length, dataQualityIssues:qualityIssues.filter((item)=>item.status !== "resolved").length, openP0Quality:openP0Quality.length, openCriticalAlerts:openCriticalAlerts.length, dutyShifts:data.emergencyDutyShifts.length, approvalsSigned:approvals.filter((item)=>item.status === "signed").length, approvalsTotal:approvals.length, handoffsAccepted:handoffs.filter((item)=>item.status==="accepted").length, handoffsTotal:handoffs.length, observationPassed:observations.filter((item)=>item.status==="passed").length, observationTotal:observations.length, openLaunchIncidents:incidents.filter((item)=>item.status!=="resolved").length },
    endpoints, queue:queue.slice(0,100), drills, requirements, dataQuality:{ rules:data.emergencyDataQualityRules, issues:qualityIssues.slice(0,200) }, alerts:alerts.slice(0,200), dutyShifts:data.emergencyDutyShifts, approvals, handoffs, commandBriefs:briefs, observations, incidents:incidents.slice(0,200), rollbackPlan:data.emergencyRollbackPlan, preflight, audit:data.emergencyProductionAudit.slice(0,100),
    slo:{ apiAvailabilityTarget:"99.99%", dispatchCommandAckSeconds:3, criticalMessageMaxAgeSeconds:30, queueBacklogMax:20, rpoMinutes:0, rtoMinutes:15 }
  };
}

function acceptProductionHandoff(data,user,id,payload={}){ensure(data);const row=data.emergencyProductionHandoffs.find((item)=>item.id===id);if(!row)throw Object.assign(new Error("production handoff not found"),{status:404});if(row.status==="accepted")return row;if(!text(payload.evidenceRef)||text(payload.confirmation)!=="ACCEPT EMERGENCY PRODUCTION HANDOFF")throw new Error("exact confirmation and evidenceRef are required");row.status="accepted";row.acceptedBy=user.name;row.acceptedAt=timestamp();row.evidenceRef=text(payload.evidenceRef,300);audit(data,user,"accept-production-handoff",id,row.evidenceRef);return row;}

function applyCommandBriefAction(data,user,id,payload={}){ensure(data);const brief=data.emergencyLaunchCommandBriefs.find((item)=>item.id===id);if(!brief)throw Object.assign(new Error("command brief not found"),{status:404});const action=text(payload.action,30);if(action==="issue"){const center=buildCenter(data);if(!center.preflight.ready||!center.approvals.every((item)=>item.status==="signed"))throw new Error("cutover preflight and dual approvals must pass before issuing command");brief.status="issued";brief.effectiveAt=text(payload.effectiveAt)||timestamp();brief.evidenceRef=text(payload.evidenceRef,300);brief.issuedBy=user.name;}else if(action==="acknowledge"){const recipient=text(payload.recipient,100);if(!brief.expectedRecipients.includes(recipient))throw new Error("recipient is not expected");if(!brief.acknowledgements.some((item)=>item.recipient===recipient))brief.acknowledgements.push({recipient,at:timestamp(),actor:user.name});if(brief.acknowledgements.length===brief.expectedRecipients.length)brief.status="acknowledged";}else throw new Error("unsupported command brief action");audit(data,user,`command-brief-${action}`,id,payload.recipient||brief.effectiveAt);return brief;}

function recordObservation(data,user,id,payload={}){ensure(data);const row=data.emergencyGoLiveObservations.find((item)=>item.id===id);if(!row)throw Object.assign(new Error("observation window not found"),{status:404});if(row.status===payload.result&&row.evidenceRef===text(payload.evidenceRef,300))return row;if(!["passed","failed"].includes(payload.result)||!text(payload.evidenceRef))throw new Error("result and evidenceRef are required");row.status=payload.result;row.result=payload.result;row.observedAt=timestamp();row.observedBy=user.name;row.evidenceRef=text(payload.evidenceRef,300);row.note=text(payload.note);audit(data,user,"record-go-live-observation",id,`${row.result}; ${row.evidenceRef}`);return row;}

function createLaunchIncident(data,user,payload={}){ensure(data);if(!text(payload.title)||!["P0","P1","P2","P3"].includes(payload.severity))throw new Error("title and valid severity are required");const incident={id:randomUUID(),title:text(payload.title,200),severity:payload.severity,status:"open",owner:text(payload.owner||user.name,100),detectedAt:timestamp(),resolvedAt:"",rollbackRecommended:payload.severity==="P0",note:text(payload.note)};data.emergencyLaunchIncidents.unshift(incident);audit(data,user,"create-launch-incident",incident.id,`${incident.severity}; rollback=${incident.rollbackRecommended}`);return incident;}

function resolveLaunchIncident(data,user,id,payload={}){ensure(data);const incident=data.emergencyLaunchIncidents.find((item)=>item.id===id);if(!incident)throw Object.assign(new Error("launch incident not found"),{status:404});if(!text(payload.note)||!text(payload.evidenceRef))throw new Error("resolution note and evidenceRef are required");incident.status="resolved";incident.resolvedAt=timestamp();incident.resolvedBy=user.name;incident.note=text(payload.note);incident.evidenceRef=text(payload.evidenceRef,300);audit(data,user,"resolve-launch-incident",id,incident.evidenceRef);return incident;}

function readPath(object, dotted) { return dotted.split(".").reduce((value,key)=>value == null ? undefined : value[key],object); }
function validateEvent(data,user,eventId){
  ensure(data);const event=(data.emergencyEvents||[]).find((item)=>item.id===eventId);if(!event)throw Object.assign(new Error("emergency event not found"),{status:404});
  const issues=[];for(const rule of data.emergencyDataQualityRules.filter((item)=>item.enabled)){
    let applies=true;if(rule.id==="emg-dq-mission")applies=!(["accepted"].includes(event.status));if(rule.id==="emg-dq-clinical")applies=["transporting","hospital-confirmed","arrived-hospital","handover-completed","closed"].includes(event.status);if(rule.id==="emg-dq-handover")applies=["handover-completed","closed"].includes(event.status);if(!applies)continue;
    const missing=rule.fields.filter((field)=>{const value=readPath(event,field);return value==null||value===""||(Array.isArray(value)&&value.length===0);});
    if(rule.id==="emg-dq-timeline"&&!event.timeline?.some((item)=>item.status===event.status))missing.push("timeline.currentStatus");
    if(missing.length)issues.push({id:randomUUID(),eventId,ruleId:rule.id,severity:rule.severity,status:"open",missingFields:[...new Set(missing)],detectedAt:timestamp(),resolvedAt:""});
  }
  data.emergencyDataQualityIssues=data.emergencyDataQualityIssues.filter((item)=>item.eventId!==eventId||item.status==="resolved");data.emergencyDataQualityIssues.unshift(...issues);audit(data,user,"validate-event-quality",eventId,`${issues.length} issues`);return {eventId,passed:issues.length===0,issues};
}

function resolveDataQualityIssue(data,user,id,payload={}){ensure(data);const issue=data.emergencyDataQualityIssues.find((item)=>item.id===id);if(!issue)throw Object.assign(new Error("data quality issue not found"),{status:404});if(issue.status==="resolved")return issue;if(!text(payload.evidenceRef)||!text(payload.note))throw new Error("resolution note and evidenceRef are required");issue.status="resolved";issue.resolvedAt=timestamp();issue.resolvedBy=user.name||user.username;issue.evidenceRef=text(payload.evidenceRef,300);issue.note=text(payload.note);audit(data,user,"resolve-data-quality-issue",id,issue.evidenceRef);return issue;}

function applyAlertAction(data,user,id,payload={}){ensure(data);const alert=data.emergencyOperationalAlerts.find((item)=>item.id===id);if(!alert)throw Object.assign(new Error("alert not found"),{status:404});const action=text(payload.action,40);if(action==="acknowledge"){alert.status="acknowledged";alert.acknowledgedAt=timestamp();alert.owner=text(payload.owner||user.name,100);}else if(action==="resolve"){if(!text(payload.note))throw new Error("resolution note is required");alert.status="resolved";alert.resolvedAt=timestamp();alert.note=text(payload.note);alert.owner=text(payload.owner||user.name,100);}else throw new Error("unsupported alert action");audit(data,user,`alert-${action}`,id,alert.note||alert.owner);return alert;}

function signCutoverApproval(data,user,id,payload={}){ensure(data);const center=buildCenter(data);if(!center.preflight.ready)throw new Error("cutover preflight is not ready");const approval=data.emergencyCutoverApprovals.find((item)=>item.id===id);if(!approval)throw Object.assign(new Error("approval not found"),{status:404});if(approval.status==="signed")return approval;if(!text(payload.evidenceRef)||!text(payload.note)||text(payload.confirmation)!=="CONFIRM EMERGENCY CUTOVER APPROVAL")throw new Error("exact confirmation, evidenceRef and note are required");const other=data.emergencyCutoverApprovals.find((item)=>item.status==="signed");if(other?.signedBy===(user.name||user.username))throw new Error("business and technical approvals require different signers");approval.status="signed";approval.signedBy=user.name||user.username;approval.signedAt=timestamp();approval.evidenceRef=text(payload.evidenceRef,300);approval.note=text(payload.note);audit(data,user,"sign-cutover-approval",id,approval.evidenceRef);return approval;}

function probeEndpoint(data, user, id, payload = {}) {
  ensure(data);
  const endpoint = data.emergencyIntegrationEndpoints.find((item)=>item.id === id);
  if (!endpoint) throw Object.assign(new Error("integration endpoint not found"), { status:404 });
  const configured = Boolean(text(payload.baseUrl) && text(payload.credentialRef));
  endpoint.lastProbeAt = timestamp();
  endpoint.latencyMs = configured ? Math.max(1, Number(payload.latencyMs) || 35) : null;
  endpoint.status = configured ? "probe-passed-site-signoff-pending" : "configuration-required";
  endpoint.productionReady = false;
  endpoint.configuration = configured ? { baseUrl:text(payload.baseUrl,200), credentialRef:text(payload.credentialRef,120), certificateFingerprint:text(payload.certificateFingerprint,160) } : undefined;
  audit(data,user,"probe-endpoint",id,endpoint.status);
  return endpoint;
}

function enqueue(data, user, payload = {}) {
  ensure(data);
  const key = text(payload.idempotencyKey,160);
  if (!key) throw new Error("idempotencyKey is required");
  const existing = data.emergencyDeliveryQueue.find((item)=>item.idempotencyKey === key);
  if (existing) return { item:existing, idempotentReplay:true };
  const item = { id:randomUUID(), eventId:text(payload.eventId,100), channel:text(payload.channel,80), idempotencyKey:key, status:"queued", attempts:0, maxAttempts:Math.max(1,Math.min(10,Number(payload.maxAttempts)||5)), createdAt:timestamp(), deliveredAt:"", lastError:"", payloadDigest:hash(payload.body || {}) };
  data.emergencyDeliveryQueue.unshift(item); audit(data,user,"enqueue-delivery",item.id,key); return { item, idempotentReplay:false };
}

function retryDelivery(data, user, id, payload = {}) {
  ensure(data);
  const item = data.emergencyDeliveryQueue.find((row)=>row.id === id);
  if (!item) throw Object.assign(new Error("delivery not found"), { status:404 });
  if (item.status === "delivered") return item;
  item.attempts += 1;
  if (payload.simulateSuccess === true) { item.status="delivered"; item.deliveredAt=timestamp(); item.lastError=""; }
  else if (item.attempts >= item.maxAttempts) { item.status="dead-letter"; item.lastError=text(payload.error || "delivery failed",300); }
  else { item.status="retrying"; item.lastError=text(payload.error || "temporary failure",300); }
  audit(data,user,"retry-delivery",id,`${item.status}; attempts=${item.attempts}`); return item;
}

function completeDrill(data, user, id, payload = {}) {
  ensure(data);
  const drill = data.emergencyDrills.find((item)=>item.id === id);
  if (!drill) throw Object.assign(new Error("drill not found"), { status:404 });
  if (!text(payload.evidenceRef) || text(payload.result) !== "passed") throw new Error("passed result and evidenceRef are required");
  drill.status="passed"; drill.result="passed"; drill.evidenceRef=text(payload.evidenceRef,300); drill.executedAt=timestamp(); drill.executedBy=user.name; drill.productionEvidence=true;
  audit(data,user,"complete-drill",id,drill.evidenceRef); return drill;
}

function signRequirement(data, user, id, payload = {}) {
  ensure(data);
  const requirement = data.emergencyLaunchRequirements.find((item)=>item.id === id);
  if (!requirement) throw Object.assign(new Error("launch requirement not found"), { status:404 });
  const relatedEndpoint = data.emergencyIntegrationEndpoints.find((item)=>({"EMG-SITE-01":"cti","EMG-SITE-02":"location","EMG-SITE-03":"device","EMG-SITE-04":"hospital","EMG-SITE-06":"regional-platform"}[id] === item.category));
  const action = text(payload.action || "submit-evidence", 40);
  const actor = user.id || user.username || user.name;
  if (action === "submit-evidence") {
    if (text(payload.confirmation) !== REQUIREMENT_CONFIRMATION || !text(payload.evidenceRef) || !text(payload.note) || !text(payload.externalSigner) || !text(payload.externalOrganization) || !/^sha256:[a-f0-9]{64}$/.test(text(payload.evidenceDigest,80))) throw new Error("exact confirmation, evidence reference, SHA-256 digest, external signer, organization and note are required");
    if (relatedEndpoint && relatedEndpoint.status !== "probe-passed-site-signoff-pending") throw new Error("related endpoint probe must pass before evidence submission");
    if (requirement.status === "signed") throw new Error("a signed launch requirement cannot be replaced without a formal change record");
    Object.assign(requirement, { status:"evidence-submitted", evidenceRef:text(payload.evidenceRef,300), evidenceDigest:text(payload.evidenceDigest,80), externalSigner:text(payload.externalSigner,100), externalOrganization:text(payload.externalOrganization,160), note:text(payload.note,500), submittedBy:actor, submittedAt:timestamp(), verifiedBy:"", verifiedAt:"", verificationRef:"", signedBy:"", signedAt:"" });
    audit(data,user,"submit-launch-requirement-evidence",id,`${requirement.evidenceRef}; ${requirement.evidenceDigest}`); return requirement;
  }
  if (action === "verify-evidence") {
    if (requirement.status !== "evidence-submitted") throw new Error("external evidence must be submitted before independent verification");
    if (text(payload.confirmation) !== "VERIFY EMERGENCY SITE EVIDENCE" || !text(payload.verificationRef) || text(payload.evidenceDigest,80) !== requirement.evidenceDigest) throw new Error("exact verification confirmation, matching SHA-256 digest and verification reference are required");
    if (actor === requirement.submittedBy) throw new Error("the evidence submitter cannot independently verify the same launch requirement");
    Object.assign(requirement, { status:"signed", verifiedBy:actor, verifiedAt:timestamp(), verificationRef:text(payload.verificationRef,300), signedBy:actor, signedAt:timestamp() });
    if (relatedEndpoint) { relatedEndpoint.status="ready"; relatedEndpoint.productionReady=true; }
    audit(data,user,"verify-launch-requirement-evidence",id,`${requirement.verificationRef}; ${requirement.evidenceDigest}`); return requirement;
  }
  throw new Error("unsupported launch requirement action");
}

module.exports = { REQUIREMENT_CONFIRMATION, acceptProductionHandoff, applyAlertAction, applyCommandBriefAction, buildCenter, completeDrill, createLaunchIncident, enqueue, ensure, probeEndpoint, recordObservation, resolveDataQualityIssue, resolveLaunchIncident, retryDelivery, seed, signCutoverApproval, signRequirement, validateEvent };
