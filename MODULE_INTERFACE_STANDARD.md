# 模块标准接口

## 1. 目标结构

```text
HTTP / Worker / CLI / UI 入口
  → 协议适配器
  → 领域用例端口
  → 仓储 / 事件 / 外部系统端口
  → SQLite / PostgreSQL / HTTP / provider 实现
```

## 2. 接口最低要求

每个公共模块接口必须明确：

- owner 和所属 T00–T09 进程；
- 输入、输出、错误和异步语义；
- 身份、角色、权限和数据范围；
- 幂等键、版本/CAS 和重试语义；
- 数据 owner、事务和审计副作用；
- 外部依赖、超时、故障和降级；
- 兼容窗口、测试和观测指标。

## 3. HTTP 路由标准

- 路由只做解析、认证上下文、校验、服务调用和响应映射。
- 新领域路由进入所属 `src/http/routes/<domain>`，不得回到 `server.js`。
- 只有 T00 可改变 `ROUTE_ORDER`、公共错误/认证协议和运行时组合。
- handler 完成响应返回 `true`；未命中返回/自然结束为 `false`。
- 错误使用稳定 `code`，不向调用方泄露内部错误栈或敏感字段。

## 4. 领域服务标准

- 构造函数/工厂显式接收小型端口，不接收包含上百函数的全局 runtime。
- 服务不 require `server.js`，不读取路由源码判断能力是否存在。
- 业务不直接依赖 JSON/SQLite/PG 具体实现。
- 跨域读取通过版本化查询契约；跨域写入调用 owner 端口或提交事件。

## 5. 仓储与数据标准

建议端口：

```js
repository.get(id, context)
repository.list(query, context)
repository.save(entity, { expectedVersion, context })
repository.transaction(callback, context)
```

- `context` 包含 actor、tenant/region/institution、correlationId 和授权范围。
- `save` 明确 CAS/幂等；禁止静默 last-write-wins。
- 生产实现遵守 `domain-data-ownership`，禁止未注册集合写入。
- outbox 与业务提交同事务；投递 worker 幂等、可重试、可核对。

## 6. 外部适配标准

- 配置只接受凭据引用，不把真实密钥写入 JSON、日志或证据。
- 明确协议版本、超时、重试、签名、nonce、时钟窗口和 circuit 状态。
- 对外错误转换为领域错误；保留 correlationId，不泄露 provider 响应原文。
- mock/simulated 响应在生产 fail closed。

## 7. 前端标准

- API 统一通过 client；组件不直接 fetch `data/db.json` 作为生产回退。
- 文本使用 `textContent`；HTML 必须来自审计过的模板/净化接口。
- 身份以 HttpOnly Cookie 上下文为准，localStorage 只允许明确的非敏感演示状态。
- 页面必须覆盖加载、空、失败、无权、过期和重试状态。

## 8. 渐进迁移

1. 为遗留入口建立特征测试。
2. 定义最小端口和兼容适配器。
3. 将一个用例移到端口后。
4. 运行专项、架构和全量回归。
5. 记录剩余调用方和回滚路径。
6. 只有全部调用者迁移后才删除旧入口。
