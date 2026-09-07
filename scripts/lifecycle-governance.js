#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_CONFIG = path.join(ROOT, "config", "lifecycle-governance.json");
const TASK_ID = /^(?:ARCH|DATA|SEC|OPS|TEST|REL|GOV)-\d{3}$/;
const REQUIRED_MAPS = new Set([
  "CURRENT_ARCHITECTURE.md",
  "MODULE_MAP.md",
  "DATA_MODEL.md",
  "API_MAP.md",
  "DEPENDENCY_MAP.md",
  "TECH_DEBT.md"
]);
const REQUIRED_GATE_TIERS = new Set(["quick", "pr", "nightly", "release"]);
const REQUIRED_SCENARIO_PATHS = new Set(["正常", "失败", "越权", "恢复"]);
const REQUIRED_ADMISSION_DOMAINS = new Set(["功能完整性", "数据迁移", "安全合规", "性能容量", "灾备恢复", "供应商联调"]);
const REQUIRED_FITNESS_FUNCTIONS = new Set([
  "FIT-MODULE-OWNERSHIP",
  "FIT-DEPENDENCY-DIRECTION",
  "FIT-AUTHORIZATION",
  "FIT-VENDOR-PORT",
  "FIT-API-COMPATIBILITY",
  "FIT-MIGRATION-REGISTRY",
  "FIT-AUDIT-FAIL-CLOSED",
  "FIT-SENSITIVE-OUTPUT"
]);
const REQUIRED_OBSERVABILITY = ["structuredLogs", "metricsAndAlerts", "tracing", "healthCheck", "sloAndErrorBudget", "runbook", "degradation", "compensation"];
const RISK_APPROVAL_MODES = {
  "低": "approved-task-package",
  "中": "T00-plan-approval",
  "高": "accepted-adr-human-review-special-validation"
};

function readJson(file = DEFAULT_CONFIG) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function uniqueBy(items, key, label) {
  const values = items.map((item) => item[key]);
  if (values.some((value) => !value) || new Set(values).size !== values.length) {
    throw new Error(`${label} must have unique non-empty ${key}`);
  }
  return new Map(items.map((item) => [item[key], item]));
}

function sameSet(actual, expected) {
  return actual.size === expected.size && [...expected].every((value) => actual.has(value));
}

function assertReferences(items, known, label) {
  for (const value of items || []) {
    if (!known.has(value)) throw new Error(`${label} references unknown id ${value}`);
  }
}

function assertNoDependencyCycle(tasksById) {
  const visiting = new Set();
  const visited = new Set();
  function visit(taskId) {
    if (visiting.has(taskId)) throw new Error(`task dependency cycle detected at ${taskId}`);
    if (visited.has(taskId)) return;
    visiting.add(taskId);
    for (const dependency of tasksById.get(taskId).dependencies || []) visit(dependency);
    visiting.delete(taskId);
    visited.add(taskId);
  }
  for (const taskId of tasksById.keys()) visit(taskId);
}

function validateLifecycleGovernance(config, options = {}) {
  const root = options.root || ROOT;
  if (config?.schemaVersion !== "platform-lifecycle-governance-v1") throw new Error("unsupported lifecycle governance schema");
  if (config.authority?.controlTower !== "T00" || config.authority?.integrationBranch !== "main" || config.authority?.developmentBase !== "origin/main") {
    throw new Error("T00 control tower and single-mainline authority must remain fixed");
  }

  const capabilityStatuses = config.capabilityStatusLifecycle || [];
  const taskStatuses = config.taskStatusLifecycle || [];
  if (!sameSet(new Set(capabilityStatuses), new Set(["未建设", "已实现", "已验证", "已集成", "准生产", "已投产"])) || capabilityStatuses.length !== 6) {
    throw new Error("capability status lifecycle drifted");
  }
  if (new Set(taskStatuses).size !== taskStatuses.length || taskStatuses.length < 6) throw new Error("task status lifecycle is incomplete");
  if (JSON.stringify(config.riskApprovalPolicy) !== JSON.stringify(RISK_APPROVAL_MODES)) throw new Error("risk approval policy drifted");

  const requirements = uniqueBy(config.requirements || [], "id", "requirements");
  const controls = uniqueBy(config.regulatoryControls || [], "id", "regulatory controls");
  const risks = uniqueBy(config.risks || [], "id", "risks");
  const decisions = uniqueBy(config.decisions || [], "id", "decisions");
  const tests = uniqueBy(config.tests || [], "id", "tests");
  const evidence = uniqueBy(config.evidence || [], "id", "evidence");
  const tasks = uniqueBy(config.tasks || [], "id", "tasks");
  const maps = uniqueBy(config.maps || [], "id", "maps");
  const gates = uniqueBy(config.gateTiers || [], "id", "gate tiers");
  const fitnessFunctions = uniqueBy(config.fitnessFunctions || [], "id", "fitness functions");
  const scenarios = uniqueBy(config.goldenScenarios || [], "id", "golden scenarios");
  const admissions = uniqueBy(config.productionAdmission || [], "id", "production admission domains");

  if (!sameSet(new Set([...maps.values()].map((item) => item.path)), REQUIRED_MAPS)) throw new Error("the six AS-IS maps must have exactly one status-layer record");
  if (!sameSet(new Set(gates.keys()), REQUIRED_GATE_TIERS)) throw new Error("gate tiers must be quick, pr, nightly and release");
  if (!sameSet(new Set(fitnessFunctions.keys()), REQUIRED_FITNESS_FUNCTIONS)) throw new Error("architecture fitness functions are incomplete");
  if (!sameSet(new Set([...admissions.values()].map((item) => item.domain)), REQUIRED_ADMISSION_DOMAINS)) throw new Error("production admission matrix is incomplete");
  if (scenarios.size < 10 || scenarios.size > 20) throw new Error("golden scenario catalog must contain 10 to 20 scenarios");

  for (const decision of decisions.values()) {
    if (!["Proposed", "Accepted", "Rejected", "Superseded", "Deprecated"].includes(decision.status)) throw new Error(`${decision.id} has invalid ADR status`);
    if (!decision.path || !fs.existsSync(path.join(root, decision.path))) throw new Error(`${decision.id} ADR path is missing`);
    if (!decision.reviewDue || !decision.effectiveScope || !Array.isArray(decision.supersedes)) throw new Error(`${decision.id} lacks lifecycle metadata`);
  }
  for (const test of tests.values()) {
    if (!test.path || !test.command || !fs.existsSync(path.join(root, test.path))) throw new Error(`${test.id} test contract is not executable`);
  }
  for (const item of evidence.values()) {
    assertReferences(item.testIds, tests, item.id);
    if (!item.scope || !item.type || !item.ref || typeof item.productionEvidence !== "boolean") throw new Error(`${item.id} evidence metadata is incomplete`);
  }

  const active = [];
  for (const task of tasks.values()) {
    if (!TASK_ID.test(task.id)) throw new Error(`${task.id} is not a governed task id`);
    if (!/^T\d{2}$/.test(task.ownerProcess)) throw new Error(`${task.id} has invalid process owner`);
    if (!taskStatuses.includes(task.taskStatus) || !capabilityStatuses.includes(task.capabilityStatus)) throw new Error(`${task.id} has invalid lifecycle status`);
    if (!Object.hasOwn(RISK_APPROVAL_MODES, task.riskLevel)) throw new Error(`${task.id} has invalid risk level`);
    assertReferences(task.requirementIds, requirements, task.id);
    assertReferences(task.regulatoryControlIds, controls, task.id);
    assertReferences(task.riskIds, risks, task.id);
    assertReferences(task.decisionIds, decisions, task.id);
    assertReferences(task.dependencies, tasks, task.id);
    assertReferences(task.testIds, tests, task.id);
    assertReferences(task.evidenceIds, evidence, task.id);
    for (const field of ["affectedModules", "acceptanceCriteria", "writeScopes"]) {
      if (!Array.isArray(task[field]) || task[field].length === 0) throw new Error(`${task.id} lacks ${field}`);
    }
    for (const field of ["dataSensitivity", "rollback", "planRef", "branch", "worktree"]) {
      if (!String(task[field] || "").trim()) throw new Error(`${task.id} lacks ${field}`);
    }
    const isActive = config.portfolioPolicy.wipStatuses.includes(task.taskStatus);
    if (isActive && (task.approval?.state !== "approved" || !task.approval.ref || task.approval.mode !== RISK_APPROVAL_MODES[task.riskLevel])) {
      throw new Error(`${task.id} lacks risk-appropriate approval`);
    }
    if (isActive && task.riskLevel === "高") {
      if (task.decisionIds.length === 0 || task.testIds.length === 0) throw new Error(`${task.id} high-risk work lacks ADR or tests`);
      if (task.decisionIds.some((id) => decisions.get(id).status !== "Accepted")) throw new Error(`${task.id} high-risk work requires an Accepted ADR`);
    }
    const capabilityIndex = capabilityStatuses.indexOf(task.capabilityStatus);
    if (capabilityIndex >= capabilityStatuses.indexOf("已验证") && task.evidenceIds.length === 0) throw new Error(`${task.id} is marked verified without evidence`);
    if (capabilityIndex >= capabilityStatuses.indexOf("已集成") && (!task.pullRequestRef || !task.ciRef)) throw new Error(`${task.id} is marked integrated without PR and CI evidence`);
    if (capabilityIndex >= capabilityStatuses.indexOf("准生产") && admissions.size !== [...admissions.values()].filter((item) => item.status === "GO").length) throw new Error(`${task.id} cannot be production-ready while admission domains remain NO-GO`);
    if (task.runtimeCapability === true) {
      if (task.observability?.applicable !== true || REQUIRED_OBSERVABILITY.some((field) => !String(task.observability[field] || "").trim())) throw new Error(`${task.id} runtime capability lacks complete observability delivery`);
    } else if (task.observability?.applicable !== false || !task.observability.reason) {
      throw new Error(`${task.id} must declare observability applicability`);
    }
    if (isActive) active.push(task);
  }

  assertNoDependencyCycle(tasks);
  if (config.portfolioPolicy.highRiskDownstreamExpansionAllowed === false) {
    for (const task of tasks.values()) {
      const blockingDependency = (task.dependencies || []).map((id) => tasks.get(id)).find((dependency) => dependency.riskLevel === "高" && dependency.taskStatus !== "已关闭");
      if (blockingDependency) throw new Error(`${task.id} cannot expand downstream from open high-risk task ${blockingDependency.id}`);
    }
  }
  if (active.length > config.portfolioPolicy.maximumWip) throw new Error(`WIP limit exceeded: ${active.length}/${config.portfolioPolicy.maximumWip}`);
  const scopeWriters = new Map();
  for (const task of active) {
    for (const scope of task.writeScopes) {
      const previous = scopeWriters.get(scope);
      if (previous) throw new Error(`core write scope ${scope} has concurrent writers ${previous} and ${task.id}`);
      scopeWriters.set(scope, task.id);
    }
  }

  for (const map of maps.values()) {
    if (!map.baseline || !map.target || !capabilityStatuses.includes(map.status)) throw new Error(`${map.id} lacks baseline, target or status`);
    assertReferences(map.gapTaskIds, tasks, map.id);
    assertReferences(map.evidenceIds, evidence, map.id);
    if (capabilityStatuses.indexOf(map.status) >= capabilityStatuses.indexOf("已验证") && map.evidenceIds.length === 0) throw new Error(`${map.id} is verified without evidence`);
  }
  for (const gate of gates.values()) {
    if (!gate.trigger || !gate.command || !Array.isArray(gate.contents) || gate.contents.length === 0) throw new Error(`${gate.id} gate is incomplete`);
  }
  for (const fitnessFunction of fitnessFunctions.values()) {
    if (!fitnessFunction.rule || !fitnessFunction.command) throw new Error(`${fitnessFunction.id} fitness function is incomplete`);
  }
  if (config.testOperations?.flakyPolicy?.retryDoesNotConvertFailureToPass !== true || !Array.isArray(config.testOperations?.flakyPolicy?.entries)) throw new Error("flaky test policy must fail closed");
  for (const flaky of config.testOperations.flakyPolicy.entries) {
    if (!flaky.testId || !flaky.owner || !/^\d{4}-\d{2}-\d{2}$/.test(flaky.exitDate || "")) throw new Error("flaky tests require an owner and exit date");
  }
  for (const scenario of scenarios.values()) {
    if (!sameSet(new Set(scenario.pathTypes || []), REQUIRED_SCENARIO_PATHS)) throw new Error(`${scenario.id} must cover normal, failure, unauthorized and recovery paths`);
    if (!capabilityStatuses.includes(scenario.status) || !Array.isArray(scenario.ownerProcesses) || scenario.ownerProcesses.length === 0) throw new Error(`${scenario.id} lacks owners or lifecycle status`);
    if (capabilityStatuses.indexOf(scenario.status) >= capabilityStatuses.indexOf("已验证") && (!(scenario.testIds || []).length || !(scenario.evidenceIds || []).length)) throw new Error(`${scenario.id} is verified without tests and evidence`);
  }
  for (const admission of admissions.values()) {
    if (!["GO", "NO-GO"].includes(admission.status) || !admission.repositoryStatus || !admission.unblockCondition || !admission.responsibleParty || !admission.requiredEvidence?.length) throw new Error(`${admission.id} admission rule is incomplete`);
    if (admission.status === "GO") {
      const externalEvidence = (admission.evidenceIds || []).map((id) => evidence.get(id));
      if (externalEvidence.length === 0 || externalEvidence.some((item) => !item?.productionEvidence || item.scope !== "external")) throw new Error(`${admission.id} cannot be GO without external production evidence`);
    }
  }

  return {
    ok: true,
    schemaVersion: config.schemaVersion,
    summary: {
      tasks: tasks.size,
      activeWip: active.length,
      maximumWip: config.portfolioPolicy.maximumWip,
      maps: maps.size,
      goldenScenarios: scenarios.size,
      gateTiers: gates.size,
      productionDecision: [...admissions.values()].every((item) => item.status === "GO") ? "GO-CANDIDATE" : "NO-GO",
      productionNoGoDomains: [...admissions.values()].filter((item) => item.status !== "GO").map((item) => item.domain)
    }
  };
}

function parseArg(prefix, argv = process.argv.slice(2)) {
  return argv.find((item) => item.startsWith(`${prefix}=`))?.slice(prefix.length + 1) || "";
}

function changedFiles(options = {}) {
  if (options.files) return options.files.map((item) => item.replaceAll("\\", "/"));
  const base = options.base || "origin/main";
  const root = options.root || ROOT;
  const commands = [
    ["diff", "--name-only", `${base}...HEAD`],
    ["diff", "--name-only"],
    ["diff", "--cached", "--name-only"],
    ["ls-files", "--others", "--exclude-standard"]
  ];
  const files = new Set();
  for (const args of commands) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
    if (result.status !== 0) throw new Error(String(result.stderr || `git ${args.join(" ")} failed`).trim());
    result.stdout.split(/\r?\n/).map((item) => item.trim().replaceAll("\\", "/")).filter(Boolean).forEach((item) => files.add(item));
  }
  return [...files].sort();
}

function analyzeImpact(config, files) {
  const matchedRules = [];
  const modules = new Set();
  const requiredTiers = new Set();
  const quickTests = new Set();
  for (const rule of config.impactRules || []) {
    if (!files.some((file) => rule.patterns.some((pattern) => file === pattern || file.startsWith(pattern) || file.endsWith(pattern)))) continue;
    matchedRules.push(rule.id);
    rule.modules.forEach((item) => modules.add(item));
    rule.requiredTiers.forEach((item) => requiredTiers.add(item));
    (rule.quickTests || []).forEach((item) => quickTests.add(item));
  }
  if (files.length > 0 && matchedRules.length === 0) {
    requiredTiers.add("quick");
    requiredTiers.add("pr");
    modules.add("unclassified-change");
  }
  const order = ["quick", "pr", "nightly", "release"];
  return {
    schemaVersion: "platform-change-impact-v1",
    files,
    matchedRules,
    modules: [...modules].sort(),
    requiredTiers: order.filter((item) => requiredTiers.has(item)),
    quickTests: [...quickTests].sort(),
    fullUnitFallback: files.length > 0 && matchedRules.length === 0
  };
}

function runChangedUnitTests(config, files) {
  const impact = analyzeImpact(config, files);
  if (impact.fullUnitFallback) {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const result = spawnSync(npm, ["run", "test:unit"], { cwd: ROOT, stdio: "inherit", windowsHide: true });
    if (result.status !== 0) throw new Error("unclassified change full unit fallback failed");
  } else {
    const tests = impact.quickTests.length > 0 ? impact.quickTests : ["test/lifecycle-governance.test.js"];
    for (const testPath of tests) {
      if (!fs.existsSync(path.join(ROOT, testPath))) throw new Error(`quick test does not exist: ${testPath}`);
    }
    const result = spawnSync(process.execPath, ["--test", ...tests], { cwd: ROOT, stdio: "inherit", windowsHide: true });
    if (result.status !== 0) throw new Error("changed unit tests failed");
  }
  return { ...impact, executed: impact.fullUnitFallback ? "full-unit-fallback" : "affected-unit-tests" };
}

function runCli(argv = process.argv.slice(2)) {
  const command = argv[0] || "check";
  const config = readJson(parseArg("--config", argv) || DEFAULT_CONFIG);
  if (command === "check") return validateLifecycleGovernance(config);
  if (command === "impact") {
    const explicitFiles = parseArg("--files", argv);
    const files = changedFiles({ base: parseArg("--base", argv) || "origin/main", files: explicitFiles ? explicitFiles.split(",").filter(Boolean) : undefined });
    return analyzeImpact(config, files);
  }
  if (command === "tests") {
    const explicitFiles = parseArg("--files", argv);
    const files = changedFiles({ base: parseArg("--base", argv) || "origin/main", files: explicitFiles ? explicitFiles.split(",").filter(Boolean) : undefined });
    return runChangedUnitTests(config, files);
  }
  throw new Error("Usage: lifecycle-governance.js check|impact|tests [--base=ref] [--files=path,...]");
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(runCli(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { analyzeImpact, assertNoDependencyCycle, changedFiles, readJson, runChangedUnitTests, validateLifecycleGovernance };
