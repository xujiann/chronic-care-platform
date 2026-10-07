# GS03 内存事务适配

- 状态：Accepted
- 日期：2026-10-07；决策 ADR-GS03-MEMORY-001；任务 GOV-033、OPS-053。
- 限域依据：用户确认非生产共同事务路线并继续开发，用户统一协调、专业事项另签。仅合成内存事务适配开发测试，不授权文件数据库、HTTP、生产、推送或合并；父CALLBACK/STORAGE/S2仍Proposed。

## Problem

结果执行器不拥有数据库事务。真实适配器必须区分本次取得的事务与其他调用已存在的事务，避免begin拒绝后的清理误回滚别人。单main空file的PRAGMA不能证明内存来源，SQLite空路径临时库也可能满足。

## Options

1. 接收任意外部连接并依靠PRAGMA判断内存：来源不足，不采用。
2. 工厂只创建精确:memory:，内部持有连接和同连接租约：本片选择。
3. 持久权威、正式schema、业务与HTTP接线：专业决策未齐，不在范围。

## Contract

createGs03MemoryTransactionSession仅接受environment=development/test，不接受数据库路径、外部连接或额外配置。内部new DatabaseSync(':memory:')；原生isTransaction必须为布尔，否则关闭自有连接并拒绝，不改变全项目Node engines。

session只提供createPort({apply,verify})和close及固定productionReady=false；port对应一次事务，兼容既有runGs03Transaction的五阶段。成功BEGIN IMMEDIATE后才拥有事务。同session多个port共享租约，已有外部事务或其他port占用时begin拒绝；未曾取得事务的rollback不执行SQL，仅证明本调用尚未业务写入。

apply/verify是可信同步合成回调，显式获得自有内存连接；不接受外部请求中的函数。apply只返回first/replay，verify必须true。各阶段复核事务存在、租约及未附加其他库；正常COMMIT后确认事务结束才成功。曾拥有事务后事务消失、COMMIT/ROLLBACK异常或无法确认结果，都隔离整个session，新port不能绕过。不在本片实现恢复或清除隔离。

回调禁止BEGIN/COMMIT/ROLLBACK、ATTACH/DETACH、关闭或外泄连接、异步逃逸；不是不可信SQL/回调沙箱。发现Promise/thenable即隔离，runner收到unknown，不因随后cleanup而宣称零写；不能取消回调自行安排的异步任务。相同连接的裸SQL提交后再BEGIN等ABA和其他绕开适配器的写者不在本片保证内。

close在活动正常事务时拒绝；调用方可显式销毁隔离的整份自有内存session。销毁不是持久业务恢复或已确认回滚证据。无文件读取、网络、provider、默认启动或持久事实。

已提交port随后收到rollback时，适配器无法区分误用与外层提交响应丢失，因此保守隔离整个session。此操作不执行SQL、不回滚其他port已开始的事务，但会阻止其继续提交；调用方须显式销毁隔离session，不将其误报为已确认零写。

## Advantages and Disadvantages

真实SQLite执行与租约保护可组合验证，不再仅相信测试port返回true。仅验证合成内存、合作适配器与受信任回调，不能替代专业签署、授权/回执权威、外部scope或所有写者保护。

## Migration cost

不改现有schema、migration、runner或实验helper；合成表只在专项中建立。回滚移除未接线模块及测试，不修改业务数据。

## Risk

内存结果不持久，不承诺重启恢复、长期幂等、跨进程或生产能力。异常隔离不能用新port或重新建session当作已完成业务对账。留存/恢复政策不填默认值，生产六域NO-GO。

## PLAN

先核PR337精确冻结f4703b2d、merge fba3c706和共同tree46323f0，再按PR/main各9成功闭合GOV032/OPS052限定交付。T00独占治理与六图，T08独立工作树只写新模块及专项，WIP2增4。先登记后实现；覆盖来源、环境、能力门禁、first/replay、双port租约、外部事务、非法顺序、自动回滚、异步误用、失去事务、关闭和脱敏。独立审查后冻结串行18门禁，不推送合并上线。
