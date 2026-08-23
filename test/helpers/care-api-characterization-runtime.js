"use strict";

const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

async function request(baseUrl, pathname, token = "", options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  return { response, body: await response.json() };
}

async function login(baseUrl, username, password = "123456") {
  const result = await request(baseUrl, "/api/auth/login", "", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
  if (result.response.status !== 200) {
    throw new Error(`care characterization login failed for ${username}: ${JSON.stringify(result.body)}`);
  }
  return result.body.token;
}

function jsonCommand(token, commandId, body) {
  return {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": commandId
    },
    body: JSON.stringify(body)
  };
}

async function startCareApiCharacterization(name) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  const environment = {
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    DATA_DIR: process.env.DATA_DIR,
    STORAGE_ENGINE: process.env.STORAGE_ENGINE,
    SESSION_STORE: process.env.SESSION_STORE,
    SESSION_SECRETS: process.env.SESSION_SECRETS
  };
  Object.assign(process.env, {
    NODE_ENV: "test",
    PORT: "0",
    DATA_DIR: dataDir,
    STORAGE_ENGINE: "json",
    SESSION_STORE: "memory",
    SESSION_SECRETS: "test006-care-characterization-session-secret-2026"
  });
  const { server, startServer, stopServer } = require(path.join(ROOT, "server.js"));
  startServer(0);
  await once(server, "listening");
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  let stopped = false;
  async function stop() {
    if (stopped) return;
    stopped = true;
    await stopServer();
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  return { baseUrl, dataDir, login: (username, password) => login(baseUrl, username, password), request: (pathname, token, options) => request(baseUrl, pathname, token, options), stop };
}

module.exports = {
  jsonCommand,
  startCareApiCharacterization
};
