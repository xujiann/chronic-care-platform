# ADR：浏览器动态 URL 统一进入 Safe URL Port

- 状态：Accepted
- 日期：2026-08-23
- Owner：T00（浏览器公共安全端口、静态发布、CI）+ 页面 Owner（逐项迁移）
- 影响范围：浏览器导航、链接/资源属性、官方来源、对象存储短时地址、电话与本地下载

## Problem

Inventory v2 在 145 个显式发布资产中识别出 69 个动态 URL sink。它们分散使用
`location`、`window.open`、DOM URL property、`setAttribute` 和模板 HTML；部分调用已经在居民短时
凭据、对象存储或小程序策略中执行 exact-Origin 检查，但浏览器写入点没有统一协议、userinfo、
Origin 和能力边界。逐页面复制正则或只依赖 CSP 都不能保证 `javascript:`、`data:`、协议相对地址、
userinfo 和未批准 Origin 在 DOM mutation 前被拒绝。

## Options

1. 保留分散实现，只增加 Inventory 数量门禁。
2. 对每个页面分别增加 URL 校验器和 allowlist。
3. 建立 `browser-safe-url-policy.v1` 公共端口，按能力区分 internal navigation、official source、
   object storage、`tel` 和 blob download；所有 DOM mutation/navigation 必须先得到策略决定。
4. 立即迁移全部 URL sink，并为来源不明的 OHIF/模板地址猜测固定 Origin。

## Advantages

方案 3 复用居民短时凭据、对象存储和小程序已有的 HTTPS、无凭据、精确 Origin 语义，提供稳定
`SAFE_URL_*` 错误；调用方必须显式声明能力和 allowlist。内部导航只允许当前 Origin，官方来源和
对象存储要求显式 exact-Origin，电话只允许调用方列出的号码，blob 下载绑定当前页面 Origin。
首批迁移使动态 URL occurrence 从 69 降至 35，同时保留机器基线和剩余复核清单。

## Disadvantages

所有加载 `auth.js` 的页面增加一个公共脚本依赖。旧页面若缺少端口会失败关闭；页面 Owner 仍需为
模板 URL 提供可信来源/编码证据。词法 Inventory 仍会把公共端口内部 4 个受控 DOM/navigation
调用计为 P0，不能用数量直接代表可利用风险。

## Migration cost

中等。先发布 UMD/CommonJS 双用端口和负向测试，再迁移认证导航、居民短时凭据、内部页面入口、
`tel:120` 和同源 blob 下载；刷新只减不增基线。剩余模板 URL 必须改为 DOM 构造或经审核的安全渲染
端口。OHIF 的 2 个导航只有在部署合同提供可信 exact-Origin allowlist 后才能迁移。

## Risk

- allowlist 从待验证输入自身派生会使 exact-Origin 失去意义，固定禁止。
- 为兼容故障接受 `javascript:`、`data:`、协议相对 URL、userinfo 或通配 Origin 会重新扩大 XSS/钓鱼面。
- blob、电话或对象存储能力互相复用会绕过最小能力原则。
- 错误配置可能阻断合法导航，因此每批迁移必须有模块负向测试和 Playwright 行为回归。
- Safe URL 端口不净化 HTML、不证明 OHIF/对象存储供应方可信，也不授权严格 CSP 或生产上线。

## Recommendation

采用方案 3。`browser-safe-url-policy.v1` 是浏览器动态 URL 的唯一新增公共策略端口；调用方必须在
mutation 前声明能力、base URL 和（适用时）独立 exact-Origin allowlist。首批只迁移仓库证据能够
证明来源的调用；当时 29 个模板 URL 和 2 个 OHIF 导航保持 `review-required`，不得硬编码猜测。
`productionReady=false` 保持不变，真实托管响应头、OHIF/对象存储现场 Origin、严格 CSP、独立扫描和
全角色验收仍是外部/后续阻断项。

## 内部 sink 闭环状态（2026-08-23）

后续切片继续采用方案 3，没有建立第二套 sanitizer。29 个原模板 occurrence 中，28 个真实 URL
属性已改为模板不携带 URL，再由 `browser-safe-url-policy.v1` 按 internal/official capability 绑定 DOM；
另 1 个是 `digital-hospital-standard-platform/app.js` 的普通 `item.action` 模板字符串赋值，扫描器已增加
synthetic 回归避免再误判为 HTML `action` 属性。Inventory v2 的动态 URL 由 35 降至 6：公共端口内
4 个受控 sink，外加 2 个 OHIF 导航。OHIF 的真实部署 Origin 仍不在仓库，故两项继续
`review-required`，不猜测、不降级；恶意 javascript/data/userinfo/协议相对/未批准 Origin 的批量绑定
在 mutation 前失败关闭。兼容 `unsafe-inline`、严格 Report-Only 与 `productionReady=false` 均保持不变。

## Rollback

回滚整个首批切片并恢复上一份 Inventory v2 基线；不得只删除端口、放宽协议/Origin 或保留已迁移
调用对不存在端口的引用。回滚后生产仍保持 NO-GO。
