const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildMasterDataDirectory,
  buildPlatformBlockerRegister,
  buildPlatformGoLiveSlices,
  buildPlatformServiceOrderCenter,
  renderPlatformGoLiveSlicesMarkdown
} = require("../platform-go-live-slices");
const { buildPlatformGoLiveSlicesReport, parseArgs, writeOutput } = require("../scripts/platform-go-live-slices");

function sampleData() {
  return {
    serviceOrders: [{ id: "so-1", serviceType: "registration", residentId: "r1", title: "Appointment", status: "open" }],
    internetNursingOrders: [{ id: "in-1", residentId: "r2", serviceName: "Home care", status: "scheduled" }],
    escortServiceOrders: [{ id: "es-1", residentId: "r3", serviceName: "Escort", status: "open" }],
    registrationOrders: [{ id: "reg-1", residentId: "r4", serviceName: "Register", status: "completed" }],
    chronicScreeningTasks: [{ id: "ch-1", residentId: "r5", taskName: "Screening", status: "open" }],
    careOrders: [{ id: "care-1", residentId: "r6", orderType: "Referral", status: "open" }],
    countyCollaborationOrders: [{ id: "co-1", residentId: "r7", orderType: "County collaboration", status: "open" }],
    emergencyEvents: [{ id: "em-1", residentId: "r8", title: "Emergency", status: "open" }],
    physicalExamFollowupTasks: [{ id: "pe-1", residentId: "r9", taskName: "Exam follow-up", status: "open" }],
    standardDataDictionaries: [
      { id: "dict-person-index", name: "Person index", domain: "personIndex", owner: "data-office", standardItems: ["id", "name"], platformCollections: ["residents"], status: "ready", signoffStatus: "signed", version: "v1" },
      { id: "dict-org", name: "Organization", domain: "organization", owner: "data-office", standardItems: ["orgCode"], platformCollections: ["authOrganizations"], status: "ready", signoffStatus: "signed", version: "v1" },
      { id: "dict-staff", name: "Staff", domain: "staff", owner: "hr", standardItems: ["staffCode"], platformCollections: ["authUsers"], status: "ready", signoffStatus: "signed", version: "v1" },
      { id: "dict-disease", name: "Disease", domain: "disease", owner: "medical", standardItems: ["icd10"], platformCollections: ["diseases"], status: "ready", signoffStatus: "signed", version: "v1" },
      { id: "dict-drug", name: "Drug", domain: "drug", owner: "pharmacy", standardItems: ["drugCode"], platformCollections: ["medicationPickups"], status: "ready", signoffStatus: "signed", version: "v1" },
      { id: "dict-lab", name: "Lab", domain: "lab", owner: "lab", standardItems: ["loinc"], platformCollections: ["diagnosticReports"], status: "pending-site-signoff", blocker: "onsite signature", version: "v1" }
    ],
    residents: [],
    authOrganizations: [],
    authUsers: [],
    diseases: [],
    medicationPickups: [],
    diagnosticReports: [],
    publicHealthCutoverBlockers: [{ id: "ph-1", severity: "P0", status: "open", owner: "cdc", title: "CDC receipt", nextAction: "Upload receipt." }]
  };
}

test("platform go-live slices summarize blockers orders and master data", () => {
  const data = sampleData();
  const capabilityMap = {
    riskRegister: {
      items: [{ id: "risk-1", source: "capability-map", severity: "P1", status: "open", title: "Missing evidence", owner: "ops" }]
    }
  };
  const blockerRegister = buildPlatformBlockerRegister(data, capabilityMap);
  const serviceOrderCenter = buildPlatformServiceOrderCenter(data);
  const masterDataDirectory = buildMasterDataDirectory(data);
  const report = buildPlatformGoLiveSlices(data, capabilityMap);
  assert.equal(blockerRegister.summary.p0, 1);
  assert.equal(serviceOrderCenter.summary.total >= 8, true);
  assert.equal(serviceOrderCenter.summary.serviceTypes >= 4, true);
  assert.equal(masterDataDirectory.summary.domains, 6);
  assert.equal(masterDataDirectory.summary.onsiteBlocked >= 1, true);
  assert.equal(report.ok, true);
  assert.equal(report.checks.every((item) => item.passed), true);
});

test("platform go-live slices markdown and script output are exportable", (t) => {
  const outputDir = path.join(__dirname, "..", "tmp", "platform-go-live-slices-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildPlatformGoLiveSlicesReport({
    data: sampleData(),
    releaseReport: { ok: true, checks: [], summary: { total: 0 } },
    manifest: { ok: true, artifacts: [], templateReadmes: [] },
    capabilityMap: { riskRegister: { items: [{ id: "risk-1", severity: "P0", status: "open", source: "test" }] } }
  });
  const markdown = renderPlatformGoLiveSlicesMarkdown(report);
  assert.match(markdown, /Platform go-live slices readiness/);
  assert.match(markdown, /Unified Blocker Register/);
  assert.match(markdown, /Service Order Center/);
  assert.match(markdown, /Master Data Directory/);
  writeOutput(report, {
    output: path.join(outputDir, "platform-go-live-slices.json"),
    markdown: path.join(outputDir, "platform-go-live-slices.md")
  });
  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "platform-go-live-slices.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "platform-go-live-slices.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.match(writtenMarkdown, /Platform go-live slices readiness/);
  assert.deepEqual(parseArgs(["--output=release/a.json", "--markdown=release/a.md"]), {
    output: "release/a.json",
    markdown: "release/a.md"
  });
});
