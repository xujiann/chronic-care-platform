"use strict";

const fs = require("node:fs");
const path = require("node:path");

const Core = require("../resident-mini-program-core");
const Adapter = require("../resident-mini-program-adapter");

const root = path.resolve(__dirname, "..");

function visibleHtmlText(source) {
  return String(source || "")
    .replace(/<!doctype[^>]*>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|times|middot);/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scanTextGroups(groups = {}) {
  return Object.entries(groups).flatMap(([group, values]) => (
    Core.findEnglishBusinessCopy(Array.isArray(values) ? values : [values])
      .map((text) => ({ group, text }))
  ));
}

function assessChineseCopy() {
  const html = fs.readFileSync(path.join(root, "resident-mini-program.html"), "utf8");
  const shellText = visibleHtmlText(html);
  const statusText = Object.values(Core.STATUS_LABELS);
  const reasonText = [
    "missing-session",
    "session-expired",
    "subject-mismatch",
    "server-session-expired",
    "verified-relationship-required",
    "active-scoped-authorization-required",
    "unknown"
  ].map(Core.reasonLabel);
  const bridgeText = [
    Adapter.classifyFailure({ errMsg: "cancel" }),
    Adapter.classifyFailure({ errorMessage: "deny" }),
    Adapter.classifyFailure({ message: "timeout" }),
    Adapter.classifyFailure({ message: "failed" })
  ].map((item) => item.message);
  const groups = {
    shell: Core.findEnglishBusinessCopy([shellText]),
    statuses: Core.findEnglishBusinessCopy(statusText),
    reasons: Core.findEnglishBusinessCopy(reasonText),
    platformFailures: Core.findEnglishBusinessCopy(bridgeText),
    platformCapabilities: Core.findEnglishBusinessCopy(Object.values(Adapter.CAPABILITY_MESSAGES))
  };
  const violations = Object.entries(groups).flatMap(([group, rows]) => rows.map((text) => ({ group, text })));
  return {
    ready: violations.length === 0,
    scannedGroups: Object.keys(groups),
    violations
  };
}

if (require.main === module) {
  const result = assessChineseCopy();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ready) process.exitCode = 1;
}

module.exports = { assessChineseCopy, scanTextGroups, visibleHtmlText };
