"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const config = require("../config/lifecycle-governance.json");
const { analyzeImpact, validateLifecycleGovernance } = require("../scripts/lifecycle-governance");

function copy() {
  return structuredClone(config);
}

test("the lifecycle control tower validates the governed portfolio", () => {
  const report = validateLifecycleGovernance(copy());
  assert.equal(report.ok, true);
  assert.equal(report.summary.maps, 6);
  assert.equal(report.summary.goldenScenarios, 10);
  assert.equal(report.summary.gateTiers, 4);
  assert.equal(report.summary.productionDecision, "NO-GO");
  assert.equal(report.summary.productionNoGoDomains.length, 6);
});

test("WIP and concurrent core writers fail closed", () => {
  const duplicate = copy();
  for (let index = 0; index < 5; index += 1) {
    const task = structuredClone(duplicate.tasks[0]);
    task.id = `OPS-${String(index + 100).padStart(3, "0")}`;
    task.writeScopes = [`src/runtime-${index}`];
    duplicate.tasks.push(task);
  }
  assert.throws(() => validateLifecycleGovernance(duplicate), /WIP limit exceeded/);

  const collision = copy();
  const second = structuredClone(collision.tasks[0]);
  second.id = "ARCH-012";
  collision.tasks.push(second);
  assert.throws(() => validateLifecycleGovernance(collision), /concurrent writers/);
});

test("task dependency cycles and broken trace links fail closed", () => {
  const cyclic = copy();
  const second = structuredClone(cyclic.tasks[0]);
  second.id = "DATA-021";
  second.dependencies = ["GOV-002"];
  second.writeScopes = ["database/migrations"];
  cyclic.tasks[0].dependencies = ["DATA-021"];
  cyclic.tasks.push(second);
  assert.throws(() => validateLifecycleGovernance(cyclic), /dependency cycle/);

  const missingRequirement = copy();
  missingRequirement.tasks[0].requirementIds = ["REQ-MISSING"];
  assert.throws(() => validateLifecycleGovernance(missingRequirement), /unknown id REQ-MISSING/);
});

test("high-risk work cannot advance without approval, ADR, tests and evidence", () => {
  const noApproval = copy();
  noApproval.tasks[0].approval.state = "pending";
  assert.throws(() => validateLifecycleGovernance(noApproval), /risk-appropriate approval/);

  const proposed = copy();
  proposed.decisions[0].status = "Proposed";
  assert.throws(() => validateLifecycleGovernance(proposed), /requires an Accepted ADR/);

  const noEvidence = copy();
  noEvidence.tasks[0].evidenceIds = [];
  assert.throws(() => validateLifecycleGovernance(noEvidence), /verified without evidence/);
});

test("risk-tier approvals allow intake but fail closed before implementation", () => {
  const candidate = copy();
  candidate.tasks[0].taskStatus = "待批准";
  candidate.tasks[0].approval = { state: "pending" };
  candidate.decisions[0].status = "Proposed";
  assert.equal(validateLifecycleGovernance(candidate).ok, true);

  const lowRisk = copy();
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
  premature.tasks[0].capabilityStatus = "准生产";
  premature.tasks[0].pullRequestRef = "PR-TEST-ONLY";
  premature.tasks[0].ciRef = "CI-TEST-ONLY";
  assert.throws(() => validateLifecycleGovernance(premature), /admission domains remain NO-GO/);
});

test("every golden scenario retains normal, failure, unauthorized and recovery paths", () => {
  const invalid = copy();
  invalid.goldenScenarios[0].pathTypes = ["正常", "失败", "恢复"];
  assert.throws(() => validateLifecycleGovernance(invalid), /must cover normal, failure, unauthorized and recovery paths/);
});

test("runtime capability completion requires the full observability delivery", () => {
  const runtimeTask = copy();
  runtimeTask.tasks[0].runtimeCapability = true;
  runtimeTask.tasks[0].observability = { applicable: true, structuredLogs: "logs" };
  assert.throws(() => validateLifecycleGovernance(runtimeTask), /lacks complete observability delivery/);
});

test("open high-risk work cannot fan out to a downstream task", () => {
  const expanded = copy();
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
