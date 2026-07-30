"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

function loadUiContext() {
  const nodes = new Map();
  const node = (selector) => {
    if (!nodes.has(selector)) {
      nodes.set(selector, {
        className: "",
        innerHTML: "",
        textContent: "",
        disabled: false,
        closest() { return null; }
      });
    }
    return nodes.get(selector);
  };
  const context = vm.createContext({
    console,
    location: { protocol: "http:" },
    window: {},
    fetch: async () => { throw new Error("network-disabled"); },
    document: {
      addEventListener() {},
      querySelector: node,
      querySelectorAll() { return []; }
    }
  });
  vm.runInContext(read("public-health.js"), context, { filename: "public-health.js" });
  return { context, node };
}

test("modernization page exposes eight accessible commission workbenches and controlled routes", () => {
  const html = read("public-health.html");
  const source = read("public-health.js");
  const css = read("portal.css");
  assert.match(html, /aria-label="公共卫生现代化工作台"/);
  assert.match(html, /数据底座/);
  assert.match(html, /数据源运行状态/);
  assert.match(html, /规则治理/);
  assert.match(html, /监测预警/);
  assert.match(html, /医防协同/);
  assert.match(html, /id="public-health-signal-intake-form"/);
  assert.match(html, /id="public-health-rule-change-form"/);
  assert.match(html, /id="public-health-surveillance-model-governance-title"/);
  assert.match(html, /id="public-health-model-validation-form"/);
  assert.match(html, /id="public-health-respiratory-pathogen-title"/);
  assert.match(html, /id="public-health-respiratory-pathogen-form"/);
  assert.match(html, /id="public-health-respiratory-network-title"/);
  assert.match(html, /id="public-health-respiratory-network-institutions"/);
  assert.match(html, /id="public-health-respiratory-network-lifecycle-evidence"/);
  assert.match(html, /id="public-health-respiratory-network-lifecycle-requests"/);
  assert.match(html, /另一名有权用户独立批准或驳回/);
  assert.match(html, /距到期不足 30 天/);
  assert.match(html, /technicalLaunchReady/);
  assert.match(html, /中央现场证据、P0\/P1 关闭、生产交接和正式上线审批/);
  assert.match(html, /18种病原目录/);
  assert.match(html, /仅接收聚合计数与证据/);
  assert.match(html, /modelAdviceOnly=true/);
  assert.match(html, /humanDecisionRequired=true/);
  assert.match(html, /alertCreated=false/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /人工责任/);
  assert.match(html, /productionReady 始终为 false/);
  assert.match(html, /id="public-health-official-exchange-chain-title"/);
  assert.match(html, /浏览器只能引用 trustedReceiptId/);
  assert.match(html, /连续回执、现场证据、P0\/P1 关闭、生产交接与正式审批/);
  assert.match(source, /\/api\/public-health\/data-foundation/);
  assert.match(source, /\/api\/public-health\/data-source-operations/);
  assert.match(source, /\/api\/public-health\/surveillance-rule-governance/);
  assert.match(source, /\/api\/public-health\/surveillance-rule-changes/);
  assert.match(source, /\/api\/public-health\/surveillance-model-governance/);
  assert.match(source, /\/api\/public-health\/surveillance-models\/\$\{encodeURIComponent\(id\)\}\/shadow-runs/);
  assert.match(source, /\/api\/public-health\/surveillance-model-validations\/\$\{encodeURIComponent\(id\)\}\/actions/);
  assert.match(source, /\/api\/public-health\/respiratory-pathogen-surveillance/);
  assert.match(source, /\/api\/public-health\/respiratory-pathogen-batches/);
  assert.match(source, /\/api\/public-health\/respiratory-network-readiness/);
  assert.match(source, /renderPublicHealthRespiratoryNetworkReadiness/);
  assert.match(source, /request-supersede/);
  assert.match(source, /approve-lifecycle/);
  assert.match(source, /reject-lifecycle/);
  assert.match(source, /respiratory-evidence-lifecycle/);
  assert.match(source, /PUBLIC_HEALTH_RESPIRATORY_PATHOGEN_CODES/);
  assert.match(source, /testedSpecimens:\s*specimenCount/);
  assert.match(source, /\/api\/public-health\/surveillance-center/);
  assert.match(source, /\/api\/public-health\/medical-prevention-tasks/);
  assert.match(source, /\/api\/public-health\/surveillance-signals\/\$\{encodeURIComponent\(id\)\}\/actions/);
  assert.match(source, /\/api\/public-health\/surveillance-alerts\/\$\{encodeURIComponent\(id\)\}\/actions/);
  assert.match(source, /\/api\/public-health\/medical-prevention-tasks\/\$\{encodeURIComponent\(id\)\}\/actions/);
  assert.match(source, /"Idempotency-Key"/);
  assert.match(source, /expectedVersion/);
  assert.match(source, /renderPublicHealthOfficialExchangeReceipts/);
  assert.match(source, /服务器已验真的正式上报 trustedReceiptId/);
  assert.doesNotMatch(source, /body\.reportId\s*=\s*promptRequired/);
  assert.doesNotMatch(source, /body\.feedbackCode\s*=\s*promptRequired/);
  assert.doesNotMatch(source, /productionReady\s*=\s*true/);
  assert.match(css, /\.public-health-modernization-grid/);
  assert.match(css, /\.modernization-form/);
  assert.match(css, /\.respiratory-network-tracks/);
  assert.match(css, /\.respiratory-network-lifecycle-request/);
  assert.match(css, /@media \(max-width: 1100px\)/);
});

test("modernization rendering uses only safe summary fields and fails closed when unavailable", () => {
  const { context, node } = loadUiContext();
  context.fixture = {
    foundation: {
      ok: true,
      summary: {
        catalogEntries: 7,
        sources: 8,
        registeredSources: 8,
        signals: 1,
        qualityFindings: 0
      },
      sources: [{ id: "safe-source", name: "临床症候群", owner: "疾控监测", status: "registered" }],
      signals: [{
        id: "safe-signal",
        version: 1,
        signalType: "clinical-syndrome",
        regionCode: "210202",
        institutionId: "medical-institution-001",
        workflowState: "received"
      }],
      productionReady: false
    },
    sourceOperations: {
      ok: true,
      summary: { fresh: 1, delayed: 1, stale: 0, noData: 6, clockSkew: 0, qualityReview: 0 },
      sources: [{
        id: "safe-source",
        name: "临床症候群",
        expectedRefreshMinutes: 15,
        signalCount: 1,
        qualityFindings: 0,
        operationalState: "fresh"
      }],
      productionReady: false
    },
    ruleGovernance: {
      ok: true,
      summary: {
        rules: 8,
        activeRules: 8,
        ruleVersions: 9,
        submitted: 1,
        approved: 0,
        activationConfigured: true,
        managedKeyringReady: true,
        activationKeys: {
          configured: true,
          managed: true,
          purposeValid: true,
          legacyCompatibility: false,
          active: 1,
          grace: 1,
          revoked: 0,
          blockerCode: ""
        }
      },
      changes: [{
        id: "safe-rule-change",
        version: 1,
        ruleId: "ph-rule-clinical-syndrome",
        fromVersion: 1,
        toVersion: 2,
        status: "submitted",
        threshold: 10,
        severity: "high"
      }],
      productionReady: false
    },
    modelGovernance: {
      ok: true,
      summary: {
        models: 3,
        shadowModels: 3,
        validatedShadowModels: 1,
        modelRuns: 1,
        remediationRequired: 1,
        driftReviewsDue: 1
      },
      models: [{
        id: "ph-model-baseline-deviation",
        version: 1,
        name: "baseline-shadow",
        algorithm: "relative-baseline-uplift-v1",
        validationState: "validated-shadow",
        driftState: "within-window",
        validatedForShadowUse: true
      }],
      runs: [{
        id: "safe-model-run",
        modelId: "ph-model-baseline-deviation",
        modelVersion: 1,
        status: "shadow-observation",
        signalCount: 1,
        score: 0.7,
        riskBand: "manual-review-recommended",
        modelAdviceOnly: true,
        humanDecisionRequired: true,
        alertCreated: false
      }],
      validations: [{
        id: "safe-validation",
        modelId: "ph-model-baseline-deviation",
        modelVersion: 1,
        version: 1,
        status: "submitted",
        performanceGatePassed: true,
        allowedActions: ["review-model-validation"]
      }],
      productionReady: false
    },
    respiratoryPathogen: {
      ok: true,
      summary: {
        catalogPathogens: 18,
        planningMinimumPathogens: 15,
        observedPathogens: 18,
        batches: 2,
        oneSampleMultiTestBatches: 2,
        childBatches: 1,
        olderAdultBatches: 1,
        priorityPlaceBatches: 2,
        publishedSignals: 3,
        findings: 0,
        planningCoverageReady: true
      },
      panel: {
        id: "ph-respiratory-panel-18-v1",
        version: 1,
        name: "respiratory-18-panel",
        pathogenCount: 18,
        planningMinimumPathogens: 15
      },
      batches: [{
        id: "safe-respiratory-batch",
        version: 1,
        regionCode: "210202",
        ageGroup: "child",
        placeType: "school",
        specimenCount: 20,
        pathogenCoverage: 18,
        positivePathogens: 3,
        publishedSignals: 0,
        status: "received",
        oneSampleMultiTest: true,
        allowedActions: ["verify-respiratory-pathogen-batch"]
      }],
      findings: [],
      productionReady: false
    },
    respiratoryNetwork: {
      ok: true,
      technicalLaunchReady: true,
      summary: {
        requiredEvidenceTypes: 6,
        institutions: 1,
        technicalLaunchReadyInstitutions: 1,
        trustedEvidence: 6,
        minimumConsecutiveQualityDays: 3,
        minimumEvidenceValidityDaysAtLaunch: 30,
        lifecycleEvents: 1,
        suspendedEvidence: 0,
        revokedEvidence: 0,
        supersededEvidence: 1,
        renewalDueEvidence: 0,
        keyring: {
          managed: true,
          active: 1,
          grace: 1,
          revoked: 0
        }
      },
      evidenceRequirements: [
        "panel-standard-mapping",
        "sentinel-network-authorization",
        "laboratory-quality-qualification",
        "data-sharing-authorization",
        "privacy-security-review",
        "continuity-observation-acceptance"
      ].map((type) => ({ type, label: `safe-${type}` })),
      institutions: [{
        institutionId: "sentinel-respiratory-laboratory-001",
        technicalLaunchReady: true,
        trustedEvidence: 6,
        activeEvidence: 6,
        suspendedEvidence: 0,
        revokedEvidence: 0,
        supersededEvidence: 1,
        renewalDueEvidence: 0,
        consecutiveQualityDays: 3,
        completedEvidenceTypes: [
          "panel-standard-mapping",
          "sentinel-network-authorization",
          "laboratory-quality-qualification",
          "data-sharing-authorization",
          "privacy-security-review",
          "continuity-observation-acceptance"
        ],
        missingEvidenceTypes: [],
        blockerCodes: [],
        productionReady: false
      }],
      lifecycle: {
        ok: true,
        summary: {
          active: 6,
          suspended: 0,
          revoked: 0,
          superseded: 1,
          renewalDue: 0,
          events: 1,
          findings: 0
        },
        requestSummary: { total: 2, pending: 1, approved: 1, rejected: 0 },
        blockerCodes: []
      },
      evidence: [{
        id: "safe-network-evidence-active",
        institutionId: "sentinel-respiratory-laboratory-001",
        evidenceType: "panel-standard-mapping",
        state: "active",
        lifecycleVersion: 2,
        expiresAt: "2027-07-01T00:00:00.000Z",
        daysUntilExpiration: 336,
        renewalDue: false,
        allowedRequestActions: ["request-suspend", "request-revoke", "request-supersede"],
        productionReady: false
      }],
      lifecycleRequests: [{
        id: "safe-lifecycle-request",
        targetEvidenceId: "safe-network-evidence-active",
        successorEvidenceId: "",
        eventType: "suspend",
        reasonCode: "scheduled-evidence-governance",
        status: "pending",
        version: 1,
        requestedBySelf: false,
        canReview: true,
        productionReady: false
      }],
      blockers: [],
      externalProductionBlockers: [
        "central-site-evidence-required",
        "p0-p1-handoff-and-launch-approval-required"
      ],
      productionReady: false
    },
    surveillance: {
      ok: true,
      summary: {
        rules: 8,
        activeRules: 8,
        humanVerifiedSignals: 0,
        openAlerts: 0,
        humanRiskAssessments: 0,
        trustedOfficialReports: 1,
        trustedOfficialFeedbacks: 1
      },
      dataFoundation: { signals: [] },
      alerts: [],
      officialExchangeReceipts: {
        ok: true,
        summary: {
          receipts: 2,
          trustedReceipts: 2,
          officialReports: 1,
          feedbacks: 1,
          findings: 0
        },
        receipts: [{
          trustedReceiptId: "safe-official-report-record",
          alertId: "safe-alert",
          stage: "official-report",
          businessStatus: "accepted",
          externalBusinessCode: "SAFE-REPORT-ACCEPTED",
          issuedAt: "2026-07-30T10:00:00.000Z",
          productionReady: false
        }],
        findings: [],
        blockers: ["continuous-official-receipt-evidence-required"],
        configurationCode: "",
        productionReady: false
      },
      productionReady: false
    },
    collaboration: {
      ok: true,
      summary: { tasks: 0, openTasks: 0, exceptions: 0, closedTasks: 0 },
      tasks: [],
      productionReady: false
    }
  };
  vm.runInContext("renderPublicHealthModernizationWorkbenches(fixture)", context);
  const rendered = [
    node("#public-health-data-foundation-metrics").innerHTML,
    node("#public-health-data-foundation-sources").innerHTML,
    node("#public-health-data-source-operations-metrics").innerHTML,
    node("#public-health-data-source-operations-list").innerHTML,
    node("#public-health-rule-governance-metrics").innerHTML,
    node("#public-health-rule-governance-list").innerHTML,
    node("#public-health-surveillance-model-governance-metrics").innerHTML,
    node("#public-health-surveillance-model-governance-list").innerHTML,
    node("#public-health-surveillance-model-runs").innerHTML,
    node("#public-health-surveillance-model-validations").innerHTML,
    node("#public-health-respiratory-pathogen-metrics").innerHTML,
    node("#public-health-respiratory-pathogen-catalog").innerHTML,
    node("#public-health-respiratory-pathogen-batches").innerHTML,
    node("#public-health-respiratory-pathogen-findings").innerHTML,
    node("#public-health-respiratory-network-metrics").innerHTML,
    node("#public-health-respiratory-network-institutions").innerHTML,
    node("#public-health-respiratory-network-lifecycle-evidence").innerHTML,
    node("#public-health-respiratory-network-lifecycle-requests").innerHTML,
    node("#public-health-respiratory-network-blockers").innerHTML,
    node("#public-health-surveillance-metrics").innerHTML,
    node("#public-health-surveillance-signals").innerHTML,
    node("#public-health-surveillance-alerts").innerHTML,
    node("#public-health-official-exchange-chain-metrics").innerHTML,
    node("#public-health-official-exchange-chain-list").innerHTML,
    node("#public-health-official-exchange-chain-blockers").innerHTML,
    node("#public-health-medical-prevention-metrics").innerHTML,
    node("#public-health-medical-prevention-tasks").innerHTML
  ].join("\n");
  assert.match(rendered, /8\/8/);
  assert.match(rendered, /临床症候群/);
  assert.match(rendered, /人工核实/);
  assert.match(rendered, /托管激活密钥/);
  assert.match(rendered, /active 1 \/ grace 1 \/ revoked 0/);
  assert.match(rendered, /validated-shadow/);
  assert.match(rendered, /advisory-only/);
  assert.match(rendered, /alertCreated=false/);
  assert.match(rendered, /18\/18/);
  assert.match(rendered, /respiratory-18-panel/);
  assert.match(rendered, /6\/6/);
  assert.match(rendered, /3\/3/);
  assert.match(rendered, /safe-panel-standard-mapping/);
  assert.match(rendered, /technicalLaunchReady/);
  assert.match(rendered, /申请同轨替换/);
  assert.match(rendered, /独立批准/);
  assert.match(rendered, /scheduled-evidence-governance/);
  assert.match(rendered, /productionReady=false/);
  assert.match(rendered, /人工确认/);
  assert.match(rendered, /独立批准/);
  assert.match(rendered, /暂无预警/);
  assert.match(rendered, /SAFE-REPORT-ACCEPTED/);
  assert.match(rendered, /可信回执/);
  assert.doesNotMatch(rendered, /externalSignalId|externalSignalKeyHash|idempotencyKeyHash|contentFingerprint|endpoint|secret|signature|receiptId|keyId|artifactDigest/i);
  assert.match(read("public-health.js"), /managedKeyringReady/);
  assert.match(read("public-health.js"), /legacy compatibility \/ No-Go/);
  assert.match(read("public-health.js"), /blockerCode/);

  vm.runInContext(
    "renderPublicHealthModernizationWorkbenches({ foundation: null, sourceOperations: null, ruleGovernance: null, modelGovernance: null, respiratoryPathogen: null, respiratoryNetwork: null, surveillance: null, collaboration: null })",
    context
  );
  assert.match(node("#public-health-data-foundation-status").textContent, /失败关闭/);
  assert.match(node("#public-health-data-source-operations-status").textContent, /失败关闭/);
  assert.match(node("#public-health-rule-governance-status").textContent, /失败关闭/);
  assert.match(node("#public-health-surveillance-model-governance-status").textContent, /失败关闭/);
  assert.match(node("#public-health-respiratory-pathogen-status").textContent, /失败关闭/);
  assert.match(node("#public-health-respiratory-network-status").textContent, /失败关闭/);
  assert.match(node("#public-health-surveillance-status").textContent, /失败关闭/);
  assert.match(node("#public-health-official-exchange-chain-status").textContent, /失败关闭/);
  assert.match(node("#public-health-official-exchange-chain-list").innerHTML, /按未完成处理/);
  assert.match(node("#public-health-medical-prevention-status").textContent, /失败关闭/);
  assert.match(node("#public-health-data-foundation-sources").innerHTML, /按未就绪处理/);
  assert.match(node("#public-health-data-source-operations-list").innerHTML, /按未就绪处理/);
  assert.match(node("#public-health-rule-governance-list").innerHTML, /不得参与评估/);
  assert.match(node("#public-health-surveillance-model-governance-list").innerHTML, /影子建议按未验证处理/);
  assert.match(node("#public-health-respiratory-pathogen-batches").innerHTML, /禁止确认或发布/);
  assert.match(node("#public-health-respiratory-network-institutions").innerHTML, /按未就绪处理/);
  assert.match(node("#public-health-respiratory-network-lifecycle-evidence").innerHTML, /失败关闭处理/);
  assert.match(node("#public-health-respiratory-network-lifecycle-requests").innerHTML, /不允许客户端替代可信状态/);
});
