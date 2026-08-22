"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildDependencyTargetInventory } = require("../scripts/care-service-dependency-targets");

function configuredEnv() {
  return {
    STORAGE_ENGINE: "postgres",
    DATABASE_URL: "postgresql://sensitive-user:sensitive-password@db.internal/care",
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

test("dependency target inventory emits complete digest-only production bindings", () => {
  const inventory = buildDependencyTargetInventory(configuredEnv());
  assert.equal(inventory.complete, true);
  assert.equal(inventory.dependencies.length, 13);
  assert.equal(inventory.dependencies.every((item) => /^sha256:[a-f0-9]{64}$/.test(item.targetDigest)), true);
  const serialized = JSON.stringify(inventory);
  [
    "sensitive-user",
    "sensitive-password",
    "db.internal",
    "identity.health.gov.cn",
    "nursing.health.gov.cn"
  ].forEach((value) => assert.equal(serialized.includes(value), false));
});

test("dependency target inventory remains incomplete when required targets are absent", () => {
  const inventory = buildDependencyTargetInventory({});
  assert.equal(inventory.complete, false);
  assert.equal(inventory.dependencies.every((item) => item.configured === false), true);
});
