"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { issuePhoneVerificationCode } = require("../server");

const OPTIONS = Object.freeze({
  env: { NODE_ENV: "production" },
  digestSecret: "phone-flow-test-digest-secret-at-least-32-characters",
  generateCode: () => "314159"
});

test("provider rejection revokes only the issued OTP", async () => {
  const calls = [];
  let active = false;
  const store = {
    async issueVerificationCode() { calls.push("issue"); active = true; return { expiresAt: "2026-08-21T01:00:00.000Z" }; },
    async revokeVerificationCode() { calls.push("revoke-otp"); active = false; return { revoked: true }; }
  };
  await assert.rejects(() => issuePhoneVerificationCode("13800000000", {
    ...OPTIONS,
    store,
    async sendSms() { calls.push("send"); throw new Error("provider rejected"); }
  }), /provider rejected/);
  assert.deepEqual(calls, ["issue", "send", "revoke-otp"]);
  assert.equal(active, false);
});

test("shared-state issue failure invokes the SMS adapter zero times", async () => {
  let adapterCalls = 0;
  const store = {
    async issueVerificationCode() { throw new Error("shared state unavailable"); },
    async revokeVerificationCode() { throw new Error("must not be called"); }
  };
  await assert.rejects(() => issuePhoneVerificationCode("13800000000", {
    ...OPTIONS,
    store,
    async sendSms() { adapterCalls += 1; return {}; }
  }), /shared state unavailable/);
  assert.equal(adapterCalls, 0);
});
