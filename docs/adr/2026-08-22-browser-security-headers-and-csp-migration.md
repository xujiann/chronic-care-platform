# ADR：浏览器安全响应头与 CSP 分批强制

- 状态：Accepted
- 日期：2026-08-22
- Owner：T00（HTTP/静态发布/CI）+ T01（身份安全评审）+ 页面 Owner（风险迁移）
- 影响范围：动态 HTTP、静态发布、浏览器资产、CI、部署验收

## Problem

浏览器响应头原本以内联函数存在于 `server.js`，Node 动态服务与静态发布没有共同的机器合同。兼容 CSP 允许 `script-src 'unsafe-inline'` 和 `style-src 'unsafe-inline'`；决策时显式发布图包含 37 个 P0 可执行内联脚本以及 21 个 P1 内联样式块/样式属性。直接启用不含 `unsafe-inline` 的严格 CSP 会破坏页面，而继续只保留兼容 CSP 会掩盖 SEC-004 尚未关闭的事实。仓库也缺少 fail-closed 清单阻止新增内联事件处理器、`eval` 或其他高风险构造。

## Options

1. 维持 `server.js` 内联响应头和允许 inline 的 CSP。
2. 立即删除所有内联脚本/样式并一次性强制严格 CSP。
3. 建立集中响应头端口；保留不破坏现有页面的兼容 CSP 基线，同时下发无 `unsafe-inline`/`unsafe-eval` 的严格 Report-Only 目标；建立发布资产风险基线和 CI 增量拒绝，再按页面逐批迁移并最终强制。
4. 暂时删除 CSP，仅依赖输入编码和外部安全测试。

## Advantages

方案 3 不降低现有 `base-uri`、`object-src`、`frame-ancestors` 和 `script-src-attr` 兼容保护，同时把严格目标、已知遗留风险、静态托管缺口和生产 NO-GO 变成机器可验证合同。页面 Owner 可以逐页减少风险，CI 允许净减少但拒绝新增或替换既有 P0/P1 指纹。动态 HTTP、Pages 构建制品和部署验收消费同一公开策略文件。

## Disadvantages

双 CSP 阶段增加理解成本；Report-Only 不会阻止目标策略违规。指纹基线只能约束已扫描的显式发布图，不能替代运行时 DOM 污染分析、浏览器扩展场景、第三方渗透测试或现场响应头验证。静态制品携带策略合同并不自动证明托管平台实际应用了响应头。

## Migration cost

中到高。第一切片建立端口、扫描清单、CI、测试和部署说明；后续需按页面把可执行内联脚本移到外部资源、把样式属性迁至类、保持脚本加载顺序和角色页面行为，并运行逐页 E2E。最后还需在动态入口与真实静态托管/CDN 分别验证强制头、缓存和回滚。

## Risk

- 过早强制严格 CSP 会造成登录、角色门户或业务动作不可用。
- 错误放宽 `unsafe-eval`、通配来源、`data:` 脚本或任意 frame 会扩大 XSS/点击劫持面。
- 只看全局数量可能通过“删除一个、增加一个”掩盖风险，因此基线按资产、类型和规范化片段指纹约束。
- 静态发布清单通过不等于真实托管响应头通过；没有独立抓取和安全评估时必须保持 NO-GO。

## Recommendation

采用方案 3。集中端口固定提供 `nosniff`、`Referrer-Policy`、`Permissions-Policy`、同源 frame 策略和生产 HSTS；兼容 CSP 继续强制但不得描述为严格 CSP，严格目标只用 `Content-Security-Policy-Report-Only`。P0/P1 基线必须只减不增。生产就绪条件至少包括：P0/P1 资产风险归零或逐项受控例外、严格 CSP 强制后的全角色 E2E、动态和静态托管响应头独立验证、无未关闭高危发现以及正式安全评估。

### 第二阶段状态（2026-08-22）

显式发布图原有 37 个可执行内联脚本、8 个内联样式块和 13 个样式属性已迁至外部脚本、外部样式表和受控 class，P0/P1 静态风险基线为 0。角色/账户守卫统一由 `page-auth-bootstrap.js` 承载，并以行为测试保持原有加载顺序和失败关闭语义。此结果只完成第二阶段的静态迁移，不授权提前进入第三/四阶段：动态 CSSOM、全角色浏览器与恶意输入回归、真实托管响应头和独立安全评估仍未完成，因此兼容 `unsafe-inline` 保留、严格策略仍为 Report-Only、`productionReady=false`。

### Inventory v2 治理状态（2026-08-22）

显式发布图的治理清单扩展到 DOM HTML、动态 URL、动态 HTML style、CSSOM 和 runtime style element：当前精确 occurrence 为 896、69、48，分别覆盖 44、18、15 个资产。每个资产/类型以规范化源行 occurrence 集合生成稳定 SHA-256；数量增长、同数量替换、新资产或新类型均失败关闭，风险减少也必须显式刷新基线接受评审。该词法清单不分析数据来源和净化效果，不修改任何 sink、响应头或 CSP enforcement；兼容 CSP、严格 Report-Only 和 `productionReady=false` 均保持不变。

### 血液主工作台可信渲染试点（2026-08-23）

T06 将 `blood.js` 的 25 个 `innerHTML`、2 个 CSSOM display mutation 和 1 个模板 style 属性迁为显式 DOM、`textContent`、`replaceChildren` 和固定 class；表格、状态、按钮及接口字段均由节点类型表达，恶意 API 字段只显示为文本。Inventory v2 因真实减少刷新为 871 个 DOM HTML、69 个动态 URL和45 个动态样式风险，分别覆盖 43、18、14 个资产。该页面试点不代表其他血液资产或全平台已安全，也不改变兼容 CSP、严格 Report-Only、真实托管验证和 `productionReady=false`。

### Safe URL 首批迁移状态（2026-08-23）

后续 Accepted Safe URL ADR 将可证明的 internal navigation、object-storage、`tel:120` 和同源 blob
download 收敛到 `browser-safe-url-policy.v1`，动态 URL occurrence 从 69 降至 35。当前 4 项是公共
端口内受控 sink，29 个模板 URL 与 2 个缺可信 OHIF exact-Origin allowlist 的导航继续
`review-required`。这不改变本 ADR 的分阶段 CSP 决策：兼容 CSP、严格 Report-Only、外部托管验证和
`productionReady=false` 保持不变。

### Safe URL 内部 sink 闭环状态（2026-08-23）

29 个原模板 occurrence 已由 28 个真实 DOM 绑定迁移和 1 个普通 `item.action` 词法误报校正闭合，
动态 URL 基线现为 6：共享端口内 4 个受控 sink、缺真实 OHIF exact-Origin 的 2 个导航。批量绑定仍
逐项调用唯一 Safe URL port，恶意 javascript/data/userinfo/协议相对/未批准 Origin 不会留下可导航属性。
本状态不推进 CSP enforcement 阶段；HTML/style sink、全角色浏览器、真实托管响应头和独立评估未闭合，
因此兼容 `unsafe-inline`、严格 Report-Only 与 `productionReady=false` 不变。

### 急救生命链可信渲染切片（2026-08-23）

`emergency-lifechain-ui.js` 将 overview、quality、command-center 及失败回退中的 6 个 `innerHTML`
迁为显式 `createElement`、`textContent`、dataset、固定 class 与 `replaceChildren`。浏览器以恶意 API
字段验证标签和事件属性不会被创建，同时保留事件/授权按钮的原 dataset 行为。Inventory v2 的 DOM
HTML occurrence 由 871 降为 865，覆盖资产由 43 降为 42；动态 URL 6 和动态样式 45 均未改变。
该单页切片不代表 `emergency.js` 或其他页面已迁移，不推进 CSP enforcement；真实托管头、OHIF/外部
Origin、独立渗透与现场验收仍未完成，兼容 `unsafe-inline`、严格 Report-Only 和 `productionReady=false` 保持不变。

### 医生工作台可信渲染切片（2026-08-23）

`doctor.js` 将本人指标、临床辅助、执业档案、政策、申请消息与公开备案中的 6 个 `innerHTML`
迁为显式 `createElement`、`textContent`、dataset、固定 class 与 `replaceChildren`。迁移前先以恶意
API 字段冻结现有编码表现，迁移后同一浏览器合同确认标签、事件属性不会被创建，临床提醒按钮仍保留
原 alert ID/action dataset。与急救切片合并后，Inventory v2 的 DOM HTML occurrence 由 865 降为
859，覆盖资产由 42 降为 41；动态 URL 6 和动态样式 45 均未改变。该单页切片不改变 API、鉴权、
数据或审计，也不推进 CSP enforcement；真实托管头、OHIF/外部 Origin、独立渗透与现场验收继续
NO-GO，兼容 `unsafe-inline`、严格 Report-Only 和 `productionReady=false` 保持不变。

### 血液上线看板可信渲染切片（2026-08-23）

`blood-go-live.js` 将上线摘要、临床门禁、标准登记、接口/设备、要求、演练、迁移与审批中的
8 个 `innerHTML` 迁为显式 `createElement`、`textContent`、固定 class 与 `replaceChildren`。
迁移前先以恶意 API 字段冻结现有编码表现，迁移后同一浏览器合同确认标签、事件属性不会被创建，
既有表格与状态表达保持不变。Inventory v2 的 DOM HTML occurrence 由 859 降为 851，覆盖资产由
41 降为 40；动态 URL 6 和动态样式 45 均未改变。该单页切片不改变 API、鉴权、数据、审计或
CSP enforcement；真实血液系统/设备接口、证据双签、演练、迁移、审批、托管头、OHIF/外部 Origin、
独立渗透与现场验收继续 NO-GO，兼容 `unsafe-inline`、严格 Report-Only 和
`productionReady=false` 保持不变。

### 陪诊工作台可信渲染切片（2026-08-23）

`escort.js` 将指标、服务商下拉、订单、服务主体、陪诊师、风险队列与政策映射中的 7 个 `innerHTML`
和订单医院交接按钮的 1 个 `insertAdjacentHTML` 迁为显式 `createElement`、`textContent`/文本节点、
固定 class、dataset 与 `replaceChildren`。迁移前先以恶意陪诊 API 字段冻结现有编码与 action/hospital
dataset 表现，迁移后同一浏览器合同确认标签和事件属性不会被创建。Inventory v2 的 DOM HTML
occurrence 由 851 降为 843，覆盖资产由 40 降为 39，其中 `innerHTML` 846→839、
`insertAdjacentHTML` 5→4；动态 URL 6 和动态样式 45 均未改变。该单页切片不改变 API、鉴权、
数据、schema、审计、CI 或 CSP enforcement；真实 HIS/导诊台、托管头、OHIF/外部 Origin、独立渗透
与现场验收继续 NO-GO，兼容 `unsafe-inline`、严格 Report-Only 和 `productionReady=false` 保持不变。

### 产品运行驾驶舱可信渲染切片（2026-08-23）

`product-operations-ui.js` 将 `mount` 中唯一的 `innerHTML` sink 迁为显式 `createElement`、
`textContent`、dataset 与 `replaceChildren`，同时保留既有 `render`/`escapeHtml` 字符串接口及编码语义。
迁移前先以恶意产品运行 API 字段冻结现有文本与 dataset 表现，迁移后同一浏览器合同确认标签和事件属性
不会被创建。Inventory v2 的 DOM HTML occurrence 由 843 降为 842，覆盖资产由 39 降为 38，其中
`innerHTML` 839→838；动态 URL 6 和动态样式 45 均未改变。该单页切片不改变 API、commission 鉴权、
数据、schema、审计、CI 或 CSP enforcement；真实托管头、OHIF/外部 Origin、独立渗透与现场验收继续
NO-GO，兼容 `unsafe-inline`、严格 Report-Only 和 `productionReady=false` 保持不变。

### 产品区域运行驾驶舱可信渲染切片（2026-08-23）

`product-regional-operations-ui.js` 将 `mount` 中唯一的 `innerHTML` sink 迁为显式
`createElement`、`textContent`、dataset 与 `replaceChildren`，同时保留既有 `render`/`escapeHtml`
字符串接口及编码语义。迁移前先以恶意增强驾驶舱 API 字段冻结现有文本与 dataset 表现，迁移后同一
浏览器合同确认标签和事件属性不会被创建。Inventory v2 的 DOM HTML occurrence 由 842 降为 841，
覆盖资产由 38 降为 37，其中 `innerHTML` 838→837；动态 URL 6 和动态样式 45 均未改变。该单页切片
不改变 API、commission 鉴权、数据、schema、审计、CI 或 CSP enforcement；真实托管头、地区外部系统、
OHIF/外部 Origin、独立渗透与现场验收继续 NO-GO，兼容 `unsafe-inline`、严格 Report-Only 和
`productionReady=false` 保持不变。

### 质量安全工作台可信渲染切片（2026-08-23）

`quality-safety.js` 原有唯一 `innerHTML` 是整页共享挂载入口，实际承载 dashboard 与 interface joint-test
pack 的二十余个渲染区，而非一个低风险文本点。迁移前先以恶意 API 字段冻结文本、dataset 与委托按钮
交互，迁移后将表头、空态、固定 class、dataset 和动作节点改为显式 `createElement`、`textContent`、
`append` 与 `replaceChildren`，且不新增 sanitizer 或扫描忽略。Inventory v2 的 DOM HTML occurrence
由 841 降为 840，覆盖资产由 37 降为 36，其中 `innerHTML` 837→836；动态 URL 6 和动态样式 45 均未改变。
该切片不改变 API、commission 鉴权、数据、schema、审计、CI 或 CSP enforcement；真实托管头、
OHIF/外部 Origin、独立渗透与现场验收继续 NO-GO，兼容 `unsafe-inline`、严格 Report-Only 和
`productionReady=false` 保持不变。

### 区域切换工作台可信渲染切片（2026-08-23）

`regional-cutover-workbench-ui.js` 的两个 `innerHTML` 分别承载区域切换摘要卡片和地区证据卡片。
大部分字段原先经过 `escapeHtml`，但 `readyScopes/requiredScopes` 直接进入模板；恶意 API 回归在旧实现
中可创建活动标签和事件属性。迁移后摘要、地区、发布、运维、存储、证据、阻断项、边界及区域 dataset
均通过显式 `createElement`、`textContent`、固定 class、dataset 与 `replaceChildren` 写入，原 badge、
文本格式和加载失败行为保持不变。Inventory v2 的 DOM HTML occurrence 由 840 降为 838，覆盖资产由
36 降为 35，其中 `innerHTML` 836→834；动态 URL 6 和动态样式 45 均未改变。该单页切片不改变 API、
commission 鉴权、区域发布事实、审计、schema、CI 或 CSP enforcement；真实地区切换、外部证据、
托管头、独立渗透与现场验收继续 NO-GO，兼容 `unsafe-inline`、严格 Report-Only 和
`productionReady=false` 保持不变。

### 血液召回可信渲染切片（2026-08-23）

`blood-recall.js` 的两个 `innerHTML` 分别承载召回面板骨架及召回列表/空态；召回 ID、原因和待确认机构数
原先直接进入模板，恶意 API 回归在旧实现中可创建活动标签和事件属性。迁移后复用既有页面 DOM helper，
通过 `createElement`、`textContent`、dataset 与 `replaceChildren` 写入，原确认 POST、toast、确认后空态和
加载失败行为保持不变。Inventory v2 的 DOM HTML occurrence 由 838 降为 836，覆盖资产由 35 降为 34，
其中 `innerHTML` 834→832；动态 URL 6 和动态样式 45 均未改变。该切片不改变 API、鉴权、数据、schema、
审计、CI 或 CSP enforcement；真实血液系统、外部回执、托管头、独立渗透与现场验收继续 NO-GO，兼容
`unsafe-inline`、严格 Report-Only 和 `productionReady=false` 保持不变。

## Phased enforcement and rollback

1. 第一阶段：集中端口、兼容 CSP + 严格 Report-Only、风险清单、CI 增量拒绝；固定 `productionReady=false`。
2. 第二阶段：页面 Owner 逐页迁移内联脚本、事件处理器和样式，不做全仓重写；每批更新基线并运行页面负向/E2E。
3. 第三阶段：只有目标页面 P0/P1 为零且回归通过，才可在独立切片中对该批页面强制严格 CSP。
4. 第四阶段：全发布图归零后移除兼容 `unsafe-inline`，在真实动态入口和静态托管/CDN 验证响应头与报告接收，再提交安全评估和上线审批。

回滚仅允许恢复上一份已验证的兼容 CSP/资产基线，不得删除 `nosniff`、frame、referrer、permissions 或生产 HSTS，也不得通过扩大来源、加入 `unsafe-eval` 或放宽 CI 基线解决页面故障。
