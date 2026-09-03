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

test("居民端现场动态数据中的指标、时段和技术来源统一转换为中文", () => {
  const source = "来源记录 43c562cd-568c-4f79-bdab-0d47c0ac0cf3 · systolic 166 · bmi 29.4 · 2026-07-18 AM · 关联Orthanc检查 ORTHANC-701636 · FD-PKG-HBP";
  const translated = uiZh.translateVisibleText(source);

  assert.equal(
    translated,
    "来源记录已核验 · 收缩压 166 · 体质指数 29.4 · 2026-07-18 上午 · 关联影像归档检查 ORTHANC-701636 · 高血压家庭医生服务包"
  );
  assert.doesNotMatch(translated, /systolic|bmi|\bAM\b|关联Orthanc检查|FD-PKG-HBP/i);

  const appointment = uiZh.translateVisibleText("Qingniwaqiao Community Health Service Center demo · General Practice · Doctor Chen · schedule-change replacement · Internet hospital source pool · Ready");
  assert.equal(appointment, "示范社区卫生服务中心演示点 · 全科医学科 · 陈医生 · 改期替补号源 · 互联网医院号源池 · 已就绪");

  assert.equal(uiZh.translateVisibleText("HC-****3219 · MI-****E-R1 · 2.0-demo"), "健康卡尾号3219 · 医保凭证已脱敏 · 2.0-演示版");
});
