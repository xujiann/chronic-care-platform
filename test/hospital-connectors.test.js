const assert = require("node:assert/strict");
const test = require("node:test");

const {
  dispatchHospitalRequest,
  hospitalConnectorCenter,
  signHospitalRequest,
  stableStringify
} = require("../hospital-connectors");

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  };
}

test("hospital connector signs a stable envelope and returns a normalized receipt", async () => {
  let captured;
  const receipt = await dispatchHospitalRequest({
    domain: "HIS",
    contractId: "his-patient-v1",
    idempotencyKey: "his-visit-001",
    requestId: "request-001",
    payload: { residentId: "r1", externalId: "visit-001" }
  }, {
    env: {
      NODE_ENV: "production",
      HIS_ADAPTER_URL: "https://his.example.gov.cn/platform/events",
      HIS_ADAPTER_SECRET: "his-signing-secret",
      HIS_ADAPTER_TOKEN: "his-bearer-token",
      HOSPITAL_ADAPTER_MAX_ATTEMPTS: "3"
    },
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options };
      return jsonResponse({ receiptId: "his-receipt-001", status: "accepted", acceptedAt: "2026-07-11T03:00:00.000Z" });
    }
  });

  const envelope = JSON.parse(captured.options.body);
  assert.equal(captured.url, "https://his.example.gov.cn/platform/events");
  assert.equal(captured.options.headers.Authorization, "Bearer his-bearer-token");
  assert.equal(captured.options.headers["X-Idempotency-Key"], "his-visit-001");
  assert.equal(captured.options.headers["X-Signature"], signHospitalRequest(
    stableStringify(envelope),
    "his-signing-secret",
    captured.options.headers["X-Timestamp"],
    "request-001"
  ));
  assert.equal(receipt.receiptId, "his-receipt-001");
  assert.equal(receipt.attempts, 1);
  assert.equal(JSON.stringify(receipt).includes("his-signing-secret"), false);
  assert.equal(JSON.stringify(receipt).includes("his-bearer-token"), false);
});

test("hospital connector retries transient failures with the same idempotency identity", async () => {
  const requests = [];
  const receipt = await dispatchHospitalRequest({
    domain: "LIS",
    contractId: "lis-report-v1",
    idempotencyKey: "lis-report-001",
    payload: { reportNo: "LAB-001" }
  }, {
    env: {
      LIS_ADAPTER_URL: "http://127.0.0.1:8080/lis",
      HOSPITAL_ADAPTER_SECRET: "shared-signing-secret",
      HOSPITAL_ADAPTER_MAX_ATTEMPTS: "3"
    },
    retryDelayMs: 0,
    fetchImpl: async (_url, options) => {
      requests.push(options);
      if (requests.length < 3) return jsonResponse({ message: "temporary unavailable" }, 503);
      return jsonResponse({ receiptId: "lis-receipt-001", status: "queued" });
    }
  });

  assert.equal(receipt.attempts, 3);
  assert.equal(new Set(requests.map((item) => item.headers["X-Request-Id"])).size, 1);
  assert.equal(new Set(requests.map((item) => item.headers["X-Idempotency-Key"])).size, 1);
  assert.equal(new Set(requests.map((item) => item.headers["X-Signature"])).size, 1);
});

test("hospital connector does not retry permanent or negative receipts", async () => {
  let permanentAttempts = 0;
  await assert.rejects(() => dispatchHospitalRequest({
    domain: "EMR",
    contractId: "emr-summary-v1",
    idempotencyKey: "emr-summary-001",
    payload: { externalId: "emr-001" }
  }, {
    env: { EMR_ADAPTER_URL: "http://127.0.0.1/emr", EMR_ADAPTER_SECRET: "secret" },
    retryDelayMs: 0,
    fetchImpl: async () => {
      permanentAttempts += 1;
      return jsonResponse({ message: "schema invalid" }, 400);
    }
  }), /schema invalid/);
  assert.equal(permanentAttempts, 1);

  await assert.rejects(() => dispatchHospitalRequest({
    domain: "PACS",
    contractId: "pacs-report-v1",
    idempotencyKey: "pacs-report-001",
    payload: { externalId: "pacs-001" }
  }, {
    env: { PACS_ADAPTER_URL: "http://127.0.0.1/pacs", PACS_ADAPTER_SECRET: "secret" },
    fetchImpl: async () => jsonResponse({ receiptId: "pacs-rejected-001", status: "rejected" })
  }), /rejected the request/);
});

test("production hospital connectors require configured HTTPS endpoints", async () => {
  await assert.rejects(() => dispatchHospitalRequest({
    domain: "Appointment",
    contractId: "appointment-order-v1",
    idempotencyKey: "appointment-001",
    payload: { orderNo: "order-001" }
  }, {
    env: {
      NODE_ENV: "production",
      APPOINTMENT_ADAPTER_URL: "http://his.internal/appointments",
      APPOINTMENT_ADAPTER_SECRET: "secret"
    },
    fetchImpl: async () => jsonResponse({ receiptId: "never-called" })
  }), /HTTPS/);
});

test("hospital connector center exposes configuration state without secrets or endpoints", () => {
  const center = hospitalConnectorCenter({
    NODE_ENV: "production",
    HIS_ADAPTER_URL: "https://his.example.gov.cn/events",
    HIS_ADAPTER_SECRET: "his-secret",
    HOSPITAL_ADAPTER_TOKEN: "shared-token"
  });
  assert.equal(center.summary.total, 5);
  assert.equal(center.summary.configured, 1);
  assert.equal(center.productionReady, false);
  assert.equal(center.connectors.find((item) => item.domain === "HIS").configured, true);
  assert.equal(JSON.stringify(center).includes("his.example.gov.cn"), false);
  assert.equal(JSON.stringify(center).includes("his-secret"), false);
  assert.equal(JSON.stringify(center).includes("shared-token"), false);
});
