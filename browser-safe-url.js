(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HealthBrowserSafeUrl = api;
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  "use strict";

  const CONTRACT_ID = "browser-safe-url-policy.v1";
  const CAPABILITIES = Object.freeze([
    "internal-navigation",
    "official-source",
    "object-storage",
    "tel",
    "blob-download"
  ]);

  function policyError(code, message) {
    const error = new Error(message);
    error.name = "BrowserSafeUrlError";
    error.code = code;
    return error;
  }

  function baseUrl(options = {}) {
    const candidate = String(options.baseUrl || root?.location?.href || "").trim();
    if (!candidate) throw policyError("SAFE_URL_BASE_REQUIRED", "safe URL base is required");
    try {
      return new URL(candidate);
    } catch {
      throw policyError("SAFE_URL_BASE_INVALID", "safe URL base is invalid");
    }
  }

  function isLoopback(hostname) {
    return ["localhost", "127.0.0.1", "::1"].includes(String(hostname || "").toLowerCase());
  }

  function exactOrigins(entries, options = {}) {
    if (!Array.isArray(entries) || !entries.length) {
      throw policyError("SAFE_URL_ALLOWED_ORIGINS_REQUIRED", "safe URL exact-origin allowlist is required");
    }
    const origins = new Set();
    entries.forEach((entry) => {
      const raw = String(entry || "").trim();
      if (!raw || raw.startsWith("//") || raw.includes("*")) {
        throw policyError("SAFE_URL_ALLOWED_ORIGIN_INVALID", "safe URL allowed origin is invalid");
      }
      let parsed;
      try {
        parsed = new URL(raw);
      } catch {
        throw policyError("SAFE_URL_ALLOWED_ORIGIN_INVALID", "safe URL allowed origin is invalid");
      }
      const localHttp = options.allowHttpLocalhost === true && parsed.protocol === "http:" && isLoopback(parsed.hostname);
      if (parsed.protocol !== "https:" && !localHttp) {
        throw policyError("SAFE_URL_ALLOWED_ORIGIN_PROTOCOL_DENIED", "safe URL allowed origin protocol is denied");
      }
      if (parsed.username || parsed.password || (parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
        throw policyError("SAFE_URL_ALLOWED_ORIGIN_INVALID", "safe URL allowed origin must not contain credentials, path, query or fragment");
      }
      origins.add(parsed.origin);
    });
    return origins;
  }

  function parseHttpUrl(input, options = {}) {
    const raw = String(input || "").trim();
    if (!raw) throw policyError("SAFE_URL_REQUIRED", "safe URL is required");
    if (raw.startsWith("//")) {
      throw policyError("SAFE_URL_PROTOCOL_RELATIVE_DENIED", "protocol-relative safe URL is denied");
    }
    let parsed;
    try {
      parsed = new URL(raw, baseUrl(options));
    } catch {
      throw policyError("SAFE_URL_INVALID", "safe URL is invalid");
    }
    const localHttp = options.allowHttpLocalhost === true && parsed.protocol === "http:" && isLoopback(parsed.hostname);
    if (parsed.protocol !== "https:" && !localHttp) {
      throw policyError("SAFE_URL_PROTOCOL_DENIED", "safe URL protocol is denied");
    }
    if (parsed.username || parsed.password) {
      throw policyError("SAFE_URL_CREDENTIALS_DENIED", "safe URL credentials are denied");
    }
    return parsed;
  }

  function resolveInternal(input, options) {
    const base = baseUrl(options);
    const raw = String(input || "").trim();
    if (!raw) throw policyError("SAFE_URL_REQUIRED", "safe URL is required");
    if (raw.startsWith("//") || raw.startsWith("\\\\")) {
      throw policyError("SAFE_URL_PROTOCOL_RELATIVE_DENIED", "protocol-relative safe URL is denied");
    }
    if (base.protocol === "file:") {
      if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw) || raw.startsWith("/") || raw.startsWith("\\")) {
        throw policyError("SAFE_URL_PROTOCOL_DENIED", "safe URL protocol is denied");
      }
      const local = new URL(raw, base);
      if (local.protocol !== "file:" || !/\.html$/i.test(local.pathname)) {
        throw policyError("SAFE_URL_PROTOCOL_DENIED", "safe URL protocol is denied");
      }
      return local;
    }
    if (!["http:", "https:"].includes(base.protocol)) {
      throw policyError("SAFE_URL_BASE_INVALID", "safe URL base protocol is invalid");
    }
    let parsed;
    try {
      parsed = new URL(raw, base);
    } catch {
      throw policyError("SAFE_URL_INVALID", "safe URL is invalid");
    }
    if (parsed.username || parsed.password) {
      throw policyError("SAFE_URL_CREDENTIALS_DENIED", "safe URL credentials are denied");
    }
    if (parsed.protocol !== base.protocol) {
      throw policyError("SAFE_URL_PROTOCOL_DENIED", "safe URL protocol is denied");
    }
    if (parsed.origin !== base.origin) {
      throw policyError("SAFE_URL_ORIGIN_DENIED", "safe URL origin is denied");
    }
    return parsed;
  }

  function resolveExactOrigin(input, options, capability) {
    const allowHttpLocalhost = options.allowHttpLocalhost === true;
    const parsed = parseHttpUrl(input, { ...options, allowHttpLocalhost });
    const origins = exactOrigins(options.allowedOrigins, { allowHttpLocalhost });
    if (!origins.has(parsed.origin)) {
      throw policyError("SAFE_URL_ORIGIN_DENIED", "safe URL origin is denied");
    }
    if (capability === "object-storage" && parsed.hash) {
      throw policyError("SAFE_URL_FRAGMENT_DENIED", "object storage URL fragment is denied");
    }
    return parsed;
  }

  function resolveTelephone(input, options = {}) {
    const raw = String(input || "").trim();
    const match = /^tel:([0-9]{3,20})$/.exec(raw);
    if (!match) throw policyError("SAFE_URL_TEL_INVALID", "telephone URL is invalid");
    const allowedNumbers = new Set((options.allowedPhoneNumbers || []).map((value) => String(value)));
    if (!allowedNumbers.size || !allowedNumbers.has(match[1])) {
      throw policyError("SAFE_URL_TEL_DENIED", "telephone URL is not approved");
    }
    return { href: raw, origin: "null" };
  }

  function resolveBlob(input, options = {}) {
    const raw = String(input || "").trim();
    if (!raw || raw.startsWith("//")) throw policyError("SAFE_URL_BLOB_INVALID", "blob download URL is invalid");
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      throw policyError("SAFE_URL_BLOB_INVALID", "blob download URL is invalid");
    }
    if (parsed.protocol !== "blob:") throw policyError("SAFE_URL_PROTOCOL_DENIED", "safe URL protocol is denied");
    const base = baseUrl(options);
    if (parsed.origin !== base.origin) throw policyError("SAFE_URL_ORIGIN_DENIED", "safe URL origin is denied");
    const embedded = raw.slice("blob:".length);
    if (base.origin !== "null") {
      let embeddedUrl;
      try {
        embeddedUrl = new URL(embedded);
      } catch {
        throw policyError("SAFE_URL_BLOB_INVALID", "blob download URL is invalid");
      }
      if (embeddedUrl.username || embeddedUrl.password) {
        throw policyError("SAFE_URL_CREDENTIALS_DENIED", "safe URL credentials are denied");
      }
    }
    return parsed;
  }

  function resolve(input, options = {}) {
    const capability = String(options.capability || "");
    if (!CAPABILITIES.includes(capability)) {
      throw policyError("SAFE_URL_CAPABILITY_DENIED", "safe URL capability is denied");
    }
    let parsed;
    if (capability === "internal-navigation") parsed = resolveInternal(input, options);
    else if (capability === "official-source" || capability === "object-storage") parsed = resolveExactOrigin(input, options, capability);
    else if (capability === "tel") parsed = resolveTelephone(input, options);
    else parsed = resolveBlob(input, options);
    return Object.freeze({ contractId: CONTRACT_ID, capability, href: parsed.href, origin: parsed.origin });
  }

  function setElementUrl(element, attribute, input, options = {}) {
    if (!element || !["href", "src"].includes(attribute)) {
      throw policyError("SAFE_URL_ELEMENT_TARGET_INVALID", "safe URL element target is invalid");
    }
    const decision = resolve(input, options);
    const assigned = decision.capability === "internal-navigation" ? String(input).trim() : decision.href;
    if (attribute === "href") element.setAttribute("href", assigned);
    else element.setAttribute("src", assigned);
    return decision;
  }

  function setElementUrlBindings(bindings = []) {
    if (!Array.isArray(bindings)) {
      throw policyError("SAFE_URL_BINDINGS_INVALID", "safe URL bindings must be an array");
    }
    return bindings.map((binding) => {
      const element = binding?.element;
      const attribute = binding?.attribute || "href";
      try {
        return Object.freeze({
          ok: true,
          decision: setElementUrl(element, attribute, binding?.input, binding?.options || {})
        });
      } catch (error) {
        if (error?.name !== "BrowserSafeUrlError") throw error;
        if (typeof element?.removeAttribute === "function" && ["href", "src"].includes(attribute)) element.removeAttribute(attribute);
        return Object.freeze({ ok: false, errorCode: error.code });
      }
    });
  }

  function navigate(input, options = {}) {
    const decision = resolve(input, options);
    const target = options.navigation || root?.location;
    if (!target) throw policyError("SAFE_URL_NAVIGATION_UNAVAILABLE", "safe URL navigation target is unavailable");
    if (options.navigation && options.mode === "replace") target.replace(decision.href);
    else if (options.navigation && options.mode === "assign") target.assign(decision.href);
    else if (options.mode === "replace") root.location.replace(decision.href);
    else if (options.mode === "assign") root.location.assign(decision.href);
    else throw policyError("SAFE_URL_NAVIGATION_MODE_DENIED", "safe URL navigation mode is denied");
    return decision;
  }

  return Object.freeze({
    CAPABILITIES,
    CONTRACT_ID,
    exactOrigins,
    navigate,
    resolve,
    setElementUrl,
    setElementUrlBindings
  });
});
