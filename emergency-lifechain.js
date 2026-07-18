const { randomUUID } = require("node:crypto");

const AUTO_SIGNALS = new Set(["fall-detected", "cardiac-risk", "hypoxia-risk", "no-motion", "collapse", "chest-pain", "breathing-difficulty", "stroke-suspected"]);
const AUTO_SOS_DEDUPLICATION_WINDOW_MS = 120000;

function now() { return new Date().toISOString(); }
function text(value, max = 240) { return String(value || "").trim().slice(0, max); }
function distanceMeters(latitudeA, longitudeA, latitudeB, longitudeB) {
  const radians = (value) => Number(value) * Math.PI / 180;
  const earth = 6371000;
  const deltaLatitude = radians(latitudeB - latitudeA);
  const deltaLongitude = radians(longitudeB - longitudeA);
  const a = Math.sin(deltaLatitude / 2) ** 2 + Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB)) * Math.sin(deltaLongitude / 2) ** 2;
  return Math.round(earth * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function seed() {
  return {
    emergencySosAuthorizations: [],
    emergencyFamilyContacts: [],
    emergencyResponderProfiles: [
      { id:"responder-demo-01", label:"Verified first-aid responder A", certified:true, availability:"available", latitude:38.9206, longitude:121.6487, dispatchRadiusMeters:1500 },
      { id:"responder-demo-02", label:"Verified first-aid responder B", certified:true, availability:"available", latitude:38.9183, longitude:121.6471, dispatchRadiusMeters:1500 }
    ],
    emergencyFirstAidTasks: [],
    emergencyGreenChannelPreparations: [],
    emergencyFamilyNotifications: [],
    emergencyFallbackDeliveries: [],
    emergencySosSignalLog: [],
    emergencyQualityReviews: []
  };
}

function ensureState(data) {
  const defaults = seed();
  for (const [key, value] of Object.entries(defaults)) if (!Array.isArray(data[key])) data[key] = value;
  return data;
}

function appendAudit(data, user, action, target, detail) {
  if (!Array.isArray(data.emergencyAuditEvents)) data.emergencyAuditEvents = [];
  data.emergencyAuditEvents.unshift({ id:randomUUID(), at:now(), actor:user.name || user.username || user.id || "system", role:user.role || "system", action, target, detail:text(detail, 500) });
  data.emergencyAuditEvents = data.emergencyAuditEvents.slice(0, 1000);
}

function assertCitizen(user) {
  if (user.role !== "citizen" || !user.residentId) throw Object.assign(new Error("A resident-linked citizen account is required"), { status:403 });
}

function assertEventScope(event, user) {
  if (!event) throw Object.assign(new Error("Emergency event not found"), { status:404 });
  if (user.role === "citizen" && event.residentId !== user.residentId) throw Object.assign(new Error("Current citizen cannot access this emergency event"), { status:403 });
  if (!["citizen", "commission", "institution"].includes(user.role)) throw Object.assign(new Error("Current role cannot access life-chain data"), { status:403 });
}

function createAuthorization(data, user, payload = {}) {
  ensureState(data); assertCitizen(user);
  if (![true, "true", "CONFIRM AUTO SOS"].includes(payload.confirmed)) throw Object.assign(new Error("Automatic SOS requires explicit patient authorization"), { status:400 });
  const deviceId = text(payload.deviceId, 80);
  if (!deviceId) throw Object.assign(new Error("A device identifier is required"), { status:400 });
  const item = data.emergencySosAuthorizations.find((row) => row.residentId === user.residentId && row.deviceId === deviceId);
  const record = item || { id:randomUUID(), residentId:user.residentId, deviceId, createdAt:now() };
  Object.assign(record, { active:true, autoCallEnabled:true, allowedSignals:[...AUTO_SIGNALS], consentVersion:"auto-sos-consent-v1", updatedAt:now() });
  if (!item) data.emergencySosAuthorizations.unshift(record);
  appendAudit(data, user, "authorize-auto-sos", record.id, `${deviceId}; ${record.consentVersion}`);
  return record;
}

function revokeAuthorization(data, user, authorizationId, payload = {}) {
  ensureState(data); assertCitizen(user);
  if (![true, "true", "REVOKE AUTO SOS"].includes(payload.confirmed)) throw Object.assign(new Error("Revoking automatic SOS requires an explicit confirmation"), { status:400 });
  const record = data.emergencySosAuthorizations.find((item) => item.id === authorizationId && item.residentId === user.residentId);
  if (!record) throw Object.assign(new Error("Automatic SOS authorization not found"), { status:404 });
  record.active = false;
  record.autoCallEnabled = false;
  record.revokedAt = now();
  record.updatedAt = record.revokedAt;
  appendAudit(data, user, "revoke-auto-sos-authorization", record.id, record.deviceId);
  return record;
}

function addFamilyContact(data, user, payload = {}) {
  ensureState(data); assertCitizen(user);
  if (![true, "true", "CONFIRM FAMILY CONTACT"].includes(payload.confirmed)) throw Object.assign(new Error("Family notification requires explicit authorization"), { status:400 });
  const contactName = text(payload.contactName, 80);
  const phoneMasked = text(payload.phoneMasked, 40);
  if (!contactName || !phoneMasked) throw Object.assign(new Error("Family contact name and masked phone are required"), { status:400 });
  const item = { id:randomUUID(), residentId:user.residentId, contactName, phoneMasked, relation:text(payload.relation || "emergency contact", 40), consentStatus:"active", createdAt:now() };
  data.emergencyFamilyContacts.unshift(item);
  appendAudit(data, user, "add-family-emergency-contact", item.id, contactName);
  return item;
}

function chooseGreenChannel(event, hospitals) {
  const signal = event.sos?.detectedSignal || "";
  const complaint = String(event.chiefComplaint || "").toLowerCase();
  const channel = signal === "stroke-suspected" || complaint.includes("stroke") ? "stroke" : signal === "chest-pain" || signal === "cardiac-risk" || complaint.includes("chest") ? "chest-pain" : "general-emergency";
  const field = channel === "stroke" ? "strokeCenter" : channel === "chest-pain" ? "chestPainCenter" : "emergencyStatus";
  const candidates = hospitals.filter((item) => item.emergencyStatus === "available" && (field === "emergencyStatus" || item[field]));
  return { channel, hospital:candidates.sort((left, right) => Number(left.etaMinutes || 999) - Number(right.etaMinutes || 999))[0] || null };
}

function coordinateEvent(data, user, event, payload = {}) {
  ensureState(data); assertEventScope(event, user);
  const createdAt = now();
  const existing = event.lifeChain || {};
  const latitude = Number(event.location?.latitude);
  const longitude = Number(event.location?.longitude);
  const responders = Number.isFinite(latitude) && Number.isFinite(longitude) ? data.emergencyResponderProfiles.filter((item) => item.certified && item.availability === "available").map((item) => ({ ...item, distanceMeters:distanceMeters(latitude, longitude, item.latitude, item.longitude) })).filter((item) => item.distanceMeters <= item.dispatchRadiusMeters).sort((left, right) => left.distanceMeters - right.distanceMeters).slice(0, 3) : [];
  const taskIds = existing.firstAidTaskIds || responders.map((responder) => {
    const task = { id:randomUUID(), eventId:event.id, responderId:responder.id, responderLabel:responder.label, distanceMeters:responder.distanceMeters, status:"notified", createdAt, instruction:"Retrieve AED if available, begin CPR when indicated, and follow 120 dispatcher instructions." };
    data.emergencyFirstAidTasks.unshift(task); return task.id;
  });
  const prepared = data.emergencyGreenChannelPreparations.find((item) => item.eventId === event.id);
  const selection = chooseGreenChannel(event, data.emergencyHospitals || []);
  const greenChannel = prepared || (selection.hospital ? { id:randomUUID(), eventId:event.id, hospitalId:selection.hospital.id, channel:selection.channel, status:"pending-hospital-confirmation", createdAt, note:"System pre-alert only; hospital acceptance remains a human-confirmed decision." } : null);
  if (!prepared && greenChannel) data.emergencyGreenChannelPreparations.unshift(greenChannel);
  const notifications = existing.familyNotificationIds || data.emergencyFamilyContacts.filter((item) => item.residentId === event.residentId && item.consentStatus === "active").map((contact) => {
    const notification = { id:randomUUID(), eventId:event.id, contactId:contact.id, contactName:contact.contactName, phoneMasked:contact.phoneMasked, status:"queued", createdAt, message:"Emergency SOS was accepted into the 120 information queue. This is not a dispatch confirmation." };
    data.emergencyFamilyNotifications.unshift(notification); return notification.id;
  });
  const networkStatus = text(payload.networkStatus || event.sos?.networkStatus || "online", 20).toLowerCase();
  const fallback = existing.fallbackDeliveryId || (["weak", "offline", "sms-only"].includes(networkStatus) ? { id:randomUUID(), eventId:event.id, channel:"sms-location-fallback", status:"queued-for-certified-gateway", createdAt, location:event.location, reason:networkStatus, boundary:"No actual SMS is sent until a certified messaging gateway is integrated and signed off." } : null);
  if (fallback && !existing.fallbackDeliveryId) data.emergencyFallbackDeliveries.unshift(fallback);
  event.lifeChain = { activatedAt:existing.activatedAt || createdAt, firstAidTaskIds:taskIds, greenChannelPreparationId:greenChannel?.id || existing.greenChannelPreparationId || "", familyNotificationIds:notifications, fallbackDeliveryId:fallback?.id || existing.fallbackDeliveryId || "", networkStatus, stages:["sos-accepted", "first-aid-notified", "green-channel-prealert", "family-notified", fallback ? "weak-network-fallback" : "network-normal"] };
  appendAudit(data, user, "coordinate-golden-four-minutes", event.id, JSON.stringify(event.lifeChain.stages));
  return event.lifeChain;
}

function attachSubmissionResult(event, result) {
  Object.defineProperty(event, "automaticSosSubmission", { value:result, enumerable:false, configurable:true });
  return event;
}

function createAutomaticSos(data, user, payload, EmergencyService) {
  ensureState(data); assertCitizen(user);
  const deviceId = text(payload.deviceId, 80);
  const signal = text(payload.detectedSignal, 40);
  const authorization = data.emergencySosAuthorizations.find((item) => item.residentId === user.residentId && item.deviceId === deviceId && item.active && item.autoCallEnabled);
  if (!authorization) throw Object.assign(new Error("No active automatic SOS authorization exists for this device"), { status:403 });
  if (!authorization.allowedSignals.includes(signal) || !AUTO_SIGNALS.has(signal)) throw Object.assign(new Error("This signal is not authorized for automatic SOS"), { status:400 });
  const riskScore = Math.max(0, Math.min(100, Number(payload.riskScore) || 0));
  if (riskScore < 60) throw Object.assign(new Error("Risk score is below the automatic SOS threshold"), { status:400 });
  const receivedAt = now();
  const sourceSignalId = text(payload.sourceSignalId || payload.signalId || "", 100);
  const duplicate = data.emergencySosSignalLog.find((item) => {
    if (item.residentId !== user.residentId || item.deviceId !== deviceId || item.signal !== signal || item.status !== "accepted") return false;
    if (sourceSignalId && item.sourceSignalId === sourceSignalId) return true;
    const elapsed = Date.parse(receivedAt) - Date.parse(item.receivedAt || "");
    return !sourceSignalId && Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= AUTO_SOS_DEDUPLICATION_WINDOW_MS;
  });
  if (duplicate) {
    data.emergencySosSignalLog.unshift({ id:randomUUID(), eventId:duplicate.eventId, residentId:user.residentId, deviceId, signal, riskScore, sourceSignalId, receivedAt, status:"suppressed-duplicate", suppressedEventId:duplicate.eventId, reason:sourceSignalId ? "replayed-source-signal" : "same-device-signal-within-120-seconds" });
    appendAudit(data, user, "suppress-duplicate-automatic-sos", duplicate.eventId, `${deviceId}; ${signal}; ${sourceSignalId || "time-window"}`);
    const existing = data.emergencyEvents.find((item) => item.id === duplicate.eventId);
    if (!existing) throw Object.assign(new Error("Original automatic SOS event is unavailable"), { status:409 });
    return attachSubmissionResult(existing, { deduplicated:true, eventId:existing.id, reason:sourceSignalId ? "replayed-source-signal" : "same-device-signal-within-120-seconds" });
  }
  const event = EmergencyService.createSosCall(data, user, { ...payload, confirmed:true, detectedSignal:signal, chiefComplaint:text(payload.chiefComplaint || `Automatic device SOS: ${signal}`, 500), source:"device-sos" });
  event.sos.autoAuthorized = true;
  event.sos.authorizationId = authorization.id;
  event.sos.deviceRef = deviceId;
  event.sos.riskScore = riskScore;
  event.sos.networkStatus = text(payload.networkStatus || "online", 20);
  data.emergencySosSignalLog.unshift({ id:randomUUID(), eventId:event.id, residentId:user.residentId, deviceId, signal, riskScore, sourceSignalId, receivedAt, status:"accepted" });
  coordinateEvent(data, user, event, payload);
  appendAudit(data, user, "automatic-device-sos", event.id, `${deviceId}; ${signal}; risk=${riskScore}`);
  return attachSubmissionResult(event, { deduplicated:false, eventId:event.id });
}

function requestAutomaticSosCancellation(data, user, eventId, payload = {}) {
  ensureState(data); assertCitizen(user);
  if (![true, "true", "REQUEST REVIEW"].includes(payload.confirmed)) throw Object.assign(new Error("Cancellation review requires explicit confirmation"), { status:400 });
  const event = data.emergencyEvents.find((item) => item.id === eventId);
  assertEventScope(event, user);
  if (!event.sos?.autoAuthorized) throw Object.assign(new Error("Only an automatic SOS can enter cancellation review"), { status:400 });
  if (event.status !== "accepted") throw Object.assign(new Error("Cancellation review is only available before dispatch"), { status:409 });
  if (event.sos.reviewStatus === "cancellation-requested") return event.sos;
  const requestedAt = now();
  event.sos.reviewStatus = "cancellation-requested";
  event.sos.cancellationRequestedAt = requestedAt;
  event.sos.cancellationReason = text(payload.reason || "Patient requested a human review before dispatch", 300);
  event.timeline.push({ status:"cancellation-review-requested", at:requestedAt, actor:user.name || user.username || user.id, note:event.sos.cancellationReason });
  event.lifeChain = { ...(event.lifeChain || {}), stages:[...(event.lifeChain?.stages || []), "cancellation-review-requested"] };
  data.emergencyQualityReviews.unshift({ id:randomUUID(), eventId, type:"automatic-sos-cancellation-review", status:"pending-120-review", requestedAt, requestedBy:user.name || user.username || user.id, reason:event.sos.cancellationReason });
  appendAudit(data, user, "request-automatic-sos-cancellation-review", event.id, event.sos.cancellationReason);
  return event.sos;
}

function resolveAutomaticSosCancellation(data, user, eventId, payload = {}) {
  ensureState(data);
  if (user.role !== "commission") throw Object.assign(new Error("Only the 120 emergency center can resolve a cancellation review"), { status:403 });
  if (![true, "true", "CONFIRM REVIEW"].includes(payload.confirmed)) throw Object.assign(new Error("Cancellation resolution requires explicit confirmation"), { status:400 });
  const event = data.emergencyEvents.find((item) => item.id === eventId);
  if (!event) throw Object.assign(new Error("Emergency event not found"), { status:404 });
  if (!event.sos?.autoAuthorized || event.sos.reviewStatus !== "cancellation-requested") throw Object.assign(new Error("No pending automatic SOS cancellation review exists"), { status:409 });
  const decision = text(payload.decision, 40);
  if (!["keep-open", "withdraw-before-dispatch"].includes(decision)) throw Object.assign(new Error("Cancellation decision must be keep-open or withdraw-before-dispatch"), { status:400 });
  const resolvedAt = now();
  event.sos.reviewStatus = decision === "keep-open" ? "kept-open" : "withdrawn-before-dispatch";
  event.sos.cancellationResolvedAt = resolvedAt;
  event.sos.cancellationResolvedBy = user.name || user.username || user.id;
  event.sos.cancellationDecision = decision;
  if (decision === "withdraw-before-dispatch") {
    if (event.status !== "accepted") throw Object.assign(new Error("An SOS may only be withdrawn before dispatch"), { status:409 });
    event.status = "closed";
    event.updatedAt = resolvedAt;
  }
  event.timeline.push({ status:decision === "withdraw-before-dispatch" ? "closed" : "cancellation-review-kept-open", at:resolvedAt, actor:user.name || user.username || user.id, note:text(payload.note || decision, 300) });
  const review = data.emergencyQualityReviews.find((item) => item.eventId === eventId && item.type === "automatic-sos-cancellation-review" && item.status === "pending-120-review");
  if (review) Object.assign(review, { status:decision, resolvedAt, resolvedBy:user.name || user.username || user.id, note:text(payload.note || "", 300) });
  appendAudit(data, user, "resolve-automatic-sos-cancellation-review", event.id, decision);
  return event.sos;
}

function confirmGreenChannel(data, user, eventId, payload = {}) {
  ensureState(data);
  if (user.role !== "institution") throw Object.assign(new Error("Only a hospital user can confirm a green-channel pre-alert"), { status:403 });
  const item = data.emergencyGreenChannelPreparations.find((row) => row.eventId === eventId);
  if (!item) throw Object.assign(new Error("Green-channel pre-alert not found"), { status:404 });
  const hospital = (data.emergencyHospitals || []).find((row) => row.id === item.hospitalId);
  if (!hospital || !user.orgCode || hospital.orgCode !== user.orgCode) throw Object.assign(new Error("Current hospital is not the target of this green-channel pre-alert"), { status:403 });
  item.status = "hospital-confirmed"; item.confirmedAt = now(); item.confirmedBy = user.name || user.username; item.note = text(payload.note || "Hospital confirmed pre-alert", 300);
  appendAudit(data, user, "confirm-green-channel-prealert", eventId, item.hospitalId);
  return item;
}

function scopedEvents(data, user) {
  if (user.role === "citizen") return data.emergencyEvents.filter((event) => event.residentId === user.residentId);
  if (user.role !== "institution") return data.emergencyEvents;
  const hospitalIds = new Set((data.emergencyHospitals || []).filter((item) => item.orgCode === user.orgCode).map((item) => item.id));
  const preparedEventIds = new Set((data.emergencyGreenChannelPreparations || []).filter((item) => hospitalIds.has(item.hospitalId)).map((item) => item.eventId));
  return data.emergencyEvents.filter((event) => hospitalIds.has(event.hospitalResponse?.hospitalId) || preparedEventIds.has(event.id));
}
function buildOverview(data, user, eventId = "") {
  ensureState(data);
  if (!["citizen", "commission", "institution"].includes(user.role)) throw Object.assign(new Error("Current role cannot access life-chain data"), { status:403 });
  const events = scopedEvents(data, user);
  const event = eventId ? events.find((row) => row.id === eventId) : events[0];
  const eventIdSet = new Set(events.map((row) => row.id));
  const inScope = (row) => eventIdSet.has(row.eventId) && (!eventId || row.eventId === eventId);
  const taskRows = data.emergencyFirstAidTasks.filter(inScope);
  const preparationRows = data.emergencyGreenChannelPreparations.filter(inScope);
  const familyRows = data.emergencyFamilyNotifications.filter(inScope);
  const fallbackRows = data.emergencyFallbackDeliveries.filter(inScope);
  return { ok:true, generatedAt:now(), activeEvent:event || null, events:events.slice(0, 20), firstAidTasks:taskRows, greenChannelPreparations:preparationRows, familyNotifications:familyRows, fallbackDeliveries:fallbackRows, authorizations:user.role === "citizen" ? data.emergencySosAuthorizations.filter((row) => row.residentId === user.residentId) : [], summary:{ goldenFourMinuteTasks:taskRows.length, pendingHospitalConfirmation:preparationRows.filter((row) => row.status !== "hospital-confirmed").length, queuedFamilyNotifications:familyRows.filter((row) => row.status === "queued").length, weakNetworkFallbacks:fallbackRows.length } };
}

function buildCommandCenter(data, user) {
  ensureState(data); if (!["commission", "institution"].includes(user.role)) throw Object.assign(new Error("Only emergency-center or hospital roles can access the command center"), { status:403 });
  const activeEvents = scopedEvents(data, user).filter((item) => !["closed", "handover-completed"].includes(item.status));
  const availableVehicles = data.emergencyResources.filter((item) => item.status === "available");
  const aedAvailable = (data.emergencyAedSites || []).filter((item) => item.status === "available");
  const hospitalIds = user.role === "institution" ? new Set((data.emergencyHospitals || []).filter((item) => item.orgCode === user.orgCode).map((item) => item.id)) : null;
  const cancellationReviews = user.role === "commission" ? data.emergencyQualityReviews.filter((item) => item.type === "automatic-sos-cancellation-review" && item.status === "pending-120-review") : [];
  return { ok:true, generatedAt:now(), activeEvents, resources:data.emergencyResources, hospitals:user.role === "institution" ? data.emergencyHospitals.filter((item) => hospitalIds.has(item.id)) : data.emergencyHospitals, aedSites:data.emergencyAedSites || [], greenChannelPreparations:user.role === "institution" ? data.emergencyGreenChannelPreparations.filter((item) => hospitalIds.has(item.hospitalId)) : data.emergencyGreenChannelPreparations, cancellationReviews, coverage:{ activeEvents:activeEvents.length, availableVehicles:availableVehicles.length, availableAed:aedAvailable.length, responderTasks:data.emergencyFirstAidTasks.filter((item) => item.status === "notified").length, pendingCancellationReviews:cancellationReviews.length, gap:availableVehicles.length === 0 ? "vehicle-capacity-risk" : aedAvailable.length === 0 ? "aed-data-or-coverage-risk" : "no-current-seed-gap" }, boundary:"Operational projection only; live vehicle, hospital-capacity and AED feeds require signed external integrations." };
}

function buildQualityDashboard(data, user) {
  ensureState(data); if (!["commission", "institution"].includes(user.role)) throw Object.assign(new Error("Only emergency-center or hospital roles can access quality analytics"), { status:403 });
  const visibleEvents = scopedEvents(data, user);
  const visibleEventIds = new Set(visibleEvents.map((event) => event.id));
  const rows = visibleEvents.filter((event) => event.sos || event.lifeChain).map((event) => {
    const chain = event.lifeChain || {};
    const tasks = data.emergencyFirstAidTasks.filter((item) => item.eventId === event.id);
    const green = data.emergencyGreenChannelPreparations.find((item) => item.eventId === event.id);
    return { eventId:event.id, eventNo:event.eventNo, source:event.source, status:event.status, signal:event.sos?.detectedSignal || "manual", automatic:Boolean(event.sos?.autoAuthorized), firstAidTasks:tasks.length, greenChannelStatus:green?.status || "not-created", fallback:Boolean(chain.fallbackDeliveryId), evidenceReady:Boolean(event.handover), qualityState:event.handover ? "closed-loop-complete" : green?.status === "hospital-confirmed" ? "hospital-prealert-confirmed" : "in-progress" };
  });
  return { ok:true, generatedAt:now(), summary:{ cases:rows.length, automaticSos:rows.filter((row) => row.automatic).length, firstAidTaskCoverage:rows.filter((row) => row.firstAidTasks > 0).length, hospitalPrealertsConfirmed:rows.filter((row) => row.greenChannelStatus === "hospital-confirmed").length, weakNetworkFallbacks:rows.filter((row) => row.fallback).length, cancellationReviews:data.emergencyQualityReviews.filter((item) => visibleEventIds.has(item.eventId) && item.type === "automatic-sos-cancellation-review").length, suppressedDuplicateSignals:data.emergencySosSignalLog.filter((item) => visibleEventIds.has(item.eventId) && item.status === "suppressed-duplicate").length, closedLoopEvidence:rows.filter((row) => row.evidenceReady).length }, rows, boundary:"Quality dashboard uses platform timestamps; statutory quality reporting and official emergency performance assessment require locally approved indicators and data signoff." };
}

module.exports = { addFamilyContact, buildCommandCenter, buildOverview, buildQualityDashboard, confirmGreenChannel, coordinateEvent, createAuthorization, createAutomaticSos, ensureState, requestAutomaticSosCancellation, resolveAutomaticSosCancellation, revokeAuthorization, seed };
