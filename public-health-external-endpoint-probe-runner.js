"use strict";

const crypto = require("node:crypto");
const dns = require("node:dns");
const https = require("node:https");
const net = require("node:net");
const { performance } = require("node:perf_hooks");
const {
  EXTERNAL_ADAPTER_PROFILES
} = require("./public-health-external-adapter-service");
const {
  DEFAULT_MAX_LATENCY_MS,
  ENDPOINT_PROBE_SCHEMA_VERSION,
  MAX_PROBE_TTL_SECONDS,
  TRUSTED_ATTESTATION_ORIGIN,
  TRUSTED_VERIFICATION_SOURCE,
  isPublicEndpointAddress,
  normalizeProductionEndpoint,
  signPublicHealthExternalEndpointProbeReceipt,
  verifyPublicHealthExternalEndpointProbeReceipt
} = require("./public-health-external-endpoint-verification-service");

const DEFAULT_PROBE_TIMEOUT_MS = 5000;
const DEFAULT_PROBE_TTL_SECONDS = 600;
const MAX_RESOLVED_ADDRESSES = 16;
const ALLOWED_COMMAND_KEYS = new Set(["laneId"]);

function clean(value) {
  return String(value ?? "").trim();
}

function probeError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function profileForLane(laneId) {
  return EXTERNAL_ADAPTER_PROFILES.find((item) => item.laneId === clean(laneId));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeFingerprint(value, label = "certificate fingerprint") {
  const normalized = clean(value).replaceAll(":", "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw probeError("ENDPOINT_PROBE_CERTIFICATE_INVALID", `${label} must be a SHA-256 digest`);
  }
  return normalized;
}

function normalizeProbePolicy(value = {}) {
  const maxLatencyMs = Number(value.maxLatencyMs ?? DEFAULT_MAX_LATENCY_MS);
  const timeoutMs = Number(value.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS);
  const ttlSeconds = Number(value.ttlSeconds ?? DEFAULT_PROBE_TTL_SECONDS);
  const method = clean(value.method || "HEAD").toUpperCase();
  if (!Number.isInteger(maxLatencyMs) || maxLatencyMs < 1 || maxLatencyMs > 60000) {
    throw probeError("ENDPOINT_PROBE_POLICY_INVALID", "maxLatencyMs must be an integer from 1 to 60000");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) {
    throw probeError("ENDPOINT_PROBE_POLICY_INVALID", "timeoutMs must be an integer from 100 to 60000");
  }
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > MAX_PROBE_TTL_SECONDS) {
    throw probeError(
      "ENDPOINT_PROBE_POLICY_INVALID",
      `ttlSeconds must be an integer from 60 to ${MAX_PROBE_TTL_SECONDS}`
    );
  }
  if (!["GET", "HEAD"].includes(method)) {
    throw probeError("ENDPOINT_PROBE_POLICY_INVALID", "probe method must be GET or HEAD");
  }
  const certificatePins = [...new Set(
    (Array.isArray(value.certificatePins) ? value.certificatePins : value.certificatePins ? [value.certificatePins] : [])
      .map((item) => normalizeFingerprint(item, "certificate pin"))
  )];
  if (certificatePins.length > 16) {
    throw probeError("ENDPOINT_PROBE_POLICY_INVALID", "certificate pin list exceeds the server policy limit");
  }
  return {
    maxLatencyMs,
    timeoutMs,
    ttlSeconds,
    method,
    requireMutualTls: value.requireMutualTls === true,
    certificatePins
  };
}

function assertServerOnlyCommand(command = {}) {
  const unknownKeys = Object.keys(command).filter((key) => !ALLOWED_COMMAND_KEYS.has(key));
  if (unknownKeys.length) {
    throw probeError(
      "ENDPOINT_PROBE_COMMAND_OVERRIDE_FORBIDDEN",
      "endpoint probe command may contain only laneId"
    );
  }
  const profile = profileForLane(command.laneId);
  if (!profile) throw probeError("ENDPOINT_PROBE_LANE_INVALID", "endpoint probe lane is invalid");
  return profile;
}

function normalizeResolvedAddresses(value) {
  const rows = Array.isArray(value) ? value : [];
  const addresses = [];
  for (const row of rows) {
    const address = clean(typeof row === "string" ? row : row?.address).toLowerCase();
    const family = Number(typeof row === "string" ? net.isIP(address) : row?.family || net.isIP(address));
    if (!address || ![4, 6].includes(family) || net.isIP(address) !== family) {
      throw probeError("ENDPOINT_PROBE_DNS_INVALID", "DNS resolver returned an invalid address");
    }
    if (!isPublicEndpointAddress(address)) {
      throw probeError(
        "ENDPOINT_PROBE_DNS_NON_PUBLIC",
        "DNS resolution included a loopback, private or reserved address"
      );
    }
    if (!addresses.some((item) => item.address === address)) addresses.push({ address, family });
  }
  if (!addresses.length) {
    throw probeError("ENDPOINT_PROBE_DNS_EMPTY", "DNS resolution returned no public address");
  }
  if (addresses.length > MAX_RESOLVED_ADDRESSES) {
    throw probeError("ENDPOINT_PROBE_DNS_EXCESSIVE", "DNS resolution exceeded the address limit");
  }
  return addresses;
}

async function defaultResolveAddresses(hostname) {
  if (net.isIP(hostname)) return [{ address: hostname, family: net.isIP(hostname) }];
  try {
    return await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw probeError("ENDPOINT_PROBE_DNS_FAILED", "DNS resolution failed", error);
  }
}

function peerCertificateFingerprint(socket) {
  const certificate = socket.getPeerCertificate?.(true) || {};
  if (certificate.fingerprint256) return normalizeFingerprint(certificate.fingerprint256);
  if (Buffer.isBuffer(certificate.raw) && certificate.raw.length) return sha256(certificate.raw);
  throw probeError("ENDPOINT_PROBE_CERTIFICATE_INVALID", "peer certificate fingerprint is unavailable");
}

function localCertificatePresented(socket, tlsOptions = {}) {
  const certificate = socket.getCertificate?.() || {};
  return Boolean(
    tlsOptions.cert
    && ((Buffer.isBuffer(certificate.raw) && certificate.raw.length) || clean(certificate.subject))
  );
}

function safeTlsClientOptions(value = {}) {
  const allowed = [
    "ca",
    "cert",
    "key",
    "pfx",
    "passphrase",
    "ciphers",
    "ecdhCurve",
    "honorCipherOrder",
    "minVersion",
    "maxVersion",
    "secureOptions",
    "sigalgs"
  ];
  return Object.fromEntries(
    allowed
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, value[key]])
  );
}

function defaultHttpsTransport({
  endpoint,
  resolvedAddress,
  family,
  policy,
  tlsOptions = {}
}) {
  const target = new URL(endpoint);
  const trustedTlsOptions = safeTlsClientOptions(tlsOptions);
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    let settled = false;
    const fail = (code, message, cause) => {
      if (settled) return;
      settled = true;
      reject(probeError(code, message, cause));
    };
    const request = https.request({
      protocol: "https:",
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search}`,
      method: policy.method,
      headers: {
        Host: target.host,
        Accept: "*/*",
        "User-Agent": "public-health-endpoint-probe/1"
      },
      ...trustedTlsOptions,
      servername: net.isIP(target.hostname) ? undefined : target.hostname,
      rejectUnauthorized: true,
      timeout: policy.timeoutMs,
      lookup: (_hostname, _options, callback) => callback(null, resolvedAddress, family)
    }, (response) => {
      const socket = response.socket;
      const observation = {
        statusCode: Number(response.statusCode),
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        remoteAddress: clean(socket.remoteAddress).toLowerCase(),
        authorized: socket.authorized === true,
        tlsProtocol: clean(socket.getProtocol?.()),
        certificateFingerprintSha256: peerCertificateFingerprint(socket),
        mutualTlsVerified: localCertificatePresented(socket, tlsOptions)
      };
      response.resume();
      response.once("end", () => {
        if (settled) return;
        settled = true;
        resolve(observation);
      });
      response.once("error", (error) => fail(
        "ENDPOINT_PROBE_RESPONSE_FAILED",
        "HTTPS probe response failed",
        error
      ));
    });
    request.once("timeout", () => request.destroy(
      probeError("ENDPOINT_PROBE_TIMEOUT", "HTTPS probe timed out")
    ));
    request.once("error", (error) => fail(
      clean(error?.code).startsWith("ENDPOINT_PROBE_") ? error.code : "ENDPOINT_PROBE_TRANSPORT_FAILED",
      clean(error?.code).startsWith("ENDPOINT_PROBE_") ? error.message : "HTTPS probe transport failed",
      error
    ));
    request.end();
  });
}

function validateObservation(observation = {}, context = {}) {
  const statusCode = Number(observation.statusCode);
  const latencyMs = Number(observation.latencyMs);
  const remoteAddress = clean(observation.remoteAddress).toLowerCase();
  if (!context.addresses.some((item) => item.address === remoteAddress)) {
    throw probeError(
      "ENDPOINT_PROBE_DNS_REBINDING",
      "HTTPS peer address does not match the pinned DNS result"
    );
  }
  if (!isPublicEndpointAddress(remoteAddress)) {
    throw probeError("ENDPOINT_PROBE_REMOTE_NON_PUBLIC", "HTTPS peer address is not public");
  }
  if (!Number.isInteger(statusCode) || statusCode < 200 || statusCode > 299) {
    throw probeError("ENDPOINT_PROBE_HTTP_UNHEALTHY", "HTTPS probe did not return a successful status");
  }
  if (!Number.isFinite(latencyMs) || latencyMs < 0 || latencyMs > context.policy.maxLatencyMs) {
    throw probeError("ENDPOINT_PROBE_LATENCY_EXCEEDED", "HTTPS probe latency exceeds server policy");
  }
  if (observation.authorized !== true) {
    throw probeError("ENDPOINT_PROBE_TLS_UNAUTHORIZED", "HTTPS peer certificate is not authorized");
  }
  const tlsProtocol = clean(observation.tlsProtocol);
  if (!["TLSv1.2", "TLSv1.3"].includes(tlsProtocol)) {
    throw probeError("ENDPOINT_PROBE_TLS_PROTOCOL_REJECTED", "HTTPS probe negotiated a disallowed TLS protocol");
  }
  const fingerprint = normalizeFingerprint(observation.certificateFingerprintSha256);
  if (context.policy.certificatePins.length && !context.policy.certificatePins.includes(fingerprint)) {
    throw probeError(
      "ENDPOINT_PROBE_CERTIFICATE_PIN_MISMATCH",
      "HTTPS peer certificate does not match server policy"
    );
  }
  const mutualTlsVerified = observation.mutualTlsVerified === true;
  if (context.policy.requireMutualTls && !mutualTlsVerified) {
    throw probeError("ENDPOINT_PROBE_MTLS_REQUIRED", "mutual TLS is required by server policy");
  }
  return {
    statusCode,
    latencyMs,
    remoteAddress,
    tlsProtocol,
    fingerprint,
    mutualTlsVerified
  };
}

function secureId(prefix, randomUUID = crypto.randomUUID) {
  return `${prefix}-${randomUUID()}`;
}

async function runPublicHealthExternalEndpointProbe(command = {}, options = {}) {
  const profile = assertServerOnlyCommand(command);
  const env = options.env || {};
  const endpoint = normalizeProductionEndpoint(env[profile.endpointEnv]);
  const target = new URL(endpoint);
  const policy = normalizeProbePolicy(
    typeof options.policyResolver === "function"
      ? options.policyResolver(profile.laneId, profile)
      : options.policy
  );
  const resolver = options.resolveAddresses || defaultResolveAddresses;
  let resolvedRows;
  try {
    resolvedRows = await resolver(target.hostname, {
      laneId: profile.laneId,
      adapterId: profile.adapterId
    });
  } catch (error) {
    if (clean(error?.code).startsWith("ENDPOINT_PROBE_")) throw error;
    throw probeError("ENDPOINT_PROBE_DNS_FAILED", "DNS resolution failed", error);
  }
  const addresses = normalizeResolvedAddresses(resolvedRows);
  const selectedAddress = addresses[0];
  const transport = options.transport || defaultHttpsTransport;
  let observation;
  try {
    observation = await transport({
      laneId: profile.laneId,
      adapterId: profile.adapterId,
      endpoint,
      hostname: target.hostname,
      sniHostname: target.hostname.toLowerCase(),
      resolvedAddress: selectedAddress.address,
      family: selectedAddress.family,
      addresses: addresses.map((item) => ({ ...item })),
      policy: { ...policy },
      tlsOptions: typeof options.tlsOptionsResolver === "function"
        ? options.tlsOptionsResolver(profile.laneId, profile) || {}
        : {}
    });
  } catch (error) {
    if (clean(error?.code).startsWith("ENDPOINT_PROBE_")) throw error;
    throw probeError("ENDPOINT_PROBE_TRANSPORT_FAILED", "HTTPS probe transport failed", error);
  }
  const validated = validateObservation(observation, { addresses, policy });
  const issuedAt = new Date(options.at || new Date().toISOString());
  if (!Number.isFinite(issuedAt.getTime())) {
    throw probeError("ENDPOINT_PROBE_TIME_INVALID", "server probe time is invalid");
  }
  const expiresAt = new Date(issuedAt.getTime() + policy.ttlSeconds * 1000);
  const randomUUID = options.randomUUID || crypto.randomUUID;
  const contract = clean(
    typeof options.contractResolver === "function"
      ? options.contractResolver(profile.laneId, profile)
      : profile.contract
  );
  if (!contract) throw probeError("ENDPOINT_PROBE_CONTRACT_INVALID", "active contract is unavailable");
  const keyring = typeof options.keyringResolver === "function"
    ? options.keyringResolver(profile.laneId, profile)
    : options.keyring;
  const receipt = signPublicHealthExternalEndpointProbeReceipt({
    schemaVersion: ENDPOINT_PROBE_SCHEMA_VERSION,
    receiptId: secureId(`ph-endpoint-probe-${profile.laneId}`, randomUUID),
    laneId: profile.laneId,
    adapterId: profile.adapterId,
    contract,
    endpoint,
    status: "healthy",
    httpStatus: validated.statusCode,
    latencyMs: validated.latencyMs,
    network: {
      resolvedAddress: validated.remoteAddress,
      sniHostname: target.hostname.toLowerCase()
    },
    tls: {
      authorized: true,
      protocol: validated.tlsProtocol,
      certificateFingerprintSha256: validated.fingerprint,
      mutualTlsVerified: validated.mutualTlsVerified
    },
    verification: {
      attestationOrigin: TRUSTED_ATTESTATION_ORIGIN,
      verificationSource: TRUSTED_VERIFICATION_SOURCE,
      signatureVerified: true
    },
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    nonce: secureId(`ph-endpoint-probe-nonce-${profile.laneId}`, randomUUID)
  }, keyring);
  const verified = verifyPublicHealthExternalEndpointProbeReceipt(receipt, {
    expectedEndpoint: endpoint,
    expectedContract: contract,
    keyring,
    at: issuedAt.toISOString(),
    maxLatencyMs: policy.maxLatencyMs,
    certificatePins: policy.certificatePins,
    requireMutualTls: policy.requireMutualTls
  });
  if (!verified.ok) {
    throw probeError("ENDPOINT_PROBE_SELF_VERIFICATION_FAILED", "signed endpoint probe receipt failed verification");
  }
  return {
    laneId: profile.laneId,
    receipt,
    policy: {
      maxLatencyMs: policy.maxLatencyMs,
      requireMutualTls: policy.requireMutualTls,
      certificatePinningEnabled: policy.certificatePins.length > 0
    },
    productionReady: false,
    blocker: "Trusted site evidence, production handoffs, P0/P1 closure and launch approval remain required."
  };
}

function sanitizedFailure(laneId, error) {
  const code = clean(error?.code).startsWith("ENDPOINT_PROBE_")
    ? clean(error.code)
    : "ENDPOINT_PROBE_FAILED";
  return {
    laneId,
    ok: false,
    code,
    message: code === "ENDPOINT_PROBE_FAILED"
      ? "endpoint probe failed"
      : "endpoint probe failed closed; inspect restricted server diagnostics",
    productionReady: false
  };
}

async function runPublicHealthExternalEndpointProbeBatch(options = {}) {
  const results = [];
  for (const profile of EXTERNAL_ADAPTER_PROFILES) {
    try {
      const result = await runPublicHealthExternalEndpointProbe({ laneId: profile.laneId }, options);
      results.push({ laneId: profile.laneId, ok: true, receipt: result.receipt });
    } catch (error) {
      results.push(sanitizedFailure(profile.laneId, error));
    }
  }
  return {
    ok: results.every((item) => item.ok),
    summary: {
      lanes: results.length,
      succeeded: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length
    },
    results,
    productionReady: false,
    blockers: [
      "Active endpoint probes verify connectivity only.",
      "Trusted site evidence, production handoffs, P0/P1 closure and launch approval remain required."
    ]
  };
}

module.exports = {
  DEFAULT_PROBE_TIMEOUT_MS,
  DEFAULT_PROBE_TTL_SECONDS,
  MAX_RESOLVED_ADDRESSES,
  assertServerOnlyCommand,
  defaultHttpsTransport,
  defaultResolveAddresses,
  normalizeProbePolicy,
  normalizeResolvedAddresses,
  runPublicHealthExternalEndpointProbe,
  runPublicHealthExternalEndpointProbeBatch,
  safeTlsClientOptions,
  validateObservation
};
