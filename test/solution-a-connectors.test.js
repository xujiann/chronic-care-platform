const test = require("node:test");
const assert = require("node:assert/strict");
const { buildOhifStudyUrl, createSyntheticDicom, normalizeDicomWebStudy, publishDiagnosticReportToFhir, publishImagingStudyToFhir, queryDicomWebStudies, queryOrthancStudies, readFhirPatient, solutionAConfiguration, solutionAHealth, upsertFhirPatient, upsertFhirResource, validateFhirPatient } = require("../solution-a-connectors");

test("solution A exposes safe default local endpoints", () => {
  const config = solutionAConfiguration({});
  assert.equal(config.hapiFhir.baseUrl, "http://127.0.0.1:8080/fhir");
  assert.equal(config.orthanc.baseUrl, "http://127.0.0.1:8042");
});

test("publishes a quality review as a linked FHIR DiagnosticReport", async () => {
  let written;
  const fetchImpl = async (_url, options) => {
    written = JSON.parse(options.body);
    return { ok: true, status: 200, text: async () => JSON.stringify({ ...written, meta: { versionId: "3" } }) };
  };
  const result = await publishDiagnosticReportToFhir({
    studyInstanceUID: "1.2.3.4", studyDate: "20260713",
    fhirPatientId: "platform-patient-1", fhirImagingStudyId: "imaging-study-1"
  }, { result: "质控通过", comment: "影像与报告质控通过" }, { env: {}, fetchImpl });
  assert.equal(written.resourceType, "DiagnosticReport");
  assert.equal(written.status, "final");
  assert.equal(written.subject.reference, "Patient/platform-patient-1");
  assert.equal(written.imagingStudy[0].reference, "ImagingStudy/imaging-study-1");
  assert.equal(result.diagnosticReport.versionId, "3");
});
test("OHIF study URL validates DICOM UID", () => {
  assert.match(buildOhifStudyUrl("1.2.840.113619.2.55.3"), /StudyInstanceUIDs=1.2.840/);
  assert.throws(() => buildOhifStudyUrl("bad/uid"), /valid DICOM UID/);
});
test("health probe reports all three services", async () => {
  const fetchImpl = async () => ({ ok: true, status: 200 });
  const report = await solutionAHealth({ env: {}, fetchImpl });
  assert.equal(report.ok, true); assert.equal(report.services.length, 3);
});
test("FHIR patient write and read use standard resource endpoints", async () => {
  const calls = [];
  const patient = { resourceType: "Patient", id: "test-patient", identifier: [{ system: "urn:test", value: "TEST-1" }] };
  const fetchImpl = async (url, request = {}) => { calls.push({ url, request }); return { ok: true, status: request.method === "PUT" ? 201 : 200, text: async () => JSON.stringify(patient) }; };
  const write = await upsertFhirPatient(patient, { fetchImpl, env: {} });
  const read = await readFhirPatient(patient.id, { fetchImpl, env: {} });
  assert.equal(write.status, 201); assert.equal(read.id, patient.id);
  assert.match(calls[0].url, /\/fhir\/Patient\/test-patient$/); assert.equal(calls[0].request.method, "PUT");
});
test("FHIR patient validation rejects missing identity", () => {
  assert.throws(() => validateFhirPatient({ resourceType: "Patient", id: "x" }), /identifier is required/);
});
test("Orthanc study query requires an array", async () => {
  const studies = await queryOrthancStudies({ env: {}, fetchImpl: async () => ({ ok: true, status: 200, text: async () => "[]" }) });
  assert.deepEqual(studies, []);
});
test("synthetic DICOM creation resolves its generated study UID", async () => {
  const responses = [
    { ok: true, status: 200, text: async () => JSON.stringify({ ID: "instance-1" }) },
    { ok: true, status: 200, text: async () => JSON.stringify({ StudyInstanceUID: "1.2.3.4" }) }
  ];
  const result = await createSyntheticDicom({ env: {}, suffix: "123", fetchImpl: async () => responses.shift() });
  assert.equal(result.orthancId, "instance-1"); assert.equal(result.studyInstanceUID, "1.2.3.4");
});
test("DICOMweb query returns study metadata array", async () => {
  const studies = await queryDicomWebStudies({ env: {}, fetchImpl: async () => ({ ok: true, status: 200, text: async () => "[{}]" }) });
  assert.equal(studies.length, 1);
});
test("DICOMweb normalization preserves synthetic identity and masks other identities", () => {
  const base = { "0020000D": { Value: ["1.2.3"] }, "00100020": { Value: ["SYNTHETIC-001"] }, "00100010": { Value: [{ Alphabetic: "SOLUTION^A^SYNTHETIC" }] } };
  const synthetic = normalizeDicomWebStudy(base, {});
  assert.equal(synthetic.synthetic, true); assert.equal(synthetic.patientId, "SYNTHETIC-001");
  const protectedStudy = normalizeDicomWebStudy({ ...base, "00100020": { Value: ["PATIENT-123456"] }, "00100010": { Value: [{ Alphabetic: "REAL^NAME" }] } }, {});
  assert.equal(protectedStudy.synthetic, false); assert.equal(protectedStudy.patientName, "受保护患者"); assert.equal(protectedStudy.patientId.endsWith("3456"), true);
});
test("FHIR imaging publication writes Patient before ImagingStudy", async () => {
  const calls = [];
  const fetchImpl = async (url, request) => { const body = JSON.parse(request.body); calls.push({ url, body }); return { ok: true, status: 201, text: async () => JSON.stringify({ ...body, meta: { versionId: "1" } }) }; };
  const result = await publishImagingStudyToFhir({ studyInstanceUID: "1.2.3.4", studyDate: "2026-07-13", seriesCount: 1, imageCount: 1, synthetic: true }, { id: "r1", name: "演示居民" }, { env: {}, fetchImpl });
  assert.equal(result.ok, true); assert.equal(calls[0].body.resourceType, "Patient"); assert.equal(calls[1].body.resourceType, "ImagingStudy");
  assert.equal(calls[1].body.subject.reference, `Patient/${result.patient.id}`);
});
test("generic FHIR writer rejects resources outside the solution A allowlist", async () => {
  await assert.rejects(() => upsertFhirResource({ resourceType: "Claim", id: "claim-1" }), /not allowed/);
});
