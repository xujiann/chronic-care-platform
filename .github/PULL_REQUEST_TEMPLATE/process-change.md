## 进程交付

- 进程：`TNN`
- 基线 ref/SHA：
- 分支：`process/tNN-<topic>-YYYYMMDD`
- 领域路由：
- 运行时新增依赖：

## 修改范围

- 业务文件：
- 测试文件：
- 文档：
- 数据迁移影响：

## 验证

- [ ] `npm run process:verify`
- [ ] `npm run routes:check`
- [ ] `npm run routes:test`
- [ ] 所属领域专项测试
- [ ] 未修改其他进程的受保护文件

## T00 合入事项

- [ ] 无需修改 `ROUTE_ORDER`
- [ ] 无需修改 `server.js` 依赖装配
- [ ] 无需修改部署制品或发布门禁
- [ ] 外部现场阻断项已单独列出，未宣称生产 Go
