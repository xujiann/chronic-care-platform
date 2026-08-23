"use strict";

const E2E_PORT_ENV = "PLAYWRIGHT_E2E_PORT";

function requireE2EPort(env = process.env) {
  const raw = String(env[E2E_PORT_ENV] || "").trim();
  const port = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`${E2E_PORT_ENV} must be an integer between 1024 and 65535`);
  }
  return port;
}

function createE2EBaseURL(port) {
  return `http://127.0.0.1:${port}`;
}

module.exports = {
  E2E_PORT_ENV,
  createE2EBaseURL,
  requireE2EPort
};
