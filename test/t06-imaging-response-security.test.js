"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  projectImagingDashboardResponse,
  projectImagingErrorResponse,
  projectImagingViewerResponse,
  projectPublicImagingResponse
} = require("../src/http/routes/clinical-specialties/clinical-blood");

const FORBIDDEN_KEYS = /^(?:(?:object|physical|storage)[_-]?path|object[_-]?key|access[_-]?url|signed[_-]?url|(?:access|refresh)?[_-]?token|authorization|api[_-]?key|secrets?|passwords?|credentials?|credential[_-]?ref|private[_-]?key|signatures?|signing[_-]?keys?|signature[_-]?keys?|certificate[_-]?fingerprint|endpoint|base[_-]?url|bucket(?:Name)?|containerName)$/i;

function assertPublicBoundary(value, path = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPublicBoundary(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    assert.doesNotMatch(key, FORBIDDEN_KEYS, `${path}.${key} is a forbidden public field`);
    assertPublicBoundary(item, `${path}.${key}`);
  }
}

test("public imaging projection removes secrets and physical storage details recursively", () => {
  const response = projectPublicImagingResponse({
    id: "study-1",
    status: "available",
    objectPath: "oss://private-bucket/study-1/",
    nested: [{
      token: "IMG-SECRET",
      credentialRef: "vault://orthanc",
      certificateFingerprint: "private-fingerprint",
      detail: "upload failed at C:\\storage\\study-1"
    }]
  });

  assert.equal(response.id, "study-1");
  assert.equal(response.status, "available");
  assert.equal(response.nested[0].detail, "[redacted-sensitive-detail]");
  assertPublicBoundary(response);
  assert.doesNotMatch(JSON.stringify(response), /IMG-SECRET|private-bucket|vault:\/\/|C:\\storage/);
});

test("dashboard and error projections preserve business identifiers without exposing transport material", () => {
  const dashboard = projectImagingDashboardResponse({
    summary: { studies: 1 },
    studies: [{ id: "study-1", accessionNumber: "ACC-1", viewerUrl: "https://viewer.local/?token=secret", objectPath: "s3://bucket/key" }],
    shares: [{ id: "share-1", studyId: "study-1", status: "active", token: "IMG-SECRET" }]
  });
  assert.deepEqual(dashboard.studies, [{ id: "study-1", accessionNumber: "ACC-1" }]);
  assert.deepEqual(dashboard.shares, [{ id: "share-1", studyId: "study-1", status: "active" }]);

  const error = projectImagingErrorResponse({
    error: "FHIR Sync Failed",
    code: "FHIR_UNAVAILABLE",
    message: "Bearer abc.secret failed for https://user:pass@internal.local/fhir?access_token=secret",
    objectPath: "/var/lib/imaging/study-1"
  });
  assert.equal(error.error, "FHIR Sync Failed");
  assert.equal(error.code, "FHIR_UNAVAILABLE");
  assert.equal(error.message, "[redacted-sensitive-detail]");
  assertPublicBoundary(error);
});

test("viewer response uses a fixed allowlist and strips URL credentials and signing parameters", () => {
  const response = projectImagingViewerResponse({
    studyId: "study-1",
    studyInstanceUID: "1.2.3.4",
    viewerUrl: "https://viewer:password@example.test/viewer?StudyInstanceUIDs=1.2.3.4&access_token=secret&signature=signed#private",
    viewer: "OHIF",
    archive: "Orthanc DICOMweb",
    expiresAt: null,
    objectPath: "oss://bucket/private",
    token: "IMG-SECRET",
    extra: "must-not-cross-the-boundary"
  });

  assert.deepEqual(Object.keys(response), ["studyId", "studyInstanceUID", "viewerUrl", "viewer", "archive", "expiresAt"]);
  assert.equal(response.studyId, "study-1");
  assert.match(response.viewerUrl, /^https:\/\/example\.test\/viewer\?StudyInstanceUIDs=1\.2\.3\.4$/);
  assert.doesNotMatch(response.viewerUrl, /password|access_token|signature|secret|#private/);
});
