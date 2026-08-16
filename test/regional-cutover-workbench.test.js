"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { buildRegionalCutoverWorkbench } = require("../src/platform/regional/regional-cutover-workbench");

test("regional cutover workbench aggregates every site without sensitive control material", () => {
  const report = buildRegionalCutoverWorkbench({ env: {}, receipts: [], now: "2026-08-16T03:00:00.000Z" });
  assert.equal(report.ok, true);
  assert.equal(report.summary.regions, 2);
  assert.equal(report.summary.technicalReady, 2);
  assert.equal(report.summary.candidateReady, 0);
  assert.equal(report.productionReady, false);
  assert.equal(report.containsEndpoints, false);
  assert.equal(report.containsEvidenceBodies, false);
  assert.equal(report.containsActorIdentities, false);
  assert.doesNotMatch(JSON.stringify(report), /https:\/\/|"signature"|"privateKey"|"custodianRole"/);
});

test("platform page loads the independent regional workbench module", () => {
  const root = path.resolve(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "platform.html"), "utf8");
  const source = fs.readFileSync(path.join(root, "regional-cutover-workbench-ui.js"), "utf8");
  assert.match(html, /id="regional-cutover-workbench-panel"/);
  assert.match(html, /regional-cutover-workbench-ui\.js/);
  assert.match(source, /\/regional\/cutover-workbench/);
  assert.doesNotMatch(source, /innerHTML\s*=\s*[^;]*error\.message/);
});
