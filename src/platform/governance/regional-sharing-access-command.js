"use strict";

const { createHash } = require("node:crypto");

const COMMAND_ID = "regional-sharing-access-command.v1";
const RECEIPT_SCHEMA = "regional-sharing-access-receipt.v1";
const ACCESS_SCOPES = new Set([
  "attachments",
  "emr-summary",
  "health-record-summary",
  "imaging-report",
  "labs",
  "medications"
]);
const PURPOSE_CODE_PATTERN = /^[a-z][a-z0-9.-]{2,79}$/;
const READY_PACKAGE_STATUSES = new Set(["ready"]);
const packageWriteTails = new Map();

function stringValue(value) {
  return String(value ?? "").trim();
}

function text(value, maximum = 200) {
  return String(value || "").trim().slice(0, maximum);
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function digest(value) {
  return sha256(JSON.stringify(stableValue(value)));
}

function uniqueScopes(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))].sort();
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function deriveRequiredScopes(packageItem = {}) {
  const declared = uniqueScopes(packageItem.requiredAuthorizationScopes);
  if (declared.length) return declared;
  const contracts = uniqueScopes(packageItem.contractRefs).join(" ").toLowerCase();
  const collections = uniqueScopes(packageItem.sharedCollections);
  const category = text(packageItem.category, 160).toLowerCase();
  const scopes = new Set();
  if (contracts.includes("pacs") || category.includes("影像")) scopes.add("imaging-report");
  if (contracts.includes("lis") || category.includes("检验")) scopes.add("labs");
  if (contracts.includes("emr")) scopes.add("emr-summary");
  if (collections.includes("personalRecords") || collections.includes("followups")) scopes.add("health-record-summary");
  if (collections.includes("secureAttachments")) scopes.add("attachments");
  return [...(scopes.size ? scopes : new Set(["health-record-summary"]))].sort();
}

function errorResult(status, code, message) {
  return {
    status,
    body: {
      ok: false,
      error: status === 503
        ? "Service Unavailable"
        : status === 404
          ? "Not Found"
          : status === 409
            ? "Conflict"
            : status === 403
              ? "Forbidden"
              : "Bad Request",
      code,
      message,
      productionReady: false
    }
  };
}

function packageInOrganizationScope(user, packageItem) {
  if (user?.role === "commission") return true;
  const orgCode = stringValue(user?.orgCode);
  if (!orgCode || orgCode.length > 160 || user?.role !== "institution") return false;
  return stringValue(packageItem.sourceOrgCode) === orgCode
    || (Array.isArray(packageItem.targetOrgCodes) ? packageItem.targetOrgCodes : [])
      .some((candidate) => stringValue(candidate) === orgCode);
}

function packageVersion(packageItem) {
  const version = Number(packageItem?.version);
  return Number.isInteger(version) && version >= 0 ? version : 0;
}

function pick(source, fields) {
  if (!source || typeof source !== "object") return undefined;
  return Object.fromEntries(fields.filter((field) => Object.hasOwn(source, field)).map((field) => [field, source[field]]));
}

function projectRegionalSharingAccessResponse(body = {}) {
  const response = pick(body, [
    "ok",
    "replayed",
    "legacyCompatibility",
    "compatibilityBlockers",
    "productionReady",
    "authorizationReevaluated",
    "error",
    "code",
    "message"
  ]);
  if (body.review) {
    response.review = pick(body.review, [
      "id",
      "schemaVersion",
      "command",
      "packageId",
      "decision",
      "reasonCode",
      "status",
      "version",
      "packageVersionBefore",
      "packageVersionAfter",
      "at",
      "legacyCompatibility",
      "productionReady"
    ]);
  }
  if (body.package) {
    response.package = pick(body.package, [
      "id",
      "status",
      "qualityStatus",
      "version",
      "lastSharedAt",
      "lastAccessReviewId"
    ]);
  }
  return response;
}

function projectRegionalSharingReadResponse(view = {}) {
  return {
    ...view,
    accessReviews: (Array.isArray(view.accessReviews) ? view.accessReviews : []).map((review) => ({
      ...pick(review, [
        "id",
        "schemaVersion",
        "command",
        "packageId",
        "decision",
        "reasonCode",
        "status",
        "version",
        "packageVersionBefore",
        "packageVersionAfter",
        "at",
        "legacyCompatibility",
        "productionReady"
      ]),
      actor: review?.command === COMMAND_ID ? "服务端授权命令" : "历史调阅记录",
      organization: "",
      purpose: review?.command === COMMAND_ID ? "已按结构化授权用途核验" : "历史授权范围内调阅",
      note: "服务端已保留受限审计证据。"
    }))
  };
}

function withRegionalSharingPackageWriteLock(packageId, work) {
  const key = sha256(stringValue(packageId));
  const previous = packageWriteTails.get(key) || Promise.resolve();
  const execution = previous.then(work, work);
  const tail = execution.then(() => undefined, () => undefined);
  packageWriteTails.set(key, tail);
  tail.finally(() => {
    if (packageWriteTails.get(key) === tail) packageWriteTails.delete(key);
  });
  return execution;
}

function safeAuditActor(user) {
  const identity = text(user?.id || user?.accountId || user?.username || user?.role || "unknown", 200);
  return `principal:${sha256(identity).slice(0, 16)}`;
}

function validStoredString(value, maximum, { optional = false } = {}) {
  if (value === undefined || value === null || value === "") return optional;
  return typeof value === "string" && Boolean(value.trim()) && value.trim().length <= maximum;
}

function validStoredStringArray(value, maximumItems, maximumLength, { optional = false } = {}) {
  if (value === undefined || value === null) return optional;
  return Array.isArray(value)
    && value.length <= maximumItems
    && value.every((item) => validStoredString(item, maximumLength));
}

function persistedPackageError(packageItem) {
  if (!validStoredString(packageItem?.id, 160)
    || !validStoredString(packageItem?.residentId, 160)
    || !validStoredString(packageItem?.sourceOrgCode, 160, { optional: true })
    || !validStoredStringArray(packageItem?.targetOrgCodes, 100, 160, { optional: true })
    || !validStoredString(packageItem?.regionCode, 80, { optional: true })
    || !validStoredString(packageItem?.category, 160, { optional: true })
    || !validStoredStringArray(packageItem?.contractRefs, 100, 160, { optional: true })
    || !validStoredStringArray(packageItem?.sharedCollections, 100, 100, { optional: true })
    || !validStoredStringArray(packageItem?.requiredAuthorizationScopes, 20, 100, { optional: true })) {
    return errorResult(409, "REGIONAL_SHARING_PACKAGE_EVIDENCE_INVALID", "regional sharing package evidence is invalid");
  }
  const hasVersion = packageItem?.version !== undefined && packageItem?.version !== null && packageItem?.version !== "";
  if (hasVersion && (!Number.isInteger(Number(packageItem.version)) || Number(packageItem.version) < 0)) {
    return errorResult(409, "REGIONAL_SHARING_PACKAGE_EVIDENCE_INVALID", "regional sharing package version evidence is invalid");
  }
  return null;
}

function createRegionalSharingAccessCommand(dependencies = {}, options = {}) {
  const required = [
    "appendDataAccessLog",
    "canAccessResident",
    "createId",
    "prependAuditTrailEntry",
    "readAuthorizationDecision"
  ];
  const missing = required.filter((name) => typeof dependencies[name] !== "function");
  if (missing.length) throw new TypeError(`regional sharing access command is missing: ${missing.join(", ")}`);

  const production = String(options.environment?.NODE_ENV || "").toLowerCase() === "production";
  const activeRegionCode = stringValue(options.activeRegionCode);
  const capabilityEnabled = options.capabilityEnabled === true;
  const productionStorageReady = options.productionCutoverAuthorized === true
    && options.atomicRepository === true
    && String(options.storageEngine || "").toLowerCase() === "postgresql";

  function auditDecision(nextData, user, packageItem, receipt, reasonCode) {
    const auditActor = safeAuditActor(user);
    const residentAuditRef = `resident:${sha256(`${receipt.id}:${packageItem.residentId}`).slice(0, 24)}`;
    dependencies.appendDataAccessLog(
      nextData,
      { ...user, name: auditActor, roleName: text(user?.role, 80) },
      packageItem.residentId,
      "regionalDataSharing",
      `purpose:${receipt.purposeDigest.slice(0, 16)}`,
      receipt.decision === "allowed" ? "允许" : "拒绝",
      { actor: auditActor, at: receipt.at, personIndex: residentAuditRef }
    );
    nextData.securityEvents = dependencies.prependAuditTrailEntry(nextData.securityEvents, {
      id: dependencies.createId(),
      at: receipt.at,
      actor: auditActor,
      role: text(user?.role, 80),
      action: COMMAND_ID,
      target: text(packageItem.id, 160),
      result: receipt.decision,
      detail: reasonCode
    });
  }

  function execute(data, payload = {}, user = {}, request = {}) {
    const source = data && typeof data === "object" ? data : {};
    const packageId = String(payload.packageId ?? "").trim();
    if (!packageId) return errorResult(400, "REGIONAL_SHARING_PACKAGE_ID_REQUIRED", "packageId is required");
    if (packageId.length > 160) return errorResult(400, "REGIONAL_SHARING_PACKAGE_ID_INVALID", "packageId is too long");
    if (production && !capabilityEnabled) {
      return errorResult(403, "REGIONAL_SHARING_CAPABILITY_DISABLED", "regional sharing capability is disabled");
    }
    if (production && !productionStorageReady) {
      return errorResult(
        503,
        "REGIONAL_SHARING_PRODUCTION_REPOSITORY_UNAVAILABLE",
        "regional sharing production cutover requires an authorized PostgreSQL atomic repository"
      );
    }

    const packages = Array.isArray(source.regionalSharingPackages) ? source.regionalSharingPackages : [];
    const index = packages.findIndex((item) => stringValue(item?.id) === packageId);
    if (index < 0) return errorResult(404, "REGIONAL_SHARING_PACKAGE_NOT_FOUND", "regional sharing package not found");
    const currentPackage = packages[index];
    const packageEvidenceError = persistedPackageError(currentPackage);
    if (packageEvidenceError) return packageEvidenceError;
    if (!packageInOrganizationScope(user, currentPackage)) {
      return errorResult(403, "REGIONAL_SHARING_ORGANIZATION_SCOPE_DENIED", "organization scope denied");
    }
    if (!dependencies.canAccessResident(user, currentPackage.residentId, source)) {
      return errorResult(403, "REGIONAL_SHARING_RESIDENT_SCOPE_DENIED", "resident scope denied");
    }
    if (!READY_PACKAGE_STATUSES.has(stringValue(currentPackage.status))
      || stringValue(currentPackage.qualityStatus) !== "passed") {
      return errorResult(409, "REGIONAL_SHARING_PACKAGE_NOT_SHAREABLE", "regional sharing package is not shareable");
    }

    const blockers = new Set();
    const rawOrgCode = stringValue(user.orgCode);
    if (user.role === "institution" && (!rawOrgCode || rawOrgCode.length > 160)) {
      return errorResult(403, "REGIONAL_SHARING_ACTOR_ORGANIZATION_INVALID", "actor organization evidence is invalid");
    }
    if (user.role === "commission" && rawOrgCode.length > 160) {
      return errorResult(403, "REGIONAL_SHARING_ACTOR_ORGANIZATION_INVALID", "actor organization evidence is invalid");
    }
    const orgCode = user.role === "commission" ? "commission-wide" : rawOrgCode;
    const userRegionCode = stringValue(user.regionCode);
    const packageRegionCode = stringValue(currentPackage.regionCode);
    if (activeRegionCode.length > 80 || userRegionCode.length > 80 || packageRegionCode.length > 80) {
      return errorResult(409, "REGIONAL_SHARING_REGION_EVIDENCE_INVALID", "regional evidence is invalid");
    }
    if (production && ![activeRegionCode, userRegionCode, packageRegionCode].every((value) => /^\d{6}$/.test(value))) {
      return errorResult(400, "REGIONAL_SHARING_REGION_EVIDENCE_REQUIRED", "complete six-digit region evidence is required");
    }
    if (activeRegionCode && userRegionCode && activeRegionCode !== userRegionCode) {
      return errorResult(403, "REGIONAL_SHARING_ACTOR_REGION_DENIED", "actor region scope denied");
    }
    if (activeRegionCode && packageRegionCode && activeRegionCode !== packageRegionCode) {
      return errorResult(403, "REGIONAL_SHARING_PACKAGE_REGION_DENIED", "package region scope denied");
    }
    if (userRegionCode && packageRegionCode && userRegionCode !== packageRegionCode) {
      return errorResult(403, "REGIONAL_SHARING_REGION_SCOPE_DENIED", "regional scope denied");
    }
    if (!activeRegionCode || !userRegionCode || !packageRegionCode) {
      if (production) return errorResult(400, "REGIONAL_SHARING_REGION_EVIDENCE_REQUIRED", "complete region evidence is required");
      blockers.add("REGION_EVIDENCE_INCOMPLETE");
    }

    const declaredPackageScopes = uniqueScopes(currentPackage.requiredAuthorizationScopes);
    if (production && !declaredPackageScopes.length) {
      return errorResult(409, "REGIONAL_SHARING_PACKAGE_SCOPES_REQUIRED", "package authorization scopes are required");
    }
    if (!production && !declaredPackageScopes.length) blockers.add("PACKAGE_SCOPES_DERIVED");
    const requiredScopes = deriveRequiredScopes(currentPackage);
    if (requiredScopes.some((scope) => !ACCESS_SCOPES.has(scope))) {
      return errorResult(409, "REGIONAL_SHARING_PACKAGE_SCOPE_INVALID", "package authorization scope is invalid");
    }
    const requestedScopeInput = payload.scopes || payload.requestedScopes;
    if (requestedScopeInput !== undefined && (!Array.isArray(requestedScopeInput)
      || requestedScopeInput.length > 20
      || requestedScopeInput.some((scope) => typeof scope !== "string" || !scope.trim() || scope.trim().length > 100))) {
      return errorResult(400, "REGIONAL_SHARING_SCOPES_INVALID", "requested scopes are invalid");
    }
    let requestedScopes = uniqueScopes(requestedScopeInput);
    if (!requestedScopes.length) {
      if (production) return errorResult(400, "REGIONAL_SHARING_SCOPES_REQUIRED", "requested scopes are required");
      requestedScopes = requiredScopes;
      blockers.add("REQUESTED_SCOPES_DEFAULTED");
    }
    if (requestedScopes.some((scope) => !ACCESS_SCOPES.has(scope)) || !sameStrings(requestedScopes, requiredScopes)) {
      return errorResult(400, "REGIONAL_SHARING_SCOPES_MUST_MATCH_PACKAGE", "requested scopes must exactly match the package");
    }

    const purposeInput = String(payload.purposeCode ?? payload.purpose ?? "").trim();
    if (purposeInput.length > 300) return errorResult(400, "REGIONAL_SHARING_PURPOSE_TOO_LONG", "purpose is too long");
    let purposeCode = purposeInput;
    if (!PURPOSE_CODE_PATTERN.test(purposeCode)) {
      if (production) return errorResult(400, "REGIONAL_SHARING_PURPOSE_CODE_INVALID", "a stable purposeCode is required");
      purposeCode = `legacy-purpose.${sha256(purposeCode || "unspecified").slice(0, 16)}`;
      blockers.add("PURPOSE_CODE_LEGACY_NORMALIZED");
    }

    const idempotencyKey = String(request.idempotencyKey ?? "").trim();
    if (idempotencyKey && (idempotencyKey.length < 8 || idempotencyKey.length > 200)) {
      return errorResult(400, "REGIONAL_SHARING_IDEMPOTENCY_KEY_INVALID", "Idempotency-Key is invalid");
    }
    let effectiveIdempotencyKey = idempotencyKey;
    if (!effectiveIdempotencyKey) {
      if (production) return errorResult(400, "REGIONAL_SHARING_IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required");
      effectiveIdempotencyKey = `legacy-${dependencies.createId()}`;
      blockers.add("IDEMPOTENCY_KEY_MISSING");
    }
    const idempotencyKeyHash = sha256(effectiveIdempotencyKey);

    const storedPackageVersion = Number(currentPackage.version);
    const currentVersion = packageVersion(currentPackage);
    const suppliedPackageVersion = Number(payload.expectedVersion);
    const hasExpectedVersion = payload.expectedVersion !== undefined && payload.expectedVersion !== null && payload.expectedVersion !== "";
    if (hasExpectedVersion && (!Number.isInteger(suppliedPackageVersion) || suppliedPackageVersion < 0)) {
      return errorResult(400, "REGIONAL_SHARING_EXPECTED_VERSION_INVALID", "expectedVersion must be a non-negative integer");
    }

    const requestedAuthorizationId = String(payload.authorizationId ?? "").trim();
    if (requestedAuthorizationId.length > 200) {
      return errorResult(400, "REGIONAL_SHARING_AUTHORIZATION_ID_INVALID", "authorizationId is too long");
    }
    if (!requestedAuthorizationId) {
      if (production) return errorResult(400, "REGIONAL_SHARING_AUTHORIZATION_ID_REQUIRED", "authorizationId is required");
      blockers.add("AUTHORIZATION_ID_DEFAULTED");
    }

    const suppliedAuthorizationVersion = Number(payload.authorizationVersion);
    const hasAuthorizationVersion = payload.authorizationVersion !== undefined && payload.authorizationVersion !== null && payload.authorizationVersion !== "";
    if (hasAuthorizationVersion && (!Number.isInteger(suppliedAuthorizationVersion) || suppliedAuthorizationVersion < 0)) {
      return errorResult(400, "REGIONAL_SHARING_AUTHORIZATION_VERSION_INVALID", "authorizationVersion must be a non-negative integer");
    }
    const correlationId = String(request.correlationId ?? "").trim();
    if (correlationId.length > 200) {
      return errorResult(400, "REGIONAL_SHARING_CORRELATION_ID_INVALID", "correlationId is too long");
    }
    const now = new Date(request.now || Date.now());
    if (Number.isNaN(now.getTime())) return errorResult(400, "REGIONAL_SHARING_REQUEST_TIME_INVALID", "request time is invalid");
    const authorizationDecision = dependencies.readAuthorizationDecision(source, {
      actorOrgCode: orgCode,
      actorRole: user.role,
      authorizationId: requestedAuthorizationId,
      nowDate: now,
      production,
      purposeCode,
      requestedScopes,
      residentId: currentPackage.residentId
    });
    for (const blocker of authorizationDecision.blockers || []) blockers.add(blocker);
    if (!authorizationDecision.found && authorizationDecision.code === "REGIONAL_SHARING_AUTHORIZATION_NOT_FOUND") {
      return errorResult(403, authorizationDecision.code, "resident authorization was not found");
    }
    if (!authorizationDecision.authorizationId) {
      return errorResult(403, authorizationDecision.code, "resident authorization evidence is invalid");
    }
    const currentAuthorizationVersion = authorizationDecision.authorizationVersion;

    let authorizationVersionFailure = null;
    if (hasAuthorizationVersion && currentAuthorizationVersion !== null && suppliedAuthorizationVersion !== currentAuthorizationVersion) {
      authorizationVersionFailure = errorResult(409, "REGIONAL_SHARING_AUTHORIZATION_VERSION_CONFLICT", "resident authorization version conflict");
    } else if (!hasAuthorizationVersion || currentAuthorizationVersion === null) {
      if (production) {
        authorizationVersionFailure = errorResult(400, "REGIONAL_SHARING_AUTHORIZATION_VERSION_REQUIRED", "authorization version evidence is required");
      } else {
        blockers.add("AUTHORIZATION_VERSION_MISSING");
      }
    }

    const requestDigest = digest({
      authorizationId: authorizationDecision.authorizationId,
      authorizationVersion: hasAuthorizationVersion ? suppliedAuthorizationVersion : null,
      expectedVersion: hasExpectedVersion ? suppliedPackageVersion : null,
      orgCode,
      packageId,
      purposeCode,
      regionCode: packageRegionCode || userRegionCode || activeRegionCode,
      requestedScopes
    });
    const reviews = Array.isArray(source.regionalSharingAccessReviews) ? source.regionalSharingAccessReviews : [];
    const prior = reviews.find((review) => review?.idempotencyKeyHash === idempotencyKeyHash);
    if (prior) {
      if (prior.requestDigest !== requestDigest || prior.actorOrgCode !== orgCode) {
        return errorResult(409, "REGIONAL_SHARING_IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used for another command");
      }
      if (!authorizationDecision.allowed && prior.decision === "allowed") {
        const denied = errorResult(403, authorizationDecision.code, "current resident authorization denies replay");
        denied.replayed = false;
        denied.body.authorizationReevaluated = true;
        return denied;
      }
      if (authorizationVersionFailure) return authorizationVersionFailure;
      const replayPackage = packages.find((item) => item.id === prior.packageId) || currentPackage;
      return {
        status: prior.decision === "allowed" ? 200 : 403,
        replayed: true,
        body: {
          ok: prior.decision === "allowed",
          replayed: true,
          review: prior,
          package: replayPackage,
          legacyCompatibility: Boolean(prior.legacyCompatibility),
          productionReady: false
        }
      };
    }

    if (hasExpectedVersion && suppliedPackageVersion !== currentVersion) {
      return errorResult(409, "REGIONAL_SHARING_PACKAGE_VERSION_CONFLICT", "regional sharing package version conflict");
    }
    if (!hasExpectedVersion) {
      if (production) return errorResult(400, "REGIONAL_SHARING_EXPECTED_VERSION_REQUIRED", "expectedVersion is required");
      blockers.add("PACKAGE_EXPECTED_VERSION_DEFAULTED");
    }
    if (!Number.isInteger(storedPackageVersion) || storedPackageVersion < 0) {
      if (production) return errorResult(409, "REGIONAL_SHARING_PACKAGE_VERSION_REQUIRED", "package version evidence is required");
      blockers.add("PACKAGE_VERSION_MISSING");
    }

    if (authorizationVersionFailure) return authorizationVersionFailure;
    const legacyCompatibility = !production && blockers.size > 0;
    const nextData = structuredClone(source);
    const nextPackages = Array.isArray(nextData.regionalSharingPackages) ? nextData.regionalSharingPackages : [];
    const decision = authorizationDecision.allowed ? "allowed" : "denied";
    const nextVersion = authorizationDecision.allowed ? currentVersion + 1 : currentVersion;
    const receipt = {
      id: `rsar-${dependencies.createId()}`,
      schemaVersion: RECEIPT_SCHEMA,
      command: COMMAND_ID,
      packageId,
      residentId: text(currentPackage.residentId, 160),
      actorRef: safeAuditActor(user),
      actorOrgCode: orgCode,
      actorRegionCode: userRegionCode || activeRegionCode,
      authorizationId: authorizationDecision.authorizationId,
      authorizationVersion: currentAuthorizationVersion,
      purposeCode,
      purposeDigest: sha256(purposeCode),
      scopes: requestedScopes,
      decision,
      reasonCode: authorizationDecision.code,
      status: authorizationDecision.allowed ? "completed" : "denied",
      version: 1,
      packageVersionBefore: currentVersion,
      packageVersionAfter: nextVersion,
      idempotencyKeyHash,
      requestDigest,
      correlationId,
      at: now.toISOString(),
      legacyCompatibility,
      compatibilityBlockers: [...blockers].sort(),
      productionReady: false
    };

    nextData.regionalSharingAccessReviews = [receipt, ...(Array.isArray(nextData.regionalSharingAccessReviews) ? nextData.regionalSharingAccessReviews : [])];
    if (authorizationDecision.allowed) {
      nextPackages[index] = {
        ...nextPackages[index],
        version: nextVersion,
        lastSharedAt: receipt.at,
        lastAccessReviewId: receipt.id
      };
      nextData.regionalSharingPackages = nextPackages;
    }
    auditDecision(nextData, user, currentPackage, receipt, authorizationDecision.code);

    return {
      status: authorizationDecision.allowed ? 201 : 403,
      replayed: false,
      nextData,
      body: {
        ok: authorizationDecision.allowed,
        replayed: false,
        review: receipt,
        package: authorizationDecision.allowed ? nextPackages[index] : currentPackage,
        legacyCompatibility,
        compatibilityBlockers: receipt.compatibilityBlockers,
        productionReady: false,
        ...(authorizationDecision.allowed ? {} : {
          error: "Forbidden",
          code: authorizationDecision.code,
          message: "resident authorization denied regional sharing access"
        })
      }
    };
  }

  return Object.freeze({ execute });
}

module.exports = {
  ACCESS_SCOPES,
  COMMAND_ID,
  RECEIPT_SCHEMA,
  createRegionalSharingAccessCommand,
  deriveRequiredScopes,
  digest,
  projectRegionalSharingAccessResponse,
  projectRegionalSharingReadResponse,
  sha256,
  withRegionalSharingPackageWriteLock
};
