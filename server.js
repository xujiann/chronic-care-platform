const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const PORT = Number(process.env.PORT || 5173);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

function todayOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function seedState() {
  return {
    accounts: [
      {
        id: "a1",
        name: "王建国账户",
        phone: "13800010001",
        role: "本人",
        members: [
          { residentId: "r1", relation: "本人" },
          { residentId: "r4", relation: "母亲" }
        ]
      },
      {
        id: "a2",
        name: "李秀兰账户",
        phone: "13800010002",
        role: "本人",
        members: [
          { residentId: "r2", relation: "本人" }
        ]
      }
    ],
    residents: [
      {
        id: "r1",
        name: "王建国",
        idCard: "210204196802113219",
        gender: "男",
        birthDate: "1968-02-11",
        phone: "13800010001",
        organization: "青泥洼桥社区卫生服务中心",
        familyDoctor: "刘医生",
        address: "中山区人民路 18 号",
        metrics: { systolic: 166, diastolic: 96, glucose: 6.8, bmi: 29.4 }
      },
      {
        id: "r2",
        name: "李秀兰",
        idCard: "210203197505203427",
        gender: "女",
        birthDate: "1975-05-20",
        phone: "13800010002",
        organization: "星海湾社区卫生服务中心",
        familyDoctor: "赵医生",
        address: "沙河口区西南路 60 号",
        metrics: { systolic: 138, diastolic: 84, glucose: 7.8, bmi: 25.1 }
      },
      {
        id: "r3",
        name: "陈海涛",
        idCard: "210211198811093014",
        gender: "男",
        birthDate: "1988-11-09",
        phone: "13800010003",
        organization: "甘井子区人民医院",
        familyDoctor: "孙医生",
        address: "甘井子区山东路 88 号",
        metrics: { systolic: 126, diastolic: 78, glucose: 5.5, bmi: 24.2 }
      },
      {
        id: "r4",
        name: "赵敏",
        idCard: "210213196410013521",
        gender: "女",
        birthDate: "1964-10-01",
        phone: "13800010004",
        organization: "青泥洼桥社区卫生服务中心",
        familyDoctor: "刘医生",
        address: "中山区解放街 7 号",
        metrics: { systolic: 148, diastolic: 88, glucose: 6.3, bmi: 28.6 }
      }
    ],
    diseases: [
      { id: "d1", residentId: "r1", type: "高血压", diagnosedAt: "2024-10-12", source: "社区筛查", status: "管理中", note: "需加强用药依从性" },
      { id: "d2", residentId: "r2", type: "糖尿病", diagnosedAt: "2024-11-03", source: "医院门诊", status: "需转诊", note: "血糖控制不佳" },
      { id: "d3", residentId: "r4", type: "高血压", diagnosedAt: "2025-01-18", source: "家庭医生随访", status: "稳定管理", note: "按季度复查" }
    ],
    followups: [
      { id: "f1", residentId: "r1", diseaseType: "高血压", plannedAt: todayOffset(-2), assignee: "刘医生", status: "已逾期", result: "未记录", advice: "补充电话随访" },
      { id: "f2", residentId: "r2", diseaseType: "糖尿病", plannedAt: todayOffset(0), assignee: "赵医生", status: "待随访", result: "未记录", advice: "复测空腹血糖" },
      { id: "f3", residentId: "r4", diseaseType: "高血压", plannedAt: todayOffset(5), assignee: "刘医生", status: "待随访", result: "未记录", advice: "记录家庭血压" },
      { id: "f4", residentId: "r3", diseaseType: "健康管理", plannedAt: todayOffset(-5), assignee: "孙医生", status: "已完成", result: "控制良好", advice: "保持运动" }
    ],
    medicalResources: seedMedicalResources(),
    careOrders: seedCareOrders(),
    medicationPickups: seedMedicationPickups(),
    institutionSupervisions: seedInstitutionSupervisions(),
    insuranceClaims: seedInsuranceClaims(),
    policyAlignment: seedPolicyAlignment(),
    emergencySignals: seedEmergencySignals(),
    seniorServices: seedSeniorServices(),
    dataAccessLogs: seedDataAccessLogs(),
    personalRecords: seedPersonalRecords()
  };
}

function seedEmergencySignals() {
  return [
    { id: "es1", title: "高危慢病随访逾期聚集", source: "家庭医生随访", region: "中山区", level: "高", status: "待处置", date: todayOffset(0), action: "通知基层机构补充电话随访并评估转诊需求" },
    { id: "es2", title: "长期处方审核异常", source: "医保审核", region: "市级", level: "中", status: "研判中", date: todayOffset(0), action: "联动医保端核验处方、诊断和取药记录" },
    { id: "es3", title: "基层慢病门诊负荷上升", source: "医疗资源监测", region: "沙河口区", level: "中", status: "已派单", date: todayOffset(1), action: "协调区级医院支援复诊号源和药品保障" }
  ];
}

function seedSeniorServices() {
  return [
    { id: "ss1", residentId: "r4", service: "家属代办取药", channel: "个人端", status: "已开通", contact: "王建国", nextAction: "每月 15 日提醒家属确认取药" },
    { id: "ss2", residentId: "r1", service: "大字模式提醒", channel: "手机端", status: "待开通", contact: "本人", nextAction: "下次登录提示开启适老显示" },
    { id: "ss3", residentId: "r2", service: "线下帮办预约", channel: "社区服务站", status: "已预约", contact: "本人", nextAction: "社区工作人员协助绑定医保电子凭证" }
  ];
}

function seedDataAccessLogs() {
  return [
    { id: "al1", residentId: "r1", at: "2026-06-15 09:12", actor: "青泥洼桥社区卫生服务中心", role: "家庭医生", scope: "健康档案、随访记录", purpose: "慢病随访", result: "允许" },
    { id: "al2", residentId: "r1", at: "2026-06-15 10:35", actor: "大连市中心医院", role: "医疗机构", scope: "电子病历摘要、用药处方", purpose: "专科复诊", result: "允许" },
    { id: "al3", residentId: "r2", at: "2026-06-15 11:20", actor: "医保端审核员", role: "医保监管", scope: "医保结算、诊断摘要", purpose: "慢病结算审核", result: "允许" },
    { id: "al4", residentId: "r4", at: "2026-06-15 14:08", actor: "未授权机构", role: "外部机构", scope: "完整电子病历", purpose: "未知", result: "拒绝" }
  ];
}

function seedPolicyAlignment() {
  return [
    { domain: "普惠数字医疗", requirement: "建设互通共享的全民健康信息平台，推动医疗卫生机构数据共享互认和业务协同。", capability: "个人健康信息库聚合电子病历、检查检验、用药、授权和慢病管理数据。", status: "已启动" },
    { domain: "医疗全流程在线办理", requirement: "加快异地转诊、就医、住院、医保等医疗全流程在线办理。", capability: "医疗机构端承接转诊协同，医保端承接结算审核，个人端承接固定取药和授权共享。", status: "原型完成" },
    { domain: "互联网医疗监管", requirement: "完善互联网医疗服务监管体系，推进互联网+监管和智慧监管。", capability: "卫健委端建设四端运行监测、机构绩效、风险预警和数据质量看板。", status: "已纳入" },
    { domain: "电子健康码与医保凭证", requirement: "普及居民电子健康码，加快医保电子凭证推广应用。", capability: "以身份证号+手机号形成 personIndex，后续可对接电子健康码、医保电子凭证和居民一卡通。", status: "数据底座完成" },
    { domain: "公共卫生应急", requirement: "建立智慧化预警多点触发机制，支持公共卫生机构和医疗机构数据共享。", capability: "风险预警汇聚慢病高危、随访逾期、医保异常和资源负荷，预留公共卫生应急监测入口。", status: "待扩展" },
    { domain: "基层智慧治理", requirement: "以数据驱动、信息共享提升基层治理和疫情防控能力。", capability: "基层机构、家庭医生、居民端、医保端共用同一居民主索引和慢病闭环台账。", status: "已启动" },
    { domain: "数据安全与合规", requirement: "完善数据脱敏、加密保护、合规评估和安全保障体系。", capability: "增加授权共享、撤销授权、数据质量审计，后续补充分级权限、脱敏展示和日志留痕。", status: "待扩展" },
    { domain: "适老化与无障碍", requirement: "优化信息无障碍环境，解决老年人等群体数字鸿沟。", capability: "个人端按手机视口设计，后续补充大字模式、家属代办、语音提示和线下帮办。", status: "待扩展" }
  ];
}

function seedMedicalResources() {
  return [
    { id: "mr1", institution: "大连市中心医院", type: "三级医院", beds: 1200, doctors: 860, nurses: 1240, chronicClinics: 8, devices: 46, region: "市级" },
    { id: "mr2", institution: "大连医科大学附属医院", type: "三级医院", beds: 1500, doctors: 980, nurses: 1380, chronicClinics: 10, devices: 58, region: "市级" },
    { id: "mr3", institution: "青泥洼桥社区卫生服务中心", type: "基层医疗机构", beds: 60, doctors: 42, nurses: 58, chronicClinics: 3, devices: 12, region: "中山区" },
    { id: "mr4", institution: "星海湾社区卫生服务中心", type: "基层医疗机构", beds: 45, doctors: 36, nurses: 44, chronicClinics: 2, devices: 9, region: "沙河口区" },
    { id: "mr5", institution: "甘井子区人民医院", type: "区级医院", beds: 520, doctors: 310, nurses: 430, chronicClinics: 5, devices: 24, region: "甘井子区" }
  ];
}

function seedCareOrders() {
  return [
    {
      id: "co1",
      residentId: "r1",
      institution: "大连市中心医院",
      department: "心内科",
      type: "专科复诊",
      status: "待接诊",
      priority: "高",
      date: todayOffset(1),
      summary: "高血压控制不佳，建议专科复诊并调整用药。"
    },
    {
      id: "co2",
      residentId: "r2",
      institution: "大连医科大学附属医院",
      department: "内分泌科",
      type: "糖尿病复查",
      status: "已接诊",
      priority: "中",
      date: todayOffset(3),
      summary: "空腹血糖偏高，建议复查糖化血红蛋白。"
    },
    {
      id: "co3",
      residentId: "r4",
      institution: "青泥洼桥社区卫生服务中心",
      department: "家庭医生工作室",
      type: "基层随访",
      status: "管理中",
      priority: "中",
      date: todayOffset(5),
      summary: "稳定管理，继续季度随访。"
    }
  ];
}

function seedInsuranceClaims() {
  return [
    {
      id: "ic1",
      residentId: "r1",
      institution: "大连市中心医院",
      claimType: "门诊慢特病",
      diseaseType: "高血压",
      totalAmount: 386.5,
      insurancePay: 251.2,
      selfPay: 135.3,
      status: "待审核",
      risk: "需核验长期处方",
      date: "2026-05-21"
    },
    {
      id: "ic2",
      residentId: "r2",
      institution: "大连医科大学附属医院",
      claimType: "门诊统筹",
      diseaseType: "糖尿病",
      totalAmount: 612.8,
      insurancePay: 398.3,
      selfPay: 214.5,
      status: "已通过",
      risk: "无异常",
      date: "2026-05-18"
    },
    {
      id: "ic3",
      residentId: "r4",
      institution: "青泥洼桥社区卫生服务中心",
      claimType: "基层慢病随访",
      diseaseType: "高血压",
      totalAmount: 96,
      insurancePay: 76.8,
      selfPay: 19.2,
      status: "智能初审",
      risk: "基层服务包匹配",
      date: "2026-03-30"
    }
  ];
}

function seedMedicationPickups() {
  return [
    { id: "mp1", residentId: "r1", medication: "苯磺酸氨氯地平片", dosage: "每日 1 次", pickupDay: 5, pharmacy: "青泥洼桥社区卫生服务中心药房", nextPickup: "2026-07-05", status: "待取药", coverage: "门诊慢特病", applyMode: "本人申请", requestStatus: "已申请", institutionReview: "已确认", insuranceReview: "已通过", pharmacyStatus: "待取药", deliveryMode: "社区药房自取", lastUpdated: "2026-06-15" },
    { id: "mp2", residentId: "r1", medication: "厄贝沙坦片", dosage: "每日 1 次", pickupDay: 5, pharmacy: "青泥洼桥社区卫生服务中心药房", nextPickup: "2026-07-05", status: "待取药", coverage: "门诊慢特病", applyMode: "本人申请", requestStatus: "已申请", institutionReview: "已确认", insuranceReview: "已通过", pharmacyStatus: "待取药", deliveryMode: "社区药房自取", lastUpdated: "2026-06-15" },
    { id: "mp3", residentId: "r2", medication: "二甲双胍片", dosage: "每日 2 次", pickupDay: 10, pharmacy: "星海湾社区卫生服务中心药房", nextPickup: "2026-07-10", status: "已预约", coverage: "门诊统筹", applyMode: "本人申请", requestStatus: "已申请", institutionReview: "已确认", insuranceReview: "待审核", pharmacyStatus: "已预约", deliveryMode: "社区药房自取", lastUpdated: "2026-06-15" },
    { id: "mp4", residentId: "r4", medication: "硝苯地平控释片", dosage: "每日 1 次", pickupDay: 15, pharmacy: "青泥洼桥社区卫生服务中心药房", nextPickup: "2026-07-15", status: "待确认", coverage: "基层慢病服务包", applyMode: "家属代办", requestStatus: "已申请", institutionReview: "待确认", insuranceReview: "待审核", pharmacyStatus: "待确认", deliveryMode: "家属代取", lastUpdated: "2026-06-15" }
  ];
}

function seedInstitutionSupervisions() {
  return [
    { id: "is1", institution: "大连市中心医院", level: "提示", issue: "长期处方占比较高", action: "抽查慢病处方合理性", status: "待复核" },
    { id: "is2", institution: "大连医科大学附属医院", level: "正常", issue: "结算与病历匹配", action: "持续监测", status: "通过" },
    { id: "is3", institution: "青泥洼桥社区卫生服务中心", level: "关注", issue: "基层随访服务包需补充记录", action: "补齐家庭医生随访记录", status: "整改中" }
  ];
}

function seedPersonalRecords() {
  return [
    record("r1", "emr", "2026-05-21", "原发性高血压 2 级", "复诊血压偏高，建议调整生活方式并规律服药。", "大连市中心医院 · 心内科", {
      visitType: "门诊",
      exams: ["心电图：窦性心律", "肾功能：未见明显异常"],
      medications: ["苯磺酸氨氯地平片", "厄贝沙坦片"]
    }),
    record("r1", "emr", "2026-04-12", "高血压随访", "家庭血压记录不规律，已进行用药依从性宣教。", "青泥洼桥社区卫生服务中心 · 全科门诊", {
      visitType: "随访",
      exams: ["血压：158/92 mmHg"],
      medications: ["继续原方案"]
    }),
    record("r2", "emr", "2026-05-18", "2 型糖尿病", "空腹血糖控制不佳，建议复查糖化血红蛋白。", "大连医科大学附属医院 · 内分泌科", {
      visitType: "门诊",
      exams: ["空腹血糖：7.8 mmol/L", "糖化血红蛋白：待复查"],
      medications: ["二甲双胍片"]
    }),
    record("r4", "emr", "2026-03-30", "高血压稳定管理", "血压较前稳定，继续季度随访。", "青泥洼桥社区卫生服务中心 · 家庭医生工作室", {
      visitType: "签约服务",
      exams: ["血压：148/88 mmHg"],
      medications: ["继续原用药"]
    }),
    record("r1", "labs", "2026-05-21", "肾功能", "未见明显异常", "大连市中心医院"),
    record("r1", "labs", "2026-05-21", "心电图", "窦性心律", "大连市中心医院"),
    record("r2", "labs", "2026-05-18", "空腹血糖", "7.8 mmol/L，偏高", "大连医科大学附属医院"),
    record("r4", "labs", "2026-03-30", "血压复测", "148/88 mmHg", "青泥洼桥社区卫生服务中心"),
    record("r1", "medications", "2026-05-21", "苯磺酸氨氯地平片", "每日 1 次", "心内科门诊"),
    record("r1", "medications", "2026-05-21", "厄贝沙坦片", "每日 1 次", "心内科门诊"),
    record("r2", "medications", "2026-05-18", "二甲双胍片", "每日 2 次", "内分泌科门诊"),
    record("r1", "allergies", "2025-10-02", "青霉素", "既往皮疹", "居民自述"),
    record("r2", "allergies", "2025-08-14", "无明确药物过敏史", "已确认", "门诊问诊"),
    record("r1", "vaccines", "2025-11-01", "流感疫苗", "已接种", "社区卫生服务中心"),
    record("r4", "vaccines", "2025-11-05", "流感疫苗", "已接种", "社区卫生服务中心"),
    record("r1", "admissions", "2024-06-18", "日间观察", "血压波动观察，未住院", "大连市中心医院"),
    record("r3", "admissions", "2025-12-09", "体检中心", "年度体检，无住院记录", "甘井子区人民医院"),
    record("r1", "authorizations", "2026-01-01", "家庭医生团队", "允许查看健康档案和随访记录", "居民授权"),
    record("r1", "authorizations", "2026-01-01", "区域医疗机构", "允许查看电子病历摘要", "居民授权"),
    record("r2", "authorizations", "2026-01-01", "家庭医生团队", "允许查看慢病管理信息", "居民授权")
  ];
}

function record(residentId, category, date, name, result, source, meta = {}) {
  return {
    id: randomUUID(),
    residentId,
    category,
    date,
    name,
    result,
    source,
    meta,
    createdBy: "system",
    createdAt: new Date().toISOString()
  };
}

function ensureDatabase() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(seedState(), null, 2), "utf8");
  }
}

function readDatabase() {
  ensureDatabase();
  const data = normalizeState(JSON.parse(fs.readFileSync(DB_FILE, "utf8")));
  writeDatabase(data);
  return data;
}

function writeDatabase(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf8");
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function collectJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        req.destroy();
        reject(new Error("请求体过大"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function normalizeState(data) {
  const state = {
    accounts: Array.isArray(data.accounts) ? data.accounts : seedState().accounts,
    residents: Array.isArray(data.residents) ? data.residents : [],
    diseases: Array.isArray(data.diseases) ? data.diseases : [],
    followups: Array.isArray(data.followups) ? data.followups : [],
    medicalResources: Array.isArray(data.medicalResources) ? data.medicalResources : seedMedicalResources(),
    careOrders: Array.isArray(data.careOrders) ? data.careOrders : seedCareOrders(),
    medicationPickups: Array.isArray(data.medicationPickups) ? data.medicationPickups : seedMedicationPickups(),
    institutionSupervisions: Array.isArray(data.institutionSupervisions) ? data.institutionSupervisions : seedInstitutionSupervisions(),
    insuranceClaims: Array.isArray(data.insuranceClaims) ? data.insuranceClaims : seedInsuranceClaims(),
    policyAlignment: Array.isArray(data.policyAlignment) ? data.policyAlignment : seedPolicyAlignment(),
    emergencySignals: Array.isArray(data.emergencySignals) ? data.emergencySignals : seedEmergencySignals(),
    seniorServices: Array.isArray(data.seniorServices) ? data.seniorServices : seedSeniorServices(),
    dataAccessLogs: Array.isArray(data.dataAccessLogs) ? data.dataAccessLogs : seedDataAccessLogs(),
    personalRecords: Array.isArray(data.personalRecords) ? data.personalRecords : seedPersonalRecords()
  };
  return normalizePersonIndexes(state);
}

function normalizePersonalRecord(data) {
  const category = String(data.category || "").trim();
  const residentId = String(data.residentId || "").trim();
  if (!residentId || !category) {
    throw new Error("residentId 和 category 不能为空");
  }
  return {
    id: data.id || randomUUID(),
    residentId,
    category,
    date: String(data.date || todayOffset(0)),
    name: String(data.name || "未命名健康资料"),
    result: String(data.result || ""),
    source: String(data.source || "居民上传"),
    meta: data.meta && typeof data.meta === "object" ? data.meta : {},
    createdBy: data.createdBy || "resident",
    createdAt: data.createdAt || new Date().toISOString()
  };
}

function normalizePersonIndexes(state) {
  const residents = Array.isArray(state.residents) ? state.residents : [];
  residents.forEach((resident) => {
    resident.personIndex = personIndexFromParts(resident.idCard, resident.phone);
    resident.identityIndex = resident.personIndex;
  });
  const residentMap = new Map(residents.map((resident) => [resident.id, resident]));
  ["diseases", "followups", "personalRecords", "careOrders", "medicationPickups", "insuranceClaims", "seniorServices", "dataAccessLogs"].forEach((key) => {
    (Array.isArray(state[key]) ? state[key] : []).forEach((item) => {
      item.personIndex = item.personIndex || personIndexForResident(residentMap, item.residentId);
    });
  });
  (Array.isArray(state.accounts) ? state.accounts : []).forEach((account) => {
    (Array.isArray(account.members) ? account.members : []).forEach((member) => {
      member.personIndex = member.personIndex || personIndexForResident(residentMap, member.residentId);
    });
  });
  return state;
}

function personIndexFromParts(idCard, phone) {
  return `${String(idCard || "").trim()}#${String(phone || "").trim()}`;
}

function personIndexForResident(residentMap, residentId) {
  const resident = residentMap.get(residentId);
  return resident ? personIndexFromParts(resident.idCard, resident.phone) : "";
}

function serveStatic(req, res) {
  const rawPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const requested = rawPath === "/" ? "/index.html" : rawPath;
  const filePath = path.normalize(path.join(ROOT, requested));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    res.end(content);
  });
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && req.url === "/api/health") {
    sendJson(res, 200, { ok: true, storage: DB_FILE });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    sendJson(res, 200, readDatabase());
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/state") {
    const data = normalizeState(await collectJson(req));
    writeDatabase(data);
    sendJson(res, 200, data);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/personal-records") {
    const data = readDatabase();
    const residentId = url.searchParams.get("residentId");
    const category = url.searchParams.get("category");
    const records = data.personalRecords.filter((item) => (!residentId || item.residentId === residentId) && (!category || item.category === category));
    sendJson(res, 200, records);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/personal-records") {
    const data = readDatabase();
    const recordData = normalizePersonalRecord(await collectJson(req));
    const residentMap = new Map(data.residents.map((resident) => [resident.id, resident]));
    recordData.personIndex = recordData.personIndex || personIndexForResident(residentMap, recordData.residentId);
    data.personalRecords.push(recordData);
    writeDatabase(data);
    sendJson(res, 201, recordData);
    return;
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/personal-records/")) {
    const id = decodeURIComponent(url.pathname.replace("/api/personal-records/", ""));
    const patch = await collectJson(req);
    const data = readDatabase();
    const index = data.personalRecords.findIndex((item) => item.id === id);
    if (index < 0) {
      sendJson(res, 404, { error: "personal record not found" });
      return;
    }
    data.personalRecords[index] = {
      ...data.personalRecords[index],
      ...patch,
      meta: {
        ...(data.personalRecords[index].meta || {}),
        ...(patch.meta || {})
      },
      updatedAt: new Date().toISOString()
    };
    writeDatabase(data);
    sendJson(res, 200, data.personalRecords[index]);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/reset") {
    const data = seedState();
    writeDatabase(data);
    sendJson(res, 200, data);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/id") {
    sendJson(res, 200, { id: randomUUID() });
    return;
  }

  sendJson(res, 404, { error: "API not found" });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/")) {
      await handleApi(req, res);
      return;
    }
    serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  ensureDatabase();
  console.log(`慢病医防融合管理平台已启动：http://localhost:${PORT}`);
});
