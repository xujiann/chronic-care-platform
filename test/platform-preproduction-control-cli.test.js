"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  parseArgs,
  run
} = require("../scripts/platform-preproduction-control");
const {
  createPreproductionEvidence,
  createRehearsalSession
} = require("./support/preproduction-six-iteration-fixtures");

function withJsonFixture(value, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "platform-preproduction-"));
  const file = path.join(directory, "input.json");
  fs.writeFileSync(file, JSON.stringify(value));
  try {
    return callback(file);
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
}

test("CLI parses commands without performing any deployment", () => {
  assert.deepEqual(parseArgs([
    "environment",
    "--input=evidence.json",
    "--require-ready"
  ]), {
    command: "environment",
    options: {
      input: "evidence.json",
      "require-ready": true
    }
  });
});

test("environment and rehearsal commands return bounded metadata reports", () => {
  withJsonFixture(createPreproductionEvidence(), (file) => {
    const result = run({
      command: "environment",
      options: { input: file, "require-ready": true }
    }, { now: "2026-08-04T10:00:00.000Z" });
    assert.equal(result.exitCode, 0);
    assert.equal(result.report.decision, "LOCAL-READY");
    assert.equal(result.report.productionReady, false);
  });
  withJsonFixture(createRehearsalSession(), (file) => {
    const result = run({
      command: "rehearsal",
      options: { input: file, "ledger-payload": true }
    }, { now: "2026-08-04T10:00:00.000Z" });
    assert.equal(result.exitCode, 0);
    assert.equal(result.report.schemaVersion, "pilot-cutover-rehearsal-v1");
    assert.match(result.report.sessionEvidenceFingerprint, /^sha256:[a-f0-9]{64}$/);
  });
});
