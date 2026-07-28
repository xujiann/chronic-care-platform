const {
  verifyPublicHealthExternalDispatch
} = require("./public-health-external-adapter-service");
const {
  verifyPublicHealthExternalAuditChain,
  verifyRuntimeStateSignature
} = require("./public-health-external-adapter-runtime");
const { summarizeKeyring } = require("./public-health-external-keyring-service");
const {
  buildPublicHealthExternalResilienceRuntime,
  verifyPublicHealthExternalLaneControlAuditChain
} = require("./public-health-external-resilience-service");
const {
  authorizePublicHealthExternalContract
} = require("./public-health-external-contract-governance-service");
const {
  buildPublicHealthExternalContractCutoverBoard
} = require("./public-health-external-contract-cutover-service");

function clean(value) {
  return String(value ?? "").trim();
}

function rows(data, key) {
  return Array.isArray(data?.[key]) ? data[key] : [];
}

function timeValue(value) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : NaN;
}

function signingMaterialForLane(secretResolver, laneId) {
  if (typeof secretResolver === "function") return secretResolver(laneId);
  if (secretResolver && typeof secretResolver === "object") return secretResolver[laneId];
  return "";
}

function signingMaterialAvailable(material, now) {
  if (typeof material === "string") return clean(material).length >= 32;
  return summarizeKeyring(material, now).ok;
}

function issue(severity, code, dispatch, detail, action) {
  return {
    severity,
    code,
    dispatchId: clean(dispatch?.id),
    laneId: clean(dispatch?.laneId),
    detail,
    action
  };
}

const ENDPOINT_PROBE_CAMPAIGN_CHAIN_CODES = new Set([
  "ENDPOINT_PROBE_CAMPAIGN_CHAIN_LINK_MISSING",
  "ENDPOINT_PROBE_CAMPAIGN_CHAIN_LINK_MISMATCH",
  "campaign-chain-link-missing",
  "campaign-chain-link-mismatch"
]);

function endpointProbeCampaignChainIssue(continuityBreak) {
  const sourceCode = clean(continuityBreak?.code);
  if (!ENDPOINT_PROBE_CAMPAIGN_CHAIN_CODES.has(sourceCode)) return null;
  const code = sourceCode.toLowerCase().includes("missing")
    ? "campaign-chain-link-missing"
    : "campaign-chain-link-mismatch";
  const campaignId = /^[a-z0-9][a-z0-9._:-]{7,127}$/i.test(clean(continuityBreak?.campaignId))
    ? clean(continuityBreak.campaignId)
    : "";
  return {
    severity: "P0",
    code,
    dispatchId: "",
    laneId: "",
    campaignId,
    detail: code === "campaign-chain-link-missing"
      ? "The signed endpoint campaign predecessor link is missing."
      : "The signed endpoint campaign predecessor link does not match the trusted chain.",
    action: "Stop continuity promotion and reconcile the trusted signed campaign chain."
  };
}

function expectedCoordinationStates(dispatch) {
  if (dispatch.deliveryState === "delivered") return ["receipt-confirmed", "closed"];
  if (dispatch.deliveryState === "dead-letter" && !dispatch.recovery) return ["exception-open"];
  if (dispatch.deliveryState === "dead-letter" && dispatch.recovery) return ["in-progress", "receipt-confirmed", "closed"];
  return ["in-progress"];
}

function enqueueTime(data, dispatchId) {
  const entry = rows(data, "publicHealthExternalDispatchAudit")
    .find((item) => item.dispatchId === dispatchId && item.action === "enqueue-external-dispatch");
  return timeValue(entry?.at);
}

function relationshipIssues(dispatches) {
  const issues = [];
  const byId = new Map(dispatches.map((item) => [item.id, item]));
  const successors = new Map();
  dispatches.filter((item) => item.predecessorDispatchId).forEach((item) => {
    const list = successors.get(item.predecessorDispatchId) || [];
    list.push(item);
    successors.set(item.predecessorDispatchId, list);
  });
  successors.forEach((items, predecessorId) => {
    const predecessor = byId.get(predecessorId);
    if (!predecessor) {
      items.forEach((item) => issues.push(issue(
        "P0",
        "recovery-predecessor-missing",
        item,
        `Recovery predecessor ${predecessorId} does not exist.`,
        "Quarantine the successor and restore the signed predecessor record."
      )));
      return;
    }
    if (items.length > 1) {
      issues.push(issue(
        "P0",
        "multiple-recovery-successors",
        predecessor,
        `Dead letter has ${items.length} recovery successors.`,
        "Quarantine all successors and retain only the authorized signed relationship."
      ));
    }
    const expectedSuccessorId = predecessor.recovery?.successorDispatchId;
    if (!expectedSuccessorId || !items.some((item) => item.id === expectedSuccessorId)) {
      issues.push(issue(
        "P0",
        "recovery-link-mismatch",
        predecessor,
        "Predecessor recovery seal and successor relationship do not match.",
        "Restore the signed predecessor-successor relationship before delivery."
      ));
    }
  });
  dispatches.filter((item) => item.recovery?.state === "requeued").forEach((item) => {
    const successor = byId.get(item.recovery.successorDispatchId);
    if (!successor || successor.predecessorDispatchId !== item.id) {
      issues.push(issue(
        "P0",
        "recovery-successor-missing",
        item,
        "Recovery seal points to a missing or mismatched successor.",
        "Quarantine the recovery chain and restore its signed successor."
      ));
    }
  });
  dispatches.forEach((start) => {
    const visited = new Set();
    let current = start;
    while (current?.predecessorDispatchId) {
      if (visited.has(current.id)) {
        issues.push(issue(
          "P0",
          "recovery-cycle-detected",
          start,
          "Recovery predecessor chain contains a cycle.",
          "Quarantine the full recovery chain for security review."
        ));
        break;
      }
      visited.add(current.id);
      current = byId.get(current.predecessorDispatchId);
    }
  });
  return issues;
}

function buildPublicHealthExternalOperationsBoard({
  data = {},
  coordinationCenter = {},
  secretResolver = null,
  contractGovernance = null,
  endpointProbeContinuity = null,
  now = new Date().toISOString(),
  pendingSlaMinutes = 15
} = {}) {
  const nowValue = timeValue(now);
  if (!Number.isFinite(nowValue)) throw new Error("operations board now must be a valid date-time");
  const sla = Number(pendingSlaMinutes);
  if (!Number.isFinite(sla) || sla < 1 || sla > 1440) throw new Error("pendingSlaMinutes must be from 1 to 1440");
  const dispatches = rows(data, "publicHealthExternalDispatches");
  const resilienceRuntime = buildPublicHealthExternalResilienceRuntime(data);
  const dispatchIds = new Set(dispatches.map((item) => item.id));
  const handoffs = new Map((coordinationCenter.handoffs || []).map((item) => [item.id, item]));
  const issues = [];
  const laneSummary = new Map();
  const contractCutover = contractGovernance
    ? buildPublicHealthExternalContractCutoverBoard({ data, contractGovernance, now })
    : {
      lanes: [],
      issues: [],
      summary: { transitionLanes: 0, transitionTracks: 0, outstanding: 0, staleSuccessors: 0 }
    };
  issues.push(...contractCutover.issues);
  const endpointCampaignChainIssue = endpointProbeCampaignChainIssue(
    endpointProbeContinuity?.continuityBreak
  );
  if (endpointCampaignChainIssue) issues.push(endpointCampaignChainIssue);
  rows(data, "publicHealthExternalDispatchAudit")
    .filter((item) => !dispatchIds.has(item.dispatchId))
    .forEach((item) => issues.push(issue(
      "P0",
      "audit-dispatch-missing",
      { id: item.dispatchId, laneId: item.laneId },
      `Audit entry ${clean(item.id) || "unknown"} references a missing dispatch.`,
      "Quarantine the orphan audit entry and restore its signed dispatch."
    )));
  const laneControlIds = new Set(rows(data, "publicHealthExternalLaneControls").map((item) => item.laneId));
  rows(data, "publicHealthExternalLaneControlAudit")
    .filter((item) => !laneControlIds.has(item.laneId))
    .forEach((item) => issues.push(issue(
      "P0",
      "lane-control-audit-orphan",
      { id: "", laneId: item.laneId },
      `Lane-control audit entry ${clean(item.id) || "unknown"} has no signed control state.`,
      "Quarantine the orphan resilience audit and restore its signed lane control."
    )));

  dispatches.forEach((dispatch) => {
    const lane = laneSummary.get(dispatch.laneId) || {
      laneId: dispatch.laneId,
      dispatches: 0,
      delivered: 0,
      deadLetter: 0,
      pending: 0,
      retryScheduled: 0,
      issues: 0
    };
    lane.dispatches += 1;
    const stateCounter = {
      pending: "pending",
      "retry-scheduled": "retryScheduled",
      delivered: "delivered",
      "dead-letter": "deadLetter"
    }[dispatch.deliveryState];
    if (stateCounter) lane[stateCounter] += 1;
    laneSummary.set(dispatch.laneId, lane);

    const signingMaterial = signingMaterialForLane(secretResolver, dispatch.laneId);
    if (!signingMaterialAvailable(signingMaterial, now)) {
      issues.push(issue(
        "P0",
        "signature-secret-unavailable",
        dispatch,
        "The lane request secret is unavailable for integrity verification.",
        "Provision the lane verification secret before processing this dispatch."
      ));
    } else {
      const requestVerification = verifyPublicHealthExternalDispatch(dispatch, signingMaterial);
      if (!requestVerification.ok) {
        issues.push(issue(
          "P0",
          "request-signature-invalid",
          dispatch,
          requestVerification.reason,
          "Quarantine the dispatch and restore the signed request envelope."
        ));
      }
      if (!verifyRuntimeStateSignature(dispatch, signingMaterial)) {
        issues.push(issue(
          "P0",
          "runtime-state-signature-invalid",
          dispatch,
          "Mutable outbox state failed signature verification.",
          "Quarantine the dispatch and restore the last trusted state."
        ));
      }
      const auditVerification = verifyPublicHealthExternalAuditChain(data, dispatch.id, signingMaterial);
      if (!auditVerification.ok) {
        issues.push(issue(
          "P0",
          "audit-chain-invalid",
          dispatch,
          auditVerification.reason,
          "Quarantine writes and restore the signed audit chain."
        ));
      }
    }

    const handoff = handoffs.get(dispatch.handoffId);
    if (!handoff) {
      issues.push(issue(
        "P0",
        "coordination-handoff-missing",
        dispatch,
        `Linked coordination handoff ${dispatch.handoffId} does not exist.`,
        "Restore the coordination task or quarantine the orphan dispatch."
      ));
    } else {
      const expectedStates = expectedCoordinationStates(dispatch);
      if (!expectedStates.includes(handoff.state)) {
        issues.push(issue(
          "P0",
          "coordination-state-mismatch",
          dispatch,
          `Outbox state ${dispatch.deliveryState} expects coordination state ${expectedStates.join("/")} but found ${handoff.state}.`,
          "Reconcile the outbox receipt and coordination action atomically."
        ));
      }
    }

    if (contractGovernance) {
      const governedLane = contractGovernance.entries?.find((item) => item.laneId === dispatch.laneId);
      const governedContract = governedLane?.contracts?.find((item) => item.contract === dispatch.contract);
      const authorization = authorizePublicHealthExternalContract(
        contractGovernance,
        dispatch.laneId,
        dispatch.contract,
        dispatch.request?.schemaVersion,
        dispatch.receipt?.schemaVersion || governedContract?.receiptSchemaVersion || ""
      );
      if (!authorization.ok) {
        const governedTransitions = governedLane?.transitions?.length
          ? governedLane.transitions
          : [governedLane?.transition];
        const cutoverRetirement = authorization.reason === "contract-version-retired"
          && governedTransitions.some((item) => item?.fromContract === dispatch.contract);
        if (!cutoverRetirement) {
          issues.push(issue(
            "P0",
            "contract-governance-mismatch",
            dispatch,
            authorization.reason,
            "Quarantine the dispatch and reconcile its signed contract and schema versions."
          ));
        }
      } else if (authorization.state === "deprecated") {
        const historical = dispatch.deliveryState === "delivered"
          || (dispatch.deliveryState === "dead-letter" && dispatch.recovery?.state === "requeued");
        if (!historical) {
          issues.push(issue(
            "P1",
            "contract-version-deprecated",
            dispatch,
            authorization.warning,
            "Migrate the producer and consumer before the signed sunset deadline."
          ));
        }
      }
    }

    const leaseExpiry = timeValue(dispatch.lease?.expiresAt);
    if (dispatch.lease && Number.isFinite(leaseExpiry) && leaseExpiry <= nowValue) {
      issues.push(issue(
        "P1",
        "worker-lease-expired",
        dispatch,
        `Worker lease expired at ${dispatch.lease.expiresAt}.`,
        "Reclaim the due dispatch with a new signed worker lease."
      ));
    }
    if (dispatch.deliveryState === "retry-scheduled"
      && Number.isFinite(timeValue(dispatch.nextRetryAt))
      && timeValue(dispatch.nextRetryAt) <= nowValue
      && !dispatch.lease) {
      issues.push(issue(
        "P1",
        "retry-due-unclaimed",
        dispatch,
        `Retry became due at ${dispatch.nextRetryAt}.`,
        "Claim and deliver the due retry through the worker lease flow."
      ));
    }
    const createdAt = enqueueTime(data, dispatch.id);
    if (dispatch.deliveryState === "pending"
      && !dispatch.lease
      && Number.isFinite(createdAt)
      && createdAt + sla * 60_000 <= nowValue) {
      issues.push(issue(
        "P1",
        "pending-dispatch-overdue",
        dispatch,
        `Pending dispatch exceeded the ${sla}-minute claim SLA.`,
        "Claim the dispatch or investigate worker availability."
      ));
    }
    if (dispatch.deliveryState === "dead-letter" && !dispatch.recovery) {
      issues.push(issue(
        "P1",
        "dead-letter-unrecovered",
        dispatch,
        "Dead letter has no authorized remediation successor.",
        "Complete remediation review and governed dead-letter recovery."
      ));
    }
  });

  rows(data, "publicHealthExternalLaneControls").forEach((control) => {
    const lane = laneSummary.get(control.laneId) || {
      laneId: control.laneId,
      dispatches: 0,
      delivered: 0,
      deadLetter: 0,
      pending: 0,
      retryScheduled: 0,
      issues: 0
    };
    lane.circuitState = control.circuitState;
    lane.controlVersion = control.version;
    laneSummary.set(control.laneId, lane);
    const signingMaterial = signingMaterialForLane(secretResolver, control.laneId);
    if (!signingMaterialAvailable(signingMaterial, now)) {
      issues.push(issue(
        "P0",
        "lane-control-signature-secret-unavailable",
        { id: "", laneId: control.laneId },
        "The lane signing material is unavailable for resilience-control verification.",
        "Provision the full lane request keyring before claiming more work."
      ));
    } else {
      const verification = verifyPublicHealthExternalLaneControlAuditChain(
        data,
        control.laneId,
        signingMaterial
      );
      if (!verification.ok) {
        issues.push(issue(
          "P0",
          "lane-control-integrity-invalid",
          { id: "", laneId: control.laneId },
          verification.reason,
          "Stop lane delivery and restore the last trusted signed resilience state."
        ));
      }
    }
    if (control.circuitState === "open") {
      issues.push(issue(
        "P1",
        "lane-circuit-open",
        { id: "", laneId: control.laneId },
        `Lane circuit is open until ${clean(control.openUntil) || "manual review"}.`,
        "Investigate the external dependency and wait for the governed half-open probe."
      ));
    } else if (control.circuitState === "half-open") {
      issues.push(issue(
        "P1",
        "lane-circuit-half-open",
        { id: "", laneId: control.laneId },
        `Lane has ${Number(control.halfOpenProbesInFlight || 0)} half-open probes in flight.`,
        "Allow only the configured probe count and observe its signed outcome."
      ));
    }
  });

  issues.push(...relationshipIssues(dispatches));
  issues.forEach((item) => {
    const lane = laneSummary.get(item.laneId);
    if (lane) lane.issues += 1;
  });
  const p0 = issues.filter((item) => item.severity === "P0").length;
  const p1 = issues.filter((item) => item.severity === "P1").length;
  const integrityFailureIds = new Set(issues.filter((item) => [
    "signature-secret-unavailable",
    "request-signature-invalid",
    "runtime-state-signature-invalid",
    "audit-chain-invalid",
    "lane-control-audit-orphan",
    "lane-control-signature-secret-unavailable",
    "lane-control-integrity-invalid",
    "contract-governance-mismatch"
  ].includes(item.code)).map((item) => item.dispatchId));
  return {
    generatedAt: new Date(nowValue).toISOString(),
    ok: p0 === 0,
    operationallyHealthy: issues.length === 0,
    functionalState: p0 === 0 ? "external-outbox-integrity-verified" : "external-outbox-integrity-blocked",
    formalGoLiveState: "blocked-until-t00-routes-production-connectivity-and-trusted-site-evidence-verified",
    summary: {
      dispatches: dispatches.length,
      lanes: laneSummary.size,
      issues: issues.length,
      p0,
      p1,
      signatureVerified: dispatches.length - integrityFailureIds.size,
      orphanDispatches: issues.filter((item) => item.code === "coordination-handoff-missing").length,
      orphanAuditEntries: issues.filter((item) => item.code === "audit-dispatch-missing").length,
      orphanLaneControlAuditEntries: issues.filter((item) => item.code === "lane-control-audit-orphan").length,
      stateMismatches: issues.filter((item) => item.code === "coordination-state-mismatch").length,
      expiredLeases: issues.filter((item) => item.code === "worker-lease-expired").length,
      overduePending: issues.filter((item) => item.code === "pending-dispatch-overdue").length,
      dueRetries: issues.filter((item) => item.code === "retry-due-unclaimed").length,
      unrecoveredDeadLetters: issues.filter((item) => item.code === "dead-letter-unrecovered").length,
      resilienceLanes: resilienceRuntime.summary.lanes,
      openCircuits: issues.filter((item) => item.code === "lane-circuit-open").length,
      halfOpenCircuits: issues.filter((item) => item.code === "lane-circuit-half-open").length,
      contractMismatches: issues.filter((item) => item.code === "contract-governance-mismatch").length,
      deprecatedContracts: issues.filter((item) => item.code === "contract-version-deprecated").length,
      contractCutoverLanes: contractCutover.summary.transitionLanes,
      contractCutoverTracks: contractCutover.summary.transitionTracks,
      contractCutoverBacklog: contractCutover.summary.outstanding,
      contractCutoverStaleSuccessors: contractCutover.summary.staleSuccessors,
      campaignChainLinksVerified: Number(
        endpointProbeContinuity?.summary?.campaignChainLinksVerified || 0
      ),
      campaignChainBreaks: issues.filter((item) => [
        "campaign-chain-link-missing",
        "campaign-chain-link-mismatch"
      ].includes(item.code)).length
    },
    contractCutover,
    lanes: [...laneSummary.values()].sort((left, right) => left.laneId.localeCompare(right.laneId)),
    issues,
    productionReady: false,
    blockers: [
      ...issues.filter((item) => item.severity === "P0").map((item) => (
        `${item.code}:${item.campaignId || item.dispatchId}`
      )),
      "Production connectivity and trusted site evidence require independent verification."
    ]
  };
}

module.exports = {
  buildPublicHealthExternalOperationsBoard,
  expectedCoordinationStates,
  relationshipIssues
};
