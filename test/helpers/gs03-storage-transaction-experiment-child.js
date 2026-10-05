"use strict";

// Disposable TEST-027 worker. It never loads the application runtime.
const fs = require("node:fs");
const path = require("node:path");
const { openExperiment } = require("./gs03-storage-transaction-experiment");

const [encoded] = process.argv.slice(2);
const input = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
const pause = new Int32Array(new SharedArrayBuffer(4));

function send(message) {
  if (process.send) process.send(message);
}

function phase(name) {
  send({ type: "phase", phase: name });
  if (name === input.holdPhase) {
    const directory = path.resolve(input.directory);
    const gatePath = path.resolve(input.gatePath);
    if (path.dirname(gatePath) !== path.dirname(directory)
      || !path.basename(gatePath).startsWith(`gate-${path.basename(directory)}-`)) {
      throw new Error("synthetic gate path is outside the approved temp root");
    }
    // The marker is durable even while synchronous SQLite holds the IPC loop.
    fs.writeFileSync(`${gatePath}.phase`, name, { flag: "wx" });
    const deadline = Date.now() + 20000;
    while (!fs.existsSync(gatePath)) {
      if (Date.now() > deadline) throw new Error("synthetic child gate timed out");
      Atomics.wait(pause, 0, 0, 20);
    }
  }
  if (name === input.failPhase) throw new Error(`injected fault at ${name}`);
}

let experiment;
try {
  experiment = openExperiment({
    directory: input.directory,
    identity: input.identity,
    clock: () => input.now,
    busyTimeoutMs: input.busyTimeoutMs
  });
  send({ type: "started" });
  const result = input.operation === "revoke"
    ? experiment.revokeAuthorization(input.request, { onPhase: phase })
    : input.operation === "reconcile"
      ? experiment.reconcile(input.request, { busyTimeoutMs: input.busyTimeoutMs })
      : experiment.applyCallback(input.request, { onPhase: phase });
  send({ type: "result", result });
} catch (error) {
  send({
    type: "error",
    code: error.code || null,
    outcome: error.outcome || null,
    message: String(error.message || error)
  });
} finally {
  if (experiment) experiment.close();
  if (process.disconnect) process.disconnect();
}
