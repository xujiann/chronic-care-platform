"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createClinicalAssistRuntime, resolveClinicalOrganizationCode } = require("../src/http/clinical-assist-runtime");

function fixture() {
  return {
    authOrganizations: [{ orgCode: "MR1", name: "示范机构一" }, { orgCode: "MR2", name: "示范机构二" }],
    medicalResources: [{ id: "mr1", institution: "历史机构引用一" }, { id: "mr2", institution: "历史机构引用二" }]
  };
}

test("clinical resolver accepts only uniquely registered explicit organization codes", () => {
  const data = fixture();
  assert.equal(resolveClinicalOrganizationCode(data, { orgCode: "MR1" }), "MR1");
  assert.equal(resolveClinicalOrganizationCode(data, { institutionCode: "MR2" }), "MR2");
  assert.equal(resolveClinicalOrganizationCode(data, { sourceInstitutionCode: "MR2" }), "MR2");
  assert.equal(resolveClinicalOrganizationCode(data, { sourceInstitutionCode: "UNKNOWN", institutionName: "示范机构一" }), "");
  assert.equal(resolveClinicalOrganizationCode(data, { orgCode: "UNKNOWN", institution: "示范机构一" }), "");
  assert.equal(resolveClinicalOrganizationCode(data, { orgCode: "mr1", institution: "示范机构一" }), "");
  data.authOrganizations.push({ orgCode: "MR1", name: "重复目录" });
  assert.equal(resolveClinicalOrganizationCode(data, { orgCode: "MR1" }), "");
});

test("clinical resolver rejects ambiguous names and accepts a unique trusted directory name", () => {
  const data = fixture();
  assert.equal(resolveClinicalOrganizationCode(data, { institution: "示范机构一" }), "MR1");
  assert.equal(resolveClinicalOrganizationCode(data, { institutionName: "示范机构一" }), "MR1");
  assert.equal(resolveClinicalOrganizationCode(data, { sourceInstitution: "示范机构二" }), "MR2");
  data.authOrganizations.push({ orgCode: "MR3", name: "示范机构一" });
  assert.equal(resolveClinicalOrganizationCode(data, { institution: "示范机构一" }), "");
});

test("name resolution cannot bypass duplicate organization code rejection", () => {
  const data = fixture();
  data.authOrganizations.push({ orgCode: "MR1", name: "示范机构一" });
  assert.equal(resolveClinicalOrganizationCode(data, { institution: "示范机构一" }), "");
  assert.equal(resolveClinicalOrganizationCode(data, { sourceInstitution: "示范机构一" }), "");
  data.authOrganizations[2].name = "另一目录名称";
  assert.equal(resolveClinicalOrganizationCode(data, { institution: "示范机构一" }), "");
});

test("historical medical resource IDs resolve only to an existing unique directory code", () => {
  const data = fixture();
  const original = structuredClone(data);
  assert.equal(resolveClinicalOrganizationCode(data, { institution: "历史机构引用一" }), "MR1");
  assert.equal(resolveClinicalOrganizationCode(data, { sourceInstitution: "历史机构引用二" }), "MR2");
  assert.deepEqual(data, original);
  data.medicalResources.push({ id: "mr-not-registered", institution: "目录外资源" });
  assert.equal(resolveClinicalOrganizationCode(data, { institution: "目录外资源" }), "");
  data.authOrganizations.push({ orgCode: "MR1", name: "重复目录" });
  assert.equal(resolveClinicalOrganizationCode(data, { institution: "历史机构引用一" }), "");
});

test("resource and name conflicts never broaden the resolved institution", () => {
  const data = fixture();
  data.medicalResources.push({ id: "mr2", institution: "示范机构一" });
  assert.equal(resolveClinicalOrganizationCode(data, { institution: "示范机构一" }), "");
  data.medicalResources.push({ id: "mr2", institution: "历史机构引用一" });
  assert.equal(resolveClinicalOrganizationCode(data, { institution: "历史机构引用一" }), "");
});

test("missing directory, unmapped names and empty references fail closed", () => {
  for (const row of [{}, { institution: "未知机构" }, { institution: "" }, { sourceInstitution: 42 }]) {
    assert.equal(resolveClinicalOrganizationCode(fixture(), row), "");
  }
  assert.equal(resolveClinicalOrganizationCode({}, { orgCode: "MR1" }), "");
  assert.equal(resolveClinicalOrganizationCode({ authOrganizations: null, medicalResources: [{ id: "mr1", institution: "历史引用" }] }, { institution: "历史引用" }), "");
});

test("runtime institution and doctor access reject foreign or unresolved alerts", () => {
  const data = fixture();
  const runtime = createClinicalAssistRuntime();
  const manager = { id: "manager-1", role: "institution", orgCode: "MR1", accountType: "manager" };
  assert.equal(runtime.canAccessAlert(manager, { institution: "历史机构引用一" }, data), true);
  assert.equal(runtime.canAccessAlert(manager, { institution: "历史机构引用二" }, data), false);
  assert.equal(runtime.canAccessAlert(manager, { institution: "未知机构" }, data), false);
  assert.equal(runtime.canAccessAlert({ ...manager, orgCode: "UNKNOWN" }, { orgCode: "UNKNOWN" }, data), false);
  const doctor = { ...manager, accountType: "doctor", doctorId: "doctor-1" };
  assert.equal(runtime.canAccessAlert(doctor, { institution: "历史机构引用一", doctorId: "doctor-1" }, data), true);
  assert.equal(runtime.canAccessAlert(doctor, { institution: "历史机构引用一", doctorId: "doctor-2" }, data), false);
  assert.equal(runtime.canAccessAlert({ ...doctor, doctorId: "" }, { institution: "历史机构引用一" }, data), false);
});
