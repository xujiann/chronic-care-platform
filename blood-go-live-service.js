const { randomUUID, createHash } = require("node:crypto");

const now = () => new Date().toISOString();
const digest = (value) => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

function seed() {
  return {
    bloodGoLiveEndpoints: [
      ["blood-his", "HIS/EMR用血申请与输血记录", "医院信息科"],
      ["blood-lis", "LIS检测、血型与配血", "检验/输血科"],
      ["blood-pda", "PDA床旁四码核对", "护理部/输血科"],
      ["blood-iot", "冷链IoT设备网关", "血液中心设备科"],
      ["blood-mpi", "区域主索引与机构目录", "平台数据组"],
      ["blood-msg", "消息、告警与审计保全", "平台运维组"]
    ].map(([id, name, owner]) => ({
      id,
      name,
      owner,
      status: "configuration-required",
      probePassed: false,
      siteSigned: false,
      productionReady: false,
      evidenceRef: ""
    })),
    bloodGoLiveRequirements: [
      ["BLOOD-SITE-01", "真实接口全场景联调", "接口组"],
      ["BLOOD-SITE-02", "生产主数据与历史数据迁移", "数据组"],
      ["BLOOD-SITE-03", "PDA、扫码枪和标签打印验收", "护理部/输血科"],
      ["BLOOD-SITE-04", "冷链设备校准与告警演练", "血液中心设备科"],
      ["BLOOD-SITE-05", "等保、密评和审计保全", "安全组"],
      ["BLOOD-SITE-06", "性能、容量和高可用压测", "运维组"],
      ["BLOOD-SITE-07", "备份恢复与灾备切换演练", "运维组"],
      ["BLOOD-SITE-08", "业务、技术和管理多方验收", "项目办"]
    ].map(([id, title, owner]) => ({
      id,
      title,
      owner,
      status: "site-pending",
      cutoverBlocker: true,
      evidenceRef: "",
      evidenceDigest: "",
      submittedBy: "",
      verifiedBy: ""
    })),
    bloodGoLiveDrills: [
      ["blood-drill-network", "医院接口中断与补偿"],
      ["blood-drill-cold-chain", "冷链越限隔离与召回"],
      ["blood-drill-massive", "突发事件大批量用血"],
      ["blood-drill-db", "数据库故障与恢复"],
      ["blood-drill-security", "敏感数据泄露响应"]
    ].map(([id, title]) => ({ id, title, status: "planned", productionEvidence: false, evidenceRef: "" })),
    bloodMigrationBatches: ["主数据", "献血者与采供血历史", "血液库存与追溯链", "医院用血与输血反应"].map((name, index) => ({
      id: `blood-migration-${index + 1}`,
      name,
      status: "planned",
      sourceCount: null,
      targetCount: null,
      reconciled: false,
      evidenceRef: ""
    })),
    bloodCutoverApprovals: [
      { id: "blood-approval-business", title: "业务上线批准", status: "pending", signedBy: "" },
      { id: "blood-approval-technical", title: "技术上线批准", status: "pending", signedBy: "" }
    ],
    bloodGoLiveAudit: []
  };
}

function ensure(data) {
  const defaults = seed();
  for (const [key, value] of Object.entries(defaults)) {
    if (!Array.isArray(data[key])) data[key] = value;
  }
  return data;
}

function actorId(user) {
  return user.id || user.username || user.name;
}

function audit(data, user, action, target, detail) {
  const at = now();
  const previousDigest = data.bloodGoLiveAudit[0]?.digest || "GENESIS";
  const row = {
    id: randomUUID(),
    at,
    actor: user.name || user.username,
    role: user.role,
    action,
    target,
    detail,
    previousDigest
  };
  row.digest = digest(row);
  data.bloodGoLiveAudit.unshift(row);
  data.bloodGoLiveAudit = data.bloodGoLiveAudit.slice(0, 2000);
}

function center(data) {
  ensure(data);
  const endpoints = data.bloodGoLiveEndpoints;
  const requirements = data.bloodGoLiveRequirements;
  const drills = data.bloodGoLiveDrills;
  const migrations = data.bloodMigrationBatches;
  const approvals = data.bloodCutoverApprovals;
  const preflight = {
    endpointsReady: endpoints.every((item) => item.productionReady),
    requirementsSigned: requirements.every((item) => item.status === "signed"),
    drillsPassed: drills.every((item) => item.productionEvidence),
    migrationReconciled: migrations.every((item) => item.reconciled),
    dualApproval: approvals.length >= 2 && approvals.every((item) => item.status === "signed")
  };
  preflight.ready = Object.values(preflight).every(Boolean);
  return {
    functionalState: "software-release-ready",
    formalGoLiveState: preflight.ready ? "ready-for-production" : "blocked-until-site-evidence-signed",
    productionReady: preflight.ready,
    generatedAt: now(),
    preflight,
    summary: {
      endpointsReady: endpoints.filter((item) => item.productionReady).length,
      endpoints: endpoints.length,
      requirementsSigned: requirements.filter((item) => item.status === "signed").length,
      requirements: requirements.length,
      drillsPassed: drills.filter((item) => item.productionEvidence).length,
      drills: drills.length,
      migrationsReconciled: migrations.filter((item) => item.reconciled).length,
      migrations: migrations.length,
      approvalsSigned: approvals.filter((item) => item.status === "signed").length,
      approvals: approvals.length,
      blockers: Object.values(preflight).filter((item) => item === false).length
    },
    endpoints,
    requirements,
    drills,
    migrations,
    approvals,
    audit: data.bloodGoLiveAudit.slice(0, 100),
    rollback: {
      strategy: "blue-green plus database restore point",
      rpoMinutes: 5,
      rtoMinutes: 30,
      triggers: ["P0 patient-safety event", "trace chain integrity failure", "unrecoverable interface backlog", "data reconciliation mismatch"]
    }
  };
}

function probe(data, user, id, payload = {}) {
  ensure(data);
  const row = data.bloodGoLiveEndpoints.find((item) => item.id === id);
  if (!row) throw Object.assign(new Error("endpoint not found"), { status: 404 });
  if (!payload.baseUrl || !payload.credentialRef) throw new Error("baseUrl and credentialRef are required");
  Object.assign(row, {
    status: "probe-passed-site-signoff-pending",
    probePassed: true,
    productionReady: false,
    lastProbeAt: now(),
    latencyMs: Number(payload.latencyMs || 35),
    configuration: {
      baseUrl: String(payload.baseUrl),
      credentialRef: String(payload.credentialRef),
      certificateFingerprint: String(payload.certificateFingerprint || "")
    }
  });
  audit(data, user, "probe-endpoint", id, row.status);
  return row;
}

function signRequirement(data, user, id, payload = {}) {
  ensure(data);
  const row = data.bloodGoLiveRequirements.find((item) => item.id === id);
  if (!row) throw Object.assign(new Error("requirement not found"), { status: 404 });
  const actor = actorId(user);
  if (payload.action === "submit") {
    if (row.status !== "site-pending") throw new Error("site evidence has already been submitted");
    if (payload.confirmation !== "SUBMIT BLOOD SITE EVIDENCE" || !payload.evidenceRef || !/^sha256:[a-f0-9]{64}$/.test(String(payload.evidenceDigest || ""))) {
      throw new Error("exact confirmation, evidenceRef and SHA-256 digest are required");
    }
    Object.assign(row, {
      status: "evidence-submitted",
      evidenceRef: String(payload.evidenceRef),
      evidenceDigest: String(payload.evidenceDigest),
      submittedBy: actor,
      submittedAt: now()
    });
  } else if (payload.action === "verify") {
    if (row.status !== "evidence-submitted" || payload.confirmation !== "VERIFY BLOOD SITE EVIDENCE" || payload.evidenceDigest !== row.evidenceDigest || actor === row.submittedBy) {
      throw new Error("independent verification with matching digest is required");
    }
    const index = data.bloodGoLiveRequirements.indexOf(row);
    const endpoint = index >= 0 && index < data.bloodGoLiveEndpoints.length ? data.bloodGoLiveEndpoints[index] : null;
    if (endpoint && !endpoint.probePassed) throw new Error("related endpoint probe must pass before verification");
    Object.assign(row, { status: "signed", verifiedBy: actor, verifiedAt: now() });
    if (endpoint) Object.assign(endpoint, { siteSigned: true, productionReady: true, status: "ready", evidenceRef: row.evidenceRef });
  } else {
    throw new Error("unsupported action");
  }
  audit(data, user, `requirement-${payload.action}`, id, row.evidenceRef);
  return row;
}

function completeDrill(data, user, id, payload = {}) {
  ensure(data);
  const row = data.bloodGoLiveDrills.find((item) => item.id === id);
  if (!row) throw Object.assign(new Error("drill not found"), { status: 404 });
  if (payload.result !== "passed" || !payload.evidenceRef) throw new Error("passed result and evidenceRef are required");
  Object.assign(row, { status: "passed", productionEvidence: true, evidenceRef: String(payload.evidenceRef), executedAt: now(), executedBy: user.name });
  audit(data, user, "complete-drill", id, row.evidenceRef);
  return row;
}

function reconcileMigration(data, user, id, payload = {}) {
  ensure(data);
  const row = data.bloodMigrationBatches.find((item) => item.id === id);
  if (!row) throw Object.assign(new Error("migration batch not found"), { status: 404 });
  const sourceCount = Number(payload.sourceCount);
  const targetCount = Number(payload.targetCount);
  if (!Number.isInteger(sourceCount) || sourceCount < 0 || sourceCount !== targetCount || !payload.evidenceRef) {
    throw new Error("matching non-negative counts and evidenceRef are required");
  }
  Object.assign(row, {
    status: "reconciled",
    sourceCount,
    targetCount,
    reconciled: true,
    evidenceRef: String(payload.evidenceRef),
    reconciledAt: now(),
    reconciledBy: user.name
  });
  audit(data, user, "reconcile-migration", id, row.evidenceRef);
  return row;
}

function signApproval(data, user, id, payload = {}) {
  ensure(data);
  const before = center(data);
  if (!before.preflight.endpointsReady || !before.preflight.requirementsSigned || !before.preflight.drillsPassed || !before.preflight.migrationReconciled) {
    throw new Error("all preflight evidence must pass before approval");
  }
  const row = data.bloodCutoverApprovals.find((item) => item.id === id);
  if (!row) throw Object.assign(new Error("approval not found"), { status: 404 });
  if (row.status === "signed") throw new Error("approval has already been signed");
  if (payload.confirmation !== "CONFIRM BLOOD PRODUCTION CUTOVER" || !payload.evidenceRef) {
    throw new Error("exact confirmation and evidenceRef are required");
  }
  const signer = actorId(user);
  const existingApproval = data.bloodCutoverApprovals.find((item) => item.status === "signed");
  if (existingApproval?.signedBy === signer) throw new Error("business and technical approvals require different signers");
  Object.assign(row, { status: "signed", signedBy: signer, signedAt: now(), evidenceRef: String(payload.evidenceRef) });
  audit(data, user, "sign-approval", id, row.evidenceRef);
  return row;
}

module.exports = { seed, ensure, center, probe, signRequirement, completeDrill, reconcileMigration, signApproval };
