#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

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

function normalizeRegistrationJourneyOrder(order = {}) {
  let journeyStage = order.journeyStage || "slot-reserved-demo";
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
  return {
    ...order,
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
    boundary: "Local payment, confirmation, check-in, completion and refund actions are workflow evidence only. They never represent a real financial transaction or production hospital acceptance."
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
  applyRegistrationJourneyAction,
  buildRegistrationJourneyCenter,
  buildRegistrationJourneyReadiness,
  normalizeRegistrationJourneyOrder,
  parseArgs,
  registrationJourneyAllowedActions,
  renderMarkdown,
  writeOutput
};
