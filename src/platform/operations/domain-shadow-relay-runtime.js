"use strict";

const {
  buildDigestSnapshot,
  compareDigestSnapshots,
  runShadowOutboxRelayOnce,
  sha256
} = require("./shadow-outbox-relay");

const DOMAINS = new Set(["referral", "emergency"]);

function domainError(code, message, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

function rowsForDomain(state = {}, domain) {
  if (domain === "referral") {
    return Array.isArray(state.referralSystem?.referralOutbox)
      ? state.referralSystem.referralOutbox
      : [];
  }
  return (Array.isArray(state.emergencyAuditEvents) ? state.emergencyAuditEvents : [])
    .filter((row) => row?.action === "domain-event-outbox" && row?.owner === "clinical-specialties");
}

function eventPayload(row = {}, domain) {
  if (domain === "referral") return structuredClone(row.payload || {});
  return {
    id: row.id,
    domain: row.domain,
    type: row.type,
    aggregateId: row.aggregateId,
    aggregateVersion: row.aggregateVersion,
    correlationId: row.correlationId,
    causationId: row.causationId,
    occurredAt: row.occurredAt,
    payload: structuredClone(row.payload || {})
  };
}

function normalizedRows(state, domain) {
  const rows = rowsForDomain(state, domain).map((row) => structuredClone(row));
  const ordered = [...rows].sort((left, right) =>
    String(left.occurredAt || left.createdAt || "").localeCompare(
      String(right.occurredAt || right.createdAt || "")
    ) || String(left.id || "").localeCompare(String(right.id || "")));
  const used = new Set();
  for (const row of ordered) {
    const sequence = Number(row.relaySequence);
    if (Number.isSafeInteger(sequence) && sequence > 0 && !used.has(sequence)) used.add(sequence);
  }
  let legacySequence = 1;
  return ordered.map((row) => {
    let sequence = Number(row.relaySequence);
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      while (used.has(legacySequence)) legacySequence += 1;
      sequence = legacySequence++;
      used.add(sequence);
    }
    const payload = eventPayload(row, domain);
    return Object.freeze({
      id: String(row.id || ""),
      sequence,
      payload,
      payloadDigest: sha256(payload),
      metadata: domain === "referral"
        ? Object.freeze({
          type: row.type,
          contractId: row.contractId,
          aggregateVersion: row.aggregateVersion,
          correlationId: row.correlationId,
          occurredAt: row.occurredAt
        })
        : Object.freeze({ delivery: structuredClone(row.delivery || {}) })
    });
  }).sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
}

function createDomainShadowSource(options = {}) {
  const domain = String(options.domain || "");
  if (!DOMAINS.has(domain) || typeof options.readDatabase !== "function") {
    throw domainError(
      "DOMAIN_SHADOW_SOURCE_INVALID",
      "domain shadow source requires referral or emergency and readDatabase",
      400
    );
  }
  return Object.freeze({
    async readBatch({ afterSequence = 0, limit = 20 } = {}) {
      return normalizedRows(options.readDatabase(), domain)
        .filter((row) => row.sequence > Number(afterSequence || 0))
        .slice(0, Math.min(100, Math.max(1, Number(limit) || 20)));
    },
    async snapshot() {
      return buildDigestSnapshot(normalizedRows(options.readDatabase(), domain));
    }
  });
}

function projectDomainEvent(domain, payload, context = {}) {
  if (domain === "referral") {
    return {
      id: context.id,
      type: context.metadata.type,
      contractId: context.metadata.contractId,
      aggregateVersion: context.metadata.aggregateVersion,
      correlationId: context.metadata.correlationId,
      occurredAt: context.metadata.occurredAt,
      payload
    };
  }
  return { ...payload, delivery: structuredClone(context.metadata.delivery || {}) };
}

async function requireEligibleRuntime(runtime, domain, verifySchema) {
  if (typeof runtime?.shadowRelayReadiness !== "function") {
    throw domainError("DOMAIN_SHADOW_RUNTIME_INVALID", "central production adapter runtime is required", 503);
  }
  const report = await runtime.shadowRelayReadiness(domain, { verifySchema });
  if (!report.eligible) {
    throw domainError(
      "DOMAIN_SHADOW_RELAY_GATE_BLOCKED",
      `domain shadow relay gate is blocked for ${domain}`,
      409
    );
  }
  return report;
}

async function runDomainShadowRelayOnce(options = {}) {
  const domain = String(options.domain || "");
  if (!DOMAINS.has(domain)) {
    throw domainError("DOMAIN_SHADOW_RELAY_UNKNOWN", "domain must be referral or emergency", 400);
  }
  await requireEligibleRuntime(options.runtime, domain, options.verifySchema === true);
  const source = options.source || createDomainShadowSource({
    domain,
    readDatabase: options.readDatabase
  });
  return runShadowOutboxRelayOnce({
    relayId: options.relayId || `${domain}-postgres-shadow-v1`,
    source,
    sink: options.runtime.repository(domain),
    checkpoint: options.checkpoint,
    limit: options.limit,
    faultInjector: options.faultInjector,
    project: (payload, context) => projectDomainEvent(domain, payload, context)
  });
}

async function reconcileDomainShadowRelay(options = {}) {
  const domain = String(options.domain || "");
  await requireEligibleRuntime(options.runtime, domain, options.verifySchema === true);
  const source = options.source || createDomainShadowSource({
    domain,
    readDatabase: options.readDatabase
  });
  const repository = options.runtime.repository(domain);
  if (typeof repository.shadowSnapshot !== "function") {
    throw domainError("DOMAIN_SHADOW_SNAPSHOT_UNAVAILABLE", "target repository does not expose shadowSnapshot", 503);
  }
  const [sourceSnapshot, targetEvents] = await Promise.all([
    source.snapshot(),
    repository.shadowSnapshot()
  ]);
  const targetSnapshot = buildDigestSnapshot(targetEvents);
  return Object.freeze({
    domain,
    ...compareDigestSnapshots(sourceSnapshot, targetSnapshot),
    boundary: "This digest-only reconciliation is local technical evidence, not external acceptance or production cutover authorization."
  });
}

module.exports = {
  createDomainShadowSource,
  normalizedRows,
  projectDomainEvent,
  reconcileDomainShadowRelay,
  runDomainShadowRelayOnce
};
