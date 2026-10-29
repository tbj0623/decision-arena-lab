# W02-04 · 区间敏感性分析算法设计（v1.1 提案）

- **状态**：设计 + 证明 + 测试草案，**未改动主代码**
- **目标版本**：v1.1
- **基线**：`site/core.mjs` v1.0.0（`night-v8` 分支，16898 bytes）
- **作者**：logic-engineer
- **红线遵守**：不改 v1.0 任何函数语义 / 不引入概率统计概念 / 拿不准的标 `OPEN QUESTION`

---

## 0. TL;DR

用户给每个因素一个主观允许区间 $[lo,hi]$（**不是概率分布**）。在盒状约束下求 $S(A)-S(B)=\Delta$ 的**最小值与最大值**。

**核心结论：极值必在顶点取得；且因为盒是笛卡尔积、$\Delta$ 无交叉项，优化可分离，$O(n)$ 即可精确求解，不需要枚举 $2^{2n}$ 个顶点。**

$$\min\Delta = 10\sum_i p_i\,(lo^A_i - hi^B_i), \qquad
\max\Delta = 10\sum_i p_i\,(hi^A_i - lo^B_i)$$

若 $0 \in [\min\Delta,\max\Delta]$，则区间内**存在**让结论打平（乃至翻转）的取值。

---

## 1. 问题定义

### 1.1 记号

| 符号 | 含义 |
|---|---|
| $n$ | 因素个数，$n \in \{4,5,6\}$（沿用 `MIN_FACTORS`/`MAX_FACTORS`） |
| $w_i$ | 第 $i$ 个因素的权重，$w_i \ge 0$，$\sum_i w_i > 0$ |
| $p_i$ | 归一化占比 $p_i = w_i / \sum_j w_j$，故 $\sum_i p_i = 1$，$p_i \ge 0$ |
| $r^A_i,\ r^B_i$ | 因素 $i$ 对选项 A / B 的评分，取值域 $[0,10]$ |
| $d_i$ | 评分差 $r^A_i - r^B_i \in [-10,10]$ |

### 1.2 点估计下的差距（v1.0 已有，此处仅对齐记号）

$$S(A) = 10\sum_i p_i r^A_i,\quad S(B) = 10\sum_i p_i r^B_i,\quad
\boxed{\Delta = S(A)-S(B) = 10\sum_i p_i\,d_i}$$

$\Delta > 0$ 判 A 胜，$\Delta<0$ 判 B 胜，$|\Delta| < \texttt{TIE\_EPSILON}=10^{-9}$ 判平。

### 1.3 区间输入（本轮新增）

用户对每个因素、每个选项各给一个**闭区间**：

$$[lo^A_i,\ hi^A_i] \subseteq [0,10], \qquad [lo^B_i,\ hi^B_i] \subseteq [0,10]$$

语义是**主观允许范围**：'我给 A 打 7 分，但大概 6–8 分之间吧'。**不是概率分布，不是置信区间，没有密度函数。**

### 1.4 待求解的优化问题

定义**盒**（box，$2n$ 维矩形）：

$$\mathcal{B} \;=\; \prod_{i=1}^{n}\,[lo^A_i,hi^A_i]\ \times\ \prod_{i=1}^{n}\,[lo^B_i,hi^B_i]\ \subseteq\ \mathbb{R}^{2n}$$

在 $\mathcal{B}$ 上求 $\Delta$ 的上下确界：

$$\boxed{\ \min\Delta \;=\; \min_{\mathbf{r}\in\mathcal{B}} \Delta(\mathbf{r}), \qquad
\max\Delta \;=\; \max_{\mathbf{r}\in\mathcal{B}} \Delta(\mathbf{r})\ }$$

### 1.5 输出语义

| 条件 | 含义 | 产品话术 |
|---|---|---|
| $\min\Delta > 0$ | A 在区间内**永远**获胜 | 结论稳固（A） |
| $\max\Delta < 0$ | B 在区间内**永远**获胜 | 结论稳固（B） |
| $0 \in [\min\Delta,\max\Delta]$ | 区间内**存在**打平的取值 | 结论不稳，可能翻 |

> **红线**：只输出上面的**可达性**判断。**绝不**输出"翻车概率 62%"之类的数字——
> 那需要概率分布假设，本设计没有、也不引入。

---

## 2. 推导：为什么极值一定在端点

### 2.1 前提：盒是非空紧凸多面体

$\mathcal{B}$ 是 $2n$ 个闭区间之积。每个 $[a,b]\subset\mathbb{R}$ 都是紧（有界闭）凸集，有限个紧凸集之积仍紧凸。
**非空性**：$\mathcal{B}\neq\varnothing \iff lo_i \le hi_i$ 对所有 $i$ 成立。
这就是为什么 $lo>hi$ 必须作为**非法输入**报错，而不能"自动交换端点"（见 §5）。

### 2.2 $\Delta$ 是仿射函数

$$\Delta(\mathbf{r}) = 10\sum_i p_i (r^A_i - r^B_i)$$

对每个 $r^A_i, r^B_i$ 都是一次的，且**无常数项、无交叉项**（不含 $r^A_i r^A_j$、$r^A_i r^B_j$ 之类）。
故 $\Delta$ 是从 $\mathbb{R}^{2n}$ 到 $\mathbb{R}$ 的**线性映射**（线性 ⊂ 仿射）。

### 2.3 引理（仿射函数在紧凸多面体上的极值在顶点取得）

> **引理 1.** 设 $P\subset\mathbb{R}^m$ 非空紧凸多面体，$V(P)$ 为其顶点集，$f:\mathbb{R}^m\to\mathbb{R}$ 仿射。
> 则 $\max_{P} f = \max_{V(P)} f$，且 $\min_P f = \min_{V(P)} f$。

**证明.**
任取 $\mathbf{x}\in P$。由多面体的定义，$\mathbf{x}$ 可写成顶点的凸组合：

$$\mathbf{x} = \sum_{j} \lambda_j \mathbf{v}_j,\qquad \mathbf{v}_j\in V(P),\ \lambda_j\ge 0,\ \sum_j \lambda_j = 1$$

由 $f$ 仿射，$f(\mathbf{x}) = f\!\left(\sum_j \lambda_j \mathbf{v}_j\right) = \sum_j \lambda_j f(\mathbf{v}_j)$。

于是
$$f(\mathbf{x}) = \sum_j \lambda_j f(\mathbf{v}_j) \le \sum_j \lambda_j \Big(\max_{\mathbf{v}\in V(P)} f(\mathbf{v})\Big)
= \max_{\mathbf{v}\in V(P)} f(\mathbf{v})$$

即 $f$ 在 $P$ 上的任意取值都不超过顶点上的最大值；而 $V(P)\subseteq P$，故
$\max_{V(P)}f \le \max_P f$。两边夹得 $\max_P f = \max_{V(P)} f$。

对 $-f$（同样仿射）用上述结论：$\min_P f = -\max_P(-f) = -\max_{V(P)}(-f) = \min_{V(P)} f$。 $\blacksquare$

> **这回答了题面的"为什么极值在端点"**：不是因为"线性函数单调"这种直觉，
> 而是因为**凸组合 + 仿射性**把函数值锁在顶点值的凸包内。若 $f$ 非仿射（例如含平方项），
> 该引理不成立，极值可能落在内部。

### 2.4 但不需要枚举 $2^{2n}$ 个顶点：分离性

盒有 $2^{2n}$ 个顶点（每个坐标各取 $lo$ 或 $hi$）。$n=6$ 时是 $2^{12}=4096$ 个，
每个算一次 $O(n)$，总 $O(n\cdot 4^n)$。**这既不必要，也容易写错**（漏掉某些顶点、或误以为要考虑"中间取值的组合"）。

真正的原因：**可行集是笛卡尔积，$\Delta$ 无交叉项 ⇒ 优化问题可分离**。

> **定理 2（端点解）.**
> $$\max_{\mathbf{r}\in\mathcal{B}}\Delta = 10\sum_i p_i\,(hi^A_i - lo^B_i)
> \qquad
> \min_{\mathbf{r}\in\mathcal{B}}\Delta = 10\sum_i p_i\,(lo^A_i - hi^B_i)$$

**证明（上界 + 可达，两侧夹逼）.**

*上界*：对任意 $\mathbf{r}\in\mathcal{B}$，逐坐标有 $r^A_i \le hi^A_i$、$r^B_i \ge lo^B_i$，故
$r^A_i - r^B_i \le hi^A_i - lo^B_i$。又 $p_i \ge 0$（权重非负、总权重为正），逐项乘非负数保序：

$$10\,p_i\,(r^A_i-r^B_i) \le 10\,p_i\,(hi^A_i - lo^B_i)$$

对 $i$ 求和得 $\Delta(\mathbf{r}) \le 10\sum_i p_i(hi^A_i-lo^B_i)$。故右式为上界。

*可达*：取 $\mathbf{r}^\star$ 使 $r^{\star A}_i = hi^A_i$、$r^{\star B}_i = lo^B_i$ 对**所有** $i$ 成立。
因每个坐标都取其区间端点，$\mathbf{r}^\star \in \mathcal{B}$（可行），且代入后取等号。
故上界可达，即最大值。

*最小值*：同法取 $\mathbf{r}_\star$ 使 $r^A_i = lo^A_i$、$r^B_i = hi^B_i$，得下界且可达。 $\blacksquare$

> **注 2.1** 两个见证点（witness）**一般不是同一个点**：最坏情况把所有因素同时推向对 A 最不利，
> 最好情况同时推向最有利。这正是"盒状不确定性"的语义——**所有不确定量可以同时取极端**。
> 该语义的解读风险见 §8。

### 2.5 可达集恰好是一个区间

> **推论 3.** $\{\Delta(\mathbf{r}) : \mathbf{r}\in\mathcal{B}\} = [\min\Delta,\ \max\Delta]$。

**证明.** $\mathcal{B}$ 凸 ⇒ 连通；$\Delta$ 连续 ⇒ 像集连通，故是 $\mathbb{R}$ 中的区间。
由定理 2 其端点即 $\min\Delta,\max\Delta$。 $\blacksquare$

这个推论让"会不会翻"变成**精确判定**而非估计：

$$\text{存在打平取值} \iff 0 \in [\min\Delta,\max\Delta]$$

反过来，若 $0\notin[\min\Delta,\max\Delta]$，则区间内**任何**取值都不可能打平——这是**保证**，不是猜测。

---

## 3. 算法

### 3.1 复杂度结论

**$O(n)$，不是 $O(2^n)$ 也不是 $O(2^{2n})$。** 理由见 §2.4：分离性使每个坐标独立取端点。
$2^{2n}$ 枚举是**正确但浪费**的做法（$n=6$ 时 4096 次 × 6 维，约慢 3 个数量级），
本设计不采用；但测试草案里会保留一个 $O(2^{2n})$ 的**暴力对拍实现**用于验证 $O(n)$ 版本（见 §7.2）。

### 3.2 伪代码

```
function analyzeInterval(raw):
    # ── 1. 校验（不复用 normalizeInput，见 §9.2）──
    input = normalizeIntervalInput(raw)          # 抛 ValidationError，码见 §5
    factors, totalWeight = input.factors, input.totalWeight

    # ── 2. 主循环：O(n) ──
    minDelta = 0
    maxDelta = 0
    pointDelta = 0
    worstCase = { A: [], B: [] }                 # argmin 见证
    bestCase  = { A: [], B: [] }                 # argmax 见证
    perFactor = []

    for each factor f in factors:
        p = f.weight / totalWeight               # ∈ [0,1]，Σp = 1
        aLo, aHi = f.intervals.A
        bLo, bHi = f.intervals.B

        termMin = 10 * p * (aLo - bHi)           # A 最低、B 最高
        termMax = 10 * p * (aHi - bLo)           # A 最高、B 最低
        termMid = 10 * p * ((aLo+aHi)/2 - (bLo+bHi)/2)

        minDelta += termMin
        maxDelta += termMax
        pointDelta += termMid

        worstCase.A.push(aLo); worstCase.B.push(bHi)
        bestCase.A.push(aHi);  bestCase.B.push(bLo)
        perFactor.push({ factorId: f.id, label: f.label, share: p,
                         minContribution: termMin, maxContribution: termMax,
                         uncertaintyWidth: termMax - termMin })

    # ── 3. 判定（用 epsilon 分类，原始数值不改）──
    verdict = classify(minDelta, maxDelta, TIE_EPSILON)

    return {
        minDelta, maxDelta, pointDelta,
        spread: maxDelta - minDelta,
        verdict,                                  # §4
        canTie:   minDelta <=  TIE_EPSILON and maxDelta >= -TIE_EPSILON,
        canFlipA: minDelta <  -TIE_EPSILON,        # 存在 B 胜的取值
        canFlipB: maxDelta >   TIE_EPSILON,        # 存在 A 胜的取值
        worstCase, bestCase,                      # 见证点，供"代回"校验
        factors: perFactor,
        meta: { pointSource: 'midpoint', epsilon: TIE_EPSILON, version: '1.1.0' }
    }
```

### 3.3 为什么返回 `worstCase` / `bestCase`

这两个见证点是**自校验点**：把 `worstCase` 的评分向量代回 `scoreDecision`，得到的
`difference` 必须**精确等于** `minDelta`（`bestCase` 同理等于 `maxDelta`）。

这与 v1.0 中"把 $t^\star$ 代回 `projectAtShare`"是同一套验证哲学：
**不用相信公式，直接把解代回原函数验证**。它能在公式写错（符号、把 $hi$ 当 $lo$）时立刻暴露。

### 3.4 数值稳定性

- $n\le 6$，求和只有 6 项，**不存在**严重累积误差。
- $\min\Delta \le \max\Delta$ 在所有区间退化为点时**逐位相等**（同一表达式、同一求和顺序）。
- 一般情形下的单调性论证：逐项 `fl(10*p*(loA-hiB)) <= fl(10*p*(hiA-loB))`（因 $lo^A\le hi^A$、$hi^B\ge lo^B$，
  减法与乘法对非负因子单调、舍入单调），且求和顺序相同 ⇒ 浮点下仍保证 `fl(min) <= fl(max)`。
  故 **`minDelta <= maxDelta` 是硬保证，不需要 epsilon**。
- 但 $\min\Delta \le \Delta_{\text{point}} \le \max\Delta$ **在浮点下建议用容差断言**，
  因为 `pointDelta` 走的是"先算中点再相减"的另一条舍入路径。见 §6 不变量 I2 的说明。

---

## 4. 判定分类（verdict）

```js
function classify(min, max, eps) {
  const lo = min >  eps;     // 严格为正
  const hi = max < -eps;     // 严格为负
  const loZero = Math.abs(min) <= eps;
  const hiZero = Math.abs(max) <= eps;

  if (Math.abs(max - min) <= eps) return 'degenerate';   // 区间塌缩成一点
  if (lo) return 'stableA';                              // 永远 A 胜
  if (hi) return 'stableB';                              // 永远 B 胜
  if (loZero) return 'criticalA';                        // A 永不输，但可以打平
  if (hiZero) return 'criticalB';                        // B 永不输，但可以打平
  return 'unstable';                                     // 真·两边都可能
}
```

| verdict | 条件 | 用户看到的意思 |
|---|---|---|
| `stableA` | $\min\Delta > \epsilon$ | 在你给的范围内，A 一定赢 |
| `stableB` | $\max\Delta < -\epsilon$ | 在你给的范围内，B 一定赢 |
| `criticalA` | $\min\Delta \approx 0,\ \max\Delta > 0$ | A 不会输，但存在打平的取值 |
| `criticalB` | $\max\Delta \approx 0,\ \min\Delta < 0$ | B 不会输，但存在打平的取值 |
| `unstable` | $\min\Delta < 0 < \max\Delta$ | 结论不稳，范围内两种结果都能出现 |
| `degenerate` | $\min\Delta \approx \max\Delta$ | 区间没有带来任何不确定性 |

> **为什么需要 `criticalA`/`criticalB` 两个档**：数学上"能打平"与"能翻转"是两件事。
> 把 $[0,5]$ 说成"可能翻"是**错的**——A 永远不会输。这类边界恰恰是 v1.0 中
> `BOUNDARY` 与 `OUT_OF_RANGE` 要分开的原因，同样的严谨性应延续。

> **判定用 epsilon、报告用原始值**：`minDelta`/`maxDelta` 原样输出（不四舍五入、不吸附到 0），
> 只有 `verdict` 这个**分类标签**用 `TIE_EPSILON` 做容差。这样既不丢信息，也不会因
> $-1.4\times10^{-16}$ 这种浮点噪声把 `stableA` 误判成 `unstable`。

---

## 5. 边界处理

| # | 情形 | 处理 | 错误码 / 结果 | 理由 |
|---|---|---|---|---|
| B1 | 某因素 $w_i=0$ | **合法**，$p_i=0$，贡献恒为 0 | 区间被完全忽略 | $\Delta$ 中该项系数为 0。**但仍校验其区间格式**（见 B6） |
| B2 | 区间退化 $lo_i=hi_i$ | **合法** | 退化为点估计 | 用户"很确定"的正当表达 |
| B3 | 所有区间都退化 | **合法** | `minΔ === maxΔ`，`verdict='degenerate'` | 必须与 `scoreDecision` 的 `difference` 一致 |
| B4 | $lo_i > hi_i$ | **非法，报错** | `INVALID_INTERVAL` | $\mathcal{B}$ 为空集，优化问题无定义。**不自动交换端点**：那会静默猜测用户意图 |
| B5 | 端点超出 $[0,10]$ | **非法，报错** | `RATING_OUT_OF_RANGE` | 沿用 v1.0 评分域 |
| B6 | 端点非有限（`NaN`/`Infinity`/非数字） | **非法，报错** | `INVALID_RATING` | 沿用 v1.0 |
| B7 | 区间**包含 0 分**（如 $[0,3]$） | **合法** | 正常计算 | 0 是合法评分；线性推导不受影响 |
| B8 | 5 个因素全不确定 | **合法** | 正常计算 | $O(n)$ 与不确定因素个数无关 |
| B9 | 权重也不确定 | **本版不做** | — | 明确排除，见 §9.1 |
| B10 | 所有 $w_i=0$ | **非法，报错** | `ALL_ZERO_WEIGHTS` | 沿用 v1.0，$\sum w=0$ 无法归一化 |
| B11 | 因素数 $n<4$ 或 $n>6$ | **非法，报错** | `FACTOR_COUNT` | 沿用 v1.0 |
| B12 | 区间宽到覆盖整个 $[0,10]$ | **合法** | 正常计算 | 用户表达"完全没数"，正当 |
| B13 | 只给了一个端点（缺 `lo` 或 `hi`） | **非法** | `INVALID_INTERVAL` | 不接受"缺省=点估计"的隐式推断 |
| B14 | 点估计落在区间之外 | 见 `OPEN QUESTION` OQ-1 | — | 需产品决策 |
| B15 | 区间数组顺序反了 `[hi, lo]` 但数值有序 | 由 B4 统一处理 | `INVALID_INTERVAL` | 不做"智能修复" |

> **校验顺序**沿用 v1.0 已验证的顺序：**结构 → 因素数 → 单因子（id/label/weight/ratings）→ 全零权重**，
> 区间校验挂在"单因子"这一步（替换掉 v1.0 的标量评分校验）。

---

## 6. 不变量（应永远成立）

以下性质用于测试，且**每一条都能独立于实现被验证**。

| 编号 | 不变量 | 说明 / 强度 |
|---|---|---|
| **I1** | `minDelta <= maxDelta` | **硬保证**，浮点下也成立（§3.4），可精确断言 |
| **I2** | `minDelta <= pointDelta <= maxDelta` | 点估计（取区间中点）必落在范围内。浮点下用 `1e-9` 容差断言 |
| **I3** | 任意 $\mathbf{r}\in\mathcal{B}$，`minDelta <= Δ(r) <= maxDelta` | 可对随机采样点验证（LCG 固定种子，不用 `Math.random`） |
| **I4** | 代回：`scoreDecision(worstCase).difference === minDelta` | **最强的断言**，直接验证公式方向对错 |
| **I5** | 代回：`scoreDecision(bestCase).difference === maxDelta` | 同上 |
| **I6** | A/B 互换：`min' === -max`，`max' === -min` | 交换两个选项后区间整体镜像 |
| **I7** | 区间加宽单调：区间变宽 ⇒ `min' <= min` 且 `max' >= max` | 不确定性越多，范围只会更宽 |
| **I8** | 零权重无关：改变 $w_i=0$ 因素的区间，`min`/`max` 不变 | 见 B1 |
| **I9** | 全退化塌缩：所有 $lo=hi$ ⇒ `min === max === scoreDecision().difference` | 与 v1.0 一致性锚点 |
| **I10** | 权重等比缩放不变：$w\to cw\ (c>0)$ ⇒ 边界不变 | 只依赖 $p_i$ |
| **I11** | 输出有限：`minDelta`/`maxDelta`/`spread` 均 `Number.isFinite` | 无 `NaN`/`Infinity` |
| **I12** | 序列化干净：`JSON.stringify` 后不含 `"NaN"`/`"Infinity"`/`"undefined"` | 沿用 v1.0 测试约定 |
| **I13** | `verdict` 与边界自洽：`verdict==='stableA' ⇒ minDelta > 0` 等 | 分类不得自相矛盾 |
| **I14** | $O(n)$ 结果 === $O(2^{2n})$ 暴力枚举结果 | 独立实现对拍（§7.2） |

> **I4/I5 是本设计的关键测试手段**：不必证明公式对，只需把返回的见证向量代回 v1.0 的
> `scoreDecision`，看差值是否精确等于声明的极值。公式里任何一个符号写反都会立刻暴露。

---

## 7. 测试用例草案

> **仅草案，不运行**（位于 `proposals/`，不接入 `node --test`）。
> 所有期望值均为**手算**结果，手算依据写在每个用例里。
> 夹具统一取 4 因素等权（$w_i=1$，$p_i=0.25$），则 $\Delta = 10\times0.25\times\sum d_i = 2.5\sum_i d_i$，便于口算。

### 7.1 夹具与辅助函数

```js
import test from 'node:test';
import assert from 'node:assert/strict';
// 提案中的新导出；本文件不运行，仅示意调用形态
// import { analyzeInterval } from '../../site/core.mjs';

/** 构造分析输入：factors 形如 [{ id, weight, A: [lo,hi], B: [lo,hi] }] */
function makeIntervalInput(factors) {
  return {
    options: [{ label: '甲' }, { label: '乙' }],
    factors: factors.map((f) => ({
      id: f.id,
      label: f.id,
      weight: f.weight,
      intervals: { A: f.A, B: f.B },
    })),
  };
}

/** 4 因素等权、给定每因素区间 */
function equalFour(specs) {
  return makeIntervalInput(
    specs.map((s, i) => ({ id: `f${i + 1}`, weight: 1, A: s.A, B: s.B })),
  );
}

/** 断言不做四舍五入的精确相等（这些用例的期望值都是二进制可表示的） */
function assertDelta(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-9,
    `${label}: 期望 ${expected}，实际 ${actual}`);
}
```

### 7.2 独立对拍：$O(2^{2n})$ 暴力枚举（测试专用）

```js
/**
 * 暴力枚举盒的所有顶点求 min/max，仅用于对拍 O(n) 版本。
 * 与主实现完全独立：不共享公式，只依赖 Δ 的定义。
 */
function bruteForceBounds(input) {
  const fs = input.factors;
  const totalW = fs.reduce((s, f) => s + f.weight, 0);
  const p = fs.map((f) => f.weight / totalW);
  const corners = (range) => [range[0], range[1]];

  let min = Infinity;
  let max = -Infinity;
  // 每个因素有 4 种角点组合：A 取 lo/hi × B 取 lo/hi ⇒ 共 4^n
  const rec = (i, acc) => {
    if (i === fs.length) {
      const delta = acc.reduce((s, v, k) => s + 10 * p[k] * v, 0);
      if (delta < min) min = delta;
      if (delta > max) max = delta;
      return;
    }
    const f = fs[i];
    for (const a of corners(f.intervals.A)) {
      for (const b of corners(f.intervals.B)) rec(i + 1, [...acc, a - b]);
    }
  };
  rec(0, []);
  return { min, max };
}
```

### 7.3 用例

#### T1 — 全部退化（等价于点估计）

```js
test('T1 全部区间退化：min===max===scoreDecision.difference', () => {
  const input = equalFour([
    { A: [8, 8], B: [6, 6] }, { A: [8, 8], B: [6, 6] },
    { A: [8, 8], B: [6, 6] }, { A: [8, 8], B: [6, 6] },
  ]);
  const r = analyzeInterval(input);
  // 手算：每个 d_i = 8-6 = 2；Σd = 8；Δ = 2.5 × 8 = 20
  assertDelta(r.minDelta, 20, 'T1.min');
  assertDelta(r.maxDelta, 20, 'T1.max');
  assert.equal(r.verdict, 'degenerate');
});
```
**手算依据**：$d_i=2\ \forall i$，$\sum d=8$，$\Delta=2.5\times8=20$。全退化 ⇒ 上下界重合。

#### T2 — 单因素不确定，一侧恰为 0（`criticalA`）

```js
test('T2 单因素区间 [6,8]：min=0, max=5，A 不会输但可打平', () => {
  const input = equalFour([
    { A: [6, 8], B: [6, 6] },
    { A: [5, 5], B: [5, 5] }, { A: [5, 5], B: [5, 5] }, { A: [5, 5], B: [5, 5] },
  ]);
  const r = analyzeInterval(input);
  // 手算：d_1 ∈ [6-6, 8-6] = [0,2]；其余 d=0
  //   minΔ = 2.5 × (0+0+0+0) = 0
  //   maxΔ = 2.5 × (2+0+0+0) = 5
  assertDelta(r.minDelta, 0, 'T2.min');
  assertDelta(r.maxDelta, 5, 'T2.max');
  assert.equal(r.verdict, 'criticalA');   // A 永不输，但存在打平
  assert.equal(r.canTie, true);
  assert.equal(r.canFlipA, false);        // 不存在 B 胜的取值
});
```
**手算依据**：只有 f1 有不确定性，$d_1\in[0,2]$，其余为 0。故 $\sum d\in[0,2]$，$\Delta\in[0,5]$。
$\min=0$ ⇒ 打平可达但 A 永不落后。

#### T3 — 单因素完全不确定（`unstable`）

```js
test('T3 单因素区间 [0,10]×[0,10]：min=-25, max=25', () => {
  const input = equalFour([
    { A: [0, 10], B: [0, 10] },
    { A: [5, 5], B: [5, 5] }, { A: [5, 5], B: [5, 5] }, { A: [5, 5], B: [5, 5] },
  ]);
  const r = analyzeInterval(input);
  // 手算：d_1 ∈ [0-10, 10-0] = [-10,10]；其余 0
  //   minΔ = 2.5 × (-10) = -25 ; maxΔ = 2.5 × 10 = 25
  assertDelta(r.minDelta, -25, 'T3.min');
  assertDelta(r.maxDelta, 25, 'T3.max');
  assert.equal(r.verdict, 'unstable');
});
```

#### T4 — 非等权 + 混合方向（主力用例）

```js
test('T4 权重 4/3/2/1、混合区间：min=-8, max=10', () => {
  const input = makeIntervalInput([
    { id: 'f1', weight: 4, A: [7, 9], B: [4, 5] },
    { id: 'f2', weight: 3, A: [5, 6], B: [6, 7] },
    { id: 'f3', weight: 2, A: [3, 3], B: [8, 8] },
    { id: 'f4', weight: 1, A: [5, 5], B: [5, 5] },
  ]);
  const r = analyzeInterval(input);
  // 手算：W=10，p = (0.4, 0.3, 0.2, 0.1)
  //   f1: d ∈ [7-5, 9-4] = [2,5]  → 贡献 [10×0.4×2, 10×0.4×5] = [8, 20]
  //   f2: d ∈ [5-7, 6-6] = [-2,0] → 贡献 [10×0.3×(-2), 0]      = [-6, 0]
  //   f3: d = 3-8 = -5（退化）    → 贡献 [10×0.2×(-5)]          = [-10, -10]
  //   f4: d = 0（退化）           → 贡献 [0, 0]
  //   minΔ = 8 - 6 - 10 + 0 = -8 ; maxΔ = 20 + 0 - 10 + 0 = 10
  assertDelta(r.minDelta, -8, 'T4.min');
  assertDelta(r.maxDelta, 10, 'T4.max');
  assert.equal(r.verdict, 'unstable');
});
```

#### T5 — 全体宽区间但仍稳固（A）

```js
test('T5 每个因素 A∈[8,9], B∈[5,6]：min=20, max=40，仍 stableA', () => {
  const input = equalFour(Array(4).fill({ A: [8, 9], B: [5, 6] }));
  const r = analyzeInterval(input);
  // 手算：每个 d_i ∈ [8-6, 9-5] = [2,4]
  //   minΔ = 2.5 × (2×4) = 2.5 × 8  = 20
  //   maxΔ = 2.5 × (4×4) = 2.5 × 16 = 40
  assertDelta(r.minDelta, 20, 'T5.min');
  assertDelta(r.maxDelta, 40, 'T5.max');
  assert.equal(r.verdict, 'stableA');   // 注意：范围很宽，但结论依然稳固
});
```
**教学价值**：区间宽 ≠ 结论不稳。判据永远是 $0$ 是否落在 $[\min\Delta,\max\Delta]$ 内。

#### T6 — 全体宽区间但稳固（B），验证符号对称

```js
test('T6 每个因素 A∈[5,6], B∈[8,9]：min=-40, max=-20，stableB', () => {
  const input = equalFour(Array(4).fill({ A: [5, 6], B: [8, 9] }));
  const r = analyzeInterval(input);
  // 手算：d_i ∈ [5-9, 6-8] = [-4,-2]
  //   minΔ = 2.5 × (-16) = -40 ; maxΔ = 2.5 × (-8) = -20
  assertDelta(r.minDelta, -40, 'T6.min');
  assertDelta(r.maxDelta, -20, 'T6.max');
  assert.equal(r.verdict, 'stableB');
});
```

#### T7 — 零权重因素区间应被完全忽略

```js
test('T7 零权重因素的巨大区间不影响结果', () => {
  const input = makeIntervalInput([
    { id: 'f1', weight: 1, A: [5, 5], B: [5, 5] },
    { id: 'f2', weight: 1, A: [5, 5], B: [5, 5] },
    { id: 'f3', weight: 1, A: [5, 5], B: [5, 5] },
    { id: 'f4', weight: 0, A: [0, 10], B: [0, 10] },   // 零权重
  ]);
  const r = analyzeInterval(input);
  // 手算：p4 = 0/3 = 0 ⇒ f4 贡献恒为 0；其余 d=0
  assertDelta(r.minDelta, 0, 'T7.min');
  assertDelta(r.maxDelta, 0, 'T7.max');
  assert.equal(r.verdict, 'degenerate');
});
```

#### T8 — 唯一有确定性差距 + 零权重干扰项

```js
test('T8 确定性差距 15，零权重区间无法撼动', () => {
  const input = makeIntervalInput([
    { id: 'f1', weight: 1, A: [8, 8], B: [5, 5] },
    { id: 'f2', weight: 1, A: [5, 5], B: [5, 5] },
    { id: 'f3', weight: 0, A: [0, 10], B: [0, 10] },
    { id: 'f4', weight: 0, A: [10, 10], B: [0, 0] },
  ]);
  const r = analyzeInterval(input);
  // 手算：W=2，p1 = p2 = 0.5；f1 d=3 ⇒ 10×0.5×3 = 15；其余 0
  assertDelta(r.minDelta, 15, 'T8.min');
  assertDelta(r.maxDelta, 15, 'T8.max');
  assert.equal(r.verdict, 'degenerate');
});
```

#### T9 — $lo>hi$ 非法

```js
test('T9 lo>hi 必须报 INVALID_INTERVAL，不自动交换', () => {
  // 注意：必须凑够 4 个因素，否则会先撞 FACTOR_COUNT，测不到区间校验
  const bad = equalFour([
    { A: [8, 3], B: [5, 5] },   // lo > hi，非法
    { A: [5, 5], B: [5, 5] }, { A: [5, 5], B: [5, 5] }, { A: [5, 5], B: [5, 5] },
  ]);
  assert.throws(() => analyzeInterval(bad), (err) => {
    assert.equal(err.code, 'INVALID_INTERVAL');
    return true;
  });
});
```

#### T10 — 端点越界

```js
test('T10 端点超出 [0,10] 报 RATING_OUT_OF_RANGE', () => {
  for (const A of [[-1, 5], [5, 11], [0, 10.5]]) {
    const input = equalFour([
      { A, B: [5, 5] },
      { A: [5, 5], B: [5, 5] }, { A: [5, 5], B: [5, 5] }, { A: [5, 5], B: [5, 5] },
    ]);
    assert.throws(() => analyzeInterval(input), (err) => err.code === 'RATING_OUT_OF_RANGE',
      `A=${JSON.stringify(A)} 应越界`);
  }
});
```

#### T11 — 非有限端点

```js
test('T11 NaN / Infinity 端点报 INVALID_RATING', () => {
  for (const bad of [NaN, Infinity, -Infinity, '7', null]) {
    const input = equalFour([
      { A: [5, bad], B: [5, 5] },
      { A: [5, 5], B: [5, 5] }, { A: [5, 5], B: [5, 5] }, { A: [5, 5], B: [5, 5] },
    ]);
    assert.throws(() => analyzeInterval(input), (err) => err.code === 'INVALID_RATING',
      `端点 ${String(bad)} 应报 INVALID_RATING`);
  }
});
```

#### T12 — 区间包含 0 分

```js
test('T12 区间含 0 分是合法的：min=0, max=7.5', () => {
  const input = equalFour([
    { A: [0, 3], B: [0, 0] },
    { A: [5, 5], B: [5, 5] }, { A: [5, 5], B: [5, 5] }, { A: [5, 5], B: [5, 5] },
  ]);
  const r = analyzeInterval(input);
  // 手算：d_1 ∈ [0-0, 3-0] = [0,3]
  //   minΔ = 2.5 × 0 = 0 ; maxΔ = 2.5 × 3 = 7.5
  assertDelta(r.minDelta, 0, 'T12.min');
  assertDelta(r.maxDelta, 7.5, 'T12.max');
  assert.equal(r.verdict, 'criticalA');
});
```

#### T13 — 5 个因素全部不确定

```js
test('T13 5 因素全部不确定：min=-10, max=10', () => {
  const input = makeIntervalInput(
    Array.from({ length: 5 }, (_, i) => ({
      id: `f${i + 1}`, weight: 1, A: [5, 6], B: [5, 6],
    })),
  );
  const r = analyzeInterval(input);
  // 手算：n=5，p=0.2；每个 d_i ∈ [5-6, 6-5] = [-1,1]
  //   Δ = 10×0.2×Σd = 2Σd，Σd ∈ [-5,5]
  //   minΔ = -10 ; maxΔ = 10
  assertDelta(r.minDelta, -10, 'T13.min');
  assertDelta(r.maxDelta, 10, 'T13.max');
  assert.equal(r.verdict, 'unstable');
});
```

#### T14 — 全零权重

```js
test('T14 全零权重报 ALL_ZERO_WEIGHTS', () => {
  const input = makeIntervalInput(
    Array.from({ length: 4 }, (_, i) => ({
      id: `f${i + 1}`, weight: 0, A: [0, 10], B: [0, 10],
    })),
  );
  assert.throws(() => analyzeInterval(input), (err) => err.code === 'ALL_ZERO_WEIGHTS');
});
```

#### T15 — 因素数非法

```js
test('T15 因素数 3 或 7 报 FACTOR_COUNT', () => {
  for (const n of [3, 7]) {
    const input = makeIntervalInput(
      Array.from({ length: n }, (_, i) => ({
        id: `f${i + 1}`, weight: 1, A: [5, 5], B: [5, 5],
      })),
    );
    assert.throws(() => analyzeInterval(input), (err) => err.code === 'FACTOR_COUNT',
      `n=${n} 应报 FACTOR_COUNT`);
  }
});
```

#### T16 — `criticalB`：B 永不输但可打平

```js
test('T16 A∈[2,6] vs B=6：min=-10, max=0，criticalB', () => {
  const input = equalFour([
    { A: [2, 6], B: [6, 6] },
    { A: [5, 5], B: [5, 5] }, { A: [5, 5], B: [5, 5] }, { A: [5, 5], B: [5, 5] },
  ]);
  const r = analyzeInterval(input);
  // 手算：d_1 ∈ [2-6, 6-6] = [-4, 0]
  //   minΔ = 2.5 × (-4) = -10 ; maxΔ = 2.5 × 0 = 0
  assertDelta(r.minDelta, -10, 'T16.min');
  assertDelta(r.maxDelta, 0, 'T16.max');
  assert.equal(r.verdict, 'criticalB');
  assert.equal(r.canFlipB, false);
});
```

#### T17 — 全平（$\min=\max=0$）

```js
test('T17 全部 A=B=5：min=max=0', () => {
  const input = equalFour(Array(4).fill({ A: [5, 5], B: [5, 5] }));
  const r = analyzeInterval(input);
  assertDelta(r.minDelta, 0, 'T17.min');
  assertDelta(r.maxDelta, 0, 'T17.max');
  assert.equal(r.verdict, 'degenerate');
});
```

#### T18 — 代回见证点（I4/I5，最强断言）

```js
test('T18 见证点代回 scoreDecision 必须精确等于声明的极值', () => {
  const input = makeIntervalInput([
    { id: 'f1', weight: 4, A: [7, 9], B: [4, 5] },
    { id: 'f2', weight: 3, A: [5, 6], B: [6, 7] },
    { id: 'f3', weight: 2, A: [3, 3], B: [8, 8] },
    { id: 'f4', weight: 1, A: [5, 5], B: [5, 5] },
  ]);
  const r = analyzeInterval(input);

  const asPoint = (vec) => ({
    options: [{ label: '甲' }, { label: '乙' }],
    factors: input.factors.map((f, i) => ({
      id: f.id, label: f.label, weight: f.weight,
      ratings: { A: vec.A[i], B: vec.B[i] },
    })),
  });

  const worst = scoreDecision(asPoint(r.worstCase));
  const best = scoreDecision(asPoint(r.bestCase));

  assertDelta(worst.difference, r.minDelta, 'T18.worst');
  assertDelta(best.difference, r.maxDelta, 'T18.best');
  // 独立于公式：见证点必须真的落在各自区间内
  for (let i = 0; i < 4; i += 1) {
    assert.ok(r.worstCase.A[i] >= input.factors[i].intervals.A[0]);
    assert.ok(r.worstCase.A[i] <= input.factors[i].intervals.A[1]);
  }
});
```
**这是最关键的用例**：它不验证公式，而是把解代回 v1.0 的既有函数。任何符号写反、$hi$/$lo$ 用错都会失败。

#### T19 — A/B 镜像对称（I6）

```js
test('T19 交换 A/B 后 min/max 镜像取负', () => {
  const base = [
    { id: 'f1', weight: 4, A: [7, 9], B: [4, 5] },
    { id: 'f2', weight: 3, A: [5, 6], B: [6, 7] },
    { id: 'f3', weight: 2, A: [3, 3], B: [8, 8] },
    { id: 'f4', weight: 1, A: [5, 5], B: [5, 5] },
  ];
  const r1 = analyzeInterval(makeIntervalInput(base));
  const r2 = analyzeInterval(makeIntervalInput(
    base.map((f) => ({ ...f, A: f.B, B: f.A })),
  ));
  // 手算：交换后 d_i 取负 ⇒ Δ 取负 ⇒ 原 [−8,10] 变为 [−10, 8]
  assertDelta(r2.minDelta, -r1.maxDelta, 'T19.min');
  assertDelta(r2.maxDelta, -r1.minDelta, 'T19.max');
  assertDelta(r2.minDelta, -10, 'T19.min.abs');
  assertDelta(r2.maxDelta, 8, 'T19.max.abs');
});
```

#### T20 — 区间加宽单调（I7）

```js
test('T20 区间变宽后 min 不增、max 不减', () => {
  const narrow = analyzeInterval(equalFour(
    Array(4).fill({ A: [6, 7], B: [5, 6] }),
  ));
  const wide = analyzeInterval(equalFour(
    Array(4).fill({ A: [4, 9], B: [2, 8] }),
  ));
  assert.ok(wide.minDelta <= narrow.minDelta + 1e-9);
  assert.ok(wide.maxDelta >= narrow.maxDelta - 1e-9);
});
```

#### T21 — 权重等比缩放不变（I10）

```js
test('T21 权重整体 ×7 后边界不变', () => {
  const spec = [
    { A: [7, 9], B: [4, 5] }, { A: [5, 6], B: [6, 7] },
    { A: [3, 3], B: [8, 8] }, { A: [5, 5], B: [5, 5] },
  ];
  const w1 = [4, 3, 2, 1];
  const a = analyzeInterval(makeIntervalInput(spec.map((s, i) => ({
    id: `f${i + 1}`, weight: w1[i], ...s,
  }))));
  const b = analyzeInterval(makeIntervalInput(spec.map((s, i) => ({
    id: `f${i + 1}`, weight: w1[i] * 7, ...s,
  }))));
  assertDelta(b.minDelta, a.minDelta, 'T21.min');
  assertDelta(b.maxDelta, a.maxDelta, 'T21.max');
});
```

#### T22 — $O(n)$ 与暴力枚举对拍（I14，含随机）

```js
test('T22 LCG 随机 100 组：O(n) 结果必须等于 4^n 暴力枚举结果', () => {
  const lcg = (seed) => {
    let s = seed >>> 0;
    return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296; };
  };
  for (let k = 0; k < 100; k += 1) {
    const rand = lcg(20261030 + k * 7919);
    const n = 4 + Math.floor(rand() * 3);
    const factors = Array.from({ length: n }, (_, i) => {
      const loA = rand() * 10, hiA = loA + rand() * (10 - loA);
      const loB = rand() * 10, hiB = loB + rand() * (10 - loB);
      return { id: `f${i + 1}`, weight: Math.floor(rand() * 10), A: [loA, hiA], B: [loB, hiB] };
    });
    if (factors.every((f) => f.weight === 0)) factors[0].weight = 1;

    const input = makeIntervalInput(factors);
    const fast = analyzeInterval(input);
    const slow = bruteForceBounds(input);
    assertDelta(fast.minDelta, slow.min, `T22#${k}.min`);
    assertDelta(fast.maxDelta, slow.max, `T22#${k}.max`);
  }
});
```

#### T23 — 不变量组合守卫

```js
test('T23 通用不变量：min<=mid<=max、有限性、序列化干净', () => {
  const input = makeIntervalInput([
    { id: 'f1', weight: 4, A: [7, 9], B: [4, 5] },
    { id: 'f2', weight: 3, A: [5, 6], B: [6, 7] },
    { id: 'f3', weight: 2, A: [3, 3], B: [8, 8] },
    { id: 'f4', weight: 1, A: [5, 5], B: [5, 5] },
  ]);
  const r = analyzeInterval(input);
  assert.ok(r.minDelta <= r.maxDelta);                       // I1
  assert.ok(r.minDelta <= r.pointDelta + 1e-9);              // I2
  assert.ok(r.pointDelta <= r.maxDelta + 1e-9);              // I2
  for (const v of [r.minDelta, r.maxDelta, r.pointDelta, r.spread]) {
    assert.ok(Number.isFinite(v), `${v} 应有限`);            // I11
  }
  const json = JSON.stringify(r);                             // I12
  assert.ok(!/NaN|Infinity|undefined/.test(json));
});
```

**用例总数：23（≥ 15 要求）。**

---

## 8. 解释性陷阱（必须写进 UI 文案）

> 这一节不是实现细节，而是**防止产品说谎**。

1. **$\min\Delta$ 是"所有不确定量同时变坏"的联合最坏情况。**
   盒模型假设各因素的不确定性**可以自由组合**。若现实中因素相关（例如"薪资涨"与"加班多"通常同时发生），
   联合最坏情况会**过于悲观**——它可能是现实里根本达不到的组合。
   正确话术：「如果每一项都往最不利的方向偏，最坏会到 …」，而不是「最坏情况一定会发生」。

2. **$[\min\Delta,\max\Delta]$ 是可达集的精确刻画（推论 3），不是估计。**
   所以"会不会翻"是**确定性命中判定**：$0$ 在区间内 ⇔ 存在翻转取值。这点可以理直气壮地说。

3. **绝不输出概率。** 没有分布就没有 $P(\Delta<0)$。若产品要"风险等级"，只能映射到
   **定性三档**（稳固 / 临界 / 不稳），且必须标注"基于范围，非概率"。

4. **区间宽 ≠ 结论不稳**（见 T5）：即使每个因素都给了很宽的区间，只要所有区间都指向同一方向，
   结论依然稳固。反之，区间很窄但正好跨过 0，也依然不稳。判据只有 $0 \in [\min,\max]$。

5. **确定性差距与不确定性差距要说清。** 输出里同时给 `pointDelta` 与 `spread`，
   用户才能分辨"本来就接近打平"还是"本来差很多但不确定性太大"。

---

## 9. Scope 与集成

### 9.1 明确不做（本版）

| 不做 | 原因 |
|---|---|
| **权重区间**（$w_i$ 也不确定） | 目标函数对 $w$ 是**分式**（$p_i=w_i/\sum w$），不再是线性的；极值不再保证在端点，需要分式规划/单纯形，复杂度与正确性论证都要重做。**建议 v1.2 单独设计。** |
| 概率分布 / 置信区间 / 蒙特卡洛 | 红线：不引入统计假设 |
| 因素间相关性 | 盒模型无法表达，需要联合可行域（多面体），属于 v1.3 |
| 非线性评分映射 | 会破坏仿射性，§2.3 的引理失效 |

### 9.2 与 v1.0 的关系（非回归保证）

- **新增导出** `analyzeInterval(raw)`，**不修改**任何既有导出（`scoreDecision` /
  `findFlipThresholds` / `projectAtShare` / `validate` 等签名与语义完全不变）。
- **不能复用 `normalizeInput`**：v1.0 在 `core.mjs:138-149` 硬性要求
  `ratings.A` / `ratings.B` 是 `Number.isFinite` 的标量，数组会直接抛 `INVALID_RATING`。
  因此需要**并列的** `normalizeIntervalInput`，但**复用**同一套常量和 `ValidationError` 约定
  （同码同义，便于 UI 统一处理）。
- 建议新增错误码 `INVALID_INTERVAL`（唯一全新的码），其余全部复用。

---

## 10. OPEN QUESTION

| 编号 | 问题 | 我的倾向 | 需谁定 |
|---|---|---|---|
| **OQ-1** | 若用户同时给了点估计 $r$ 且**不在**区间内，怎么办？ | 报 `POINT_OUTSIDE_INTERVAL`，不静默 clamp。**默认实现建议：不要求点估计，`pointDelta` 一律取区间中点**（保证 I2 恒成立，且语义自洽） | 产品 |
| **OQ-2** | `verdict` 分类用的 epsilon 取多少？ | 复用 `TIE_EPSILON = 1e-9`（与判平一致）；但 $\min\Delta$ 是 0–100 量级，也可考虑 `1e-7` | Lead |
| **OQ-3** | `criticalA`/`criticalB`（能打平但不会输）是否要单独展示，还是并进 `unstable`？ | 必须有独立档。并进 `unstable` 会让"可能翻"这个说法变成假话 | 产品 |
| **OQ-4** | 零权重因素的**非法区间**要不要报错？（它不影响任何输出） | **要报错**。原则：校验所有输入，不因"反正不影响结果"而放行 | Lead |
| **OQ-5** | `minDelta`/`maxDelta` 展示时是否四舍五入到 1 位小数？ | 计算层不rounding；展示层可 `toFixed(1)`。浮点噪声（如 `20.000000000000004`）应在展示层处理 | 产品 |
| **OQ-6** | 是否需要"哪个因素最该收敛不确定性"的排名？ | 天然可得：按 `uncertaintyWidth = 10·p_i·[(hiA-loA)+(hiB-loB)]` 降序。**建议 v1.2**，本版不做 | 产品 |
| **OQ-7** | 输入形态：`intervals:{A:[lo,hi]}` 还是 `ratings:{A:{lo,hi}}`？ | 用 `intervals` 独立字段，**避免**与 v1.0 的 `ratings` 标量语义混淆（`ratings` 传数组会误报 `INVALID_RATING`） | Lead |
| **OQ-8** | 6 因素 + 全宽区间时，`spread` 最大可达多少？ | 上界 $10\sum p_i \cdot 20 = 200$（每项 $d_i$ 最大跨度 20）。若 UI 要画进度条需知道量程 | 产品 |

---

## 11. 交付自检

| 要求 | 状态 |
|---|---|
| 问题定义（精确记号） | §1 |
| 推导：为什么极值在端点 | §2（引理 1 完整证明 + 定理 2 上界/可达夹逼） |
| 算法 + 复杂度 | §3，**$O(n)$**，并说明为何不需 $2^{2n}$ |
| 边界处理表 | §5，15 条 |
| 15+ 测试草案 | §7，**23 个**，含手算依据 |
| 不变量 | §6，14 条 |
| 不改 v1.0 | §9.2 |
| 无概率/统计 | §1.5、§8.3 |
| 不确定项标 OPEN QUESTION | §10，8 条 |

**未修改任何主代码；本文档位于 `proposals/math/`，不接入测试运行。**

---

## 12. 期望值的独立验证记录（写文档后补做）

本文档中 **16 组手算期望值**（T1、T2、T3、T4、T5、T6、T7、T8、T12、T13、T16、T17、T19、T20、T21 + T22 的 100 组随机）
均已用一个**与本提案不共享公式**的独立 oracle 复核过——该 oracle 直接按 §7.2 的
$4^n$ 角点暴力枚举 $\Delta$ 的定义式，不引用 §3 的 $O(n)$ 公式：

```
PASS T1    min=20  max=20       PASS T12   min=0    max=7.5
PASS T2    min=0   max=5        PASS T13   min=-10  max=10
PASS T3    min=-25 max=25       PASS T16   min=-10  max=0
PASS T4    min=-8  max=10       PASS T17   min=0    max=0
PASS T5    min=20  max=40       PASS T19   min=-10  max=8
PASS T6    min=-40 max=-20      PASS T20   narrow=[0,20] wide=[-40,70]
PASS T7    min=0   max=0        PASS T21   x1=[-8,10] x7=[-8,10]
PASS T8    min=15  max=15
T22: O(n) vs 4^n brute worst diff = 0

ALL EXPECTATIONS VERIFIED
```

**结论：16/16 一致，且 $O(n)$ 公式与 $4^n$ 暴力枚举在 100 组随机用例上的最大偏差为 `0`（逐位相同）。**
这实证了 §2.4 的定理 2，并说明 $O(n)$ 版本没有引入任何近似。

> 注意：这里的"0 偏差"是**预期之内**的——两条路径都在算同样的 6 项以内求和，
> 且都是"先乘后加、顺序一致"，浮点结果自然逐位相同。这不代表对所有输入都逐位相等
> （若求和顺序不同可能有 1 ulp 差异），因此 §7 的断言仍统一用 `1e-9` 容差而非 `===`。
