const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildMasterDataDirectory,
  buildPlatformBlockerRegister,
  buildPlatformGoLiveSlices,
  buildPlatformServiceOrderCenter,
  renderPlatformGoLiveSlicesMarkdown
} = require("../platform-go-live-slices");
const {
  buildPlatformGoLiveSlicesReport,
  parseArgs
} = require("../scripts/platform-go-live-slices");

function fixture() {
  const standardDataDictionaries = ["person", "institution", "diagnosis", "procedure", "drug", "laboratory"].map((domain, index) => ({
    id: `dictionary-${domain}`,
    name: `${domain} master data`,
    domain,
    owner: `owner-${domain}`,
    version: `2026.${index + 1}`,
    status: index === 0 ? "pending-site-signoff" : "structured-summary",
    standardItems: [`${domain}-code`],
    platformCollections: ["serviceOrders"]
  }));
  const orders = (prefix) => [1, 2].map((index) => ({ id: `${prefix}-${index}`, residentId: `r${index}`, status: "open" }));
  return {
    standardDataDictionaries,
    serviceOrders: [],
    internetNursingOrders: orders("nursing"),
    escortServiceOrders: orders("escort"),
    registrationOrders: orders("registration"),
    chronicScreeningTasks: orders("followup")
  };
}

const capabilityMap = {
  riskRegister: {
    items: [
      { id: "risk-p0", source: "fixture", severity: "P0", title: "Site evidence missing", owner: "site-owner", status: "open", nextAction: "Archive signed evidence." }
    ]
  }
};

test("platform go-live slices keep blockers services and master data visible", () => {
  const data = fixture();
  const blockerRegister = buildPlatformBlockerRegister(data, capabilityMap);
  const serviceOrderCenter = buildPlatformServiceOrderCenter(data);
  const masterDataDirectory = buildMasterDataDirectory(data);
  const report = buildPlatformGoLiveSlices(data, capabilityMap);

  assert.equal(blockerRegister.ok, true);
  assert.equal(blockerRegister.summary.p0, 1);
  assert.equal(serviceOrderCenter.ok, true);
  assert.equal(serviceOrderCenter.summary.serviceTypes, 4);
  assert.equal(masterDataDirectory.ok, true);
  assert.equal(masterDataDirectory.summary.domains, 6);
  assert.equal(masterDataDirectory.summary.onsiteBlocked >= 1, true);
  assert.equal(report.ok, true);
  assert.equal(report.checks.every((item) => item.passed), true);
  assert.match(renderPlatformGoLiveSlicesMarkdown(report), /Unified Blocker Register/);
  assert.match(renderPlatformGoLiveSlicesMarkdown(report), /Master Data Directory/);
});

test("platform go-live slices report accepts injected release evidence", () => {
  const report = buildPlatformGoLiveSlicesReport({
    data: fixture(),
    releaseReport: { ok: true },
    manifest: { ok: true },
    capabilityMap
  });
  assert.equal(report.ok, true);
  assert.deepEqual(parseArgs(["--output=tmp/report.json", "--markdown=tmp/report.md"]), {
    output: "tmp/report.json",
    markdown: "tmp/report.md"
  });
});
