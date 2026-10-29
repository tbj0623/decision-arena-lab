# tests/core — `site/core.mjs` 单元测试

Decision Arena「反悔雷达」核心算法的回归测试。零依赖，只用 Node 内置的
`node:test` + `node:assert/strict`，ESM（`.mjs`）。

- 测试文件：[core.test.mjs](./core.test.mjs)
- 复核记录 / 缺陷清单：[FINDINGS.md](./FINDINGS.md)
- 被测模块：`../../site/core.mjs`（**只读，本目录不修改它**）

## 运行

Node 24.20.0 实测通过。

```bash
# 在 decision-arena-lab/ 下执行（推荐）
node --test tests/core/*.test.mjs

# 全仓所有测试（含 tests/qa/）
node --test "tests/**/*.test.mjs"
```

> ⚠️ **不要传目录**。本机 Node 24.20.0 实测：`node --test tests/core/`、`node --test tests/core`、
> `node --test tests`、`node --test tests/` **全部失败**，报
> `ERR_MODULE_NOT_FOUND: Cannot find module ...\tests\core`，
> 结果恒为 `tests 1 / pass 0 / fail 1`（它把目录当模块入口去解析，而不是当搜索根）。
> 必须给到 **glob 或具体文件路径**。
>
> 实测对照（同一份代码）：
>
> | 命令 | tests | pass | fail |
> |---|---|---|---|
> | `node --test tests/core/*.test.mjs` | 45 | 45 | 0 |
> | `node --test "tests/**/*.test.mjs"` | 62 | 62 | 0 |
> | `node --test tests/core/` | 1 | 0 | 1 |
> | `node --test tests` | 1 | 0 | 1 |

### 当前真实结果

```
$ node --test tests/core/*.test.mjs

ℹ tests 45
ℹ suites 0
ℹ pass 45
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
⏱  6 因素 × 1000 次 scoreDecision+findFlipThresholds = 18.3ms（单次 0.0183ms，预算 500ms，用量 3.7%）
```

退出码 0。45 条 test（每条内含多条断言，实际断言数远多于此）。
全仓联跑 `node --test "tests/**/*.test.mjs"` → 62/62 通过（含 `tests/qa/` 的 17 条）。

## 覆盖点

### 题面要求的 16 类（全部覆盖）

| # | 覆盖点 | 测试名（缩写） |
|---|---|---|
| 1 | 权重归一化总和为 1 | 权重归一化：normalizedWeights 之和为 1 |
| 2 | 单评分边界 0 | 单评分边界 0：全部 rating 为 0 |
| 3 | 单评分边界 10 | 单评分边界 10：某一侧全为 10 |
| 4 | 相同评分判平 | 相同评分判平 / 权重悬殊仍判平 |
| 5 | 权重等比缩放结果不变 | 等比缩放：分数不变 / t\* 不变 |
| 6 | 主导因素压倒弱因素 | 97:3 压倒 / 小权重也可能翻盘 |
| 7 | 存在合法 t\* | t\* ∈ (0,1) 且与解析解一致 |
| 8 | t\* 代回 projectAtShare | \|difference\| < 1e-6 |
| 9 | t\* 两侧符号相反 | t\*±0.05 符号相反 |
| 10 | 不存在阈值（各差同号） | OUT_OF_RANGE + 端点不翻 / NO_LEVERAGE |
| 11 | 全零权重 | `ALL_ZERO_WEIGHTS` |
| 12 | 负权重 | `NEGATIVE_WEIGHT` |
| 13 | NaN / Infinity | `INVALID_WEIGHT` / `INVALID_RATING` |
| 14 | 仅一个非零权重 | `SOLE_FACTOR`，不除零 |
| 15 | 评分越界 | `RATING_OUT_OF_RANGE` |
| 16 | 交换 A/B | difference 变号、magnitude 相等 |

### 额外补充

- **因素数**：3 个 / 7 个抛 `FACTOR_COUNT`，4–6 个合法（含 `details.count` 断言）。
- **选项校验**：同名（含 trim 后同名）`DUPLICATE_OPTION_LABEL`；1 个 / 3 个选项 `INVALID_OPTIONS`。
- **label**：空 / 全空白（含全角空格）抛错；超长按 120（选项）/ 60（因素）分界，
  并断言**边界长度本身必须通过**（120、60 合法，121、61 抛错）。
- **其它校验**：`INVALID_INPUT`、`INVALID_FACTORS`、`INVALID_FACTOR`、`DUPLICATE_FACTOR_ID`、
  `INVALID_FACTOR_ID`、`WEIGHT_TOO_LARGE`、`INVALID_TITLE`、`INVALID_RATINGS`。
- **`projectAtShare`**：`t` 越界（含 `NaN`/`Infinity`/字符串/`null`）抛 `INVALID_SHARE`；
  `UNKNOWN_FACTOR`；`t=0` / `t=1` 两端点按解析式验证；`t` 从 0→1 差值与解析式一致且单调。
- **`findFlipThresholds`**：每个因素恰好一条、顺序一致、无 NaN/Infinity/undefined；
  `code` 与 `feasible`/`direction`/`distance` 自洽；`AT_THRESHOLD` 契约。
- **`AT_THRESHOLD` UI 契约守卫**（FINDINGS F-01 配套）：用真正打平的夹具（k=2/8:0，
  o1=1/3:7，o2=1/7:3，o3=2/3:7 → 46.66/46.66）把所有因素推进 `AT_THRESHOLD`，断言
  `direction === 'hold'`、`distance === 0`、`thresholdShare ≈ currentShare（用 1e-12 容差，
  **不是 `===`**）`、`boundary === false`、且 `direction` 不得退化成 increase/decrease；
  并断言 `direction` 的取值域是闭集，UI 才能穷举分支。
  注：`thresholdShare` 与 `currentShare` 由两条不同浮点路径算出，实测 o1/o2 相差
  `2.7755575615628914e-17`，**严格相等会失败**，故必须用容差。
- **P0 性能守卫**：6 因素 × 1000 次 `scoreDecision + findFlipThresholds` 总耗时 < 500ms
  （单次预算 0.5ms，比 UI 的 90ms 交互预算宽 180 倍，不会误报）。实测 15–22ms，约占预算 3–4%。
  含 200 次预热以排除 JIT 编译成本，并用"长度校验"防止引擎把计算优化掉。
- **`rankFlipCandidates` / `pickFlipHighlight`**：可行项优先 + 按 distance 升序；空数组返回 `null`；不修改入参。
- **序列化**：`scoreDecision` / `findFlipThresholds` / `chooseValidationHypothesis` /
  `projectAtShare` / `validate` 的输出 `JSON.stringify` 后不含 `"NaN"`/`"Infinity"`/`"undefined"`。
- **确定性随机 200 组**：自实现 LCG（`Math.imul(1664525, s) + 1013904223`，不用 `Math.random`），
  种子 `20261029 + i*7919`，逐条断言与独立重算一致、归一化、贡献和、分数范围、
  可行项代回打平、两侧翻转、纯函数性、magnitude 定义、winner 与符号一致。
- **其它导出**：`normalizeInput` 规范化、`validate`、`applyEqualWeights`、`chooseValidationHypothesis`、
  `closeness` 五档 + `TIE_EPSILON` 语义。

## 测试设计原则

1. **不把实现细节写成期望值。** 能写成不变式的（和为 1、贡献和 = 差值、代回打平、
   两侧异号、交换变号）一律用不变式；需要具体数值时，用**独立重算**（`manualScores` /
   `manualThreshold`）而不是复制 core.mjs 的写法。
2. **每个测试都有真实数值断言**，没有 `assert.ok(true)` 这类占位。
3. **不弱化断言换绿。** 唯一一次失败（"弱因素翻不动"）经复核是**测试自己的前提错了**：
   60/10/10/10 的夹具里弱因素 `t* = 1/3 ∈ (0,1)`，确实可翻盘。已改为：
   ① 断言它**可行**并附解析推导；② 另造一个 `t* = 9/7 > 1` 的夹具验证"真正翻不动"。

## 变异测试（验证测试本身有效）

把 `core.mjs` 复制到临时目录注入 bug，用同一份测试跑，确认能抓到（本地实测）：

| 注入的 bug | 失败数 |
|---|---|
| `magnitude` 乘 1.01 | 2 |
| `tStar` 乘 0.98 | 6 |
| 删掉选项同名检查 | 2 |
| `tie` 去掉 epsilon（改成 `=== 0`） | 1 |
| `projectAtShare` 不做剩余权重重分配 | 6 |
| 允许负权重 | 1 |
| 评分不做 `/total` 归一化 | 14 |
| `direction` 的 increase/decrease 写反 | 1 |
| `AT_THRESHOLD` 的 `hold` 改成 `increase` | 1 |
| `AT_THRESHOLD` 的 `distance` 改成 0.5 | 1 |
| `AT_THRESHOLD` 的 `hold` 改成 `null` | 1 |
| 每次 `findFlipThresholds` 注入 1ms 忙等（性能） | 1（1029ms > 500ms 被拒） |

12/12 全部被抓到，说明断言不是走过场。性能守卫也确认**真会失败**，不是摆设。

## 备注

- 测试只读 `site/core.mjs`，不会写入或修改产品代码。
- 若 `core.mjs` 的对外契约有意变更（例如 `AT_THRESHOLD` 的 `direction` 改 `null`），
  需同步更新本目录对应断言——见 [FINDINGS.md](./FINDINGS.md) 的 F-01。
