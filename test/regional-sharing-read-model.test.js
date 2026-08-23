"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CONTRACT_ID,
  createRegionalSharingReadModel
} = require("../src/platform/governance/regional-sharing-read-model");

function createReadModel(overrides = {}) {
  return createRegionalSharingReadModel({
    buildReferralHandoffEvidence(packageItem, reviews) {
      const ready = packageItem.id === "package-visible" && reviews.some((item) => item.packageId === packageItem.id);
      return {
        ready,
        readyCount: ready ? 2 : 1,
        total: 2,
        evidence: [
          { label: "资料", ready: true },
          { label: "审计", ready }
        ],
        note: `handoff:${packageItem.id}`
      };
    },
    canAccessPackage: (_user, item) => item.id !== "package-hidden",
    createId: () => "fixed-id",
    normalizePackages: (packages) => packages,
    now: () => "2026-08-23T00:00:00.000Z",
    seedPackages: () => [],
    seedScope: () => ({ name: "seed scope" }),
    seedSnapshots: () => ({ generatedAt: "seed" }),
    ...overrides
  });
}

function fixture() {
  return {
    regionalDataSharingScope: { name: "区域诊疗数据共享平台" },
    regionalSharingSnapshots: { generatedAt: "snapshot" },
    regionalSharingPackages: [
      {
        id: "package-visible",
        residentId: "resident-1",
        title: "共享包一",
        sourceInstitution: "来源机构",
        sourceOrgCode: "ORG-SOURCE",
        targetInstitutions: ["目标机构"],
        targetOrgCodes: ["ORG-TARGET"],
        status: "ready",
        recordRefs: ["report-explicit", "recognition-1"],
        sharedCollections: ["personalRecords"],
        contractRefs: ["contract-ready"]
      },
      {
        id: "package-hidden",
        residentId: "resident-2",
        targetInstitutions: [],
        targetOrgCodes: [],
        status: "blocked",
        recordRefs: [],
        sharedCollections: [],
        contractRefs: []
      }
    ],
    regionalSharingAccessReviews: [
      { id: "review-visible", packageId: "package-visible" },
      { id: "review-hidden", packageId: "package-hidden" }
    ],
    residents: [{ id: "resident-1", name: "居民一" }],
    integrationContracts: [{ id: "contract-ready", domain: "LIS", resource: "report", status: "ready", secret: "not-projected" }],
    diagnosticReports: [
      { id: "report-resident", residentId: "resident-1", item: "较早报告", status: "ready", reportedAt: "2026-08-20T00:00:00.000Z" },
      { id: "report-explicit", residentId: "resident-other", item: "较新报告", status: "ready", reportedAt: "2026-08-22T00:00:00.000Z" }
    ],
    personalRecords: [{ id: "personal-1", residentId: "resident-1", name: "档案", category: "summary", recordDate: "2026-08-21T00:00:00.000Z" }],
    countyMutualRecognitionRecords: [{ id: "recognition-1", residentId: "resident-other", item: "互认", status: "passed", at: "2026-08-23T00:00:00.000Z" }]
  };
}

test("regional sharing read model exposes a versioned two-query port and rejects incomplete composition", () => {
  assert.equal(CONTRACT_ID, "regional-sharing-read-model.v1");
  assert.throws(() => createRegionalSharingReadModel({}), /buildReferralHandoffEvidence/);
  const model = createReadModel();
  assert.equal(model.contractId, CONTRACT_ID);
  assert.deepEqual(Object.keys(model), ["contractId", "buildRegionalDataSharingView", "buildRegionalHandoffReport"]);
  assert.equal(Object.isFrozen(model), true);
});

test("regional sharing view preserves scope filtering, evidence projection and latest-record ordering", () => {
  const view = createReadModel().buildRegionalDataSharingView(fixture(), { role: "institution" });
  assert.deepEqual(view.scope, { name: "区域诊疗数据共享平台" });
  assert.deepEqual(view.snapshots, { generatedAt: "snapshot" });
  assert.deepEqual(view.summary, {
    totalPackages: 1,
    ready: 1,
    pendingReview: 0,
    blocked: 0,
    referralHandoffReady: 1,
    accessReviews: 1,
    institutions: 2,
    contracts: 1
  });
  assert.deepEqual(view.accessReviews, [{ id: "review-visible", packageId: "package-visible" }]);
  assert.deepEqual(view.packages[0].contracts, [{ id: "contract-ready", domain: "LIS", resource: "report", status: "ready" }]);
  assert.deepEqual(view.packages[0].evidenceCounts, {
    diagnosticReports: 2,
    personalRecords: 1,
    mutualRecognitionRecords: 1,
    contracts: 1
  });
  assert.deepEqual(view.packages[0].latestRecords.map((item) => item.id), [
    "recognition-1",
    "report-explicit",
    "personal-1",
    "report-resident"
  ]);
});

test("regional handoff report preserves actor scope, evidence summary and markdown shape", () => {
  const report = createReadModel().buildRegionalHandoffReport(fixture(), {
    role: "institution",
    orgName: "目标机构",
    name: "机构用户"
  });
  assert.equal(report.reportId, "rshr-fixed-id");
  assert.equal(report.generatedAt, "2026-08-23T00:00:00.000Z");
  assert.deepEqual(report.actor, { role: "institution", organization: "目标机构", name: "机构用户" });
  assert.equal(report.scope.packageScope, "本机构来源或接收共享包");
  assert.equal(report.summary.packages, 1);
  assert.equal(report.summary.handoffReady, 1);
  assert.equal(report.summary.evidenceTotal, 2);
  assert.equal(report.summary.evidenceReady, 2);
  assert.equal(report.summary.accessReviews, 1);
  assert.deepEqual(report.packages[0].readyEvidence, ["资料", "审计"]);
  assert.deepEqual(report.packages[0].pendingEvidence, []);
  assert.match(report.markdown, /^# 区域共享-转诊会诊交接清单/m);
  assert.match(report.markdown, /清单编号：rshr-fixed-id/);
  assert.match(report.markdown, /package-visible \| 居民一 \| 来源机构 \| 目标机构 \| 2\/2 \| 无/);
});
