"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildSpecialtyCutoverPack } = require("../emergency-specialty-cutover");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("T00 exposes the T10 specialty cutover pack through public integration contracts", () => {
  const server = read("server.js");
  const client = read("t10-specialty-cutover.js");
  const workbench = read("workbench.html");
  const readme = read("README.md");
  const releaseReport = read("scripts/release-report.js");
  const pkg = JSON.parse(read("package.json"));

  assert.match(server, /buildSpecialtyCutoverPack/);
  assert.match(server, /url\.pathname === "\/api\/t10-specialty\/cutover-pack"/);
  assert.match(server, /url\.pathname === "\/api\/t10-specialty-cutover"/);
  assert.match(server, /requireApiRole\(req, res, \["commission"\], url\.pathname\)/);
  assert.match(server, /t10-specialty-cutover-read/);
  assert.match(client, /HealthCityAuth\?\.authFetch/);
  assert.match(client, /HealthCityAuth\?\.authFetch \|\| fetch/);
  assert.match(client, /\/api\/t10-specialty\/cutover-pack/);
  assert.match(client, /release\/t10-specialty-cutover-pack\.json/);
  assert.match(client, /source === "server-api"/);
  assert.match(client, /withCutoverDefaults/);
  assert.match(readme, /t10-specialty-cutover\.html/);
  assert.match(readme, /GET \/api\/t10-specialty\/cutover-pack/);
  assert.match(workbench, /t10-specialty-cutover\.html/);
  assert.match(workbench, /T10割接总控/);
  assert.equal(pkg.scripts["t10:specialty-cutover"], "node emergency-specialty-cutover.js");
  assert.match(releaseReport, /specialtyCutoverChecks/);
  assert.match(releaseReport, /specialtyCutover:rehearsalPlan/);
  assert.match(releaseReport, /specialtyCutover:goNoGoDecision/);
  assert.match(releaseReport, /t10-specialty-cutover-pack\.json/);
  assert.match(releaseReport, /t10-specialty-cutover-pack\.md/);
});

test("T10 public projection keeps all real production gates closed with rehearsal and go/no-go controls", () => {
  const pack = buildSpecialtyCutoverPack({ generatedAt: "2026-07-23T00:00:00.000Z" });

  assert.equal(pack.summary.tracks, 4);
  assert.equal(pack.summary.codeReady, 4);
  assert.equal(pack.summary.productionReady, 0);
  assert.equal(pack.summary.formalGoLiveState, "blocked-until-site-evidence-signed");
  assert.ok(pack.summary.siteBlockers > 0);
  assert.ok(pack.tracks.every((track) => track.productionReady === false && track.blockers.length > 0));
  assert.deepEqual(pack.stages, [
    "code-readiness",
    "synthetic-acceptance",
    "joint-test",
    "site-evidence",
    "go-no-go",
    "grey-release"
  ]);
  assert.equal(pack.rehearsalPlan.scope.primaryTrackId, "emergency-life-chain");
  assert.equal(pack.rehearsalPlan.timeline.length, 3);
  assert.equal(pack.goNoGoDecision.currentDecision, "no-go-site-evidence-pending");
  assert.equal(pack.goNoGoDecision.score, 20);
  assert.equal(pack.goNoGoDecision.threshold, 100);
  assert.ok(pack.goNoGoDecision.hardStops.some((item) => item.id === "patient-safety"));
});
