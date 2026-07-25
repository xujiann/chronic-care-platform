const crypto = require("node:crypto");
const net = require("node:net");
const {
  EXTERNAL_ADAPTER_PROFILES
} = require("./public-health-external-adapter-service");
const {
  resolveVerificationKey,
  selectSigningKey
} = require("./public-health-external-keyring-service");

const ENDPOINT_PROBE_SCHEMA_VERSION = "public-health-external-endpoint-probe/v1";
const TRUSTED_ATTESTATION_ORIGIN = "server-generated";
const TRUSTED_VERIFICATION_SOURCE = "platform-observability";
const MAX_PROBE_TTL_SECONDS = 900;
const DEFAULT_CLOCK_SKEW_SECONDS = 30;
const DEFAULT_MAX_LATENCY_MS = 3000;

function clean(value) {
  return String(value ?? "").trim();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function timingSafeHexEqual(left, right) {
  if (!/^[a-f0-9]{64}$/i.test(clean(left)) || !/^[a-f0-9]{64}$/i.test(clean(right))) return false;
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function timeValue(value, label) {
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid date-time`);
  return parsed;
}

function digest(value, label) {
  const normalized = clean(value).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${label} must be a SHA-256 digest`);
  return normalized;
}

function profileForLane(laneId) {
  return EXTERNAL_ADAPTER_PROFILES.find((item) => item.laneId === clean(laneId));
}

function privateIpv4(hostname) {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) return false;
  return octets[0] === 10
    || octets[0] === 127
    || octets[0] === 0
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || (octets[0] === 192 && octets[1] === 0 && octets[2] === 2)
    || (octets[0] === 198 && [18, 19].includes(octets[1]))
    || (octets[0] === 198 && octets[1] === 51 && octets[2] === 100)
    || (octets[0] === 203 && octets[1] === 0 && octets[2] === 113)
    || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
    || octets[0] >= 224;
}

function privateIpv6(hostname) {
  const normalized = hostname.toLowerCase();
  return normalized === "::1"
    || normalized === "::"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || /^fe[89ab]/.test(normalized)
    || normalized.startsWith("2001:db8:")
    || normalized.startsWith("ff");
}

function reservedHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (!normalized || normalized === "localhost") return true;
  if ([".localhost", ".local", ".invalid", ".test", ".example"].some((suffix) => normalized.endsWith(suffix))) return true;
  if (["example.com", "example.net", "example.org"].includes(normalized)) return true;
  const addressType = net.isIP(normalized);
  if (addressType === 4) return privateIpv4(normalized);
  if (addressType === 6) return privateIpv6(normalized);
  return false;
}

function normalizeProductionEndpoint(value) {
  let endpoint;
  try {
    endpoint = new URL(clean(value));
  } catch {
    throw new Error("endpoint probe target must be a valid URL");
  }
  if (endpoint.protocol !== "https:") throw new Error("endpoint probe target must use HTTPS");
  if (!endpoint.hostname || endpoint.username || endpoint.password || endpoint.hash) {
    throw new Error("endpoint probe target must not contain credentials or fragments");
  }
  if (reservedHostname(endpoint.hostname)) {
    throw new Error("endpoint probe target must not use loopback, private or reserved hostnames");
  }
  endpoint.hostname = endpoint.hostname.toLowerCase();
  if (endpoint.port === "443") endpoint.port = "";
  return endpoint.toString();
}

function canonicalVerification(value = {}) {
  return {
    attestationOrigin: clean(value.attestationOrigin),
    verificationSource: clean(value.verificationSource),
    signatureVerified: value.signatureVerified === true
  };
}

function canonicalTls(value = {}) {
  return {
    authorized: value.authorized === true,
    protocol: clean(value.protocol),
    certificateFingerprintSha256: clean(value.certificateFingerprintSha256).toLowerCase(),
    mutualTlsVerified: value.mutualTlsVerified === true
  };
}

function canonicalNetwork(value = {}) {
  return {
    resolvedAddress: clean(value.resolvedAddress).toLowerCase(),
    sniHostname: clean(value.sniHostname).toLowerCase()
  };
}

function normalizedEndpointProbePayload(value = {}) {
  return {
    schemaVersion: ENDPOINT_PROBE_SCHEMA_VERSION,
    receiptId: clean(value.receiptId),
    laneId: clean(value.laneId),
    adapterId: clean(value.adapterId),
    contract: clean(value.contract),
    endpoint: clean(value.endpoint),
    endpointDigest: clean(value.endpointDigest).toLowerCase(),
    status: clean(value.status).toLowerCase(),
    httpStatus: Number(value.httpStatus),
    latencyMs: Number(value.latencyMs),
    network: canonicalNetwork(value.network),
    tls: canonicalTls(value.tls),
    verification: canonicalVerification(value.verification),
    issuedAt: clean(value.issuedAt),
    expiresAt: clean(value.expiresAt),
    nonce: clean(value.nonce),
    signingKeyId: clean(value.signingKeyId)
  };
}

function validateEndpointProbePayload(payload, options = {}) {
  const profile = profileForLane(payload.laneId);
  if (!profile) throw new Error("endpoint probe lane is invalid");
  if (payload.adapterId !== profile.adapterId) throw new Error("endpoint probe adapter binding is invalid");
  if (payload.contract !== clean(options.expectedContract || profile.contract)) {
    throw new Error("endpoint probe contract binding is invalid");
  }
  if (!/^[a-z0-9][a-z0-9._:-]{7,127}$/i.test(payload.receiptId)) {
    throw new Error("endpoint probe receiptId is invalid");
  }
  if (!/^[a-z0-9][a-z0-9._:-]{7,127}$/i.test(payload.nonce)) {
    throw new Error("endpoint probe nonce is invalid");
  }
  const endpoint = normalizeProductionEndpoint(payload.endpoint);
  const expectedEndpoint = normalizeProductionEndpoint(options.expectedEndpoint);
  if (endpoint !== expectedEndpoint) throw new Error("endpoint probe target does not match server configuration");
  if (!timingSafeHexEqual(payload.endpointDigest, sha256(endpoint))) {
    throw new Error("endpoint probe target digest is invalid");
  }
  const resolvedAddressType = net.isIP(payload.network.resolvedAddress);
  if (!resolvedAddressType
    || (resolvedAddressType === 4 && privateIpv4(payload.network.resolvedAddress))
    || (resolvedAddressType === 6 && privateIpv6(payload.network.resolvedAddress))) {
    throw new Error("endpoint probe resolved address must be a public IP address");
  }
  if (payload.network.sniHostname !== new URL(endpoint).hostname.toLowerCase()) {
    throw new Error("endpoint probe SNI hostname does not match the configured target");
  }
  if (payload.status !== "healthy") throw new Error("endpoint probe status must be healthy");
  if (!Number.isInteger(payload.httpStatus) || payload.httpStatus < 200 || payload.httpStatus > 299) {
    throw new Error("endpoint probe HTTP status must be successful");
  }
  const maxLatencyMs = Number(options.maxLatencyMs || DEFAULT_MAX_LATENCY_MS);
  if (!Number.isInteger(maxLatencyMs) || maxLatencyMs < 1 || maxLatencyMs > 60000) {
    throw new Error("endpoint probe maxLatencyMs must be an integer from 1 to 60000");
  }
  if (!Number.isFinite(payload.latencyMs) || payload.latencyMs < 0 || payload.latencyMs > maxLatencyMs) {
    throw new Error("endpoint probe latency exceeds policy");
  }
  if (!payload.tls.authorized) throw new Error("endpoint probe TLS authorization is required");
  if (!["TLSv1.2", "TLSv1.3"].includes(payload.tls.protocol)) {
    throw new Error("endpoint probe TLS protocol must be TLSv1.2 or TLSv1.3");
  }
  digest(payload.tls.certificateFingerprintSha256, "endpoint probe certificate fingerprint");
  if (payload.verification.attestationOrigin !== TRUSTED_ATTESTATION_ORIGIN
    || payload.verification.verificationSource !== TRUSTED_VERIFICATION_SOURCE
    || payload.verification.signatureVerified !== true) {
    throw new Error("endpoint probe trust metadata is not server verified");
  }
  const issuedAt = timeValue(payload.issuedAt, "endpoint probe issuedAt");
  const expiresAt = timeValue(payload.expiresAt, "endpoint probe expiresAt");
  if (expiresAt <= issuedAt || expiresAt - issuedAt > MAX_PROBE_TTL_SECONDS * 1000) {
    throw new Error("endpoint probe validity window is invalid");
  }
  const at = timeValue(options.at || new Date().toISOString(), "endpoint probe verification at");
  const clockSkewSeconds = Number(options.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS);
  if (!Number.isInteger(clockSkewSeconds) || clockSkewSeconds < 0 || clockSkewSeconds > 300) {
    throw new Error("endpoint probe clockSkewSeconds must be an integer from 0 to 300");
  }
  const skewMs = clockSkewSeconds * 1000;
  if (issuedAt > at + skewMs) throw new Error("endpoint probe is issued in the future");
  if (expiresAt < at - skewMs) throw new Error("endpoint probe has expired");
  return { profile, endpoint, issuedAt, expiresAt };
}

function endpointProbeSignaturePayload(payload) {
  return normalizedEndpointProbePayload(payload);
}

function signPublicHealthExternalEndpointProbeReceipt(value = {}, keyring) {
  const issuedAt = clean(value.issuedAt);
  const signingKey = selectSigningKey(keyring, issuedAt);
  const endpoint = normalizeProductionEndpoint(value.endpoint);
  const payload = normalizedEndpointProbePayload({
    ...value,
    endpoint,
    endpointDigest: sha256(endpoint),
    signingKeyId: signingKey.keyId
  });
  const signature = crypto.createHmac("sha256", signingKey.secret)
    .update(stableStringify(endpointProbeSignaturePayload(payload)))
    .digest("hex");
  return { ...payload, signature };
}

function verifyPublicHealthExternalEndpointProbeReceipt(receipt = {}, options = {}) {
  let payload;
  let validated;
  try {
    payload = normalizedEndpointProbePayload(receipt);
    if (clean(receipt.schemaVersion) !== ENDPOINT_PROBE_SCHEMA_VERSION) {
      throw new Error("endpoint probe schema version is invalid");
    }
    validated = validateEndpointProbePayload(payload, options);
  } catch (error) {
    return { ok: false, reason: error.message };
  }
  const keyResolution = resolveVerificationKey(options.keyring, payload.signingKeyId, payload.issuedAt);
  if (!keyResolution.ok) return { ok: false, reason: `endpoint-probe-${keyResolution.reason}` };
  const expectedSignature = crypto.createHmac("sha256", keyResolution.key.secret)
    .update(stableStringify(endpointProbeSignaturePayload(payload)))
    .digest("hex");
  if (!timingSafeHexEqual(receipt.signature, expectedSignature)) {
    return { ok: false, reason: "endpoint probe signature is invalid" };
  }
  if (options.seenReceiptIds?.has(payload.receiptId)) {
    return { ok: false, reason: "endpoint probe receipt replay detected" };
  }
  if (options.seenNonces?.has(payload.nonce)) {
    return { ok: false, reason: "endpoint probe nonce replay detected" };
  }
  return {
    ok: true,
    reason: "verified",
    payload,
    endpoint: validated.endpoint,
    endpointDigest: payload.endpointDigest
  };
}

function buildPublicHealthExternalEndpointProbeRegistry(options = {}) {
  const receipts = Array.isArray(options.receipts) ? options.receipts : [];
  const env = options.env || {};
  const seenReceiptIds = new Set();
  const seenNonces = new Set();
  const entries = EXTERNAL_ADAPTER_PROFILES.map((profile) => {
    const configuredEndpoint = clean(env[profile.endpointEnv]);
    let endpointDigest = "";
    let endpointConfigured = false;
    let endpointConfigurationBlocker = "";
    try {
      const normalized = normalizeProductionEndpoint(configuredEndpoint);
      endpointDigest = sha256(normalized);
      endpointConfigured = true;
    } catch (error) {
      endpointConfigurationBlocker = error.message;
    }
    const candidates = receipts
      .filter((item) => clean(item.laneId) === profile.laneId)
      .sort((left, right) => clean(right.issuedAt).localeCompare(clean(left.issuedAt)));
    let verified = null;
    const invalidReasons = [];
    for (const candidate of candidates) {
      const result = verifyPublicHealthExternalEndpointProbeReceipt(candidate, {
        expectedEndpoint: configuredEndpoint,
        expectedContract: typeof options.contractResolver === "function"
          ? options.contractResolver(profile.laneId, profile)
          : profile.contract,
        keyring: typeof options.keyringResolver === "function"
          ? options.keyringResolver(profile.laneId, candidate)
          : options.keyring,
        at: options.at,
        maxLatencyMs: options.maxLatencyMs,
        clockSkewSeconds: options.clockSkewSeconds,
        seenReceiptIds,
        seenNonces
      });
      if (result.ok) {
        verified = result;
        seenReceiptIds.add(result.payload.receiptId);
        seenNonces.add(result.payload.nonce);
        break;
      }
      invalidReasons.push(result.reason);
    }
    const connectivityVerified = endpointConfigured && Boolean(verified);
    return {
      laneId: profile.laneId,
      adapterId: profile.adapterId,
      contract: clean(verified?.payload.contract || profile.contract),
      endpointConfigured,
      endpointDigest,
      connectivityVerified,
      receiptId: clean(verified?.payload.receiptId),
      signingKeyId: clean(verified?.payload.signingKeyId),
      issuedAt: clean(verified?.payload.issuedAt),
      expiresAt: clean(verified?.payload.expiresAt),
      latencyMs: verified?.payload.latencyMs ?? null,
      resolvedAddressDigest: verified ? sha256(verified.payload.network.resolvedAddress) : "",
      tlsProtocol: clean(verified?.payload.tls?.protocol),
      mutualTlsVerified: verified?.payload.tls?.mutualTlsVerified === true,
      blockerCode: connectivityVerified
        ? "trusted-site-evidence-still-required"
        : endpointConfigured
          ? "trusted-endpoint-probe-required"
          : "production-endpoint-configuration-required",
      blockerReason: connectivityVerified
        ? "Endpoint connectivity is verified, but trusted site evidence and launch approval are still required."
        : invalidReasons[0] || endpointConfigurationBlocker || "A fresh server-signed endpoint probe is required."
    };
  });
  const verified = entries.filter((item) => item.connectivityVerified).length;
  return {
    ok: entries.length === 8,
    functionalState: verified === entries.length
      ? "eight-endpoint-probes-verified"
      : "endpoint-probe-verification-pending",
    formalGoLiveState: "blocked-until-trusted-site-evidence-and-launch-approval",
    summary: {
      lanes: entries.length,
      endpointsConfigured: entries.filter((item) => item.endpointConfigured).length,
      endpointProbesVerified: verified,
      endpointProbesPending: entries.length - verified
    },
    entries,
    endpointConnectivityReady: verified === entries.length,
    productionReady: false,
    blockers: [
      "Endpoint probe receipts verify connectivity only.",
      "Trusted site evidence, production handoffs, P0/P1 closure and launch approval remain required."
    ]
  };
}

module.exports = {
  DEFAULT_CLOCK_SKEW_SECONDS,
  DEFAULT_MAX_LATENCY_MS,
  ENDPOINT_PROBE_SCHEMA_VERSION,
  MAX_PROBE_TTL_SECONDS,
  TRUSTED_ATTESTATION_ORIGIN,
  TRUSTED_VERIFICATION_SOURCE,
  buildPublicHealthExternalEndpointProbeRegistry,
  endpointProbeSignaturePayload,
  normalizeProductionEndpoint,
  normalizedEndpointProbePayload,
  signPublicHealthExternalEndpointProbeReceipt,
  verifyPublicHealthExternalEndpointProbeReceipt
};
