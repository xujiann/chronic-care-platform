const catalog={
  version:"2026.07.12",effectiveAt:"2026-07-12T00:00:00+08:00",
  bloodTypes:["A Rh+","A Rh-","B Rh+","B Rh-","O Rh+","O Rh-","AB Rh+","AB Rh-"],
  components:[{code:"RBC-S",name:"悬浮红细胞",storage:"2-6C",unit:"U"},{code:"PLT-A",name:"单采血小板",storage:"20-24C振荡",unit:"治疗量"},{code:"FFP",name:"新鲜冰冻血浆",storage:"-18C以下",unit:"ml"},{code:"CRYO",name:"冷沉淀凝血因子",storage:"-18C以下",unit:"U"},{code:"WBC-G",name:"单采粒细胞",storage:"20-24C",unit:"治疗量"}],
  unitStatuses:["collected","prepared","testing","qualified","quarantined","released","in_transit","hospital_received","issued","transfusing","evaluated","returned","discarded","recalled"],
  specimenRejectionReasons:["身份不一致","标签不完整","标本溶血","标本超过接收时限","采集容器不符合"],
  recallDispositions:["库存冻结","已退回血液中心","已报废","已输注并启动患者随访","未收到该血液"],
  reactionSeverities:["一般","严重","危及生命","死亡"],reactionConclusions:["非溶血性发热反应","过敏反应","急性溶血反应","细菌污染反应","输血相关循环超负荷","待排除输血相关性","与输血无关"],emergencyPriorities:["urgent","critical","disaster"]
};
function validateBloodType(value){return catalog.bloodTypes.includes(value)}
function validateComponent(value){return catalog.components.some(x=>x.name===value||x.code===value)}
function snapshot(){return JSON.parse(JSON.stringify(catalog))}
module.exports={catalog,validateBloodType,validateComponent,snapshot};
