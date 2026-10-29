# FACTORY KIT — 十脑造物局

> 一次真实的多智能体协作开发记录，以及从这次记录里提炼出的可复用流程。
> 不是理论，是"我们真这么干了一遍，哪里有坑"。

## 这是什么

2026-10-29 夜，一个 Lead + 8 个 AI Agent 在约 9 小时内，把一个决策辅助工具
「反悔雷达 / Decision Arena」从零做到可运行、可测试、可审计、可发布。

这份手册记录**流程本身**，不是产品本身。目标是让另一支团队（人或 AI）能复用这套协作方式，
并且**避开我们踩过的坑**。

## 一句话结论

> 多智能体能产出的前提不是"人多"，而是**写入区不重叠 + 验收标准可执行 + 有人独立复核**。
> 缺任何一个，多出来的 Agent 只会增加合并冲突和虚假的完成感。

## 文件索引

| 文件 | 内容 | 什么时候读 |
|---|---|---|
| [ROLES.md](ROLES.md) | 角色卡：职责 / 写入区 / 验收 / **失败模式** | 组建团队前 |
| [FILE_OWNERSHIP.md](FILE_OWNERSHIP.md) | 文件所有权与冲突防止 | 分配任务前 |
| [TASK_PROTOCOL.md](TASK_PROTOCOL.md) | 消息模板、任务状态机、依赖表达 | 开始派任务时 |
| [QUALITY_GATES.md](QUALITY_GATES.md) | 三层门禁 + 什么叫"真测试" | 定验收标准时 |
| [LESSONS.md](LESSONS.md) | **6 个真实踩坑记录** | 任何时候，尤其复盘 |
| [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md) | 从本地能跑到公网已验证 | 准备发布时 |
| [LEAD_HANDOFF_PROMPT.md](LEAD_HANDOFF_PROMPT.md) | 可直接复制的接力提示词 | 换 Lead 时 |

## 适用与不适用

**适用**
- 有一个边界清楚的产品（不是开放研究）
- 有一个能裁决、能写代码的 Lead
- 有可自动化的验收方式（测试、构建、静态检查）

**不适用**
- 需求还在探索期（这时候并行只会产生互相矛盾的方案）
- 无法定义"完成"长什么样
- 没有 Lead 做最终集成（否则没人对整体负责）

## 这份手册的可信度

我们尽量只写有证据的东西。每条"我们做了 X"都能在项目文件里找到来源：

- 角色分工与写入区 → `docs/product/PRD.md`、`FILE_OWNERSHIP.md`
- 验收标准 → `docs/product/ACCEPTANCE_CHECKLIST.md`
- 测试真实结果 → `tests/core/README.md`、`tests/qa/`
- 缺陷与修复 → `tests/core/FINDINGS.md`、`LESSONS.md`（内部缺陷记录的脱敏版）
- 协作过程的坑 → `LESSONS.md`

**没有写进去的**：Token 消耗、效率提升百分比、任何"AI 比人快 N 倍"的结论。
我们没有可靠数据支撑这些，所以不写。
