"use strict";

const { isDeepStrictEqual } = require("node:util");

const ownershipManifest = require("../../../config/domain-data-ownership.json");

const SYSTEM_COLLECTION_OWNERS = Object.freeze({
  dataAccessLogs: "platform-governance",
  platformProcessAudit: "platform-governance",
  securityEvents: "platform-governance"
});

const PLATFORM_WRITE_CONTRACTS = Object.freeze({
  "governance-catalog": Object.freeze({
    id: "platform-governance.governance-catalog-write.v1",
    collections: Object.freeze({
      drugConsumableSupervisions: "insurance-payment",
      platformProcessAudit: "platform-governance",
      qualityOperationsGovernanceAuditEvents: "platform-governance",
      qualityOperationsGovernanceCommandReceipts: "platform-governance",
      qualityRectificationOrders: "clinical-specialties",
      resourceDispatchRequests: "care-coordination",
      securityEvents: "platform-governance"
    })
  }),
  "public-health-coordination": Object.freeze({
    id: "platform-governance.public-health-coordination-write.v1",
    collections: Object.freeze({
      digitalHospitalPublicHealthCoordination: "public-health",
      securityEvents: "platform-governance"
    })
  }),
  "digital-hospital-pilot": Object.freeze({
    id: "platform-governance.digital-hospital-pilot-write.v1",
    collections: Object.freeze({
      disasterRecoveryDrills: "platform-governance",
      operationsDutyShifts: "platform-governance",
      operationsEvidencePackets: "platform-governance",
      operationsIncidents: "platform-governance",
      securityEvents: "platform-governance"
    })
  }),
  "production-operations": Object.freeze({
    id: "platform-governance.production-operations-write.v1",
    collections: Object.freeze({
      productionGoNoGoApprovals: "platform-governance",
      productionGoNoGoDecision: "platform-governance",
      productionSecurityFindings: "platform-governance",
      productionSecurityReleaseApprovals: "platform-governance",
      securityEvents: "platform-governance"
    })
  }),
  "digital-hospital-governance": Object.freeze({
    id: "platform-governance.digital-hospital-governance-write.v1",
    collections: Object.freeze({
      digitalHospitalCollectionJobs: "platform-governance",
      digitalHospitalControlMatrix: "platform-governance",
      digitalHospitalEvaluationEvidence: "platform-governance",
      digitalHospitalFormalCutoverApprovals: "platform-governance",
      digitalHospitalLaunchCommandBriefs: "platform-governance",
      digitalHospitalLaunchRequirements: "platform-governance",
      digitalHospitalPilotInstitutions: "platform-governance",
      digitalHospitalPilotIssues: "platform-governance",
      digitalHospitalPolicyRegister: "platform-governance",
      digitalHospitalPreAssessments: "platform-governance",
      digitalHospitalProductionEvidencePackets: "platform-governance",
      digitalHospitalSelfAssessments: "platform-governance",
      securityEvents: "platform-governance"
    })
  }),
  "phase2-operations": Object.freeze({
    id: "platform-governance.phase2-operations-write.v1",
    collections: Object.freeze({
      commercialCryptoCapabilities: "platform-governance",
      commercialCryptoEvidencePackets: "platform-governance",
      commercialCryptoProbeRuns: "platform-governance",
      phase2ClinicalAssistAlerts: "clinical-specialties",
      phase2ClinicalAssistReceipts: "clinical-specialties",
      phase2ClinicalAssistRules: "clinical-specialties",
      phase2DiseaseReportQueue: "public-health",
      phase2DiseaseReportReceipts: "public-health",
      phase2FamilyDoctorApplications: "care-coordination",
      phase2FamilyDoctorContracts: "care-coordination",
      phase2FamilyDoctorFulfillments: "care-coordination",
      platformCapabilityReviews: "platform-governance",
      platformProductionBlockerReviews: "platform-governance",
      productionDatabaseCutoverRuns: "platform-governance",
      productionDatabaseMigrationBatches: "platform-governance",
      securityEvents: "platform-governance",
      taskMessages: "care-coordination"
    })
  }),
  "mutual-recognition-decision": Object.freeze({
    id: "platform-governance.mutual-recognition-decision-write.v1",
    collections: Object.freeze({
      countyMutualRecognitionRecords: "clinical-specialties",
      diagnosticReports: "clinical-specialties",
      phase2MutualRecognitionCitations: "clinical-specialties",
      securityEvents: "platform-governance"
    })
  }),
  "productization-center": Object.freeze({
    id: "platform-governance.productization-center-write.v1",
    collections: Object.freeze({
      institutionIntegrationCommands: "integration",
      institutionIntegrationProfiles: "integration",
      institutionJointTestRuns: "integration",
      platformWorkItemCommands: "platform-governance",
      platformWorkItems: "platform-governance",
      securityEvents: "platform-governance"
    })
  })
});

const LEGACY_FULL_STATE_CONTRACT = Object.freeze({
  id: "state-data.legacy-full-state-write.v1",
  deprecated: true,
  sunset: "Mon, 01 Feb 2027 00:00:00 GMT",
  successor: "/api/state-collections/:collection"
});

function valuesEqual(left, right) {
  return isDeepStrictEqual(left, right);
}

function changedCollections(current = {}, next = {}) {
  return [...new Set([...Object.keys(current || {}), ...Object.keys(next || {})])]
    .filter((collection) => collection !== "storageMeta")
    .filter((collection) => !valuesEqual(current?.[collection], next?.[collection]))
    .sort();
}

function ownerForCollection(collection, { allowLegacy = false } = {}) {
  const registered = ownershipManifest.collections?.[collection]?.owner;
  if (registered) return Object.freeze({ owner: registered, registered: true });
  if (SYSTEM_COLLECTION_OWNERS[collection]) {
    return Object.freeze({ owner: SYSTEM_COLLECTION_OWNERS[collection], registered: true });
  }
  if (allowLegacy) {
    return Object.freeze({
      owner: "platform-governance",
      registered: false,
      migrationRequired: true
    });
  }
  const error = new Error(`collection ${collection} has no explicit data owner`);
  error.code = "T02_DATA_OWNER_UNDECLARED";
  throw error;
}

function ownershipEntries(collections, options = {}) {
  return collections.map((collection) => Object.freeze({
    collection,
    ...ownerForCollection(collection, options)
  }));
}

function setLegacyWriteHeaders(res, contract = LEGACY_FULL_STATE_CONTRACT) {
  res.setHeader("Deprecation", "true");
  res.setHeader("Sunset", contract.sunset);
  res.setHeader("Link", `<${contract.successor}>; rel="successor-version"`);
  res.setHeader("X-Write-Contract", contract.id);
  res.setHeader("X-Compatibility-Mode", "legacy-delegated-write");
}

function setOwnedWriteHeaders(res, collection) {
  const policy = ownerForCollection(collection);
  res.setHeader("X-Data-Owner", policy.owner);
  res.setHeader("X-Write-Contract", `state-data.${collection}.delegated-write.v1`);
  res.setHeader("X-Compatibility-Mode", "owner-delegation");
  return policy;
}

function createOwnershipEnforcedRuntime(runtime, subdomain) {
  const contract = PLATFORM_WRITE_CONTRACTS[subdomain];
  if (!contract || typeof runtime.writeDatabase !== "function") return runtime;
  if (typeof runtime.readDatabase !== "function") {
    throw new TypeError(`ownership writer for ${subdomain} requires readDatabase`);
  }
  return Object.freeze({
    ...runtime,
    writeDatabase(data, options = {}) {
      const changed = changedCollections(runtime.readDatabase(), data);
      const undeclared = changed.filter((collection) => !contract.collections[collection]);
      if (undeclared.length) {
        const error = new Error(
          `${contract.id} attempted undeclared collection write: ${undeclared.join(", ")}`
        );
        error.code = "T02_DATA_OWNERSHIP_CONTRACT_VIOLATION";
        error.collections = undeclared;
        throw error;
      }
      for (const collection of changed) {
        const registeredOwner = ownershipManifest.collections?.[collection]?.owner;
        if (registeredOwner && registeredOwner !== contract.collections[collection]) {
          throw new Error(
            `${contract.id} declares ${collection}:${contract.collections[collection]}, expected ${registeredOwner}`
          );
        }
      }
      return runtime.writeDatabase(data, {
        ...options,
        ownershipContract: {
          id: contract.id,
          domain: "platform-governance",
          collections: changed.map((collection) => ({
            collection,
            owner: contract.collections[collection]
          }))
        }
      });
    }
  });
}

function validatePlatformWriteContracts() {
  for (const [subdomain, contract] of Object.entries(PLATFORM_WRITE_CONTRACTS)) {
    if (!contract.id.startsWith(`platform-governance.${subdomain}`)) {
      throw new TypeError(`invalid ownership contract id for ${subdomain}`);
    }
    for (const [collection, owner] of Object.entries(contract.collections)) {
      const registeredOwner = ownershipManifest.collections?.[collection]?.owner;
      if (registeredOwner && registeredOwner !== owner) {
        throw new TypeError(`${subdomain} declares ${collection}:${owner}, expected ${registeredOwner}`);
      }
    }
  }
  return true;
}

module.exports = {
  LEGACY_FULL_STATE_CONTRACT,
  PLATFORM_WRITE_CONTRACTS,
  changedCollections,
  createOwnershipEnforcedRuntime,
  ownerForCollection,
  ownershipEntries,
  setLegacyWriteHeaders,
  setOwnedWriteHeaders,
  validatePlatformWriteContracts
};
