const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildQualitySafetyReport, renderMarkdown } = require("../scripts/quality-safety-report");

const ROOT = path.resolve(__dirname, "..");

async function api(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json();
  return { response, body };
}

async function login(baseUrl, username, password = "123456") {
  return api(baseUrl, "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
}

function authorized(token, options = {}) {
  return {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    }
  };
}

test("quality safety report covers boundaries, reuse and routes", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  const report = buildQualitySafetyReport({ data });
  assert.equal(report.ok, true);
  assert.equal(report.summary.modeledBoundaries, report.summary.boundaries);
  assert.equal(report.collections.every((item) => item.present && item.rows > 0), true);
  assert.equal(report.reusedCollections.some((item) => item.collection === "diagnosticReports" && item.present), true);
  assert.equal(report.reusedCollections.some((item) => item.collection === "countyMutualRecognitionRecords" && item.present), true);
  assert.equal(report.reusedCollections.some((item) => item.collection === "securityEvents" && item.present), true);
  assert.equal(report.routes.every((item) => item.present), true);
  assert.equal(report.routes.some((item) => item.route.includes("escalate") && item.present), true);
  assert.equal(report.routes.some((item) => item.route.includes("critical-values") && item.route.includes("acknowledge") && item.present), true);
  assert.equal(report.routes.some((item) => item.route.includes("critical-values") && item.route.includes("dispose") && item.present), true);
  assert.equal(report.routes.some((item) => item.route.includes("clinical-pathways") && item.route.includes("review") && item.present), true);
  assert.equal(report.checks.some((item) => item.id === "quality-safety:sla" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "quality-safety:critical-value-loop" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "quality-safety:clinical-pathway-loop" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "quality-safety:policy-basis" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "quality-safety:action-plan" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "quality-safety:risk-ranking" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "quality-safety:site-signoff-tracker" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "quality-safety:go-live-readiness" && item.passed), true);
  assert.equal(report.goLiveReadiness.usable, true);
  assert.equal(report.goLiveReadiness.stage, "controlled_pilot_ready");
  assert.equal(report.summary.readinessScore, 100);
  assert.equal(report.summary.siteSignoffs.total >= 6, true);
  assert.equal(report.siteSignoffs.some((item) => item.id === "qss-audit-retention" && item.requiredEvidence.length > 0), true);
  assert.equal(report.institutionRisks.length > 0, true);
  assert.equal(report.institutionRisks[0].score > 0, true);
  assert.equal(report.criticalValues.length > 0, true);
  assert.equal(report.clinicalPathways.length > 0, true);
  assert.equal(report.policyReferences.every((item) => item.present), true);
  assert.equal(report.actionPlan.some((item) => item.priority === "critical" && item.evidence), true);
  assert.equal(report.rectifications.some((item) => item.slaStatus && item.evidenceComplete), true);
  assert.match(renderMarkdown(report), /Medical quality and safety supervision report/);
  assert.match(renderMarkdown(report), /mutual-recognition-qc/);
  assert.match(renderMarkdown(report), /Critical Value Loop/);
  assert.match(renderMarkdown(report), /Clinical Pathway Loop/);
  assert.match(renderMarkdown(report), /Policy Basis/);
  assert.match(renderMarkdown(report), /Regulatory Action Plan/);
  assert.match(renderMarkdown(report), /Go-live Readiness/);
  assert.match(renderMarkdown(report), /controlled_pilot_ready/);
  assert.match(renderMarkdown(report), /Site Joint-testing Sign-offs/);
  assert.match(renderMarkdown(report), /Institution risk ranking/);
  assert.match(renderMarkdown(report), /Rectification SLA/);
});

test("quality safety API supports dashboard, dispatch, feedback and review", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "quality-safety-test-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  process.env.DATA_DIR = dataDir;
  process.env.STORAGE_ENGINE = "json";
  const { server, startServer, stopServer } = require(path.join(ROOT, "server.js"));
  startServer(0);
  await once(server, "listening");
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    await stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const commissionLogin = await login(baseUrl, "health");
  assert.equal(commissionLogin.response.status, 200);
  const token = commissionLogin.body.token;

  const dashboard = await api(baseUrl, "/api/quality-safety/dashboard", authorized(token));
  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.body.summary.issues >= 3, true);
  assert.equal(dashboard.body.summary.criticalValuesPending >= 1, true);
  assert.equal(dashboard.body.summary.clinicalPathwaysOpen >= 1, true);
  assert.equal(dashboard.body.summary.actionItems >= 1, true);
  assert.equal(dashboard.body.goLiveReadiness.usable, true);
  assert.equal(dashboard.body.goLiveReadiness.stage, "controlled_pilot_ready");
  assert.equal(dashboard.body.summary.readinessScore, 100);
  assert.equal(dashboard.body.summary.siteSignoffs >= 6, true);
  assert.equal(dashboard.body.summary.coreSystems, 18);
  assert.equal(dashboard.body.summary.coreSystemsLinked >= 18, true);
  assert.equal(dashboard.body.coreSystemMatrix.length, 18);
  assert.equal(dashboard.body.coreSystemMatrix.some((item) => item.name === "危急值报告制度" && item.evidenceCollections.includes("criticalValueAlerts")), true);
  assert.equal(dashboard.body.coreSystemMatrix.some((item) => item.name === "信息安全管理制度" && item.evidenceCollections.includes("securityEvents")), true);
  assert.equal(dashboard.body.departmentTaskView.role, "commission");
  assert.equal(dashboard.body.departmentTaskView.profile.permissions.includes("review_rectification"), true);
  assert.equal(dashboard.body.departmentTaskView.metrics.some((item) => item.label === "逾期整改"), true);
  assert.equal(dashboard.body.departmentTaskView.queue.some((item) => item.kind === "action_plan"), true);
  assert.equal(dashboard.body.departmentTaskView.queue.some((item) => item.targetSection === "quality-safety-actions" && item.actionLabel === "查看行动计划"), true);
  assert.equal(dashboard.body.departmentTaskView.queue.some((item) => item.targetSection === "quality-safety-signoffs"), true);
  assert.equal(dashboard.body.siteSignoffs.some((item) => item.id === "qss-live-feeds"), true);
  assert.equal(dashboard.body.actionPlan.some((item) => item.priority === "critical"), true);
  assert.equal(dashboard.body.institutionRisks.length > 0, true);
  assert.equal(dashboard.body.institutionRisks[0].score > 0, true);
  assert.equal(dashboard.body.reusedCollections.some((item) => item.collection === "hospitalInteroperabilityFunctions"), true);
  const critical = dashboard.body.criticalValueAlerts[0];
  const pathway = dashboard.body.clinicalPathwayCases[0];

  const issue = dashboard.body.issues.find((item) => item.id === "qse-path-001") || dashboard.body.issues[0];
  const dispatch = await api(baseUrl, `/api/quality-safety/issues/${encodeURIComponent(issue.id)}/dispatch`, authorized(token, {
    method: "POST",
    body: JSON.stringify({
      ownerRole: "institution",
      owner: "Site quality office",
      requirement: "Submit correction evidence and department sign-off."
    })
  }));
  assert.equal(dispatch.response.status, 201);
  assert.equal(dispatch.body.status, "dispatched");

  const institutionLogin = await login(baseUrl, "hospital");
  assert.equal(institutionLogin.response.status, 200);
  const institutionDashboard = await api(baseUrl, "/api/quality-safety/dashboard", authorized(institutionLogin.body.token));
  assert.equal(institutionDashboard.response.status, 200);
  assert.equal(institutionDashboard.body.role, "institution");
  assert.equal(institutionDashboard.body.departmentTaskView.role, "institution");
  assert.equal(institutionDashboard.body.departmentTaskView.profile.permissions.includes("submit_feedback"), true);
  assert.equal(institutionDashboard.body.departmentTaskView.metrics.some((item) => item.label === "待处置危急值"), true);
  assert.equal(institutionDashboard.body.departmentTaskView.queue.some((item) => item.actionLabel === "提交证据"), true);
  assert.equal(Array.isArray(institutionDashboard.body.institutionRisks), true);
  assert.equal(institutionDashboard.body.siteSignoffs.some((item) => item.id === "qss-critical-routing"), true);
  const siteEvidence = await api(baseUrl, "/api/quality-safety/site-signoffs/qss-critical-routing/evidence", authorized(institutionLogin.body.token, {
    method: "POST",
    body: JSON.stringify({ note: "Critical routing screenshot and receipt uploaded.", evidence: ["critical-routing-screenshot", "ack-receipt"] })
  }));
  assert.equal(siteEvidence.response.status, 200);
  assert.equal(siteEvidence.body.status, "evidence_submitted");
  assert.equal(siteEvidence.body.evidenceCount >= 2, true);
  assert.equal(Array.isArray(siteEvidence.body.submissionTrail), true);
  const acknowledgement = await api(baseUrl, `/api/quality-safety/critical-values/${encodeURIComponent(critical.id)}/acknowledge`, authorized(institutionLogin.body.token, {
    method: "POST",
    body: JSON.stringify({ note: "Duty physician confirmed receipt." })
  }));
  assert.equal(acknowledgement.response.status, 200);
  assert.equal(acknowledgement.body.acknowledgementComplete, true);
  const disposition = await api(baseUrl, `/api/quality-safety/critical-values/${encodeURIComponent(critical.id)}/dispose`, authorized(institutionLogin.body.token, {
    method: "POST",
    body: JSON.stringify({ action: "Disposition note completed and patient contacted.", outcome: "disposed" })
  }));
  assert.equal(disposition.response.status, 200);
  assert.equal(disposition.body.status, "disposed");
  assert.equal(disposition.body.dispositionComplete, true);
  const forbiddenDispatch = await api(baseUrl, `/api/quality-safety/issues/${encodeURIComponent(issue.id)}/dispatch`, authorized(institutionLogin.body.token, {
    method: "POST",
    body: JSON.stringify({ ownerRole: "institution", requirement: "Should be forbidden." })
  }));
  assert.equal(forbiddenDispatch.response.status, 403);
  const forbiddenPathwayReview = await api(baseUrl, `/api/quality-safety/clinical-pathways/${encodeURIComponent(pathway.id)}/review`, authorized(institutionLogin.body.token, {
    method: "POST",
    body: JSON.stringify({ decision: "approved", comment: "Should be forbidden." })
  }));
  assert.equal(forbiddenPathwayReview.response.status, 403);

  const countyLogin = await login(baseUrl, "county");
  assert.equal(countyLogin.response.status, 200);
  const countyDashboard = await api(baseUrl, "/api/quality-safety/dashboard", authorized(countyLogin.body.token));
  assert.equal(countyDashboard.response.status, 200);
  assert.equal(countyDashboard.body.role, "county");
  assert.equal(countyDashboard.body.departmentTaskView.role, "county");
  assert.equal(countyDashboard.body.departmentTaskView.profile.permissions.includes("submit_consortium_evidence"), true);
  assert.equal(countyDashboard.body.departmentTaskView.metrics.some((item) => item.label === "互认待复核"), true);
  assert.equal(countyDashboard.body.departmentTaskView.queue.some((item) => item.targetSection === "quality-safety-signoffs"), true);
  assert.equal(countyDashboard.body.siteSignoffs.some((item) => item.id === "qss-mutual-recognition-rules"), true);
  const countyEvidence = await api(baseUrl, "/api/quality-safety/site-signoffs/qss-mutual-recognition-rules/evidence", authorized(countyLogin.body.token, {
    method: "POST",
    body: JSON.stringify({ note: "Recognition catalog and exception sample uploaded.", evidence: ["recognition-catalog", "exception-sample"] })
  }));
  assert.equal(countyEvidence.response.status, 200);
  assert.equal(countyEvidence.body.status, "evidence_submitted");
  const forbiddenSiteEvidence = await api(baseUrl, "/api/quality-safety/site-signoffs/qss-live-feeds/evidence", authorized(countyLogin.body.token, {
    method: "POST",
    body: JSON.stringify({ note: "Should be forbidden.", evidence: ["wrong-owner"] })
  }));
  assert.equal(forbiddenSiteEvidence.response.status, 403);

  const escalation = await api(baseUrl, `/api/quality-safety/rectifications/${encodeURIComponent(dispatch.body.id)}/escalate`, authorized(token, {
    method: "POST",
    body: JSON.stringify({ reason: "Escalate before site feedback window closes." })
  }));
  assert.equal(escalation.response.status, 200);
  assert.equal(escalation.body.status, "escalated");
  assert.equal(typeof escalation.body.slaStatus, "string");

  const feedback = await api(baseUrl, `/api/quality-safety/rectifications/${encodeURIComponent(dispatch.body.id)}/feedback`, authorized(institutionLogin.body.token, {
    method: "POST",
    body: JSON.stringify({ content: "Evidence uploaded.", attachments: ["qc-evidence"] })
  }));
  assert.equal(feedback.response.status, 200);
  assert.equal(feedback.body.status, "feedback_submitted");
  assert.equal(feedback.body.feedback.length, 1);

  const review = await api(baseUrl, `/api/quality-safety/rectifications/${encodeURIComponent(dispatch.body.id)}/review`, authorized(token, {
    method: "POST",
    body: JSON.stringify({ decision: "approved", comment: "Evidence accepted." })
  }));
  assert.equal(review.response.status, 200);
  assert.equal(review.body.status, "closed");
  const pathwayReview = await api(baseUrl, `/api/quality-safety/clinical-pathways/${encodeURIComponent(pathway.id)}/review`, authorized(token, {
    method: "POST",
    body: JSON.stringify({ decision: "approved", comment: "Pathway variance closed.", evidence: ["emr-follow-up-note"] })
  }));
  assert.equal(pathwayReview.response.status, 200);
  assert.equal(pathwayReview.body.status, "review_passed");
  assert.equal(pathwayReview.body.reviewComplete, true);
  const signoffReview = await api(baseUrl, "/api/quality-safety/site-signoffs/qss-live-feeds/review", authorized(token, {
    method: "POST",
    body: JSON.stringify({ decision: "ready_for_joint_test", note: "Joint-test payload sample archived.", evidence: ["his-emr-lis-pacs-sample"] })
  }));
  assert.equal(signoffReview.response.status, 200);
  assert.equal(signoffReview.body.status, "ready_for_joint_test");
  assert.equal(signoffReview.body.evidenceCount >= 1, true);
  const signoffAccepted = await api(baseUrl, "/api/quality-safety/site-signoffs/qss-critical-routing/review", authorized(token, {
    method: "POST",
    body: JSON.stringify({ decision: "accepted", note: "Institution evidence accepted for controlled pilot.", evidence: ["commission-acceptance-note"] })
  }));
  assert.equal(signoffAccepted.response.status, 200);
  assert.equal(signoffAccepted.body.status, "accepted");
  assert.equal(signoffAccepted.body.normalizedStatus, "closed");
  const forbiddenSignoffReview = await api(baseUrl, "/api/quality-safety/site-signoffs/qss-live-feeds/review", authorized(institutionLogin.body.token, {
    method: "POST",
    body: JSON.stringify({ decision: "accepted", note: "Should be forbidden." })
  }));
  assert.equal(forbiddenSignoffReview.response.status, 403);

  const audit = await api(baseUrl, "/api/audit/export?trail=securityEvents", authorized(token));
  assert.equal(audit.response.status, 200);
  assert.equal(JSON.stringify(audit.body).includes("quality-safety review"), true);
  assert.equal(JSON.stringify(audit.body).includes("quality-safety critical value disposition"), true);
  assert.equal(JSON.stringify(audit.body).includes("quality-safety clinical pathway review"), true);
  assert.equal(JSON.stringify(audit.body).includes("quality-safety site signoff evidence"), true);
  assert.equal(JSON.stringify(audit.body).includes("quality-safety site signoff review"), true);
});
