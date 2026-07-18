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

`.env`、私钥、证书私钥容器和 `secrets.*` 不得进入制品。TLS 证书、公钥链和非敏感信任锚可以由基础设施层挂载，但私钥必须留在受控密钥系统。

## 正式生产边界

部署包校验通过不等于生产环境已经正式验收。上线前仍须完成不可变制品仓库或只读发布目录、真实密钥提供方、域名与 TLS、服务账号和目录权限、数据库备份、回滚演练、生产 smoke 及多方签字。
