function clean(value) {
  return String(value ?? "").trim();
}

function rows(data, key) {
  return Array.isArray(data?.[key]) ? data[key] : [];
}

function timeValue(value, label) {
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid date-time`);
  return parsed;
}

function isOutstanding(dispatch) {
  if (dispatch?.lease) return true;
  if (["pending", "retry-scheduled"].includes(dispatch?.deliveryState)) return true;
  return dispatch?.deliveryState === "dead-letter" && dispatch?.recovery?.state !== "requeued";
}

function cutoverIssue(severity, code, lane, dispatch, detail, action) {
  return {
    severity,
    code,
    laneId: lane.laneId,
    dispatchId: clean(dispatch?.id),
    fromContract: lane.transition.fromContract,
    toContract: lane.transition.toContract,
    sunsetAt: lane.transition.sunsetAt,
    detail,
    action
  };
}

function buildPublicHealthExternalContractCutoverBoard({
  data = {},
  contractGovernance,
  now = contractGovernance?.generatedAt || new Date().toISOString()
} = {}) {
  const nowValue = timeValue(now, "contract cutover now");
  const dispatches = rows(data, "publicHealthExternalDispatches");
  const issues = [];
  const lanes = [];
  if (!contractGovernance?.ok || !Array.isArray(contractGovernance.entries)) {
    return {
      generatedAt: new Date(nowValue).toISOString(),
      ok: false,
      functionalState: "external-contract-cutover-governance-unavailable",
      lanes: [],
      issues: [{
        severity: "P0",
        code: "contract-cutover-governance-unavailable",
        laneId: "",
        dispatchId: "",
        detail: "A verified contract governance snapshot is required.",
        action: "Restore the server-verified contract governance snapshot before cutover."
      }],
      summary: {
        transitionLanes: 0,
        transitionTracks: 0,
        scheduled: 0,
        draining: 0,
        readyForSunset: 0,
        completed: 0,
        outstanding: 0,
        staleSuccessors: 0
      },
      productionReady: false,
      blockers: ["Verified contract governance is unavailable."]
    };
  }

  contractGovernance.entries.flatMap((entry) => {
    const transitions = entry.transitions?.length
      ? entry.transitions
      : [entry.transition].filter(Boolean);
    return transitions.map((transition, transitionIndex) => ({
      ...entry,
      transitions,
      transition,
      transitionIndex
    }));
  }).forEach((entry) => {
    const effectiveAt = timeValue(entry.transition.effectiveAt, "contract cutover effectiveAt");
    const sunsetAt = timeValue(entry.transition.sunsetAt, "contract cutover sunsetAt");
    const oldDispatches = dispatches.filter((item) => (
      item.laneId === entry.laneId && item.contract === entry.transition.fromContract
    ));
    const outstanding = oldDispatches.filter(isOutstanding);
    const staleSuccessors = [];
    const allowedSuccessorContracts = new Set(
      entry.transitions.slice(entry.transitionIndex).map((item) => item.toContract)
    );
    oldDispatches.filter((item) => item.recovery?.state === "requeued").forEach((item) => {
      const successor = dispatches.find((candidate) => candidate.id === item.recovery.successorDispatchId);
      if (!successor
        || successor.predecessorDispatchId !== item.id
        || !allowedSuccessorContracts.has(successor.contract)) {
        staleSuccessors.push({ predecessor: item, successor });
      }
    });
    const afterEffective = nowValue >= effectiveAt;
    const afterSunset = nowValue >= sunsetAt;
    if (afterEffective) {
      outstanding.forEach((dispatch) => issues.push(cutoverIssue(
        afterSunset ? "P0" : "P1",
        afterSunset ? "contract-cutover-backlog-after-sunset" : "contract-cutover-backlog",
        entry,
        dispatch,
        `${dispatch.deliveryState} work still uses ${entry.transition.fromContract}.`,
        afterSunset
          ? "Quarantine the retired task and create an authorized successor on the active contract."
          : "Complete delivery or create an authorized active-contract successor before sunset."
      )));
      staleSuccessors.forEach(({ predecessor, successor }) => issues.push(cutoverIssue(
        "P0",
        "contract-cutover-successor-stale",
        entry,
        predecessor,
        successor
          ? `Recovery successor ${successor.id} does not use a later governed contract.`
          : `Recovery successor ${predecessor.recovery.successorDispatchId} is missing.`,
        "Repair the signed recovery relationship and create exactly one successor on the active contract."
      )));
    }
    const status = !afterEffective
      ? "scheduled"
      : afterSunset
        ? (outstanding.length || staleSuccessors.length ? "blocked-after-sunset" : "completed")
        : (outstanding.length || staleSuccessors.length ? "draining" : "ready-for-sunset");
    lanes.push({
      laneId: entry.laneId,
      transitionIndex: entry.transitionIndex,
      fromContract: entry.transition.fromContract,
      toContract: entry.transition.toContract,
      effectiveAt: entry.transition.effectiveAt,
      sunsetAt: entry.transition.sunsetAt,
      status,
      hoursUntilSunset: Math.floor((sunsetAt - nowValue) / 3600000),
      historicalCompleted: oldDispatches.filter((item) => (
        item.deliveryState === "delivered"
        || (item.deliveryState === "dead-letter" && item.recovery?.state === "requeued")
      )).length,
      outstanding: outstanding.length,
      staleSuccessors: staleSuccessors.length
    });
  });

  const summary = {
    transitionLanes: new Set(lanes.map((item) => item.laneId)).size,
    transitionTracks: lanes.length,
    scheduled: lanes.filter((item) => item.status === "scheduled").length,
    draining: lanes.filter((item) => item.status === "draining").length,
    readyForSunset: lanes.filter((item) => item.status === "ready-for-sunset").length,
    completed: lanes.filter((item) => item.status === "completed").length,
    outstanding: lanes.reduce((sum, item) => sum + item.outstanding, 0),
    staleSuccessors: lanes.reduce((sum, item) => sum + item.staleSuccessors, 0)
  };
  return {
    generatedAt: new Date(nowValue).toISOString(),
    ok: issues.every((item) => item.severity !== "P0"),
    functionalState: "external-contract-cutover-backlog-governed",
    lanes,
    issues,
    summary,
    productionReady: false,
    blockers: [
      ...issues.map((item) => `${item.code}:${item.dispatchId || item.laneId}`),
      "A clear cutover backlog does not replace deployed release digests, joint testing or site acceptance."
    ]
  };
}

module.exports = {
  buildPublicHealthExternalContractCutoverBoard,
  isOutstanding
};
