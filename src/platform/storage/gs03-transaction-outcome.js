"use strict";

// T08 non-production component; T00 owns any future shared-runtime assembly.
// Ports are trusted, exclusive transaction adapters, not request data or proofs.
const active = new WeakSet();
const uncertain = new WeakSet();
const stages = ["begin", "apply", "verify", "commit", "rollback"];

function report(status, phase) {
  return Object.freeze({ status, phase, productionReady: false });
}

async function runGs03Transaction({ environment, port } = {}) {
  if (!["development", "test"].includes(environment) || !port || typeof port !== "object") {
    return report("rejected", "admission");
  }
  if (active.has(port)) return report("busy", "admission");
  if (uncertain.has(port)) return report("unknown", "admission");
  let methods;
  try {
    methods = Object.fromEntries(stages.map((name) => [name, port[name]]));
    if (stages.some((name) => typeof methods[name] !== "function")) {
      return report("rejected", "admission");
    }
  } catch {
    return report("rejected", "admission");
  }
  active.add(port);
  let phase = "begin";
  let commitAttempted = false;
  try {
    if (await methods.begin.call(port) !== true) throw new Error("UNCONFIRMED_BEGIN");
    phase = "apply";
    const kind = await methods.apply.call(port);
    if (kind !== "first" && kind !== "replay") throw new Error("INVALID_RESULT");
    phase = "verify";
    if (await methods.verify.call(port) !== true) throw new Error("UNCONFIRMED_VERIFY");
    phase = "commit";
    commitAttempted = true;
    if (await methods.commit.call(port) !== true) throw new Error("UNCONFIRMED_COMMIT");
    return report(kind === "first" ? "confirmed-first" : "confirmed-replay", phase);
  } catch {
    let rollbackConfirmed = false;
    try {
      rollbackConfirmed = await methods.rollback.call(port) === true;
    } catch {
      // A cleanup error cannot turn an unknown transaction into a rollback.
    }
    if (!commitAttempted && rollbackConfirmed) return report("rolled-back", phase);
    uncertain.add(port);
    return report("unknown", phase);
  } finally {
    active.delete(port);
  }
}

module.exports = { runGs03Transaction };
