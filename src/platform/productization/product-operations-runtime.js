"use strict";

const { buildMonitoringReadinessReport } = require("../../../scripts/monitoring-readiness");
const { buildExercise: buildRegionalReplicationExercise } = require("../../../scripts/regional-replication-exercise");
const { buildProductOperationsCenter } = require("./product-operations-center");

const SAFE_STATE = new Set(["ready", "attention", "blocked"]);
const SAFE_SECTION = new Set(["work-items", "frontend", "monitoring", "nonfunctional", "regional-replication"]);
const SAFE_STAGE = new Set(["development", "validation", "staging", "production"]);
const SAFE_DEPLOYMENT_CLASS = new Set(["development", "test", "staging", "production"]);
const SAFE_WORK_ITEM_STATUS = new Set(["queued", "assigned", "in-progress", "blocked", "observed", "resolved"]);
const SAFE_PRIORITY = new Set(["low", "normal", "medium", "high", "critical"]);
const CARD_LABELS = Object.freeze({
  "open-work-items": "开放事项",
  "blocked-work-items": "阻断事项",
  "monitoring-controls": "监控控制",
  "frontend-assets": "前端预算",
  "regional-sites": "地区实例"
});

function integer(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function identifier(value, maximum = 96) {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9._-]+$/.test(text) ? text.slice(0, maximum) : "redacted";
}

function regionCode(value) {
  const text = String(value || "").trim();
  return /^\d{6,12}$/.test(text) ? text : "redacted";
}

function enumValue(value, allowlist) {
  const text = String(value || "").trim();
  return allowlist.has(text) ? text : "blocked";
}

function checks(items) {
  return Object.freeze((Array.isArray(items) ? items : []).map((item) => Object.freeze({
    id: identifier(item?.id),
    passed: item?.passed === true
  })));
}

function projectViewModel(viewModel) {
  return Object.freeze({
    schemaVersion: "product-operations-view-model-v1",
    status: viewModel?.status === "local-control-ready" ? "local-control-ready" : "blocked",
    productionReady: false,
    cards: Object.freeze((Array.isArray(viewModel?.cards) ? viewModel.cards : [])
      .filter((card) => Object.hasOwn(CARD_LABELS, card?.id))
      .map((card) => Object.freeze({
      id: card.id,
      label: CARD_LABELS[card.id],
      value: integer(card?.value),
      state: enumValue(card?.state, SAFE_STATE)
    }))),
    sections: Object.freeze((Array.isArray(viewModel?.sections) ? viewModel.sections : [])
      .filter((section) => SAFE_SECTION.has(section?.id))
      .map((section) => Object.freeze({
        id: section.id,
        state: enumValue(section?.state, SAFE_STATE)
      }))),
    workItems: Object.freeze((Array.isArray(viewModel?.workItems) ? viewModel.workItems : []).map((item) => Object.freeze({
      id: identifier(item?.id, 48),
      label: "平台运行事项",
      domain: identifier(item?.domain, 48),
      status: enumValue(item?.status, SAFE_WORK_ITEM_STATUS),
      priority: enumValue(item?.priority, SAFE_PRIORITY),
      version: integer(item?.version)
    }))),
    boundary: "驾驶舱仅包含白名单运维元数据，不包含患者、机构报文或授权结论。"
  });
}

function projectProductOperationsCockpit(center) {
  const monitoring = center?.monitoring || {};
  const nonfunctional = center?.nonfunctional || {};
  const replication = center?.replication || {};
  return Object.freeze({
    schemaVersion: "platform-product-operations-cockpit-v1",
    generatedAt: String(center?.generatedAt || "").slice(0, 40),
    ok: center?.ok === true,
    localControlReady: center?.localControlReady === true,
    siteReady: false,
    productionReady: false,
    containsBusinessPayload: false,
    containsCredentials: false,
    summary: Object.freeze({
      projectedWorkItems: integer(center?.summary?.projectedWorkItems),
      openWorkItems: integer(center?.summary?.openWorkItems),
      monitoringControls: integer(center?.summary?.monitoringControls),
      frontendAssetsWithinBudget: integer(center?.summary?.frontendAssetsWithinBudget),
      operationsUiWithinBudget: center?.summary?.operationsUiWithinBudget === true,
      regionalSites: integer(center?.summary?.regionalSites)
    }),
    cockpit: projectViewModel(center?.frontend),
    monitoring: Object.freeze({
      ok: monitoring.ok === true,
      status: identifier(monitoring.status, 80),
      productionReady: false,
      summary: Object.freeze({
        routes: integer(monitoring.summary?.routes),
        controls: integer(monitoring.summary?.controls),
        blockers: integer(monitoring.summary?.blockers)
      }),
      requiredChecks: checks(monitoring.requiredChecks),
      boundary: "仅公开监控控制数量和门禁结果，不公开探测目标、正文、告警载荷或接收端。"
    }),
    nonfunctional: Object.freeze({
      ok: nonfunctional.ok === true,
      productionReady: false,
      summary: Object.freeze({
        assets: integer(nonfunctional.summary?.assets),
        assetsWithinBudget: integer(nonfunctional.summary?.assetsWithinBudget),
        testFiles: integer(nonfunctional.summary?.testFiles),
        routeFiles: integer(nonfunctional.summary?.routeFiles)
      }),
      checks: checks(nonfunctional.checks),
      boundary: "静态预算只证明本地控制，不替代压测、弱网、容灾或无障碍现场验收。"
    }),
    replication: Object.freeze({
      ok: replication.ok === true,
      technicalReady: replication.technicalReady === true,
      productionReady: false,
      summary: Object.freeze({
        sites: integer(replication.summary?.sites),
        validationSites: integer(replication.summary?.validationSites)
      }),
      sites: Object.freeze((Array.isArray(replication.sites) ? replication.sites : []).map((site) => Object.freeze({
        siteId: identifier(site?.siteId, 64),
        regionCode: regionCode(site?.regionCode),
        stage: enumValue(site?.stage, SAFE_STAGE),
        deploymentClass: enumValue(site?.deploymentClass, SAFE_DEPLOYMENT_CLASS),
        productionReady: false
      }))),
      boundary: "仅公开地区代号和部署阶段，不公开主机、端口、路径、账号、存储资源或运行密钥。"
    }),
    checks: checks(center?.checks),
    blockers: Object.freeze((Array.isArray(center?.blockers) ? center.blockers : []).map((item) => identifier(item, 120))),
    boundary: "本地产品运行控制面可以就绪，但现场验收和生产启用始终保持关闭。"
  });
}

function blockedMonitoringEvidence() {
  return Object.freeze({ ok: false, productionReady: false, status: "blocked", summary: {}, checks: [] });
}

function blockedReplicationEvidence() {
  return Object.freeze({ ok: false, technicalReady: false, productionReady: false, sites: [] });
}

function localEvidence(options = {}) {
  if (options.monitoring || options.replication) {
    return {
      monitoring: options.monitoring || blockedMonitoringEvidence(),
      replication: options.replication || blockedReplicationEvidence()
    };
  }
  try {
    return {
      monitoring: buildMonitoringReadinessReport(),
      replication: buildRegionalReplicationExercise({ generatedAt: options.now })
    };
  } catch {
    return { monitoring: blockedMonitoringEvidence(), replication: blockedReplicationEvidence() };
  }
}

function buildPlatformProductOperationsCockpit(data, options = {}) {
  const evidence = localEvidence(options);
  const center = buildProductOperationsCenter(data || {}, {
    ...options,
    monitoring: evidence.monitoring,
    replication: evidence.replication
  });
  return projectProductOperationsCockpit(center);
}

module.exports = {
  buildPlatformProductOperationsCockpit,
  localEvidence,
  projectProductOperationsCockpit
};
