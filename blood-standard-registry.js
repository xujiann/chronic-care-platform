(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BloodStandardRegistry = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const standard = Object.freeze({
    number: "WS/T 866—2025",
    name: "医疗机构临床用血基本数据集",
    version: "V1.0",
    effectiveAt: "2026-01-01",
    datasetId: "HDSD2.01"
  });

  const subsets = Object.freeze([
    ["institution", "用血医疗机构基本信息"],
    ["blood-product", "血液产品基本信息"],
    ["patient", "用血者基本信息"],
    ["blood-order", "医疗机构订血"],
    ["blood-return", "医疗机构退血"],
    ["transfusion", "医疗机构用血"],
    ["discard", "医疗机构血液报废"],
    ["inventory", "医疗机构血液库存管理"],
    ["crossmatch", "交叉配血"],
    ["autologous-treatment", "自体输血及输血治疗"],
    ["donation-certificate", "献血证基本信息"],
    ["blood-fee-relief", "用血减免"]
  ].map(([id, name]) => ({ id, name })));

  const elements = Object.freeze([
    ["institution", "organizationCode", "医疗机构代码", "AN18", true],
    ["institution", "organizationName", "医疗机构名称", "AN70", true],
    ["blood-product", "donationCode", "献血编号", "AN32", true],
    ["blood-product", "bloodComponentCode", "血液品种代码", "AN20", true],
    ["blood-product", "aboCode", "ABO血型代码", "N1", true],
    ["blood-product", "rhDCode", "RhD血型代码", "N1", true],
    ["blood-product", "amount", "血液数量", "N..10,2", true],
    ["blood-product", "expiresAt", "血液有效期", "DT15", true],
    ["patient", "patientId", "患者唯一标识", "AN64", true],
    ["patient", "medicalRecordNumber", "病案号", "AN32", true],
    ["patient", "patientName", "患者姓名", "A..50", true],
    ["blood-order", "orderTypeCode", "订血类型代码", "N1", true],
    ["blood-order", "orderedAt", "订血时间", "DT15", true],
    ["blood-order", "plannedUseAt", "预定用血时间", "DT15", true],
    ["blood-return", "returnReasonCode", "退血原因代码", "N2", true],
    ["blood-return", "returnedAt", "退血时间", "DT15", true],
    ["transfusion", "startedAt", "输血开始时间", "DT15", true],
    ["transfusion", "completedAt", "输血结束时间", "DT15", true],
    ["transfusion", "reactionCode", "输血反应分类代码", "N2", false],
    ["discard", "discardReasonCode", "报废原因代码", "N2", true],
    ["inventory", "storageTemperatureCode", "血液储存温度代码", "N1", true],
    ["inventory", "inventoryStatusCode", "库存状态代码", "N1", true],
    ["crossmatch", "crossmatchMethodCode", "配血方式代码", "N1", true],
    ["crossmatch", "crossmatchResultCode", "配血结果代码", "N1", true],
    ["crossmatch", "performedBy", "配血操作人", "AN64", true],
    ["crossmatch", "reviewedBy", "配血结果复核人", "AN64", true],
    ["autologous-treatment", "autologousTypeCode", "自体输血种类代码", "N1", true],
    ["donation-certificate", "donationCertificateNumber", "献血证编号", "AN32", true],
    ["blood-fee-relief", "reliefAmount", "用血减免金额", "N..12,2", true]
  ].map(([subset, key, name, format, required]) => ({ subset, key, name, format, required })));

  function validateRecord(subset, record = {}) {
    const errors = [];
    if (!subsets.some((item) => item.id === subset)) errors.push(`unknown WS/T 866 subset: ${subset}`);
    elements.filter((item) => item.subset === subset && item.required).forEach((item) => {
      if (record[item.key] === undefined || record[item.key] === null || record[item.key] === "") errors.push(`${item.key} is required`);
    });
    return { valid: errors.length === 0, errors };
  }

  function coverage() {
    const represented = new Set(elements.map((item) => item.subset));
    return {
      standard,
      subsets: subsets.length,
      representedSubsets: represented.size,
      registeredElements: elements.length,
      completeSubsetCoverage: subsets.every((item) => represented.has(item.id))
    };
  }

  return { standard, subsets, elements, validateRecord, coverage };
});
