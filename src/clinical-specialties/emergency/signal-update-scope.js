"use strict";

function normalizedScopeValue(value) {
  return String(value || "").trim().toLocaleLowerCase("zh-CN")
    .replace(/[\s·・,，。()（）_-]+/g, "");
}

function scopeValuesMatch(left, right) {
  const a = normalizedScopeValue(left);
  const b = normalizedScopeValue(right);
  return Boolean(
    a && b && (a === b || (a.length >= 3 && b.includes(a)) || (b.length >= 3 && a.includes(b)))
  );
}

function emergencySignalOrganizationValues(signal) {
  return [
    signal?.orgCode,
    signal?.organizationId,
    signal?.institutionCode,
    signal?.sourceInstitutionCode,
    signal?.sourceOrgCode,
    signal?.sourceInstitution,
    signal?.targetInstitutionCode,
    signal?.targetOrgCode,
    signal?.targetInstitution,
    signal?.createdByOrgCode
  ].filter(Boolean);
}

function emergencySignalScopeProjection(state, signal) {
  const creator = (Array.isArray(state?.authUsers) ? state.authUsers : [])
    .find((item) => String(item?.username || "") === String(signal?.createdBy || ""));
  return creator?.orgCode
    ? { ...signal, createdByOrgCode: creator.orgCode }
    : signal;
}

function organizationMatchesValue(organization, value) {
  const code = String(organization?.orgCode || "").trim().toLocaleLowerCase("zh-CN");
  const candidate = String(value || "").trim().toLocaleLowerCase("zh-CN");
  return Boolean((code && code === candidate) || scopeValuesMatch(organization?.name, value));
}

function countyScope(state, user) {
  const organizations = Array.isArray(state?.authOrganizations) ? state.authOrganizations : [];
  const actorOrganization = organizations.find((item) =>
    [user?.orgCode, user?.orgName].some((value) => organizationMatchesValue(item, value)));
  const parentOrganization = actorOrganization?.parentCode
    ? organizations.find((item) => item?.orgCode === actorOrganization.parentCode)
    : null;
  const countyRoot = actorOrganization?.orgType === "district"
    ? actorOrganization
    : parentOrganization?.orgType === "district"
      ? parentOrganization
      : null;
  return {
    organizationCodes: new Set([
      user?.orgCode,
      actorOrganization?.orgCode,
      countyRoot?.orgCode
    ].map((value) => String(value || "").trim().toLocaleLowerCase("zh-CN")).filter(Boolean)),
    regionCodes: new Set([
      user?.regionCode
    ].map((value) => String(value || "").trim().toLocaleLowerCase("zh-CN")).filter(Boolean)),
    textValues: [
      user?.region,
      user?.orgName,
      user?.dataScope,
      actorOrganization?.name,
      actorOrganization?.dataScope,
      countyRoot?.name,
      countyRoot?.dataScope
    ].filter(Boolean)
  };
}

function organizationWithinCountyScope(state, organization, allowedScope) {
  const organizations = Array.isArray(state?.authOrganizations) ? state.authOrganizations : [];
  const parent = organization?.parentCode
    ? organizations.find((item) => item?.orgCode === organization.parentCode)
    : null;
  const organizationCodes = [organization?.orgCode, organization?.parentCode]
    .map((value) => String(value || "").trim().toLocaleLowerCase("zh-CN"))
    .filter(Boolean);
  if (organizationCodes.some((code) => allowedScope.organizationCodes.has(code))) return true;
  const resourceTextValues = [
    organization?.name,
    organization?.dataScope,
    parent?.name,
    parent?.dataScope
  ].filter(Boolean);
  return allowedScope.textValues.some((allowed) =>
    resourceTextValues.some((resource) => scopeValuesMatch(allowed, resource)));
}

function authorizeEmergencySignalUpdate({ state, signal, user, rowMatchesOrganizationScope }) {
  if (!signal) return Object.freeze({ allowed: false, code: "EMERGENCY_SIGNAL_NOT_FOUND", statusCode: 404 });
  if (user?.role === "commission") return Object.freeze({ allowed: true, code: "ALLOWED", statusCode: 200 });
  const scopedSignal = emergencySignalScopeProjection(state, signal);
  if (user?.role === "institution") {
    const allowed = typeof rowMatchesOrganizationScope === "function"
      && rowMatchesOrganizationScope(state, user, scopedSignal) === true;
    return Object.freeze({
      allowed,
      code: allowed ? "ALLOWED" : "EMERGENCY_SIGNAL_SCOPE_DENIED",
      statusCode: allowed ? 200 : 403
    });
  }
  if (user?.role === "county") {
    const allowedScope = countyScope(state, user);
    const organizations = Array.isArray(state?.authOrganizations) ? state.authOrganizations : [];
    const referencedOrganizations = emergencySignalOrganizationValues(scopedSignal)
      .map((value) => organizations.find((item) => organizationMatchesValue(item, value)))
      .filter(Boolean);
    const explicitOrganizationsAllowed = referencedOrganizations.length > 0
      ? referencedOrganizations.every((item) => organizationWithinCountyScope(state, item, allowedScope))
      : null;
    const regionValues = [scopedSignal?.regionCode, scopedSignal?.region, scopedSignal?.district].filter(Boolean);
    const regionAllowed = regionValues.length > 0 && regionValues.some((resource) => {
      const exact = String(resource || "").trim().toLocaleLowerCase("zh-CN");
      return allowedScope.regionCodes.has(exact)
        || allowedScope.organizationCodes.has(exact)
        || allowedScope.textValues.some((allowed) => scopeValuesMatch(allowed, resource));
    });
    const allowed = explicitOrganizationsAllowed === null ? regionAllowed : explicitOrganizationsAllowed;
    return Object.freeze({
      allowed,
      code: allowed ? "ALLOWED" : "EMERGENCY_SIGNAL_SCOPE_DENIED",
      statusCode: allowed ? 200 : 403
    });
  }
  return Object.freeze({ allowed: false, code: "EMERGENCY_SIGNAL_SCOPE_DENIED", statusCode: 403 });
}

module.exports = { authorizeEmergencySignalUpdate };
