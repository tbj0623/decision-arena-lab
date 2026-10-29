# FINDINGS — core.mjs 复核记录

复核对象：`site/core.mjs`（16898 bytes，mtime 2026-10-29 19:05:03）
复核方式：45 条 `node:test` 断言 + 独立重算对拍 + 12 组变异测试（见 README）。

**结论：核心数学（评分、归一化、t\* 解析解、projectAtShare 重分配）正确，未发现计算错误。**
45 条测试全部通过。F-01 已由 Lead 按方案 B（只改 UI）修复并验证，F-02 为已修复记录。

> **状态更新（19:2x）**：F-01 已修复 —— Lead 在 `site/app.mjs` 新增 `flipDescription()`，
> 对 `direction === 'hold'` 单独措辞，并在 `buildThresholdList()` 里显示「已打平」。
> `site/core.mjs` 未改动，契约保持不变。已补 `AT_THRESHOLD` UI 契约守卫测试锁定该语义。
> 详见下方 F-01 的「修复结果」小节。

---

## F-01（低）`AT_THRESHOLD` 的 `direction: 'hold'` 会让 UI 输出自相矛盾的文案

**状态**：✅ 已修复（方案 B：只改 UI，`core.mjs` 未动）

**严重级别**：低（纯文案/交互，数学无错，仅在「当前已打平」这一罕见状态下触发）

**现象**

`findFlipThresholds` 在 `|t* − currentShare| < EPS` 时返回：

```js
{ feasible: true, code: 'AT_THRESHOLD', direction: 'hold', distance: 0 }
```

`pickFlipHighlight` 认为 `feasible === true` 就选它做 highlight。但下游两处消费方
都只认 `'increase' | 'decrease'`：

- `site/app.mjs:530`：`${flip.direction === 'increase' ? '提高' : '降低'}`
- `site/features/narrative.mjs:122`：`只要「X」的权重占比从现在的 33.3% 挪到 33.3%`

**复现输入**

```js
const AT = {
  options: [{ label: '甲' }, { label: '乙' }],
  factors: [
    { id: 'k',  label: 'k',  weight: 2, ratings: { A: 8, B: 0 } },
    { id: 'o1', label: 'o1', weight: 1, ratings: { A: 3, B: 7 } },
    { id: 'o2', label: 'o2', weight: 1, ratings: { A: 3, B: 7 } },
    { id: 'o3', label: 'o3', weight: 2, ratings: { A: 3, B: 7 } },
  ],
};
```

`scoreDecision(AT)` → `scoreA = scoreB = 46.666666666666664`，`tie = true`。
每个因素的 `t*` 都恰好等于其当前占比 → 全部 `AT_THRESHOLD`。

**期望**

当前已打平时，不存在"往某个方向拨到打平"这回事；文案应表达
「现在就是打平，往任一方向拨都会立刻偏向一方」，而不是「从 33.3% 降低到 33.3%」。

**实际**（app.mjs 的模板拼接结果）

> 最容易被撬动的是「k」：把它的权重占比从 33.3% **降低**到 33.3%，两边就会打平；再**往下**就翻过来了。

**实测行为**：从当前占比各拨 1 个百分点，`−0.01 → diff = −1.2`，`+0.01 → diff = +1.2`。
即确实是"往任一方向都会翻"，但文案只描述了"往下"一个方向，且"从 33.3% 到 33.3%"读起来像 bug。

**建议**（由 Lead 决定，我不改 `site/core.mjs`）

- 方案 A（改 core）：`AT_THRESHOLD` 的 `direction` 改为 `null`，由 UI 单独分支渲染"现在已打平"。
- 方案 B（只改 UI）：`app.mjs` / `narrative.mjs` 增加 `flip.direction === 'hold'` 分支。
- 方案 C（不修）：可接受——该状态只在用户手工调到恰好打平时出现，且不影响任何数值。

**测试现状**：`core.test.mjs` 中「findFlipThresholds 的 code 与 feasible/direction/distance 自洽」
已把 `AT_THRESHOLD → direction: 'hold' / distance: 0` 的**当前契约**锁定。
若采用方案 A，请同步改该条断言（我会跟进）。

### 修复结果（方案 B，Lead 于 19:18 完成）

Lead 在 `site/app.mjs` 做了两处改动，`site/core.mjs` 未动：

1. 新增 `flipDescription(flip)`（app.mjs:545），把原先散落在模板字符串里的拼接收敛成一处，
   并增加 `direction === 'hold'` 分支：
   > 「k」现在的权重占比 33.3% 恰好就是打平点。此刻两边分数相同——往任一方向拨动都会立刻偏向一方。
2. `buildThresholdList()`（app.mjs:573）：`direction === 'hold'` 时右侧数字显示「已打平」，
   不再重复输出同一个百分比。

**为什么选 B 而非 A（Lead 的取舍，我认同）**：`direction: 'hold'` 这个契约本身是合理的——
它如实表达了"当前位置就在临界点上"，只是**新增了一个取值**；错的是 UI 把三值硬塞进
increase/decrease 二元分支。改 UI 不动数学契约，也不会让其它依赖 `direction` 的下游产生新的未定义行为。

**我的复核**：`node --check site/app.mjs` 通过；用原复现夹具重算，`flipDescription` 的三个分支
（hold / increase / decrease）都能被走到，`"从 X% 降到 X%"` 已不可能再出现。

**回归守卫**：新增测试「AT_THRESHOLD 的 UI 契约守卫」，锁定
`direction === 'hold'`、`distance === 0`、`thresholdShare ≈ currentShare`、`boundary === false`，
并断言 `direction` 取值域是闭集（新增值必须同步 UI）。变异测试确认：把 `hold` 改成
`increase` / `null`、或把 `distance` 改成 0.5，该测试都会失败。

> **一个坑（写给未来的自己）**：`thresholdShare === currentShare` **严格相等会失败**。
> 实测 o1/o2 两者相差 `2.7755575615628914e-17` —— `t* = -dOthers/(dk-dOthers)` 与
> `weight/Σw` 是两条不同的浮点计算路径。守卫必须用 `1e-12` 容差，不能写 `===`。

---

## F-02（信息）已修复项：`OUT_OF_RANGE` 分支曾被 `BOUNDARY` 遮蔽

初次读到 `core.mjs`（16716 bytes）时，`tStar <= EPS || tStar >= 1 - EPS` 的边界判断
排在 `tStar < 0 || tStar > 1` 之前，导致 `t* = -2.375` 这类明显越界的值也被标成
`boundary: true, code: 'BOUNDARY'`，`OUT_OF_RANGE` 分支不可达。

读到 16898 bytes 版本时，两个分支已调换顺序（先判越界、再判贴边），复测：

| 夹具 | `t*` | `code` | `boundary` | 判定 |
|---|---|---|---|---|
| F1 / f1 | −0.09375 | `OUT_OF_RANGE` | false | 正确 |
| F1 / f2 | −2.375 | `OUT_OF_RANGE` | false | 正确 |
| F1 / f4 | 1.625 | `OUT_OF_RANGE` | false | 正确 |
| 贴边夹具 / k | 1.0 | `BOUNDARY` | true | 正确 |
| 贴边夹具 / k | −0 | `BOUNDARY` | true | 正确 |

**已由 Lead 修复，无需再动。** 现存测试「不存在阈值：所有因素评分差同号…」
与「真正"翻不动"的弱因素…」已覆盖该语义，可防止回归。

---

## 复核过程中确认"不是 bug"的三处直觉陷阱

记录在此，避免后续 review 重复误判：

1. **「10 权重翻不动 60 权重」是错的。** 60/10/10/10 夹具里弱因素的 `t* = 1/3 ∈ (0,1)`，
   完全可行。机制是把占比 `t` 给目标因素、剩余 `1−t` 按原比例分给其余因素，
   不是比较权重绝对值。已写成测试并附解析推导。
2. **`t*` 是打平点，不是翻转点。** 判据是 `t* ∈ (0,1)` 且分母非零；
   "越过才翻转"由 `t*±ε` 两侧符号相反来验证，不能拿 `t*` 本身当翻转点。
3. **`projectAtShare` 不校验 `factorId` 之外的输入。** `UNKNOWN_FACTOR` 在
   `normalizeInput` 之后才抛，因此非法输入会先报校验错误——这是合理的，
   测试已按此顺序断言。

---

## 未覆盖 / 已知边界

- `applyEqualWeights` 只把 `weight` 置 1，不校验其余字段；若传入非法 `factors` 仍会产出
  非法对象。当前有 `validate(fixed)` 断言兜底，未单独判为缺陷。
- 极端量级（`Number.MIN_VALUE` 权重）实测不产生 NaN，但 `othersWeight <= 1e-12`
  会让极小权重因素被判 `SOLE_FACTOR`。属设计取舍，未报缺陷。
- 200 组 LCG 随机样本共产生 997 条阈值记录，其中可行 469 条、不可行 528 条，
  两类都有足够覆盖；但随机样本全部使用整数评分与整数权重，小数评分另由专门用例覆盖。

---

## 性能记录（P0 性能守卫）

用户拖动权重滑杆时 UI 每 90ms 重算一次，因此单次 `scoreDecision + findFlipThresholds`
必须远低于 90ms。实测（Node 24.20.0，6 因素夹具，含 200 次预热）：

| 项目 | 实测 |
|---|---|
| 1000 次 `scoreDecision` + `findFlipThresholds` | **15–22ms**（5 次连跑） |
| 单次总耗时 | **0.0155–0.0219ms** |
| 仅 `scoreDecision` ×1000 | ~5.2ms |
| 仅 `findFlipThresholds` ×1000 | ~9.2ms |
| 相对 90ms 交互预算 | 约占 **0.02%** |
| 相对 500ms 测试预算 | 约占 **3–4%** |

结论：**性能有约 4000 倍余量，不构成风险。**

守卫本身已验证"真会失败"：往 `findFlipThresholds` 注入 1ms 忙等后，
总耗时 1029.3ms，测试如期报错 `超出 500ms 预算`。

**注意**：该断言依赖机器性能，500ms 阈值是单次 0.5ms、比交互预算宽 180 倍，
在负载正常的 CI 上不会误报；但若 CI 机器被严重抢占（>25 倍慢），理论上可能抖动。
若未来出现假阳性，先看日志里的实际毫秒数再决定是否调阈值，**不要直接删测试**。
