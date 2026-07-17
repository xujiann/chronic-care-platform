const LIFE_CHAIN_API = location.protocol === "file:" ? "" : "/api/emergency";

function lifeChainEscape(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[char])); }
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
  } catch (error) { document.querySelector("#lifechain-overview").innerHTML = `<p>${lifeChainEscape(error.message)}</p>`; }
  try {
    const quality = await lifeChainRequest("/life-chain/quality");
    renderLifeChainQuality(quality);
  } catch (error) { document.querySelector("#lifechain-quality").innerHTML = "<p>Quality view is available to emergency-center and hospital roles.</p>"; }
  try {
    const command = await lifeChainRequest("/life-chain/command-center");
    renderLifeChainCommandCenter(command);
  } catch (error) { document.querySelector("#lifechain-command-center").innerHTML = "<p>Command projection is available to emergency-center and hospital roles.</p>"; }
}

function renderLifeChainOverview(item) {
  const node = document.querySelector("#lifechain-overview"); if (!node) return;
  const event = item.activeEvent;
  const eventText = event ? `${event.eventNo} · ${event.status}` : "No resident-scoped active event";
  const taskRows = item.firstAidTasks.map((task) => `<div class="lifechain-row"><strong>First-aid responder</strong><span>${lifeChainEscape(task.status)} · ${lifeChainEscape(task.distanceMeters)} m</span></div>`).join("") || "<p>No first-aid task is currently generated.</p>";
  const greenRows = item.greenChannelPreparations.map((row) => `<div class="lifechain-row"><strong>Green-channel pre-alert</strong><span>${lifeChainEscape(row.channel)} · ${lifeChainEscape(row.status)} ${row.status === "pending-hospital-confirmation" ? `<button type="button" class="secondary" data-green-channel-event="${lifeChainEscape(row.eventId)}">Confirm hospital pre-alert</button>` : ""}</span></div>`).join("") || "<p>No green-channel pre-alert is currently generated.</p>";
  const familyRows = item.familyNotifications.map((row) => `<div class="lifechain-row"><strong>Family notification</strong><span>${lifeChainEscape(row.contactName)} · ${lifeChainEscape(row.status)}</span></div>`).join("") || "<p>No authorized family notification is currently generated.</p>";
  const fallbackRows = item.fallbackDeliveries.map((row) => `<div class="lifechain-row"><strong>Weak-network fallback</strong><span>${lifeChainEscape(row.channel)} · ${lifeChainEscape(row.status)}</span></div>`).join("") || "<p>Network is normal; no fallback task is queued.</p>";
  const authorizationRows = item.authorizations.map((row) => `<div class="lifechain-row"><strong>Device authorization</strong><span>${lifeChainEscape(row.deviceId)} · ${lifeChainEscape(row.active ? "active" : "revoked")} ${row.active ? `<button type="button" class="secondary" data-revoke-authorization="${lifeChainEscape(row.id)}">Revoke authorization</button>` : ""}</span></div>`).join("") || "";
  const cancellation = event?.sos?.autoAuthorized && event?.status === "accepted" && !event?.sos?.reviewStatus ? `<div class="lifechain-row"><strong>False-alert safeguard</strong><span><button type="button" class="secondary" data-cancellation-event="${lifeChainEscape(event.id)}">Request 120 cancellation review</button></span></div>` : "";
  node.innerHTML = `<div class="lifechain-summary"><strong>Active event</strong><span>${lifeChainEscape(eventText)}</span><span>Responder tasks ${item.summary.goldenFourMinuteTasks} · hospital confirmations pending ${item.summary.pendingHospitalConfirmation}</span></div>${authorizationRows}${cancellation}${taskRows}${greenRows}${familyRows}${fallbackRows}`;
}

function renderLifeChainCommandCenter(item) {
  const node = document.querySelector("#lifechain-command-center"); if (!node) return;
  const eventRows = item.activeEvents.map((row) => `${row.eventNo} (${row.status})`).join(" · ") || "no active event";
  node.innerHTML = `<div class="lifechain-summary"><strong>Capacity</strong><span>active events ${item.coverage.activeEvents} · available vehicles ${item.coverage.availableVehicles} · available AED ${item.coverage.availableAed} · responder tasks ${item.coverage.responderTasks}</span></div><div class="lifechain-row"><strong>Operational gap</strong><span>${lifeChainEscape(item.coverage.gap)}</span></div><div class="lifechain-row"><strong>Active events</strong><span>${lifeChainEscape(eventRows)}</span></div><p class="lifechain-boundary">${lifeChainEscape(item.boundary)}</p>`;
}

function renderLifeChainQuality(item) {
  const node = document.querySelector("#lifechain-quality"); if (!node) return;
  node.innerHTML = `<div class="lifechain-summary"><strong>Cases ${item.summary.cases}</strong><span>Automatic SOS ${item.summary.automaticSos} · first-aid coverage ${item.summary.firstAidTaskCoverage} · hospital pre-alerts confirmed ${item.summary.hospitalPrealertsConfirmed}</span></div>${item.rows.map((row) => `<div class="lifechain-row"><strong>${lifeChainEscape(row.eventNo)}</strong><span>${lifeChainEscape(row.qualityState)} · ${lifeChainEscape(row.signal)} · fallback ${lifeChainEscape(row.fallback)}</span></div>`).join("") || "<p>No life-chain cases are available.</p>"}<p class="lifechain-boundary">${lifeChainEscape(item.boundary)}</p>`;
}

async function submitLifeChainForm(event) {
  event.preventDefault();
  const form = event.currentTarget; const payload = Object.fromEntries(new FormData(form).entries());
  const pathByForm = { "lifechain-authorization-form":"/life-chain/authorizations", "lifechain-family-form":"/life-chain/family-contacts", "lifechain-device-sos-form":"/life-chain/device-sos" };
  try {
    const result = await lifeChainRequest(pathByForm[form.id], { method:"POST", body:JSON.stringify(payload) });
    lifeChainMessage(form.id === "lifechain-device-sos-form" ? (result.submission?.deduplicated ? "Duplicate device signal was suppressed; the original SOS remains in the 120 information queue." : "Pre-authorized device SOS submitted to the 120 information queue.") : "Life-chain authorization information saved.");
    await loadLifeChain();
    if (form.id === "lifechain-device-sos-form" && !result.submission?.deduplicated && result.callInstruction?.telUri) location.href = result.callInstruction.telUri;
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
  loadLifeChain();
});
