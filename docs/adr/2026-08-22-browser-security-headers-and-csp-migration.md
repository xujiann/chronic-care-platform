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

## Phased enforcement and rollback

1. 第一阶段：集中端口、兼容 CSP + 严格 Report-Only、风险清单、CI 增量拒绝；固定 `productionReady=false`。
2. 第二阶段：页面 Owner 逐页迁移内联脚本、事件处理器和样式，不做全仓重写；每批更新基线并运行页面负向/E2E。
3. 第三阶段：只有目标页面 P0/P1 为零且回归通过，才可在独立切片中对该批页面强制严格 CSP。
4. 第四阶段：全发布图归零后移除兼容 `unsafe-inline`，在真实动态入口和静态托管/CDN 验证响应头与报告接收，再提交安全评估和上线审批。

回滚仅允许恢复上一份已验证的兼容 CSP/资产基线，不得删除 `nosniff`、frame、referrer、permissions 或生产 HSTS，也不得通过扩大来源、加入 `unsafe-eval` 或放宽 CI 基线解决页面故障。
