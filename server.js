const http = require("http");
const fs = require("fs");
const path = require("path");
const { createHash, createHmac, pbkdf2Sync, randomUUID, timingSafeEqual } = require("crypto");

const PORT = Number(process.env.PORT || 5173);
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const SQLITE_FILE = path.join(DATA_DIR, "health-city.sqlite");
const STORAGE_ENGINE = String(process.env.STORAGE_ENGINE || "auto").toLowerCase();
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const DEMO_PASSWORD = "123456";
const PASSWORD_HASH_ITERATIONS = 120_000;
const STORAGE_SCHEMA_VERSION = 6;
const sessions = new Map();
let sqliteModule = null;
let sqliteError = null;
const SQLITE_MIGRATIONS = [
  {
    version: 1,
    name: "create collection state and storage events",
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS state_collections (
          key TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS storage_events (
          id TEXT PRIMARY KEY,
          at TEXT NOT NULL,
          event TEXT NOT NULL,
          detail TEXT NOT NULL
        );
      `);
    }
  },
  {
    version: 2,
    name: "add collection versions and update index",
    apply(db) {
      const columns = db.prepare("PRAGMA table_info(state_collections)").all();
      if (!columns.some((column) => column.name === "version")) {
        db.exec("ALTER TABLE state_collections ADD COLUMN version INTEGER NOT NULL DEFAULT 1");
      }
      db.exec("CREATE INDEX IF NOT EXISTS idx_state_collections_updated_at ON state_collections(updated_at)");
    }
  },
  {
    version: 3,
    name: "add structured identity mirror tables",
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS residents (
          id TEXT PRIMARY KEY,
          person_index TEXT,
          name TEXT NOT NULL,
          id_card TEXT,
          phone TEXT,
          gender TEXT,
          birth_date TEXT,
          organization TEXT,
          family_doctor TEXT,
          address TEXT,
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_residents_person_index
          ON residents(person_index)
          WHERE person_index IS NOT NULL AND person_index != '';
        CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          phone TEXT,
          role TEXT,
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS account_members (
          account_id TEXT NOT NULL,
          resident_id TEXT NOT NULL,
          relation TEXT,
          person_index TEXT,
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (account_id, resident_id),
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
          FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_account_members_resident_id
          ON account_members(resident_id);
        CREATE INDEX IF NOT EXISTS idx_account_members_person_index
          ON account_members(person_index);
        CREATE TABLE IF NOT EXISTS person_indexes (
          person_index TEXT PRIMARY KEY,
          resident_id TEXT NOT NULL UNIQUE,
          id_card TEXT,
          phone TEXT,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE CASCADE
        );
      `);
    }
  },
  {
    version: 4,
    name: "add structured personal record mirror table",
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS personal_records (
          id TEXT PRIMARY KEY,
          resident_id TEXT NOT NULL,
          person_index TEXT,
          category TEXT NOT NULL,
          record_date TEXT,
          name TEXT NOT NULL,
          result TEXT,
          source TEXT,
          created_by TEXT,
          created_at TEXT,
          updated_by TEXT,
          updated_at TEXT,
          payload TEXT NOT NULL,
          synced_at TEXT NOT NULL,
          FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_personal_records_resident_category
          ON personal_records(resident_id, category);
        CREATE INDEX IF NOT EXISTS idx_personal_records_person_index
          ON personal_records(person_index);
        CREATE INDEX IF NOT EXISTS idx_personal_records_record_date
          ON personal_records(record_date);
      `);
    }
  },
  {
    version: 5,
    name: "add structured business workflow mirror tables",
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS chronic_records (
          id TEXT PRIMARY KEY,
          collection TEXT NOT NULL,
          resident_id TEXT NOT NULL,
          person_index TEXT,
          disease_type TEXT,
          title TEXT NOT NULL,
          status TEXT,
          owner TEXT,
          due_date TEXT,
          payload TEXT NOT NULL,
          synced_at TEXT NOT NULL,
          FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_chronic_records_collection_status
          ON chronic_records(collection, status);
        CREATE INDEX IF NOT EXISTS idx_chronic_records_resident
          ON chronic_records(resident_id);
        CREATE INDEX IF NOT EXISTS idx_chronic_records_due_date
          ON chronic_records(due_date);
        CREATE TABLE IF NOT EXISTS followup_records (
          id TEXT PRIMARY KEY,
          resident_id TEXT NOT NULL,
          person_index TEXT,
          disease_type TEXT,
          planned_at TEXT,
          assignee TEXT,
          status TEXT,
          result TEXT,
          payload TEXT NOT NULL,
          synced_at TEXT NOT NULL,
          FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_followup_records_resident_status
          ON followup_records(resident_id, status);
        CREATE INDEX IF NOT EXISTS idx_followup_records_planned_at
          ON followup_records(planned_at);
        CREATE TABLE IF NOT EXISTS insurance_claim_records (
          id TEXT PRIMARY KEY,
          resident_id TEXT NOT NULL,
          person_index TEXT,
          institution TEXT,
          claim_type TEXT,
          disease_type TEXT,
          total_amount REAL,
          insurance_pay REAL,
          self_pay REAL,
          status TEXT,
          claim_date TEXT,
          payload TEXT NOT NULL,
          synced_at TEXT NOT NULL,
          FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_insurance_claim_records_resident_status
          ON insurance_claim_records(resident_id, status);
        CREATE INDEX IF NOT EXISTS idx_insurance_claim_records_claim_date
          ON insurance_claim_records(claim_date);
        CREATE TABLE IF NOT EXISTS certificate_records (
          id TEXT PRIMARY KEY,
          certificate_type TEXT NOT NULL,
          certificate_no TEXT,
          resident_id TEXT,
          person_index TEXT,
          subject_name TEXT,
          issuing_institution TEXT,
          status TEXT,
          electronic_license_status TEXT,
          event_at TEXT,
          last_updated TEXT,
          payload TEXT NOT NULL,
          synced_at TEXT NOT NULL,
          FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_certificate_records_type_status
          ON certificate_records(certificate_type, status);
        CREATE INDEX IF NOT EXISTS idx_certificate_records_resident
          ON certificate_records(resident_id);
        CREATE INDEX IF NOT EXISTS idx_certificate_records_event_at
          ON certificate_records(event_at);
      `);
    }
  },
  {
    version: 6,
    name: "add service and county workflow mirror tables",
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS care_order_records (
          id TEXT PRIMARY KEY,
          resident_id TEXT NOT NULL,
          person_index TEXT,
          institution TEXT,
          department TEXT,
          order_type TEXT,
          status TEXT,
          priority TEXT,
          order_date TEXT,
          payload TEXT NOT NULL,
          synced_at TEXT NOT NULL,
          FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_care_order_records_resident_status
          ON care_order_records(resident_id, status);
        CREATE INDEX IF NOT EXISTS idx_care_order_records_order_date
          ON care_order_records(order_date);
        CREATE TABLE IF NOT EXISTS medication_pickup_records (
          id TEXT PRIMARY KEY,
          resident_id TEXT NOT NULL,
          person_index TEXT,
          medication TEXT NOT NULL,
          pharmacy TEXT,
          next_pickup TEXT,
          status TEXT,
          coverage TEXT,
          delivery_mode TEXT,
          payload TEXT NOT NULL,
          synced_at TEXT NOT NULL,
          FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_medication_pickup_records_resident_status
          ON medication_pickup_records(resident_id, status);
        CREATE INDEX IF NOT EXISTS idx_medication_pickup_records_next_pickup
          ON medication_pickup_records(next_pickup);
        CREATE TABLE IF NOT EXISTS county_workflow_records (
          id TEXT PRIMARY KEY,
          collection TEXT NOT NULL,
          resident_id TEXT NOT NULL,
          person_index TEXT,
          region TEXT,
          institution TEXT,
          workflow_type TEXT,
          status TEXT,
          event_at TEXT,
          payload TEXT NOT NULL,
          synced_at TEXT NOT NULL,
          FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_county_workflow_records_collection_status
          ON county_workflow_records(collection, status);
        CREATE INDEX IF NOT EXISTS idx_county_workflow_records_resident
          ON county_workflow_records(resident_id);
        CREATE INDEX IF NOT EXISTS idx_county_workflow_records_event_at
          ON county_workflow_records(event_at);
      `);
    }
  }
];
const WORKFLOW_COLLECTIONS = new Set(["careOrders", "medicationPickups", "insuranceClaims", "followups", "referrals", "deathCertificates", "birthCertificates", "multiPracticeApplications", "digitalCredentials", "emergencySignals", "chronicScreeningTasks", "chronicEducationPushes", "chronicManagementPlans", "countyCollaborationOrders", "countyAiDiagnosisCases", "countyMutualRecognitionRecords", "diagnosticReports"]);
const WORKFLOW_ROLE_COLLECTIONS = {
  commission: WORKFLOW_COLLECTIONS,
  institution: new Set(["careOrders", "medicationPickups", "followups", "referrals", "deathCertificates", "birthCertificates", "multiPracticeApplications", "chronicScreeningTasks", "chronicEducationPushes", "chronicManagementPlans"]),
  insurance: new Set(["insuranceClaims", "medicationPickups", "digitalCredentials"]),
  county: new Set(["countyCollaborationOrders", "countyAiDiagnosisCases", "countyMutualRecognitionRecords", "diagnosticReports"])
};
const WORKFLOW_PROTECTED_FIELDS = new Set(["id", "residentId", "maternalResidentId", "personIndex", "credentialNo", "certificateNo", "documentNo", "motherDocumentNo", "fatherDocumentNo", "createdAt", "createdBy", "createdByName", "lastUpdated", "updatedAt", "updatedBy", "updatedByName"]);
const PERSONAL_RECORD_PROTECTED_FIELDS = new Set(["id", "residentId", "personIndex", "createdAt", "createdBy", "createdByName", "updatedAt", "updatedBy", "updatedByName", "expectedVersion"]);
const RESIDENT_PROTECTED_FIELDS = new Set(["id", "idCard", "phone", "personIndex", "identityIndex"]);
const MULTI_PRACTICE_PROTECTED_FIELDS = new Set(["id", "doctorId", "doctorName", "category", "title", "specialty", "primaryInstitutionId", "primaryInstitution", "targetInstitutionId", "targetInstitution", "compliance", "lastUpdated", "updatedBy", "updatedByName", "expectedVersion"]);
const SENSITIVE_RESPONSE_FIELDS = new Set(["idCard", "phone", "applicantPhone", "documentNo", "motherDocumentNo", "fatherDocumentNo", "certificateNo", "credentialNo", "personIndex", "identityIndex", "address"]);
const COLLECTION_WRITE_KEYS = new Set([
  "residents",
  "personalRecords",
  "careOrders",
  "medicationPickups",
  "insuranceClaims",
  "followups",
  "deathCertificates",
  "birthCertificates",
  "chronicScreeningTasks",
  "chronicEducationPushes",
  "chronicManagementPlans"
]);

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
        name: "演示居民A账户",
        phone: "DEMO-MOBILE-R1",
        role: "本人",
        members: [
          { residentId: "r1", relation: "本人" },
          { residentId: "r4", relation: "母亲" }
        ]
      },
      {
        id: "a2",
        name: "演示居民B账户",
        phone: "DEMO-MOBILE-R2",
        role: "本人",
        members: [
          { residentId: "r2", relation: "本人" }
        ]
      }
    ],
    residents: [
      {
        id: "r1",
        name: "演示居民A",
        idCard: "DEMO-ID-R1",
        gender: "男",
        birthDate: "1968-02-11",
        phone: "DEMO-MOBILE-R1",
        organization: "青泥洼桥社区卫生服务中心",
        familyDoctor: "刘医生",
        address: "演示地址A",
        metrics: { systolic: 166, diastolic: 96, glucose: 6.8, bmi: 29.4 }
      },
      {
        id: "r2",
        name: "演示居民B",
        idCard: "DEMO-ID-R2",
        gender: "女",
        birthDate: "1975-05-20",
        phone: "DEMO-MOBILE-R2",
        organization: "星海湾社区卫生服务中心",
        familyDoctor: "赵医生",
        address: "演示地址B",
        metrics: { systolic: 138, diastolic: 84, glucose: 7.8, bmi: 25.1 }
      },
      {
        id: "r3",
        name: "演示居民C",
        idCard: "DEMO-ID-R3",
        gender: "男",
        birthDate: "1988-11-09",
        phone: "DEMO-MOBILE-R3",
        organization: "甘井子区人民医院",
        familyDoctor: "孙医生",
        address: "演示地址C",
        metrics: { systolic: 126, diastolic: 78, glucose: 5.5, bmi: 24.2 }
      },
      {
        id: "r4",
        name: "演示居民D",
        idCard: "DEMO-ID-R4",
        gender: "女",
        birthDate: "1964-10-01",
        phone: "DEMO-MOBILE-R4",
        organization: "青泥洼桥社区卫生服务中心",
        familyDoctor: "刘医生",
        address: "演示地址D",
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
    healthStatistics: seedHealthStatistics(),
    deathCertificates: seedDeathCertificates(),
    deathCertificateForms: seedDeathCertificateForms(),
    deathStatistics: seedDeathStatistics(),
    birthCertificates: seedBirthCertificates(),
    birthCertificateForms: seedBirthCertificateForms(),
    birthStatistics: seedBirthStatistics(),
    healthBulletin2024: seedHealthBulletin2024(),
    dalianHealthStatistics2025: seedDalianHealthStatistics2025(),
    healthStatisticsIngestion: seedHealthStatisticsIngestion(),
    doctorProfiles: seedDoctorProfiles(),
    multiPracticePolicy: seedMultiPracticePolicy(),
    multiPracticeApplications: seedMultiPracticeApplications(),
    chronicScreeningTasks: seedChronicScreeningTasks(),
    chronicEducationPushes: seedChronicEducationPushes(),
    chronicManagementPlans: seedChronicManagementPlans(),
    countyCollaborationOrders: seedCountyCollaborationOrders(),
    countyAiDiagnosisCases: seedCountyAiDiagnosisCases(),
    countyMutualRecognitionRecords: seedCountyMutualRecognitionRecords(),
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
    authOrganizations: seedAuthOrganizations(),
    authUsers: seedAuthUsers(),
    interfaceRequirements: seedInterfaceRequirements(),
    chronicProjectBlueprint: seedChronicProjectBlueprint(),
    countyProjectBlueprint: seedCountyProjectBlueprint(),
    countyConsortium: seedCountyConsortium(),
    referralSystem: seedReferralSystem(),
    platformCapabilities: seedPlatformCapabilities(),
    platformIntegrations: seedPlatformIntegrations(),
    platformInterfaces: seedPlatformInterfaces(),
    platformDeliveryBatches: seedPlatformDeliveryBatches(),
    platformEvidence: seedPlatformEvidence(),
    applicationCatalog: seedApplicationCatalog(),
    institutionCreditEvaluations: seedInstitutionCreditEvaluations(),
    securityAcceptanceLedger: seedSecurityAcceptanceLedger(),
    platformChangeLogs: seedPlatformChangeLogs(),
    platformRoadmap: seedPlatformRoadmap(),
    platformAudit: seedPlatformAudit(),
    platformProcessAudit: seedPlatformProcessAudit(),
    personalRecords: seedPersonalRecords()
  };
}

function seedPlatformChangeLogs() {
  return [
    { id: "pcl-001", at: "2026-06-18 15:10", actor: "市级管理员", role: "commission", collection: "platformCapabilities", itemId: "cap-data-platform", itemName: "城市级医疗健康大数据平台", action: "初始化建设台账", before: "无", after: "开发中", note: "按申报材料建立建设域、整合项、接口域和开发批次数据。" }
  ];
}

function seedPlatformCapabilities() {
  return [
    { id: "cap-data-platform", group: "城市级医疗健康大数据平台", source: "申报材料（五）项目建设目标及内容、七（二）本期建设方案", target: "统一平台底座、区域医疗健康大数据中心、全域互联互通、数据资产管理、信创及国产密码改造", existing: ["residents", "personalRecords", "healthStatistics", "dataAccessLogs", "securityEvents"], status: "开发中", next: "补齐共享文档、信息资源中心、运行监控、标签模型、数据资产目录和存量模块统一纳管。" },
    { id: "cap-doctor", group: "助医应用", source: "分级诊疗、临床治疗辅助、居民健康数字身份", target: "远程会诊、双向转诊、远程影像、远程心电、委托检验、远程教育、临床辅助提醒", existing: ["careOrders", "referralSystem", "personalRecords", "countyMutualRecognitionRecords"], status: "已衔接", next: "将现有转诊、协同工单、检验检查互认扩展为远程会诊和区域专科诊断业务流。" },
    { id: "cap-citizen", group: "惠民应用", source: "健康大连互联网应用统一入口、互联网+药事服务、居民健康画像", target: "居民统一入口、诊后用药、用药提醒、个性化健康标签、授权共享", existing: ["accounts", "residents", "personalRecords", "medicationPickups", "digitalCredentials"], status: "已衔接", next: "把居民端、移动预览、固定取药和授权共享归入健康大连统一入口。" },
    { id: "cap-governance", group: "辅政应用", source: "数智健康大脑、卫生统计质控共享、医疗机构信用评价", target: "综合监管专题、统计直报质控、数据可视化、信用评价、公示", existing: ["healthStatistics", "healthStatisticsIngestion", "platformAudit", "platformProcessAudit"], status: "开发中", next: "新增医疗机构信用评价模型，并把统计质控问题沉淀为闭环工单。" },
    { id: "cap-research", group: "医疗科研创新平台", source: "专病库、多模态医疗数据集、科研研究落地验证", target: "结构化、标准化、高质量、可计算数据集，支撑专病库和科研协作", existing: ["diseases", "chronicScreeningTasks", "chronicManagementPlans", "personalRecords"], status: "待深化", next: "在慢病专病库基础上补充病种版本、数据脱敏、伦理审批、科研项目授权和数据集发布流程。" },
    { id: "cap-district", group: "区级机构对接及应用实施", source: "中山区、沙河口区、甘井子区、高新区区属医疗机构数据采集和应用下沉", target: "区属医院、基层医疗机构、妇幼机构、体检机构接入，市级应用下沉", existing: ["countyConsortium", "countyCollaborationOrders", "countyAiDiagnosisCases", "medicalResources"], status: "已衔接", next: "沿用医共体和机构端组织模型，补齐区级接入批次、接口验收和应用培训台账。" },
    { id: "cap-evaluation", group: "互联互通测评服务", source: "互联互通四甲、五乙测评材料、模拟演练、现场查验", target: "标准化改造、健康医疗数据归集、文审材料、模拟演练、测评证据", existing: ["interfaceRequirements", "platformProcessAudit", "platformRoadmap"], status: "待深化", next: "建立测评证据库，按共享文档、术语标准、主索引、互联互通交易逐项归档。" },
    { id: "cap-security", group: "安全可靠和密码应用", source: "等保三级、密码应用安全性评估、信创适配", target: "统一认证、国密传输、数据库关键信息加密、日志审计、国产软硬件适配", existing: ["authUsers", "authOrganizations", "securityEvents", "dataAccessLogs"], status: "开发中", next: "把当前登录、角色、审计能力升级为等保和密评验收清单。" }
  ];
}

function seedPlatformIntegrations() {
  return [
    { id: "int-health-1-2", name: "全民健康信息平台一、二期", approach: "原生升级", keep: "主索引、注册服务、四大数据库、业务协同、监管和便民能力", target: "市级平台底座", owner: "市级平台", status: "已纳入" },
    { id: "int-pharmacy", name: "医疗机构药事管理平台", approach: "接口接入+场景合并", keep: "药事管理数据、药事服务流程", target: "互联网+药事服务、固定取药、医保审核", owner: "药政/医保中心", status: "开发中" },
    { id: "int-care", name: "保健管理系统", approach: "数据回流+门户集成", keep: "医疗管理、健康管理、综合管理、统计分析", target: "居民健康画像、行业治理专题", owner: "保健管理", status: "待接口" },
    { id: "int-emergency-video", name: "疫情防控应急指挥视频通讯平台", approach: "能力复用", keep: "视频会议、应急指挥调度、可视化政务管理", target: "公共卫生应急、远程会诊、远程教育", owner: "应急管理", status: "待接口" },
    { id: "int-chronic", name: "慢病管理平台", approach: "模块纳管", keep: "筛查、建档、风险分级、随访、宣教、固定取药", target: "医疗科研专病库、医防协同和居民画像", owner: "疾控/基层", status: "已纳入" },
    { id: "int-county", name: "医共体信息平台", approach: "能力复用+边界清晰", keep: "县乡村一体化、医技共享、基层AI辅助、协同工单", target: "区级应用下沉、分级诊疗和区域诊断中心", owner: "医共体办公室", status: "已纳入" }
  ];
}

function seedPlatformInterfaces() {
  return [
    { id: "if-auth", domain: "统一认证", existing: "现有登录、角色、会话、审计", next: "政务统一认证、CA、短信、人脸核验", priority: "P0", owner: "市级平台", status: "开发中" },
    { id: "if-person-index", domain: "居民主索引", existing: "personIndex、居民档案、家庭成员", next: "人口库、电子健康码、标准健康档案主索引", priority: "P0", owner: "市级平台", status: "开发中" },
    { id: "if-medical", domain: "医疗机构业务系统", existing: "个人健康信息库、机构端协同", next: "HIS、EMR、LIS、PACS、心电、体检系统", priority: "P0", owner: "医疗机构", status: "待接口" },
    { id: "if-referral", domain: "分级诊疗", existing: "转诊规则、协同工单、预留资源", next: "远程会诊、双向转诊、远程影像、心电、检验、教育", priority: "P0", owner: "医政医管", status: "开发中" },
    { id: "if-insurance", domain: "医保结算监管", existing: "医保审核、凭证核验、固定取药审核", next: "医保核心结算、门慢门特、异地转诊规则", priority: "P1", owner: "医保局/医保中心/区市县医保局", status: "演示对接完成" },
    { id: "if-statistics", domain: "卫生统计", existing: "统计导入任务、资源直报对账、质控看板", next: "辽宁省卫统直报、国家统计直报系统", priority: "P1", owner: "规划信息", status: "演示对接完成" },
    { id: "if-license", domain: "电子证照", existing: "出生/死亡医学证明模型和统计", next: "电子证照平台、公安户籍、民政殡葬、疾控死因监测", priority: "P1", owner: "医政/妇幼", status: "已建模" },
    { id: "if-evaluation", domain: "互联互通测评", existing: "接口需求清单、流程审计、路线图", next: "共享文档、术语标准、交易服务、测评文审材料", priority: "P1", owner: "项目办", status: "待深化" },
    { id: "if-security", domain: "安全信创", existing: "角色权限、安全事件、访问日志", next: "国密传输、数据库加密、日志保全、密评和等保证据", priority: "P0", owner: "安全管理", status: "开发中" }
  ];
}

function seedPlatformDeliveryBatches() {
  return [
    { id: "batch-foundation", phase: "第一批：平台底座和存量纳管", owner: "市级平台", items: ["统一应用目录", "统一身份认证", "数据资源目录", "存量模块登记", "运行监控"], status: "启动" },
    { id: "batch-doctor", phase: "第二批：助医和分级诊疗闭环", owner: "医政医管/医疗机构", items: ["双向转诊", "远程会诊", "区域影像", "区域心电", "委托检验", "远程教育"], status: "衔接现有机构端和医共体模块" },
    { id: "batch-citizen", phase: "第三批：惠民统一入口", owner: "基层卫生/居民端", items: ["健康大连统一入口", "互联网+药事服务", "居民健康画像", "授权共享", "固定取药提醒"], status: "衔接居民端和慢病模块" },
    { id: "batch-governance", phase: "第四批：辅政和科研", owner: "规划信息/科研管理", items: ["数智健康大脑", "统计质控共享", "信用评价", "专病库", "科研数据集"], status: "补齐治理和科研能力" },
    { id: "batch-acceptance", phase: "第五批：测评、安全和验收", owner: "项目办/安全管理", items: ["互联互通五乙材料", "等保三级", "密评", "信创适配", "接口验收"], status: "贯穿全周期沉淀证据" }
  ];
}

function seedPlatformEvidence() {
  return [
    { id: "ev-application", category: "申报材料", name: "提级论证申报材料闭环", owner: "项目办", source: "项目申报材料、建设方案、预算和论证意见", artifacts: ["建设范围矩阵", "存量模块合并清单", "开发批次计划", "周报素材"], status: "已建档", next: "持续补充需求变更、会议纪要和专家论证反馈。", records: [] },
    { id: "ev-interoperability", category: "互联互通测评", name: "四甲/五乙测评证据包", owner: "项目办/标准管理", source: "共享文档、术语字典、主索引、交易服务、测评文审材料", artifacts: ["接口清单", "标准映射", "交易样例", "整改记录"], status: "待补齐", next: "按接口域逐项挂接截图、报文样例、测试记录和整改状态。", records: [] },
    { id: "ev-security", category: "安全合规", name: "等保、密评和信创适配证据", owner: "安全管理岗", source: "统一认证、访问审计、安全事件、数据访问日志、信创适配清单", artifacts: ["权限矩阵", "审计日志", "安全事件", "密评整改项"], status: "开发中", next: "补齐国密传输、数据库加密、日志保全和国产化适配证明。", records: [] },
    { id: "ev-interface", category: "接口联调", name: "外部系统接口联调验收", owner: "市级平台/医疗机构", source: "HIS、EMR、LIS、PACS、医保、电子证照、卫生统计等对接计划", artifacts: ["联调计划", "字段映射", "异常清单", "回归测试"], status: "开发中", next: "为每个接口域建立责任人、环境、频率、样例和验收规则。", records: [] },
    { id: "ev-launch", category: "上线验收", name: "区级实施和应用上线材料", owner: "实施组", source: "中山、沙河口、甘井子、高新区实施批次和应用培训记录", artifacts: ["上线确认", "培训签到", "试运行问题", "用户反馈"], status: "待启动", next: "按区县、机构、应用和批次沉淀上线确认与问题闭环。", records: [] }
  ];
}

function seedApplicationCatalog() {
  return [
    { id: "app-health-platform", name: "全民健康信息平台一、二期", sourceSystem: "市级存量平台", interfaceMode: "原生升级", owner: "规划信息处", reuseMode: "底座复用", batch: "第一批", evidence: "平台现状清单/架构图", status: "已纳管", next: "补齐运行监控和数据资源目录关联。" },
    { id: "app-chronic", name: "慢病医防融合管理", sourceSystem: "慢病管理平台", interfaceMode: "模块纳管", owner: "基层卫生处/疾控", reuseMode: "业务与数据复用", batch: "第一批", evidence: "筛查随访闭环/接口清单", status: "已纳管", next: "挂接专病库版本和科研数据集目录。" },
    { id: "app-county", name: "县域医共体协同", sourceSystem: "医共体信息平台", interfaceMode: "API/能力复用", owner: "医政医管处", reuseMode: "协同中心复用", batch: "第二批", evidence: "16255 功能清单/工单样例", status: "已纳管", next: "补齐区级实施批次和培训证据。" },
    { id: "app-institution", name: "医疗机构业务协同", sourceSystem: "HIS/EMR/LIS/PACS", interfaceMode: "标准接口", owner: "医疗机构", reuseMode: "门户集成+数据回流", batch: "第二批", evidence: "字段映射/联调记录", status: "开发中", next: "按机构登记接口环境、版本和联调责任人。" },
    { id: "app-citizen", name: "健康大连居民服务", sourceSystem: "居民端/健康码", interfaceMode: "统一入口", owner: "基层卫生处", reuseMode: "入口整合", batch: "第三批", evidence: "居民旅程/授权记录", status: "已纳管", next: "接入政务身份源和正式消息服务。" },
    { id: "app-insurance", name: "医保结算监管协同", sourceSystem: "医保核心平台", interfaceMode: "接口接入", owner: "医保局/医保中心", reuseMode: "业务协同", batch: "第三批", evidence: "结算审核/凭证核验样例", status: "演示对接完成", next: "确认生产接口规范和联调窗口。" }
  ];
}

function seedInstitutionCreditEvaluations() {
  return [
    { id: "credit-central", name: "大连市中心医院", institutionType: "三级医院", period: "2026上半年", score: 92, grade: "A", indicators: "依法执业98/质量安全90/数据报送88/服务信用92", owner: "医政医管处", status: "已评价", next: "保持月度数据质量复核并公示优秀项。" },
    { id: "credit-ganjingzi", name: "甘井子区人民医院", institutionType: "二级医院", period: "2026上半年", score: 84, grade: "B", indicators: "依法执业92/质量安全86/数据报送76/服务信用82", owner: "属地卫生行政部门", status: "整改中", next: "30日内完成统计迟报和接口数据缺项整改。" },
    { id: "credit-community", name: "青泥洼桥社区卫生服务中心", institutionType: "基层机构", period: "2026上半年", score: 88, grade: "B+", indicators: "依法执业95/质量安全87/数据报送85/服务信用86", owner: "中山区卫生健康局", status: "已评价", next: "补齐家庭医生签约数据质控证据。" }
  ];
}

function seedSecurityAcceptanceLedger() {
  return [
    { id: "security-level3", name: "网络安全等级保护三级", category: "等保", control: "定级备案、差距测评、安全整改、复测", evidence: "定级报告/备案证明/测评报告/整改记录", owner: "安全管理岗", status: "开发中", next: "完成生产环境定级备案和测评机构进场计划。" },
    { id: "security-crypto", name: "密码应用安全性评估", category: "密评", control: "国密传输、身份鉴别、存储加密、密钥管理", evidence: "密码应用方案/检测记录/密评报告", owner: "密码应用责任人", status: "待测评", next: "确定密码设备和电子签名边界，形成测评对象清单。" },
    { id: "security-gm", name: "国产密码改造", category: "国密改造", control: "SM2/SM3/SM4、国密SSL、关键字段加密", evidence: "改造清单/配置截图/兼容性测试", owner: "平台技术组", status: "方案设计", next: "完成接口、数据库和证书链的国密改造排期。" },
    { id: "security-domestic", name: "信创适配", category: "信创适配", control: "国产CPU、操作系统、数据库、中间件和浏览器", evidence: "适配矩阵/测试报告/问题闭环", owner: "基础设施组", status: "待测试", next: "建立软硬件版本矩阵并执行功能、性能和容灾测试。" }
  ];
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
      status: "已完成",
      nextAction: "本地演示已完成后端会话、接口权限、角色范围和审计闭环；真实身份源接入列为现场实施配置。"
    },
    {
      priority: "P0",
      title: "SQLite 数据库迁移",
      reason: "JSON 适合演示，不适合长期开发。需要结构化表、索引、迁移脚本和数据备份。",
      scope: ["数据层", "持久化", "迁移"],
      status: "已完成",
      nextAction: "已完成 SQLite 主存储、JSON 快照、集合级索引口径和数据备份说明；生产库拆表列为部署实施项。"
    },
    {
      priority: "P1",
      title: "居民 360 详情与趋势图",
      reason: "医生和居民都需要按时间查看指标、病历、用药、检查、随访、取药和转诊。",
      scope: ["个人端", "医疗机构端", "健康档案"],
      status: "已完成",
      nextAction: "已在卫健委端、个人端和医疗机构端形成居民 360、健康指标趋势、档案病历、协同闭环和访问审计。"
    },
    {
      priority: "P1",
      title: "业务动作闭环",
      reason: "当前多数状态为展示型，下一步要能接诊、审核、下转、完成取药、完成随访。",
      scope: ["分级诊疗", "医保", "取药", "随访"],
      status: "已完成",
      nextAction: "已新增 /api/workflow-actions，并在医疗机构端、医保中心经办端接入接诊、审核、签发、上报、取药和备案按钮。"
    },
    {
      priority: "P1",
      title: "检查检验互认与资源共享中心深化",
      reason: "县域医共体和分级诊疗都依赖医技共享、结果互认、危急值和质控。",
      scope: ["医共体", "医疗机构", "医保监管"],
      status: "进行中",
      nextAction: "已补齐县域医共体页面的协同工单、互认台账和质控展示；下一步完成真实互认规则、危急值、医保调阅和报告回传接口。"
    },
    {
      priority: "P2",
      title: "统计报表和绩效考核",
      reason: "卫健委和医共体办公室需要面向管理的月报、绩效、机构排名和导出能力。",
      scope: ["卫健委端", "县域医共体", "导出"],
      status: "进行中",
      nextAction: "已形成演示月报和绩效视图；下一步把医共体绩效、人财物、药耗、基层履约指标拆成可导出的验收报表。"
    },
    {
      priority: "P2",
      title: "移动端和适老化深化",
      reason: "居民端最终要在手机上使用，需要大字模式、家属代办、消息提醒和无障碍优化。",
      scope: ["个人端", "手机预览", "适老化"],
      status: "进行中",
      nextAction: "居民端已有手机预览、家属代办和授权上传入口；下一步补消息触达、线下帮办和无障碍验收。"
    }
  ];
}

function seedPlatformAudit() {
  return [
    { module: "慢病", issue: "筛查、宣教、分级管理已有演示台账和操作按钮，但仍需接入真实外部接口与运营质控。", priority: "P1", owner: "疾控/卫健委", status: "进行中", nextAction: "按接口清单逐项标注来源系统、数据项、更新频率、责任人和验收规则。" },
    { module: "慢病", issue: "专病库和风险模型已入模，但缺少模型版本、适用人群、触发阈值和人工复核记录。", priority: "P1", owner: "慢病中心", status: "待细化", nextAction: "为每个筛查模型补版本、阈值、复核人和输出处置路径。" },
    { module: "医共体", issue: "16255 建设模型已入模，但新建应用尚未拆成实施批次和验收指标。", priority: "P1", owner: "医共体办公室", status: "进行中", nextAction: "按消毒供应、跨机构预约、合理用药、人财物、绩效、基层 AI 分批排期。" },
    { module: "医共体", issue: "影像、心电、检验共享中心已有台账，但互认规则、危急值、医保调阅、不互认原因仍需接口化。", priority: "P1", owner: "医技质控中心", status: "进行中", nextAction: "建立互认规则字典、质控复核流、报告回传记录和医保调阅日志。" }
  ];
}

function seedPlatformProcessAudit() {
  return [
    { process: "统一登录与角色权限", owner: "市级平台", status: "进行中", risk: "真实身份源待接入", auditPoint: "核查账号、角色、机构范围、拒绝访问和安全事件是否留痕。", evidence: "演示账号、Bearer 会话和安全事件已建模。", nextAction: "接入政务统一认证、密码哈希和机构级权限。" },
    { process: "居民主索引与个人健康信息库", owner: "市级平台", status: "已闭环", risk: "正式人口主索引待接入", auditPoint: "核查居民、档案、病历、授权、取药、医保是否使用同一 personIndex。", evidence: "居民、慢病、随访、个人健康记录、取药和医保数据均保留 personIndex。", nextAction: "对接人口库、电子健康码和正式健康档案主索引。" },
    { process: "慢病筛查、随访与分级管理", owner: "疾控/卫健委", status: "进行中", risk: "外部专病库与质控待接入", auditPoint: "核查筛查建档、风险分层、随访、宣教、分级管理是否形成闭环。", evidence: "筛查任务、宣教推送、管理计划和随访台账已进入系统。", nextAction: "补齐模型版本、触发阈值、人工复核和质控抽查。" },
    { process: "分级诊疗与双向转诊", owner: "转诊中心", status: "进行中", risk: "真实号源床位接口待接入", auditPoint: "核查基层评估、上转、接诊、下转、随访和医保引导。", evidence: "转诊规则、预留资源、医保引导和居民宣教已入模。", nextAction: "接入预约号源、床位、接诊反馈和下转随访消息。" },
    { process: "固定取药与长期处方", owner: "基层机构/医保中心", status: "进行中", risk: "药房库存与医保结算接口待接入", auditPoint: "核查个人申请、机构确认、医保中心审核、药房取药和状态回流。", evidence: "个人端取药计划、机构确认、医保中心审核和药房状态已建模。", nextAction: "对接处方、药房库存、配送和医保结算状态。" },
    { process: "医保审核与监管", owner: "医保局/医保中心/区市县医保局", status: "进行中", risk: "医保核心系统待接入", auditPoint: "核查慢病结算、支付引导、凭证核验、机构监管和审核留痕，并区分行政监管、经办审核和属地监管职责。", evidence: "医保中心审核、医保局基金监管、区市县医保局属地监管和凭证核验已建模。", nextAction: "接入医保核心结算、门慢门特、双通道和异地转诊规则。" },
    { process: "县域医共体协同", owner: "医共体办公室", status: "进行中", risk: "新建应用批次与验收待细化", auditPoint: "核查医技共享、互认、基层 AI、绩效、人财物和药耗协同。", evidence: "16255 模型、协同工单、互认记录和基层 AI 病例已入模。", nextAction: "拆分上线批次，建立互认、危急值、报告回传和绩效验收指标。" },
    { process: "公共卫生应急预警", owner: "卫健委端", status: "进行中", risk: "多点触发真实数据源待接入", auditPoint: "核查风险信号、资源调度、处置反馈和复盘记录。", evidence: "风险信号、区域、级别、处置动作已入模。", nextAction: "接入疾控、医疗资源、基层随访和医保异常监测。" },
    { process: "出生死亡证明与人口统计", owner: "医疗机构/卫健委", status: "进行中", risk: "国家平台与公安民政共享待接入", auditPoint: "核查证照签发、材料、上报、共享、质控和统计回流。", evidence: "出生证明、死亡证明、统计主题和共享去向已建模。", nextAction: "对接电子证照、人口死亡登记、公安户籍和民政殡葬共享。" },
    { process: "卫生统计导入与发布", owner: "规划发展与信息化处", status: "进行中", risk: "国家直报系统接口待接入", auditPoint: "核查采集、解析、指标映射、质控、入库、发布和审计留痕。", evidence: "统计导入流程、任务、资源报表和公报数据已建模。", nextAction: "固化指标口径、映射规则、版本发布和差异复核。" },
    { process: "数据安全与访问审计", owner: "安全管理岗", status: "进行中", risk: "生产级脱敏、密评、等保待实施", auditPoint: "核查授权、访问、拒绝、脱敏、敏感写操作和审计日志。", evidence: "访问日志、安全事件、接口拒绝和授权记录已进入审计视图。", nextAction: "补齐生产级日志保全、脱敏策略、密评和等保验收证据。" }
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
      { title: "长期处方与固定取药", audience: "慢病患者", message: "符合条件的慢病患者基层单次可开具不超过 12 周长期处方，并与固定取药闭环联动。", channel: "个人端、医保中心经办端" }
    ]
  };
}

function seedAuthUsers() {
  return [
    { id: "u-city", username: "city", name: "市级管理员", role: "commission", roleName: "市级健康城市管理", orgCode: "ORG-CITY-DL", orgName: "大连市健康城市平台", orgType: "city", orgLevel: "市级", dataScope: "全市", home: "workbench.html", status: "启用" },
    { id: "u-district", username: "district", name: "区市县管理员", role: "commission", roleName: "区市县管理端", orgCode: "ORG-DIST-ZS", orgName: "中山区健康城市平台", orgType: "district", orgLevel: "区市县", dataScope: "中山区", home: "workbench.html", status: "启用" },
    { id: "u-health", username: "health", name: "大连市卫生健康委管理员", role: "commission", roleName: "大连市卫生健康委", orgCode: "ORG-HEALTH-DL", orgName: "大连市卫生健康委", orgType: "health_admin", orgLevel: "市级", dataScope: "医疗资源、统计直报、公共卫生、分级诊疗和数据质量监管", home: "index.html", status: "启用" },
    { id: "u-mi", username: "mi", name: "大连市医保局管理员", role: "insurance", roleName: "大连市医保局管理端", orgCode: "ORG-MI-DL", orgName: "大连市医保局", orgType: "insurance_bureau", orgLevel: "市级", dataScope: "医保政策、基金监管、待遇管理和跨区县监督", home: "insurance.html", status: "启用" },
    { id: "u-hospital", username: "hospital", name: "医疗机构管理员", role: "institution", roleName: "医疗机构端", orgCode: "MR1", orgName: "大连市中心医院", orgType: "medical_institution", orgLevel: "三级医院", dataScope: "本机构", home: "institution.html", status: "启用" },
    { id: "u-community", username: "community", name: "基层机构管理员", role: "institution", roleName: "基层医疗机构端", orgCode: "MR3", orgName: "青泥洼桥社区卫生服务中心", orgType: "medical_institution", orgLevel: "基层医疗机构", dataScope: "本机构与签约居民", home: "institution.html", status: "启用" },
    { id: "u1", username: "whjw", name: "大连市卫生健康委管理员", role: "commission", roleName: "大连市卫生健康委", orgCode: "ORG-HEALTH-DL", orgName: "大连市卫生健康委", orgType: "health_admin", orgLevel: "市级", dataScope: "医疗资源、统计直报、公共卫生、分级诊疗和数据质量监管", home: "index.html", status: "启用" },
    { id: "u2", username: "doctor", name: "刘医生", role: "institution", roleName: "医生账户", orgCode: "MR3", orgName: "青泥洼桥社区卫生服务中心", orgType: "medical_institution", orgLevel: "基层医疗机构", dataScope: "签约居民、随访、长期处方、多点执业申请", home: "institution.html", doctorId: "doc-liu", accountType: "doctor", status: "启用" },
    { id: "u-doctor-wang", username: "doctor_wang", name: "王医生", role: "institution", roleName: "医生账户", orgCode: "MR1", orgName: "大连市中心医院", orgType: "medical_institution", orgLevel: "三级医院", dataScope: "本机构诊疗、转诊接诊、多点执业备案", home: "institution.html", doctorId: "doc-wang", accountType: "doctor", status: "启用" },
    { id: "u3", username: "insurance", name: "大连市医保中心审核员", role: "insurance", roleName: "大连市医保中心经办端", orgCode: "ORG-MI-CENTER-DL", orgName: "大连市医保中心", orgType: "insurance_center", orgLevel: "市级", dataScope: "医保结算经办、凭证核验、固定取药审核和经办留痕", home: "insurance.html", status: "启用" },
    { id: "u-mi-district", username: "district_mi", name: "区市县医保局管理员", role: "insurance", roleName: "区市县医保局管理端", orgCode: "ORG-MI-DIST-ZS", orgName: "中山区医保局", orgType: "district_insurance_bureau", orgLevel: "区市县", dataScope: "本区医保基金监管、机构监管和慢病待遇协同", home: "insurance.html", status: "启用" },
    { id: "u4", username: "citizen", name: "演示居民A", role: "citizen", roleName: "个人端", orgCode: "PERSON-R1", orgName: "演示居民A家庭", orgType: "citizen", orgLevel: "个人", dataScope: "本人及家庭授权成员", home: "citizen.html", residentId: "r1", accountId: "a1", status: "启用" },
    { id: "u5", username: "county", name: "医共体办公室", role: "county", roleName: "县域医共体平台", orgCode: "ORG-CONSORTIUM-ZS", orgName: "中山区县域医共体", orgType: "county_consortium", orgLevel: "区市县", dataScope: "医共体成员机构", home: "county.html", status: "启用" }
  ];
}

function seedAuthOrganizations() {
  return [
    { orgCode: "ORG-CITY-DL", name: "大连市健康城市平台", orgType: "city", orgLevel: "市级", parentCode: "", portal: "workbench.html", dataScope: "全市总览、跨部门协同、运行监测", interfaces: ["统一认证", "人口主索引", "城市运行指标"] },
    { orgCode: "ORG-DIST-ZS", name: "中山区健康城市平台", orgType: "district", orgLevel: "区市县", parentCode: "ORG-CITY-DL", portal: "workbench.html", dataScope: "本区市县居民、机构、公共卫生和慢病管理", interfaces: ["区县数据交换", "基层治理平台"] },
    { orgCode: "ORG-HEALTH-DL", name: "大连市卫生健康委", orgType: "health_admin", orgLevel: "市级", parentCode: "ORG-CITY-DL", portal: "index.html", dataScope: "医疗资源、统计直报、公共卫生、分级诊疗监管", interfaces: ["卫生健康统计直报", "全民健康信息平台", "电子病历共享"] },
    { orgCode: "ORG-MI-DL", name: "大连市医保局", orgType: "insurance_bureau", orgLevel: "市级", parentCode: "ORG-CITY-DL", portal: "insurance.html", dataScope: "医保政策、基金监管、待遇管理、跨区县监督和部门协同", interfaces: ["医保政策管理", "基金监管", "待遇管理", "跨区县监督"] },
    { orgCode: "ORG-MI-CENTER-DL", name: "大连市医保中心", orgType: "insurance_center", orgLevel: "市级", parentCode: "ORG-MI-DL", portal: "insurance.html", dataScope: "医保结算经办、凭证核验、固定取药审核和业务留痕", interfaces: ["医保结算经办", "医保电子凭证", "慢病待遇经办", "固定取药审核"] },
    { orgCode: "ORG-MI-DIST-ZS", name: "中山区医保局", orgType: "district_insurance_bureau", orgLevel: "区市县", parentCode: "ORG-MI-DL", portal: "insurance.html", dataScope: "本区医保基金监管、机构监管、慢病待遇协同和基层服务监督", interfaces: ["区县医保监管", "机构监管", "基层待遇协同"] },
    { orgCode: "MR1", name: "大连市中心医院", orgType: "medical_institution", orgLevel: "三级医院", parentCode: "ORG-HEALTH-DL", portal: "institution.html", dataScope: "本机构诊疗、转诊接诊、病历与检查检验", interfaces: ["HIS", "EMR", "LIS", "PACS", "住院管理"] },
    { orgCode: "MR3", name: "青泥洼桥社区卫生服务中心", orgType: "medical_institution", orgLevel: "基层医疗机构", parentCode: "ORG-DIST-ZS", portal: "institution.html", dataScope: "签约居民、慢病随访、长期处方、固定取药", interfaces: ["基层医疗", "公卫", "家医签约"] }
  ];
}

function seedInterfaceRequirements() {
  return [
    { id: "ir-auth", domain: "统一认证", keepExisting: "保留 /api/auth/login、/api/auth/me、/api/auth/logout 和 Bearer token 机制", need: "本地演示认证已完成；政务统一身份认证、短信/CA/人脸核验为现场配置项", owner: "市级平台", priority: "P0", status: "演示对接完成" },
    { id: "ir-org", domain: "组织机构目录", keepExisting: "保留 authUsers、authOrganizations、medicalResources 的 orgCode/institutionId 映射", need: "接入市、区市县、大连市卫生健康委、医保局、医保中心、区市县医保局、医疗机构统一社会信用代码和机构编码", owner: "大连市卫生健康委", priority: "P0", status: "已建模" },
    { id: "ir-person", domain: "居民主索引", keepExisting: "保留 personIndex=身份证号#手机号 的演示索引和 personalRecords API", need: "本地多键主索引已完成；人口库、电子健康码和正式居民健康档案主索引为现场配置项", owner: "市级平台", priority: "P0", status: "演示对接完成" },
    { id: "ir-emr", domain: "电子病历与检查检验", keepExisting: "保留 personalRecords、健康档案/电子病历时间线和居民授权机制", need: "本地 EMR/LIS/PACS 摘要适配已完成；真实院内接口为现场配置项", owner: "各医疗机构", priority: "P1", status: "演示对接完成" },
    { id: "ir-doctor", domain: "医生账户与多点执业", keepExisting: "保留 doctorProfiles、multiPracticeApplications、/api/doctors/me 和 /api/multi-practice-applications", need: "对接医师电子化注册、定期考核、职称、人事合同、劳务协议、医疗责任保险和多点执业信息公开", owner: "医疗机构/大连市卫生健康委", priority: "P1", status: "已建模" },
    { id: "ir-death", domain: "死亡医学证明与死亡统计", keepExisting: "保留 deathCertificates、deathCertificateForms、deathStatistics 和 /api/death-certificates", need: "对接人口死亡信息登记系统、电子证照平台、疾控死因监测、公安户籍注销和民政殡葬服务共享", owner: "医疗机构/大连市卫生健康委", priority: "P1", status: "已建模" },
    { id: "ir-stat", domain: "卫生健康统计", keepExisting: "保留 healthStatistics、dalianHealthStatistics2025、healthStatisticsIngestion 和 /api/health-statistics/import-jobs", need: "本地报表导入、统计看板和质控任务已完成；国家直报系统接口为现场配置项", owner: "大连市卫生健康委", priority: "P1", status: "演示对接完成" },
    { id: "ir-mi", domain: "医保结算监管", keepExisting: "保留 insuranceClaims、institutionSupervisions、medicationPickups 和 /api/workflow-actions", need: "本地医保审核、凭证核验和固定取药审核已完成；医保核心结算接口为现场配置项", owner: "医保局/医保中心/区市县医保局", priority: "P1", status: "演示对接完成" },
    { id: "ir-workflow", domain: "跨端业务闭环", keepExisting: "保留 /api/workflow-actions 更新转诊、取药、随访、医保审核等状态", need: "本地状态回调、幂等业务单号、审计留痕已完成；跨系统消息中间件为现场配置项", owner: "市级平台", priority: "P1", status: "已完成" }
  ];
}

function seedIntegrationContracts() {
  return [
    { id: "his-patient-v1", domain: "HIS", version: "1.0.0", direction: "inbound", resource: "PatientVisit", requiredFields: ["externalId", "residentId", "institution", "visitedAt"], idempotencyKey: "externalId", signature: "HMAC-SHA256", retryPolicy: "3 次指数退避", status: "ready" },
    { id: "emr-summary-v1", domain: "EMR", version: "1.0.0", direction: "inbound", resource: "MedicalSummary", requiredFields: ["externalId", "residentId", "diagnosis", "recordDate"], idempotencyKey: "externalId", signature: "HMAC-SHA256", retryPolicy: "3 次指数退避", status: "ready" },
    { id: "lis-report-v1", domain: "LIS", version: "1.0.0", direction: "inbound", resource: "LabReport", requiredFields: ["externalId", "residentId", "item", "result", "reportedAt"], idempotencyKey: "externalId", signature: "HMAC-SHA256", retryPolicy: "3 次指数退避", status: "ready" },
    { id: "pacs-report-v1", domain: "PACS", version: "1.0.0", direction: "inbound", resource: "ImagingReport", requiredFields: ["externalId", "residentId", "modality", "conclusion", "reportedAt"], idempotencyKey: "externalId", signature: "HMAC-SHA256", retryPolicy: "3 次指数退避", status: "ready" },
    { id: "insurance-settlement-v1", domain: "医保", version: "1.0.0", direction: "bidirectional", resource: "SettlementStatus", requiredFields: ["externalId", "residentId", "claimStatus", "amount"], idempotencyKey: "externalId", signature: "HMAC-SHA256", retryPolicy: "失败进入补偿队列", status: "ready" },
    { id: "certificate-sync-v1", domain: "电子证照", version: "1.0.0", direction: "outbound", resource: "CertificateStatus", requiredFields: ["externalId", "certificateNo", "status"], idempotencyKey: "externalId", signature: "HMAC-SHA256", retryPolicy: "失败进入补偿队列", status: "ready" },
    { id: "statistics-report-v1", domain: "卫生统计", version: "1.0.0", direction: "inbound", resource: "HealthStatistics", requiredFields: ["externalId", "period", "institution", "metrics"], idempotencyKey: "externalId", signature: "HMAC-SHA256", retryPolicy: "人工复核后重放", status: "ready" }
  ];
}

function seedChronicProjectBlueprint() {
  return {
    source: "大连市慢病管理平台建设项目-提级论证申报材料（20260615）",
    sponsor: "大连市疾病预防控制中心（大连市卫生监督所）",
    goal: "构建覆盖防、筛、诊、治、管全流程的慢病管理平台，形成以人群、时间、空间、数字为核心的闭环管理。",
    architecture: [
      { name: "一中心", detail: "慢病数据中心，汇聚医疗、公卫、疾控、民政等多源数据，支撑采集、治理、存储、分析和服务接口。", status: "已入模" },
      { name: "三网", detail: "慢病教育系统、慢病筛查系统、慢病管理系统，分别承接宣教、风险筛查和分级干预。", status: "已入模" },
      { name: "一平台", detail: "慢病监管分析平台，支撑分布、归因、服务过程、死亡结局和防治趋势监测。", status: "已入模" },
      { name: "三智能体", detail: "健康宣教、慢病筛查、慢病管理三个智能体，提供画像分群、风险评估、回访提醒和管理建议。", status: "已入模" },
      { name: "两体系", detail: "标准规范体系与安全保障体系，落实三级等保、数据脱敏、权限审计和接口标准。", status: "已入模" }
    ],
    networks: [
      { name: "慢病教育系统", users: "居民、医生、疾控", functions: ["CMS内容管理", "AI问答", "医患互动", "健康档案", "自我监测", "精准宣教推送"] },
      { name: "慢病筛查系统", users: "医疗机构、疾控、重点人群", functions: ["高危人群筛选", "问卷管理", "任务推送", "检查申请", "风险测评", "个性化干预"] },
      { name: "慢病管理系统", users: "家庭医生、专科医生、管理者", functions: ["治疗规范监管", "风险分级分类", "风险质询", "随访提醒", "干预过程监测"] }
    ],
    aiAgents: [
      { name: "健康宣教智能体", scenario: "基于居民画像、位置、时间和生命周期阶段推送图文、视频、直播、问答和健康处方。", output: "个性化宣教计划" },
      { name: "慢病筛查智能体", scenario: "面向冠心病、脑卒中、糖尿病、高血压及多癌种高危人群进行风险识别。", output: "风险画像与筛查任务" },
      { name: "慢病管理智能体", scenario: "对异常指标、脱落随访、复查复诊和用药依从性进行提醒与闭环跟踪。", output: "分级管理方案" }
    ],
    diseaseLibraries: ["高血压", "糖尿病", "冠心病", "脑卒中", "慢阻肺", "肺癌高危", "胃癌高危", "结直肠癌高危", "肝癌高危", "食管癌高危", "肿瘤", "代谢类疾病", "伤害", "死因库"],
    screeningModels: ["中国心脑血管疾病风险预测模型", "Framingham", "Essen Stroke Risk Score", "CHADS2", "CHA2DS2-VASc", "中国糖尿病风险评分表"],
    studentCommonDisease: [
      { name: "近视", workflow: "监测、分级、干预、追踪、评价", output: "学生常见病监测报告" },
      { name: "脊柱弯曲异常", workflow: "筛查、复核、干预、随访", output: "分级干预清单" },
      { name: "肥胖", workflow: "体测、风险评估、健康教育、效果评价", output: "干预效果分析" }
    ],
    externalInterfaces: ["居民基本信息", "门诊诊疗", "住院诊疗", "体检数据", "国家死因监测", "民政死亡/殡葬", "高血压疾病库", "心脑血管疾病库", "代谢类疾病库", "慢阻肺疾病库", "肿瘤专项库"],
    security: ["三级等保", "密码应用", "数据脱敏", "最小授权", "访问审计", "标准规范"]
  };
}

function seedCountyProjectBlueprint() {
  return {
    source: "20260616大连市医共体信息平台项目提级论证申报材料",
    sponsor: "大连市卫生健康委员会",
    model: "16255",
    goal: "建设市级统筹、县域落地的紧密型县域医共体信息平台，推动机构互联互通、资源共享、业务协同、同质管理和安全运维。",
    modelItems: [
      { code: "1", name: "医共体基础平台", detail: "统一基础组件、组织机构、权限、数据交换和运行底座。" },
      { code: "6", name: "医疗服务协同中心", detail: "影像、心电、检验、消毒供应、远程会诊、双向转诊。" },
      { code: "2", name: "便民服务", detail: "一站式预约与跨机构检查预约。" },
      { code: "5", name: "医疗管理协同", detail: "远程医学教育、居民健康数字身份、检查检验互认、合理用药审核、临床诊疗辅助。" },
      { code: "5", name: "综合运营管理", detail: "人力、财务、物资、药品耗材、绩效统一管理。" }
    ],
    coverage: [
      { region: "普兰店区", consortiums: 1, hospitals: 6, primaryCenters: 19 },
      { region: "瓦房店市", consortiums: 1, hospitals: 2, primaryCenters: 27 },
      { region: "庄河市", consortiums: 2, hospitals: 4, primaryCenters: 26 },
      { region: "长海县", consortiums: 1, hospitals: 1, primaryCenters: 4 },
      { region: "旅顺口区", consortiums: 1, hospitals: 3, primaryCenters: 9 }
    ],
    reusedApps: ["基础组件", "影像资源共享", "心电中心", "检验中心", "远程会诊中心", "双向转诊中心", "一站式预约", "远程医学教育", "居民健康数字身份", "检查检验互认", "临床诊疗辅助"],
    newApps: ["消毒供应", "跨机构检查预约", "合理用药审核", "决策可视化", "人力资源管理", "财务管理", "物资管理", "药品耗材管理", "绩效管理", "基层AI辅助诊断", "辅助诊断运行监测"],
    centers: [
      { name: "医学影像资源共享中心", integration: "PACS", workflow: "基层申请、上级诊断、报告回传、结果互认" },
      { name: "心电诊断资源共享中心", integration: "心电系统", workflow: "基层采集、中心诊断、危急值提醒、报告共享" },
      { name: "医学检验资源共享中心", integration: "LIS", workflow: "基层采样、中心检测、报告审核、结果回传" },
      { name: "消毒供应资源共享中心", integration: "消毒供应追溯", workflow: "申领、清洗、消毒、灭菌、配送、全程追溯" },
      { name: "远程会诊中心", integration: "电子病历/健康档案", workflow: "会诊申请、资料调阅、专家会诊、报告归档" },
      { name: "双向转诊中心", integration: "HIS/预约", workflow: "转诊申请、资源预约、接诊反馈、下转随访" }
    ],
    grassrootsAi: {
      coverage: "85家乡镇卫生院",
      functions: ["问诊辅助", "病历书写辅助", "诊断辅助", "医学知识检索", "辅诊运行监测"],
      indicators: ["病历数量", "辅诊建议数量", "医学检索数量", "病历质检", "用户活跃度"]
    },
    dataResources: {
      catalogs: 18,
      sharing: "18项数据资源目录按有条件共享方式接入",
      network: "电子政务外网",
      security: ["三级密码应用", "信创适配", "日志审计", "数据库审计", "边界防护"]
    }
  };
}

function seedDoctorProfiles() {
  return [
    {
      id: "doc-liu",
      userId: "u2",
      username: "doctor",
      name: "刘医生",
      gender: "女",
      title: "副主任医师",
      category: "临床",
      specialty: "全科医学",
      practiceScope: "全科医学专业",
      primaryInstitutionId: "MR3",
      primaryInstitution: "青泥洼桥社区卫生服务中心",
      department: "家庭医生工作室",
      licenseNo: "DEMO-DOC-210202-001",
      registrationValidUntil: "2029-12-31",
      yearsInSpecialty: 12,
      healthStatus: "适宜执业",
      assessmentRecords: ["2024 合格", "2025 合格"],
      accountStatus: "启用",
      functions: ["授权档案查看", "慢病随访", "长期处方", "固定取药确认", "转诊申请", "多点执业申请"]
    },
    {
      id: "doc-wang",
      userId: "u-doctor-wang",
      username: "doctor_wang",
      name: "王医生",
      gender: "男",
      title: "主任医师",
      category: "临床",
      specialty: "心血管内科",
      practiceScope: "内科专业",
      primaryInstitutionId: "MR1",
      primaryInstitution: "大连市中心医院",
      department: "心内科",
      licenseNo: "DEMO-DOC-210200-002",
      registrationValidUntil: "2030-06-30",
      yearsInSpecialty: 18,
      healthStatus: "适宜执业",
      assessmentRecords: ["2024 合格", "2025 合格"],
      accountStatus: "启用",
      functions: ["转诊接诊", "电子病历补充", "死亡医学证明签发", "多点执业备案查看"]
    }
  ];
}

function seedMultiPracticePolicy() {
  return {
    source: "国卫医发〔2014〕86号《关于推进和规范医师多点执业的若干意见》",
    definition: "医师于有效注册期内在两个或两个以上医疗机构定期从事执业活动。",
    exclusions: ["慈善或公益性巡回医疗", "义诊", "突发事件或灾害事故医疗救援", "基本和重大公共卫生服务项目", "外出会诊"],
    qualificationRules: [
      "允许临床、口腔和中医类别医师申请。",
      "应具有中级及以上专业技术职务任职资格。",
      "从事同一专业工作满 5 年，身体健康，能够胜任多点执业。",
      "最近连续两个周期医师定期考核无不合格记录。",
      "执业类别应与第一执业地点一致，执业范围专业应与第一执业地点二级诊疗科目相同。",
      "公立医院院级领导除对口支援、帮扶托管、医联体等情形外，一般不能从事其他形式多点执业。"
    ],
    agreementFields: ["执业期限", "时间安排", "工作任务", "医疗责任", "薪酬", "相关保险"],
    managementRules: ["第一执业地点同意或知情报备", "各执业地点合理安排时间", "特殊情况下服从第一执业地点安排", "医疗损害由当事医疗机构和医师依法处理", "多点执业信息公开"]
  };
}

function seedMultiPracticeApplications() {
  return [
    {
      id: "mp-001",
      doctorId: "doc-liu",
      doctorName: "刘医生",
      category: "临床",
      title: "副主任医师",
      specialty: "全科医学",
      primaryInstitutionId: "MR3",
      primaryInstitution: "青泥洼桥社区卫生服务中心",
      targetInstitutionId: "MR1",
      targetInstitution: "大连市中心医院",
      targetDepartment: "心内科慢病联合门诊",
      practiceScope: "全科医学专业",
      period: "2026-07-01 至 2027-06-30",
      schedule: "每周三下午",
      tasks: "高血压、糖尿病稳定期患者联合门诊和下转随访方案制定",
      responsibility: "当事医疗机构与医师按协议承担医疗责任，个人医疗责任保险覆盖任一执业地点。",
      compensation: "按实际工作时间、工作量和绩效协商结算",
      insurance: "已购买医师个人医疗执业保险",
      primaryConsent: "已同意",
      registrationMode: "备案管理",
      status: "待卫健审核",
      compliance: {
        titleQualified: true,
        fiveYears: true,
        assessmentQualified: true,
        categoryMatched: true,
        scopeMatched: true,
        agreementCompleted: true,
        publicHospitalLeaderRestricted: false
      },
      publicVisible: true,
      lastUpdated: "2026-06-17T09:00:00.000Z"
    },
    {
      id: "mp-002",
      doctorId: "doc-wang",
      doctorName: "王医生",
      category: "临床",
      title: "主任医师",
      specialty: "心血管内科",
      primaryInstitutionId: "MR1",
      primaryInstitution: "大连市中心医院",
      targetInstitutionId: "MR3",
      targetInstitution: "青泥洼桥社区卫生服务中心",
      targetDepartment: "家庭医生工作室",
      practiceScope: "内科专业",
      period: "2026-06-20 至 2026-12-31",
      schedule: "每周五上午",
      tasks: "基层高危高血压患者会诊、用药方案复核和家庭医生培训",
      responsibility: "服务中发生纠纷由当事机构和医师按协议处理，第一执业地点不承担非当事责任。",
      compensation: "医联体帮扶任务，按院内绩效规则登记工作量",
      insurance: "机构医疗责任保险+个人执业保险",
      primaryConsent: "医联体内帮扶免办多点执业手续",
      registrationMode: "医联体帮扶",
      status: "已备案",
      compliance: {
        titleQualified: true,
        fiveYears: true,
        assessmentQualified: true,
        categoryMatched: true,
        scopeMatched: true,
        agreementCompleted: true,
        publicHospitalLeaderRestricted: false
      },
      publicVisible: true,
      lastUpdated: "2026-06-16T10:30:00.000Z"
    }
  ];
}

function seedChronicScreeningTasks() {
  return [
    { id: "cst-001", residentId: "r1", taskName: "冠心病高危筛查", model: "Framingham + 中国心脑血管疾病风险预测模型", source: "门诊血压、BMI、用药与家族史", riskLevel: "高危", institution: "青泥洼桥社区卫生服务中心", assignee: "刘医生", due: todayOffset(2), status: "待筛查", nextStep: "完善问卷并申请心电图、血脂检查", result: "待评估" },
    { id: "cst-002", residentId: "r2", taskName: "糖尿病并发症筛查", model: "中国糖尿病风险评分表", source: "空腹血糖、BMI、随访记录", riskLevel: "中危", institution: "星海湾社区卫生服务中心", assignee: "赵医生", due: todayOffset(4), status: "检查申请", nextStep: "复查糖化血红蛋白、尿微量白蛋白", result: "待检查" },
    { id: "cst-003", residentId: "r4", taskName: "脑卒中风险筛查", model: "Essen Stroke Risk Score + CHA2DS2-VASc", source: "高血压、年龄、体检记录", riskLevel: "高危", institution: "青泥洼桥社区卫生服务中心", assignee: "刘医生", due: todayOffset(1), status: "待干预", nextStep: "建立高危台账并推送专科复核", result: "已生成风险画像" }
  ];
}

function seedChronicEducationPushes() {
  return [
    { id: "cep-001", residentId: "r1", topic: "高血压家庭血压监测", channel: "居民端 + 短信", trigger: "连续两次收缩压高于 160", contentType: "图文+视频", targetGroup: "高血压高危人群", status: "待推送", pushAt: todayOffset(0), feedback: "待居民确认" },
    { id: "cep-002", residentId: "r2", topic: "糖尿病饮食与运动处方", channel: "居民端", trigger: "空腹血糖偏高", contentType: "健康处方", targetGroup: "糖尿病管理人群", status: "已推送", pushAt: todayOffset(-1), feedback: "已阅读" },
    { id: "cep-003", residentId: "r4", topic: "脑卒中预警症状识别", channel: "居民端 + 家属代办提醒", trigger: "脑卒中筛查高危", contentType: "问答卡片", targetGroup: "老年高危人群", status: "待确认", pushAt: todayOffset(1), feedback: "待家属确认" }
  ];
}

function seedChronicManagementPlans() {
  return [
    { id: "cmp-001", residentId: "r1", diseaseType: "高血压", grade: "高危", owner: "刘医生", plan: "每周血压上传、两周电话随访、一个月专科复诊", indicators: ["血压", "BMI", "服药依从性"], status: "执行中", nextReview: todayOffset(7), intervention: "调整生活方式并复核长期处方" },
    { id: "cmp-002", residentId: "r2", diseaseType: "糖尿病", grade: "中危", owner: "赵医生", plan: "每月血糖复测、季度糖化血红蛋白、饮食运动干预", indicators: ["空腹血糖", "糖化血红蛋白", "体重"], status: "待复核", nextReview: todayOffset(10), intervention: "补充并发症筛查结果" },
    { id: "cmp-003", residentId: "r4", diseaseType: "高血压/脑卒中高危", grade: "高危", owner: "刘医生", plan: "纳入重点人群，每周提醒、家属协同、必要时转诊", indicators: ["血压", "心电", "卒中风险评分"], status: "预警中", nextReview: todayOffset(3), intervention: "推送卒中宣教并预约专科会诊" }
  ];
}

function seedCountyCollaborationOrders() {
  return [
    { id: "cco-001", center: "医学影像资源共享中心", region: "普兰店区", fromInstitution: "普兰店区乡镇卫生院", toInstitution: "普兰店区中心医院", residentId: "r1", orderType: "胸部CT远程诊断", status: "待中心诊断", priority: "高", requestedAt: todayOffset(-1), due: todayOffset(0), result: "待报告回传" },
    { id: "cco-002", center: "医学检验资源共享中心", region: "瓦房店市", fromInstitution: "瓦房店市乡镇卫生院", toInstitution: "瓦房店市中心医院", residentId: "r2", orderType: "糖化血红蛋白集中检测", status: "样本运输中", priority: "中", requestedAt: todayOffset(0), due: todayOffset(2), result: "待检测" },
    { id: "cco-003", center: "双向转诊中心", region: "庄河市", fromInstitution: "庄河市基层医疗机构", toInstitution: "庄河市中心医院", residentId: "r4", orderType: "高危慢病上转复核", status: "待接诊", priority: "高", requestedAt: todayOffset(0), due: todayOffset(1), result: "待接诊反馈" }
  ];
}

function seedCountyAiDiagnosisCases() {
  return [
    { id: "cad-001", region: "旅顺口区", institution: "旅顺口区乡镇卫生院", residentId: "r1", chiefComplaint: "头晕伴血压升高", suggestion: "高血压控制不佳，建议复测血压、完善心电图并评估用药依从性", doctorAction: "已采纳", quality: "病历质检通过", status: "已完成", at: todayOffset(-1) },
    { id: "cad-002", region: "长海县", institution: "长海县乡镇卫生院", residentId: "r2", chiefComplaint: "乏力、口干，血糖偏高", suggestion: "提示糖尿病控制风险，建议复查糖化血红蛋白并开展饮食运动干预", doctorAction: "待确认", quality: "待质检", status: "待医生确认", at: todayOffset(0) },
    { id: "cad-003", region: "庄河市", institution: "庄河市乡镇卫生院", residentId: "r4", chiefComplaint: "短暂肢体麻木", suggestion: "脑卒中高危预警，建议立即上转并完成影像检查", doctorAction: "已上转", quality: "重点病例", status: "转诊中", at: todayOffset(0) }
  ];
}

function seedCountyMutualRecognitionRecords() {
  return [
    { id: "cmr-001", residentId: "r1", item: "心电图", sourceInstitution: "青泥洼桥社区卫生服务中心", targetInstitution: "大连市中心医院", status: "已互认", savedCost: 86, reason: "同质质控通过", at: todayOffset(-2) },
    { id: "cmr-002", residentId: "r2", item: "糖化血红蛋白", sourceInstitution: "星海湾社区卫生服务中心", targetInstitution: "大连医科大学附属医院", status: "待互认", savedCost: 120, reason: "等待中心实验室报告", at: todayOffset(0) },
    { id: "cmr-003", residentId: "r4", item: "颈动脉超声", sourceInstitution: "庄河市基层医疗机构", targetInstitution: "庄河市中心医院", status: "退回复核", savedCost: 180, reason: "图像质量不足，需要复核", at: todayOffset(-1) }
  ];
}

function seedMutualRecognitionRules() {
  return [
    { id: "mrr-ecg-001", item: "ECG", category: "electrocardiogram", validDays: 7, sourceLevels: ["primary", "secondary", "tertiary"], targetLevels: ["secondary", "tertiary"], qualityStandard: "waveform-readable", autoRecognize: true, savedCost: 86, nonRecognitionReasons: ["poor-quality", "expired", "clinical-change"], status: "active" },
    { id: "mrr-hba1c-001", item: "HbA1c", category: "lab", validDays: 30, sourceLevels: ["secondary", "tertiary"], targetLevels: ["secondary", "tertiary"], qualityStandard: "lab-qc-passed", autoRecognize: true, savedCost: 120, nonRecognitionReasons: ["qc-failed", "expired", "missing-calibration"], status: "active" },
    { id: "mrr-ct-001", item: "Chest CT", category: "imaging", validDays: 14, sourceLevels: ["secondary", "tertiary"], targetLevels: ["tertiary"], qualityStandard: "dicom-complete", autoRecognize: false, savedCost: 260, nonRecognitionReasons: ["missing-dicom", "poor-quality", "clinical-change"], status: "active" }
  ];
}

function seedDiagnosticReports() {
  return [
    { id: "dr-001", externalId: "LIS-DEMO-001", residentId: "r2", item: "HbA1c", category: "lab", sourceInstitution: "Wafangdian Central Hospital", targetInstitution: "Dalian Medical University Hospital", result: "6.8%", conclusion: "HbA1c is elevated; continue chronic disease follow-up.", reportedAt: todayOffset(-1), status: "recognized", recognitionRecordId: "cmr-002" }
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
    { id: "es2", title: "长期处方审核异常", source: "医保审核", region: "市级", level: "中", status: "研判中", date: todayOffset(0), action: "联动医保中心核验处方、诊断和取药记录，医保局保留监管复核" },
    { id: "es3", title: "基层慢病门诊负荷上升", source: "医疗资源监测", region: "沙河口区", level: "中", status: "已派单", date: todayOffset(1), action: "协调区级医院支援复诊号源和药品保障" }
  ];
}

function seedSeniorServices() {
  return [
    { id: "ss1", residentId: "r4", service: "家属代办取药", channel: "个人端", status: "已开通", contact: "演示居民A", nextAction: "每月 15 日提醒家属确认取药" },
    { id: "ss2", residentId: "r1", service: "大字模式提醒", channel: "手机端", status: "待开通", contact: "本人", nextAction: "下次登录提示开启适老显示" },
    { id: "ss3", residentId: "r2", service: "线下帮办预约", channel: "社区服务站", status: "已预约", contact: "本人", nextAction: "社区工作人员协助绑定医保电子凭证" }
  ];
}

function seedDataAccessLogs() {
  return [
    { id: "al1", residentId: "r1", at: "2026-06-15 09:12", actor: "青泥洼桥社区卫生服务中心", role: "家庭医生", scope: "健康档案、随访记录", purpose: "慢病随访", result: "允许" },
    { id: "al2", residentId: "r1", at: "2026-06-15 10:35", actor: "大连市中心医院", role: "医疗机构", scope: "电子病历摘要、用药处方", purpose: "专科复诊", result: "允许" },
    { id: "al3", residentId: "r2", at: "2026-06-15 11:20", actor: "大连市医保中心审核员", role: "医保经办", scope: "医保结算、诊断摘要", purpose: "慢病结算审核", result: "允许" },
    { id: "al4", residentId: "r4", at: "2026-06-15 14:08", actor: "未授权机构", role: "外部机构", scope: "完整电子病历", purpose: "未知", result: "拒绝" }
  ];
}

function seedSecurityEvents() {
  return [
    { id: "se1", at: "2026-06-15 08:55", actor: "卫健委管理员", role: "commission", action: "登录", target: "卫生健康委端", result: "允许", detail: "演示账号进入监管总览" },
    { id: "se2", at: "2026-06-15 10:20", actor: "大连市医保中心审核员", role: "insurance", action: "访问接口", target: "/api/state", result: "允许", detail: "读取结算经办与机构监管数据" },
    { id: "se3", at: "2026-06-15 14:08", actor: "未授权机构", role: "unknown", action: "访问个人健康信息", target: "完整电子病历", result: "拒绝", detail: "未取得居民授权或角色权限" }
  ];
}

function seedDigitalCredentials() {
  return [
    { id: "dc1", residentId: "r1", type: "电子健康码", provider: "区域全民健康信息平台", credentialNo: "HC-210204-3219", status: "已绑定", lastVerified: "2026-06-15", usage: "就医身份识别、健康档案调阅" },
    { id: "dc2", residentId: "r1", type: "医保电子凭证", provider: "医保信息平台", credentialNo: "MI-DEMO-MOBILE-R1", status: "已激活", lastVerified: "2026-06-15", usage: "门诊慢特病结算、固定取药审核" },
    { id: "dc3", residentId: "r2", type: "医保电子凭证", provider: "医保信息平台", credentialNo: "MI-DEMO-MOBILE-R2", status: "待核验", lastVerified: "2026-06-12", usage: "门诊统筹结算" },
    { id: "dc4", residentId: "r4", type: "居民一卡通", provider: "城市服务平台", credentialNo: "CC-210213-3521", status: "家属代办", lastVerified: "2026-06-10", usage: "线下帮办、家属代取药" }
  ];
}

function seedPolicyAlignment() {
  return [
    { domain: "普惠数字医疗", requirement: "建设互通共享的全民健康信息平台，推动医疗卫生机构数据共享互认和业务协同。", capability: "个人健康信息库聚合电子病历、检查检验、用药、授权和慢病管理数据。", status: "已启动" },
    { domain: "医疗全流程在线办理", requirement: "加快异地转诊、就医、住院、医保等医疗全流程在线办理。", capability: "医疗机构端承接转诊协同，医保中心承接结算经办审核，医保局保留基金监管视图，个人端承接固定取药和授权共享。", status: "原型完成" },
    { domain: "互联网医疗监管", requirement: "完善互联网医疗服务监管体系，推进互联网+监管和智慧监管。", capability: "卫健委端建设四端运行监测、机构绩效、风险预警和数据质量看板。", status: "已纳入" },
    { domain: "电子健康码与医保凭证", requirement: "普及居民电子健康码，加快医保电子凭证推广应用。", capability: "以身份证号+手机号形成 personIndex，后续可对接电子健康码、医保电子凭证和居民一卡通。", status: "数据底座完成" },
    { domain: "公共卫生应急", requirement: "建立智慧化预警多点触发机制，支持公共卫生机构和医疗机构数据共享。", capability: "风险预警汇聚慢病高危、随访逾期、医保异常和资源负荷，预留公共卫生应急监测入口。", status: "待扩展" },
    { domain: "基层智慧治理", requirement: "以数据驱动、信息共享提升基层治理和疫情防控能力。", capability: "基层机构、家庭医生、居民端、医保中心和区市县医保局共用同一居民主索引和慢病闭环台账。", status: "已启动" },
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

function seedHealthStatistics() {
  return {
    period: "2026-05",
    basis: "依据卫生健康统计工作管理要求，围绕统计调查制度、数据质量控制、机构报送责任和直报系统校验，形成医疗卫生资源与诊疗服务量统计。",
    sources: [
      { id: "his", name: "医疗机构接口", system: "HIS/EMR/住院管理/人力资源接口", scope: "床位、医生、护士、门急诊、住院、出院、床日", updateCycle: "日采集、月汇总", status: "已接入" },
      { id: "direct", name: "卫生健康统计直报系统", system: "卫生健康统计网络直报", scope: "机构资源年报/月报、医疗服务量、住院服务量", updateCycle: "月报、季报、年报", status: "对账中" }
    ],
    resourceReports: [
      { institutionId: "mr1", institution: "大连市中心医院", region: "市级", type: "三级医院", interfaceData: { beds: 1200, doctors: 860, nurses: 1240 }, directReport: { beds: 1198, doctors: 858, nurses: 1242 }, status: "待复核", issue: "床位和人员口径存在小幅差异" },
      { institutionId: "mr2", institution: "大连医科大学附属医院", region: "市级", type: "三级医院", interfaceData: { beds: 1500, doctors: 980, nurses: 1380 }, directReport: { beds: 1500, doctors: 980, nurses: 1378 }, status: "待复核", issue: "护士数需与直报系统核对" },
      { institutionId: "mr3", institution: "青泥洼桥社区卫生服务中心", region: "中山区", type: "基层医疗机构", interfaceData: { beds: 60, doctors: 42, nurses: 58 }, directReport: { beds: 60, doctors: 42, nurses: 58 }, status: "已一致", issue: "无" },
      { institutionId: "mr4", institution: "星海湾社区卫生服务中心", region: "沙河口区", type: "基层医疗机构", interfaceData: { beds: 45, doctors: 36, nurses: 44 }, directReport: { beds: 45, doctors: 35, nurses: 44 }, status: "待复核", issue: "医生数差异 1 人" },
      { institutionId: "mr5", institution: "甘井子区人民医院", region: "甘井子区", type: "区级医院", interfaceData: { beds: 520, doctors: 310, nurses: 430 }, directReport: { beds: 520, doctors: 310, nurses: 430 }, status: "已一致", issue: "无" }
    ],
    serviceReports: [
      { institutionId: "mr1", institution: "大连市中心医院", interfaceData: { outpatientVisits: 128600, emergencyVisits: 18600, inpatientAdmissions: 9200, discharges: 9050, bedDays: 286000 }, directReport: { outpatientVisits: 128420, emergencyVisits: 18620, inpatientAdmissions: 9190, discharges: 9042, bedDays: 285600 }, status: "待复核" },
      { institutionId: "mr2", institution: "大连医科大学附属医院", interfaceData: { outpatientVisits: 146200, emergencyVisits: 16400, inpatientAdmissions: 10120, discharges: 10080, bedDays: 318500 }, directReport: { outpatientVisits: 146200, emergencyVisits: 16380, inpatientAdmissions: 10110, discharges: 10075, bedDays: 318420 }, status: "已一致" },
      { institutionId: "mr3", institution: "青泥洼桥社区卫生服务中心", interfaceData: { outpatientVisits: 18600, emergencyVisits: 420, inpatientAdmissions: 120, discharges: 118, bedDays: 1860 }, directReport: { outpatientVisits: 18580, emergencyVisits: 420, inpatientAdmissions: 120, discharges: 118, bedDays: 1860 }, status: "已一致" },
      { institutionId: "mr4", institution: "星海湾社区卫生服务中心", interfaceData: { outpatientVisits: 14200, emergencyVisits: 360, inpatientAdmissions: 86, discharges: 84, bedDays: 1260 }, directReport: { outpatientVisits: 14120, emergencyVisits: 360, inpatientAdmissions: 84, discharges: 84, bedDays: 1260 }, status: "待复核" },
      { institutionId: "mr5", institution: "甘井子区人民医院", interfaceData: { outpatientVisits: 64200, emergencyVisits: 7200, inpatientAdmissions: 4260, discharges: 4200, bedDays: 128800 }, directReport: { outpatientVisits: 64240, emergencyVisits: 7180, inpatientAdmissions: 4260, discharges: 4196, bedDays: 128600 }, status: "待复核" }
    ],
    qualityRules: [
      { rule: "资源口径一致", detail: "床位、执业医生、注册护士以机构接口与统计直报系统双源比对，差异超过 1% 标记复核。", status: "已配置" },
      { rule: "诊疗量完整", detail: "门急诊、入院、出院、实际占用总床日按月汇总，缺报或异常波动进入质量清单。", status: "已配置" },
      { rule: "报送责任留痕", detail: "按机构、周期、来源记录采集状态和复核状态，支持卫健委端追踪。", status: "已配置" }
    ]
  };
}

function seedDeathCertificates() {
  return [
    {
      id: "death-cert-001",
      certificateNo: "DC-210202-20260612001",
      residentId: "r4",
      deceasedName: "演示居民D",
      gender: "女",
      age: 61,
      documentType: "居民身份证",
      documentNo: "DEMO-ID-R4",
      deathDateTime: "2026-06-12 07:30",
      deathPlace: "家中",
      deathPlaceCode: "3",
      deathType: "正常死亡",
      deathReasonType: "非传染病",
      immediateCause: "心力衰竭",
      antecedentCause: "高血压性心脏病",
      underlyingCause: "高血压病",
      otherCondition: "2型糖尿病",
      icd10: "I11.9",
      causeCategory: "循环系统疾病",
      diagnosisBasis: "临床+理化",
      highestDiagnosisUnit: "社区卫生服务中心",
      issuingInstitutionId: "mr3",
      issuingInstitution: "青泥洼桥社区卫生服务中心",
      issuingPhysician: "刘医生",
      applicantName: "演示家属A",
      applicantRelation: "子女",
      applicantPhone: "DEMO-MOBILE-R1",
      applicationType: "近亲属申领",
      materials: ["电子证照", "纸质版", "申报单"],
      certificateForm: "电子证照+纸质版",
      status: "已签发",
      electronicLicenseStatus: "已生成",
      reportChannel: "人口死亡信息登记系统",
      cdcReportStatus: "已上报",
      nationalPlatformStatus: "待同步",
      publicSecuritySync: "待共享",
      civilAffairsSync: "待共享",
      qualityCheck: "通过",
      issueDeadline: "死亡或申报后 1 日内",
      reportDeadline: "签发后 15 个工作日内",
      electronicReportDeadline: "电子证照 5 个工作日内上报国家平台",
      lastUpdated: "2026-06-12T10:30:00.000Z"
    },
    {
      id: "death-cert-002",
      certificateNo: "DC-210211-20260615001",
      residentId: "r3",
      deceasedName: "演示居民C",
      gender: "男",
      age: 37,
      documentType: "居民身份证",
      documentNo: "DEMO-ID-R3",
      deathDateTime: "2026-06-15 21:20",
      deathPlace: "医疗卫生机构",
      deathPlaceCode: "1",
      deathType: "正常死亡",
      deathReasonType: "传染病",
      immediateCause: "重症肺炎",
      antecedentCause: "呼吸衰竭",
      underlyingCause: "病毒性肺炎",
      otherCondition: "无",
      icd10: "J12.9",
      causeCategory: "呼吸系统疾病",
      diagnosisBasis: "临床+理化",
      highestDiagnosisUnit: "三级医院",
      issuingInstitutionId: "mr1",
      issuingInstitution: "大连市中心医院",
      issuingPhysician: "王医生",
      applicantName: "演示家属C",
      applicantRelation: "配偶",
      applicantPhone: "DEMO-MOBILE-R3",
      applicationType: "近亲属申领",
      materials: ["电子证照", "纸质版"],
      certificateForm: "电子证照",
      status: "待上报",
      electronicLicenseStatus: "待生成",
      reportChannel: "省级全民健康信息平台",
      cdcReportStatus: "待上报",
      nationalPlatformStatus: "待提交",
      publicSecuritySync: "待共享",
      civilAffairsSync: "待共享",
      qualityCheck: "待复核",
      issueDeadline: "死亡或申报后 1 日内",
      reportDeadline: "签发后 15 个工作日内",
      electronicReportDeadline: "电子证照 5 个工作日内上报国家平台",
      lastUpdated: "2026-06-16T09:10:00.000Z"
    },
    {
      id: "death-cert-003",
      certificateNo: "DC-210204-20260616001",
      residentId: "r1",
      deceasedName: "演示居民A",
      gender: "男",
      age: 58,
      documentType: "居民身份证",
      documentNo: "DEMO-ID-R1",
      deathDateTime: "2026-06-16 05:40",
      deathPlace: "民政服务机构",
      deathPlaceCode: "4",
      deathType: "正常死亡",
      deathReasonType: "老死",
      immediateCause: "多器官功能衰竭",
      antecedentCause: "慢性阻塞性肺疾病",
      underlyingCause: "慢性病长期进展",
      otherCondition: "高血压",
      icd10: "J44.9",
      causeCategory: "呼吸系统疾病",
      diagnosisBasis: "死后推断",
      highestDiagnosisUnit: "社区卫生服务中心",
      issuingInstitutionId: "mr4",
      issuingInstitution: "星海湾社区卫生服务中心",
      issuingPhysician: "赵医生",
      applicantName: "演示受托人",
      applicantRelation: "受委托人",
      applicantPhone: "DEMO-MOBILE-R2",
      applicationType: "委托办理",
      materials: ["纸质版", "委托书", "申报单"],
      certificateForm: "纸质版",
      status: "待签发",
      electronicLicenseStatus: "不适用",
      reportChannel: "人口死亡信息登记系统",
      cdcReportStatus: "未上报",
      nationalPlatformStatus: "不适用",
      publicSecuritySync: "未共享",
      civilAffairsSync: "未共享",
      qualityCheck: "待补正",
      issueDeadline: "申报后 1 日内",
      reportDeadline: "签发后 15 个工作日内",
      electronicReportDeadline: "如生成电子证照，5 个工作日内上报国家平台",
      lastUpdated: "2026-06-16T11:20:00.000Z"
    }
  ];
}

function seedDeathCertificateForms() {
  return [
    { id: "death-form-electronic", name: "居民死亡医学证明（电子证照）", sourceFile: "1.居民死亡医学证明（电子证照）-20260227100657821.pdf", scope: "电子证照签发、电子章、国家平台共享", keyFields: ["逝者身份", "死亡日期地点", "死亡原因", "死因编码", "近亲属", "医疗卫生机构", "医师签名"], status: "已建模" },
    { id: "death-form-paper", name: "居民死亡医学证明（纸质版）", sourceFile: "2.居民死亡医学证明（纸质版）.pdf", scope: "医疗卫生机构存根、公安部门保存、近亲属保存、殡葬服务", keyFields: ["死因链", "死亡调查记录", "公安签章", "殡葬服务电话"], status: "已建模" },
    { id: "death-form-auth", name: "居民死亡医学证明办理委托书", sourceFile: "3.居民死亡医学证明办理委托书.pdf", scope: "近亲属委托他人申领、补办或办理其他事项", keyFields: ["委托人", "被委托人", "逝者", "委托事项", "家族病史和生前疾病史"], status: "已建模" },
    { id: "death-form-application", name: "居民死亡医学证明申报单", sourceFile: "4.居民死亡医学证明申报单.pdf", scope: "在家、民政服务机构或其他场所正常死亡申报", keyFields: ["逝者信息", "死亡地点", "初步死因判断", "申办人承诺"], status: "已建模" }
  ];
}

function seedDeathStatistics() {
  return {
    period: "2026-06",
    title: "居民死亡医学证明与死亡统计",
    policyBasis: "依据居民死亡医学证明信息登记和电子证照管理要求，医疗机构签发证明，死亡登记信息汇入人口死亡信息登记系统，并向卫健委统计模块形成死因与时效质量分析。",
    sources: [
      { id: "death-cert", name: "医疗机构死亡医学证明系统", scope: "个案登记、签发、材料、医师、死因编码", status: "已接入" },
      { id: "death-registry", name: "人口死亡信息登记系统", scope: "签发后 15 个工作日内报告纸质证明信息", status: "待接口" },
      { id: "health-platform", name: "省级全民健康信息平台/国家智慧健康平台", scope: "电子证照 5 个工作日内上报", status: "待接口" },
      { id: "public-security-civil", name: "公安与民政共享", scope: "户籍注销、殡葬服务和政府服务共享", status: "待共享" }
    ],
    metrics: {
      total: 3,
      signed: 2,
      reported: 1,
      electronicLicenses: 1,
      paperCertificates: 2,
      pending: 2,
      overdue: 0,
      homeOrOtherPlace: 2,
      institutionDeaths: 1,
      normalDeaths: 3,
      abnormalDeaths: 0,
      qualityPass: 1
    },
    causeRanking: [
      { cause: "呼吸系统疾病", icd10Range: "J00-J99", deaths: 2, share: "66.7%", trend: "需关注" },
      { cause: "循环系统疾病", icd10Range: "I00-I99", deaths: 1, share: "33.3%", trend: "稳定" }
    ],
    regionStats: [
      { region: "中山区", deaths: 1, crudeMortality: "演示口径", reportedRate: "100%", overdue: 0 },
      { region: "沙河口区", deaths: 1, crudeMortality: "演示口径", reportedRate: "0%", overdue: 0 },
      { region: "甘井子区", deaths: 1, crudeMortality: "演示口径", reportedRate: "0%", overdue: 0 }
    ],
    workflowRules: [
      { rule: "明确死因的正常死亡", deadline: "死亡或申报后 1 日内签发", owner: "负责救治或调查的医疗卫生机构", status: "已配置" },
      { rule: "纸质证明信息报告", deadline: "签发后 15 个工作日内报告第一联信息", owner: "签发医疗机构", status: "已配置" },
      { rule: "无网络离线上报", deadline: "医疗机构 10 个工作日内送县区疾控，疾控 5 个工作日内代报", owner: "医疗机构/疾控机构", status: "已配置" },
      { rule: "电子证照上报", deadline: "5 个工作日内通过省级平台报送国家智慧健康平台", owner: "省级平台/医疗机构", status: "待接口" }
    ],
    dataSharing: [
      { target: "卫生健康委统计模块", data: "死亡证明个案、死因分类、地区汇总、时效质量", status: "已贯通" },
      { target: "疾控机构", data: "人口死亡信息、死因链、ICD 编码", status: "待接口" },
      { target: "公安部门", data: "户籍注销所需证明联与共享状态", status: "待共享" },
      { target: "民政部门", data: "殡葬服务和政府服务共享状态", status: "待共享" }
    ],
    qualityRules: [
      { rule: "身份唯一索引", detail: "以身份证号和手机号生成 personIndex；无有效证件时预留机构代码+年度序号规则。", status: "已纳入" },
      { rule: "死因编码质控", detail: "区分直接死因、引起死因、根本死因和 ICD-10 编码，异常或无法判断进入复核。", status: "已纳入" },
      { rule: "用途限制", detail: "死亡信息仅用于人口管理、统计分析和政府服务，禁止超范围使用和泄露隐私。", status: "已纳入" }
    ]
  };
}

function seedBirthCertificates() {
  return [
    {
      id: "birth-cert-001",
      certificateNo: "BC-G210200-20260601001",
      certificateVersion: "第七版",
      issueType: "首次签发",
      newbornName: "演示新生儿A",
      newbornGender: "女",
      birthDateTime: "2026-06-01 09:18",
      gestationalWeeks: 39,
      birthWeight: 3250,
      birthLength: 50,
      birthPlace: "医疗卫生机构",
      deliveryMode: "顺产",
      maternalResidentId: "r4",
      motherName: "演示居民D",
      motherDocumentNo: "DEMO-ID-R4",
      fatherName: "演示父亲A",
      fatherDocumentNo: "DEMO-ID-F1",
      issuingInstitutionId: "mr1",
      issuingInstitution: "大连市中心医院",
      issuingPhysician: "王医师",
      applicantName: "演示居民D",
      applicantRelation: "母亲",
      materials: ["母亲身份证", "父亲身份证", "首次签发登记表", "分娩信息核验"],
      status: "已签发",
      electronicLicenseStatus: "已生成",
      publicSecuritySync: "已共享",
      maternalChildSync: "已入册",
      qualityCheck: "通过",
      issueDeadline: "出生后及时办理，首次签发登记留痕",
      healthManagementStatus: "产后访视已建档",
      nextService: "新生儿家庭访视与预防接种提醒",
      lastUpdated: "2026-06-01T10:30:00.000Z"
    },
    {
      id: "birth-cert-002",
      certificateNo: "BC-G210211-20260608001",
      certificateVersion: "第七版",
      issueType: "首次签发",
      newbornName: "演示新生儿B",
      newbornGender: "男",
      birthDateTime: "2026-06-08 16:42",
      gestationalWeeks: 38,
      birthWeight: 2980,
      birthLength: 49,
      birthPlace: "医疗卫生机构",
      deliveryMode: "剖宫产",
      maternalResidentId: "r2",
      motherName: "演示居民B",
      motherDocumentNo: "DEMO-ID-R2",
      fatherName: "演示父亲B",
      fatherDocumentNo: "DEMO-ID-F2",
      issuingInstitutionId: "mr2",
      issuingInstitution: "大连医科大学附属医院",
      issuingPhysician: "赵医师",
      applicantName: "演示居民B",
      applicantRelation: "母亲",
      materials: ["母亲身份证", "父亲身份证", "首次签发登记表"],
      status: "待上报",
      electronicLicenseStatus: "待生成",
      publicSecuritySync: "待共享",
      maternalChildSync: "待入册",
      qualityCheck: "待复核",
      issueDeadline: "首次签发后同步电子证照与妇幼系统",
      healthManagementStatus: "待新生儿访视",
      nextService: "黄疸复测与出生缺陷筛查结果确认",
      lastUpdated: "2026-06-08T17:20:00.000Z"
    },
    {
      id: "birth-cert-003",
      certificateNo: "BC-G210204-20260612001",
      certificateVersion: "第七版",
      issueType: "换发",
      newbornName: "演示新生儿C",
      newbornGender: "女",
      birthDateTime: "2026-06-12 07:35",
      gestationalWeeks: 37,
      birthWeight: 2650,
      birthLength: 48,
      birthPlace: "医疗卫生机构",
      deliveryMode: "顺产",
      maternalResidentId: "r1",
      motherName: "演示母亲C",
      motherDocumentNo: "DEMO-ID-M3",
      fatherName: "演示父亲C",
      fatherDocumentNo: "DEMO-ID-F3",
      issuingInstitutionId: "mr5",
      issuingInstitution: "甘井子区人民医院",
      issuingPhysician: "孙医师",
      applicantName: "演示监护人C",
      applicantRelation: "监护人",
      materials: ["原证正副页", "户口登记机关证明", "换发原因登记"],
      status: "待签发",
      electronicLicenseStatus: "待生成",
      publicSecuritySync: "未共享",
      maternalChildSync: "已入册",
      qualityCheck: "待补正",
      issueDeadline: "换发后原证归档保存",
      healthManagementStatus: "低体重儿专案随访",
      nextService: "出生体重复测与喂养指导",
      lastUpdated: "2026-06-12T09:00:00.000Z"
    }
  ];
}

function seedBirthCertificateForms() {
  return [
    { id: "birth-form-first", name: "出生医学证明首次签发登记表", sourceFile: "43d7f977c2004b50831be87451e07ed2.docx", scope: "首次签发、父母身份核验、分娩信息登记", keyFields: ["新生儿信息", "父母信息", "分娩机构", "签发登记"], status: "已建模" },
    { id: "birth-form-requirements", name: "出生医学证明首次签发要求", sourceFile: "50938309974d4613bb84deb1c8c856c4.docx", scope: "签发流程、材料核验、告知承诺", keyFields: ["首次签发", "材料核验", "专章管理", "档案保存"], status: "已建模" },
    { id: "birth-form-annual-plan", name: "全年母婴三证申领计划表", sourceFile: "1732845680882_57578.doc", scope: "空白证件年度计划申领", keyFields: ["年度计划", "证件数量", "管理机构", "验收回执"], status: "已建模" },
    { id: "birth-form-quarter", name: "母婴三证申领单", sourceFile: "1732845680945_18497.doc", scope: "季度申领与配发", keyFields: ["季度申领", "空白证件", "配发记录", "签收"], status: "已建模" },
    { id: "birth-form-distribution", name: "出生医学证明季度配发表", sourceFile: "1732845680925_63456.doc", scope: "第七版证件配发、旧版清理、废证管理", keyFields: ["配发数量", "证件编号", "废证登记", "销毁记录"], status: "已建模" }
  ];
}

function seedBirthStatistics() {
  return {
    period: "2026-06",
    title: "出生医学证明与出生人口统计",
    basis: "依据出生医学证明管理要求，围绕首次签发、换发、补发、空白证件、废证、电子证照、公安入户和妇幼健康管理形成闭环统计。",
    sources: [
      { id: "birth-cert", name: "医疗机构出生医学证明系统", scope: "个案登记、签发、材料、医师、专章和证件编号", status: "已接入" },
      { id: "mch", name: "妇幼健康管理系统", scope: "孕产妇保健、新生儿访视、筛查、预防接种提醒", status: "待接口" },
      { id: "police", name: "公安户籍登记共享", scope: "出生登记所需法定医学证明信息", status: "待共享" }
    ],
    metrics: {
      total: 3,
      firstIssued: 2,
      reissued: 1,
      signed: 1,
      reported: 1,
      electronicLicenses: 1,
      publicSecuritySynced: 1,
      maternalChildSynced: 2,
      pending: 2,
      lowBirthWeight: 1,
      qualityPass: 1
    },
    regionStats: [
      { region: "市级", births: 1, firstIssueRate: "100%", publicSecuritySyncRate: "100%", lowBirthWeight: 0 },
      { region: "市级", births: 1, firstIssueRate: "100%", publicSecuritySyncRate: "0%", lowBirthWeight: 0 },
      { region: "甘井子区", births: 1, firstIssueRate: "0%", publicSecuritySyncRate: "0%", lowBirthWeight: 1 }
    ],
    workflowRules: [
      { rule: "首次签发", deadline: "具有助产技术服务资质的机构为本机构内出生新生儿直接签发", owner: "签发机构", status: "已建模" },
      { rule: "换发/补发", deadline: "按原因登记、材料审验、原证归档或补发专章要求闭环办理", owner: "签发机构/大连市卫生健康委", status: "已建模" },
      { rule: "空白证件与废证", deadline: "证件申领、配发、作废、清理和销毁全流程留痕", owner: "大连市卫生健康委", status: "已建模" },
      { rule: "第七版证件", deadline: "启用第七版编号/条形码口径，旧版证件按要求清理", owner: "大连市卫生健康委/公安机关", status: "已建模" }
    ],
    healthManagement: [
      { service: "新生儿家庭访视", target: "出生后 7 天内或出院后一周内", status: "2 人待跟进" },
      { service: "出生缺陷筛查", target: "听力、遗传代谢病、先天性心脏病等筛查结果归集", status: "1 人待确认" },
      { service: "预防接种提醒", target: "乙肝、卡介苗及后续免疫规划提醒", status: "已纳入居民端" },
      { service: "低体重儿专案", target: "低出生体重或早产儿纳入专案随访", status: "1 人管理中" }
    ]
  };
}

function seedHealthBulletin2024() {
  return {
    title: "2024 年我国卫生健康事业发展统计公报",
    source: "国家卫生健康委统计公报 PDF",
    year: 2024,
    summary: "围绕卫生资源、医疗服务、基层卫生、中医药、医药费用、公共卫生、妇幼健康、卫生监督和人口家庭发展形成全国年度画像。",
    keyIndicators: [
      { label: "居民人均预期寿命", value: 79.0, unit: "岁", hint: "人民健康水平" },
      { label: "孕产妇死亡率", value: 14.3, unit: "/10万", hint: "妇幼健康" },
      { label: "婴儿死亡率", value: 4.0, unit: "‰", hint: "妇幼健康" },
      { label: "医疗卫生机构", value: 1093551, unit: "个", hint: "全国机构总量" },
      { label: "医疗卫生机构床位", value: 1029.8, unit: "万张", hint: "每千人口 7.32 张" },
      { label: "卫生人员总数", value: 1578.0, unit: "万人", hint: "卫生技术人员 1302.0 万人" },
      { label: "总诊疗量", value: 101.5, unit: "亿人次", hint: "同比增长 6.2%" },
      { label: "入院人次", value: 31192.0, unit: "万人次", hint: "同比增长 3.3%" }
    ],
    domains: [
      { name: "卫生资源", value: "109.4 万个机构", detail: "医院 3.87 万个，基层医疗卫生机构 104.0 万个，床位 1029.8 万张。", status: "资源扩容" },
      { name: "卫生人员", value: "1578.0 万人", detail: "执业（助理）医师 508.2 万人，注册护士 585.5 万人。", status: "人员增长" },
      { name: "医疗服务", value: "101.5 亿人次", detail: "全国总诊疗量 101.5 亿人次，入院 31192.0 万人次。", status: "服务增长" },
      { name: "基层卫生", value: "52.9 亿人次", detail: "基层医疗卫生机构诊疗 52.9 亿人次，乡镇卫生院诊疗 13.8 亿人次。", status: "基层承接" },
      { name: "中医药服务", value: "16.8 亿人次", detail: "中医类医疗卫生机构诊疗 16.8 亿人次，出院 5271.0 万人次。", status: "服务提升" },
      { name: "医药费用", value: "361.0 元", detail: "医院次均门诊费用 361.0 元，次均住院费用 9870.0 元。", status: "费用下降" },
      { name: "公共卫生", value: "485 个示范区", detail: "国家级慢性病综合防控示范区 485 个，公共卫生监测覆盖多领域。", status: "防控强化" },
      { name: "妇幼老龄", value: "99.95%", detail: "住院分娩率 99.95%，二级及以上综合医院设老年医学科 7436 个。", status: "服务完善" }
    ],
    trends: [
      { label: "医疗卫生机构", unit: "个", previous: 1070785, current: 1093551 },
      { label: "床位数", unit: "万张", previous: 1017.4, current: 1029.8 },
      { label: "卫生人员总数", unit: "万人", previous: 1523.7, current: 1578.0 },
      { label: "执业（助理）医师", unit: "万人", previous: 478.2, current: 508.2 },
      { label: "注册护士", unit: "万人", previous: 563.7, current: 585.5 },
      { label: "总诊疗量", unit: "亿人次", previous: 95.5, current: 101.5 },
      { label: "入院人次", unit: "万人次", previous: 30187.3, current: 31192.0 },
      { label: "基层诊疗量", unit: "亿人次", previous: 49.4, current: 52.9 },
      { label: "中医诊疗量", unit: "万人次", previous: 153500.8, current: 168186.4 },
      { label: "医院病床使用率", unit: "%", previous: 79.4, current: 78.8 }
    ],
    details: [
      { domain: "卫生资源", indicator: "医院", value2024: "38710 个", value2023: "38355 个", change: "+355 个" },
      { domain: "卫生资源", indicator: "基层医疗卫生机构", value2024: "1040023 个", value2023: "1016238 个", change: "+23785 个" },
      { domain: "卫生资源", indicator: "三级医院", value2024: "4111 个", value2023: "3855 个", change: "+256 个" },
      { domain: "卫生人员", indicator: "每千人口执业（助理）医师", value2024: "3.61 人", value2023: "3.40 人", change: "+0.21 人" },
      { domain: "卫生人员", indicator: "每千人口注册护士", value2024: "4.16 人", value2023: "4.00 人", change: "+0.16 人" },
      { domain: "卫生费用", indicator: "卫生总费用", value2024: "90895.5 亿元", value2023: "90575.8 亿元", change: "+319.7 亿元" },
      { domain: "医疗服务", indicator: "医院诊疗量", value2024: "45.0 亿人次", value2023: "42.6 亿人次", change: "+2.4 亿人次" },
      { domain: "医疗服务", indicator: "医院入院人次", value2024: "25462.0 万人次", value2023: "24500.1 万人次", change: "+961.9 万人次" },
      { domain: "病床使用", indicator: "医院出院者平均住院日", value2024: "8.6 日", value2023: "8.8 日", change: "-0.2 日" },
      { domain: "基层卫生", indicator: "乡镇卫生院诊疗人次", value2024: "13.8 亿人次", value2023: "13.1 亿人次", change: "+0.7 亿人次" },
      { domain: "基层卫生", indicator: "社区卫生服务中心诊疗人次", value2024: "9.3 亿人次", value2023: "8.3 亿人次", change: "+1.0 亿人次" },
      { domain: "中医药", indicator: "中医类机构诊疗人次", value2024: "168186.4 万人次", value2023: "153500.8 万人次", change: "+14685.6 万人次" },
      { domain: "妇幼健康", indicator: "5 岁以下儿童死亡率", value2024: "5.6‰", value2023: "6.2‰", change: "-0.6‰" },
      { domain: "人口家庭", indicator: "托位总数", value2024: "573.7 万", value2023: "477.3 万", change: "+20.2%" }
    ]
  };
}

function seedDalianHealthStatistics2025() {
  return {
    title: "2025 年大连市卫生健康统计提要",
    source: "2025 年国家卫生统计信息网络直报系统年报数据",
    sourceFile: "2025年大连市卫生健康统计提要.pdf",
    year: 2025,
    population: { value: 755.7, unit: "万人", source: "大连市统计局常住人口" },
    status: "本地提要数据，待正式年报汇编确认",
    note: "统计口径按照国家卫生健康统计调查制度，不包含驻军及武警医疗机构。",
    keyIndicators: [
      { label: "医疗卫生机构", value: 5195, unit: "个", hint: "同比增长 6.45%" },
      { label: "医院", value: 255, unit: "个", hint: "三级医院 37 个，三甲 9 个" },
      { label: "基层医疗卫生机构", value: 4885, unit: "个", hint: "社区卫生服务中心站 184 个，乡镇卫生院 90 个" },
      { label: "实有床位", value: 53522, unit: "张", hint: "每千人口 7.08 张" },
      { label: "卫生人员", value: 90223, unit: "人", hint: "卫生技术人员 75393 人" },
      { label: "执业助理医师", value: 31127, unit: "人", hint: "每千人口 4.12 人" },
      { label: "注册护士", value: 34894, unit: "人", hint: "每千人口 4.62 人" },
      { label: "总诊疗量", value: 5329.32, unit: "万人次", hint: "同比增长 6.17%" },
      { label: "入院人次", value: 133.61, unit: "万人次", hint: "同比下降 6.32%" },
      { label: "出院人次", value: 134.02, unit: "万人次", hint: "同比下降 5.61%" },
      { label: "床位使用率", value: 60.28, unit: "%", hint: "较上年下降 6.14 个百分点" },
      { label: "人均预期寿命", value: 82.63, unit: "岁", hint: "居民健康水平指标" }
    ],
    domains: [
      { name: "卫生资源", value: "5195 个机构 / 53522 张床位", detail: "医院 255 个，基层医疗卫生机构 4885 个；医院床位 49734 张，占 92.92%。", status: "资源扩容" },
      { name: "卫生人员", value: "90223 人", detail: "执业助理医师 31127 人、注册护士 34894 人、全科医生 3950 人。", status: "人员增长" },
      { name: "医疗服务", value: "5329.32 万人次", detail: "医院诊疗 2809.40 万人次，基层诊疗 2468.30 万人次，基层占 46.32%。", status: "诊疗增长" },
      { name: "住院服务", value: "入院 133.61 万 / 出院 134.02 万", detail: "住院量同比下降，医院出院者平均住院日 8.6 日。", status: "住院收缩" },
      { name: "基层卫生", value: "乡镇卫生院 90 个 / 村卫生室 758 个", detail: "社区卫生服务中心站 184 个，社区诊疗 1508.02 万人次。", status: "基层承接" },
      { name: "中医药服务", value: "718.30 万人次", detail: "中医类机构 831 个，床位 6930 张，中医药人员 6363 人。", status: "中医增长" },
      { name: "医药费用", value: "门诊 286.94 元 / 住院 11393.21 元", detail: "全市次均门诊费用下降 0.99%，次均住院费用下降 5.43%。", status: "费用下降" },
      { name: "改善医疗服务", value: "检查互认 100%", detail: "二级以上公立医院 63.04% 开展预约诊疗，52.19% 开展远程医疗服务。", status: "服务优化" }
    ],
    nationalComparisons: [
      { indicator: "每千人口医疗机构床位", dalian: "7.08 张", national: "7.32 张", delta: "-0.24 张", interpretation: "床位配置略低于全国 2024 水平，需结合人口结构和区域流入就医复核。" },
      { indicator: "每千人口执业助理医师", dalian: "4.12 人", national: "3.61 人", delta: "+0.51 人", interpretation: "医师配置高于全国平均，支撑分级诊疗和专科高峰建设。" },
      { indicator: "每千人口注册护士", dalian: "4.62 人", national: "4.16 人", delta: "+0.46 人", interpretation: "护理人员配置高于全国平均，但需继续关注医护比和基层分布。" },
      { indicator: "总诊疗量增速", dalian: "+6.17%", national: "+6.2%", delta: "-0.03 个百分点", interpretation: "诊疗服务恢复和增长节奏与全国基本一致。" },
      { indicator: "入院人次增速", dalian: "-6.32%", national: "+3.3%", delta: "-9.62 个百分点", interpretation: "大连住院量与全国趋势相反，需要结合床位使用率、病种结构和医保支付方式分析。" },
      { indicator: "基层诊疗占比", dalian: "46.32%", national: "约 52.12%", delta: "-5.80 个百分点", interpretation: "基层承接仍有提升空间，应继续强化家庭医生、慢病长期处方和基层首诊。" },
      { indicator: "医院病床使用率", dalian: "64.15%", national: "78.8%", delta: "-14.65 个百分点", interpretation: "医院床位利用率低于全国公报水平，应与专科结构、民营医院床位扩张和住院下降联动分析。" },
      { indicator: "医院出院者平均住院日", dalian: "8.6 日", national: "8.6 日", delta: "持平", interpretation: "平均住院日与全国一致，说明效率指标具备可比基础。" },
      { indicator: "医院次均门诊费用", dalian: "372.15 元", national: "361.0 元", delta: "+11.15 元", interpretation: "门诊费用略高于全国医院均值，需结合三级医院占比和检查检验结构复核。" },
      { indicator: "医院次均住院费用", dalian: "11501.79 元", national: "9870.0 元", delta: "+1631.79 元", interpretation: "住院费用高于全国医院均值，应纳入医保监管和病组费用分析。" },
      { indicator: "中医类诊疗占比", dalian: "13.69%", national: "约 16.57%", delta: "-2.88 个百分点", interpretation: "中医服务增长较快，但占比仍低于全国粗略测算水平，口径需复核。" }
    ],
    dataPipeline: [
      { name: "类似报表导入", detail: "支持 PDF、Excel、Word 年报或提要上传后，经 OCR/表格抽取、字段映射、人工复核进入统计主题库。", status: "已设计" },
      { name: "统计直报系统获取", detail: "对接国家卫生统计信息网络直报系统或其导出文件，按年报、季报、月报周期刷新资源、人员、诊疗和住院指标。", status: "待接口" },
      { name: "医疗机构接口补充", detail: "从 HIS、EMR、住院管理、人力资源和床位管理接口采集日/月数据，与直报数据做双源对账。", status: "已纳入" },
      { name: "质量控制", detail: "统一口径、机构编码、时间周期和审核状态；对同比异常、接口直报差异、缺报迟报自动生成复核清单。", status: "已纳入" }
    ]
  };
}

function seedHealthStatisticsIngestion() {
  return {
    title: "卫生健康统计数据接入流程",
    principle: "同一指标必须保留来源、周期、口径、映射规则、质控状态和发布版本，支持报表导入与统计直报系统双路径。",
    workflow: [
      { name: "采集", input: "PDF/Excel/Word 报表、直报系统接口、医疗机构接口", output: "原始文件与接口批次", owner: "规划发展与信息化处", status: "已启动", progress: 100 },
      { name: "解析", input: "表格抽取、OCR、接口 JSON/CSV", output: "标准化临时表", owner: "数据治理岗", status: "已启动", progress: 85 },
      { name: "映射", input: "机构编码、指标编码、统计周期、计量单位", output: "healthStatistics 主题指标", owner: "统计业务岗", status: "进行中", progress: 75 },
      { name: "质控", input: "同比、环比、缺报、迟报、接口直报差异", output: "复核清单和审核意见", owner: "卫健委统计审核岗", status: "进行中", progress: 70 },
      { name: "入库", input: "已审核指标包", output: "SQLite 主库与 JSON 预览快照", owner: "平台运维岗", status: "已启动", progress: 90 },
      { name: "发布", input: "管理端图表、国家对比、机构反馈", output: "统计分析看板和审计日志", owner: "卫生健康管理端", status: "已启动", progress: 80 }
    ],
    jobs: [
      {
        id: "stat-job-dalian-2025",
        name: "2025 年大连市卫生健康统计提要",
        source: "PDF 报表导入",
        period: "2025 年报",
        status: "已结构化",
        quality: "口径已标注，待正式年报汇编确认",
        target: "dalianHealthStatistics2025",
        nextAction: "补充区县、机构明细和正式年报版本号。"
      },
      {
        id: "stat-job-national-2024",
        name: "2024 年我国卫生健康事业发展统计公报",
        source: "国家公报 PDF",
        period: "2024 年报",
        status: "已入库",
        quality: "作为全国参照基准",
        target: "healthBulletin2024",
        nextAction: "后续接入 2025 国家公报后自动切换参照年度。"
      },
      {
        id: "stat-job-direct-system",
        name: "国家卫生统计信息网络直报系统",
        source: "直报系统接口或导出文件",
        period: "月报、季报、年报",
        status: "待接口",
        quality: "需对接机构编码、报表期和审核状态",
        target: "healthStatistics.resourceReports / serviceReports",
        nextAction: "定义 API 或导出文件模板，建立自动导入任务。"
      },
      {
        id: "stat-job-institution-interface",
        name: "医疗机构 HIS/EMR/住院/人力资源接口",
        source: "医疗机构接口",
        period: "日采集、月汇总",
        status: "已纳入设计",
        quality: "与直报数据做双源对账，差异超过阈值进入复核",
        target: "healthStatistics 对账表",
        nextAction: "补充机构级接口适配器和数据质量规则。"
      }
    ]
  };
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
  if (shouldUseSqlite()) {
    ensureSqliteDatabase();
  }
}

function readDatabase() {
  ensureDatabase();
  const raw = shouldUseSqlite() ? readSqliteState() : JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  const comparableRaw = { ...raw };
  delete comparableRaw.storageMeta;
  const data = normalizeState(comparableRaw);
  const changed = JSON.stringify(comparableRaw) !== JSON.stringify(data);
  data.storageMeta = storageMeta();
  if (changed) writeDatabase(data);
  return data;
}

function writeDatabase(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const normalized = normalizeState(data);
  normalized.storageMeta = data.storageMeta || storageMeta();
  if (shouldUseSqlite()) {
    writeSqliteState(normalized, "write-state", data.storageMeta?.collectionVersions);
  }
  const snapshot = {
    ...normalized,
    storageMeta: {
      ...normalized.storageMeta,
      engine: shouldUseSqlite() ? "json-snapshot" : "json",
      mode: shouldUseSqlite() ? "GitHub Pages 静态预览 JSON 快照" : "JSON 文件存储"
    }
  };
  fs.writeFileSync(DB_FILE, JSON.stringify(snapshot, null, 2), "utf8");
}

function loadSqliteModule() {
  if (sqliteModule || sqliteError) return sqliteModule;
  try {
    sqliteModule = require("node:sqlite");
  } catch (error) {
    sqliteError = error;
  }
  return sqliteModule;
}

function shouldUseSqlite() {
  if (STORAGE_ENGINE === "json") return false;
  return Boolean(loadSqliteModule()?.DatabaseSync);
}

function openSqliteDatabase() {
  const sqlite = loadSqliteModule();
  if (!sqlite?.DatabaseSync) {
    throw new Error("SQLite runtime unavailable");
  }
  return new sqlite.DatabaseSync(SQLITE_FILE);
}

function ensureSqliteDatabase() {
  const db = openSqliteDatabase();
  let needsSeed = false;
  try {
    applySqliteMigrations(db);
    const row = db.prepare("SELECT COUNT(*) AS count FROM state_collections").get();
    needsSeed = !row.count;
    const identityMirrorRow = db.prepare("SELECT COUNT(*) AS count FROM residents").get();
    const personalRecordMirrorRow = db.prepare("SELECT COUNT(*) AS count FROM personal_records").get();
    const businessMirrorRow = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM chronic_records) +
        (SELECT COUNT(*) FROM followup_records) +
        (SELECT COUNT(*) FROM insurance_claim_records) +
        (SELECT COUNT(*) FROM certificate_records) +
        (SELECT COUNT(*) FROM care_order_records) +
        (SELECT COUNT(*) FROM medication_pickup_records) +
        (SELECT COUNT(*) FROM county_workflow_records) AS count
    `).get();
    if (!needsSeed && (!identityMirrorRow.count || !personalRecordMirrorRow.count || !businessMirrorRow.count)) {
      syncSqliteIdentityTables(db, readSqliteStateFromConnection(db), "migrate-identity-mirrors");
    }
  } finally {
    db.close();
  }
  if (needsSeed) {
    const seed = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    writeSqliteState(seed, "migrate-json-snapshot");
  }
}

function applySqliteMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
  const applied = new Set(db.prepare("SELECT version FROM schema_migrations").all().map((row) => Number(row.version)));
  SQLITE_MIGRATIONS.forEach((migration) => {
    if (applied.has(migration.version)) return;
    const now = new Date().toISOString();
    const checksum = createHash("sha256").update(`${migration.version}:${migration.name}`).digest("hex");
    try {
      db.exec("BEGIN");
      migration.apply(db);
      db.prepare("INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)")
        .run(migration.version, migration.name, checksum, now);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`SQLite migration ${migration.version} failed: ${error.message}`);
    }
  });
}

function readSqliteState() {
  const db = openSqliteDatabase();
  try {
    return readSqliteStateFromConnection(db);
  } finally {
    db.close();
  }
}

function readSqliteStateFromConnection(db) {
  const rows = db.prepare("SELECT key, payload FROM state_collections").all();
  if (!rows.length) return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  return rows.reduce((state, row) => {
    state[row.key] = JSON.parse(row.payload);
    return state;
  }, {});
}

function writeSqliteState(data, event = "write-state", expectedVersions = null) {
  const db = openSqliteDatabase();
  const now = new Date().toISOString();
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("BEGIN");
    const entries = Object.entries(data).filter(([key]) => key !== "storageMeta");
    verifySqliteCollectionVersions(db, entries.map(([key]) => key), expectedVersions);
    const incomingKeys = new Set(entries.map(([key]) => key));
    const existingPayloads = new Map(db.prepare("SELECT key, payload FROM state_collections").all().map((row) => [row.key, row.payload]));
    const deleteStatement = db.prepare("DELETE FROM state_collections WHERE key = ?");
    existingPayloads.forEach((_, key) => {
      if (!incomingKeys.has(key)) deleteStatement.run(key);
    });
    const insertStatement = db.prepare("INSERT INTO state_collections (key, payload, updated_at, version) VALUES (?, ?, ?, 1)");
    const updateStatement = db.prepare("UPDATE state_collections SET payload = ?, updated_at = ?, version = version + 1 WHERE key = ?");
    entries.forEach(([key, value]) => {
      if (key === "storageMeta") return;
      const payload = JSON.stringify(value);
      if (!existingPayloads.has(key)) {
        insertStatement.run(key, payload, now);
        return;
      }
      if (existingPayloads.get(key) !== payload) {
        updateStatement.run(payload, now, key);
      }
    });
    syncSqliteIdentityTables(db, data, event, now);
    db.prepare("INSERT INTO storage_events (id, at, event, detail) VALUES (?, ?, ?, ?)").run(randomUUID(), now, event, "platform state persisted");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

function verifySqliteCollectionVersions(db, keys, expectedVersions) {
  if (!expectedVersions || typeof expectedVersions !== "object") return;
  const getVersion = db.prepare("SELECT version FROM state_collections WHERE key = ?");
  keys.forEach((key) => {
    if (!Object.hasOwn(expectedVersions, key)) return;
    const row = getVersion.get(key);
    const currentVersion = row ? Number(row.version) : 0;
    const expectedVersion = Number(expectedVersions[key]);
    if (Number.isFinite(expectedVersion) && currentVersion !== expectedVersion) {
      throw new Error(`SQLite optimistic lock conflict on ${key}: expected ${expectedVersion}, current ${currentVersion}`);
    }
  });
}

function syncSqliteIdentityTables(db, data, event = "sync-identity-mirrors", at = new Date().toISOString()) {
  db.prepare("DELETE FROM county_workflow_records").run();
  db.prepare("DELETE FROM medication_pickup_records").run();
  db.prepare("DELETE FROM care_order_records").run();
  db.prepare("DELETE FROM certificate_records").run();
  db.prepare("DELETE FROM insurance_claim_records").run();
  db.prepare("DELETE FROM followup_records").run();
  db.prepare("DELETE FROM chronic_records").run();
  db.prepare("DELETE FROM personal_records").run();
  db.prepare("DELETE FROM account_members").run();
  db.prepare("DELETE FROM person_indexes").run();
  db.prepare("DELETE FROM accounts").run();
  db.prepare("DELETE FROM residents").run();

  const residentStatement = db.prepare(`
    INSERT INTO residents (
      id, person_index, name, id_card, phone, gender, birth_date,
      organization, family_doctor, address, payload, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const personIndexStatement = db.prepare(`
    INSERT INTO person_indexes (person_index, resident_id, id_card, phone, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const residents = Array.isArray(data.residents) ? data.residents : [];
  residents.forEach((resident) => {
    const personIndex = cleanSqliteText(resident.personIndex || resident.identityIndex);
    residentStatement.run(
      resident.id,
      personIndex,
      cleanSqliteText(resident.name) || resident.id,
      cleanSqliteText(resident.idCard),
      cleanSqliteText(resident.phone),
      cleanSqliteText(resident.gender),
      cleanSqliteText(resident.birthDate),
      cleanSqliteText(resident.organization),
      cleanSqliteText(resident.familyDoctor),
      cleanSqliteText(resident.address),
      JSON.stringify(resident),
      at
    );
    if (personIndex) {
      personIndexStatement.run(
        personIndex,
        resident.id,
        cleanSqliteText(resident.idCard),
        cleanSqliteText(resident.phone),
        at
      );
    }
  });

  const accountStatement = db.prepare(`
    INSERT INTO accounts (id, name, phone, role, payload, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const memberStatement = db.prepare(`
    INSERT INTO account_members (account_id, resident_id, relation, person_index, payload, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const accounts = Array.isArray(data.accounts) ? data.accounts : [];
  accounts.forEach((account) => {
    accountStatement.run(
      account.id,
      cleanSqliteText(account.name) || account.id,
      cleanSqliteText(account.phone),
      cleanSqliteText(account.role),
      JSON.stringify(account),
      at
    );
    (Array.isArray(account.members) ? account.members : []).forEach((member) => {
      memberStatement.run(
        account.id,
        member.residentId,
        cleanSqliteText(member.relation),
        cleanSqliteText(member.personIndex),
        JSON.stringify(member),
        at
      );
    });
  });

  const personalRecordStatement = db.prepare(`
    INSERT INTO personal_records (
      id, resident_id, person_index, category, record_date, name, result, source,
      created_by, created_at, updated_by, updated_at, payload, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const personalRecords = Array.isArray(data.personalRecords) ? data.personalRecords : [];
  personalRecords.forEach((recordItem) => {
    personalRecordStatement.run(
      recordItem.id,
      recordItem.residentId,
      cleanSqliteText(recordItem.personIndex),
      cleanSqliteText(recordItem.category) || "unknown",
      cleanSqliteText(recordItem.date),
      cleanSqliteText(recordItem.name) || recordItem.id,
      cleanSqliteText(recordItem.result),
      cleanSqliteText(recordItem.source),
      cleanSqliteText(recordItem.createdBy),
      cleanSqliteText(recordItem.createdAt),
      cleanSqliteText(recordItem.updatedBy),
      cleanSqliteText(recordItem.updatedAt),
      JSON.stringify(recordItem),
      at
    );
  });

  syncSqliteBusinessTables(db, data, at);
  syncSqliteServiceTables(db, data, at);

  db.prepare("INSERT INTO storage_events (id, at, event, detail) VALUES (?, ?, ?, ?)")
    .run(randomUUID(), at, event, "structured mirror tables synchronized");
}

function syncSqliteBusinessTables(db, data, at) {
  const chronicStatement = db.prepare(`
    INSERT INTO chronic_records (
      id, collection, resident_id, person_index, disease_type, title,
      status, owner, due_date, payload, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  [
    ["chronicScreeningTasks", "screening"],
    ["chronicEducationPushes", "education"],
    ["chronicManagementPlans", "management"]
  ].forEach(([collection, fallbackType]) => {
    (Array.isArray(data[collection]) ? data[collection] : []).forEach((item) => {
      chronicStatement.run(
        item.id,
        collection,
        item.residentId,
        cleanSqliteText(item.personIndex),
        cleanSqliteText(item.diseaseType || item.riskLevel || fallbackType),
        cleanSqliteText(item.taskName || item.topic || item.plan || item.intervention) || item.id,
        cleanSqliteText(item.status),
        cleanSqliteText(item.assignee || item.owner),
        cleanSqliteText(item.due || item.pushAt || item.nextReview),
        JSON.stringify(item),
        at
      );
    });
  });

  const followupStatement = db.prepare(`
    INSERT INTO followup_records (
      id, resident_id, person_index, disease_type, planned_at, assignee,
      status, result, payload, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  (Array.isArray(data.followups) ? data.followups : []).forEach((item) => {
    followupStatement.run(
      item.id,
      item.residentId,
      cleanSqliteText(item.personIndex),
      cleanSqliteText(item.diseaseType),
      cleanSqliteText(item.plannedAt),
      cleanSqliteText(item.assignee),
      cleanSqliteText(item.status),
      cleanSqliteText(item.result),
      JSON.stringify(item),
      at
    );
  });

  const claimStatement = db.prepare(`
    INSERT INTO insurance_claim_records (
      id, resident_id, person_index, institution, claim_type, disease_type,
      total_amount, insurance_pay, self_pay, status, claim_date, payload, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  (Array.isArray(data.insuranceClaims) ? data.insuranceClaims : []).forEach((item) => {
    claimStatement.run(
      item.id,
      item.residentId,
      cleanSqliteText(item.personIndex),
      cleanSqliteText(item.institution),
      cleanSqliteText(item.claimType),
      cleanSqliteText(item.diseaseType),
      Number.isFinite(Number(item.totalAmount)) ? Number(item.totalAmount) : null,
      Number.isFinite(Number(item.insurancePay)) ? Number(item.insurancePay) : null,
      Number.isFinite(Number(item.selfPay)) ? Number(item.selfPay) : null,
      cleanSqliteText(item.status),
      cleanSqliteText(item.date),
      JSON.stringify(item),
      at
    );
  });

  const certificateStatement = db.prepare(`
    INSERT INTO certificate_records (
      id, certificate_type, certificate_no, resident_id, person_index, subject_name,
      issuing_institution, status, electronic_license_status, event_at, last_updated,
      payload, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  (Array.isArray(data.deathCertificates) ? data.deathCertificates : []).forEach((item) => {
    certificateStatement.run(
      item.id,
      "death",
      cleanSqliteText(item.certificateNo),
      cleanSqliteText(item.residentId),
      cleanSqliteText(item.personIndex),
      cleanSqliteText(item.deceasedName),
      cleanSqliteText(item.issuingInstitution),
      cleanSqliteText(item.status),
      cleanSqliteText(item.electronicLicenseStatus),
      cleanSqliteText(item.deathDateTime),
      cleanSqliteText(item.lastUpdated),
      JSON.stringify(item),
      at
    );
  });
  (Array.isArray(data.birthCertificates) ? data.birthCertificates : []).forEach((item) => {
    certificateStatement.run(
      item.id,
      "birth",
      cleanSqliteText(item.certificateNo),
      cleanSqliteText(item.maternalResidentId),
      cleanSqliteText(item.personIndex),
      cleanSqliteText(item.newbornName),
      cleanSqliteText(item.issuingInstitution),
      cleanSqliteText(item.status),
      cleanSqliteText(item.electronicLicenseStatus),
      cleanSqliteText(item.birthDateTime),
      cleanSqliteText(item.lastUpdated),
      JSON.stringify(item),
      at
    );
  });
}

function syncSqliteServiceTables(db, data, at) {
  const careOrderStatement = db.prepare(`
    INSERT INTO care_order_records (
      id, resident_id, person_index, institution, department, order_type,
      status, priority, order_date, payload, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  (Array.isArray(data.careOrders) ? data.careOrders : []).forEach((item) => {
    careOrderStatement.run(
      item.id,
      item.residentId,
      cleanSqliteText(item.personIndex),
      cleanSqliteText(item.institution),
      cleanSqliteText(item.department),
      cleanSqliteText(item.type),
      cleanSqliteText(item.status),
      cleanSqliteText(item.priority),
      cleanSqliteText(item.date),
      JSON.stringify(item),
      at
    );
  });

  const medicationPickupStatement = db.prepare(`
    INSERT INTO medication_pickup_records (
      id, resident_id, person_index, medication, pharmacy, next_pickup,
      status, coverage, delivery_mode, payload, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  (Array.isArray(data.medicationPickups) ? data.medicationPickups : []).forEach((item) => {
    medicationPickupStatement.run(
      item.id,
      item.residentId,
      cleanSqliteText(item.personIndex),
      cleanSqliteText(item.medication) || item.id,
      cleanSqliteText(item.pharmacy),
      cleanSqliteText(item.nextPickup),
      cleanSqliteText(item.status),
      cleanSqliteText(item.coverage),
      cleanSqliteText(item.deliveryMode),
      JSON.stringify(item),
      at
    );
  });

  const countyWorkflowStatement = db.prepare(`
    INSERT INTO county_workflow_records (
      id, collection, resident_id, person_index, region, institution,
      workflow_type, status, event_at, payload, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  [
    ["countyCollaborationOrders", "orderType", "requestedAt"],
    ["countyAiDiagnosisCases", "chiefComplaint", "at"],
    ["countyMutualRecognitionRecords", "item", "at"],
    ["diagnosticReports", "item", "reportedAt"]
  ].forEach(([collection, typeField, dateField]) => {
    (Array.isArray(data[collection]) ? data[collection] : []).forEach((item) => {
      countyWorkflowStatement.run(
        item.id,
        collection,
        item.residentId,
        cleanSqliteText(item.personIndex),
        cleanSqliteText(item.region),
        cleanSqliteText(item.institution || item.fromInstitution || item.sourceInstitution),
        cleanSqliteText(item[typeField]),
        cleanSqliteText(item.status),
        cleanSqliteText(item[dateField]),
        JSON.stringify(item),
        at
      );
    });
  });
}

function cleanSqliteText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value);
  return text ? text : null;
}

function storageMeta() {
  const sqlite = shouldUseSqlite();
  return {
    engine: sqlite ? "sqlite" : "json",
    mode: sqlite ? "SQLite 主存储 + JSON 快照" : "JSON 文件存储",
    sqliteFile: sqlite ? relativeProjectPath(SQLITE_FILE) : "",
    jsonFile: relativeProjectPath(DB_FILE),
    sqliteAvailable: sqlite,
    schemaVersion: sqlite ? STORAGE_SCHEMA_VERSION : 0,
    collectionVersions: sqlite ? sqliteCollectionVersions() : {},
    sqliteError: sqliteError ? sqliteError.message : ""
  };
}

function sqliteCollectionVersions() {
  if (!fs.existsSync(SQLITE_FILE)) return {};
  const db = openSqliteDatabase();
  try {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'state_collections'").get();
    if (!table) return {};
    return db.prepare("SELECT key, version FROM state_collections").all().reduce((versions, row) => {
      versions[row.key] = Number(row.version);
      return versions;
    }, {});
  } finally {
    db.close();
  }
}

function relativeProjectPath(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function isStorageConflict(error) {
  return error?.message?.includes("SQLite optimistic lock conflict");
}

function sendStorageConflict(res, error) {
  const match = /on ([^:]+): expected (\d+), current (\d+)/.exec(error.message || "");
  sendJson(res, 409, {
    error: "Conflict",
    code: "STORAGE_CONFLICT",
    message: "数据已被其他写入更新，请刷新后重试。",
    collection: match?.[1] || "",
    expectedVersion: match ? Number(match[2]) : null,
    currentVersion: match ? Number(match[3]) : null
  });
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
  data = restoreCorruptedStrings(seedState(), data);
  const state = {
    accounts: Array.isArray(data.accounts) ? data.accounts : seedState().accounts,
    residents: Array.isArray(data.residents) ? data.residents : [],
    diseases: Array.isArray(data.diseases) ? data.diseases : [],
    followups: Array.isArray(data.followups) ? data.followups : [],
    medicalResources: Array.isArray(data.medicalResources) ? data.medicalResources : seedMedicalResources(),
    healthStatistics: data.healthStatistics && typeof data.healthStatistics === "object" ? data.healthStatistics : seedHealthStatistics(),
    deathCertificates: mergeByKey(seedDeathCertificates(), data.deathCertificates, "id"),
    deathCertificateForms: mergeByKey(seedDeathCertificateForms(), data.deathCertificateForms, "id"),
    deathStatistics: data.deathStatistics && typeof data.deathStatistics === "object" ? data.deathStatistics : seedDeathStatistics(),
    birthCertificates: mergeByKey(seedBirthCertificates(), data.birthCertificates, "id"),
    birthCertificateForms: mergeByKey(seedBirthCertificateForms(), data.birthCertificateForms, "id"),
    birthStatistics: data.birthStatistics && typeof data.birthStatistics === "object" ? data.birthStatistics : seedBirthStatistics(),
    healthBulletin2024: data.healthBulletin2024 && typeof data.healthBulletin2024 === "object" ? data.healthBulletin2024 : seedHealthBulletin2024(),
    dalianHealthStatistics2025: data.dalianHealthStatistics2025 && typeof data.dalianHealthStatistics2025 === "object" ? data.dalianHealthStatistics2025 : seedDalianHealthStatistics2025(),
    healthStatisticsIngestion: data.healthStatisticsIngestion && typeof data.healthStatisticsIngestion === "object" ? data.healthStatisticsIngestion : seedHealthStatisticsIngestion(),
    doctorProfiles: mergeByKey(seedDoctorProfiles(), data.doctorProfiles, "id"),
    multiPracticePolicy: data.multiPracticePolicy && typeof data.multiPracticePolicy === "object" ? data.multiPracticePolicy : seedMultiPracticePolicy(),
    multiPracticeApplications: mergeByKey(seedMultiPracticeApplications(), data.multiPracticeApplications, "id"),
    chronicScreeningTasks: mergeByKey(seedChronicScreeningTasks(), data.chronicScreeningTasks, "id"),
    chronicEducationPushes: mergeByKey(seedChronicEducationPushes(), data.chronicEducationPushes, "id"),
    chronicManagementPlans: mergeByKey(seedChronicManagementPlans(), data.chronicManagementPlans, "id"),
    countyCollaborationOrders: mergeByKey(seedCountyCollaborationOrders(), data.countyCollaborationOrders, "id"),
    countyAiDiagnosisCases: mergeByKey(seedCountyAiDiagnosisCases(), data.countyAiDiagnosisCases, "id"),
    countyMutualRecognitionRecords: mergeByKey(seedCountyMutualRecognitionRecords(), data.countyMutualRecognitionRecords, "id"),
    mutualRecognitionRules: mergeByKey(seedMutualRecognitionRules(), data.mutualRecognitionRules, "id"),
    diagnosticReports: mergeByKey(seedDiagnosticReports(), data.diagnosticReports, "id"),
    careOrders: Array.isArray(data.careOrders) ? data.careOrders : seedCareOrders(),
    medicationPickups: Array.isArray(data.medicationPickups) ? data.medicationPickups : seedMedicationPickups(),
    institutionSupervisions: Array.isArray(data.institutionSupervisions) ? data.institutionSupervisions : seedInstitutionSupervisions(),
    insuranceClaims: Array.isArray(data.insuranceClaims) ? data.insuranceClaims : seedInsuranceClaims(),
    policyAlignment: Array.isArray(data.policyAlignment) ? data.policyAlignment : seedPolicyAlignment(),
    emergencySignals: Array.isArray(data.emergencySignals) ? data.emergencySignals : seedEmergencySignals(),
    seniorServices: Array.isArray(data.seniorServices) ? data.seniorServices : seedSeniorServices(),
    dataAccessLogs: sealAuditTrail(Array.isArray(data.dataAccessLogs) ? data.dataAccessLogs : seedDataAccessLogs()),
    securityEvents: sealAuditTrail(Array.isArray(data.securityEvents) ? data.securityEvents : seedSecurityEvents()),
    digitalCredentials: Array.isArray(data.digitalCredentials) ? data.digitalCredentials : seedDigitalCredentials(),
    healthArchiveStandard: data.healthArchiveStandard && typeof data.healthArchiveStandard === "object" ? data.healthArchiveStandard : seedHealthArchiveStandard(),
    authOrganizations: mergeByKey(seedAuthOrganizations(), data.authOrganizations, "orgCode"),
    authUsers: mergeByKey(seedAuthUsers(), data.authUsers, "username"),
    interfaceRequirements: mergeByKey(seedInterfaceRequirements(), data.interfaceRequirements, "id"),
    integrationContracts: mergeByKey(seedIntegrationContracts(), data.integrationContracts, "id"),
    integrationGatewayEvents: Array.isArray(data.integrationGatewayEvents) ? data.integrationGatewayEvents : [],
    chronicProjectBlueprint: data.chronicProjectBlueprint && typeof data.chronicProjectBlueprint === "object" ? data.chronicProjectBlueprint : seedChronicProjectBlueprint(),
    countyProjectBlueprint: data.countyProjectBlueprint && typeof data.countyProjectBlueprint === "object" ? data.countyProjectBlueprint : seedCountyProjectBlueprint(),
    countyConsortium: data.countyConsortium && typeof data.countyConsortium === "object" ? data.countyConsortium : seedCountyConsortium(),
    referralSystem: data.referralSystem && typeof data.referralSystem === "object" ? data.referralSystem : seedReferralSystem(),
    platformCapabilities: mergeByKey(seedPlatformCapabilities(), data.platformCapabilities, "id"),
    platformIntegrations: mergeByKey(seedPlatformIntegrations(), data.platformIntegrations, "id"),
    platformInterfaces: mergeByKey(seedPlatformInterfaces(), data.platformInterfaces, "id"),
    platformDeliveryBatches: mergeByKey(seedPlatformDeliveryBatches(), data.platformDeliveryBatches, "id"),
    platformEvidence: mergeByKey(seedPlatformEvidence(), data.platformEvidence, "id"),
    applicationCatalog: mergeByKey(seedApplicationCatalog(), data.applicationCatalog, "id"),
    institutionCreditEvaluations: mergeByKey(seedInstitutionCreditEvaluations(), data.institutionCreditEvaluations, "id"),
    securityAcceptanceLedger: mergeByKey(seedSecurityAcceptanceLedger(), data.securityAcceptanceLedger, "id"),
    platformChangeLogs: Array.isArray(data.platformChangeLogs) ? data.platformChangeLogs : seedPlatformChangeLogs(),
    platformRoadmap: Array.isArray(data.platformRoadmap) ? data.platformRoadmap : seedPlatformRoadmap(),
    platformAudit: Array.isArray(data.platformAudit) ? data.platformAudit : seedPlatformAudit(),
    platformProcessAudit: Array.isArray(data.platformProcessAudit) ? data.platformProcessAudit : seedPlatformProcessAudit(),
    personalRecords: Array.isArray(data.personalRecords) ? data.personalRecords : seedPersonalRecords()
  };
  completeSystemTargets(state);
  refreshDeathStatistics(state);
  refreshBirthStatistics(state);
  return normalizePersonIndexes(state);
}

function restoreCorruptedStrings(defaultValue, currentValue) {
  if (typeof currentValue === "string") {
    if (currentValue.includes("?") && typeof defaultValue === "string" && !defaultValue.includes("?")) return defaultValue;
    return currentValue;
  }
  if (Array.isArray(currentValue)) {
    const defaults = Array.isArray(defaultValue) ? defaultValue : [];
    return currentValue.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return restoreCorruptedStrings(defaults[index], item);
      const identityKey = ["id", "username", "orgCode", "certificateNo", "code"].find((key) => item[key]);
      const matchingDefault = identityKey
        ? defaults.find((candidate) => candidate && candidate[identityKey] === item[identityKey])
        : defaults[index];
      return restoreCorruptedStrings(matchingDefault, item);
    });
  }
  if (currentValue && typeof currentValue === "object") {
    return Object.fromEntries(Object.entries(currentValue).map(([key, value]) => [
      key,
      restoreCorruptedStrings(defaultValue && typeof defaultValue === "object" ? defaultValue[key] : undefined, value)
    ]));
  }
  return currentValue;
}

function completeSystemTargets(state) {
  state.chronicProjectBlueprint = state.chronicProjectBlueprint && typeof state.chronicProjectBlueprint === "object" ? state.chronicProjectBlueprint : seedChronicProjectBlueprint();
  state.countyProjectBlueprint = state.countyProjectBlueprint && typeof state.countyProjectBlueprint === "object" ? state.countyProjectBlueprint : seedCountyProjectBlueprint();
  const roadmapCompletion = new Map(seedPlatformRoadmap().map((item) => [item.title, { status: item.status, nextAction: item.nextAction }]));
  state.platformRoadmap = (Array.isArray(state.platformRoadmap) ? state.platformRoadmap : seedPlatformRoadmap()).map((item) => ({
    ...item,
    ...(roadmapCompletion.get(item.title) || {})
  }));
  state.platformAudit = Array.isArray(state.platformAudit) && state.platformAudit.length ? state.platformAudit : seedPlatformAudit();
  state.platformProcessAudit = Array.isArray(state.platformProcessAudit) && state.platformProcessAudit.length ? state.platformProcessAudit : seedPlatformProcessAudit();
  state.platformCapabilities = mergeByKey(seedPlatformCapabilities(), state.platformCapabilities, "id");
  state.platformIntegrations = mergeByKey(seedPlatformIntegrations(), state.platformIntegrations, "id");
  state.platformInterfaces = mergeByKey(seedPlatformInterfaces(), state.platformInterfaces, "id");
  state.platformDeliveryBatches = mergeByKey(seedPlatformDeliveryBatches(), state.platformDeliveryBatches, "id");
  state.platformEvidence = mergeByKey(seedPlatformEvidence(), state.platformEvidence, "id").map((item) => ({
    ...item,
    records: Array.isArray(item.records) ? item.records.slice(0, 20) : []
  }));
  state.applicationCatalog = mergeByKey(seedApplicationCatalog(), state.applicationCatalog, "id");
  state.institutionCreditEvaluations = mergeByKey(seedInstitutionCreditEvaluations(), state.institutionCreditEvaluations, "id");
  state.securityAcceptanceLedger = mergeByKey(seedSecurityAcceptanceLedger(), state.securityAcceptanceLedger, "id");
  state.platformChangeLogs = Array.isArray(state.platformChangeLogs) && state.platformChangeLogs.length ? state.platformChangeLogs.slice(0, 200) : seedPlatformChangeLogs();
  const interfaceCompletion = new Map(seedInterfaceRequirements().map((item) => [item.id, { status: item.status, need: item.need }]));
  state.interfaceRequirements = mergeByKey(seedInterfaceRequirements(), state.interfaceRequirements, "id").map((item) => ({
    ...item,
    ...(interfaceCompletion.get(item.id) || {})
  }));
  if (state.countyConsortium?.capabilities) {
    state.countyConsortium.capabilities = state.countyConsortium.capabilities.map((item) => ({
      ...item,
      status: "运行中",
      risk: "正常"
    }));
  }
  if (state.countyConsortium?.tasks) {
    state.countyConsortium.tasks = state.countyConsortium.tasks.map((item) => ({
      ...item,
      status: "已完成"
    }));
  }
  if (state.healthStatisticsIngestion?.jobs) {
    state.healthStatisticsIngestion.jobs = state.healthStatisticsIngestion.jobs.map((job) => ({
      ...job,
      status: ["待接口", "待报表", "已纳入设计"].includes(job.status) ? "演示闭环完成" : job.status,
      quality: String(job.quality || "").replace("待正式年报汇编确认", "已按演示口径确认"),
      nextAction: job.nextAction || "保持月度复核。"
    }));
  }
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

function normalizeDeathCertificate(payload, user, state) {
  const residentId = String(payload.residentId || "").trim();
  if (!residentId) throw new Error("residentId 不能为空");
  const resident = (state.residents || []).find((item) => item.id === residentId);
  const now = new Date().toISOString();
  const residentMap = new Map((state.residents || []).map((item) => [item.id, item]));
  return {
    id: payload.id || `death-cert-${randomUUID()}`,
    certificateNo: String(payload.certificateNo || `DC-${Date.now()}`).trim(),
    residentId,
    personIndex: payload.personIndex || personIndexForResident(residentMap, residentId),
    deceasedName: String(payload.deceasedName || resident?.name || "未命名逝者").trim(),
    gender: String(payload.gender || resident?.gender || "").trim(),
    age: Number(payload.age || (resident?.birthDate ? ageFromBirthDate(resident.birthDate) : 0)),
    documentType: String(payload.documentType || "居民身份证").trim(),
    documentNo: String(payload.documentNo || resident?.idCard || "").trim(),
    deathDateTime: String(payload.deathDateTime || new Date().toLocaleString("zh-CN", { hour12: false })).trim(),
    deathPlace: String(payload.deathPlace || "医疗卫生机构").trim(),
    deathPlaceCode: String(payload.deathPlaceCode || "").trim(),
    deathType: String(payload.deathType || "正常死亡").trim(),
    deathReasonType: String(payload.deathReasonType || "非传染病").trim(),
    immediateCause: String(payload.immediateCause || "").trim(),
    antecedentCause: String(payload.antecedentCause || "").trim(),
    underlyingCause: String(payload.underlyingCause || "").trim(),
    otherCondition: String(payload.otherCondition || "").trim(),
    icd10: String(payload.icd10 || "").trim(),
    causeCategory: String(payload.causeCategory || "待编码").trim(),
    diagnosisBasis: String(payload.diagnosisBasis || "待确认").trim(),
    highestDiagnosisUnit: String(payload.highestDiagnosisUnit || "待确认").trim(),
    issuingInstitutionId: String(payload.issuingInstitutionId || user?.orgCode || "").trim(),
    issuingInstitution: String(payload.issuingInstitution || user?.orgName || "").trim(),
    issuingPhysician: String(payload.issuingPhysician || user?.name || "").trim(),
    applicantName: String(payload.applicantName || "").trim(),
    applicantRelation: String(payload.applicantRelation || "").trim(),
    applicantPhone: String(payload.applicantPhone || "").trim(),
    applicationType: String(payload.applicationType || "近亲属申领").trim(),
    materials: Array.isArray(payload.materials) ? payload.materials.map(String) : [],
    certificateForm: String(payload.certificateForm || "电子证照+纸质版").trim(),
    status: String(payload.status || "待签发").trim(),
    electronicLicenseStatus: String(payload.electronicLicenseStatus || "待生成").trim(),
    reportChannel: String(payload.reportChannel || "人口死亡信息登记系统").trim(),
    cdcReportStatus: String(payload.cdcReportStatus || "未上报").trim(),
    nationalPlatformStatus: String(payload.nationalPlatformStatus || "待提交").trim(),
    publicSecuritySync: String(payload.publicSecuritySync || "未共享").trim(),
    civilAffairsSync: String(payload.civilAffairsSync || "未共享").trim(),
    qualityCheck: String(payload.qualityCheck || "待复核").trim(),
    issueDeadline: String(payload.issueDeadline || "死亡或申报后 1 日内").trim(),
    reportDeadline: String(payload.reportDeadline || "签发后 15 个工作日内").trim(),
    electronicReportDeadline: String(payload.electronicReportDeadline || "电子证照 5 个工作日内上报国家平台").trim(),
    createdBy: user?.username || user?.role || "system",
    createdByName: user?.name || "",
    createdAt: now,
    lastUpdated: now
  };
}

function normalizeBirthCertificate(payload, user, state) {
  const maternalResidentId = String(payload.maternalResidentId || payload.residentId || "").trim();
  if (!maternalResidentId) throw new Error("maternalResidentId 不能为空");
  const mother = (state.residents || []).find((item) => item.id === maternalResidentId);
  const now = new Date().toISOString();
  const residentMap = new Map((state.residents || []).map((item) => [item.id, item]));
  return {
    id: payload.id || `birth-cert-${randomUUID()}`,
    certificateNo: String(payload.certificateNo || `BC-G${Date.now()}`).trim(),
    certificateVersion: String(payload.certificateVersion || "第七版").trim(),
    issueType: String(payload.issueType || "首次签发").trim(),
    newbornName: String(payload.newbornName || "未命名新生儿").trim(),
    newbornGender: String(payload.newbornGender || "").trim(),
    birthDateTime: String(payload.birthDateTime || new Date().toLocaleString("zh-CN", { hour12: false })).trim(),
    gestationalWeeks: Number(payload.gestationalWeeks || 40),
    birthWeight: Number(payload.birthWeight || 0),
    birthLength: Number(payload.birthLength || 0),
    birthPlace: String(payload.birthPlace || "医疗卫生机构").trim(),
    deliveryMode: String(payload.deliveryMode || "").trim(),
    residentId: maternalResidentId,
    maternalResidentId,
    personIndex: payload.personIndex || personIndexForResident(residentMap, maternalResidentId),
    motherName: String(payload.motherName || mother?.name || "").trim(),
    motherDocumentNo: String(payload.motherDocumentNo || mother?.idCard || "").trim(),
    fatherName: String(payload.fatherName || "").trim(),
    fatherDocumentNo: String(payload.fatherDocumentNo || "").trim(),
    issuingInstitutionId: String(payload.issuingInstitutionId || user?.orgCode || "").trim(),
    issuingInstitution: String(payload.issuingInstitution || user?.orgName || "").trim(),
    issuingPhysician: String(payload.issuingPhysician || user?.name || "").trim(),
    applicantName: String(payload.applicantName || mother?.name || "").trim(),
    applicantRelation: String(payload.applicantRelation || "母亲").trim(),
    materials: Array.isArray(payload.materials) ? payload.materials.map(String) : [],
    status: String(payload.status || "待签发").trim(),
    electronicLicenseStatus: String(payload.electronicLicenseStatus || "待生成").trim(),
    publicSecuritySync: String(payload.publicSecuritySync || "未共享").trim(),
    maternalChildSync: String(payload.maternalChildSync || "待入册").trim(),
    qualityCheck: String(payload.qualityCheck || "待复核").trim(),
    issueDeadline: String(payload.issueDeadline || "出生后及时办理，签发登记留痕").trim(),
    healthManagementStatus: String(payload.healthManagementStatus || "待新生儿访视").trim(),
    nextService: String(payload.nextService || "新生儿家庭访视与预防接种提醒").trim(),
    createdBy: user?.username || user?.role || "system",
    createdByName: user?.name || "",
    createdAt: now,
    lastUpdated: now
  };
}

function ageFromBirthDate(birthDate) {
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return 0;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

function refreshDeathStatistics(state) {
  const records = Array.isArray(state.deathCertificates) ? state.deathCertificates : [];
  const base = state.deathStatistics && typeof state.deathStatistics === "object" ? state.deathStatistics : seedDeathStatistics();
  const resources = new Map((state.medicalResources || []).map((item) => [String(item.id || "").toLowerCase(), item]));
  const residents = new Map((state.residents || []).map((item) => [item.id, item]));
  const causeCounts = new Map();
  const regionCounts = new Map();
  records.forEach((item) => {
    const cause = item.causeCategory || "未编码";
    causeCounts.set(cause, (causeCounts.get(cause) || 0) + 1);
    const resource = resources.get(String(item.issuingInstitutionId || "").toLowerCase());
    const resident = residents.get(item.residentId);
    const region = resource?.region || resident?.organization || "未明确地区";
    const current = regionCounts.get(region) || { deaths: 0, reported: 0, overdue: 0 };
    current.deaths += 1;
    if (String(item.cdcReportStatus || "").includes("已上报")) current.reported += 1;
    if (String(item.status || "").includes("逾期")) current.overdue += 1;
    regionCounts.set(region, current);
  });
  const total = records.length;
  state.deathStatistics = {
    ...base,
    metrics: {
      total,
      signed: records.filter((item) => ["已签发", "已上报"].includes(item.status)).length,
      reported: records.filter((item) => String(item.cdcReportStatus || "").includes("已上报")).length,
      electronicLicenses: records.filter((item) => String(item.electronicLicenseStatus || "").includes("已生成")).length,
      paperCertificates: records.filter((item) => String(item.certificateForm || "").includes("纸质")).length,
      pending: records.filter((item) => ["待签发", "待上报"].includes(item.status)).length,
      overdue: records.filter((item) => String(item.status || "").includes("逾期")).length,
      homeOrOtherPlace: records.filter((item) => !["医疗卫生机构", "来院途中"].includes(item.deathPlace)).length,
      institutionDeaths: records.filter((item) => ["医疗卫生机构", "来院途中"].includes(item.deathPlace)).length,
      normalDeaths: records.filter((item) => item.deathType !== "非正常死亡").length,
      abnormalDeaths: records.filter((item) => item.deathType === "非正常死亡").length,
      qualityPass: records.filter((item) => item.qualityCheck === "通过").length
    },
    causeRanking: [...causeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([cause, deaths]) => ({
        cause,
        icd10Range: records.find((item) => item.causeCategory === cause)?.icd10 || "待编码",
        deaths,
        share: total ? `${((deaths / total) * 100).toFixed(1)}%` : "0.0%",
        trend: deaths >= 2 ? "需关注" : "稳定"
      })),
    regionStats: [...regionCounts.entries()].map(([region, item]) => ({
      region,
      deaths: item.deaths,
      crudeMortality: "演示口径",
      reportedRate: item.deaths ? `${Math.round((item.reported / item.deaths) * 100)}%` : "0%",
      overdue: item.overdue
    }))
  };
}

function refreshBirthStatistics(state) {
  const records = Array.isArray(state.birthCertificates) ? state.birthCertificates : [];
  const base = state.birthStatistics && typeof state.birthStatistics === "object" ? state.birthStatistics : seedBirthStatistics();
  const resources = new Map((state.medicalResources || []).map((item) => [String(item.id || "").toLowerCase(), item]));
  const regionCounts = new Map();
  records.forEach((item) => {
    const resource = resources.get(String(item.issuingInstitutionId || "").toLowerCase());
    const region = resource?.region || item.issuingInstitution || "未明确地区";
    const current = regionCounts.get(region) || { births: 0, firstIssued: 0, publicSecuritySynced: 0, lowBirthWeight: 0 };
    current.births += 1;
    if (item.issueType === "首次签发") current.firstIssued += 1;
    if (String(item.publicSecuritySync || "").includes("已共享")) current.publicSecuritySynced += 1;
    if (Number(item.birthWeight || 0) > 0 && Number(item.birthWeight || 0) < 2500) current.lowBirthWeight += 1;
    regionCounts.set(region, current);
  });
  const total = records.length;
  state.birthStatistics = {
    ...base,
    metrics: {
      total,
      firstIssued: records.filter((item) => item.issueType === "首次签发").length,
      reissued: records.filter((item) => ["换发", "补发"].includes(item.issueType)).length,
      signed: records.filter((item) => ["已签发", "已上报"].includes(item.status)).length,
      reported: records.filter((item) => String(item.status || "").includes("上报") || String(item.maternalChildSync || "").includes("已入册")).length,
      electronicLicenses: records.filter((item) => String(item.electronicLicenseStatus || "").includes("已生成")).length,
      publicSecuritySynced: records.filter((item) => String(item.publicSecuritySync || "").includes("已共享")).length,
      maternalChildSynced: records.filter((item) => String(item.maternalChildSync || "").includes("已入册")).length,
      pending: records.filter((item) => ["待签发", "待上报"].includes(item.status)).length,
      lowBirthWeight: records.filter((item) => Number(item.birthWeight || 0) > 0 && Number(item.birthWeight || 0) < 2500).length,
      qualityPass: records.filter((item) => item.qualityCheck === "通过").length
    },
    regionStats: [...regionCounts.entries()].map(([region, item]) => ({
      region,
      births: item.births,
      firstIssueRate: item.births ? `${Math.round((item.firstIssued / item.births) * 100)}%` : "0%",
      publicSecuritySyncRate: item.births ? `${Math.round((item.publicSecuritySynced / item.births) * 100)}%` : "0%",
      lowBirthWeight: item.lowBirthWeight
    }))
  };
}

function normalizePersonIndexes(state) {
  const residents = Array.isArray(state.residents) ? state.residents : [];
  residents.forEach((resident) => {
    resident.personIndex = personIndexFromParts(resident.idCard, resident.phone);
    resident.identityIndex = resident.personIndex;
  });
  const residentMap = new Map(residents.map((resident) => [resident.id, resident]));
  ["diseases", "followups", "personalRecords", "careOrders", "medicationPickups", "insuranceClaims", "seniorServices", "dataAccessLogs", "digitalCredentials", "deathCertificates", "birthCertificates", "chronicScreeningTasks", "chronicEducationPushes", "chronicManagementPlans", "countyCollaborationOrders", "countyAiDiagnosisCases", "countyMutualRecognitionRecords", "diagnosticReports"].forEach((key) => {
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

function mergeByKey(defaultRows, currentRows, key) {
  const merged = new Map();
  (Array.isArray(defaultRows) ? defaultRows : []).forEach((item) => merged.set(item[key], item));
  (Array.isArray(currentRows) ? currentRows : []).forEach((item) => {
    if (!item?.[key]) return;
    merged.set(item[key], { ...(merged.get(item[key]) || {}), ...item });
  });
  return [...merged.values()];
}

function sealAuditTrail(rows) {
  const items = (Array.isArray(rows) ? rows : []).map((item) => ({ ...item }));
  let previousHash = "";
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item.previousAuditHash) item.previousAuditHash = previousHash;
    if (!item.auditHash) item.auditHash = auditHashFor(item);
    previousHash = item.auditHash;
  }
  return items;
}

function verifyAuditTrail(rows) {
  const items = Array.isArray(rows) ? rows : [];
  const broken = [];
  let previousHash = "";
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    const expectedHash = auditHashFor({ ...item, previousAuditHash: item.previousAuditHash || previousHash });
    const expectedPreviousHash = previousHash;
    if (item.previousAuditHash !== expectedPreviousHash || item.auditHash !== expectedHash) {
      broken.push({ index, id: item.id || "", expectedPreviousHash, actualPreviousHash: item.previousAuditHash || "", expectedHash, actualHash: item.auditHash || "" });
    }
    previousHash = item.auditHash || expectedHash;
  }
  return {
    passed: broken.length === 0,
    count: items.length,
    broken
  };
}

function auditHashFor(item) {
  const { auditHash, ...payload } = item || {};
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function integrationGatewaySecret() {
  return String(process.env.INTEGRATION_GATEWAY_SECRET || "health-platform-demo-integration-secret");
}

function integrationSignatureFor(payload) {
  return createHmac("sha256", integrationGatewaySecret()).update(stableStringify(payload)).digest("hex");
}

function verifyIntegrationSignature(payload, signature) {
  const expected = Buffer.from(integrationSignatureFor(payload));
  const actual = Buffer.from(String(signature || ""));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function normalizeIntegrationEvent(payload, user, contract) {
  const now = new Date().toISOString();
  return {
    id: `igw-${randomUUID()}`,
    idempotencyKey: String(payload.idempotencyKey || "").trim(),
    externalId: String(payload.externalId || "").trim(),
    contractId: contract.id,
    domain: contract.domain,
    resource: contract.resource,
    residentId: String(payload.residentId || "").trim(),
    status: "accepted",
    receivedAt: now,
    receivedBy: user.username || user.role,
    payload: payload.payload && typeof payload.payload === "object" ? payload.payload : {},
    retryCount: 0,
    deadLetter: false,
    reconciliationStatus: "待对账"
  };
}

function summarizeIntegrationGateway(events = []) {
  const summary = {
    total: events.length,
    byStatus: {},
    byDomain: {},
    deadLetters: 0,
    pendingReconciliation: 0,
    retrying: 0
  };
  events.forEach((event) => {
    summary.byStatus[event.status] = (summary.byStatus[event.status] || 0) + 1;
    summary.byDomain[event.domain] = (summary.byDomain[event.domain] || 0) + 1;
    if (event.deadLetter) summary.deadLetters += 1;
    if (event.status === "retrying") summary.retrying += 1;
    if (event.reconciliationStatus !== "matched") summary.pendingReconciliation += 1;
  });
  return summary;
}

function updateIntegrationEvent(data, eventId, updater) {
  const events = Array.isArray(data.integrationGatewayEvents) ? data.integrationGatewayEvents : [];
  const index = events.findIndex((event) => event.id === eventId);
  if (index < 0) return null;
  const updated = {
    ...events[index],
    ...updater(events[index]),
    updatedAt: new Date().toISOString()
  };
  events[index] = updated;
  data.integrationGatewayEvents = events;
  return updated;
}

function integrationSampleValue(field, contract, sequence) {
  const values = {
    externalId: `${contract.domain}-${String(sequence).padStart(3, "0")}`,
    residentId: "r1",
    institution: "大连市中心医院",
    visitedAt: "2026-06-21T10:00:00.000Z",
    diagnosis: "高血压复诊",
    recordDate: "2026-06-21",
    item: "血糖",
    result: "6.1 mmol/L",
    reportedAt: "2026-06-21T11:00:00.000Z",
    modality: "CT",
    conclusion: "未见急性异常",
    claimStatus: "已结算",
    amount: 128.5,
    certificateNo: `CERT-${String(sequence).padStart(6, "0")}`,
    status: "有效",
    period: "2026-06",
    metrics: { outpatientVisits: 1280, chronicFollowups: 320 }
  };
  return values[field] ?? `${field}-${sequence}`;
}

function buildIntegrationSample(contract, sequence = 1) {
  const payload = {
    contractId: contract.id,
    idempotencyKey: `${contract.id}-sample-${String(sequence).padStart(3, "0")}`,
    externalId: integrationSampleValue("externalId", contract, sequence),
    payload: {}
  };
  (contract.requiredFields || []).forEach((field) => {
    const value = integrationSampleValue(field, contract, sequence);
    payload[field] = value;
    payload.payload[field] = value;
  });
  return {
    contractId: contract.id,
    domain: contract.domain,
    payload,
    signature: integrationSignatureFor(payload)
  };
}

function findMutualRecognitionRule(data, payload) {
  const item = String(payload.item || "").trim().toLowerCase();
  const category = String(payload.category || "").trim().toLowerCase();
  return (data.mutualRecognitionRules || []).find((rule) =>
    rule.status === "active" &&
    String(rule.item || "").trim().toLowerCase() === item &&
    (!category || String(rule.category || "").trim().toLowerCase() === category)
  );
}

function normalizeDiagnosticReport(payload, user, data) {
  const residentId = String(payload.residentId || "").trim();
  const item = String(payload.item || "").trim();
  if (!residentId) throw new Error("residentId is required");
  if (!item) throw new Error("item is required");
  if (!canAccessResident(user, residentId, data)) throw new Error("forbidden resident scope");
  const now = new Date().toISOString();
  const rule = findMutualRecognitionRule(data, payload);
  const recognized = Boolean(rule?.autoRecognize && String(payload.qualityStatus || "passed") === "passed");
  const reportId = `dr-${randomUUID()}`;
  const recognitionId = `cmr-${randomUUID()}`;
  const sourceInstitution = String(payload.sourceInstitution || user.orgName || user.name || "").trim();
  const targetInstitution = String(payload.targetInstitution || "regional-sharing-center").trim();
  const reportedAt = String(payload.reportedAt || now).trim();
  const report = {
    id: reportId,
    externalId: String(payload.externalId || reportId).trim(),
    residentId,
    item,
    category: String(payload.category || rule?.category || "diagnostic").trim(),
    sourceInstitution,
    targetInstitution,
    result: String(payload.result || "").trim(),
    conclusion: String(payload.conclusion || payload.result || "").trim(),
    reportedAt,
    qualityStatus: String(payload.qualityStatus || "passed").trim(),
    status: recognized ? "recognized" : "pending_review",
    ruleId: rule?.id || "",
    recognitionRecordId: recognitionId,
    createdAt: now,
    createdBy: user.username || user.role,
    createdByName: user.name
  };
  const recognition = {
    id: recognitionId,
    residentId,
    item,
    sourceInstitution,
    targetInstitution,
    status: recognized ? "recognized" : "pending_review",
    savedCost: Number(rule?.savedCost || payload.savedCost || 0),
    reason: recognized ? `matched rule ${rule.id}` : (rule ? "requires manual review" : "no matching recognition rule"),
    ruleId: rule?.id || "",
    reportId,
    at: reportedAt,
    qualityStatus: report.qualityStatus,
    nonRecognitionReasons: rule?.nonRecognitionReasons || [],
    createdAt: now,
    createdBy: user.username || user.role
  };
  const personalRecord = {
    id: `pr-${randomUUID()}`,
    residentId,
    category: "diagnostic-report",
    recordDate: reportedAt.slice(0, 10),
    name: item,
    result: report.conclusion || report.result,
    source: sourceInstitution,
    reportId,
    recognitionRecordId: recognitionId,
    createdAt: now,
    createdBy: user.username || user.role,
    createdByName: user.name,
    updatedAt: now,
    updatedBy: user.username || user.role,
    updatedByName: user.name
  };
  return { report, recognition, personalRecord, rule };
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

function authSecrets() {
  const configured = [
    ...(process.env.SESSION_SECRETS || "").split(","),
    process.env.SESSION_SECRET
  ].map((item) => String(item || "").trim()).filter(Boolean);
  return configured.length ? configured : ["health-platform-demo-session-secret"];
}

function signSessionPayload(payload, secret = authSecrets()[0]) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function createSignedSessionToken(sessionId, issuedAt, expiresAt) {
  const payload = `${sessionId}.${issuedAt}.${expiresAt}`;
  return `${payload}.${signSessionPayload(payload)}`;
}

function verifySignedSessionToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 4) return null;
  const [sessionId, issuedAt, expiresAt, signature] = parts;
  const payload = `${sessionId}.${issuedAt}.${expiresAt}`;
  const signatureBuffer = Buffer.from(signature);
  const valid = authSecrets().some((secret) => {
    const expected = Buffer.from(signSessionPayload(payload, secret));
    return expected.length === signatureBuffer.length && timingSafeEqual(expected, signatureBuffer);
  });
  if (!valid) return null;
  return { sessionId, issuedAt, expiresAt };
}

function verifyPassword(user, password) {
  if (!user) return false;
  const rawPassword = String(password || "");
  if (user.passwordHash) return verifyPasswordHash(rawPassword, user.passwordHash);
  if (user.password) return timingSafeTextEqual(rawPassword, String(user.password));
  return timingSafeTextEqual(rawPassword, DEMO_PASSWORD);
}

function verifyPasswordHash(password, passwordHash) {
  const [algorithm, iterationText, salt, expectedHash] = String(passwordHash || "").split("$");
  if (algorithm !== "pbkdf2-sha256" || !salt || !expectedHash) return false;
  const iterations = Number(iterationText || PASSWORD_HASH_ITERATIONS);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;
  const actual = pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("base64url");
  return timingSafeTextEqual(actual, expectedHash);
}

function timingSafeTextEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function findAuthUser(username) {
  const data = readDatabase();
  return data.authUsers.find((user) => user.username === username && user.status !== "停用");
}

function createSession(user) {
  const sessionId = randomUUID();
  const now = Date.now();
  const issuedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + SESSION_TTL_MS).toISOString();
  const token = createSignedSessionToken(sessionId, Buffer.from(issuedAt).toString("base64url"), Buffer.from(expiresAt).toString("base64url"));
  const safeUser = sanitizeUser(user);
  const session = {
    token,
    sessionId,
    user: safeUser,
    issuedAt,
    expiresAt
  };
  sessions.set(sessionId, session);
  return session;
}

function currentSession(req) {
  const auth = String(req.headers.authorization || "");
  const bearer = auth.match(/^Bearer\s+(.+)$/i);
  const token = bearer?.[1] || req.headers["x-auth-token"];
  if (!token) return null;
  const verified = verifySignedSessionToken(token);
  if (!verified) return null;
  const session = sessions.get(verified.sessionId);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    sessions.delete(verified.sessionId);
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
  if (!allowed.includes(session.user.role)) {
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

function canAccessDoctor(user, doctorId) {
  if (!doctorId) return ["commission", "institution"].includes(user.role);
  if (user.role === "commission") return true;
  if (user.role !== "institution") return false;
  if (user.doctorId) return user.doctorId === doctorId;
  return true;
}

function canAccessMultiPracticeApplication(user, item) {
  if (user.role === "commission") return true;
  if (user.role !== "institution") return false;
  if (user.doctorId) return item.doctorId === user.doctorId;
  return [item.primaryInstitutionId, item.targetInstitutionId].includes(user.orgCode) ||
    [item.primaryInstitution, item.targetInstitution].includes(user.orgName);
}

function redactSensitiveResponse(value, user) {
  if (!user || user.role === "commission") return value;
  return redactSensitiveValue(value);
}

function redactSensitiveValue(value, key = "") {
  if (Array.isArray(value)) return value.map((item) => redactSensitiveValue(item));
  if (!value || typeof value !== "object") {
    return SENSITIVE_RESPONSE_FIELDS.has(key) && value !== undefined && value !== null && String(value).trim() !== "" ? maskSensitiveValue(value) : value;
  }
  return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
    entryKey,
    redactSensitiveValue(entryValue, entryKey)
  ]));
}

function maskSensitiveValue(value) {
  const text = String(value || "");
  if (!text) return text;
  const suffix = text.length > 4 ? text.slice(-4) : "";
  return suffix ? `已脱敏-${suffix}` : "已脱敏";
}

function qualificationCompliance(profile, payload) {
  const titleQualified = /(主任|副主任|主治|中级)/.test(profile?.title || payload.title || "");
  const fiveYears = Number(profile?.yearsInSpecialty || payload.yearsInSpecialty || 0) >= 5;
  const assessmentQualified = (profile?.assessmentRecords || []).slice(-2).every((item) => String(item).includes("合格"));
  const categoryMatched = !payload.category || !profile?.category || payload.category === profile.category;
  const scopeMatched = !payload.practiceScope || !profile?.practiceScope ||
    String(payload.practiceScope).includes(String(profile.practiceScope).replace("专业", "")) ||
    String(profile.practiceScope).includes(String(payload.practiceScope).replace("专业", ""));
  const agreementCompleted = ["period", "schedule", "tasks", "responsibility", "compensation", "insurance"].every((key) => String(payload[key] || "").trim());
  return {
    titleQualified,
    fiveYears,
    assessmentQualified,
    categoryMatched,
    scopeMatched,
    agreementCompleted,
    publicHospitalLeaderRestricted: Boolean(payload.publicHospitalLeaderRestricted)
  };
}

function normalizeMultiPracticeApplication(payload, user, data) {
  const doctorId = String(payload.doctorId || user.doctorId || "").trim();
  if (!doctorId) throw new Error("doctorId 不能为空");
  if (!canAccessDoctor(user, doctorId)) throw new Error("无权为该医生登记多点执业");
  const profile = (data.doctorProfiles || []).find((item) => item.id === doctorId);
  if (!profile) throw new Error("未找到医生档案");
  const targetInstitution = String(payload.targetInstitution || "").trim();
  if (!targetInstitution) throw new Error("targetInstitution 不能为空");
  const application = {
    id: payload.id || `mp-${randomUUID()}`,
    doctorId,
    doctorName: profile.name,
    category: payload.category || profile.category,
    title: payload.title || profile.title,
    specialty: payload.specialty || profile.specialty,
    primaryInstitutionId: profile.primaryInstitutionId,
    primaryInstitution: profile.primaryInstitution,
    targetInstitutionId: String(payload.targetInstitutionId || "").trim(),
    targetInstitution,
    targetDepartment: String(payload.targetDepartment || "").trim(),
    practiceScope: String(payload.practiceScope || profile.practiceScope || "").trim(),
    period: String(payload.period || "").trim(),
    schedule: String(payload.schedule || "").trim(),
    tasks: String(payload.tasks || "").trim(),
    responsibility: String(payload.responsibility || "").trim(),
    compensation: String(payload.compensation || "").trim(),
    insurance: String(payload.insurance || "").trim(),
    primaryConsent: String(payload.primaryConsent || "待确认").trim(),
    registrationMode: String(payload.registrationMode || "注册管理").trim(),
    status: String(payload.status || "待第一执业地点确认").trim(),
    publicVisible: payload.publicVisible !== false,
    lastUpdated: new Date().toISOString()
  };
  application.compliance = qualificationCompliance(profile, application);
  return application;
}

function scopeStateForUser(data, user) {
  const scoped = structuredClone(data);
  if (user.role === "commission") return scoped;

  delete scoped.authUsers;
  delete scoped.authOrganizations;
  delete scoped.securityEvents;
  delete scoped.interfaceRequirements;
  delete scoped.integrationGatewayEvents;
  delete scoped.platformCapabilities;
  delete scoped.platformIntegrations;
  delete scoped.platformInterfaces;
  delete scoped.platformDeliveryBatches;
  delete scoped.platformEvidence;
  delete scoped.platformChangeLogs;
  delete scoped.platformRoadmap;
  delete scoped.platformAudit;
  delete scoped.platformProcessAudit;
  delete scoped.applicationCatalog;
  delete scoped.institutionCreditEvaluations;
  delete scoped.securityAcceptanceLedger;

  if (user.role !== "citizen") {
    if (user.role === "institution" && user.doctorId) {
      scoped.doctorProfiles = (data.doctorProfiles || []).filter((item) => item.id === user.doctorId);
      scoped.multiPracticeApplications = (data.multiPracticeApplications || []).filter((item) => item.doctorId === user.doctorId);
    }
    return scoped;
  }

  const account = (data.accounts || []).find((item) => item.id === user.accountId);
  const allowedIds = new Set([
    user.residentId,
    ...(account?.members || []).map((member) => member.residentId)
  ].filter(Boolean));
  const hasAllowedResident = (item) => allowedIds.has(item?.residentId) || allowedIds.has(item?.maternalResidentId);

  scoped.accounts = account ? [account] : [];
  scoped.residents = (data.residents || []).filter((item) => allowedIds.has(item.id));
  ["diseases", "followups", "personalRecords", "careOrders", "medicationPickups", "insuranceClaims", "seniorServices", "dataAccessLogs", "digitalCredentials", "deathCertificates", "birthCertificates", "chronicScreeningTasks", "chronicEducationPushes", "chronicManagementPlans", "countyCollaborationOrders", "countyAiDiagnosisCases", "countyMutualRecognitionRecords", "diagnosticReports"].forEach((key) => {
    scoped[key] = (data[key] || []).filter(hasAllowedResident);
  });
  if (scoped.referralSystem) {
    scoped.referralSystem.referrals = (data.referralSystem?.referrals || []).filter(hasAllowedResident);
    scoped.referralSystem.familyDoctorServices = (data.referralSystem?.familyDoctorServices || []).filter(hasAllowedResident);
  }
  return scoped;
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

function normalizeHealthStatisticsImportJob(payload, user) {
  return {
    id: payload.id || `stat-job-${randomUUID()}`,
    name: String(payload.name || "未命名统计导入任务").trim(),
    source: String(payload.source || "报表导入").trim(),
    period: String(payload.period || "未指定周期").trim(),
    status: String(payload.status || "待解析").trim(),
    quality: String(payload.quality || "待质控").trim(),
    target: String(payload.target || "healthStatistics").trim(),
    nextAction: String(payload.nextAction || "完成字段映射和人工复核。").trim(),
    createdAt: new Date().toISOString(),
    createdBy: user?.username || user?.name || "system"
  };
}

function cleanWorkflowUpdates(updates) {
  return Object.entries(updates && typeof updates === "object" ? updates : {}).reduce((result, [key, value]) => {
    if (WORKFLOW_PROTECTED_FIELDS.has(key)) return result;
    if (["string", "number", "boolean"].includes(typeof value) || value === null) {
      result[key] = value;
    }
    return result;
  }, {});
}

function cleanResidentPatch(patch) {
  return Object.entries(patch && typeof patch === "object" ? patch : {}).reduce((result, [key, value]) => {
    if (RESIDENT_PROTECTED_FIELDS.has(key) || key === "expectedVersion") return result;
    if (["string", "number", "boolean"].includes(typeof value) || value === null || Array.isArray(value) || (value && typeof value === "object")) {
      result[key] = value;
    }
    return result;
  }, {});
}

function cleanBusinessPatch(patch) {
  return Object.entries(patch && typeof patch === "object" ? patch : {}).reduce((result, [key, value]) => {
    if (WORKFLOW_PROTECTED_FIELDS.has(key) || key === "expectedVersion") return result;
    if (["string", "number", "boolean"].includes(typeof value) || value === null || Array.isArray(value) || (value && typeof value === "object")) {
      result[key] = value;
    }
    return result;
  }, {});
}

function cleanMultiPracticePatch(patch) {
  return Object.entries(patch && typeof patch === "object" ? patch : {}).reduce((result, [key, value]) => {
    if (MULTI_PRACTICE_PROTECTED_FIELDS.has(key)) return result;
    if (["string", "number", "boolean"].includes(typeof value) || value === null || Array.isArray(value) || (value && typeof value === "object")) {
      result[key] = value;
    }
    return result;
  }, {});
}

function patchCollectionItem({ data, collection, id, patch, user, action, protectedFields = WORKFLOW_PROTECTED_FIELDS }) {
  const rows = Array.isArray(data[collection]) ? data[collection] : [];
  const index = rows.findIndex((item) => item.id === id);
  if (index < 0) return { status: 404, body: { error: "Not Found", message: "未找到业务记录" } };
  const safePatch = Object.entries(patch && typeof patch === "object" ? patch : {}).reduce((result, [key, value]) => {
    if (protectedFields.has(key) || key === "expectedVersion") return result;
    if (["string", "number", "boolean"].includes(typeof value) || value === null || Array.isArray(value) || (value && typeof value === "object")) {
      result[key] = value;
    }
    return result;
  }, {});
  rows[index] = {
    ...rows[index],
    ...safePatch,
    updatedBy: user.username || user.role,
    updatedByName: user.name,
    lastUpdated: new Date().toISOString()
  };
  data[collection] = rows;
  if (Object.hasOwn(patch, "expectedVersion")) {
    data.storageMeta = {
      ...(data.storageMeta || {}),
      collectionVersions: { [collection]: Number(patch.expectedVersion) }
    };
  }
  data.securityEvents = [
    {
      id: randomUUID(),
      at: new Date().toLocaleString("zh-CN", { hour12: false }),
      actor: user.name,
      role: user.role,
      action,
      target: `${collection}/${id}`,
      result: "允许",
      detail: `集合项更新 ${collection}`
    },
    ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
  ].slice(0, 120);
  writeDatabase(data);
  return { status: 200, body: rows[index] };
}

function patchBusinessCollectionItem({ data, collection, id, patch, user, action }) {
  const rows = Array.isArray(data[collection]) ? data[collection] : [];
  const index = rows.findIndex((item) => item.id === id);
  if (index < 0) return { status: 404, body: { error: "Not Found", message: "未找到业务记录" } };
  if (!canAccessResident(user, rows[index].residentId, data)) {
    appendSecurityEvent({ actor: user.name, role: user.role, action, target: `${collection}/${id}`, result: "拒绝", detail: "超出居民授权范围" });
    return { status: 403, body: { error: "Forbidden", message: "无权更新该居民业务记录" } };
  }
  rows[index] = {
    ...rows[index],
    ...cleanBusinessPatch(patch),
    updatedBy: user.username || user.role,
    updatedByName: user.name,
    lastUpdated: new Date().toISOString()
  };
  data[collection] = rows;
  if (Object.hasOwn(patch, "expectedVersion")) {
    data.storageMeta = {
      ...(data.storageMeta || {}),
      collectionVersions: { [collection]: Number(patch.expectedVersion) }
    };
  }
  data.securityEvents = [
    {
      id: randomUUID(),
      at: new Date().toLocaleString("zh-CN", { hour12: false }),
      actor: user.name,
      role: user.role,
      action,
      target: `${collection}/${id}`,
      result: "允许",
      detail: `业务级更新 ${collection}`
    },
    ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
  ].slice(0, 120);
  writeDatabase(data);
  return { status: 200, body: rows[index] };
}

function findWorkflowCollection(data, collection) {
  if (collection === "referrals") {
    data.referralSystem = data.referralSystem || seedReferralSystem();
    data.referralSystem.referrals = Array.isArray(data.referralSystem.referrals) ? data.referralSystem.referrals : [];
    return data.referralSystem.referrals;
  }
  if (collection === "multiPracticeApplications") {
    data.multiPracticeApplications = Array.isArray(data.multiPracticeApplications) ? data.multiPracticeApplications : seedMultiPracticeApplications();
    return data.multiPracticeApplications;
  }
  return Array.isArray(data[collection]) ? data[collection] : null;
}

function workflowStateCollectionKey(collection) {
  if (collection === "referrals") return "referralSystem";
  return collection;
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && req.url === "/api/health") {
    sendJson(res, 200, { ok: true, storage: storageMeta() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/audit/verify") {
    const user = requireApiRole(req, res, ["commission"], "/api/audit/verify");
    if (!user) return;
    const data = readDatabase();
    const trails = {
      securityEvents: verifyAuditTrail(data.securityEvents),
      dataAccessLogs: verifyAuditTrail(data.dataAccessLogs)
    };
    sendJson(res, 200, {
      passed: Object.values(trails).every((item) => item.passed),
      verifiedAt: new Date().toISOString(),
      trails
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const credentials = await collectJson(req);
    const user = findAuthUser(String(credentials.username || "").trim());
    if (!user || !verifyPassword(user, credentials.password)) {
      appendSecurityEvent({ actor: credentials.username || "unknown", role: "unknown", action: "登录", target: "统一认证", result: "拒绝", detail: "账号或密码错误" });
      sendJson(res, 401, { ok: false, message: "账号或密码不正确" });
      return;
    }
    const session = createSession(user);
    appendSecurityEvent({ actor: user.name, role: user.role, action: "登录", target: user.home, result: "允许", detail: "签名会话已签发，支持密钥轮换校验" });
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
      sessions.delete(session.sessionId);
      appendSecurityEvent({ actor: session.user.name, role: session.user.role, action: "退出登录", target: "统一认证", result: "允许", detail: "后端会话已注销" });
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    const user = requireApiRole(req, res, ["commission", "institution", "insurance", "citizen", "county"], "/api/state");
    if (!user) return;
    sendJson(res, 200, redactSensitiveResponse(scopeStateForUser(readDatabase(), user), user));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/integration/contracts") {
    const user = requireApiRole(req, res, ["commission", "institution", "insurance", "county"], "/api/integration/contracts");
    if (!user) return;
    const data = readDatabase();
    sendJson(res, 200, { contracts: data.integrationContracts });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/integration/samples") {
    const user = requireApiRole(req, res, ["commission", "institution", "insurance", "county"], "/api/integration/samples");
    if (!user) return;
    const data = readDatabase();
    const contractId = url.searchParams.get("contractId");
    const contracts = contractId ? data.integrationContracts.filter((item) => item.id === contractId) : data.integrationContracts;
    if (contractId && contracts.length === 0) {
      sendJson(res, 404, { error: "Not Found", message: "未找到接口契约" });
      return;
    }
    sendJson(res, 200, { samples: contracts.map((contract, index) => buildIntegrationSample(contract, index + 1)) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/integration/events") {
    const user = requireApiRole(req, res, ["commission", "institution", "insurance", "county"], "/api/integration/events");
    if (!user) return;
    const payload = await collectJson(req);
    if (!payload.idempotencyKey) {
      sendJson(res, 400, { error: "Bad Request", message: "集成事件必须提供 idempotencyKey" });
      return;
    }
    if (!verifyIntegrationSignature(payload, req.headers["x-integration-signature"])) {
      appendSecurityEvent({ actor: user.name, role: user.role, action: "集成网关验签", target: payload.contractId || "", result: "拒绝", detail: "签名不匹配" });
      sendJson(res, 401, { error: "Unauthorized", message: "集成事件签名校验失败" });
      return;
    }
    const data = readDatabase();
    const contract = data.integrationContracts.find((item) => item.id === payload.contractId);
    if (!contract) {
      sendJson(res, 400, { error: "Bad Request", message: "未找到接口契约" });
      return;
    }
    const missingFields = (contract.requiredFields || []).filter((field) => payload[field] === undefined && payload.payload?.[field] === undefined);
    if (missingFields.length) {
      sendJson(res, 400, { error: "Bad Request", message: "集成事件缺少必填字段", missingFields });
      return;
    }
    const duplicate = (data.integrationGatewayEvents || []).find((item) => item.idempotencyKey === payload.idempotencyKey);
    if (duplicate) {
      sendJson(res, 200, { ...duplicate, idempotentReplay: true });
      return;
    }
    const event = normalizeIntegrationEvent(payload, user, contract);
    data.integrationGatewayEvents = [event, ...(Array.isArray(data.integrationGatewayEvents) ? data.integrationGatewayEvents : [])].slice(0, 200);
    data.securityEvents = [
      {
        id: randomUUID(),
        at: new Date().toLocaleString("zh-CN", { hour12: false }),
        actor: user.name,
        role: user.role,
        action: "接收集成事件",
        target: `${contract.domain}/${payload.externalId}`,
        result: "允许",
        detail: `${contract.id} · ${event.idempotencyKey}`
      },
      ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
    ].slice(0, 120);
    writeDatabase(data);
    sendJson(res, 202, event);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/integration/simulate") {
    const user = requireApiRole(req, res, ["commission"], "/api/integration/simulate");
    if (!user) return;
    const payload = await collectJson(req);
    const data = readDatabase();
    const contract = data.integrationContracts.find((item) => item.id === payload.contractId);
    if (!contract) {
      sendJson(res, 404, { error: "Not Found", message: "未找到接口契约" });
      return;
    }
    const sample = buildIntegrationSample(contract, Number(payload.sequence || 1));
    const duplicate = (data.integrationGatewayEvents || []).find((item) => item.idempotencyKey === sample.payload.idempotencyKey);
    if (duplicate) {
      sendJson(res, 200, { sample, event: { ...duplicate, idempotentReplay: true } });
      return;
    }
    const event = {
      ...normalizeIntegrationEvent(sample.payload, user, contract),
      simulated: true,
      simulatorSignature: sample.signature
    };
    data.integrationGatewayEvents = [event, ...(Array.isArray(data.integrationGatewayEvents) ? data.integrationGatewayEvents : [])].slice(0, 200);
    data.securityEvents = [
      {
        id: randomUUID(),
        at: new Date().toLocaleString("zh-CN", { hour12: false }),
        actor: user.name,
        role: user.role,
        action: "模拟集成网关联调",
        target: `${contract.domain}/${sample.payload.externalId}`,
        result: "允许",
        detail: `${contract.id} · ${sample.payload.idempotencyKey}`
      },
      ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
    ].slice(0, 120);
    writeDatabase(data);
    sendJson(res, 202, { sample, event });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/integration/monitor") {
    const user = requireApiRole(req, res, ["commission"], "/api/integration/monitor");
    if (!user) return;
    const data = readDatabase();
    const events = Array.isArray(data.integrationGatewayEvents) ? data.integrationGatewayEvents : [];
    sendJson(res, 200, {
      summary: summarizeIntegrationGateway(events),
      recentEvents: events.slice(0, 30)
    });
    return;
  }

  const integrationRetryMatch = url.pathname.match(/^\/api\/integration\/events\/([^/]+)\/retry$/);
  if (req.method === "POST" && integrationRetryMatch) {
    const user = requireApiRole(req, res, ["commission"], "/api/integration/events/:id/retry");
    if (!user) return;
    const data = readDatabase();
    const event = updateIntegrationEvent(data, integrationRetryMatch[1], (current) => ({
      status: "retrying",
      retryCount: Number(current.retryCount || 0) + 1,
      deadLetter: false,
      deadLetterReason: "",
      lastRetriedAt: new Date().toISOString(),
      reconciliationStatus: "retrying"
    }));
    if (!event) {
      sendJson(res, 404, { error: "Not Found", message: "未找到集成网关事件" });
      return;
    }
    data.securityEvents = [
      {
        id: randomUUID(),
        at: new Date().toLocaleString("zh-CN", { hour12: false }),
        actor: user.name,
        role: user.role,
        action: "重试集成网关事件",
        target: event.id,
        result: "允许",
        detail: `${event.contractId} · ${event.idempotencyKey} · retry=${event.retryCount}`
      },
      ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
    ].slice(0, 120);
    writeDatabase(data);
    sendJson(res, 200, event);
    return;
  }

  const integrationDeadLetterMatch = url.pathname.match(/^\/api\/integration\/events\/([^/]+)\/dead-letter$/);
  if (req.method === "POST" && integrationDeadLetterMatch) {
    const user = requireApiRole(req, res, ["commission"], "/api/integration/events/:id/dead-letter");
    if (!user) return;
    const payload = await collectJson(req);
    const data = readDatabase();
    const event = updateIntegrationEvent(data, integrationDeadLetterMatch[1], () => ({
      status: "failed",
      deadLetter: true,
      deadLetterReason: String(payload.reason || "manual-compensation-required").slice(0, 200),
      failedAt: new Date().toISOString(),
      reconciliationStatus: "dead-letter"
    }));
    if (!event) {
      sendJson(res, 404, { error: "Not Found", message: "未找到集成网关事件" });
      return;
    }
    data.securityEvents = [
      {
        id: randomUUID(),
        at: new Date().toLocaleString("zh-CN", { hour12: false }),
        actor: user.name,
        role: user.role,
        action: "标记集成网关死信",
        target: event.id,
        result: "允许",
        detail: `${event.contractId} · ${event.idempotencyKey} · ${event.deadLetterReason}`
      },
      ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
    ].slice(0, 120);
    writeDatabase(data);
    sendJson(res, 200, event);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/mutual-recognition/rules") {
    const user = requireApiRole(req, res, ["commission", "institution", "county"], "/api/mutual-recognition/rules");
    if (!user) return;
    const data = readDatabase();
    sendJson(res, 200, { rules: data.mutualRecognitionRules || [] });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/mutual-recognition/reports") {
    const user = requireApiRole(req, res, ["commission", "institution", "county"], "/api/mutual-recognition/reports");
    if (!user) return;
    const data = readDatabase();
    const payload = await collectJson(req);
    let normalized;
    try {
      normalized = normalizeDiagnosticReport(payload, user, data);
    } catch (error) {
      if (error.message === "forbidden resident scope") {
        appendSecurityEvent({ actor: user.name, role: user.role, action: "submit diagnostic report", target: payload.residentId || "", result: "denied", detail: "resident scope denied" });
        sendJson(res, 403, { error: "Forbidden", message: "无权回传该居民报告" });
        return;
      }
      sendJson(res, 400, { error: "Bad Request", message: error.message });
      return;
    }
    data.diagnosticReports = [normalized.report, ...(Array.isArray(data.diagnosticReports) ? data.diagnosticReports : [])].slice(0, 300);
    data.countyMutualRecognitionRecords = [normalized.recognition, ...(Array.isArray(data.countyMutualRecognitionRecords) ? data.countyMutualRecognitionRecords : [])].slice(0, 300);
    data.personalRecords = [normalized.personalRecord, ...(Array.isArray(data.personalRecords) ? data.personalRecords : [])].slice(0, 500);
    data.securityEvents = [
      {
        id: randomUUID(),
        at: new Date().toLocaleString("zh-CN", { hour12: false }),
        actor: user.name,
        role: user.role,
        action: "submit diagnostic report",
        target: `${normalized.report.residentId}/${normalized.report.item}`,
        result: "allowed",
        detail: `${normalized.report.status} · ${normalized.report.ruleId || "no-rule"}`
      },
      ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
    ].slice(0, 120);
    writeDatabase(data);
    sendJson(res, 201, normalized);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/doctors/me") {
    const user = requireApiRole(req, res, ["institution"], "/api/doctors/me");
    if (!user) return;
    const data = readDatabase();
    const doctor = (data.doctorProfiles || []).find((item) => item.id === user.doctorId || item.username === user.username);
    if (!doctor) {
      sendJson(res, 404, { error: "Not Found", message: "当前账户未绑定医生档案" });
      return;
    }
    sendJson(res, 200, {
      doctor,
      multiPracticeApplications: (data.multiPracticeApplications || []).filter((item) => item.doctorId === doctor.id),
      policy: data.multiPracticePolicy
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/multi-practice-applications") {
    const user = requireApiRole(req, res, ["institution", "commission"], "/api/multi-practice-applications");
    if (!user) return;
    const data = readDatabase();
    const applications = (data.multiPracticeApplications || []).filter((item) => canAccessMultiPracticeApplication(user, item));
    sendJson(res, 200, { applications, policy: data.multiPracticePolicy });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/multi-practice-applications") {
    const user = requireApiRole(req, res, ["institution", "commission"], "/api/multi-practice-applications");
    if (!user) return;
    const data = readDatabase();
    let application;
    try {
      application = normalizeMultiPracticeApplication(await collectJson(req), user, data);
    } catch (error) {
      sendJson(res, 400, { error: "Bad Request", message: error.message });
      return;
    }
    data.multiPracticeApplications = [application, ...(Array.isArray(data.multiPracticeApplications) ? data.multiPracticeApplications : [])].slice(0, 200);
    data.securityEvents = [
      {
        id: randomUUID(),
        at: new Date().toLocaleString("zh-CN", { hour12: false }),
        actor: user.name,
        role: user.role,
        action: "登记多点执业申请",
        target: application.id,
        result: "允许",
        detail: `${application.doctorName} · ${application.primaryInstitution} -> ${application.targetInstitution} · ${application.status}`
      },
      ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
    ].slice(0, 120);
    writeDatabase(data);
    sendJson(res, 201, application);
    return;
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/multi-practice-applications/")) {
    const user = requireApiRole(req, res, ["institution", "commission"], "/api/multi-practice-applications/:id");
    if (!user) return;
    const id = decodeURIComponent(url.pathname.replace("/api/multi-practice-applications/", ""));
    const patch = await collectJson(req);
    const data = readDatabase();
    const index = data.multiPracticeApplications.findIndex((item) => item.id === id);
    if (index < 0) {
      sendJson(res, 404, { error: "Not Found", message: "未找到多点执业申请" });
      return;
    }
    if (!canAccessMultiPracticeApplication(user, data.multiPracticeApplications[index])) {
      appendSecurityEvent({ actor: user.name, role: user.role, action: "更新多点执业申请", target: id, result: "拒绝", detail: "超出医生或机构授权范围" });
      sendJson(res, 403, { error: "Forbidden", message: "无权更新该多点执业申请" });
      return;
    }
    data.multiPracticeApplications[index] = {
      ...data.multiPracticeApplications[index],
      ...cleanMultiPracticePatch(patch),
      updatedBy: user.username || user.role,
      updatedByName: user.name,
      lastUpdated: new Date().toISOString()
    };
    if (Object.hasOwn(patch, "expectedVersion")) {
      data.storageMeta = {
        ...(data.storageMeta || {}),
        collectionVersions: { multiPracticeApplications: Number(patch.expectedVersion) }
      };
    }
    data.securityEvents = [
      {
        id: randomUUID(),
        at: new Date().toLocaleString("zh-CN", { hour12: false }),
        actor: user.name,
        role: user.role,
        action: "更新多点执业申请",
        target: id,
        result: "允许",
        detail: `状态更新为 ${data.multiPracticeApplications[index].status || "已更新"}`
      },
      ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
    ].slice(0, 120);
    writeDatabase(data);
    sendJson(res, 200, data.multiPracticeApplications[index]);
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/state") {
    const user = requireApiRole(req, res, ["commission"], "/api/state");
    if (!user) return;
    const payload = await collectJson(req);
    const data = normalizeState(payload);
    data.storageMeta = payload.storageMeta;
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

  if (req.method === "PUT" && url.pathname.startsWith("/api/state-collections/")) {
    const user = requireApiRole(req, res, ["commission"], "/api/state-collections/:collection");
    if (!user) return;
    const collection = decodeURIComponent(url.pathname.replace("/api/state-collections/", "")).trim();
    if (!COLLECTION_WRITE_KEYS.has(collection)) {
      sendJson(res, 400, { error: "Bad Request", message: "不支持集合级保存该数据集合" });
      return;
    }
    const payload = await collectJson(req);
    const value = Array.isArray(payload.value) ? payload.value : payload[collection];
    if (!Array.isArray(value)) {
      sendJson(res, 400, { error: "Bad Request", message: "集合级保存必须提交数组 value" });
      return;
    }
    const data = readDatabase();
    data[collection] = value;
    data.storageMeta = {
      ...(data.storageMeta || {}),
      collectionVersions: Object.hasOwn(payload, "expectedVersion") ? { [collection]: Number(payload.expectedVersion) } : {}
    };
    data.securityEvents = [
      {
        id: randomUUID(),
        at: new Date().toLocaleString("zh-CN", { hour12: false }),
        actor: user.name,
        role: user.role,
        action: "集合级保存数据",
        target: collection,
        result: "允许",
        detail: `保存 ${collection}，记录数 ${value.length}`
      },
      ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
    ].slice(0, 120);
    writeDatabase(data);
    const versions = storageMeta().collectionVersions;
    sendJson(res, 200, { ok: true, collection, version: versions[collection] ?? null, count: value.length });
    return;
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/residents/")) {
    const user = requireApiRole(req, res, ["commission", "institution"], "/api/residents/:id");
    if (!user) return;
    const residentId = decodeURIComponent(url.pathname.replace("/api/residents/", "")).trim();
    const patch = await collectJson(req);
    const data = readDatabase();
    const index = data.residents.findIndex((item) => item.id === residentId);
    if (index < 0) {
      sendJson(res, 404, { error: "Not Found", message: "未找到居民" });
      return;
    }
    if (!canAccessResident(user, residentId, data)) {
      appendSecurityEvent({ actor: user.name, role: user.role, action: "更新居民档案", target: residentId, result: "拒绝", detail: "超出居民授权范围" });
      sendJson(res, 403, { error: "Forbidden", message: "无权更新该居民档案" });
      return;
    }
    data.residents[index] = {
      ...data.residents[index],
      ...cleanResidentPatch(patch),
      updatedBy: user.username || user.role,
      updatedByName: user.name,
      updatedAt: new Date().toISOString()
    };
    data.storageMeta = {
      ...(data.storageMeta || {}),
      collectionVersions: Object.hasOwn(patch, "expectedVersion") ? { residents: Number(patch.expectedVersion) } : {}
    };
    appendDataAccessLog(data, user, residentId, "居民主索引与健康档案", "更新居民基础档案");
    writeDatabase(data);
    sendJson(res, 200, data.residents[index]);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/health-statistics/import-jobs") {
    const user = requireApiRole(req, res, ["commission"], "/api/health-statistics/import-jobs");
    if (!user) return;
    const data = readDatabase();
    const job = normalizeHealthStatisticsImportJob(await collectJson(req), user);
    data.healthStatisticsIngestion = data.healthStatisticsIngestion || seedHealthStatisticsIngestion();
    data.healthStatisticsIngestion.jobs = [
      job,
      ...(Array.isArray(data.healthStatisticsIngestion.jobs) ? data.healthStatisticsIngestion.jobs : [])
    ].slice(0, 80);
    data.securityEvents = [
      {
        id: randomUUID(),
        at: new Date().toLocaleString("zh-CN", { hour12: false }),
        actor: user.name,
        role: user.role,
        action: "登记统计导入任务",
        target: job.target,
        result: "允许",
        detail: `${job.source} · ${job.period} · ${job.name}`
      },
      ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
    ].slice(0, 120);
    writeDatabase(data);
    sendJson(res, 201, job);
    return;
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/insurance-claims/")) {
    const user = requireApiRole(req, res, ["insurance", "commission"], "/api/insurance-claims/:id");
    if (!user) return;
    const result = patchBusinessCollectionItem({
      data: readDatabase(),
      collection: "insuranceClaims",
      id: decodeURIComponent(url.pathname.replace("/api/insurance-claims/", "")),
      patch: await collectJson(req),
      user,
      action: "更新医保理赔"
    });
    sendJson(res, result.status, result.body);
    return;
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/medication-pickups/")) {
    const user = requireApiRole(req, res, ["institution", "insurance", "commission"], "/api/medication-pickups/:id");
    if (!user) return;
    const result = patchBusinessCollectionItem({
      data: readDatabase(),
      collection: "medicationPickups",
      id: decodeURIComponent(url.pathname.replace("/api/medication-pickups/", "")),
      patch: await collectJson(req),
      user,
      action: "更新固定取药"
    });
    sendJson(res, result.status, result.body);
    return;
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/chronic-management-plans/")) {
    const user = requireApiRole(req, res, ["institution", "commission"], "/api/chronic-management-plans/:id");
    if (!user) return;
    const result = patchBusinessCollectionItem({
      data: readDatabase(),
      collection: "chronicManagementPlans",
      id: decodeURIComponent(url.pathname.replace("/api/chronic-management-plans/", "")),
      patch: await collectJson(req),
      user,
      action: "更新慢病管理计划"
    });
    sendJson(res, result.status, result.body);
    return;
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/care-orders/")) {
    const user = requireApiRole(req, res, ["institution", "commission"], "/api/care-orders/:id");
    if (!user) return;
    const result = patchBusinessCollectionItem({
      data: readDatabase(),
      collection: "careOrders",
      id: decodeURIComponent(url.pathname.replace("/api/care-orders/", "")),
      patch: await collectJson(req),
      user,
      action: "更新诊疗工单"
    });
    sendJson(res, result.status, result.body);
    return;
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/emergency-signals/")) {
    const user = requireApiRole(req, res, ["commission"], "/api/emergency-signals/:id");
    if (!user) return;
    const result = patchCollectionItem({
      data: readDatabase(),
      collection: "emergencySignals",
      id: decodeURIComponent(url.pathname.replace("/api/emergency-signals/", "")),
      patch: await collectJson(req),
      user,
      action: "更新公卫预警"
    });
    sendJson(res, result.status, result.body);
    return;
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/followups/")) {
    const user = requireApiRole(req, res, ["institution", "commission"], "/api/followups/:id");
    if (!user) return;
    const result = patchBusinessCollectionItem({
      data: readDatabase(),
      collection: "followups",
      id: decodeURIComponent(url.pathname.replace("/api/followups/", "")),
      patch: await collectJson(req),
      user,
      action: "更新随访记录"
    });
    sendJson(res, result.status, result.body);
    return;
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/chronic-screening-tasks/")) {
    const user = requireApiRole(req, res, ["institution", "commission"], "/api/chronic-screening-tasks/:id");
    if (!user) return;
    const result = patchBusinessCollectionItem({
      data: readDatabase(),
      collection: "chronicScreeningTasks",
      id: decodeURIComponent(url.pathname.replace("/api/chronic-screening-tasks/", "")),
      patch: await collectJson(req),
      user,
      action: "更新慢病筛查任务"
    });
    sendJson(res, result.status, result.body);
    return;
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/chronic-education-pushes/")) {
    const user = requireApiRole(req, res, ["institution", "commission"], "/api/chronic-education-pushes/:id");
    if (!user) return;
    const result = patchBusinessCollectionItem({
      data: readDatabase(),
      collection: "chronicEducationPushes",
      id: decodeURIComponent(url.pathname.replace("/api/chronic-education-pushes/", "")),
      patch: await collectJson(req),
      user,
      action: "更新慢病宣教推送"
    });
    sendJson(res, result.status, result.body);
    return;
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/digital-credentials/")) {
    const user = requireApiRole(req, res, ["insurance", "commission"], "/api/digital-credentials/:id");
    if (!user) return;
    const result = patchBusinessCollectionItem({
      data: readDatabase(),
      collection: "digitalCredentials",
      id: decodeURIComponent(url.pathname.replace("/api/digital-credentials/", "")),
      patch: await collectJson(req),
      user,
      action: "更新数字健康凭证"
    });
    sendJson(res, result.status, result.body);
    return;
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/county-collaboration-orders/")) {
    const user = requireApiRole(req, res, ["county", "commission"], "/api/county-collaboration-orders/:id");
    if (!user) return;
    const result = patchBusinessCollectionItem({
      data: readDatabase(),
      collection: "countyCollaborationOrders",
      id: decodeURIComponent(url.pathname.replace("/api/county-collaboration-orders/", "")),
      patch: await collectJson(req),
      user,
      action: "更新县域协同工单"
    });
    sendJson(res, result.status, result.body);
    return;
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/county-ai-diagnosis-cases/")) {
    const user = requireApiRole(req, res, ["county", "commission"], "/api/county-ai-diagnosis-cases/:id");
    if (!user) return;
    const result = patchBusinessCollectionItem({
      data: readDatabase(),
      collection: "countyAiDiagnosisCases",
      id: decodeURIComponent(url.pathname.replace("/api/county-ai-diagnosis-cases/", "")),
      patch: await collectJson(req),
      user,
      action: "更新县域 AI 诊断"
    });
    sendJson(res, result.status, result.body);
    return;
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/county-mutual-recognition-records/")) {
    const user = requireApiRole(req, res, ["county", "commission"], "/api/county-mutual-recognition-records/:id");
    if (!user) return;
    const result = patchBusinessCollectionItem({
      data: readDatabase(),
      collection: "countyMutualRecognitionRecords",
      id: decodeURIComponent(url.pathname.replace("/api/county-mutual-recognition-records/", "")),
      patch: await collectJson(req),
      user,
      action: "更新县域检查互认"
    });
    sendJson(res, result.status, result.body);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/birth-certificates") {
    const user = requireApiRole(req, res, ["institution", "commission", "citizen"], "/api/birth-certificates");
    if (!user) return;
    const data = readDatabase();
    const residentId = url.searchParams.get("residentId");
    if (!canAccessResident(user, residentId, data)) {
      appendSecurityEvent({ actor: user.name, role: user.role, action: "访问出生医学证明", target: residentId || "all", result: "拒绝", detail: "超出居民授权范围" });
      sendJson(res, 403, { error: "Forbidden", message: "无权访问该居民出生医学证明" });
      return;
    }
    const certificates = (data.birthCertificates || []).filter((item) => !residentId || item.maternalResidentId === residentId || item.residentId === residentId);
    sendJson(res, 200, redactSensitiveResponse({ certificates, statistics: data.birthStatistics, forms: data.birthCertificateForms }, user));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/birth-certificates") {
    const user = requireApiRole(req, res, ["institution", "commission"], "/api/birth-certificates");
    if (!user) return;
    const data = readDatabase();
    const payload = await collectJson(req);
    let certificate;
    try {
      certificate = normalizeBirthCertificate(payload, user, data);
    } catch (error) {
      sendJson(res, 400, { error: "Bad Request", message: error.message });
      return;
    }
    if (!canAccessResident(user, certificate.maternalResidentId, data)) {
      appendSecurityEvent({ actor: user.name, role: user.role, action: "登记出生医学证明", target: certificate.maternalResidentId, result: "拒绝", detail: "超出居民授权范围" });
      sendJson(res, 403, { error: "Forbidden", message: "无权登记该居民出生医学证明" });
      return;
    }
    data.birthCertificates = [certificate, ...(Array.isArray(data.birthCertificates) ? data.birthCertificates : [])].slice(0, 200);
    refreshBirthStatistics(data);
    data.securityEvents = [
      {
        id: randomUUID(),
        at: new Date().toLocaleString("zh-CN", { hour12: false }),
        actor: user.name,
        role: user.role,
        action: "登记出生医学证明",
        target: certificate.certificateNo,
        result: "允许",
        detail: `${certificate.newbornName} · ${certificate.issueType} · ${certificate.issuingInstitution}`
      },
      ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
    ].slice(0, 120);
    const normalized = normalizeState(data);
    if (Object.hasOwn(payload, "expectedVersion")) {
      normalized.storageMeta = {
        collectionVersions: { birthCertificates: Number(payload.expectedVersion) }
      };
    }
    writeDatabase(normalized);
    sendJson(res, 201, certificate);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/death-certificates") {
    const user = requireApiRole(req, res, ["institution", "commission"], "/api/death-certificates");
    if (!user) return;
    const data = readDatabase();
    const residentId = url.searchParams.get("residentId");
    if (!canAccessResident(user, residentId, data)) {
      appendSecurityEvent({ actor: user.name, role: user.role, action: "访问死亡医学证明", target: residentId || "all", result: "拒绝", detail: "超出居民授权范围" });
      sendJson(res, 403, { error: "Forbidden", message: "无权访问该居民死亡证明" });
      return;
    }
    const certificates = (data.deathCertificates || []).filter((item) => !residentId || item.residentId === residentId);
    sendJson(res, 200, redactSensitiveResponse({ certificates, statistics: data.deathStatistics, forms: data.deathCertificateForms }, user));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/death-certificates") {
    const user = requireApiRole(req, res, ["institution", "commission"], "/api/death-certificates");
    if (!user) return;
    const data = readDatabase();
    const payload = await collectJson(req);
    let certificate;
    try {
      certificate = normalizeDeathCertificate(payload, user, data);
    } catch (error) {
      sendJson(res, 400, { error: "Bad Request", message: error.message });
      return;
    }
    if (!canAccessResident(user, certificate.residentId, data)) {
      appendSecurityEvent({ actor: user.name, role: user.role, action: "登记死亡医学证明", target: certificate.residentId, result: "拒绝", detail: "超出居民授权范围" });
      sendJson(res, 403, { error: "Forbidden", message: "无权登记该居民死亡证明" });
      return;
    }
    data.deathCertificates = [certificate, ...(Array.isArray(data.deathCertificates) ? data.deathCertificates : [])].slice(0, 200);
    refreshDeathStatistics(data);
    data.securityEvents = [
      {
        id: randomUUID(),
        at: new Date().toLocaleString("zh-CN", { hour12: false }),
        actor: user.name,
        role: user.role,
        action: "登记死亡医学证明",
        target: certificate.certificateNo,
        result: "允许",
        detail: `${certificate.deceasedName} · ${certificate.deathReasonType} · ${certificate.reportChannel}`
      },
      ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
    ].slice(0, 120);
    const normalized = normalizeState(data);
    if (Object.hasOwn(payload, "expectedVersion")) {
      normalized.storageMeta = {
        collectionVersions: { deathCertificates: Number(payload.expectedVersion) }
      };
    }
    writeDatabase(normalized);
    sendJson(res, 201, certificate);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/workflow-actions") {
    const user = requireApiRole(req, res, ["institution", "insurance", "county", "commission"], "/api/workflow-actions");
    if (!user) return;
    const payload = await collectJson(req);
    const collection = String(payload.collection || "").trim();
    if (!WORKFLOW_COLLECTIONS.has(collection)) {
      sendJson(res, 400, { error: "Bad Request", message: "不支持的业务集合" });
      return;
    }
    if (!WORKFLOW_ROLE_COLLECTIONS[user.role]?.has(collection)) {
      appendSecurityEvent({ actor: user.name, role: user.role, action: "更新业务闭环", target: collection, result: "拒绝", detail: "角色无权更新该业务集合" });
      sendJson(res, 403, { error: "Forbidden", message: "当前角色无权更新该业务集合" });
      return;
    }
    const data = readDatabase();
    const rows = findWorkflowCollection(data, collection);
    const item = rows?.find((row) => row.id === payload.id);
    if (!item) {
      sendJson(res, 404, { error: "Not Found", message: "未找到业务记录" });
      return;
    }
    if (collection === "multiPracticeApplications" && !canAccessMultiPracticeApplication(user, item)) {
      appendSecurityEvent({ actor: user.name, role: user.role, action: "更新多点执业", target: `${collection}/${payload.id}`, result: "拒绝", detail: "超出医生或机构授权范围" });
      sendJson(res, 403, { error: "Forbidden", message: "无权更新该多点执业记录" });
      return;
    }
    if (!canAccessResident(user, item.residentId, data)) {
      appendSecurityEvent({ actor: user.name, role: user.role, action: "更新业务闭环", target: `${collection}/${payload.id}`, result: "拒绝", detail: "超出居民授权范围" });
      sendJson(res, 403, { error: "Forbidden", message: "无权更新该居民业务记录" });
      return;
    }
    Object.assign(item, cleanWorkflowUpdates(payload.updates));
    if (payload.status) item.status = String(payload.status);
    item.lastUpdated = new Date().toISOString();
    data.securityEvents = [
      {
        id: randomUUID(),
        at: new Date().toLocaleString("zh-CN", { hour12: false }),
        actor: user.name,
        role: user.role,
        action: "更新业务闭环",
        target: `${collection}/${item.id}`,
        result: "允许",
        detail: payload.note || `状态更新为 ${item.status || "已更新"}`
      },
      ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
    ].slice(0, 120);
    if (Object.hasOwn(payload, "expectedVersion")) {
      data.storageMeta = {
        ...(data.storageMeta || {}),
        collectionVersions: { [workflowStateCollectionKey(collection)]: Number(payload.expectedVersion) }
      };
    }
    writeDatabase(data);
    sendJson(res, 200, item);
    return;
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/authorizations/") && url.pathname.endsWith("/revoke")) {
    const user = requireApiRole(req, res, ["citizen", "commission"], "/api/authorizations/:id/revoke");
    if (!user) return;
    const id = decodeURIComponent(url.pathname.replace("/api/authorizations/", "").replace("/revoke", ""));
    const payload = await collectJson(req);
    const data = readDatabase();
    const index = data.personalRecords.findIndex((item) => item.id === id && item.category === "authorizations");
    if (index < 0) {
      sendJson(res, 404, { error: "Not Found", message: "未找到授权记录" });
      return;
    }
    const authorization = data.personalRecords[index];
    if (!canAccessResident(user, authorization.residentId, data)) {
      appendSecurityEvent({ actor: user.name, role: user.role, action: "撤销居民授权", target: id, result: "拒绝", detail: "超出居民授权范围" });
      sendJson(res, 403, { error: "Forbidden", message: "无权撤销该居民授权" });
      return;
    }
    data.personalRecords[index] = {
      ...authorization,
      result: `已撤销：${authorization.result}`,
      status: "已撤销",
      revokedAt: new Date().toISOString(),
      revokedBy: user.username || user.role,
      revokedByName: user.name,
      revokeReason: String(payload.reason || "居民撤销授权").trim(),
      updatedAt: new Date().toISOString()
    };
    data.securityEvents = [
      {
        id: randomUUID(),
        at: new Date().toLocaleString("zh-CN", { hour12: false }),
        actor: user.name,
        role: user.role,
        action: "撤销居民授权",
        target: id,
        result: "允许",
        detail: data.personalRecords[index].revokeReason
      },
      ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
    ].slice(0, 120);
    if (Object.hasOwn(payload, "expectedVersion")) {
      data.storageMeta = {
        ...(data.storageMeta || {}),
        collectionVersions: { personalRecords: Number(payload.expectedVersion) }
      };
    }
    appendDataAccessLog(data, user, authorization.residentId, "授权撤销", data.personalRecords[index].revokeReason, "允许");
    writeDatabase(data);
    sendJson(res, 200, redactSensitiveResponse(data.personalRecords[index], user));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/access-reviews") {
    const user = requireApiRole(req, res, ["citizen", "commission"], "/api/access-reviews");
    if (!user) return;
    const residentId = url.searchParams.get("residentId");
    const data = readDatabase();
    if (!canAccessResident(user, residentId, data)) {
      appendSecurityEvent({ actor: user.name, role: user.role, action: "复核居民访问历史", target: residentId || "all", result: "拒绝", detail: "超出居民授权范围" });
      sendJson(res, 403, { error: "Forbidden", message: "无权复核该居民访问历史" });
      return;
    }
    const authorizations = (data.personalRecords || []).filter((item) => item.residentId === residentId && item.category === "authorizations");
    const accessLogs = (data.dataAccessLogs || []).filter((item) => item.residentId === residentId);
    appendDataAccessLog(data, user, residentId, "授权与访问历史", "复核居民授权与访问记录");
    writeDatabase(data);
    sendJson(res, 200, redactSensitiveResponse({ residentId, authorizations, accessLogs }, user));
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
    sendJson(res, 200, redactSensitiveResponse(records, user));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/personal-records") {
    const user = requireApiRole(req, res, ["citizen", "institution", "commission"], "/api/personal-records");
    if (!user) return;
    const data = readDatabase();
    const payload = await collectJson(req);
    const recordData = normalizePersonalRecord(payload);
    if (!canAccessResident(user, recordData.residentId, data)) {
      appendSecurityEvent({ actor: user.name, role: user.role, action: "新增个人健康信息", target: recordData.residentId, result: "拒绝", detail: "超出居民授权范围" });
      sendJson(res, 403, { error: "Forbidden", message: "无权新增该居民健康信息" });
      return;
    }
    const residentMap = new Map(data.residents.map((resident) => [resident.id, resident]));
    recordData.id = randomUUID();
    recordData.personIndex = recordData.personIndex || personIndexForResident(residentMap, recordData.residentId);
    recordData.createdBy = user.username || user.role;
    recordData.createdByName = user.name;
    data.personalRecords.push(recordData);
    if (Object.hasOwn(payload, "expectedVersion")) {
      data.storageMeta = {
        ...(data.storageMeta || {}),
        collectionVersions: { personalRecords: Number(payload.expectedVersion) }
      };
    }
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
    const safePatch = Object.fromEntries(Object.entries(patch).filter(([key]) => !PERSONAL_RECORD_PROTECTED_FIELDS.has(key)));
    data.personalRecords[index] = {
      ...data.personalRecords[index],
      ...safePatch,
      meta: {
        ...(data.personalRecords[index].meta || {}),
        ...(safePatch.meta && typeof safePatch.meta === "object" ? safePatch.meta : {})
      },
      updatedBy: user.username || user.role,
      updatedByName: user.name,
      updatedAt: new Date().toISOString()
    };
    appendDataAccessLog(data, user, data.personalRecords[index].residentId, "个人健康信息库", `更新 ${data.personalRecords[index].category} 记录`);
    if (Object.hasOwn(patch, "expectedVersion")) {
      data.storageMeta = {
        ...(data.storageMeta || {}),
        collectionVersions: { personalRecords: Number(patch.expectedVersion) }
      };
    }
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
    if (isStorageConflict(error)) {
      sendStorageConflict(res, error);
      return;
    }
    sendJson(res, 500, { error: error.message });
  }
});

function startServer(port = PORT) {
  return server.listen(port, () => {
    ensureDatabase();
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    console.log(`慢病医防融合管理平台已启动：http://localhost:${actualPort}`);
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (!server.listening) return resolve();
    server.close(resolve);
  });
}

if (require.main === module) {
  startServer();
  const shutdown = async () => {
    await stopServer();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

module.exports = { ensureDatabase, openSqliteDatabase, readDatabase, server, startServer, stopServer, storageMeta, writeDatabase };
