const assert = require("node:assert/strict");
const test = require("node:test");

const {
  HIGHLIGHT_FEATURE_IDS,
  buildInternetNursingInnovationCenter,
  riskScore
} = require("../internet-nursing-highlights");

const nurses = [
  {
    id: "n1",
    name: "Nurse A",
    institutionId: "h1",
    yearsClinical: 8,
    registrationStatus: "verified",
    badPracticeRecord: "none",
    trainingStatus: "passed",
    insuranceStatus: "covered",
    dailyCapacity: 6,
    assignedToday: 2
  }
];

const orders = [
  {
    id: "o1",
    residentId: "r1",
    residentName: "Resident A",
    institutionId: "h1",
    serviceItem: "PICC maintenance",
    riskLevel: "high",
    status: "requested",
    firstVisitAssessment: "pending",
    informedConsent: "pending",
    settlement: { paymentStatus: "pending", insuranceEstimate: 120, estimatedSelfPay: 80 },
    qualityInspection: { status: "required" },
    adverseEvent: { status: "none" }
  },
  {
    id: "o2",
    residentId: "r2",
    residentName: "Resident B",
    institutionId: "h1",
    nurseId: "n1",
    serviceItem: "blood glucose measurement",
    riskLevel: "low",
    status: "accepted",
    firstVisitAssessment: "passed",
    informedConsent: "signed",
    consentAttachment: { status: "signed", version: "internet-nursing-consent-v1", signedAt: "2026-07-17T08:00:00.000Z", signerName: "Resident B", hash: "sha256:demo" },
    locationTrace: "tracking",
    locationTracePoints: [
      { stage: "nurse-accept", lat: 38.9, lng: 121.6 },
      { stage: "service-start", lat: 38.91, lng: 121.61 }
    ],
    serviceRecord: {
      status: "in-progress",
      vitalSigns: { bloodGlucose: "6.8 mmol/L" },
      careActions: ["identity check", "blood glucose measurement"],
      materialsUsed: ["test strip"],
      followupAdvice: "repeat tomorrow"
    },
    settlement: { paymentStatus: "prechecked", insuranceEstimate: 50, estimatedSelfPay: 36 },
    qualityInspection: { status: "sampled" },
    adverseEvent: { status: "none" }
  }
];

test("internet nursing innovation center exposes all ten highlight features", () => {
  const center = buildInternetNursingInnovationCenter({
    orders,
    nurses,
    institutions: [{ id: "h1", name: "Hospital A" }],
    siteCutoverPack: {
      productionReadiness: "production-blocked",
      productionBlockers: [{ id: "b1", source: "oidc", name: "OIDC", requiredAction: "configure OIDC" }],
      tracks: [{ id: "t1", ready: true }, { id: "t2", ready: true }, { id: "t3", ready: true }, { id: "t4", ready: true }, { id: "t5", ready: true }]
    }
  });

  assert.equal(center.featureCount, 10);
  assert.deepEqual(center.features.map((item) => item.id), HIGHLIGHT_FEATURE_IDS);
  assert.equal(center.smartDispatch.pendingOrders, 1);
  assert.equal(center.smartDispatch.recommendedCandidates >= 1, true);
  assert.equal(center.riskScores.some((item) => item.band === "high"), true);
  assert.equal(center.liveTrace.trackedOrders, 1);
  assert.equal(center.videoConsent.signedOrders, 1);
  assert.equal(center.voiceRecords.structuredDrafts, 1);
  assert.equal(center.familyCollaboration.ordersWithFamilyView, 2);
  assert.equal(center.qualityControl.issueCount >= 1, true);
  assert.equal(center.regulatoryDashboard.serviceVolume, 2);
  assert.equal(center.paymentClosure.precheckedOrders, 1);
  assert.equal(center.evidenceWorkbench.blockerCount, 1);
});

test("risk score explains why a home nursing order is high risk", () => {
  const score = riskScore(orders[0]);
  assert.equal(score.band, "high");
  assert.equal(score.reasons.includes("首诊评估未完成"), true);
  assert.equal(score.reasons.includes("知情同意未签署"), true);
  assert.equal(score.reasons.includes("尚未派单"), true);
});
