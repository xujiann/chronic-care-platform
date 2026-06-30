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
    ["Rectifications", summary.rectifications]
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

function renderIssues(rows) {
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
            <td><button class="inline-action" type="button" data-dispatch="${item.id}">Dispatch</button></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `);
}

function renderRectifications(rows) {
  setHtml("quality-safety-rectifications", `
    <table>
      <thead><tr><th>Order</th><th>Requirement</th><th>Status</th><th>Feedback</th><th>Action</th></tr></thead>
      <tbody>
        ${rows.map((item) => `
          <tr>
            <td><strong>${item.id}</strong><br /><small>${text(item.institutionName)}</small></td>
            <td>${text(item.requirement)}</td>
            <td>${statusLabel(item.normalizedStatus || item.status)}</td>
            <td>${(item.feedback || []).length}</td>
            <td>
              <button class="inline-action" type="button" data-feedback="${item.id}">Feedback</button>
              <button class="inline-action" type="button" data-review="${item.id}">Review</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `);
}

function renderCritical(rows) {
  setHtml("quality-safety-critical", rows.map((item) => `
    <div class="rule-card">
      <strong>${text(item.item)} ${text(item.value)}</strong>
      <span>${statusLabel(item.status)}</span>
      <p>${text(item.action)}</p>
    </div>
  `).join(""));
}

function renderBoundaries(data) {
  const rows = [
    ...(data.clinicalPathwayCases || []).map((item) => ({ type: "Clinical pathway", name: item.pathwayName, status: item.status, next: item.varianceReason || item.currentNode })),
    ...(data.medicalRecordQualityReviews || []).map((item) => ({ type: "Medical record QC", name: item.sampleNo, status: item.status, next: item.nextAction })),
    ...(data.mutualRecognitionQualityReviews || []).map((item) => ({ type: "Mutual recognition QC", name: item.item, status: item.status, next: item.nextAction }))
  ];
  setHtml("quality-safety-boundaries", `
    <table>
      <thead><tr><th>Boundary</th><th>Name</th><th>Status</th><th>Next</th></tr></thead>
      <tbody>
        ${rows.map((item) => `
          <tr>
            <td>${item.type}</td>
            <td>${text(item.name)}</td>
            <td>${statusLabel(item.status)}</td>
            <td>${text(item.next)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `);
}

function renderQualitySafety(data) {
  qualitySafetyState = data;
  renderMetrics(data.summary || {});
  renderReuse(data.reusedCollections || []);
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

document.addEventListener("click", (event) => {
  const dispatch = event.target.closest("[data-dispatch]");
  const feedback = event.target.closest("[data-feedback]");
  const review = event.target.closest("[data-review]");
  if (dispatch) dispatchIssue(dispatch.dataset.dispatch).catch((error) => alert(error.message));
  if (feedback) submitFeedback(feedback.dataset.feedback).catch((error) => alert(error.message));
  if (review) reviewOrder(review.dataset.review).catch((error) => alert(error.message));
});

loadQualitySafety();
