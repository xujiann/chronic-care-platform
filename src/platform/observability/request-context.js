"use strict";

const { AsyncLocalStorage } = require("node:async_hooks");
const { randomUUID } = require("node:crypto");

const CORRELATION_HEADER = "x-correlation-id";

function normalizeCorrelationId(value) {
  const candidate = String(value || "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(candidate) ? candidate : randomUUID();
}

class PlatformObservability {
  constructor({ now = () => Date.now() } = {}) {
    this.storage = new AsyncLocalStorage();
    this.now = now;
    this.metrics = new Map();
    this.dependencies = new Map();
  }

  run(req, res, handler) {
    const correlationId = normalizeCorrelationId(req.headers?.[CORRELATION_HEADER]);
    const context = Object.freeze({
      correlationId,
      requestId: correlationId,
      method: String(req.method || "GET"),
      path: String(req.url || "").split("?")[0],
      startedAt: this.now()
    });
    req.correlationId = correlationId;
    res.setHeader(CORRELATION_HEADER, correlationId);
    return this.storage.run(context, async () => {
      try {
        return await handler();
      } finally {
        const durationMs = this.now() - context.startedAt;
        this.recordHttp({
          domain: req.routeDomain || "unmatched",
          subdomain: req.routeSubdomain || "",
          method: context.method,
          status: Number(res.statusCode || 0),
          durationMs
        });
      }
    });
  }

  current() {
    return this.storage.getStore() || null;
  }

  recordHttp({ domain, subdomain = "", method, status, durationMs }) {
    const key = `${domain}:${subdomain || "_"}:${method}`;
    const current = this.metrics.get(key) || { count: 0, errors: 0, durationMs: 0, maxDurationMs: 0 };
    current.count += 1;
    current.errors += status >= 500 ? 1 : 0;
    current.durationMs += durationMs;
    current.maxDurationMs = Math.max(current.maxDurationMs, durationMs);
    this.metrics.set(key, current);
  }

  recordDependency(name, { ok, latencyMs = 0, detail = "" }) {
    this.dependencies.set(name, Object.freeze({
      ok: ok === true,
      latencyMs: Number(latencyMs),
      detail: String(detail || "").slice(0, 200),
      checkedAt: new Date().toISOString()
    }));
  }

  snapshot() {
    return Object.freeze({
      http: Object.freeze([...this.metrics.entries()].map(([key, value]) => Object.freeze({
        key,
        ...value,
        averageDurationMs: value.count ? Math.round(value.durationMs / value.count) : 0
      }))),
      dependencies: Object.freeze(Object.fromEntries(this.dependencies))
    });
  }
}

module.exports = { CORRELATION_HEADER, PlatformObservability, normalizeCorrelationId };
