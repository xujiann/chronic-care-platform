const test = require("node:test");
const assert = require("node:assert/strict");

const Domain = require("../nursing-escort-domain");

const NOW = "2026-07-23T09:00:00+08:00";
const HASH = `sha256:${"b".repeat(64)}`;

function assessedOrder(overrides = {}) {
  const order = {
    id: "ino-p1-assessment",
    residentId: "r1",
    institutionId: "inh-mr1",
    institutionCode: "MR1",
    serviceItem: "wound and ostomy care",
    serviceObject: "mobility-limited chronic disease patients",
    riskLevel: "medium",
    status: "requested",
    ...overrides
  };
  return {
    ...order,
    ...Domain.buildNursingAssessmentEvidence(order, {
      eligible: true,
      identityVerified: true,
      clinicianId: "doctor-home-001",
      sourceEncounterId: "encounter-ino-p1",
      conditions: ["chronic wound requiring home dressing"],
      contraindicationChecks: [
        { code: "unstable-vital-signs", status: "cleared" },
        { code: "active-massive-bleeding", status: "cleared" }
      ],
      consentSigned: true,
      signerId: "r1",
      signerName: "Resident A",
      objectKey: "consent/ino-p1-assessment.pdf",
      contentHash: HASH,
      storageReceiptId: "storage-receipt-ino-p1",
      validUntil: "2026-07-26T09:00:00+08:00"
    }, { at: NOW })
  };
}

test("P1 intake rejects past out-of-area and duplicate appointments with stable idempotency", () => {
  const draft = Domain.buildNursingOrderIntakeEvidence({
    id: "ino-p1-intake",
    residentId: "r1",
    institutionId: "inh-mr1",
    serviceItem: "wound and ostomy care",
    serviceObject: "mobility-limited chronic disease patients"
  }, {
    preferredAt: "2026-07-25T09:30:00+08:00",
    durationMinutes: 90,
    district: "Zhongshan",
    address: "Zhongshan service address",
    lat: 38.915,
    lng: 121.616
  });
  const institution = { id: "inh-mr1", serviceArea: ["Zhongshan", "Xigang"] };
  assert.equal(Domain.validateNursingOrderIntake(draft, { now: NOW, institution, orders: [] }).ok, true);

  const duplicate = { ...draft, id: "ino-p1-existing", status: "requested" };
  const duplicateResult = Domain.validateNursingOrderIntake(draft, { now: NOW, institution, orders: [duplicate] });
  assert.equal(duplicateResult.ok, false);
  assert.equal(duplicateResult.reasons.includes("intake-duplicate-active-order"), true);

  const invalid = Domain.buildNursingOrderIntakeEvidence(draft, {
    preferredAt: "2026-07-22T09:30:00+08:00",
    durationMinutes: 10,
    district: "Ganjingzi",
    lat: 38.915,
    lng: 121.616
  });
  const invalidResult = Domain.validateNursingOrderIntake(invalid, { now: NOW, institution, orders: [] });
  assert.equal(invalidResult.reasons.includes("intake-preferred-time-not-future"), true);
  assert.equal(invalidResult.reasons.includes("intake-duration-invalid"), true);
  assert.equal(invalidResult.reasons.includes("intake-outside-service-area"), true);
});

test("P1 assessment binds clinician contraindications consent object and content hash", () => {
  const order = assessedOrder();
  const result = Domain.validateNursingAssessmentEvidence(order, { at: NOW });
  assert.equal(result.ok, true);
  const assessed = Domain.transitionOrder("nursing", order, "assessed", {
    at: NOW,
    actorId: "doctor-home-001",
    actorRole: "clinician"
  });
  assert.equal(assessed.status, "assessed");
  assert.equal(assessed.timelineEvents[0].evidenceTypes.includes("clinical-assessment"), true);
  assert.equal(assessed.timelineEvents[0].evidenceTypes.includes("consent-storage-receipt"), true);

  const forged = {
    ...order,
    consentAttachment: { ...order.consentAttachment, contentHash: "sha256:forged" }
  };
  assert.throws(
    () => Domain.transitionOrder("nursing", forged, "assessed", { at: NOW }),
    (error) => error.code === "ORDER_ASSESSMENT_EVIDENCE_INVALID"
      && error.details.reasons.includes("consent-content-hash-invalid")
  );
});

test("P1 peritoneal dialysis protocol requires specialist checks records waste and EMR archive", () => {
  const accepted = {
    id: "ino-p1-pd",
    residentId: "r1",
    institutionId: "inh-mr1",
    nurseId: "inn-001",
    serviceItem: "peritoneal dialysis care",
    status: "accepted",
    identityVerified: true,
    adverseEvent: { status: "none" }
  };
  const protocol = Domain.SPECIALIST_NURSING_PROTOCOLS["peritoneal dialysis care"];
  const startEvidence = Domain.buildServiceStartEvidence("nursing", accepted, {
    lat: 38.915,
    lng: 121.616,
    verified: true,
    identityMatched: true,
    readinessVerified: true,
    equipmentItems: [...protocol.requiredEquipment, "service recorder"],
    equipmentVerified: true,
    emergencyReady: true,
    emergencyContactId: "nursing-duty-001",
    oneClickAlertTested: true,
    coordinationConfirmed: true,
    hospitalContactId: "dialysis-center-001",
    supportContactId: "family-r1",
    specialistProtocol: {
      riskChecks: protocol.requiredRiskChecks,
      equipment: protocol.requiredEquipment
    }
  }, { at: NOW });
  const inService = Domain.transitionOrder("nursing", accepted, "in-service", { at: NOW, updates: startEvidence });
  assert.equal(inService.specialistProtocolEvidence.status, "verified");

  const completedAt = "2026-07-23T10:00:00+08:00";
  const completionEvidence = Domain.buildServiceCompletionEvidence("nursing", inService, {
    lat: 38.916,
    lng: 121.617,
    verified: true,
    actions: ["aseptic exchange guidance", "catheter site care"],
    residentConfirmed: true,
    signerName: "Resident A",
    archiveAccepted: true,
    archiveTarget: "EMR",
    exceptionReport: { status: "none" },
    specialistProtocol: {
      riskChecks: protocol.requiredRiskChecks,
      equipment: protocol.requiredEquipment,
      procedureRecord: {
        effluentAppearance: "clear",
        catheterSite: "clean and dry",
        exchangeVolumeMl: 2000,
        dwellTimeMinutes: 240
      },
      outcome: "exchange completed without complication",
      patientEducation: "infection signs and emergency contact reviewed",
      exceptionDeclared: true
    },
    medicalWaste: {
      received: true,
      wasteTypes: ["dialysis consumables", "used dressing"],
      containerSealId: "seal-pd-001",
      receiverId: "waste-center-001"
    }
  }, { at: completedAt });
  const completed = Domain.transitionOrder("nursing", inService, "completed", {
    at: completedAt,
    updates: completionEvidence
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.specialistProtocolEvidence.status, "completed");
  assert.equal(completed.medicalWasteHandover.status, "received");
  assert.equal(completed.serviceArchiveReceipt.targetSystem, "EMR");

  assert.throws(
    () => Domain.transitionOrder("nursing", inService, "completed", {
      at: completedAt,
      updates: {
        ...completionEvidence,
        specialistProtocolEvidence: {
          ...completionEvidence.specialistProtocolEvidence,
          procedureRecord: { effluentAppearance: "clear" }
        }
      }
    }),
    (error) => error.code === "ORDER_SERVICE_EVIDENCE_INVALID"
      && error.details.reasons.includes("specialist-record-field-missing:catheterSite")
  );
});

test("P1 price snapshot locks integer cents and binds settlement evidence", () => {
  const completed = {
    id: "ino-p1-price",
    residentId: "r1",
    status: "completed",
    serviceItem: "peritoneal dialysis care",
    feeEstimate: 298,
    settlement: { insuranceEstimate: 160 }
  };
  const dispatch = Domain.buildSettlementDispatchEvidence("nursing", completed, {
    at: NOW,
    catalogVersion: "internet-nursing-price-2026-v1"
  });
  const candidate = { ...completed, ...dispatch };
  assert.equal(Domain.validateOrderPriceSnapshot("nursing", candidate).ok, true);
  assert.equal(Domain.validateFinancialEvidence("nursing", candidate, "settlement-pending").ok, true);
  assert.equal(candidate.priceSnapshot.baseAmountFen, 29800);
  assert.equal(candidate.priceSnapshot.insuranceAmountFen + candidate.priceSnapshot.selfPayAmountFen, 29800);

  const tampered = {
    ...candidate,
    priceSnapshot: { ...candidate.priceSnapshot, selfPayAmountFen: 1 }
  };
  const result = Domain.validateFinancialEvidence("nursing", tampered, "settlement-pending");
  assert.equal(result.ok, false);
  assert.equal(result.reasons.includes("price-snapshot-split-mismatch"), true);
  assert.equal(result.reasons.includes("price-snapshot-digest-mismatch"), true);
});

test("P1 domain exposes scheduling complaint incident timeline and notification closure", () => {
  [
    "buildResourceReservationEvidence",
    "buildRescheduleRequestEvidence",
    "buildNoShowEvidence",
    "buildCancellationRequestEvidence",
    "buildRefundDispatchEvidence",
    "buildComplaintEvidence",
    "buildRiskIncidentEvidence",
    "buildTimelineEvent",
    "buildNotificationPlan",
    "recordNotificationReceipt"
  ].forEach((name) => assert.equal(typeof Domain[name], "function", name));
});
