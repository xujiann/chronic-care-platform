"use strict";

const OWNER = "T06/physical-examination";
const USE_CASE = "physical-examination-specialized-intake-action-command.v1";

function requirePort(name, port) {
  if (typeof port !== "function") {
    throw new TypeError(`${name} port must be a function`);
  }
  return port;
}

function createPhysicalExaminationSpecializedIntakeActionCommand({
  applySpecializedIntakeAction,
  appendDataAccessLog,
  appendSecurityEvent,
  normalizeState,
  now,
  writeDatabase
} = {}) {
  const applyAction = requirePort("applySpecializedIntakeAction", applySpecializedIntakeAction);
  const appendAccessAudit = requirePort("appendDataAccessLog", appendDataAccessLog);
  const appendSecurityAudit = requirePort("appendSecurityEvent", appendSecurityEvent);
  const normalize = requirePort("normalizeState", normalizeState);
  const currentTime = requirePort("now", now);
  const persist = requirePort("writeDatabase", writeDatabase);

  return Object.freeze({
    execute({ data, intakeId, payload, user }) {
      const intake = applyAction(data, intakeId, payload, {
        actor: user.username || user.role,
        now: currentTime()
      });
      appendAccessAudit(
        data,
        user,
        intake.residentId,
        "专项体检分流处置",
        `${intake.examProgramName} · ${payload.action}`
      );
      appendSecurityAudit({
        actor: user.name,
        role: user.role,
        action: "专项体检分流处置",
        target: intake.id,
        result: "成功",
        detail: `${payload.action} · ${payload.evidenceRef}`
      });
      persist(normalize(data));
      return intake;
    }
  });
}

module.exports = {
  OWNER,
  USE_CASE,
  createPhysicalExaminationSpecializedIntakeActionCommand
};
