"use strict";

const FOUNDATION_CONTRACTS = Object.freeze([
  Object.freeze({
    id: "identity-authorization",
    version: "1.0.0",
    participants: Object.freeze({
      "identity-security": Object.freeze(["currentSession", "requireApiRole", "appendSecurityEvent"]),
      "citizen-chronic": Object.freeze(["canAccessResident", "requireApiRole", "appendSecurityEvent"]),
      "care-coordination": Object.freeze(["canAccessResident", "requireApiRole", "appendSecurityEvent"]),
      "insurance-payment": Object.freeze(["requireApiRole", "appendSecurityEvent"]),
      integration: Object.freeze(["canAccessResident", "requireApiRole", "appendSecurityEvent"])
    })
  }),
  Object.freeze({
    id: "financial-external-dispatch",
    version: "1.0.0",
    participants: Object.freeze({
      "insurance-payment": Object.freeze(["dispatchFinancialRequest", "validateFinancialRequest", "writeDatabase"]),
      integration: Object.freeze(["dispatchFinancialRequest", "verifyIntegrationSignature", "writeDatabase"])
    })
  }),
  Object.freeze({
    id: "signed-appointment-event",
    version: "1.0.0",
    participants: Object.freeze({
      "care-coordination": Object.freeze(["landAppointmentIntegrationEvent", "updateIntegrationEvent", "verifyIntegrationSignature"]),
      integration: Object.freeze(["landAppointmentIntegrationEvent", "updateIntegrationEvent", "verifyIntegrationSignature"])
    })
  })
]);

function validateFoundationContracts(contexts) {
  const results = FOUNDATION_CONTRACTS.map((contract) => {
    const missing = [];
    for (const [domain, capabilities] of Object.entries(contract.participants)) {
      const context = contexts[domain];
      for (const capability of capabilities) {
        if (!context || !(capability in context)) missing.push(`${domain}.${capability}`);
      }
    }
    return Object.freeze({ id: contract.id, version: contract.version, missing: Object.freeze(missing) });
  });
  const failures = results.flatMap(({ id, missing }) => missing.map((item) => `${id}: ${item}`));
  if (failures.length > 0) throw new TypeError(`foundation contract violation: ${failures.join(", ")}`);
  return Object.freeze(results);
}

module.exports = { FOUNDATION_CONTRACTS, validateFoundationContracts };
