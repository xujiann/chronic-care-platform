#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "registration-journey-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "registration-journey-readiness-report.md");

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail };
}

function paymentReady(order) {
  return ["paid", "paid-demo", "waived"].includes(order.paymentStatus);
}

function hospitalConfirmed(order) {
  return ["confirmed", "confirmed-demo"].includes(order.hisConfirmationStatus);
}

function disruptionOverdue(disruption, now = Date.now()) {
  if (!disruption || disruption.status !== "pending-resident") return false;
  const dueAt = Date.parse(disruption.acknowledgementDueAt || "");
  return Number.isFinite(dueAt) && dueAt < now;
}

function normalizeRegistrationJourneyOrder(order = {}) {
  let journeyStage = order.journeyStage || "slot-reserved-demo";
  const disruption = order.disruption && typeof order.disruption === "object"
    ? {
        ...order.disruption,
        productionEvidence: false,
        history: Array.isArray(order.disruption.history) ? order.disruption.history : []
      }
    : null;
  const callbackEvidence = Array.isArray(order.auditTrail) && order.auditTrail.some((item) => String(item.action || "").startsWith("integration-"));
  if (paymentReady(order)) journeyStage = order.paymentStatus === "paid" ? "payment-recorded-callback" : "payment-recorded-demo";
  if (hospitalConfirmed(order)) journeyStage = order.hisConfirmationStatus === "confirmed" ? "hospital-confirmed-callback" : "hospital-confirmed-demo";
  if (["checked-in", "checked-in-demo"].includes(order.checkInStatus)) journeyStage = order.checkInStatus === "checked-in" ? "checked-in-callback" : "checked-in-demo";
  if (order.status === "completed") journeyStage = callbackEvidence || order.completionNo ? "completed-callback" : "completed-demo";
  if (order.status === "cancelled") {
    if (order.refundStatus === "refund-pending") journeyStage = "cancelled-refund-pending";
    else if (order.refundStatus === "refund-failed") journeyStage = "cancelled-refund-failed-callback";
    else if (order.refundStatus === "refunded") journeyStage = "cancelled-refunded-callback";
    else if (order.refundStatus === "refunded-demo") journeyStage = "cancelled-refunded-demo";
    else journeyStage = "cancelled";
  }
  if (!["cancelled", "completed", "closed"].includes(order.status)) {
    if (disruption?.status === "pending-resident") journeyStage = "reschedule-response-pending";
    if (disruption?.status === "accepted" && !hospitalConfirmed(order)) journeyStage = "rescheduled-his-confirmation-pending";
  }
  return {
    ...order,
    disruption,
    journeyStage,
    hisConfirmationStatus: order.hisConfirmationStatus || "pending-demo",
    checkInStatus: order.checkInStatus || "not-checked-in",
    productionReady: false,
    auditTrail: Array.isArray(order.auditTrail) ? order.auditTrail : []
  };
}

function registrationJourneyAllowedActions(order, user = {}) {
  const row = normalizeRegistrationJourneyOrder(order);
  const role = user.role || "citizen";
  const actions = [];
  if (row.disruption?.status === "pending-resident") return actions;
  if (row.status === "cancelled") {
    if (row.refundStatus === "refund-pending" && ["commission", "institution"].includes(role)) actions.push("refund-demo");
    return actions;
  }
  if (["completed", "closed"].includes(row.status)) return actions;
  if (row.paymentStatus === "pending" && ["commission", "citizen"].includes(role)) actions.push("pay-demo");
  if (paymentReady(row) && !hospitalConfirmed(row) && ["commission", "institution"].includes(role)) actions.push("confirm-his-demo");
  if (row.insuranceStatus === "prechecked" && ["commission", "insurance"].includes(role)) actions.push("confirm-insurance-demo");
  if (paymentReady(row) && hospitalConfirmed(row) && !["checked-in", "checked-in-demo"].includes(row.checkInStatus) && ["commission", "institution", "citizen"].includes(role)) actions.push("check-in-demo");
  if (["checked-in", "checked-in-demo"].includes(row.checkInStatus) && ["commission", "institution"].includes(role)) actions.push("complete-demo");
  return actions;
}

function registrationDisruptionAllowedActions(order, user = {}) {
  const row = normalizeRegistrationJourneyOrder(order);
  const role = user.role || "citizen";
  if (["cancelled", "completed", "closed"].includes(row.status) || ["checked-in", "checked-in-demo"].includes(row.checkInStatus)) return [];
  if (row.disruption?.status === "pending-resident") {
    if (role === "commission") return ["accept", "cancel", "withdraw"];
    if (role === "institution") return ["withdraw"];
    if (role === "citizen") return ["accept", "cancel"];
    return [];
  }
  if (row.disruption && row.disruption.status !== "withdrawn") return [];
  if (["commission", "institution"].includes(role)) return ["notify"];
  return [];
}

function validateReplacementSchedule(order, schedule = {}) {
  if (!schedule.id) throw new Error("replacement schedule is required");
  if (schedule.id === order.scheduleId) throw new Error("replacement schedule must differ from current schedule");
  if (schedule.status === "closed" || Number(schedule.remaining || 0) <= 0) throw new Error("replacement schedule is unavailable");
  if (order.hospitalCode && schedule.hospitalCode !== order.hospitalCode) throw new Error("replacement schedule must belong to the same hospital");
  if (order.departmentCode && schedule.departmentCode !== order.departmentCode) throw new Error("replacement schedule must belong to the same department");
}

function applyRegistrationDisruptionAction(order, payload = {}, user = {}, replacementSchedule = {}) {
  const action = String(payload.action || "").trim();
  if (!action) throw new Error("action is required");
  if (!registrationDisruptionAllowedActions(order, user).includes(action)) {
    throw new Error(`disruption action ${action} is not allowed for current registration journey`);
  }
  const now = payload.at || new Date().toISOString();
  const actor = user.name || user.username || user.role || "system";
  const note = String(payload.note || payload.reason || "").trim();
  if (note.length < 2) throw new Error("note is required");
  const next = normalizeRegistrationJourneyOrder(order);

  if (action === "notify") {
    validateReplacementSchedule(next, replacementSchedule);
    const type = String(payload.type || "schedule-adjustment").trim();
    if (!["doctor-unavailable", "schedule-adjustment", "clinic-suspended"].includes(type)) throw new Error("unsupported disruption type");
    const acknowledgementDueAt = String(payload.acknowledgementDueAt || "").trim();
    const dueTime = Date.parse(acknowledgementDueAt);
    const nowTime = Date.parse(now);
    if (!Number.isFinite(dueTime) || (Number.isFinite(nowTime) && dueTime <= nowTime)) throw new Error("acknowledgementDueAt must be a future time");
    next.disruption = {
      id: String(payload.id || `regchg-${randomUUID()}`),
      type,
      status: "pending-resident",
      reason: note,
      acknowledgementDueAt,
      notifiedAt: now,
      notifiedBy: actor,
      originalSchedule: {
        scheduleId: next.scheduleId,
        hisScheduleId: next.hisScheduleId || "",
        appointmentDate: next.appointmentDate || "",
        period: next.period || "",
        doctorCode: next.doctorCode || "",
        doctor: next.doctor || "",
        hisVisitId: next.hisVisitId || "",
        registrationNo: next.registrationNo || "",
        queueNo: next.queueNo || "",
        hisConfirmationStatus: next.hisConfirmationStatus || "pending-demo",
        fee: Number(next.fee || 0)
      },
      proposedSchedule: {
        scheduleId: replacementSchedule.id,
        hisScheduleId: replacementSchedule.hisScheduleId || "",
        appointmentDate: replacementSchedule.date || "",
        period: replacementSchedule.period || "",
        doctorCode: replacementSchedule.doctorCode || "",
        doctor: replacementSchedule.doctor || "",
        fee: Number(replacementSchedule.fee || 0),
        remainingAtNotice: Number(replacementSchedule.remaining || 0)
      },
      productionEvidence: false,
      history: [{ at: now, action, by: actor, role: user.role || "unknown", note, productionEvidence: false }]
    };
  }

  if (action === "accept") {
    validateReplacementSchedule(next, replacementSchedule);
    if (replacementSchedule.id !== next.disruption?.proposedSchedule?.scheduleId) throw new Error("replacement schedule does not match disruption notice");
    const originalFee = Number(next.disruption.originalSchedule?.fee ?? next.fee ?? 0);
    const replacementFee = Number(replacementSchedule.fee || 0);
    const feeDifference = Number((replacementFee - originalFee).toFixed(2));
    next.scheduleId = replacementSchedule.id;
    next.hisScheduleId = replacementSchedule.hisScheduleId || replacementSchedule.id;
    next.hospitalCode = replacementSchedule.hospitalCode || next.hospitalCode;
    next.hospital = replacementSchedule.hospital || next.hospital;
    next.departmentCode = replacementSchedule.departmentCode || next.departmentCode;
    next.department = replacementSchedule.department || next.department;
    next.doctorCode = replacementSchedule.doctorCode || "";
    next.doctor = replacementSchedule.doctor || "";
    next.appointmentDate = replacementSchedule.date || "";
    next.period = replacementSchedule.period || "";
    next.fee = replacementFee;
    next.hisVisitId = `HIS-RS-${String(next.id || "ORDER").slice(-8).toUpperCase()}`;
    next.registrationNo = `REG-RS-${String(next.id || "ORDER").slice(-8).toUpperCase()}`;
    next.queueNo = `RS${String(next.id || "00").slice(-2).toUpperCase()}`;
    next.scheduleLockStatus = "confirmed";
    next.hisConfirmationStatus = "pending-demo";
    next.checkInStatus = "not-checked-in";
    next.disruption = {
      ...next.disruption,
      status: "accepted",
      respondedAt: now,
      respondedBy: actor,
      responseNote: note,
      feeDifference,
      paymentAdjustmentStatus: feeDifference > 0 ? "supplement-pending" : feeDifference < 0 ? "partial-refund-pending" : "not-required",
      history: [
        { at: now, action, by: actor, role: user.role || "unknown", note, productionEvidence: false },
        ...(next.disruption?.history || [])
      ].slice(0, 20)
    };
  }

  if (action === "cancel" || action === "withdraw") {
    next.disruption = {
      ...next.disruption,
      status: action === "cancel" ? "cancelled" : "withdrawn",
      respondedAt: now,
      respondedBy: actor,
      responseNote: note,
      history: [
        { at: now, action, by: actor, role: user.role || "unknown", note, productionEvidence: false },
        ...(next.disruption?.history || [])
      ].slice(0, 20)
    };
  }

  next.updatedAt = now;
  next.updatedBy = actor;
  next.productionReady = false;
  next.auditTrail = [
    { at: now, action: `registration-disruption-${action}`, by: actor, role: user.role || "unknown", note, productionEvidence: false },
    ...(Array.isArray(next.auditTrail) ? next.auditTrail : [])
  ].slice(0, 30);
  return normalizeRegistrationJourneyOrder(next);
}

function applyRegistrationJourneyAction(order, payload = {}, user = {}) {
  const action = String(payload.action || "").trim();
  const note = String(payload.note || "").trim();
  if (!action) throw new Error("action is required");
  if (!note) throw new Error("note is required");
  const allowed = registrationJourneyAllowedActions(order, user);
  if (!allowed.includes(action)) throw new Error(`action ${action} is not allowed for current registration journey`);
  const now = payload.at || new Date().toISOString();
  const actor = user.name || user.username || user.role || "system";
  const next = normalizeRegistrationJourneyOrder(order);

  if (action === "pay-demo") {
    next.paymentStatus = "paid-demo";
    next.paymentReceiptNo = `PAYRCPT-DEMO-${String(next.id || "ORDER").slice(-10).toUpperCase()}`;
    next.paidAt = now;
  }
  if (action === "confirm-his-demo") {
    next.hisConfirmationStatus = "confirmed-demo";
    next.hisConfirmedAt = now;
    next.hisConfirmedBy = actor;
  }
  if (action === "confirm-insurance-demo") {
    next.insuranceStatus = "confirmed-demo";
    next.insuranceConfirmationNo = `MI-CONF-DEMO-${String(next.id || "ORDER").slice(-10).toUpperCase()}`;
    next.insuranceConfirmedAt = now;
  }
  if (action === "check-in-demo") {
    next.checkInStatus = "checked-in-demo";
    next.checkedInAt = now;
    next.checkedInBy = actor;
  }
  if (action === "complete-demo") {
    next.status = "completed";
    next.completedAt = now;
    next.completedBy = actor;
    next.completionNote = note;
  }
  if (action === "refund-demo") {
    next.paymentStatus = "refunded-demo";
    next.refundStatus = "refunded-demo";
    next.refundReceiptNo = `REFUND-DEMO-${String(next.id || "ORDER").slice(-10).toUpperCase()}`;
    next.refundedAt = now;
  }

  next.updatedAt = now;
  next.updatedBy = actor;
  next.productionReady = false;
  next.auditTrail = [
    { at: now, action, by: actor, role: user.role || "unknown", note, productionEvidence: false },
    ...(Array.isArray(next.auditTrail) ? next.auditTrail : [])
  ].slice(0, 30);
  return normalizeRegistrationJourneyOrder(next);
}

function buildRegistrationJourneyCenter(orders = []) {
  const rows = orders.map(normalizeRegistrationJourneyOrder);
  return {
    ok: true,
    status: "journey-mvp-onsite-blocked",
    summary: {
      orders: rows.length,
      paymentPending: rows.filter((item) => item.paymentStatus === "pending").length,
      paid: rows.filter(paymentReady).length,
      hospitalConfirmed: rows.filter(hospitalConfirmed).length,
      checkedIn: rows.filter((item) => ["checked-in", "checked-in-demo"].includes(item.checkInStatus)).length,
      completed: rows.filter((item) => item.status === "completed").length,
      refundPending: rows.filter((item) => item.refundStatus === "refund-pending").length,
      refunded: rows.filter((item) => ["refunded", "refunded-demo"].includes(item.refundStatus)).length,
      disruptionPending: rows.filter((item) => item.disruption?.status === "pending-resident").length,
      disruptionOverdue: rows.filter((item) => disruptionOverdue(item.disruption)).length,
      rescheduled: rows.filter((item) => item.disruption?.status === "accepted").length,
      disruptionCancelled: rows.filter((item) => item.disruption?.status === "cancelled").length,
      productionReady: 0,
      onsiteBlockers: 4
    },
    orders: rows,
    blockers: [
      "live hospital HIS schedule lock, confirmation and check-in callback",
      "certified payment and refund gateway with signed receipts",
      "medical-insurance e-voucher settlement and reconciliation callback",
      "onsite appointment policy, service desk and multi-party acceptance"
    ],
    boundary: "本地支付、确认、报到、完成和退费操作仅作为流程验证证据，不代表真实资金交易或生产医院接诊结果。"
  };
}

function buildRegistrationJourneyReadiness(options = {}) {
  const data = options.data || readJson(path.join("data", "db.json"));
  const pkg = options.pkg || readJson("package.json");
  const serverSource = options.serverSource ?? readText("server.js");
  const citizenSource = options.citizenSource ?? readText("citizen.js");
  const citizenHtml = options.citizenHtml ?? readText("citizen.html");
  const institutionSource = options.institutionSource ?? readText("institution.js");
  const institutionHtml = options.institutionHtml ?? readText("institution.html");
  const documentation = options.documentation ?? readText(path.join("docs", "registration-journey-center.md"));
  const manifestSource = options.manifestSource ?? readText(path.join("scripts", "release-artifact-manifest.js"));
  const deploySource = options.deploySource ?? readText(path.join("scripts", "deploy-check.js"));
  const releaseSource = options.releaseSource ?? readText(path.join("scripts", "release-report.js"));
  const center = buildRegistrationJourneyCenter(data.registrationOrders || []);
  const sample = normalizeRegistrationJourneyOrder((data.registrationOrders || [])[0] || { id: "sample", paymentStatus: "pending", insuranceStatus: "prechecked" });
  const checks = [
    check("registrationJourney:model", center.summary.orders >= 1 && center.orders.every((item) => item.productionReady === false && item.journeyStage), `${center.summary.orders} registration journeys`),
    check("registrationJourney:stateMachine", ["pay-demo", "confirm-his-demo", "confirm-insurance-demo", "check-in-demo", "complete-demo", "refund-demo"].every((marker) => readText(path.join("scripts", "registration-journey-readiness.js")).includes(marker)), "six cross-role actions are modeled"),
    check("registrationJourney:productionBoundary", center.summary.productionReady === 0 && center.summary.onsiteBlockers >= 4 && sample.productionReady === false, `production ready 0 / ${center.summary.onsiteBlockers} onsite blockers`),
    check("registrationJourney:api", ["/api/registrations/orders/:id/actions", "registration-journey-action"].every((marker) => serverSource.includes(marker)), "role-scoped action API and audit event are wired"),
    check("registrationJourney:citizenUi", citizenHtml.includes("registration-journey-timeline") && citizenSource.includes("runRegistrationJourneyAction") && citizenSource.includes("data-registration-journey-action"), "resident payment and check-in actions are visible"),
    check("registrationJourney:institutionUi", institutionHtml.includes("registration-journey-workbench") && institutionSource.includes("renderRegistrationJourneyWorkbench") && institutionSource.includes("data-registration-institution-action"), "institution confirmation, completion and refund desk is visible"),
    check("registrationJourney:disruption", serverSource.includes("/api/registrations/orders/:id/disruption") && serverSource.includes("applyRegistrationDisruptionAction") && institutionSource.includes("data-registration-disruption-action") && citizenSource.includes("runRegistrationDisruptionAction") && documentation.includes("resident-acceptance"), "institution disruption notice, resident reschedule or cancellation, inventory transfer and SLA evidence are wired"),
    check("registrationJourney:docs", ["payment", "refund", "HIS", "insurance", "productionReady=false"].every((marker) => documentation.includes(marker)), "cross-role flow and production boundary are documented"),
    check("registrationJourney:releaseWiring", Boolean(pkg.scripts?.["registration:journey-readiness"]) && manifestSource.includes("registration-journey-readiness-report.md") && deploySource.includes("api:registrationJourney") && releaseSource.includes("registrationJourney:readiness"), "package, manifest, deploy and release gates are wired")
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    center,
    checks
  };
}

function renderMarkdown(report) {
  return [
    "# Registration journey readiness report",
    "",
    `- Status: ${report.ok ? "PASS" : "FAIL"}`,
    `- Orders: ${report.center.summary.orders}`,
    `- Paid / hospital confirmed / checked in / completed: ${report.center.summary.paid} / ${report.center.summary.hospitalConfirmed} / ${report.center.summary.checkedIn} / ${report.center.summary.completed}`,
    `- Refund pending / refunded: ${report.center.summary.refundPending} / ${report.center.summary.refunded}`,
    `- Disruption pending / overdue / rescheduled / cancelled: ${report.center.summary.disruptionPending} / ${report.center.summary.disruptionOverdue} / ${report.center.summary.rescheduled} / ${report.center.summary.disruptionCancelled}`,
    `- Production ready: ${report.center.summary.productionReady}`,
    "",
    "## Checks",
    "",
    "| Check | Result | Detail |",
    "|---|---|---|",
    ...report.checks.map((item) => `| ${item.id} | ${item.passed ? "PASS" : "FAIL"} | ${item.detail} |`),
    "",
    "## Production boundary",
    "",
    report.center.boundary,
    "",
    ...report.center.blockers.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = { output: DEFAULT_OUTPUT, markdown: DEFAULT_MARKDOWN };
  argv.forEach((arg) => {
    if (arg.startsWith("--output=")) options.output = path.resolve(ROOT, arg.slice(9));
    if (arg.startsWith("--markdown=")) options.markdown = path.resolve(ROOT, arg.slice(11));
  });
  return options;
}

function writeOutput(report, options = {}) {
  const output = options.output ? path.resolve(ROOT, options.output) : DEFAULT_OUTPUT;
  const markdown = options.markdown ? path.resolve(ROOT, options.markdown) : DEFAULT_MARKDOWN;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdown, `${renderMarkdown(report)}\n`, "utf8");
  return { output, markdown };
}

if (require.main === module) {
  const report = buildRegistrationJourneyReadiness();
  writeOutput(report, parseArgs());
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}

module.exports = {
  applyRegistrationDisruptionAction,
  applyRegistrationJourneyAction,
  buildRegistrationJourneyCenter,
  buildRegistrationJourneyReadiness,
  normalizeRegistrationJourneyOrder,
  parseArgs,
  registrationDisruptionAllowedActions,
  registrationJourneyAllowedActions,
  renderMarkdown,
  writeOutput
};
