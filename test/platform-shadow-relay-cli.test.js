"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { run } = require("../scripts/platform-shadow-relay");

function fakeRuntime() {
  return {
    shadowRelayReadiness: async () => ({
      adapter: "referral",
      eligible: false,
      productionReady: false
    }),
    close: async () => undefined
  };
}

test("shadow relay CLI defaults to status and refuses mutation while activation is closed", async () => {
  const status = await run(
    { domain: "referral" },
    { env: {}, runtime: fakeRuntime() }
  );
  assert.equal(status.report.eligible, false);
  await assert.rejects(
    () => run(
      { domain: "referral", run: true },
      { env: { PLATFORM_SHADOW_RELAY_ENABLED: "false" }, runtime: fakeRuntime() }
    ),
    (error) => error.code === "PLATFORM_SHADOW_RELAY_DISABLED"
  );
});
