"use strict";

const FORBIDDEN_PUBLIC_FIELD = /^(?:(?:object|physical|storage)[_-]?path|object[_-]?key|access[_-]?url|signed[_-]?url|(?:access|refresh)?[_-]?token|authorization|api[_-]?key|secrets?|passwords?|credentials?|credential[_-]?ref|private[_-]?key|signatures?|signing[_-]?keys?|signature[_-]?keys?|certificate[_-]?fingerprint|endpoint|base[_-]?url|bucket(?:Name)?|containerName)$/i;
const SENSITIVE_QUERY_PARAMETER = /^(?:token|access_?token|refresh_?token|signature|sig|key|api_?key|secret|password|credential)$/i;
const PHYSICAL_LOCATION = /(?:\b(?:s3|oss|cos|obs|file):\/\/|(?:^|[\s"'(])[A-Za-z]:\\|(?:^|[\s"'(])\/(?:var|srv|opt|run|mnt|data|tmp)\/)/i;
const AUTHORIZATION_VALUE = /\b(?:bearer|basic)\s+[A-Za-z0-9+/=_\-.]+/i;
const URL_VALUE = /https?:\/\/[^\s"'<>]+/gi;

function sanitizeUrl(value, { allowViewerUrl = false } = {}) {
  try {
    const parsed = new URL(String(value));
    if (!new Set(["http:", "https:"]).has(parsed.protocol)) return "";
    parsed.username = "";
    parsed.password = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_QUERY_PARAMETER.test(key)) parsed.searchParams.delete(key);
    }
    parsed.hash = "";
    return allowViewerUrl ? parsed.toString() : "[redacted-url]";
  } catch {
    return "";
  }
}

function sanitizePublicString(value, options = {}) {
  const text = String(value);
  if (AUTHORIZATION_VALUE.test(text) || PHYSICAL_LOCATION.test(text)) {
    return "[redacted-sensitive-detail]";
  }
  return text.replace(URL_VALUE, (url) => sanitizeUrl(url, options) || "[redacted-url]");
}

function projectPublicImagingResponse(value, options = {}) {
  if (Array.isArray(value)) return value.map((item) => projectPublicImagingResponse(item, options));
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? sanitizePublicString(value, options) : value;
  }
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_PUBLIC_FIELD.test(key)) continue;
    if (key === "viewerUrl" && !options.allowViewerUrl) continue;
    output[key] = projectPublicImagingResponse(item, options);
  }
  return output;
}

function projectImagingDashboardResponse(value) {
  const dashboard = value && typeof value === "object" ? value : {};
  return projectPublicImagingResponse({
    ...dashboard,
    studies: Array.isArray(dashboard.studies) ? dashboard.studies : [],
    mutualRecognition: Array.isArray(dashboard.mutualRecognition) ? dashboard.mutualRecognition : [],
    shares: Array.isArray(dashboard.shares) ? dashboard.shares : []
  });
}

function projectImagingViewerResponse(value) {
  const source = value && typeof value === "object" ? value : {};
  return projectPublicImagingResponse({
    studyId: source.studyId,
    studyInstanceUID: source.studyInstanceUID,
    viewerUrl: source.viewerUrl,
    viewer: source.viewer,
    archive: source.archive,
    expiresAt: source.expiresAt ?? null
  }, { allowViewerUrl: true });
}

function projectImagingErrorResponse(value) {
  const source = value && typeof value === "object" ? value : {};
  return projectPublicImagingResponse({
    error: source.error || "Imaging Request Failed",
    code: source.code,
    message: source.message || "The imaging request could not be completed.",
    productionReady: source.productionReady
  });
}

module.exports = {
  projectImagingDashboardResponse,
  projectImagingErrorResponse,
  projectImagingViewerResponse,
  projectPublicImagingResponse,
  sanitizePublicString
};
