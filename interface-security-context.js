const issuedCrossInstitutionAuthorizations = new WeakSet();

function safeActor(value) {
  return String(value || "").trim().replace(/[\r\n]/g, " ").slice(0, 160);
}

function issueCrossInstitutionAuthorization(authorizedBy, options = {}) {
  const actor = safeActor(authorizedBy);
  if (!actor) {
    const error = new Error("cross-institution authorization requires an accountable server-side actor");
    error.code = "CROSS_INSTITUTION_AUTHORIZATION_ACTOR_REQUIRED";
    error.statusCode = 500;
    throw error;
  }
  const authorization = Object.freeze({
    type: "cross-institution-interface",
    authorizedBy: actor,
    reason: safeActor(options.reason || "server-side integration routing"),
    issuedAt: String(options.issuedAt || new Date().toISOString())
  });
  issuedCrossInstitutionAuthorizations.add(authorization);
  return authorization;
}

function isIssuedCrossInstitutionAuthorization(value) {
  return Boolean(value && typeof value === "object" && issuedCrossInstitutionAuthorizations.has(value));
}

module.exports = {
  isIssuedCrossInstitutionAuthorization,
  issueCrossInstitutionAuthorization
};
