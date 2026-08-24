"use strict";

const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const INTEGRATION_SECRET = "insurance-public-api-integration-secret-32-characters";

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function commandSignature(pathname, id, action, payload) {
  return createHmac("sha256", INTEGRATION_SECRET)
    .update(stableStringify({
      action: `formal-grouping.${action}`,
      target: `${pathname}:${id}`,
      payload
    }))
    .digest("hex");
}

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  return { response, body: await response.json() };
}

async function login(baseUrl, username) {
  return request(baseUrl, "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "123456" })
  });
}

function authenticated(token, body, extraHeaders = {}) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    ...(body ? { "Idempotency-Key": body.idempotencyKey || `idem-${Date.now()}` } : {}),
    ...extraHeaders
  };
}

async function waitForServer(baseUrl) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error("server start timeout");
}

test("T07 public routes enforce trusted actors organization scope and production blockers", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "insurance-payment-public-api-"));
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  fixture.integrationGatewayEvents = [{
    id: "igw-t07-original-payment",
    adapterType: "financial",
    gatewayType: "PAYMENT",
    operation: "create-payment",
    externalId: "ORDER-T07-001",
    adapterReceipt: { receiptId: "PAY-T07-001", status: "succeeded" },
    requestPayload: { payload: { orderNo: "ORDER-T07-001", amountFen: 10000, currency: "CNY" } },
    providerStatus: "succeeded",
    reconciliationStatus: "provider-final",
    businessDate: "2026-07-27",
    callbackEvents: []
  }, ...(fixture.integrationGatewayEvents || [])];
  fs.writeFileSync(path.join(dataDir, "db.json"), JSON.stringify(fixture, null, 2));

  const port = 20500 + Math.floor(Math.random() * 800);
  const server = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      INTEGRATION_GATEWAY_SECRET: INTEGRATION_SECRET,
      DISEASE_PAYMENT_GROUPER_CALLBACK_SECRET: "insurance-public-api-grouper-callback-secret-32-characters",
      DISEASE_PAYMENT_GROUPER_CALLBACK_ALLOWED_SOURCES: "official-grouper-api-test"
    },
    stdio: "ignore"
  });
  t.after(() => {
    server.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl);
  const hospital = await login(baseUrl, "hospital");
  const doctor = await login(baseUrl, "doctor_wang");
  const nurse = await login(baseUrl, "nurse");
  const community = await login(baseUrl, "community");
  const insurance = await login(baseUrl, "insurance");
  for (const session of [hospital, doctor, nurse, community, insurance]) assert.equal(session.response.status, 200);

  const anonymousOperations = await request(baseUrl, "/api/disease-payment/formal-grouping/operations");
  assert.equal(anonymousOperations.response.status, 401);

  const refundInput = {
    paymentEventId: "igw-t07-original-payment",
    paymentTradeNo: "PAY-T07-001",
    refundAmountFen: 3000,
    refundReason: "resident cancelled the service",
    reasonCode: "SERVICE_CANCELLED",
    idempotencyKey: "refund-t07-public-001",
    requestedBy: "forged-client",
    organizationId: "MR3"
  };
  const anonymousRefund = await request(baseUrl, "/api/online-payments/refunds", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": refundInput.idempotencyKey },
    body: JSON.stringify(refundInput)
  });
  assert.equal(anonymousRefund.response.status, 401);

  const unauthorizedRefund = await request(baseUrl, "/api/online-payments/refunds", {
    method: "POST",
    headers: authenticated(insurance.body.token, refundInput),
    body: JSON.stringify(refundInput)
  });
  assert.equal(unauthorizedRefund.response.status, 403);

  const created = await request(baseUrl, "/api/online-payments/refunds", {
    method: "POST",
    headers: authenticated(hospital.body.token, refundInput),
    body: JSON.stringify(refundInput)
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.refund.requestedBy, "hospital");
  assert.equal(created.body.refund.organizationId, "MR1");
  assert.equal(created.body.refund.refundTransactionRuntime, undefined);
  assert.equal(created.body.refund.requestKeyHash, undefined);
  assert.equal(created.body.eventContract.id, "insurance-payment.refund-request.v1");
  assert.equal(created.body.eventContract.version, 1);
  assert.match(created.body.eventContract.outboxEventId, /^ipe-/);
  assert.equal(created.body.productionReady, false);

  const replayed = await request(baseUrl, "/api/online-payments/refunds", {
    method: "POST",
    headers: authenticated(hospital.body.token, refundInput),
    body: JSON.stringify({ ...refundInput, id: "forged-second-refund-id" })
  });
  assert.equal(replayed.response.status, 200);
  assert.equal(replayed.body.idempotent, true);
  assert.equal(replayed.body.refund.id, created.body.refund.id);

  const conflictingReplay = await request(baseUrl, "/api/online-payments/refunds", {
    method: "POST",
    headers: authenticated(hospital.body.token, refundInput),
    body: JSON.stringify({ ...refundInput, refundAmountFen: 4000 })
  });
  assert.equal(conflictingReplay.response.status, 409);
  assert.equal(conflictingReplay.body.code, "PERSISTENCE_COMMAND_CONFLICT");

  const crossOrganization = await request(baseUrl, `/api/online-payments/refunds/${created.body.refund.id}/reviews`, {
    method: "POST",
    headers: authenticated(community.body.token, { idempotencyKey: "cross-org-review" }),
    body: JSON.stringify({ approved: true, reviewDomain: "business-review", role: "finance" })
  });
  assert.equal(crossOrganization.response.status, 403);
  assert.equal(crossOrganization.body.code, "REFUND_ORGANIZATION_SCOPE_DENIED");

  const businessReview = await request(baseUrl, `/api/online-payments/refunds/${created.body.refund.id}/reviews`, {
    method: "POST",
    headers: authenticated(doctor.body.token, { idempotencyKey: "business-review" }),
    body: JSON.stringify({ approved: true, reviewDomain: "business-review", role: "forged-finance-role" })
  });
  assert.equal(businessReview.response.status, 200);
  assert.equal(businessReview.body.review.role, "institution");

  const financeReview = await request(baseUrl, `/api/online-payments/refunds/${created.body.refund.id}/reviews`, {
    method: "POST",
    headers: authenticated(nurse.body.token, { idempotencyKey: "finance-review" }),
    body: JSON.stringify({ approved: true, reviewDomain: "finance-review", role: "forged-finance-role" })
  });
  assert.equal(financeReview.response.status, 200);
  assert.equal(financeReview.body.refund.state, "APPROVED");

  const formalJobInput = {
    id: "t07-public-formal-job",
    idempotencyKey: "t07-public-formal-job-idem",
    mode: "DRG",
    schemeVersion: "DRG-2.0-DL",
    caseIds: ["dp-case-001"]
  };
  const formalJob = await request(baseUrl, "/api/disease-payment/formal-grouping/jobs", {
    method: "POST",
    headers: authenticated(insurance.body.token, formalJobInput),
    body: JSON.stringify(formalJobInput)
  });
  assert.equal(formalJob.response.status, 201);

  const dispatchPath = "/api/disease-payment/formal-grouping/jobs/t07-public-formal-job/dispatch";
  const dispatchPayload = { accepted: true, transportId: "trusted-system-transport" };
  const humanDispatch = await request(baseUrl, dispatchPath, {
    method: "POST",
    headers: authenticated(insurance.body.token, dispatchPayload),
    body: JSON.stringify(dispatchPayload)
  });
  assert.equal(humanDispatch.response.status, 401);
  assert.equal(humanDispatch.body.code, "INSURANCE_PAYMENT_SYSTEM_SIGNATURE_INVALID");

  const trustedDispatch = await request(baseUrl, dispatchPath, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Integration-Signature": commandSignature(dispatchPath, "t07-public-formal-job", "dispatch", dispatchPayload)
    },
    body: JSON.stringify(dispatchPayload)
  });
  assert.equal(trustedDispatch.response.status, 200);
  assert.equal(trustedDispatch.body.job.status, "awaiting-receipt");

  const clientReportedReceipt = await request(baseUrl, "/api/disease-payment/formal-grouping/jobs/t07-public-formal-job/receipts", {
    method: "POST",
    headers: authenticated(insurance.body.token, {}),
    body: JSON.stringify({
      eventId: "forged-client-receipt",
      correlationId: trustedDispatch.body.job.correlationId,
      officialResults: []
    })
  });
  assert.ok([400, 401, 403].includes(clientReportedReceipt.response.status));

  const blockedFinanceAction = await request(baseUrl, "/api/disease-payment/annual-clearances/missing/actions", {
    method: "POST",
    headers: authenticated(insurance.body.token, { idempotencyKey: "forged-post" }),
    body: JSON.stringify({ action: "post", voucherNo: "FORGED-VOUCHER" })
  });
  assert.equal(blockedFinanceAction.response.status, 403);
  assert.equal(blockedFinanceAction.body.code, "ANNUAL_CLEARANCE_TRUSTED_FINANCE_ACTOR_REQUIRED");
});
