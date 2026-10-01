"use strict";

// A disposable worker for the isolated SQLite experiment. Never load app runtime.
const fs = require("node:fs");
const { openExperiment } = require("./gs03-sqlite-experiment");

const [encoded] = process.argv.slice(2);
const input = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
const pause = new Int32Array(new SharedArrayBuffer(4));

function send(message) {
  if (process.send) process.send(message);
}

function phase(name) {
  send({ type: "phase", phase: name });
  if (name !== input.holdPhase) return;
  // A durable synthetic gate marker proves the child reached this exact phase
  // even when its IPC event loop is blocked inside the synchronous SQLite call.
  fs.writeFileSync(`${input.gatePath}.phase`, name);
  const deadline = Date.now() + 30000;
  while (!fs.existsSync(input.gatePath)) {
    if (Date.now() > deadline) throw new Error("synthetic child gate timed out");
    Atomics.wait(pause, 0, 0, 20);
  }
}

let experiment;
try {
  experiment = openExperiment({
    dbPath: input.dbPath,
    identity: input.identity,
    clock: () => input.now
  });
  send({ type: "started" });
  const result = input.operation === "revoke"
    ? experiment.revokeAuthorization(input.request, { onPhase: phase })
    : input.operation === "reconcile"
      ? experiment.reconcile(input.request)
      : experiment.applyCallback(input.request, { onPhase: phase });
  send({ type: "result", result });
} catch (error) {
  send({
    type: "error",
    code: error.code || null,
    transactionState: error.transactionState || null,
    message: String(error.message || error)
  });
} finally {
  if (experiment) experiment.close();
  if (process.disconnect) process.disconnect();
}
