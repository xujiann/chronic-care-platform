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
  const readme = read("README.md");
  const releaseReport = read("scripts/release-report.js");
  const pkg = JSON.parse(read("package.json"));

  assert.match(server, /buildSpecialtyCutoverPack/);
  assert.match(server, /GET" && url\.pathname === "\/api\/t10-specialty-cutover"/);
  assert.match(server, /requireApiRole\(req, res, \["commission"\], url\.pathname\)/);
  assert.match(server, /t10-specialty-cutover-read/);
  assert.match(client, /HealthCityAuth\?\.authFetch/);
  assert.match(client, /\/api\/t10-specialty-cutover/);
  assert.match(client, /release\/t10-specialty-cutover-pack\.json/);
  assert.match(readme, /t10-specialty-cutover\.html/);
  assert.match(readme, /GET \/api\/t10-specialty-cutover/);
  assert.equal(pkg.scripts["t10:specialty-cutover"], "node emergency-specialty-cutover.js");
  assert.match(releaseReport, /specialtyCutoverChecks/);
  assert.match(releaseReport, /t10-specialty-cutover-pack\.json/);
  assert.match(releaseReport, /t10-specialty-cutover-pack\.md/);
});

test("T10 public projection keeps all real production gates closed", () => {
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
});
