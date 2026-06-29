#!/usr/bin/env node
const { createHash, createHmac, timingSafeEqual } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { buildQualitySafetyInterfaceStandard } = require("./quality-safety-interface-standard");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "quality-safety-interface-joint-test-pack.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "quality-safety-interface-joint-test-pack.md");
const DEFAULT_SECRET = "health-platform-demo-integration-secret";
const DEFAULT_TIMESTAMP = "2026-06-29T09:00:00+08:00";

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function hmacSignature(secret, baseString) {
  return createHmac("sha256", secret || DEFAULT_SECRET).update(baseString).digest("hex");
}

function signatureBase({ method = "POST", path: endpoint = "", timestamp = DEFAULT_TIMESTAMP, idempotencyKey = "", body = {} }) {
  return [String(method).toUpperCase(), endpoint, timestamp, idempotencyKey, sha256(body)].join("\n");
}

function signInterfaceRequest(options) {
  return hmacSignature(options.secret, signatureBase(options));
}

function sampleValue(field, interfaceDef, index) {
  const values = {
    alertId: "cva-001",
    attachmentDigest: `sha256-demo-attachment-${index}`,
    attachments: ["site-evidence-placeholder"],
    content: "Corrected evidence has been uploaded for regulatory review.",
    currentNode: "follow-up-after-medication",
    disposedAt: "2026-06-29T09:40:00+08:00",
    dueAt: "2026-06-30T17:00:00+08:00",
    institutionName: "Dalian Central Hospital",
    issueId: "qse-record-001",
    issueType: "critical_value_followup",
    item: "glucose",
    messageId: `${interfaceDef.id}-sample-${String(index).padStart(3, "0")}`,
    outcome: "disposed",
    ownerRole: "institution",
    pathwayCode: "HTN-2026",
    pathwayName: "Hypertension standard pathway",
    qcStatus: "manual_review_required",
    recognitionRecordId: "cmr-001",
    reportId: "dr-001",
    reportedAt: "2026-06-29T09:12:00+08:00",
    requirement: "Complete root-cause analysis and department sign-off.",
    residentId: "r1",
    responsiblePhysician: "doctor-wang",
    sourceInstitution: "Dalian Central Hospital",
    targetInstitution: "Qingniwaqiao Community Health Service Center",
    threshold: ">25 mmol/L",
    value: "26.1 mmol/L",
    varianceReason: "Follow-up result not written back to EMR.",
    varianceType: "missing_evidence"
  };
  if (field === "action") return interfaceDef.id.includes("disposition") ? "Responsible physician notified and disposition note completed." : "Complete regulatory rectification.";
  return values[field] ?? `${field}-${index}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function enrichPayloadFields(interfaceDef, message, index) {
  const payload = message.payload && typeof message.payload === "object" ? { ...message.payload } : {};
  (interfaceDef.requiredFields || []).forEach((field) => {
    if (message[field] !== undefined || payload[field] !== undefined) return;
    payload[field] = sampleValue(field, interfaceDef, index);
  });
  return { ...message, payload };
}

function buildSampleMessage(interfaceDef, index = 1) {
  const sample = clone(interfaceDef.samplePayload || {});
  const envelope = sample.messageId && sample.eventType && sample.payload ? sample : {
    messageId: sample.messageId || `${interfaceDef.id}-sample-${String(index).padStart(3, "0")}`,
    eventType: interfaceDef.eventType,
    sourceSystem: interfaceDef.sourceSystems?.[0] || "quality-office",
    sourceInstitutionCode: "ORG-HOSPITAL-001",
    occurredAt: sample.occurredAt || DEFAULT_TIMESTAMP,
    payload: sample.payload && typeof sample.payload === "object" ? sample.payload : sample
  };
  return enrichPayloadFields(interfaceDef, envelope, index);
}

function deriveIdempotencyKey(interfaceDef, message) {
  const payload = message.payload || {};
  if (message.messageId) return message.messageId;
  if (payload.alertId && payload.disposedAt) return `${payload.alertId}:${payload.disposedAt}`;
  if (payload.orderId && payload.attachmentDigest) return `${payload.orderId}:${payload.attachmentDigest}`;
  if (payload.recognitionRecordId && payload.qcStatus) return `${payload.recognitionRecordId}:${payload.qcStatus}`;
  if (payload.reportId && payload.item && payload.reportedAt) return `${payload.reportId}:${payload.item}:${payload.reportedAt}`;
  return `${interfaceDef.id}:sample`;
}

function buildSampleRequest(interfaceDef, index = 1, options = {}) {
  const message = buildSampleMessage(interfaceDef, index);
  const method = "POST";
  const endpoint = interfaceDef.endpoint;
  const timestamp = message.occurredAt || DEFAULT_TIMESTAMP;
  const idempotencyKey = deriveIdempotencyKey(interfaceDef, message);
  const signature = signInterfaceRequest({
    method,
    path: endpoint,
    timestamp,
    idempotencyKey,
    body: message,
    secret: options.secret || DEFAULT_SECRET
  });
  return {
    interfaceId: interfaceDef.id,
    method,
    path: endpoint,
    headers: {
      "X-Client-Id": "ORG-HOSPITAL-001",
      "X-Timestamp": timestamp,
      "X-Idempotency-Key": idempotencyKey,
      "X-Signature": signature
    },
    message,
    signatureBase: signatureBase({ method, path: endpoint, timestamp, idempotencyKey, body: message }),
    bodySha256: sha256(message)
  };
}

function findInterface(standard, interfaceId) {
  return (standard.interfaces || []).find((item) => item.id === interfaceId || item.eventType === interfaceId);
}

function headerValue(headers, name) {
  const target = String(name).toLowerCase();
  const match = Object.entries(headers || {}).find(([key]) => String(key).toLowerCase() === target);
  return match ? String(match[1] || "").trim() : "";
}

function hasAuthHeader(headers) {
  return Boolean(headerValue(headers, "Authorization") || headerValue(headers, "X-Client-Id"));
}

function endpointMatches(template, actual) {
  if (!actual) return true;
  const pattern = String(template)
    .split("/")
    .map((part) => part.startsWith(":") ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("/");
  return new RegExp(`^${pattern}$`).test(String(actual));
}

function fieldValue(message, field) {
  if (message && Object.prototype.hasOwnProperty.call(message, field)) return message[field];
  if (message?.payload && Object.prototype.hasOwnProperty.call(message.payload, field)) return message.payload[field];
  return undefined;
}

function valueMissing(value) {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function validateQualitySafetyInterfaceMessage(options = {}) {
  const standard = options.standard || buildQualitySafetyInterfaceStandard(options).standard;
  const interfaceDef = findInterface(standard, options.interfaceId);
  const errors = [];
  const warnings = [];
  const headers = options.headers || {};
  const message = options.message && typeof options.message === "object" ? options.message : {};
  const method = String(options.method || "POST").toUpperCase();
  const endpoint = String(options.path || interfaceDef?.endpoint || "");
  const timestamp = headerValue(headers, "X-Timestamp");
  const idempotencyKey = headerValue(headers, "X-Idempotency-Key");
  const signature = headerValue(headers, "X-Signature");

  if (!interfaceDef) {
    errors.push({ code: "UNKNOWN_INTERFACE", field: "interfaceId", message: "Interface id is not defined in the quality-safety standard." });
    return { ok: false, status: "rejected", interfaceId: options.interfaceId || "", errors, warnings };
  }
  if (!message || Object.keys(message).length === 0) {
    errors.push({ code: "EMPTY_MESSAGE", field: "message", message: "Message body is required." });
  }
  if (!hasAuthHeader(headers)) {
    errors.push({ code: "MISSING_HEADER", field: "Authorization or X-Client-Id", message: "Authorization or X-Client-Id is required." });
  }
  ["X-Timestamp", "X-Idempotency-Key", "X-Signature"].forEach((field) => {
    if (!headerValue(headers, field)) errors.push({ code: "MISSING_HEADER", field, message: `${field} is required.` });
  });
  (standard.messageEnvelope.requiredFields || []).forEach((field) => {
    if (valueMissing(message[field])) errors.push({ code: "MISSING_ENVELOPE_FIELD", field, message: `${field} is required in the message envelope.` });
  });
  if (message.eventType && message.eventType !== interfaceDef.eventType) {
    errors.push({ code: "EVENT_TYPE_MISMATCH", field: "eventType", message: `Expected ${interfaceDef.eventType}.` });
  }
  (interfaceDef.requiredFields || []).forEach((field) => {
    if (valueMissing(fieldValue(message, field))) errors.push({ code: "MISSING_PAYLOAD_FIELD", field, message: `${field} is required for ${interfaceDef.id}.` });
  });
  if (!endpointMatches(interfaceDef.endpoint, endpoint)) {
    errors.push({ code: "ENDPOINT_MISMATCH", field: "path", message: `Expected ${interfaceDef.endpoint}.` });
  }
  if (timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      errors.push({ code: "INVALID_TIMESTAMP", field: "X-Timestamp", message: "Timestamp must be ISO-8601." });
    } else if (options.now) {
      const skew = Math.abs(new Date(options.now).getTime() - date.getTime()) / 1000;
      if (skew > standard.security.clockSkewSeconds) errors.push({ code: "TIMESTAMP_SKEW", field: "X-Timestamp", message: `Clock skew ${Math.round(skew)}s exceeds ${standard.security.clockSkewSeconds}s.` });
    }
  }
  if (signature && timestamp && idempotencyKey) {
    const expected = signInterfaceRequest({
      method,
      path: endpoint,
      timestamp,
      idempotencyKey,
      body: message,
      secret: options.secret || DEFAULT_SECRET
    });
    if (!safeEqual(expected, signature)) {
      errors.push({ code: "SIGNATURE_MISMATCH", field: "X-Signature", message: "HMAC-SHA256 signature does not match the request body." });
    }
  }
  if ((options.previousIdempotencyKeys || []).includes(idempotencyKey)) {
    errors.push({ code: "DUPLICATE_IDEMPOTENCY_KEY", field: "X-Idempotency-Key", message: "Duplicate replay detected for this idempotency key." });
  }

  const ok = errors.length === 0;
  return {
    ok,
    status: ok ? "accepted" : "rejected",
    interfaceId: interfaceDef.id,
    eventType: interfaceDef.eventType,
    endpoint: interfaceDef.endpoint,
    idempotencyKey,
    bodySha256: sha256(message),
    acceptedAt: ok ? new Date().toISOString() : "",
    errors,
    warnings
  };
}

function buildFieldDictionaries(standard) {
  return (standard.interfaces || []).map((interfaceDef) => ({
    interfaceId: interfaceDef.id,
    eventType: interfaceDef.eventType,
    targetCollection: interfaceDef.targetCollection,
    fields: [
      ...(standard.messageEnvelope.requiredFields || []).map((field) => ({ field, location: "envelope", required: true, source: "message envelope" })),
      ...(interfaceDef.requiredFields || []).map((field) => ({ field, location: field === "messageId" ? "envelope" : "payload", required: true, source: interfaceDef.sourceSystems.join("/") }))
    ]
  }));
}

function buildNegativeCases(sampleRequests, secret) {
  const first = clone(sampleRequests[0]);
  const missingField = clone(first);
  const missingTarget = sampleRequests[0]?.message?.payload ? Object.keys(sampleRequests[0].message.payload)[0] : "";
  if (missingTarget) delete missingField.message.payload[missingTarget];
  missingField.headers["X-Signature"] = signInterfaceRequest({
    method: missingField.method,
    path: missingField.path,
    timestamp: missingField.headers["X-Timestamp"],
    idempotencyKey: missingField.headers["X-Idempotency-Key"],
    body: missingField.message,
    secret
  });
  const invalidSignature = clone(first);
  invalidSignature.headers["X-Signature"] = "invalid-signature";
  const duplicateReplay = clone(first);
  return [
    { id: "missing-required-field", request: missingField, previousIdempotencyKeys: [], expectedCode: "MISSING_PAYLOAD_FIELD" },
    { id: "invalid-signature", request: invalidSignature, previousIdempotencyKeys: [], expectedCode: "SIGNATURE_MISMATCH" },
    { id: "duplicate-idempotency", request: duplicateReplay, previousIdempotencyKeys: [duplicateReplay.headers["X-Idempotency-Key"]], expectedCode: "DUPLICATE_IDEMPOTENCY_KEY" }
  ];
}

function buildQualitySafetyInterfaceJointTestPack(options = {}) {
  const standardReport = options.standardReport || buildQualitySafetyInterfaceStandard(options);
  const standard = standardReport.standard;
  const secret = options.secret || DEFAULT_SECRET;
  const sampleRequests = standard.interfaces.map((interfaceDef, index) => buildSampleRequest(interfaceDef, index + 1, { secret }));
  const sampleValidations = sampleRequests.map((request) => ({
    id: `${request.interfaceId}:sample-valid`,
    result: validateQualitySafetyInterfaceMessage({
      standard,
      interfaceId: request.interfaceId,
      method: request.method,
      path: request.path,
      headers: request.headers,
      message: request.message,
      secret
    })
  }));
  const negativeCases = buildNegativeCases(sampleRequests, secret).map((item) => ({
    id: item.id,
    expectedCode: item.expectedCode,
    result: validateQualitySafetyInterfaceMessage({
      standard,
      interfaceId: item.request.interfaceId,
      method: item.request.method,
      path: item.request.path,
      headers: item.request.headers,
      message: item.request.message,
      previousIdempotencyKeys: item.previousIdempotencyKeys,
      secret
    })
  }));
  const checks = [
    { id: "joint-test:samples", passed: sampleValidations.every((item) => item.result.ok), detail: `${sampleValidations.filter((item) => item.result.ok).length}/${sampleValidations.length} sample messages accepted` },
    { id: "joint-test:negative-cases", passed: negativeCases.every((item) => !item.result.ok && item.result.errors.some((error) => error.code === item.expectedCode)), detail: `${negativeCases.length} rejection cases verified` },
    { id: "joint-test:signature-fixture", passed: sampleRequests.every((item) => item.headers["X-Signature"] && item.signatureBase.includes(item.headers["X-Idempotency-Key"])), detail: "HMAC-SHA256 base strings generated" },
    { id: "joint-test:field-dictionaries", passed: buildFieldDictionaries(standard).every((item) => item.fields.length >= standard.messageEnvelope.requiredFields.length), detail: `${standard.interfaces.length} field dictionaries` }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    standardVersion: standard.documentControl.version,
    summary: {
      interfaces: standard.interfaces.length,
      sampleRequests: sampleRequests.length,
      sampleAccepted: sampleValidations.filter((item) => item.result.ok).length,
      negativeCases: negativeCases.length,
      fieldDictionaries: standard.interfaces.length
    },
    securityFixture: {
      algorithm: "HMAC-SHA256",
      signatureBase: "method + path + timestamp + idempotencyKey + sha256(stable JSON body)",
      demoSecretName: "INTEGRATION_GATEWAY_SECRET",
      clockSkewSeconds: standard.security.clockSkewSeconds
    },
    fieldDictionaries: buildFieldDictionaries(standard),
    sampleRequests,
    sampleValidations,
    negativeCases,
    checks
  };
}

function renderMarkdown(report) {
  return [
    "# Quality-safety institution joint-test pack",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Interfaces: ${report.summary.interfaces}`,
    `- Sample requests: ${report.summary.sampleRequests}`,
    `- Accepted samples: ${report.summary.sampleAccepted}`,
    "",
    "## Security Fixture",
    "",
    `- Algorithm: ${report.securityFixture.algorithm}`,
    `- Signature base: ${report.securityFixture.signatureBase}`,
    `- Secret env: ${report.securityFixture.demoSecretName}`,
    "",
    "## Sample Requests",
    "",
    "| Interface | Method | Path | Idempotency key | Body SHA-256 |",
    "|---|---|---|---|---|",
    ...report.sampleRequests.map((item) => `| ${item.interfaceId} | ${item.method} | ${item.path} | ${item.headers["X-Idempotency-Key"]} | ${item.bodySha256} |`),
    "",
    "## Validation Cases",
    "",
    "| Case | Result | Detail |",
    "|---|---|---|",
    ...report.sampleValidations.map((item) => `| ${item.id} | ${item.result.ok ? "PASS" : "FAIL"} | ${item.result.errors.map((error) => error.code).join(", ") || "accepted"} |`),
    ...report.negativeCases.map((item) => `| ${item.id} | ${!item.result.ok ? "PASS" : "FAIL"} | expected ${item.expectedCode}; got ${item.result.errors.map((error) => error.code).join(", ")} |`),
    "",
    "## Field Dictionaries",
    "",
    "| Interface | Target collection | Required fields |",
    "|---|---|---|",
    ...report.fieldDictionaries.map((item) => `| ${item.interfaceId} | ${item.targetCollection} | ${item.fields.map((field) => `${field.location}.${field.field}`).join(", ")} |`),
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${item.detail} |`),
    ""
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  argv.forEach((flag) => {
    if (!flag.startsWith("--")) return;
    const [key, ...rest] = flag.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  });
  return flags;
}

function writeOutput(report, flags = {}) {
  const output = path.resolve(ROOT, String(flags.output || DEFAULT_OUTPUT));
  const markdown = path.resolve(ROOT, String(flags.markdown || DEFAULT_MARKDOWN));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

function runCli() {
  const flags = parseArgs();
  const report = buildQualitySafetyInterfaceJointTestPack();
  if (flags.write !== false) writeOutput(report, flags);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_SECRET,
  buildQualitySafetyInterfaceJointTestPack,
  buildSampleRequest,
  parseArgs,
  renderMarkdown,
  signInterfaceRequest,
  signatureBase,
  stableStringify,
  validateQualitySafetyInterfaceMessage,
  writeOutput
};
