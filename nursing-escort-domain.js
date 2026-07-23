(function initNursingEscortDomain(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NursingEscortDomain = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createNursingEscortDomain() {
  "use strict";

  const TERMINAL_STATES = new Set(["closed", "cancelled", "rejected", "refunded"]);
  const NURSE_AVAILABLE_STATUSES = new Set(["available"]);
  const ESCORT_WORKER_AVAILABLE_STATUSES = new Set(["available"]);
  const WORKFLOW_POLICY_VERSION = "nursing-escort-workflow-v1";
  const DISPATCH_EVIDENCE_TTL_MS = 30 * 60 * 1000;
  const DISPATCH_EVIDENCE_FUTURE_SKEW_MS = 5 * 60 * 1000;
  const ISSUED_DISPATCH_DECISIONS = new Map();
  const ISSUED_DISPATCH_DECISION_LIMIT = 1000;

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
      "complaint-open": ["complaint-record"],
      "adverse-event": ["incident-report", "risk-escalation"],
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
      "complaint-open": ["complaint-record"],
      "adverse-event": ["incident-report", "risk-escalation"],
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

  function stableDigest(value) {
    const text = JSON.stringify(value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }

  function qualificationDigestPayload(snapshot = {}) {
    return {
      status: snapshot.status,
      orderId: snapshot.orderId,
      domain: snapshot.domain,
      subjectId: snapshot.subjectId,
      subjectType: snapshot.subjectType,
      checkedAt: snapshot.checkedAt,
      validUntil: snapshot.validUntil,
      policyVersion: snapshot.policyVersion
    };
  }

  function dispatchDecisionDigestPayload(decision = {}) {
    return {
      status: decision.status,
      orderId: decision.orderId,
      domain: decision.domain,
      targetStatus: decision.targetStatus,
      subjectId: decision.subjectId,
      score: decision.score,
      riskBand: decision.riskBand,
      qualificationDigest: decision.qualificationDigest,
      checkedAt: decision.checkedAt,
      validUntil: decision.validUntil,
      policyVersion: decision.policyVersion
    };
  }

  function dispatchEvidenceFingerprint(qualification = {}, decision = {}) {
    return JSON.stringify({
      qualification: { ...qualificationDigestPayload(qualification), digest: qualification.digest },
      decision: { ...dispatchDecisionDigestPayload(decision), digest: decision.digest, id: decision.id }
    });
  }

  function registerDispatchEvidence(qualification, decision) {
    if (ISSUED_DISPATCH_DECISIONS.size >= ISSUED_DISPATCH_DECISION_LIMIT) {
      ISSUED_DISPATCH_DECISIONS.delete(ISSUED_DISPATCH_DECISIONS.keys().next().value);
    }
    ISSUED_DISPATCH_DECISIONS.set(decision.id, dispatchEvidenceFingerprint(qualification, decision));
  }

  function evidenceTimeReasons(prefix, evidence = {}, at) {
    const reasons = [];
    const checkedAt = parseTime(evidence.checkedAt);
    const validUntil = parseTime(evidence.validUntil);
    if (!Number.isFinite(at)) reasons.push(`${prefix}-validation-time-invalid`);
    if (checkedAt === null) reasons.push(`${prefix}-checked-at-invalid`);
    if (validUntil === null) reasons.push(`${prefix}-valid-until-invalid`);
    if (Number.isFinite(at) && checkedAt !== null && checkedAt > at + DISPATCH_EVIDENCE_FUTURE_SKEW_MS) reasons.push(`${prefix}-checked-at-future`);
    if (Number.isFinite(at) && checkedAt !== null && at - checkedAt > DISPATCH_EVIDENCE_TTL_MS) reasons.push(`${prefix}-stale`);
    if (Number.isFinite(at) && validUntil !== null && validUntil < at) reasons.push(`${prefix}-expired`);
    if (checkedAt !== null && validUntil !== null && (validUntil <= checkedAt || validUntil - checkedAt > DISPATCH_EVIDENCE_TTL_MS)) {
      reasons.push(`${prefix}-validity-window-invalid`);
    }
    return reasons;
  }

  function validateDispatchEvidence(domain, order = {}, options = {}) {
    const normalizedDomain = normalizeDomain(domain);
    const targetStatus = dispatchTargetState(normalizedDomain);
    const assignedField = normalizedDomain === "nursing" ? "nurseId" : "workerId";
    const expectedSubjectType = normalizedDomain === "nursing" ? "nurse" : "escort-worker";
    const assignedId = String(order[assignedField] || "").trim();
    const orderId = String(order.id || "").trim();
    const at = new Date(options.at || Date.now()).getTime();
    const qualification = order.qualificationSnapshot;
    const decision = order.dispatchDecision;
    const qualificationReasons = [];
    const decisionReasons = [];

    if (!orderId) qualificationReasons.push("order-id-missing");
    if (!assignedId) qualificationReasons.push("assigned-subject-missing");
    if (!qualification || typeof qualification !== "object" || Array.isArray(qualification)) {
      qualificationReasons.push("qualification-snapshot-missing");
    } else {
      if (qualification.status !== "passed") qualificationReasons.push("qualification-status-not-passed");
      if (qualification.policyVersion !== WORKFLOW_POLICY_VERSION) qualificationReasons.push("qualification-policy-version-invalid");
      if (qualification.orderId !== orderId) qualificationReasons.push("qualification-order-mismatch");
      if (qualification.domain !== normalizedDomain) qualificationReasons.push("qualification-domain-mismatch");
      if (qualification.subjectId !== assignedId) qualificationReasons.push("qualification-subject-mismatch");
      if (qualification.subjectType !== expectedSubjectType) qualificationReasons.push("qualification-subject-type-mismatch");
      qualificationReasons.push(...evidenceTimeReasons("qualification", qualification, at));
      if (qualification.digest !== stableDigest(qualificationDigestPayload(qualification))) qualificationReasons.push("qualification-digest-mismatch");
    }

    if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
      decisionReasons.push("dispatch-decision-missing");
    } else {
      if (decision.status !== "approved") decisionReasons.push("dispatch-decision-not-approved");
      if (decision.policyVersion !== WORKFLOW_POLICY_VERSION) decisionReasons.push("dispatch-policy-version-invalid");
      if (decision.orderId !== orderId) decisionReasons.push("dispatch-order-mismatch");
      if (decision.domain !== normalizedDomain) decisionReasons.push("dispatch-domain-mismatch");
      if (decision.targetStatus !== targetStatus) decisionReasons.push("dispatch-target-mismatch");
      if (decision.subjectId !== assignedId) decisionReasons.push("dispatch-subject-mismatch");
      if (!Number.isFinite(decision.score)) decisionReasons.push("dispatch-score-invalid");
      if (!["low", "medium", "high"].includes(decision.riskBand)) decisionReasons.push("dispatch-risk-band-invalid");
      if (!qualification || decision.qualificationDigest !== qualification.digest) decisionReasons.push("dispatch-qualification-mismatch");
      decisionReasons.push(...evidenceTimeReasons("dispatch", decision, at));
      const expectedDigest = stableDigest(dispatchDecisionDigestPayload(decision));
      if (decision.digest !== expectedDigest) decisionReasons.push("dispatch-digest-mismatch");
      if (decision.id !== `dispatch:${expectedDigest}`) decisionReasons.push("dispatch-id-mismatch");
      const issuedFingerprint = ISSUED_DISPATCH_DECISIONS.get(decision.id);
      if (!issuedFingerprint) decisionReasons.push("dispatch-decision-not-issued");
      else if (issuedFingerprint !== dispatchEvidenceFingerprint(qualification, decision)) decisionReasons.push("dispatch-issuance-mismatch");
    }

    const reasons = [...new Set([...qualificationReasons, ...decisionReasons])];
    return {
      ok: reasons.length === 0,
      domain: normalizedDomain,
      orderId,
      targetStatus,
      assignedId,
      qualificationOk: qualificationReasons.length === 0,
      decisionOk: decisionReasons.length === 0,
      reasons
    };
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
    const orderId = String(order.id || "");
    const validUntil = new Date(new Date(checkedAt).getTime() + DISPATCH_EVIDENCE_TTL_MS).toISOString();
    const qualificationSnapshot = {
      subjectId: personId,
      subjectType: qualification.subjectType,
      status: "passed",
      orderId,
      domain: normalizedDomain,
      checkedAt,
      validUntil,
      policyVersion: WORKFLOW_POLICY_VERSION
    };
    qualificationSnapshot.digest = stableDigest(qualificationDigestPayload(qualificationSnapshot));
    const dispatchDecision = {
      status: "approved",
      score,
      riskBand: risk.band,
      checkedAt,
      validUntil,
      subjectId: personId,
      orderId,
      domain: normalizedDomain,
      targetStatus: target,
      qualificationDigest: qualificationSnapshot.digest,
      policyVersion: WORKFLOW_POLICY_VERSION
    };
    dispatchDecision.digest = stableDigest(dispatchDecisionDigestPayload(dispatchDecision));
    dispatchDecision.id = `dispatch:${dispatchDecision.digest}`;
    if (eligible) registerDispatchEvidence(qualificationSnapshot, dispatchDecision);
    return {
      eligible,
      domain: normalizedDomain,
      orderId,
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
        qualificationSnapshot,
        dispatchDecision
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

  function serviceAssignedSubject(domain, order = {}) {
    const normalizedDomain = normalizeDomain(domain);
    return String(normalizedDomain === "nursing" ? order.nurseId || "" : order.workerId || "").trim();
  }

  function serviceTracePoint(order = {}, stage) {
    const points = Array.isArray(order.locationTracePoints) ? order.locationTracePoints : [];
    return [...points].reverse().find((item) => item?.stage === stage) || null;
  }

  function validateBoundServiceTrace(domain, order = {}, stage) {
    const normalizedDomain = normalizeDomain(domain);
    const orderId = String(order.id || "").trim();
    const subjectId = serviceAssignedSubject(normalizedDomain, order);
    const trace = serviceTracePoint(order, stage);
    const reasons = [];
    if (!trace) return { ok: false, trace: null, reasons: [`${stage}-trace-missing`] };
    if (!trace.id) reasons.push(`${stage}-trace-id-missing`);
    if (trace.orderId !== orderId) reasons.push(`${stage}-trace-order-mismatch`);
    if (trace.domain !== normalizedDomain) reasons.push(`${stage}-trace-domain-mismatch`);
    if (trace.subjectId !== subjectId) reasons.push(`${stage}-trace-subject-mismatch`);
    if (trace.verified !== true) reasons.push(`${stage}-trace-not-verified`);
    if (typeof trace.lat !== "number" || typeof trace.lng !== "number"
      || !Number.isFinite(trace.lat) || !Number.isFinite(trace.lng)
      || trace.lat < -90 || trace.lat > 90 || trace.lng < -180 || trace.lng > 180) {
      reasons.push(`${stage}-trace-location-invalid`);
    }
    if (parseTime(trace.capturedAt) === null) reasons.push(`${stage}-trace-time-invalid`);
    if (!String(trace.source || "").trim()) reasons.push(`${stage}-trace-source-missing`);
    return { ok: reasons.length === 0, trace, reasons };
  }

  function validateServiceEvidence(domain, order = {}, nextStatus) {
    const normalizedDomain = normalizeDomain(domain);
    const next = canonicalStatus(nextStatus, normalizedDomain);
    const orderId = String(order.id || "").trim();
    const residentId = String(order.residentId || "").trim();
    const subjectId = serviceAssignedSubject(normalizedDomain, order);
    const reasons = [];
    if (!orderId) reasons.push("service-order-id-missing");
    if (!residentId) reasons.push("service-resident-id-missing");
    if (!subjectId) reasons.push("service-subject-missing");

    if (next === "in-service") {
      const startTrace = validateBoundServiceTrace(normalizedDomain, order, "service-start");
      reasons.push(...startTrace.reasons);
      const checkIn = order.serviceCheckIn;
      if (!checkIn || typeof checkIn !== "object" || Array.isArray(checkIn)) {
        reasons.push("service-check-in-missing");
      } else {
        if (checkIn.status !== "verified") reasons.push("service-check-in-not-verified");
        if (checkIn.orderId !== orderId) reasons.push("service-check-in-order-mismatch");
        if (checkIn.domain !== normalizedDomain) reasons.push("service-check-in-domain-mismatch");
        if (checkIn.subjectId !== subjectId) reasons.push("service-check-in-subject-mismatch");
        if (checkIn.residentId !== residentId) reasons.push("service-check-in-resident-mismatch");
        if (checkIn.tracePointId !== startTrace.trace?.id) reasons.push("service-check-in-trace-mismatch");
        const checkedInAt = parseTime(checkIn.checkedInAt);
        if (checkedInAt === null) reasons.push("service-check-in-time-invalid");
        if (checkedInAt !== null && checkedInAt !== parseTime(startTrace.trace?.capturedAt)) reasons.push("service-check-in-time-mismatch");
      }
    }

    if (next === "completed") {
      const startTrace = validateBoundServiceTrace(normalizedDomain, order, "service-start");
      const endTrace = validateBoundServiceTrace(normalizedDomain, order, "service-complete");
      reasons.push(...startTrace.reasons, ...endTrace.reasons);
      const record = order.serviceRecord;
      if (!record || typeof record !== "object" || Array.isArray(record)) {
        reasons.push("service-record-missing");
      } else {
        if (record.status !== "completed") reasons.push("service-record-not-completed");
        if (!record.id) reasons.push("service-record-id-missing");
        if (!record.version) reasons.push("service-record-version-missing");
        if (record.orderId !== orderId) reasons.push("service-record-order-mismatch");
        if (record.domain !== normalizedDomain) reasons.push("service-record-domain-mismatch");
        if (record.subjectId !== subjectId) reasons.push("service-record-subject-mismatch");
        if (record.residentId !== residentId) reasons.push("service-record-resident-mismatch");
        const startedAt = parseTime(record.startedAt);
        const completedAt = parseTime(record.completedAt);
        if (startedAt === null) reasons.push("service-record-start-time-invalid");
        if (completedAt === null) reasons.push("service-record-complete-time-invalid");
        if (startedAt !== null && completedAt !== null && completedAt <= startedAt) reasons.push("service-record-time-order-invalid");
        if (startedAt !== null && parseTime(startTrace.trace?.capturedAt) !== startedAt) reasons.push("service-record-start-trace-mismatch");
        if (completedAt !== null && parseTime(endTrace.trace?.capturedAt) !== completedAt) reasons.push("service-record-complete-trace-mismatch");
        const actions = normalizedDomain === "nursing"
          ? record.careActions
          : record.serviceActions || record.serviceItemsCompleted;
        if (!Array.isArray(actions) || actions.filter(Boolean).length === 0) reasons.push("service-record-actions-missing");
        const exception = record.exceptionReport;
        if (!exception || !["none", "resolved"].includes(exception.status)) reasons.push("exception-declaration-invalid");
        if (exception?.status === "resolved" && (!exception.resolution || parseTime(exception.resolvedAt) === null)) reasons.push("exception-resolution-incomplete");
      }
      const confirmation = order.residentConfirmation;
      if (!confirmation || typeof confirmation !== "object" || Array.isArray(confirmation)) {
        reasons.push("resident-confirmation-missing");
      } else {
        if (confirmation.status !== "confirmed") reasons.push("resident-confirmation-not-confirmed");
        if (confirmation.orderId !== orderId) reasons.push("resident-confirmation-order-mismatch");
        if (confirmation.residentId !== residentId) reasons.push("resident-confirmation-resident-mismatch");
        if (!confirmation.signerName) reasons.push("resident-confirmation-signer-missing");
        const confirmedAt = parseTime(confirmation.confirmedAt);
        if (confirmedAt === null) reasons.push("resident-confirmation-time-invalid");
        const completedAt = parseTime(order.serviceRecord?.completedAt);
        if (confirmedAt !== null && completedAt !== null && confirmedAt < completedAt) reasons.push("resident-confirmation-before-completion");
      }
      if (order.adverseEvent?.status && !["none", "closed", "resolved"].includes(order.adverseEvent.status)) reasons.push("adverse-event-open");
    }

    return {
      ok: reasons.length === 0,
      domain: normalizedDomain,
      next,
      orderId,
      residentId,
      subjectId,
      reasons: [...new Set(reasons)]
    };
  }

  function buildServiceStartEvidence(domain, order = {}, details = {}, options = {}) {
    const normalizedDomain = normalizeDomain(domain);
    const at = new Date(options.at || Date.now()).toISOString();
    const orderId = String(order.id || "").trim();
    const residentId = String(order.residentId || "").trim();
    const subjectId = serviceAssignedSubject(normalizedDomain, order);
    const traceId = `${normalizedDomain}:${orderId}:service-start:${at}`;
    const tracePoint = {
      id: traceId,
      stage: "service-start",
      orderId,
      domain: normalizedDomain,
      subjectId,
      capturedAt: at,
      lat: Number(details.lat),
      lng: Number(details.lng),
      source: String(details.source || "worker-mobile"),
      verified: details.verified === true
    };
    return {
      locationTrace: "tracking",
      locationTracePoints: [...(Array.isArray(order.locationTracePoints) ? order.locationTracePoints : []), tracePoint].slice(-30),
      serviceCheckInAt: at,
      serviceCheckIn: {
        status: details.identityMatched === true ? "verified" : "rejected",
        orderId,
        domain: normalizedDomain,
        subjectId,
        residentId,
        tracePointId: traceId,
        checkedInAt: at
      },
      serviceRecordStatus: "in-progress",
      serviceRecord: {
        ...(order.serviceRecord || {}),
        status: "in-progress",
        orderId,
        domain: normalizedDomain,
        subjectId,
        residentId,
        startedAt: at,
        version: WORKFLOW_POLICY_VERSION
      }
    };
  }

  function buildServiceCompletionEvidence(domain, order = {}, details = {}, options = {}) {
    const normalizedDomain = normalizeDomain(domain);
    const at = new Date(options.at || Date.now()).toISOString();
    const orderId = String(order.id || "").trim();
    const residentId = String(order.residentId || "").trim();
    const subjectId = serviceAssignedSubject(normalizedDomain, order);
    const traceId = `${normalizedDomain}:${orderId}:service-complete:${at}`;
    const tracePoint = {
      id: traceId,
      stage: "service-complete",
      orderId,
      domain: normalizedDomain,
      subjectId,
      capturedAt: at,
      lat: Number(details.lat),
      lng: Number(details.lng),
      source: String(details.source || "worker-mobile"),
      verified: details.verified === true
    };
    const actions = Array.isArray(details.actions) ? details.actions.filter(Boolean) : [];
    const exceptionReport = details.exceptionReport && typeof details.exceptionReport === "object"
      ? { ...details.exceptionReport }
      : { status: "none" };
    return {
      locationTrace: "completed",
      locationTracePoints: [...(Array.isArray(order.locationTracePoints) ? order.locationTracePoints : []), tracePoint].slice(-30),
      serviceRecordStatus: "completed",
      serviceRecord: {
        ...(order.serviceRecord || {}),
        id: String(order.serviceRecord?.id || `${normalizedDomain}:${orderId}:service-record`),
        status: "completed",
        version: WORKFLOW_POLICY_VERSION,
        orderId,
        domain: normalizedDomain,
        subjectId,
        residentId,
        startedAt: order.serviceRecord?.startedAt,
        completedAt: at,
        ...(normalizedDomain === "nursing" ? { careActions: actions } : { serviceActions: actions }),
        exceptionReport
      },
      residentConfirmation: {
        status: details.residentConfirmed === true ? "confirmed" : "rejected",
        orderId,
        residentId,
        signerName: String(details.signerName || ""),
        confirmedAt: at
      },
      adverseEvent: details.adverseEvent || order.adverseEvent || { status: "none" }
    };
  }

  function financialAmountFen(order = {}) {
    if (!Object.hasOwn(order, "feeEstimate") || order.feeEstimate === null || String(order.feeEstimate).trim() === "") return null;
    const amount = Number(order.feeEstimate);
    const scaled = amount * 100;
    const amountFen = Math.round(scaled);
    return Number.isFinite(amount) && Math.abs(scaled - amountFen) < 1e-8 && Number.isSafeInteger(amountFen) && amountFen >= 0
      ? amountFen
      : null;
  }

  function validateFinancialEvidence(domain, order = {}, nextStatus) {
    const normalizedDomain = normalizeDomain(domain);
    const next = canonicalStatus(nextStatus, normalizedDomain);
    const orderId = String(order.id || "").trim();
    const amountFen = financialAmountFen(order);
    const expectedKey = orderId && amountFen !== null ? `${normalizedDomain}:${orderId}:settlement:v1` : "";
    const pricing = order.pricingConfirmation;
    const dispatch = order.financialDispatch;
    const callback = order.financialCallback;
    const reconciliation = order.reconciliationResult;
    const pricingReasons = [];
    const dispatchReasons = [];
    const callbackReasons = [];
    const reconciliationReasons = [];

    if (!orderId) pricingReasons.push("financial-order-id-missing");
    if (amountFen === null) pricingReasons.push("financial-amount-invalid");
    if (!pricing || typeof pricing !== "object" || Array.isArray(pricing)) {
      pricingReasons.push("pricing-confirmation-missing");
    } else {
      if (pricing.status !== "confirmed") pricingReasons.push("pricing-not-confirmed");
      if (pricing.orderId !== orderId) pricingReasons.push("pricing-order-mismatch");
      if (pricing.domain !== normalizedDomain) pricingReasons.push("pricing-domain-mismatch");
      if (pricing.amountFen !== amountFen) pricingReasons.push("pricing-amount-mismatch");
      if (pricing.currency !== "CNY") pricingReasons.push("pricing-currency-invalid");
      if (pricing.policyVersion !== WORKFLOW_POLICY_VERSION) pricingReasons.push("pricing-policy-version-invalid");
      if (parseTime(pricing.confirmedAt) === null) pricingReasons.push("pricing-time-invalid");
    }

    if (!dispatch || typeof dispatch !== "object" || Array.isArray(dispatch)) {
      dispatchReasons.push("financial-dispatch-missing");
    } else {
      if (dispatch.status !== "accepted") dispatchReasons.push("financial-dispatch-not-accepted");
      if (dispatch.orderId !== orderId) dispatchReasons.push("financial-dispatch-order-mismatch");
      if (dispatch.domain !== normalizedDomain) dispatchReasons.push("financial-dispatch-domain-mismatch");
      if (dispatch.operation !== "settlement") dispatchReasons.push("financial-dispatch-operation-invalid");
      if (dispatch.commandType !== "INSURANCE") dispatchReasons.push("financial-dispatch-command-type-invalid");
      if (dispatch.amountFen !== amountFen) dispatchReasons.push("financial-dispatch-amount-mismatch");
      if (dispatch.idempotencyKey !== expectedKey) dispatchReasons.push("financial-dispatch-idempotency-mismatch");
      if (dispatch.policyVersion !== WORKFLOW_POLICY_VERSION) dispatchReasons.push("financial-dispatch-policy-version-invalid");
      const dispatchedAt = parseTime(dispatch.dispatchedAt);
      if (dispatchedAt === null) dispatchReasons.push("financial-dispatch-time-invalid");
      const confirmedAt = parseTime(pricing?.confirmedAt);
      if (dispatchedAt !== null && confirmedAt !== null && dispatchedAt < confirmedAt) dispatchReasons.push("financial-dispatch-before-pricing");
    }

    if (next === "settled") {
      if (!callback || typeof callback !== "object" || Array.isArray(callback)) {
        callbackReasons.push("financial-callback-missing");
      } else {
        if (callback.status !== "succeeded") callbackReasons.push("financial-callback-not-succeeded");
        if (callback.signatureStatus !== "verified") callbackReasons.push("financial-callback-signature-invalid");
        if (!callback.id) callbackReasons.push("financial-callback-id-missing");
        if (!callback.providerTransactionId) callbackReasons.push("financial-provider-transaction-missing");
        if (callback.orderId !== orderId) callbackReasons.push("financial-callback-order-mismatch");
        if (callback.domain !== normalizedDomain) callbackReasons.push("financial-callback-domain-mismatch");
        if (callback.amountFen !== amountFen) callbackReasons.push("financial-callback-amount-mismatch");
        if (callback.idempotencyKey !== expectedKey) callbackReasons.push("financial-callback-idempotency-mismatch");
        const verifiedAt = parseTime(callback.verifiedAt);
        if (verifiedAt === null) callbackReasons.push("financial-callback-time-invalid");
        const dispatchedAt = parseTime(dispatch?.dispatchedAt);
        if (verifiedAt !== null && dispatchedAt !== null && verifiedAt < dispatchedAt) callbackReasons.push("financial-callback-before-dispatch");
      }

      if (!reconciliation || typeof reconciliation !== "object" || Array.isArray(reconciliation)) {
        reconciliationReasons.push("reconciliation-result-missing");
      } else {
        if (reconciliation.status !== "matched") reconciliationReasons.push("reconciliation-not-matched");
        if (reconciliation.digestVerified !== true) reconciliationReasons.push("reconciliation-digest-invalid");
        if (reconciliation.orderId !== orderId) reconciliationReasons.push("reconciliation-order-mismatch");
        if (reconciliation.domain !== normalizedDomain) reconciliationReasons.push("reconciliation-domain-mismatch");
        if (reconciliation.amountFen !== amountFen) reconciliationReasons.push("reconciliation-amount-mismatch");
        if (reconciliation.callbackId !== callback?.id) reconciliationReasons.push("reconciliation-callback-mismatch");
        const reconciledAt = parseTime(reconciliation.reconciledAt);
        if (reconciledAt === null) reconciliationReasons.push("reconciliation-time-invalid");
        const verifiedAt = parseTime(callback?.verifiedAt);
        if (reconciledAt !== null && verifiedAt !== null && reconciledAt < verifiedAt) reconciliationReasons.push("reconciliation-before-callback");
      }
    }

    const reasons = [...new Set([...pricingReasons, ...dispatchReasons, ...callbackReasons, ...reconciliationReasons])];
    return {
      ok: reasons.length === 0,
      domain: normalizedDomain,
      next,
      orderId,
      amountFen,
      expectedIdempotencyKey: expectedKey,
      pricingOk: pricingReasons.length === 0,
      dispatchOk: dispatchReasons.length === 0,
      callbackOk: next !== "settled" || callbackReasons.length === 0,
      reconciliationOk: next !== "settled" || reconciliationReasons.length === 0,
      reasons
    };
  }

  function buildSettlementDispatchEvidence(domain, order = {}, options = {}) {
    const normalizedDomain = normalizeDomain(domain);
    const at = new Date(options.at || Date.now()).toISOString();
    const orderId = String(order.id || "").trim();
    const amountFen = financialAmountFen(order);
    if (amountFen === null) {
      const error = new Error("order amount is invalid for settlement dispatch");
      error.code = "FINANCIAL_AMOUNT_INVALID";
      throw error;
    }
    const command = buildFinancialCommand(normalizedDomain, order, "settlement");
    return {
      pricingConfirmedAt: at,
      pricingConfirmation: {
        status: "confirmed",
        orderId,
        domain: normalizedDomain,
        amountFen,
        currency: "CNY",
        confirmedAt: at,
        policyVersion: WORKFLOW_POLICY_VERSION
      },
      financialDispatch: {
        status: "accepted",
        orderId,
        domain: normalizedDomain,
        operation: "settlement",
        commandType: command.type,
        amountFen,
        idempotencyKey: command.idempotencyKey,
        dispatchedAt: at,
        policyVersion: WORKFLOW_POLICY_VERSION
      }
    };
  }

  function buildSettlementCompletionEvidence(domain, order = {}, details = {}, options = {}) {
    const normalizedDomain = normalizeDomain(domain);
    const at = new Date(options.at || Date.now()).toISOString();
    const orderId = String(order.id || "").trim();
    const amountFen = financialAmountFen(order);
    const idempotencyKey = String(order.financialDispatch?.idempotencyKey || "");
    const providerTransactionId = String(details.providerTransactionId || "");
    const callbackId = String(details.callbackId || `${normalizedDomain}:${orderId}:callback:${providerTransactionId}`);
    return {
      financialCallback: {
        id: callbackId,
        status: details.status || "succeeded",
        signatureStatus: details.signatureVerified === true ? "verified" : "rejected",
        providerTransactionId,
        orderId,
        domain: normalizedDomain,
        amountFen,
        idempotencyKey,
        verifiedAt: at
      },
      reconciliationResult: {
        status: details.reconciliationStatus || "matched",
        digestVerified: details.digestVerified === true,
        orderId,
        domain: normalizedDomain,
        amountFen,
        callbackId,
        reconciledAt: at
      }
    };
  }

  function validateRiskQualityEvidence(domain, order = {}, nextStatus, options = {}) {
    const normalizedDomain = normalizeDomain(domain);
    const next = canonicalStatus(nextStatus, normalizedDomain);
    const current = canonicalStatus(options.currentStatus || order.status, normalizedDomain);
    const orderId = String(order.id || "").trim();
    const residentId = String(order.residentId || "").trim();
    const subjectId = serviceAssignedSubject(normalizedDomain, order);
    const incident = order.adverseEvent;
    const escalation = order.riskEscalation;
    const complaint = order.complaint;
    const callback = order.qualityCallback;
    const decision = order.qualityDecision;
    const incidentReasons = [];
    const escalationReasons = [];
    const complaintReasons = [];
    const callbackReasons = [];
    const decisionReasons = [];

    if (next === "adverse-event") {
      if (!orderId) incidentReasons.push("incident-order-id-missing");
      if (!residentId) incidentReasons.push("incident-resident-id-missing");
      if (!subjectId) incidentReasons.push("incident-subject-missing");
      if (!incident || typeof incident !== "object" || Array.isArray(incident)) {
        incidentReasons.push("incident-report-missing");
      } else {
        if (!incident.id) incidentReasons.push("incident-id-missing");
        if (!["open", "in-review"].includes(incident.status)) incidentReasons.push("incident-status-invalid");
        if (incident.orderId !== orderId) incidentReasons.push("incident-order-mismatch");
        if (incident.domain !== normalizedDomain) incidentReasons.push("incident-domain-mismatch");
        if (incident.residentId !== residentId) incidentReasons.push("incident-resident-mismatch");
        if (incident.subjectId !== subjectId) incidentReasons.push("incident-subject-mismatch");
        if (!["low", "medium", "high", "critical"].includes(incident.severity)) incidentReasons.push("incident-severity-invalid");
        if (!incident.type) incidentReasons.push("incident-type-missing");
        if (!incident.description) incidentReasons.push("incident-description-missing");
        if (!incident.ownerId) incidentReasons.push("incident-owner-missing");
        const occurredAt = parseTime(incident.occurredAt);
        const reportedAt = parseTime(incident.reportedAt);
        const dueAt = parseTime(incident.dueAt);
        if (occurredAt === null) incidentReasons.push("incident-occurred-time-invalid");
        if (reportedAt === null) incidentReasons.push("incident-reported-time-invalid");
        if (dueAt === null) incidentReasons.push("incident-due-time-invalid");
        if (occurredAt !== null && reportedAt !== null && reportedAt < occurredAt) incidentReasons.push("incident-reported-before-occurrence");
        if (reportedAt !== null && dueAt !== null && dueAt <= reportedAt) incidentReasons.push("incident-sla-invalid");
      }
      if (!escalation || typeof escalation !== "object" || Array.isArray(escalation)) {
        escalationReasons.push("risk-escalation-missing");
      } else {
        if (!["notified", "accepted"].includes(escalation.status)) escalationReasons.push("risk-escalation-status-invalid");
        if (escalation.incidentId !== incident?.id) escalationReasons.push("risk-escalation-incident-mismatch");
        if (escalation.orderId !== orderId) escalationReasons.push("risk-escalation-order-mismatch");
        if (escalation.domain !== normalizedDomain) escalationReasons.push("risk-escalation-domain-mismatch");
        if (!escalation.ownerId || escalation.ownerId !== incident?.ownerId) escalationReasons.push("risk-escalation-owner-mismatch");
        if (!escalation.channel) escalationReasons.push("risk-escalation-channel-missing");
        const notifiedAt = parseTime(escalation.notifiedAt);
        const dueAt = parseTime(escalation.dueAt);
        if (notifiedAt === null) escalationReasons.push("risk-escalation-time-invalid");
        if (dueAt === null || dueAt !== parseTime(incident?.dueAt)) escalationReasons.push("risk-escalation-sla-mismatch");
        if (["high", "critical"].includes(incident?.severity) && escalation.emergencyContactStatus !== "notified") {
          escalationReasons.push("emergency-contact-not-notified");
        }
      }
    }

    if (next === "complaint-open") {
      if (!orderId) complaintReasons.push("complaint-order-id-missing");
      if (!residentId) complaintReasons.push("complaint-resident-id-missing");
      if (!complaint || typeof complaint !== "object" || Array.isArray(complaint)) {
        complaintReasons.push("complaint-record-missing");
      } else {
        if (!complaint.id) complaintReasons.push("complaint-id-missing");
        if (complaint.status !== "open") complaintReasons.push("complaint-status-invalid");
        if (complaint.orderId !== orderId) complaintReasons.push("complaint-order-mismatch");
        if (complaint.domain !== normalizedDomain) complaintReasons.push("complaint-domain-mismatch");
        if (complaint.residentId !== residentId) complaintReasons.push("complaint-resident-mismatch");
        if (!["low", "medium", "high", "critical"].includes(complaint.severity)) complaintReasons.push("complaint-severity-invalid");
        if (!complaint.category) complaintReasons.push("complaint-category-missing");
        if (!complaint.description) complaintReasons.push("complaint-description-missing");
        if (!complaint.ownerId) complaintReasons.push("complaint-owner-missing");
        const submittedAt = parseTime(complaint.submittedAt);
        const acknowledgedAt = parseTime(complaint.acknowledgedAt);
        const dueAt = parseTime(complaint.dueAt);
        if (submittedAt === null) complaintReasons.push("complaint-submitted-time-invalid");
        if (acknowledgedAt === null) complaintReasons.push("complaint-acknowledgment-missing");
        if (dueAt === null) complaintReasons.push("complaint-due-time-invalid");
        if (submittedAt !== null && acknowledgedAt !== null && acknowledgedAt < submittedAt) complaintReasons.push("complaint-acknowledged-before-submission");
        if (submittedAt !== null && dueAt !== null && dueAt <= submittedAt) complaintReasons.push("complaint-sla-invalid");
      }
    }

    if (next === "quality-review" || next === "closed") {
      if (!orderId) callbackReasons.push("quality-order-id-missing");
      if (!callback || typeof callback !== "object" || Array.isArray(callback)) {
        callbackReasons.push("quality-callback-missing");
      } else {
        if (callback.status !== "completed") callbackReasons.push("quality-callback-not-completed");
        if (callback.orderId !== orderId) callbackReasons.push("quality-callback-order-mismatch");
        if (callback.domain !== normalizedDomain) callbackReasons.push("quality-callback-domain-mismatch");
        if (!callback.reviewerId) callbackReasons.push("quality-callback-reviewer-missing");
        if (!["passed", "follow-up-required"].includes(callback.result)) callbackReasons.push("quality-callback-result-invalid");
        if (!callback.notes) callbackReasons.push("quality-callback-notes-missing");
        if (parseTime(callback.completedAt) === null) callbackReasons.push("quality-callback-time-invalid");
        if (next === "closed" && callback.result !== "passed") callbackReasons.push("quality-follow-up-incomplete");
      }
      if (incident?.status && incident.status !== "none" && !["resolved", "closed"].includes(incident.status)) {
        incidentReasons.push("incident-unresolved");
      }
      if ((current === "complaint-open" || complaint?.status) && complaint?.status !== "none" && !["resolved", "closed"].includes(complaint?.status)) {
        complaintReasons.push("complaint-unresolved");
      }
      if (["resolved", "closed"].includes(complaint?.status)) {
        if (!complaint.resolution) complaintReasons.push("complaint-resolution-missing");
        if (!complaint.resolvedBy) complaintReasons.push("complaint-resolver-missing");
        const resolvedAt = parseTime(complaint.resolvedAt);
        const submittedAt = parseTime(complaint.submittedAt);
        const dueAt = parseTime(complaint.dueAt);
        const residentNotifiedAt = parseTime(complaint.residentNotifiedAt);
        if (resolvedAt === null) complaintReasons.push("complaint-resolved-time-invalid");
        if (resolvedAt !== null && submittedAt !== null && resolvedAt < submittedAt) complaintReasons.push("complaint-resolved-before-submission");
        if (residentNotifiedAt === null) complaintReasons.push("complaint-resident-notification-missing");
        if (residentNotifiedAt !== null && resolvedAt !== null && residentNotifiedAt < resolvedAt) complaintReasons.push("complaint-resident-notified-before-resolution");
        if (resolvedAt !== null && dueAt !== null && resolvedAt > dueAt
          && (!complaint.slaBreachReason || parseTime(complaint.escalatedAt) === null)) {
          complaintReasons.push("complaint-sla-breach-unexplained");
        }
      }
      if (["resolved", "closed"].includes(incident?.status)) {
        if (!incident.resolution) incidentReasons.push("incident-resolution-missing");
        if (!incident.reviewedBy) incidentReasons.push("incident-reviewer-missing");
        const resolvedAt = parseTime(incident.resolvedAt);
        const reportedAt = parseTime(incident.reportedAt);
        const dueAt = parseTime(incident.dueAt);
        if (resolvedAt === null) incidentReasons.push("incident-resolved-time-invalid");
        if (resolvedAt !== null && reportedAt !== null && resolvedAt < reportedAt) incidentReasons.push("incident-resolved-before-report");
        if (resolvedAt !== null && dueAt !== null && resolvedAt > dueAt
          && (!incident.slaBreachReason || parseTime(incident.escalatedAt) === null)) {
          incidentReasons.push("incident-sla-breach-unexplained");
        }
      }
    }

    if (next === "closed") {
      if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
        decisionReasons.push("quality-decision-missing");
      } else {
        if (decision.status !== "passed") decisionReasons.push("quality-decision-not-passed");
        if (decision.orderId !== orderId) decisionReasons.push("quality-decision-order-mismatch");
        if (decision.domain !== normalizedDomain) decisionReasons.push("quality-decision-domain-mismatch");
        if (!decision.reviewerId) decisionReasons.push("quality-decision-reviewer-missing");
        if (!Array.isArray(decision.basis) || decision.basis.filter(Boolean).length === 0) decisionReasons.push("quality-decision-basis-missing");
        const decidedAt = parseTime(decision.decidedAt);
        if (decidedAt === null) decisionReasons.push("quality-decision-time-invalid");
        const callbackAt = parseTime(callback?.completedAt);
        if (decidedAt !== null && callbackAt !== null && decidedAt < callbackAt) decisionReasons.push("quality-decision-before-callback");
      }
    }

    const reasons = [...new Set([
      ...incidentReasons,
      ...escalationReasons,
      ...complaintReasons,
      ...callbackReasons,
      ...decisionReasons
    ])];
    return {
      ok: reasons.length === 0,
      domain: normalizedDomain,
      current,
      next,
      orderId,
      incidentOk: incidentReasons.length === 0,
      escalationOk: escalationReasons.length === 0,
      complaintOk: complaintReasons.length === 0,
      callbackOk: callbackReasons.length === 0,
      decisionOk: decisionReasons.length === 0,
      reasons
    };
  }

  function buildRiskIncidentEvidence(domain, order = {}, details = {}, options = {}) {
    const normalizedDomain = normalizeDomain(domain);
    const at = new Date(options.at || Date.now()).toISOString();
    const severity = String(details.severity || "medium");
    const dueHours = ["high", "critical"].includes(severity) ? 2 : 24;
    const dueAt = new Date(new Date(at).getTime() + dueHours * 60 * 60 * 1000).toISOString();
    const orderId = String(order.id || "");
    const incidentId = String(details.id || `${normalizedDomain}:${orderId}:incident:${at}`);
    const ownerId = String(details.ownerId || "");
    return {
      adverseEvent: {
        id: incidentId,
        status: "open",
        orderId,
        domain: normalizedDomain,
        residentId: String(order.residentId || ""),
        subjectId: serviceAssignedSubject(normalizedDomain, order),
        severity,
        type: String(details.type || ""),
        description: String(details.description || ""),
        ownerId,
        occurredAt: new Date(details.occurredAt || at).toISOString(),
        reportedAt: at,
        dueAt
      },
      riskEscalation: {
        status: "notified",
        incidentId,
        orderId,
        domain: normalizedDomain,
        ownerId,
        channel: String(details.channel || "risk-duty"),
        notifiedAt: at,
        dueAt,
        emergencyContactStatus: details.emergencyContactNotified === true ? "notified" : "pending"
      }
    };
  }

  function buildRiskResolutionEvidence(order = {}, details = {}, options = {}) {
    const at = new Date(options.at || Date.now()).toISOString();
    return {
      adverseEvent: {
        ...(order.adverseEvent || {}),
        status: "resolved",
        resolution: String(details.resolution || ""),
        reviewedBy: String(details.reviewedBy || ""),
        resolvedAt: at,
        slaBreachReason: String(details.slaBreachReason || ""),
        escalatedAt: details.escalatedAt ? new Date(details.escalatedAt).toISOString() : ""
      },
      riskEscalation: {
        ...(order.riskEscalation || {}),
        status: "closed",
        closedAt: at
      }
    };
  }

  function buildComplaintEvidence(domain, order = {}, details = {}, options = {}) {
    const normalizedDomain = normalizeDomain(domain);
    const at = new Date(options.at || Date.now()).toISOString();
    const severity = String(details.severity || "medium");
    const dueHours = ["high", "critical"].includes(severity) ? 4 : 24;
    return {
      complaintStatus: "open",
      complaint: {
        id: String(details.id || `${normalizedDomain}:${order.id || "order"}:complaint:${at}`),
        status: "open",
        orderId: String(order.id || ""),
        domain: normalizedDomain,
        residentId: String(order.residentId || ""),
        severity,
        category: String(details.category || ""),
        description: String(details.description || ""),
        ownerId: String(details.ownerId || ""),
        submittedAt: at,
        acknowledgedAt: at,
        dueAt: new Date(new Date(at).getTime() + dueHours * 60 * 60 * 1000).toISOString()
      }
    };
  }

  function buildComplaintResolutionEvidence(order = {}, details = {}, options = {}) {
    const at = new Date(options.at || Date.now()).toISOString();
    return {
      complaintStatus: "closed",
      complaint: {
        ...(order.complaint || {}),
        status: "resolved",
        resolution: String(details.resolution || ""),
        resolvedBy: String(details.resolvedBy || ""),
        resolvedAt: at,
        residentNotifiedAt: details.residentNotified === true ? at : "",
        slaBreachReason: String(details.slaBreachReason || ""),
        escalatedAt: details.escalatedAt ? new Date(details.escalatedAt).toISOString() : ""
      }
    };
  }

  function buildQualityReviewEvidence(domain, order = {}, details = {}, options = {}) {
    const normalizedDomain = normalizeDomain(domain);
    const at = new Date(options.at || Date.now()).toISOString();
    return {
      qualityCallback: {
        status: "completed",
        orderId: String(order.id || ""),
        domain: normalizedDomain,
        reviewerId: String(details.reviewerId || ""),
        result: String(details.result || "passed"),
        notes: String(details.notes || ""),
        completedAt: at
      }
    };
  }

  function buildQualityClosureEvidence(domain, order = {}, details = {}, options = {}) {
    const normalizedDomain = normalizeDomain(domain);
    const at = new Date(options.at || Date.now()).toISOString();
    return {
      qualityDecision: {
        status: details.status || "passed",
        orderId: String(order.id || ""),
        domain: normalizedDomain,
        reviewerId: String(details.reviewerId || ""),
        basis: Array.isArray(details.basis) ? details.basis.filter(Boolean) : [],
        decidedAt: at
      }
    };
  }

  function evidenceTypes(order = {}) {
    const types = new Set((Array.isArray(order.evidence) ? order.evidence : []).map((item) => typeof item === "string" ? item : item?.type).filter(Boolean));
    if (order.identityVerified) types.add("identity-verification");
    if (order.firstVisitAssessment === "passed") types.add("first-visit-assessment");
    if (order.informedConsent === "signed" && order.consentAttachment?.status === "signed") types.add("signed-consent");
    if (order.workerAcceptedAt || order.nurseAcceptedAt || order.status === "accepted") types.add("worker-acceptance");
    if (order.providerAdmissionSnapshot || order.provider?.published) types.add("provider-admission-snapshot");
    if (order.eligibilityResult) types.add("eligibility-result");
    if (order.hospitalInterfaceStatus === "confirmed" && (order.hisVisitId || order.hospitalCheckInNo)) types.add("hospital-handoff");
    const tracePoints = Array.isArray(order.locationTracePoints) ? order.locationTracePoints : [];
    if (tracePoints.some((item) => item.stage === "service-start" && item.verified !== false)) types.add("location-start");
    if (tracePoints.some((item) => item.stage === "service-complete" && item.verified !== false)) types.add("location-end");
    if (order.serviceCheckInAt || tracePoints.some((item) => item.stage === "service-start")) types.add("service-check-in");
    if (order.serviceRecord?.status === "completed" || order.serviceRecordStatus === "completed") types.add("service-record");
    if (order.residentConfirmation?.status === "confirmed" || order.residentConfirmation === "confirmed" || order.residentServiceConfirmation === "confirmed" || (order.serviceAttachments || []).some((item) => item.type === "resident-signature")) types.add("resident-confirmation");
    if (["none", "resolved"].includes(order.serviceRecord?.exceptionReport?.status) || ["none", "closed", "resolved"].includes(order.adverseEvent?.status)) types.add("exception-declaration");
    return types;
  }

  function validateEvidenceForTransition(domain, order = {}, nextStatus, options = {}) {
    const normalizedDomain = normalizeDomain(domain);
    const next = canonicalStatus(nextStatus, normalizedDomain);
    const required = [...(EVIDENCE_GATES[normalizedDomain][next] || [])];
    const present = evidenceTypes(order);
    let dispatchIntegrity = null;
    let financialIntegrity = null;
    let riskQualityIntegrity = null;
    if (next === dispatchTargetState(normalizedDomain)) {
      dispatchIntegrity = validateDispatchEvidence(normalizedDomain, order, options);
      if (dispatchIntegrity.qualificationOk) present.add("qualification-snapshot");
      if (dispatchIntegrity.qualificationOk && dispatchIntegrity.decisionOk) present.add("dispatch-decision");
    }
    if (["settlement-pending", "settled"].includes(next)) {
      financialIntegrity = validateFinancialEvidence(normalizedDomain, order, next);
      if (financialIntegrity.pricingOk) present.add("pricing-confirmation");
      if (financialIntegrity.dispatchOk) present.add("financial-dispatch");
      if (financialIntegrity.callbackOk && next === "settled") present.add("financial-callback");
      if (financialIntegrity.reconciliationOk && next === "settled") present.add("reconciliation-result");
    }
    if (["adverse-event", "complaint-open", "quality-review", "closed"].includes(next)) {
      riskQualityIntegrity = validateRiskQualityEvidence(normalizedDomain, order, next, options);
      if (next === "adverse-event" && riskQualityIntegrity.incidentOk) present.add("incident-report");
      if (next === "adverse-event" && riskQualityIntegrity.escalationOk) present.add("risk-escalation");
      if (next === "complaint-open" && riskQualityIntegrity.complaintOk) present.add("complaint-record");
      if (["quality-review", "closed"].includes(next) && riskQualityIntegrity.callbackOk) present.add("quality-callback");
      if (next === "closed" && riskQualityIntegrity.decisionOk) present.add("quality-decision");
    }
    const missing = required.filter((item) => !present.has(item));
    return {
      ok: missing.length === 0,
      domain: normalizedDomain,
      next,
      required,
      missing,
      present: [...present],
      dispatchIntegrity,
      financialIntegrity,
      riskQualityIntegrity
    };
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
      evidenceTypes: validateEvidenceForTransition(domain, order, transition.next, { at, currentStatus: transition.current }).present,
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
    if (transition.next === dispatchTargetState(domain)) {
      const integrity = validateDispatchEvidence(domain, candidate, { at: options.at });
      if (!integrity.ok) {
        const error = new Error(`invalid dispatch evidence for ${transition.next}: ${integrity.reasons.join(", ")}`);
        error.code = "ORDER_DISPATCH_INTEGRITY_INVALID";
        error.statusCode = 409;
        error.details = integrity;
        throw error;
      }
    }
    if (["in-service", "completed"].includes(transition.next)) {
      const serviceEvidence = validateServiceEvidence(domain, candidate, transition.next);
      if (!serviceEvidence.ok) {
        const error = new Error(`invalid service evidence for ${transition.next}: ${serviceEvidence.reasons.join(", ")}`);
        error.code = "ORDER_SERVICE_EVIDENCE_INVALID";
        error.statusCode = 409;
        error.details = serviceEvidence;
        throw error;
      }
    }
    if (["settlement-pending", "settled"].includes(transition.next)) {
      const financialEvidence = validateFinancialEvidence(domain, candidate, transition.next);
      if (!financialEvidence.ok) {
        const error = new Error(`invalid financial evidence for ${transition.next}: ${financialEvidence.reasons.join(", ")}`);
        error.code = "ORDER_FINANCIAL_EVIDENCE_INVALID";
        error.statusCode = 409;
        error.details = financialEvidence;
        throw error;
      }
    }
    if (["adverse-event", "complaint-open", "quality-review", "closed"].includes(transition.next)) {
      const riskQualityEvidence = validateRiskQualityEvidence(domain, candidate, transition.next, { currentStatus: transition.current });
      if (!riskQualityEvidence.ok) {
        const error = new Error(`invalid risk or quality evidence for ${transition.next}: ${riskQualityEvidence.reasons.join(", ")}`);
        error.code = "ORDER_RISK_QUALITY_EVIDENCE_INVALID";
        error.statusCode = 409;
        error.details = riskQualityEvidence;
        throw error;
      }
    }
    const evidence = validateEvidenceForTransition(domain, candidate, transition.next, { at: options.at, currentStatus: transition.current });
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
      workflowVersion: WORKFLOW_POLICY_VERSION,
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
    validateDispatchEvidence,
    assessOrderRisk,
    validateServiceEvidence,
    buildServiceStartEvidence,
    buildServiceCompletionEvidence,
    validateFinancialEvidence,
    buildSettlementDispatchEvidence,
    buildSettlementCompletionEvidence,
    validateRiskQualityEvidence,
    buildRiskIncidentEvidence,
    buildRiskResolutionEvidence,
    buildComplaintEvidence,
    buildComplaintResolutionEvidence,
    buildQualityReviewEvidence,
    buildQualityClosureEvidence,
    evidenceTypes,
    validateEvidenceForTransition,
    buildTimelineEvent,
    transitionOrder,
    buildFinancialCommand
  });
});
