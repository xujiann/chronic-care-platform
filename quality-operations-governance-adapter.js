const {
  CANONICAL_STATUSES,
  DOMAINS,
  METRIC_DEFINITIONS,
  SOURCE_STATUS_MAPS,
  STATUS_MACHINES,
  createGovernanceState,
  institutionScope,
  normalizeSourceStatus,
  validateMetricCatalog
} = require("./quality-operations-governance");

const SOURCE_DEFINITIONS = Object.freeze([
  Object.freeze({
    collection: "qualityRectificationOrders",
    domain: DOMAINS.QUALITY_RECTIFICATION,
    sourceStatusByCanonical: Object.freeze({
      detected: "open",
      triaged: "pending_disposition",
      assigned: "dispatched",
      in_progress: "acknowledged",
      evidence_submitted: "feedback_submitted",
      under_review: "review_pending",
      returned: "returned",
      escalated: "escalated",
      closed: "closed",
      cancelled: "cancelled"
    })
  }),
  Object.freeze({
    collection: "resourceDispatchRequests",
    domain: DOMAINS.RESOURCE_DISPATCH,
    sourceStatusByCanonical: Object.freeze({
      detected: "open",
      triaged: "triage-confirmed",
      assigned: "assigned",
      in_progress: "in-progress",
      evidence_submitted: "evidence-submitted",
      under_review: "pending-review",
      returned: "returned",
      escalated: "escalated",
      closed: "closed",
      cancelled: "cancelled"
    })
  }),
  Object.freeze({
    collection: "drugConsumableSupervisions",
    domain: DOMAINS.DRUG_CONSUMABLE,
    sourceStatusByCanonical: Object.freeze({
      detected: "open",
      triaged: "pending-review",
      assigned: "institution-confirmed",
      in_progress: "in-progress",
      evidence_submitted: "remediation-submitted",
      under_review: "in-review",
      returned: "returned",
      escalated: "escalated",
      closed: "closed",
      cancelled: "cancelled"
    })
  })
]);

const SOURCE_BY_COLLECTION = new Map(SOURCE_DEFINITIONS.map((item) => [item.collection, item]));
const SOURCE_BY_DOMAIN = new Map(SOURCE_DEFINITIONS.map((item) => [item.domain, item]));
const INSTITUTION_ALIASES = Object.freeze({
  "dalian central hospital": "MR1",
  "dalian women and children medical center": "MR2",
  "qingniwaqiao community health service center": "MR3",
  "xinghaiwan community health service center": "MR3"
});

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function cleanText(value, maximumLength = 300) {
  return String(value || "").trim().replace(/[\r\n]/g, " ").slice(0, maximumLength);
}

function normalizedName(value) {
  return cleanText(value, 300).toLowerCase().replace(/\s+/g, " ");
}

function organizationDirectory(data = {}) {
  const directory = new Map();
  for (const organization of data.authOrganizations || []) {
    const orgCode = cleanText(organization.orgCode, 120);
    const name = normalizedName(organization.name);
    if (orgCode && name) directory.set(name, orgCode);
  }
  for (const user of data.authUsers || []) {
    const orgCode = cleanText(user.orgCode, 120);
    const name = normalizedName(user.orgName);
    if (orgCode && name) directory.set(name, orgCode);
  }
  Object.entries(INSTITUTION_ALIASES).forEach(([name, orgCode]) => directory.set(name, orgCode));
  return directory;
}

function linkedQualityEvent(data, row) {
  return (data.qualitySafetyEvents || []).find((item) => item.id === row.issueId) || null;
}

function linkedDrugSource(data, row) {
  const collections = {
    insuranceClaims: data.insuranceClaims,
    institutionSupervisions: data.institutionSupervisions,
    medicationPickups: data.medicationPickups
  };
  return (collections[row.sourceCollection] || []).find((item) => item.id === row.sourceId)
    || (data.insuranceClaims || []).find((item) => item.id === row.relatedClaimId)
    || null;
}

function resolveInstitutionId(data, row, definition) {
  if (definition.domain === DOMAINS.RESOURCE_DISPATCH) {
    return cleanText(row.targetInstitutionId || row.institutionId, 120);
  }
  if (definition.domain === DOMAINS.QUALITY_RECTIFICATION) {
    const event = linkedQualityEvent(data, row);
    const byName = organizationDirectory(data).get(normalizedName(row.institutionName || event?.institutionName));
    return cleanText(row.institutionId || byName || event?.institutionId, 120);
  }
  const source = linkedDrugSource(data, row);
  const byName = organizationDirectory(data).get(normalizedName(row.institution || source?.institution));
  return cleanText(row.institutionId || source?.institutionId || source?.institutionCode || byName, 120);
}

function sourceVersion(row) {
  return cleanText(
    row.governanceSourceVersion
      || row.lastUpdated
      || row.updatedAt
      || row.dispatchedAt
      || row.requestedAt
      || row.createdAt,
    80
  );
}

function adaptSourceRecord(data, collection, row) {
  const definition = SOURCE_BY_COLLECTION.get(collection);
  if (!definition) throw new Error(`unsupported governance source collection: ${collection}`);
  const sourceStatus = cleanText(row.status || row.reviewStatus || row.remediationStatus, 80);
  const status = cleanText(row.governanceStatus, 80) || normalizeSourceStatus(definition.domain, sourceStatus);
  const institutionId = resolveInstitutionId(data, row, definition);
  return {
    id: cleanText(row.id, 160),
    domain: definition.domain,
    status,
    sourceCollection: collection,
    sourceId: cleanText(row.id, 160),
    sourceStatus,
    sourceVersion: sourceVersion(row),
    version: Number.isInteger(row.governanceVersion) && row.governanceVersion >= 0 ? row.governanceVersion : 0,
    institutionId,
    sourceInstitutionId: cleanText(row.sourceInstitutionId, 120),
    targetInstitutionId: cleanText(row.targetInstitutionId, 120),
    title: cleanText(row.requirement || row.issue || row.reason || row.resourceType || row.id, 500),
    riskLevel: cleanText(row.riskLevel || row.priority, 80),
    updatedAt: cleanText(row.governanceUpdatedAt || row.lastUpdated || row.updatedAt, 80),
    updatedBy: cleanText(row.governanceUpdatedBy, 160),
    lastCommandId: cleanText(row.governanceLastCommandId, 240),
    details: clone(row.governanceDetails || {}),
    auditEvents: (data.qualityOperationsGovernanceAuditEvents || []).filter((item) => item.recordId === row.id)
  };
}

function buildGovernanceRuntimeState(data = {}) {
  const records = [];
  const unmapped = [];
  for (const definition of SOURCE_DEFINITIONS) {
    for (const row of data[definition.collection] || []) {
      const record = adaptSourceRecord(data, definition.collection, row);
      if (!record.id || !CANONICAL_STATUSES.includes(record.status)) {
        unmapped.push({
          collection: definition.collection,
          id: record.id,
          domain: definition.domain,
          sourceStatus: record.sourceStatus,
          reason: record.id ? "source status has no approved canonical mapping" : "source record id is missing"
        });
        continue;
      }
      records.push(record);
    }
  }
  const state = createGovernanceState(records);
  state.commandReceipts = clone(data.qualityOperationsGovernanceCommandReceipts || {});
  state.auditEvents = clone(data.qualityOperationsGovernanceAuditEvents || []);
  return { state, unmapped };
}

function publicGovernanceRecord(record) {
  if (!record) return null;
  const { auditEvents, ...safe } = clone(record);
  return { ...safe, institutionIds: institutionScope(record), auditEventCount: auditEvents?.length || 0 };
}

function actorCanView(record, actor = {}) {
  if (actor.role === "commission") return true;
  if (actor.role === "insurance") return record.domain === DOMAINS.DRUG_CONSUMABLE;
  if (actor.role !== "institution") return false;
  const orgCode = cleanText(actor.orgCode || actor.institutionId, 120);
  return Boolean(orgCode) && institutionScope(record).includes(orgCode);
}

function buildGovernanceCatalog(data = {}) {
  const { state, unmapped } = buildGovernanceRuntimeState(data);
  const records = Object.values(state.records);
  const metrics = validateMetricCatalog();
  return {
    productionReady: false,
    sourceCollections: SOURCE_DEFINITIONS.map((item) => ({
      collection: item.collection,
      domain: item.domain,
      rows: (data[item.collection] || []).length
    })),
    domains: Object.values(DOMAINS),
    statuses: CANONICAL_STATUSES,
    statusMachines: STATUS_MACHINES,
    sourceStatusMaps: SOURCE_STATUS_MAPS,
    metrics: METRIC_DEFINITIONS,
    metricCatalog: metrics,
    summary: {
      records: records.length,
      open: records.filter((item) => !["closed", "cancelled"].includes(item.status)).length,
      unmapped: unmapped.length,
      auditEvents: state.auditEvents.length,
      commandReceipts: Object.keys(state.commandReceipts).length
    },
    unmapped,
    blockers: [
      "trusted identity and institution directory evidence",
      "live HIS/EMR/LIS/PACS, bed, roster, equipment and transfer interfaces",
      "scan terminals and insurance callbacks",
      "production database, SIEM, alert duty and disaster recovery evidence"
    ]
  };
}

function listGovernanceRecords(data = {}, actor = {}, filters = {}) {
  const { state, unmapped } = buildGovernanceRuntimeState(data);
  const domain = cleanText(filters.domain, 80);
  const status = cleanText(filters.status, 80);
  const institutionId = cleanText(filters.institutionId, 120);
  const records = Object.values(state.records)
    .filter((item) => actorCanView(item, actor))
    .filter((item) => !domain || item.domain === domain)
    .filter((item) => !status || item.status === status)
    .filter((item) => !institutionId || institutionScope(item).includes(institutionId))
    .map(publicGovernanceRecord);
  return { records, unmapped, total: records.length };
}

function governanceAuditForRecord(data = {}, recordId, actor = {}) {
  const { state } = buildGovernanceRuntimeState(data);
  const record = state.records[recordId];
  if (!record) return { found: false, allowed: false, record: null, auditEvents: [] };
  if (!actorCanView(record, actor)) return { found: true, allowed: false, record: null, auditEvents: [] };
  return {
    found: true,
    allowed: true,
    record: publicGovernanceRecord(record),
    auditEvents: state.auditEvents.filter((item) => item.recordId === recordId)
  };
}

function sourceStatusForRecord(record) {
  const definition = SOURCE_BY_DOMAIN.get(record.domain);
  return definition?.sourceStatusByCanonical?.[record.status] || "";
}

function applyGovernanceResultToData(data, result) {
  const alreadyPersisted = new Set((data.qualityOperationsGovernanceAuditEvents || []).map((item) => item.id));
  data.qualityOperationsGovernanceAuditEvents = clone(result.state.auditEvents || []);
  data.qualityOperationsGovernanceCommandReceipts = clone(result.state.commandReceipts || {});
  const isNewAudit = Boolean(result.auditEvent?.id) && !alreadyPersisted.has(result.auditEvent.id);
  if (result.ok && !result.replayed && result.record) {
    const definition = SOURCE_BY_DOMAIN.get(result.record.domain);
    const rows = data[definition.collection] || [];
    const index = rows.findIndex((item) => item.id === result.record.sourceId);
    if (index < 0) throw new Error(`governance source record disappeared: ${definition.collection}/${result.record.sourceId}`);
    rows[index] = {
      ...rows[index],
      status: sourceStatusForRecord(result.record),
      governanceStatus: result.record.status,
      governanceVersion: result.record.version,
      governanceSourceVersion: result.record.sourceVersion,
      governanceLastCommandId: result.record.lastCommandId,
      governanceUpdatedAt: result.record.updatedAt,
      governanceUpdatedBy: result.record.updatedBy,
      governanceDetails: clone(result.record.details || {}),
      auditTrail: [
        {
          at: result.auditEvent.occurredAt,
          actor: result.auditEvent.actorId,
          role: result.auditEvent.actorRole,
          action: `governance:${result.auditEvent.action}`,
          result: result.auditEvent.outcome,
          note: result.auditEvent.reason
        },
        ...(Array.isArray(rows[index].auditTrail) ? rows[index].auditTrail : [])
      ].slice(0, 100)
    };
  }
  if (isNewAudit) {
    data.platformProcessAudit = [
      {
        process: `quality-operations-governance:${result.auditEvent.domain}`,
        owner: result.auditEvent.actorId,
        status: result.auditEvent.outcome,
        risk: result.auditEvent.code,
        auditPoint: `${result.auditEvent.action}:${result.auditEvent.fromStatus}->${result.auditEvent.toStatus}`,
        evidence: `qualityOperationsGovernanceAuditEvents/${result.auditEvent.id}`,
        nextAction: result.auditEvent.reason
      },
      ...(Array.isArray(data.platformProcessAudit) ? data.platformProcessAudit : [])
    ].slice(0, 120);
    data.securityEvents = [
      {
        id: result.auditEvent.id,
        at: result.auditEvent.occurredAt,
        actor: result.auditEvent.actorId,
        role: result.auditEvent.actorRole,
        action: "quality-operations-governance-command",
        target: `${result.auditEvent.domain}/${result.auditEvent.recordId}`,
        result: result.auditEvent.outcome,
        detail: `${result.auditEvent.code}:${result.auditEvent.reason}`
      },
      ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
    ].slice(0, 160);
  }
  return { data, isNewAudit };
}

module.exports = {
  SOURCE_DEFINITIONS,
  actorCanView,
  adaptSourceRecord,
  applyGovernanceResultToData,
  buildGovernanceCatalog,
  buildGovernanceRuntimeState,
  governanceAuditForRecord,
  listGovernanceRecords,
  publicGovernanceRecord,
  resolveInstitutionId,
  sourceStatusForRecord
};
