"use strict";

const {
  dispatchPublicHealthDirectReport
} = require("./public-health-connectors");
const {
  validatePayloadAgainstDictionary
} = require("./public-health-direct-report-control-package");
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

function requireRepository(repository) {
  if (!repository || typeof repository.transaction !== "function") {
    const error = new Error("direct-report worker requires a transactional repository");
    error.code = "PUBLIC_HEALTH_DIRECT_REPORT_REPOSITORY_REQUIRED";
    throw error;
  }
  return repository;
}

async function claimNextDirectReportDelivery(repository, options = {}) {
  requireRepository(repository);
  const claimedAt = nowFrom(options.clock);
  return repository.transaction(async (transaction) => {
    const snapshot = await transaction.readState();
    const [due] = listDueDirectReportDeliveries(snapshot.state, {
      now: claimedAt,
      limit: 1
    });
    if (!due) return null;
    const claimed = claimDirectReportDeliveryToState(snapshot.state, due.id, {
      expectedVersion: due.version,
      workerId: options.workerId,
      leaseSeconds: options.leaseSeconds || 120,
      now: claimedAt
    }, {
      randomUUID: options.randomUUID
    });
    const workflow = reportingCaseFor(claimed.nextData, claimed.delivery.caseId);
    await transaction.writeState(claimed.nextData, {
      expectedVersion: snapshot.version,
      event: "delivery-claimed"
    });
    return {
      delivery: claimed.delivery,
      leaseToken: claimed.leaseToken,
      workflow: structuredClone(workflow),
      claimedAt
    };
  });
}

async function settleDirectReportDelivery(repository, claim, outcome, options = {}) {
  requireRepository(repository);
  const completedAt = nowFrom(options.clock);
  return repository.transaction(async (transaction) => {
    const snapshot = await transaction.readState();
    const recorded = recordDirectReportDeliveryOutcomeToState(
      snapshot.state,
      claim.delivery.id,
      outcome,
      {
        expectedVersion: claim.delivery.version,
        leaseToken: claim.leaseToken,
        now: completedAt
      }
    );
    await transaction.writeState(recorded.nextData, {
      expectedVersion: snapshot.version,
      event: "delivery-attempted"
    });
    return {
      delivery: projectDirectReportDelivery(recorded.delivery, { now: completedAt }),
      completedAt
    };
  });
}

async function processTransactionalDirectReportDelivery(repository, options = {}) {
  const claim = await claimNextDirectReportDelivery(repository, options);
  if (!claim) return null;
  let outcome;
  try {
    const request = buildDirectReportDeliveryInput(claim.workflow, {
      ...(options.dispatchOptions || {}),
      deliveryId: claim.delivery.id
    });
    if (options.dictionaryControl) {
      validatePayloadAgainstDictionary(
        request.payload,
        options.dictionaryControl,
        options.dispatchOptions || {}
      );
    }
    const dispatch = options.dispatch || dispatchPublicHealthDirectReport;
    if (typeof dispatch !== "function") throw new Error("direct-report worker dispatch implementation is required");
    const result = await dispatch(request, options.dispatchOptions || {});
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
  const settled = await settleDirectReportDelivery(repository, claim, outcome, options);
  return {
    ok: true,
    delivery: settled.delivery,
    claimedAt: claim.claimedAt,
    completedAt: settled.completedAt,
    productionReady: false
  };
}

async function runTransactionalDirectReportWorkerCycle(repository, options = {}) {
  requireRepository(repository);
  const limit = Number(options.limit || 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    const error = new Error("direct-report worker limit must be an integer from 1 to 100");
    error.code = "PUBLIC_HEALTH_DIRECT_REPORT_WORKER_LIMIT_INVALID";
    throw error;
  }
  const startedAt = nowFrom(options.clock);
  const deliveries = [];
  while (deliveries.length < limit) {
    const result = await processTransactionalDirectReportDelivery(repository, options);
    if (!result) break;
    deliveries.push(result.delivery);
  }
  return {
    generatedAt: startedAt,
    processed: deliveries.length,
    awaitingCallback: deliveries.filter((item) => item.state === "awaiting-callback").length,
    retryScheduled: deliveries.filter((item) => item.state === "retry-scheduled").length,
    deadLetters: deliveries.filter((item) => item.state === "dead-letter").length,
    deliveries,
    productionReady: false
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
    if (options.dictionaryControl) {
      validatePayloadAgainstDictionary(request.payload, options.dictionaryControl, dispatchOptions);
    }
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
  claimNextDirectReportDelivery,
  processDirectReportDelivery,
  processTransactionalDirectReportDelivery,
  reportingCaseFor,
  runDirectReportWorkerCycle,
  runTransactionalDirectReportWorkerCycle,
  safeFailure,
  settleDirectReportDelivery
};
