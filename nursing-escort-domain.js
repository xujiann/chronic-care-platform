(function initNursingEscortDomain(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NursingEscortDomain = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createNursingEscortDomain() {
  "use strict";

  const TERMINAL_STATES = new Set(["closed", "cancelled", "rejected", "refunded"]);
  const NURSE_AVAILABLE_STATUSES = new Set(["available"]);
  const ESCORT_WORKER_AVAILABLE_STATUSES = new Set(["available"]);

  const WORKFLOWS = Object.freeze({
    nursing: Object.freeze({
      requested: ["assessed", "risk-hold", "cancel-requested", "rejected"],
      assessed: ["dispatched", "risk-hold", "cancel-requested", "rejected"],
      "risk-hold": ["assessed", "rejected", "cancel-requested"],
      dispatched: ["accepted", "cancel-requested", "rejected"],
      accepted: ["in-service", "cancel-requested"],
      "in-service": ["completed", "adverse-event"],
      "adverse-event": ["in-service", "completed", "closed"],
      completed: ["settlement-pending", "quality-review"],
      "settlement-pending": ["settled", "refund-pending"],
      settled: ["quality-review", "refund-pending"],
      "quality-review": ["closed", "complaint-open"],
      "complaint-open": ["quality-review", "closed"],
      "cancel-requested": ["cancelled", "refund-pending", "requested"],
      "refund-pending": ["refunded"],
      refunded: [],
      cancelled: [],
      rejected: [],
      closed: []
    }),
    escort: Object.freeze({
      requested: ["eligibility-checked", "risk-hold", "cancel-requested", "rejected"],
      "eligibility-checked": ["provider-matched", "risk-hold", "cancel-requested", "rejected"],
      "provider-matched": ["worker-dispatched", "cancel-requested", "rejected"],
      "worker-dispatched": ["accepted", "cancel-requested", "rejected"],
      accepted: ["hospital-confirmed", "hospital-returned", "cancel-requested"],
      "hospital-returned": ["evidence-pending", "cancel-requested", "rejected"],
      "evidence-pending": ["accepted", "hospital-confirmed", "cancel-requested"],
      "hospital-confirmed": ["in-service", "cancel-requested"],
      "risk-hold": ["eligibility-checked", "rejected", "cancel-requested"],
      "in-service": ["completed", "adverse-event"],
      "adverse-event": ["in-service", "completed", "closed"],
      completed: ["settlement-pending", "quality-review"],
      "settlement-pending": ["settled", "refund-pending"],
      settled: ["quality-review", "refund-pending"],
      "quality-review": ["closed", "complaint-open"],
      "complaint-open": ["quality-review", "closed"],
      "cancel-requested": ["cancelled", "refund-pending", "requested"],
      "refund-pending": ["refunded"],
      refunded: [],
      cancelled: [],
      rejected: [],
      closed: []
    })
  });

  const STATUS_ALIASES = Object.freeze({
    pending: "requested",
    submitted: "requested",
    "contract-pending": "requested",
    matched: "worker-dispatched",
    assigned: "worker-dispatched",
    "hospital-confirmed": "hospital-confirmed",
    "hospital-returned": "hospital-returned",
    "in-service": "in-service",
    completed: "completed",
    "quality-review": "quality-review",
    "cancel-requested": "cancel-requested",
    cancelled: "cancelled",
    canceled: "cancelled"
  });

  const EVIDENCE_GATES = Object.freeze({
    nursing: Object.freeze({
      assessed: ["identity-verification", "first-visit-assessment", "signed-consent"],
      dispatched: ["qualification-snapshot", "dispatch-decision"],
      accepted: ["worker-acceptance"],
      "in-service": ["identity-verification", "location-start", "service-check-in"],
      completed: ["service-record", "location-end", "resident-confirmation", "exception-declaration"],
      "settlement-pending": ["pricing-confirmation", "financial-dispatch"],
      settled: ["financial-callback", "reconciliation-result"],
      "quality-review": ["quality-callback"],
      closed: ["quality-decision"]
    }),
    escort: Object.freeze({
      "eligibility-checked": ["identity-verification", "eligibility-result"],
      "provider-matched": ["provider-admission-snapshot"],
      "worker-dispatched": ["qualification-snapshot", "dispatch-decision"],
      accepted: ["worker-acceptance"],
      "hospital-confirmed": ["hospital-handoff"],
      "in-service": ["identity-verification", "location-start", "service-check-in"],
      completed: ["service-record", "location-end", "resident-confirmation", "exception-declaration"],
      "settlement-pending": ["pricing-confirmation", "financial-dispatch"],
      settled: ["financial-callback", "reconciliation-result"],
      "quality-review": ["quality-callback"],
      closed: ["quality-decision"]
    })
  });

  function normalizeDomain(value) {
    const domain = String(value || "").trim().toLowerCase();
    if (domain === "internet-nursing") return "nursing";
    if (domain === "medical-escort") return "escort";
    if (!WORKFLOWS[domain]) throw new Error(`unsupported service domain: ${domain || "empty"}`);
    return domain;
  }

  function canonicalStatus(value, domain) {
    const normalized = String(value || "requested").trim().toLowerCase();
    const candidate = STATUS_ALIASES[normalized] || normalized;
    return WORKFLOWS[normalizeDomain(domain)][candidate] ? candidate : normalized;
  }

  function allowedNextStates(domain, currentStatus) {
    const normalizedDomain = normalizeDomain(domain);
    const current = canonicalStatus(currentStatus, normalizedDomain);
    return [...(WORKFLOWS[normalizedDomain][current] || [])];
  }

  function validateTransition(domain, currentStatus, nextStatus) {
    const normalizedDomain = normalizeDomain(domain);
    const current = canonicalStatus(currentStatus, normalizedDomain);
    const next = canonicalStatus(nextStatus, normalizedDomain);
    const allowed = allowedNextStates(normalizedDomain, current);
    return {
      ok: allowed.includes(next),
      domain: normalizedDomain,
      current,
      next,
      allowed,
      reason: allowed.includes(next) ? "" : `${normalizedDomain} transition ${current} -> ${next} is not allowed`
    };
  }

  function parseTime(value) {
    const time = Date.parse(String(value || ""));
    return Number.isFinite(time) ? time : null;
  }

  function isExpired(value, now = new Date()) {
    const text = String(value || "").trim();
    const expiresAt = parseTime(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T23:59:59.999` : text);
    if (expiresAt === null) return true;
    return expiresAt < new Date(now).getTime();
  }

  function qualificationResult(reasons, details) {
    return { ok: reasons.length === 0, reasons, ...details };
  }

  function validateNurseQualification(nurse = {}, order = {}, options = {}) {
    const reasons = [];
    const minimumYears = order.riskLevel === "high" ? Number(options.highRiskMinimumYears ?? 8) : Number(options.minimumYears ?? 5);
    if (!nurse.id) reasons.push("nurse-not-found");
    if (Number(nurse.yearsClinical || 0) < minimumYears) reasons.push("clinical-years-insufficient");
    if (nurse.registrationStatus !== "verified") reasons.push("registration-not-verified");
    if (nurse.badPracticeRecord !== "none") reasons.push("bad-practice-record");
    if (nurse.trainingStatus !== "passed") reasons.push("training-not-passed");
    if (nurse.insuranceStatus !== "covered") reasons.push("insurance-not-covered");
    if (isExpired(nurse.qualificationExpiresAt, options.now)) reasons.push("qualification-expired");
    const nurseStatus = String(nurse.status || "").trim().toLowerCase();
    if (!nurseStatus) reasons.push("nurse-status-missing");
    if (nurseStatus && !NURSE_AVAILABLE_STATUSES.has(nurseStatus)) reasons.push("nurse-status-not-allowed");
    if (!NURSE_AVAILABLE_STATUSES.has(nurseStatus)) reasons.push("nurse-unavailable");
    if (order.institutionId && !String(nurse.institutionId || "").trim()) reasons.push("institution-id-missing");
    else if (order.institutionId && nurse.institutionId !== order.institutionId) reasons.push("institution-mismatch");
    if (order.institutionCode && !String(nurse.institutionCode || "").trim()) reasons.push("institution-code-missing");
    else if (order.institutionCode && nurse.institutionCode !== order.institutionCode) reasons.push("institution-mismatch");
    if (order.serviceItem && !Array.isArray(nurse.specialties)) reasons.push("specialties-missing");
    else if (order.serviceItem && !nurse.specialties.includes(order.serviceItem)) reasons.push("specialty-mismatch");
    if (Number(nurse.dailyCapacity || 0) > 0 && Number(nurse.assignedToday || 0) >= Number(nurse.dailyCapacity || 0)) reasons.push("daily-capacity-exhausted");
    return qualificationResult([...new Set(reasons)], {
      subjectId: String(nurse.id || ""),
      subjectType: "nurse",
      minimumYears,
      checkedAt: new Date(options.now || Date.now()).toISOString()
    });
  }

  function validateEscortWorkerQualification(worker = {}, order = {}, options = {}) {
    const reasons = [];
    const minimumTrainingHours = Number(options.minimumTrainingHours ?? 32);
    if (!worker.id) reasons.push("worker-not-found");
    if (Number(worker.trainingHours || 0) < minimumTrainingHours) reasons.push("training-hours-insufficient");
    if (worker.examStatus !== "passed") reasons.push("exam-not-passed");
    if (worker.insuranceStatus !== "covered") reasons.push("insurance-not-covered");
    const workerStatus = String(worker.status || "").trim().toLowerCase();
    if (!workerStatus) reasons.push("worker-status-missing");
    if (workerStatus && !ESCORT_WORKER_AVAILABLE_STATUSES.has(workerStatus)) reasons.push("worker-status-not-allowed");
    if (!ESCORT_WORKER_AVAILABLE_STATUSES.has(workerStatus)) reasons.push("worker-unavailable");
    if (order.providerId && !String(worker.providerId || "").trim()) reasons.push("provider-id-missing");
    else if (order.providerId && worker.providerId !== order.providerId) reasons.push("provider-mismatch");
    const requestedSkills = Array.isArray(order.serviceItems) ? order.serviceItems.filter(Boolean) : [];
    if (requestedSkills.length && !Array.isArray(worker.skills)) reasons.push("skills-missing");
    const workerSkills = new Set(Array.isArray(worker.skills) ? worker.skills : []);
    const missingSkills = requestedSkills.filter((item) => !workerSkills.has(item));
    if (missingSkills.length) reasons.push("skill-mismatch");
    return qualificationResult([...new Set(reasons)], {
      subjectId: String(worker.id || ""),
      subjectType: "escort-worker",
      minimumTrainingHours,
      missingSkills,
      checkedAt: new Date(options.now || Date.now()).toISOString()
    });
  }

  function dispatchTargetState(domain) {
    return normalizeDomain(domain) === "nursing" ? "dispatched" : "worker-dispatched";
  }

  function dispatchPrerequisites(domain, order = {}) {
    const normalizedDomain = normalizeDomain(domain);
    const missing = [];
    if (!order.identityVerified) missing.push("identity-verification");
    if (normalizedDomain === "nursing") {
      if (order.firstVisitAssessment !== "passed") missing.push("first-visit-assessment");
      if (order.informedConsent !== "signed" || order.consentAttachment?.status !== "signed") missing.push("signed-consent");
    } else {
      if (!["eligible", "passed", "approved"].includes(String(order.eligibilityResult?.status || order.eligibilityResult || "").toLowerCase())) missing.push("eligibility-result");
      if (!order.providerAdmissionSnapshot && order.provider?.published !== true) missing.push("provider-admission-snapshot");
    }
    return [...new Set(missing)];
  }

  function dispatchCandidateScore(domain, person = {}, order = {}) {
    const normalizedDomain = normalizeDomain(domain);
    if (normalizedDomain === "nursing") {
      const remainingCapacity = Math.max(0, Number(person.dailyCapacity || 0) - Number(person.assignedToday || 0));
      const experience = Math.min(20, Number(person.yearsClinical || 0));
      const riskBonus = order.riskLevel === "high" && Number(person.yearsClinical || 0) >= 8 ? 8 : 0;
      return remainingCapacity * 4 + experience + riskBonus;
    }
    const requestedSkills = Array.isArray(order.serviceItems) ? order.serviceItems.filter(Boolean) : [];
    const skills = new Set(Array.isArray(person.skills) ? person.skills : []);
    const skillCoverage = requestedSkills.filter((item) => skills.has(item)).length;
    return Math.min(20, Number(person.trainingHours || 0) / 2) + skillCoverage * 8;
  }

  function evaluateDispatchCandidate(domain, order = {}, person = {}, options = {}) {
    const normalizedDomain = normalizeDomain(domain);
    const target = dispatchTargetState(normalizedDomain);
    const transition = validateTransition(normalizedDomain, order.status, target);
    const qualification = normalizedDomain === "nursing"
      ? validateNurseQualification(person, order, options)
      : validateEscortWorkerQualification(person, order, options);
    const risk = assessOrderRisk(normalizedDomain, order);
    const prerequisites = dispatchPrerequisites(normalizedDomain, order);
    const blockers = [];
    if (!transition.ok) blockers.push(`transition:${transition.current}->${target}`);
    blockers.push(...prerequisites.map((item) => `evidence:${item}`));
    blockers.push(...qualification.reasons.map((item) => `qualification:${item}`));
    if (risk.band === "critical") blockers.push("risk:critical");
    if (risk.band === "high" && order.riskReview?.status !== "approved") blockers.push("risk:review-required");
    const score = dispatchCandidateScore(normalizedDomain, person, order);
    const checkedAt = new Date(options.now || Date.now()).toISOString();
    const personId = String(person.id || "");
    const personName = String(person.name || personId);
    const uniqueBlockers = [...new Set(blockers)];
    const eligible = uniqueBlockers.length === 0;
    return {
      eligible,
      domain: normalizedDomain,
      orderId: String(order.id || ""),
      targetStatus: target,
      personId,
      personName,
      score,
      blockers: uniqueBlockers,
      transition,
      qualification,
      risk,
      prerequisites,
      updates: eligible ? {
        ...(normalizedDomain === "nursing" ? { nurseId: personId, nurseName: personName } : { workerId: personId, workerName: personName }),
        qualificationSnapshot: {
          subjectId: personId,
          subjectType: qualification.subjectType,
          status: "passed",
          checkedAt,
          policyVersion: "nursing-escort-workflow-v1"
        },
        dispatchDecision: {
          status: "approved",
          score,
          riskBand: risk.band,
          checkedAt,
          subjectId: personId
        }
      } : {}
    };
  }

  function rankDispatchCandidates(domain, order = {}, roster = [], options = {}) {
    const decisions = (Array.isArray(roster) ? roster : [])
      .map((person) => evaluateDispatchCandidate(domain, order, person, options))
      .sort((left, right) => Number(right.eligible) - Number(left.eligible) || right.score - left.score || left.personId.localeCompare(right.personId));
    const limit = Math.max(1, Math.min(20, Number(options.limit || 3)));
    return {
      domain: normalizeDomain(domain),
      orderId: String(order.id || ""),
      targetStatus: dispatchTargetState(domain),
      candidates: decisions.filter((item) => item.eligible).slice(0, limit),
      blockedCandidates: decisions.filter((item) => !item.eligible).slice(0, limit),
      blockers: [...new Set(decisions.flatMap((item) => item.blockers))],
      evaluated: decisions.length
    };
  }

  function assessOrderRisk(domain, order = {}) {
    const normalizedDomain = normalizeDomain(domain);
    let score = order.riskLevel === "high" ? 35 : order.riskLevel === "medium" ? 18 : 6;
    const reasons = [];
    if (order.riskLevel === "high") reasons.push("declared-high-risk");
    if (normalizedDomain === "nursing") {
      if (order.firstVisitAssessment !== "passed") { score += 24; reasons.push("assessment-pending"); }
      if (order.informedConsent !== "signed" || order.consentAttachment?.status !== "signed") { score += 18; reasons.push("consent-missing"); }
      if (!order.nurseId) { score += 12; reasons.push("nurse-unassigned"); }
      if (order.adverseEvent?.status && order.adverseEvent.status !== "none") { score += 35; reasons.push("adverse-event-open"); }
    } else {
      if (order.contractStatus !== "signed") { score += 16; reasons.push("contract-pending"); }
      if (order.insuranceStatus !== "covered") { score += 14; reasons.push("insurance-pending"); }
      if (!order.workerId) { score += 12; reasons.push("worker-unassigned"); }
      if (order.hospitalInterfaceStatus === "returned") { score += 20; reasons.push("hospital-returned"); }
      if (order.familyContactStatus === "pending") { score += 8; reasons.push("family-contact-pending"); }
    }
    if (order.complaintStatus && order.complaintStatus !== "none" && order.complaintStatus !== "closed") { score += 18; reasons.push("complaint-open"); }
    const finalScore = Math.min(100, score);
    const band = finalScore >= 80 ? "critical" : finalScore >= 60 ? "high" : finalScore >= 35 ? "medium" : "low";
    const controls = band === "critical"
      ? ["stop-auto-dispatch", "clinical-review", "emergency-contact"]
      : band === "high"
        ? ["manual-review", "senior-worker", "family-confirmation"]
        : band === "medium" ? ["institution-review"] : ["routine-monitoring"];
    return { domain: normalizedDomain, score: finalScore, band, reasons, controls };
  }

  function evidenceTypes(order = {}) {
    const types = new Set((Array.isArray(order.evidence) ? order.evidence : []).map((item) => typeof item === "string" ? item : item?.type).filter(Boolean));
    if (order.identityVerified) types.add("identity-verification");
    if (order.firstVisitAssessment === "passed") types.add("first-visit-assessment");
    if (order.informedConsent === "signed" && order.consentAttachment?.status === "signed") types.add("signed-consent");
    if (order.qualificationSnapshot || order.qualificationEvidence) types.add("qualification-snapshot");
    if (order.dispatchDecision || order.nurseId || order.workerId) types.add("dispatch-decision");
    if (order.workerAcceptedAt || order.nurseAcceptedAt || order.status === "accepted") types.add("worker-acceptance");
    if (order.providerAdmissionSnapshot || order.provider?.published) types.add("provider-admission-snapshot");
    if (order.eligibilityResult) types.add("eligibility-result");
    if (order.hospitalInterfaceStatus === "confirmed" && (order.hisVisitId || order.hospitalCheckInNo)) types.add("hospital-handoff");
    const tracePoints = Array.isArray(order.locationTracePoints) ? order.locationTracePoints : [];
    if (tracePoints.some((item) => item.stage === "service-start" && item.verified !== false)) types.add("location-start");
    if (tracePoints.some((item) => item.stage === "service-complete" && item.verified !== false)) types.add("location-end");
    if (order.serviceCheckInAt || tracePoints.some((item) => item.stage === "service-start")) types.add("service-check-in");
    if (order.serviceRecord?.status === "completed" || order.serviceRecordStatus === "completed") types.add("service-record");
    if (order.residentConfirmation === "confirmed" || order.residentServiceConfirmation === "confirmed" || (order.serviceAttachments || []).some((item) => item.type === "resident-signature")) types.add("resident-confirmation");
    if (order.serviceRecord?.exceptionReport || order.adverseEvent) types.add("exception-declaration");
    if (Number(order.feeEstimate || 0) >= 0 && order.pricingConfirmedAt) types.add("pricing-confirmation");
    if (order.financialDispatch?.idempotencyKey) types.add("financial-dispatch");
    if (order.financialCallback?.status === "succeeded") types.add("financial-callback");
    if (order.reconciliationResult?.status === "matched") types.add("reconciliation-result");
    if (order.qualityCallback === "closed" || order.qualityReview === "closed" || order.satisfaction?.status === "submitted") types.add("quality-callback");
    if (order.qualityDecision?.status === "passed" || order.qualityInspection?.status === "closed") types.add("quality-decision");
    return types;
  }

  function validateEvidenceForTransition(domain, order = {}, nextStatus) {
    const normalizedDomain = normalizeDomain(domain);
    const next = canonicalStatus(nextStatus, normalizedDomain);
    const required = [...(EVIDENCE_GATES[normalizedDomain][next] || [])];
    const present = evidenceTypes(order);
    const missing = required.filter((item) => !present.has(item));
    return { ok: missing.length === 0, domain: normalizedDomain, next, required, missing, present: [...present] };
  }

  function buildTimelineEvent(domain, order, transition, options = {}) {
    const at = new Date(options.at || Date.now()).toISOString();
    return {
      id: String(options.id || `${normalizeDomain(domain)}:${order.id || "order"}:${transition.next}:${at}`),
      serviceOrderId: String(order.id || ""),
      serviceType: normalizeDomain(domain),
      residentId: String(order.residentId || ""),
      eventType: "status-transition",
      fromStatus: transition.current,
      toStatus: transition.next,
      occurredAt: at,
      actorId: String(options.actorId || options.actor || "system"),
      actorRole: String(options.actorRole || "system"),
      evidenceTypes: validateEvidenceForTransition(domain, order, transition.next).present,
      note: String(options.note || "")
    };
  }

  function transitionOrder(domain, order = {}, nextStatus, options = {}) {
    if (Object.hasOwn(options, "enforceEvidence")) {
      const error = new Error("evidence enforcement cannot be overridden");
      error.code = "EVIDENCE_BYPASS_FORBIDDEN";
      error.statusCode = 409;
      throw error;
    }
    const transition = validateTransition(domain, order.status, nextStatus);
    if (!transition.ok) {
      const error = new Error(transition.reason);
      error.code = "INVALID_ORDER_TRANSITION";
      error.statusCode = 409;
      error.details = transition;
      throw error;
    }
    const candidate = { ...order, ...(options.updates || {}), status: transition.next };
    const evidence = validateEvidenceForTransition(domain, candidate, transition.next);
    if (!evidence.ok) {
      const error = new Error(`missing evidence for ${transition.next}: ${evidence.missing.join(", ")}`);
      error.code = "ORDER_EVIDENCE_INCOMPLETE";
      error.statusCode = 409;
      error.details = evidence;
      throw error;
    }
    const event = buildTimelineEvent(domain, candidate, transition, options);
    return {
      ...candidate,
      workflowVersion: "nursing-escort-workflow-v1",
      updatedAt: event.occurredAt,
      timelineEvents: [event, ...(Array.isArray(order.timelineEvents) ? order.timelineEvents : [])].slice(0, 100),
      auditTrail: [
        { at: event.occurredAt, action: `transition:${transition.current}->${transition.next}`, by: event.actorId, note: event.note },
        ...(Array.isArray(order.auditTrail) ? order.auditTrail : [])
      ].slice(0, 100)
    };
  }

  function buildFinancialCommand(domain, order = {}, operation = "create-payment") {
    const normalizedDomain = normalizeDomain(domain);
    const orderId = String(order.id || "").trim();
    if (!orderId) throw new Error("order id is required for financial dispatch");
    const amountFen = Math.round(Number(order.feeEstimate || 0) * 100);
    if (!Number.isSafeInteger(amountFen) || amountFen < 0) throw new Error("order amount is invalid");
    const insurance = operation === "settlement";
    const sharedPayload = {
      amountFen,
      businessOrderType: normalizedDomain,
      businessOrderId: orderId
    };
    return {
      type: insurance ? "INSURANCE" : "PAYMENT",
      operation,
      idempotencyKey: `${normalizedDomain}:${orderId}:${operation}:v1`,
      payload: insurance
        ? {
          ...sharedPayload,
          claimNo: String(order.claimNo || `${normalizedDomain}:${orderId}`),
          residentId: String(order.residentId || ""),
          institutionCode: String(order.institutionCode || order.hospitalCode || "")
        }
        : {
          ...sharedPayload,
          orderNo: `${normalizedDomain}:${orderId}`,
          currency: "CNY"
        }
    };
  }

  return Object.freeze({
    WORKFLOWS,
    EVIDENCE_GATES,
    TERMINAL_STATES,
    normalizeDomain,
    canonicalStatus,
    allowedNextStates,
    validateTransition,
    validateNurseQualification,
    validateEscortWorkerQualification,
    dispatchTargetState,
    dispatchPrerequisites,
    evaluateDispatchCandidate,
    rankDispatchCandidates,
    assessOrderRisk,
    evidenceTypes,
    validateEvidenceForTransition,
    buildTimelineEvent,
    transitionOrder,
    buildFinancialCommand
  });
});
