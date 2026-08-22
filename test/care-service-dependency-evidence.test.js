"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  EVIDENCE_SCHEMA_VERSION,
  REQUIRED_DEPENDENCIES,
  loadDependencyEvidence,
  sha256,
  targetDigestForDependency,
  validateDependencyEvidence
} = require("../care-service-dependency-evidence");
const Runtime = require("../care-service-runtime");

const AT = "2026-07-24T03:00:00.000Z";
const FILE_DIGEST = `sha256:${"a".repeat(64)}`;

function dependencyEnv() {
  return {
    STORAGE_ENGINE: "postgres",
    DATABASE_URL: "postgresql://care-user:care-password@db.internal/care?sslmode=require",
    OIDC_ISSUER_URL: "https://identity.health.gov.cn",
    OIDC_CLIENT_ID: "care-service",
    SMS_GATEWAY_URL: "https://sms.health.gov.cn/messages",
    SMS_TEMPLATE_ID: "care-status-v1",
    HIS_ADAPTER_URL: "https://his.hospital.cn/events",
    APPOINTMENT_ADAPTER_URL: "https://appointment.hospital.cn/events",
    OBJECT_STORAGE_GATEWAY_URL: "https://storage.health.gov.cn",
    OBJECT_STORAGE_BUCKET: "care-evidence",
    OBJECT_STORAGE_GATEWAY_CONTRACT_VERSION: "object-storage-gateway-trust-v1",
    OBJECT_STORAGE_UPLOAD_URL_ALLOWED_ORIGINS: "https://upload.storage.health.gov.cn",
    OBJECT_STORAGE_DOWNLOAD_URL_ALLOWED_ORIGINS: "https://download.storage.health.gov.cn",
    PAYMENT_GATEWAY_URL: "https://payment.health.gov.cn",
    INSURANCE_GATEWAY_URL: "https://insurance.health.gov.cn",
    CERTIFICATE_GATEWAY_URL: "https://certificate.health.gov.cn",
    SIEM_ENDPOINT: "https://siem.health.gov.cn/events",
    CARE_OUTBOX_WORKER_ID: "care-outbox-prod-01",
    CARE_SERVICE_RUNTIME_MODULE: "runtime/care-service-production.js",
    CARE_NURSING_DELIVERY_URL: "https://nursing.health.gov.cn/events",
    CARE_ESCORT_DELIVERY_URL: "https://escort.health.gov.cn/events"
  };
}

function receiptDigest(index) {
  return `sha256:${(index + 1).toString(16).repeat(64)}`;
}

function validManifest(env = dependencyEnv(), overrides = {}) {
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    policyVersion: Runtime.RUNTIME_POLICY_VERSION,
    environment: "production",
    releaseId: "CARE-CHANGE-20260724-002",
    probes: REQUIRED_DEPENDENCIES.map((dependency, index) => ({
      dependency,
      status: "healthy",
      checkType: index % 2 === 0 ? "signed-health" : "authenticated-read-only",
      checkedAt: "2026-07-24T02:55:00.000Z",
      expiresAt: "2026-07-24T03:10:00.000Z",
      targetDigest: targetDigestForDependency(env, dependency),
      receiptRef: `urn:care-probe:${dependency}:20260724`,
      receiptDigest: receiptDigest(index)
    })),
    ...overrides
  };
}

function validate(manifest, env = dependencyEnv(), options = {}) {
  return validateDependencyEvidence(manifest, {
    env,
    at: AT,
    policyVersion: Runtime.RUNTIME_POLICY_VERSION,
    expectedDigest: FILE_DIGEST,
    actualDigest: FILE_DIGEST,
    ...options
  });
}

test("dependency evidence accepts fresh independently receipted probes bound to configured targets", () => {
  const env = dependencyEnv();
  const result = validate(validManifest(env), env);
  assert.equal(result.ok, true);
  assert.deepEqual(result.healthyDependencies, REQUIRED_DEPENDENCIES);
  assert.equal(result.errors.length, 0);
});

test("dependency evidence strips database credentials before deriving its target digest", () => {
  const first = dependencyEnv();
  const second = { ...first, DATABASE_URL: first.DATABASE_URL.replace("care-password", "rotated-password") };
  assert.equal(targetDigestForDependency(first, "storage"), targetDigestForDependency(second, "storage"));
});

test("object storage probe binding changes with contract or exact origins without binding secrets", () => {
  const baseline = dependencyEnv();
  const contractDrift = { ...baseline, OBJECT_STORAGE_GATEWAY_CONTRACT_VERSION: "legacy" };
  const originDrift = { ...baseline, OBJECT_STORAGE_DOWNLOAD_URL_ALLOWED_ORIGINS: "https://other.storage.health.gov.cn" };
  const invalidOriginScheme = { ...baseline, OBJECT_STORAGE_DOWNLOAD_URL_ALLOWED_ORIGINS: "file://storage.health.gov.cn" };
  const rotatedSecrets = {
    ...baseline,
    OBJECT_STORAGE_SIGNING_SECRET: "rotated-request-secret",
    OBJECT_STORAGE_RECEIPT_SIGNING_SECRET: "rotated-receipt-secret"
  };
  const digest = targetDigestForDependency(baseline, "object-storage");
  assert.notEqual(digest, targetDigestForDependency(contractDrift, "object-storage"));
  assert.notEqual(digest, targetDigestForDependency(originDrift, "object-storage"));
  assert.notEqual(digest, targetDigestForDependency(invalidOriginScheme, "object-storage"));
  assert.equal(digest, targetDigestForDependency(rotatedSecrets, "object-storage"));
  const result = validate(validManifest(baseline), originDrift);
  assert.equal(result.errors.some((item) => item.code === "CARE_DEPENDENCY_EVIDENCE_TARGET_MISMATCH" && item.dependency === "object-storage"), true);
});

test("dependency evidence rejects stale unhealthy expired and cross-target probes", () => {
  const env = dependencyEnv();
  const manifest = validManifest(env);
  manifest.probes.find((item) => item.dependency === "identity").checkedAt = "2026-07-24T02:00:00.000Z";
  manifest.probes.find((item) => item.dependency === "sms").status = "degraded";
  manifest.probes.find((item) => item.dependency === "his").expiresAt = "2026-07-24T02:59:00.000Z";
  manifest.probes.find((item) => item.dependency === "payment").targetDigest = targetDigestForDependency(env, "insurance");
  const result = validate(manifest, env);
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((item) => item.code === "CARE_DEPENDENCY_EVIDENCE_STALE" && item.dependency === "identity"), true);
  assert.equal(result.errors.some((item) => item.code === "CARE_DEPENDENCY_EVIDENCE_STATUS_UNHEALTHY" && item.dependency === "sms"), true);
  assert.equal(result.errors.some((item) => item.code === "CARE_DEPENDENCY_EVIDENCE_EXPIRED" && item.dependency === "his"), true);
  assert.equal(result.errors.some((item) => item.code === "CARE_DEPENDENCY_EVIDENCE_TARGET_MISMATCH" && item.dependency === "payment"), true);
});

test("dependency evidence rejects missing duplicate unknown and reused receipts", () => {
  const env = dependencyEnv();
  const manifest = validManifest(env);
  manifest.probes = manifest.probes.filter((item) => item.dependency !== "audit");
  manifest.probes.push({ ...manifest.probes[0] });
  manifest.probes.push({ ...manifest.probes[1], dependency: "unknown-gateway" });
  manifest.probes.find((item) => item.dependency === "insurance").receiptDigest =
    manifest.probes.find((item) => item.dependency === "payment").receiptDigest;
  const result = validate(manifest, env);
  assert.equal(result.ok, false);
  assert.equal(result.healthyDependencies.length, 0);
  assert.equal(result.errors.some((item) => item.code === "CARE_DEPENDENCY_EVIDENCE_TARGET_MISSING" && item.dependency === "audit"), true);
  assert.equal(result.errors.some((item) => item.code === "CARE_DEPENDENCY_EVIDENCE_TARGET_DUPLICATE"), true);
  assert.equal(result.errors.some((item) => item.code === "CARE_DEPENDENCY_EVIDENCE_TARGET_UNKNOWN"), true);
  assert.equal(result.errors.some((item) => item.code === "CARE_DEPENDENCY_EVIDENCE_RECEIPT_DIGEST_REUSED"), true);
});

test("dependency evidence loader rejects any change to the pinned file bytes", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "care-dependency-evidence-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const env = dependencyEnv();
  const raw = Buffer.from(JSON.stringify(validManifest(env), null, 2), "utf8");
  const file = path.join(directory, "dependency-evidence.json");
  fs.writeFileSync(file, raw);
  const configured = {
    ...env,
    CARE_DEPENDENCY_EVIDENCE_FILE: file,
    CARE_DEPENDENCY_EVIDENCE_SHA256: sha256(raw)
  };
  assert.equal(loadDependencyEvidence(configured, {
    at: AT,
    policyVersion: Runtime.RUNTIME_POLICY_VERSION
  }).ok, true);
  fs.appendFileSync(file, "\n");
  const tampered = loadDependencyEvidence(configured, {
    at: AT,
    policyVersion: Runtime.RUNTIME_POLICY_VERSION
  });
  assert.equal(tampered.ok, false);
  assert.equal(tampered.healthyDependencies.length, 0);
  assert.equal(tampered.errors.some((item) => item.code === "CARE_DEPENDENCY_EVIDENCE_DIGEST_MISMATCH"), true);
});
