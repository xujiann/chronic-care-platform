const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildSpecialtyCutoverPack,
  normalizeTrack,
  renderMarkdown,
  selectFirstIncrement,
  writeCutoverPack
} = require("../emergency-specialty-cutover");

function report(overrides = {}) {
  return {
    ok: true,
    codeReady: true,
    productionReady: false,
    formalGoLiveState: "blocked-until-site-evidence-signed",
    summary: { checks: 10, passed: 10, sitePending: 2 },
    checks: [{ id: "demo", passed: true }],
    siteBlockers: [
      { id: "SITE-01", title: "external interface receipt", owner: "site owner", status: "site-pending" },
      { id: "SITE-02", title: "dual approval", owner: "commission", status: "site-pending" }
    ],
    ...overrides
  };
}

const tracks = [
  {
    id: "emergency-life-chain",
    name: "120急救生命链",
    department: "急救中心",
    page: "emergency.html",
    api: "/api/emergency/production-center",
    acceptanceIncrement: "single 120 station grey release",
    requiredExternalEvidence: ["dispatch receipt", "hospital handover"]
  },
  {
    id: "clinical-blood",
    name: "临床用血",
    department: "血液中心",
    page: "blood.html",
    api: "/api/blood-system/go-live",
    acceptanceIncrement: "single blood batch grey release",
    requiredExternalEvidence: ["cold chain receipt", "dual reviewer"]
  }
];

test("normalizeTrack keeps code readiness separate from formal production readiness", () => {
  const normalized = normalizeTrack(tracks[0], report());
  assert.equal(normalized.codeReady, true);
  assert.equal(normalized.productionReady, false);
  assert.equal(normalized.currentStage, "site-evidence");
  assert.equal(normalized.blockers.length, 2);
  assert.match(normalized.readiness.digest, /^sha256:[a-f0-9]{64}$/);
});

test("buildSpecialtyCutoverPack aggregates site blockers and cross-track controls", () => {
  const pack = buildSpecialtyCutoverPack({
    generatedAt: "2026-07-23T00:00:00.000Z",
    tracks,
    reports: {
      "emergency-life-chain": report(),
      "clinical-blood": report({ summary: { checks: 12, passed: 12, sitePending: 1 }, siteBlockers: [{ id: "BLOOD-01", title: "BIS receipt", owner: "blood center" }] })
    }
  });

  assert.equal(pack.summary.tracks, 2);
  assert.equal(pack.summary.codeReady, 2);
  assert.equal(pack.summary.productionReady, 0);
  assert.equal(pack.summary.siteBlockers, 3);
  assert.equal(pack.summary.totalChecks, 22);
  assert.equal(pack.summary.passedChecks, 22);
  assert.equal(pack.summary.formalGoLiveState, "blocked-until-site-evidence-signed");
  assert.equal(pack.crossTrackControls.length, 4);
  assert.ok(pack.crossTrackControls.some((item) => item.id === "four-eyes-site-evidence"));
  assert.match(pack.integrity.digest, /^sha256:[a-f0-9]{64}$/);
});

test("selectFirstIncrement prioritizes emergency life chain when code is ready but site evidence is pending", () => {
  const pack = buildSpecialtyCutoverPack({
    tracks,
    reports: {
      "emergency-life-chain": report(),
      "clinical-blood": report()
    }
  });

  assert.equal(pack.firstIncrement.trackId, "emergency-life-chain");
  assert.match(pack.firstIncrement.why, /现场证据/);
  assert.equal(pack.firstIncrement.requiredBeforeStart.length, 2);
});

test("renderMarkdown exposes the digest, departments, blockers and first grey increment", () => {
  const pack = buildSpecialtyCutoverPack({
    tracks,
    reports: {
      "emergency-life-chain": report(),
      "clinical-blood": report()
    }
  });
  const markdown = renderMarkdown(pack);
  assert.match(markdown, /T10 急救、用血、影像与体检专项上线割接包/);
  assert.match(markdown, /120急救生命链/);
  assert.match(markdown, /临床用血/);
  assert.match(markdown, /Site blockers: 4/);
  assert.match(markdown, /sha256:[a-f0-9]{64}/);
  assert.match(markdown, /首个可验收灰度增量/);
});

test("writeCutoverPack writes JSON and Markdown artifacts without touching runtime data", () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "t10-cutover-"));
  const pack = buildSpecialtyCutoverPack({
    tracks,
    reports: {
      "emergency-life-chain": report(),
      "clinical-blood": report()
    }
  });

  const output = writeCutoverPack(pack, { outputDir });
  assert.equal(JSON.parse(fs.readFileSync(output.jsonPath, "utf8")).module, "t10-emergency-blood-imaging-physical-exam-cutover");
  assert.match(fs.readFileSync(output.markdownPath, "utf8"), /T10 急救、用血、影像与体检专项上线割接包/);
});

test("static cutover preview page exposes T10 tracks and release-artifact fallback", () => {
  const root = path.resolve(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "t10-specialty-cutover.html"), "utf8");
  const client = fs.readFileSync(path.join(root, "t10-specialty-cutover.js"), "utf8");

  assert.match(html, /T10专项上线割接总控/);
  assert.match(html, /t10-specialty-cutover\.js/);
  assert.match(html, /emergency\.html/);
  assert.match(html, /blood\.html/);
  assert.match(html, /imaging-cloud\.html/);
  assert.match(html, /physical-examination\.html/);
  assert.match(client, /release\/t10-specialty-cutover-pack\.json/);
  assert.match(client, /fallbackCutoverPack/);
  assert.match(client, /120急救生命链/);
  assert.match(client, /四眼现场证据签收/);
  assert.match(client, /blocked-until-site-evidence-signed/);
});
