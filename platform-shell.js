(function (root) {
  "use strict";

  function currentUser() {
    try {
      return root.HealthCityAuth?.getUser?.()
        || JSON.parse(root.localStorage?.getItem("health-city-auth-session") || "{}")
        || null;
    } catch (error) {
      return "";
    }
  }

  function boot() {
    root.HealthPlatformDesign?.install?.();
    const user = currentUser();
    const role = user?.role || "";
    const modules = root.HealthPlatformModules?.forUser?.(user) || [];
    const menu = root.HealthAccessPolicy?.pagesForUser?.(user) || [];
    root.HealthPlatform = Object.freeze({
      api: root.HealthPlatformApi?.createClient?.(),
      role,
      accountType: root.HealthAccessPolicy?.normalizeAccountType?.(user) || "",
      modules,
      menu,
      version: "2.0.0"
    });
    root.document?.documentElement?.setAttribute("data-platform-shell", "ready");
    root.document?.dispatchEvent?.(new root.CustomEvent("health-platform:ready", {
      detail: { role, moduleIds: modules.map((item) => item.id), menuPages: menu.map((item) => item.page) }
    }));
  }

  if (root.document?.readyState === "loading") root.document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})(typeof globalThis === "object" ? globalThis : this);
