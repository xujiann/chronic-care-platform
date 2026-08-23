"use strict";
const { readRuntimeSource } = require("../src/http/runtime-source");

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const OperatingModel = require("../insurance-payment-operating-model");
const DiseasePayment = require("../disease-payment-service");
const DiseasePaymentIntake = require("../disease-payment-intake");
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
  assert.equal(OperatingModel.authorizeAction("refund.request", { role: "institution", organizationType: "medical_institution" }).allowed, true);
  assert.equal(OperatingModel.authorizeAction("refund.request", { role: "institution", organizationType: "hospital_finance" }).allowed, false);
  assert.equal(OperatingModel.authorizeAction("refund.resubmit", { role: "institution", organizationType: "medical_institution" }).allowed, true);
  assert.equal(OperatingModel.authorizeAction("refund.resubmit", { role: "finance", organizationType: "hospital_finance" }).allowed, false);
  assert.equal(OperatingModel.authorizeAction("formal-grouping.receipt", { role: "system", organizationType: "official_grouper_adapter" }).allowed, true);
  assert.equal(OperatingModel.authorizeAction("formal-grouping.receipt", { role: "insurance", organizationType: "insurance_center" }).allowed, false);
  assert.equal(OperatingModel.authorizeAction("formal-grouping.reconcile", { role: "insurance", organizationType: "insurance_center" }).allowed, true);
  assert.equal(OperatingModel.authorizeAction("formal-grouping.reconcile", { role: "commission", organizationType: "platform" }).allowed, false);
});

test("T00 handoff confirms public and trusted callback wiring without claiming production readiness", () => {
  const serverSource = readRuntimeSource(ROOT);
  const handoff = OperatingModel.buildT00IntegrationHandoff(serverSource);
  assert.equal(handoff.readyForIntegration, true);
  assert.equal(handoff.pending, 0);
  assert.ok(handoff.routes.some((item) => item.id === "refund-callback-hook" && item.wired));
  assert.ok(handoff.routes.some((item) => item.id === "refund-resubmit" && item.wired));
  assert.ok(handoff.routes.some((item) => item.id === "annual-clearance-create" && item.wired));
  const formalReceipt = handoff.routes.find((item) => item.id === "formal-grouping-receipt");
  assert.equal(formalReceipt.wired, true);
  assert.deepEqual(formalReceipt.roles, ["system"]);
  assert.deepEqual(formalReceipt.organizations, ["official_grouper_adapter"]);
  assert.ok(formalReceipt.integrationMarkers.includes("verifyTrustedGrouperCallback"));
  const domainHandlers = { ...DiseasePayment, ...DiseasePaymentIntake, ...FinancialGateway };
  assert.ok(handoff.routes.every((item) => (item.handlers || [item.handler]).every((handler) => typeof domainHandlers[handler] === "function")));
});
