const test = require("node:test");
const assert = require("node:assert/strict");

const uiZh = require("../citizen-ui-zh");

test("居民端常见技术缩写和英文状态统一转换为中文", () => {
  const source = "C端 V2 · HIS/EMR/LIS/PACS · SHA-256 · BMI 27.2kg/m² · scheduled";
  const translated = uiZh.translateVisibleText(source);

  assert.equal(
    translated,
    "居民端 第二版 · 医院信息系统/电子病历系统/检验信息系统/医学影像系统 · 摘要校验 · 体质指数 27.2千克/平方米 · 已安排"
  );
  assert.doesNotMatch(translated, /\b(HIS|EMR|LIS|PACS|SHA-256|BMI|scheduled)\b/);
});

test("居民端业务数据中的英文名称、来源和状态统一转换为中文", () => {
  const source = "Dalian Central Hospital · Nurse Sun · internetNursingOrders · pending-verification";
  assert.equal(
    uiZh.translateVisibleText(source),
    "大连市中心医院 · 孙护士 · 互联网护理订单 · 待核验"
  );
});

test("居民端英文通知转换为完整中文说明", () => {
  const source = "Dalian Central Hospital teleconsultation report is overdue; confirm report callback or manual reconciliation.";
  assert.equal(
    uiZh.translateVisibleText(source),
    "大连市中心医院远程会诊报告已逾期，请核对报告回传或进行人工对账。"
  );
});

test("中文内容和程序标识保持稳定", () => {
  assert.equal(uiZh.translateVisibleText("健康档案持续更新"), "健康档案持续更新");
  assert.equal(uiZh.translateVisibleText("报告号 TJ202605180028"), "报告号 TJ202605180028");
  assert.equal(uiZh.translateVisibleText("心电图编号 ECG-DEMO-001"), "心电图编号 ECG-DEMO-001");
});
