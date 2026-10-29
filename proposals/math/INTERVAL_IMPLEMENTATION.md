# W03-01 · 区间敏感性分析实现说明

- **模块**：`site/features/interval.mjs`（12258 bytes）
- **测试**：`tests/core/interval.test.mjs`（37 个 test）
- **提案**：[INTERVAL_ANALYSIS.md](./INTERVAL_ANALYSIS.md)
- **状态**：`DONE`
- **真实结果**：`node --test tests/core/interval.test.mjs` → **37 tests / 37 pass / 0 fail**；全仓 `node --test "tests/**/*.test.mjs"` → **164 / 164 pass**

---

## 1. 交付内容

### 导出

| 导出 | 作用 |
|---|---|
| `normalizeIntervalInput(raw)` | 校验区间输入，返回规范化结构（不复用 core 的 `normalizeInput`） |
| `analyzeInterval(raw)` | 主函数，O(n) 求 `minDelta`/`maxDelta`/`pointDelta`/`verdict`/见证点 |
| `enumerateCorners(raw)` | 暴力 oracle，枚举 2^(2n) 角点，**仅供测试对拍** |
| `INTERVAL_VERSION` | `'1.1.0'` |

### `analyzeInterval` 返回结构

```js
{
  ok: true,
  minDelta, maxDelta, pointDelta, spread,
  verdict,        // stableA | stableB | criticalA | criticalB | unstable | degenerate
  canTie, canFlipA, canFlipB,
  worstCase: { A: number[], B: number[] },   // 见证点（argmin）
  bestCase:  { A: number[], B: number[] },   // 见证点（argmax）
  factors: [{ factorId, label, weight, share,
              minContribution, maxContribution, midContribution,
              uncertaintyWidth, intervals }],
  totalWeight, options, title, epsilon, version
}
```

`worstCase` / `bestCase` 都是**具体评分点**，可直接代回 `scoreDecision` 验证。

---

## 2. 与提案的差异

### 2.1 已实现且与提案一致

- 闭式解 `minΔ = 10·Σp(loA−hiB)`、`maxΔ = 10·Σp(hiA−loB)`，O(n)。
- 六档 verdict。
- `worstCase`/`bestCase` 见证点（提案 §3.3）。
- `INVALID_INTERVAL` 新错误码；其余复用 core 的码。

### 2.2 实现时新增/修正（提案里没有或不够具体）

| # | 差异 | 原因 |
|---|---|---|
| **D1** | **`-0` 规范化下沉到逐因素层**，不只在顶层 | 提案只提到"顶层别出 `-0`"。实测发现：`[-0,-0,-0,-0].reduce(+)` 归约成 **`+0`**，所以顶层 `minDelta` 本来就不会是 `-0`；**真正漏出 `-0` 的是 `factors[i].minContribution`**（`10·share·(-0) === -0`）。只规范化顶层会漏掉整整一层。见 §3.1 |
| **D2** | `normalizeIntervalInput` 额外加了 **`DUPLICATE_FACTOR_LABEL`** | 提案没提。core.mjs 的 `normalizeInput` 要求因素名唯一，为保持两套输入一致，这里也校验 |
| **D3** | 区间校验顺序固化为 **结构 → 元素有限 → 元素域 → `lo<=hi`** | 提案只说"lo>hi 非法"。明确顺序后，`[NaN, 5]` 报 `INVALID_RATING` 而不是 `INVALID_INTERVAL`，与 core 的"先报最具体"一致 |
| **D4** | `enumerateCorners` 额外返回 `count` | 便于断言角点数恰为 `4^n`（测试里用了） |
| **D5** | `pointDelta` 明确取**区间中点** | 提案 §10 OQ-1 悬而未决。实现取中点（`(lo+hi)/2`），这样 I2 恒成立。**这仍然是 OPEN QUESTION，需产品确认** |
| **D6** | 增加 `epsilon` / `version` 字段 | 便于 UI 显示"基于 ±1e-9 判定"与缓存失效 |

### 2.3 未实现（提案已划出 scope）

- 权重区间（`w` 不确定）—— 目标函数对 `w` 是分式，端点解不成立，需 v1.2 单独设计。
- 概率 / 蒙特卡洛 / 因素相关性 —— 红线，不引入。

---

## 3. 遇到的坑

### 3.1 `-0` 的真实来源与"只规范顶层不够"

这是本轮最有价值的发现。

```js
-0 - 0              // → -0
10 * 0.25 * (-0)    // → -0
[-0,-0,-0,-0].reduce((s,v)=>s+v, 0)   // → +0  ← 关键！
```

因为**加法会把 `-0` 归约成 `+0`**（IEEE-754 规定 `(-0) + (-0) = -0`，但 `(-0) + (+0) = +0`，
而 reduce 的初值 `0` 是 `+0`，所以第一项 `+0 + (-0) = +0`，之后一路上都是 `+0`），
顶层的 `minDelta` 根本不可能出现 `-0`。

**真正会漏出去的是 `factors[i].minContribution`。** 只规范化顶层时，变异测试 `M9`
（把逐因素的 `normalizeZero` 去掉）**37 个测试全绿**——说明测试没有覆盖到这一层。

修复：在 `perFactor.push({...})` 里对四个数值字段逐个 `normalizeZero`，并补了 3 组
**显式传 `-0` 端点**的夹具（`A:[-0,0]`、`B:[-0,0]`），以及三行"前提校验"断言，
确保这些断言不是空转：

```js
assert.equal(Object.is(-0 - 0, -0), true);                                  // 前提成立
assert.equal(Object.is(10 * 0.25 * (-0), -0), true);                        // 前提成立
assert.equal(Object.is([-0,-0,-0,-0].reduce((s,v)=>s+v,0), -0), false);     // 所以顶层不会漏
```

> 这个坑与 v1.0 `findFlipThresholds` 的 `thresholdShare` 存成 `-0`（我在 W01-04 案例 3a 记录过）
> 是同一类问题。区别在于：v1.0 那个在**顶层**，这里在**逐因素层**，更容易漏。

### 3.2 `pointDelta` 差点没被断言

变异 `M6`（把 `midContribution` 从"取中点"改成"取 lo 端点"）最初**37 个测试全绿**。
原因：`pointDelta` 只被 `minΔ ≤ pointΔ ≤ maxΔ` 这条**不等式**约束，而取 lo 端点也满足该不等式，
所以不变量抓不住它。

修复：在 T2 补了 `assertDelta(r.pointDelta, 2.5)` 以及逐因素 `midContribution` 的硬断言。
现在 `M6`（取 lo）`M6b`（取 hi）都会失败。

**教训**：不变量只能抓住"违反不变量的错"，抓不住"换了个也满足不变量的错"。
关键语义（这里：中点 = 算术平均）必须用**具体数值**锁一次。

### 3.3 不能用 `assert.equal` 判浮点

按 Lead 要求全部用 `Math.abs(a-b) < 1e-9`。唯一用 `assert.equal` 的地方是：
- 整数比较（`count`、`verdict`、`Object.is` 布尔结果）；
- **O(n) vs 暴力枚举的 4 因素对拍**——这里故意用严格相等。

关于最后一点：两条路径都是 4 项求和、同样顺序、同样 `10*share*gap` 形式，
所以浮点结果**逐位相同**，严格相等是安全的且更强的断言。已实测 100 组随机全部 `===`。
但为防未来重构改变求和顺序，其它地方仍统一用 1e-9 容差。

### 3.4 零权重因素的区间仍然要校验

即使 `w=0` 使该因素对结果毫无影响，`intervals` 结构非法时**仍然报错**。
理由：校验所有输入，不因"反正不影响结果"而放行（对应提案 OQ-4，我采用了"要报错"的立场）。
若 Lead 认为应放宽，改 `normalizeIntervalInput` 里一个分支即可。

---

## 4. 测试覆盖

37 个 test，分 8 组：

| 组 | 内容 | 数量 |
|---|---|---|
| A | 提案 §7 的 T1–T23 全部落地 | 23 |
| B | `minΔ ≤ pointΔ ≤ maxΔ` 不变量，LCG 随机 **200 组** | 1 |
| C | 见证点代回 `scoreDecision` 必须达到极值，随机 100 组 + 手工 3 组 | 2 |
| D | 退化区间（`lo===hi`）等价于 `scoreDecision`，随机 100 组 + 非等权 | 2 |
| E | O(n) vs `enumerateCorners` 完全相等，4 因素随机 100 组 + n=4..6 角点数 | 2 |
| F | 六档 verdict 全覆盖 + 自洽、`-0` 防护（7 组含 `-0` 端点）、`spread` 恒等 | 3 |
| G | `normalizeIntervalInput` 单独校验（合法/各类错误码/边界长度 60/60 合法/不修改入参） | 3 |
| H | 纯函数性（重复调用一致、不改入参） | 1 |

### 变异测试（证明测试不是摆设）

对 `site/features/interval.mjs` 注入 12 个 bug，用同一份测试跑：

| 注入的 bug | 失败数 |
|---|---|
| `minContribution` 用 `aHi` 而非 `aLo` | 20 |
| `maxContribution` 用 `aLo` 而非 `aHi` | 20 |
| 删掉 `lo > hi` 检查 | 1 |
| `VERDICT_EPSILON` 改成 `1e9` | 9 |
| 关掉 `normalizeZero` | 1 |
| `midContribution` 取 lo 端点 | 1 |
| 见证点 worst/best 互换 | 3 |
| `enumerateCorners` 只枚举一个角点 | 3 |
| **只规范化顶层、不规范化逐因素** | **1** |
| `classify` 删掉 degenerate 分支 | 6 |
| `canFlipA` 比较方向反了 | 1 |
| `share` 忘了除以 `totalWeight` | 21 |

**12/12 全部被抓到。** 其中 `normalizeZero` 与 `midContribution` 两条是补测试之后才抓到的（见 §3.1/§3.2）。

---

## 5. 边界处理核对

| 边界 | 行为 | 测试 |
|---|---|---|
| 零权重因素 | 区间任意变化不影响 `min/max`；`uncertaintyWidth === 0` | T7, T8 |
| 零权重 + 非法区间 | **仍然报错**（校验所有输入） | G 组 |
| `lo === hi` | 退化为点估计，`min === max === point === scoreDecision.difference` | D 组（100 组随机），T1 |
| `lo > hi` | `INVALID_INTERVAL`，**不自动交换** | T9 |
| 区间跨 0 分 | 合法，正常计算 | T12 |
| 权重全 0 | `ALL_ZERO_WEIGHTS` | T14 |
| 因素数 3/7 | `FACTOR_COUNT`；4/6 合法 | T15 |
| 端点越界 | `RATING_OUT_OF_RANGE`；`0`/`10` 边界本身合法 | T10 |
| 端点非有限 | `INVALID_RATING`（`NaN`/`±Infinity`/字符串/`null`/`undefined`/布尔/对象） | T11 |
| `-0` 端点 | 规范化为 `+0`，顶层与逐因素层都处理 | F 组 |

---

## 6. 性能

`analyzeInterval`，n=6、全宽区间、1000 次（含 200 次预热）：

```
1000 次 analyzeInterval = 9.6ms（单次 0.0096ms）
```

比 UI 的 90ms 交互预算快约 **9400 倍**。`enumerateCorners` 在 n=6 时 4096 个角点，
仅供测试，**不要在生产路径调用**。

---

## 7. 与 v1.0 的隔离

- **`site/core.mjs` 一个字节都没动**（19066 bytes，mtime `2026-10-29 21:16:56`，是 Lead 的改动，非本次）。
- 唯一 import：`import { ValidationError, MIN_FACTORS, MAX_FACTORS, RATING_MIN, RATING_MAX } from '../core.mjs'` —— **只读引用常量与错误类**，不调用 `normalizeInput`。
- 零依赖、无 DOM、无网络（已 grep 确认无 `document.`/`window.`/`fetch(`）。
- `node --check` 通过。

---

## 8. 遗留 OPEN QUESTION

| 编号 | 问题 | 当前实现 | 需谁定 |
|---|---|---|---|
| **OQ-1** | 用户同时给点估计且不在区间内怎么办？ | 接口**不接受点估计**，`pointDelta` 一律取区间中点 | 产品 |
| **OQ-3** | `criticalA`/`criticalB` 是否单独展示？ | 已独立成档（并进 `unstable` 会让"可能翻"变成假话） | 产品 |
| **OQ-4** | 零权重因素的非法区间要不要报错？ | **报错**（校验所有输入，不因不影响结果而放行） | Lead |
| **OQ-5** | 展示层是否四舍五入到 1 位小数？ | 计算层不 round，原样返回；建议 UI 层 `toFixed(1)` | 产品 |
| **OQ-7** | 输入字段名 `intervals` vs `ratings`？ | 用 `intervals`，避免与 v1.0 的标量 `ratings` 混淆 | Lead |

未决项均已有明确默认行为，不阻塞集成。
