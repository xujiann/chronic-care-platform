# ADR：Playwright E2E 采用统一浏览器策略与独占测试服务

- 状态：Accepted
- 日期：2026-08-23
- Owner：T00
- 影响范围：Playwright 配置、浏览器 E2E runner、CI browser-e2e、本地测试

## Problem

TEST-005 基线在 Windows 自动选择系统 Chrome，而 CI 安装并使用 Playwright Chromium，导致同一测试
命令实际依赖不同浏览器版本。当前主线的完整 40 项、居民文件 13 项和超时恢复单例均在本地重现失败；
trace 显示受控首请求中止后，500ms 重试仍可能与同一浏览器上下文的 Service Worker 预缓存争用。

根 Playwright 配置还把居民小程序 13 项与其余 27 项放在同一服务进程和临时数据目录中，虽然仓库已经
存在能独占服务、临时数据和清理生命周期的居民 runner。固定端口 `5210` 也会使并行 worktree 或本地
任务连接到其他任务的测试服务；实际复现中独占 runner 因端口被另一 worktree 占用而错误继续使用外来
健康响应。这些差异造成顺序依赖、重跑不稳定和跨任务状态污染风险。

## Options

1. 保留系统 Chrome 优先、固定端口和单服务完整套件，通过重跑处理失败。
2. 只删除系统 Chrome 自动选择，继续共享服务、端口与 Service Worker 状态。
3. 统一使用 Playwright Chromium；E2E 上下文阻止 Service Worker；把 40 项精确拆为根 27 项与居民
   13 项两个不重叠套件；每个 runner 获取独立临时端口和临时数据目录，并由居民 runner 显式停止服务。
4. 为每一条 E2E 测试启动完整服务进程和独立浏览器。

## Advantages

- 方案 3 使本地和 CI 消费同一 Playwright 浏览器发行物，移除系统 Chrome 版本漂移。
- 根套件和居民套件的服务、端口及数据生命周期隔离，跨 worktree 并行执行不再复用固定服务。
- 禁用 Service Worker 让现有 E2E 聚焦在线页面/API 行为，避免缓存安装与 500ms 故障注入互相争用。
- 机器测试锁定 27 + 13 = 40 的唯一并集、浏览器策略、动态端口与 runner 清理，防止静默漏测。

## Disadvantages

- 本地首次执行前必须安装与 `@playwright/test` 对应的 Chromium，不能再隐式借用系统 Chrome。
- 两个服务顺序启动增加少量启动时间；Service Worker 的真实安装、更新和离线行为需要独立专项测试，
  不能由本套件通过推断为已验证。
- 动态空闲端口在关闭预留 socket 到子进程监听之间仍有极小竞争窗口；启动失败必须直接失败，不得复用
  未知健康服务。

## Migration cost

低到中。复用既有居民 runner 和两个临时数据 server，只增加共享浏览器/端口策略、根 runner、参数透传
和治理测试；不增加 npm 依赖，不修改业务页面、HTTP API、鉴权、数据库 schema、部署拓扑或生产配置。

## Risk

- 套件拆分可能静默遗漏测试，因此必须以 Playwright `--list` 和源码声明共同验证 40 项唯一并集。
- 禁用 Service Worker 不能替代离线/PWA 专项验收；后续若建立该专项，应使用独立 browser context、cache
  清理和版本化断言，不得重新打开所有业务 E2E 的共享缓存状态。
- runner 必须只停止自己启动的服务；端口、临时数据和进程生命周期失败均应使命令失败。

## Recommendation

采用方案 3。标准 `npm run test:e2e` 顺序执行根 27 项和独占居民 13 项；两者共同使用
`playwright-browser-policy.v1`、Playwright Chromium、`serviceWorkers=block` 和运行时分配的回环端口。
保留单 worker 和既有业务断言，不扩大超时、不修改运行时代码。回滚应整体恢复前一测试拓扑，但不得以
删除失败用例、复用外来服务或改用系统 Chrome 作为长期解决方案。

### PWA 专项实施状态（2026-08-23）

在线根 27 项与居民 13 项继续使用 `serviceWorkers=block`。新增的 PWA 3 项通过同一 Chromium、动态端口和
临时数据装配，在独立 `playwright-pwa-browser-policy.v1` context 中允许 Worker；三套测试形成 43 项唯一
并集。专项使用正式 `service-worker.js` 验证居民登录后安装、受控 update、v60→v61 清理、离线回退、
API/404 缓存边界以及每项 unregister/Cache Storage 清理。该事实补完方案 3 预留的仓库内专项，不改变
真实 HTTPS、OS 安装策略、外部 Origin 和现场浏览器验收仍外置的结论。

后续页面级恶意响应回归在不改变三套隔离策略的前提下逐项进入根套件；区域切换工作台、血液召回面板、血液创新指挥中心、体检风险卡与 Go/No-Go 责任角色回归加入后，当前
拓扑为根 39 项、居民 13 项、PWA 3 项，共 55 项唯一并集。Go/No-Go 回归验证四方业务责任属性不被登录角色过滤器误删；其他新增用例仍使用临时数据和阻止 Service Worker
的在线 context，不能解释为真实 HTTPS、托管安全头、外部 Origin、渗透或现场验收证据。
