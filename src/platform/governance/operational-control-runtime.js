"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  evaluateOperationalControlPlane,
  loadOperationalControls
} = require("./operational-control-plane");

const MAX_INPUT_BYTES = 1024 * 1024;

function runtimeError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function resolveInputFile(value) {
  const file = String(value || "").trim();
  if (!file || !path.isAbsolute(file)) {
    throw runtimeError(
      "OPERATIONAL_CONTROL_INPUT_PATH_INVALID",
      "operational control input must use an absolute path"
    );
  }
  return path.resolve(file);
}

function readOperationalControlInput(file, options = {}) {
  const resolved = resolveInputFile(file);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    throw runtimeError(
      "OPERATIONAL_CONTROL_INPUT_UNAVAILABLE",
      "operational control input is unavailable"
    );
  }
  const maximumBytes = Number(options.maximumBytes) || MAX_INPUT_BYTES;
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0 || stat.size > maximumBytes) {
    throw runtimeError(
      "OPERATIONAL_CONTROL_INPUT_SIZE_INVALID",
      "operational control input must be a non-empty regular file within the size limit"
    );
  }
  let input;
  try {
    input = JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch {
    throw runtimeError(
      "OPERATIONAL_CONTROL_INPUT_JSON_INVALID",
      "operational control input is not valid JSON"
    );
  }
  if (!input || typeof input !== "object" || Array.isArray(input)
    || input.schemaVersion !== "platform-operational-control-input-v1"
    || !input.snapshot || typeof input.snapshot !== "object"
    || (input.externalEvidence !== undefined && !Array.isArray(input.externalEvidence))) {
    throw runtimeError(
      "OPERATIONAL_CONTROL_INPUT_INVALID",
      "operational control input must contain a snapshot object and optional externalEvidence array"
    );
  }
  return Object.freeze({
    snapshot: structuredClone(input.snapshot),
    externalEvidence: Object.freeze(structuredClone(input.externalEvidence || []))
  });
}

function evaluateOperationalControlRuntime(options = {}) {
  const env = options.env || process.env;
  const input = options.input || readOperationalControlInput(
    options.file || env.PLATFORM_OPERATIONAL_CONTROL_INPUT_FILE,
    options
  );
  return evaluateOperationalControlPlane({
    config: options.config || loadOperationalControls(options.controlFile),
    snapshot: input.snapshot,
    externalEvidence: input.externalEvidence,
    now: options.now || new Date().toISOString()
  });
}

module.exports = {
  MAX_INPUT_BYTES,
  evaluateOperationalControlRuntime,
  readOperationalControlInput,
  resolveInputFile
};
