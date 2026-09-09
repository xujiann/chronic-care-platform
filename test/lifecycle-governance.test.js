"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const config = require("../config/lifecycle-governance.json");
const { analyzeImpact, buildHandoffReport, npmRunInvocation, runChangedUnitTests, validateLifecycleGovernance } = require("../scripts/lifecycle-governance");

function copy() {
  return structuredClone(config);
}

function syncMapGapFixture(fixture) {
  const required = fixture.tasks.filter((task) => task.taskStatus !== "已关闭"
    || fixture.capabilityStatusLifecycle.indexOf(task.capabilityStatus) < fixture.capabilityStatusLifecycle.indexOf("已集成")
    || task.unresolved.length > 0).map((task) => task.id);
  fixture.maps.forEach((map, index) => { map.gapTaskIds = index === 0 ? required : []; });
  return fixture;
}

function activeControlTowerFixture() {
  const fixture = copy();
  fixture.tasks = fixture.tasks.filter((task) => task.id === "GOV-002");
  fixture.tasks[0].taskStatus = "待集成";
  fixture.tasks[0].capabilityStatus = "已验证";
  return syncMapGapFixture(fixture);
}

test("parent and child write scopes collide while sibling directories remain independent", () => {
  for (const childScope of ["src/runtime/task.js", "src\\runtime\\task.js", "SRC/RUNTIME/task.js", "src/runtime/**"]) {
    const fixture = activeControlTowerFixture();
    fixture.tasks[0].writeScopes = ["src/runtime/"];
    const other = structuredClone(fixture.tasks[0]);
    other.id = "OPS-100";
    other.writeScopes = [childScope];
    fixture.tasks.push(other);
    assert.throws(() => validateLifecycleGovernance(fixture), /concurrent writers/);
    other.writeScopes = ["src/runtime-peer/task.js"];
    syncMapGapFixture(fixture);
    assert.doesNotThrow(() => validateLifecycleGovernance(fixture));
  }
  for (const scope of ["../src", "/src", "C:/src", "src/../runtime", "src//runtime", "src/*/file.js", "", "src/."]) {
    const fixture = activeControlTowerFixture();
    fixture.tasks[0].writeScopes = [scope];
    assert.throws(() => validateLifecycleGovernance(fixture), /invalid write scope/);
  }
});

test("a known documentation change cannot hide an unknown runtime change", () => {
  const report = analyzeImpact(copy(), ["docs/lifecycle-governance.md", "tools/new-runtime.js"]);
  assert.equal(report.fullUnitFallback, true);
  assert.deepEqual(report.unclassifiedFiles, ["tools/new-runtime.js"]);
  assert.deepEqual(report.requiredTiers, ["quick", "pr"]);
  assert.ok(report.quickTests.includes("test/documentation-fact-drift.test.js"));
  const calls = [];
  runChangedUnitTests(copy(), report.files, {
    npmExecPath: "C:/npm/npm-cli.js",
    spawnSync(command, args) { calls.push(args); return { status: 0 }; }
  });
  assert.deepEqual(calls, [["C:/npm/npm-cli.js", "run", "test:unit"]]);
  assert.deepEqual(analyzeImpact(copy(), []).unclassifiedFiles, []);
  const similar = analyzeImpact(copy(), ["scripts/lifecycle-governance.js.backup", "nested/scripts/lifecycle-governance.js"]);
  assert.equal(similar.fullUnitFallback, true);
  assert.equal(similar.unclassifiedFiles.length, 2);
});

test("handoff CLI returns review queues while preserving the ledger bytes", () => {
  const root = path.resolve(__dirname, "..");
  const ledger = path.join(root, "config/lifecycle-governance.json");
  const before = fs.readFileSync(ledger);
  const result = spawnSync(process.execPath, ["scripts/lifecycle-governance.js", "handoff"], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schemaVersion, "platform-lifecycle-handoff-v1");
  assert.equal(report.automaticActionsAllowed, false);
  assert.deepEqual(fs.readFileSync(ledger), before);
});

function handoffFixture() {
  const fixture = activeControlTowerFixture();
  const parent = fixture.tasks[0];
  parent.riskLevel = "低";
  parent.approval.mode = "approved-task-package";
  parent.taskStatus = "已关闭";
  parent.capabilityStatus = "已实现";
  const child = structuredClone(parent);
  child.id = "OPS-100";
  child.taskStatus = "已阻塞";
  child.dependencies = [parent.id];
  child.writeScopes = ["src/next-task"];
  child.pullRequestRef = "";
  child.ciRef = "";
  child.unresolved = [];
  fixture.tasks.push(child);
  return syncMapGapFixture(fixture);
}

test("mixed changes retain selected integration tests outside the full unit partition", () => {
  const fixture = copy();
  fixture.impactRules = [{ id: "selected-api", patterns: ["known.js"], modules: ["api"], requiredTiers: ["quick", "pr"],
    quickTests: ["test/api.test.js", "test/lifecycle-governance.test.js"] }];
  const calls = [];
  const report = runChangedUnitTests(fixture, ["known.js", "unknown.js"], {
    npmExecPath: "C:/npm/npm-cli.js",
    spawnSync(command, args) { calls.push(args); return { status: 0 }; }
  });
  assert.deepEqual(report.supplementalTests, ["test/api.test.js"]);
  assert.deepEqual(calls, [["C:/npm/npm-cli.js", "run", "test:unit"], ["--test", "test/api.test.js"]]);
  let count = 0;
  assert.throws(() => runChangedUnitTests(fixture, ["known.js", "unknown.js"], {
    npmExecPath: "C:/npm/npm-cli.js",
    spawnSync() { return { status: ++count === 1 ? 0 : 1 }; }
  }), /supplemental affected tests failed/);
});

test("handoff candidates require dependency, approval, scope and WIP review without changing state", () => {
  const fixture = handoffFixture();
  const before = structuredClone(fixture);
  let report = buildHandoffReport(fixture);
  assert.deepEqual(fixture, before);
  assert.equal(report.automaticActionsAllowed, false);
  assert.equal(report.productionDecision, "NO-GO");
  assert.equal(report.dependencyReview[0].nextAction, "review-dependency-release");
  fixture.tasks[1].unresolved = ["外部条件尚未满足"];
  assert.equal(buildHandoffReport(fixture).dependencyReview[0].nextAction, "review-unresolved-blockers");
  fixture.tasks[1].unresolved = [];

  fixture.tasks[0].taskStatus = "实施中";
  report = buildHandoffReport(fixture);
  assert.deepEqual(report.dependencyReview[0].blockingDependencies, ["GOV-002"]);
  fixture.tasks[0].taskStatus = "已关闭";
  fixture.tasks[1].approval = { state: "pending" };
  assert.equal(buildHandoffReport(fixture).dependencyReview[0].approvalReady, false);
  fixture.tasks[1].approval = { ...before.tasks[1].approval, mode: "T00-plan-approval" };
  assert.equal(buildHandoffReport(fixture).dependencyReview[0].approvalReady, false);
  fixture.tasks[1].approval = before.tasks[1].approval;
  const writer = structuredClone(fixture.tasks[0]);
  writer.id = "OPS-101";
  writer.taskStatus = "实施中";
  writer.writeScopes = ["src/next-task/child.js"];
  fixture.tasks.push(writer);
  syncMapGapFixture(fixture);
  assert.deepEqual(buildHandoffReport(fixture).dependencyReview[0].conflictingTaskIds, ["OPS-101"]);
  writer.writeScopes = ["src/other"];
  fixture.portfolioPolicy.maximumWip = 1;
  assert.equal(buildHandoffReport(fixture).dependencyReview[0].wipAvailable, false);
});

test("handoff reports PRs as evidence to inspect and retains closed-task capability gaps", () => {
  const fixture = handoffFixture();
  const parent = fixture.tasks[0];
  parent.taskStatus = "待集成";
  parent.pullRequestRef = "https://github.com/example/platform/pull/1";
  parent.ciRef = "";
  let report = buildHandoffReport(fixture);
  assert.equal(report.integrationReview[0].taskId, "GOV-002");
  assert.equal(report.integrationReview[0].nextAction, "verify-merge-and-ci");
  parent.taskStatus = "已关闭";
  parent.runtimeCapability = true;
  parent.observability = { applicable: true, structuredLogs: "existing-logs" };
  parent.unresolved = ["现场告警尚未验收"];
  report = buildHandoffReport(fixture);
  assert.equal(report.integrationReview.length, 0);
  assert.equal(report.capabilityFollowups[0].taskId, "GOV-002");
  assert.equal(report.capabilityFollowups[0].capabilityStatus, "已实现");
  assert.ok(report.capabilityFollowups[0].missingObservability.includes("metricsAndAlerts"));
  assert.deepEqual(report.capabilityFollowups[0].unresolved, parent.unresolved);
  fixture.tasks[1].dependencies = ["OPS-999"];
  assert.throws(() => buildHandoffReport(fixture), /unknown id/);
});

test("the lifecycle control tower validates the governed portfolio", () => {
  const report = validateLifecycleGovernance(copy());
  assert.equal(report.ok, true);
  assert.equal(report.summary.maps, 6);
  assert.equal(report.summary.goldenScenarios, 10);
  assert.equal(report.summary.gateTiers, 4);
  assert.equal(report.summary.productionDecision, "NO-GO");
  assert.equal(report.summary.productionNoGoDomains.length, 6);
});

test("map gaps are the reverse coverage of every not-fully-closed task", () => {
  const missing = copy();
  for (const map of missing.maps) map.gapTaskIds = map.gapTaskIds.filter((taskId) => taskId !== "OPS-016");
  assert.throws(() => validateLifecycleGovernance(missing), /requiring map gap coverage are unmapped: OPS-016/);

  const stale = copy();
  stale.maps[0].gapTaskIds.push("OPS-019");
  assert.throws(() => validateLifecycleGovernance(stale), /fully closed tasks retain stale map gaps: OPS-019/);

  const duplicate = copy();
  duplicate.maps[0].gapTaskIds.push(duplicate.maps[0].gapTaskIds[0]);
  assert.throws(() => validateLifecycleGovernance(duplicate), /duplicate gap task ids/);
});

test("WIP and concurrent core writers fail closed", () => {
  const duplicate = activeControlTowerFixture();
  for (let index = 0; index < 5; index += 1) {
    const task = structuredClone(duplicate.tasks[0]);
    task.id = `OPS-${String(index + 100).padStart(3, "0")}`;
    task.writeScopes = [`src/runtime-${index}`];
    duplicate.tasks.push(task);
  }
  assert.throws(() => validateLifecycleGovernance(duplicate), /WIP limit exceeded/);

  const collision = activeControlTowerFixture();
  const second = structuredClone(collision.tasks[0]);
  second.id = "ARCH-012";
  collision.tasks.push(second);
  assert.throws(() => validateLifecycleGovernance(collision), /concurrent writers/);
});

test("task dependency cycles and broken trace links fail closed", () => {
  const cyclic = activeControlTowerFixture();
  const second = structuredClone(cyclic.tasks[0]);
  second.id = "DATA-021";
  second.dependencies = ["GOV-002"];
  second.writeScopes = ["database/migrations"];
  cyclic.tasks[0].dependencies = ["DATA-021"];
  cyclic.tasks.push(second);
  assert.throws(() => validateLifecycleGovernance(cyclic), /dependency cycle/);

  const missingRequirement = activeControlTowerFixture();
  missingRequirement.tasks[0].requirementIds = ["REQ-MISSING"];
  assert.throws(() => validateLifecycleGovernance(missingRequirement), /unknown id REQ-MISSING/);
});

test("high-risk work cannot advance without approval, ADR, tests and evidence", () => {
  const noApproval = activeControlTowerFixture();
  noApproval.tasks[0].approval.state = "pending";
  assert.throws(() => validateLifecycleGovernance(noApproval), /risk-appropriate approval/);

  const proposed = activeControlTowerFixture();
  proposed.decisions[0].status = "Proposed";
  assert.throws(() => validateLifecycleGovernance(proposed), /requires an Accepted ADR/);

  const noEvidence = activeControlTowerFixture();
  noEvidence.tasks[0].evidenceIds = [];
  assert.throws(() => validateLifecycleGovernance(noEvidence), /verified without evidence/);
});

test("risk-tier approvals allow intake but fail closed before implementation", () => {
  const candidate = activeControlTowerFixture();
  candidate.tasks[0].taskStatus = "待批准";
  candidate.tasks[0].approval = { state: "pending" };
  candidate.decisions[0].status = "Proposed";
  assert.equal(validateLifecycleGovernance(candidate).ok, true);

  const lowRisk = activeControlTowerFixture();
  lowRisk.tasks[0].riskLevel = "低";
  lowRisk.tasks[0].approval.mode = "T00-plan-approval";
  assert.throws(() => validateLifecycleGovernance(lowRisk), /risk-appropriate approval/);

  lowRisk.tasks[0].approval.mode = "approved-task-package";
  assert.equal(validateLifecycleGovernance(lowRisk).ok, true);
});

test("repository evidence can never manufacture production GO", () => {
  const falseGo = copy();
  falseGo.productionAdmission[0].status = "GO";
  falseGo.productionAdmission[0].evidenceIds = ["EVD-GOV-001"];
  assert.throws(() => validateLifecycleGovernance(falseGo), /external production evidence/);

  const premature = copy();
  const task = premature.tasks.find((item) => item.id === "GOV-002");
  task.capabilityStatus = "准生产";
  task.pullRequestRef = "PR-TEST-ONLY";
  task.ciRef = "CI-TEST-ONLY";
  assert.throws(() => validateLifecycleGovernance(premature), /admission domains remain NO-GO/);
});

test("every golden scenario retains normal, failure, unauthorized and recovery paths", () => {
  const invalid = copy();
  invalid.goldenScenarios[0].pathTypes = ["正常", "失败", "恢复"];
  assert.throws(() => validateLifecycleGovernance(invalid), /must cover normal, failure, unauthorized and recovery paths/);
});

test("implemented runtime work can expose observability gaps without claiming capability completion", () => {
  const runtimeTask = activeControlTowerFixture();
  runtimeTask.tasks[0].runtimeCapability = true;
  runtimeTask.tasks[0].capabilityStatus = "已实现";
  runtimeTask.tasks[0].observability = { applicable: true, structuredLogs: "logs" };
  assert.doesNotThrow(() => validateLifecycleGovernance(runtimeTask));
  runtimeTask.tasks[0].capabilityStatus = "已验证";
  assert.throws(() => validateLifecycleGovernance(runtimeTask), /verified runtime capability lacks complete observability delivery/);
});

test("open high-risk work cannot fan out to a downstream task", () => {
  const expanded = activeControlTowerFixture();
  const downstream = structuredClone(expanded.tasks[0]);
  downstream.id = "OPS-014";
  downstream.riskLevel = "低";
  downstream.approval.mode = "approved-task-package";
  downstream.dependencies = ["GOV-002"];
  downstream.writeScopes = ["src/platform/operations/example.js"];
  expanded.tasks.push(downstream);
  assert.throws(() => validateLifecycleGovernance(expanded), /cannot expand downstream from open high-risk task/);
});

test("change impact selects risk tiers without treating documentation as runtime", () => {
  const docs = analyzeImpact(copy(), ["docs/lifecycle-governance.md"]);
  assert.deepEqual(docs.requiredTiers, ["quick"]);
  assert.deepEqual(docs.modules, ["documentation"]);
  assert.equal(docs.fullUnitFallback, false);
  assert.ok(docs.quickTests.includes("test/documentation-fact-drift.test.js"));

  const database = analyzeImpact(copy(), ["database/migrations/0018-example.js"]);
  assert.deepEqual(database.requiredTiers, ["quick", "pr", "nightly", "release"]);
  assert.deepEqual(database.modules, ["data", "migration"]);

  const controlPlane = analyzeImpact(copy(), ["config/lifecycle-governance.json"]);
  assert.deepEqual(controlPlane.requiredTiers, ["quick", "pr", "release"]);

  const unknown = analyzeImpact(copy(), ["tools/new-unclassified-file.xyz"]);
  assert.equal(unknown.fullUnitFallback, true);
  assert.deepEqual(unknown.requiredTiers, ["quick", "pr"]);
});

test("Windows full-unit fallback uses the active npm Node entry instead of spawning a batch file directly", () => {
  const invocation = npmRunInvocation("test:unit", {
    platform: "win32",
    npmExecPath: "C:/npm/npm-cli.js"
  });
  assert.equal(invocation.command, process.execPath);
  assert.deepEqual(invocation.args, ["C:/npm/npm-cli.js", "run", "test:unit"]);
  assert.equal(invocation.shell, false);

  const calls = [];
  const impact = runChangedUnitTests(copy(), ["tools/unclassified.xyz"], {
    platform: "win32",
    npmExecPath: "C:/npm/npm-cli.js",
    spawnSync(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0 };
    }
  });
  assert.equal(impact.executed, "full-unit-fallback");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, process.execPath);
  assert.deepEqual(calls[0].args, ["C:/npm/npm-cli.js", "run", "test:unit"]);
  assert.equal(calls[0].options.shell, false);

  assert.throws(() => runChangedUnitTests(copy(), ["tools/unclassified.xyz"], {
    platform: "win32",
    npmExecPath: "",
    spawnSync() {
      return { status: null, error: { code: "EINVAL", message: "private process detail" } };
    }
  }), /unclassified change full unit fallback failed: EINVAL/);
});
