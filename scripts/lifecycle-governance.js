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

function normalizedWriteScope(scope) {
  const value = typeof scope === "string" ? scope.replaceAll("\\", "/").replace(/(?:\/\*\*|\/)$/, "") : "";
  if (!value || /[:*?]/.test(value) || value.split("/").some((part) => !part || part === "." || part === ".." || part.trim() !== part)) {
    throw new Error("invalid write scope: expected a repository-relative file or directory");
  }
  // Case folding also protects the shared Windows checkout from alias writers.
  return value.toLowerCase();
}

function writeScopesOverlap(left, right) {
  const a = normalizedWriteScope(left);
  const b = normalizedWriteScope(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
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
    task.writeScopes.forEach(normalizedWriteScope);
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
      if (task.observability?.applicable !== true) throw new Error(`${task.id} runtime capability must declare observability applicable`);
      if (capabilityIndex >= capabilityStatuses.indexOf("已验证") && REQUIRED_OBSERVABILITY.some((field) => !String(task.observability[field] || "").trim())) {
        throw new Error(`${task.id} verified runtime capability lacks complete observability delivery`);
      }
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
  const scopeWriters = [];
  for (const task of active) {
    for (const scope of task.writeScopes) {
      const previous = scopeWriters.find((entry) => entry.taskId !== task.id && writeScopesOverlap(scope, entry.scope));
      if (previous) throw new Error(`core write scope ${scope} has concurrent writers ${previous.taskId} and ${task.id}`);
      scopeWriters.push({ scope, taskId: task.id });
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

function buildHandoffReport(config, options = {}) {
  const validation = validateLifecycleGovernance(config, options);
  const active = config.tasks.filter((task) => config.portfolioPolicy.wipStatuses.includes(task.taskStatus));
  const byId = new Map(config.tasks.map((task) => [task.id, task]));
  const decisions = new Map(config.decisions.map((decision) => [decision.id, decision]));
  const integrationReview = [];
  const dependencyReview = [];
  const capabilityFollowups = [];
  for (const task of config.tasks) {
    if (task.taskStatus !== "已关闭" && task.pullRequestRef) {
      integrationReview.push({
        taskId: task.id, ownerProcess: task.integrationOwner || task.ownerProcess,
        pullRequestRef: task.pullRequestRef, ciRef: task.ciRef || "",
        nextAction: "verify-merge-and-ci"
      });
    }
    if (["候选", "待批准", "已阻塞", "已批准"].includes(task.taskStatus)) {
      const blockingDependencies = task.dependencies.filter((id) => byId.get(id).taskStatus !== "已关闭");
      const conflictingTaskIds = active.filter((other) => other.id !== task.id && task.writeScopes.some((scope) => other.writeScopes.some((otherScope) => writeScopesOverlap(scope, otherScope)))).map((other) => other.id);
      const approvalReady = task.approval?.state === "approved" && Boolean(task.approval.ref)
        && task.approval.mode === RISK_APPROVAL_MODES[task.riskLevel]
        && (task.riskLevel !== "高" || (task.decisionIds.length > 0 && task.testIds.length > 0 && task.decisionIds.every((id) => decisions.get(id).status === "Accepted")));
      const wipAvailable = active.some((other) => other.id === task.id) || active.length < config.portfolioPolicy.maximumWip;
      const unresolved = [...(task.unresolved || [])];
      const nextAction = !approvalReady ? "obtain-approval"
        : blockingDependencies.length ? "await-dependencies"
          : conflictingTaskIds.length ? "await-write-scope"
            : !wipAvailable ? "await-wip-slot"
              : unresolved.length ? "review-unresolved-blockers" : "review-dependency-release";
      dependencyReview.push({ taskId: task.id, ownerProcess: task.ownerProcess, approvalReady, blockingDependencies, conflictingTaskIds, wipAvailable, unresolved, nextAction });
    }
    if (task.taskStatus === "已关闭") {
      const missingObservability = task.runtimeCapability === true
        ? REQUIRED_OBSERVABILITY.filter((field) => !String(task.observability[field] || "").trim()) : [];
      if (missingObservability.length || task.unresolved?.length) {
        capabilityFollowups.push({ taskId: task.id, ownerProcess: task.ownerProcess, capabilityStatus: task.capabilityStatus,
          missingObservability, unresolved: [...(task.unresolved || [])], nextAction: "register-capability-follow-up" });
      }
    }
  }
  return {
    schemaVersion: "platform-lifecycle-handoff-v1",
    automaticActionsAllowed: false,
    productionDecision: validation.summary.productionDecision,
    activeWip: active.length, maximumWip: config.portfolioPolicy.maximumWip,
    integrationReview, dependencyReview, capabilityFollowups
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
  const classifiedFiles = new Set();
  for (const rule of config.impactRules || []) {
    const matchingFiles = files.filter((file) => rule.patterns.some((pattern) => {
      if (/^\.[a-z0-9]+$/i.test(pattern)) return file.endsWith(pattern);
      if (pattern.endsWith("/")) return file.startsWith(pattern);
      // Preserve the existing bare filename-family rule (for example "auth").
      if (/^[a-z0-9-]+$/i.test(pattern)) return file.startsWith(pattern);
      return file === pattern;
    }));
    if (matchingFiles.length === 0) continue;
    matchingFiles.forEach((file) => classifiedFiles.add(file));
    matchedRules.push(rule.id);
    rule.modules.forEach((item) => modules.add(item));
    rule.requiredTiers.forEach((item) => requiredTiers.add(item));
    (rule.quickTests || []).forEach((item) => quickTests.add(item));
  }
  const unclassifiedFiles = [...new Set(files.filter((file) => !classifiedFiles.has(file)))].sort();
  if (unclassifiedFiles.length > 0) {
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
    unclassifiedFiles,
    fullUnitFallback: unclassifiedFiles.length > 0
  };
}

function npmRunInvocation(script, options = {}) {
  const platform = options.platform || process.platform;
  const npmExecPath = options.npmExecPath === undefined ? process.env.npm_execpath : options.npmExecPath;
  if (npmExecPath) {
    return {
      command: process.execPath,
      args: [npmExecPath, "run", script],
      shell: false
    };
  }
  return {
    command: platform === "win32" ? "npm.cmd" : "npm",
    args: ["run", script],
    shell: platform === "win32"
  };
}

function assertSpawnSucceeded(result, message) {
  if (result?.error) {
    const code = String(result.error.code || "SPAWN_FAILED").replace(/[^A-Z0-9_-]/gi, "") || "SPAWN_FAILED";
    throw new Error(`${message}: ${code}`);
  }
  if (result?.status !== 0) throw new Error(message);
}

function runChangedUnitTests(config, files, options = {}) {
  const impact = analyzeImpact(config, files);
  const spawn = options.spawnSync || spawnSync;
  const root = options.root || ROOT;
  let supplementalTests = [];
  if (impact.fullUnitFallback) {
    const invocation = npmRunInvocation("test:unit", options);
    const result = spawn(invocation.command, invocation.args, {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
      shell: invocation.shell
    });
    assertSpawnSucceeded(result, "unclassified change full unit fallback failed");
    const unitTests = new Set(require("./run-standard-test-suite").listStandardSuite("unit"));
    supplementalTests = impact.quickTests.filter((testPath) => !unitTests.has(testPath));
    if (supplementalTests.length > 0) {
      for (const testPath of supplementalTests) {
        if (!fs.existsSync(path.join(root, testPath))) throw new Error(`quick test does not exist: ${testPath}`);
      }
      const additional = spawn(process.execPath, ["--test", ...supplementalTests], { cwd: root, stdio: "inherit", windowsHide: true });
      assertSpawnSucceeded(additional, "supplemental affected tests failed");
    }
  } else {
    const tests = impact.quickTests.length > 0 ? impact.quickTests : ["test/lifecycle-governance.test.js"];
    for (const testPath of tests) {
      if (!fs.existsSync(path.join(root, testPath))) throw new Error(`quick test does not exist: ${testPath}`);
    }
    const result = spawn(process.execPath, ["--test", ...tests], { cwd: root, stdio: "inherit", windowsHide: true });
    assertSpawnSucceeded(result, "changed unit tests failed");
  }
  return { ...impact, supplementalTests, executed: impact.fullUnitFallback ? "full-unit-fallback" : "affected-unit-tests" };
}

function runCli(argv = process.argv.slice(2)) {
  const command = argv[0] || "check";
  const config = readJson(parseArg("--config", argv) || DEFAULT_CONFIG);
  if (command === "check") return validateLifecycleGovernance(config);
  if (command === "handoff") return buildHandoffReport(config);
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
  throw new Error("Usage: lifecycle-governance.js check|handoff|impact|tests [--base=ref] [--files=path,...]");
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(runCli(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { analyzeImpact, assertNoDependencyCycle, assertSpawnSucceeded, buildHandoffReport, changedFiles, npmRunInvocation, readJson, runChangedUnitTests, validateLifecycleGovernance, writeScopesOverlap };
