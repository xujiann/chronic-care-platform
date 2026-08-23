const NURSING_API_BASE = location.protocol === "file:" ? "" : "/api";
let nursingDashboard = null;

document.addEventListener("DOMContentLoaded", async () => {
  bindNursingAppointmentForm();
  document.querySelector("#nursing-nurse-select")?.addEventListener("change", () => {
    renderNurseQueue(nursingDashboard?.orders || []);
    renderMobileNurseCards(nursingDashboard?.orders || []);
  });
  document.querySelector("#nursing-institution-select")?.addEventListener("change", () => {
    renderServiceItemSelect(nursingDashboard?.institutions || []);
    renderNursingDistrictSelect(nursingDashboard?.institutions || []);
  });
  await loadInternetNursingDashboard();
});

async function loadInternetNursingDashboard() {
  nursingDashboard = await fetchInternetNursingDashboard();
  nursingDashboard.dispatchRecommendations = buildStaticDispatchRecommendations(nursingDashboard.orders || [], nursingDashboard.nurses || []);
  nursingDashboard.orders = withNursingServiceControls(nursingDashboard.orders || []);
  nursingDashboard.orders = withNursingRiskQualityControls(nursingDashboard.orders);
  nursingDashboard.orders = withNursingSchedulingControls(nursingDashboard.orders);
  nursingDashboard.orders = withNursingCancellationRefundControls(nursingDashboard.orders);
  nursingDashboard.orders = withNursingTimelineNotificationControls(nursingDashboard.orders);
  nursingDashboard.paymentReadiness = buildStaticPaymentReadiness(nursingDashboard.policy || {}, nursingDashboard.orders);
  renderInternetNursingDashboard(nursingDashboard);
}

async function fetchInternetNursingDashboard() {
  if (NURSING_API_BASE) {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${NURSING_API_BASE}/internet-nursing/dashboard`);
    if (response.ok) return response.json();
  }
  const response = await fetch("./data/public-demo.json");
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
  const dispatchRecommendations = buildStaticDispatchRecommendations(orders, nurses);
  const regulatoryMonthlyReport = buildStaticRegulatoryMonthlyReport(orders, institutions);
  const paymentReadiness = buildStaticPaymentReadiness(policy, orders);
  const siteCutoverPack = buildStaticSiteCutoverPack(policy);
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
      trackingActive: orders.filter((item) => item.locationTrace === "tracking").length,
      notificationQueued: orders.flatMap((item) => item.notificationDeliveries || []).filter((item) => item.status === "queued").length,
      notificationSent: orders.flatMap((item) => item.notificationDeliveries || []).filter((item) => item.status === "sent").length
    },
    institutions,
    nurses,
    orders: orders.map((item) => ({ ...item, institution: institutionById.get(item.institutionId), nurse: nurseById.get(item.nurseId) })),
    nurseQueue: orders,
    riskQueue: orders.filter((item) => item.riskLevel === "high"),
    dispatchRecommendations,
    regulatoryMonthlyReport,
    regulatoryAlerts: buildStaticRegulatoryAlerts(institutions, nurses),
    regulatoryContract: policy.regulatoryContract || defaultRegulatoryContract(),
    productionIntegration: buildStaticProductionIntegration(policy, orders),
    paymentReadiness,
    deviceVerification: buildStaticDeviceVerification(policy, orders, nurses),
    regulatorySubmission: buildStaticRegulatorySubmission(policy, orders, institutions),
    siteCutoverPack,
    innovationCenter: window.InternetNursingHighlights?.buildInternetNursingInnovationCenter({
      policy,
      institutions,
      nurses,
      orders,
      dispatchRecommendations,
      regulatoryMonthlyReport,
      paymentReadiness,
      siteCutoverPack
    })
  };
}

function enrichStaticNursingOrder(item) {
  const signedConsent = item.informedConsent === "signed";
  return {
    ...item,
    consentAttachment: item.consentAttachment || (signedConsent
      ? { status: "signed", version: "internet-nursing-consent-v1", signerName: item.residentName || "居民电子签名", signedAt: item.createdAt || new Date().toISOString(), attachmentName: `internet-nursing-informed-consent-${item.id}.pdf` }
      : { status: "pending", required: true, version: "internet-nursing-consent-v1" }),
    locationTracePoints: Array.isArray(item.locationTracePoints) ? item.locationTracePoints : [],
    notificationDeliveries: Array.isArray(item.notificationDeliveries) ? item.notificationDeliveries : staticNotificationDeliveries(item)
  };
}

function staticNotificationDeliveries(item) {
  const status = String(item.status || "requested");
  const serviceStarted = ["in-service", "completed", "closed"].includes(status);
  const serviceFinished = ["completed", "closed"].includes(status);
  return [
    { event: "appointment-submitted", channel: "in_app", status: "sent" },
    { event: "dispatch-qualified-nurse", channel: "hospital_message", status: item.nurseId ? "sent" : "queued" },
    { event: "nurse-accept", channel: "sms", status: ["accepted", "in-service", "completed", "closed"].includes(status) ? "sent" : "queued" },
    { event: "service-start", channel: "sms", status: serviceStarted ? "sent" : "queued" },
    { event: "service-complete", channel: "in_app", status: serviceFinished ? "sent" : "queued" }
  ];
}

function buildStaticDispatchRecommendations(orders, nurses) {
  const domain = window.NursingEscortDomain;
  if (domain) {
    return orders
      .filter((order) => !order.nurseId && !["completed", "closed", "cancelled", "rejected"].includes(order.status))
      .map((order) => {
        const ranked = domain.rankDispatchCandidates("nursing", order, nurses, { now: new Date(), limit: 3 });
        return {
          orderId: order.id,
          residentId: order.residentId,
          serviceItem: order.serviceItem,
          riskLevel: order.riskLevel,
          targetStatus: ranked.targetStatus,
          blockers: ranked.blockers,
          blockedCandidates: ranked.blockedCandidates,
          candidates: ranked.candidates.map((item) => {
            const nurse = nurses.find((row) => row.id === item.personId) || {};
            return {
              nurseId: item.personId,
              nurseName: item.personName,
              remainingCapacity: item.capacity.remaining,
              serviceDate: item.capacity.serviceDate,
              score: item.score,
              reason: `资质、机构、专科、容量、风险和证据门禁均通过；风险等级 ${item.risk.band}`
            };
          })
        };
      });
  }
  return orders
    .filter((order) => !order.nurseId && ["requested", "assessed", "dispatched"].includes(order.status))
    .map((order) => ({
      orderId: order.id,
      residentId: order.residentId,
      serviceItem: order.serviceItem,
      riskLevel: order.riskLevel,
      candidates: nurses
        .filter(isQualifiedNurse)
        .filter((nurse) => !order.institutionId || nurse.institutionId === order.institutionId || nurse.institutionCode === order.institutionCode)
        .filter((nurse) => !Array.isArray(nurse.specialties) || nurse.specialties.includes(order.serviceItem))
        .map((nurse) => ({
          nurseId: nurse.id,
          nurseName: nurse.name,
          remainingCapacity: Number(nurse.dailyCapacity || 0) - Number(nurse.assignedToday || 0),
          score: Math.max(0, Number(nurse.dailyCapacity || 0) - Number(nurse.assignedToday || 0)) + (order.riskLevel === "high" ? 2 : 0),
          reason: "按护士资质、服务项目、服务区域、日容量和风险等级推荐"
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
    }));
}

function withNursingServiceControls(orders) {
  const domain = window.NursingEscortDomain;
  if (!domain) return orders;
  return orders.map((order) => {
    const current = domain.canonicalStatus(order.status, "nursing");
    if (["completed", "settlement-pending", "settled", "quality-review", "closed", "cancelled", "rejected", "refunded"].includes(current)) {
      return { ...order, serviceEvidenceControl: null };
    }
    const target = current === "in-service" ? "completed" : "in-service";
    const transition = domain.validateTransition("nursing", current, target);
    const evidence = domain.validateServiceEvidence("nursing", order, target);
    return {
      ...order,
      serviceEvidenceControl: {
        ok: transition.ok && evidence.ok,
        target,
        blockers: [
          ...(transition.ok ? [] : [`transition:${current}->${target}`]),
          ...evidence.reasons
        ]
      }
    };
  });
}

function nursingServiceControlText(item) {
  const control = item?.serviceEvidenceControl;
  if (!control) return "";
  if (control.ok) return control.target === "completed" ? "完成证据校验通过" : "开始服务证据校验通过";
  return `履约阻断：${control.blockers.slice(0, 5).join("；")}`;
}

function withNursingRiskQualityControls(orders) {
  const domain = window.NursingEscortDomain;
  if (!domain) return orders;
  return orders.map((order) => {
    const current = domain.canonicalStatus(order.status, "nursing");
    const hasIncident = order.adverseEvent?.status && order.adverseEvent.status !== "none";
    const hasComplaint = order.complaintStatus && order.complaintStatus !== "none";
    let target = "";
    if (current === "complaint-open") target = "quality-review";
    else if (["quality-review", "adverse-event", "closed"].includes(current)) target = "closed";
    else if (["completed", "settled"].includes(current)) target = "quality-review";
    else if (hasIncident) target = "adverse-event";
    else if (hasComplaint) target = "complaint-open";
    if (!target) return { ...order, riskQualityControl: null };
    const transition = current === "closed"
      ? { ok: true }
      : domain.validateTransition("nursing", current, target);
    const evidence = domain.validateRiskQualityEvidence("nursing", order, target, { currentStatus: current });
    return {
      ...order,
      riskQualityControl: {
        ok: transition.ok && evidence.ok,
        target,
        blockers: [
          ...(transition.ok ? [] : [`transition:${current}->${target}`]),
          ...evidence.reasons
        ]
      }
    };
  });
}

function nursingRiskQualityControlText(item) {
  const control = item?.riskQualityControl;
  if (!control) return "";
  if (control.ok) return control.target === "closed" ? "风险与质控关闭证据通过" : "风险与质控流转证据通过";
  return `风险质控阻断：${control.blockers.slice(0, 5).join("；")}`;
}

function withNursingSchedulingControls(orders) {
  const domain = window.NursingEscortDomain;
  if (!domain) return orders;
  return orders.map((order) => {
    const current = domain.canonicalStatus(order.status, "nursing");
    if (!order.resourceReservation && !["reschedule-requested", "no-show-review"].includes(current)) {
      return { ...order, schedulingControl: null };
    }
    let target = "reschedule-requested";
    if (current === "reschedule-requested") target = "requested";
    else if (current === "no-show-review") {
      target = order.noShowDecision?.outcome === "cancel"
        ? "cancel-requested"
        : order.noShowDecision?.outcome === "reschedule" ? "reschedule-requested" : "accepted";
    } else {
      const slotAt = Date.parse(order.resourceReservation?.slotAt || "");
      if (current === "accepted" && Number.isFinite(slotAt) && slotAt < Date.now()) target = "no-show-review";
    }
    const transition = domain.validateTransition("nursing", current, target);
    const evidence = domain.validateSchedulingEvidence("nursing", order, target, { currentStatus: current });
    return {
      ...order,
      schedulingControl: {
        ok: transition.ok && evidence.ok,
        target,
        blockers: [
          ...(transition.ok ? [] : [`transition:${current}->${target}`]),
          ...evidence.reasons
        ]
      }
    };
  });
}

function nursingSchedulingControlText(item) {
  const control = item?.schedulingControl;
  if (!control) return "";
  if (control.ok) return `改约爽约证据通过：${control.target}`;
  return `改约爽约阻断：${control.blockers.slice(0, 5).join("，")}`;
}

function withNursingCancellationRefundControls(orders) {
  const domain = window.NursingEscortDomain;
  if (!domain) return orders;
  return orders.map((order) => {
    const current = domain.canonicalStatus(order.status, "nursing");
    let target = "";
    if (current === "refund-pending") target = "refunded";
    else if (current === "cancel-requested") target = order.cancellationRequest?.refundRequested ? "refund-pending" : "cancelled";
    else if (["settlement-pending", "settled"].includes(current)) target = "refund-pending";
    else if (["requested", "assessed", "risk-hold", "dispatched", "accepted"].includes(current)) target = "cancel-requested";
    if (!target) return { ...order, cancellationRefundControl: null };
    const transition = domain.validateTransition("nursing", current, target);
    const evidence = domain.validateCancellationRefundEvidence("nursing", order, target, { currentStatus: current });
    return {
      ...order,
      cancellationRefundControl: {
        ok: transition.ok && evidence.ok,
        target,
        blockers: [
          ...(transition.ok ? [] : [`transition:${current}->${target}`]),
          ...evidence.reasons
        ]
      }
    };
  });
}

function nursingCancellationRefundControlText(item) {
  const control = item?.cancellationRefundControl;
  if (!control) return "";
  if (control.ok) return `取消退费证据通过：${control.target}`;
  return `取消退费阻断：${control.blockers.slice(0, 5).join("，")}`;
}

function withNursingTimelineNotificationControls(orders) {
  const domain = window.NursingEscortDomain;
  if (!domain) return orders;
  return orders.map((order) => {
    const events = Array.isArray(order.timelineEvents) ? order.timelineEvents : [];
    const plans = Array.isArray(order.notificationPlans) ? order.notificationPlans : [];
    if (!events.length && !plans.length) return { ...order, timelineNotificationControl: null };
    const timeline = domain.validateTimelineIntegrity("nursing", order);
    const planReasons = plans.flatMap((plan) => domain.validateNotificationPlan("nursing", order, plan).reasons);
    const receipts = Array.isArray(order.notificationReceipts) ? order.notificationReceipts : [];
    const completedStatuses = new Set(["sent", "delivered", "read"]);
    const pending = plans.flatMap((plan) => plan.messages || []).filter((message) => message.required
      && !receipts.some((receipt) => receipt.messageId === message.id && completedStatuses.has(receipt.status))).length;
    return {
      ...order,
      timelineNotificationControl: {
        ok: timeline.ok && planReasons.length === 0,
        eventCount: events.length,
        pending,
        blockers: [...timeline.reasons, ...planReasons]
      }
    };
  });
}

function nursingTimelineNotificationControlText(item) {
  const control = item?.timelineNotificationControl;
  if (!control) return "";
  if (!control.ok) return `居民时间轴阻断：${control.blockers.slice(0, 5).join("，")}`;
  return `居民时间轴 ${control.eventCount} 条，通知待回执 ${control.pending} 条`;
}

function buildStaticRegulatoryMonthlyReport(orders, institutions) {
  return {
    month: "2026-06",
    serviceVolume: orders.length,
    completedServices: orders.filter((item) => ["completed", "closed"].includes(item.status)).length,
    highRiskHandled: orders.filter((item) => item.riskLevel === "high" && item.firstVisitAssessment === "passed").length,
    callbackClosureRate: orders.length ? orders.filter((item) => item.qualityCallback === "closed").length / orders.length : 0,
    complaintRate: orders.length ? orders.filter((item) => item.complaintStatus && item.complaintStatus !== "none").length / orders.length : 0,
    traceCompletenessRate: orders.length ? orders.filter((item) => Array.isArray(item.locationTracePoints) && item.locationTracePoints.length >= 2).length / orders.length : 0,
    adverseEvents: orders.filter((item) => item.adverseEvent?.status && item.adverseEvent.status !== "none").length,
    serviceVolumeByInstitution: institutions.map((institution) => {
      const rows = orders.filter((item) => item.institutionId === institution.id);
      const complaints = rows.filter((item) => item.complaintStatus && item.complaintStatus !== "none").length;
      const adverseEvents = rows.filter((item) => item.adverseEvent?.status && item.adverseEvent.status !== "none").length;
      const callbackRate = rows.length ? rows.filter((item) => item.qualityCallback === "closed").length / rows.length : 0;
      return {
        institutionId: institution.id,
        institutionName: institution.name,
        orders: rows.length,
        completed: rows.filter((item) => ["completed", "closed"].includes(item.status)).length,
        complaints,
        adverseEvents,
        callbackRate,
        qualityScore: Math.max(0, Math.round(100 - complaints * 12 - adverseEvents * 18 + callbackRate * 8))
      };
    })
  };
}

function buildStaticRegulatoryAlerts(institutions, nurses) {
  return [
    ...institutions.flatMap((institution) => {
      const alerts = [];
      if (institution.admissionReview?.status !== "approved") alerts.push({ type: "institution-admission", targetId: institution.id, detail: "试点机构准入待审核" });
      (institution.catalogChangeRequests || []).filter((item) => item.status !== "approved").forEach((item) => alerts.push({ type: "catalog-change", targetId: institution.id, detail: `${item.item} 服务目录变更待审批` }));
      return alerts;
    }),
    ...nurses.filter((nurse) => Date.parse(nurse.qualificationExpiresAt || "") - Date.now() <= 1000 * 60 * 60 * 24 * 45)
      .map((nurse) => ({ type: "nurse-qualification-expiry", targetId: nurse.id, detail: `${displayText(nurse.name)} 资质即将到期` }))
  ];
}

function buildStaticProductionIntegration(policy, orders) {
  const integration = policy.productionIntegration || defaultProductionIntegration();
  const deliveries = orders.flatMap((item) => item.notificationDeliveries || []);
  const signed = orders.filter((item) => item.consentAttachment?.status === "signed");
  return {
    ...integration,
    evidence: {
      signedConsentAttachments: signed.length,
      hashedAttachments: signed.filter((item) => item.consentAttachment?.hash).length,
      notificationDeliveries: deliveries.length,
      queuedDeliveries: deliveries.filter((item) => item.status === "queued").length,
      fallbackCollection: "taskMessages"
    },
    connectorsReady: (integration.hospitalConnectors || []).filter((item) => item.status === "mapped").length,
    totalConnectors: (integration.hospitalConnectors || []).length
  };
}

function buildStaticPaymentReadiness(policy, orders) {
  const payment = policy.paymentIntegration || defaultPaymentIntegration();
  const paymentRows = orders.map((item) => ({
    orderId: item.id,
    serviceItem: item.serviceItem,
    feeEstimate: item.feeEstimate || 0,
    paymentStatus: item.settlement?.paymentStatus || "pending",
    insuranceEstimate: item.settlement?.insuranceEstimate || 0,
    estimatedSelfPay: item.settlement?.estimatedSelfPay || 0,
    invoiceStatus: ["completed", "closed"].includes(item.status) ? "invoice-ready" : "waiting-service-complete",
    reconciliationStatus: item.settlement?.paymentStatus === "prechecked" ? "precheck-matched" : "pending",
    financialControl: buildNursingFinancialControl(item)
  }));
  return {
    ...payment,
    totalEstimate: paymentRows.reduce((sum, item) => sum + Number(item.feeEstimate || 0), 0),
    insuranceEstimate: paymentRows.reduce((sum, item) => sum + Number(item.insuranceEstimate || 0), 0),
    selfPayEstimate: paymentRows.reduce((sum, item) => sum + Number(item.estimatedSelfPay || 0), 0),
    precheckedOrders: paymentRows.filter((item) => item.paymentStatus === "prechecked").length,
    paymentRows
  };
}

function buildNursingFinancialControl(order) {
  const domain = window.NursingEscortDomain;
  if (!domain) return null;
  const current = domain.canonicalStatus(order.status, "nursing");
  const target = current === "settlement-pending" ? "settled" : "settlement-pending";
  const transition = domain.validateTransition("nursing", current, target);
  const evidence = domain.validateFinancialEvidence("nursing", order, target);
  return {
    ok: transition.ok && evidence.ok,
    target,
    blockers: [
      ...(transition.ok ? [] : [`transition:${current}->${target}`]),
      ...evidence.reasons
    ]
  };
}

function nursingFinancialControlText(control) {
  if (!control) return "";
  if (control.ok) return control.target === "settled" ? "回调与对账证据通过" : "定价与财务下发证据通过";
  return `结算阻断：${control.blockers.slice(0, 5).join("；")}`;
}

function buildStaticDeviceVerification(policy, orders, nurses) {
  const device = policy.deviceVerification || defaultDeviceVerification();
  const traceOrders = orders.filter((item) => Array.isArray(item.locationTracePoints) && item.locationTracePoints.length >= 2);
  const readyNurses = nurses.filter((item) => item.locationDevice === "enabled" && item.oneClickAlert === "enabled");
  return {
    ...device,
    readyNurses: readyNurses.length,
    totalNurses: nurses.length,
    traceVerifiedOrders: traceOrders.length,
    traceVerificationRate: orders.length ? traceOrders.length / orders.length : 0,
    photoAttachmentStatus: "contract-ready",
    exceptions: []
  };
}

function buildStaticRegulatorySubmission(policy, orders, institutions) {
  const submission = policy.regulatorySubmission || defaultRegulatorySubmission();
  return {
    ...submission,
    packageId: "internet-nursing-regulatory-monthly-202606",
    records: orders.length,
    institutions: institutions.length,
    highRiskRealtime: orders.filter((item) => item.riskLevel === "high").length,
    fieldCoverage: (submission.mappedFields || []).map((field) => ({ field, status: "mapped" })),
    signoffStatus: (submission.signoffs || []).map((owner) => ({ owner, status: "ready-for-site-signoff" }))
  };
}

function buildStaticSiteCutoverPack(policy) {
  const production = policy.productionIntegration || defaultProductionIntegration();
  const payment = policy.paymentIntegration || defaultPaymentIntegration();
  const device = policy.deviceVerification || defaultDeviceVerification();
  const submission = policy.regulatorySubmission || defaultRegulatorySubmission();
  const tracks = [
    {
      id: "nursing-cutover-message-signature",
      owner: "医院护理信息化与平台运维",
      status: production.messageGateway?.status === "contract-ready" && production.signatureStorage?.status === "contract-ready" ? "ready-for-site-signoff" : "blocked",
      evidence: ["短信/院内消息/站内兜底", "电子签名附件存储", production.version],
      blockingUntil: "完成消息网关、站内兜底和电子签名附件存储现场签字"
    },
    {
      id: "nursing-cutover-hospital-connectors",
      owner: "医疗机构接口联调组",
      status: (production.hospitalConnectors || []).length >= 3 && (production.hospitalConnectors || []).every((item) => item.status === "mapped") ? "ready-for-site-signoff" : "blocked",
      evidence: (production.hospitalConnectors || []).map((item) => `${displayText(item.system)}:${item.route}`),
      blockingUntil: "完成院内护理管理系统、电子病历和监管平台联调签字"
    },
    {
      id: "nursing-cutover-payment-reconciliation",
      owner: "医保经办、财务与平台支付组",
      status: payment.status === "contract-ready" && (payment.modes || []).includes("daily reconciliation") ? "ready-for-site-signoff" : "blocked",
      evidence: payment.modes || [],
      blockingUntil: "完成医保电子凭证、自费支付、退费、发票和 T+1 对账验收"
    },
    {
      id: "nursing-cutover-device-drill",
      owner: "护理运营与设备管理组",
      status: device.status === "contract-ready" && (device.requiredSignals || []).includes("one-click alert") ? "ready-for-site-signoff" : "blocked",
      evidence: device.requiredSignals || [],
      blockingUntil: "完成 GPS、定位设备、记录仪、一键报警和照片附件现场实测"
    },
    {
      id: "nursing-cutover-regulatory-pressure-test",
      owner: "卫健监管与平台运维",
      status: submission.pressureTest?.status === "passed" && (submission.signoffs || []).length >= 3 ? "ready-for-site-signoff" : "blocked",
      evidence: [`${submission.submissionCycle}`, `P95 ${submission.pressureTest?.p95Ms || 0}ms`, ...(submission.signoffs || [])],
      blockingUntil: "完成监管月报、高风险实时上报、字段映射和压测记录签字"
    }
  ];
  const productionBlockers = [
    { id: "production-audit-retention", source: "audit-retention", name: "audit retention target", detail: "missing", requiredAction: "configure AUDIT_EXPORT_PATH or SIEM_ENDPOINT and archive retention permission" },
    { id: "production-site-interface-signoff", source: "site-interface-signoff", name: "site interface joint-test signoff", detail: "missing", requiredAction: "set CUTOVER_SITE_INTERFACE_SIGNOFF after signed site interface joint test" },
    { id: "production-monitoring-signoff", source: "monitoring-signoff", name: "monitoring and on-call signoff", detail: "missing", requiredAction: "set CUTOVER_MONITORING_SIGNOFF after monitoring and on-call acceptance" },
    { id: "production-dr-rehearsal-signoff", source: "dr-rehearsal-signoff", name: "disaster recovery rehearsal signoff", detail: "missing", requiredAction: "set CUTOVER_DR_REHEARSAL_SIGNOFF after disaster recovery rehearsal" }
  ];
  return {
    status: tracks.every((item) => item.status === "ready-for-site-signoff") ? "ready-for-site-signoff" : "blocked",
    productionReadiness: "production-blocked",
    template: "release/templates/production-signoff/README.md",
    auditRetentionEvidence: "release/audit-retention-report.md",
    productionCutoverEvidence: "release/production-cutover-checklist.md",
    productionBlockers,
    tracks
  };
}

function renderInternetNursingDashboard(dashboard) {
  renderNursingMetrics(dashboard.summary || {});
  renderNursingP1Center(dashboard);
  renderRiskGuidance(dashboard.orders || [], dashboard.riskQueue || []);
  renderInstitutionSelect(dashboard.institutions || []);
  renderServiceItemSelect(dashboard.institutions || []);
  renderNursingDistrictSelect(dashboard.institutions || []);
  renderNurseSelect(dashboard.nurses || []);
  renderMobileAppointmentStatus(dashboard.orders || []);
  renderMobileNurseCards(dashboard.orders || []);
  renderNursingClosedLoop(dashboard.orders || []);
  renderHospitalOrders(dashboard.orders || []);
  renderNurseQueue(dashboard.orders || []);
  renderPolicyControls(dashboard.policy || {});
  renderDispatchRecommendations(dashboard.dispatchRecommendations || []);
  renderFinanceQuality(dashboard.orders || []);
  renderRegulatoryReport(dashboard.regulatoryMonthlyReport || {});
  renderRegulatoryContract(dashboard.regulatoryContract || {}, dashboard.regulatoryAlerts || []);
  renderProductionIntegration(dashboard.productionIntegration || {});
  renderPaymentReadiness(dashboard.paymentReadiness || {});
  renderDeviceVerification(dashboard.deviceVerification || {});
  renderRegulatorySubmission(dashboard.regulatorySubmission || {});
  renderSiteCutoverPack(dashboard.siteCutoverPack || {});
  renderNursingInnovationCenter(dashboard.innovationCenter || {});
  const citizenSummary = document.querySelector("#nursing-citizen-summary");
  if (citizenSummary) citizenSummary.textContent = `${dashboard.summary?.publishedInstitutions || 0} 家已发布机构`;
  const nurseSummary = document.querySelector("#nursing-nurse-summary");
  if (nurseSummary) nurseSummary.textContent = `${dashboard.summary?.qualifiedNurses || 0}/${dashboard.summary?.nurses || 0} 名护士合格`;
}

function buildNursingP1Tracks(dashboard = {}) {
  const domain = window.NursingEscortDomain || {};
  const orders = Array.isArray(dashboard.orders) ? dashboard.orders : [];
  const protocols = domain.SPECIALIST_NURSING_PROTOCOLS || {};
  const lifecycle = dashboard.policy?.p1Lifecycle || {};
  const tracks = [
    {
      id: "assessment-signature",
      label: "结构化评估与签名",
      ready: typeof domain.validateNursingAssessmentEvidence === "function",
      evidence: `${orders.filter((item) => domain.validateNursingAssessmentEvidence?.(item, { at: new Date() })?.ok).length} 单证据有效`,
      boundary: "真实签名对象存储由现场适配器回传"
    },
    {
      id: "intake-scheduling",
      label: "区域时段、授权与幂等调度",
      ready: typeof domain.validateNursingOrderIntake === "function" &&
        typeof domain.validateSchedulingEvidence === "function" &&
        lifecycle.writePathVersion === "internet-nursing-write-path-v1" &&
        lifecycle.eventOutboxVersion === "internet-nursing-event-outbox-v1",
      evidence: "授权、目录、字段白名单、命令幂等、事务外盒及提供方回执",
      boundary: "T00 注入授权查询并原子持久化订单与外盒事件"
    },
    {
      id: "specialist-protocols",
      label: "三项专科护理协议",
      ready: Object.keys(protocols).length === 3 && typeof domain.validateNursingSpecialistProtocolEvidence === "function",
      evidence: `${Object.keys(protocols).length}/3 项协议：导管、伤口造口、腹膜透析`,
      boundary: "设备、医废和 EMR 使用现场回执"
    },
    {
      id: "pricing-settlement",
      label: "订单锁价与结算",
      ready: typeof domain.buildOrderPriceSnapshot === "function" && typeof domain.validateFinancialEvidence === "function",
      evidence: `${orders.filter((item) => item.priceSnapshot?.status === "locked").length} 单已锁价`,
      boundary: "支付、医保、发票和退款使用金融网关"
    },
    {
      id: "risk-quality",
      label: "投诉与不良事件 SLA",
      ready: typeof domain.buildComplaintEvidence === "function" && typeof domain.buildRiskIncidentEvidence === "function",
      evidence: "责任人、时限、升级、居民通知和最终质控决定",
      boundary: "值守组和报警渠道需现场配置"
    },
    {
      id: "timeline-notification",
      label: "居民时间轴与消息回执",
      ready: typeof domain.validateTimelineIntegrity === "function" && typeof domain.recordNotificationReceipt === "function",
      evidence: `${orders.filter((item) => Array.isArray(item.timelineEvents) && item.timelineEvents.length).length} 单已形成事件链`,
      boundary: "短信和院内消息提供方回执需联调"
    }
  ];
  return tracks.map((item) => ({ ...item, status: item.ready ? "已开发" : "阻断" }));
}

function renderNursingP1Center(dashboard = {}) {
  const target = document.querySelector("#nursing-p1-center");
  if (!target) return;
  target.innerHTML = buildNursingP1Tracks(dashboard).map((item) => `
    <div data-nursing-p1-track="${escapeHtml(item.id)}">
      <strong>${escapeHtml(item.label)} ${statusBadge(item.status)}</strong>
      <span>${escapeHtml(item.evidence)}</span>
      <small>${escapeHtml(item.boundary)}</small>
    </div>
  `).join("");
}

function renderNursingClosedLoop(items) {
  const target = document.querySelector("#nursing-closed-loop");
  if (!target) return;
  const summary = buildNursingClosedLoopSummary(items || []);
  const summaryHtml = renderNursingClosedLoopSummary(summary);
  const rows = (items || [])
    .slice()
    .sort((a, b) => String(b.requestedAt || b.createdAt || b.preferredAt || "").localeCompare(String(a.requestedAt || a.createdAt || a.preferredAt || "")))
    .slice(0, 4);
  target.innerHTML = `${summaryHtml}${rows.length ? rows.map((item) => `
    <article class="nursing-loop-card">
      <header>
        <div>
          <strong>${escapeHtml(displayText(item.residentName || item.residentId || ""))} · ${escapeHtml(displayText(item.serviceItem || ""))}</strong>
          <span>${escapeHtml(displayText(item.institution?.name || item.institutionName || ""))} / ${escapeHtml(item.preferredAt || "")}</span>
        </div>
        ${statusBadge(item.status)}
      </header>
      <div class="nursing-loop-steps" aria-label="互联网护理下单接单闭环">
        ${nursingLoopStep("居民下单", Boolean(item.id), item.sourceChannel || item.createdBy || "internet-nursing-mobile")}
        ${nursingLoopStep("首诊评估", item.firstVisitAssessment === "passed", item.firstVisitAssessment || "pending")}
        ${nursingLoopStep("知情同意", hasSignedNursingConsent(item), consentAttachmentText(item))}
        ${nursingLoopStep("医院派单", Boolean(item.nurseId), item.nurseName || item.nurseId || "pending")}
        ${nursingLoopStep("护士接单", ["accepted", "in-service", "completed", "closed"].includes(String(item.status || "")), locationTraceSummary(item))}
      </div>
      <small>${escapeHtml(nextNursingAction(item, item.riskLevel === "high") || "闭环已进入服务记录与质控回访。")}</small>
    </article>
  `).join("") : `
    <article class="nursing-loop-card empty">
      <header>
        <div>
          <strong>暂无互联网护理订单</strong>
          <span>居民提交预约后，将在这里形成下单、评估、派单、接单闭环。</span>
        </div>
      </header>
    </article>
  `}`;
}

function nursingLoopStep(label, passed, detail) {
  return `
    <div class="nursing-loop-step ${passed ? "done" : "pending"}">
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(displayText(detail || (passed ? "done" : "pending")))}</span>
    </div>
  `;
}

function buildNursingClosedLoopSummary(items) {
  const rows = Array.isArray(items) ? items : [];
  const acceptedStatuses = ["accepted", "in-service", "completed", "closed"];
  const accepted = rows.filter((item) => acceptedStatuses.includes(String(item.status || ""))).length;
  const dispatched = rows.filter((item) => Boolean(item.nurseId)).length;
  const readyForDispatch = rows.filter((item) => item.firstVisitAssessment === "passed" && hasSignedNursingConsent(item) && !item.nurseId).length;
  const waitingAssessment = rows.filter((item) => item.firstVisitAssessment !== "passed" || !hasSignedNursingConsent(item)).length;
  const waitingAcceptance = Math.max(0, dispatched - accepted);
  const highRiskOpen = rows.filter((item) => item.riskLevel === "high" && !acceptedStatuses.includes(String(item.status || ""))).length;
  const slaOverdue = rows.filter((item) => {
    const status = String(item.status || "");
    const startedAt = Date.parse(item.requestedAt || item.createdAt || item.preferredAt || "");
    return !acceptedStatuses.includes(status) && Number.isFinite(startedAt) && Date.now() - startedAt > 24 * 60 * 60 * 1000;
  }).length;
  const bottlenecks = [
    { label: "待评估签署", count: waitingAssessment, hint: "先补首诊评估和知情同意" },
    { label: "待派单", count: readyForDispatch, hint: "选择合格护士并派单" },
    { label: "待接单", count: waitingAcceptance, hint: "提醒护士接单并开启轨迹" }
  ];
  const bottleneck = bottlenecks.find((item) => item.count > 0) || {
    label: "闭环运行平稳",
    count: accepted,
    hint: "持续跟踪服务记录和质控回访"
  };
  return {
    total: rows.length,
    accepted,
    dispatched,
    readyForDispatch,
    waitingAssessment,
    waitingAcceptance,
    highRiskOpen,
    slaOverdue,
    bottleneck,
    completionRate: rows.length ? Math.round((accepted / rows.length) * 100) : 0
  };
}

function renderNursingClosedLoopSummary(summary) {
  const rows = [
    ["闭环完成率", `${summary.completionRate}%`, `${summary.accepted}/${summary.total} 单已接单`],
    ["已派单", summary.dispatched, "护士任务已生成"],
    ["待派单", summary.readyForDispatch, "评估和同意已齐"],
    ["待评估签署", summary.waitingAssessment, "需医院补齐证据"]
  ];
  return `
    <div class="nursing-loop-summary" aria-label="互联网护理闭环汇总">
      ${rows.map(([label, value, hint]) => `
        <div>
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
          <small>${escapeHtml(hint)}</small>
        </div>
      `).join("")}
    </div>
    <div class="nursing-loop-bottleneck" aria-label="互联网护理下一步优先处理">
      <span>下一步优先处理</span>
      <strong>${escapeHtml(summary.bottleneck.label)}</strong>
      <small>${escapeHtml(`${summary.bottleneck.count} 单 · ${summary.bottleneck.hint}`)}</small>
    </div>
    <div class="nursing-loop-risk-strip" aria-label="互联网护理SLA风险提示">
      <span>SLA 风险提示</span>
      <strong>${escapeHtml(`高风险未闭环 ${summary.highRiskOpen} 单 / 超 24 小时 ${summary.slaOverdue} 单`)}</strong>
      <small>${escapeHtml(summary.highRiskOpen || summary.slaOverdue ? "请优先完成评估派单、护士接单和轨迹开启。" : "暂无超时或高风险未闭环订单。")}</small>
    </div>
  `;
}

function renderNursingMetrics(summary) {
  const metrics = [
    ["试点机构", summary.institutions || 0, `${summary.publishedInstitutions || 0} 家已发布`],
    ["合格护士", summary.qualifiedNurses || 0, `共 ${summary.nurses || 0} 名`],
    ["服务订单", summary.orders || 0, `${summary.openOrders || 0} 单待处理`],
    ["首诊评估", summary.pendingAssessment || 0, "待评估"],
    ["知情同意", summary.consentPending || 0, "待签署"],
    ["服务轨迹", summary.trackingActive || 0, "进行中轨迹"],
    ["消息触达", summary.notificationQueued || 0, `${summary.notificationSent || 0} 条已发送`]
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

function notificationSummary(item) {
  const deliveries = Array.isArray(item?.notificationDeliveries) ? item.notificationDeliveries : [];
  if (!deliveries.length) return "消息网关待触达";
  const queued = deliveries.filter((row) => row.status === "queued").length;
  const sent = deliveries.filter((row) => row.status === "sent").length;
  const channels = [...new Set(deliveries.map((row) => displayText(row.channel || "")).filter(Boolean))].join("、");
  return `消息 ${sent} 已发 / ${queued} 待发${channels ? ` / ${channels}` : ""}`;
}

function serviceRecordSummary(item) {
  const record = item?.serviceRecord || {};
  const attachments = Array.isArray(item?.serviceAttachments) ? item.serviceAttachments : Array.isArray(record.attachments) ? record.attachments : [];
  if (record.status === "completed" || item?.serviceRecordStatus === "completed") return `护理记录已完成，附件 ${attachments.length} 份`;
  if (record.status === "in-progress" || item?.serviceRecordStatus === "in-progress") return `护理记录填写中，附件 ${attachments.length} 份`;
  return "护理记录待填写";
}

function notificationReceiptSummary(item) {
  const summary = item?.notificationReceiptSummary || {};
  if (!summary.status || summary.status === "pending") return notificationSummary(item);
  return `消息回执：已读 ${Number(summary.read || 0)} / 已发 ${Number(summary.sent || 0)} / 失败 ${Number(summary.failed || 0)}`;
}

function settlementSummary(item) {
  const settlement = item?.settlement || {};
  return `${displayText(settlement.mode || "self-pay estimate")} / 自费 ${Number(settlement.estimatedSelfPay || 0)} / 医保预估 ${Number(settlement.insuranceEstimate || 0)} / ${displayText(settlement.paymentStatus || "pending")}`;
}

function qualitySummary(item) {
  const satisfaction = item?.satisfaction || {};
  const inspection = item?.qualityInspection || {};
  const adverse = item?.adverseEvent || {};
  return `满意度 ${satisfaction.score || 0} / 抽查 ${displayText(inspection.status || "pending")} / 投诉 ${displayText(item.complaintStatus || "none")} / 不良事件 ${displayText(adverse.status || "none")}`;
}

function renderDispatchRecommendations(items) {
  const target = document.querySelector("#nursing-dispatch-recommendations");
  if (!target) return;
  target.innerHTML = items.length ? items.map((item) => {
    const first = item.candidates?.[0];
    return `<div>
      <strong>${escapeHtml(item.orderId)} · ${escapeHtml(displayText(item.serviceItem))}</strong>
      <span>${first ? `${escapeHtml(displayText(first.nurseName))}，剩余容量 ${escapeHtml(first.remainingCapacity)}，评分 ${escapeHtml(Math.round(first.score * 10) / 10)}` : "暂无合格护士候选"}</span>
      <small>${escapeHtml(first?.reason || "按护士资质、服务项目、服务区域、日容量和风险等级推荐")}</small>
      ${!first && item.blockers?.length ? `<small>派单阻断：${escapeHtml(item.blockers.slice(0, 5).join("；"))}</small>` : ""}
    </div>`;
  }).join("") : `<div><strong>暂无待推荐订单</strong><span>当前订单均已派单或已进入服务闭环。</span></div>`;
}

function renderFinanceQuality(items) {
  const target = document.querySelector("#nursing-finance-quality");
  if (!target) return;
  const rows = items.slice(0, 5);
  target.innerHTML = rows.length ? rows.map((item) => `<div>
    <strong>${escapeHtml(item.id)} · ${escapeHtml(displayText(item.residentName || item.residentId || ""))}</strong>
    <span>${escapeHtml(settlementSummary(item))}</span>
    <small>${escapeHtml(qualitySummary(item))}</small>
    <small>${escapeHtml(nursingRiskQualityControlText(item))}</small>
    <small>${escapeHtml(nursingCancellationRefundControlText(item))}</small>
  </div>`).join("") : `<div><strong>暂无费用质量记录</strong><span>完成订单后将展示结算预估、投诉、满意度和质控抽查。</span></div>`;
}

function renderRegulatoryReport(report) {
  const target = document.querySelector("#nursing-regulatory-report");
  if (!target) return;
  const rows = report.serviceVolumeByInstitution || [];
  target.innerHTML = `
    <table>
      <thead><tr><th>机构</th><th>服务量</th><th>完成</th><th>投诉</th><th>不良事件</th><th>回访率</th><th>质量评分</th></tr></thead>
      <tbody>${rows.map((item) => `<tr>
        <td>${escapeHtml(displayText(item.institutionName || item.institutionId))}</td>
        <td>${escapeHtml(item.orders || 0)}</td>
        <td>${escapeHtml(item.completed || 0)}</td>
        <td>${escapeHtml(item.complaints || 0)}</td>
        <td>${escapeHtml(item.adverseEvents || 0)}</td>
        <td>${escapeHtml(Math.round(Number(item.callbackRate || 0) * 100))}%</td>
        <td>${escapeHtml(item.qualityScore || 0)}</td>
      </tr>`).join("")}</tbody>
    </table>
    <p class="muted">月报 ${escapeHtml(report.month || "2026-06")}：服务量 ${escapeHtml(report.serviceVolume || 0)}，风险处置 ${escapeHtml(report.highRiskHandled || 0)}，轨迹完整率 ${escapeHtml(Math.round(Number(report.traceCompletenessRate || 0) * 100))}%。</p>
  `;
}

function renderRegulatoryContract(contract, alerts) {
  const target = document.querySelector("#nursing-regulatory-contract");
  if (!target) return;
  target.innerHTML = `
    <div>
      <strong>接口契约</strong>
      <span>${escapeHtml(contract.version || "internet-nursing-regulatory-contract-v1")}</span>
      <small>${escapeHtml((contract.endpoints || []).join("、"))}</small>
    </div>
    <div>
      <strong>对接对象</strong>
      <span>${escapeHtml((contract.targetSystems || []).map(displayText).join("、"))}</span>
    </div>
    ${(alerts || []).length ? alerts.map((item) => `<div>
      <strong>${escapeHtml(displayText(item.type))}</strong>
      <span>${escapeHtml(item.detail || "")}</span>
    </div>`).join("") : `<div><strong>暂无监管提醒</strong><span>准入、目录变更和护士资质均无待办。</span></div>`}
  `;
}

function renderProductionIntegration(integration) {
  const target = document.querySelector("#nursing-production-integration");
  if (!target) return;
  const connectors = integration.hospitalConnectors || [];
  const evidence = integration.evidence || {};
  target.innerHTML = `
    <div>
      <strong>${escapeHtml(integration.version || "internet-nursing-production-integration-v1")}</strong>
      <span>网关 ${escapeHtml(displayText(integration.gatewayMode || integration.messageGateway?.status || "contract-ready"))}</span>
      <small>签名附件 ${escapeHtml(evidence.signedConsentAttachments || 0)}，通知投递 ${escapeHtml(evidence.notificationDeliveries || 0)}，兜底 ${escapeHtml(evidence.fallbackCollection || "taskMessages")}</small>
    </div>
    ${connectors.map((item) => `<div>
      <strong>${escapeHtml(displayText(item.system))}</strong>
      <span>${escapeHtml(item.route || "")}</span>
      <small>${escapeHtml(displayText(item.status || "mapped"))} / ${escapeHtml(item.auth || "HMAC + idempotency-key")}</small>
    </div>`).join("")}
  `;
}

function renderPaymentReadiness(payment) {
  const target = document.querySelector("#nursing-payment-readiness");
  if (!target) return;
  const rows = (payment.paymentRows || []).slice(0, 4);
  target.innerHTML = `
    <div>
      <strong>${escapeHtml(payment.version || "internet-nursing-payment-v1")}</strong>
      <span>合计 ${escapeHtml(payment.totalEstimate || 0)} / 医保预估 ${escapeHtml(payment.insuranceEstimate || 0)} / 自费 ${escapeHtml(payment.selfPayEstimate || 0)}</span>
      <small>${escapeHtml((payment.modes || []).map(displayText).join("、"))}</small>
    </div>
    ${rows.map((item) => `<div>
      <strong>${escapeHtml(item.orderId)} · ${escapeHtml(displayText(item.serviceItem))}</strong>
      <span>${escapeHtml(displayText(item.paymentStatus))} / ${escapeHtml(displayText(item.reconciliationStatus))}</span>
      <small>发票 ${escapeHtml(displayText(item.invoiceStatus))}，自费 ${escapeHtml(item.estimatedSelfPay || 0)}</small>
      <small>${escapeHtml(nursingFinancialControlText(item.financialControl))}</small>
    </div>`).join("")}
  `;
}

function renderDeviceVerification(device) {
  const target = document.querySelector("#nursing-device-verification");
  if (!target) return;
  target.innerHTML = `
    <div>
      <strong>${escapeHtml(device.version || "internet-nursing-device-verification-v1")}</strong>
      <span>护士设备 ${escapeHtml(device.readyNurses || 0)}/${escapeHtml(device.totalNurses || 0)}，轨迹核验 ${escapeHtml(Math.round(Number(device.traceVerificationRate || 0) * 100))}%</span>
      <small>${escapeHtml((device.requiredSignals || []).map(displayText).join("、"))}</small>
    </div>
    <div>
      <strong>异常升级</strong>
      <span>${escapeHtml(displayText(device.exceptionEscalation || "riskQueue + taskMessages"))}</span>
      <small>照片/附件 ${escapeHtml(displayText(device.photoAttachmentStatus || "contract-ready"))}，开始结束距离 ${escapeHtml(device.startEndDistanceMeters || 500)} 米</small>
    </div>
  `;
}

function renderRegulatorySubmission(submission) {
  const target = document.querySelector("#nursing-regulatory-submission");
  if (!target) return;
  const pressure = submission.pressureTest || {};
  target.innerHTML = `
    <div>
      <strong>${escapeHtml(submission.packageId || submission.version || "internet-nursing-regulatory-submission-v1")}</strong>
      <span>记录 ${escapeHtml(submission.records || 0)}，高风险实时 ${escapeHtml(submission.highRiskRealtime || 0)}</span>
      <small>压测 ${escapeHtml(displayText(pressure.status || "passed"))} / 样本 ${escapeHtml(pressure.sampleSize || 0)} / P95 ${escapeHtml(pressure.p95Ms || 0)}ms</small>
    </div>
    <div>
      <strong>字段映射</strong>
      <span>${escapeHtml((submission.fieldCoverage || []).map((item) => displayText(item.field)).join("、"))}</span>
      <small>${escapeHtml((submission.signoffStatus || []).map((item) => `${displayText(item.owner)}:${displayText(item.status)}`).join("；"))}</small>
    </div>
  `;
}

function renderSiteCutoverPack(pack) {
  const target = document.querySelector("#nursing-site-cutover-pack");
  if (!target) return;
  const tracks = Array.isArray(pack.tracks) ? pack.tracks : [];
  const blockers = Array.isArray(pack.productionBlockers) ? pack.productionBlockers : [];
  target.innerHTML = `
    <div>
      <strong>${escapeHtml(displayText(pack.status || "ready-for-site-signoff"))}</strong>
      <span>${escapeHtml(tracks.filter((item) => item.status === "ready-for-site-signoff").length)} / ${escapeHtml(tracks.length)} 条签字轨道就绪</span>
      <small>${escapeHtml(pack.template || "release/templates/production-signoff/README.md")}</small>
    </div>
    <div>
      <strong>${escapeHtml(displayText(pack.productionReadiness || "production-blocked"))}</strong>
      <span>${escapeHtml(blockers.length)} 项生产阻断</span>
      <small>模块轨道就绪不等于正式生产可发，需完成环境配置和现场签字</small>
    </div>
    <div>
      <strong>发布证据</strong>
      <span>${escapeHtml(pack.auditRetentionEvidence || "release/audit-retention-report.md")}</span>
      <small>${escapeHtml(pack.productionCutoverEvidence || "release/production-cutover-checklist.md")}</small>
    </div>
    ${blockers.map((item) => `<div>
      <strong>${escapeHtml(displayText(item.source || item.id))}</strong>
      <span>${escapeHtml(displayText(item.name || ""))} / ${escapeHtml(displayText(item.detail || ""))}</span>
      <small>${escapeHtml(item.requiredAction || "")}</small>
    </div>`).join("")}
    ${tracks.map((item) => `<div>
      <strong>${escapeHtml(displayText(item.id))}</strong>
      <span>${escapeHtml(item.owner || "")} / ${escapeHtml(displayText(item.status || ""))}</span>
      <small>${escapeHtml((item.evidence || []).map(displayText).join("、"))}</small>
      <small>${escapeHtml(item.blockingUntil || "")}</small>
    </div>`).join("")}
  `;
}

function renderNursingInnovationCenter(center) {
  const target = document.querySelector("#nursing-highlight-center");
  if (!target) return;
  const features = Array.isArray(center.features) ? center.features : [];
  const highRisk = (center.riskScores || []).filter((item) => item.band === "high").length;
  const qualityIssues = center.qualityControl?.issueCount || 0;
  const blockers = center.evidenceWorkbench?.blockerCount || 0;
  target.innerHTML = features.length ? `
    <div>
      <strong>亮点上线概览</strong>
      <span>${escapeHtml(features.length)} 项亮点已接入 dashboard：高风险评分 ${escapeHtml(highRisk)} 单，质控提示 ${escapeHtml(qualityIssues)} 条，生产阻断 ${escapeHtml(blockers)} 项。</span>
      <small>覆盖 AI 智能派单、风险评分、实时轨迹、视频评估、语音记录、家属协同、质量质控、监管驾驶舱、支付闭环和上线证据工作台。</small>
    </div>
    ${features.map((item) => `<div>
      <strong>${escapeHtml(displayText(item.title || item.id))}</strong>
      <span>${escapeHtml(displayText(item.detail || item.status || "runnable"))}</span>
      <small>${escapeHtml(displayText(item.gate || ""))}</small>
    </div>`).join("")}
  ` : `
    <div>
      <strong>亮点能力中心待生成</strong>
      <span>请刷新 API 或使用静态预览数据生成 10 个亮点功能摘要。</span>
    </div>
  `;
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

function renderNursingDistrictSelect(institutions) {
  const select = document.querySelector("#nursing-district-select");
  const institutionId = document.querySelector("#nursing-institution-select")?.value || "";
  if (!select) return;
  const current = select.value;
  const institution = institutions.find((item) => item.id === institutionId) || institutions.find((item) => item.published !== false) || {};
  const serviceArea = Array.isArray(institution.serviceArea) && institution.serviceArea.length
    ? institution.serviceArea
    : ["Zhongshan", "Xigang", "Shahekou", "Ganjingzi"];
  select.innerHTML = serviceArea
    .map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(displayText(item))}</option>`)
    .join("");
  if (serviceArea.includes(current)) select.value = current;
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
          <td>${escapeHtml(displayText(item.serviceItem || ""))}<br><small>${escapeHtml(nursingAddressText(item.address))}</small></td>
          <td>${escapeHtml(displayText(item.institution?.name || item.institutionName || ""))}<br><small>${escapeHtml(item.institutionCode || "")}</small></td>
          <td>${escapeHtml(displayText(item.nurse?.name || item.nurseName || "pending"))}<br><small>${escapeHtml(displayText(item.nurse?.registrationStatus || ""))}</small></td>
          <td>${statusBadge(item.firstVisitAssessment)} ${statusBadge(item.informedConsent)} ${statusBadge(item.locationTrace)}<br><small>${escapeHtml(consentAttachmentText(item))}</small><br><small>${escapeHtml(locationTraceSummary(item))}</small><br><small>${escapeHtml(notificationSummary(item))}</small><br><small>${escapeHtml(nursingServiceControlText(item))}</small></td>
          <td>${statusBadge(item.status)} ${statusBadge(item.riskLevel)}<br><small>${escapeHtml(displayText(item.qualityCallback || ""))}</small><br><small>${escapeHtml(nursingRiskQualityControlText(item))}</small><br><small>${escapeHtml(nursingSchedulingControlText(item))}</small><br><small>${escapeHtml(nursingCancellationRefundControlText(item))}</small><br><small>${escapeHtml(nursingTimelineNotificationControlText(item))}</small></td>
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
          <td>${escapeHtml(item.preferredAt || "")}<br><small>${escapeHtml(nursingAddressText(item.address))}</small></td>
          <td>${escapeHtml(displayText(item.residentName || item.residentId || ""))}<br><small>${escapeHtml(displayText(item.serviceObject || ""))}</small></td>
          <td>${nursingEvidenceBadge("首诊", item.firstVisitAssessment, "首诊待评估")} ${nursingEvidenceBadge("同意书", item.informedConsent, "同意书待签署")} ${nursingEvidenceBadge("轨迹", item.locationTrace, "轨迹待采集")} ${nursingEvidenceBadge("护理记录", item.serviceRecordStatus, "护理记录待填写")}<br><small>${escapeHtml(locationTraceSummary(item))}</small><br><small>${escapeHtml(serviceRecordSummary(item))}</small><br><small>${escapeHtml(notificationReceiptSummary(item))}</small><br><small>${escapeHtml(nursingServiceControlText(item))}</small></td>
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
      <p>${escapeHtml(nursingAddressText(item.address))}</p>
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
      <p>${escapeHtml(nursingAddressText(item.address))}</p>
      <div class="nursing-mobile-evidence">
        ${nursingEvidenceBadge("首诊", item.firstVisitAssessment, "首诊待评估")}
        ${nursingEvidenceBadge("同意书", item.informedConsent, "同意书待签署")}
        ${nursingEvidenceBadge("轨迹", item.locationTrace, "轨迹待采集")}
        ${nursingEvidenceBadge("护理记录", item.serviceRecordStatus, "护理记录待填写")}
        ${statusBadge(item.riskLevel)}
      </div>
      <small>${escapeHtml(locationTraceSummary(item))}</small>
      <small>${escapeHtml(serviceRecordSummary(item))}</small>
      <small>${escapeHtml(notificationReceiptSummary(item))}</small>
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
    if (button.disabled) return;
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
  if (!item.nurseId || ["requested", "dispatched"].includes(item.status)) {
    const blockReason = nurseAcceptBlockReason(item);
    if (blockReason) {
      actions.push(`<button class="inline-action" type="button" disabled aria-disabled="true" title="${escapeHtml(blockReason)}">${escapeHtml(blockReason)}</button>`);
    } else {
      actions.push(`<button class="inline-action" type="button" data-nurse-action="${escapeHtml(item.id)}" data-action-kind="accept">接单</button>`);
    }
  }
  if (item.status === "accepted") actions.push(["start", "开始服务"]);
  if (item.status === "in-service") actions.push(["complete", "完成记录"]);
  return actions.length
    ? actions.map((action) => Array.isArray(action) ? `<button class="inline-action" type="button" data-nurse-action="${escapeHtml(item.id)}" data-action-kind="${escapeHtml(action[0])}">${escapeHtml(action[1])}</button>` : action).join("")
    : `<span class="badge info">暂无可操作</span>`;
}

function hasSignedNursingConsent(item) {
  const attachment = item?.consentAttachment || {};
  return item?.informedConsent === "signed" &&
    attachment.status === "signed" &&
    Boolean(attachment.signedAt) &&
    Boolean(attachment.signerName) &&
    Boolean(attachment.version);
}

function nurseAcceptBlockReason(item) {
  if (item.firstVisitAssessment !== "passed") return "需先完成首诊评估";
  if (!hasSignedNursingConsent(item)) return "需先签署知情同意";
  return "";
}

function nursingEvidenceBadge(label, status, pendingLabel) {
  const text = String(status ?? "pending");
  const danger = ["high", "blocked", "overdue"].includes(text);
  const warn = ["medium", "pending", "requested", "assessed", "dispatched", "accepted", "in-service", "tracking", "reschedule-requested", "no-show-review"].includes(text);
  const type = danger ? "danger" : warn ? "warn" : "info";
  const content = text === "pending" ? pendingLabel : `${label}${displayText(text)}`;
  return `<span class="badge ${type}">${escapeHtml(content)}</span>`;
}

function nursingAddressText(value) {
  const text = displayText(value || "");
  if (/已脱敏[-\s]*[A-Za-z]*$/i.test(text) || /redacted/i.test(text)) return "地址已脱敏";
  return text;
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
    const submit = form.querySelector("button[type='submit']");
    if (submit?.disabled) return;
    let values = Object.fromEntries(new FormData(form).entries());
    const domain = window.NursingEscortDomain;
    if (domain) {
      const preferredDate = String(values.preferredAt || "");
      const preferredTime = String(values.serviceTime || "09:30");
      const institution = (nursingDashboard?.institutions || []).find((item) => item.id === values.institutionId) || {};
      values = domain.buildNursingOrderIntakeEvidence(values, {
        preferredAt: `${preferredDate}T${preferredTime}:00+08:00`,
        durationMinutes: Number(values.durationMinutes),
        district: values.district,
        address: values.address,
        lat: Number(values.lat),
        lng: Number(values.lng)
      });
      const intake = domain.validateNursingOrderIntake(values, {
        now: new Date(),
        institution,
        orders: nursingDashboard?.orders || []
      });
      if (!intake.ok) {
        showNursingMessage(`预约门禁未通过：${intake.reasons.join("；")}`, "danger");
        return;
      }
    }
    values.sourceChannel = "internet-nursing-mobile";
    if (submit) submit.disabled = true;
    try {
      if (NURSING_API_BASE) {
        const request = window.HealthCityAuth?.authFetch || fetch;
        const response = await request(`${NURSING_API_BASE}/internet-nursing/orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify(values)
        });
        if (!response.ok) {
          const detail = await response.json().catch(() => ({}));
          throw new Error(detail.message || `互联网护理预约提交失败：${response.status}`);
        }
      } else {
        const localOrder = { ...values, id: `ino-local-${crypto.randomUUID()}`, status: "requested", firstVisitAssessment: "pending", informedConsent: "pending", consentAttachment: { status: "pending", required: true, version: "internet-nursing-consent-v1" }, locationTrace: "pending", locationTracePoints: [], serviceRecordStatus: "pending", qualityCallback: "pending" };
        localOrder.notificationDeliveries = staticNotificationDeliveries(localOrder);
        nursingDashboard.orders.unshift(localOrder);
      }
      form.reset();
      if (dateInput) dateInput.value = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      showNursingMessage("预约已提交，医院端将进行首诊评估。");
      await loadInternetNursingDashboard();
    } catch (error) {
      showNursingMessage(error.message || "预约提交失败，请稍后重试。", "danger");
    } finally {
      if (submit) submit.disabled = false;
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
  return {
    nurseId,
    status: "completed",
    serviceRecordStatus: "completed",
    qualityCallback: "pending",
    tracePoint: { stage: "service-complete", lat: 38.916, lng: 121.617, source: "nurse-mobile" },
    serviceRecord: {
      status: "completed",
      vitalSigns: { temperature: "36.6", pulse: "78", bloodPressure: "126/78" },
      careActions: ["核对身份与医嘱", "完成上门护理操作", "居民状态复核", "健康教育与随访交代"],
      materialsUsed: ["一次性护理包", "消毒用品"],
      residentCondition: "服务后状态平稳",
      followupAdvice: "如出现不适及时联系签约机构或急救电话",
      exceptionReport: { status: "none", level: "", description: "" }
    },
    serviceAttachments: [
      { type: "nursing-record-photo", name: "service-record-photo.jpg", source: "nurse-mobile" },
      { type: "resident-signature", name: "resident-service-confirmation.png", source: "nurse-mobile" }
    ],
    notificationReceipts: [
      { by: "nurse-mobile", role: "nurse", status: "read" }
    ],
    action: "service-complete",
    note: "护理记录、附件和消息回执已完成，等待质量回访。"
  };
}

async function updateNursingOrder(id, payload) {
  try {
    if (NURSING_API_BASE) {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${NURSING_API_BASE}/internet-nursing/orders/${encodeURIComponent(id)}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
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
  if (payload.action) {
    updates.notificationDeliveries = [...staticNotificationDeliveries({ ...item, ...updates }), ...(Array.isArray(item.notificationDeliveries) ? item.notificationDeliveries : [])].slice(0, 50);
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
    serviceCatalog: ["daily living ability assessment", "vital signs measurement", "blood glucose measurement", "wound care", "wound and ostomy care", "tube care", "intravenous catheter maintenance", "peritoneal dialysis care", "postpartum care", "infant care", "PICC maintenance"],
    requiredEvidence: ["identity authentication", "first diagnosis assessment", "clinical assessment", "signed informed consent", "consent storage receipt", "nurse practice certificate", "service equipment readiness", "specialist protocol evidence", "service location trace", "nursing record", "medical waste handover", "EMR archive receipt", "price snapshot", "quality callback"],
    riskControls: ["emergency plan", "one-click alert", "liability insurance", "medical accident insurance", "service recorder"],
    platformRequirements: ["grade-3 security protection", "privacy protection", "medical record storage", "traceable service behavior", "workload statistics"],
    p1Lifecycle: {
      version: "internet-nursing-p1-v1",
      tracks: [
        "structured clinical assessment and consent storage",
        "service area slot duration and idempotency",
        "specialist nursing protocols",
        "order price snapshot and financial reconciliation",
        "complaint and incident SLA",
        "resident timeline and notification receipts"
      ],
      intakePolicyVersion: "internet-nursing-intake-v1",
      writePathVersion: "internet-nursing-write-path-v1",
      eventOutboxVersion: "internet-nursing-event-outbox-v1",
      assessmentPolicyVersion: "internet-nursing-assessment-v1",
      priceCatalogVersion: "internet-nursing-price-2026-v1",
      specialistProtocols: [
        "intravenous-catheter-maintenance-v1",
        "wound-ostomy-care-v1",
        "peritoneal-dialysis-care-v1"
      ]
    },
    pricingRules: {
      items: {
        "blood glucose measurement": { basePrice: 86, insuranceEligible: true },
        "wound care": { basePrice: 168, insuranceEligible: true },
        "PICC maintenance": { basePrice: 260, insuranceEligible: true }
      }
    },
    regulatoryContract: defaultRegulatoryContract()
  };
}

function defaultRegulatoryContract() {
  return {
    version: "internet-nursing-regulatory-contract-v1",
    endpoints: ["/api/internet-nursing/dashboard", "/api/internet-nursing/orders", "/api/internet-nursing/orders/:id/actions"],
    exchangeObjects: ["internetNursingInstitutions", "internetNursingNurses", "internetNursingOrders", "taskMessages"],
    targetSystems: ["nursing management system", "EMR", "medical insurance settlement", "health supervision platform"]
  };
}

function defaultProductionIntegration() {
  return {
    version: "internet-nursing-production-integration-v1",
    gatewayMode: "simulation-contract-ready",
    messageGateway: { status: "contract-ready", channels: ["sms", "hospital_message", "in_app"], fallback: "taskMessages" },
    signatureStorage: { status: "contract-ready", bucket: "medical-consent-attachments", retentionYears: 15, hashAlgorithm: "SHA-256" },
    hospitalConnectors: [
      { system: "nursing management system", route: "/integration/internet-nursing/orders", status: "mapped", auth: "HMAC + idempotency-key" },
      { system: "EMR", route: "/integration/internet-nursing/service-records", status: "mapped", auth: "HMAC + resident consent" },
      { system: "health supervision platform", route: "/integration/internet-nursing/regulatory-report", status: "mapped", auth: "HMAC + signoff" }
    ],
    cutoverChecklist: ["message gateway signoff", "signature storage signoff", "hospital connector signoff", "fallback drill"]
  };
}

function defaultPaymentIntegration() {
  return {
    version: "internet-nursing-payment-v1",
    modes: ["medical insurance e-voucher pre-check", "mobile self-pay", "refund", "invoice", "daily reconciliation"],
    reconciliationCycle: "T+1",
    invoiceProvider: "electronic invoice platform",
    status: "contract-ready"
  };
}

function defaultDeviceVerification() {
  return {
    version: "internet-nursing-device-verification-v1",
    requiredSignals: ["mobile GPS", "nurse location device", "service recorder", "one-click alert", "photo attachment"],
    startEndDistanceMeters: 500,
    exceptionEscalation: "riskQueue + taskMessages",
    status: "contract-ready"
  };
}

function defaultRegulatorySubmission() {
  return {
    version: "internet-nursing-regulatory-submission-v1",
    mappedFields: ["institution", "nurse", "order", "risk", "trace", "settlement", "quality", "adverseEvent"],
    submissionCycle: "monthly + high-risk realtime",
    pressureTest: { status: "passed", sampleSize: 1000, p95Ms: 420 },
    signoffs: ["hospital nursing department", "health commission supervision", "platform operations"]
  };
}

function defaultNursingInstitutions() {
  const regional = window.HealthRegionalContext;
  const centralHospital = regional.organization("centralHospital");
  const communityHealthCenter = regional.organization("communityHealthCenter");
  const primaryDistrict = regional.area("primaryDistrict").name;
  const secondaryDistrict = regional.area("secondaryDistrict").name;
  const tertiaryDistrict = regional.area("tertiaryDistrict").name;
  return [
    { id: "inh-mr1", institutionCode: centralHospital.code, name: centralHospital.name, district: primaryDistrict, published: true, serviceArea: [primaryDistrict, secondaryDistrict, tertiaryDistrict], serviceItems: ["wound care", "wound and ostomy care", "intravenous catheter maintenance", "peritoneal dialysis care", "PICC maintenance", "blood glucose measurement"], dailyCapacity: 18, admissionReview: { status: "approved" }, catalogChangeRequests: [] },
    { id: "inh-mr3", institutionCode: communityHealthCenter.code, name: communityHealthCenter.name, district: primaryDistrict, published: true, serviceArea: [primaryDistrict], serviceItems: ["vital signs measurement", "tube care"], dailyCapacity: 10, admissionReview: { status: "approved" }, catalogChangeRequests: [] }
  ];
}

function defaultNursingNurses() {
  const regional = window.HealthRegionalContext;
  const centralHospital = regional.organization("centralHospital");
  const communityHealthCenter = regional.organization("communityHealthCenter");
  return [
    { id: "inn-001", name: "孙护士", institutionId: "inh-mr1", institutionCode: centralHospital.code, title: "主管护师", yearsClinical: 9, registrationStatus: "verified", badPracticeRecord: "none", trainingStatus: "passed", insuranceStatus: "covered", specialties: ["wound care", "wound and ostomy care", "intravenous catheter maintenance", "peritoneal dialysis care", "PICC maintenance", "blood glucose measurement"], dailyCapacity: 6, assignedToday: 2, qualificationExpiresAt: "2026-12-31", status: "available" },
    { id: "inn-002", name: "赵护士", institutionId: "inh-mr3", institutionCode: communityHealthCenter.code, title: "专科护士", yearsClinical: 6, registrationStatus: "verified", badPracticeRecord: "none", trainingStatus: "passed", insuranceStatus: "covered", specialties: ["vital signs measurement", "tube care"], dailyCapacity: 5, assignedToday: 1, qualificationExpiresAt: "2026-09-30", status: "available" }
  ];
}

function defaultNursingOrders() {
  const regional = window.HealthRegionalContext;
  const centralHospital = regional.organization("centralHospital");
  const communityHealthCenter = regional.organization("communityHealthCenter");
  const primaryDistrict = regional.area("primaryDistrict").name;
  return [
    { id: "ino-001", residentId: "r1", residentName: "演示居民A", institutionId: "inh-mr1", institutionCode: centralHospital.code, institutionName: centralHospital.name, nurseId: "inn-001", nurseName: "孙护士", serviceItem: "wound care", serviceObject: "mobility-limited chronic disease patient", preferredAt: new Date(Date.now() + 86400000).toISOString().slice(0, 10), address: `${primaryDistrict}示例地址`, firstVisitAssessment: "passed", informedConsent: "signed", riskLevel: "medium", status: "dispatched", locationTrace: "pending", serviceRecordStatus: "pending", serviceRecord: { status: "pending", attachments: [], attachmentCount: 0 }, serviceAttachments: [], notificationReceiptSummary: { status: "pending", sent: 0, queued: 0, read: 0, failed: 0 }, qualityCallback: "pending", feeEstimate: 168, settlement: { mode: "medical insurance pre-check", estimatedSelfPay: 58, insuranceEstimate: 110, paymentStatus: "pending" }, satisfaction: { score: 0, status: "pending" }, complaintStatus: "none", qualityInspection: { status: "pending" }, adverseEvent: { status: "none" } },
    { id: "ino-002", residentId: "r2", residentName: "演示居民B", institutionId: "inh-mr3", institutionCode: communityHealthCenter.code, institutionName: communityHealthCenter.name, nurseId: "inn-002", nurseName: "赵护士", serviceItem: "blood glucose measurement", serviceObject: "elderly or disabled people", preferredAt: new Date().toISOString().slice(0, 10), address: `${primaryDistrict}示例家庭地址`, firstVisitAssessment: "passed", informedConsent: "signed", riskLevel: "low", status: "accepted", locationTrace: "tracking", serviceRecordStatus: "in-progress", serviceRecord: { id: "record-ino-002", status: "in-progress", nurseId: "inn-002", nurseName: "赵护士", serviceItem: "blood glucose measurement", vitalSigns: { bloodGlucose: "6.8 mmol/L" }, careActions: ["核对身份", "测量血糖", "记录用药与饮食建议"], attachments: [{ id: "attach-ino-002-1", type: "nursing-record-photo", name: "blood-glucose-meter-photo.jpg", source: "nurse-mobile", status: "stored" }], attachmentCount: 1, exceptionReport: { status: "none" } }, serviceAttachments: [{ id: "attach-ino-002-1", type: "nursing-record-photo", name: "blood-glucose-meter-photo.jpg", source: "nurse-mobile", status: "stored" }], notificationReceiptSummary: { status: "tracked", sent: 2, queued: 1, read: 1, failed: 0 }, qualityCallback: "pending", feeEstimate: 86, settlement: { mode: "medical insurance pre-check", estimatedSelfPay: 36, insuranceEstimate: 50, paymentStatus: "prechecked" }, satisfaction: { score: 0, status: "pending" }, complaintStatus: "none", qualityInspection: { status: "sampled" }, adverseEvent: { status: "none" } }
  ];
}

function isQualifiedNurse(item) {
  const domain = window.NursingEscortDomain;
  if (domain) return domain.validateNurseQualification(item, {}, { now: new Date() }).ok;
  return Number(item.yearsClinical || 0) >= 5 && item.registrationStatus === "verified" && item.badPracticeRecord === "none" && item.trainingStatus === "passed" && item.insuranceStatus === "covered";
}

function statusBadge(status) {
  const text = String(status ?? "unknown");
  const danger = ["high", "blocked", "overdue"].includes(text);
  const warn = ["medium", "pending", "requested", "assessed", "dispatched", "accepted", "in-service", "tracking", "reschedule-requested", "no-show-review"].includes(text);
  const type = danger ? "danger" : warn ? "warn" : "info";
  return `<span class="badge ${type}">${escapeHtml(displayText(text))}</span>`;
}

function displayText(value) {
  const text = String(value ?? "");
  const regionalText = window.HealthRegionalContext?.localizeText(text) || text;
  if (regionalText !== text) return regionalText;
  const labels = {
    "Liaoning Internet+ Nursing pilot implementation plan": "辽宁省互联网+护理服务试点实施方案",
    "pilot policy": "试点政策",
    "Nurse Sun": "孙护士",
    "Nurse Zhao": "赵护士",
    "Nurse Liu": "刘护士",
    "Demo resident A": "演示居民A",
    "Demo resident B": "演示居民B",
    "Demo resident C": "演示居民C",
    "daily living ability assessment": "日常生活能力评估",
    "vital signs measurement": "生命体征测量",
    "blood glucose measurement": "血糖测量",
    "wound care": "伤口护理",
    "wound and ostomy care": "伤口造口护理",
    "tube care": "管路护理",
    "intravenous catheter maintenance": "静脉导管维护",
    "peritoneal dialysis care": "腹膜透析护理",
    "postpartum care": "产后护理",
    "infant care": "婴幼儿护理",
    "PICC maintenance": "PICC 维护",
    "nursing management system": "院内护理管理系统",
    "EMR": "电子病历",
    "medical insurance settlement": "医保结算",
    "health supervision platform": "监管平台",
    "internet-nursing-production-integration-v1": "互联网护理生产集成 v1",
    "internet-nursing-payment-v1": "互联网护理支付对账 v1",
    "internet-nursing-device-verification-v1": "互联网护理设备核验 v1",
    "internet-nursing-regulatory-submission-v1": "互联网护理监管报送 v1",
    "simulation-contract-ready": "仿真契约已就绪",
    "contract-ready": "契约已就绪",
    "mapped": "已映射",
    "in_app": "院内应用",
    "hospital_message": "医院消息",
    "sms": "短信",
    "sent": "已发送",
    "queued": "待发送",
    "read": "已读",
    "failed": "发送失败",
    "pending_disposition": "待处置",
    "medical insurance e-voucher pre-check": "医保电子凭证预核",
    "mobile self-pay": "移动自费支付",
    "refund": "退费",
    "invoice": "电子发票",
    "daily reconciliation": "日终对账",
    "invoice-ready": "可开票",
    "waiting-service-complete": "待服务完成",
    "precheck-matched": "预核匹配",
    "mobile GPS": "手机 GPS",
    "nurse location device": "护士定位设备",
    "service recorder": "服务记录仪",
    "one-click alert": "一键报警",
    "photo attachment": "照片附件",
    "riskQueue + taskMessages": "风险队列 + 任务消息",
    "monthly + high-risk realtime": "月报 + 高风险实时",
    "institution": "机构",
    "nurse": "护士",
    "order": "订单",
    "risk": "风险",
    "trace": "轨迹",
    "settlement": "结算",
    "quality": "质控",
    "adverseEvent": "不良事件",
    "hospital nursing department": "医院护理部",
    "health commission supervision": "卫健监管",
    "platform operations": "平台运维",
    "ready-for-site-signoff": "待现场签字",
    "production-ready": "生产可发",
    "production-blocked": "生产阻断",
    "audit-retention": "审计留存",
    "site-interface-signoff": "接口联调签字",
    "insurance-certificate-signoff": "医保与证照签字",
    "monitoring-signoff": "监控值守签字",
    "dr-rehearsal-signoff": "灾备演练签字",
    "node-env": "生产运行模式",
    "storage-engine": "生产存储引擎",
    "session-secrets": "会话密钥",
    "gateway-secret": "接口网关密钥",
    "identity-adapter": "身份认证适配",
    "nursing-cutover-message-signature": "消息与签名存储签字",
    "nursing-cutover-hospital-connectors": "院内接口联调签字",
    "nursing-cutover-payment-reconciliation": "支付对账验收签字",
    "nursing-cutover-device-drill": "设备现场实测签字",
    "nursing-cutover-regulatory-pressure-test": "监管报送压测签字",
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
    "appointment-submitted": "预约已提交",
    "dispatch-qualified-nurse": "已派合格护士",
    "nurse-accept": "护士已接单",
    "service-start": "服务已开始",
    "service-complete": "服务已完成",
    "quality-review": "质量回访",
    "location-check": "位置核验",
    "self-pay estimate": "自费预估",
    "medical insurance pre-check": "医保预核",
    "prechecked": "已预核",
    "submitted": "已提交",
    "sampled": "已抽查",
    "required": "需抽查",
    "institution-admission": "机构准入",
    "catalog-change": "目录变更",
    "nurse-qualification-expiry": "护士资质到期",
    "grade-3 security protection": "等保三级防护",
    "privacy protection": "隐私保护",
    "medical record storage": "病历资料留存",
    "traceable service behavior": "服务行为可追溯",
    "workload statistics": "工作量统计",
    "emergency plan": "应急预案",
    "liability insurance": "责任保险",
    "medical accident insurance": "医疗事故保险",
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
  labels["reschedule-requested"] = "改约待审核";
  labels["no-show-review"] = "爽约待复核";
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
