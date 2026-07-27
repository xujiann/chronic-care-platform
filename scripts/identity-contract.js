#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "identity-contract.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "identity-contract.md");

const ROLE_PORTALS = {
  commission: ["index.html", "workbench.html", "blood.html"],
  institution: ["institution.html", "internet-nursing.html", "doctor.html", "blood.html"],
  insurance: ["insurance.html"],
  citizen: ["citizen.html"],
  county: ["county.html"]
};

const REQUIRED_CLAIMS = [
  { claim: "issuer", required: true, purpose: "namespaces the external subject across identity providers" },
  { claim: "sub", required: true, purpose: "stable external subject identifier" },
  { claim: "preferred_username", required: true, purpose: "platform username lookup and audit actor" },
  { claim: "name", required: true, purpose: "display name and audit trail actor label" },
  { claim: "orgCode", required: true, purpose: "authOrganizations.orgCode lookup" },
  { claim: "roles", required: true, purpose: "maps to commission/institution/insurance/citizen/county" },
  { claim: "accountType", required: false, purpose: "distinguishes manager, doctor, nurse, resident and guardian duties" },
  { claim: "personIndex", required: false, purpose: "links a verified resident without exposing raw identity numbers" },
  { claim: "assuranceLevel", required: false, purpose: "records real-name and step-up authentication strength" },
  { claim: "orgName", required: false, purpose: "fallback organization display name" },
  { claim: "orgType", required: false, purpose: "fallback role inference when roles are absent" },
  { claim: "dataScope", required: false, purpose: "site-specific access scope description" }
];

const TARGET_ORGANIZATION_LEVELS = ["city", "district", "township-street", "institution"];

const REFERENCE_ORGANIZATIONS = [
  { orgCode: "REF-CITY", name: "市级健康城市平台", canonicalLevel: "city", orgType: "city-platform", parentCode: "" },
  { orgCode: "REF-HEALTH", name: "市卫生健康委", canonicalLevel: "city", orgType: "health-commission", parentCode: "REF-CITY" },
  { orgCode: "REF-INSURANCE", name: "市医保局", canonicalLevel: "city", orgType: "insurance-bureau", parentCode: "REF-CITY" },
  { orgCode: "REF-DISTRICT", name: "区市县管理节点", canonicalLevel: "district", orgType: "district-platform", parentCode: "REF-CITY" },
  { orgCode: "REF-TOWNSHIP", name: "乡镇街道管理节点", canonicalLevel: "township-street", orgType: "township-street", parentCode: "REF-DISTRICT" },
  { orgCode: "REF-HOSPITAL", name: "市属医疗机构", canonicalLevel: "institution", orgType: "medical-institution", parentCode: "REF-HEALTH" },
  { orgCode: "REF-PRIMARY", name: "基层医疗卫生机构", canonicalLevel: "institution", orgType: "primary-care-institution", parentCode: "REF-TOWNSHIP" }
];

const PERMISSION_MATRIX = [
  {
    actor: "commission-identity-admin",
    portalRole: "commission",
    accountType: "manager",
    organizationScope: "city-approved-organizations",
    permissions: ["identity.directory.read", "identity.binding.review", "identity.account.disable", "identity.audit.read"]
  },
  {
    actor: "district-township-admin",
    portalRole: "commission",
    accountType: "manager",
    organizationScope: "self-and-descendants",
    permissions: ["organization.directory.read", "identity.account.request", "identity.audit.read-local"]
  },
  {
    actor: "insurance-operator",
    portalRole: "insurance",
    accountType: "manager",
    organizationScope: "insurance-jurisdiction",
    permissions: ["insurance.claim.read", "insurance.treatment.review", "insurance.audit.read"]
  },
  {
    actor: "institution-admin",
    portalRole: "institution",
    accountType: "manager",
    organizationScope: "own-institution",
    permissions: ["staff.account.request", "staff.affiliation.manage", "staff.credential.review"]
  },
  {
    actor: "doctor",
    portalRole: "institution",
    accountType: "doctor",
    organizationScope: "assigned-or-encounter-residents",
    permissions: ["resident.clinical.read", "resident.clinical.write", "referral.manage"]
  },
  {
    actor: "nurse",
    portalRole: "institution",
    accountType: "nurse",
    organizationScope: "assigned-orders-and-own-institution",
    permissions: ["nursing.order.read", "nursing.service.write", "nursing.audit.append"]
  },
  {
    actor: "resident",
    portalRole: "citizen",
    accountType: "resident",
    organizationScope: "self",
    permissions: ["resident.self.read", "resident.self.contact.update", "delegation.self.revoke"]
  },
  {
    actor: "guardian-proxy",
    portalRole: "citizen",
    accountType: "guardian",
    organizationScope: "explicit-delegated-resident-scope",
    permissions: ["resident.delegated.read", "service.delegated.apply", "delegation.receipt.read"]
  },
  {
    actor: "county-consortium-operator",
    portalRole: "county",
    accountType: "manager",
    organizationScope: "member-institutions",
    permissions: ["referral.network.read", "mutual-recognition.manage", "consortium.aggregate.read"]
  }
];

const PROTOCOL_CLAIM_MAPPINGS = [
  { field: "externalSubject", oidc: ["iss", "sub"], saml: ["IdP entityID", "persistent NameID"], local: "authUsers.externalIssuer + externalSubject", validation: "issuer-scoped unique and immutable" },
  { field: "username", oidc: ["preferred_username"], saml: ["uid", "accountName"], local: "authUsers.username", validation: "lookup only; never a binding key" },
  { field: "name", oidc: ["name"], saml: ["displayName", "cn"], local: "authUsers.name", validation: "display value; never a unique identifier" },
  { field: "orgCode", oidc: ["org_code", "orgCode"], saml: ["urn:health-city:claims:org_code"], local: "authUsers.orgCode", validation: "must match an accepted organization directory node" },
  { field: "roles", oidc: ["roles", "groups"], saml: ["Role", "Group"], local: "authUsers.role", validation: "allow-list translation; unknown values fail closed" },
  { field: "accountType", oidc: ["account_type", "profession"], saml: ["employeeType", "urn:health-city:claims:profession"], local: "authUsers.accountType", validation: "manager/doctor/nurse/resident/guardian allow-list" },
  { field: "practitionerId", oidc: ["doctor_id", "nurse_id"], saml: ["urn:health-city:claims:practitioner_id"], local: "authUsers.doctorId or nurseId", validation: "must be verified against the practitioner registry" },
  { field: "personIndex", oidc: ["person_index"], saml: ["urn:health-city:claims:person_index"], local: "residents.personIndex", validation: "verified token only; raw identity number is not persisted in a session" },
  { field: "assuranceLevel", oidc: ["acr", "amr", "auth_time"], saml: ["AuthnContextClassRef", "AuthnInstant"], local: "identity verification receipt", validation: "sensitive actions require an accepted level and recent authentication" }
];

const REAL_NAME_WORKFLOW = {
  states: ["submitted", "source-verified", "manual-review", "approved", "rejected", "revoked"],
  terminalStates: ["approved", "rejected", "revoked"],
  requiredEvidence: ["verification-source", "masked-person-reference", "assurance-level", "verified-at"],
  controls: ["no-anonymous-self-provisioning", "master-index-match", "evidence-minimization", "review-audit-trail"]
};

const GUARDIAN_DELEGATION_WORKFLOW = {
  states: ["draft", "submitted", "material-requested", "approved", "active", "suspended", "revoked", "expired"],
  terminalStates: ["revoked", "expired"],
  requiredFields: ["actorAccountId", "subjectResidentId", "relationship", "legalBasis", "permissions", "validFrom", "validUntil", "status"],
  controls: ["guardian-real-name-required", "explicit-subject-and-scope", "actor-subject-audit", "step-up-for-sensitive-actions", "revocation-and-expiry-enforced"]
};

const SAMPLE_CLAIMS = [
  { id: "identity-commission", issuer: "https://identity.example/issuer", sub: "commission-001", preferred_username: "health-admin", name: "市卫健委身份管理员", orgCode: "ORG-HEALTH-DL", roles: ["health_admin", "commission"], expectedRole: "commission", expectedHome: "index.html" },
  { id: "identity-institution", issuer: "https://identity.example/issuer", sub: "doctor-001", preferred_username: "doctor-demo", name: "基层医生", orgCode: "MR3", roles: ["doctor"], expectedRole: "institution", expectedHome: "doctor.html" },
  { id: "identity-insurance", issuer: "https://identity.example/issuer", sub: "insurance-001", preferred_username: "insurance-demo", name: "医保经办人", orgCode: "ORG-MI-CENTER-DL", roles: ["insurance"], expectedRole: "insurance", expectedHome: "insurance.html" },
  { id: "identity-county", issuer: "https://identity.example/issuer", sub: "county-001", preferred_username: "county-demo", name: "医共体运营人员", orgCode: "ORG-CONSORTIUM-ZS", roles: ["county"], expectedRole: "county", expectedHome: "county.html" },
  { id: "identity-citizen", issuer: "https://identity.example/issuer", sub: "resident-001", preferred_username: "resident-demo", name: "实名居民", orgCode: "PERSON-R1", roles: ["citizen"], expectedRole: "citizen", expectedHome: "citizen.html" }
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function roleFromClaims(roles, organization) {
  const rawRoles = [roles].flat().filter(Boolean).map((item) => String(item).toLowerCase());
  if (rawRoles.some((item) => /citizen|resident/.test(item))) return "citizen";
  if (rawRoles.some((item) => /insurance/.test(item))) return "insurance";
  if (rawRoles.some((item) => /county|consortium/.test(item))) return "county";
  if (rawRoles.some((item) => /hospital|doctor|institution|medical/.test(item))) return "institution";
  if (rawRoles.some((item) => /commission|admin|health/.test(item))) return "commission";
  const orgType = String(organization?.orgType || "").toLowerCase();
  if (orgType.includes("insurance")) return "insurance";
  if (orgType.includes("medical")) return "institution";
  if (orgType.includes("county")) return "county";
  if (orgType.includes("citizen")) return "citizen";
  return null;
}

function homeForRole(role, organization, roles = []) {
  const rawRoles = [roles].flat().filter(Boolean).map((item) => String(item).toLowerCase());
  if (role === "institution" && rawRoles.some((item) => /doctor|physician/.test(item))) return "doctor.html";
  if (organization?.portal) return organization.portal;
  return ROLE_PORTALS[role]?.[0] || "health-city.html";
}

function canonicalOrganizationLevel(organization = {}) {
  if (organization.canonicalLevel) return organization.canonicalLevel;
  const level = String(organization.orgLevel || "").toLowerCase();
  const type = String(organization.orgType || "").toLowerCase();
  if (/乡镇|街道|township|street/.test(`${level} ${type}`)) return "township-street";
  if (/区|县|district|county/.test(level) && !/institution|medical|hospital/.test(type)) return "district";
  if (/机构|医院|基层|institution|medical|hospital|primary/.test(`${level} ${type}`)) return "institution";
  if (/市级|city/.test(`${level} ${type}`)) return "city";
  return "unclassified";
}

function validateOrganizationHierarchy(organizations = []) {
  const codes = organizations.map((item) => String(item.orgCode || "").trim());
  const duplicateCodes = [...new Set(codes.filter((code, index) => code && codes.indexOf(code) !== index))];
  const emptyCodes = organizations.filter((item) => !String(item.orgCode || "").trim()).map((item) => item.name || "unnamed");
  const byCode = new Map(organizations.filter((item) => item.orgCode).map((item) => [item.orgCode, item]));
  const missingParents = organizations
    .filter((item) => item.parentCode && !byCode.has(item.parentCode))
    .map((item) => ({ orgCode: item.orgCode, parentCode: item.parentCode }));
  const cycles = [];
  organizations.forEach((organization) => {
    const path = [];
    const seen = new Set();
    let current = organization;
    while (current?.orgCode) {
      if (seen.has(current.orgCode)) {
        cycles.push([...path, current.orgCode]);
        break;
      }
      seen.add(current.orgCode);
      path.push(current.orgCode);
      current = current.parentCode ? byCode.get(current.parentCode) : null;
    }
  });
  return {
    valid: duplicateCodes.length === 0 && emptyCodes.length === 0 && missingParents.length === 0 && cycles.length === 0,
    nodeCount: organizations.length,
    duplicateCodes,
    emptyCodes,
    missingParents,
    cycles,
    levelsPresent: [...new Set(organizations.map(canonicalOrganizationLevel))]
  };
}

function permissionMatrixStatus(matrix = PERMISSION_MATRIX) {
  const actorTypes = [...new Set(matrix.map((item) => item.accountType))];
  const actors = matrix.map((item) => item.actor);
  const guardian = matrix.find((item) => item.actor === "guardian-proxy");
  return {
    valid: new Set(actors).size === actors.length
      && matrix.every((item) => item.organizationScope && item.permissions.length > 0 && !item.permissions.includes("*"))
      && ["manager", "doctor", "nurse", "resident", "guardian"].every((item) => actorTypes.includes(item))
      && Boolean(guardian)
      && guardian.permissions.every((item) => !item.startsWith("identity.")),
    actors: actors.length,
    accountTypes: actorTypes,
    defaultPolicy: "deny"
  };
}

function buildIdentityContract(options = {}) {
  const data = options.data || readJson("data/db.json");
  const productionEvidence = options.productionEvidence || {};
  const adapterSource = options.adapterSource ?? readText("production-adapters.js");
  const serverSource = options.serverSource ?? readText("server.js");
  const sessionStoreSource = options.sessionStoreSource ?? readText("session-store.js");
  const authSource = options.authSource ?? readText("auth.js");
  const loginSource = options.loginSource ?? readText("login.html");
  const bloodBusinessSource = options.bloodBusinessSource ?? readText("blood-business.js");
  const bloodRecallSource = options.bloodRecallSource ?? readText("blood-recall.js");
  const platformHtml = options.platformHtml ?? readText("platform.html");
  const platformSource = options.platformSource ?? readText("platform.js");
  const adapterDocument = options.adapterDocument ?? readText("docs/production-identity-message-adapters.md");
  const envTemplate = options.envTemplate ?? readText(".env.example");
  const users = Array.isArray(data.authUsers) ? data.authUsers : [];
  const organizations = Array.isArray(data.authOrganizations) ? data.authOrganizations : [];
  const identityReviewCases = Array.isArray(data.citizenIdentityReviewCases) ? data.citizenIdentityReviewCases : [];
  const orgByCode = new Map(organizations.map((item) => [item.orgCode, item]));
  const p0IdentityRequirements = (Array.isArray(data.interfaceRequirements) ? data.interfaceRequirements : [])
    .filter((item) => item.priority === "P0" && /认证|机构|居民主索引/.test(`${item.domain}${item.need}${item.keepExisting}`));

  const roleCoverage = Object.fromEntries(Object.keys(ROLE_PORTALS).map((role) => {
    const roleUsers = users.filter((item) => item.role === role);
    return [role, {
      users: roleUsers.length,
      homes: [...new Set(roleUsers.map((item) => item.home).filter(Boolean))],
      orgCodes: [...new Set(roleUsers.map((item) => item.orgCode).filter(Boolean))]
    }];
  }));

  const sampleMappings = SAMPLE_CLAIMS.map((sample) => {
    const organization = orgByCode.get(sample.orgCode);
    const role = roleFromClaims(sample.roles, organization);
    const home = homeForRole(role, organization, sample.roles);
    return {
      ...sample,
      mappedRole: role,
      mappedHome: home,
      organizationFound: Boolean(organization),
      passed: role === sample.expectedRole && home === sample.expectedHome && (Boolean(organization) || role === "citizen")
    };
  });
  const requiredClaimNames = REQUIRED_CLAIMS.filter((item) => item.required).map((item) => item.claim);
  const sampleClaimsComplete = SAMPLE_CLAIMS.every((sample) => requiredClaimNames.every((claim) => Object.hasOwn(sample, claim)));

  const currentOrganizationTopology = validateOrganizationHierarchy(organizations);
  currentOrganizationTopology.missingTargetLevels = TARGET_ORGANIZATION_LEVELS.filter((level) => !currentOrganizationTopology.levelsPresent.includes(level));
  const referenceOrganizationTopology = validateOrganizationHierarchy(REFERENCE_ORGANIZATIONS);
  referenceOrganizationTopology.missingTargetLevels = TARGET_ORGANIZATION_LEVELS.filter((level) => !referenceOrganizationTopology.levelsPresent.includes(level));
  const permissions = permissionMatrixStatus();
  const protocolMapping = {
    complete: PROTOCOL_CLAIM_MAPPINGS.every((item) => item.field && item.oidc.length && item.saml.length && item.local && item.validation),
    fields: PROTOCOL_CLAIM_MAPPINGS.length,
    subjectNamespaced: PROTOCOL_CLAIM_MAPPINGS.some((item) => item.field === "externalSubject" && item.oidc.includes("iss") && item.saml.includes("IdP entityID")),
    unknownRolePolicy: "deny"
  };
  const externalRoleMapperStart = serverSource.indexOf("function roleFromExternalClaims");
  const externalRoleMapperEnd = serverSource.indexOf("function homeForRole", externalRoleMapperStart);
  const externalRoleMapperSource = externalRoleMapperStart >= 0
    ? serverSource.slice(externalRoleMapperStart, externalRoleMapperEnd > externalRoleMapperStart ? externalRoleMapperEnd : externalRoleMapperStart + 2000)
    : "";
  const runtimeIdentityAlignment = {
    issuerScopedSubject: serverSource.includes("externalIssuer") && serverSource.includes("claims.iss"),
    unknownRoleFailClosed: externalRoleMapperSource.length > 0 && !externalRoleMapperSource.includes('return "commission";')
  };
  const identityReviewCoverage = {
    cases: identityReviewCases.length,
    guardianCases: identityReviewCases.filter((item) => item.source === "family-proxy").length,
    productionReadyCases: identityReviewCases.filter((item) => item.productionReady === true).length,
    statuses: [...new Set(identityReviewCases.map((item) => item.status).filter(Boolean))]
  };

  const adapterContracts = {
    oidc: {
      runtime: adapterSource.includes("fetchOidcUserInfo") && serverSource.includes("/api/auth/oidc/exchange"),
      configuration: ["OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"].every((marker) => envTemplate.includes(marker)),
      boundary: adapterDocument.includes("受控本地账号绑定") && adapterDocument.includes("现场联合测试回执")
    },
    oidcLifecycle: {
      refresh: adapterSource.includes("refreshOidcAccessToken") && serverSource.includes("/api/auth/oidc/refresh"),
      revocation: adapterSource.includes("revokeOidcToken") && serverSource.includes("/api/auth/oidc/revoke"),
      directory: adapterSource.includes("fetchIdentityDirectory") && ["/api/auth/identity-directory/preview", "/api/auth/identity-directory/bind", "/api/auth/identity-directory/apply"].every((marker) => serverSource.includes(marker)),
      controlledBinding: ["BIND EXTERNAL IDENTITY", "IDENTITY_BINDING_SUBJECT_CONFLICT", "IDENTITY_BINDING_REASSIGNMENT_BLOCKED", "local username exists but external subject requires controlled binding"].every((marker) => serverSource.includes(marker)),
      deactivationSafety: ["IDENTITY_DIRECTORY_SELF_DEACTIVATION_BLOCKED", "IDENTITY_DIRECTORY_LAST_COMMISSION_BLOCKED", "APPLY IDENTITY DIRECTORY DEACTIVATIONS"].every((marker) => serverSource.includes(marker)),
      operationsUi: platformHtml.includes("identity-lifecycle-center") && ["renderIdentityLifecycleCenter", "runIdentityBindingAction", "runIdentityDirectoryAction"].every((marker) => platformSource.includes(marker)),
      configuration: ["OIDC_TOKEN_URL", "OIDC_REVOCATION_URL", "IDENTITY_DIRECTORY_URL", "IDENTITY_DIRECTORY_TOKEN"].every((marker) => envTemplate.includes(marker)),
      boundary: ["不自动开户", "不自动提权", "不自动复活", "真实机构目录"].every((marker) => adapterDocument.includes(marker))
    },
    saml: {
      mappingContract: protocolMapping.complete,
      issuerScopedSubject: protocolMapping.subjectNamespaced,
      runtime: false,
      metadataAndCertificates: false,
      signedAssertionValidation: false
    },
    browserIdentityContext: {
      issuerScopedSubject: ["buildExternalIdentityKey", "externalIssuer", "encodeURIComponent(issuer)"].every((marker) => authSource.includes(marker)),
      guardianAccount: ["authorizeDelegatedResidentAccess", "GUARDIAN_ACCOUNT_REQUIRED"].every((marker) => authSource.includes(marker)),
      auditableDelegation: ["DELEGATION_AUDIT_FIELDS_REQUIRED", '"id", "actorAccountId", "relationship", "legalBasis"'].every((marker) => authSource.includes(marker)),
      explicitPermission: ["DELEGATION_WILDCARD_FORBIDDEN", "DELEGATION_PERMISSION_DENIED"].every((marker) => authSource.includes(marker)),
      validityWindow: ["DELEGATION_NOT_STARTED", "DELEGATION_EXPIRED", "DELEGATION_VALIDITY_INVALID"].every((marker) => authSource.includes(marker)),
      sensitiveStepUp: ["DELEGATION_STEP_UP_REQUIRED", "DEFAULT_STEP_UP_MAX_AGE_MS"].every((marker) => authSource.includes(marker)),
      clientBoundary: authSource.includes("clientHintOnly: true")
    },
    sms: {
      runtime: adapterSource.includes("sendSmsVerificationCode") && serverSource.includes("/api/auth/phone-code"),
      protectedCode: adapterSource.includes("digestPhoneVerificationCode") && serverSource.includes("codeDigest"),
      signedDeliveryCallback: ["verifySmsDeliveryCallback", "applySmsDeliveryCallback", "SMS_CALLBACK_REPLAY_DETECTED", "terminal-conflict"].every((marker) => adapterSource.includes(marker)) && ["/api/auth/sms-delivery-callback", "/api/auth/sms-deliveries", "smsDeliveryReceipts"].every((marker) => serverSource.includes(marker)),
      operationsUi: ["sms-delivery-status", "sms-delivery-metrics", "sms-delivery-receipts"].every((marker) => platformHtml.includes(marker)) && platformSource.includes("smsDelivery"),
      configuration: ["SMS_GATEWAY_URL", "SMS_TEMPLATE_ID", "SMS_GATEWAY_TOKEN", "SMS_DELIVERY_CALLBACK_SECRET"].every((marker) => envTemplate.includes(marker)),
      boundary: ["最终送达回调", "供应商专有字段与签名差异", "回调验签", "重放", "乱序"].every((marker) => adapterDocument.includes(marker))
    },
    productionSecurity: {
      localPasswordDisabled: ["LOCAL_PASSWORD_LOGIN_DISABLED", "local password login is disabled in production"].every((marker) => serverSource.includes(marker)),
      weakSecretStartupBlocked: ["assertProductionRuntimeSecurity", "PRODUCTION_SESSION_SECRET_INVALID"].every((marker) => serverSource.includes(marker)),
      persistentSessionStore: ["SqliteSessionStore", "PRODUCTION_SESSION_STORE_INVALID", "sessionStoreStatus"].every((marker) => serverSource.includes(marker)) && ["auth_sessions", "revokeByUserIds", "crossProcess: true"].every((marker) => sessionStoreSource.includes(marker)) && platformSource.includes("同一主机共享数据目录可跨进程撤销") && envTemplate.includes("SESSION_STORE=sqlite"),
      centralizedSessionStore: ["PostgresSessionStore", "hydrateRequestSession", "startServerAsync", "SESSION_STORE_UNAVAILABLE", "SESSION_TOPOLOGY"].every((marker) => serverSource.includes(marker)) && ["class PostgresSessionStore", "async hydrate", "crossHost: true", "centralized: true"].every((marker) => sessionStoreSource.includes(marker)) && ["SESSION_TOPOLOGY=single-host", "SESSION_STORE=sqlite"].every((marker) => envTemplate.includes(marker)) && platformSource.includes("多主机中央会话可跨节点撤销") && adapterDocument.includes("PostgreSQL 中央会话表"),
      sessionRetention: ["cleanupRuntimeSessions", "scheduleSessionCleanup", "/api/auth/sessions/cleanup", "SESSION_CLEANUP_CONFIRMATION_REQUIRED", "PRODUCTION_SESSION_RETENTION_INVALID"].every((marker) => serverSource.includes(marker)) && ["cleanup(options", "deletedExpired", "deletedRevoked"].every((marker) => sessionStoreSource.includes(marker)) && ["SESSION_EXPIRED_RETENTION_DAYS", "SESSION_REVOKED_RETENTION_DAYS", "SESSION_CLEANUP_INTERVAL_MS"].every((marker) => envTemplate.includes(marker)) && platformSource.includes("会话保留"),
      browserFailClosed: authSource.includes("认证服务暂不可用，请稍后重试"),
      residentScope: ["applyResidentScope", "canManageResidentProfile", "INSURANCE_RESIDENT_COLLECTIONS", "COUNTY_RESIDENT_COLLECTIONS"].every((marker) => serverSource.includes(marker)),
      contentSecurity: serverSource.includes("script-src-attr 'none'") && [bloodBusinessSource, bloodRecallSource].every((source) => source.includes("escapeHtml")),
      boundary: ["生产安全边界", "集中式会话", "不再回退到本地演示账号"].every((marker) => adapterDocument.includes(marker))
    }
  };

  const checks = [
    { id: "identity:p0Requirements", passed: p0IdentityRequirements.length >= 3, detail: `${p0IdentityRequirements.length} P0 identity/org requirements` },
    { id: "identity:requiredClaims", passed: REQUIRED_CLAIMS.filter((item) => item.required).length >= 5, detail: `${REQUIRED_CLAIMS.length} claims documented` },
    { id: "identity:roleCoverage", passed: Object.values(roleCoverage).every((item) => item.users >= 1), detail: Object.entries(roleCoverage).map(([role, item]) => `${role}:${item.users}`).join(";") },
    { id: "identity:organizationCoverage", passed: users.every((item) => item.role === "citizen" || orgByCode.has(item.orgCode)), detail: `${organizations.length} organizations, ${users.length} users` },
    { id: "identity:portalMapping", passed: users.every((item) => ROLE_PORTALS[item.role]?.includes(item.home)), detail: "role home pages match allowed portals" },
    { id: "identity:sampleMappings", passed: sampleMappings.every((item) => item.passed), detail: sampleMappings.map((item) => `${item.id}:${item.mappedRole}/${item.mappedHome}`).join(";") },
    { id: "identity:sampleClaimCompleteness", passed: sampleClaimsComplete, detail: `${SAMPLE_CLAIMS.length} samples include ${requiredClaimNames.join(",")}` },
    { id: "identity:referenceOrganizationHierarchy", passed: referenceOrganizationTopology.valid && referenceOrganizationTopology.missingTargetLevels.length === 0, detail: `${referenceOrganizationTopology.nodeCount} reference nodes cover ${TARGET_ORGANIZATION_LEVELS.join(",")}` },
    { id: "identity:currentOrganizationHierarchy", passed: currentOrganizationTopology.valid, detail: `${currentOrganizationTopology.nodeCount} current nodes; missing target levels: ${currentOrganizationTopology.missingTargetLevels.join(",") || "none"}` },
    { id: "identity:leastPrivilegeMatrix", passed: permissions.valid, detail: `${permissions.actors} actors; default policy ${permissions.defaultPolicy}` },
    { id: "identity:protocolClaimMapping", passed: protocolMapping.complete && protocolMapping.subjectNamespaced && protocolMapping.unknownRolePolicy === "deny", detail: `${protocolMapping.fields} canonical OIDC/SAML fields; issuer-scoped subject and deny-unknown policy` },
    { id: "identity:realNameWorkflow", passed: REAL_NAME_WORKFLOW.states.includes("manual-review") && REAL_NAME_WORKFLOW.controls.includes("master-index-match"), detail: `${REAL_NAME_WORKFLOW.states.length} states and ${REAL_NAME_WORKFLOW.controls.length} controls` },
    { id: "identity:guardianDelegationWorkflow", passed: GUARDIAN_DELEGATION_WORKFLOW.states.includes("active") && GUARDIAN_DELEGATION_WORKFLOW.controls.includes("actor-subject-audit"), detail: `${GUARDIAN_DELEGATION_WORKFLOW.states.length} states and ${GUARDIAN_DELEGATION_WORKFLOW.controls.length} controls` },
    { id: "identity:loginProvisioningBoundary", passed: ["data-provisioning-step=\"external-identity\"", "data-provisioning-step=\"guardian\"", "不自动开户", "监护关系", "试点机构护理部", "平台账号管理员", "医政部门", "平台身份管理员"].every((marker) => loginSource.includes(marker)), detail: "login page preserves provisioning owner compatibility and documents controlled external binding and guardian review" },
    { id: "identity:browserIdentityContext", passed: Object.values(adapterContracts.browserIdentityContext).every(Boolean), detail: "browser external-subject namespace and guardian delegation checks fail closed and remain client hints" },
    { id: "identity:oidcRuntimeAdapter", passed: Object.values(adapterContracts.oidc).every(Boolean), detail: "OIDC UserInfo runtime, configuration and controlled-binding boundary documented" },
    { id: "identity:oidcLifecycle", passed: Object.values(adapterContracts.oidcLifecycle).every(Boolean), detail: "OIDC subject binding, refresh, revocation, safe directory deactivation, operations UI and production boundary documented" },
    { id: "identity:smsRuntimeAdapter", passed: Object.values(adapterContracts.sms).every(Boolean), detail: "SMS runtime, keyed code digest, signed final-delivery callback, replay-safe ordered ledger, operations UI and provider boundary documented" },
    { id: "identity:productionSecurityBoundary", passed: Object.values(adapterContracts.productionSecurity).every(Boolean), detail: "production local-password, signing-secret, durable session retention, browser fail-closed, resident scope and content-security controls are wired" }
  ];

  const productionBlockers = [];
  if (currentOrganizationTopology.missingTargetLevels.length) productionBlockers.push(`organization levels missing from current directory: ${currentOrganizationTopology.missingTargetLevels.join(", ")}`);
  if (!adapterContracts.saml.runtime) productionBlockers.push("SAML runtime, metadata and signed assertion validation are not implemented");
  if (!runtimeIdentityAlignment.issuerScopedSubject) productionBlockers.push("runtime external subjects are not yet namespaced by identity-provider issuer");
  if (!runtimeIdentityAlignment.unknownRoleFailClosed) productionBlockers.push("runtime external-role mapping still requires deny-unknown hardening");
  if (identityReviewCoverage.productionReadyCases < identityReviewCoverage.cases) productionBlockers.push("resident real-name and guardian review cases lack production evidence");
  if (!["providerMetadataAccepted", "organizationDirectoryAccepted", "signedJointTestReceipts"].every((item) => productionEvidence[item] === true)) {
    productionBlockers.push("real provider metadata, organization directory acceptance and signed joint-test receipts are required onsite");
  }

  return {
    ok: checks.every((item) => item.passed),
    productionReady: checks.every((item) => item.passed) && productionBlockers.length === 0,
    productionBlockers,
    productionEvidence,
    generatedAt: new Date().toISOString(),
    requiredClaims: REQUIRED_CLAIMS,
    rolePortals: ROLE_PORTALS,
    roleCoverage,
    targetOrganizationLevels: TARGET_ORGANIZATION_LEVELS,
    referenceOrganizations: REFERENCE_ORGANIZATIONS,
    currentOrganizationTopology,
    referenceOrganizationTopology,
    permissionMatrix: PERMISSION_MATRIX,
    permissionMatrixStatus: permissions,
    protocolClaimMappings: PROTOCOL_CLAIM_MAPPINGS,
    protocolMappingStatus: protocolMapping,
    runtimeIdentityAlignment,
    realNameWorkflow: REAL_NAME_WORKFLOW,
    guardianDelegationWorkflow: GUARDIAN_DELEGATION_WORKFLOW,
    identityReviewCoverage,
    organizationCount: organizations.length,
    userCount: users.length,
    p0IdentityRequirements,
    sampleMappings,
    adapterContracts,
    checks
  };
}

function renderMarkdown(contract) {
  const cell = (value) => String(value ?? "").replace(/\|/g, "/");
  const checkRows = contract.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  const claimRows = contract.requiredClaims.map((item) => `| ${item.required ? "required" : "optional"} | ${item.claim} | ${item.purpose} |`);
  const roleRows = Object.entries(contract.roleCoverage).map(([role, item]) => `| ${role} | ${item.users} | ${item.homes.join(", ")} | ${item.orgCodes.join(", ")} |`);
  const sampleRows = contract.sampleMappings.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${item.orgCode} | ${item.roles.join(", ")} | ${item.mappedRole} | ${item.mappedHome} |`);
  const adapterRows = Object.entries(contract.adapterContracts).map(([adapter, controls]) => `| ${adapter} | ${Object.values(controls).every(Boolean) ? "foundation-ready" : "incomplete"} | ${Object.entries(controls).map(([name, passed]) => `${name}:${passed ? "PASS" : "FAIL"}`).join("; ")} |`);
  const organizationRows = contract.referenceOrganizations.map((item) => `| ${item.orgCode} | ${cell(item.name)} | ${item.canonicalLevel} | ${item.orgType} | ${item.parentCode || "-"} |`);
  const permissionRows = contract.permissionMatrix.map((item) => `| ${item.actor} | ${item.portalRole} | ${item.accountType} | ${item.organizationScope} | ${cell(item.permissions.join(", "))} |`);
  const protocolRows = contract.protocolClaimMappings.map((item) => `| ${item.field} | ${cell(item.oidc.join(" + "))} | ${cell(item.saml.join(" + "))} | ${cell(item.local)} | ${cell(item.validation)} |`);
  const blockerRows = contract.productionBlockers.map((item) => `- ${item}`);
  return [
    "# Identity integration contract",
    "",
    `- Generated at: ${contract.generatedAt}`,
    `- Foundation result: ${contract.ok ? "PASS" : "FAIL"}`,
    `- Production ready: ${contract.productionReady ? "YES" : "NO"}`,
    `- Users: ${contract.userCount}`,
    `- Organizations: ${contract.organizationCount}`,
    "",
    "## Production blockers",
    "",
    ...(blockerRows.length ? blockerRows : ["- none"]),
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...checkRows,
    "",
    "## Required external claims",
    "",
    "| Level | Claim | Purpose |",
    "|---|---|---|",
    ...claimRows,
    "",
    "## Role and portal coverage",
    "",
    "| Role | Users | Homes | Org codes |",
    "|---|---:|---|---|",
    ...roleRows,
    "",
    "## Sample mappings",
    "",
    "| Result | Sample | Org code | Roles | Mapped role | Mapped home |",
    "|---|---|---|---|---|---|",
    ...sampleRows,
    "",
    "## Target organization hierarchy",
    "",
    `Current levels: ${contract.currentOrganizationTopology.levelsPresent.join(", ")}; missing target levels: ${contract.currentOrganizationTopology.missingTargetLevels.join(", ") || "none"}.`,
    "",
    "| Org code | Name | Canonical level | Type | Parent |",
    "|---|---|---|---|---|",
    ...organizationRows,
    "",
    "## Least-privilege permission matrix",
    "",
    `Default policy: ${contract.permissionMatrixStatus.defaultPolicy}.`,
    "",
    "| Actor | Portal role | Account type | Scope | Permissions |",
    "|---|---|---|---|---|",
    ...permissionRows,
    "",
    "## OIDC and SAML claim mappings",
    "",
    "| Field | OIDC | SAML | Local target | Validation |",
    "|---|---|---|---|---|",
    ...protocolRows,
    "",
    "## Real-name workflow",
    "",
    `- States: ${contract.realNameWorkflow.states.join(" -> ")}`,
    `- Required evidence: ${contract.realNameWorkflow.requiredEvidence.join(", ")}`,
    `- Controls: ${contract.realNameWorkflow.controls.join(", ")}`,
    "",
    "## Guardian delegation workflow",
    "",
    `- States: ${contract.guardianDelegationWorkflow.states.join(" -> ")}`,
    `- Required fields: ${contract.guardianDelegationWorkflow.requiredFields.join(", ")}`,
    `- Controls: ${contract.guardianDelegationWorkflow.controls.join(", ")}`,
    `- Current review cases: ${contract.identityReviewCoverage.cases}; guardian cases: ${contract.identityReviewCoverage.guardianCases}; production-ready cases: ${contract.identityReviewCoverage.productionReadyCases}`,
    "",
    "## Production runtime adapters",
    "",
    "| Adapter | Status | Controls |",
    "|---|---|---|",
    ...adapterRows,
    "",
    "Runtime adapter readiness does not replace real provider joint-test receipts, directory ownership and mapping acceptance, delivery callbacks or site signoff.",
    ""
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  argv.forEach((flag) => {
    if (!flag.startsWith("--")) return;
    const [key, ...rest] = flag.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  });
  return flags;
}

function writeOutput(contract, flags = {}) {
  const output = path.resolve(ROOT, String(flags.output || DEFAULT_OUTPUT));
  const markdown = path.resolve(ROOT, String(flags.markdown || DEFAULT_MARKDOWN));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(contract, null, 2), "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, renderMarkdown(contract), "utf8");
}

function runCli() {
  const flags = parseArgs();
  const contract = buildIdentityContract();
  if (flags.write !== false) writeOutput(contract, flags);
  console.log(JSON.stringify(contract, null, 2));
  if (!contract.ok) process.exitCode = 1;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  buildIdentityContract,
  canonicalOrganizationLevel,
  parseArgs,
  permissionMatrixStatus,
  renderMarkdown,
  validateOrganizationHierarchy,
  writeOutput
};
