# 生产部署包与密钥注入自动化

## 已实现能力

- `npm run deployment:package` 为根目录运行文件生成 SHA-256 清单、整体制品摘要、发布编号和来源提交信息。
- `npm run deployment:verify` 在部署前复算文件大小、文件摘要和整体摘要，发现缺失、修改或额外敏感文件时阻断。
- 部署包只记录密钥变量名、用途和注入方式，不读取或持久化密钥值。
- 进程契约固定 Node 入口、生产依赖安装命令、优雅停止时间、重启策略及健康/就绪/指标探针。
- 回滚契约要求上一版本制品摘要、数据备份、回滚快照和回滚后健康检查。
- `deploy/chronic-care-platform.service.template` 提供最小权限 systemd 模板，业务目录只读，仅数据和日志目录可写。

## 使用方式

```powershell
npm.cmd run deployment:package
npm.cmd run deployment:verify
```

CI 或正式制品构建必须使用严格模式：

```powershell
npm.cmd run deployment:package -- --strict --release-id=<release-id>
npm.cmd run deployment:verify
```

## 生产配置契约

正式环境必须由 Vault、KMS 或容器/进程编排器注入密钥，并设置：

```text
DEPLOYMENT_SECRET_PROVIDER=vault|kms|orchestrator
DEPLOYMENT_RELEASE_ID=<approved-release-id>
DEPLOYMENT_ARTIFACT_DIGEST=sha256:<64-hex-digest>
DEPLOYMENT_APP_DIR=<read-only-release-directory>
DEPLOYMENT_SECRET_ENV_FILE=<root-owned-secret-file-or-provider-mount>
```

严格生产预检还需要部署方在仓库外挂载两份 metadata-only JSON，并独立固定 trust-anchor bundle：

```text
PRODUCTION_EVIDENCE_TRUST_ANCHORS_FILE=<absolute-regular-file>
PRODUCTION_EVIDENCE_TRUST_ANCHORS_SHA256=sha256:<64-hex-anchor-bundle-digest>
PRODUCTION_EVIDENCE_TRUST_ENVELOPE_FILE=<absolute-regular-file>
PRODUCTION_CUTOVER_ACTION_EVIDENCE_DIR=<absolute-controlled-directory>
```

trust bundle 只含 Ed25519 公钥、key/signer/role、状态和有效期；envelope 只含受控引用、摘要、
release/artifact/evidence/registry 绑定和两个独立角色的 base64url 签名。两者必须是服务账号只读的
普通非符号链接文件且不超过 1 MiB。私钥、原始证据、provider 响应、患者数据和凭据不得进入文件、
环境模板、部署包或报告。anchor 文件摘要必须由独立配置/密钥管理面注入，不能从同一文件旁路读取。

部署前按当前 package、registry 和 evidence directory 执行：

```powershell
npm.cmd run production:preflight:strict -- --package=<package-json> --registry=<registry-json> --evidence-dir=<controlled-evidence-directory> --config-env=<production-env-file>
```

provider 成功仅解除 external trust verifier 的软件装配阻断。缺失、过期、未来时间、撤销 key、重复
signer、错签或任何 release/artifact/evidence/registry 漂移都会失败关闭；audit、live probe、备份、
worker、现场证据和最终审批仍必须全部通过。

行动目录必须为普通非 symlink 目录，并按 definitions-only 台账精确提供 14 个 `<action-id>.json`；每份
envelope 由 `action-evidence-custodian` 与 `independent-release-verifier` 两个独立 signer 签署，绑定前态
转换、证据/指纹/命令回执摘要、release 与 artifact。`production-promotion.yml` 只允许 `main` 手工触发，
依赖 GitHub `production` environment 和专用 `self-hosted, production-promotion` runner。工作流成功时只
上传 `production-promotion-receipt.json`，不上传原始 preflight、证据或签名，也不执行现场部署。

受保护 environment 还必须配置绝对、只读的 `PRODUCTION_DEPLOYMENT_PACKAGE_FILE`、
`PRODUCTION_RELEASE_REGISTRY_FILE`、`PRODUCTION_CONFIG_ENV_FILE`、`PRODUCTION_RELEASE_EVIDENCE_DIR`、
`PRODUCTION_CUTOVER_ACTION_EVIDENCE_DIR`、anchor/envelope 路径变量，并以 environment secret 注入独立
anchor digest pin。仓库不提供这些真实值；缺任一值时工作流失败关闭。

`.env`、私钥、证书私钥容器和 `secrets.*` 不得进入制品。TLS 证书、公钥链和非敏感信任锚可以由基础设施层挂载，但私钥必须留在受控密钥系统。

## 正式生产边界

部署包校验通过不等于生产环境已经正式验收。上线前仍须完成不可变制品仓库或只读发布目录、真实密钥提供方、域名与 TLS、服务账号和目录权限、数据库备份、回滚演练、生产 smoke 及多方签字。
