const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildImagingCloudDeploymentReadiness, parseArgs, readEnvFile } = require("../scripts/imaging-cloud-deployment-readiness");

function readyEnv() {
  return {
    IMAGING_DEPLOYMENT_ENV: "production",
    DEPLOYMENT_SECRET_PROVIDER: "vault",
    DEPLOYMENT_RELEASE_ID: "imaging-20260724-01",
    DEPLOYMENT_ARTIFACT_DIGEST: `sha256:${"a".repeat(64)}`,
    IMAGING_FHIR_BASE_URL: "https://fhir.ln-health.example/fhir",
    IMAGING_DICOMWEB_BASE_URL: "https://dicom.ln-health.example/dicom-web",
    IMAGING_OHIF_BASE_URL: "https://viewer.ln-health.example",
    IMAGING_PACS_DICOM_TLS_HOST: "pacs-gateway.ln-health.example",
    IMAGING_PACS_DICOM_TLS_PORT: "2762",
    IMAGING_PACS_DICOM_TLS_CERT_SHA256: `sha256:${"b".repeat(64)}`,
    IMAGING_OBJECT_STORAGE_REGION: "liaoning-in-province",
    IMAGING_OBJECT_STORAGE_ENCRYPTION: "enabled",
    IMAGING_AUDIT_RETENTION_DAYS: "180",
    IMAGING_MOBILE_ORIGINAL_DICOM_POLICY: "no-original-dicom-on-mobile",
    IMAGING_CONFIGURATION_EVIDENCE_REF: "CHG-20260724-001"
  };
}

test("imaging deployment configuration requires TLS, local storage and artifact provenance", () => {
  const report = buildImagingCloudDeploymentReadiness({ env: readyEnv() });
  assert.equal(report.deploymentConfigReady, true);
  assert.equal(report.productionReady, false);
  assert.equal(report.formalGoLiveState, "blocked-until-site-evidence-signed");
  assert.equal(report.secretValuesRead, false);

  const rejected = buildImagingCloudDeploymentReadiness({ env: { ...readyEnv(), IMAGING_OHIF_BASE_URL: "http://localhost:3000", IMAGING_AUDIT_RETENTION_DAYS: "90" } });
  assert.equal(rejected.deploymentConfigReady, false);
  assert.equal(rejected.checks.some((item) => item.id === "deployment:ohif-tls" && !item.passed), true);
  assert.equal(rejected.checks.some((item) => item.id === "deployment:audit-retention" && !item.passed), true);
});

test("deployment environment parser preserves only configured key values", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "imaging-cloud-env-"));
  const file = path.join(directory, "deployment.env");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(file, "# comment\nA=1\nB='two words'\n", "utf8");
  assert.deepEqual(readEnvFile(file), { A: "1", B: "two words" });
  assert.deepEqual(parseArgs(["--env-file=deploy/solution-a/imaging-cloud.production.env", "--quiet"]), { "env-file": "deploy/solution-a/imaging-cloud.production.env", quiet: true });
});
