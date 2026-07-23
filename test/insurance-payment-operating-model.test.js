"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const OperatingModel = require("../insurance-payment-operating-model");
const DiseasePayment = require("../disease-payment-service");
const FinancialGateway = require("../financial-gateways");

const ROOT = path.resolve(__dirname, "..");

test("insurance and hospital responsibilities cover every payment workflow", () => {
  const validation = OperatingModel.validateOperatingModel();
  assert.equal(validation.ok, true);
  assert.equal(validation.responsibilityCapabilities, 7);
  assert.ok(OperatingModel.RESPONSIBILITY_MATRIX.every((item) => item.accountable && item.responsible.length && item.evidence.length));
});

test("responsibility authorization requires both role and organization boundary", () => {
  assert.equal(OperatingModel.authorizeAction("special-case.apply", { role: "institution", organizationType: "medical_institution" }).allowed, true);
  assert.equal(OperatingModel.authorizeAction("special-case.apply", { role: "insurance", organizationType: "insurance_center" }).allowed, false);
  assert.equal(OperatingModel.authorizeAction("settlement.core-callback", { role: "system", organizationType: "insurance_core_adapter" }).allowed, true);
  assert.equal(OperatingModel.authorizeAction("settlement.core-callback", { role: "insurance", organizationType: "insurance_center" }).allowed, false);
});

test("T00 handoff lists public and trusted callback wiring without claiming it is complete", () => {
  const serverSource = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const handoff = OperatingModel.buildT00IntegrationHandoff(serverSource);
  assert.equal(handoff.readyForIntegration, true);
  assert.ok(handoff.pending > 0);
  assert.ok(handoff.routes.some((item) => item.id === "refund-callback-hook" && !item.wired));
  assert.ok(handoff.routes.some((item) => item.id === "annual-clearance-create" && !item.wired));
  const domainHandlers = { ...DiseasePayment, ...FinancialGateway };
  assert.ok(handoff.routes.every((item) => (item.handlers || [item.handler]).every((handler) => typeof domainHandlers[handler] === "function")));
});
