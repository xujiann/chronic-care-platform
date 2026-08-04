# 外部系统预生产联合测试与双签回执闭环

## 交付结论

本增量提供 T08 所有权范围内的预生产联调控制面，不执行真实外部调用，也不保存端点、账号、令牌、私钥、患者数据或原始报文。

控制面覆盖 12 类外部系统：

- 医院核心：HIS、EMR、LIS、PACS；
- 身份和消息：OIDC、短信；
- 资金和证照：医保、支付、电子证照；
- 监管和运维：公共卫生直报、SIEM、值班工单。

每类接口都必须完成 8 个场景：正常、幂等重放、超时重试、拒绝补偿、乱序回调、重复回调、密钥轮换、对账。合计 96 个外部场景回执，缺少任意一项均输出 `NO-GO`。

## 功能边界

`src/platform/integration/external-joint-test-campaign.js` 负责：

1. 加载并验证元数据化活动清单；
2. 生成 96 项待执行场景，不推断外部成功；
3. 校验回执与活动、接口、场景、执行窗口和摘要的绑定；
4. 使用 Ed25519 公钥校验平台方与外部责任方两个独立签名；
5. 识别缺失、重复、篡改、过期和撤销证据；
6. 输出可交给现有切换控制面的 `regional-joint-test-evidence-v1` 投影。

即使所有场景通过，模块仍保持：

```text
productionReady=false
credentialsExposed=false
patientDataExposed=false
```

`JOINT-TEST-PASSED` 只表示这批外部证据在当前评估时刻完整、有效且双签可信，不是生产切换命令。

## 场景验收矩阵

| 场景 | 强制断言 |
|---|---|
| 正常 | 外部接受、关联标识绑定、返回接收回执 |
| 幂等重放 | 重复被抑制、业务结果一致、副作用仅一次 |
| 超时重试 | 有界重试、复用幂等键、最终接受，且尝试次数为 2–4 次 |
| 拒绝补偿 | 外部明确拒绝、补偿留痕、无未提交副作用 |
| 乱序回调 | 检出乱序、关联标识绑定、状态不倒退 |
| 重复回调 | 重复被抑制、关联标识绑定、副作用仅一次 |
| 密钥轮换 | 旧密钥被拒、新密钥被接受、轮换审计留痕 |
| 对账 | 对账匹配、差异数为零、责任人确认 |

断言只记录布尔或计数结论。请求和响应只记录 SHA-256 摘要与受控证据引用，禁止将原始业务报文放入证据包。

## 双签规则

每个场景回执恰好需要两个独立证明：

- `platform`：平台联调责任人；
- `external`：外部系统责任人。

两个证明必须使用不同账号和不同公钥。公钥登记必须：

- 算法固定为 Ed25519；
- 状态为 `active`；
- 在签发时和评估时均有效；
- 明确列出可签署的接口；
- 仅包含公钥，不得包含私钥。

签名对象由 `createExternalJointTestReceiptSubject` 生成，绑定活动摘要、接口、场景、运行编号、执行时间、失效时间、请求/响应摘要、证据引用及断言。签名后修改任意字段都会验证失败。

## API

T08 路由已接入两个只读/评估入口：

- `GET /api/integration/joint-test-campaign`：commission、institution 可查看元数据化活动计划；
- `POST /api/integration/joint-test-campaign/evaluate`：仅 commission 可提交公钥登记和证据包进行无状态评估。

POST 请求结构：

```json
{
  "trustRegistry": {
    "schemaVersion": "external-joint-test-trust-registry-v1",
    "keys": []
  },
  "evidenceBundle": {
    "schemaVersion": "external-joint-test-evidence-bundle-v1",
    "campaignId": "regional-preproduction-joint-test-20260804",
    "campaignDigest": "sha256:<64-hex>",
    "receipts": [],
    "revocations": []
  }
}
```

接口不持久化上传内容，也不会把配置就绪视为联调成功。正式运行应由 T00 使用受控绝对文件和发布包生成器读取证据，避免把大型证据包长期通过请求路径传递。

## 现场执行步骤

1. T00 固化本次不可变发布包和活动摘要。
2. T08、机构及外部厂商确认接口范围、责任人、公钥范围和网络窗口。
3. 使用脱敏或合成数据执行 96 项场景。
4. 每项场景归档请求摘要、响应摘要、可追踪引用和外部回执引用。
5. 平台责任人与外部责任人分别对同一规范化主题签名。
6. 汇总撤销登记并执行评估。
7. `NO-GO` 时按缺失、无效、过期或撤销分类整改后重新签署，不覆盖旧证据。
8. 全部通过后将 `regionalJointTestEvidence` 交给 T00 的切换证据包；现场委员会仍需独立审批。

## 证据模板

- `docs/evidence-templates/external-integration/external-joint-test-evidence-bundle.template.json`
- `docs/evidence-templates/external-integration/external-joint-test-trust-registry.template.json`
- `deploy/external-joint-test-campaign.env.template`

模板是结构示例，不是已通过的外部证据。

## T00 集成交接

以下文件由 T00 独占，本分支未修改：

1. 在 `package.json` 增加联调计划/评估脚本；
2. 在中央部署环境模板和部署包生成器中纳入三个绝对文件引用；
3. 在 `config/process-workstreams.json` 将新增模块、T08 子路由、活动清单和测试登记为 T08 所有；
4. 在 `config/platform-iteration-program.json` 将 96 项双签结果纳入迭代 3 外部门禁；
5. 在切换包生成流程中读取 `regionalJointTestEvidence`，并保持现有摘要重算校验；
6. 将 `test/external-joint-test-campaign.test.js` 纳入中央迭代测试命令。

中央接线前，仓库内 API 可用于受控的无状态评估；部署环境变量模板仅为 handoff，不代表运行时已读取。
