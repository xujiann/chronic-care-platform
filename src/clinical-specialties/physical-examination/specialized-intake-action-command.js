"use strict";

const { createHash } = require("node:crypto");

const OWNER = "T06/physical-examination";
const USE_CASE = "physical-examination-specialized-intake-action-command.v2";
const ROUTE = "/api/physical-exams/specialized-intakes/:id/actions";
const ERROR_PREFIX = "PHYSICAL_EXAM_SPECIALIZED_INTAKE";
const RECEIPT_FIELD = "_apiCommandReceipts";
const MAX_RECEIPTS = 50;

function requirePort(name, port) {
  if (typeof port !== "function") {
    throw new TypeError(`${name} port must be a function`);
  }
  return port;
}

function commandError(code, message, statusCode) {
  return Object.assign(new Error(message), { code, statusCode });
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function boundedKey(value, field) {
  if (typeof value !== "string") {
    throw commandError(`${ERROR_PREFIX}_INVALID`, `${field} must be a string`, 400);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 160) {
    throw commandError(`${ERROR_PREFIX}_INVALID`, `${field} is invalid`, 400);
  }
  return normalized;
}

function actorScope(user = {}) {
  return {
    role: String(user.role || "").trim(),
    orgType: String(user.orgType || "").trim().toLowerCase(),
    orgCode: String(user.orgCode || "").trim().toUpperCase(),
    principal: String(user.id || user.username || "").trim()
  };
}

function createCommandIdentity({ idempotencyKey, intakeId, payload, user }) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw commandError(`${ERROR_PREFIX}_INVALID`, "request body must be an object", 400);
  }
  const headerKey = idempotencyKey === undefined ? "" : boundedKey(idempotencyKey, "Idempotency-Key");
  const bodyKey = payload.idempotencyKey === undefined ? "" : boundedKey(payload.idempotencyKey, "idempotencyKey");
  if (headerKey && bodyKey && headerKey !== bodyKey) {
    throw commandError(`${ERROR_PREFIX}_INVALID`, "Idempotency-Key conflicts with body idempotencyKey", 400);
  }
  const selectedKey = headerKey || bodyKey;
  const hasExpectedVersion = Object.hasOwn(payload, "expectedVersion");
  if (selectedKey && !hasExpectedVersion) {
    throw commandError(
      `${ERROR_PREFIX}_EXPECTED_VERSION_REQUIRED`,
      "expectedVersion is required with an explicit idempotency key",
      400
    );
  }
  if (hasExpectedVersion && (!Number.isSafeInteger(payload.expectedVersion) || payload.expectedVersion < 0)) {
    throw commandError(`${ERROR_PREFIX}_INVALID`, "expectedVersion must be a non-negative integer", 400);
  }
  const scope = actorScope(user);
  const canonicalPayload = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "idempotencyKey"));
  return {
    commandKeyHash: selectedKey ? sha256({ route: ROUTE, resourceId: intakeId, scope, selectedKey }) : "",
    explicitContract: Boolean(selectedKey),
    expectedVersion: hasExpectedVersion ? payload.expectedVersion : null,
    requestDigest: sha256({ route: ROUTE, resourceId: intakeId, scope, payload: canonicalPayload })
  };
}

function commandReceipts(intake) {
  return Array.isArray(intake?.[RECEIPT_FIELD]) ? intake[RECEIPT_FIELD] : [];
}

function currentVersion(intake) {
  if (Number.isSafeInteger(intake?.version) && intake.version >= 0) return intake.version;
  return (Array.isArray(intake?.actionHistory) ? intake.actionHistory : [])
    .filter((item) => item?.action && item.action !== "routed").length;
}

function projectIntake(intake) {
  const { [RECEIPT_FIELD]: _receipts, ...projected } = structuredClone(intake || {});
  return projected;
}

function findReplay(intake, command) {
  if (!command.explicitContract) return null;
  const receipt = commandReceipts(intake).find((item) => item.commandKeyHash === command.commandKeyHash);
  if (!receipt) return null;
  if (receipt.requestDigest !== command.requestDigest) {
    throw commandError(
      `${ERROR_PREFIX}_IDEMPOTENCY_CONFLICT`,
      "idempotency key was already used with a different request",
      409
    );
  }
  return receipt;
}

function assertExpectedVersion(intake, command) {
  const version = currentVersion(intake);
  if (command.expectedVersion !== null && command.expectedVersion !== version) {
    throw commandError(
      `${ERROR_PREFIX}_VERSION_CONFLICT`,
      `version conflict: expected ${command.expectedVersion}, current ${version}`,
      409
    );
  }
  return version;
}

function appendReceipt(intake, command, response, now) {
  const receipts = commandReceipts(intake);
  if (receipts.length >= MAX_RECEIPTS) {
    throw commandError(
      `${ERROR_PREFIX}_RECEIPT_CAPACITY_REACHED`,
      "specialized intake command receipt capacity reached",
      409
    );
  }
  intake[RECEIPT_FIELD] = [{
    schemaVersion: "physical-exam-specialized-intake-command-receipt.v1",
    commandKeyHash: command.commandKeyHash,
    requestDigest: command.requestDigest,
    statusCode: 200,
    response: structuredClone(response),
    committedAt: now
  }, ...receipts];
}

function createPhysicalExaminationSpecializedIntakeActionCommand({
  applySpecializedIntakeAction,
  appendDataAccessLog,
  appendSecurityAuditToState,
  normalizeState,
  now,
  writeDatabase
} = {}) {
  const applyAction = requirePort("applySpecializedIntakeAction", applySpecializedIntakeAction);
  const appendAccessAudit = requirePort("appendDataAccessLog", appendDataAccessLog);
  const appendSecurityAudit = requirePort("appendSecurityAuditToState", appendSecurityAuditToState);
  const normalize = requirePort("normalizeState", normalizeState);
  const currentTime = requirePort("now", now);
  const persist = requirePort("writeDatabase", writeDatabase);

  return Object.freeze({
    execute({ data, idempotencyKey, intakeId, payload, user }) {
      const intake = (Array.isArray(data?.physicalExamSpecializedIntakes) ? data.physicalExamSpecializedIntakes : [])
        .find((item) => item.id === intakeId);
      if (!intake) {
        throw commandError(`${ERROR_PREFIX}_NOT_FOUND`, "专项体检分流记录不存在", 404);
      }
      const command = createCommandIdentity({ idempotencyKey, intakeId, payload, user });
      const replay = findReplay(intake, command);
      if (replay) {
        return {
          intake: structuredClone(replay.response.intake),
          idempotentReplay: true
        };
      }
      const version = assertExpectedVersion(intake, command);
      if (command.explicitContract && commandReceipts(intake).length >= MAX_RECEIPTS) {
        throw commandError(
          `${ERROR_PREFIX}_RECEIPT_CAPACITY_REACHED`,
          "specialized intake command receipt capacity reached",
          409
        );
      }
      const committedAt = currentTime();
      const updated = applyAction(data, intakeId, payload, {
        actor: user.username || user.role,
        now: committedAt
      });
      updated.version = version + 1;
      appendAccessAudit(
        data,
        user,
        updated.residentId,
        "专项体检分流处置",
        `${updated.examProgramName} · ${payload.action}`
      );
      appendSecurityAudit(data, {
        actor: user.name,
        role: user.role,
        action: "专项体检分流处置",
        target: updated.id,
        result: "成功",
        detail: `${payload.action} · ${payload.evidenceRef}`
      });
      const publicIntake = projectIntake(updated);
      if (command.explicitContract) appendReceipt(updated, command, { intake: publicIntake }, committedAt);
      persist(normalize(data));
      return { intake: publicIntake, idempotentReplay: false };
    }
  });
}

function physicalExaminationSpecializedIntakeHttpError(error) {
  if (error?.code && Number.isInteger(error.statusCode)) {
    return {
      status: error.statusCode,
      body: {
        error: error.statusCode === 404 ? "Not Found" : error.statusCode === 409 ? "Conflict" : "Bad Request",
        code: error.code,
        message: error.message
      }
    };
  }
  if (/SQLite optimistic lock conflict|version conflict|CAS conflict/i.test(String(error?.message || ""))) {
    return {
      status: 409,
      body: {
        error: "Conflict",
        code: `${ERROR_PREFIX}_VERSION_CONFLICT`,
        message: "resource version changed; refresh and retry"
      }
    };
  }
  if (Number(error?.statusCode) === 404) {
    return { status: 404, body: { error: "Not Found", code: `${ERROR_PREFIX}_NOT_FOUND`, message: error.message } };
  }
  if (Number(error?.statusCode) === 409) {
    return { status: 409, body: { error: "Conflict", code: `${ERROR_PREFIX}_STATE_CONFLICT`, message: error.message } };
  }
  if (Number(error?.statusCode) === 400) {
    return { status: 400, body: { error: "Bad Request", code: `${ERROR_PREFIX}_INVALID`, message: error.message } };
  }
  return {
    status: 500,
    body: {
      error: "Internal Server Error",
      code: `${ERROR_PREFIX}_STORAGE_FAILED`,
      message: "specialized intake command persistence failed"
    }
  };
}

module.exports = {
  ERROR_PREFIX,
  MAX_RECEIPTS,
  OWNER,
  RECEIPT_FIELD,
  ROUTE,
  USE_CASE,
  createPhysicalExaminationSpecializedIntakeActionCommand,
  physicalExaminationSpecializedIntakeHttpError,
  projectIntake
};
