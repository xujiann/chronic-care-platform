(function(root,factory){const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;root.BloodDomain=api;})(typeof globalThis!=="undefined"?globalThis:this,function(){
  const standards=[
    {id:"PLAN-IT",source:"全国血站服务体系建设发展规划",clause:"信息化建设",domain:"区域协同",requirement:"覆盖国家、区域、省、血站和用血医疗机构，汇聚献血、库存、调配和检测信息",level:"应",evidence:"双角色工作台与区域库存"},
    {id:"PLAN-RISK",source:"全国血站服务体系建设发展规划",clause:"风险预警",domain:"风险管理",requirement:"建立血液安全监测和风险预警机制",level:"应",evidence:"库存、温控、检测异常预警"},
    {id:"PLAN-EMG",source:"全国血站服务体系建设发展规划",clause:"应急保障",domain:"应急调配",requirement:"开展应急检测、储备、供应、统筹调配和演练",level:"应",evidence:"区域应急调配状态机"},
    {id:"BIS-4.2-ID",source:"血站信息系统基本功能标准",clause:"4.2",domain:"通用功能",requirement:"关键环节身份识别，献血码关联献血者、血袋、标本和献血记录",level:"应",evidence:"献血码关联校验"},
    {id:"BIS-4.3",source:"血站信息系统基本功能标准",clause:"4.3",domain:"系统管理",requirement:"机构、角色、参数、字典、运行监管和日志管理",level:"应",evidence:"双角色与审计事件"},
    {id:"BIS-4.4",source:"血站信息系统基本功能标准",clause:"4.4",domain:"共享协同",requirement:"对接内部系统、医院、区域平台和国家血液管理系统",level:"应",evidence:"BIS-BTIS交换契约"},
    {id:"BIS-4.5",source:"血站信息系统基本功能标准",clause:"4.5",domain:"安全",requirement:"认证、授权、保密、追溯和备份恢复",level:"应",evidence:"角色门禁与审计链"},
    {id:"BIS-5.1",source:"血站信息系统基本功能标准",clause:"5.1",domain:"献血者服务",requirement:"招募、登记、健康检查、屏蔽、关爱、回访和回告",level:"应",evidence:"献血者风险阻断规则"},
    {id:"BIS-5.2",source:"血站信息系统基本功能标准",clause:"5.2",domain:"血液采集",requirement:"采前核对、采集记录、不良反应和献血证管理",level:"应",evidence:"采集状态门禁"},
    {id:"BIS-5.3",source:"血站信息系统基本功能标准",clause:"5.3",domain:"成分制备",requirement:"起始血液核查、成分关联、不符合品标识与隔离",level:"应",evidence:"父子血液成分追溯"},
    {id:"BIS-5.4",source:"血站信息系统基本功能标准",clause:"5.4",domain:"血液检测",requirement:"标本、检测、综合判定、报告签发、收回与确证",level:"应",evidence:"检测放行阻断规则"},
    {id:"BIS-5.5",source:"血站信息系统基本功能标准",clause:"5.5",domain:"储运发放",requirement:"状态隔离、库存效期、唯一标签、放行、收回和运输交接",level:"应",evidence:"库存冷链及召回"},
    {id:"BIS-5.6",source:"血站信息系统基本功能标准",clause:"5.6",domain:"质量管理",requirement:"体系文件、成分血、设备、物料、环境与持续改进",level:"应",evidence:"质量控制台账"},
    {id:"BTIS-5.1",source:"WS/T 867-2025",clause:"5.1",domain:"通用功能",requirement:"唯一临床用血标识，按WS/T 866采集、存储和交换",level:"应",evidence:"用血标识与交换消息"},
    {id:"BTIS-5.3",source:"WS/T 867-2025",clause:"5.3",domain:"共享协同",requirement:"对接HIS、LIS、EMR、护理、手麻、血站和区域平台",level:"应",evidence:"接口契约清单"},
    {id:"BTIS-5.4",source:"WS/T 867-2025",clause:"5.4",domain:"系统安全",requirement:"加密传输存储、操作追溯、备份与合规密码应用",level:"应",evidence:"安全建设项"},
    {id:"BTIS-6.1",source:"WS/T 867-2025",clause:"6.1",domain:"用血申请",requirement:"输血前评估、知情同意、申请、审核、查询及特殊用血提示",level:"应",evidence:"分级审批规则"},
    {id:"BTIS-6.2",source:"WS/T 867-2025",clause:"6.2",domain:"实验室检测",requirement:"标本身份核对、接收退回、保存及相容性检测",level:"应",evidence:"标本拒收和配血规则"},
    {id:"BTIS-6.3",source:"WS/T 867-2025",clause:"6.3",domain:"医院血库",requirement:"预订、入库、库存预警、温控、发放、退回和追溯",level:"应",evidence:"医院库存及发血门禁"},
    {id:"BTIS-6.4",source:"WS/T 867-2025",clause:"6.4",domain:"临床输血",requirement:"输血前核对、过程监控、反应、疗效评价和病程记录",level:"应",evidence:"床旁闭环"},
    {id:"BTIS-6.5",source:"WS/T 867-2025",clause:"6.5",domain:"自体输血治疗",requirement:"自体输血及血浆置换等输血治疗全过程记录",level:"应",evidence:"专项治疗流程"},
    {id:"BTIS-6.6",source:"WS/T 867-2025",clause:"6.6",domain:"质量管理",requirement:"体系文件、室内质控、室间质评、设备、试剂耗材和持续改进",level:"应",evidence:"医院质量台账"}
  ];
  const transitions={
    collected:["prepared","testing","discarded"],prepared:["testing","quarantined","discarded"],testing:["qualified","quarantined","discarded"],qualified:["released","recalled"],released:["in_transit","recalled"],in_transit:["hospital_received","quarantined","recalled"],hospital_received:["crossmatched","quarantined","returned","discarded","recalled"],crossmatched:["issued","quarantined","returned","recalled"],issued:["transfusing","returned","recalled"],quarantined:["discarded","recalled"],transfusing:["completed","reaction"],reaction:["investigating"],investigating:["closed"],completed:["evaluated"],evaluated:[]
  };
  function canTransition(from,to,context={}){const reasons=[];if(!(transitions[from]||[]).includes(to))reasons.push("状态转换不允许");if(to==="released"&&!context.testReportSigned)reasons.push("检测报告未签发");if(to==="released"&&!context.dualReview)reasons.push("未完成双人放行复核");if(to==="hospital_received"&&context.temperatureOk===false)reasons.push("冷链温度越限，应隔离评估");if(to==="issued"&&!context.crossmatchCompatible)reasons.push("交叉配血未相合");if(to==="transfusing"&&!context.bedsideIdentityMatched)reasons.push("床旁患者、血袋、医嘱核对不一致");return{ok:reasons.length===0,reasons};}
  function assessInventory(item){const hours=(new Date(item.expiresAt)-new Date(item.now||Date.now()))/36e5;const days=Number(item.availableUnits||0)/Math.max(Number(item.averageDailyUse||1),1);const alerts=[];if(days<3)alerts.push("低于3日安全库存");if(hours<48)alerts.push("存在48小时内到期血液");if(item.temperatureOk===false)alerts.push("存储温度越限");return{level:alerts.length>1?"danger":alerts.length?"warn":"ok",days:Number(days.toFixed(1)),alerts};}
  function verifyTrace(events){const required=["donor_registered","collected","tested","released","delivered","crossmatched","transfused"];const types=new Set(events.map(x=>x.type));const missing=required.filter(x=>!types.has(x));const codes=new Set(events.map(x=>x.donationCode).filter(Boolean));return{ok:missing.length===0&&codes.size===1,missing,codeConsistent:codes.size===1};}
  function buildExchangeMessage(type,payload){const allowed=["blood_order","dispatch","delivery_receipt","transfusion_outcome","reaction_report","recall_notice","recall_acknowledgement"];if(!allowed.includes(type))throw new Error("unsupported blood exchange message");return{messageId:`BX-${Date.now()}`,type,sentAt:new Date().toISOString(),standard:"WS/T 866 + WS/T 867-2025",version:"1.0",payload};}
  return{standards,transitions,canTransition,assessInventory,verifyTrace,buildExchangeMessage};
});
