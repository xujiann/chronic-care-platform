(function (root) {
  "use strict";

  function currentRole() {
    try {
      return root.HealthCityAuth?.currentUser?.()?.role
        || JSON.parse(root.localStorage?.getItem("health-city-auth-session") || "{}").role
        || "";
    } catch (error) {
      return "";
    }
  }

  function boot() {
    root.HealthPlatformDesign?.install?.();
    const role = currentRole();
    const modules = root.HealthPlatformModules?.forRole?.(role) || [];
    root.HealthPlatform = Object.freeze({
      api: root.HealthPlatformApi?.createClient?.(),
      role,
      modules,
      version: "1.0.0"
    });
    root.document?.documentElement?.setAttribute("data-platform-shell", "ready");
    root.document?.dispatchEvent?.(new root.CustomEvent("health-platform:ready", {
      detail: { role, moduleIds: modules.map((item) => item.id) }
    }));
  }

  if (root.document?.readyState === "loading") root.document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})(typeof globalThis === "object" ? globalThis : this);
