(function (root, factory) {
  const policy = typeof module === "object" && module.exports
    ? require("./access-control-policy")
    : root.HealthAccessPolicy;
  const api = factory(policy);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HealthPlatformModules = api;
})(typeof globalThis === "object" ? globalThis : this, function (policy) {
  "use strict";

  const modules = Object.freeze([
    Object.freeze({ id: "citizen-chronic", label: "居民与慢病", pages: Object.freeze(["index.html", "institution.html", "doctor.html", "citizen.html"]) }),
    Object.freeze({ id: "care-coordination", label: "医疗协同", pages: Object.freeze(["workbench.html", "internet-nursing.html", "escort.html", "county.html"]) }),
    Object.freeze({ id: "clinical-specialties", label: "临床专科", pages: Object.freeze(["imaging-cloud.html", "emergency.html", "physical-examination.html", "blood.html"]) }),
    Object.freeze({ id: "public-health", label: "公共卫生", pages: Object.freeze(["public-health.html", "immunization.html"]) }),
    Object.freeze({ id: "insurance-payment", label: "医保支付", pages: Object.freeze(["insurance.html", "disease-payment.html"]) }),
    Object.freeze({ id: "platform-governance", label: "平台治理", pages: Object.freeze(["platform.html", "operations.html", "quality-safety.html"]) })
  ]);

  function forUser(user, context = {}) {
    if (!policy || !user) return [];
    return modules
      .filter((item) => item.pages.some((page) => policy.canAccessPage(page, user, context)))
      .map((item) => Object.freeze({
        ...item,
        home: item.pages.find((page) => policy.canAccessPage(page, user, context))
      }));
  }

  function forRole(role) {
    const defaults = {
      commission: { accountType: "manager", orgType: "health_admin" },
      institution: { accountType: "manager", orgType: "medical_institution" },
      insurance: { accountType: "manager", orgType: "insurance_bureau" },
      citizen: { accountType: "resident", orgType: "citizen" },
      county: { accountType: "manager", orgType: "county_consortium" }
    };
    return defaults[role] ? forUser({ role, ...defaults[role] }) : [];
  }

  return Object.freeze({ modules, forRole, forUser });
});
