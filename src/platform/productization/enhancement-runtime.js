"use strict";

const { buildCareIntegrationV2Readiness } = require("../../../scripts/care-integration-v2-readiness");
const { buildProductRegionalEnhancementReadiness } = require("../../../scripts/product-regional-enhancement-readiness");
const { buildDataGovernanceControlPlane } = require("../data/data-governance-control-plane");
const { buildProductRegionalOperationsViewModel } = require("./product-regional-operations-view-model");
const { applyWorkItemCommandV2, buildPlatformWorkItemCenterV2 } = require("./work-item-center-v2");

function dataGovernanceInput(data = {}) {
  return {
    migrationRuns: Array.isArray(data.platformDataMigrationRuns) ? data.platformDataMigrationRuns : [],
    executionState: data.platformDataMigrationExecution || undefined,
    reconciliationExceptions: Array.isArray(data.platformDataReconciliationExceptions) ? data.platformDataReconciliationExceptions : [],
    qualityFindings: Array.isArray(data.platformDataQualityFindings) ? data.platformDataQualityFindings : [],
    changes: Array.isArray(data.platformDataChanges) ? data.platformDataChanges : []
  };
}

function buildPlatformEnhancementCockpit(data = {}, options = {}) {
  const now = options.now || new Date().toISOString();
  const dataGovernance = buildDataGovernanceControlPlane(dataGovernanceInput(data), { now });
  const careIntegration = buildCareIntegrationV2Readiness(data, { now });
  const productRegional = buildProductRegionalEnhancementReadiness({
    data,
    now,
    root: options.root,
    monitoring: options.monitoring,
    replication: options.replication,
    nonfunctional: options.nonfunctional,
    configuration: options.configuration,
    acceptance: options.acceptance,
    regionDescriptors: options.regionDescriptors
  });
  const workItems = buildPlatformWorkItemCenterV2(data, { now });
  const cockpit = buildProductRegionalOperationsViewModel(workItems, productRegional.regional);
  const localControlReady = dataGovernance.ok === true
    && productRegional.ok === true
    && careIntegration.sections.adapters.productionReady === false
    && careIntegration.sections.continuousCare.productionReady === false;
  return Object.freeze({
    schemaVersion: "platform-enhancement-cockpit-v1",
    generatedAt: now,
    ok: localControlReady,
    localControlReady,
    siteReady: false,
    productionReady: false,
    decision: "NO-GO",
    containsBusinessPayload: false,
    containsCredentials: false,
    summary: Object.freeze({
      dataIterations: dataGovernance.summary.iterations,
      dataIssues: dataGovernance.summary.openReconciliationExceptions + dataGovernance.summary.openQualityFindings,
      adapterSystemsPassed: careIntegration.sections.adapters.summary.passedSystems,
      careLoopsClosed: careIntegration.sections.continuousCare.summary.closedLoops,
      productIterations: productRegional.summary.iterationsPassed,
      workItems: workItems.summary.total,
      regions: productRegional.summary.regions,
      alertBlockers: productRegional.summary.alertBlockers
    }),
    lines: Object.freeze({
      data: Object.freeze({ ok: dataGovernance.ok, localGateReady: dataGovernance.localGateReady, productionReady: false, summary: dataGovernance.summary }),
      care: Object.freeze({ ok: careIntegration.ok, localTechnicalReady: careIntegration.localTechnicalReady, productionReady: false, adapters: careIntegration.sections.adapters.summary, continuousCare: careIntegration.sections.continuousCare.summary }),
      product: Object.freeze({ ok: productRegional.ok, localControlReady: productRegional.localControlReady, productionReady: false, summary: productRegional.summary })
    }),
    cockpit,
    blockers: Object.freeze([...new Set([
      ...careIntegration.sections.adapters.blockers,
      ...careIntegration.sections.continuousCare.blockers,
      ...productRegional.blockers
    ])]),
    boundary: "统一驾驶舱只展示三条开发线的脱敏运行元数据；真实迁移、机构连通、地区验收及生产授权仍须外部证据。"
  });
}

function applyPlatformWorkItemV2GovernanceAction(data, payload = {}, user = {}, options = {}) {
  return applyWorkItemCommandV2(data, {
    ...payload,
    actorRole: "platform-governance",
    actorId: user.id || user.name || "governance-operator"
  }, options);
}

module.exports = {
  applyPlatformWorkItemV2GovernanceAction,
  buildPlatformEnhancementCockpit,
  dataGovernanceInput
};
