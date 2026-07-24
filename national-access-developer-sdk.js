(function (global, factory) {
  const sdk = factory(global);
  if (typeof module === "object" && module.exports) module.exports = sdk;
  if (global) global.NationalHealthAccessSdk = sdk;
})(typeof globalThis !== "undefined" ? globalThis : this, function (global) {
  "use strict";

  class NationalHealthAccessError extends Error {
    constructor(message, options = {}) {
      super(message);
      this.name = "NationalHealthAccessError";
      this.status = Number(options.status || 0);
      this.code = options.code || "NATIONAL_ACCESS_CLIENT_ERROR";
      this.details = options.details || null;
    }
  }

  class NationalHealthAccessClient {
    constructor(options = {}) {
      this.baseUrl = String(options.baseUrl || "").replace(/\/+$/, "");
      this.apiKey = String(options.apiKey || "");
      this.fetchImpl = options.fetchImpl || global.fetch;
      if (typeof this.fetchImpl !== "function") {
        throw new NationalHealthAccessError("A fetch implementation is required");
      }
    }

    setApiKey(apiKey) {
      this.apiKey = String(apiKey || "");
      return this;
    }

    async invoke(request = {}) {
      if (!this.apiKey) {
        throw new NationalHealthAccessError("Developer API key is required", {
          code: "NATIONAL_ACCESS_CLIENT_KEY_REQUIRED"
        });
      }
      const body = {
        packageId: request.packageId,
        contractId: request.contractId,
        idempotencyKey: request.idempotencyKey,
        payloadDigest: request.payloadDigest,
        ...(request.requestId ? { requestId: request.requestId } : {})
      };
      const response = await this.fetchImpl(`${this.baseUrl}/api/national-access/sandbox/invoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-National-Access-Key": this.apiKey
        },
        body: JSON.stringify(body)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new NationalHealthAccessError(
          payload.message || payload.error || `Request failed with status ${response.status}`,
          {
            status: response.status,
            code: payload.error,
            details: payload
          }
        );
      }
      return payload;
    }

    createIdempotencyKey(prefix = "request") {
      const safePrefix = String(prefix || "request").replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 40);
      const randomPart = global.crypto?.randomUUID
        ? global.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      return `${safePrefix}-${randomPart}`;
    }

    async sha256(value) {
      if (!global.crypto?.subtle || typeof TextEncoder === "undefined") {
        throw new NationalHealthAccessError("Web Crypto SHA-256 is unavailable", {
          code: "NATIONAL_ACCESS_CLIENT_CRYPTO_UNAVAILABLE"
        });
      }
      const bytes = new TextEncoder().encode(String(value ?? ""));
      const digest = await global.crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
    }
  }

  return {
    NationalHealthAccessClient,
    NationalHealthAccessError,
    version: "1.0.0"
  };
});
