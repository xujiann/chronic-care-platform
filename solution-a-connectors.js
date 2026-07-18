const { createHash } = require("node:crypto");
const DEFAULT_TIMEOUT_MS = 5000;
const { generateSyntheticDicom } = require("./synthetic-dicom");

function cleanBaseUrl(value, label) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw new Error(`${label} must be a valid URL`); }
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error(`${label} must use HTTP or HTTPS`);
  return url.toString().replace(/\/$/, "");
}

function solutionAConfiguration(env = process.env) {
  return {
    hapiFhir: { baseUrl: cleanBaseUrl(env.HAPI_FHIR_BASE_URL || "http://127.0.0.1:8080/fhir", "HAPI_FHIR_BASE_URL"), healthPath: "/metadata" },
    orthanc: { baseUrl: cleanBaseUrl(env.ORTHANC_BASE_URL || "http://127.0.0.1:8042", "ORTHANC_BASE_URL"), healthPath: "/system", username: String(env.ORTHANC_USERNAME || "orthanc"), password: String(env.ORTHANC_PASSWORD || "") },
    ohif: { baseUrl: cleanBaseUrl(env.OHIF_BASE_URL || "http://127.0.0.1:3000", "OHIF_BASE_URL"), healthPath: "/" },
    timeoutMs: Math.min(30000, Math.max(1000, Number(env.SOLUTION_A_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS))
  };
}

async function probeService(name, config, timeoutMs, fetchImpl = globalThis.fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { Accept: "application/json, text/html;q=0.8" };
  if (name === "orthanc" && config.password) headers.Authorization = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`;
  const startedAt = Date.now();
  try {
    const response = await fetchImpl(`${config.baseUrl}${config.healthPath}`, { headers, signal: controller.signal });
    return { name, ok: response.ok, status: response.status, latencyMs: Date.now() - startedAt, endpoint: `${config.baseUrl}${config.healthPath}` };
  } catch (error) {
    return { name, ok: false, status: 0, latencyMs: Date.now() - startedAt, endpoint: `${config.baseUrl}${config.healthPath}`, error: error.name === "AbortError" ? "timeout" : error.message };
  } finally { clearTimeout(timer); }
}

async function solutionAHealth(options = {}) {
  const config = solutionAConfiguration(options.env);
  const services = await Promise.all(Object.entries(config).filter(([name]) => name !== "timeoutMs").map(([name, item]) => probeService(name, item, config.timeoutMs, options.fetchImpl)));
  return { generatedAt: new Date().toISOString(), ok: services.every((item) => item.ok), services };
}

async function readResponseJson(response, label) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new Error(`${label} returned non-JSON response (${response.status})`); }
}

function validateFhirPatient(patient) {
  if (!patient || patient.resourceType !== "Patient") throw new Error("FHIR resourceType must be Patient");
  const id = String(patient.id || "").trim();
  if (!/^[A-Za-z0-9\-.]{1,64}$/.test(id)) throw new Error("FHIR Patient.id is invalid");
  if (!Array.isArray(patient.identifier) || !patient.identifier.some((item) => String(item?.value || "").trim())) throw new Error("FHIR Patient.identifier is required");
  return { ...patient, id };
}

async function upsertFhirPatient(patient, options = {}) {
  const resource = validateFhirPatient(patient);
  const config = solutionAConfiguration(options.env).hapiFhir;
  const response = await (options.fetchImpl || globalThis.fetch)(`${config.baseUrl}/Patient/${encodeURIComponent(resource.id)}`, {
    method: "PUT", headers: { Accept: "application/fhir+json", "Content-Type": "application/fhir+json" }, body: JSON.stringify(resource)
  });
  const body = await readResponseJson(response, "HAPI FHIR");
  if (!response.ok) throw new Error(`HAPI FHIR Patient upsert failed (${response.status})`);
  return { ok: true, status: response.status, patient: body };
}

const WRITABLE_FHIR_RESOURCES = new Set(["Patient", "ImagingStudy", "DiagnosticReport"]);
async function upsertFhirResource(resource, options = {}) {
  const type = String(resource?.resourceType || "");
  const id = String(resource?.id || "").trim();
  if (!WRITABLE_FHIR_RESOURCES.has(type)) throw new Error(`FHIR ${type || "resource"} is not allowed for solution A write`);
  if (!/^[A-Za-z0-9\-.]{1,64}$/.test(id)) throw new Error(`FHIR ${type}.id is invalid`);
  const config = solutionAConfiguration(options.env).hapiFhir;
  const response = await (options.fetchImpl || globalThis.fetch)(`${config.baseUrl}/${type}/${encodeURIComponent(id)}`, { method: "PUT", headers: { Accept: "application/fhir+json", "Content-Type": "application/fhir+json" }, body: JSON.stringify(resource) });
  const body = await readResponseJson(response, "HAPI FHIR");
  if (!response.ok) throw new Error(`HAPI FHIR ${type} upsert failed (${response.status}): ${body.issue?.map((item) => item.diagnostics || item.details?.text).filter(Boolean).join("; ") || body.message || "validation error"}`);
  return { ok: true, status: response.status, resource: body };
}

function fhirId(prefix, value) { return `${prefix}-${createHash("sha256").update(String(value)).digest("hex").slice(0, 24)}`; }
function fhirDate(value) {
  const compact = String(value || "").trim();
  if (/^\d{8}$/.test(compact)) return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(compact)) return compact;
  return new Date().toISOString().slice(0, 10);
}
async function publishImagingStudyToFhir(study, resident, options = {}) {
  if (!study?.studyInstanceUID || !resident?.id) throw new Error("studyInstanceUID and resident are required for FHIR imaging sync");
  const patientId = fhirId("platform-patient", resident.id);
  const imagingStudyId = fhirId("imaging-study", study.studyInstanceUID);
  const patient = {
    resourceType: "Patient", id: patientId, active: true,
    identifier: [{ system: "urn:chronic-care-platform:resident-id", value: resident.id }],
    name: [{ use: "official", text: String(resident.name || "平台居民") }],
    meta: { tag: [{ system: "urn:chronic-care-platform:source", code: study.synthetic ? "synthetic-test-data" : "governed-platform-link" }] }
  };
  const imagingStudy = {
    resourceType: "ImagingStudy", id: imagingStudyId, status: "available", subject: { reference: `Patient/${patientId}` },
    identifier: [{ system: "urn:dicom:uid", value: `urn:oid:${study.studyInstanceUID}` }],
    started: `${fhirDate(study.studyDate)}T00:00:00+08:00`,
    numberOfSeries: Number(study.seriesCount || 1), numberOfInstances: Number(study.imageCount || 1),
    description: String(study.bodyPart || study.studyDescription || "Solution A imaging study"),
    extension: study.viewerUrl ? [{ url: "urn:chronic-care-platform:ohif-viewer-url", valueUrl: String(study.viewerUrl) }] : [],
    meta: { tag: [{ system: "urn:chronic-care-platform:source", code: "solution-a-orthanc" }] }
  };
  const patientReceipt = await upsertFhirResource(patient, options);
  const imagingReceipt = await upsertFhirResource(imagingStudy, options);
  return { ok: true, patient: { id: patientId, status: patientReceipt.status, versionId: patientReceipt.resource.meta?.versionId || "" }, imagingStudy: { id: imagingStudyId, status: imagingReceipt.status, versionId: imagingReceipt.resource.meta?.versionId || "" } };
}

async function publishDiagnosticReportToFhir(study, review, options = {}) {
  if (!study?.fhirPatientId || !study?.fhirImagingStudyId || !study?.studyInstanceUID) throw new Error("FHIR Patient and ImagingStudy linkage is required before DiagnosticReport sync");
  const reportId = fhirId("diagnostic-report", study.studyInstanceUID);
  const passed = /通过|合格|passed|final/i.test(String(review?.result || ""));
  const report = {
    resourceType: "DiagnosticReport", id: reportId, status: passed ? "final" : "preliminary",
    code: { coding: [{ system: "http://loinc.org", code: "18748-4", display: "Diagnostic imaging study" }], text: "医学影像诊断与质控报告" },
    subject: { reference: `Patient/${study.fhirPatientId}` },
    imagingStudy: [{ reference: `ImagingStudy/${study.fhirImagingStudyId}` }],
    effectiveDateTime: `${fhirDate(study.studyDate)}T00:00:00+08:00`, issued: new Date().toISOString(),
    conclusion: String(review?.comment || study.reportConclusion || review?.result || "影像报告待完善"),
    conclusionCode: [{ text: String(review?.result || "待质控") }],
    identifier: [{ system: "urn:dicom:uid", value: `urn:oid:${study.studyInstanceUID}` }],
    meta: { tag: [{ system: "urn:chronic-care-platform:source", code: "solution-a-quality-review" }] }
  };
  const receipt = await upsertFhirResource(report, options);
  return { ok: true, diagnosticReport: { id: reportId, status: receipt.status, versionId: receipt.resource.meta?.versionId || "", reportStatus: receipt.resource.status } };
}

async function readFhirPatient(patientId, options = {}) {
  const id = String(patientId || "").trim();
  if (!/^[A-Za-z0-9\-.]{1,64}$/.test(id)) throw new Error("FHIR Patient.id is invalid");
  const config = solutionAConfiguration(options.env).hapiFhir;
  const response = await (options.fetchImpl || globalThis.fetch)(`${config.baseUrl}/Patient/${encodeURIComponent(id)}`, { headers: { Accept: "application/fhir+json" } });
  const body = await readResponseJson(response, "HAPI FHIR");
  if (!response.ok) throw new Error(`HAPI FHIR Patient read failed (${response.status})`);
  return body;
}

async function queryOrthancStudies(options = {}) {
  const config = solutionAConfiguration(options.env).orthanc;
  const headers = { Accept: "application/json" };
  if (config.password) headers.Authorization = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`;
  const response = await (options.fetchImpl || globalThis.fetch)(`${config.baseUrl}/studies`, { headers });
  const body = await readResponseJson(response, "Orthanc");
  if (!response.ok) throw new Error(`Orthanc studies query failed (${response.status})`);
  if (!Array.isArray(body)) throw new Error("Orthanc studies response must be an array");
  return body;
}

function orthancHeaders(config, contentType = "") {
  const headers = { Accept: "application/json" };
  if (contentType) headers["Content-Type"] = contentType;
  if (config.password) headers.Authorization = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`;
  return headers;
}

async function createSyntheticDicom(options = {}) {
  const config = solutionAConfiguration(options.env).orthanc;
  const suffix = String(options.suffix || Date.now()).replace(/\D/g, "").slice(-12) || "1";
  const dicom = generateSyntheticDicom({ stamp: suffix });
  const response = await (options.fetchImpl || globalThis.fetch)(`${config.baseUrl}/instances`, { method: "POST", headers: orthancHeaders(config, "application/dicom"), body: dicom.buffer });
  const body = await readResponseJson(response, "Orthanc DICOM upload");
  if (!response.ok) throw new Error(`Orthanc synthetic DICOM creation failed (${response.status}): ${body.Message || body.message || JSON.stringify(body)}`);
  const orthancId = body.ID || String(body.Path || "").split("/").filter(Boolean).pop() || "";
  const tagResponse = await (options.fetchImpl || globalThis.fetch)(`${config.baseUrl}/instances/${encodeURIComponent(orthancId)}/simplified-tags`, { headers: orthancHeaders(config) });
  const tags = await readResponseJson(tagResponse, "Orthanc instance tags");
  if (!tagResponse.ok || !tags.StudyInstanceUID) throw new Error("Orthanc synthetic DICOM is missing StudyInstanceUID");
  return { orthancId, studyInstanceUID: tags.StudyInstanceUID, payloadClass: "synthetic-test-data", pixelData: true, rows: dicom.rows, columns: dicom.columns };
}

async function queryDicomWebStudies(options = {}) {
  const config = solutionAConfiguration(options.env).orthanc;
  const response = await (options.fetchImpl || globalThis.fetch)(`${config.baseUrl}/dicom-web/studies`, { headers: orthancHeaders(config) });
  const body = await readResponseJson(response, "Orthanc DICOMweb");
  if (!response.ok) throw new Error(`Orthanc DICOMweb query failed (${response.status})`);
  if (!Array.isArray(body)) throw new Error("Orthanc DICOMweb studies response must be an array");
  return body;
}

function dicomValue(record, tag) {
  const values = record?.[tag]?.Value;
  if (!Array.isArray(values) || values.length === 0) return "";
  const value = values[0];
  if (value && typeof value === "object") return [value.Alphabetic, value.Ideographic, value.Phonetic].filter(Boolean).join(" / ");
  return String(value ?? "");
}

function normalizeDicomWebStudy(record, env = process.env) {
  const studyInstanceUID = dicomValue(record, "0020000D");
  if (!studyInstanceUID) throw new Error("DICOMweb study is missing StudyInstanceUID");
  const patientId = dicomValue(record, "00100020");
  const synthetic = /^SYNTHETIC-/i.test(patientId) || /SOLUTION\^A\^SYNTHETIC/i.test(dicomValue(record, "00100010"));
  return {
    studyInstanceUID,
    patientId: synthetic ? patientId : patientId.replace(/.(?=.{4})/g, "*"),
    patientName: synthetic ? dicomValue(record, "00100010") : "受保护患者",
    studyDate: dicomValue(record, "00080020"),
    studyDescription: dicomValue(record, "00081030"),
    modalities: dicomValue(record, "00080061") || dicomValue(record, "00080060"),
    accessionNumber: dicomValue(record, "00080050"),
    synthetic,
    viewerUrl: buildOhifStudyUrl(studyInstanceUID, env)
  };
}

async function listOrthancStudySummaries(options = {}) {
  return (await queryDicomWebStudies(options)).map((item) => normalizeDicomWebStudy(item, options.env));
}

function buildOhifStudyUrl(studyInstanceUid, env = process.env) {
  const uid = String(studyInstanceUid || "").trim();
  if (!/^[0-9]+(?:\.[0-9]+)+$/.test(uid)) throw new Error("studyInstanceUid must be a valid DICOM UID");
  return `${solutionAConfiguration(env).ohif.baseUrl}/viewer?StudyInstanceUIDs=${encodeURIComponent(uid)}`;
}

module.exports = { buildOhifStudyUrl, createSyntheticDicom, dicomValue, listOrthancStudySummaries, normalizeDicomWebStudy, probeService, publishDiagnosticReportToFhir, publishImagingStudyToFhir, queryDicomWebStudies, queryOrthancStudies, readFhirPatient, solutionAConfiguration, solutionAHealth, upsertFhirPatient, upsertFhirResource, validateFhirPatient };
