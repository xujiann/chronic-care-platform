(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HealthPlatformModules = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  const modules = Object.freeze([
    Object.freeze({ id: "citizen-chronic", label: "居民与慢病", roles: Object.freeze(["commission", "institution", "citizen"]), home: "index.html" }),
    Object.freeze({ id: "care-coordination", label: "医疗协同", roles: Object.freeze(["commission", "institution", "county", "citizen"]), home: "workbench.html" }),
    Object.freeze({ id: "clinical-specialties", label: "临床专科", roles: Object.freeze(["commission", "institution", "county"]), home: "imaging-cloud.html" }),
    Object.freeze({ id: "public-health", label: "公共卫生", roles: Object.freeze(["commission"]), home: "public-health.html" }),
    Object.freeze({ id: "insurance-payment", label: "医保支付", roles: Object.freeze(["insurance"]), home: "insurance.html" }),
    Object.freeze({ id: "platform-governance", label: "平台治理", roles: Object.freeze(["commission"]), home: "platform.html" })
  ]);

  function forRole(role) {
    return modules.filter((item) => item.roles.includes(role));
  }

  return Object.freeze({ modules, forRole });
});
