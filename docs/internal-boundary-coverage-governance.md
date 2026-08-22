# TEST-001 补充：关键内部边界覆盖率治理

本文件记录 TEST-002 的首批关闭边界，并补充 TEST-001 标准门禁。它不改变运行时、数据库、API 或部署架构，因此不新增 ADR。

## 独立覆盖组与冻结基线

| 分组 | 范围 | 行 | 函数 | 分支 |
|---|---|---:|---:|---:|
| runtime identity policy | `src/identity-security/runtime-identity-policy.js` | 96.83% | 100% | 64.84% |
| audit chain/source | `audit-chain.js`、`audit-delivery-source.js` | 93.19% | 100% | 74.49% |
| object storage trust | `secure-object-storage.js` | 97.63% | 100% | 69.27% |
| API catalog/authorization | `api-authorization-matrix.js`、`production-api-catalog.js` | 95.66% | 92.30% | 80.97% |

基线来自当前真实专项测试结果，配置位于 `config/internal-boundary-coverage.json`。后续变更只能持平或提高；降低阈值必须作为独立治理决策评审，不能随业务改动静默放宽。原 `server.js` 的 `85/85/55` 门禁保持不变。

## 负向矩阵

- 身份：生产 bearer/hybrid 未通过显式兼容门禁时必须保持 `NO-GO`。
- 审计：突变、删除、插入、重排和结构缺陷必须被拒绝。
- 对象存储：签名响应 body 绑定漂移必须被拒绝，provider 错误不得泄露。
- API：缺鉴权分类、method/path 漂移、缺幂等分类和生产误 promotion 必须失败关闭。

治理测试把这些精确测试标题与分组锁定，并要求四个覆盖组各有直接负向合同，避免覆盖率数字替代安全语义断言。

## 报告与生产边界

`npm run test:coverage:boundaries` 复用现有 c8 和既有测试，不新增依赖。原始数据和 JSON/text 报告只写入操作系统临时目录，命令结束即删除；不得提交覆盖报告或把它作为生产事实源。

覆盖率只证明已执行的仓库测试范围，不是外部漏洞扫描、真实身份源、WORM/KMS、对象存储、网络或现场验收证据。生产状态继续保持 `NO-GO`。
