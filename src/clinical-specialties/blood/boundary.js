"use strict";

const BOUNDARY_ID = "clinical-blood.v1";

const API_PREFIXES = Object.freeze(["/api/blood-system"]);

const CORE_COLLECTIONS = Object.freeze([
  "bloodAuditEvents",
  "bloodBusinessRecords",
  "bloodDomainEvents",
  "bloodEventDeliveries",
  "bloodIdempotencyRecords",
  "bloodIntegrationDeadLetters",
  "bloodIntegrationEndpoints",
  "bloodIntegrationEvents",
  "bloodModuleProjections",
  "bloodRecalls",
  "bloodReleaseReviews",
  "bloodSafetyIncidents",
  "bloodShipments",
  "bloodSpecimens",
  "bloodTestReports",
  "bloodUnits",
  "compatibilityTests",
  "donorSafetyCases",
  "emergencyBloodAllocations",
  "transfusionEpisodes",
  "transfusionReactions",
  "transfusionRequests"
]);

const OPERATIONS_COLLECTIONS = Object.freeze([
  "bloodClinicalDecisions",
  "bloodComplianceRuns",
  "bloodCutoverApprovals",
  "bloodForecastRuns",
  "bloodGoLiveAudit",
  "bloodGoLiveDrills",
  "bloodGoLiveEndpoints",
  "bloodGoLiveRequirements",
  "bloodInnovationEvents",
  "bloodMigrationBatches",
  "bloodPdaSessions",
  "bloodRecruitmentCampaigns"
]);

const OWNED_COLLECTIONS = Object.freeze([...CORE_COLLECTIONS, ...OPERATIONS_COLLECTIONS]);
const EXTERNAL_READ_COLLECTIONS = Object.freeze(["securityEvents"]);
const SHARED_PLATFORM_PORTS = Object.freeze([
  "identity-and-authorization",
  "audit-and-security-events",
  "integration-gateway",
  "transactional-outbox",
  "regional-context",
  "observability"
]);
const CROSS_DOMAIN_CONTRACTS = Object.freeze([
  "blood-emergency-coordination.v1",
  "blood-quality-signal.v1",
  "clinical-quality-observation.v1"
]);

const BLOOD_DOMAIN_BOUNDARY = Object.freeze({
  id: BOUNDARY_ID,
  owner: "T06/blood",
  sourceRoot: "src/clinical-specialties/blood",
  apiPrefixes: API_PREFIXES,
  ownedCollections: OWNED_COLLECTIONS,
  externalReadCollections: EXTERNAL_READ_COLLECTIONS,
  sharedPlatformPorts: SHARED_PLATFORM_PORTS,
  crossDomainContracts: CROSS_DOMAIN_CONTRACTS,
  deployment: Object.freeze({
    current: "shared-node-runtime",
    independentDeploymentAuthorized: false
  })
});

module.exports = {
  API_PREFIXES,
  BLOOD_DOMAIN_BOUNDARY,
  BOUNDARY_ID,
  CORE_COLLECTIONS,
  CROSS_DOMAIN_CONTRACTS,
  EXTERNAL_READ_COLLECTIONS,
  OPERATIONS_COLLECTIONS,
  OWNED_COLLECTIONS,
  SHARED_PLATFORM_PORTS
};
