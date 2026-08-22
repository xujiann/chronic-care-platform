"use strict";

(function exposeServiceWorkerRegistration(root) {
  function registerServiceWorkerOnLoad(runtime = root) {
    if (!("serviceWorker" in runtime.navigator) || runtime.location.protocol === "file:") return false;
    runtime.addEventListener("load", () => runtime.navigator.serviceWorker.register("./service-worker.js"));
    return true;
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { registerServiceWorkerOnLoad };
  if (root.navigator && root.location && typeof root.addEventListener === "function") registerServiceWorkerOnLoad();
})(typeof window !== "undefined" ? window : globalThis);
