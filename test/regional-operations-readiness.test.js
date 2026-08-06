"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildReadiness,
  renderMarkdown
} = require("../scripts/regional-operations-readiness");

test("regional operations readiness proves local wiring without claiming site acceptance", () => {
  const report = buildReadiness({
    env: {},
    receipts: [],
    now: "2026-08-06T12:00:00.000Z"
  });
  assert.equal(report.ok, true);
  assert.equal(report.productionReady, false);
  assert.equal(report.fleet.summary.sites, 2);
  assert.equal(report.fleet.containsBusinessData, false);
  assert.equal(report.externalBlockers.length, 4);
  assert.ok(report.checks.every((item) => item.passed));
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Production ready: no/);
  assert.match(markdown, /210200/);
  assert.match(markdown, /990001/);
  assert.doesNotMatch(markdown, /https:\/\//);
});
