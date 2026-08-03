"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createClient, PlatformApiError } = require("../platform-api-client");
const { forRole } = require("../platform-domain-modules");
const design = require("../platform-design-system");

test("frontend domain manifest exposes only role-owned modules", () => {
  assert.deepEqual(forRole("insurance").map((item) => item.id), ["insurance-payment"]);
  assert.ok(forRole("commission").some((item) => item.id === "public-health"));
  assert.ok(!forRole("citizen").some((item) => item.id === "platform-governance"));
});

test("unified API client propagates correlation and idempotency headers", async () => {
  let request;
  const client = createClient({
    baseUrl: "/api",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        headers: { get: () => "server-correlation-1" },
        json: async () => ({ ok: true })
      };
    }
  });
  const result = await client.post("/followups", { residentId: "r1" }, { correlationId: "client-correlation-1" });
  assert.equal(request.url, "/api/followups");
  assert.equal(request.options.headers["X-Correlation-Id"], "client-correlation-1");
  assert.ok(request.options.headers["Idempotency-Key"]);
  assert.equal(result.correlationId, "server-correlation-1");
});

test("unified API errors retain stable code and correlation id", async () => {
  const client = createClient({
    fetchImpl: async () => ({
      ok: false,
      status: 409,
      headers: { get: () => "server-correlation-2" },
      json: async () => ({ code: "VERSION_CONFLICT", message: "stale version" })
    })
  });
  await assert.rejects(
    () => client.put("/record/1", { version: 1 }),
    (error) => error instanceof PlatformApiError
      && error.code === "VERSION_CONFLICT"
      && error.correlationId === "server-correlation-2"
  );
});

test("design system publishes shared accessibility tokens", () => {
  assert.equal(design.tokens.colorFocus, "#0b74de");
  assert.equal(typeof design.install, "function");
});
