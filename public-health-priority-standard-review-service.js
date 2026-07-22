const { createHmac, timingSafeEqual } = require("node:crypto");

const PRIORITY_STANDARD_REVIEW_TRACKS = [
  {
    id: "phpsr-infectious",
    name: "传染病发现与直报",
    domainIds: ["ph-infectious"],
    leadOwner: "疾控中心传染病监测部门",
    ownerRole: "cdc",
    collaborators: ["医院发热门诊", "院感部门", "检验科", "医院信息科"],
    dataCollections: ["publicHealthEvents", "phase2DiseaseReportQueue", "phase2DiseaseReportReceipts"],
    interfaces: ["EMR/LIS 信号", "传染病网络直报", "疾控回执"],
    artifactEvidence: ["public-health-event-reporting-service.js", "scripts/public-health-event-reporting-readiness.js", "docs/public-health-event-reporting-closure.md"]
  },
  {
    id: "phpsr-immunization",
    name: "免疫规划",
    domainIds: ["ph-immunization"],
    leadOwner: "疾控免疫规划部门",
    ownerRole: "cdc",
    collaborators: ["预防接种门诊", "基层医疗卫生机构", "妇幼保健机构", "疫苗冷链团队"],
    dataCollections: ["birthCertificates", "publicHealthEvents"],
    interfaces: ["预防接种系统", "出生证照", "预约与冷链回执", "AEFI 监测"],
    artifactEvidence: ["immunization-schedule.js", "scripts/immunization-readiness.js", "docs/immunization-program-2026.md"]
  },
  {
    id: "phpsr-maternal-child",
    name: "妇幼健康",
    domainIds: ["ph-maternal-child"],
    leadOwner: "妇幼保健机构/妇幼健康处",
    ownerRole: "maternal-child",
    collaborators: ["医疗机构", "医政部门", "电子证照平台主管部门", "公安出生登记"],
    dataCollections: ["birthCertificates", "birthStatistics", "personalRecords"],
    interfaces: ["妇幼保健系统", "出生医学证明", "电子证照", "公安共享"],
    artifactEvidence: ["scripts/maternal-child-readiness.js", "docs/maternal-child-policy.md", "docs/妇幼健康主要功能报告.md"]
  },
  {
    id: "phpsr-senior",
    name: "老年健康",
    domainIds: ["ph-senior"],
    leadOwner: "基层医疗卫生机构",
    ownerRole: "primary-care",
    collaborators: ["民政部门", "医养结合机构", "家庭医生团队"],
    dataCollections: ["seniorServices", "personalRecords", "followups"],
    interfaces: ["老年健康服务", "医养结合", "居民健康档案"],
    artifactEvidence: ["scripts/chronic-followup-readiness.js", "docs/chronic-followup-readiness.md"]
  },
  {
    id: "phpsr-chronic",
    name: "慢性病防控",
    domainIds: ["ph-chronic"],
    leadOwner: "基层卫生部门/疾控慢病部门",
    ownerRole: "primary-care",
    collaborators: ["家庭医生团队", "医院专科", "药房", "居民服务团队"],
    dataCollections: ["chronicScreeningTasks", "chronicManagementPlans", "followups"],
    interfaces: ["慢病平台", "家庭医生签约", "死因监测"],
    artifactEvidence: ["scripts/chronic-followup-readiness.js", "docs/chronic-followup-readiness.md", "docs/chronic-institution-interfaces.md"]
  },
  {
    id: "phpsr-public-health-followup",
    name: "基本公卫随访",
    domainIds: ["ph-chronic", "ph-archive"],
    leadOwner: "基层公卫专班",
    ownerRole: "primary-care",
    collaborators: ["家庭医生团队", "疾控慢病部门", "居民健康档案管理部门"],
    dataCollections: ["followups", "taskMessages", "personalRecords"],
    interfaces: ["基层公卫系统", "居民健康档案", "居民端提醒"],
    artifactEvidence: ["scripts/chronic-followup-readiness.js", "docs/chronic-followup-readiness.md"]
  },
  {
    id: "phpsr-health-education",
    name: "健康教育",
    domainIds: ["ph-health-education"],
    leadOwner: "疾控健康教育部门/基层机构",
    ownerRole: "cdc",
    collaborators: ["慢病团队", "妇幼团队", "免疫规划团队", "居民服务团队"],
    dataCollections: ["chronicEducationPushes", "publicHealthEvents"],
    interfaces: ["健康教育平台", "居民端消息", "活动效果评价"],
    artifactEvidence: ["scripts/chronic-followup-readiness.js", "docs/公共卫生信息化系统建设报告.md"]
  },
  {
    id: "phpsr-family-doctor",
    name: "家庭医生协同",
    domainIds: ["ph-chronic", "ph-archive"],
    leadOwner: "基层卫生部门/家庭医生团队",
    ownerRole: "primary-care",
    collaborators: ["基层公卫专班", "疾控慢病部门", "居民服务团队"],
    dataCollections: ["phase2FamilyDoctorApplications", "phase2FamilyDoctorContracts", "phase2FamilyDoctorFulfillments", "followups"],
    interfaces: ["家庭医生签约", "服务履约", "公卫随访回写", "居民端申请"],
    artifactEvidence: ["scripts/phase2-family-doctor-readiness.js", "scripts/chronic-followup-readiness.js", "docs/chronic-followup-readiness.md"]
  }
];

const REVIEW_ACTIONS = {
  "confirm-responsibility": { from: ["draft"], to: "owner-confirmed", roles: ["commission", "cdc", "institution", "primary-care", "maternal-child"] },
  "review-standard-mapping": { from: ["owner-confirmed"], to: null, roles: ["commission", "cdc"] },
  "link-site-evidence": { from: ["mapping-reviewed", "site-evidence-linked"], to: "site-evidence-linked", roles: ["commission", "cdc"] }
};

const TRUSTED_SITE_EVIDENCE_SOURCES = new Set(["server-evidence-store", "trusted-signature-service"]);
const TRUSTED_SIGNATURE_ALGORITHMS = new Set(["SM2/SM3", "RSA-SHA256", "ECDSA-SHA256"]);
const TRUSTED_EVIDENCE_RECEIPT_VERSION = "ph-site-evidence-v1";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clean(value) {
  return String(value ?? "").trim();
}

function roleOf(user = {}) {
  const role = clean(user.role || user.roleName).toLowerCase();
  if (["health-admin", "public-health-admin", "commission"].includes(role)) return "commission";
  if (["cdc", "disease-control"].includes(role)) return "cdc";
  if (["hospital", "institution"].includes(role)) return "institution";
  if (["primary-care", "family-doctor"].includes(role)) return "primary-care";
  if (["maternal-child", "mch"].includes(role)) return "maternal-child";
  return role || "anonymous";
}

function actorName(user = {}) {
  return clean(user.name || user.username || "standard reviewer");
}

function sameValues(actual = [], expected = []) {
  const left = Array.from(new Set(actual.map(clean).filter(Boolean))).sort();
  const right = Array.from(new Set(expected.map(clean).filter(Boolean))).sort();
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasRows(data, key) {
  const value = data?.[key];
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value && typeof value === "object" && Object.keys(value).length > 0);
}

function findTrustedSiteEvidence(registry, evidenceId) {
  if (!registry || !evidenceId) return null;
  if (registry instanceof Map) return registry.get(evidenceId) || null;
  if (Array.isArray(registry)) return registry.find((item) => clean(item?.id) === evidenceId) || null;
  if (typeof registry === "object") return registry[evidenceId] || null;
  return null;
}

function normalizeArtifactDigest(value) {
  return clean(value).toLowerCase().replace(/^sha256:/, "");
}

function trustedEvidenceReceiptPayload(evidence = {}) {
  const attestation = evidence.trustedVerification || {};
  return [
    TRUSTED_EVIDENCE_RECEIPT_VERSION,
    clean(evidence.id),
    clean(evidence.templateId),
    clean(evidence.artifactName),
    clean(evidence.status).toLowerCase(),
    clean(attestation.attestationOrigin).toLowerCase(),
    clean(attestation.verificationSource).toLowerCase(),
    attestation.signatureVerified === true ? "true" : "false",
    normalizeArtifactDigest(attestation.artifactDigest),
    clean(attestation.signedBy),
    clean(attestation.algorithm).toUpperCase(),
    clean(attestation.keyId),
    clean(attestation.receiptId),
    clean(attestation.verifiedBy),
    clean(attestation.verifiedAt)
  ].join("\n");
}

function signTrustedSiteEvidenceReceipt(evidence, verificationSecret) {
  const secret = clean(verificationSecret);
  if (secret.length < 32) throw new Error("trusted evidence verification secret must be at least 32 characters");
  return createHmac("sha256", secret).update(trustedEvidenceReceiptPayload(evidence)).digest("hex");
}

function verifyTrustedSiteEvidenceReceipt(evidence, verificationSecret) {
  const signature = clean(evidence?.trustedVerification?.receiptSignature).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(signature) || clean(verificationSecret).length < 32) return false;
  const expected = signTrustedSiteEvidenceReceipt(evidence, verificationSecret);
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
}

function buildTrustedSiteEvidenceRegistry({ siteLaunchEvidence = [], verificationTasks = [], verificationSecret = "" } = {}) {
  const evidenceRows = Array.isArray(siteLaunchEvidence) ? siteLaunchEvidence : [];
  const tasks = Array.isArray(verificationTasks) ? verificationTasks : [];
  const verifiedTaskByEvidenceId = new Map(
    tasks.filter((item) => clean(item.status).toLowerCase() === "verified" && clean(item.evidenceId)).map((item) => [clean(item.evidenceId), item])
  );
  const registry = [];
  const rejected = [];
  evidenceRows.forEach((evidence) => {
    const evidenceId = clean(evidence?.id);
    const task = verifiedTaskByEvidenceId.get(evidenceId) || null;
    const attestation = evidence?.trustedVerification || {};
    const verificationSource = clean(attestation.verificationSource).toLowerCase();
    const algorithm = clean(attestation.algorithm).toUpperCase();
    const artifactDigest = normalizeArtifactDigest(attestation.artifactDigest);
    const receiptId = clean(attestation.receiptId);
    const reasons = [];
    if (!evidenceId || clean(evidence.status).toLowerCase() !== "verified" || !clean(evidence.artifactName)) reasons.push("verified evidence identity and artifact are required");
    if (!task) reasons.push("matching verified public health evidence task is required");
    if (task && clean(task.templateId) !== clean(evidence.templateId)) reasons.push("verification task template does not match evidence template");
    if (task && clean(task.verificationReceiptId) !== receiptId) reasons.push("server verification receipt does not match task receipt");
    if (clean(attestation.attestationOrigin).toLowerCase() !== "server-generated") reasons.push("attestation must be server-generated");
    if (!TRUSTED_SITE_EVIDENCE_SOURCES.has(verificationSource)) reasons.push("trusted verification source is required");
    if (attestation.signatureVerified !== true) reasons.push("server signature verification is required");
    if (!TRUSTED_SIGNATURE_ALGORITHMS.has(algorithm)) reasons.push("approved signature algorithm is required");
    if (!clean(attestation.keyId)) reasons.push("signature keyId is required");
    if (!/^[a-f0-9]{64}$/.test(artifactDigest)) reasons.push("SHA-256 artifact digest is required");
    if (!receiptId || !clean(attestation.verifiedBy) || !clean(attestation.verifiedAt) || !clean(attestation.signedBy)) reasons.push("server receipt, verifier, timestamp and signer are required");
    if (!verifyTrustedSiteEvidenceReceipt(evidence, verificationSecret)) reasons.push("valid server verification receipt signature is required");
    if (reasons.length) {
      rejected.push({ id: evidenceId || "missing-evidence-id", templateId: clean(evidence?.templateId), reasons });
      return;
    }
    registry.push({
      id: evidenceId,
      status: "verified",
      artifactName: clean(evidence.artifactName),
      signedBy: clean(attestation.signedBy),
      signatureVerified: true,
      verificationSource,
      artifactDigest,
      verifiedBy: clean(attestation.verifiedBy),
      verifiedAt: clean(attestation.verifiedAt),
      algorithm,
      keyId: clean(attestation.keyId),
      receiptId,
      receiptSignatureVerified: true,
      templateId: clean(evidence.templateId),
      verificationTaskId: clean(task.id)
    });
  });
  return {
    ok: rejected.length === 0,
    functionalState: registry.length ? "trusted-evidence-registry-built" : "trusted-evidence-pending",
    summary: {
      evidenceRows: evidenceRows.length,
      verifiedEvidenceRows: evidenceRows.filter((item) => clean(item?.status).toLowerCase() === "verified").length,
      verificationTasks: tasks.length,
      verifiedTasks: verifiedTaskByEvidenceId.size,
      trustedRecords: registry.length,
      rejectedRecords: rejected.length
    },
    registry,
    rejected,
    productionReady: false
  };
}

function verifyTrustedSiteEvidence(claimedEvidence, context = {}) {
  const evidenceId = clean(claimedEvidence?.id);
  const trusted = findTrustedSiteEvidence(context.trustedSiteEvidenceRegistry, evidenceId);
  if (!trusted) return { verified: false, blockerReason: "服务端可信证据仓尚无对应核验记录。" };
  const verificationSource = clean(trusted.verificationSource).toLowerCase();
  const artifactDigest = clean(trusted.artifactDigest).toLowerCase();
  const matched = clean(trusted.id) === evidenceId
    && clean(trusted.status).toLowerCase() === "verified"
    && clean(trusted.artifactName) === clean(claimedEvidence.artifactName)
    && clean(trusted.signedBy) === clean(claimedEvidence.signedBy)
    && trusted.signatureVerified === true
    && TRUSTED_SITE_EVIDENCE_SOURCES.has(verificationSource)
    && /^[a-f0-9]{64}$/.test(artifactDigest)
    && Boolean(clean(trusted.verifiedBy))
    && Boolean(clean(trusted.verifiedAt));
  if (!matched) return { verified: false, blockerReason: "服务端证据仓记录未通过来源、签名、摘要或字段一致性校验。" };
  return {
    verified: true,
    verification: {
      source: verificationSource,
      signatureVerified: true,
      artifactDigest,
      verifiedBy: clean(trusted.verifiedBy),
      verifiedAt: clean(trusted.verifiedAt)
    }
  };
}

function trustedSiteEvidenceForTrack(track, context = {}) {
  const evidence = track?.siteEvidence || {};
  if (!clean(evidence.id)) return { verified: false, blockerReason: "尚未登记现场材料。" };
  return verifyTrustedSiteEvidence({
    id: evidence.id,
    artifactName: evidence.artifactName,
    signedBy: evidence.claimedSignedBy
  }, context);
}

function hasTrustedSiteEvidenceAttestation(track, context = {}) {
  return trustedSiteEvidenceForTrack(track, context).verified;
}

function buildPriorityStandardReviewPack({ ledger = [], data = {}, artifactAvailability = {} } = {}) {
  const ledgerByDomain = new Map(ledger.map((item) => [item.standardDomainId, item]));
  const tracks = PRIORITY_STANDARD_REVIEW_TRACKS.map((definition) => {
    const domainEntries = definition.domainIds.map((id) => ledgerByDomain.get(id)).filter(Boolean);
    const missingDomainIds = definition.domainIds.filter((id) => !ledgerByDomain.has(id));
    const missingDataCollections = definition.dataCollections.filter((key) => !hasRows(data, key));
    const missingArtifacts = definition.artifactEvidence.filter((file) => artifactAvailability[file] !== true);
    const ownerAligned = domainEntries.every((entry) => clean(entry.owner)) && Boolean(clean(definition.leadOwner));
    const ledgerMappingComplete = domainEntries.length === definition.domainIds.length
      && domainEntries.every((entry) => Array.isArray(entry.dataCollections) && entry.dataCollections.length && Array.isArray(entry.interfaces) && entry.interfaces.length);
    const mappingReady = !missingDomainIds.length && !missingDataCollections.length && !missingArtifacts.length && ownerAligned && ledgerMappingComplete;
    return {
      ...clone(definition),
      version: 1,
      state: "draft",
      domainEntries: clone(domainEntries),
      missingDomainIds,
      missingDataCollections,
      missingArtifacts,
      ownerAligned,
      ledgerMappingComplete,
      mappingReady,
      ownerConfirmation: null,
      mappingReview: null,
      siteEvidence: null,
      siteEvidenceTrustStatus: "not-registered",
      formallyAccepted: false,
      timeline: [],
      nextAction: mappingReady ? "确认责任部门并执行标准映射复核。" : "补齐缺失标准域、数据集合或制品证据后再复核。"
    };
  });
  return summarizePack(tracks);
}

function summarizePack(tracks, context = {}) {
  const rows = clone(tracks).map((item) => {
    const trustResult = trustedSiteEvidenceForTrack(item, context);
    const siteEvidence = item.siteEvidence?.id ? {
      ...item.siteEvidence,
      trustStatus: trustResult.verified ? "trusted-verified" : "pending-server-verification",
      trustBlocker: trustResult.blockerReason || "",
      verification: trustResult.verification || null
    } : null;
    return {
      ...item,
      siteEvidence,
      siteEvidenceTrustStatus: siteEvidence?.trustStatus || "not-registered",
      formallyAccepted: trustResult.verified
    };
  });
  const mappingReady = rows.filter((item) => item.mappingReady).length;
  const mappingReviewed = rows.filter((item) => item.state === "mapping-reviewed" || item.state === "site-evidence-linked").length;
  const siteEvidenceRegistered = rows.filter((item) => item.siteEvidence?.id).length;
  const formallyAccepted = rows.filter((item) => item.formallyAccepted).length;
  const allTrustedEvidenceVerified = rows.length > 0 && formallyAccepted === rows.length;
  const productionBlockers = rows.filter((item) => !item.formallyAccepted).map((item) => ({
    id: `trusted-site-evidence:${item.id}`,
    trackId: item.id,
    trackName: item.name,
    status: item.siteEvidence?.id ? "evidence-registered-trust-pending" : "evidence-not-registered",
    reason: item.siteEvidence?.trustBlocker || "尚未登记现场材料并取得服务端可信证据仓核验结果。",
    requiredVerification: ["trusted source", "verified signature", "SHA-256 artifact digest", "server verifier", "verification timestamp"]
  }));
  return {
    tracks: rows,
    summary: {
      tracks: rows.length,
      standardDomains: new Set(rows.flatMap((item) => item.domainIds)).size,
      mappingReady,
      mappingReviewed,
      siteEvidenceRegistered,
      siteEvidencePending: rows.length - formallyAccepted,
      trustedEvidenceVerified: formallyAccepted,
      formallyAccepted,
      productionBlockers: productionBlockers.length
    },
    status: allTrustedEvidenceVerified
      ? "trusted-site-evidence-verified"
      : siteEvidenceRegistered === rows.length
        ? "site-evidence-registered-trust-pending"
      : mappingReviewed === rows.length
        ? "mapping-reviewed-site-evidence-pending"
        : mappingReady === rows.length
          ? "ready-for-owner-review"
          : "mapping-input-incomplete",
    productionBlockers,
    productionReady: allTrustedEvidenceVerified && productionBlockers.length === 0
  };
}

function authorize(action, user) {
  const definition = REVIEW_ACTIONS[action];
  if (!definition) throw new Error(`unsupported priority standard review action: ${action}`);
  const role = roleOf(user);
  if (!definition.roles.includes(role)) throw new Error(`role ${role} is not allowed to ${action}`);
  return { definition, role };
}

function existingIdempotentAction(track, action, idempotencyKey) {
  return (track.timeline || []).find((item) => item.action === action && item.idempotencyKey === idempotencyKey) || null;
}

function applyPriorityStandardReviewAction(current, payload = {}, user = {}, context = {}) {
  const track = clone(current);
  const action = clean(payload.action);
  const { definition, role } = authorize(action, user);
  const idempotencyKey = clean(payload.idempotencyKey);
  if (!idempotencyKey) throw new Error(`idempotencyKey is required for ${action}`);
  const duplicate = existingIdempotentAction(track, action, idempotencyKey);
  if (duplicate) return { track, history: duplicate, idempotent: true };
  if (!definition.from.includes(track.state)) throw new Error(`action ${action} is not allowed from state ${track.state}`);
  if (payload.expectedVersion !== undefined && Number(payload.expectedVersion) !== Number(track.version)) {
    throw new Error(`version conflict: expected ${payload.expectedVersion}, current ${track.version}`);
  }

  let nextState = definition.to || track.state;
  if (action === "confirm-responsibility") {
    if (role !== track.ownerRole && role !== "commission") {
      throw new Error(`role ${role} cannot confirm responsibility for ownerRole ${track.ownerRole}`);
    }
    const responsibleOwner = clean(payload.responsibleOwner);
    const collaborators = Array.isArray(payload.collaborators) ? payload.collaborators.map(clean).filter(Boolean) : [];
    if (!responsibleOwner || !collaborators.length || !clean(payload.note)) {
      throw new Error("responsibleOwner, collaborators and note are required to confirm responsibility");
    }
    track.ownerConfirmation = {
      responsibleOwner,
      collaborators,
      confirmedBy: actorName(user),
      confirmedAt: clean(payload.at || new Date().toISOString()),
      note: clean(payload.note)
    };
  }

  if (action === "review-standard-mapping") {
    if (!track.mappingReady) throw new Error("track mapping inputs must be complete before review");
    const reviewedDomainIds = Array.isArray(payload.reviewedDomainIds) ? payload.reviewedDomainIds : [];
    const reviewedDataCollections = Array.isArray(payload.reviewedDataCollections) ? payload.reviewedDataCollections : [];
    const reviewedInterfaces = Array.isArray(payload.reviewedInterfaces) ? payload.reviewedInterfaces : [];
    const evidenceRefs = Array.isArray(payload.evidenceRefs) ? payload.evidenceRefs.map(clean).filter(Boolean) : [];
    if (!sameValues(reviewedDomainIds, track.domainIds)) throw new Error("reviewedDomainIds must exactly match the track standard domains");
    if (!sameValues(reviewedDataCollections, track.dataCollections)) throw new Error("reviewedDataCollections must exactly match the track data collections");
    if (!sameValues(reviewedInterfaces, track.interfaces)) throw new Error("reviewedInterfaces must exactly match the track interfaces");
    if (!sameValues(evidenceRefs, track.artifactEvidence)) throw new Error("evidenceRefs must exactly match the available track artifacts");
    if (!clean(payload.note)) throw new Error("note is required for standard mapping review");
    track.mappingReview = {
      status: "reviewed",
      reviewedBy: actorName(user),
      reviewedAt: clean(payload.at || new Date().toISOString()),
      reviewedDomainIds: clone(reviewedDomainIds),
      reviewedDataCollections: clone(reviewedDataCollections),
      reviewedInterfaces: clone(reviewedInterfaces),
      evidenceRefs,
      note: clean(payload.note)
    };
    nextState = "mapping-reviewed";
  }

  if (action === "link-site-evidence") {
    const evidence = payload.siteEvidence || {};
    if (!clean(evidence.status) || !clean(evidence.id) || !clean(evidence.artifactName) || !clean(evidence.signedBy)) {
      throw new Error("site evidence material with status, id, artifactName and signedBy is required");
    }
    const trustResult = verifyTrustedSiteEvidence(evidence, context);
    track.siteEvidence = {
      id: clean(evidence.id),
      artifactName: clean(evidence.artifactName),
      claimedStatus: clean(evidence.status).toLowerCase(),
      claimedSignedBy: clean(evidence.signedBy),
      registeredBy: actorName(user),
      registeredAt: clean(payload.at || new Date().toISOString()),
      trustStatus: trustResult.verified ? "trusted-verified" : "pending-server-verification",
      trustBlocker: trustResult.blockerReason || "",
      verification: trustResult.verification || null
    };
    track.siteEvidenceTrustStatus = track.siteEvidence.trustStatus;
    track.formallyAccepted = trustResult.verified;
    track.nextAction = trustResult.verified
      ? "可信现场证据已核验，可进入后续全局上线审批。"
      : "等待服务端可信证据仓完成签名、摘要和核验人验证。";
  }

  const sequence = (track.timeline || []).length + 1;
  const history = {
    id: `${track.id}-history-${sequence}`,
    sequence,
    action,
    from: track.state,
    to: nextState,
    actor: actorName(user),
    role,
    at: clean(payload.at || new Date().toISOString()),
    idempotencyKey,
    note: clean(payload.note)
  };
  track.state = nextState;
  track.version = Number(track.version || 0) + 1;
  track.timeline = [...(track.timeline || []), history].slice(-30);
  track.lastAction = history;
  return { track, history, idempotent: false };
}

function runPriorityStandardReviewAcceptanceScenario(pack) {
  const reviewer = { name: "卫健标准复核员", role: "commission" };
  const reviewedTracks = pack.tracks.map((initial) => {
    let track = clone(initial);
    const owner = { name: `${track.leadOwner}责任人`, role: track.ownerRole };
    track = applyPriorityStandardReviewAction(track, {
      action: "confirm-responsibility",
      idempotencyKey: `${track.id}:owner`,
      responsibleOwner: track.leadOwner,
      collaborators: track.collaborators,
      note: "确认主责、协同部门和标准复核联系人。"
    }, owner).track;
    track = applyPriorityStandardReviewAction(track, {
      action: "review-standard-mapping",
      idempotencyKey: `${track.id}:mapping-review`,
      reviewedDomainIds: track.domainIds,
      reviewedDataCollections: track.dataCollections,
      reviewedInterfaces: track.interfaces,
      evidenceRefs: track.artifactEvidence,
      note: "完成标准域、数据集合、接口和现有制品证据复核；现场签字证据另行关联。"
    }, reviewer).track;
    return track;
  });
  return summarizePack(reviewedTracks);
}

module.exports = {
  PRIORITY_STANDARD_REVIEW_TRACKS,
  REVIEW_ACTIONS,
  applyPriorityStandardReviewAction,
  buildTrustedSiteEvidenceRegistry,
  buildPriorityStandardReviewPack,
  runPriorityStandardReviewAcceptanceScenario,
  summarizePack,
  hasTrustedSiteEvidenceAttestation,
  signTrustedSiteEvidenceReceipt,
  trustedEvidenceReceiptPayload,
  verifyTrustedSiteEvidenceReceipt,
  verifyTrustedSiteEvidence
};
