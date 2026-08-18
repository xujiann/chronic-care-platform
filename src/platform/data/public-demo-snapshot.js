"use strict";

const { createHmac, randomBytes } = require("node:crypto");

const MASK_RULES = [
  { pattern: /^(idCard|documentNo|motherDocumentNo|fatherDocumentNo|certificateNo|credentialNo|personIndex|identityIndex)$/i, replacement: "DEMO-ID" },
  { pattern: /(phone|mobile|tel)$/i, replacement: "DEMO-MOBILE" },
  { pattern: /address$/i, replacement: "演示地址" },
  { pattern: /contact$/i, replacement: "演示联系人" }
];

const OMIT_RULES = [
  /^(password|passwordHash|accessToken|refreshToken|token|secret|clientSecret|privateKey|apiKey|sessionId|csrfToken)$/i,
  /(password|credentialSecret|signingSecret|encryptionSecret)$/i
];

const PERSONAL_NAME_RULE = { pattern: /^(applicantName|authorName|byName|callerName|createdByName|custodianName|deceasedName|doctorName|fatherName|leaderDoctorName|motherName|newbornName|nurseName|patientName|residentName|signerName)$/i, replacement: "演示姓名" };
const PERSONAL_NAME_CONTAINERS = new Set(["accounts", "authUsers", "doctors", "nurses", "patients", "residents"]);

function stableToken(value, maskSecret) {
  return createHmac("sha256", maskSecret).update(String(value)).digest("hex").slice(0, 8).toUpperCase();
}

function reportPath(pathSegments, key) {
  return [...pathSegments.filter((segment) => !/^\d+$/.test(segment)), key].join(".");
}

function sanitizeValue(value, pathSegments, report, maskSecret) {
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeValue(item, [...pathSegments, String(index)], report, maskSecret));
  }
  if (!value || typeof value !== "object") return value;

  const sanitized = {};
  Object.entries(value).forEach(([key, entryValue]) => {
    if (OMIT_RULES.some((rule) => rule.test(key))) {
      const keyPath = reportPath(pathSegments, key);
      report.fieldsRemoved[keyPath] = (report.fieldsRemoved[keyPath] || 0) + 1;
      report.totalRemoved += 1;
      return;
    }

    const personalName = PERSONAL_NAME_RULE.pattern.test(key)
      || (key.toLowerCase() === "name" && pathSegments.some((segment) => PERSONAL_NAME_CONTAINERS.has(segment)));
    const rule = personalName ? PERSONAL_NAME_RULE : MASK_RULES.find((item) => item.pattern.test(key));
    if (rule && entryValue !== undefined && entryValue !== null && String(entryValue).trim() !== "") {
      const keyPath = reportPath(pathSegments, key);
      report.fieldsMasked[keyPath] = (report.fieldsMasked[keyPath] || 0) + 1;
      report.totalMasked += 1;
      sanitized[key] = `${rule.replacement}-${stableToken(entryValue, maskSecret)}`;
      return;
    }
    sanitized[key] = sanitizeValue(entryValue, [...pathSegments, key], report, maskSecret);
  });
  return sanitized;
}

function sanitizeSnapshot(snapshot, options = {}) {
  const maskSecret = options.maskSecret || randomBytes(32);
  const report = {
    classification: options.classification || "SANITIZED_EXPORT",
    fieldsMasked: {},
    fieldsRemoved: {},
    totalMasked: 0,
    totalRemoved: 0
  };
  return { snapshot: sanitizeValue(snapshot, [], report, maskSecret), report };
}

function buildPublicDemoSnapshot(snapshot, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const result = sanitizeSnapshot(snapshot, { classification: "PUBLIC_DEMO", maskSecret: options.maskSecret });
  result.snapshot.storageMeta = {
    ...(result.snapshot.storageMeta || {}),
    publicDemoSnapshot: {
      schemaVersion: 1,
      generatedAt,
      classification: result.report.classification,
      totalMasked: result.report.totalMasked,
      totalRemoved: result.report.totalRemoved
    }
  };
  return result;
}

module.exports = {
  MASK_RULES,
  OMIT_RULES,
  PERSONAL_NAME_RULE,
  buildPublicDemoSnapshot,
  sanitizeSnapshot,
  stableToken
};
