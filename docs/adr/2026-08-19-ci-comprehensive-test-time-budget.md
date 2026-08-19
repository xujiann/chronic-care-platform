# ADR：综合 CI 采用 15 分钟有界时间预算

- 状态：Superseded
- 日期：2026-08-19
- Owner：T00
- 影响范围：GitHub Actions 综合 test job、CI 反馈时限、主线验收

## Problem

综合 `test` job 在同一个 runner 上顺序执行所有权、治理、架构、专项门禁、API 回归、
Chromium 安装、36 个浏览器 E2E 以及大量 readiness/report/deployment 命令，但配置的
硬上限只有 10 分钟。PR #122 合并后的 main run `32208514622` 连续两个 attempt 均在
约 10 分钟处被取消：全量单元/集成与其他四个 job 已成功，综合 job 已通过 API 回归，
取消发生在 E2E，日志没有测试失败。两个 attempt 的 Chromium 安装分别约 5 分钟和
3 分钟，证明干净 runner 的依赖安装波动能够耗尽现有预算。

## Options

1. 维持 10 分钟预算，发生取消时人工重跑。
2. 仅把综合 `test` 的有界预算调整为 15 分钟，保持区域矩阵 5 分钟和
   complete-unit-test 10 分钟，并增加配置回归测试。
3. 立即拆分综合 job、缓存浏览器或重构全部 readiness 流程。

## Advantages

- 方案 1 无配置变化，真实挂起仍会快速终止。
- 方案 2 是低成本、可回滚的容量修复，为已观测的安装波动和后续检查保留约 5 分钟
  余量，同时不降低或删除任何 required check。
- 方案 3 能获得更好的并行度、定位能力和长期运行时间隔离。

## Disadvantages

- 方案 1 会继续把 runner 波动误报为主线失败，并依赖人工重跑。
- 方案 2 会让真实挂起最多晚 5 分钟反馈，且不能解决综合 job 过大这一结构问题。
- 方案 3 改动范围和验证成本较高，会把一次确定的容量修复扩大为 CI 架构重构。

## Migration cost

低。修改一个 workflow 数值，增加确定性契约测试，并同步 ADR、依赖地图、技术债和
当天计划。不增加依赖，不改变业务代码、测试命令、数据库、API、鉴权或部署拓扑。

## Risk

- 15 分钟仍可能在极端 GitHub runner 或网络异常下耗尽；出现新证据时应先拆分 job，
  不得无限增加时限。
- 正则契约测试可能因无关 YAML 格式变化失败；这是有意的治理信号，要求显式评审三个
  job 的预算。
- 更长预算不得掩盖测试失败；所有原步骤、顺序、required checks 和失败语义保持不变。

## Recommendation

采用方案 2。综合 `test` 使用 `timeout-minutes: 15`，区域矩阵和 complete-unit-test
分别保持 5 与 10 分钟；测试同时锁定三项预算，防止误改其他 job。CI-001 继续保留，
后续按风险域拆分综合 job，但不把该长期工作混入本次修复。

迁移先通过独立 T00 PR 验证，再合入 main 并观察合并后 push CI。回滚只需回退该 T00
提交；不得通过删除 E2E、跳过 readiness、放宽 required checks 或无限重跑替代修复。

> 2026-08-19：PR #125 的两个 attempt 证明 15 分钟单体预算仍会被 Chromium 系统依赖
> 安装耗尽。本 ADR 的有界预算原则保留；单体 job 拓扑由
> `2026-08-19-ci-risk-domain-job-split.md` supersede。
