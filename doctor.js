const doctorApiBase = location.protocol === "file:" || location.hostname.endsWith("github.io") ? "" : "/api";
const doctorFallbackState = { doctorProfiles: [], multiPracticeApplications: [], multiPracticePolicy: {}, taskMessages: [], phase2ClinicalAssistRules: [], phase2ClinicalAssistAlerts: [], phase2ClinicalAssistReceipts: [], phase2ClinicalAssistPluginContracts: [] };
let doctorRuntime = { doctor: null, applications: [], messages: [], policy: {}, ledger: [], summary: {}, clinicalAssist: {} };
const doctorClinicalCommands = new Map();

document.addEventListener("DOMContentLoaded", async () => {
  doctorRuntime = await loadDoctorRuntime();
  bindDoctorForm();
  bindDoctorClinicalAssistActions();
  renderDoctorWorkbench();
});

async function loadDoctorRuntime() {
  const session = window.HealthCityAuth?.getUser?.() || {};
  if (doctorApiBase) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const [meResponse, ledgerResponse, clinicalAssistResponse] = await Promise.all([
        request(`${doctorApiBase}/doctors/me`),
        fetch(`${doctorApiBase}/public/multi-practice-ledger`),
        request(`${doctorApiBase}/phase2/clinical-assist`)
      ]);
      if (meResponse.ok) {
        const me = await meResponse.json();
        const ledger = ledgerResponse.ok ? (await ledgerResponse.json()).publicLedger || [] : [];
        const clinicalAssist = clinicalAssistResponse.ok ? await clinicalAssistResponse.json() : {};
        return {
          doctor: me.doctor,
          applications: me.multiPracticeApplications || [],
          messages: me.multiPracticeMessages || [],
          policy: me.policy || {},
          summary: me.multiPracticeSummary || {},
          clinicalAssist,
          ledger
        };
      }
    } catch (error) {
      // Static preview falls back to the bundled snapshot below.
    }
  }

  const state = await loadPlatformState(doctorFallbackState);
  const doctor = (state.doctorProfiles || []).find((item) => item.id === session.doctorId || item.username === session.username) || (state.doctorProfiles || [])[0] || {};
  const applications = (state.multiPracticeApplications || []).filter((item) => item.doctorId === doctor.id);
  const messages = (state.taskMessages || []).filter((item) => item.collection === "multiPracticeApplications" && applications.some((application) => application.id === item.sourceId));
  return {
    doctor: { ...doctor, electronicRegistrationVerification: doctor.electronicRegistration || {} },
    applications,
    messages,
    policy: state.multiPracticePolicy || {},
    summary: {
      total: applications.length,
      pending: applications.filter((item) => /待|补正|pending/i.test(String(item.status || ""))).length
    },
    clinicalAssist: buildStaticClinicalAssist(state, doctor),
    ledger: (state.multiPracticeApplications || []).filter((item) => item.publicVisible !== false)
  };
}

function bindDoctorForm() {
  const form = document.querySelector("#doctor-multi-practice-form");
  if (!form) return;
  const scopeInput = form.elements.practiceScope;
  if (scopeInput && !scopeInput.value) scopeInput.value = doctorRuntime.doctor?.practiceScope || "";
  form.addEventListener("submit", submitDoctorMultiPractice);
}

function bindDoctorClinicalAssistActions() {
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-clinical-assist-receipt]");
    if (!button) return;
    await submitDoctorClinicalAssistReceipt(button.dataset.clinicalAssistReceipt, button.dataset.doctorAction || "acknowledged");
  });
}

async function submitDoctorMultiPractice(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.querySelector("#doctor-submit-status");
  const submit = form.querySelector("button[type='submit']");
  const payload = {
    ...Object.fromEntries(new FormData(form)),
    doctorId: doctorRuntime.doctor?.id,
    publicVisible: form.elements.publicVisible?.checked !== false
  };
  submit.disabled = true;
  if (status) status.textContent = "提交中";
  try {
    if (!doctorApiBase) throw new Error("静态预览模式下不提交申请");
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${doctorApiBase}/multi-practice-applications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `提交失败：${response.status}`);
    }
    doctorRuntime = await loadDoctorRuntime();
    form.reset();
    bindDoctorForm();
    renderDoctorWorkbench();
    if (status) status.textContent = "已提交到医院端待办";
  } catch (error) {
    if (status) status.textContent = error.message || "提交失败";
  } finally {
    submit.disabled = false;
  }
}

function renderDoctorWorkbench() {
  renderDoctorMetrics();
  renderDoctorClinicalAssist();
  renderDoctorProfile();
  renderDoctorPolicy();
  renderDoctorApplications();
  renderDoctorPublicLedger();
}

function renderDoctorMetrics() {
  const target = document.querySelector("#doctor-metrics");
  if (!target) return;
  const applications = doctorRuntime.applications || [];
  const messages = doctorRuntime.messages || [];
  const clinicalAlerts = doctorRuntime.clinicalAssist?.alerts || [];
  const registry = doctorRuntime.doctor?.electronicRegistrationVerification || doctorRuntime.doctor?.electronicRegistration || {};
  const pending = applications.filter((item) => /待|补正|pending/i.test(String(item.status || ""))).length;
  const publicRows = applications.filter((item) => item.publicVisible !== false).length;
  doctorReplace(target, [
    ["本人申请", applications.length, "多点执业申请和备案记录"],
    ["待处理", pending, "医院端或医生端仍需处理"],
    ["临床辅助", clinicalAlerts.length, `${clinicalAlerts.filter((item) => /pending|待/i.test(`${item.status || ""} ${item.messageReceiptStatus || ""}`)).length} 条待回执`],
    ["医院消息", messages.length, "医院端确认、退回和备案通知"],
    ["电子注册", registry.verificationStatus || "待核验", registry.registryId || "医师电子化注册系统"]
  ].map(([label, value, hint]) => doctorElement("article", { className: "metric-card" }, [
    doctorElement("strong", { text: value }),
    doctorElement("span", { text: label }),
    doctorElement("small", { text: hint })
  ])));
  const status = document.querySelector("#doctor-profile-status");
  if (status) status.textContent = `${publicRows} 条公开备案相关记录`;
}

function renderDoctorClinicalAssist() {
  const target = document.querySelector("#doctor-clinical-assist");
  const count = document.querySelector("#doctor-clinical-assist-count");
  if (!target || !count) return;
  const assist = doctorRuntime.clinicalAssist || {};
  const alerts = assist.alerts || [];
  const pending = alerts.filter((item) => /pending|待/i.test(`${item.status || ""} ${item.messageReceiptStatus || ""}`));
  count.textContent = `${alerts.length} 条 · ${pending.length} 条待回执`;
  doctorReplace(target, alerts.map((item) => {
    const pendingReceipt = /pending|待/i.test(`${item.status || ""} ${item.messageReceiptStatus || ""}`);
    const decisionUnavailable = item.decisionAvailable === false;
    const actions = [
      doctorElement("span", {
        className: `badge ${doctorStatusClass(item.status)}`,
        text: item.severity || item.status || "待处理"
      })
    ];
    if (pendingReceipt && doctorApiBase) {
      const accept = doctorButton("采纳提醒", item.id, "accepted-recommendation");
      accept.disabled = decisionUnavailable;
      actions.push(
        accept,
        doctorButton("保留并说明", item.id, "kept-order-with-reason")
      );
    }
    const reason = pendingReceipt && doctorApiBase ? doctorElement("label", {}, [
      doctorElement("span", { text: "保留原医嘱的临床理由（至少 8 个字符）" }),
      doctorElement("textarea", { attributes: { "aria-label": "保留原医嘱的临床理由", rows: "3", maxlength: "2000" }, dataset: { clinicalAssistReason: item.id } })
    ]) : null;
    return doctorElement("section", { className: "item" }, [
      doctorElement("div", {}, [
        doctorElement("h3", { text: `${item.alertTitle || item.category || "临床辅助提醒"} · ${item.residentName || item.residentId || ""}` }),
        doctorElement("p", { text: item.alertDetail || "" }),
        doctorElement("p", { text: decisionUnavailable ? "当前规则未获有效治理批准，建议暂不可采纳；可保留原医嘱并说明原因。" : `建议：${item.recommendation || ""}` }),
        decisionUnavailable ? doctorElement("p", { text: `治理状态：${item.governanceStatus || "待核验"} · decisionAvailable=false` }) : null,
        doctorElement("p", { text: `工作站：${item.pluginSurface || "doctor-workstation"} · 回执 ${item.messageReceiptStatus || "pending"} · ${item.lastAction || ""}` }),
        reason,
        doctorElement("p", { attributes: { role: "status", "aria-live": "polite" }, dataset: { clinicalAssistStatus: item.id } })
      ]),
      doctorElement("div", { className: "actions" }, actions)
    ]);
  }), doctorElement("p", { className: "muted", text: "暂无本人临床辅助提醒。" }));
}

async function submitDoctorClinicalAssistReceipt(alertId, doctorAction) {
  if (!doctorApiBase) return;
  const alert = doctorRuntime.clinicalAssist?.alerts?.find((item) => item.id === alertId);
  if (!alert || (doctorAction === "accepted-recommendation" && alert.decisionAvailable === false)) return;
  if (doctorClinicalCommands.get(alertId)?.busy) return;
  const status = Array.from(document.querySelectorAll("[data-clinical-assist-status]")).find((node) => node.dataset.clinicalAssistStatus === alertId);
  const reason = Array.from(document.querySelectorAll("[data-clinical-assist-reason]")).find((node) => node.dataset.clinicalAssistReason === alertId);
  const accepting = doctorAction === "accepted-recommendation";
  const actionDetail = accepting ? "医生已采纳临床辅助提醒并回写处理结果。" : (reason?.value || "").trim();
  if (!accepting && (actionDetail.length < 8 || actionDetail.length > 2000)) {
    if (status) status.textContent = "请填写 8–2000 个字符的实际临床理由后再提交。";
    reason?.focus();
    return;
  }
  const payload = { receiptStatus: "received", doctorAction, actionDetail, messageChannel: "doctor-workstation", expectedVersion: Number.isSafeInteger(alert.version) ? alert.version : 0 };
  const fingerprint = JSON.stringify(payload);
  let command = doctorClinicalCommands.get(alertId);
  const buttons = Array.from(document.querySelectorAll("[data-clinical-assist-receipt]")).filter((node) => node.dataset.clinicalAssistReceipt === alertId);
  try {
    if (!command || command.fingerprint !== fingerprint) {
      command = { fingerprint, key: `doctor-receipt-${crypto.randomUUID()}`, busy: false };
      doctorClinicalCommands.set(alertId, command);
    }
    command.busy = true;
    buttons.forEach((button) => { button.disabled = true; });
    if (reason) reason.disabled = true;
    if (status) status.textContent = "正在提交回执，请等待服务端确认。";
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${doctorApiBase}/phase2/clinical-assist/alerts/${encodeURIComponent(alertId)}/receipt`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": command.key },
      body: JSON.stringify({ ...payload, idempotencyKey: command.key })
    });
    if (!response.ok) throw new Error(response.status === 409 ? "提醒版本或治理状态已变化，请刷新页面后复核。" : `回执未确认（${response.status}），可重试相同操作。`);
    doctorClinicalCommands.delete(alertId);
    doctorRuntime = await loadDoctorRuntime();
    renderDoctorWorkbench();
  } catch (error) {
    if (status) status.textContent = error.message || "回执未确认，可重试相同操作。";
  } finally {
    if (command) command.busy = false;
    buttons.forEach((button) => { button.disabled = button.dataset.doctorAction === "accepted-recommendation" && alert.decisionAvailable === false; });
    if (reason) reason.disabled = false;
  }
}

function buildStaticClinicalAssist(state, doctor) {
  const alerts = (state.phase2ClinicalAssistAlerts || []).filter((item) => item.doctorId === doctor.id);
  const receipts = (state.phase2ClinicalAssistReceipts || []).filter((item) => alerts.some((alert) => alert.id === item.alertId));
  return {
    ok: true,
    summary: {
      alerts: alerts.length,
      pendingAlerts: alerts.filter((item) => /pending|待/i.test(`${item.status || ""} ${item.messageReceiptStatus || ""}`)).length,
      receipts: receipts.length
    },
    rules: state.phase2ClinicalAssistRules || [],
    alerts,
    receipts,
    pluginContracts: state.phase2ClinicalAssistPluginContracts || []
  };
}

function renderDoctorProfile() {
  const doctor = doctorRuntime.doctor || {};
  const registry = doctor.electronicRegistrationVerification || doctor.electronicRegistration || {};
  const target = document.querySelector("#doctor-profile");
  if (!target) return;
  const verified = ["已核验", "verified"].includes(String(registry.verificationStatus || ""));
  doctorReplace(target, [doctorElement("section", { className: "item" }, [
    doctorElement("div", {}, [
      doctorElement("h3", { text: `${doctor.name || "医生账户"} · ${doctor.title || "职称待同步"} · ${doctor.specialty || "专业待同步"}` }),
      doctorElement("p", { text: `${doctor.primaryInstitution || "第一执业地点待同步"} · ${doctor.department || "科室待同步"}` }),
      doctorElement("p", { text: `执业证号：${doctor.licenseNo || "待同步"} · 执业范围：${doctor.practiceScope || "待同步"} · 有效期至 ${doctor.registrationValidUntil || registry.validUntil || "待同步"}` }),
      doctorElement("p", { text: `电子化注册：${registry.registryId || "待同步"} · ${registry.verificationStatus || "待核验"} · 签章 ${registry.signatureNo || "待签章"}` })
    ]),
    doctorElement("span", { className: `badge ${verified ? "info" : "warn"}`, text: doctor.accountStatus || "启用" })
  ])]);
}

function renderDoctorPolicy() {
  const policy = doctorRuntime.policy || {};
  const target = document.querySelector("#doctor-policy");
  if (!target) return;
  const rows = [
    ["资格", (policy.qualificationRules || []).slice(0, 2).join("；") || "执业范围、任职年限、考核和电子注册需一致"],
    ["材料", (policy.agreementFields || []).join("、") || "协议、薪酬、责任、保险、第一执业地点意见"],
    ["公开", "公开台账只展示姓名、执业类别、执业范围、第一执业地点、拟执业机构和监管状态"],
    ["风险", "排班冲突、责任保险缺失、第一执业地点未确认时进入补正队列"]
  ];
  doctorReplace(target, rows.map(([label, detail]) => doctorElement("div", {}, [
    doctorElement("strong", { text: label }),
    doctorElement("span", { text: detail })
  ])));
}

function renderDoctorApplications() {
  const target = document.querySelector("#doctor-applications");
  const count = document.querySelector("#doctor-application-count");
  if (!target || !count) return;
  const applications = doctorRuntime.applications || [];
  const messages = doctorRuntime.messages || [];
  count.textContent = `${applications.length} 条`;
  doctorReplace(target, applications.map((item) => {
    const relatedMessages = messages.filter((message) => message.sourceId === item.id).slice(0, 3);
    const riskFlags = Array.isArray(item.riskFlags) ? item.riskFlags : [];
    const externalSync = item.externalSync || {};
    const confirmation = item.primaryPracticeConfirmation || {};
    const details = [
      doctorElement("h3", { text: `${item.targetInstitution || "拟执业机构待定"} · ${item.targetDepartment || "科室待定"}` }),
      doctorElement("p", { text: `${item.period || "期限待定"} · ${item.schedule || "时间待定"} · ${item.practiceScope || "范围待定"}` }),
      doctorElement("p", { text: `第一执业地点：${confirmation.status || item.primaryConsent || "待确认"} · 签章 ${confirmation.signatureNo || "待签章"} · 公开 ${item.publicVisible === false ? "否" : "是"}` }),
      doctorElement("p", { text: `外部同步：电子注册 ${externalSync.electronicRegistration?.status || "待同步"} · 电子签章 ${externalSync.eSignature?.status || "待签"} · HIS/HR ${externalSync.hisHr?.status || "待映射"}` })
    ];
    if (riskFlags.length) details.push(doctorElement("p", { className: "muted", text: `补正提示：${riskFlags.join("、")}` }));
    if (relatedMessages.length) {
      details.push(doctorElement("div", { className: "list compact" }, relatedMessages.map((message) => doctorElement("p", {}, [
        doctorElement("strong", { text: message.title || "医院消息" }),
        document.createTextNode(`：${message.body || "待处理"}`)
      ]))));
    }
    return doctorElement("section", { className: "item" }, [
      doctorElement("div", {}, details),
      doctorElement("span", { className: `badge ${doctorStatusClass(item.status)}`, text: item.status || "待处理" })
    ]);
  }), doctorElement("p", { className: "muted", text: "暂无本人多点执业申请。" }));
}

function renderDoctorPublicLedger() {
  const target = document.querySelector("#doctor-public-ledger");
  const count = document.querySelector("#doctor-ledger-count");
  if (!target || !count) return;
  const doctorName = doctorRuntime.doctor?.name || "";
  const rows = (doctorRuntime.ledger || []).filter((item) => !doctorName || item.doctorName === doctorName || item.doctorId === doctorRuntime.doctor?.id);
  count.textContent = `${rows.length} 条`;
  const bodyRows = rows.map((item) => doctorElement("tr", {}, [
    doctorElement("td", { text: item.doctorName || doctorName }),
    doctorElement("td", { text: item.primaryInstitution || "" }),
    doctorElement("td", { text: item.targetInstitution || "" }),
    doctorElement("td", { text: item.practiceScope || "" }),
    doctorElement("td", { text: item.status || "" })
  ]));
  if (!bodyRows.length) {
    bodyRows.push(doctorElement("tr", {}, [doctorElement("td", { text: "暂无公开备案记录", attributes: { colspan: "5" } })]));
  }
  doctorReplace(target, [doctorElement("table", {}, [
    doctorElement("thead", {}, [doctorElement("tr", {}, ["医生", "第一执业地点", "拟执业机构", "范围", "状态"].map((label) => doctorElement("th", { text: label })))]),
    doctorElement("tbody", {}, bodyRows)
  ])]);
}

function doctorElement(tagName, options = {}, children = []) {
  const element = document.createElement(tagName);
  if (options.className) element.className = options.className;
  if (Object.hasOwn(options, "text")) element.textContent = String(options.text ?? "");
  Object.entries(options.attributes || {}).forEach(([name, value]) => element.setAttribute(name, String(value)));
  Object.entries(options.dataset || {}).forEach(([name, value]) => {
    element.dataset[name] = String(value ?? "");
  });
  element.append(...children.filter(Boolean));
  return element;
}

function doctorReplace(target, children, emptyNode) {
  const nextChildren = children.length ? children : [emptyNode];
  target.replaceChildren(...nextChildren.filter(Boolean));
}

function doctorButton(label, alertId, action) {
  return doctorElement("button", {
    className: "inline-action",
    text: label,
    attributes: { type: "button" },
    dataset: { clinicalAssistReceipt: alertId, doctorAction: action }
  });
}

function doctorStatusClass(status) {
  const text = String(status || "");
  if (/退回|暂停|冲突|补正|风险|danger/i.test(text)) return "danger";
  if (/待|审核|处理中|pending|review/i.test(text)) return "warn";
  return "info";
}
