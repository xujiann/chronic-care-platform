const LIFE_CHAIN_API = location.protocol === "file:" ? "" : "/api/emergency";

function lifeChainSafeTelephone(target) {
  if (!window.HealthBrowserSafeUrl) throw Object.assign(new Error("browser safe URL policy is unavailable"), { code: "SAFE_URL_POLICY_UNAVAILABLE" });
  return window.HealthBrowserSafeUrl.navigate(target, {
    capability: "tel",
    allowedPhoneNumbers: ["120"],
    mode: "assign"
  });
}

function lifeChainText(value) { return value == null ? "" : String(value); }

function lifeChainAppend(parent, children) {
  (Array.isArray(children) ? children : [children]).flat(Infinity).forEach((child) => {
    if (child == null) return;
    parent.append(child instanceof Node ? child : document.createTextNode(lifeChainText(child)));
  });
  return parent;
}

function lifeChainElement(tagName, options = {}, children = []) {
  const node = document.createElement(tagName);
  if (options.className) node.className = options.className;
  if (Object.hasOwn(options, "text")) node.textContent = lifeChainText(options.text);
  if (options.type) node.type = options.type;
  Object.entries(options.dataset || {}).forEach(([key, value]) => { node.dataset[key] = lifeChainText(value); });
  return lifeChainAppend(node, children);
}

function lifeChainReplace(selector, children) {
  const target = document.querySelector(selector);
  if (!target) return;
  const fragment = document.createDocumentFragment();
  lifeChainAppend(fragment, children);
  target.replaceChildren(fragment);
}

function lifeChainRow(label, children) {
  return lifeChainElement("div", { className: "lifechain-row" }, [
    lifeChainElement("strong", { text: label }),
    lifeChainElement("span", {}, children)
  ]);
}

function lifeChainButton(label, dataset) {
  return lifeChainElement("button", { type: "button", className: "secondary", text: label, dataset });
}

function lifeChainEmpty(message) {
  return lifeChainElement("p", { text: message });
}
async function lifeChainRequest(path, options = {}) {
  const authFetch = window.HealthCityAuth?.authFetch || fetch;
  const response = await authFetch(`${LIFE_CHAIN_API}${path}`, { headers:{ "Content-Type":"application/json", ...(options.headers || {}) }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || "Life-chain operation failed");
  return body;
}
function lifeChainMessage(message, error = false) {
  const node = document.querySelector("#emergency-message");
  if (!node) return;
  node.hidden = false; node.textContent = message; node.style.color = error ? "#b91c1c" : "#166534";
}

async function loadLifeChain() {
  if (!LIFE_CHAIN_API) return;
  try {
    const overview = await lifeChainRequest("/life-chain/overview");
    renderLifeChainOverview(overview);
  } catch (error) { lifeChainReplace("#lifechain-overview", lifeChainEmpty(error.message)); }
  try {
    const quality = await lifeChainRequest("/life-chain/quality");
    renderLifeChainQuality(quality);
  } catch (error) { lifeChainReplace("#lifechain-quality", lifeChainEmpty("Quality view is available to emergency-center and hospital roles.")); }
  try {
    const command = await lifeChainRequest("/life-chain/command-center");
    renderLifeChainCommandCenter(command);
  } catch (error) { lifeChainReplace("#lifechain-command-center", lifeChainEmpty("Command projection is available to emergency-center and hospital roles.")); }
}

function renderLifeChainOverview(item) {
  const event = item.activeEvent;
  const eventText = event ? `${event.eventNo} · ${event.status}` : "No resident-scoped active event";
  const taskRows = item.firstAidTasks.length
    ? item.firstAidTasks.map((task) => lifeChainRow("First-aid responder", `${lifeChainText(task.status)} · ${lifeChainText(task.distanceMeters)} m`))
    : lifeChainEmpty("No first-aid task is currently generated.");
  const greenRows = item.greenChannelPreparations.length
    ? item.greenChannelPreparations.map((row) => lifeChainRow("Green-channel pre-alert", [
        `${lifeChainText(row.channel)} · ${lifeChainText(row.status)} `,
        row.status === "pending-hospital-confirmation" ? lifeChainButton("Confirm hospital pre-alert", { greenChannelEvent: row.eventId }) : null
      ]))
    : lifeChainEmpty("No green-channel pre-alert is currently generated.");
  const familyRows = item.familyNotifications.length
    ? item.familyNotifications.map((row) => lifeChainRow("Family notification", `${lifeChainText(row.contactName)} · ${lifeChainText(row.status)}`))
    : lifeChainEmpty("No authorized family notification is currently generated.");
  const fallbackRows = item.fallbackDeliveries.length
    ? item.fallbackDeliveries.map((row) => lifeChainRow("Weak-network fallback", `${lifeChainText(row.channel)} · ${lifeChainText(row.status)}`))
    : lifeChainEmpty("Network is normal; no fallback task is queued.");
  const authorizationRows = item.authorizations.map((row) => lifeChainRow("Device authorization", [
    `${lifeChainText(row.deviceId)} · ${row.active ? "active" : "revoked"} `,
    row.active ? lifeChainButton("Revoke authorization", { revokeAuthorization: row.id }) : null
  ]));
  const cancellation = event?.sos?.autoAuthorized && event?.status === "accepted" && !event?.sos?.reviewStatus
    ? lifeChainRow("False-alert safeguard", lifeChainButton("Request 120 cancellation review", { cancellationEvent: event.id }))
    : null;
  lifeChainReplace("#lifechain-overview", [
    lifeChainElement("div", { className: "lifechain-summary" }, [
      lifeChainElement("strong", { text: "Active event" }),
      lifeChainElement("span", { text: eventText }),
      lifeChainElement("span", { text: `Responder tasks ${lifeChainText(item.summary.goldenFourMinuteTasks)} · hospital confirmations pending ${lifeChainText(item.summary.pendingHospitalConfirmation)}` })
    ]),
    authorizationRows,
    cancellation,
    taskRows,
    greenRows,
    familyRows,
    fallbackRows
  ]);
}

function renderLifeChainCommandCenter(item) {
  const eventRows = item.activeEvents.map((row) => `${row.eventNo} (${row.status})`).join(" · ") || "no active event";
  const cancellationRows = (item.cancellationReviews || []).map((row) => lifeChainRow("Automatic SOS cancellation review", [
    `${lifeChainText(row.eventId)} · ${lifeChainText(row.reason)} `,
    lifeChainButton("Keep queue open", { cancellationReviewEvent: row.eventId, cancellationReviewDecision: "keep-open" }),
    " ",
    lifeChainButton("Withdraw before dispatch", { cancellationReviewEvent: row.eventId, cancellationReviewDecision: "withdraw-before-dispatch" })
  ]));
  lifeChainReplace("#lifechain-command-center", [
    lifeChainElement("div", { className: "lifechain-summary" }, [
      lifeChainElement("strong", { text: "Capacity" }),
      lifeChainElement("span", { text: `active events ${lifeChainText(item.coverage.activeEvents)} · available vehicles ${lifeChainText(item.coverage.availableVehicles)} · available AED ${lifeChainText(item.coverage.availableAed)} · responder tasks ${lifeChainText(item.coverage.responderTasks)} · cancellation reviews ${lifeChainText(item.coverage.pendingCancellationReviews || 0)}` })
    ]),
    lifeChainRow("Operational gap", item.coverage.gap),
    lifeChainRow("Active events", eventRows),
    cancellationRows,
    lifeChainElement("p", { className: "lifechain-boundary", text: item.boundary })
  ]);
}

function renderLifeChainQuality(item) {
  const rows = item.rows.length
    ? item.rows.map((row) => lifeChainRow(row.eventNo, `${lifeChainText(row.qualityState)} · ${lifeChainText(row.signal)} · fallback ${lifeChainText(row.fallback)}`))
    : lifeChainEmpty("No life-chain cases are available.");
  lifeChainReplace("#lifechain-quality", [
    lifeChainElement("div", { className: "lifechain-summary" }, [
      lifeChainElement("strong", { text: `Cases ${lifeChainText(item.summary.cases)}` }),
      lifeChainElement("span", { text: `Automatic SOS ${lifeChainText(item.summary.automaticSos)} · first-aid coverage ${lifeChainText(item.summary.firstAidTaskCoverage)} · hospital pre-alerts confirmed ${lifeChainText(item.summary.hospitalPrealertsConfirmed)} · duplicate signals ${lifeChainText(item.summary.suppressedDuplicateSignals)} · cancellation reviews ${lifeChainText(item.summary.cancellationReviews)}` })
    ]),
    rows,
    lifeChainElement("p", { className: "lifechain-boundary", text: item.boundary })
  ]);
}

async function submitLifeChainForm(event) {
  event.preventDefault();
  const form = event.currentTarget; const payload = Object.fromEntries(new FormData(form).entries());
  const pathByForm = { "lifechain-authorization-form":"/life-chain/authorizations", "lifechain-family-form":"/life-chain/family-contacts", "lifechain-device-sos-form":"/life-chain/device-sos" };
  try {
    const result = await lifeChainRequest(pathByForm[form.id], { method:"POST", body:JSON.stringify(payload) });
    lifeChainMessage(form.id === "lifechain-device-sos-form" ? (result.submission?.deduplicated ? "Duplicate device signal was suppressed; the original SOS remains in the 120 information queue." : "Pre-authorized device SOS submitted to the 120 information queue.") : "Life-chain authorization information saved.");
    await loadLifeChain();
    if (form.id === "lifechain-device-sos-form" && !result.submission?.deduplicated && result.callInstruction?.telUri) lifeChainSafeTelephone(result.callInstruction.telUri);
  } catch (error) { lifeChainMessage(error.message, true); }
}

document.addEventListener("DOMContentLoaded", () => {
  ["lifechain-authorization-form", "lifechain-family-form", "lifechain-device-sos-form"].forEach((id) => document.querySelector(`#${id}`)?.addEventListener("submit", submitLifeChainForm));
  document.querySelector("#lifechain-overview")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-green-channel-event], [data-revoke-authorization], [data-cancellation-event]");
    if (!button) return;
    try {
      if (button.dataset.revokeAuthorization) {
        if (!window.confirm("Revoke automatic SOS for this device?")) return;
        await lifeChainRequest(`/life-chain/authorizations/${encodeURIComponent(button.dataset.revokeAuthorization)}/revoke`, { method:"POST", body:JSON.stringify({ confirmed:true }) });
        lifeChainMessage("Automatic SOS authorization revoked.");
      } else if (button.dataset.cancellationEvent) {
        if (!window.confirm("Request a 120 human review for this automatic SOS? This does not cancel a dispatched ambulance.")) return;
        await lifeChainRequest(`/events/${encodeURIComponent(button.dataset.cancellationEvent)}/automatic-sos-cancellation-request`, { method:"POST", body:JSON.stringify({ confirmed:true, reason:"Requested from the patient emergency portal" }) });
        lifeChainMessage("Cancellation review has been sent to the 120 queue; dispatch staff must make the final decision.");
      } else {
        await lifeChainRequest(`/events/${encodeURIComponent(button.dataset.greenChannelEvent)}/green-channel/confirm`, { method:"POST", body:JSON.stringify({ note:"Confirmed from emergency life-chain workbench" }) });
        lifeChainMessage("Hospital green-channel pre-alert confirmed.");
      }
      await loadLifeChain();
    }
    catch (error) { lifeChainMessage(error.message, true); }
  });
  document.querySelector("#lifechain-command-center")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-cancellation-review-event]");
    if (!button) return;
    const decision = button.dataset.cancellationReviewDecision;
    if (!window.confirm(decision === "withdraw-before-dispatch" ? "Confirm that 120 has reviewed the request and withdraw this queue item before dispatch?" : "Confirm that 120 has reviewed the request and will keep this queue item open?")) return;
    try {
      await lifeChainRequest(`/events/${encodeURIComponent(button.dataset.cancellationReviewEvent)}/automatic-sos-cancellation-resolve`, { method:"POST", body:JSON.stringify({ confirmed:true, decision, note:"Resolved from emergency command workbench" }) });
      lifeChainMessage(decision === "withdraw-before-dispatch" ? "120 cancellation review completed; the pre-dispatch queue item was withdrawn." : "120 cancellation review completed; the queue item remains open.");
      await loadLifeChain();
    } catch (error) { lifeChainMessage(error.message, true); }
  });
  loadLifeChain();
});
