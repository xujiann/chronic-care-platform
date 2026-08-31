"use strict";

const programDefault = require("../../../config/data-governance-control-plane.json");
const migrationProgram = require("../../../config/data-migration-program.json");
const promotionProgram = require("../../../config/p0-data-promotions.json");
const { buildDataMigrationControlCenter } = require("./migration-control-center");
const { promotionPhaseCounts } = require("./promotion-contract");
const { STATES: EXECUTION_STATES, assessMigrationExecutionState } = require("./migration-execution-runtime");
const {
  SHA256,
  assertMetadataOnly,
  createTechnicalEvidenceFingerprint,
  sha256
} = require("../governance/technical-evidence");

const ISSUE_STATUS = new Set(["open", "acknowledged", "resolved"]);
const SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const RECONCILIATION_TYPES = new Set(["count-mismatch", "digest-mismatch", "duplicate-detected", "checkpoint-mismatch"]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,119}$/;

function governanceError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function text(value, field, pattern = ID) {
  const normalized = String(value || "").trim();
  if (!normalized || (pattern && !pattern.test(normalized))) {
    throw governanceError("DATA_GOVERNANCE_METADATA_INVALID", `${field} is invalid`);
  }
  return normalized;
}

function timestamp(value, field) {
  const normalized = text(value, field, null);
  if (Number.isNaN(Date.parse(normalized))) throw governanceError("DATA_GOVERNANCE_TIMESTAMP_INVALID", `${field} must be an ISO timestamp`);
  return normalized;
}

function digest(value, field) {
  const normalized = text(value, field, null).toLowerCase();
  if (!SHA256.test(normalized)) throw governanceError("DATA_GOVERNANCE_DIGEST_INVALID", `${field} must be a sha256 digest`);
  return normalized;
}

function onlyKeys(value, allowed, location) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw governanceError("DATA_GOVERNANCE_METADATA_INVALID", `${location} must be an object`);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw governanceError("DATA_GOVERNANCE_FIELD_NOT_ALLOWED", `${location} contains unsupported metadata fields: ${unknown.join(",")}`);
}

function validateDataGovernanceControlProgram(program = programDefault) {
  assertMetadataOnly(program, "dataGovernanceProgram");
  if (program?.schemaVersion !== "data-governance-control-plane-program-v1") throw new TypeError("data governance control-plane program schema is invalid");
  if (!Array.isArray(program.iterations) || program.iterations.length !== 6 || new Set(program.iterations.map((item) => item.id)).size !== 6) {
    throw new TypeError("data governance control plane requires exactly six unique iterations");
  }
  if (!Array.isArray(program.qualityRules) || program.qualityRules.length < 5) throw new TypeError("data governance quality rule catalog is incomplete");
  const ruleIds = new Set();
  for (const rule of program.qualityRules) {
    if (!ID.test(rule.id || "") || ruleIds.has(rule.id) || !["min", "max"].includes(rule.operator)
      || !Number.isFinite(rule.threshold) || !SEVERITIES.has(rule.severity)) {
      throw new TypeError("data governance quality rule is invalid or duplicated");
    }
    ruleIds.add(rule.id);
  }
  const nodes = program.topology?.nodes || [];
  const edges = program.topology?.edges || [];
  if (!Array.isArray(nodes) || nodes.length < 2 || new Set(nodes).size !== nodes.length || !Array.isArray(edges) || edges.length < nodes.length - 1) {
    throw new TypeError("data governance lineage topology is incomplete");
  }
  const nodeSet = new Set(nodes);
  const adjacency = new Map(nodes.map((node) => [node, []]));
  for (const edge of edges) {
    if (!nodeSet.has(edge.from) || !nodeSet.has(edge.to) || !ID.test(edge.control || "")) throw new TypeError("data governance lineage edge is invalid");
    adjacency.get(edge.from).push(edge.to);
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(node) {
    if (visiting.has(node)) throw new TypeError("data governance lineage topology must be acyclic");
    if (visited.has(node)) return;
    visiting.add(node);
    adjacency.get(node).forEach(visit);
    visiting.delete(node);
    visited.add(node);
  }
  nodes.forEach(visit);
  if (!nodes.includes("local-candidate") || !nodes.includes("recoverable-checkpoint") || !nodes.includes("exact-reconciliation-gate")) {
    throw new TypeError("data governance lineage topology is missing required gates");
  }
  if (program.requestPathDualWrite !== false || program.metadataOnly !== true || program.productionActivationAuthorized !== false) {
    throw new TypeError("data governance control plane must remain metadata-only and production fail-closed");
  }
  for (const severity of SEVERITIES) {
    if (!Number.isFinite(program.workItems?.slaHours?.[severity]) || program.workItems.slaHours[severity] <= 0) throw new TypeError("data governance work-item SLA is invalid");
  }
  return true;
}

function normalizeReconciliationIssue(issue, program) {
  onlyKeys(issue, new Set(["id", "batchId", "runId", "waveId", "exceptionType", "severity", "status", "detectedAt", "evidenceRef", "evidenceDigest", "dueAt"]), "reconciliationException");
  const waveId = text(issue.waveId, "waveId");
  if (!migrationProgram.waves.some((wave) => wave.id === waveId)) throw governanceError("DATA_GOVERNANCE_WAVE_UNKNOWN", `unknown migration wave: ${waveId}`);
  const exceptionType = text(issue.exceptionType, "exceptionType");
  if (!RECONCILIATION_TYPES.has(exceptionType)) throw governanceError("DATA_GOVERNANCE_RECONCILIATION_TYPE_INVALID", "reconciliation exception type is invalid");
  const severity = text(issue.severity, "severity").toLowerCase();
  const status = text(issue.status, "status").toLowerCase();
  if (!SEVERITIES.has(severity) || !ISSUE_STATUS.has(status)) throw governanceError("DATA_GOVERNANCE_ISSUE_STATE_INVALID", "issue severity or status is invalid");
  const detectedAt = timestamp(issue.detectedAt, "detectedAt");
  const deadline = new Date(Date.parse(detectedAt) + program.workItems.slaHours[severity] * 3600000).toISOString();
  const dueAt = issue.dueAt ? timestamp(issue.dueAt, "dueAt") : deadline;
  if (Date.parse(dueAt) > Date.parse(deadline)) throw governanceError("DATA_GOVERNANCE_SLA_INVALID", "reconciliation issue dueAt exceeds the configured SLA");
  return Object.freeze({
    kind: "reconciliation",
    id: text(issue.id, "issue id"),
    batchId: text(issue.batchId, "batchId"),
    runId: text(issue.runId, "runId"),
    waveId,
    exceptionType,
    severity,
    status,
    detectedAt,
    dueAt,
    evidenceRef: text(issue.evidenceRef, "evidenceRef"),
    evidenceDigest: digest(issue.evidenceDigest, "evidenceDigest")
  });
}

function normalizeQualityFinding(finding, program) {
  onlyKeys(finding, new Set(["id", "ruleId", "waveId", "collection", "severity", "status", "observedValue", "detectedAt", "evidenceRef", "evidenceDigest", "dueAt"]), "qualityFinding");
  const ruleId = text(finding.ruleId, "ruleId");
  const rule = program.qualityRules.find((item) => item.id === ruleId);
  if (!rule) throw governanceError("DATA_GOVERNANCE_QUALITY_RULE_UNKNOWN", `unknown quality rule: ${ruleId}`);
  const waveId = text(finding.waveId, "waveId");
  const wave = migrationProgram.waves.find((item) => item.id === waveId);
  const collection = text(finding.collection, "collection", /^[A-Za-z][A-Za-z0-9]{1,79}$/);
  if (!wave || !wave.collections.includes(collection)) throw governanceError("DATA_GOVERNANCE_LINEAGE_COLLECTION_INVALID", "quality finding collection is outside the migration wave");
  const severity = text(finding.severity, "severity").toLowerCase();
  const status = text(finding.status, "status").toLowerCase();
  if (severity !== rule.severity || !ISSUE_STATUS.has(status) || !Number.isFinite(finding.observedValue)) {
    throw governanceError("DATA_GOVERNANCE_QUALITY_FINDING_INVALID", "quality finding does not match its rule metadata");
  }
  const violated = rule.operator === "min" ? finding.observedValue < rule.threshold : finding.observedValue > rule.threshold;
  if (!violated) throw governanceError("DATA_GOVERNANCE_QUALITY_FINDING_NOT_VIOLATED", "quality finding observed value does not violate the configured rule");
  const detectedAt = timestamp(finding.detectedAt, "detectedAt");
  const deadline = new Date(Date.parse(detectedAt) + program.workItems.slaHours[severity] * 3600000).toISOString();
  const dueAt = finding.dueAt ? timestamp(finding.dueAt, "dueAt") : deadline;
  if (Date.parse(dueAt) > Date.parse(deadline)) throw governanceError("DATA_GOVERNANCE_SLA_INVALID", "quality finding dueAt exceeds the configured SLA");
  return Object.freeze({
    kind: "quality",
    id: text(finding.id, "finding id"),
    ruleId,
    waveId,
    collection,
    severity,
    status,
    observedValue: finding.observedValue,
    threshold: rule.threshold,
    operator: rule.operator,
    detectedAt,
    dueAt,
    evidenceRef: text(finding.evidenceRef, "evidenceRef"),
    evidenceDigest: digest(finding.evidenceDigest, "evidenceDigest")
  });
}

function buildLineage(program) {
  const nodes = Object.freeze([...program.topology.nodes]);
  const edges = Object.freeze(program.topology.edges.map((edge) => Object.freeze({ ...edge })));
  return Object.freeze(migrationProgram.waves.flatMap((wave) => wave.collections.map((collection) => Object.freeze({
    lineageId: `lineage-${sha256(`${wave.id}:${collection}`).slice(7, 23)}`,
    waveId: wave.id,
    collection,
    nodes,
    edges,
    metadataOnly: true,
    productionPrimary: false
  }))));
}

function analyzeImpact(change, program = programDefault) {
  assertMetadataOnly(change, "dataGovernanceChange");
  onlyKeys(change, new Set(["changeId", "changedNodes", "waveId", "collection", "requestedAt", "evidenceRef", "evidenceDigest"]), "dataGovernanceChange");
  const changedNodes = Array.isArray(change.changedNodes) ? change.changedNodes.map((node) => text(node, "changedNode")) : [];
  const nodeSet = new Set(program.topology.nodes);
  if (!changedNodes.length || changedNodes.some((node) => !nodeSet.has(node))) throw governanceError("DATA_GOVERNANCE_IMPACT_NODE_INVALID", "impact analysis requires known changed nodes");
  const waveId = text(change.waveId, "waveId");
  const wave = migrationProgram.waves.find((item) => item.id === waveId);
  const collection = text(change.collection, "collection", /^[A-Za-z][A-Za-z0-9]{1,79}$/);
  if (!wave || !wave.collections.includes(collection)) throw governanceError("DATA_GOVERNANCE_LINEAGE_COLLECTION_INVALID", "impact collection is outside the migration wave");
  const adjacency = new Map(program.topology.nodes.map((node) => [node, []]));
  for (const edge of program.topology.edges) adjacency.get(edge.from).push(edge);
  const impacted = new Set(changedNodes);
  const controls = new Set();
  const queue = [...changedNodes];
  while (queue.length) {
    const node = queue.shift();
    for (const edge of adjacency.get(node)) {
      controls.add(edge.control);
      if (!impacted.has(edge.to)) {
        impacted.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  const projection = {
    changeId: text(change.changeId, "changeId"),
    waveId,
    collection,
    changedNodes: [...changedNodes].sort(),
    impactedNodes: [...impacted].sort(),
    impactedControls: [...controls].sort(),
    blocksLocalCandidate: impacted.has("local-candidate"),
    requestedAt: timestamp(change.requestedAt, "requestedAt"),
    evidenceRef: text(change.evidenceRef, "evidenceRef"),
    evidenceDigest: digest(change.evidenceDigest, "evidenceDigest")
  };
  return Object.freeze({ ...projection, impactDigest: createTechnicalEvidenceFingerprint("data-governance-impact-analysis-v1", projection) });
}

function validRollback(run) {
  const rollback = run.controls?.rollback;
  if (!rollback || rollback.snapshotDigest !== rollback.restoreDigest || !SHA256.test(rollback.snapshotDigest || "")
    || rollback.rpoSeconds > migrationProgram.rollback.maximumRpoSeconds || rollback.rtoSeconds > migrationProgram.rollback.maximumRtoSeconds) return false;
  const approvals = Array.isArray(rollback.approvals) ? rollback.approvals : [];
  const roles = new Set(approvals.map((item) => item.role));
  return approvals.length >= migrationProgram.rollback.minimumIndependentApprovals
    && roles.size === approvals.length
    && migrationProgram.rollback.requiredApprovalRoles.every((role) => roles.has(role))
    && approvals.every((item) => SHA256.test(item.digest || "") && Boolean(item.evidenceRef));
}

function validQuality(run) {
  const quality = run.controls?.quality;
  const threshold = migrationProgram.qualityThresholds;
  return Boolean(quality) && quality.completenessPct >= threshold.minimumCompletenessPct
    && quality.validityPct >= threshold.minimumValidityPct && quality.uniquenessPct >= threshold.minimumUniquenessPct
    && quality.freshnessLagSeconds <= threshold.maximumFreshnessLagSeconds
    && quality.criticalIssueCount <= threshold.maximumCriticalIssueCount
    && quality.unresolvedIssueCount <= threshold.maximumUnresolvedIssueCount;
}

function projectWorkItem(issue, program) {
  const identity = `${issue.kind}:${issue.id}:${issue.evidenceDigest}`;
  const terminal = issue.status === "resolved";
  return Object.freeze({
    id: `wi-dg-${sha256(identity).slice(7, 23)}`,
    sourceCollection: issue.kind === "reconciliation" ? "dataGovernanceReconciliationExceptions" : "dataGovernanceQualityFindings",
    sourceRefDigest: sha256(identity),
    domain: program.workItems.domain,
    label: issue.kind === "reconciliation" ? "数据迁移对账异常" : "数据质量治理问题",
    sourceStatus: issue.status,
    sourceState: terminal ? "terminal" : "open",
    priority: issue.severity,
    dueAt: issue.dueAt,
    status: terminal ? "observed" : "queued",
    assigneeRole: "",
    version: 0,
    latestEvidenceRef: issue.evidenceRef,
    latestNoteDigest: "",
    createdAt: issue.detectedAt,
    updatedAt: issue.detectedAt,
    productionReady: false,
    payloadsExposed: false,
    credentialsExposed: false
  });
}

function buildDataGovernanceControlPlane(input = {}, options = {}) {
  const program = options.program || programDefault;
  validateDataGovernanceControlProgram(program);
  assertMetadataOnly(input, "dataGovernanceControlInput");
  onlyKeys(input, new Set(["migrationRuns", "executionState", "reconciliationExceptions", "qualityFindings", "changes"]), "dataGovernanceControlInput");
  const migrationRuns = Array.isArray(input.migrationRuns) ? input.migrationRuns : [];
  const executionState = input.executionState || { schemaVersion: "data-migration-execution-recovery-v1", batches: [], outboxEvents: [] };
  const reconciliationExceptions = (input.reconciliationExceptions || []).map((item) => normalizeReconciliationIssue(item, program));
  const qualityFindings = (input.qualityFindings || []).map((item) => normalizeQualityFinding(item, program));
  const impacts = (input.changes || []).map((item) => analyzeImpact(item, program));
  const issueKeys = [...reconciliationExceptions, ...qualityFindings].map((item) => `${item.kind}:${item.id}`);
  if (new Set(issueKeys).size !== issueKeys.length) throw governanceError("DATA_GOVERNANCE_ISSUE_DUPLICATED", "data governance issue identifiers must be unique within each issue type");
  const changeIds = impacts.map((item) => item.changeId);
  if (new Set(changeIds).size !== changeIds.length) throw governanceError("DATA_GOVERNANCE_CHANGE_DUPLICATED", "data governance change identifiers must be unique");
  const promotions = options.promotions || promotionProgram;
  const promotionPhases = promotionPhaseCounts(promotions);
  const migration = buildDataMigrationControlCenter(migrationRuns, { now: options.now, promotions });
  const execution = assessMigrationExecutionState(executionState, { now: options.now });
  const candidateRuns = migrationRuns.filter((run) => run.state === "local-candidate");
  const candidateBatches = (executionState.batches || []).filter((batch) => batch.state === EXECUTION_STATES.LOCAL_CANDIDATE);
  const bindingsValid = candidateBatches.every((batch) => candidateRuns.some((run) => run.runId === batch.runId
    && run.waveId === batch.waveId && run.controls?.reconciliation?.outboxCheckpoint === batch.checkpoint?.checkpointId));
  const rollbackReady = candidateRuns.every(validRollback);
  const qualityControlsReady = candidateRuns.every(validQuality);
  const openReconciliation = reconciliationExceptions.filter((item) => item.status !== "resolved");
  const openQuality = qualityFindings.filter((item) => item.status !== "resolved");
  const issues = [...reconciliationExceptions, ...qualityFindings];
  const workItems = Object.freeze(issues.map((item) => projectWorkItem(item, program)));
  const lineage = buildLineage(program);
  const checkpointStates = new Set([EXECUTION_STATES.APPLYING, EXECUTION_STATES.AWAITING_RECONCILIATION, EXECUTION_STATES.RECONCILED, EXECUTION_STATES.LOCAL_CANDIDATE]);
  const checkpointsValid = (executionState.batches || []).every((batch) => !checkpointStates.has(batch.state) || Boolean(batch.checkpoint?.checkpointDigest));
  const workItemsValid = workItems.length === issues.length && workItems.every((item) => item.productionReady === false
    && item.payloadsExposed === false && item.credentialsExposed === false && item.sourceRefDigest.startsWith("sha256:"));
  const checks = Object.freeze([
    { id: "dataGovernanceControl:program", passed: true, detail: `${program.iterations.length} iterations / ${program.qualityRules.length} quality rules` },
    { id: "dataGovernanceControl:promotionPhases", passed: promotionPhases.promotedP0 + promotionPhases.repositoryPlanReady === promotionPhases.registeredContracts, detail: `${promotionPhases.promotedP0} promoted / ${promotionPhases.repositoryPlanReady} repository plan-ready` },
    { id: "dataGovernanceControl:migrationExecution", passed: migration.ok && execution.ok, detail: `${migration.summary.runs} runs / ${execution.summary.batches} batches` },
    { id: "dataGovernanceControl:recoverableCheckpoint", passed: checkpointsValid, detail: `${(executionState.batches || []).filter((batch) => batch.checkpoint).length} persisted checkpoints` },
    { id: "dataGovernanceControl:exactReconciliation", passed: bindingsValid && openReconciliation.length === 0, detail: `${candidateBatches.length} candidate bindings / ${openReconciliation.length} open exceptions` },
    { id: "dataGovernanceControl:rollbackGate", passed: rollbackReady, detail: `${candidateRuns.filter(validRollback).length}/${candidateRuns.length} candidate runs` },
    { id: "dataGovernanceControl:qualityRules", passed: qualityControlsReady && openQuality.length === 0, detail: `${program.qualityRules.length} rules / ${openQuality.length} open findings` },
    { id: "dataGovernanceControl:lineageImpact", passed: lineage.length === migrationProgram.waves.reduce((sum, wave) => sum + wave.collections.length, 0) && impacts.every((item) => SHA256.test(item.impactDigest)), detail: `${lineage.length} collection lineages / ${impacts.length} impact analyses` },
    { id: "dataGovernanceControl:workItemProjection", passed: workItemsValid, detail: `${workItems.length} metadata-only unified work items` },
    { id: "dataGovernanceControl:productionFailClosed", passed: program.productionActivationAuthorized === false && migration.productionReady === false && execution.productionReady === false, detail: "NO-GO until verified external evidence and approval" }
  ]);
  const ok = checks.every((item) => item.passed);
  return Object.freeze({
    schemaVersion: "data-governance-control-plane-v1",
    generatedAt: options.now || new Date().toISOString(),
    ok,
    controlPlaneReady: ok,
    localGateReady: ok && candidateRuns.length > 0 && candidateBatches.length > 0,
    productionReady: false,
    productionPrimary: false,
    activationAuthorized: false,
    decision: "NO-GO",
    summary: Object.freeze({
      iterations: program.iterations.length,
      promotedP0: promotionPhases.promotedP0,
      repositoryPlanReady: promotionPhases.repositoryPlanReady,
      migrationRuns: migration.summary.runs,
      executionBatches: execution.summary.batches,
      checkpoints: (executionState.batches || []).filter((batch) => batch.checkpoint).length,
      candidateBindings: candidateBatches.length,
      openReconciliationExceptions: openReconciliation.length,
      openQualityFindings: openQuality.length,
      lineageRecords: lineage.length,
      impactAnalyses: impacts.length,
      projectedWorkItems: workItems.length
    }),
    migration,
    execution,
    qualityRules: Object.freeze(program.qualityRules.map((item) => Object.freeze({ ...item }))),
    reconciliationExceptions: Object.freeze(reconciliationExceptions),
    qualityFindings: Object.freeze(qualityFindings),
    lineage,
    impacts: Object.freeze(impacts),
    workItems,
    checks,
    externalGates: Object.freeze([...migrationProgram.externalGates]),
    boundary: "This metadata control plane operates local migration evidence and unified work-item projections only. It cannot activate a production worker or authorize cutover."
  });
}

module.exports = {
  analyzeImpact,
  buildDataGovernanceControlPlane,
  buildLineage,
  normalizeQualityFinding,
  normalizeReconciliationIssue,
  projectWorkItem,
  validateDataGovernanceControlProgram
};
