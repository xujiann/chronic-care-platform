const {
  claimPublicHealthExternalDispatchToState,
  listDuePublicHealthExternalDispatches,
  recordClaimedPublicHealthExternalAttemptToState
} = require("./public-health-external-adapter-runtime");
const {
  loadPublicHealthLaneCredentials
} = require("./public-health-external-key-provider");

function clean(value) {
  return String(value ?? "").trim();
}

function serverTime(clock) {
  const value = clean((clock || (() => new Date().toISOString()))());
  if (!Number.isFinite(new Date(value).getTime())) throw new Error("public health worker clock must return a valid date-time");
  return value;
}

function dispatchFor(data, dispatchId) {
  const dispatch = (Array.isArray(data.publicHealthExternalDispatches) ? data.publicHealthExternalDispatches : [])
    .find((item) => item.id === clean(dispatchId));
  if (!dispatch) throw new Error(`unknown public health external dispatch: ${clean(dispatchId) || "missing"}`);
  return dispatch;
}

function laneControlVersionFor(data, laneId) {
  const control = (Array.isArray(data.publicHealthExternalLaneControls) ? data.publicHealthExternalLaneControls : [])
    .find((item) => item.laneId === clean(laneId));
  return Number(control?.version || 0);
}

function deliveryEnvelope(dispatch, endpoint) {
  return {
    endpoint,
    dispatchId: dispatch.id,
    laneId: dispatch.laneId,
    request: dispatch.request,
    requestDigest: dispatch.requestDigest,
    requestSignatureKeyId: dispatch.requestSignatureKeyId,
    requestSignature: dispatch.requestSignature,
    signatureAlgorithm: dispatch.signatureAlgorithm
  };
}

async function processPublicHealthExternalDispatch(options = {}) {
  const {
    data = {},
    dispatchId,
    expectedVersion,
    workerId,
    idempotencyKey,
    leaseSeconds = 60,
    transport,
    writeState,
    dependencies = {},
    clock,
    loadCredentials = loadPublicHealthLaneCredentials
  } = options;
  if (typeof transport !== "function") throw new Error("public health external worker transport is required");
  if (typeof writeState !== "function") throw new Error("public health external worker durable writer is required");
  const initial = dispatchFor(data, dispatchId);
  const claimedAt = serverTime(clock);
  const credentials = await loadCredentials(initial.laneId, { at: claimedAt });
  const expectedLaneControlVersion = laneControlVersionFor(data, initial.laneId);
  const claimed = claimPublicHealthExternalDispatchToState(data, initial.id, {
    workerId: clean(workerId),
    idempotencyKey: clean(idempotencyKey),
    expectedVersion,
    expectedLaneControlVersion,
    leaseSeconds,
    now: claimedAt
  }, credentials);
  await writeState(claimed.nextData, {
    event: "public-health-external-claim",
    at: claimedAt,
    publicHealthExternalCas: {
      dispatchId: initial.id,
      expectedOutboxVersion: Number(initial.outboxVersion),
      laneId: initial.laneId,
      expectedLaneControlVersion
    }
  });

  let transportResult;
  try {
    transportResult = await transport(deliveryEnvelope(claimed.dispatch, credentials.endpoint));
  } catch {
    transportResult = { networkError: "transport-failure" };
  }
  const attemptedAt = serverTime(clock);
  const attempted = recordClaimedPublicHealthExternalAttemptToState(
    claimed.nextData,
    claimed.dispatch.id,
    transportResult || {},
    {
      requestKeyring: credentials.requestKeyring,
      receiptKeyring: credentials.receiptKeyring,
      resiliencePolicies: credentials.resiliencePolicies,
      attemptIdempotencyKey: `${clean(idempotencyKey)}:attempt`,
      expectedVersion: claimed.dispatch.outboxVersion,
      expectedLaneControlVersion: Number(claimed.laneControl?.version ?? expectedLaneControlVersion),
      workerId: clean(workerId),
      leaseToken: claimed.leaseToken,
      at: attemptedAt
    },
    dependencies
  );
  await writeState(attempted.nextData, {
    event: "public-health-external-attempt",
    at: attemptedAt,
    publicHealthExternalCas: {
      dispatchId: claimed.dispatch.id,
      expectedOutboxVersion: Number(claimed.dispatch.outboxVersion),
      laneId: claimed.dispatch.laneId,
      expectedLaneControlVersion: Number(claimed.laneControl?.version ?? expectedLaneControlVersion)
    }
  });
  return {
    ok: true,
    claimed: {
      idempotent: claimed.idempotent,
      dispatchId: claimed.dispatch.id,
      outboxVersion: claimed.dispatch.outboxVersion,
      laneControlVersion: claimed.laneControl?.version ?? null
    },
    attempted: {
      idempotent: attempted.idempotent,
      dispatchId: attempted.dispatch.id,
      outboxVersion: attempted.dispatch.outboxVersion,
      laneControlVersion: attempted.laneControl?.version ?? null,
      deliveryState: attempted.dispatch.deliveryState
    },
    nextData: attempted.nextData,
    productionReady: false
  };
}

async function runPublicHealthExternalWorkerCycle(options = {}) {
  const now = serverTime(options.clock);
  const due = listDuePublicHealthExternalDispatches(options.data || {}, {
    now,
    limit: options.limit || 20
  });
  const results = [];
  let currentData = options.data || {};
  for (const item of due) {
    const result = await processPublicHealthExternalDispatch({
      ...options,
      data: currentData,
      dispatchId: item.id,
      expectedVersion: item.outboxVersion,
      idempotencyKey: `${clean(options.cycleId)}:${item.id}`,
      clock: options.clock
    });
    currentData = result.nextData;
    results.push(result);
  }
  return {
    generatedAt: now,
    due: due.length,
    processed: results.length,
    results: results.map((item) => item.attempted),
    nextData: currentData,
    productionReady: false
  };
}

module.exports = {
  deliveryEnvelope,
  laneControlVersionFor,
  processPublicHealthExternalDispatch,
  runPublicHealthExternalWorkerCycle
};
