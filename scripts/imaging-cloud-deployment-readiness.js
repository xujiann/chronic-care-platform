#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const SECRET_PROVIDERS = new Set(["vault", "kms", "orchestrator"]);

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail };
}

function readEnvFile(filePath) {
  const values = {};
  fs.readFileSync(filePath, "utf8").split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separator = trimmed.indexOf("=");
    if (separator < 1) return;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[key] = value;
  });
  return values;
}

function isProductionHttps(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function hasTlsPacsConfiguration(env) {
  const host = String(env.IMAGING_PACS_DICOM_TLS_HOST || "").trim();
  const port = Number(env.IMAGING_PACS_DICOM_TLS_PORT);
  return Boolean(host) && !["localhost", "127.0.0.1", "::1"].includes(host) && Number.isInteger(port) && port > 0 && port <= 65535 && SHA256.test(String(env.IMAGING_PACS_DICOM_TLS_CERT_SHA256 || ""));
}

function buildImagingCloudDeploymentReadiness(options = {}) {
  const env = options.env || process.env;
  const endpoints = [
    ["fhir", "IMAGING_FHIR_BASE_URL"],
    ["dicomweb", "IMAGING_DICOMWEB_BASE_URL"],
    ["ohif", "IMAGING_OHIF_BASE_URL"]
  ];
  const checks = [
    check("deployment:environment", env.IMAGING_DEPLOYMENT_ENV === "production", "IMAGING_DEPLOYMENT_ENV must be production"),
    ...endpoints.map(([id, key]) => check(`deployment:${id}-tls`, isProductionHttps(env[key]), `${key} must be a non-loopback HTTPS URL`)),
    check("deployment:pacs-dicom-tls", hasTlsPacsConfiguration(env), "PACS DICOM TLS host, port and certificate SHA-256 are required"),
    check("deployment:object-storage", env.IMAGING_OBJECT_STORAGE_REGION === "liaoning-in-province" && env.IMAGING_OBJECT_STORAGE_ENCRYPTION === "enabled", "object storage must be in-province with encryption at rest enabled"),
    check("deployment:audit-retention", Number(env.IMAGING_AUDIT_RETENTION_DAYS) >= 180, "audit retention must be at least 180 days"),
    check("deployment:mobile-boundary", env.IMAGING_MOBILE_ORIGINAL_DICOM_POLICY === "no-original-dicom-on-mobile", "mobile terminals must not store original DICOM"),
    check("deployment:secrets", SECRET_PROVIDERS.has(env.DEPLOYMENT_SECRET_PROVIDER), "DEPLOYMENT_SECRET_PROVIDER must be vault, kms or orchestrator"),
    check("deployment:artifact", SHA256.test(String(env.DEPLOYMENT_ARTIFACT_DIGEST || "")) && Boolean(String(env.DEPLOYMENT_RELEASE_ID || "").trim()), "approved release ID and SHA-256 artifact digest are required"),
    check("deployment:configuration-evidence", Boolean(String(env.IMAGING_CONFIGURATION_EVIDENCE_REF || "").trim()), "configuration evidence reference is required")
  ];
  const deploymentConfigReady = checks.every((item) => item.passed);
  return {
    schemaVersion: "imaging-cloud-deployment-readiness-v1",
    generatedAt: new Date().toISOString(),
    deploymentConfigReady,
    productionReady: false,
    formalGoLiveState: "blocked-until-site-evidence-signed",
    secretValuesRead: false,
    requiredExternalEvidence: [
      "PACS/RIS/DICOM TLS site receipt",
      "FHIR and EMR report writeback receipt",
      "object storage, authorization and audit receipt",
      "mutual-recognition appeal receipt",
      "failure degradation and rollback receipt",
      "independent verification, drills and dual cutover approval"
    ],
    checks
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  argv.forEach((arg) => {
    if (!arg.startsWith("--")) return;
    const [key, ...rest] = arg.slice(2).split("=");
    flags[key] = rest.join("=") || true;
  });
  return flags;
}

function runCli() {
  const flags = parseArgs();
  const envFile = flags["env-file"] ? path.resolve(ROOT, String(flags["env-file"])) : "";
  const env = envFile ? { ...process.env, ...readEnvFile(envFile) } : process.env;
  const report = buildImagingCloudDeploymentReadiness({ env });
  console.log(JSON.stringify(report, null, 2));
  if (!report.deploymentConfigReady) process.exitCode = 1;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { buildImagingCloudDeploymentReadiness, hasTlsPacsConfiguration, isProductionHttps, parseArgs, readEnvFile };
