# ADR：静态内容安全边界

- 状态：Accepted
- 日期：2026-08-18
- Owner：T00（发布/组合根）+ T01（安全评审）+ 数据 owner（公开演示分类）
- 影响范围：静态服务、Pages、Service Worker、演示数据、部署包

## Problem

`serveStatic` 从仓库 `ROOT` 解析任意非越界路径；静态页面守卫对非 HTML 请求直接返回 `ASSET` allowed。`data/db.json` 被 Git 跟踪、多个页面读取、Pages 发布且进入 Service Worker 缓存。路径遍历保护不能阻止读取仓库内本来就存在的数据库快照、源码、环境模板或 Git worktree 元数据。

## Options

1. 维持仓库根目录静态服务，仅依赖页面鉴权。
2. 增加敏感路径 denylist。
3. 建立显式发布 manifest/独立 public 根，只允许列出的 HTML/CSS/JS/图标和经批准的合成数据。
4. 完全取消静态演示和 Pages。

## Advantages

方案 3 默认拒绝未知文件、可测试、与构建制品一致，同时保留静态演示。它把“什么能发布”变为显式契约，而不是依赖不断补充 denylist。

## Disadvantages

需要盘点 44 个页面及其资源；旧相对路径、Service Worker、Pages 和直接打开 HTML 的方式可能需要兼容层。资源漏登记会产生可见 404。

## Migration cost

中到高。需要生成/维护 manifest、迁移 `data/db.json` 消费者、更新缓存版本、补负向测试、调整 Pages/部署包并验证所有角色页面。

## Risk

直接切断快照会让静态演示不可用；缓存迁移不完整会继续保留旧数据；误将真实数据复制到新 public 目录会让结构修复失效；仓库历史中若存在敏感数据还需另行清理和轮换。

## Recommendation

选择方案 3。由一份机器可读 manifest 同时约束 Node 静态服务与 Pages 制品；`data/db.json` 只作为运行时/迁移输入，公开演示由统一纯函数合成，删除凭据字段并稳定掩码身份与联系字段。非目标：本 ADR 不改变 API 鉴权、不删除静态演示、不重写 Git 历史。

## Implementation and rollback

- 实现分支：`process/t00-static-content-boundary-20260818`。
- 兼容：保留 44 个 HTML 入口、现有浏览器资源、两份明确列入清单的 DRG/DIP 空白下载模板和静态演示；其他仓库文档、源码、配置、环境模板、Git 元数据及源快照不发布。
- 缓存：Service Worker 提升到 v60，只缓存 `data/public-demo.json`，激活时删除旧缓存。
- 回滚：回退本实现提交并重新部署前一制品；由于旧边界会重新暴露仓库根和源快照，只允许应急、限时回滚。若回退后再次前滚，必须再次提升缓存版本。
- 验收：资产清单构建、敏感路径拒绝矩阵、脱敏纯函数、Pages 独立制品、API 静态边界和既有存储脱敏测试必须通过；公开快照中的个人姓名、身份和联系字段均使用稳定演示掩码。
