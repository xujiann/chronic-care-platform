"use strict";

const {
  acknowledgePilotCutoverAlert,
  buildPilotCutoverAlertProjection,
  deliverPilotCutoverAlert,
  derivePilotCutoverAlertCandidates,
  escalatePilotCutoverAlert,
  pilotCutoverMonitoringAdapterStatus,
  readPilotCutoverAlertJournal,
  recoverPilotCutoverAlert,
  redrivePilotCutoverAlert
} = require("./pilot-cutover-alert-lifecycle");
const { attachWorkerObservability } = require("../operations/worker-observability-contract");

const COMMANDS = Object.freeze({
  acknowledge: acknowledgePilotCutoverAlert,
  escalate: escalatePilotCutoverAlert,
  recover: recoverPilotCutoverAlert,
  redrive: redrivePilotCutoverAlert
});

function clean(value, maximum = 240) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function journalFile(options = {}) {
  return options.file
    || options.env?.PLATFORM_PILOT_CUTOVER_ALERT_JOURNAL_FILE
    || process.env.PLATFORM_PILOT_CUTOVER_ALERT_JOURNAL_FILE;
}

function blockedProjection(error, adapter, now = new Date().toISOString()) {
  return Object.freeze({
    schema: "pilot-cutover-alert-control-status-v1",
    evaluatedAt: now,
    status: "blocked",
    adapter,
    projection: null,
    summary: Object.freeze({
      total: 0,
      open: 0,
      critical: 0,
      deadLetter: 0,
      recovered: 0
    }),
    error: Object.freeze({
      code: clean(error?.code || "PILOT_CUTOVER_ALERT_CONTROL_UNAVAILABLE", 120),
      message: "pilot cutover alert control is unavailable"
    }),
    failClosed: true,
    cutoverExecutionAuthorized: false,
    productionReady: false
  });
}

function buildPilotCutoverAlertControlStatus(options = {}) {
  const env = options.env || process.env;
  const file = journalFile(options);
  const adapter = pilotCutoverMonitoringAdapterStatus({
    env,
    file,
    routes: options.routes
  });
  try {
    const events = readPilotCutoverAlertJournal(file, { allowMissing: true });
    const projection = buildPilotCutoverAlertProjection({
      events,
      now: options.now
    });
    const blocked = adapter.adapterReady !== true
      || projection.chainValid !== true
      || projection.summary.critical > 0
      || projection.summary.deadLetter > 0;
    return Object.freeze({
      schema: "pilot-cutover-alert-control-status-v1",
      evaluatedAt: projection.evaluatedAt,
      status: blocked ? "blocked" : "operational",
      adapter,
      projection,
      summary: projection.summary,
      failClosed: blocked,
      monitoringAcceptanceProven: false,
      cutoverExecutionAuthorized: false,
      productionReady: false,
      boundary: "This endpoint exposes metadata-only alert state. It neither delivers alerts nor authorizes cutover."
    });
  } catch (error) {
    return blockedProjection(error, adapter, options.now);
  }
}

function applyPilotCutoverAlertCommand(options = {}) {
  const action = clean(options.action, 40);
  const command = COMMANDS[action];
  const actorAccount = clean(options.actorAccount, 160);
  const alertFingerprint = clean(options.alertFingerprint, 200);
  if (!command || !actorAccount || !alertFingerprint) {
    throw Object.assign(new Error(
      "alert command requires a supported action, authenticated actor and fingerprint"
    ), {
      code: "PILOT_CUTOVER_ALERT_COMMAND_INVALID",
      statusCode: 400
    });
  }
  const event = command({
    file: journalFile(options),
    alertFingerprint,
    actorAccount,
    recordedAt: options.recordedAt,
    evidenceRef: options.evidenceRef,
    evidenceDigest: options.evidenceDigest,
    level: options.level,
    ownerGroup: options.ownerGroup
  });
  return Object.freeze({
    schema: "pilot-cutover-alert-command-result-v1",
    action,
    event: Object.freeze({
      eventId: event.eventId,
      sequence: event.sequence,
      type: event.type,
      alertFingerprint: event.alertFingerprint,
      recordedAt: event.recordedAt,
      actorAccount: event.actorAccount,
      eventDigest: event.eventDigest
    }),
    control: buildPilotCutoverAlertControlStatus(options),
    cutoverExecutionAuthorized: false,
    productionReady: false
  });
}

function blockedControl(now, error) {
  return Object.freeze({
    schema: "pilot-cutover-authorization-control-v1",
    evaluatedAt: now,
    releaseId: "",
    decision: "NO-GO",
    ledger: Object.freeze({
      releaseId: "",
      packageFingerprint: "",
      headDigest: "",
      chainValid: false,
      trustReady: false,
      rehearsalReady: false,
      lifecycle: Object.freeze([]),
      trust: Object.freeze([])
    }),
    error: Object.freeze({
      code: clean(error?.code || "PILOT_CUTOVER_CONTROL_UNAVAILABLE", 120)
    }),
    cutoverExecutionAuthorized: false,
    productionReady: false
  });
}

function controlProviderError(code) {
  return Object.assign(new Error("pilot cutover control provider is unavailable"), {
    code
  });
}

async function runPilotCutoverAlertDeliveryCycle(options = {}) {
  const env = options.env || process.env;
  const now = options.now || new Date().toISOString();
  const enabled = options.enabled === true
    || /^(?:1|true|yes|enabled)$/i.test(clean(
      env.PLATFORM_PILOT_CUTOVER_ALERT_WORKER_ENABLED,
      20
    ));
  const actorAccount = clean(
    options.actorAccount || env.PLATFORM_PILOT_CUTOVER_ALERT_WORKER_ACCOUNT,
    160
  );
  const before = buildPilotCutoverAlertControlStatus({
    ...options,
    env,
    now
  });
  if (!enabled || !actorAccount || before.adapter.adapterReady !== true) {
    return attachWorkerObservability("cutover-alert-delivery", {
      schema: "pilot-cutover-alert-worker-cycle-v1",
      evaluatedAt: now,
      status: "blocked",
      candidates: 0,
      delivered: 0,
      failed: 0,
      workerEnabled: enabled,
      adapter: before.adapter,
      failClosed: true,
      cutoverExecutionAuthorized: false,
      productionReady: false
    }, { observedAt: now });
  }
  let control;
  try {
    const provider = options.controlProvider;
    if (typeof provider !== "function") {
      throw controlProviderError("PILOT_CUTOVER_CONTROL_PROVIDER_REQUIRED");
    }
    control = await provider();
    if (!control || typeof control !== "object" || Array.isArray(control)) {
      throw controlProviderError("PILOT_CUTOVER_CONTROL_PROVIDER_INVALID");
    }
  } catch (error) {
    control = blockedControl(now, error);
  }
  const candidates = derivePilotCutoverAlertCandidates(control, {
    now,
    warningHours: options.warningHours
  });
  const results = [];
  for (const candidate of candidates) {
    try {
      results.push(await deliverPilotCutoverAlert({
        candidate,
        file: journalFile(options),
        env,
        routes: options.routes,
        actorAccount,
        maximumAttempts: options.maximumAttempts,
        dispatcher: options.dispatcher,
        fetchImpl: options.fetchImpl,
        sleep: options.sleep,
        now
      }));
    } catch (error) {
      results.push(Object.freeze({
        schema: "pilot-cutover-alert-delivery-result-v1",
        fingerprint: candidate.fingerprint,
        delivered: false,
        failClosed: true,
        error: Object.freeze({
          code: clean(error?.code || "PILOT_CUTOVER_ALERT_DELIVERY_FAILED", 120)
        }),
        productionReady: false
      }));
    }
  }
  const delivered = results.filter((row) => row.delivered === true).length;
  const failed = results.length - delivered;
  return attachWorkerObservability("cutover-alert-delivery", {
    schema: "pilot-cutover-alert-worker-cycle-v1",
    evaluatedAt: now,
    status: failed ? "blocked" : "completed",
    candidates: candidates.length,
    delivered,
    failed,
    workerEnabled: enabled,
    results: Object.freeze(results),
    controlDecision: control.decision === "GO-CANDIDATE" ? "GO-CANDIDATE" : "NO-GO",
    controlErrorCode: clean(control.error?.code, 120),
    failClosed: failed > 0,
    monitoringAcceptanceProven: false,
    cutoverExecutionAuthorized: false,
    productionReady: false
  }, { observedAt: now });
}

module.exports = {
  COMMANDS,
  applyPilotCutoverAlertCommand,
  blockedProjection,
  buildPilotCutoverAlertControlStatus,
  runPilotCutoverAlertDeliveryCycle
};
