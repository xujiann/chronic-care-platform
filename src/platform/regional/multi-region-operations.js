"use strict";

const dns = require("node:dns");
const https = require("node:https");
const net = require("node:net");
const path = require("node:path");
const { buildCompositeRegionalRelease } = require("./composite-release");
const { loadRegionManifest } = require("./region-manifest");

const DEFAULT_ROOT = path.resolve(__dirname, "..", "..", "..");
const MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 5000;
const REQUIRED_PATHS = Object.freeze([
  "/api/live",
  "/api/health",
  "/api/regional/context"
]);

function stableError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function environmentVariableForRegion(regionCode) {
  return `REGIONAL_SITE_${String(regionCode).replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}_BASE_URL`;
}

function backupEnvironmentVariableForRegion(regionCode) {
  return `REGIONAL_SITE_${String(regionCode).replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}_BACKUP_CHECKED_AT`;
}

function normalizeDigest(value) {
  const digest = String(value || "").trim().toLowerCase();
  return digest.startsWith("sha256:") ? digest : `sha256:${digest}`;
}

function isBlockedIp(address) {
  const normalized = String(address || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  const version = net.isIP(normalized);
  if (version === 4) {
    const octets = normalized.split(".").map(Number);
    const [a, b] = octets;
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0)
      || (a === 192 && b === 168)
      || (a === 198 && b === 51 && octets[2] === 100)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 203 && b === 0 && octets[2] === 113)
      || a >= 224;
  }
  if (version === 6) {
    if (normalized.startsWith("::ffff:")) {
      const mapped = normalized.slice("::ffff:".length);
      if (net.isIP(mapped) === 4) return isBlockedIp(mapped);
      const mappedParts = mapped.split(":");
      if (mappedParts.length === 2 && mappedParts.every((item) => /^[a-f0-9]{1,4}$/.test(item))) {
        const value = (Number.parseInt(mappedParts[0], 16) * 0x10000) + Number.parseInt(mappedParts[1], 16);
        return isBlockedIp([
          (value >>> 24) & 255,
          (value >>> 16) & 255,
          (value >>> 8) & 255,
          value & 255
        ].join("."));
      }
      return true;
    }
    return normalized === "::"
      || normalized === "::1"
      || normalized.startsWith("fc")
      || normalized.startsWith("fd")
      || /^fe[89ab]/.test(normalized)
      || normalized.startsWith("ff")
      || normalized.startsWith("64:ff9b:")
      || normalized.startsWith("2001:db8")
      || normalized.startsWith("2001:10:");
  }
  return true;
}

function validateProbeBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw stableError("REGIONAL_PROBE_TARGET_INVALID", "regional probe target must be an absolute HTTPS URL");
  }
  if (url.protocol !== "https:") {
    throw stableError("REGIONAL_PROBE_HTTPS_REQUIRED", "regional probe target must use HTTPS");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw stableError("REGIONAL_PROBE_TARGET_UNSAFE", "regional probe target cannot contain credentials, query or fragment");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw stableError("REGIONAL_PROBE_TARGET_UNSAFE", "regional probe target must not contain a path");
  }
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw stableError("REGIONAL_PROBE_TARGET_BLOCKED", "regional probe target host is blocked");
  }
  if (net.isIP(hostname) && isBlockedIp(hostname)) {
    throw stableError("REGIONAL_PROBE_TARGET_BLOCKED", "regional probe target address is blocked");
  }
  return url;
}

async function resolvePublicAddresses(hostname, resolver = dns.promises.lookup) {
  const directVersion = net.isIP(hostname);
  const resolved = directVersion
    ? [{ address: hostname, family: directVersion }]
    : await resolver(hostname, { all: true, verbatim: true });
  const addresses = (Array.isArray(resolved) ? resolved : [resolved])
    .map((item) => ({ address: String(item?.address || ""), family: Number(item?.family) || net.isIP(item?.address) }))
    .filter((item) => item.address && item.family);
  if (addresses.length === 0 || addresses.some((item) => isBlockedIp(item.address))) {
    throw stableError("REGIONAL_PROBE_DNS_BLOCKED", "regional probe DNS resolution is empty or contains a blocked address");
  }
  return addresses;
}

function parseJsonBody(buffer, pathName) {
  try {
    return JSON.parse(buffer);
  } catch {
    throw stableError("REGIONAL_PROBE_RESPONSE_INVALID", `${pathName} did not return valid JSON`);
  }
}

function normalizeCertificateNotAfter(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function requestJson(url, pathName, pinnedAddress, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = https.request({
      protocol: "https:",
      hostname: url.hostname,
      port: url.port || 443,
      servername: url.hostname,
      path: pathName,
      method: "GET",
      headers: { accept: "application/json", "user-agent": "health-platform-regional-operations/1" },
      rejectUnauthorized: true,
      timeout: timeoutMs,
      lookup(_hostname, _lookupOptions, callback) {
        callback(null, pinnedAddress.address, pinnedAddress.family);
      }
    }, (response) => {
      const statusCode = Number(response.statusCode) || 0;
      if (statusCode >= 300 && statusCode < 400) {
        response.resume();
        reject(stableError("REGIONAL_PROBE_REDIRECT_REJECTED", `${pathName} redirects are not allowed`));
        return;
      }
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
        if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
          request.destroy(stableError("REGIONAL_PROBE_RESPONSE_TOO_LARGE", `${pathName} response exceeded the size limit`));
        }
      });
      response.on("end", () => {
        if (settled) return;
        settled = true;
        const certificate = response.socket?.getPeerCertificate?.() || {};
        resolve({
          statusCode,
          body: parseJsonBody(body, pathName),
          certificateNotAfter: normalizeCertificateNotAfter(certificate.valid_to)
        });
      });
    });
    request.on("timeout", () => request.destroy(stableError("REGIONAL_PROBE_TIMEOUT", "regional probe timed out")));
    request.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error.code?.startsWith?.("REGIONAL_") ? error : stableError("REGIONAL_PROBE_TRANSPORT_FAILED", "regional probe transport failed"));
    });
    request.end();
  });
}

async function defaultProbeTransport({ baseUrl, addresses, timeoutMs }) {
  const pinnedAddress = addresses[0];
  const results = {};
  for (const pathName of REQUIRED_PATHS) {
    results[pathName] = await requestJson(baseUrl, pathName, pinnedAddress, { timeoutMs });
  }
  return results;
}

function buildExpectedSites(options = {}) {
  const root = options.root || DEFAULT_ROOT;
  const loaded = loadRegionManifest({ root });
  return loaded.registry.regions
    .filter((entry) => entry.enabled && entry.code !== "template")
    .map((entry) => {
      const release = buildCompositeRegionalRelease({ root, regionCode: entry.code, generatedAt: options.generatedAt });
      return Object.freeze({
        regionCode: entry.code,
        regionName: entry.name,
        deploymentClass: entry.deploymentClass,
        environmentVariable: environmentVariableForRegion(entry.code),
        backupEnvironmentVariable: backupEnvironmentVariableForRegion(entry.code),
        platformVersion: release.platform.version,
        regionalReleaseId: release.releaseId,
        expectedContentDigest: normalizeDigest(release.region.contentDigest),
        expectedArtifactDigest: release.artifact.digest
      });
    });
}

function summarizeReceipt(expected, receipt, now = new Date().toISOString()) {
  if (!receipt) {
    return {
      ...expected,
      status: "not-checked",
      blockers: ["probe-receipt-missing"],
      lastCheckedAt: "",
      live: false,
      ready: false,
      digestMatch: false,
      productionReady: false
    };
  }
  const blockers = [];
  if (receipt.live !== true) blockers.push("live-check-failed");
  if (receipt.ready !== true) blockers.push("health-check-failed");
  if (receipt.observedRegionCode !== expected.regionCode) blockers.push("region-code-drift");
  if (receipt.observedDeploymentClass !== expected.deploymentClass) blockers.push("deployment-class-drift");
  if (normalizeDigest(receipt.observedContentDigest) !== expected.expectedContentDigest) blockers.push("content-digest-drift");
  const checkedAt = Date.parse(receipt.checkedAt || "");
  if (!Number.isFinite(checkedAt) || Date.parse(now) - checkedAt > 15 * 60 * 1000) blockers.push("probe-receipt-stale");
  if (!receipt.backupCheckedAt) blockers.push("backup-evidence-missing");
  else if (Date.parse(now) - Date.parse(receipt.backupCheckedAt) > 24 * 60 * 60 * 1000) blockers.push("backup-evidence-stale");
  if (!receipt.certificateNotAfter) blockers.push("certificate-expiry-unknown");
  else if (Date.parse(receipt.certificateNotAfter) - Date.parse(now) < 30 * 24 * 60 * 60 * 1000) blockers.push("certificate-expiring");
  return {
    ...expected,
    status: blockers.length === 0 ? "healthy" : blockers.some((item) => item.endsWith("-drift")) ? "drift" : "degraded",
    blockers,
    lastCheckedAt: String(receipt.checkedAt || ""),
    live: receipt.live === true,
    ready: receipt.ready === true,
    digestMatch: !blockers.includes("content-digest-drift"),
    backupCheckedAt: String(receipt.backupCheckedAt || ""),
    certificateNotAfter: String(receipt.certificateNotAfter || ""),
    productionReady: false
  };
}

function buildFleetStatus(options = {}) {
  const expectedSites = buildExpectedSites(options);
  const receipts = Array.isArray(options.receipts) ? options.receipts : [];
  const latestByRegion = new Map();
  for (const receipt of receipts) {
    if (!receipt?.regionCode) continue;
    const current = latestByRegion.get(receipt.regionCode);
    if (!current || String(receipt.checkedAt || "") > String(current.checkedAt || "")) {
      latestByRegion.set(receipt.regionCode, receipt);
    }
  }
  const sites = expectedSites.map((expected) => {
    const configured = Boolean(options.env?.[expected.environmentVariable]);
    const summary = summarizeReceipt(expected, latestByRegion.get(expected.regionCode), options.now);
    if (!configured && summary.status === "not-checked") {
      summary.status = "unconfigured";
      summary.blockers = ["server-owned-endpoint-missing", ...summary.blockers];
    }
    return { ...summary, endpointConfigured: configured };
  });
  return {
    schemaVersion: "regional-operations-fleet-v1",
    generatedAt: options.now || new Date().toISOString(),
    summary: {
      sites: sites.length,
      healthy: sites.filter((site) => site.status === "healthy").length,
      degraded: sites.filter((site) => site.status === "degraded").length,
      drift: sites.filter((site) => site.status === "drift").length,
      unconfigured: sites.filter((site) => site.status === "unconfigured").length
    },
    sites,
    containsBusinessData: false,
    probeTargetsExposed: false,
    productionReady: false
  };
}

async function probeRegion(options = {}) {
  const now = options.now || new Date().toISOString();
  const expected = buildExpectedSites(options).find((site) => site.regionCode === options.regionCode);
  if (!expected) throw stableError("REGIONAL_SITE_NOT_PROBE_ELIGIBLE", "regional site is not enabled for operations probing");
  const rawBaseUrl = options.env?.[expected.environmentVariable];
  if (!rawBaseUrl) throw stableError("REGIONAL_PROBE_TARGET_MISSING", "server-owned regional probe target is not configured");
  const baseUrl = validateProbeBaseUrl(rawBaseUrl);
  const addresses = await resolvePublicAddresses(baseUrl.hostname, options.resolver);
  const transport = options.transport || defaultProbeTransport;
  const responses = await transport({
    baseUrl,
    addresses,
    timeoutMs: Math.min(Math.max(Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS, 500), 10000),
    requiredPaths: REQUIRED_PATHS
  });
  const live = responses["/api/live"];
  const health = responses["/api/health"];
  const regional = responses["/api/regional/context"];
  if (!live || !health || !regional) {
    throw stableError("REGIONAL_PROBE_RESPONSE_INCOMPLETE", "regional probe did not return every required response");
  }
  const receipt = {
    schemaVersion: "regional-operations-probe-receipt-v1",
    regionCode: expected.regionCode,
    checkedAt: now,
    live: live.statusCode === 200,
    ready: health.statusCode === 200,
    observedRegionCode: String(regional.body?.regionCode || ""),
    observedDeploymentClass: String(regional.body?.deploymentClass || ""),
    observedContentDigest: normalizeDigest(regional.body?.contentDigest),
    certificateNotAfter: String(live.certificateNotAfter || health.certificateNotAfter || regional.certificateNotAfter || ""),
    backupCheckedAt: normalizeCertificateNotAfter(options.env?.[expected.backupEnvironmentVariable]),
    targetEnvironmentVariable: expected.environmentVariable,
    targetDigest: expected.expectedContentDigest,
    transportSafe: true,
    containsBusinessData: false,
    productionReady: false
  };
  return {
    receipt,
    site: summarizeReceipt(expected, receipt, now),
    endpointExposed: false,
    resolvedAddressesExposed: false,
    productionReady: false
  };
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  REQUIRED_PATHS,
  backupEnvironmentVariableForRegion,
  buildExpectedSites,
  buildFleetStatus,
  defaultProbeTransport,
  environmentVariableForRegion,
  isBlockedIp,
  normalizeCertificateNotAfter,
  normalizeDigest,
  probeRegion,
  resolvePublicAddresses,
  summarizeReceipt,
  validateProbeBaseUrl
};
