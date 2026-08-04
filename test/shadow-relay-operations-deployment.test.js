"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("shadow relay deployment schedules hardened relay and reconciliation processes", () => {
  const environment = read("deploy/platform-production-adapters.env.template");
  const relay = read("deploy/platform-shadow-relay@.service.template");
  const reconcile = read("deploy/platform-shadow-reconcile@.service.template");
  const timer = read("deploy/platform-shadow-reconcile@.timer.template");

  assert.match(environment, /^PLATFORM_SHADOW_RELAY_ENABLED=false$/m);
  assert.match(environment, /^PLATFORM_SHADOW_CHECKPOINT_FILE=$/m);
  assert.match(environment, /^PLATFORM_SHADOW_OPERATIONS_FILE=$/m);
  assert.match(environment, /^PLATFORM_SHADOW_RECONCILIATION_MAX_AGE_MINUTES=60$/m);
  for (const service of [relay, reconcile]) {
    assert.match(service, /^User=health-platform$/m);
    assert.match(service, /^UMask=0077$/m);
    assert.match(service, /^NoNewPrivileges=true$/m);
    assert.match(service, /^ProtectSystem=strict$/m);
    assert.match(service, /^ReadWritePaths=__DATA_DIR__$/m);
  }
  assert.match(reconcile, /--domain=%i --reconcile --verify-schema/);
  assert.match(timer, /^Persistent=true$/m);
  assert.match(timer, /^Unit=platform-shadow-reconcile@%i\.service$/m);
});

test("cutover template binds reconciliation evidence to the generated control-plane fingerprint", () => {
  const template = JSON.parse(read(
    "docs/evidence-templates/platform-iterations/pilot-cutover.template.json"
  ));
  assert.equal(template.reports.reconciliation.schema, "shadow-relay-control-plane-v1");
  assert.match(
    template.reports.reconciliation.technicalEvidenceFingerprint,
    /must-equal-evidenceDigests\.reconciliation/
  );
  assert.equal(template.reports.reconciliation.chainValid, false);
  assert.equal(template.reports.reconciliation.externalEvidenceVerified, false);
  assert.equal(template.reports.reconciliation.productionReady, false);
});
