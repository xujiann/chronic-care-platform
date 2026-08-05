"use strict";

const {
  dispatchPublicHealthDirectReport
} = require("./public-health-connectors");
const {
  buildDirectReportDeliveryInput,
  claimDirectReportDeliveryToState,
  listDueDirectReportDeliveries,
  projectDirectReportDelivery,
  recordDirectReportDeliveryOutcomeToState
} = require("./public-health-direct-report-outbox-service");

function clean(value, maximum = 240) {
  return String(value ?? "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function nowFrom(clock) {
  const value = clean((clock || (() => new Date().toISOString()))(), 80);
  if (!Number.isFinite(Date.parse(value))) throw new Error("direct-report worker clock must return a valid date-time");
  return new Date(value).toISOString();
}

function reportingCaseFor(data, caseId) {
  const workflow = (Array.isArray(data?.publicHealthInfectiousReportingCases)
    ? data.publicHealthInfectiousReportingCases
    : []).find((item) => item.id === caseId);
  if (!workflow) {
    const error = new Error("bound infectious reporting case was not found");
    error.code = "PUBLIC_HEALTH_DIRECT_REPORT_CASE_NOT_FOUND";
    error.retryable = false;
    throw error;
  }
  return workflow;
}

function safeFailure(error) {
  const code = clean(error?.code || "PUBLIC_HEALTH_DIRECT_REPORT_TRANSPORT_FAILED", 120).toUpperCase();
  return {
    accepted: false,
    code: /^[A-Z0-9_:-]+$/.test(code) ? code : "PUBLIC_HEALTH_DIRECT_REPORT_TRANSPORT_FAILED",
    retryable: error?.retryable === true
  };
}

async function processDirectReportDelivery(options = {}) {
  const {
    data = {},
    deliveryId,
    expectedVersion,
    workerId,
    leaseSeconds = 120,
    dispatch = dispatchPublicHealthDirectReport,
    writeState,
    dispatchOptions = {},
    clock
  } = options;
  if (typeof dispatch !== "function") throw new Error("direct-report worker dispatch implementation is required");
  if (typeof writeState !== "function") throw new Error("direct-report worker durable writer is required");
  const claimedAt = nowFrom(clock);
  const claimed = claimDirectReportDeliveryToState(data, deliveryId, {
    expectedVersion,
    workerId,
    leaseSeconds,
    now: claimedAt
  }, {
    randomUUID: options.randomUUID
  });
  await writeState(claimed.nextData, {
    event: "public-health-direct-report-delivery-claimed",
    deliveryId: claimed.delivery.id,
    expectedVersion: Number(expectedVersion),
    nextVersion: Number(claimed.delivery.version),
    at: claimedAt
  });

  let outcome;
  try {
    const workflow = reportingCaseFor(claimed.nextData, claimed.delivery.caseId);
    const request = buildDirectReportDeliveryInput(workflow, {
      ...dispatchOptions,
      deliveryId: claimed.delivery.id
    });
    const result = await dispatch(request, dispatchOptions);
    outcome = {
      accepted: true,
      receiptId: result.receiptId,
      requestId: result.requestId,
      providerStatus: result.status,
      acceptedAt: result.acceptedAt,
      transportAttempts: result.attempts
    };
  } catch (error) {
    outcome = safeFailure(error);
  }

  const completedAt = nowFrom(clock);
  const recorded = recordDirectReportDeliveryOutcomeToState(
    claimed.nextData,
    claimed.delivery.id,
    outcome,
    {
      expectedVersion: claimed.delivery.version,
      leaseToken: claimed.leaseToken,
      now: completedAt
    }
  );
  await writeState(recorded.nextData, {
    event: "public-health-direct-report-delivery-attempted",
    deliveryId: recorded.delivery.id,
    expectedVersion: Number(claimed.delivery.version),
    nextVersion: Number(recorded.delivery.version),
    state: recorded.delivery.state,
    at: completedAt
  });
  return {
    ok: true,
    delivery: projectDirectReportDelivery(recorded.delivery, { now: completedAt }),
    nextData: recorded.nextData,
    productionReady: false
  };
}

async function runDirectReportWorkerCycle(options = {}) {
  const startedAt = nowFrom(options.clock);
  const due = listDueDirectReportDeliveries(options.data || {}, {
    now: startedAt,
    limit: options.limit || 20
  });
  let currentData = options.data || {};
  const results = [];
  for (const delivery of due) {
    const result = await processDirectReportDelivery({
      ...options,
      data: currentData,
      deliveryId: delivery.id,
      expectedVersion: delivery.version
    });
    currentData = result.nextData;
    results.push(result.delivery);
  }
  return {
    generatedAt: startedAt,
    due: due.length,
    processed: results.length,
    deliveries: results,
    nextData: currentData,
    productionReady: false
  };
}

module.exports = {
  processDirectReportDelivery,
  reportingCaseFor,
  runDirectReportWorkerCycle,
  safeFailure
};
