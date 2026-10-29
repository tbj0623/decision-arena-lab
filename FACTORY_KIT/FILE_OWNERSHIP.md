# FILE OWNERSHIP — 文件所有权与冲突防止

## 为什么需要这个

多个 Agent 共享同一个文件系统。**没有文件锁。** 两个成员同时写同一个文件的结果是：
后写的覆盖先写的，而且**两边都以为自己成功了**——不会报错，只会丢工作。

这是多智能体协作里最贵的失败方式，因为它是**静默的**。

## 核心规则

> **一个文件，同一时刻，只有一个写入者。**

不是"尽量不重叠"，是硬规则。重叠就是事故。

## 本次项目的实际分区表

| 写入者 | 独占写入区 | 只读区 |
|---|---|---|
| **Lead** | 根目录（`README` `STATUS` `BLOCKERS` `CHECKPOINT` `FINAL_REPORT` `HANDOFF`）、`scripts/`、`docs/`、`FACTORY_KIT/`、`site/core.mjs` | 全部 |
| product-owner | `work/product/` | `site/core.mjs`、`docs/` |
| logic-engineer | `tests/core/` | `site/core.mjs`（**只读**） |
| ux-writer | `site/styles/`、`work/ux/` | `site/index.html`、`site/app.mjs` |
| ui-engineer | `site/index.html`、`site/app.mjs` | `site/core.mjs`、`site/features/` |
| story-engineer | `site/features/`、`site/data/` | `site/core.mjs`（**只读**） |
| qa-engineer | `tests/qa/`、`work/qa/` | 全部（只读） |
| red-team | `work/red/` | 全部（只读） |
| growth-producer | `marketing/` | `README`、`docs/LIMITATIONS.md` |
| release-engineer | `.github/`、`docs/release/`、`work/release/` | 全部（只读） |

**注意**：`site/core.mjs` 只有一个写入者（Lead），但**有五个读者**。
这是刻意设计的「**多读一写**」模式。

## 多读一写模式

本次项目里，`site/core.mjs` 被 3 个成员同时读来做**独立验证**：

- product-owner 用它实算 5 条用户旅程 → 发现了越界阈值的 bug
- logic-engineer 用它做对拍和变异测试 → 发现了一个测试断言的前提错误
- story-engineer 用它验证示例数据的合理性 → 发现了 `direction: 'hold'` 未被处理

而它全程只有一个写入者（Lead）。

**为什么有效**：读的人不做修改，所以不会有冲突；但**每个人都用自己的方式重算了一遍**，
所以能从不同角度发现同一个文件的错误。

**这个模式的代价**：写入者改完之后，**必须重跑全部测试**，因为读者的结论可能已经过期。
本项目里 Lead 改 `core.mjs` 两次，每次都重跑了：
```bash
node --test                    # 45 条算法测试
node work/product/verify-journeys.mjs   # 5 条旅程对拍
```

**这个模式的前提**：读者不能"顺手改一下"。一旦读者变成写者，模式立刻失效。

## 跨区修改怎么办

**不要直接改别人的文件。** 三个步骤：

1. **写建议文件**到自己的区，例如 `work/product/SUGGEST_core_api.md`，
   内容是：问题、复现输入、期望行为、建议改法。
2. **send_message 给 Lead**，一句话说明"建议已写，路径是 X"。
3. **Lead 判断并合并**。如果接受，由 Lead（或该文件的唯一写入者）修改，然后重跑全部测试。

本次真实例子：
- product-owner 发现 `core.mjs` 的越界 bug → 写进验收清单 B-15 + 发消息 → Lead 修
- logic-engineer 发现 `AT_THRESHOLD` 的 UI 契约问题 → 写进 `tests/core/FINDINGS.md` + 发消息 → Lead 修
- 两次都没有人越过写入区去改别人的文件。

## 如果两个成员真的必须改同一个文件

用**串行方案**，不要并行：

```
时间 →
成员 A: [读] [改] [跑测试] [报告] ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
成员 B: ┄┄┄┄┄┄┄┄┄┄┄┄[等 A 完成] [读最新版] [改] [跑测试] [报告]
```

具体操作：
1. Lead 在任务板上给这个文件建**一条串行任务**，明确"A 先做，完成后 B 才开始"
2. A 完成后必须 **commit**（让状态可回溯）
3. B 开始时**必须重新 read 文件**，不能依赖自己之前读到的版本
4. B 改完必须**重跑 A 的测试**，确认没打破 A 的假设

**这比并行慢，但比合并冲突快。** 并行改同一个文件的成本是：两次修改 + 一次人工合并 + 一次回归，
几乎总是比串行更慢，而且更容易出错。

## 文件系统的"读后写"保护

本项目使用的工具链有一个「先读后写」策略：**没读过就写会报错**，读完之后如果文件被改过再写，
会报 `FS_STALE_VERSION`。

遇到 `FS_STALE_VERSION` 的正确处理：
1. **重新读**文件（拿到最新内容）
2. 把自己的改动**重新应用到新内容上**
3. 再写

**不要**忽略这个错误继续写 —— 那意味着你会覆盖掉别人刚做的修改。

## 交付清单（每个成员每次交付都必须包含）

消息长度 ≤ 1KB，格式固定：

```
任务ID：
状态：DONE / BLOCKED / NEEDS_REVIEW
修改路径：（列出所有写过的文件）
核验命令及结果：（真实命令 + 真实数字）
风险：（一个最高风险）
下一步：（一条建议）
```

**为什么强制这个格式**：它逼成员交代"我怎么证明我做完了"。
没有「核验命令及结果」这一栏，"DONE"就只是一个词。
