const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { IMAGE_POLICY, buildSolutionAReadiness, isControlledBindAddress, isImmutableImageReference, isLoopbackBindAddress, isPlaceholder, readinessExitCode } = require("../scripts/solution-a-readiness");

const ROOT = path.resolve(__dirname, "..");
const composeSource = fs.readFileSync(path.join(ROOT, "deploy/solution-a/docker-compose.yml"), "utf8");
const templateSource = fs.readFileSync(path.join(ROOT, "deploy/solution-a/.env.example"), "utf8");

function productionEnvironment(overrides = {}) {
  return {
    HAPI_DB_PASSWORD: "hapi-db-secret-with-32-characters-minimum",
    ORTHANC_USERNAME: "solution-a-clinical",
    ORTHANC_PASSWORD: "orthanc-secret-with-32-characters-minimum",
    ORTHANC_AUTHENTICATION_ENABLED: "true",
    ...overrides
  };
}

test("solution A repository defaults are secure while production remains externally blocked", () => {
  const report = buildSolutionAReadiness({});
  assert.equal(report.ok, true);
  assert.equal(report.configurationReady, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.dicomBindingMode, "loopback");
  assert.equal(report.checks.find((item) => item.id === "solution-a:container-image-contract").ok, true);
  assert.equal(report.checks.find((item) => item.id === "solution-a:orthanc-authentication-default").ok, true);
  assert.equal(report.checks.find((item) => item.id === "solution-a:dicom-loopback-default").ok, true);
  assert.equal(report.checks.find((item) => item.id === "solution-a:external-image-verification").externalEvidenceRequired, true);
  assert.equal(report.checks.find((item) => item.id === "solution-a:site-network-acceptance").externalEvidenceRequired, true);
});

test("reviewed credentials satisfy repository configuration checks but not external gates", () => {
  const report = buildSolutionAReadiness(productionEnvironment());
  assert.equal(report.ok, true);
  assert.equal(report.configurationReady, true);
  assert.equal(report.productionReady, false);
  assert.equal(readinessExitCode(report), 0);
  assert.equal(readinessExitCode(report, { production: true }), 1);
});

test("placeholder credentials and disabled authentication fail closed for production", () => {
  const report = buildSolutionAReadiness(productionEnvironment({ HAPI_DB_PASSWORD: "replace-with-strong-password", ORTHANC_USERNAME: "orthanc", ORTHANC_PASSWORD: "password", ORTHANC_AUTHENTICATION_ENABLED: "false" }));
  assert.equal(report.ok, true);
  assert.equal(report.configurationReady, false);
  assert.equal(report.checks.find((item) => item.id === "solution-a:production-credentials").ok, false);
  assert.equal(report.checks.find((item) => item.id === "solution-a:production-authentication").ok, false);
});

test("image overrides cannot bypass the reviewed tag-and-digest policy", () => {
  const [variable] = Object.keys(IMAGE_POLICY);
  const report = buildSolutionAReadiness(productionEnvironment({ [variable]: "hapiproject/hapi:latest" }));
  assert.equal(report.ok, true);
  assert.equal(report.configurationReady, false);
  assert.equal(report.checks.find((item) => item.id === "solution-a:production-image-selection").ok, false);
  assert.equal(isImmutableImageReference("hapiproject/hapi:latest"), false);
  assert.equal(isImmutableImageReference(IMAGE_POLICY[variable].reference), true);
});

test("repository contract detects mutable compose defaults and environment-template drift", () => {
  const mutableCompose = composeSource.replace(IMAGE_POLICY.HAPI_FHIR_IMAGE.reference, "hapiproject/hapi:latest");
  const driftedTemplate = templateSource.replace(IMAGE_POLICY.OHIF_IMAGE.reference, "ohif/app:v3.12.11");
  assert.equal(buildSolutionAReadiness({}, { composeSource: mutableCompose }).ok, false);
  assert.equal(buildSolutionAReadiness({}, { templateSource: driftedTemplate }).ok, false);
});

test("DICOM binding accepts loopback or explicit private interfaces and rejects wildcards", () => {
  assert.equal(isLoopbackBindAddress("127.0.0.1"), true);
  assert.equal(isControlledBindAddress("192.168.10.12"), true);
  assert.equal(isControlledBindAddress("172.20.10.8"), true);
  assert.equal(isControlledBindAddress("0.0.0.0"), false);
  assert.equal(isControlledBindAddress("203.0.113.5"), false);
  assert.equal(isControlledBindAddress("10.999.1.1"), false);
  assert.equal(isControlledBindAddress("[fd12:3456::8]"), true);
  assert.equal(isPlaceholder("replace-with-strong-password"), true);
});

test("private DICOM binding remains subject to on-site network acceptance", () => {
  const report = buildSolutionAReadiness(productionEnvironment({ ORTHANC_DICOM_BIND_ADDRESS: "10.10.20.30" }));
  assert.equal(report.ok, true);
  assert.equal(report.configurationReady, true);
  assert.equal(report.productionReady, false);
  assert.equal(report.dicomBindingMode, "controlled-private");
  assert.match(report.checks.find((item) => item.id === "solution-a:dicom-bind-address").detail, /site network acceptance/);
});
