"use strict";

const { BLOOD_DOMAIN_BOUNDARY } = require("./boundary");
const { CONTRACTS } = require("./cross-domain-contracts");
const {
  createBloodCoreHttpHandler,
  createBloodOperationsHttpHandler
} = require("./http-handler");

const services = Object.freeze({
  business: require("./business-service"),
  clinicalProduction: require("./clinical-production"),
  eventHub: require("./event-hub"),
  goLive: require("./go-live-service"),
  innovation: require("./innovation-service"),
  integration: require("./integration-gateway"),
  masterData: require("./master-data"),
  transaction: require("./transaction-service"),
  transfusion: require("./service")
});

module.exports = Object.freeze({
  boundary: BLOOD_DOMAIN_BOUNDARY,
  contracts: CONTRACTS,
  http: Object.freeze({
    createCoreHandler: createBloodCoreHttpHandler,
    createOperationsHandler: createBloodOperationsHttpHandler
  }),
  services
});
