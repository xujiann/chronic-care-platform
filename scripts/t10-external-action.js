#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  applyExternalActionCommand,
  evaluateExternalActionGate,
  verifyExternalActionBoard
} = require("../t10-external-action-workflow");

function readJson(file, label) {
  const target = path.resolve(file);
  if (!fs.existsSync(target)) throw new Error(`${label} not found: ${target}`);
  try {
    return JSON.parse(fs.readFileSync(target, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function inspectExternalActionBoard(options = {}) {
  if (!options.board) throw new Error("--board is required");
  const boardPath = path.resolve(options.board);
  const board = readJson(boardPath, "external action board");
  const verification = verifyExternalActionBoard(board);
  if (!verification.ok) {
    return {
      ok: false,
      status: "external-action-board-invalid",
      boardPath,
      verification,
      gates: []
    };
  }
  const trackIds = options.track
    ? [String(options.track)]
    : [...new Set(board.actions.map((item) => item.trackId))].sort();
  const gates = trackIds.map((trackId) => evaluateExternalActionGate(board, trackId, { now: options.now }));
  return {
    ok: true,
    status: "external-action-board-inspected",
    boardPath,
    boardDigest: board.integrity.digest,
    summary: board.summary,
    verification,
    gates
  };
}

function executeExternalActionCommand(options = {}) {
  if (!options.board) throw new Error("--board is required");
  if (!options.command) throw new Error("--command is required");
  const boardPath = path.resolve(options.board);
  const commandPath = path.resolve(options.command);
  const auditPath = path.resolve(options.audit || path.join(path.dirname(boardPath), "external-action-audit-export.json"));
  const lockPath = `${boardPath}.lock`;
  if ([boardPath, lockPath, commandPath].includes(auditPath)) {
    throw new Error("audit path must differ from board, lock and command paths");
  }
  fs.mkdirSync(path.dirname(boardPath), { recursive: true });

  let lockHandle;
  const lockToken = JSON.stringify({
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
    token: crypto.randomUUID()
  });
  try {
    lockHandle = fs.openSync(lockPath, "wx");
    fs.writeFileSync(lockHandle, lockToken, "utf8");
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`external action board is locked: ${lockPath}`);
    throw error;
  }

  try {
    const board = readJson(boardPath, "external action board");
    const command = readJson(commandPath, "external action command");
    const expectedDigest = String(command.expectedBoardDigest || "").trim();
    if (!expectedDigest) throw new Error("expectedBoardDigest is required");
    if (expectedDigest !== board.integrity?.digest) {
      throw new Error(`stale external action command: expected ${expectedDigest}, current ${board.integrity?.digest || "missing"}`);
    }
    const actionId = String(command.actionId || "").trim();
    if (!actionId) throw new Error("actionId is required");
    const nextBoard = applyExternalActionCommand(board, actionId, command);
    const verification = verifyExternalActionBoard(nextBoard);
    if (!verification.ok) throw new Error("updated external action board failed integrity verification");
    const trackIds = [...new Set(nextBoard.actions.map((item) => item.trackId))].sort();
    const gates = trackIds.map((trackId) => evaluateExternalActionGate(nextBoard, trackId, { now: command.occurredAt }));
    const auditExport = {
      contractVersion: nextBoard.contractVersion,
      boardPath,
      generatedAt: command.occurredAt || new Date().toISOString(),
      boardDigest: nextBoard.integrity.digest,
      auditEvents: nextBoard.audit.length,
      audit: nextBoard.audit
    };
    if (!options.dryRun) {
      atomicWriteJson(boardPath, nextBoard);
      atomicWriteJson(auditPath, auditExport);
    }
    return {
      ok: true,
      status: options.dryRun ? "external-action-command-dry-run" : "external-action-command-applied",
      actionId,
      action: command.action,
      boardPath,
      auditPath,
      previousDigest: board.integrity.digest,
      boardDigest: nextBoard.integrity.digest,
      persisted: !options.dryRun,
      summary: nextBoard.summary,
      gates,
      verification
    };
  } finally {
    if (lockHandle !== undefined) fs.closeSync(lockHandle);
    if (fs.existsSync(lockPath) && fs.readFileSync(lockPath, "utf8") === lockToken) fs.unlinkSync(lockPath);
  }
}

function atomicWriteJson(target, value) {
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function parseArgs(argv = process.argv.slice(2)) {
  const [operation, ...argumentsList] = argv;
  if (!["status", "verify", "apply"].includes(operation)) throw new Error("operation must be status, verify or apply");
  const options = { operation };
  for (const argument of argumentsList) {
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument.startsWith("--board=")) options.board = argument.slice("--board=".length);
    else if (argument.startsWith("--command=")) options.command = argument.slice("--command=".length);
    else if (argument.startsWith("--audit=")) options.audit = argument.slice("--audit=".length);
    else if (argument.startsWith("--track=")) options.track = argument.slice("--track=".length);
    else if (argument.startsWith("--now=")) options.now = argument.slice("--now=".length);
    else throw new Error(`unknown argument: ${argument}`);
  }
  if (!options.board) throw new Error("--board is required");
  if (operation === "apply" && !options.command) throw new Error("--command is required for apply");
  return options;
}

function runCli() {
  const options = parseArgs();
  const result = options.operation === "apply"
    ? executeExternalActionCommand(options)
    : inspectExternalActionBoard(options);
  const output = options.operation === "verify"
    ? {
      ok: result.verification?.ok === true,
      status: result.verification?.status || result.status,
      boardPath: result.boardPath,
      boardDigest: result.boardDigest,
      verification: result.verification
    }
    : result;
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exitCode = 1;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  readJson,
  inspectExternalActionBoard,
  executeExternalActionCommand,
  atomicWriteJson,
  parseArgs
};
