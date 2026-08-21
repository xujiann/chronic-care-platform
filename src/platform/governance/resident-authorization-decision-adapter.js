"use strict";

function stringValue(value) {
  return String(value ?? "").trim();
}

function uniqueScopes(value) {
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))].sort();
}

function denied(code, authorizationId = "", authorizationVersion = null, blockers = []) {
  return Object.freeze({
    found: Boolean(authorizationId),
    allowed: false,
    code,
    authorizationId,
    authorizationVersion,
    blockers: Object.freeze([...blockers].sort())
  });
}

function createResidentAuthorizationDecisionAdapter(dependencies = {}) {
  if (typeof dependencies.authorizationState !== "function"
    || typeof dependencies.buildAuthorizationLifecycle !== "function") {
    throw new TypeError("resident authorization decision adapter requires authorization state and lifecycle ports");
  }

  function decide(data, input = {}) {
    const records = (Array.isArray(data?.personalRecords) ? data.personalRecords : [])
      .filter((record) => record?.category === "authorizations" && record?.residentId === input.residentId);
    let record = input.authorizationId
      ? records.find((candidate) => stringValue(candidate?.id) === input.authorizationId)
      : null;
    if (!input.authorizationId && !input.production) {
      record = records.find((candidate) =>
        dependencies.authorizationState(candidate, input.nowDate).key !== "revoked") || records[0];
    }
    if (!record) return denied("REGIONAL_SHARING_AUTHORIZATION_NOT_FOUND");

    const authorizationId = stringValue(record.id);
    if (!authorizationId || authorizationId.length > 200) {
      return denied("REGIONAL_SHARING_AUTHORIZATION_EVIDENCE_INVALID");
    }
    const rawVersion = record?.meta?.version ?? record?.version;
    const hasVersion = rawVersion !== undefined && rawVersion !== null && rawVersion !== "";
    const authorizationVersion = hasVersion ? Number(rawVersion) : null;
    if (hasVersion && (!Number.isInteger(authorizationVersion) || authorizationVersion < 0)) {
      return denied("REGIONAL_SHARING_AUTHORIZATION_EVIDENCE_INVALID", authorizationId);
    }

    const blockers = new Set();
    const state = dependencies.authorizationState(record, input.nowDate);
    const lifecycle = dependencies.buildAuthorizationLifecycle([record], input.nowDate, 30).items[0] || {};
    if (state.key === "revoked" || lifecycle.lifecycleKey === "revoked") {
      return denied("REGIONAL_SHARING_AUTHORIZATION_REVOKED", authorizationId, authorizationVersion);
    }
    if (input.production && !lifecycle.active) {
      return denied("REGIONAL_SHARING_AUTHORIZATION_INACTIVE", authorizationId, authorizationVersion);
    }
    if (!input.production && !lifecycle.active) blockers.add("AUTHORIZATION_LIFECYCLE_INCOMPLETE");

    const granteeId = stringValue(
      record?.meta?.granteeId || record?.meta?.granteeAccountId || record?.meta?.granteeResidentId
    );
    if (granteeId.length > 160) {
      return denied("REGIONAL_SHARING_AUTHORIZATION_EVIDENCE_INVALID", authorizationId, authorizationVersion);
    }
    if (input.actorRole === "commission" && !input.production) {
      blockers.add("COMMISSION_LEGACY_SCOPE");
    } else if (granteeId && granteeId !== input.actorOrgCode) {
      return denied("REGIONAL_SHARING_AUTHORIZATION_GRANTEE_DENIED", authorizationId, authorizationVersion);
    } else if (!granteeId) {
      if (input.production) {
        return denied("REGIONAL_SHARING_AUTHORIZATION_GRANTEE_REQUIRED", authorizationId, authorizationVersion);
      }
      blockers.add("AUTHORIZATION_GRANTEE_MISSING");
    }

    const purpose = stringValue(record?.meta?.purpose);
    if (purpose.length > 300) {
      return denied("REGIONAL_SHARING_AUTHORIZATION_EVIDENCE_INVALID", authorizationId, authorizationVersion);
    }
    if (purpose && purpose !== input.purposeCode) {
      return denied("REGIONAL_SHARING_AUTHORIZATION_PURPOSE_DENIED", authorizationId, authorizationVersion);
    }
    if (!purpose) {
      if (input.production) {
        return denied("REGIONAL_SHARING_AUTHORIZATION_PURPOSE_REQUIRED", authorizationId, authorizationVersion);
      }
      blockers.add("AUTHORIZATION_PURPOSE_MISSING");
    }

    const rawScopes = record?.meta?.scopes;
    if (rawScopes !== undefined && (!Array.isArray(rawScopes)
      || rawScopes.length > 20
      || rawScopes.some((scope) => typeof scope !== "string" || !scope.trim() || scope.trim().length > 100))) {
      return denied("REGIONAL_SHARING_AUTHORIZATION_EVIDENCE_INVALID", authorizationId, authorizationVersion);
    }
    const scopes = Array.isArray(rawScopes) ? uniqueScopes(rawScopes) : [];
    if (scopes.length && input.requestedScopes.some((scope) => !scopes.includes(scope))) {
      return denied("REGIONAL_SHARING_AUTHORIZATION_SCOPE_DENIED", authorizationId, authorizationVersion);
    }
    if (!scopes.length) {
      if (input.production) {
        return denied("REGIONAL_SHARING_AUTHORIZATION_SCOPES_REQUIRED", authorizationId, authorizationVersion);
      }
      blockers.add("AUTHORIZATION_SCOPES_MISSING");
    }

    return Object.freeze({
      found: true,
      allowed: true,
      code: "REGIONAL_SHARING_ACCESS_ALLOWED",
      authorizationId,
      authorizationVersion,
      blockers: Object.freeze([...blockers].sort())
    });
  }

  return Object.freeze({ decide });
}

module.exports = { createResidentAuthorizationDecisionAdapter };
