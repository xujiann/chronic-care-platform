"use strict";

const assert = require("node:assert/strict");
const { generateKeyPairSync } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const Builder = require("../scripts/disease-payment-package-builder");

test("local package builder parses quoted CSV and assembles verified digests", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "local-payment-package-"));
  try {
    const basePath = path.join(directory, "base.json");
    const catalogPath = path.join(directory, "catalog.csv");
    const coefficientPath = path.join(directory, "coefficients.csv");
    const approvalPath = path.join(directory, "approval.txt");
    const signingKeyPath = path.join(directory, "signing-key.pem");
    const signingKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    fs.writeFileSync(basePath, JSON.stringify({ id: "builder-drg", regionCode: "210200", regionName: "构建测试区", mode: "DRG", scope: "incremental", authority: "local-medical-insurance-approved", packageVersion: "BUILDER-V1", nationalVersion: "CHS-DRG 2.0", documentNo: "BUILDER-1", sourceOrganization: "测试医保局", effectiveFrom: "2027-01-01", effectiveTo: "2027-12-31", approvalDocument: { documentNo: "BUILDER-1", issuedAt: "2026-12-20", fileDigest: "" }, payment: { rateMethod: "固定费率法", rate: 12000, budgetYear: 2027, institutionCoefficients: [] } }), "utf8");
    fs.writeFileSync(catalogPath, "code,name,mdcCode,mdcName,adrgCode,adrgName,groupType,complicationLevel,diagnosisPrefixes,weight,adjustment,primaryCare\nBR23,\"脑血管疾病,伴一般并发症\",MDCB,神经系统,BR2,脑血管疾病,medical,CC,I63|I64,2.5,1,false\n", "utf8");
    fs.writeFileSync(coefficientPath, "institutionCode,institution,coefficient,effectiveFrom,effectiveTo,basisDocumentNo\nH001,测试医院,1.08,2027-01-01,2027-12-31,BUILDER-1\n", "utf8");
    fs.writeFileSync(approvalPath, "formal approval evidence", "utf8");
    fs.writeFileSync(signingKeyPath, signingKeys.privateKey.export({ type: "pkcs8", format: "pem" }), "utf8");
    const result = Builder.buildPackage({ base: basePath, catalog: catalogPath, coefficients: coefficientPath, approval: approvalPath, verified: true, "signing-key": signingKeyPath, "signer-id": "builder-test-signer", "valid-until": "2036-12-31T23:59:59.000Z" });
    assert.equal(result.validation.ok, true);
    assert.equal(result.package.catalog[0].name, "脑血管疾病,伴一般并发症");
    assert.deepEqual(result.package.catalog[0].diagnosisPrefixes, ["I63", "I64"]);
    assert.equal(result.package.payment.institutionCoefficients[0].coefficient, 1.08);
    assert.match(result.package.sourceFiles[0].sha256, /^[a-f\d]{64}$/);
    assert.match(result.package.approvalDocument.fileDigest, /^[a-f\d]{64}$/);
    assert.equal(result.validation.signature.ok, true);
    assert.equal(result.validation.signature.trusted, true);
    assert.equal(result.package.signatureEvidence.algorithm, "RSA-SHA256");
    assert.equal(JSON.stringify(result.package).includes("PRIVATE KEY"), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("local package builder defaults source evidence to pending verification", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "local-payment-package-pending-"));
  try {
    const basePath = path.join(directory, "base.json");
    const catalogPath = path.join(directory, "catalog.csv");
    fs.writeFileSync(basePath, JSON.stringify({ id: "pending-dip", regionCode: "210200", regionName: "待核验区", mode: "DIP", scope: "incremental", authority: "template-only", packageVersion: "DIP-V1", nationalVersion: "DIP", documentNo: "PENDING-1", sourceOrganization: "测试医保局", effectiveFrom: "2027-01-01", effectiveTo: "2027-12-31", approvalDocument: { documentNo: "PENDING-1", issuedAt: "2026-12-20", fileDigest: "a".repeat(64) }, payment: { rateMethod: "浮动点值法", rate: 100, budgetYear: 2027 } }), "utf8");
    fs.writeFileSync(catalogPath, "code,name,diagnosisPrefixes,score,adjustment\nDIP-I10,高血压,I10,80,1\n", "utf8");
    const result = Builder.buildPackage({ base: basePath, catalog: catalogPath });
    assert.equal(result.package.sourceFiles[0].verificationStatus, "待核验");
    assert.equal(result.validation.ok, false);
    assert.ok(result.validation.errors.some((item) => item.includes("来源核验")));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
