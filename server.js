const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const PORT = Number(process.env.PORT || 5173);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const DEMO_PASSWORD = "123456";
const sessions = new Map();

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
    securityEvents: seedSecurityEvents(),
    digitalCredentials: seedDigitalCredentials(),
    healthArchiveStandard: seedHealthArchiveStandard(),
    authUsers: seedAuthUsers(),
    countyConsortium: seedCountyConsortium(),
    referralSystem: seedReferralSystem(),
    platformRoadmap: seedPlatformRoadmap(),
    personalRecords: seedPersonalRecords()
  };
}

function seedPlatformRoadmap() {
  return [
    {
      priority: "P0",
      title: "统一运营工作台",
      reason: "系统功能多、端口多，需要总控台承接整体梳理、跨端待办和后续开发顺序。",
      scope: ["系统总览", "跨端待办", "路线图"],
      status: "已完成",
      nextAction: "继续从工作台选择下一项 P0。"
    },
    {
      priority: "P0",
      title: "真实认证、角色权限和审计闭环",
      reason: "健康档案和电子病历属于敏感数据，当前登录仍是前端演示，需要后端会话、接口权限和审计。",
      scope: ["登录", "权限", "审计", "API"],
      status: "进行中",
      nextAction: "已完成后端会话、接口权限和安全事件第一版；下一步接入真实身份源、密码哈希和机构级权限。"
    },
    {
      priority: "P0",
      title: "SQLite 数据库迁移",
      reason: "JSON 适合演示，不适合长期开发。需要结构化表、索引、迁移脚本和数据备份。",
      scope: ["数据层", "持久化", "迁移"],
      status: "待开发",
      nextAction: "建立 SQLite schema，迁移 data/db.json。"
    },
    {
      priority: "P1",
      title: "居民 360 详情与趋势图",
      reason: "医生和居民都需要按时间查看指标、病历、用药、检查、随访、取药和转诊。",
      scope: ["个人端", "医疗机构端", "健康档案"],
      status: "待开发",
      nextAction: "新增居民全景详情页和血压、血糖、BMI 趋势。"
    },
    {
      priority: "P1",
      title: "业务动作闭环",
      reason: "当前多数状态为展示型，下一步要能接诊、审核、下转、完成取药、完成随访。",
      scope: ["分级诊疗", "医保", "取药", "随访"],
      status: "待开发",
      nextAction: "为转诊、医保审核、固定取药增加状态操作。"
    },
    {
      priority: "P1",
      title: "检查检验互认与资源共享中心深化",
      reason: "县域医共体和分级诊疗都依赖医技共享、结果互认、危急值和质控。",
      scope: ["医共体", "医疗机构", "医保监管"],
      status: "待开发",
      nextAction: "新增影像、心电、检验互认台账和质控规则。"
    },
    {
      priority: "P2",
      title: "统计报表和绩效考核",
      reason: "卫健委和医共体办公室需要面向管理的月报、绩效、机构排名和导出能力。",
      scope: ["卫健委端", "县域医共体", "导出"],
      status: "待开发",
      nextAction: "补充月报生成、机构绩效评分和 CSV/JSON 导出。"
    },
    {
      priority: "P2",
      title: "移动端和适老化深化",
      reason: "居民端最终要在手机上使用，需要大字模式、家属代办、消息提醒和无障碍优化。",
      scope: ["个人端", "手机预览", "适老化"],
      status: "待开发",
      nextAction: "新增大字模式、提醒中心、家属代办入口。"
    }
  ];
}

function seedReferralSystem() {
  return {
    policy: "国办发〔2026〕11号《关于加快建设分级诊疗体系的若干措施》",
    goals: [
      "以紧密型医联体为抓手完善分级诊疗协同机制",
      "以常见病、慢性病为重点引导群众基层首诊",
      "以提升就医连续性为导向加强转诊服务管理",
      "完善医保支付、价格、薪酬和宣传引导等多元保障措施"
    ],
    institutionRoles: [
      { level: "基层医疗卫生机构", role: "基层首诊、慢病管理、长期处方、家庭医生签约、康复护理和上门服务", outpatientFocus: "常见病、慢性病、恢复期管理", gatekeeping: "首诊与转诊发起" },
      { level: "二级医院", role: "承接常见病专科、康复、护理、安宁疗护、医养结合，承担三级医院和基层之间桥梁作用", outpatientFocus: "专科复诊、康复护理、下转承接", gatekeeping: "区域转诊枢纽" },
      { level: "三级医院", role: "聚焦急危重症和疑难复杂疾病，提供转诊会诊、住院服务和专科能力下沉", outpatientFocus: "疑难重症、急危重症、专科会诊", gatekeeping: "上转接诊与下转指导" }
    ],
    rules: [
      { name: "基层首诊", scenario: "常见病、慢性病、诊断明确且病情稳定", action: "优先在基层就诊，由家庭医生或全科医生评估。", owner: "基层医疗卫生机构" },
      { name: "上转", scenario: "疑难复杂、急危重症、基层能力不足、需住院或专科会诊", action: "由基层或二级医院发起转诊，上级医院预留号源床位并及时接诊。", owner: "转诊中心" },
      { name: "下转", scenario: "恢复期、康复期、病情稳定、慢病长期管理", action: "上级医院主动下转，基层承接随访、康复、用药和健康管理。", owner: "牵头医院" },
      { name: "跨区域转诊", scenario: "跨统筹地区、跨省异地就医", action: "原则上由二、三级医院副主任医师及以上人员评估必要性。", owner: "二三级医院" }
    ],
    referrals: [
      { id: "rf1", residentId: "r1", type: "上转", diseaseType: "高血压", from: "青泥洼桥社区卫生服务中心", to: "大连市中心医院 · 心内科", reason: "血压控制不佳，需专科调整方案", status: "待接诊", priority: "高", date: "2026-06-16", reservedResource: "心内科号源 2 个，床位 1 张", insurancePolicy: "基层逐级转诊，住院起付线连续计算" },
      { id: "rf2", residentId: "r2", type: "上转", diseaseType: "糖尿病", from: "星海湾社区卫生服务中心", to: "大连医科大学附属医院 · 内分泌科", reason: "空腹血糖偏高，需复查糖化血红蛋白", status: "已接诊", priority: "中", date: "2026-06-18", reservedResource: "内分泌复诊号源 3 个", insurancePolicy: "门诊报销按转诊路径执行差异化支付" },
      { id: "rf3", residentId: "r4", type: "下转", diseaseType: "高血压", from: "大连市中心医院", to: "青泥洼桥社区卫生服务中心 · 家庭医生工作室", reason: "病情稳定，转回基层长期随访和续方", status: "基层承接", priority: "中", date: "2026-06-20", reservedResource: "家庭医生随访 1 次，长期处方 8 周", insurancePolicy: "同一疾病周期下转基层不另设住院起付线" }
    ],
    reservedResources: [
      { institution: "大连市中心医院", department: "心内科", outpatientSlots: 12, beds: 4, forPrimaryReferral: "基层转诊优先", status: "可预约" },
      { institution: "大连医科大学附属医院", department: "内分泌科", outpatientSlots: 10, beds: 2, forPrimaryReferral: "慢病复查优先", status: "可预约" },
      { institution: "青泥洼桥社区卫生服务中心", department: "家庭医生工作室", outpatientSlots: 30, beds: 0, forPrimaryReferral: "下转随访承接", status: "可承接" }
    ],
    insuranceGuidance: [
      { item: "逐级转诊住院起付线", policy: "统筹地区内经基层逐级转诊的参保患者，上级医院住院起付线连续计算。", status: "已纳入审核规则" },
      { item: "下转基层起付线", policy: "上级医院下转至基层的住院患者，同一疾病周期内不再另设住院起付线。", status: "已纳入审核规则" },
      { item: "差异化报销比例", policy: "不同等级医疗机构住院报销比例原则上逐级拉开 10 个百分点左右。", status: "待配置地区参数" },
      { item: "基层长期处方", policy: "符合条件慢病患者基层单次可开具不超过 12 周用药长期处方。", status: "已纳入慢病取药闭环" }
    ],
    familyDoctorServices: [
      { residentId: "r1", servicePackage: "高血压签约服务包", provider: "刘医生团队", items: ["疾病预防", "基本医疗", "转诊服务", "用药指导"], fulfillment: "履约中", nextAction: "补充家庭血压记录并评估上转结果" },
      { residentId: "r2", servicePackage: "糖尿病签约服务包", provider: "赵医生团队", items: ["血糖监测", "健康咨询", "转诊服务", "用药指导"], fulfillment: "待随访", nextAction: "复查糖化血红蛋白后调整随访计划" },
      { residentId: "r4", servicePackage: "老年高血压服务包", provider: "刘医生团队", items: ["慢病随访", "康复指导", "家属代办", "长期处方"], fulfillment: "履约中", nextAction: "承接下转后开具 8 周处方" }
    ],
    education: [
      { title: "基层首诊指引", audience: "居民", message: "常见病、慢性病和诊断明确的稳定期问题优先到社区卫生服务中心或乡镇卫生院就诊。", channel: "个人端、家庭医生" },
      { title: "有序转诊须知", audience: "居民", message: "经基层评估后上转，可享受预留号源床位和连续起付线等政策衔接。", channel: "个人端、转诊中心" },
      { title: "长期处方与固定取药", audience: "慢病患者", message: "符合条件的慢病患者基层单次可开具不超过 12 周长期处方，并与固定取药闭环联动。", channel: "个人端、医保端" }
    ]
  };
}

function seedAuthUsers() {
  return [
    { id: "u1", username: "whjw", name: "卫健委管理员", role: "commission", roleName: "卫生健康委端", home: "index.html", status: "启用" },
    { id: "u2", username: "doctor", name: "刘医生", role: "institution", roleName: "医疗机构端", home: "institution.html", status: "启用" },
    { id: "u3", username: "insurance", name: "医保审核员", role: "insurance", roleName: "医保端", home: "insurance.html", status: "启用" },
    { id: "u4", username: "citizen", name: "王建国", role: "citizen", roleName: "个人端", home: "citizen.html", residentId: "r1", accountId: "a1", status: "启用" },
    { id: "u5", username: "county", name: "医共体办公室", role: "county", roleName: "县域医共体平台", home: "county.html", status: "启用" }
  ];
}

function seedCountyConsortium() {
  const domains = [
    ["区域医疗服务协同", ["医学影像诊断资源共享中心", "心电诊断资源共享中心", "医学检验资源共享中心", "病理诊断资源共享中心", "远程会诊资源共享中心", "消毒供应资源共享中心", "县域智慧医疗急救中心"]],
    ["便民惠民服务协同", ["电子健康卡应用", "互联网+诊疗服务", "互联网+慢病协同管理", "互联网+家庭医生签约服务", "预约诊疗服务", "中医智能辅诊服务", "中药智能药学服务", "基层缺药登记服务", "居民用药监测服务"]],
    ["医疗管理服务协同", ["检验检查结果互认服务", "合理用药审核及药事管理协同服务", "医保业务协同服务", "远程医学教育", "县域中医药适宜技术推广"]],
    ["公共卫生服务协同", ["慢性病业务协同服务", "老年健康业务协同服务", "妇幼保健业务协同服务", "疫苗接种业务协同服务", "突发公共卫生事件应急处置指挥协同管理", "基层医疗卫生机构和公共卫生业务协同服务", "其他卫生业务协同服务"]],
    ["基层医疗卫生综合管理", ["综合决策管理统一可视化展示", "人力资源统一协同管理", "财务统一协同管理", "物资统一协同管理", "药品耗材统一协同管理", "行政统一协同管理", "医共体绩效统一协同管理", "医疗废弃物统一协同管理"]]
  ];
  let no = 1;
  return {
    organizations: [
      { name: "县域医共体总医院", level: "牵头医院", role: "医技共享、远程会诊、质控、绩效和运营管理", systems: ["HIS", "EMR", "运营监管"] },
      { name: "乡镇卫生院", level: "成员单位", role: "基层首诊、签约服务、慢病随访、转诊申请", systems: ["基层医疗", "公卫", "家医签约"] },
      { name: "村卫生室", level: "网底机构", role: "健康监测、取药登记、随访提醒", systems: ["移动随访", "电子健康卡"] },
      { name: "疾控/妇幼/急救中心", level: "公共卫生", role: "疾控、妇幼、疫苗、应急和院前急救", systems: ["疾控", "妇幼", "急救"] }
    ],
    capabilities: domains.flatMap(([domain, names]) => names.map((name) => ({
      no: no++,
      domain,
      name,
      summary: "依据紧密型县域医共体信息化功能指引建设，支撑县乡村一体化协同。",
      owner: domain.includes("综合") ? "医共体办公室" : "牵头医院",
      status: no % 4 === 0 ? "建设中" : no % 7 === 0 ? "待启动" : "运行中",
      functions: ["申请", "协同", "质控", "统计"],
      risk: no % 7 === 0 ? "需推进" : "正常"
    }))),
    tasks: [
      { title: "检验检查结果互认规则上线", owner: "医共体办公室", due: "2026-07-15", action: "统一互认项目、质控标准和不互认理由。", status: "进行中", level: "高" },
      { title: "基层缺药登记与药物配供闭环", owner: "总医院药学中心", due: "2026-07-30", action: "接入固定取药、延伸处方和配送状态。", status: "进行中", level: "中" }
    ],
    workflows: [
      { name: "医技共享", steps: ["基层申请", "中心诊断", "报告回传", "结果互认"] },
      { name: "双向转诊", steps: ["转诊申请", "资源预约", "接诊反馈", "下转随访"] },
      { name: "慢病协同", steps: ["筛查建档", "风险分级", "干预随访", "用药监测"] }
    ],
    indicators: [
      { name: "县域内就诊率", value: "82.4%", target: "逐季提升", source: "HIS/医保结算", trend: "正常" },
      { name: "基层首诊率", value: "61.8%", target: "提升基层能力", source: "预约与门诊记录", trend: "正常" },
      { name: "检验检查互认率", value: "46.2%", target: "减少重复检查", source: "医技共享中心", trend: "预警" }
    ],
    governance: [
      { title: "省市统筹、县域落地", detail: "依托全民健康信息平台，统一网络、标准、接口和安全要求。" },
      { title: "数据安全与最小授权", detail: "健康档案、电子病历、医保、药品和绩效数据分级授权、访问留痕。" }
    ]
  };
}

function seedHealthArchiveStandard() {
  const contentGroups = [
    { key: "basic", title: "个人基本信息", detail: "人口学、社会经济、亲属、社会保障、基本健康、建档信息。" },
    { key: "child", title: "儿童保健", detail: "出生医学证明、新生儿筛查、儿童体检、体弱儿童管理。" },
    { key: "women", title: "妇女保健", detail: "婚前保健、妇女病普查、计划生育、孕产期保健、产前筛查、出生缺陷监测。" },
    { key: "diseaseControl", title: "疾病预防", detail: "预防接种、传染病、结核病、艾滋病、职业病、伤害、中毒、行为危险因素、死亡证明。" },
    { key: "diseaseManagement", title: "疾病管理", detail: "高血压、糖尿病、肿瘤、严重精神障碍、老年人健康管理。" },
    { key: "medical", title: "医疗服务", detail: "门诊、住院、住院病案首页、成人健康体检。" }
  ];
  const datasets = [
    ["HRA00.01", "basic", "个人信息基本数据集", "建档", "all"],
    ["HRB01.01", "child", "出生医学证明", "儿童保健", "child"],
    ["HRB01.02", "child", "新生儿疾病筛查", "儿童保健", "child"],
    ["HRB01.03", "child", "儿童健康体检", "儿童保健", "child"],
    ["HRB01.04", "child", "体弱儿童管理", "儿童保健", "child"],
    ["HRB02.01", "women", "婚前保健服务", "妇女保健", "women"],
    ["HRB02.02", "women", "妇女病普查", "妇女保健", "women"],
    ["HRB02.03", "women", "计划生育技术服务", "妇女保健", "women"],
    ["HRB02.04", "women", "孕产期保健服务与高危管理", "妇女保健", "women"],
    ["HRB02.05", "women", "产前筛查与诊断", "妇女保健", "women"],
    ["HRB02.06", "women", "出生缺陷监测", "妇女保健", "women"],
    ["HRB03.01", "diseaseControl", "预防接种", "疾病预防", "all"],
    ["HRB03.02", "diseaseControl", "传染病报告", "疾病预防", "event"],
    ["HRB03.03", "diseaseControl", "结核病防治", "疾病预防", "event"],
    ["HRB03.04", "diseaseControl", "艾滋病防治", "疾病预防", "event"],
    ["HRB03.05", "diseaseControl", "血吸虫病病人管理", "疾病预防", "event"],
    ["HRB03.06", "diseaseControl", "慢性丝虫病病人管理", "疾病预防", "event"],
    ["HRB03.07", "diseaseControl", "职业病报告", "疾病预防", "event"],
    ["HRB03.08", "diseaseControl", "职业性健康监护", "疾病预防", "event"],
    ["HRB03.09", "diseaseControl", "伤害监测报告", "疾病预防", "event"],
    ["HRB03.10", "diseaseControl", "中毒报告", "疾病预防", "event"],
    ["HRB03.11", "diseaseControl", "行为危险因素监测", "疾病预防", "all"],
    ["HRB03.12", "diseaseControl", "死亡医学证明", "疾病预防", "event"],
    ["HRB04.01", "diseaseManagement", "高血压病例管理", "疾病管理", "disease"],
    ["HRB04.02", "diseaseManagement", "糖尿病病例管理", "疾病管理", "disease"],
    ["HRB04.03", "diseaseManagement", "肿瘤病例管理", "疾病管理", "disease"],
    ["HRB04.04", "diseaseManagement", "精神分裂症病例管理", "疾病管理", "disease"],
    ["HRB04.05", "diseaseManagement", "老年人健康管理", "疾病管理", "elderly"],
    ["HRC00.01", "medical", "门诊诊疗", "医疗服务", "all"],
    ["HRC00.02", "medical", "住院诊疗", "医疗服务", "event"],
    ["HRC00.03", "medical", "住院病案首页", "医疗服务", "event"],
    ["HRC00.04", "medical", "成人健康体检", "医疗服务", "adult"]
  ].map(([code, group, name, activity, appliesTo]) => ({ code, group, name, activity, appliesTo }));
  return {
    version: "健康档案基本架构与数据标准（试行）",
    dimensions: [
      { key: "lifeStage", title: "生命阶段", detail: "按生命阶段组织居民全生命周期档案。" },
      { key: "healthProblem", title: "健康和疾病问题", detail: "围绕风险因素、慢病、重大疾病和健康问题持续更新。" },
      { key: "serviceActivity", title: "卫生服务活动", detail: "归集预防、医疗、保健、康复、健康教育和随访干预。" }
    ],
    contentGroups,
    datasets
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

function seedSecurityEvents() {
  return [
    { id: "se1", at: "2026-06-15 08:55", actor: "卫健委管理员", role: "commission", action: "登录", target: "卫生健康委端", result: "允许", detail: "演示账号进入监管总览" },
    { id: "se2", at: "2026-06-15 10:20", actor: "医保审核员", role: "insurance", action: "访问接口", target: "/api/state", result: "允许", detail: "读取结算审核与机构监管数据" },
    { id: "se3", at: "2026-06-15 14:08", actor: "未授权机构", role: "unknown", action: "访问个人健康信息", target: "完整电子病历", result: "拒绝", detail: "未取得居民授权或角色权限" }
  ];
}

function seedDigitalCredentials() {
  return [
    { id: "dc1", residentId: "r1", type: "电子健康码", provider: "区域全民健康信息平台", credentialNo: "HC-210204-3219", status: "已绑定", lastVerified: "2026-06-15", usage: "就医身份识别、健康档案调阅" },
    { id: "dc2", residentId: "r1", type: "医保电子凭证", provider: "医保信息平台", credentialNo: "MI-13800010001", status: "已激活", lastVerified: "2026-06-15", usage: "门诊慢特病结算、固定取药审核" },
    { id: "dc3", residentId: "r2", type: "医保电子凭证", provider: "医保信息平台", credentialNo: "MI-13800010002", status: "待核验", lastVerified: "2026-06-12", usage: "门诊统筹结算" },
    { id: "dc4", residentId: "r4", type: "居民一卡通", provider: "城市服务平台", credentialNo: "CC-210213-3521", status: "家属代办", lastVerified: "2026-06-10", usage: "线下帮办、家属代取药" }
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
    securityEvents: Array.isArray(data.securityEvents) ? data.securityEvents : seedSecurityEvents(),
    digitalCredentials: Array.isArray(data.digitalCredentials) ? data.digitalCredentials : seedDigitalCredentials(),
    healthArchiveStandard: data.healthArchiveStandard && typeof data.healthArchiveStandard === "object" ? data.healthArchiveStandard : seedHealthArchiveStandard(),
    authUsers: Array.isArray(data.authUsers) ? data.authUsers : seedAuthUsers(),
    countyConsortium: data.countyConsortium && typeof data.countyConsortium === "object" ? data.countyConsortium : seedCountyConsortium(),
    referralSystem: data.referralSystem && typeof data.referralSystem === "object" ? data.referralSystem : seedReferralSystem(),
    platformRoadmap: Array.isArray(data.platformRoadmap) ? data.platformRoadmap : seedPlatformRoadmap(),
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
  ["diseases", "followups", "personalRecords", "careOrders", "medicationPickups", "insuranceClaims", "seniorServices", "dataAccessLogs", "digitalCredentials"].forEach((key) => {
    (Array.isArray(state[key]) ? state[key] : []).forEach((item) => {
      item.personIndex = item.personIndex || personIndexForResident(residentMap, item.residentId);
    });
  });
  (Array.isArray(state.referralSystem?.referrals) ? state.referralSystem.referrals : []).forEach((item) => {
    item.personIndex = item.personIndex || personIndexForResident(residentMap, item.residentId);
  });
  (Array.isArray(state.referralSystem?.familyDoctorServices) ? state.referralSystem.familyDoctorServices : []).forEach((item) => {
    item.personIndex = item.personIndex || personIndexForResident(residentMap, item.residentId);
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

function sanitizeUser(user) {
  if (!user) return null;
  const { password, passwordHash, ...safeUser } = user;
  return safeUser;
}

function findAuthUser(username) {
  const data = readDatabase();
  return data.authUsers.find((user) => user.username === username && user.status !== "停用");
}

function createSession(user) {
  const token = randomUUID();
  const now = Date.now();
  const safeUser = sanitizeUser(user);
  const session = {
    token,
    user: safeUser,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString()
  };
  sessions.set(token, session);
  return session;
}

function currentSession(req) {
  const auth = String(req.headers.authorization || "");
  const bearer = auth.match(/^Bearer\s+(.+)$/i);
  const token = bearer?.[1] || req.headers["x-auth-token"];
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function requireApiRole(req, res, roles, target) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  const session = currentSession(req);
  if (!session) {
    appendSecurityEvent({ actor: "anonymous", role: "anonymous", action: "访问接口", target, result: "拒绝", detail: "未登录或会话已过期" });
    sendJson(res, 401, { error: "Unauthorized", message: "请先登录后再访问该接口" });
    return null;
  }
  if (!allowed.includes(session.user.role) && session.user.role !== "commission") {
    appendSecurityEvent({ actor: session.user.name, role: session.user.role, action: "访问接口", target, result: "拒绝", detail: `需要角色：${allowed.join("、")}` });
    sendJson(res, 403, { error: "Forbidden", message: "当前角色无权访问该接口" });
    return null;
  }
  return session.user;
}

function canAccessResident(user, residentId, data) {
  if (!residentId) return user.role !== "citizen";
  if (user.role !== "citizen") return true;
  if (user.residentId === residentId) return true;
  const account = data.accounts.find((item) => item.id === user.accountId);
  return Boolean(account?.members?.some((member) => member.residentId === residentId));
}

function appendSecurityEvent(event) {
  const data = readDatabase();
  data.securityEvents = [
    {
      id: randomUUID(),
      at: new Date().toLocaleString("zh-CN", { hour12: false }),
      actor: event.actor || "unknown",
      role: event.role || "unknown",
      action: event.action || "访问接口",
      target: event.target || "",
      result: event.result || "允许",
      detail: event.detail || ""
    },
    ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
  ].slice(0, 120);
  writeDatabase(data);
}

function appendDataAccessLog(data, user, residentId, scope, purpose, result = "允许") {
  const residentMap = new Map(data.residents.map((resident) => [resident.id, resident]));
  data.dataAccessLogs = [
    {
      id: randomUUID(),
      residentId,
      personIndex: personIndexForResident(residentMap, residentId),
      at: new Date().toLocaleString("zh-CN", { hour12: false }),
      actor: user?.name || "anonymous",
      role: user?.roleName || user?.role || "anonymous",
      scope,
      purpose,
      result
    },
    ...(Array.isArray(data.dataAccessLogs) ? data.dataAccessLogs : [])
  ].slice(0, 120);
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && req.url === "/api/health") {
    sendJson(res, 200, { ok: true, storage: DB_FILE });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const credentials = await collectJson(req);
    const user = findAuthUser(String(credentials.username || "").trim());
    if (!user || credentials.password !== DEMO_PASSWORD) {
      appendSecurityEvent({ actor: credentials.username || "unknown", role: "unknown", action: "登录", target: "统一认证", result: "拒绝", detail: "账号或密码错误" });
      sendJson(res, 401, { ok: false, message: "账号或密码不正确" });
      return;
    }
    const session = createSession(user);
    appendSecurityEvent({ actor: user.name, role: user.role, action: "登录", target: user.home, result: "允许", detail: "后端会话已签发" });
    sendJson(res, 200, { ok: true, token: session.token, expiresAt: session.expiresAt, user: session.user });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    const session = currentSession(req);
    if (!session) {
      sendJson(res, 401, { ok: false, message: "未登录或会话已过期" });
      return;
    }
    sendJson(res, 200, { ok: true, user: session.user, expiresAt: session.expiresAt });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    const session = currentSession(req);
    if (session) {
      sessions.delete(session.token);
      appendSecurityEvent({ actor: session.user.name, role: session.user.role, action: "退出登录", target: "统一认证", result: "允许", detail: "后端会话已注销" });
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    sendJson(res, 200, readDatabase());
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/state") {
    const user = requireApiRole(req, res, ["commission"], "/api/state");
    if (!user) return;
    const data = normalizeState(await collectJson(req));
    data.securityEvents = [
      {
        id: randomUUID(),
        at: new Date().toLocaleString("zh-CN", { hour12: false }),
        actor: user.name,
        role: user.role,
        action: "更新数据",
        target: "/api/state",
        result: "允许",
        detail: "全量保存平台数据"
      },
      ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
    ].slice(0, 120);
    writeDatabase(data);
    sendJson(res, 200, data);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/personal-records") {
    const user = requireApiRole(req, res, ["citizen", "institution", "insurance", "county", "commission"], "/api/personal-records");
    if (!user) return;
    const data = readDatabase();
    const residentId = url.searchParams.get("residentId");
    const category = url.searchParams.get("category");
    if (!canAccessResident(user, residentId, data)) {
      appendSecurityEvent({ actor: user.name, role: user.role, action: "访问个人健康信息", target: residentId || "all", result: "拒绝", detail: "超出居民授权范围" });
      sendJson(res, 403, { error: "Forbidden", message: "无权访问该居民健康信息" });
      return;
    }
    const records = data.personalRecords.filter((item) => (!residentId || item.residentId === residentId) && (!category || item.category === category));
    if (residentId) {
      appendDataAccessLog(data, user, residentId, "个人健康信息库", `查询 ${category || "全部"} 记录`);
      writeDatabase(data);
    }
    sendJson(res, 200, records);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/personal-records") {
    const user = requireApiRole(req, res, ["citizen", "institution", "commission"], "/api/personal-records");
    if (!user) return;
    const data = readDatabase();
    const recordData = normalizePersonalRecord(await collectJson(req));
    if (!canAccessResident(user, recordData.residentId, data)) {
      appendSecurityEvent({ actor: user.name, role: user.role, action: "新增个人健康信息", target: recordData.residentId, result: "拒绝", detail: "超出居民授权范围" });
      sendJson(res, 403, { error: "Forbidden", message: "无权新增该居民健康信息" });
      return;
    }
    const residentMap = new Map(data.residents.map((resident) => [resident.id, resident]));
    recordData.personIndex = recordData.personIndex || personIndexForResident(residentMap, recordData.residentId);
    recordData.createdBy = user.username || user.role;
    recordData.createdByName = user.name;
    data.personalRecords.push(recordData);
    appendDataAccessLog(data, user, recordData.residentId, "个人健康信息库", `新增 ${recordData.category} 记录`);
    writeDatabase(data);
    sendJson(res, 201, recordData);
    return;
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/personal-records/")) {
    const user = requireApiRole(req, res, ["citizen", "institution", "commission"], "/api/personal-records/:id");
    if (!user) return;
    const id = decodeURIComponent(url.pathname.replace("/api/personal-records/", ""));
    const patch = await collectJson(req);
    const data = readDatabase();
    const index = data.personalRecords.findIndex((item) => item.id === id);
    if (index < 0) {
      sendJson(res, 404, { error: "personal record not found" });
      return;
    }
    if (!canAccessResident(user, data.personalRecords[index].residentId, data)) {
      appendSecurityEvent({ actor: user.name, role: user.role, action: "更新个人健康信息", target: data.personalRecords[index].residentId, result: "拒绝", detail: "超出居民授权范围" });
      sendJson(res, 403, { error: "Forbidden", message: "无权更新该居民健康信息" });
      return;
    }
    data.personalRecords[index] = {
      ...data.personalRecords[index],
      ...patch,
      meta: {
        ...(data.personalRecords[index].meta || {}),
        ...(patch.meta || {})
      },
      updatedBy: user.username || user.role,
      updatedByName: user.name,
      updatedAt: new Date().toISOString()
    };
    appendDataAccessLog(data, user, data.personalRecords[index].residentId, "个人健康信息库", `更新 ${data.personalRecords[index].category} 记录`);
    writeDatabase(data);
    sendJson(res, 200, data.personalRecords[index]);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/reset") {
    const user = requireApiRole(req, res, ["commission"], "/api/reset");
    if (!user) return;
    const data = seedState();
    data.securityEvents = [
      {
        id: randomUUID(),
        at: new Date().toLocaleString("zh-CN", { hour12: false }),
        actor: user.name,
        role: user.role,
        action: "重置数据",
        target: "/api/reset",
        result: "允许",
        detail: "恢复演示数据"
      },
      ...data.securityEvents
    ];
    writeDatabase(data);
    sendJson(res, 200, data);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/id") {
    const user = requireApiRole(req, res, ["citizen", "institution", "insurance", "county", "commission"], "/api/id");
    if (!user) return;
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
