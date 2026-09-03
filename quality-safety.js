const QUALITY_API_BASE = location.protocol === "file:" ? "" : "/api";

let qualitySafetyState = null;
let qualitySafetyInterfacePack = null;
let qualitySafetyValidationResult = null;
let qualitySafetyFilters = {
  status: "",
  domain: "",
  search: ""
};

const QUALITY_TEXT = {
  integrationContracts: "接口契约",
  qualitySafetyEvents: "质量安全事件",
  criticalValueAlerts: "危急值提醒",
  clinicalPathwayCases: "临床路径病例",
  medicalRecordQualityReviews: "病历质控复核",
  mutualRecognitionQualityReviews: "互认质控复核",
  qualityRectificationOrders: "整改工单",
  qualitySafetySiteSignoffs: "现场联调签收",
  diagnosticReports: "检查检验报告",
  countyMutualRecognitionRecords: "县域互认记录",
  hospitalInteroperabilityFunctions: "医院互联互通功能",
  personalRecords: "个人健康记录",
  creditEvaluationRules: "信用评价规则",
  integrationGatewayEvents: "接口网关事件",
  action_plan: "行动计划",
  cutover_sequence: "上线执行",
  site_signoff: "现场签收",
  cutoverSequence: "上线执行顺序",
  reviewTrail: "复核轨迹",
  auditTrail: "审计轨迹",
  feedback: "反馈",
  review: "复核",
  escalation: "升级",
  "Medical quality office": "医疗质量办公室",
  "Clinical pathway office": "临床路径办公室",
  "Community quality manager": "社区质控负责人",
  "Data quality steward": "数据质量专员",
  "Data quality issue": "数据质量问题",
  "Institution credit rectification:": "机构信用整改：",
  "Keep routine quality tracking active and review newly opened issues.": "保持常规质控跟踪，并复核新打开的问题。",
  "Follow-up result not written back to EMR.": "随访结果未回写 EMR。",
  manual_review_required: "需人工复核",
  credit_rectification: "信用整改",
  data_quality_issue: "数据质量问题",
  abnormal_value: "异常值",
  "issues, rectifications, SLA, escalation": "问题、整改、SLA、升级",
  "acknowledgement, disposition, auditTrail": "确认、处置、审计轨迹",
  "feedback, review, auditTrail": "反馈、复核、审计轨迹",
  "reviewTrail, EMR variance evidence, qualitySafetyEvents": "复核轨迹、EMR 偏离证据、质量安全事件",
  "countyMutualRecognitionRecords, diagnosticReports": "县域互认记录、检查检验报告",
  "dataQualityIssues, institutionCreditEvaluations": "数据质量问题、机构信用评价",
  "securityEvents, auditTrail": "安全事件、审计轨迹",
  controlled_pilot_ready: "受控试点就绪",
  "dashboard-scope": "看板范围",
  "dispatch-review-loop": "派发复核闭环",
  "critical-value-loop": "危急值闭环",
  "pathway-qc-loop": "临床路径质控闭环",
  "mutual-recognition-qc": "互认质控闭环",
  "risk-action-plan": "风险行动计划",
  "reuse-map": "复用能力映射",
  "joint-test:samples": "联调样例",
  "joint-test:negative-cases": "反向用例",
  "joint-test:signature-fixture": "签名样例",
  "joint-test:field-dictionaries": "字段字典",
  "Keep routine QC tracking active.": "保持常规质控跟踪。",
  "Security event:": "安全事件：",
  active: "持续跟踪",
  monthly: "按月",
  quarterly: "按季度",
  continuous: "持续监测",
  watch: "观察",
  attention_required: "需要值守关注",
  ready: "运行就绪",
  anonymous: "匿名账号",
  institutionRisks: "机构风险",
  dataAccessLogs: "数据访问日志",
  evidence: "证据",
  "risk points": "风险点",
  "Medical institution duty desk": "医疗机构值班台",
  "Quality supervision duty officer": "质控监管值守员",
  "Site integration lead": "现场接口联调负责人",
  "Security and audit administrator": "安全审计管理员",
  "Critical-value acknowledgement and disposition": "危急值确认和处置",
  "Rectification SLA and overdue escalation": "整改 SLA 和逾期升级",
  "Clinical pathway variance review": "临床路径偏差复核",
  "Mutual-recognition QC exception handling": "互认质控例外处置",
  "HIS/EMR/LIS/PACS joint-test and sign-off": "HIS/EMR/LIS/PACS 联调签收",
  "Audit retention and SIEM export evidence": "审计留存和 SIEM 导出证据",
  "acknowledge and dispose before timeout escalation": "超时升级前完成确认和处置",
  "overdue > 0 or missing feedback before due date": "存在逾期或到期前未反馈",
  "variance case remains open after review window": "路径偏差超过复核窗口仍未关闭",
  "negative-list or exception reason missing": "负面清单或例外原因缺失",
  "any production cutover sign-off missing": "任一生产切换签收缺失",
  "production audit target not configured or unsigned": "生产审计目标未配置或未签收",
  "notify department lead and commission duty officer": "通知科室负责人和卫健监管值守员",
  "issue leadership escalation and require signed correction evidence": "发起领导升级并要求签字整改证据",
  "assign pathway review and require EMR variance evidence": "派发路径复核并要求 EMR 偏差证据",
  "coordinate member institutions and submit consortium evidence": "协调成员机构并提交医共体证据",
  "freeze cutover, collect signed evidence, rerun joint-test pack": "冻结切换、收集签字证据并重跑联调包",
  "bind audit export target and archive retention sign-off": "绑定审计导出目标并归档留存签收",
  meets: "达到",
  threshold: "阈值",
  "method + path + timestamp + idempotencyKey + sha256(stable JSON body)": "请求方法 + 接口路径 + 时间戳 + 幂等键 + sha256(稳定 JSON 正文)",
  "qs-critical-value-alert-v1": "危急值提醒接入",
  "qs-clinical-pathway-variance-v1": "临床路径偏离接入",
  "qs-critical-value-disposition-v1": "危急值处置回写",
  "qs-medical-record-qc-v1": "病历质控派发",
  "qs-rectification-feedback-v1": "整改反馈回写",
  "qs-mutual-recognition-qc-v1": "互认质控接入",
  "quality_safety.critical_value_alert.v1": "质量安全-危急值提醒",
  "quality_safety.clinical_pathway_variance.v1": "质量安全-临床路径偏离",
  "quality_safety.critical_value_disposition.v1": "质量安全-危急值处置",
  "quality_safety.medical_record_qc.v1": "质量安全-病历质控",
  "quality_safety.medical_record_qc_dispatch.v1": "质量安全-病历质控派发",
  "quality_safety.rectification_feedback.v1": "质量安全-整改反馈",
  "quality_safety.mutual_recognition_qc.v1": "质量安全-互认质控",
  accepted: "已通过",
  acknowledged: "已确认",
  closed: "已关闭",
  commission: "卫健监管",
  completed: "已完成",
  complete: "完整",
  critical: "紧急",
  county: "县域医共体",
  disposed: "已处置",
  due_soon: "即将到期",
  evidence_submitted: "已提交证据",
  feedback_submitted: "已提交反馈",
  high: "高",
  in_progress: "处理中",
  institution: "医疗机构",
  low: "低",
  medium: "中",
  missing_evidence: "证据缺失",
  on_track: "按期",
  open: "待处理",
  overdue: "已逾期",
  pending: "待处理",
  pending_disposition: "待处置",
  pending_site_confirmation: "待现场确认",
  ready_for_joint_test: "具备联调条件",
  rejected: "未通过",
  returned: "已退回",
  review_passed: "复核通过",
  reviewing: "复核中",
  tracked: "已跟踪",
  unscheduled: "未排期",
  variance_open: "路径偏离待复核",
  view: "查看",
  medical_quality: "医疗质量",
  safety_event: "安全事件",
  critical_value: "危急值",
  clinical_pathway: "临床路径",
  medical_record_qc: "病历质控",
  mutual_recognition_qc: "互认质控",
  rectification: "整改闭环",
  live_interfaces: "实时接口",
  audit_retention: "审计留存",
  identity: "身份权限",
  operations: "运行运维",
  training: "培训切换",
  data_quality: "数据质量",
  institution_credit: "机构信用",
  security_audit: "安全审计",
  dataQualityIssues: "数据质量问题",
  institutionCreditEvaluations: "机构信用评价",
  securityEvents: "安全事件",
  "Regional Central Hospital": "区域中心医院",
  "Regional Medical University Hospital": "区域医科大学附属医院",
  "Qingniwaqiao Community Health Service Center": "示范社区卫生服务中心",
  "Regional mutual recognition QC": "区域互认质控",
  "Security administration": "安全管理",
  "Institution integration group": "机构接口联调组",
  "Site quality office": "现场质控办公室",
  "Critical glucose value acknowledgement overdue": "危急血糖值确认超时",
  "Hypertension pathway follow-up evidence missing": "高血压临床路径随访证据缺失",
  "Medical record quality sampling requires rectification": "病历质控抽样要求整改",
  "Clinical pathway milestone lacks follow-up assessment and medication education evidence.": "临床路径节点缺少随访评估和用药宣教证据。",
  "Hypertension standard pathway": "高血压标准路径",
  "follow-up-after-medication": "用药后随访",
  glucose: "葡萄糖",
  "critical_value_followup": "危急值随访",
  "Complete missing assessment fields and physician sign-off.": "补齐缺失评估字段并完成医师签名。",
  "Upload corrected EMR screenshots and physician sign-off.": "上传已更正 EMR 截图和医师签名。",
  "Verify critical value acknowledgement before recognition.": "互认前核验危急值确认记录。",
  "Notify responsible physician and complete disposition note.": "通知责任医师并完成处置记录。",
  "Complete acknowledgement, physician notification, disposition note, and linked event closure.": "完成危急值确认、医师通知、处置记录和关联事件关闭。",
  "Escalate overdue rectification and require leadership sign-off.": "升级逾期整改并要求负责人签收。",
  "Assign focused review and require a department correction plan.": "安排专项复核并要求科室提交整改方案。",
  "Verify recognition quality-control evidence and document whether the result can be recognized.": "核验互认质控证据并记录是否可互认。",
  "Review pathway variance, attach EMR evidence, and close or return the linked quality event.": "复核路径偏离，附加 EMR 证据，并关闭或退回关联质量事件。",
  "Start overdue escalation and require leadership sign-off.": "启动逾期升级并要求负责人签收。",
  "high-severity issue": "高严重度问题",
  "critical value or safety signal": "危急值或安全信号",
  "overdue rectification": "整改逾期",
  "feedback missing": "缺少反馈",
  "SLA due soon": "SLA 即将到期",
  "commission escalation": "监管升级",
  "Live HIS/EMR/LIS/PACS feed binding": "HIS/EMR/LIS/PACS 实时数据源绑定",
  "Production critical-value routing and timeout escalation": "生产危急值路由和超时升级",
  "Local clinical pathway dictionaries and EMR variance evidence": "本地临床路径字典和 EMR 偏离证据",
  "Regional mutual-recognition lists and negative-list rules": "区域互认清单和负面清单规则",
  "Department rectification sign-off attachments": "科室整改签收附件",
  "Production audit retention target": "生产审计留存目标",
  "signed joint-test record": "签字联调记录",
  "sample inbound payload": "入站样例报文",
  "field mapping confirmation": "字段映射确认",
  "routing rule screenshot": "路由规则截图",
  "acknowledgement receipt": "确认回执",
  "timeout escalation recipient list": "超时升级接收人清单",
  "local pathway dictionary": "本地路径字典",
  "variance rule mapping": "偏离规则映射",
  "EMR screenshot sample": "EMR 截图样例",
  "recognition catalog": "互认目录",
  "negative-list rule": "负面清单规则",
  "manual review exception sample": "人工复核例外样例",
  "department head signature": "科室负责人签名",
  "corrected EMR evidence": "已更正 EMR 证据",
  "commission review note": "监管复核意见",
  "AUDIT_EXPORT_PATH or SIEM_ENDPOINT": "AUDIT_EXPORT_PATH 或 SIEM_ENDPOINT",
  "retention period approval": "留存期限审批",
  "audit export permission": "审计导出权限",
  "Confirm live feed scope and payload signatures before production cutover.": "生产切换前确认实时数据源范围和报文签名。",
  "Pilot route is ready; production notification receipt still needs site confirmation.": "试点路由已就绪，生产通知回执仍需现场确认。",
  "Attach local pathway dictionary version and variance examples.": "补充本地路径字典版本和偏离示例。",
  "County consortium must confirm catalog and exception handling.": "县域医共体需确认目录和例外处理规则。",
  "Demo attachment placeholder exists; production requires signed department evidence.": "演示附件占位已存在，生产需科室签字证据。",
  "Production retention target remains a cutover warning until environment evidence is configured.": "配置环境证据前，生产留存目标仍为切换提示项。",
  "critical value and report quality signals": "危急值和报告质量信号",
  "mutual recognition QC": "互认质控",
  "master-data issue dispatch": "主数据问题派发",
  "institution rectification context": "机构整改上下文",
  "audit trail and high-risk event evidence": "审计轨迹和高风险事件证据",
  "HIS/EMR/LIS/PACS management boundary": "HIS/EMR/LIS/PACS 管理边界",
  "Ready for controlled pilot release; complete site joint-testing sign-offs before production cutover.": "已具备受控试点发布条件；生产切换前需完成现场联调签收。",
  "live HIS/EMR/LIS/PACS feed binding": "HIS/EMR/LIS/PACS 实时数据源绑定",
  "production critical-value routing and timeout escalation": "生产危急值路由和超时升级",
  "local clinical pathway dictionaries and EMR variance evidence": "本地临床路径字典和 EMR 偏离证据",
  "regional mutual-recognition lists and negative-list rules": "区域互认清单和负面清单规则",
  "department rectification sign-off attachments": "科室整改签收附件",
  "production audit retention target": "生产审计留存目标",
  "Clinical pathway": "临床路径",
  "Medical record QC": "病历质控",
  "Mutual recognition QC": "互认质控"
};

function zh(value) {
  const raw = value === undefined || value === null ? "" : String(value);
  if (!raw) return raw;
  if (QUALITY_TEXT[raw]) return QUALITY_TEXT[raw];
  return Object.entries(QUALITY_TEXT)
    .sort((left, right) => right[0].length - left[0].length)
    .reduce((result, [source, target]) => result.replaceAll(source, target), raw);
}

function qualityToken() {
  return window.HealthCityAuth?.getToken?.() || "";
}

async function qualityApi(pathname, options = {}) {
  const response = await fetch(`${QUALITY_API_BASE}${pathname}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(qualityToken() ? { Authorization: `Bearer ${qualityToken()}` } : {}),
      ...(options.headers || {})
    }
  });
  const body = await response.json();
  if (response.status === 401) {
    window.HealthCityAuth?.logout?.();
    throw new Error("登录已过期，请重新登录");
  }
  if (!response.ok) throw new Error(body.message || body.error || "请求失败");
  return body;
}

function text(value) {
  return value === undefined || value === null || value === "" ? "-" : String(value);
}

function zhText(value) {
  return zh(text(value));
}

function createQualityElement(tagName, options = {}, children = []) {
  const element = document.createElement(tagName);
  if (options.className) element.className = options.className;
  if (Object.prototype.hasOwnProperty.call(options, "text")) element.textContent = String(options.text ?? "");
  if (options.type) element.type = options.type;
  if (options.colSpan) element.colSpan = options.colSpan;
  Object.entries(options.dataset || {}).forEach(([key, value]) => {
    element.dataset[key] = String(value ?? "");
  });
  const childList = Array.isArray(children) ? children : [children];
  element.append(...childList.filter(Boolean));
  return element;
}

function qualityTextElement(tagName, value, options = {}) {
  return createQualityElement(tagName, { ...options, text: value });
}

function mountQualityContent(id, children) {
  const target = document.getElementById(id);
  if (!target || typeof target.replaceChildren !== "function") return null;
  const childList = Array.isArray(children) ? children : [children];
  target.replaceChildren(...childList.filter(Boolean));
  return target;
}

function qualityActionButton(label, dataset) {
  return qualityTextElement("button", label, {
    className: "inline-action",
    type: "button",
    dataset
  });
}

function qualityLine(primary, secondary, { primaryTag = "strong" } = {}) {
  const children = [qualityTextElement(primaryTag, primary)];
  if (secondary !== undefined && secondary !== null && secondary !== "") {
    children.push(createQualityElement("br"), qualityTextElement("small", secondary));
  }
  return children;
}

function qualityTable(headers, rows, emptyMessage = "") {
  const headRow = createQualityElement("tr", {}, headers.map((header) => qualityTextElement("th", header)));
  const bodyRows = rows.length
    ? rows
    : emptyMessage
      ? [createQualityEmptyRow(headers.length, emptyMessage)]
      : [];
  return createQualityElement("table", {}, [
    createQualityElement("thead", {}, headRow),
    createQualityElement("tbody", {}, bodyRows)
  ]);
}

function statusLabel(value) {
  const raw = String(value || "open");
  return zh(raw) || raw.replace(/_/g, " ");
}

function normalizeFilterText(value) {
  if (value === undefined || value === null || value === "") return "";
  return zh(String(value)).toLowerCase();
}

function createQualityEmptyRow(colspan, message = "当前筛选条件下暂无记录") {
  return createQualityElement("tr", {}, qualityTextElement("td", message, { className: "empty-cell", colSpan: colspan }));
}

function filterQualityRows(rows, accessors = {}) {
  const statusNeedle = normalizeFilterText(qualitySafetyFilters.status);
  const domainNeedle = normalizeFilterText(qualitySafetyFilters.domain);
  const searchNeedle = normalizeFilterText(qualitySafetyFilters.search);
  if (!statusNeedle && !domainNeedle && !searchNeedle) return rows;
  return rows.filter((item) => {
    const domainText = normalizeFilterText((accessors.domain?.(item) || [item.domain]).join(" "));
    const statusText = normalizeFilterText((accessors.status?.(item) || [item.normalizedStatus || item.status, item.slaStatus]).join(" "));
    const searchText = normalizeFilterText((accessors.search?.(item) || Object.values(item)).join(" "));
    return (!domainNeedle || domainText.includes(domainNeedle)) &&
      (!statusNeedle || statusText.includes(statusNeedle)) &&
      (!searchNeedle || searchText.includes(searchNeedle));
  });
}

function renderOperationsBrief(data, filtered = {}) {
  const overdueRectifications = (data.rectifications || []).filter((item) => statusLabel(item.slaStatus) === "已逾期").length;
  const openCritical = (data.criticalValueAlerts || []).filter((item) => !item.acknowledgementComplete || !item.dispositionComplete).length;
  const pendingSignoffs = (data.siteSignoffs || []).filter((item) => statusLabel(item.status) !== "具备联调条件").length;
  const highRisk = (data.institutionRisks || []).filter((item) => statusLabel(item.riskLevel) === "高").length;
  const activeFilters = [qualitySafetyFilters.status, qualitySafetyFilters.domain, qualitySafetyFilters.search].filter(Boolean).length;
  const cards = [
    ["逾期整改", overdueRectifications, "需监管升级或复核"],
    ["待处置危急值", openCritical, "确认、通知、处置闭环"],
    ["待现场签收", pendingSignoffs, "生产切换前补证"],
    ["高风险机构", highRisk, "优先纳入监管计划"],
    [
      "当前筛选命中",
      (filtered.issues || []).length + (filtered.rectifications || []).length + (filtered.siteSignoffs || []).length,
      activeFilters ? `${activeFilters} 个条件生效` : "未启用筛选"
    ]
  ];
  mountQualityContent("quality-safety-brief", cards.map(([label, value, note]) => createQualityElement("article", {}, [
    qualityTextElement("span", label),
    qualityTextElement("strong", value),
    qualityTextElement("small", note)
  ])));
}

function qualityDepartmentProfile(role) {
  const profiles = {
    commission: {
      name: "卫健监管部门",
      scope: "全域/辖区医疗质量、安全事件、整改闭环和现场签收监管",
      focus: "优先处理高风险机构、逾期整改、危急行动事项和现场签收阻断项",
      actions: ["派发问题", "复核整改", "升级逾期", "复核路径", "联调签收"]
    },
    institution: {
      name: "医疗机构",
      scope: "本机构医疗质量事件、危急值、整改反馈和现场证据",
      focus: "优先完成危急值确认处置、整改反馈、病历补证和生产证据补交",
      actions: ["提交整改反馈", "确认危急值", "处置危急值", "提交现场证据"]
    },
    county: {
      name: "县域医共体",
      scope: "医共体成员机构、互认质控、区域协同事项和现场签收材料",
      focus: "优先补齐互认清单、负面清单、例外复核证据和医共体签收材料",
      actions: ["查看互认质控", "提交医共体证据", "补充签收材料", "协同成员机构"]
    }
  };
  return profiles[role] || profiles.commission;
}

function departmentTaskMetrics(data, role) {
  const rectifications = data.rectifications || [];
  const criticalValueAlerts = data.criticalValueAlerts || [];
  const siteSignoffs = data.siteSignoffs || [];
  const mutualReviews = data.mutualRecognitionQualityReviews || [];
  const issues = data.issues || [];
  const closedSignoffStatuses = new Set(["accepted", "closed", "ready_for_joint_test", "已通过", "已关闭", "具备联调条件"]);
  const openSignoffs = siteSignoffs.filter((item) => {
    const rawStatus = String(item.normalizedStatus || item.status || "");
    return !closedSignoffStatuses.has(rawStatus) && !closedSignoffStatuses.has(statusLabel(item.status));
  });
  const roleSignoffs = openSignoffs.filter((item) => !item.ownerRole || item.ownerRole === role);
  const openIssues = issues.filter((item) => statusLabel(item.normalizedStatus || item.status) !== "已关闭").length;
  if (role === "institution") {
    return [
      ["待处置危急值", criticalValueAlerts.filter((item) => !item.acknowledgementComplete || !item.dispositionComplete).length],
      ["待反馈整改", rectifications.filter((item) => !item.feedbackComplete && statusLabel(item.normalizedStatus || item.status) !== "已关闭").length],
      ["本机构签收", roleSignoffs.length],
      ["可见问题", openIssues]
    ];
  }
  if (role === "county") {
    return [
      ["互认待复核", mutualReviews.filter((item) => statusLabel(item.normalizedStatus || item.status) !== "已关闭").length],
      ["医共体签收", roleSignoffs.length],
      ["区域整改", rectifications.filter((item) => statusLabel(item.normalizedStatus || item.status) !== "已关闭").length],
      ["可见问题", openIssues]
    ];
  }
  return [
    ["逾期整改", rectifications.filter((item) => statusLabel(item.slaStatus) === "已逾期").length],
    ["高危行动", data.summary?.criticalActionItems || 0],
    ["待复核整改", rectifications.filter((item) => statusLabel(item.normalizedStatus || item.status) === "复核中").length],
    ["待签收项", openSignoffs.length]
  ];
}

function renderDepartmentView(data) {
  const user = window.HealthCityAuth?.getUser?.() || {};
  const view = data.departmentTaskView || {};
  const role = view.role || data.role || user.role || "commission";
  const profile = view.profile || qualityDepartmentProfile(role);
  const tasks = Array.isArray(view.metrics) && view.metrics.length ? view.metrics.map((item) => [item.label, item.value]) : departmentTaskMetrics(data, role);
  const actions = profile.actions || (profile.permissions || []).map((item) => statusLabel(item));
  const roleText = view.roleName || user.roleName || profile.name;
  const orgText = view.orgName || user.orgName || profile.name;
  const scopeText = view.dataScope || user.dataScope || profile.scope;
  const queue = Array.isArray(view.queue) ? view.queue : [];
  const actionList = createQualityElement("div", { className: "quality-action-list" }, actions.map((action) => qualityTextElement("span", zhText(action))));
  const taskList = createQualityElement("div", { className: "quality-task-list" }, tasks.map(([label, value]) => createQualityElement("p", {}, [
    qualityTextElement("b", zhText(label)),
    qualityTextElement("strong", value)
  ])));
  const queueList = queue.length ? createQualityElement("div", { className: "quality-queue-list" }, queue.slice(0, 3).map((item) => createQualityElement("p", {}, [
    qualityTextElement("b", zhText(item.priority)),
    qualityTextElement("span", zhText(item.title))
  ]))) : null;
  mountQualityContent("quality-safety-department-view", [
    createQualityElement("article", { className: "primary" }, [
      qualityTextElement("span", "当前登录部门"),
      qualityTextElement("strong", zhText(roleText)),
      qualityTextElement("small", `${zhText(orgText)} · ${zhText(scopeText)}`)
    ]),
    createQualityElement("article", {}, [
      qualityTextElement("span", "数据范围"),
      qualityTextElement("strong", zhText(profile.name)),
      qualityTextElement("small", zhText(profile.scope))
    ]),
    createQualityElement("article", {}, [qualityTextElement("span", "可执行动作"), actionList]),
    createQualityElement("article", {}, [qualityTextElement("span", "重点待办"), qualityTextElement("small", zhText(profile.focus)), taskList, queueList])
  ]);
}

function renderDepartmentTaskQueue(data) {
  const rows = data.departmentTaskView?.queue || [];
  const tableRows = rows.map((item) => createQualityElement("tr", {}, [
    createQualityElement("td", {}, [qualityTextElement("span", statusLabel(item.priority)), createQualityElement("br"), qualityTextElement("small", statusLabel(item.kind))]),
    createQualityElement("td", {}, qualityLine(zhText(item.title), zhText(item.context || ""))),
    createQualityElement("td", {}, [qualityTextElement("span", zhText(item.owner)), createQualityElement("br"), qualityTextElement("small", zhText(item.source || item.id))]),
    createQualityElement("td", {}, [
      item.dueAt ? qualityTextElement("span", `截止 ${text(item.dueAt)}`) : null,
      item.dueAt ? createQualityElement("br") : null,
      qualityActionButton(zhText(item.actionLabel || "定位"), { scrollTarget: text(item.targetSection || "quality-safety-actions") })
    ])
  ]));
  mountQualityContent("quality-safety-department-queue", qualityTable(["优先级", "任务", "责任方与来源", "下一步"], tableRows, "当前部门暂无待办任务"));
}

function renderMetrics(summary) {
  const metrics = [
    ["问题总数", summary.issues],
    ["待处理", summary.open],
    ["处理中", summary.inProgress],
    ["复核中", summary.reviewing],
    ["已关闭", summary.closed],
    ["整改工单", summary.rectifications],
    ["行动事项", summary.actionItems || 0],
    ["现场签收", summary.siteSignoffs || 0],
    ["国家目标", `${summary.nationalQualityGoalsTracked || 0}/${summary.nationalQualityGoals || 0}`],
    ["采集字段", summary.nationalGoalSiteInputFields || 0],
    ["复盘节奏", summary.nationalGoalCadencePlans || 0],
    ["上线阶段", summary.cutoverSequenceSteps || 0],
    ["需关注阶段", summary.cutoverSequenceAttention || 0],
    ["开发计划", summary.nextDevelopmentItems || 0],
    ["计划关注", summary.nextDevelopmentAttention || 0],
    ["预警指标", summary.warningIndicators || 0],
    ["预警关注", summary.warningIndicatorsAttention || 0],
    ["核心制度", `${summary.coreSystemsLinked || 0}/${summary.coreSystems || 0}`],
    ["路径待复核", summary.clinicalPathwaysOpen || 0],
    ["即将到期", summary.sla?.dueSoon || 0],
    ["已逾期", summary.sla?.overdue || 0]
  ];
  mountQualityContent("quality-safety-metrics", metrics.map(([label, value]) => createQualityElement("article", { className: "metric-card" }, [
    qualityTextElement("span", label),
    qualityTextElement("strong", value)
  ])));
}

function renderNationalQualityGoals(rows) {
  const tableRows = rows.map((item) => createQualityElement("tr", {}, [
    createQualityElement("td", {}, [qualityTextElement("strong", text(item.code)), createQualityElement("br"), qualityTextElement("span", zhText(item.title)), createQualityElement("br"), qualityTextElement("small", `${statusLabel(item.currentStatus)} · ${zhText(item.cadence)}`)]),
    createQualityElement("td", {}, [qualityTextElement("span", statusLabel(item.domain)), createQualityElement("br"), qualityTextElement("small", zhText(item.strategy))]),
    createQualityElement("td", {}, [qualityTextElement("span", (item.evidenceCollections || []).map((collection) => zhText(collection)).join("、")), createQualityElement("br"), qualityTextElement("small", `${item.evidenceRows || 0} 条现有证据`)]),
    qualityTextElement("td", (item.siteInputs || []).map((input) => zhText(input)).join("、") || "-"),
    qualityTextElement("td", zhText(item.nextAction || ""))
  ]));
  mountQualityContent("quality-safety-national-goals", qualityTable(["目标", "监测重点", "平台证据源", "现场采集字段", "下一步采集边界"], tableRows, "暂无国家改进目标映射"));
}

function renderNationalGoalCadencePlan(rows) {
  const tableRows = rows.map((item) => createQualityElement("tr", {}, [
    createQualityElement("td", {}, qualityLine(zhText(item.cadenceLabel), statusLabel(item.cadenceType))),
    createQualityElement("td", {}, [qualityTextElement("span", `${item.goalCount || 0} 项`), createQualityElement("br"), qualityTextElement("small", (item.goals || []).map((goal) => text(goal.code)).join("、"))]),
    qualityTextElement("td", zhText(item.reviewWindow)),
    qualityTextElement("td", zhText(item.owner)),
    createQualityElement("td", {}, [qualityTextElement("span", `${item.evidenceRows || 0} 条证据`), createQualityElement("br"), qualityTextElement("small", `${item.siteInputFields || 0} 个采集字段`)]),
    qualityTextElement("td", zhText(item.nextAction))
  ]));
  mountQualityContent("quality-safety-national-goal-cadence", qualityTable(["复盘周期", "覆盖目标", "复盘窗口", "牵头部门", "现场准备", "下一步动作"], tableRows, "暂无国家目标复盘节奏"));
}

function renderCoreSystemMatrix(rows) {
  const tableRows = rows.map((item) => createQualityElement("tr", {}, [
    createQualityElement("td", {}, qualityLine(zhText(item.name), zhText(item.sourcePolicy))),
    createQualityElement("td", {}, [qualityTextElement("span", zhText(item.requirement)), createQualityElement("br"), qualityTextElement("small", zhText(item.platformControl))]),
    createQualityElement("td", {}, [qualityTextElement("span", (item.evidenceCollections || []).map(zh).join("、")), createQualityElement("br"), qualityTextElement("small", `${item.evidenceRows || 0} 条证据记录，${item.submittedEvidenceCount || 0} 条制度证据`)]),
    createQualityElement("td", {}, [qualityTextElement("span", zhText(item.status)), createQualityElement("br"), qualityTextElement("small", zhText(item.nextAction))]),
    createQualityElement("td", {}, qualityActionButton("提交证据", { coreSystemEvidence: text(item.id) }))
  ]));
  mountQualityContent("quality-safety-core-systems", qualityTable(["核心制度", "平台落实要求", "证据源", "状态与下一步", "操作"], tableRows, "暂无核心制度矩阵"));
}

function renderReuse(rows) {
  mountQualityContent("quality-safety-reuse", rows.map((item) => createQualityElement("div", { className: "rule-card" }, [
    qualityTextElement("strong", zhText(item.collection)),
    qualityTextElement("span", `${item.rows} 条记录`),
    qualityTextElement("p", zhText(item.reusedFor || ""))
  ])));
}

function renderRisks(rows) {
  const tableRows = rows.map((item) => createQualityElement("tr", {}, [
    createQualityElement("td", {}, qualityLine(zhText(item.institutionName), (item.domains || []).map(statusLabel).join("、"))),
    qualityTextElement("td", statusLabel(item.riskLevel)),
    qualityTextElement("td", item.score),
    createQualityElement("td", {}, [qualityTextElement("span", zhText((item.drivers || []).join("、"))), createQualityElement("br"), qualityTextElement("small", `${item.openIssues || 0} 个待处理，${item.dueSoon || 0} 个即将到期，${item.overdue || 0} 个逾期`)]),
    qualityTextElement("td", zhText(item.nextAction))
  ]));
  mountQualityContent("quality-safety-risks", qualityTable(["机构", "等级", "分值", "信号", "下一步"], tableRows));
}

function renderActionPlan(rows) {
  const tableRows = rows.map((item) => createQualityElement("tr", {}, [
    qualityTextElement("td", statusLabel(item.priority)),
    createQualityElement("td", {}, qualityLine(zhText(item.owner), `${statusLabel(item.domain)} / ${text(item.source)}`)),
    createQualityElement("td", {}, [qualityTextElement("span", zhText(item.action)), createQualityElement("br"), qualityTextElement("small", item.dueAt ? `截止 ${text(item.dueAt)}` : "")]),
    qualityTextElement("td", zhText(item.reason)),
    qualityTextElement("td", zhText(item.evidence))
  ]));
  mountQualityContent("quality-safety-actions", qualityTable(["优先级", "责任方", "行动", "原因", "证据"], tableRows));
}

function renderGoLiveReadiness(readiness = {}) {
  const checks = readiness.checks || [];
  const signoffs = readiness.productionSignoffPending || [];
  const cards = [
    [readiness.usable ? "已具备受控试点条件" : "发布候选", `${text(readiness.score)} / 100`, zhText(readiness.nextAction)],
    [statusLabel(readiness.stage), readiness.blockers?.length ? `${readiness.blockers.length} 个阻断项` : "无模块阻断项", readiness.blockers?.length ? readiness.blockers.map(statusLabel).join("、") : "看板、闭环、复用、风险和行动计划检查已具备试点使用条件。"],
    ["就绪检查", `${checks.filter((item) => item.passed).length}/${checks.length}`, checks.map((item) => `${item.passed ? "通过" : "未通过"} ${zhText(item.id)}`).join("；")],
    ["生产签收", `${signoffs.length} 个现场事项`, signoffs.map(zh).join("；")]
  ];
  mountQualityContent("quality-safety-readiness", cards.map(([heading, summary, body]) => createQualityElement("div", { className: "rule-card" }, [
    qualityTextElement("strong", heading), qualityTextElement("span", summary), qualityTextElement("p", body)
  ])));
}

function renderPrelaunchGaps(readiness = {}, siteSignoffs = []) {
  const pending = readiness.productionSignoffPending || [];
  const rows = pending.map((name) => {
    const normalized = String(name || "").toLowerCase();
    const signoff = siteSignoffs.find((item) => String(item.item || "").toLowerCase() === normalized) || {};
    return {
      name,
      owner: signoff.owner || "现场联调组",
      status: signoff.status || "pending_site_confirmation",
      evidence: signoff.requiredEvidenceText || (signoff.requiredEvidence || []).join("、") || "待补充现场证据",
      nextAction: signoff.latestNote || readiness.nextAction || "完成现场签收并归档生产证据"
    };
  });
  const tableRows = rows.map((item) => createQualityElement("tr", {}, [
    createQualityElement("td", {}, qualityTextElement("strong", zhText(item.name))),
    qualityTextElement("td", zhText(item.owner)),
    createQualityElement("td", {}, [qualityTextElement("span", statusLabel(item.status)), createQualityElement("br"), qualityTextElement("small", zhText(item.evidence))]),
    qualityTextElement("td", zhText(item.nextAction))
  ]));
  mountQualityContent("quality-safety-prelaunch-gaps", qualityTable(["上线前事项", "责任方", "证据状态", "下一步"], tableRows, "暂无上线前缺口"));
}

function renderOperationsRunbook(rows = []) {
  const tableRows = rows.map((item) => createQualityElement("tr", {}, [
    createQualityElement("td", {}, qualityLine(zhText(item.watchItem), `${statusLabel(item.domain)} / ${text(item.id)}`)),
    createQualityElement("td", {}, [qualityTextElement("span", zhText(item.owner)), createQualityElement("br"), qualityTextElement("small", statusLabel(item.ownerRole))]),
    createQualityElement("td", {}, [qualityTextElement("span", statusLabel(item.currentStatus)), createQualityElement("br"), qualityTextElement("small", zhText(item.signal))]),
    qualityTextElement("td", zhText(item.threshold)),
    createQualityElement("td", {}, [qualityTextElement("span", zhText(item.escalation)), createQualityElement("br"), qualityTextElement("small", zhText(item.evidence))])
  ]));
  mountQualityContent("quality-safety-operations-runbook", qualityTable(["值守事项", "责任方", "运行信号", "触发阈值", "升级和证据"], tableRows, "暂无运行值守事项"));
}

function renderWarningIndicators(rows = []) {
  const tableRows = rows.map((item) => createQualityElement("tr", {}, [
    createQualityElement("td", {}, qualityLine(zhText(item.name), `${statusLabel(item.domain)} / ${text(item.id)}`)),
    createQualityElement("td", {}, [qualityTextElement("span", statusLabel(item.level)), createQualityElement("br"), qualityTextElement("small", zhText(item.signal || item.currentStatus))]),
    qualityTextElement("td", zhText(item.threshold)),
    createQualityElement("td", {}, [qualityTextElement("span", zhText(item.owner)), createQualityElement("br"), qualityTextElement("small", statusLabel(item.ownerRole))]),
    createQualityElement("td", {}, [qualityTextElement("span", zhText(item.nextAction)), createQualityElement("br"), qualityTextElement("small", `${zhText(item.evidence)} / ${item.closedLoopReady ? "闭环证据已绑定" : "待补齐闭环证据"}`)]),
    createQualityElement("td", {}, qualityActionButton("定位", { scrollTarget: text(item.targetSection || "quality-safety-actions") }))
  ]));
  mountQualityContent("quality-safety-warning-indicators", qualityTable(["预警指标", "等级与信号", "触发阈值", "责任方", "闭环动作", "定位"], tableRows, "暂无预警指标"));
}

function renderOnsiteRequirements(rows = []) {
  const tableRows = rows.map((item) => createQualityElement("tr", {}, [
    createQualityElement("td", {}, qualityLine(zhText(item.requirement), `${statusLabel(item.domain)} / ${text(item.id)}`)),
    createQualityElement("td", {}, [qualityTextElement("span", zhText(item.owner)), createQualityElement("br"), qualityTextElement("small", statusLabel(item.ownerRole))]),
    qualityTextElement("td", zhText(item.onsiteInput)),
    qualityTextElement("td", zhText(item.acceptanceEvidence)),
    createQualityElement("td", {}, [qualityTextElement("span", statusLabel(item.currentStatus)), createQualityElement("br"), qualityTextElement("small", zhText(item.source))])
  ]));
  mountQualityContent("quality-safety-onsite-requirements", qualityTable(["现场功能需求", "责任方", "现场输入", "验收证据", "状态和来源"], tableRows, "暂无现场上线需求"));
}

function renderCutoverSequence(rows = []) {
  const tableRows = rows.map((item) => createQualityElement("tr", {}, [
    createQualityElement("td", {}, qualityLine(zhText(item.phase), text(item.id))),
    qualityTextElement("td", zhText(item.window)),
    qualityTextElement("td", (item.owners || []).map(zhText).join("、") || "-"),
    createQualityElement("td", {}, [qualityTextElement("span", zhText(item.objective)), createQualityElement("br"), qualityTextElement("small", (item.requirements || []).map((requirement) => zhText(requirement.requirement)).join("；"))]),
    qualityTextElement("td", zhText(item.acceptanceGate)),
    createQualityElement("td", {}, [qualityTextElement("span", statusLabel(item.currentStatus)), createQualityElement("br"), qualityTextElement("small", `${item.readyCount || 0}/${item.totalCount || 0} 已就绪`)])
  ]));
  mountQualityContent("quality-safety-cutover-sequence", qualityTable(["阶段", "时间窗口", "责任方", "现场动作", "验收门槛", "状态"], tableRows, "暂无上线执行顺序"));
}

function renderNextDevelopmentPlan(rows = []) {
  const tableRows = rows.map((item) => createQualityElement("tr", {}, [
    qualityTextElement("td", statusLabel(item.priority)),
    createQualityElement("td", {}, qualityLine(zhText(item.phase), text(item.id))),
    createQualityElement("td", {}, [qualityTextElement("span", zhText(item.owner)), createQualityElement("br"), qualityTextElement("small", zhText(item.source))]),
    createQualityElement("td", {}, [qualityTextElement("span", zhText(item.developmentIncrement)), createQualityElement("br"), qualityTextElement("small", zhText(item.currentGap || item.scope))]),
    qualityTextElement("td", zhText(item.acceptanceEvidence)),
    createQualityElement("td", {}, qualityTextElement("code", text(item.verificationCommand))),
    createQualityElement("td", {}, [qualityTextElement("span", statusLabel(item.status)), createQualityElement("br"), qualityTextElement("small", item.requiresAttention ? "需要现场推进" : "可进入联调")])
  ]));
  mountQualityContent("quality-safety-next-development", qualityTable(["优先级", "阶段", "责任方", "开发增量", "验收证据", "验证命令", "状态"], tableRows, "暂无下一步开发计划"));
}

function renderIssues(rows) {
  const canDispatch = qualitySafetyState?.role === "commission";
  const tableRows = rows.map((item) => createQualityElement("tr", {}, [
    qualityTextElement("td", statusLabel(item.domain)),
    createQualityElement("td", {}, qualityLine(zhText(item.title), `${zhText(item.sourceCollection)} ${text(item.sourceId)}`)),
    qualityTextElement("td", statusLabel(item.normalizedStatus || item.status)),
    qualityTextElement("td", zhText(item.owner || item.institutionName)),
    createQualityElement("td", {}, canDispatch ? qualityActionButton("派发", { dispatch: item.id }) : qualityTextElement("span", statusLabel(item.ownerRole || "view")))
  ]));
  mountQualityContent("quality-safety-issues", qualityTable(["领域", "问题", "状态", "责任方", "操作"], tableRows, "当前筛选条件下暂无记录"));
}

function renderSiteSignoffs(rows) {
  const role = qualitySafetyState?.role || "";
  const canReview = qualitySafetyState?.role === "commission";
  const canSubmit = (item) => role === "commission" || item.ownerRole === role;
  const tableRows = rows.map((item) => {
    const actions = [];
    if (canSubmit(item)) actions.push(qualityActionButton("提交证据", { signoffEvidence: item.id }));
    if (canReview) actions.push(qualityActionButton("记录联调", { signoffReview: item.id }));
    if (!actions.length) actions.push(qualityTextElement("span", statusLabel("view")));
    return createQualityElement("tr", {}, [
      createQualityElement("td", {}, qualityLine(zhText(item.item), `${statusLabel(item.domain)} / ${(item.sourceCollections || []).map(zh).join("、")}`)),
      createQualityElement("td", {}, [qualityTextElement("span", zhText(item.owner)), createQualityElement("br"), qualityTextElement("small", statusLabel(item.ownerRole))]),
      createQualityElement("td", {}, [qualityTextElement("span", statusLabel(item.status)), createQualityElement("br"), qualityTextElement("small", `截止 ${text(item.dueAt)}`)]),
      createQualityElement("td", {}, [qualityTextElement("span", zhText(item.requiredEvidenceText)), createQualityElement("br"), qualityTextElement("small", `${item.evidenceCount || 0} 项证据，${item.auditCount || 0} 条审计`)]),
      createQualityElement("td", {}, actions)
    ]);
  });
  mountQualityContent("quality-safety-signoffs", qualityTable(["事项", "责任方", "状态", "证据", "操作"], tableRows, "当前筛选条件下暂无记录"));
}

function renderInterfaceJointTestPack(pack, validationResult = null) {
  if (!pack) return;
  const sampleRows = pack.sampleRequests || [];
  const acceptanceRows = pack.siteSampleAcceptance || [];
  const resultText = validationResult ? `${statusLabel(validationResult.status)}：${validationResult.errors?.map((item) => item.code).join("、") || "已通过"}` : "尚未手动校验";
  const rules = createQualityElement("div", { className: "rules" }, [
    createQualityElement("div", { className: "rule-card" }, [
      qualityTextElement("strong", pack.ok ? "联调包已就绪" : "联调包需复核"),
      qualityTextElement("span", `${pack.summary.sampleAccepted}/${pack.summary.sampleRequests} 个样例通过`),
      qualityTextElement("p", (pack.checks || []).map((item) => `${item.passed ? "通过" : "未通过"} ${zhText(item.id)}`).join("；"))
    ]),
    createQualityElement("div", { className: "rule-card" }, [
      qualityTextElement("strong", pack.securityFixture.algorithm),
      qualityTextElement("span", pack.securityFixture.demoSecretName),
      qualityTextElement("p", zhText(pack.securityFixture.signatureBase))
    ]),
    createQualityElement("div", { className: "rule-card" }, [
      qualityTextElement("strong", "最近校验"),
      qualityTextElement("span", validationResult?.ok ? "已通过" : validationResult ? "未通过" : "待校验"),
      qualityTextElement("p", resultText)
    ])
  ]);
  const sampleTableRows = sampleRows.map((item) => createQualityElement("tr", {}, [
    createQualityElement("td", {}, qualityLine(zhText(item.interfaceId), zhText(item.message?.eventType))),
    qualityTextElement("td", `${text(item.method)} ${text(item.path)}`),
    qualityTextElement("td", text(item.headers?.["X-Idempotency-Key"])),
    qualityTextElement("td", `${text(item.bodySha256).slice(0, 16)}...`),
    createQualityElement("td", {}, qualityActionButton("校验样例", { interfaceValidate: item.interfaceId }))
  ]));
  const acceptanceTableRows = acceptanceRows.map((item) => createQualityElement("tr", {}, [
    createQualityElement("td", {}, qualityLine(zhText(item.interfaceId), `${zhText(item.eventType)} / ${text(item.sampleMessageId)}`)),
    createQualityElement("td", {}, [qualityTextElement("span", zhText(item.owner)), createQualityElement("br"), qualityTextElement("small", zhText(item.targetCollection))]),
    qualityTextElement("td", (item.siteInputs || []).map(zhText).join("、")),
    createQualityElement("td", {}, [qualityTextElement("span", (item.acceptanceEvidence || []).map(zhText).join("、")), createQualityElement("br"), qualityTextElement("small", `${text(item.bodySha256).slice(0, 16)}...`)]),
    createQualityElement("td", {}, qualityTextElement("code", text(item.verificationCommand))),
    createQualityElement("td", {}, [qualityTextElement("span", statusLabel(item.status)), createQualityElement("br"), qualityTextElement("small", zhText(item.validationStatus))])
  ]));
  mountQualityContent("quality-safety-interface-pack", [
    rules,
    qualityTable(["接口", "路径", "幂等键", "正文哈希", "操作"], sampleTableRows),
    qualityTable(["现场样例", "责任系统", "现场输入", "验收证据", "验证命令", "状态"], acceptanceTableRows, "暂无现场样例验收")
  ]);
}

function renderRectifications(rows) {
  const role = qualitySafetyState?.role || "";
  const canReview = role === "commission";
  const canFeedback = ["institution", "county", "commission"].includes(role);
  const canEscalate = role === "commission";
  const tableRows = rows.map((item) => {
    const actions = [];
    if (canFeedback) actions.push(qualityActionButton("反馈", { feedback: item.id }));
    if (canReview) actions.push(qualityActionButton("复核", { review: item.id }));
    if (canEscalate && item.normalizedStatus !== "closed") actions.push(qualityActionButton("升级", { escalate: item.id }));
    return createQualityElement("tr", {}, [
      createQualityElement("td", {}, qualityLine(item.id, zhText(item.institutionName))),
      qualityTextElement("td", zhText(item.requirement)),
      qualityTextElement("td", statusLabel(item.normalizedStatus || item.status)),
      createQualityElement("td", {}, [qualityTextElement("span", statusLabel(item.slaStatus)), createQualityElement("br"), qualityTextElement("small", item.daysRemaining === null ? "-" : `${item.daysRemaining} 天`)]),
      createQualityElement("td", {}, [qualityTextElement("span", item.evidenceComplete ? "完整" : "待补充"), createQualityElement("br"), qualityTextElement("small", `${(item.feedback || []).length} 条反馈`)]),
      createQualityElement("td", {}, actions)
    ]);
  });
  mountQualityContent("quality-safety-rectifications", qualityTable(["工单", "整改要求", "状态", "SLA", "证据", "操作"], tableRows, "当前筛选条件下暂无记录"));
}

function renderCritical(rows) {
  const canHandleCritical = ["institution", "commission"].includes(qualitySafetyState?.role || "");
  mountQualityContent("quality-safety-critical", rows.map((item) => createQualityElement("div", { className: "rule-card" }, [
    qualityTextElement("strong", `${zhText(item.item)} ${text(item.value)}`),
    qualityTextElement("span", statusLabel(item.status)),
    qualityTextElement("p", zhText(item.action)),
    qualityTextElement("small", `${item.acknowledgementComplete ? "已确认" : "待确认"} / ${item.dispositionComplete ? "已处置" : "待处置"}`),
    canHandleCritical && !item.acknowledgementComplete ? qualityActionButton("确认", { criticalAck: item.id }) : null,
    canHandleCritical && item.acknowledgementComplete && !item.dispositionComplete ? qualityActionButton("处置", { criticalDispose: item.id }) : null
  ])));
}

function renderBoundaries(data) {
  const canReviewPathway = qualitySafetyState?.role === "commission";
  const rows = [
    ...(data.clinicalPathwayCases || []).map((item) => ({ id: item.id, type: "Clinical pathway", name: item.pathwayName, status: item.normalizedStatus || item.status, next: item.varianceReason || item.currentNode, reviewable: item.normalizedStatus !== "closed" })),
    ...(data.medicalRecordQualityReviews || []).map((item) => ({ id: item.id, type: "Medical record QC", name: item.sampleNo, status: item.status, next: item.nextAction })),
    ...(data.mutualRecognitionQualityReviews || []).map((item) => ({ id: item.id, type: "Mutual recognition QC", name: item.item, status: item.status, next: item.nextAction }))
  ];
  const tableRows = rows.map((item) => createQualityElement("tr", {}, [
    qualityTextElement("td", zh(item.type)),
    qualityTextElement("td", zhText(item.name)),
    qualityTextElement("td", statusLabel(item.status)),
    qualityTextElement("td", zhText(item.next)),
    createQualityElement("td", {}, canReviewPathway && item.reviewable ? qualityActionButton("复核路径", { pathwayReview: item.id }) : qualityTextElement("span", statusLabel(item.type === "Clinical pathway" ? "tracked" : "view")))
  ]));
  mountQualityContent("quality-safety-boundaries", qualityTable(["边界", "名称", "状态", "下一步", "操作"], tableRows));
}

function renderQualitySafety(data) {
  qualitySafetyState = data;
  const filteredIssues = filterQualityRows(data.issues || [], {
    domain: (item) => [item.domain],
    status: (item) => [item.normalizedStatus || item.status],
    search: (item) => [item.title, item.owner, item.institutionName, item.sourceCollection, item.sourceId]
  });
  const filteredSignoffs = filterQualityRows(data.siteSignoffs || [], {
    domain: (item) => [item.domain, ...(item.sourceCollections || [])],
    status: (item) => [item.status, item.ownerRole],
    search: (item) => [item.item, item.owner, item.requiredEvidenceText, ...(item.sourceCollections || [])]
  });
  const filteredRectifications = filterQualityRows(data.rectifications || [], {
    domain: (item) => [item.domain, "整改闭环"],
    status: (item) => [item.normalizedStatus || item.status, item.slaStatus],
    search: (item) => [item.id, item.institutionName, item.requirement, item.slaStatus]
  });
  renderMetrics(data.summary || {});
  renderOperationsBrief(data, {
    issues: filteredIssues,
    rectifications: filteredRectifications,
    siteSignoffs: filteredSignoffs
  });
  renderDepartmentView(data);
  renderDepartmentTaskQueue(data);
  renderNationalQualityGoals(data.nationalQualityGoals || []);
  renderNationalGoalCadencePlan(data.nationalGoalCadencePlan || []);
  renderCoreSystemMatrix(data.coreSystemMatrix || []);
  renderGoLiveReadiness(data.goLiveReadiness || {});
  renderPrelaunchGaps(data.goLiveReadiness || {}, data.siteSignoffs || []);
  renderCutoverSequence(data.cutoverSequence || []);
  renderNextDevelopmentPlan(data.nextDevelopmentPlan || []);
  renderOnsiteRequirements(data.onsiteRequirements || []);
  renderOperationsRunbook(data.operationsRunbook || []);
  renderWarningIndicators(data.warningIndicators || []);
  renderActionPlan(data.actionPlan || []);
  renderRisks(data.institutionRisks || []);
  renderReuse(data.reusedCollections || []);
  renderSiteSignoffs(filteredSignoffs);
  renderIssues(filteredIssues);
  renderRectifications(filteredRectifications);
  renderCritical(data.criticalValueAlerts || []);
  renderBloodCoordination(data.bloodCoordination || {});
  renderBoundaries(data);
  const updated = document.getElementById("quality-safety-updated");
  if (updated) updated.textContent = data.generatedAt ? new Date(data.generatedAt).toLocaleString() : "";
}

function renderBloodCoordination(coordination = {}) {
  const target = document.querySelector("#quality-safety-blood-coordination");
  if (!target) return;
  const summary = coordination.summary || {};
  const projections = coordination.projections || [];
  target.replaceChildren();
  const lead = document.createElement("p");
  lead.textContent = `事件 ${summary.events || 0}，质控投影 ${projections.length}，死信 ${summary.deadLetters || 0}`;
  target.append(lead);
  projections.slice(0, 6).forEach((item) => {
    const row = document.createElement("div");
    row.className = "rule-item";
    row.textContent = `${item.eventType || "blood.event"} / ${item.severity || "info"} / ${item.workflow || "dispatch-rectify-review"}`;
    target.append(row);
  });
}

async function loadQualitySafety() {
  try {
    renderQualitySafety(await qualityApi("/quality-safety/dashboard"));
  } catch (error) {
    mountQualityContent("quality-safety-issues", qualityTextElement("p", error.message));
  }
}

async function loadQualitySafetyInterfacePack() {
  try {
    qualitySafetyInterfacePack = await qualityApi("/quality-safety/interface-joint-test-pack");
    renderInterfaceJointTestPack(qualitySafetyInterfacePack, qualitySafetyValidationResult);
  } catch (error) {
    mountQualityContent("quality-safety-interface-pack", qualityTextElement("p", error.message));
  }
}

async function dispatchIssue(issueId) {
  await qualityApi(`/quality-safety/issues/${encodeURIComponent(issueId)}/dispatch`, {
    method: "POST",
    body: JSON.stringify({
      ownerRole: "institution",
      owner: "现场质控办公室",
      requirement: "完成根因分析、整改证据和科室签收。"
    })
  });
  await loadQualitySafety();
}

async function submitFeedback(orderId) {
  await qualityApi(`/quality-safety/rectifications/${encodeURIComponent(orderId)}/feedback`, {
    method: "POST",
    body: JSON.stringify({
      content: "通过质量安全监管平台提交演示反馈。",
      attachments: ["site-evidence-placeholder"]
    })
  });
  await loadQualitySafety();
}

async function reviewOrder(orderId) {
  await qualityApi(`/quality-safety/rectifications/${encodeURIComponent(orderId)}/review`, {
    method: "POST",
    body: JSON.stringify({
      decision: "approved",
      comment: "反馈证据核验后通过演示复核。"
    })
  });
  await loadQualitySafety();
}

async function escalateOrder(orderId) {
  await qualityApi(`/quality-safety/rectifications/${encodeURIComponent(orderId)}/escalate`, {
    method: "POST",
    body: JSON.stringify({
      reason: "通过质量安全监管平台手动升级。"
    })
  });
  await loadQualitySafety();
}

async function acknowledgeCritical(alertId) {
  await qualityApi(`/quality-safety/critical-values/${encodeURIComponent(alertId)}/acknowledge`, {
    method: "POST",
    body: JSON.stringify({
      note: "通过质量安全监管平台确认危急值。"
    })
  });
  await loadQualitySafety();
}

async function disposeCritical(alertId) {
  await qualityApi(`/quality-safety/critical-values/${encodeURIComponent(alertId)}/dispose`, {
    method: "POST",
    body: JSON.stringify({
      action: "已通知责任医师；源系统已完成处置记录。",
      outcome: "disposed"
    })
  });
  await loadQualitySafety();
}

async function reviewClinicalPathway(caseId) {
  await qualityApi(`/quality-safety/clinical-pathways/${encodeURIComponent(caseId)}/review`, {
    method: "POST",
    body: JSON.stringify({
      decision: "approved",
      comment: "通过质量安全监管平台复核并关闭临床路径偏离。",
      evidence: ["emr-follow-up-note"]
    })
  });
  await loadQualitySafety();
}

async function reviewSiteSignoff(signoffId) {
  await qualityApi(`/quality-safety/site-signoffs/${encodeURIComponent(signoffId)}/review`, {
    method: "POST",
    body: JSON.stringify({
      decision: "ready_for_joint_test",
      note: "通过质量安全监管平台记录联调证据。",
      evidence: ["site-joint-test-note"]
    })
  });
  await loadQualitySafety();
}

async function submitSiteSignoffEvidence(signoffId) {
  await qualityApi(`/quality-safety/site-signoffs/${encodeURIComponent(signoffId)}/evidence`, {
    method: "POST",
    body: JSON.stringify({
      note: "通过质量安全监管平台提交现场联调证据。",
      evidence: ["site-joint-test-evidence"]
    })
  });
  await loadQualitySafety();
}

async function submitCoreSystemEvidence(coreSystemId) {
  await qualityApi(`/quality-safety/core-systems/${encodeURIComponent(coreSystemId)}/evidence`, {
    method: "POST",
    body: JSON.stringify({
      note: "通过质量安全监管平台提交核心制度落实证据。",
      evidence: ["core-system-evidence-placeholder"]
    })
  });
  await loadQualitySafety();
}

async function validateInterfaceSample(interfaceId) {
  const request = (qualitySafetyInterfacePack?.sampleRequests || []).find((item) => item.interfaceId === interfaceId);
  if (!request) throw new Error("接口样例尚未加载");
  qualitySafetyValidationResult = await qualityApi("/quality-safety/interface-messages/validate", {
    method: "POST",
    body: JSON.stringify({
      interfaceId: request.interfaceId,
      method: request.method,
      path: request.path,
      headers: request.headers,
      message: request.message
    })
  });
  await loadQualitySafetyInterfacePack();
}

function readQualitySafetyFilters() {
  qualitySafetyFilters = {
    status: document.getElementById("quality-safety-status-filter")?.value || "",
    domain: document.getElementById("quality-safety-domain-filter")?.value || "",
    search: document.getElementById("quality-safety-search")?.value.trim() || ""
  };
}

function applyQualitySafetyFilters() {
  readQualitySafetyFilters();
  if (qualitySafetyState) renderQualitySafety(qualitySafetyState);
}

function resetQualitySafetyFilters() {
  const status = document.getElementById("quality-safety-status-filter");
  const domain = document.getElementById("quality-safety-domain-filter");
  const search = document.getElementById("quality-safety-search");
  if (status) status.value = "";
  if (domain) domain.value = "";
  if (search) search.value = "";
  applyQualitySafetyFilters();
}

document.addEventListener("click", (event) => {
  const reset = event.target.closest("#quality-safety-reset");
  const refresh = event.target.closest("#quality-safety-refresh");
  const scrollTarget = event.target.closest("[data-scroll-target]");
  const dispatch = event.target.closest("[data-dispatch]");
  const feedback = event.target.closest("[data-feedback]");
  const review = event.target.closest("[data-review]");
  const escalate = event.target.closest("[data-escalate]");
  const criticalAck = event.target.closest("[data-critical-ack]");
  const criticalDispose = event.target.closest("[data-critical-dispose]");
  const pathwayReview = event.target.closest("[data-pathway-review]");
  const signoffReview = event.target.closest("[data-signoff-review]");
  const signoffEvidence = event.target.closest("[data-signoff-evidence]");
  const coreSystemEvidence = event.target.closest("[data-core-system-evidence]");
  const interfaceValidate = event.target.closest("[data-interface-validate]");
  if (scrollTarget) {
    const target = document.getElementById(scrollTarget.dataset.scrollTarget || "");
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if (reset) resetQualitySafetyFilters();
  if (refresh) {
    Promise.all([loadQualitySafety(), loadQualitySafetyInterfacePack()]).catch((error) => alert(error.message));
  }
  if (dispatch) dispatchIssue(dispatch.dataset.dispatch).catch((error) => alert(error.message));
  if (feedback) submitFeedback(feedback.dataset.feedback).catch((error) => alert(error.message));
  if (review) reviewOrder(review.dataset.review).catch((error) => alert(error.message));
  if (escalate) escalateOrder(escalate.dataset.escalate).catch((error) => alert(error.message));
  if (criticalAck) acknowledgeCritical(criticalAck.dataset.criticalAck).catch((error) => alert(error.message));
  if (criticalDispose) disposeCritical(criticalDispose.dataset.criticalDispose).catch((error) => alert(error.message));
  if (pathwayReview) reviewClinicalPathway(pathwayReview.dataset.pathwayReview).catch((error) => alert(error.message));
  if (signoffEvidence) submitSiteSignoffEvidence(signoffEvidence.dataset.signoffEvidence).catch((error) => alert(error.message));
  if (signoffReview) reviewSiteSignoff(signoffReview.dataset.signoffReview).catch((error) => alert(error.message));
  if (coreSystemEvidence) submitCoreSystemEvidence(coreSystemEvidence.dataset.coreSystemEvidence).catch((error) => alert(error.message));
  if (interfaceValidate) validateInterfaceSample(interfaceValidate.dataset.interfaceValidate).catch((error) => alert(error.message));
});

document.addEventListener("input", (event) => {
  if (event.target.closest("#quality-safety-search")) applyQualitySafetyFilters();
});

document.addEventListener("change", (event) => {
  if (event.target.closest("#quality-safety-status-filter, #quality-safety-domain-filter")) applyQualitySafetyFilters();
});

loadQualitySafety();
loadQualitySafetyInterfacePack();
