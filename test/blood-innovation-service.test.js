const test = require("node:test");
const assert = require("node:assert/strict");
const service = require("../blood-innovation-service");

const center = { id: "center-1", role: "commission", orgCode: "BLOOD-DL", name: "血液中心" };
const hospital = { id: "hospital-1", role: "institution", orgCode: "MR1", name: "输血科" };
function data() { return { bloodUnits: [{ id: "u1", donationCode: "D1", bloodType: "O Rh+", component: "悬浮红细胞", status: "qualified", institutionCode: "BLOOD-DL", testReportSigned: true, dualReview: false }], transfusionRequests: [{ id: "r1", bloodType: "O Rh+", status: "pending", institutionCode: "MR1" }], bloodAuditEvents: [{ id: "a1", entityId: "u1", action: "collected", at: "2026-07-17T01:00:00Z" }], bloodShipments: [], bloodSafetyIncidents: [], compatibilityTests: [], transfusionEpisodes: [], transfusionReactions: [], bloodRecalls: [], emergencyBloodAllocations: [] }; }

test("catalog implements all 13 capabilities", () => {
  assert.equal(service.capabilities.length, 13);
  assert.equal(new Set(service.capabilities.map((x) => x.id)).size, 13);
  assert.ok(service.capabilities.every((x) => x.status === "implemented"));
});

test("dashboard scopes BIS and BTIS while preserving shared capabilities", () => {
  const db = data();
  const centerDash = service.dashboard(db, center);
  const hospitalDash = service.dashboard(db, hospital);
  assert.equal(centerDash.summary.implemented, 11);
  assert.equal(hospitalDash.summary.implemented, 11);
  assert.ok(!centerDash.capabilities.some((x) => x.id === "pda-bedside"));
  assert.ok(!hospitalDash.capabilities.some((x) => x.id === "donor-recruitment"));
  assert.equal(centerDash.digitalTwin.unit.id, "u1");
});

test("forecast and recruitment create executable evidence", () => {
  const db = data();
  const run = service.execute(db, center, "supply-forecast", { horizonDays: 7 });
  assert.equal(run.status, 200);
  assert.equal(run.body.result.rows[0].horizonDays, 7);
  const campaign = service.execute(db, center, "donor-recruitment", {});
  assert.equal(campaign.status, 200);
  assert.equal(db.bloodRecruitmentCampaigns.length, 1);
  assert.equal(db.bloodInnovationEvents.length, 2);
});

test("rational use blocks unsupported requests and persists decision", () => {
  const db = data();
  const result = service.execute(db, hospital, "rational-use", { component: "悬浮红细胞", hemoglobin: 112, amount: 6, consentSigned: false, urgency: "常规" });
  assert.equal(result.status, 200);
  assert.equal(result.body.result.decision, "review_required");
  assert.ok(result.body.result.flags.length >= 3);
  assert.equal(db.bloodClinicalDecisions.length, 1);
});

test("PDA bedside requires all four codes", () => {
  const db = data();
  const blocked = service.execute(db, hospital, "pda-bedside", { patientCode: "P1", bloodUnitCode: "D1" });
  assert.equal(blocked.body.result.status, "blocked");
  const verified = service.execute(db, hospital, "pda-bedside", { patientCode: "P1", requestId: "R1", bloodUnitCode: "D1", operatorId: "N1" });
  assert.equal(verified.body.result.status, "verified");
});

test("compliance scan reports evidence gaps", () => {
  const db = data();
  const scan = service.execute(db, center, "compliance-check", {});
  assert.equal(scan.status, 200);
  assert.equal(scan.body.result.total, 7);
  assert.equal(scan.body.result.ok, true);
  db.bloodUnits[0].status = "released";
  assert.equal(service.compliance(db).ok, false);
});

test("role boundary prevents cross-side execution", () => {
  assert.equal(service.execute(data(), hospital, "donor-recruitment", {}).status, 403);
  assert.equal(service.execute(data(), center, "rational-use", {}).status, 403);
});
