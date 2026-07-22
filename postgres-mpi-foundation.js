const { createHmac } = require("node:crypto");

const MPI_RULE_VERSION = "mpi-rules-v1";
const DEFAULT_HASH_KEY_VERSION = "mpi-hmac-v1";
const DEFAULT_NAMESPACE_KEY_VERSION = "mpi-namespace-v1";
const STRONG_IDENTIFIER_TYPES = new Set(["national-id", "health-code"]);

class MpiFoundationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "MpiFoundationError";
    this.code = code;
  }
}

function safeText(value, maxLength = 240) {
  return String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function normalizeIdentifier(value) {
  return safeText(value, 320).toUpperCase().replace(/[^0-9A-Z]/g, "");
}

function normalizeName(value) {
  return safeText(value, 160).toUpperCase().replace(/[\s·•.]/g, "");
}

function normalizeGender(value) {
  const normalized = safeText(value, 20).toLowerCase();
  if (["m", "male", "男", "1"].includes(normalized)) return "M";
  if (["f", "female", "女", "2"].includes(normalized)) return "F";
  return "U";
}

function normalizeDate(value) {
  const text = safeText(value, 40);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const timestamp = Date.parse(`${text}T00:00:00.000Z`);
  return Number.isFinite(timestamp) ? text : "";
}

function assertHashKey(hashKey) {
  const key = String(hashKey || "");
  if (Buffer.byteLength(key, "utf8") < 32) {
    throw new MpiFoundationError("MPI identity hashing requires a key of at least 32 bytes", "MPI_HASH_KEY_REQUIRED");
  }
  return key;
}

function normalizeKeyVersion(value, fallback = DEFAULT_HASH_KEY_VERSION) {
  const version = safeText(value || fallback, 80).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(version)) {
    throw new MpiFoundationError("MPI hashing key version must be an explicit safe identifier", "MPI_HASH_KEY_VERSION_REQUIRED");
  }
  return version;
}

function normalizeHashKeys(options = {}) {
  const supplied = Array.isArray(options.hashKeys) && options.hashKeys.length
    ? options.hashKeys
    : [{ version: options.hashKeyVersion || DEFAULT_HASH_KEY_VERSION, key: options.hashKey }];
  const versions = new Set();
  return supplied.map((item) => {
    const version = normalizeKeyVersion(item?.version);
    if (versions.has(version)) throw new MpiFoundationError(`Duplicate MPI hashing key version: ${version}`, "MPI_HASH_KEY_VERSION_DUPLICATE");
    versions.add(version);
    return { version, key: assertHashKey(item?.key) };
  });
}

function identityHash(type, authority, value, hashKey, hashKeyVersion = DEFAULT_HASH_KEY_VERSION) {
  const normalized = normalizeIdentifier(value);
  if (!normalized) return "";
  const key = assertHashKey(hashKey);
  const version = normalizeKeyVersion(hashKeyVersion);
  return createHmac("sha256", key)
    .update(`${version}\u0000${safeText(type, 40).toLowerCase()}\u0000${safeText(authority, 120).toUpperCase()}\u0000${normalized}`)
    .digest("hex");
}

function namespaceDigest(value, options = {}) {
  const key = assertHashKey(options.namespaceKey || options.hashKey);
  const version = normalizeKeyVersion(options.namespaceKeyVersion, DEFAULT_NAMESPACE_KEY_VERSION);
  return createHmac("sha256", key).update(`${version}\u0000${safeText(value, 640)}`).digest("hex");
}

function residentIdentifiers(resident = {}, options = {}) {
  const hashKeys = normalizeHashKeys(options);
  const defaultAuthority = safeText(options.defaultAuthority || resident.identityAuthority || "local-demo", 120);
  const definitions = [
    { type: "national-id", value: resident.idCard || resident.documentNo, authority: resident.documentAuthority || defaultAuthority, verificationStatus: resident.documentVerified === true ? "verified" : "declared" },
    { type: "health-code", value: resident.healthCode || resident.electronicHealthCode, authority: resident.healthCodeAuthority || defaultAuthority, verificationStatus: resident.healthCodeVerified === true ? "verified" : "declared" },
    { type: "mobile", value: resident.phone || resident.mobile, authority: resident.phoneAuthority || "telecom-unverified", verificationStatus: resident.phoneVerified === true ? "verified" : "declared" }
  ];
  return definitions.filter((item) => normalizeIdentifier(item.value)).flatMap((item) => hashKeys.map((hashKey) => ({
    type: item.type,
    authority: safeText(item.authority, 120),
    hashKeyVersion: hashKey.version,
    hash: identityHash(item.type, item.authority, item.value, hashKey.key, hashKey.version),
    verificationStatus: item.verificationStatus,
    strong: STRONG_IDENTIFIER_TYPES.has(item.type) && item.verificationStatus === "verified"
  })));
}

function buildResidentMatchProfile(resident = {}, options = {}) {
  return {
    residentId: safeText(resident.id || resident.residentId || resident.sourceRecordId, 160),
    mpiId: safeText(resident.mpiId, 80),
    name: normalizeName(resident.name),
    birthDate: normalizeDate(resident.birthDate || resident.dateOfBirth),
    gender: normalizeGender(resident.gender || resident.sex),
    address: safeText(resident.address, 320).toUpperCase(),
    identifiers: residentIdentifiers(resident, options)
  };
}

function identifiersByType(profile) {
  const grouped = new Map();
  (profile.identifiers || []).forEach((item) => grouped.set(item.type, [...(grouped.get(item.type) || []), item]));
  return grouped;
}

function compareIdentifierSet(left = [], right = [], requireStrong = false) {
  const eligibleLeft = requireStrong ? left.filter((item) => item.strong) : left;
  const eligibleRight = requireStrong ? right.filter((item) => item.strong) : right;
  const common = [];
  eligibleLeft.forEach((leftItem) => eligibleRight.forEach((rightItem) => {
    if (leftItem.hashKeyVersion === rightItem.hashKeyVersion) common.push([leftItem, rightItem]);
  }));
  return {
    comparable: common.length > 0,
    exact: common.some(([leftItem, rightItem]) => leftItem.hash === rightItem.hash)
  };
}

function compareMpiCandidate(incoming, candidate) {
  const incomingIds = identifiersByType(incoming);
  const candidateIds = identifiersByType(candidate);
  const exactStrong = [];
  const conflictingStrong = [];
  STRONG_IDENTIFIER_TYPES.forEach((type) => {
    const comparison = compareIdentifierSet(incomingIds.get(type), candidateIds.get(type), true);
    if (!comparison.comparable) return;
    if (comparison.exact) exactStrong.push(type);
    else conflictingStrong.push(type);
  });

  const reasons = [];
  let score = 0;
  if (exactStrong.length) {
    score += 100;
    reasons.push(...exactStrong.map((type) => `exact-verified-${type}`));
  }
  if (incoming.name && incoming.name === candidate.name) {
    score += 25;
    reasons.push("exact-name");
  }
  if (incoming.birthDate && incoming.birthDate === candidate.birthDate) {
    score += 30;
    reasons.push("exact-birth-date");
  }
  if (incoming.gender !== "U" && incoming.gender === candidate.gender) {
    score += 10;
    reasons.push("exact-gender");
  }
  const mobileComparison = compareIdentifierSet(incomingIds.get("mobile"), candidateIds.get("mobile"));
  if (mobileComparison.exact) {
    score += 20;
    reasons.push("exact-mobile-non-authoritative");
  }
  if (incoming.address && incoming.address === candidate.address) {
    score += 15;
    reasons.push("exact-address");
  }
  if (conflictingStrong.length) reasons.push(...conflictingStrong.map((type) => `conflicting-verified-${type}`));

  return {
    candidateResidentId: candidate.residentId,
    candidateMpiId: candidate.mpiId,
    score,
    exactStrong,
    conflictingStrong,
    reasons
  };
}

function resolveMpiMatch(incomingResident, candidateResidents = [], options = {}) {
  const incoming = buildResidentMatchProfile(incomingResident, options);
  const ranked = candidateResidents.map((candidate) => compareMpiCandidate(incoming, buildResidentMatchProfile(candidate, options)))
    .sort((left, right) => right.score - left.score || String(left.candidateResidentId).localeCompare(String(right.candidateResidentId)));
  const strongMatches = ranked.filter((item) => item.exactStrong.length && item.conflictingStrong.length === 0);
  const strongConflicts = ranked.filter((item) => item.exactStrong.length && item.conflictingStrong.length > 0);

  if (strongConflicts.length) {
    return { decision: "manual-review", reason: "verified-identity-conflict", ruleVersion: MPI_RULE_VERSION, candidates: ranked };
  }
  if (strongMatches.length === 1) {
    return { decision: "auto-link", reason: "single-exact-verified-identity", mpiId: strongMatches[0].candidateMpiId, ruleVersion: MPI_RULE_VERSION, candidates: ranked };
  }
  if (strongMatches.length > 1) {
    return { decision: "manual-review", reason: "verified-identity-collision", ruleVersion: MPI_RULE_VERSION, candidates: ranked };
  }
  if (ranked[0]?.score >= 70) {
    return { decision: "manual-review", reason: "demographic-candidate-only", ruleVersion: MPI_RULE_VERSION, candidates: ranked };
  }
  return { decision: "create-new", reason: "no-authoritative-match", ruleVersion: MPI_RULE_VERSION, candidates: ranked };
}

function buildMpiConflictCase(incomingResident, resolution, options = {}) {
  if (!resolution || resolution.decision !== "manual-review") return null;
  const sourceSystem = safeText(options.sourceSystem || incomingResident.sourceSystem || "unknown-source", 120);
  const sourceRecordId = safeText(incomingResident.id || incomingResident.residentId || incomingResident.sourceRecordId, 160);
  if (!sourceRecordId) throw new MpiFoundationError("Conflict work order requires a source record id", "MPI_CONFLICT_SOURCE_REQUIRED");
  const incomingRecordHash = namespaceDigest(`${sourceSystem}\u0000${sourceRecordId}`, options);
  const caseId = `mpicase_${namespaceDigest(`${MPI_RULE_VERSION}\u0000${resolution.reason}\u0000${incomingRecordHash}`, options).slice(0, 32)}`;
  return {
    caseId,
    incomingRecordHash,
    sourceSystem,
    ruleVersion: MPI_RULE_VERSION,
    status: "open",
    reason: resolution.reason,
    hashKeyVersions: normalizeHashKeys(options).map((item) => item.version),
    candidates: (resolution.candidates || []).map((item) => ({
      candidateMpiId: item.candidateMpiId,
      score: item.score,
      reasonCodes: item.reasons
    }))
  };
}

function createDeterministicMpiId(resident = {}, options = {}) {
  const sourceSystem = safeText(options.sourceSystem || resident.sourceSystem || "legacy-snapshot", 120);
  const sourceRecordId = safeText(resident.id || resident.residentId || resident.sourceRecordId, 160);
  if (!sourceRecordId) throw new MpiFoundationError("Resident source record id is required", "MPI_ID_SOURCE_REQUIRED");
  const seed = namespaceDigest(`${sourceSystem}\u0000${sourceRecordId}`, options);
  return `mpi_${seed.slice(0, 32)}`;
}

function buildMpiResidentRows(residents = [], options = {}) {
  const sourceSystem = safeText(options.sourceSystem || "legacy-snapshot", 120);
  const seenMpiIds = new Set();
  const seenIdentityKeys = new Map();
  const residentRows = [];
  const identifierRows = [];
  const provenanceRows = [];
  const conflicts = [];
  const conflictCaseRows = [];
  const conflictCandidateRows = [];
  const conflictCaseIndex = new Map();
  const namespaceKeyVersion = normalizeKeyVersion(options.namespaceKeyVersion, DEFAULT_NAMESPACE_KEY_VERSION);

  residents.forEach((resident) => {
    const sourceRecordId = safeText(resident.id || resident.residentId, 160);
    const mpiId = createDeterministicMpiId(resident, { ...options, sourceSystem });
    if (seenMpiIds.has(mpiId)) {
      conflicts.push({ type: "duplicate-mpi-id", sourceRecordHash: namespaceDigest(`${sourceSystem}\u0000${sourceRecordId}`, options), mpiId });
      return;
    }
    seenMpiIds.add(mpiId);
    residentRows.push({
      mpiId,
      sourceSystem,
      sourceRecordId,
      namespaceKeyVersion,
      canonicalName: safeText(resident.name, 160),
      birthDate: normalizeDate(resident.birthDate || resident.dateOfBirth),
      genderCode: normalizeGender(resident.gender || resident.sex),
      status: "active"
    });
    residentIdentifiers(resident, options).forEach((identifier) => {
      const uniquenessKey = `${identifier.type}\u0000${identifier.authority.toUpperCase()}\u0000${identifier.hashKeyVersion}\u0000${identifier.hash}`;
      if (identifier.strong && seenIdentityKeys.has(uniquenessKey) && seenIdentityKeys.get(uniquenessKey) !== mpiId) {
        const candidateMpiId = seenIdentityKeys.get(uniquenessKey);
        const sourceRecordHash = namespaceDigest(`${sourceSystem}\u0000${sourceRecordId}`, options);
        const mpiIds = [candidateMpiId, mpiId].sort();
        const logicalKey = `${identifier.type}\u0000${identifier.authority.toUpperCase()}\u0000${mpiIds.join("\u0000")}`;
        let conflict = conflictCaseIndex.get(logicalKey);
        if (!conflict) {
          const caseId = `mpicase_${namespaceDigest(`identifier-collision\u0000${logicalKey}`, options).slice(0, 32)}`;
          conflict = { type: "identifier-collision", identifierType: identifier.type, hashKeyVersions: [], sourceRecordHash, mpiIds, caseId };
          conflictCaseIndex.set(logicalKey, conflict);
          conflicts.push(conflict);
          conflictCaseRows.push({ caseId, incomingRecordHash: sourceRecordHash, sourceSystem, ruleVersion: MPI_RULE_VERSION, status: "open", reason: "verified-identity-collision", hashKeyVersions: "[]" });
          conflictCandidateRows.push({ candidateId: `${caseId}-${candidateMpiId}`.slice(0, 120), caseId, candidateMpiId, score: 100, decision: "manual-review", reasonCodes: JSON.stringify([`exact-${identifier.type}`, "identity-collision"]) });
        }
        if (!conflict.hashKeyVersions.includes(identifier.hashKeyVersion)) conflict.hashKeyVersions.push(identifier.hashKeyVersion);
        const caseRow = conflictCaseRows.find((item) => item.caseId === conflict.caseId);
        caseRow.hashKeyVersions = JSON.stringify(conflict.hashKeyVersions);
        return;
      }
      if (identifier.strong) seenIdentityKeys.set(uniquenessKey, mpiId);
      identifierRows.push({ mpiId, identifierType: identifier.type, issuingAuthority: identifier.authority, hashKeyVersion: identifier.hashKeyVersion, identifierHash: identifier.hash, verificationStatus: identifier.verificationStatus });
    });
    [
      ["canonical_name", safeText(resident.name, 160)],
      ["birth_date", normalizeDate(resident.birthDate || resident.dateOfBirth)],
      ["gender_code", normalizeGender(resident.gender || resident.sex)]
    ].filter(([, value]) => value).forEach(([attributeName, value]) => {
      provenanceRows.push({ mpiId, attributeName, sourceSystem, sourceRecordId, valueHashKeyVersion: namespaceKeyVersion, valueHash: namespaceDigest(value, options) });
    });
  });

  return { residentRows, identifierRows, provenanceRows, conflicts, conflictCaseRows, conflictCandidateRows };
}

module.exports = {
  DEFAULT_HASH_KEY_VERSION,
  DEFAULT_NAMESPACE_KEY_VERSION,
  MPI_RULE_VERSION,
  MpiFoundationError,
  buildMpiConflictCase,
  buildMpiResidentRows,
  buildResidentMatchProfile,
  compareMpiCandidate,
  createDeterministicMpiId,
  identityHash,
  normalizeDate,
  normalizeGender,
  normalizeIdentifier,
  normalizeHashKeys,
  normalizeKeyVersion,
  resolveMpiMatch,
  residentIdentifiers
};
