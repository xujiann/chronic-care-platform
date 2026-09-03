"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { matches } = require("../domain-task-ui");
const maternal = require("../maternal-child");
const referral = require("../referral-teleconsultation");
const drug = require("../drug-consumable");
const research = require("../research-sandbox");
const casesUi = require("../public-health-supervision-cases");
const { STATUSES, SupervisionCaseError, createCase, executeCaseAction, listCases } = require("../src/public-health/health-supervision/case-service");
const { createRouteSegment } = require("../src/http/routes/public-health/health-supervision-cases");

const ROOT = path.resolve(__dirname, "..");
const commission = { username: "supervision-manager", role: "commission", jurisdictionCode: "DEMO" };
const institution = { username: "institution-operator", role: "institution", orgCode: "ORG-DEMO-01" };

test("five domain workbench pages load auth, platform shell, safe task UI, and page controller", () => {
  const pages = [
    ["maternal-child.html", "maternal-child.js"],
    ["referral-teleconsultation.html", "referral-teleconsultation.js"],
    ["drug-consumable.html", "drug-consumable.js"],
    ["research-sandbox.html", "research-sandbox.js"],
    ["public-health-supervision-cases.html", "public-health-supervision-cases.js"]
  ];
  for (const [page, controller] of pages) {
    const html = fs.readFileSync(path.join(ROOT, page), "utf8");
    assert.match(html, /access-control-policy\.js/);
    assert.match(html, /page-auth-bootstrap\.js/);
    assert.match(html, /platform-shell\.js/);
    assert.match(html, /domain-task-ui\.js/);
    assert.match(html, new RegExp(controller.replace(".", "\\.")));
  }
  assert.match(fs.readFileSync(path.join(ROOT, "public-health-supervision-cases.html"), "utf8"), /supervision-case-create-form/);
  const sources = ["domain-task-ui.js", ...pages.map(([, controller]) => controller)].map((file) => fs.readFileSync(path.join(ROOT, file), "utf8")).join("\n");
  assert.doesNotMatch(sources, /\.innerHTML\s*=|insertAdjacentHTML|window\.prompt|\.style\s*=/);
});

test("domain normalizers publish identifiers, status, detail, and next action", () => {
  const samples = [
    maternal.normalize({ id: "birth-1", newbornName: "演示新生儿", status: "待签发", maternalChildSync: "待入册" }),
    referral.normalize({ id: "ref-1", status: "pending", sourceInstitution: "基层医疗机构", targetInstitution: "示范医院" }),
    drug.normalize({ id: "drug-1", status: "in-review", institution: "示范医院" }),
    research.normalize({ id: "research-1", name: "示范专病数据集", status: "requested" }),
    casesUi.normalize({ id: "case-1", status: "立案", subjectCode: "SUBJECT-01" })
  ];
  for (const row of samples) {
    assert.ok(row.id);
    assert.ok(row.status);
    assert.ok(row.nextAction);
    assert.ok(Array.isArray(row.details));
  }
  assert.equal(matches(samples[1], "pending", "示范医院"), true);
  assert.equal(matches(samples[1], "closed", "示范医院"), false);
});

test("supervision case service enforces the closed transition set and idempotent replay", () => {
  let result = createCase({}, {
    subjectCode: "SUBJECT-01", subjectOrganizationCode: "ORG-DEMO-01", jurisdictionCode: "DEMO",
    inspectionTaskId: "TASK-01", cause: "监督检查发现需要立案处理的问题", priority: "重点"
  }, commission, { idempotencyKey: "create-case-1", randomUUID: () => "fixed", now: "2026-09-03T01:00:00.000Z" });
  let state = result.state;
  assert.equal(result.caseRecord.status, "立案");
  const replayCreate = createCase(state, {
    subjectCode: "SUBJECT-01", subjectOrganizationCode: "ORG-DEMO-01", jurisdictionCode: "DEMO",
    inspectionTaskId: "TASK-01", cause: "监督检查发现需要立案处理的问题", priority: "重点"
  }, commission, { idempotencyKey: "create-case-1", randomUUID: () => "other", now: "2026-09-03T01:01:00.000Z" });
  assert.equal(replayCreate.replayed, true);
  assert.equal(replayCreate.state.publicHealthSupervisionCases.length, 1);

  const payload = { toStatus: "调查取证", expectedVersion: 0, evidenceRefs: ["evidence:case:1"], note: "登记现场证据" };
  result = executeCaseAction(state, "scase-fixed", payload, commission, { idempotencyKey: "case-step-1", now: "2026-09-03T02:00:00.000Z" });
  state = result.state;
  assert.equal(result.caseRecord.status, "调查取证");
  assert.equal(result.caseRecord.version, 1);
  const replay = executeCaseAction(state, "scase-fixed", payload, commission, { idempotencyKey: "case-step-1" });
  assert.equal(replay.replayed, true);
  assert.equal(replay.caseRecord.version, 1);
  assert.throws(() => executeCaseAction(state, "scase-fixed", { toStatus: "处罚", expectedVersion: 1 }, commission), (error) => error instanceof SupervisionCaseError && error.code === "SUPERVISION_CASE_TRANSITION_DENIED");
  assert.deepEqual(STATUSES, ["立案", "调查取证", "审核", "处罚", "整改", "复查", "结案"]);
});

test("institution scope is restricted and institution can only submit remediation step", () => {
  let state = createCase({}, { subjectCode: "SUBJECT-01", subjectOrganizationCode: "ORG-DEMO-01", cause: "示范案件", priority: "普通" }, commission, { randomUUID: () => "scope" }).state;
  assert.equal(listCases(state, institution).length, 1);
  assert.equal(listCases(state, { ...institution, orgCode: "ORG-OTHER" }).length, 0);
  for (const [index, toStatus] of ["调查取证", "审核", "处罚"].entries()) {
    const input = { toStatus, expectedVersion: index, evidenceRefs: index === 0 ? ["evidence:investigation"] : undefined, penaltyDecision: toStatus === "处罚" ? "处罚决定" : undefined };
    Object.keys(input).forEach((key) => input[key] === undefined && delete input[key]);
    state = executeCaseAction(state, "scase-scope", input, commission).state;
  }
  const remediated = executeCaseAction(state, "scase-scope", { toStatus: "整改", expectedVersion: 3, evidenceRefs: ["evidence:remediation"] }, institution);
  assert.equal(remediated.caseRecord.status, "整改");
  assert.throws(() => executeCaseAction(remediated.state, "scase-scope", { toStatus: "复查", expectedVersion: 4, reinspectionDecision: "通过" }, institution), (error) => error.code === "SUPERVISION_CASE_ROLE_DENIED");
});

test("supervision case route persists successful commands and returns explicit replay", async () => {
  let state = {};
  const response = { status: 0, body: null };
  const runtime = {
    requireApiRole: (req) => req.user,
    collectJson: async (req) => req.body,
    readDatabase: () => structuredClone(state),
    writeDatabase: (next) => { state = structuredClone(next); },
    sendJson: (_res, status, body) => { response.status = status; response.body = body; },
    randomUUID: () => "route"
  };
  const route = createRouteSegment(runtime);
  const body = { subjectCode: "SUBJECT-ROUTE", subjectOrganizationCode: "ORG-DEMO-01", cause: "路由测试案件", priority: "普通" };
  const request = { method: "POST", headers: { "idempotency-key": "route-create" }, body, user: commission };
  assert.equal(await route.handle(request, {}, new URL("http://localhost/api/public-health/supervision/cases")), true);
  assert.equal(response.status, 201);
  assert.equal(response.body.case.id, "scase-route");
  assert.equal(await route.handle(request, {}, new URL("http://localhost/api/public-health/supervision/cases")), true);
  assert.equal(response.status, 200);
  assert.equal(response.body.idempotentReplay, true);
  const getRequest = { method: "GET", headers: {}, user: institution };
  await route.handle(getRequest, {}, new URL("http://localhost/api/public-health/supervision/cases"));
  assert.equal(response.status, 200);
  assert.equal(response.body.cases.length, 1);
});
