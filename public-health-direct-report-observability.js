"use strict";

const { createHash } = require("node:crypto");

const CONTRACT_ID = "public-health-direct-report-v1";
const SHA256 = /^[a-f0-9]{64}$/;
const DELIVERY_STATES = Object.freeze([
  "queued",
  "leased",
  "retry-scheduled",
  "awaiting-callback",
  "callback-accepted",
  "callback-rejected",
  "dead-letter"
]);

const DEFAULT_THRESHOLDS = Object.freeze({
  queueBacklogMax: 20,
  deadLetterRateMaxRatio: 0.01,
  callbackTimeoutSeconds: 300,
  evidenceExpiryWarningSeconds: 24 * 60 * 60
});

const ALERT_CATALOG = Object.freeze({
  PUBLIC_HEALTH_DIRECT_REPORT_QUEUE_BACKLOG_HIGH: {
    severity: "warning",
    owner: "hospital-information-center",
    title: "传染病直报队列积压超过 SLO",
    summary: "直报待处理投递数量超过受控阈值。",
    recoveryCondition: "QUEUE_BACKLOG_AT_OR_BELOW_SLO"
  },
  PUBLIC_HEALTH_DIRECT_REPORT_DEAD_LETTER_RATE_HIGH: {
    severity: "critical",
    owner: "hospital-information-center",
    title: "传染病直报死信率超过 SLO",
    summary: "直报死信占已尝试投递的比例超过受控阈值。",
    recoveryCondition: "DEAD_LETTER_RATE_AT_OR_BELOW_SLO"
  },
  PUBLIC_HEALTH_DIRECT_REPORT_CALLBACK_TIMEOUT: {
    severity: "critical",
    owner: "joint-direct-report-operations",
    title: "传染病直报回执超时",
    summary: "存在超过受控时限仍未收到可信终态回调的投递。",
    recoveryCondition: "NO_CALLBACK_EXCEEDS_TIMEOUT"
  },
  PUBLIC_HEALTH_DIRECT_REPORT_EVIDENCE_EXPIRING: {
    severity: "warning",
    owner: "direct-report-control-custodians",
    title: "传染病直报联合测试证据即将过期",
    summary: "联合测试证据剩余有效期已进入预警窗口。",
    recoveryCondition: "EVIDENCE_VALIDITY_EXCEEDS_WARNING_WINDOW"
  },
  PUBLIC_HEALTH_DIRECT_REPORT_EVIDENCE_EXPIRED: {
    severity: "critical",
    owner: "direct-report-control-custodians",
    title: "传染病直报联合测试证据已过期",
    summary: "联合测试证据已失效，局部激活条件不再成立。",
    recoveryCondition: "CURRENT_JOINT_TEST_EVIDENCE_VERIFIED"
  },
  PUBLIC_HEALTH_DIRECT_REPORT_EVIDENCE_UNAVAILABLE: {
    severity: "critical",
    owner: "direct-report-control-custodians",
    title: "传染病直报联合测试证据状态不可用",
    summary: "安全控制投影未提供可验证的联合测试证据有效期。",
    recoveryCondition: "CONTROL_STATUS_EXPOSES_CURRENT_EVIDENCE_EXPIRY"
  },
  PUBLIC_HEALTH_DIRECT_REPORT_CONTROL_REFERENCE_MISSING: {
    severity: "critical",
    owner: "direct-report-control-custodians",
    title: "传染病直报受控指纹基线缺失",
    summary: "无法使用已批准摘要判断字典与映射是否漂移。",
    recoveryCondition: "APPROVED_DICTIONARY_AND_MAPPING_REFERENCES_PINNED"
  },
  PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_DRIFT: {
    severity: "critical",
    owner: "direct-report-control-custodians",
    title: "传染病直报字典摘要漂移",
    summary: "运行时字典摘要与已批准基线不一致。",
    recoveryCondition: "RUNTIME_DICTIONARY_MATCHES_APPROVED_DIGEST"
  },
  PUBLIC_HEALTH_DIRECT_REPORT_MAPPING_DRIFT: {
    severity: "critical",
    owner: "direct-report-control-custodians",
    title: "传染病直报映射指纹漂移",
    summary: "运行时字段映射指纹与已批准基线不一致。",
    recoveryCondition: "RUNTIME_MAPPING_MATCHES_APPROVED_FINGERPRINT"
  },
  PUBLIC_HEALTH_DIRECT_REPORT_SIGNATURE_FAILURE: {
    severity: "critical",
    owner: "security-operations",
    title: "传染病直报签名验证失败",
    summary: "监控窗口内发现回调或控制证据签名验证失败。",
    recoveryCondition: "NO_SIGNATURE_FAILURES_IN_MONITORING_WINDOW"
  }
});

class DirectReportObservabilityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DirectReportObservabilityError";
    this.code = code;
    this.statusCode = 400;
  }
}

function clean(value, maximum = 160) {
  return String(value ?? "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function sha256(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function isoTime(value, label) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) {
    throw new DirectReportObservabilityError(
      "PUBLIC_HEALTH_DIRECT_REPORT_OBSERVABILITY_TIME_INVALID",
      `${label} must be a valid date-time`
    );
  }
  return new Date(parsed).toISOString();
}

function nonNegativeInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new DirectReportObservabilityError(
      "PUBLIC_HEALTH_DIRECT_REPORT_OBSERVABILITY_COUNT_INVALID",
      `${label} must be a non-negative safe integer`
    );
  }
  return parsed;
}

function normalizeThresholds(input = {}) {
  const thresholds = {
    queueBacklogMax: Number(input.queueBacklogMax ?? DEFAULT_THRESHOLDS.queueBacklogMax),
    deadLetterRateMaxRatio: Number(
      input.deadLetterRateMaxRatio ?? DEFAULT_THRESHOLDS.deadLetterRateMaxRatio
    ),
    callbackTimeoutSeconds: Number(
      input.callbackTimeoutSeconds ?? DEFAULT_THRESHOLDS.callbackTimeoutSeconds
    ),
    evidenceExpiryWarningSeconds: Number(
      input.evidenceExpiryWarningSeconds ?? DEFAULT_THRESHOLDS.evidenceExpiryWarningSeconds
    )
  };
  if (
    !Number.isSafeInteger(thresholds.queueBacklogMax)
    || thresholds.queueBacklogMax < 1
    || thresholds.queueBacklogMax > 1000000
    || !Number.isFinite(thresholds.deadLetterRateMaxRatio)
    || thresholds.deadLetterRateMaxRatio < 0
    || thresholds.deadLetterRateMaxRatio > 1
    || !Number.isSafeInteger(thresholds.callbackTimeoutSeconds)
    || thresholds.callbackTimeoutSeconds < 30
    || thresholds.callbackTimeoutSeconds > 7 * 24 * 60 * 60
    || !Number.isSafeInteger(thresholds.evidenceExpiryWarningSeconds)
    || thresholds.evidenceExpiryWarningSeconds < 60
    || thresholds.evidenceExpiryWarningSeconds > 30 * 24 * 60 * 60
  ) {
    throw new DirectReportObservabilityError(
      "PUBLIC_HEALTH_DIRECT_REPORT_OBSERVABILITY_THRESHOLD_INVALID",
      "direct-report observability thresholds are outside the controlled bounds"
    );
  }
  return thresholds;
}

function stateCounts(deliveries) {
  const counts = Object.fromEntries(DELIVERY_STATES.map((state) => [state, 0]));
  deliveries.forEach((delivery) => {
    const state = clean(delivery?.state, 40);
    if (Object.hasOwn(counts, state)) counts[state] += 1;
  });
  return counts;
}

function collectDirectReportObservabilitySnapshot(input = {}, options = {}) {
  const generatedAt = isoTime(
    options.now || input.generatedAt || new Date().toISOString(),
    "observability generatedAt"
  );
  const nowMs = Date.parse(generatedAt);
  const deliveries = Array.isArray(input.deliveries) ? input.deliveries : [];
  if (deliveries.length > 1000000) {
    throw new DirectReportObservabilityError(
      "PUBLIC_HEALTH_DIRECT_REPORT_OBSERVABILITY_SAMPLE_TOO_LARGE",
      "direct-report observability sample exceeds the controlled bound"
    );
  }
  const thresholds = normalizeThresholds(options.thresholds);
  const counts = stateCounts(deliveries);
  const queueBacklog = counts.queued + counts.leased + counts["retry-scheduled"];
  const attempted = deliveries.filter((delivery) => Number(delivery?.attemptCount || 0) > 0).length;
  const callbackTimeouts = deliveries.filter((delivery) => {
    if (clean(delivery?.state, 40) !== "awaiting-callback") return false;
    const acceptedAt = Date.parse(String(delivery?.providerReceipt?.acceptedAt || ""));
    return Number.isFinite(acceptedAt)
      && nowMs - acceptedAt > thresholds.callbackTimeoutSeconds * 1000;
  }).length;
  const awaitingTimes = deliveries
    .filter((delivery) => clean(delivery?.state, 40) === "awaiting-callback")
    .map((delivery) => Date.parse(String(delivery?.providerReceipt?.acceptedAt || "")))
    .filter(Number.isFinite);
  const oldestCallbackAgeSeconds = awaitingTimes.length
    ? Math.max(0, Math.floor((nowMs - Math.min(...awaitingTimes)) / 1000))
    : 0;
  const observedInvalidSignatures = deliveries.filter((delivery) => (
    delivery?.trustedCallback
    && delivery.trustedCallback.signatureVerified !== true
  )).length;
  const signatureFailureCount = nonNegativeInteger(
    input.signatureFailureCount || 0,
    "signatureFailureCount"
  ) + observedInvalidSignatures;
  const controlStatus = input.controlStatus && typeof input.controlStatus === "object"
    ? input.controlStatus
    : {};
  const expectedControl = input.expectedControl && typeof input.expectedControl === "object"
    ? input.expectedControl
    : {};
  const evidenceExpiresAt = Number.isFinite(Date.parse(String(controlStatus.evidenceExpiresAt || "")))
    ? new Date(Date.parse(controlStatus.evidenceExpiresAt)).toISOString()
    : null;
  const evidenceExpirySeconds = evidenceExpiresAt
    ? Math.floor((Date.parse(evidenceExpiresAt) - nowMs) / 1000)
    : null;
  const dictionaryDigest = clean(controlStatus.dictionaryDigest, 64);
  const mappingFingerprint = clean(controlStatus.mappingFingerprint, 64);
  const expectedDictionaryDigest = clean(expectedControl.dictionaryDigest, 64);
  const expectedMappingFingerprint = clean(expectedControl.mappingFingerprint, 64);
  const controlReferenceAvailable = (
    SHA256.test(dictionaryDigest)
    && SHA256.test(mappingFingerprint)
    && SHA256.test(expectedDictionaryDigest)
    && SHA256.test(expectedMappingFingerprint)
  );

  return {
    schemaVersion: "public-health-direct-report-observability-snapshot-v1",
    contractId: CONTRACT_ID,
    generatedAt,
    thresholds,
    delivery: {
      total: deliveries.length,
      attempted,
      queueBacklog,
      deadLetters: counts["dead-letter"],
      awaitingCallback: counts["awaiting-callback"],
      callbackTimeouts,
      oldestCallbackAgeSeconds,
      stateCounts: counts
    },
    control: {
      activationReady: controlStatus.activationReady === true,
      evidenceExpiresAt,
      evidenceExpirySeconds,
      controlReferenceAvailable,
      dictionaryDrift: controlReferenceAvailable
        ? dictionaryDigest !== expectedDictionaryDigest
        : null,
      mappingDrift: controlReferenceAvailable
        ? mappingFingerprint !== expectedMappingFingerprint
        : null
    },
    security: {
      signatureFailureCount
    },
    containsResidentData: false,
    containsRawMessages: false,
    containsCredentials: false,
    productionReady: false
  };
}

function alert(code, overrides = {}) {
  const definition = ALERT_CATALOG[code];
  return {
    code,
    fingerprint: sha256(`${CONTRACT_ID}:${code}`).slice(0, 32),
    severity: overrides.severity || definition.severity,
    responsibleParty: definition.owner,
    title: definition.title,
    summary: definition.summary,
    recoveryCondition: definition.recoveryCondition,
    active: true
  };
}

function slo(code, current, target, met, unit) {
  return { code, current, target, unit, met: met === true };
}

function evaluateDirectReportObservability(snapshot = {}) {
  if (
    snapshot.schemaVersion !== "public-health-direct-report-observability-snapshot-v1"
    || snapshot.contractId !== CONTRACT_ID
    || !snapshot.delivery
    || !snapshot.control
    || !snapshot.security
  ) {
    throw new DirectReportObservabilityError(
      "PUBLIC_HEALTH_DIRECT_REPORT_OBSERVABILITY_SNAPSHOT_INVALID",
      "direct-report observability requires a normalized safe snapshot"
    );
  }
  const { thresholds, delivery, control, security } = snapshot;
  const attempted = nonNegativeInteger(delivery.attempted, "delivery.attempted");
  const deadLetters = nonNegativeInteger(delivery.deadLetters, "delivery.deadLetters");
  const deadLetterRateRatio = attempted ? deadLetters / attempted : 0;
  const queueMet = delivery.queueBacklog <= thresholds.queueBacklogMax;
  const deadLetterMet = deadLetterRateRatio <= thresholds.deadLetterRateMaxRatio;
  const callbackMet = delivery.callbackTimeouts === 0;
  const evidenceMet = (
    control.evidenceExpirySeconds !== null
    && control.evidenceExpirySeconds > thresholds.evidenceExpiryWarningSeconds
  );
  const referenceMet = control.controlReferenceAvailable === true;
  const dictionaryMet = referenceMet && control.dictionaryDrift === false;
  const mappingMet = referenceMet && control.mappingDrift === false;
  const signatureMet = security.signatureFailureCount === 0;
  const alerts = [];
  if (!queueMet) {
    alerts.push(alert(
      "PUBLIC_HEALTH_DIRECT_REPORT_QUEUE_BACKLOG_HIGH",
      {
        severity: delivery.queueBacklog > thresholds.queueBacklogMax * 2
          ? "critical"
          : "warning"
      }
    ));
  }
  if (!deadLetterMet) alerts.push(alert("PUBLIC_HEALTH_DIRECT_REPORT_DEAD_LETTER_RATE_HIGH"));
  if (!callbackMet) alerts.push(alert("PUBLIC_HEALTH_DIRECT_REPORT_CALLBACK_TIMEOUT"));
  if (control.evidenceExpirySeconds === null) {
    alerts.push(alert("PUBLIC_HEALTH_DIRECT_REPORT_EVIDENCE_UNAVAILABLE"));
  } else if (control.evidenceExpirySeconds <= 0) {
    alerts.push(alert("PUBLIC_HEALTH_DIRECT_REPORT_EVIDENCE_EXPIRED"));
  } else if (!evidenceMet) {
    alerts.push(alert("PUBLIC_HEALTH_DIRECT_REPORT_EVIDENCE_EXPIRING"));
  }
  if (!referenceMet) {
    alerts.push(alert("PUBLIC_HEALTH_DIRECT_REPORT_CONTROL_REFERENCE_MISSING"));
  } else {
    if (!dictionaryMet) alerts.push(alert("PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_DRIFT"));
    if (!mappingMet) alerts.push(alert("PUBLIC_HEALTH_DIRECT_REPORT_MAPPING_DRIFT"));
  }
  if (!signatureMet) alerts.push(alert("PUBLIC_HEALTH_DIRECT_REPORT_SIGNATURE_FAILURE"));
  alerts.sort((left, right) => left.code.localeCompare(right.code));
  const slos = [
    slo(
      "queue-backlog",
      delivery.queueBacklog,
      thresholds.queueBacklogMax,
      queueMet,
      "deliveries"
    ),
    slo(
      "dead-letter-rate",
      Number(deadLetterRateRatio.toFixed(6)),
      thresholds.deadLetterRateMaxRatio,
      deadLetterMet,
      "ratio"
    ),
    slo(
      "callback-timeout",
      delivery.callbackTimeouts,
      0,
      callbackMet,
      "deliveries"
    ),
    slo(
      "evidence-validity",
      control.evidenceExpirySeconds,
      thresholds.evidenceExpiryWarningSeconds,
      evidenceMet,
      "seconds"
    ),
    slo("dictionary-fingerprint", dictionaryMet ? 1 : 0, 1, dictionaryMet, "boolean"),
    slo("mapping-fingerprint", mappingMet ? 1 : 0, 1, mappingMet, "boolean"),
    slo("signature-verification", security.signatureFailureCount, 0, signatureMet, "failures")
  ];
  const criticalCount = alerts.filter((item) => item.severity === "critical").length;
  return {
    schemaVersion: "public-health-direct-report-observability-report-v1",
    contractId: CONTRACT_ID,
    generatedAt: snapshot.generatedAt,
    status: criticalCount ? "critical" : alerts.length ? "degraded" : "healthy",
    monitoringReady: alerts.length === 0,
    metrics: {
      queueBacklog: delivery.queueBacklog,
      deadLetters,
      deadLetterRateRatio: Number(deadLetterRateRatio.toFixed(6)),
      awaitingCallback: delivery.awaitingCallback,
      callbackTimeouts: delivery.callbackTimeouts,
      oldestCallbackAgeSeconds: delivery.oldestCallbackAgeSeconds,
      evidenceExpirySeconds: control.evidenceExpirySeconds,
      dictionaryDrift: control.dictionaryDrift,
      mappingDrift: control.mappingDrift,
      signatureFailures: security.signatureFailureCount
    },
    slos,
    alerts,
    safety: {
      aggregateOnly: true,
      residentDataIncluded: false,
      rawMessagesIncluded: false,
      credentialsIncluded: false
    },
    blockers: [
      ...(alerts.length ? alerts.map((item) => item.code) : []),
      "SITE_MONITORING_DELIVERY_AND_SIGNED_ACCEPTANCE_REQUIRED"
    ],
    productionReady: false
  };
}

function buildDirectReportObservabilityReport(input = {}, options = {}) {
  return evaluateDirectReportObservability(
    collectDirectReportObservabilitySnapshot(input, options)
  );
}

function prometheusNumber(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "NaN";
  return String(Number(value));
}

function renderDirectReportPrometheus(report = {}) {
  if (
    report.schemaVersion !== "public-health-direct-report-observability-report-v1"
    || report.contractId !== CONTRACT_ID
  ) {
    throw new DirectReportObservabilityError(
      "PUBLIC_HEALTH_DIRECT_REPORT_OBSERVABILITY_REPORT_INVALID",
      "Prometheus rendering requires a safe direct-report observability report"
    );
  }
  const severityCounts = ["critical", "warning", "info"].map((severity) => (
    report.alerts.filter((item) => item.severity === severity).length
  ));
  const lines = [
    "# HELP health_platform_public_health_direct_report_queue_backlog Current direct-report queue backlog.",
    "# TYPE health_platform_public_health_direct_report_queue_backlog gauge",
    `health_platform_public_health_direct_report_queue_backlog ${prometheusNumber(report.metrics.queueBacklog)}`,
    "# HELP health_platform_public_health_direct_report_dead_letter_rate_ratio Direct-report dead-letter rate.",
    "# TYPE health_platform_public_health_direct_report_dead_letter_rate_ratio gauge",
    `health_platform_public_health_direct_report_dead_letter_rate_ratio ${prometheusNumber(report.metrics.deadLetterRateRatio)}`,
    "# HELP health_platform_public_health_direct_report_callback_timeouts Direct-report callbacks exceeding the SLO.",
    "# TYPE health_platform_public_health_direct_report_callback_timeouts gauge",
    `health_platform_public_health_direct_report_callback_timeouts ${prometheusNumber(report.metrics.callbackTimeouts)}`,
    "# HELP health_platform_public_health_direct_report_evidence_expiry_seconds Remaining joint-test evidence validity.",
    "# TYPE health_platform_public_health_direct_report_evidence_expiry_seconds gauge",
    `health_platform_public_health_direct_report_evidence_expiry_seconds ${prometheusNumber(report.metrics.evidenceExpirySeconds)}`,
    "# HELP health_platform_public_health_direct_report_dictionary_drift Dictionary digest drift flag.",
    "# TYPE health_platform_public_health_direct_report_dictionary_drift gauge",
    `health_platform_public_health_direct_report_dictionary_drift ${report.metrics.dictionaryDrift === true ? 1 : report.metrics.dictionaryDrift === false ? 0 : "NaN"}`,
    "# HELP health_platform_public_health_direct_report_mapping_drift Mapping fingerprint drift flag.",
    "# TYPE health_platform_public_health_direct_report_mapping_drift gauge",
    `health_platform_public_health_direct_report_mapping_drift ${report.metrics.mappingDrift === true ? 1 : report.metrics.mappingDrift === false ? 0 : "NaN"}`,
    "# HELP health_platform_public_health_direct_report_signature_failures Signature verification failures in the monitoring window.",
    "# TYPE health_platform_public_health_direct_report_signature_failures gauge",
    `health_platform_public_health_direct_report_signature_failures ${prometheusNumber(report.metrics.signatureFailures)}`,
    "# HELP health_platform_public_health_direct_report_active_alerts Active aggregate alerts by severity.",
    "# TYPE health_platform_public_health_direct_report_active_alerts gauge",
    `health_platform_public_health_direct_report_active_alerts{severity="critical"} ${severityCounts[0]}`,
    `health_platform_public_health_direct_report_active_alerts{severity="warning"} ${severityCounts[1]}`,
    `health_platform_public_health_direct_report_active_alerts{severity="info"} ${severityCounts[2]}`,
    "# HELP health_platform_public_health_direct_report_production_ready Repository output never approves production.",
    "# TYPE health_platform_public_health_direct_report_production_ready gauge",
    "health_platform_public_health_direct_report_production_ready 0"
  ];
  return `${lines.join("\n")}\n`;
}

function renderDirectReportObservabilityJson(report = {}) {
  if (
    report.schemaVersion !== "public-health-direct-report-observability-report-v1"
    || report.contractId !== CONTRACT_ID
  ) {
    throw new DirectReportObservabilityError(
      "PUBLIC_HEALTH_DIRECT_REPORT_OBSERVABILITY_REPORT_INVALID",
      "JSON rendering requires a safe direct-report observability report"
    );
  }
  return `${JSON.stringify(report, null, 2)}\n`;
}

module.exports = {
  ALERT_CATALOG,
  CONTRACT_ID,
  DEFAULT_THRESHOLDS,
  DELIVERY_STATES,
  DirectReportObservabilityError,
  buildDirectReportObservabilityReport,
  collectDirectReportObservabilitySnapshot,
  evaluateDirectReportObservability,
  renderDirectReportObservabilityJson,
  renderDirectReportPrometheus
};
