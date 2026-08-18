# ADR：核心数据 Closed-world 定义

- 状态：Accepted
- 日期：2026-08-18
- Owner：T00 / 各数据 owner
- 影响范围：核心实体、跨域契约、集合和 schema

## Problem

主线有 252 个 JSON 集合和多个领域镜像，同一居民、机构、账户、服务或记录概念容易在新需求中被平行创建。已有 `domain-data-ownership` 只覆盖 83 个集合，不能仅靠命名阻止语义分叉。

## Options

1. 每个功能自由定义自己的核心实体。
2. 建立 closed-world 核心概念清单；默认扩展或引用既有定义，新增/拆分需 ADR。
3. 立即把所有领域统一成一个巨型物理表模型。

## Advantages

方案 2 保留领域自治，同时稳定身份、owner 和跨域关系；能减少重复主索引、数据核对和授权歧义。

## Disadvantages

新需求需要先做概念匹配和 owner 协调；清单需要持续维护；某些合法的新概念必须经过正式决策。

## Migration cost

中。文档和新需求门禁成本低，遗留 169 个未注册集合需要逐步映射、归档或晋升，不能一次完成。

## Risk

清单过宽会形成巨型共享模型；过窄会继续产生别名；强行合并历史数据可能丢失来源语义。必须区分核心身份与领域投影。

## Recommendation

采用方案 2，以 `CORE_DATA_DEFINITIONS.md` 为语义入口、`domain-data-ownership` 为机器 owner 事实、跨域契约为访问方式。禁止无 ADR 创建平行 Resident、PersonIndex、Account、Institution、Practitioner、HealthRecord、DiseaseDefinition、ServiceOrder、ClaimPayment、IntegrationContract 或 AuditEvent。此决策不要求一次性重写遗留集合。
