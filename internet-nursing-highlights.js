(function initInternetNursingHighlights(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.InternetNursingHighlights = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : window, function buildFactory() {
  const HIGHLIGHT_FEATURES = [
    { id: "smart-dispatch", title: "AI 智能派单 2.0", gate: "nursing:highlightSmartDispatch" },
    { id: "risk-score", title: "居家护理风险评分", gate: "nursing:highlightRiskScore" },
    { id: "live-trace", title: "护士上门服务实时地图", gate: "nursing:highlightLiveTrace" },
    { id: "video-consent", title: "服务前视频评估与电子知情同意", gate: "nursing:highlightVideoConsent" },
    { id: "voice-record", title: "护理记录语音转结构化", gate: "nursing:highlightVoiceRecord" },
    { id: "family-collaboration", title: "家属协同与授权陪护视图", gate: "nursing:highlightFamilyCollaboration" },
    { id: "quality-control", title: "护理质量智能质控", gate: "nursing:highlightQualityControl" },
    { id: "regulatory-dashboard", title: "监管驾驶舱专题页", gate: "nursing:highlightRegulatoryDashboard" },
    { id: "payment-closure", title: "医保/自费/商保支付闭环", gate: "nursing:highlightPaymentClosure" },
    { id: "evidence-workbench", title: "现场上线证据工作台", gate: "nursing:highlightEvidenceWorkbench" }
  ];

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function signedConsent(order) {
    return order?.informedConsent === "signed" && order?.consentAttachment?.status === "signed";
  }

  function hasTrace(order) {
    return asArray(order?.locationTracePoints).length >= 2 || order?.locationTrace === "tracking";
  }

  function isClosed(order) {
    return ["completed", "closed", "cancelled"].includes(String(order?.status || ""));
  }

  function isQualifiedNurse(nurse) {
    return number(nurse?.yearsClinical) >= 5 &&
      nurse?.registrationStatus === "verified" &&
      nurse?.badPracticeRecord === "none" &&
      nurse?.trainingStatus === "passed" &&
      nurse?.insuranceStatus === "covered";
  }

  function riskScore(order) {
    const reasons = [];
    let score = order?.riskLevel === "high" ? 45 : order?.riskLevel === "medium" ? 25 : 12;
    if (["PICC maintenance", "wound care", "tube care"].includes(order?.serviceItem)) {
      score += 10;
      reasons.push("高风险服务项目");
    }
    if (order?.firstVisitAssessment !== "passed") {
      score += 14;
      reasons.push("首诊评估未完成");
    }
    if (!signedConsent(order)) {
      score += 12;
      reasons.push("知情同意未签署");
    }
    if (!order?.nurseId) {
      score += 10;
      reasons.push("尚未派单");
    }
    if (!hasTrace(order) && ["accepted", "in-service", "completed", "closed"].includes(String(order?.status || ""))) {
      score += 10;
      reasons.push("轨迹证据不足");
    }
    if (order?.complaintStatus && order.complaintStatus !== "none") {
      score += 8;
      reasons.push("存在投诉");
    }
    if (order?.adverseEvent?.status && order.adverseEvent.status !== "none") {
      score += 10;
      reasons.push("存在不良事件");
    }
    if (!reasons.length) reasons.push("常规监测");
    const finalScore = Math.min(100, score);
    return {
      orderId: order?.id || "",
      residentId: order?.residentId || "",
      residentName: order?.residentName || order?.residentId || "",
      serviceItem: order?.serviceItem || "",
      score: finalScore,
      band: finalScore >= 75 ? "high" : finalScore >= 45 ? "medium" : "low",
      reasons
    };
  }

  function buildDispatchInsights(orders, nurses, dispatchRecommendations) {
    const qualified = asArray(nurses).filter(isQualifiedNurse);
    const rows = asArray(dispatchRecommendations).length ? asArray(dispatchRecommendations) : asArray(orders)
      .filter((order) => !order.nurseId && !isClosed(order))
      .map((order) => ({
        orderId: order.id,
        residentId: order.residentId,
        serviceItem: order.serviceItem,
        riskLevel: order.riskLevel,
        candidates: qualified
          .filter((nurse) => !order.institutionId || nurse.institutionId === order.institutionId || nurse.institutionCode === order.institutionCode)
          .map((nurse) => ({
            nurseId: nurse.id,
            nurseName: nurse.name,
            remainingCapacity: Math.max(0, number(nurse.dailyCapacity) - number(nurse.assignedToday)),
            score: Math.max(0, number(nurse.dailyCapacity) - number(nurse.assignedToday)) + (order.riskLevel === "high" ? 3 : 0),
            reason: "资质合格、机构匹配、容量可用、风险等级适配"
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
      }));
    return {
      pendingOrders: rows.length,
      recommendedCandidates: rows.reduce((sum, row) => sum + asArray(row.candidates).length, 0),
      rows: rows.map((row) => ({
        ...row,
        explanation: row.candidates?.[0]
          ? `${row.candidates[0].nurseName || row.candidates[0].nurseId} 优先：资质、服务区域、容量和风险等级综合最优`
          : "暂无合格候选护士"
      }))
    };
  }

  function buildLiveTraceMonitor(orders) {
    const rows = asArray(orders).map((order) => {
      const points = asArray(order.locationTracePoints);
      const latest = points[points.length - 1] || null;
      return {
        orderId: order.id,
        residentName: order.residentName || order.residentId,
        status: order.status,
        traceStatus: hasTrace(order) ? "trace-ready" : "trace-missing",
        pointCount: points.length,
        latestPoint: latest,
        alert: !hasTrace(order) && ["accepted", "in-service", "completed", "closed"].includes(String(order.status || "")) ? "服务状态已有进展但轨迹点不足" : ""
      };
    });
    return {
      trackedOrders: rows.filter((row) => row.traceStatus === "trace-ready").length,
      missingTraceOrders: rows.filter((row) => row.traceStatus === "trace-missing").length,
      rows
    };
  }

  function buildVideoConsent(orders) {
    const rows = asArray(orders).map((order) => ({
      orderId: order.id,
      residentName: order.residentName || order.residentId,
      assessmentMode: order.preServiceAssessment?.mode || "video-precheck-ready",
      mediaCount: asArray(order.preServiceAssessment?.media).length || (signedConsent(order) ? 1 : 0),
      consentStatus: signedConsent(order) ? "signed" : "pending",
      consentVersion: order.consentAttachment?.version || "internet-nursing-consent-v1",
      hashReady: Boolean(order.consentAttachment?.hash)
    }));
    return {
      signedOrders: rows.filter((row) => row.consentStatus === "signed").length,
      videoReadyOrders: rows.filter((row) => row.mediaCount > 0).length,
      rows
    };
  }

  function buildVoiceRecords(orders) {
    const rows = asArray(orders).map((order) => {
      const record = order.serviceRecord || {};
      const actions = asArray(record.careActions);
      return {
        orderId: order.id,
        residentName: order.residentName || order.residentId,
        voiceStatus: record.voiceTranscript || actions.length ? "structured-draft-ready" : "waiting-nurse-input",
        extractedFields: [
          record.vitalSigns ? "vitalSigns" : "",
          actions.length ? "careActions" : "",
          asArray(record.materialsUsed).length ? "materialsUsed" : "",
          record.followupAdvice ? "followupAdvice" : ""
        ].filter(Boolean),
        draft: actions.length ? actions.join(" / ") : "等待护士语音录入"
      };
    });
    return {
      structuredDrafts: rows.filter((row) => row.voiceStatus === "structured-draft-ready").length,
      rows
    };
  }

  function buildFamilyCollaboration(orders) {
    const rows = asArray(orders).map((order) => {
      const familyContacts = asArray(order.familyContacts).length ? asArray(order.familyContacts) : [
        { name: "授权家属", relation: "family", notification: "in_app", status: "authorized" }
      ];
      return {
        orderId: order.id,
        residentName: order.residentName || order.residentId,
        authorizedContacts: familyContacts.filter((item) => item.status !== "revoked").length,
        notificationChannels: [...new Set(familyContacts.map((item) => item.notification || "in_app"))],
        visibleFields: ["服务进度", "风险提醒", "费用状态", "护理记录摘要", "满意度评价"]
      };
    });
    return {
      ordersWithFamilyView: rows.filter((row) => row.authorizedContacts > 0).length,
      rows
    };
  }

  function buildQualityControl(orders) {
    const issues = [];
    asArray(orders).forEach((order) => {
      if (order.firstVisitAssessment !== "passed") issues.push({ orderId: order.id, severity: "high", issue: "首诊评估未完成" });
      if (!signedConsent(order)) issues.push({ orderId: order.id, severity: "high", issue: "知情同意证据缺失" });
      if (["accepted", "in-service", "completed", "closed"].includes(String(order.status || "")) && !hasTrace(order)) issues.push({ orderId: order.id, severity: "medium", issue: "轨迹证据不足" });
      if (order.status === "completed" && order.qualityCallback !== "closed") issues.push({ orderId: order.id, severity: "medium", issue: "质控回访未关闭" });
      if (order.complaintStatus && order.complaintStatus !== "none") issues.push({ orderId: order.id, severity: "medium", issue: "投诉待复核" });
    });
    return {
      issueCount: issues.length,
      highSeverity: issues.filter((item) => item.severity === "high").length,
      passRate: asArray(orders).length ? Math.max(0, Math.round(((asArray(orders).length - new Set(issues.map((item) => item.orderId)).size) / asArray(orders).length) * 100)) : 100,
      issues
    };
  }

  function buildRegulatoryDashboard(orders, institutions, report) {
    const rows = asArray(report?.serviceVolumeByInstitution);
    return {
      serviceVolume: report?.serviceVolume ?? asArray(orders).length,
      completedServices: report?.completedServices ?? asArray(orders).filter((order) => ["completed", "closed"].includes(order.status)).length,
      highRiskOrders: asArray(orders).filter((order) => order.riskLevel === "high").length,
      traceCompletenessRate: report?.traceCompletenessRate ?? 0,
      complaintRate: report?.complaintRate ?? 0,
      institutionRankings: rows.length ? rows : asArray(institutions).map((institution) => ({ institutionId: institution.id, institutionName: institution.name, qualityScore: 0 }))
    };
  }

  function buildPaymentClosure(orders, paymentReadiness) {
    const rows = asArray(paymentReadiness?.paymentRows).length ? asArray(paymentReadiness.paymentRows) : asArray(orders).map((order) => ({
      orderId: order.id,
      serviceItem: order.serviceItem,
      paymentStatus: order.settlement?.paymentStatus || "pending",
      insuranceEstimate: order.settlement?.insuranceEstimate || 0,
      estimatedSelfPay: order.settlement?.estimatedSelfPay || 0,
      invoiceStatus: ["completed", "closed"].includes(order.status) ? "invoice-ready" : "waiting-service-complete",
      reconciliationStatus: order.settlement?.paymentStatus === "prechecked" ? "precheck-matched" : "pending"
    }));
    return {
      totalEstimate: paymentReadiness?.totalEstimate ?? rows.reduce((sum, item) => sum + number(item.feeEstimate), 0),
      precheckedOrders: rows.filter((item) => item.paymentStatus === "prechecked").length,
      invoiceReady: rows.filter((item) => item.invoiceStatus === "invoice-ready").length,
      reconciliationReady: rows.filter((item) => /matched|ready/i.test(item.reconciliationStatus || "")).length,
      rows
    };
  }

  function buildEvidenceWorkbench(siteCutoverPack) {
    const blockers = asArray(siteCutoverPack?.productionBlockers);
    const tracks = asArray(siteCutoverPack?.tracks);
    return {
      productionReadiness: siteCutoverPack?.productionReadiness || "production-blocked",
      blockers,
      blockerCount: blockers.length,
      readyTracks: tracks.filter((item) => item.ready || item.status === "ready-for-site-signoff").length,
      totalTracks: tracks.length,
      tasks: blockers.map((item) => ({
        id: item.id,
        owner: item.source || "platform-ops",
        action: item.requiredAction || "complete production evidence",
        status: "blocked"
      }))
    };
  }

  function buildInternetNursingInnovationCenter(input = {}) {
    const orders = asArray(input.orders);
    const nurses = asArray(input.nurses);
    const institutions = asArray(input.institutions);
    const riskScores = orders.map(riskScore);
    const smartDispatch = buildDispatchInsights(orders, nurses, input.dispatchRecommendations);
    const liveTrace = buildLiveTraceMonitor(orders);
    const videoConsent = buildVideoConsent(orders);
    const voiceRecords = buildVoiceRecords(orders);
    const familyCollaboration = buildFamilyCollaboration(orders);
    const qualityControl = buildQualityControl(orders);
    const regulatoryDashboard = buildRegulatoryDashboard(orders, institutions, input.regulatoryMonthlyReport);
    const paymentClosure = buildPaymentClosure(orders, input.paymentReadiness);
    const evidenceWorkbench = buildEvidenceWorkbench(input.siteCutoverPack);
    const features = HIGHLIGHT_FEATURES.map((feature) => {
      const detail = {
        "smart-dispatch": `${smartDispatch.pendingOrders} 个待派单订单，${smartDispatch.recommendedCandidates} 个候选护士`,
        "risk-score": `${riskScores.filter((item) => item.band === "high").length} 个高风险评分订单`,
        "live-trace": `${liveTrace.trackedOrders} 单有轨迹，${liveTrace.missingTraceOrders} 单待补轨迹`,
        "video-consent": `${videoConsent.signedOrders} 单已签署，${videoConsent.videoReadyOrders} 单可视频预评估`,
        "voice-record": `${voiceRecords.structuredDrafts} 单可生成结构化护理记录草稿`,
        "family-collaboration": `${familyCollaboration.ordersWithFamilyView} 单可开放家属授权视图`,
        "quality-control": `${qualityControl.issueCount} 条质控提示，质控通过率 ${qualityControl.passRate}%`,
        "regulatory-dashboard": `${regulatoryDashboard.serviceVolume} 单监管样本，机构排名已生成`,
        "payment-closure": `${paymentClosure.precheckedOrders} 单医保预核，${paymentClosure.invoiceReady} 单可开票`,
        "evidence-workbench": `${evidenceWorkbench.readyTracks}/${evidenceWorkbench.totalTracks} 现场轨道就绪，${evidenceWorkbench.blockerCount} 个生产阻断`
      }[feature.id];
      return { ...feature, status: "runnable", detail };
    });
    return {
      generatedAt: new Date().toISOString(),
      featureCount: features.length,
      features,
      riskScores,
      smartDispatch,
      liveTrace,
      videoConsent,
      voiceRecords,
      familyCollaboration,
      qualityControl,
      regulatoryDashboard,
      paymentClosure,
      evidenceWorkbench
    };
  }

  return {
    HIGHLIGHT_FEATURES,
    HIGHLIGHT_FEATURE_IDS: HIGHLIGHT_FEATURES.map((item) => item.id),
    buildInternetNursingInnovationCenter,
    riskScore
  };
});
