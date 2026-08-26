# 遗留代码重构安全网

## T09 八个首发写入口保护

`test/t09-release-write-api-behavior.test.js` 是药械监管三个兼容写入口和科研数据集五个写入口的专项负向安全网。以后触及这些路由、命令 receipt、版本字段、科研治理或职责分离时，至少运行：

```powershell
node --test test/t09-release-write-api-behavior.test.js
node --test test/research-compliant-export-workflow.test.js test/research-sandbox-read-model.test.js test/drug-consumable-supervision-use-case.test.js
```

不得删除 actor/org/resource scope，不得把 exact replay 改为二次业务/审计写入，不得在持久化失败时补写另一事实源；也不得把进程锁、JSON/SQLite 测试或 synthetic receipt 描述为跨实例 exactly-once、真实外部回执或现场上线证据。

```text
LEGACY CODE
    ↓
TEST PROTECTION
    ↓
REFACTOR
```

## 1. 重构前

1. 确认进程 owner 和保护路径。
2. 阅读六张地图、模块标签、相关 ADR 和现有测试。
3. 搜索全部调用方、动态加载、页面脚本顺序、配置和报告依赖。
4. 写特征测试锁定公共输入、输出、错误、授权、数据和审计行为。
5. 为风险行为添加负向测试，而不是只测成功路径。
6. 记录迁移、回滚和不处理的邻近问题。

## 2. 小步顺序

- 一次移动一个用例或一个依赖端口。
- 先加适配器，保持旧接口可用。
- 每步都能独立运行、review 和回滚。
- 不同时重命名、移动、改协议和改数据模型。
- 不在 C 模块重构中顺手修改 A 模块。

## 3. 必测行为

| 类型 | 最低保护 |
|---|---|
| API | method/path、状态码、字段、错误码、幂等 |
| 鉴权 | 未登录、错误角色、越权资源、跨机构/地区 |
| 数据 | 版本冲突、事务失败、migration 重跑、核对 |
| 任务 | 重试、去重、宕机恢复、多实例竞争 |
| 前端 | 允许/拒绝页面、恶意输入、缓存更新、E2E |
| 外部 | 超时、验签失败、重放、provider 不可用 |

触及 runtime identity、audit chain/source、object storage trust 或 API governance 时，还必须运行
`npm run test:coverage:boundaries`。覆盖率阈值只能持平或提高，且不能用数字替代上表的负向行为断言。

体检页面可信渲染已关闭全部 27 个 HTML sink（前一切片 2 个、本切片 25 个）和 3 个动态样式 sink；
Inventory v2 机器基线与同一恶意 API 响应 E2E 保护汇总、趋势、计划、质检、联调、专项分流、标准、
报告列表/详情的文本、闭集状态类、dataset 和 Safe URL 边界。后续触碰该页面不得回流 HTML 模板或动态
inline style；本地回归不能替代真实设备、托管响应头、严格 CSP 强制、渗透或现场验收证据。

T05 care owner 的遗留路由还必须运行 3 个独立 HTTP 特征测试，分别保护陪诊 handoff、护理闭环和护士
生命周期。派单证据构造器与 owner adapter 必须处于同一测试进程信任边界；通知只断言 plan、outbox
和可信 receipt，不得把模拟字段写成外部送达证据。

拆分 `test/api.test.js` 自身时，每个切片只能移动一个共享测试生命周期；必须锁定子测试数量与顺序，
保持单进程 server、共享状态、断言、超时、integration 成员和 CI 预算，并运行完整 API hotspot。
外部 mock helper 必须是领域特定且测试专用的生命周期边界；只有创建、监听、既有环境变量和关闭路径均无
跨子测试引用时才能提取；可变失败或扫描状态必须仍由所属子测试通过最小 control API 显式按原顺序驱动，
helper 不得自行恢复或重试。
按请求类型生成的 synthetic receipt 映射必须保持原值与请求计数语义；synthetic 响应不得描述为真实
provider receipt、外部送达或现场证据。

## 4. 完成条件

- 公共行为未意外变化；预期变化有批准和契约更新。
- 新旧路径不重复写同一事实源。
- 所属进程验证、专项测试和 required checks 通过。
- `/review` 无未处理高风险发现。
- 地图、分类、ADR、迁移和回滚说明同步。
- 旧实现只有在无调用证据充分时才删除。
