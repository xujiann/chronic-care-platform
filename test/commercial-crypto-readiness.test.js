const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  applyCommercialCryptoAction,
  buildCommercialCryptoCenter,
  buildCommercialCryptoReadiness,
  parseArgs,
  probeCommercialCryptoRuntime,
  renderMarkdown,
  seedCommercialCryptoCapabilities,
  writeOutput
} = require("../scripts/commercial-crypto-readiness");

const ROOT = path.resolve(__dirname, "..");

test("commercial crypto runtime probe distinguishes availability from approval", () => {
  const probe = probeCommercialCryptoRuntime({
    hashes: ["sha256", "sm3"],
    ciphers: ["aes-256-gcm", "sm4-cbc"],
    curves: ["prime256v1", "SM2"]
  });
  assert.deepEqual(probe.availablePrimitives, ["SM2", "SM3", "SM4"]);
  assert.equal(probe.primitives.find((item) => item.id === "SM2").selfTestPassed, false);
  assert.equal(probe.primitives.filter((item) => item.id !== "SM2").every((item) => item.selfTestPassed), true);
  assert.match(probe.caveat, /not product certification/);
});

test("commercial crypto center exposes six contracts and keeps production gate closed", () => {
  const center = buildCommercialCryptoCenter({}, {
    runtimeProbe: probeCommercialCryptoRuntime({ hashes: ["sm3"], ciphers: ["sm4-cbc"], curves: [] })
  });
  assert.equal(center.ok, true);
  assert.equal(center.summary.capabilities, 6);
  assert.equal(center.summary.productionReady, 0);
  assert.equal(center.capabilities.every((item) => item.productionReady === false), true);
  assert.equal(center.capabilities.some((item) => item.runtimeCompatibility === "runtime-partial"), true);
  assert.equal(center.onsiteBlockers.length, 5);
});

test("commercial crypto actions require evidence and never open production", () => {
  const capability = seedCommercialCryptoCapabilities()[0];
  assert.throws(
    () => applyCommercialCryptoAction(capability, { action: "record-evidence", note: "device list received" }, { name: "tester", role: "commission" }),
    /requires evidenceRef/
  );
  const recorded = applyCommercialCryptoAction(
    capability,
    { action: "record-evidence", note: "supplier document received", evidenceRef: "supplier/qualification-demo.pdf" },
    { name: "tester", role: "commission" }
  );
  assert.equal(recorded.item.status, "evidence-recorded");
  assert.equal(recorded.item.productionReady, false);
  assert.equal(recorded.evidencePacket.productionEvidence, false);
  const requested = applyCommercialCryptoAction(
    recorded.item,
    { action: "request-onsite", note: "verify provider and certificate chain onsite" },
    { name: "tester", role: "commission" }
  );
  assert.equal(requested.item.onsiteVerification, "requested");
  assert.equal(requested.item.productionReady, false);
});

test("commercial crypto probe action records compatibility evidence only", () => {
  const capability = seedCommercialCryptoCapabilities()[3];
  const action = applyCommercialCryptoAction(
    capability,
    { action: "run-runtime-probe", note: "local OpenSSL compatibility check" },
    { name: "tester", role: "commission" },
    { runtimeProbe: probeCommercialCryptoRuntime({ hashes: ["sm3"], ciphers: [], curves: [] }) }
  );
  assert.equal(action.item.status, "runtime-probe-recorded");
  assert.equal(action.probeRun.productionEvidence, false);
  assert.equal(action.probeRun.primitives.find((item) => item.id === "SM3").selfTestPassed, true);
});

test("commercial crypto readiness renders and writes release evidence", (t) => {
  const outputDir = path.join(ROOT, "tmp", "commercial-crypto-readiness-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildCommercialCryptoReadiness();
  assert.equal(report.ok, true);
  assert.equal(report.checks.every((item) => item.passed), true);
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Commercial crypto adapter center readiness report/);
  assert.match(markdown, /Production boundary/);
  writeOutput(report, {
    output: path.join("tmp", "commercial-crypto-readiness-test", "report.json"),
    markdown: path.join("tmp", "commercial-crypto-readiness-test", "report.md")
  });
  assert.equal(JSON.parse(fs.readFileSync(path.join(outputDir, "report.json"), "utf8")).ok, true);
  const parsed = parseArgs(["--output=release/custom.json", "--markdown=release/custom.md", "--write=false"]);
  assert.equal(parsed.output, "release/custom.json");
  assert.equal(parsed.markdown, "release/custom.md");
  assert.equal(parsed.write, "false");
});
