"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const SafeUrl = require("../browser-safe-url");

const BASE_URL = "https://health.example.gov.cn/platform/index.html";

function errorCode(callback) {
  assert.throws(callback, (error) => {
    assert.equal(error.name, "BrowserSafeUrlError");
    assert.match(error.code, /^SAFE_URL_/);
    return true;
  });
}

test("safe URL port exposes explicit capabilities and exact-origin internal navigation", () => {
  assert.equal(SafeUrl.CONTRACT_ID, "browser-safe-url-policy.v1");
  assert.deepEqual(SafeUrl.CAPABILITIES, [
    "internal-navigation",
    "official-source",
    "object-storage",
    "tel",
    "blob-download"
  ]);
  assert.deepEqual(SafeUrl.resolve("../login.html?redirect=index.html#auth", {
    capability: "internal-navigation",
    baseUrl: BASE_URL
  }), {
    contractId: "browser-safe-url-policy.v1",
    capability: "internal-navigation",
    href: "https://health.example.gov.cn/login.html?redirect=index.html#auth",
    origin: "https://health.example.gov.cn"
  });
  assert.equal(SafeUrl.resolve("../login.html?redirect=index.html", {
    capability: "internal-navigation",
    baseUrl: "file:///workspace/platform/subsite/index.html"
  }).href, "file:///workspace/platform/login.html?redirect=index.html");
});

test("safe URL port rejects executable, data, userinfo, protocol-relative and cross-origin navigation", () => {
  for (const candidate of [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "https://user:secret@health.example.gov.cn/",
    "//health.example.gov.cn/redirect",
    "https://evil.example/redirect"
  ]) {
    errorCode(() => SafeUrl.resolve(candidate, { capability: "internal-navigation", baseUrl: BASE_URL }));
  }
  for (const candidate of ["file:///etc/passwd", "/etc/passwd", "https://evil.example/redirect", "//server/share.html"])
    errorCode(() => SafeUrl.resolve(candidate, {
      capability: "internal-navigation",
      baseUrl: "file:///workspace/platform/index.html"
    }));
});

test("official sources require HTTPS and an explicit exact-origin allowlist", () => {
  const options = {
    capability: "official-source",
    baseUrl: BASE_URL,
    allowedOrigins: ["https://www.nhc.gov.cn"]
  };
  assert.equal(
    SafeUrl.resolve("https://www.nhc.gov.cn/wjw/policy.html#section", options).href,
    "https://www.nhc.gov.cn/wjw/policy.html#section"
  );
  errorCode(() => SafeUrl.resolve("https://nhc.gov.cn/wjw/policy.html", options));
  errorCode(() => SafeUrl.resolve("http://www.nhc.gov.cn/wjw/policy.html", options));
  errorCode(() => SafeUrl.resolve("https://www.nhc.gov.cn/wjw/policy.html", { capability: "official-source", baseUrl: BASE_URL }));
  errorCode(() => SafeUrl.resolve("https://www.nhc.gov.cn/wjw/policy.html", {
    ...options,
    allowedOrigins: ["https://www.nhc.gov.cn/path"]
  }));
});

test("object storage URLs reuse HTTPS, no-credentials, fragment-free exact-origin semantics", () => {
  const options = {
    capability: "object-storage",
    baseUrl: BASE_URL,
    allowedOrigins: ["https://objects.example.gov.cn"]
  };
  assert.equal(
    SafeUrl.resolve("https://objects.example.gov.cn/download/item?signature=opaque", options).origin,
    "https://objects.example.gov.cn"
  );
  for (const candidate of [
    "https://objects.example.gov.cn/download/item#fragment",
    "https://user@objects.example.gov.cn/download/item",
    "https://evil.example/download/item",
    "//objects.example.gov.cn/download/item"
  ]) errorCode(() => SafeUrl.resolve(candidate, options));
});

test("telephone and blob-download capabilities are narrow and origin bound", () => {
  assert.equal(SafeUrl.resolve("tel:120", {
    capability: "tel",
    allowedPhoneNumbers: ["120"]
  }).href, "tel:120");
  for (const candidate of ["tel:110", "tel:+86120", "tel:120;ext=1", "javascript:120"])
    errorCode(() => SafeUrl.resolve(candidate, { capability: "tel", allowedPhoneNumbers: ["120"] }));

  assert.equal(SafeUrl.resolve("blob:https://health.example.gov.cn/1234", {
    capability: "blob-download",
    baseUrl: BASE_URL
  }).origin, "https://health.example.gov.cn");
  for (const candidate of [
    "blob:https://evil.example/1234",
    "blob:https://user@health.example.gov.cn/1234",
    "data:text/plain,download"
  ]) errorCode(() => SafeUrl.resolve(candidate, { capability: "blob-download", baseUrl: BASE_URL }));
});

test("DOM assignment and navigation resolve before mutating their targets", () => {
  const attributes = new Map();
  const element = { setAttribute: (name, value) => attributes.set(name, value) };
  SafeUrl.setElementUrl(element, "href", "./citizen.html?page=health-record", {
    capability: "internal-navigation",
    baseUrl: BASE_URL
  });
  assert.equal(attributes.get("href"), "./citizen.html?page=health-record");
  errorCode(() => SafeUrl.setElementUrl(element, "src", "https://evil.example/frame", {
    capability: "internal-navigation",
    baseUrl: BASE_URL
  }));
  assert.equal(attributes.has("src"), false);

  const calls = [];
  const navigation = {
    assign: (href) => calls.push(["assign", href]),
    replace: (href) => calls.push(["replace", href])
  };
  SafeUrl.navigate("./login.html", { capability: "internal-navigation", baseUrl: BASE_URL, navigation, mode: "replace" });
  assert.deepEqual(calls, [["replace", "https://health.example.gov.cn/platform/login.html"]]);
  errorCode(() => SafeUrl.navigate("javascript:alert(1)", {
    capability: "internal-navigation",
    baseUrl: BASE_URL,
    navigation,
    mode: "assign"
  }));
  assert.equal(calls.length, 1);
});

test("batch DOM bindings fail individual hostile URLs closed without bypassing the shared policy", () => {
  function element() {
    const attributes = new Map();
    return {
      attributes,
      removeAttribute: (name) => attributes.delete(name),
      setAttribute: (name, value) => attributes.set(name, value)
    };
  }
  const allowed = element();
  const hostile = element();
  hostile.attributes.set("href", "./stale.html");
  const outcomes = SafeUrl.setElementUrlBindings([
    {
      element: allowed,
      input: "./citizen.html?page=health-record",
      options: { capability: "internal-navigation", baseUrl: BASE_URL }
    },
    {
      element: hostile,
      input: "javascript:alert(1)",
      options: { capability: "internal-navigation", baseUrl: BASE_URL }
    }
  ]);
  assert.equal(outcomes[0].ok, true);
  assert.equal(allowed.attributes.get("href"), "./citizen.html?page=health-record");
  assert.deepEqual(outcomes[1], { ok: false, errorCode: "SAFE_URL_PROTOCOL_DENIED" });
  assert.equal(hostile.attributes.has("href"), false);
  errorCode(() => SafeUrl.setElementUrlBindings({}));
});

test("browser global location supplies the default base and navigation target", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "location");
  const calls = [];
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: {
      href: BASE_URL,
      assign: (href) => calls.push(["assign", href]),
      replace: (href) => calls.push(["replace", href])
    }
  });
  try {
    assert.equal(SafeUrl.resolve("./citizen.html", { capability: "internal-navigation" }).href,
      "https://health.example.gov.cn/platform/citizen.html");
    SafeUrl.navigate("./login.html", { capability: "internal-navigation", mode: "assign" });
    SafeUrl.navigate("./index.html", { capability: "internal-navigation", mode: "replace" });
    assert.deepEqual(calls, [
      ["assign", "https://health.example.gov.cn/platform/login.html"],
      ["replace", "https://health.example.gov.cn/platform/index.html"]
    ]);
  } finally {
    if (original) Object.defineProperty(globalThis, "location", original);
    else delete globalThis.location;
  }
});
