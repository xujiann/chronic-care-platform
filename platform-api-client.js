(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HealthPlatformApi = api;
})(typeof globalThis === "object" ? globalThis : this, function (root) {
  "use strict";

  class PlatformApiError extends Error {
    constructor({ status, code, message, correlationId, details }) {
      super(message || `HTTP ${status}`);
      this.name = "PlatformApiError";
      this.status = status;
      this.code = code || "HTTP_ERROR";
      this.correlationId = correlationId || "";
      this.details = details;
    }
  }

  function newCorrelationId() {
    if (root.crypto?.randomUUID) return root.crypto.randomUUID();
    return `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function createClient({ baseUrl = "/api", fetchImpl } = {}) {
    const requestImpl = fetchImpl
      || root.HealthCityAuth?.authFetch
      || root.fetch?.bind(root);
    if (typeof requestImpl !== "function") throw new TypeError("API client requires fetch");

    async function request(path, options = {}) {
      const method = String(options.method || "GET").toUpperCase();
      const correlationId = options.correlationId || newCorrelationId();
      const isFormData = typeof root.FormData === "function" && options.body instanceof root.FormData;
      const headers = {
        Accept: "application/json",
        "X-Correlation-Id": correlationId,
        ...options.headers
      };
      if (options.body !== undefined && !isFormData) {
        headers["Content-Type"] = headers["Content-Type"] || "application/json";
      }
      if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
        headers["Idempotency-Key"] = headers["Idempotency-Key"] || newCorrelationId();
      }
      const response = await requestImpl(`${baseUrl}${path}`, {
        method,
        headers,
        credentials: "same-origin",
        signal: options.signal,
        body: options.body === undefined || isFormData
          ? options.body
          : JSON.stringify(options.body)
      });
      const responseCorrelationId = response.headers?.get?.("x-correlation-id") || correlationId;
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new PlatformApiError({
          status: response.status,
          code: payload.code,
          message: payload.message || payload.error,
          correlationId: responseCorrelationId,
          details: payload
        });
      }
      return Object.freeze({ data: payload, correlationId: responseCorrelationId, status: response.status });
    }

    return Object.freeze({
      request,
      get: (path, options) => request(path, { ...options, method: "GET" }),
      post: (path, body, options) => request(path, { ...options, method: "POST", body }),
      put: (path, body, options) => request(path, { ...options, method: "PUT", body }),
      delete: (path, options) => request(path, { ...options, method: "DELETE" })
    });
  }

  return Object.freeze({ PlatformApiError, createClient, newCorrelationId });
});
