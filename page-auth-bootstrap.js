"use strict";

(function exposePageAuthBootstrap(root) {
  function parseList(value) {
    return String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function runPageAuthBootstrap(script = root.document?.currentScript, auth = root.HealthCityAuth) {
    if (!script?.dataset) throw new TypeError("page auth bootstrap requires the current script dataset");
    const roles = parseList(script.dataset.roles);
    const accountTypes = parseList(script.dataset.accountTypes);
    const action = String(script.dataset.authAction || "").trim();
    let allowed = true;

    if (roles.length) {
      if (!auth || typeof auth.requireRole !== "function") throw new TypeError("page role guard is unavailable");
      allowed = auth.requireRole(roles);
    }
    if (allowed && accountTypes.length) {
      if (!auth || typeof auth.requireAccountType !== "function") throw new TypeError("page account guard is unavailable");
      allowed = auth.requireAccountType(accountTypes);
    }
    if (action === "init-auth-bar") auth?.initAuthBar?.();
    if (action === "render-session-bar") {
      if (!auth || typeof auth.renderSessionBar !== "function") throw new TypeError("session bar renderer is unavailable");
      auth.renderSessionBar();
    }
    if (action && !["init-auth-bar", "render-session-bar"].includes(action)) {
      throw new TypeError("unsupported page auth bootstrap action");
    }
    return allowed;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { parseList, runPageAuthBootstrap };
  }
  if (root.document?.currentScript) runPageAuthBootstrap();
})(typeof window !== "undefined" ? window : globalThis);
