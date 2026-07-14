const {randomUUID}=require("node:crypto");
const domains=[
  {id:"donor-service",side:"BIS",name:"献血者服务与健康检查",features:["招募","登记","献血史","健康征询","一般检查","献血前检测","屏蔽","关爱","回访","回告"]},
  {id:"collection",side:"BIS",name:"血液采集",features:["采前核对","全血采集","单采血小板","单采粒细胞","标本送检","不良反应","献血证"]},
  {id:"component-preparation",side:"BIS",name:"血液成分制备",features:["起始血液核查","制备规则","父子袋谱系","标签打印","不符合品隔离"]},
  {id:"blood-testing",side:"BIS",name:"血液检测",features:["标本接收","检测批次","试剂与质控","结果判定","报告签发","报告收回","确证"]},
  {id:"storage-distribution",side:"BIS",name:"储存、放行、发放与运输",features:["状态隔离","库位","效期","放行","报废","发放","收回","冷链运输"]},
  {id:"bis-quality",side:"BIS",name:"血站质量管理",features:["体系文件","成分血质检","设备","物料","环境卫生","偏差与持续改进"]},
  {id:"blood-application",side:"BTIS",name:"用血申请",features:["输血前评估","知情同意","申请开具","分级审核","状态查询","特殊用血提示"]},
  {id:"clinical-laboratory",side:"BTIS",name:"输血实验室",features:["标本标识","采集","接收退回","保存","血型","抗筛","交叉配血","疑难配血"]},
  {id:"hospital-inventory",side:"BTIS",name:"医院血液出入库",features:["血液预订","扫码入库","库存查询","库存预警","温控","发放","退回","追溯"]},
  {id:"clinical-transfusion",side:"BTIS",name:"临床输血",features:["输血前核对","过程监控","输血反应","输血后评价","病程记录"]},
  {id:"autologous-treatment",side:"BTIS",name:"自体输血与输血治疗",features:["储存式自体输血","稀释式自体输血","回收式自体输血","血浆置换","红细胞单采"]},
  {id:"btis-quality",side:"BTIS",name:"医院输血质量管理",features:["体系文件","室内质控","室间质评","设备","试剂耗材","指标监控与改进"]}
];
const resourceRules={
  donor:{side:"BIS",required:["donorCode","name","identityVerified"],initial:"registered",statuses:["registered","eligible","deferred","permanently_blocked","followup_due","closed"]},
  collection:{side:"BIS",required:["donorCode","donationCode","collectionType","amount","collectedAt"],initial:"collected",statuses:["collected","completed","adverse_reaction","cancelled"]},
  preparation:{side:"BIS",required:["sourceBloodUnitId","method","component","preparedAt"],initial:"prepared",statuses:["prepared","quarantined","quality_passed","discarded"]},
  laboratoryBatch:{side:"BIS",required:["batchCode","specimenIds","testItems","startedAt"],initial:"testing",statuses:["testing","review_pending","signed","recalled","confirmed"]},
  qualityRecord:{side:"BOTH",required:["category","subjectId","result","recordedAt"],initial:"recorded",statuses:["recorded","nonconformity","correcting","verified","closed"]},
  applicationApproval:{side:"BTIS",required:["requestId","level","decision"],initial:"reviewed",statuses:["reviewed","approved","rejected","escalated"]},
  bloodReturn:{side:"BTIS",required:["bloodUnitId","requestId","reason","temperatureOk","sealIntact"],initial:"assessment_pending",statuses:["assessment_pending","accepted","rejected","returned_to_center"]},
  autologousProcedure:{side:"BTIS",required:["patientId","type","plannedAt"],initial:"planned",statuses:["planned","collected","stored","reinfused","cancelled","evaluated"]},
  transfusionTreatment:{side:"BTIS",required:["patientId","type","indication","startedAt"],initial:"in_progress",statuses:["in_progress","completed","reaction","evaluated"]}
};
function seed(){return{bloodBusinessRecords:[{id:"bbr-qc-001",resource:"qualityRecord",side:"BIS",category:"equipment",subjectId:"centrifuge-01",result:"passed",recordedAt:"2026-07-12T08:00:00.000Z",status:"recorded",history:[]} ]}}
function normalize(data){data.bloodBusinessRecords=Array.isArray(data.bloodBusinessRecords)?data.bloodBusinessRecords:seed().bloodBusinessRecords;return data}
function sideAllowed(user,side){if(user.role==="commission")return side==="BIS"||side==="BOTH";if(user.role==="institution")return side==="BTIS"||side==="BOTH";return false}
function create(data,user,resource,payload){normalize(data);const rule=resourceRules[resource];if(!rule)return{status:404,body:{error:"Not Found",message:"未知血液业务资源"}};if(!sideAllowed(user,rule.side))return{status:403,body:{error:"Forbidden",message:"当前岗位无权创建该业务记录"}};const missing=rule.required.filter(x=>payload[x]===undefined||payload[x]===null||payload[x]==="");if(missing.length)return{status:400,body:{error:"Bad Request",message:`缺少字段：${missing.join("、")}`}};const record={id:`bbr-${resource}-${randomUUID()}`,resource,side:rule.side,institutionCode:user.orgCode,status:rule.initial,createdAt:new Date().toISOString(),createdBy:user.name||user.username,history:[],...payload};data.bloodBusinessRecords=[record,...data.bloodBusinessRecords].slice(0,5000);return{status:201,body:{record}}}
function action(data,user,id,payload){normalize(data);const item=data.bloodBusinessRecords.find(x=>x.id===id);if(!item)return{status:404,body:{error:"Not Found",message:"未找到业务记录"}};const rule=resourceRules[item.resource];if(!sideAllowed(user,rule.side)||(user.role==="institution"&&item.institutionCode!==user.orgCode))return{status:403,body:{error:"Forbidden",message:"无权操作该记录"}};const to=String(payload.to||"");if(!rule.statuses.includes(to))return{status:400,body:{error:"Bad Request",message:"目标状态不在业务字典中"}};const from=item.status;item.status=to;item.updatedAt=new Date().toISOString();item.history=[{from,to,actor:user.name||user.username,at:item.updatedAt,note:String(payload.note||"")},...(item.history||[])].slice(0,100);return{status:200,body:{record:item}}}
function dashboard(data,user){normalize(data);const visible=domains.filter(x=>sideAllowed(user,x.side));const records=data.bloodBusinessRecords.filter(x=>sideAllowed(user,x.side)&&(user.role!=="institution"||x.institutionCode===user.orgCode));return{domains:visible.map(x=>({...x,implementedFeatures:x.features.length,totalFeatures:x.features.length,status:"implemented"})),summary:{domains:visible.length,features:visible.reduce((n,x)=>n+x.features.length,0),records:records.length,openRecords:records.filter(x=>!["closed","evaluated","cancelled","rejected"].includes(x.status)).length},records:records.slice(0,200),resourceRules:Object.fromEntries(Object.entries(resourceRules).filter(([,x])=>sideAllowed(user,x.side)))}}
module.exports={domains,resourceRules,seed,normalize,create,action,dashboard};
