const {
  EXTERNAL_ADAPTER_PROFILES
} = require("./public-health-external-adapter-service");
const {
  resolveVerificationKey,
  selectSigningKey,
  summarizeKeyring
} = require("./public-health-external-keyring-service");
const {
  normalizePublicHealthExternalResiliencePolicy
} = require("./public-health-external-resilience-service");

const ROTATION_SEQUENCE = Object.freeze([
  "new-active",
  "old-grace",
  "cross-key-audit-smoke",
  "cross-key-callback-smoke",
  "old-expire-or-revoke"
]);

let managedKeyringLoader = null;

const DEFAULT_RESILIENCE_POLICY = Object.freeze({
  failureThreshold: 3,
  openSeconds: 120,
  halfOpenMaxProbes: 1,
  rateLimitPerMinute: 30,
  maxPending: 100
});

function clean(value) {
  return String(value ?? "").trim();
}

function profileForLane(laneId) {
  const profile = EXTERNAL_ADAPTER_PROFILES.find((item) => item.laneId === clean(laneId));
  if (!profile) throw new Error(`unsupported public health adapter lane: ${clean(laneId) || "missing"}`);
  return profile;
}

function keyringReferenceEnv(profile, purpose) {
  const suffix = purpose === "request" ? "REQUEST_KEYRING_REF" : "RECEIPT_KEYRING_REF";
  return `${profile.endpointEnv.replace(/_ENDPOINT$/, "")}_${suffix}`;
}

function legacySecretEnv(profile, purpose) {
  return purpose === "request" ? profile.requestSecretEnv : profile.receiptSecretEnv;
}

function configurePublicHealthKeyringLoader(loader) {
  if (loader !== null && typeof loader !== "function") {
    throw new Error("public health managed keyring loader must be a function or null");
  }
  managedKeyringLoader = loader;
}

function parseResiliencePolicyConfig(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  const serialized = clean(value);
  if (!serialized) return null;
  try {
    const parsed = JSON.parse(serialized);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object required");
    return parsed;
  } catch (error) {
    throw new Error(`PUBLIC_HEALTH_EXTERNAL_RESILIENCE_POLICIES must be a JSON object: ${error.message}`);
  }
}

function loadPublicHealthResiliencePolicies(options = {}) {
  const env = options.env || process.env;
  const production = options.production === undefined
    ? clean(env.NODE_ENV).toLowerCase() === "production"
    : Boolean(options.production);
  const configured = parseResiliencePolicyConfig(
    options.resiliencePolicies === undefined
      ? env.PUBLIC_HEALTH_EXTERNAL_RESILIENCE_POLICIES
      : options.resiliencePolicies
  );
  if (production && !configured) {
    throw new Error("PUBLIC_HEALTH_EXTERNAL_RESILIENCE_POLICIES is required in production");
  }
  const entries = EXTERNAL_ADAPTER_PROFILES.map((profile) => {
    const lanePolicy = configured?.[profile.laneId];
    if (production && !lanePolicy) {
      throw new Error(`production resilience policy is required for public health lane ${profile.laneId}`);
    }
    return [
      profile.laneId,
      Object.freeze(normalizePublicHealthExternalResiliencePolicy(lanePolicy || DEFAULT_RESILIENCE_POLICY))
    ];
  });
  return Object.freeze(Object.fromEntries(entries));
}

async function loadPurposeKeyring(profile, purpose, options) {
  const { env, at, loader, production } = options;
  const referenceName = keyringReferenceEnv(profile, purpose);
  const reference = clean(env[referenceName]);
  if (loader && reference) {
    const keyring = await loader({
      laneId: profile.laneId,
      purpose: `public-health-${purpose}`,
      reference,
      at
    });
    selectSigningKey(keyring, at);
    return { keyring, source: "managed-key-service", referenceConfigured: true };
  }
  if (production) {
    if (!reference) throw new Error(`${referenceName} is required in production`);
    throw new Error(`managed public health key service is unavailable for ${profile.laneId} ${purpose}`);
  }
  const secret = clean(env[legacySecretEnv(profile, purpose)]);
  if (secret.length < 32) {
    throw new Error(`${legacySecretEnv(profile, purpose)} must contain at least 32 characters for local compatibility`);
  }
  selectSigningKey(secret, at);
  return { keyring: secret, source: "legacy-static", referenceConfigured: Boolean(reference) };
}

function privateCredentials(values, summary) {
  const credentials = { summary };
  Object.defineProperties(credentials, {
    endpoint: { value: values.endpoint, enumerable: false },
    requestKeyring: { value: values.requestKeyring, enumerable: false },
    receiptKeyring: { value: values.receiptKeyring, enumerable: false },
    maxAttempts: { value: values.maxAttempts, enumerable: false },
    resiliencePolicies: { value: values.resiliencePolicies, enumerable: false }
  });
  return Object.freeze(credentials);
}

async function loadPublicHealthLaneCredentials(laneId, options = {}) {
  const profile = profileForLane(laneId);
  const env = options.env || process.env;
  const at = clean(options.at || new Date().toISOString());
  const production = clean(env.NODE_ENV).toLowerCase() === "production";
  const loader = options.loader === undefined ? managedKeyringLoader : options.loader;
  const endpoint = clean(env[profile.endpointEnv]);
  const resiliencePolicies = loadPublicHealthResiliencePolicies({
    env,
    production,
    resiliencePolicies: options.resiliencePolicies
  });
  const request = await loadPurposeKeyring(profile, "request", { env, at, loader, production });
  const receipt = await loadPurposeKeyring(profile, "receipt", { env, at, loader, production });
  const maxAttempts = Number(env[`${profile.endpointEnv.replace(/_ENDPOINT$/, "")}_MAX_ATTEMPTS`] || profile.maxAttempts);
  const requestSummary = summarizeKeyring(request.keyring, at);
  const receiptSummary = summarizeKeyring(receipt.keyring, at);
  const summary = {
    laneId: profile.laneId,
    endpointConfigured: /^https:\/\//i.test(endpoint),
    requestKeyring: requestSummary,
    receiptKeyring: receiptSummary,
    source: request.source === "managed-key-service" && receipt.source === "managed-key-service"
      ? "managed-key-service"
      : "legacy-static",
    resilience: {
      configured: true,
      lanes: Object.keys(resiliencePolicies).length,
      source: clean(env.PUBLIC_HEALTH_EXTERNAL_RESILIENCE_POLICIES) || options.resiliencePolicies
        ? "server-config"
        : "local-compatibility-defaults"
    },
    productionReady: false,
    blockers: [
      ...(requestSummary.productionReady ? [] : requestSummary.blockers),
      ...(receiptSummary.productionReady ? [] : receiptSummary.blockers),
      "Production connectivity, cross-key smoke evidence and trusted site evidence remain required."
    ]
  };
  return privateCredentials({
    endpoint,
    requestKeyring: request.keyring,
    receiptKeyring: receipt.keyring,
    maxAttempts,
    resiliencePolicies
  }, summary);
}

async function loadPublicHealthLaneCredentialMap(options = {}) {
  const entries = await Promise.all(EXTERNAL_ADAPTER_PROFILES.map(async (profile) => [
    profile.laneId,
    await loadPublicHealthLaneCredentials(profile.laneId, options)
  ]));
  return Object.fromEntries(entries);
}

function evaluateRotationEvidence(evidence = []) {
  const completed = new Set(
    (Array.isArray(evidence) ? evidence : [])
      .filter((item) => item && item.status === "verified")
      .map((item) => clean(item.step))
  );
  let blocked = false;
  const steps = ROTATION_SEQUENCE.map((step, index) => {
    const verified = completed.has(step);
    const prerequisiteMet = index === 0 || ROTATION_SEQUENCE.slice(0, index).every((item) => completed.has(item));
    if (verified && !prerequisiteMet) blocked = true;
    return {
      step,
      order: index + 1,
      status: verified && prerequisiteMet ? "verified" : prerequisiteMet ? "pending" : "blocked-by-sequence"
    };
  });
  return {
    ok: !blocked,
    steps,
    complete: steps.every((item) => item.status === "verified"),
    productionReady: false
  };
}

function revokedReferenceIssues(data = {}, credentialMap = {}) {
  const issues = [];
  const dispatches = Array.isArray(data.publicHealthExternalDispatches)
    ? data.publicHealthExternalDispatches
    : [];
  const auditRows = Array.isArray(data.publicHealthExternalDispatchAudit)
    ? data.publicHealthExternalDispatchAudit
    : [];
  const inspect = (dispatch, purpose, keyId, at, source) => {
    if (!keyId) return;
    const credentials = credentialMap[dispatch.laneId];
    const keyring = purpose === "receipt" ? credentials?.receiptKeyring : credentials?.requestKeyring;
    if (!keyring) return;
    const resolution = resolveVerificationKey(keyring, keyId, at || new Date().toISOString());
    if (resolution.reason !== "key-revoked") return;
    issues.push({
      severity: "P0",
      code: "emergency-key-revocation-reference",
      laneId: dispatch.laneId,
      dispatchId: dispatch.id,
      keyId,
      purpose,
      source,
      disposition: "security-quarantine",
      automaticResignAllowed: false,
      automaticRecoveryAllowed: false
    });
  };
  dispatches.forEach((dispatch) => {
    inspect(dispatch, "request", dispatch.requestSignatureKeyId, dispatch.request?.issuedAt, "request");
    inspect(dispatch, "request", dispatch.runtimeStateKeyId, dispatch.runtimeStateSignedAt, "runtime-state");
    inspect(dispatch, "receipt", dispatch.receipt?.signingKeyId, dispatch.receipt?.issuedAt, "receipt");
    auditRows.filter((item) => item.dispatchId === dispatch.id).forEach((item) => (
      inspect(dispatch, "request", item.auditKeyId, item.at, `audit:${item.id}`)
    ));
  });
  return issues;
}

function buildPublicHealthKeySafetyBoard(data = {}, credentialMap = {}) {
  const revocationIssues = revokedReferenceIssues(data, credentialMap);
  return {
    ok: revocationIssues.length === 0,
    productionReady: false,
    emergencyDisposition: revocationIssues.length ? "security-quarantine" : "none",
    automaticResignAllowed: false,
    automaticRecoveryAllowed: false,
    revocationIssues,
    rotation: evaluateRotationEvidence(data.publicHealthExternalKeyRotationEvidence)
  };
}

module.exports = {
  ROTATION_SEQUENCE,
  buildPublicHealthKeySafetyBoard,
  configurePublicHealthKeyringLoader,
  evaluateRotationEvidence,
  loadPublicHealthLaneCredentialMap,
  loadPublicHealthLaneCredentials,
  loadPublicHealthResiliencePolicies,
  profileForLane,
  revokedReferenceIssues,
  DEFAULT_RESILIENCE_POLICY
};
