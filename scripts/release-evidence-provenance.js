#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  assessReleaseEvidenceFreshness,
  verifyReleaseEvidenceProvenance
} = require("../src/platform/governance/release-evidence-freshness");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "release-evidence-provenance.json");

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", windowsHide: true }).trim();
}

function sourceState() {
  return {
    sourceCommit: git("rev-parse", "HEAD"),
    sourceCommittedAt: git("show", "-s", "--format=%cI", "HEAD"),
    sourceDirty: Boolean(git("status", "--porcelain"))
  };
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  fs.renameSync(temporary, file);
}

function run(command = process.argv[2] || "status") {
  const state = sourceState();
  if (command === "status" || command === "write") {
    const report = assessReleaseEvidenceFreshness({ root: ROOT, ...state });
    if (command === "write" && report.ok) atomicWrite(DEFAULT_OUTPUT, report);
    return report;
  }
  if (command === "verify") {
    const provenance = JSON.parse(fs.readFileSync(DEFAULT_OUTPUT, "utf8"));
    return verifyReleaseEvidenceProvenance(provenance, { root: ROOT, ...state });
  }
  throw new TypeError("command must be status, write or verify");
}

if (require.main === module) {
  try {
    const report = run();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: "RELEASE_EVIDENCE_PROVENANCE_FAILED", message: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { DEFAULT_OUTPUT, run, sourceState };
