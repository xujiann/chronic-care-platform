const QUALITY_API_BASE = location.protocol === "file:" ? "" : "/api";

let qualitySafetyState = null;

function qualityToken() {
  return window.HealthCityAuth?.getToken?.() || "";
}

async function qualityApi(pathname, options = {}) {
  const response = await fetch(`${QUALITY_API_BASE}${pathname}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(qualityToken() ? { Authorization: `Bearer ${qualityToken()}` } : {}),
      ...(options.headers || {})
    }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || body.error || "Request failed");
  return body;
}

function text(value) {
  return value === undefined || value === null || value === "" ? "-" : String(value);
}

function setHtml(id, html) {
  const element = document.getElementById(id);
  if (element) element.innerHTML = html;
}

function statusLabel(value) {
  return String(value || "open").replace(/_/g, " ");
}

function renderMetrics(summary) {
  const metrics = [
    ["Issues", summary.issues],
    ["Open", summary.open],
    ["In progress", summary.inProgress],
    ["Reviewing", summary.reviewing],
    ["Closed", summary.closed],
    ["Rectifications", summary.rectifications],
    ["Action items", summary.actionItems || 0],
    ["Site sign-offs", summary.siteSignoffs || 0],
    ["Pathway open", summary.clinicalPathwaysOpen || 0],
    ["Due soon", summary.sla?.dueSoon || 0],
    ["Overdue", summary.sla?.overdue || 0]
  ];
  setHtml("quality-safety-metrics", metrics.map(([label, value]) => `
    <article class="metric-card">
      <span>${label}</span>
      <strong>${value}</strong>
    </article>
  `).join(""));
}

function renderReuse(rows) {
  setHtml("quality-safety-reuse", rows.map((item) => `
    <div class="rule-card">
      <strong>${item.collection}</strong>
      <span>${item.rows} rows</span>
      <p>${item.reusedFor || ""}</p>
    </div>
  `).join(""));
}

function renderRisks(rows) {
  setHtml("quality-safety-risks", `
    <table>
      <thead><tr><th>Institution</th><th>Level</th><th>Score</th><th>Signals</th><th>Next</th></tr></thead>
      <tbody>
        ${rows.map((item) => `
          <tr>
            <td><strong>${text(item.institutionName)}</strong><br /><small>${(item.domains || []).map(statusLabel).join(", ")}</small></td>
            <td>${statusLabel(item.riskLevel)}</td>
            <td>${item.score}</td>
            <td>${text((item.drivers || []).join(", "))}<br /><small>${item.openIssues || 0} open, ${item.dueSoon || 0} due soon, ${item.overdue || 0} overdue</small></td>
            <td>${text(item.nextAction)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `);
}

function renderActionPlan(rows) {
  setHtml("quality-safety-actions", `
    <table>
      <thead><tr><th>Priority</th><th>Owner</th><th>Action</th><th>Reason</th><th>Evidence</th></tr></thead>
      <tbody>
        ${rows.map((item) => `
          <tr>
            <td>${statusLabel(item.priority)}</td>
            <td><strong>${text(item.owner)}</strong><br /><small>${text(item.domain)} / ${text(item.source)}</small></td>
            <td>${text(item.action)}<br /><small>${item.dueAt ? `Due ${text(item.dueAt)}` : ""}</small></td>
            <td>${text(item.reason)}</td>
            <td>${text(item.evidence)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `);
}

function renderGoLiveReadiness(readiness = {}) {
  const checks = readiness.checks || [];
  const signoffs = readiness.productionSignoffPending || [];
  setHtml("quality-safety-readiness", `
    <div class="rule-card">
      <strong>${readiness.usable ? "Controlled pilot ready" : "Release candidate"}</strong>
      <span>${text(readiness.score)} / 100</span>
      <p>${text(readiness.nextAction)}</p>
    </div>
    <div class="rule-card">
      <strong>${statusLabel(readiness.stage)}</strong>
      <span>${readiness.blockers?.length ? `${readiness.blockers.length} blockers` : "no module blockers"}</span>
      <p>${readiness.blockers?.length ? readiness.blockers.map(statusLabel).join(", ") : "Dashboard, closed loop, reuse, risk and action-plan checks are ready for pilot use."}</p>
    </div>
    <div class="rule-card">
      <strong>Readiness checks</strong>
      <span>${checks.filter((item) => item.passed).length}/${checks.length}</span>
      <p>${checks.map((item) => `${item.passed ? "PASS" : "FAIL"} ${item.id}`).join("; ")}</p>
    </div>
    <div class="rule-card">
      <strong>Production sign-off</strong>
      <span>${signoffs.length} site items</span>
      <p>${signoffs.join("; ")}</p>
    </div>
  `);
}

function renderIssues(rows) {
  const canDispatch = qualitySafetyState?.role === "commission";
  setHtml("quality-safety-issues", `
    <table>
      <thead><tr><th>Domain</th><th>Issue</th><th>Status</th><th>Owner</th><th>Action</th></tr></thead>
      <tbody>
        ${rows.map((item) => `
          <tr>
            <td>${text(item.domain)}</td>
            <td><strong>${text(item.title)}</strong><br /><small>${text(item.sourceCollection)} ${text(item.sourceId)}</small></td>
            <td>${statusLabel(item.normalizedStatus || item.status)}</td>
            <td>${text(item.owner || item.institutionName)}</td>
            <td>${canDispatch ? `<button class="inline-action" type="button" data-dispatch="${item.id}">Dispatch</button>` : statusLabel(item.ownerRole || "view")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `);
}

function renderSiteSignoffs(rows) {
  const canReview = qualitySafetyState?.role === "commission";
  setHtml("quality-safety-signoffs", `
    <table>
      <thead><tr><th>Item</th><th>Owner</th><th>Status</th><th>Evidence</th><th>Action</th></tr></thead>
      <tbody>
        ${rows.map((item) => `
          <tr>
            <td><strong>${text(item.item)}</strong><br /><small>${text(item.domain)} / ${text((item.sourceCollections || []).join(", "))}</small></td>
            <td>${text(item.owner)}<br /><small>${statusLabel(item.ownerRole)}</small></td>
            <td>${statusLabel(item.status)}<br /><small>Due ${text(item.dueAt)}</small></td>
            <td>${text(item.requiredEvidenceText)}<br /><small>${item.evidenceCount || 0} uploaded, ${item.auditCount || 0} audit rows</small></td>
            <td>${canReview ? `<button class="inline-action" type="button" data-signoff-review="${item.id}">Record joint-test</button>` : statusLabel("view")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `);
}

function renderRectifications(rows) {
  const role = qualitySafetyState?.role || "";
  const canReview = role === "commission";
  const canFeedback = ["institution", "county", "commission"].includes(role);
  const canEscalate = role === "commission";
  setHtml("quality-safety-rectifications", `
    <table>
      <thead><tr><th>Order</th><th>Requirement</th><th>Status</th><th>SLA</th><th>Evidence</th><th>Action</th></tr></thead>
      <tbody>
        ${rows.map((item) => `
          <tr>
            <td><strong>${item.id}</strong><br /><small>${text(item.institutionName)}</small></td>
            <td>${text(item.requirement)}</td>
            <td>${statusLabel(item.normalizedStatus || item.status)}</td>
            <td>${statusLabel(item.slaStatus)}<br /><small>${item.daysRemaining === null ? "-" : `${item.daysRemaining} days`}</small></td>
            <td>${item.evidenceComplete ? "complete" : "pending"}<br /><small>${(item.feedback || []).length} feedback</small></td>
            <td>
              ${canFeedback ? `<button class="inline-action" type="button" data-feedback="${item.id}">Feedback</button>` : ""}
              ${canReview ? `<button class="inline-action" type="button" data-review="${item.id}">Review</button>` : ""}
              ${canEscalate && item.normalizedStatus !== "closed" ? `<button class="inline-action" type="button" data-escalate="${item.id}">Escalate</button>` : ""}
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `);
}

function renderCritical(rows) {
  const canHandleCritical = ["institution", "commission"].includes(qualitySafetyState?.role || "");
  setHtml("quality-safety-critical", rows.map((item) => `
    <div class="rule-card">
      <strong>${text(item.item)} ${text(item.value)}</strong>
      <span>${statusLabel(item.status)}</span>
      <p>${text(item.action)}</p>
      <small>${item.acknowledgementComplete ? "acknowledged" : "pending acknowledgement"} / ${item.dispositionComplete ? "disposed" : "pending disposition"}</small>
      ${canHandleCritical && !item.acknowledgementComplete ? `<button class="inline-action" type="button" data-critical-ack="${item.id}">Acknowledge</button>` : ""}
      ${canHandleCritical && item.acknowledgementComplete && !item.dispositionComplete ? `<button class="inline-action" type="button" data-critical-dispose="${item.id}">Dispose</button>` : ""}
    </div>
  `).join(""));
}

function renderBoundaries(data) {
  const canReviewPathway = qualitySafetyState?.role === "commission";
  const rows = [
    ...(data.clinicalPathwayCases || []).map((item) => ({ id: item.id, type: "Clinical pathway", name: item.pathwayName, status: item.normalizedStatus || item.status, next: item.varianceReason || item.currentNode, reviewable: item.normalizedStatus !== "closed" })),
    ...(data.medicalRecordQualityReviews || []).map((item) => ({ id: item.id, type: "Medical record QC", name: item.sampleNo, status: item.status, next: item.nextAction })),
    ...(data.mutualRecognitionQualityReviews || []).map((item) => ({ id: item.id, type: "Mutual recognition QC", name: item.item, status: item.status, next: item.nextAction }))
  ];
  setHtml("quality-safety-boundaries", `
    <table>
      <thead><tr><th>Boundary</th><th>Name</th><th>Status</th><th>Next</th><th>Action</th></tr></thead>
      <tbody>
        ${rows.map((item) => `
          <tr>
            <td>${item.type}</td>
            <td>${text(item.name)}</td>
            <td>${statusLabel(item.status)}</td>
            <td>${text(item.next)}</td>
            <td>${canReviewPathway && item.reviewable ? `<button class="inline-action" type="button" data-pathway-review="${item.id}">Review pathway</button>` : statusLabel(item.type === "Clinical pathway" ? "tracked" : "view")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `);
}

function renderQualitySafety(data) {
  qualitySafetyState = data;
  renderMetrics(data.summary || {});
  renderGoLiveReadiness(data.goLiveReadiness || {});
  renderActionPlan(data.actionPlan || []);
  renderRisks(data.institutionRisks || []);
  renderReuse(data.reusedCollections || []);
  renderSiteSignoffs(data.siteSignoffs || []);
  renderIssues(data.issues || []);
  renderRectifications(data.rectifications || []);
  renderCritical(data.criticalValueAlerts || []);
  renderBoundaries(data);
  const updated = document.getElementById("quality-safety-updated");
  if (updated) updated.textContent = data.generatedAt ? new Date(data.generatedAt).toLocaleString() : "";
}

async function loadQualitySafety() {
  try {
    renderQualitySafety(await qualityApi("/quality-safety/dashboard"));
  } catch (error) {
    setHtml("quality-safety-issues", `<p>${error.message}</p>`);
  }
}

async function dispatchIssue(issueId) {
  await qualityApi(`/quality-safety/issues/${encodeURIComponent(issueId)}/dispatch`, {
    method: "POST",
    body: JSON.stringify({
      ownerRole: "institution",
      owner: "Site quality office",
      requirement: "Complete root-cause analysis, correction evidence, and department sign-off."
    })
  });
  await loadQualitySafety();
}

async function submitFeedback(orderId) {
  await qualityApi(`/quality-safety/rectifications/${encodeURIComponent(orderId)}/feedback`, {
    method: "POST",
    body: JSON.stringify({
      content: "Demo feedback submitted from the quality-safety portal.",
      attachments: ["site-evidence-placeholder"]
    })
  });
  await loadQualitySafety();
}

async function reviewOrder(orderId) {
  await qualityApi(`/quality-safety/rectifications/${encodeURIComponent(orderId)}/review`, {
    method: "POST",
    body: JSON.stringify({
      decision: "approved",
      comment: "Demo review approved after feedback evidence check."
    })
  });
  await loadQualitySafety();
}

async function escalateOrder(orderId) {
  await qualityApi(`/quality-safety/rectifications/${encodeURIComponent(orderId)}/escalate`, {
    method: "POST",
    body: JSON.stringify({
      reason: "Manual escalation from the quality-safety portal."
    })
  });
  await loadQualitySafety();
}

async function acknowledgeCritical(alertId) {
  await qualityApi(`/quality-safety/critical-values/${encodeURIComponent(alertId)}/acknowledge`, {
    method: "POST",
    body: JSON.stringify({
      note: "Critical value acknowledged from the quality-safety portal."
    })
  });
  await loadQualitySafety();
}

async function disposeCritical(alertId) {
  await qualityApi(`/quality-safety/critical-values/${encodeURIComponent(alertId)}/dispose`, {
    method: "POST",
    body: JSON.stringify({
      action: "Responsible physician notified; disposition note completed in the source system.",
      outcome: "disposed"
    })
  });
  await loadQualitySafety();
}

async function reviewClinicalPathway(caseId) {
  await qualityApi(`/quality-safety/clinical-pathways/${encodeURIComponent(caseId)}/review`, {
    method: "POST",
    body: JSON.stringify({
      decision: "approved",
      comment: "Clinical pathway variance reviewed and closed from the quality-safety portal.",
      evidence: ["emr-follow-up-note"]
    })
  });
  await loadQualitySafety();
}

async function reviewSiteSignoff(signoffId) {
  await qualityApi(`/quality-safety/site-signoffs/${encodeURIComponent(signoffId)}/review`, {
    method: "POST",
    body: JSON.stringify({
      decision: "ready_for_joint_test",
      note: "Joint-test evidence recorded from the quality-safety portal.",
      evidence: ["site-joint-test-note"]
    })
  });
  await loadQualitySafety();
}

document.addEventListener("click", (event) => {
  const dispatch = event.target.closest("[data-dispatch]");
  const feedback = event.target.closest("[data-feedback]");
  const review = event.target.closest("[data-review]");
  const escalate = event.target.closest("[data-escalate]");
  const criticalAck = event.target.closest("[data-critical-ack]");
  const criticalDispose = event.target.closest("[data-critical-dispose]");
  const pathwayReview = event.target.closest("[data-pathway-review]");
  const signoffReview = event.target.closest("[data-signoff-review]");
  if (dispatch) dispatchIssue(dispatch.dataset.dispatch).catch((error) => alert(error.message));
  if (feedback) submitFeedback(feedback.dataset.feedback).catch((error) => alert(error.message));
  if (review) reviewOrder(review.dataset.review).catch((error) => alert(error.message));
  if (escalate) escalateOrder(escalate.dataset.escalate).catch((error) => alert(error.message));
  if (criticalAck) acknowledgeCritical(criticalAck.dataset.criticalAck).catch((error) => alert(error.message));
  if (criticalDispose) disposeCritical(criticalDispose.dataset.criticalDispose).catch((error) => alert(error.message));
  if (pathwayReview) reviewClinicalPathway(pathwayReview.dataset.pathwayReview).catch((error) => alert(error.message));
  if (signoffReview) reviewSiteSignoff(signoffReview.dataset.signoffReview).catch((error) => alert(error.message));
});

loadQualitySafety();
