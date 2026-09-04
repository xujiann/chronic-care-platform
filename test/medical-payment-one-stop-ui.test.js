"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("medical payment one-stop page is registered and uses trusted DOM rendering", () => {
  const html = read("medical-payment.html");
  const client = read("medical-payment.js");
  const policy = require("../access-control-policy");
  const publication = require("../config/static-publication.json");

  assert.match(html, /医疗付费一件事/);
  assert.match(html, /page-auth-bootstrap\.js/);
  assert.match(html, /data-roles="commission,institution,insurance"/);
  assert.match(html, /name="institutionCode" required/);
  assert.match(client, /\/api\/medical-payments\/center/);
  assert.match(client, /\/api\/financial-gateways\/dispatch/);
  assert.match(client, /\/api\/online-payments\/refunds/);
  assert.match(client, /\/api\/financial-gateways\/reconciliation-runs/);
  assert.match(client, /scope\.role === "insurance" \? "INSURANCE" : values\.gatewayType/);
  assert.doesNotMatch(client, /innerHTML|insertAdjacentHTML|document\.write|\.style\b|window\.prompt|\beval\s*\(/);
  assert.match(client, /createElement/);
  assert.match(client, /textContent/);
  assert.equal(policy.pageCatalog["medical-payment.html"].group, "医保支付");
  assert.equal(policy.pageCatalog["medical-payment.html"].parent, "insurance.html");
  assert.equal(publication.entrypoints.includes("medical-payment.html"), true);
});

test("medical payment capabilities carry repository and procurement trace evidence", () => {
  const registry = require("../config/platform-capability-registry.json");
  const trace = require("../config/procurement-requirement-trace-catalog.json");
  for (const id of ["E-CIT-ORDER", "E-CIT-PAY", "E-CIT-REFUND"]) {
    const capability = registry.capabilities.find((item) => item.id === id);
    const mapping = trace.capabilities.find((item) => item.capabilityId === id);
    assert.equal(capability.coverage, "repository-verified");
    assert.equal(capability.evidence.length >= 4, true);
    assert.equal(capability.evidence.every((relative) => fs.existsSync(path.join(ROOT, relative))), true);
    assert.deepEqual(mapping.pages, ["medical-payment.html"]);
    assert.equal(mapping.interfaces.includes("GET /api/medical-payments/center"), true);
    assert.equal(mapping.tests.includes("test/medical-payment-one-stop-ui.test.js"), true);
  }
});
