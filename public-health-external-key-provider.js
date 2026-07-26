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
const {
  buildPublicHealthExternalContractGovernance
} = require("./public-health-external-contract-governance-service");
const {
  normalizeProbePolicy
} = require("./public-health-external-endpoint-probe-runner");

const ROTATION_SEQUENCE = Object.freeze([
  "new-active",
  "old-grace",
  "cross-key-audit-smoke",
  "cross-key-callback-smoke",
  "old-expire-or-revoke"
]);

let managedKeyringLoader = null;
let managedEndpointProbeTlsLoader = null;

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
  const suffix = purpose === "request"
    ? "REQUEST_KEYRING_REF"
    : purpose === "endpoint-probe"
      ? "ENDPOINT_PROBE_KEYRING_REF"
      : "RECEIPT_KEYRING_REF";
  return `${profile.endpointEnv.replace(/_ENDPOINT$/, "")}_${suffix}`;
}

function legacySecretEnv(profile, purpose) {
  if (purpose === "request") return profile.requestSecretEnv;
  if (purpose === "endpoint-probe") {
    return `${profile.endpointEnv.replace(/_ENDPOINT$/, "")}_ENDPOINT_PROBE_SECRET`;
  }
  return profile.receiptSecretEnv;
}

function configurePublicHealthKeyringLoader(loader) {
  if (loader !== null && typeof loader !== "function") {
    throw new Error("public health managed keyring loader must be a function or null");
  }
  managedKeyringLoader = loader;
}

function configurePublicHealthEndpointProbeTlsLoader(loader) {
  if (loader !== null && typeof loader !== "function") {
    throw new Error("public health endpoint probe TLS loader must be a function or null");
  }
  managedEndpointProbeTlsLoader = loader;
}

function parseEndpointProbePolicyConfig(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  const serialized = clean(value);
  if (!serialized) return null;
  try {
    const parsed = JSON.parse(serialized);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object required");
    return parsed;
  } catch (error) {
    throw new Error(`PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_POLICIES must be a JSON object: ${error.message}`);
  }
}

function normalizeEndpointProbePolicy(value = {}) {
  const policy = normalizeProbePolicy(value);
  const minIntervalSeconds = Number(value.minIntervalSeconds ?? 60);
  if (!Number.isInteger(minIntervalSeconds) || minIntervalSeconds < 1 || minIntervalSeconds > 86400) {
    throw new Error("endpoint probe minIntervalSeconds must be an integer from 1 to 86400");
  }
  return Object.freeze({ ...policy, minIntervalSeconds });
}

function loadPublicHealthEndpointProbePolicies(options = {}) {
  const env = options.env || process.env;
  const production = options.production === undefined
    ? clean(env.NODE_ENV).toLowerCase() === "production"
    : Boolean(options.production);
  const configured = parseEndpointProbePolicyConfig(
    options.endpointProbePolicies === undefined
      ? env.PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_POLICIES
      : options.endpointProbePolicies
  );
  if (production && !configured) {
    throw new Error("PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_POLICIES is required in production");
  }
  return Object.freeze(Object.fromEntries(EXTERNAL_ADAPTER_PROFILES.map((profile) => {
    const lanePolicy = configured?.[profile.laneId];
    if (production && !lanePolicy) {
      throw new Error(`production endpoint probe policy is required for public health lane ${profile.laneId}`);
    }
    return [profile.laneId, normalizeEndpointProbePolicy(lanePolicy || {})];
  })));
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
    resiliencePolicies: { value: values.resiliencePolicies, enumerable: false },
    contractGovernance: { value: values.contractGovernance, enumerable: false }
  });
  return Object.freeze(credentials);
}

function privateContractGovernanceMaterial(keyring, governance, summary) {
  const material = { governance, summary };
  Object.defineProperty(material, "signingMaterial", {
    value: keyring,
    enumerable: false
  });
  return Object.freeze(material);
}

function privateEndpointProbeContext(values, summary) {
  const context = { summary };
  Object.defineProperties(context, {
    endpoint: { value: values.endpoint, enumerable: false },
    contract: { value: values.contract, enumerable: false },
    keyring: { value: values.keyring, enumerable: false },
    policy: { value: values.policy, enumerable: false },
    tlsOptions: { value: values.tlsOptions, enumerable: false }
  });
  return Object.freeze(context);
}

async function loadPublicHealthContractGovernance(data = {}, options = {}) {
  const env = options.env || process.env;
  const at = clean(options.at || new Date().toISOString());
  const production = options.production === undefined
    ? clean(env.NODE_ENV).toLowerCase() === "production"
    : Boolean(options.production);
  const loader = options.loader === undefined ? managedKeyringLoader : options.loader;
  const referenceName = "PUBLIC_HEALTH_EXTERNAL_CONTRACT_GOVERNANCE_KEYRING_REF";
  const reference = clean(env[referenceName]);
  let keyring;
  let source;
  if (loader && reference) {
    keyring = await loader({
      laneId: "contract-governance",
      purpose: "public-health-contract-governance",
      reference,
      at
    });
    selectSigningKey(keyring, at);
    source = "managed-key-service";
  } else {
    if (production) {
      if (!reference) throw new Error(`${referenceName} is required in production`);
      throw new Error("managed public health contract governance key service is unavailable");
    }
    keyring = clean(env.PUBLIC_HEALTH_EXTERNAL_CONTRACT_GOVERNANCE_SECRET);
    if (keyring.length < 32) {
      throw new Error("PUBLIC_HEALTH_EXTERNAL_CONTRACT_GOVERNANCE_SECRET must contain at least 32 characters for local compatibility");
    }
    selectSigningKey(keyring, at);
    source = "legacy-static";
  }
  const keyringSummary = summarizeKeyring(keyring, at);
  const attestations = Array.isArray(data.publicHealthExternalContractAttestations)
    ? data.publicHealthExternalContractAttestations
    : [];
  const governance = buildPublicHealthExternalContractGovernance({
    attestations,
    signingMaterial: keyring,
    at
  });
  return privateContractGovernanceMaterial(keyring, governance, {
    source,
    referenceConfigured: Boolean(reference),
    keyring: keyringSummary,
    attestations: attestations.length,
    governanceOk: governance.ok,
    productionReady: false,
    blockers: [
      ...(keyringSummary.productionReady ? [] : keyringSummary.blockers),
      "Signed contract governance does not replace deployed release, migration or site acceptance evidence."
    ]
  });
}

async function loadPublicHealthEndpointProbeContext(laneId, data = {}, options = {}) {
  const profile = profileForLane(laneId);
  const env = options.env || process.env;
  const at = clean(options.at || new Date().toISOString());
  const production = options.production === undefined
    ? clean(env.NODE_ENV).toLowerCase() === "production"
    : Boolean(options.production);
  const keyringLoader = options.loader === undefined ? managedKeyringLoader : options.loader;
  const tlsLoader = options.tlsLoader === undefined ? managedEndpointProbeTlsLoader : options.tlsLoader;
  const endpoint = clean(env[profile.endpointEnv]);
  const policies = loadPublicHealthEndpointProbePolicies({
    env,
    production,
    endpointProbePolicies: options.endpointProbePolicies
  });
  const policy = policies[profile.laneId];
  const signing = await loadPurposeKeyring(profile, "endpoint-probe", {
    env,
    at,
    loader: keyringLoader,
    production
  });
  const contractGovernance = options.contractGovernance
    || (await loadPublicHealthContractGovernance(data, {
      env,
      at,
      loader: keyringLoader,
      production
    })).governance;
  const contractEntry = (contractGovernance.entries || [])
    .find((item) => item.laneId === profile.laneId);
  const contract = clean(contractEntry?.currentContract);
  if (!contractGovernance.ok || !contract) {
    throw new Error(`active endpoint probe contract is unavailable for public health lane ${profile.laneId}`);
  }
  const tlsReferenceName = `${profile.endpointEnv.replace(/_ENDPOINT$/, "")}_ENDPOINT_PROBE_TLS_REF`;
  const tlsReference = clean(env[tlsReferenceName]);
  let tlsOptions = {};
  if (tlsReference) {
    if (!tlsLoader) throw new Error(`managed endpoint probe TLS service is unavailable for ${profile.laneId}`);
    tlsOptions = await tlsLoader({
      laneId: profile.laneId,
      purpose: "public-health-endpoint-probe-tls",
      reference: tlsReference,
      at
    });
    if (!tlsOptions || typeof tlsOptions !== "object" || Array.isArray(tlsOptions)) {
      throw new Error(`managed endpoint probe TLS credentials are invalid for ${profile.laneId}`);
    }
  } else if (production && policy.requireMutualTls) {
    throw new Error(`${tlsReferenceName} is required when mutual TLS is required`);
  }
  const keyringSummary = summarizeKeyring(signing.keyring, at);
  return privateEndpointProbeContext({
    endpoint,
    contract,
    keyring: signing.keyring,
    policy,
    tlsOptions
  }, {
    laneId: profile.laneId,
    endpointConfigured: /^https:\/\//i.test(endpoint),
    contractConfigured: Boolean(contract),
    policyConfigured: true,
    certificatePinningEnabled: policy.certificatePins.length > 0,
    mutualTlsRequired: policy.requireMutualTls,
    tlsReferenceConfigured: Boolean(tlsReference),
    keyring: keyringSummary,
    source: signing.source,
    productionReady: false,
    blockers: [
      ...(keyringSummary.productionReady ? [] : keyringSummary.blockers),
      "Active endpoint probing does not replace trusted site evidence, production handoff or launch approval."
    ]
  });
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
  const contractGovernance = options.contractGovernance
    || (options.data
      ? (await loadPublicHealthContractGovernance(options.data, { env, at, loader, production })).governance
      : null);
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
    resiliencePolicies,
    contractGovernance
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
  configurePublicHealthEndpointProbeTlsLoader,
  configurePublicHealthKeyringLoader,
  evaluateRotationEvidence,
  loadPublicHealthContractGovernance,
  loadPublicHealthEndpointProbeContext,
  loadPublicHealthEndpointProbePolicies,
  loadPublicHealthLaneCredentialMap,
  loadPublicHealthLaneCredentials,
  loadPublicHealthResiliencePolicies,
  profileForLane,
  revokedReferenceIssues,
  DEFAULT_RESILIENCE_POLICY
};
