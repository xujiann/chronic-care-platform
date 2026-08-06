# 单地区验证部署模板

该目录只用于验证环境。一个容器或一个 systemd 服务只绑定一个
`REGION_CODE`；不得在请求中动态切换地区。

先从无密钥站点描述生成部署计划：

```bash
node scripts/regional-deployment-plan.js \
  --descriptor=deploy/validation/sites.example.json \
  --generated-at=2026-08-06T00:00:00.000Z \
  --write
```

输出位于 `release/deployments/<deploymentId>/`，包括 JSON、Markdown、逐站点
systemd 单元、激活环境和 Compose 文件。生成内容绑定 Git 提交、核心身份摘要、
地区内容摘要和组合发布摘要。

容器验证：

```bash
cp release/deployments/regional-validation-example/env/synthetic-region-validation.activation.env \
  deploy/validation/site.activation.env
docker compose --env-file deploy/validation/site.activation.env \
  -f deploy/validation/docker-compose.yml up --build
```

真实密码、会话密钥、OIDC Client Secret、接口令牌和私钥必须由外部密钥服务
注入，不得加入站点描述、激活环境模板或仓库。测试地区若声明
`stage=production`，生成器会直接拒绝。所有计划保持 `productionReady=false`；
现场联调、安全、灾备、验收和审批证据不能由代码生成。
