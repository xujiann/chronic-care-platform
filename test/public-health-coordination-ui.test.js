const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "public-health.html"), "utf8");
const source = fs.readFileSync(path.join(ROOT, "public-health.js"), "utf8");

test("public health page exposes the eight-domain coordination center", () => {
  assert.match(html, /id="public-health-coordination-center"/);
  assert.match(html, /八领域协同中心/);
  assert.match(source, /renderPublicHealthCoordinationCenter\(system\.coordinationCenter \|\| \{\}\)/);
  assert.match(source, /function renderPublicHealthCoordinationCenter/);
  assert.match(source, /function buildStaticCoordinationCenter/);
});

test("coordination UI exposes the complete versioned action contract", () => {
  [
    "assign-coordination",
    "start-coordination",
    "record-coordination-receipt",
    "retry-coordination",
    "close-coordination",
    "reopen-coordination"
  ].forEach((action) => assert.ok(source.includes(action), `${action} should be available to the coordination UI`));

  assert.match(source, /function handlePublicHealthCoordinationAction/);
  assert.match(source, /\/api\/public-health\/coordination\/\$\{encodeURIComponent\(handoff\.id\)\}\/actions/);
  assert.match(source, /expectedVersion: version/);
  assert.match(source, /idempotencyKey: `\$\{handoff\.id\}:\$\{action\}:v\$\{version\}`/);
  assert.match(source, /receiptStatus === "rejected"/);
  assert.match(source, /evidenceRefs: handoff\.requiredEvidence \|\| lane\.requiredEvidence/);
});

test("static fallback contains every coordination lane and preserves launch boundary", () => {
  [
    "infectious-reporting",
    "immunization",
    "maternal-child",
    "senior-health",
    "chronic-management",
    "public-health-followup",
    "health-education",
    "family-doctor"
  ].forEach((laneId) => assert.ok(source.includes(`id: "${laneId}"`), `${laneId} should exist in static fallback`));

  assert.match(source, /functionalState: "eight-lane-static-coordination-runnable"/);
  assert.match(source, /formalGoLiveState: "blocked-until-external-receipts-and-site-evidence-verified"/);
  assert.match(source, /productionReady: false/);
});
