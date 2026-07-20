#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "quality-safety-interface-standard.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "quality-safety-interface-standard.md");

const REQUIRED_SECTIONS = [
  "documentControl",
  "transport",
  "security",
  "messageEnvelope",
  "statusCodes",
  "interfaces",
  "acceptanceChecklist"
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function buildQualitySafetyInterfaceStandard(options = {}) {
  const data = options.data || readJson("data/db.json");
  const standard = {
    documentControl: {
      id: "quality-safety-institution-interface-standard",
      title: "\u533b\u7597\u8d28\u91cf\u4e0e\u5b89\u5168\u76d1\u7ba1\u5e73\u53f0\u533b\u7597\u673a\u6784\u63a5\u53e3\u6587\u6863\u6807\u51c6",
      version: "1.0.0",
      module: "quality-safety",
      owner: "Health commission quality supervision team",
      audience: ["hospital HIS/EMR/LIS/PACS teams", "institution quality office", "regional mutual-recognition QC team"],
      updateRule: "Any field, status, signature, retry, or evidence change must update version, changelog, sample payload, and acceptance checklist."
    },
    transport: {
      protocol: "HTTPS",
      contentType: "application/json; charset=utf-8",
      encoding: "UTF-8",
      timeZone: "Asia/Shanghai",
      dateTimeFormat: "ISO-8601 with timezone or UTC Z suffix",
      maxPayloadKb: 512,
      timeoutSeconds: 10,
      retryPolicy: "3 attempts with exponential backoff; unresolved failures enter the compensation queue",
      idempotencyHeader: "X-Idempotency-Key",
      signatureHeader: "X-Signature"
    },
    security: {
      authentication: "Bearer token for platform users; HMAC-SHA256 signature for institution system callbacks",
      signatureBase: "HTTP method + path + timestamp + idempotency key + SHA256(body)",
      requiredHeaders: ["Authorization or X-Client-Id", "X-Timestamp", "X-Idempotency-Key", "X-Signature"],
      clockSkewSeconds: 300,
      audit: "Every accepted callback must write securityEvents or business auditTrail with actor, action, target, timestamp, and result.",
      privacy: "Do not send raw ID card numbers in quality-safety callbacks; use residentId or platform personIndex mapping."
    },
    messageEnvelope: {
      requiredFields: ["messageId", "eventType", "sourceSystem", "sourceInstitutionCode", "occurredAt", "payload"],
      correlationFields: ["residentId", "reportId", "eventId", "rectificationOrderId", "pathwayCode"],
      responseShape: {
        success: { ok: true, requestId: "uuid", acceptedAt: "ISO-8601", status: "accepted" },
        failure: { ok: false, error: "VALIDATION_ERROR", message: "human-readable reason", fieldErrors: [] }
      }
    },
    statusCodes: [
      { code: "open", meaning: "new event or issue is visible to the regulator" },
      { code: "dispatched", meaning: "commission has issued a rectification order" },
      { code: "feedback_submitted", meaning: "institution submitted evidence or explanation" },
      { code: "review_passed", meaning: "commission accepted clinical pathway or QC evidence" },
      { code: "returned", meaning: "commission returned evidence for correction" },
      { code: "ready_for_joint_test", meaning: "site item has evidence ready for joint testing" },
      { code: "accepted", meaning: "site item has signed acceptance evidence" },
      { code: "closed", meaning: "business loop is closed and audit evidence is preserved" }
    ],
    interfaces: [
      {
        id: "qs-critical-value-alert-v1",
        direction: "institution-to-platform",
        sourceSystems: ["LIS", "PACS", "HIS"],
        endpoint: "/api/integrations/gateway",
        eventType: "quality_safety.critical_value_alert.v1",
        targetCollection: "criticalValueAlerts",
        requiredFields: ["messageId", "residentId", "reportId", "item", "value", "threshold", "reportedAt", "sourceInstitution", "targetInstitution"],
        idempotencyKey: "messageId or reportId:item:reportedAt",
        samplePayload: {
          messageId: "lis-critical-20260622-001",
          eventType: "quality_safety.critical_value_alert.v1",
          sourceSystem: "LIS",
          sourceInstitutionCode: "ORG-HOSPITAL-001",
          occurredAt: "2026-06-22T09:12:00+08:00",
          payload: {
            residentId: "r2",
            reportId: "dr-001",
            item: "glucose",
            value: "26.1 mmol/L",
            threshold: ">25 mmol/L",
            targetInstitution: "Dalian Central Hospital"
          }
        }
      },
      {
        id: "qs-critical-value-disposition-v1",
        direction: "institution-to-platform",
        sourceSystems: ["HIS", "EMR"],
        endpoint: "/api/quality-safety/critical-values/:id/dispose",
        eventType: "quality_safety.critical_value_disposition.v1",
        targetCollection: "criticalValueAlerts",
        requiredFields: ["alertId", "action", "outcome", "disposedAt", "responsiblePhysician"],
        idempotencyKey: "alertId:disposedAt",
        samplePayload: {
          action: "Responsible physician notified; disposition note completed in the source system.",
          outcome: "disposed",
          disposedAt: "2026-06-22T09:40:00+08:00",
          responsiblePhysician: "doctor-wang"
        }
      },
      {
        id: "qs-clinical-pathway-variance-v1",
        direction: "institution-to-platform",
        sourceSystems: ["EMR", "HIS"],
        endpoint: "/api/integrations/gateway",
        eventType: "quality_safety.clinical_pathway_variance.v1",
        targetCollection: "clinicalPathwayCases",
        requiredFields: ["messageId", "residentId", "pathwayCode", "pathwayName", "currentNode", "varianceType", "varianceReason", "dueAt"],
        idempotencyKey: "messageId or residentId:pathwayCode:currentNode",
        samplePayload: {
          messageId: "emr-pathway-20260621-001",
          eventType: "quality_safety.clinical_pathway_variance.v1",
          sourceSystem: "EMR",
          sourceInstitutionCode: "ORG-HOSPITAL-001",
          occurredAt: "2026-06-21T10:00:00+08:00",
          payload: {
            residentId: "r1",
            pathwayCode: "HTN-2026",
            pathwayName: "Hypertension standard pathway",
            currentNode: "follow-up-after-medication",
            varianceType: "missing_evidence",
            varianceReason: "Follow-up result not written back to EMR.",
            dueAt: "2026-06-28T10:00:00+08:00"
          }
        }
      },
      {
        id: "qs-medical-record-qc-v1",
        direction: "platform-to-institution",
        sourceSystems: ["quality-safety"],
        endpoint: "/api/quality-safety/issues/:id/dispatch",
        eventType: "quality_safety.medical_record_qc_dispatch.v1",
        targetCollection: "qualityRectificationOrders",
        requiredFields: ["issueId", "institutionName", "ownerRole", "requirement", "dueAt"],
        idempotencyKey: "issueId:requirement",
        samplePayload: {
          ownerRole: "institution",
          institutionName: "Qingniwaqiao Community Health Service Center",
          owner: "Community quality manager",
          requirement: "Complete missing assessment fields and physician sign-off.",
          dueAt: "2026-06-27T15:00:00+08:00"
        }
      },
      {
        id: "qs-rectification-feedback-v1",
        direction: "institution-to-platform",
        sourceSystems: ["EMR", "quality office"],
        endpoint: "/api/quality-safety/rectifications/:id/feedback",
        eventType: "quality_safety.rectification_feedback.v1",
        targetCollection: "qualityRectificationOrders",
        requiredFields: ["orderId", "content", "attachments"],
        idempotencyKey: "orderId:attachmentDigest",
        samplePayload: {
          content: "Corrected assessment fields have been uploaded for review.",
          attachments: ["emr-correction-screenshot", "department-signoff-form"]
        }
      },
      {
        id: "qs-mutual-recognition-qc-v1",
        direction: "county-or-institution-to-platform",
        sourceSystems: ["LIS", "PACS", "mutual recognition platform"],
        endpoint: "/api/integrations/gateway",
        eventType: "quality_safety.mutual_recognition_qc.v1",
        targetCollection: "mutualRecognitionQualityReviews",
        requiredFields: ["recognitionRecordId", "reportId", "institutionName", "item", "qcStatus", "issueType", "dueAt"],
        idempotencyKey: "recognitionRecordId:qcStatus",
        samplePayload: {
          messageId: "mr-qc-20260624-001",
          eventType: "quality_safety.mutual_recognition_qc.v1",
          sourceSystem: "mutual-recognition",
          sourceInstitutionCode: "REGIONAL-QC",
          occurredAt: "2026-06-24T09:00:00+08:00",
          payload: {
            recognitionRecordId: "cmr-001",
            reportId: "dr-001",
            institutionName: "Dalian Central Hospital",
            item: "glucose",
            qcStatus: "manual_review_required",
            issueType: "critical_value_followup",
            dueAt: "2026-06-24T18:00:00+08:00"
          }
        }
      }
    ],
    documentFormat: {
      requiredChapters: [
        "1. Document control and contacts",
        "2. Scope and source systems",
        "3. Security, signature, idempotency, and audit",
        "4. Message envelope",
        "5. Interface list and field dictionary",
        "6. Sample payloads and expected responses",
        "7. Error codes, retry, and compensation",
        "8. Joint-test checklist and sign-off evidence"
      ],
      fileNaming: "QS-{institutionCode}-{interfaceId}-v{major.minor}-{yyyyMMdd}.md",
      changeLogRequired: true,
      samplePayloadRequired: true,
      fieldDictionaryRequired: true
    },
    acceptanceChecklist: [
      { id: "doc-control", required: true, evidence: "version, owner, hospital contact, changelog" },
      { id: "field-dictionary", required: true, evidence: "required fields, type, length, enum, source, target mapping" },
      { id: "sample-payload", required: true, evidence: "one success and one validation-failure sample per interface" },
      { id: "signature-test", required: true, evidence: "HMAC base string, signature result, clock skew test" },
      { id: "idempotency-test", required: true, evidence: "duplicate message replay returns stable result" },
      { id: "audit-trace", required: true, evidence: "securityEvents or auditTrail row linked to the business id" },
      { id: "cutover-signoff", required: true, evidence: "qualitySafetySiteSignoffs review trail and signed acceptance attachment" }
    ]
  };
  const checks = [
    { id: "interface-standard:sections", passed: REQUIRED_SECTIONS.every((key) => standard[key]), detail: `${REQUIRED_SECTIONS.length} required sections` },
    { id: "interface-standard:interfaces", passed: standard.interfaces.length >= 6 && standard.interfaces.every((item) => item.id && item.endpoint && item.eventType && item.requiredFields.length && item.samplePayload), detail: `${standard.interfaces.length} quality-safety interfaces` },
    { id: "interface-standard:security", passed: standard.security.requiredHeaders.length >= 4 && /HMAC-SHA256/.test(standard.security.authentication), detail: standard.security.requiredHeaders.join(",") },
    { id: "interface-standard:acceptance", passed: standard.acceptanceChecklist.length >= 6 && standard.acceptanceChecklist.every((item) => item.required && item.evidence), detail: `${standard.acceptanceChecklist.length} acceptance rows` },
    { id: "interface-standard:site-signoff-link", passed: Array.isArray(data.qualitySafetySiteSignoffs) && data.qualitySafetySiteSignoffs.length >= 6, detail: `${data.qualitySafetySiteSignoffs?.length || 0} site signoff rows` }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    standard,
    summary: {
      sections: REQUIRED_SECTIONS.length,
      interfaces: standard.interfaces.length,
      requiredHeaders: standard.security.requiredHeaders.length,
      acceptanceRows: standard.acceptanceChecklist.length,
      siteSignoffs: data.qualitySafetySiteSignoffs?.length || 0
    },
    checks
  };
}

function renderMarkdown(report) {
  const standard = report.standard;
  return [
    `# ${standard.documentControl.title}`,
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Version: ${standard.documentControl.version}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Interfaces: ${report.summary.interfaces}`,
    `- Site sign-off rows: ${report.summary.siteSignoffs}`,
    "",
    "## Document Format",
    "",
    `- File naming: ${standard.documentFormat.fileNaming}`,
    `- Change log required: ${standard.documentFormat.changeLogRequired ? "yes" : "no"}`,
    `- Sample payload required: ${standard.documentFormat.samplePayloadRequired ? "yes" : "no"}`,
    "",
    "| Chapter | Required |",
    "|---|---|",
    ...standard.documentFormat.requiredChapters.map((item) => `| ${item} | yes |`),
    "",
    "## Transport And Security",
    "",
    `- Protocol: ${standard.transport.protocol}`,
    `- Content-Type: ${standard.transport.contentType}`,
    `- Idempotency header: ${standard.transport.idempotencyHeader}`,
    `- Signature header: ${standard.transport.signatureHeader}`,
    `- Authentication: ${standard.security.authentication}`,
    `- Signature base: ${standard.security.signatureBase}`,
    "",
    "## Message Envelope",
    "",
    "| Field | Required |",
    "|---|---|",
    ...standard.messageEnvelope.requiredFields.map((item) => `| ${item} | yes |`),
    "",
    "## Interface List",
    "",
    "| Interface | Direction | Event type | Endpoint | Target collection | Required fields |",
    "|---|---|---|---|---|---|",
    ...standard.interfaces.map((item) => `| ${item.id} | ${item.direction} | ${item.eventType} | ${item.endpoint} | ${item.targetCollection} | ${item.requiredFields.join(", ")} |`),
    "",
    "## Status Codes",
    "",
    "| Code | Meaning |",
    "|---|---|",
    ...standard.statusCodes.map((item) => `| ${item.code} | ${item.meaning} |`),
    "",
    "## Acceptance Checklist",
    "",
    "| Item | Required evidence |",
    "|---|---|",
    ...standard.acceptanceChecklist.map((item) => `| ${item.id} | ${item.evidence} |`),
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`),
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
  const report = buildQualitySafetyInterfaceStandard();
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

module.exports = { REQUIRED_SECTIONS, buildQualitySafetyInterfaceStandard, parseArgs, renderMarkdown, writeOutput };
