"use strict";

const { pbkdf2Sync } = require("node:crypto");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

function passwordHash(password, salt = "test-salt", iterations = 120_000) {
  return `pbkdf2-sha256$${iterations}$${salt}$${pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("base64url")}`;
}

function writeApiRegressionFixture(dataDir) {
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  delete fixture.healthStatistics.dailyServiceReports;
  delete fixture.healthStatistics.certificateExchangeLinks;
  delete fixture.healthStatistics.siteEvidencePackage;
  fixture.accounts[0].name = "Needs normalization?";
  fixture.authUsers.push({
    id: "u-hashed-test",
    username: "hashed_commission",
    name: "哈希账号",
    role: "commission",
    roleName: "哈希认证测试账号",
    orgCode: "ORG-HEALTH-DL",
    orgName: "大连市卫生健康委",
    orgType: "health_admin",
    dataScope: "测试",
    home: "index.html",
    status: "启用",
    passwordHash: passwordHash("hashed-pass")
  });
  fixture.authUsers.push({
    id: "u-citizen-r2-test",
    username: "citizen_r2",
    name: "\u6f14\u793a\u5c45\u6c11B",
    role: "citizen",
    roleName: "\u4e2a\u4eba\u7aef",
    orgCode: "PERSON-R2",
    orgName: "\u6f14\u793a\u5c45\u6c11B\u5bb6\u5ead",
    orgType: "citizen",
    orgLevel: "\u4e2a\u4eba",
    dataScope: "\u672c\u4eba",
    home: "citizen.html",
    residentId: "r2",
    accountId: "a2",
    status: "\u542f\u7528"
  });
  fixture.authUsers.push({
    id: "u-out-of-scope-hospital-test",
    username: "out_of_scope_hospital",
    name: "\u57df\u5916\u533b\u7597\u673a\u6784\u6d4b\u8bd5\u8d26\u53f7",
    role: "institution",
    roleName: "\u533b\u7597\u673a\u6784\u7aef",
    orgCode: "MR-OUTSIDE-TEST",
    orgName: "\u57df\u5916\u533b\u7597\u673a\u6784",
    orgType: "medical_institution",
    orgLevel: "\u6d4b\u8bd5",
    dataScope: "\u4ec5\u672c\u673a\u6784",
    home: "institution.html",
    status: "\u542f\u7528",
    passwordHash: passwordHash("out-of-scope-pass")
  });
  fixture.authOrganizations.push({
    orgCode: "MR-OUTSIDE-TEST",
    name: "\u57df\u5916\u533b\u7597\u673a\u6784",
    orgType: "medical_institution",
    orgLevel: "\u6d4b\u8bd5",
    parentCode: "ORG-HEALTH-DL",
    portal: "institution.html",
    dataScope: "\u4ec5\u672c\u673a\u6784",
    interfaces: []
  });
  fixture.smsDeliveryReceipts = [{
    id: "sms-delivery-api-fixture",
    providerMessageId: "provider-sms-api-001",
    clientRequestId: "phone-code-api-001",
    purpose: "resident-phone-code",
    maskedPhone: "138****0000",
    status: "accepted",
    acceptedAt: "2026-07-15T06:00:00.000Z",
    latestEventAt: "2026-07-15T06:00:00.000Z",
    providerCode: "ACCEPTED",
    failureReason: "",
    events: [],
    createdAt: "2026-07-15T06:00:00.000Z",
    updatedAt: "2026-07-15T06:00:00.000Z",
    productionEvidence: false
  }];
  fs.writeFileSync(path.join(dataDir, "db.json"), JSON.stringify(fixture, null, 2), "utf8");
  return fixture;
}

function createApiRegressionRuntime() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "health-platform-test-"));
  const fixture = writeApiRegressionFixture(dataDir);

  process.env.DATA_DIR = dataDir;
  process.env.STORAGE_ENGINE = "json";
  process.env.SMS_DELIVERY_CALLBACK_SECRET = "sms-callback-secret-with-at-least-32-characters";
  process.env.DIGITAL_HOSPITAL_CALLBACK_SECRET = "coverage-digital-hospital-callback-secret-32-plus";
  delete process.env.CARE_CUTOVER_EVIDENCE_FILE;
  delete process.env.CARE_CUTOVER_EVIDENCE_SHA256;
  delete process.env.CARE_DEPENDENCY_EVIDENCE_FILE;
  delete process.env.CARE_DEPENDENCY_EVIDENCE_SHA256;

  const {
    configureDigitalHospitalExecutionRuntime,
    digitalHospitalClientCertificate,
    digitalHospitalWorkerFingerprints,
    requireDigitalHospitalExecutionWorker,
    server,
    startServer,
    stopServer
  } = require(path.join(ROOT, "server.js"));
  configureDigitalHospitalExecutionRuntime({ managedSecretLoader: null });

  let started = false;
  let stopped = false;

  async function start() {
    startServer(0);
    await once(server, "listening");
    started = true;
    const { port } = server.address();
    return `http://127.0.0.1:${port}`;
  }

  async function stop() {
    if (stopped) return;
    stopped = true;
    if (started) await stopServer();
    delete process.env.DIGITAL_HOSPITAL_CALLBACK_SECRET;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  return {
    configureDigitalHospitalExecutionRuntime,
    digitalHospitalClientCertificate,
    digitalHospitalWorkerFingerprints,
    fixture,
    requireDigitalHospitalExecutionWorker,
    start,
    stop
  };
}

module.exports = {
  createApiRegressionRuntime
};
