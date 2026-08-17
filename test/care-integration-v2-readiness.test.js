"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildCareIntegrationV2Readiness, main, parseArgs } = require("../scripts/care-integration-v2-readiness");

test("care integration v2 readiness and CLI remain fail-closed without execution evidence", () => {
  const report = buildCareIntegrationV2Readiness({}, { now: "2026-08-17T15:00:00.000Z" });
  assert.equal(report.ok, false);
  assert.equal(report.localTechnicalReady, false);
  assert.equal(report.productionGate, "NO-GO");
  assert.equal(report.productionReady, false);
  assert.equal(report.externalEvidenceVerified, false);
  assert.equal(report.sections.adapters.summary.requiredSystems, 6);
  assert.equal(report.sections.continuousCare.summary.closedLoops, 0);

  let output = "";
  const cli = main([], {
    now: "2026-08-17T15:00:00.000Z",
    write(value) { output += value; }
  });
  assert.deepEqual(JSON.parse(output), cli);
  assert.equal(cli.productionReady, false);
  assert.deepEqual(parseArgs(["--input", "state.json"]), { input: "state.json" });
  assert.throws(() => parseArgs(["--unknown"]), /unknown argument/);
});
