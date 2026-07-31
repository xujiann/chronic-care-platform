(function (root, factory) {
  const api = factory(root.CitizenRecordsV1, root.CitizenRecordsV2);
  root.CitizenRecordsPolicy = root.CitizenRecordsPolicy || api;
})(typeof window !== "undefined" ? window : globalThis, function (CitizenRecordsV1, CitizenRecordsV2) {
  "use strict";

  function cleanText(value, maximum = 300) {
    return String(value ?? "").trim().slice(0, maximum);
  }

  function authorizationTargetsUser(record = {}, user = {}) {
    const meta = record.meta || {};
    const granteeIds = new Set([meta.granteeId, meta.granteeResidentId, meta.granteeAccountId].map((value) => cleanText(value, 160)).filter(Boolean));
    return [user.username, user.id, user.residentId, user.accountId]
      .map((value) => cleanText(value, 160))
      .filter(Boolean)
      .some((value) => granteeIds.has(value));
  }

  function authorizationHasScope(record = {}, scope = "health-record-summary") {
    const requestedScope = cleanText(scope, 100);
    const scopes = (Array.isArray(record.meta?.scopes) ? record.meta.scopes : []).map((item) => cleanText(item, 100)).filter(Boolean);
    return Boolean(
      CitizenRecordsV1?.RESIDENT_AUTHORIZATION_SCOPES?.has(requestedScope)
      && scopes.length
      && scopes.every((item) => CitizenRecordsV1.RESIDENT_AUTHORIZATION_SCOPES.has(item))
      && scopes.includes(requestedScope)
    );
  }

  function evaluateCitizenResidentRead(data = {}, user = {}, residentId, options = {}) {
    if (!user || user.role !== "citizen") return { allowed: false, reason: "citizen-role-required" };
    if (!residentId) return { allowed: false, reason: "resident-id-required" };
    if (residentId === user.residentId) return { allowed: true, reason: "self" };
    const account = (Array.isArray(data.accounts) ? data.accounts : []).find((item) => item.id === user.accountId);
    const relationship = (Array.isArray(account?.members) ? account.members : []).find((member) => member.residentId === residentId);
    const relationshipState = CitizenRecordsV2?.relationshipAccessState?.(relationship || {}, options.now || new Date());
    if (!relationshipState?.active) return { allowed: false, reason: "verified-relationship-required" };
    const authorization = (Array.isArray(data.personalRecords) ? data.personalRecords : []).find((record) => (
      record?.residentId === residentId
      && record?.category === "authorizations"
      && authorizationTargetsUser(record, user)
      && authorizationHasScope(record, options.scope)
      && CitizenRecordsV1?.authorizationState(record, options.now || new Date()).active
    ));
    if (!authorization) return { allowed: false, reason: "active-scoped-authorization-required" };
    return { allowed: true, reason: "verified-relationship-and-authorization" };
  }

  return { authorizationHasScope, authorizationTargetsUser, evaluateCitizenResidentRead };
});
