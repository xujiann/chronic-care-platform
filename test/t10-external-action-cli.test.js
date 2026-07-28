"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildSpecialtyPlanReview } = require("../t10-specialty-plan-review");
const { createExternalActionBoard } = require("../t10-external-action-workflow");
const {
  inspectExternalActionBoard,
  executeExternalActionCommand,
  parseArgs
} = require("../scripts/t10-external-action");

const GENERATED_AT = "2026-07-29T00:00:00.000Z";

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "t10-external-action-cli-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const board = createExternalActionBoard(buildSpecialtyPlanReview({
    selectedTrackIds: ["emergency-life-chain"],
    generatedAt: GENERATED_AT
  }));
  const boardPath = path.join(directory, "external-action-board.json");
  const commandPath = path.join(directory, "command.json");
  fs.writeFileSync(boardPath, `${JSON.stringify(board, null, 2)}\n`, "utf8");
  return { directory, board, boardPath, commandPath };
}

function writeCommand(target, command) {
  fs.writeFileSync(target, `${JSON.stringify(command, null, 2)}\n`, "utf8");
}

test("status verifies the board and reports track gates without mutation", (t) => {
  const fx = fixture(t);
  const before = fs.readFileSync(fx.boardPath, "utf8");
  const result = inspectExternalActionBoard({
    board: fx.boardPath,
    track: "emergency-life-chain",
    now: GENERATED_AT
  });
  assert.equal(result.ok, true);
  assert.equal(result.gates.length, 1);
  assert.equal(result.gates[0].summary.openP0, 2);
  assert.equal(result.gates[0].productionReady, false);
  assert.equal(fs.readFileSync(fx.boardPath, "utf8"), before);
});

test("apply uses optimistic locking and atomically persists the board and audit export", (t) => {
  const fx = fixture(t);
  writeCommand(fx.commandPath, {
    actionId: "EMG-NEXT-01",
    action: "assign",
    actorId: "project-office",
    assigneeId: "emergency-owner",
    expectedBoardDigest: fx.board.integrity.digest,
    occurredAt: "2026-07-29T01:00:00.000Z"
  });
  const result = executeExternalActionCommand({ board: fx.boardPath, command: fx.commandPath });
  const persisted = JSON.parse(fs.readFileSync(fx.boardPath, "utf8"));
  const audit = JSON.parse(fs.readFileSync(path.join(fx.directory, "external-action-audit-export.json"), "utf8"));
  assert.equal(result.status, "external-action-command-applied");
  assert.equal(result.persisted, true);
  assert.notEqual(result.boardDigest, result.previousDigest);
  assert.equal(persisted.actions.find((item) => item.id === "EMG-NEXT-01").assigneeId, "emergency-owner");
  assert.equal(audit.boardDigest, persisted.integrity.digest);
  assert.equal(audit.auditEvents, 1);
  assert.equal(fs.existsSync(`${fx.boardPath}.lock`), false);
});

test("stale command is rejected without changing the board", (t) => {
  const fx = fixture(t);
  const before = fs.readFileSync(fx.boardPath, "utf8");
  writeCommand(fx.commandPath, {
    actionId: "EMG-NEXT-01",
    action: "assign",
    actorId: "project-office",
    assigneeId: "emergency-owner",
    expectedBoardDigest: `sha256:${"0".repeat(64)}`,
    occurredAt: "2026-07-29T01:00:00.000Z"
  });
  assert.throws(
    () => executeExternalActionCommand({ board: fx.boardPath, command: fx.commandPath }),
    /stale external action command/
  );
  assert.equal(fs.readFileSync(fx.boardPath, "utf8"), before);
  assert.equal(fs.existsSync(`${fx.boardPath}.lock`), false);
});

test("an existing lock fails closed and is not removed by a competing process", (t) => {
  const fx = fixture(t);
  writeCommand(fx.commandPath, {});
  fs.writeFileSync(`${fx.boardPath}.lock`, "other-process", "utf8");
  assert.throws(
    () => executeExternalActionCommand({ board: fx.boardPath, command: fx.commandPath }),
    /board is locked/
  );
  assert.equal(fs.readFileSync(`${fx.boardPath}.lock`, "utf8"), "other-process");
});

test("dry run returns the next digest but leaves board and audit files untouched", (t) => {
  const fx = fixture(t);
  const before = fs.readFileSync(fx.boardPath, "utf8");
  writeCommand(fx.commandPath, {
    actionId: "EMG-NEXT-01",
    action: "assign",
    actorId: "project-office",
    assigneeId: "emergency-owner",
    expectedBoardDigest: fx.board.integrity.digest,
    occurredAt: "2026-07-29T01:00:00.000Z"
  });
  const result = executeExternalActionCommand({
    board: fx.boardPath,
    command: fx.commandPath,
    dryRun: true
  });
  assert.equal(result.status, "external-action-command-dry-run");
  assert.equal(result.persisted, false);
  assert.notEqual(result.boardDigest, fx.board.integrity.digest);
  assert.equal(fs.readFileSync(fx.boardPath, "utf8"), before);
  assert.equal(fs.existsSync(path.join(fx.directory, "external-action-audit-export.json")), false);
});

test("audit export cannot overwrite the canonical board, lock or command", (t) => {
  const fx = fixture(t);
  writeCommand(fx.commandPath, {
    actionId: "EMG-NEXT-01",
    action: "assign",
    actorId: "project-office",
    assigneeId: "emergency-owner",
    expectedBoardDigest: fx.board.integrity.digest
  });
  for (const audit of [fx.boardPath, `${fx.boardPath}.lock`, fx.commandPath]) {
    assert.throws(
      () => executeExternalActionCommand({ board: fx.boardPath, command: fx.commandPath, audit }),
      /audit path must differ/
    );
  }
  assert.equal(JSON.parse(fs.readFileSync(fx.boardPath, "utf8")).integrity.digest, fx.board.integrity.digest);
});

test("invalid or tampered board cannot be inspected or advanced", (t) => {
  const fx = fixture(t);
  const tampered = JSON.parse(fs.readFileSync(fx.boardPath, "utf8"));
  tampered.summary.total = 99;
  fs.writeFileSync(fx.boardPath, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");
  const status = inspectExternalActionBoard({ board: fx.boardPath });
  assert.equal(status.ok, false);
  writeCommand(fx.commandPath, {
    actionId: "EMG-NEXT-01",
    action: "assign",
    actorId: "project-office",
    assigneeId: "emergency-owner",
    expectedBoardDigest: fx.board.integrity.digest
  });
  assert.throws(
    () => executeExternalActionCommand({ board: fx.boardPath, command: fx.commandPath }),
    /integrity verification failed/
  );
});

test("CLI parser separates read-only and mutating operations", () => {
  assert.deepEqual(parseArgs(["status", "--board=board.json", "--track=clinical-blood", "--now=2026-07-29T00:00:00.000Z"]), {
    operation: "status",
    board: "board.json",
    track: "clinical-blood",
    now: "2026-07-29T00:00:00.000Z"
  });
  assert.deepEqual(parseArgs(["apply", "--board=board.json", "--command=command.json", "--dry-run"]), {
    operation: "apply",
    board: "board.json",
    command: "command.json",
    dryRun: true
  });
  assert.throws(() => parseArgs(["apply", "--board=board.json"]), /--command is required/);
  assert.throws(() => parseArgs(["unknown", "--board=board.json"]), /operation must be/);
});
