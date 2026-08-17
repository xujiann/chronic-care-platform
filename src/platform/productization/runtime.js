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

function buildPlatformProductizationCenter(data, options = {}) {
  const dataPromotion = buildDataPromotionCenter(data, options);
  const workItems = buildPlatformWorkItemCenter(data, options);
  const institutionIntegration = buildInstitutionIntegrationCenter(data, options);
  return Object.freeze({
    schemaVersion: "platform-productization-center-v1",
    generatedAt: options.now || new Date().toISOString(),
    ok: dataPromotion.ok && workItems.ok && institutionIntegration.ok,
    productionReady: false,
    dataPromotion,
    workItems,
    institutionIntegration,
    boundary: "Productization capabilities improve local operability but do not replace site evidence or production approval."
  });
}

module.exports = {
  applyPlatformWorkItemAction,
  buildDataPromotionCenter,
  buildInstitutionIntegrationCenter,
  buildPlatformProductOperationsCockpit,
  buildPlatformProductizationCenter,
  buildPlatformWorkItemCenter,
  registerInstitutionIntegrationProfile,
  runInstitutionSyntheticJointTest
};
