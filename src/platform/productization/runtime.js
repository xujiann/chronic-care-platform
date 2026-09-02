"use strict";

const { buildDataPromotionCenter } = require("./data-promotion-center");
const {
  applyPlatformWorkItemAction,
  buildPlatformWorkItemCenter
} = require("./work-item-center");
const {
  buildInstitutionIntegrationCenter,
  registerInstitutionIntegrationProfile,
  runInstitutionSyntheticJointTest
} = require("./institution-integration-center");
const {
  buildPlatformProductOperationsCockpit
} = require("./product-operations-runtime");
const {
  applyPlatformWorkItemV2GovernanceAction,
  buildPlatformEnhancementCockpit
} = require("./enhancement-runtime");
const { buildRegionalRequirementCatalog } = require("./regional-requirement-catalog");
const {
  applyProcurementRequirementReviewAction,
  buildProcurementRequirementGovernance
} = require("./procurement-requirement-governance");
const { applyProcurementImportRegistration } = require("./procurement-requirement-catalog-registry");
const {
  applyProcurementRequirementDeliveryAction,
  buildProcurementRequirementDelivery
} = require("./procurement-requirement-delivery");

function buildPlatformProductizationCenter(data, options = {}) {
  const dataPromotion = buildDataPromotionCenter(data, options);
  const workItems = buildPlatformWorkItemCenter(data, options);
  const institutionIntegration = buildInstitutionIntegrationCenter(data, options);
  const regionalRequirements = buildRegionalRequirementCatalog({
    catalog: options.regionalRequirementCatalog,
    bundleCatalog: options.regionalCapabilityBundles,
    capabilityRegistry: options.platformCapabilityRegistry,
    now: options.now
  });
  const requirementGovernance = buildProcurementRequirementGovernance(data, {
    catalog: options.procurementRequirementCatalog,
    registry: options.platformCapabilityRegistry,
    now: options.now
  });
  const requirementDelivery = buildProcurementRequirementDelivery(data, {
    catalog: options.procurementRequirementCatalog,
    registry: options.platformCapabilityRegistry,
    now: options.now
  });
  return Object.freeze({
    schemaVersion: "platform-productization-center-v1",
    generatedAt: options.now || new Date().toISOString(),
    ok: dataPromotion.ok && workItems.ok && institutionIntegration.ok && regionalRequirements.ok && requirementGovernance.ok && requirementDelivery.ok,
    productionReady: false,
    dataPromotion,
    workItems,
    institutionIntegration,
    regionalRequirements,
    requirementGovernance,
    requirementDelivery,
    boundary: "Productization capabilities improve local operability but do not replace site evidence or production approval."
  });
}

module.exports = {
  applyProcurementImportRegistration,
  applyProcurementRequirementDeliveryAction,
  applyProcurementRequirementReviewAction,
  applyPlatformWorkItemV2GovernanceAction,
  applyPlatformWorkItemAction,
  buildDataPromotionCenter,
  buildInstitutionIntegrationCenter,
  buildPlatformProductOperationsCockpit,
  buildPlatformEnhancementCockpit,
  buildPlatformProductizationCenter,
  buildProcurementRequirementGovernance,
  buildProcurementRequirementDelivery,
  buildRegionalRequirementCatalog,
  buildPlatformWorkItemCenter,
  registerInstitutionIntegrationProfile,
  runInstitutionSyntheticJointTest
};
