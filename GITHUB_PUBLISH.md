# GitHub 发布说明

当前仓库：

```text
https://github.com/xujiann/chronic-care-platform.git
```

当前推荐分支：

```text
codex/complete-health-platform
```

## 常用发布流程

查看改动：

```powershell
git status -sb
git diff --stat
```

提交：

```powershell
git add -- README.md DEPLOYMENT.md GITHUB_PUBLISH.md docs
git commit -m "update platform documentation"
```

推送：

```powershell
git push -u origin codex/complete-health-platform
```

## GitHub CLI 状态

当前机器已安装 `gh`，但可能未登录。检查：

```powershell
gh auth status
```

如果需要创建 PR：

```powershell
gh auth login
gh pr create --draft --fill --head codex/complete-health-platform
```

只推送代码时，`git push` 通常已足够。

## GitHub Pages

GitHub Pages 只能托管静态页面：

- HTML
- CSS
- JS
- `data/db.json`
- Markdown 文档

Node.js 后端 `server.js` 不能直接运行在 GitHub Pages 上。

## 建议仓库策略

当前阶段继续使用单仓库：

```text
chronic-care-platform
```

原因：

- 所有演示页面共享同一套数据快照。
- 统一运营工作台需要横跨各端读取状态。
- 目前仍处于 MVP 和方案验证阶段，频繁拆仓会增加同步成本。

后续生产化可拆分为：

```text
health-platform-admin
health-platform-citizen
health-platform-api
health-platform-docs
```

拆分前应先完成 API 契约、数据库表结构和权限边界。
