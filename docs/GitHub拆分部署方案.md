# GitHub 拆分部署方案

更新日期：2026-06-18

当前项目建议继续采用单仓库推进，等接口和权限模型稳定后再拆分前端与 API。这样能避免在 MVP 阶段因为目录迁移影响演示路径。

## 1. 当前仓库形态

```text
chronic-care-platform/
  login.html
  health-city.html
  workbench.html
  index.html
  county.html
  institution.html
  insurance.html
  citizen.html
  mobile-preview.html
  server.js
  data/
  docs/
```

当前页面仍放在根目录，便于 GitHub Pages 静态预览，也便于本地 Node 服务直接提供页面和 API。

## 2. 推荐部署阶段

| 阶段 | 方式 | 适用目标 |
|---|---|---|
| 阶段 1 | 单仓库 + 本地 Node 服务 | 演示、审计、功能验证 |
| 阶段 2 | 单仓库 + GitHub Pages 静态预览 | 展示页面和文档，不保留服务端写入 |
| 阶段 3 | 前端静态托管 + Node API | 多角色共用数据、保留写入和审计 |
| 阶段 4 | 拆分 admin/citizen/api 仓库 | 团队协作、独立发布、正式运维 |

## 3. GitHub Pages 能做什么

适合：

- 展示登录页、各端页面和文档。
- 展示静态演示数据和页面交互。
- 发布项目说明、流程图和 README。

不适合：

- 运行 `server.js`。
- 提供 `/api/state`、`/api/personal-records` 等写入接口。
- 持久化 `data/db.json`。
- 承担真实认证、权限和审计。

## 4. 后续拆分建议

正式拆分时可采用：

```text
health-admin-web
health-citizen-web
health-platform-api
health-platform-docs
```

拆分条件建议至少满足：

- API 路由稳定，状态模型不再频繁重命名。
- 登录认证、角色权限、居民授权和审计模型成型。
- 前端页面已明确哪些属于管理端、居民端、机构端和医保管理与经办。
- 自动化测试能覆盖登录、状态读取、居民端和运营工作台关键路径。

## 5. 当前推送策略

当前远端分支为 `codex/complete-health-platform`。建议每轮完成一个清晰主题后提交：

```powershell
git status --short
npm.cmd run check
git add <files>
git commit -m "说明本轮主题"
git push -u origin codex/complete-health-platform
```

若要打开 PR，需要先完成 `gh auth login`，否则只能完成 Git 推送，不能通过 GitHub CLI 创建草稿 PR。
