"use strict";

const { createApiRouter } = require("../api-router");
const { createPlatformRuntimeContexts } = require("../runtime-contexts");
const care_coordination = require("./care-coordination");
const citizen_chronic = require("./citizen-chronic");
const clinical_specialties = require("./clinical-specialties");
const identity_security = require("./identity-security");
const insurance_payment = require("./insurance-payment");
const integration = require("./integration");
const platform_governance = require("./platform-governance");
const public_health = require("./public-health");
const research = require("./research");
const runtime_routes = require("./runtime");
const shared = require("./shared");
const state_data = require("./state-data");

const ROUTE_ORDER = Object.freeze([
  {
    "domain": "runtime",
    "id": "runtime-01"
  },
  {
    "domain": "platform-governance",
    "id": "platform-governance-01"
  },
  {
    "domain": "public-health",
    "id": "public-health-01"
  },
  {
    "domain": "shared",
    "id": "shared-01"
  },
  {
    "domain": "clinical-specialties",
    "id": "clinical-specialties-01"
  },
  {
    "domain": "runtime",
    "id": "runtime-02"
  },
  {
    "domain": "platform-governance",
    "id": "platform-governance-02"
  },
  {
    "domain": "public-health",
    "id": "public-health-02"
  },
  {
    "domain": "shared",
    "id": "shared-02"
  },
  {
    "domain": "runtime",
    "id": "runtime-03"
  },
  {
    "domain": "platform-governance",
    "id": "platform-governance-03"
  },
  {
    "domain": "clinical-specialties",
    "id": "clinical-specialties-02"
  },
  {
    "domain": "shared",
    "id": "shared-03"
  },
  {
    "domain": "platform-governance",
    "id": "platform-governance-04"
  },
  {
    "domain": "clinical-specialties",
    "id": "clinical-specialties-03"
  },
  {
    "domain": "shared",
    "id": "shared-04"
  },
  {
    "domain": "platform-governance",
    "id": "platform-governance-05"
  },
  {
    "domain": "identity-security",
    "id": "identity-security-01"
  },
  {
    "domain": "platform-governance",
    "id": "platform-governance-06"
  },
  {
    "domain": "identity-security",
    "id": "identity-security-02"
  },
  {
    "domain": "state-data",
    "id": "state-data-01"
  },
  {
    "domain": "clinical-specialties",
    "id": "clinical-specialties-04"
  },
  {
    "domain": "citizen-chronic",
    "id": "citizen-chronic-01"
  },
  {
    "domain": "shared",
    "id": "shared-05"
  },
  {
    "domain": "care-coordination",
    "id": "care-coordination-01"
  },
  {
    "domain": "shared",
    "id": "shared-06"
  },
  {
    "domain": "care-coordination",
    "id": "care-coordination-02"
  },
  {
    "domain": "shared",
    "id": "shared-07"
  },
  {
    "domain": "clinical-specialties",
    "id": "clinical-specialties-05"
  },
  {
    "domain": "shared",
    "id": "shared-08"
  },
  {
    "domain": "care-coordination",
    "id": "care-coordination-03"
  },
  {
    "domain": "citizen-chronic",
    "id": "citizen-chronic-02"
  },
  {
    "domain": "research",
    "id": "research-01"
  },
  {
    "domain": "shared",
    "id": "shared-09"
  },
  {
    "domain": "research",
    "id": "research-02"
  },
  {
    "domain": "shared",
    "id": "shared-10"
  },
  {
    "domain": "care-coordination",
    "id": "care-coordination-04"
  },
  {
    "domain": "shared",
    "id": "shared-11"
  },
  {
    "domain": "platform-governance",
    "id": "platform-governance-07"
  },
  {
    "domain": "citizen-chronic",
    "id": "citizen-chronic-03"
  },
  {
    "domain": "platform-governance",
    "id": "platform-governance-08"
  },
  {
    "domain": "integration",
    "id": "integration-01"
  },
  {
    "domain": "insurance-payment",
    "id": "insurance-payment-01"
  },
  {
    "domain": "integration",
    "id": "integration-02"
  },
  {
    "domain": "care-coordination",
    "id": "care-coordination-05"
  },
  {
    "domain": "integration",
    "id": "integration-03"
  },
  {
    "domain": "clinical-specialties",
    "id": "clinical-specialties-06"
  },
  {
    "domain": "platform-governance",
    "id": "platform-governance-09"
  },
  {
    "domain": "clinical-specialties",
    "id": "clinical-specialties-07"
  },
  {
    "domain": "platform-governance",
    "id": "platform-governance-10"
  },
  {
    "domain": "clinical-specialties",
    "id": "clinical-specialties-08"
  },
  {
    "domain": "care-coordination",
    "id": "care-coordination-06"
  },
  {
    "domain": "shared",
    "id": "shared-12"
  },
  {
    "domain": "care-coordination",
    "id": "care-coordination-07"
  },
  {
    "domain": "insurance-payment",
    "id": "insurance-payment-02"
  },
  {
    "domain": "state-data",
    "id": "state-data-02"
  },
  {
    "domain": "citizen-chronic",
    "id": "citizen-chronic-04"
  },
  {
    "domain": "runtime",
    "id": "runtime-04"
  },
  {
    "domain": "insurance-payment",
    "id": "insurance-payment-03"
  },
  {
    "domain": "citizen-chronic",
    "id": "citizen-chronic-05"
  },
  {
    "domain": "care-coordination",
    "id": "care-coordination-08"
  },
  {
    "domain": "clinical-specialties",
    "id": "clinical-specialties-09"
  },
  {
    "domain": "citizen-chronic",
    "id": "citizen-chronic-06"
  },
  {
    "domain": "insurance-payment",
    "id": "insurance-payment-04"
  },
  {
    "domain": "care-coordination",
    "id": "care-coordination-09"
  },
  {
    "domain": "public-health",
    "id": "public-health-03"
  },
  {
    "domain": "care-coordination",
    "id": "care-coordination-10"
  },
  {
    "domain": "identity-security",
    "id": "identity-security-03"
  },
  {
    "domain": "clinical-specialties",
    "id": "clinical-specialties-10"
  },
  {
    "domain": "citizen-chronic",
    "id": "citizen-chronic-07"
  },
  {
    "domain": "state-data",
    "id": "state-data-03"
  }
]);

function createPlatformApiRouter(runtime) {
  const runtimeContexts = createPlatformRuntimeContexts(runtime);
  const segmentsById = new Map();
  for (const segment of care_coordination.createRouteSegments(runtimeContexts.forDomain("care-coordination"))) {
    if (segmentsById.has(segment.id)) throw new TypeError(`duplicate route segment id: ${segment.id}`);
    segmentsById.set(segment.id, segment);
  }
  for (const segment of citizen_chronic.createRouteSegments(runtimeContexts.forDomain("citizen-chronic"))) {
    if (segmentsById.has(segment.id)) throw new TypeError(`duplicate route segment id: ${segment.id}`);
    segmentsById.set(segment.id, segment);
  }
  for (const segment of clinical_specialties.createRouteSegments(runtime)) {
    if (segmentsById.has(segment.id)) throw new TypeError(`duplicate route segment id: ${segment.id}`);
    segmentsById.set(segment.id, segment);
  }
  for (const segment of identity_security.createRouteSegments(runtime)) {
    if (segmentsById.has(segment.id)) throw new TypeError(`duplicate route segment id: ${segment.id}`);
    segmentsById.set(segment.id, segment);
  }
  for (const segment of insurance_payment.createRouteSegments(runtime)) {
    if (segmentsById.has(segment.id)) throw new TypeError(`duplicate route segment id: ${segment.id}`);
    segmentsById.set(segment.id, segment);
  }
  for (const segment of integration.createRouteSegments(runtime)) {
    if (segmentsById.has(segment.id)) throw new TypeError(`duplicate route segment id: ${segment.id}`);
    segmentsById.set(segment.id, segment);
  }
  for (const segment of platform_governance.createRouteSegments(runtime)) {
    if (segmentsById.has(segment.id)) throw new TypeError(`duplicate route segment id: ${segment.id}`);
    segmentsById.set(segment.id, segment);
  }
  for (const segment of public_health.createRouteSegments(runtime)) {
    if (segmentsById.has(segment.id)) throw new TypeError(`duplicate route segment id: ${segment.id}`);
    segmentsById.set(segment.id, segment);
  }
  for (const segment of research.createRouteSegments(runtime)) {
    if (segmentsById.has(segment.id)) throw new TypeError(`duplicate route segment id: ${segment.id}`);
    segmentsById.set(segment.id, segment);
  }
  for (const segment of runtime_routes.createRouteSegments(runtime)) {
    if (segmentsById.has(segment.id)) throw new TypeError(`duplicate route segment id: ${segment.id}`);
    segmentsById.set(segment.id, segment);
  }
  for (const segment of shared.createRouteSegments(runtime)) {
    if (segmentsById.has(segment.id)) throw new TypeError(`duplicate route segment id: ${segment.id}`);
    segmentsById.set(segment.id, segment);
  }
  for (const segment of state_data.createRouteSegments(runtime)) {
    if (segmentsById.has(segment.id)) throw new TypeError(`duplicate route segment id: ${segment.id}`);
    segmentsById.set(segment.id, segment);
  }
  const ordered = ROUTE_ORDER.map(({ id }) => {
    const segment = segmentsById.get(id);
    if (!segment) throw new TypeError(`missing route segment: ${id}`);
    return segment;
  });
  return createApiRouter(ordered);
}

module.exports = { ROUTE_ORDER, createPlatformApiRouter };
