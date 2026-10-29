<!-- STATUS: DRAFT — NOT POSTED -->

# Decision Arena (反悔雷达) — 一个零依赖的决策敏感性分析工具

**在线**：https://tbj0623.github.io/decision-arena-lab/
**仓库**：https://github.com/tbj0623/decision-arena-lab
**许可**：MIT

---

## 它解决什么问题

加权决策矩阵（Pugh matrix / 加权评分）能给你一个排名。但它有个众所周知的弱点：**权重一改，结论就能变**——所以排名本身很容易被操纵，也很难让人信服。

这个工具不做"更好的排名"。它回答排名之后的那个问题：

> **哪个因素的权重变化会让结论翻转？我还差多少？**

这叫敏感性分析。数学上就是解一个一元一次方程，但把它做成界面的第一等公民之后，用户看到的东西完全不一样了。

---

## 技术栈

| 项 | 值 |
|---|---|
| 前端 | 原生 HTML / CSS / JavaScript（ES Modules） |
| 依赖 | **0**。没有 `package.json`，没有构建步骤，没有 `node_modules` |
| 构建 | **无**。`site/` 目录直接就是产物，丢到任何静态托管即可 |
| 后端 | **无**。没有服务器、没有数据库、没有 API |
| 网络请求 | **0**（有静态审计脚本保证，见下） |
| 存储 | **0**（不用 localStorage / sessionStorage / IndexedDB / Cookie） |
| 测试 | **211 项，全部通过**（`node --test`） |

`node --test` 会自动发现全部测试文件。注意：在 Node 24 下 `node --test tests/` 会把目录当模块解析并报 `MODULE_NOT_FOUND`，**用无参数形式**。

---

## 算法：完全公开，可以手算

页面上写着完整的推导，源码在 `site/core.mjs`，是**不碰 DOM 的纯函数**。

### 1. 权重 → 占比

$$p_i = \frac{w_i}{\sum_j w_j}$$

### 2. 加权得分

$$S = 10 \times \sum_i p_i \cdot r_i$$

其中 $r_i$ 是你给该方案在该因素上打的 0–10 分。结果落在 0–100。

### 3. 单因素敏感性：闭式解

固定其他因素之间的相对比例，只把第 $k$ 个因素的占比调成 $t$，其余按原比例重分剩下的 $(1-t)$。

令 $d_k = r_A[k] - r_B[k]$，$d_{\text{others}}$ 为其余因素贡献的加权平均分差，则两方案分差为：

$$\Delta(t) = t \cdot d_k + (1-t) \cdot d_{\text{others}}$$

解 $\Delta(t) = 0$：

$$\boxed{t^* = -\frac{d_{\text{others}}}{d_k - d_{\text{others}}}}$$

**不需要迭代、不需要数值搜索。** 判断 $t^*$ 是否落在 $(0, 1)$ 区间内，就得到三种状态：

| 状态 | 含义 |
|---|---|
| `FEASIBLE` | $t^*$ 在 $(0,1)$ 内，是一个真实可达到的临界点 |
| `BOUNDARY` | 临界点正好落在 0 或 1 的边界上，实际可调范围内没有翻盘空间 |
| `OUT_OF_RANGE` | 无解或解在区间外 |

**如果所有因素的评分差都同号**（即 $d_k$ 全正或全负），那么无论怎么调单个因素的权重都翻不过来。这时工具会直接说"翻不过来"，而不是编一个数字。

示例：仓库自带的 `oldguitar` 例子就是这个情况——5 个因素全部 `OUT_OF_RANGE`，界面明说「在只调整单个因素权重的情况下，结论翻不过来。」

---

## 零网络请求，是怎么保证的

不是靠自觉，是靠一个会失败的脚本：

```bash
node scripts/check-no-network.mjs
```

它会静态扫描 `site/` 下所有文件，检测 `fetch` / `XMLHttpRequest` / `WebSocket` / `sendBeacon` / `localStorage` / `sessionStorage` / `indexedDB` 以及密钥模式，**命中即失败并报出行号**。当前实测扫描 **12 个文件、280,595 字节（约 274 KB）**，输出 `PASS`。

这比"我们承诺不收集数据"强的地方在于：**任何人 clone 下来跑一遍就能验证**，而且一旦有人加了埋点，CI 会红。

我也在真实浏览器里核对过：打开线上站点后 `performance.getEntriesByType('resource')` 里**没有任何跨域资源**，`localStorage` / `sessionStorage` / `document.cookie` **全为空**。

---

## 算法和 UI 是分开的

```
site/
├── core.mjs              ← 纯函数：normalizeInput / scoreDecision /
│                            projectAtShare / findFlipThresholds /
│                            pickFlipHighlight / chooseValidationHypothesis /
│                            applyEqualWeights / validate
├── app.mjs               ← 只做事件绑定与渲染
├── index.html
├── features/
│   ├── narrative.mjs     ← 9 个虚构示例（数据）
│   └── interval.mjs      ← 区间/取整相关逻辑
├── data/validation-actions.mjs
├── assets/               ← 品牌图标、OG 卡
└── styles/app.css
```

`core.mjs` 不引用任何 DOM API，所以能在 Node 里直接 `import` 测试。这意味着：**改 UI 不会改坏数学**，改数学会被 211 项测试拦住。

### 核心导出

- `scoreDecision(raw)` — 返回得分、差值、胜方、接近度、逐因素贡献拆解
- `projectAtShare(raw, factorId, t)` — 把某因素占比设为 `t`，其余按原比例重分配后重算。界面那根滑杆调的就是它
- `findFlipThresholds(raw)` — 解出每个因素的 $t^*$，给方向、距离、状态码
- `pickFlipHighlight(thresholds)` — 挑出"最容易被撬动"的那一个
- `chooseValidationHypothesis(raw, analysis)` — 按"谁对当前差距贡献最大"挑一条最该核实的假设，并**明确声明这是启发式**

---

## 本地跑起来

```bash
git clone https://github.com/tbj0623/decision-arena-lab.git
cd decision-arena-lab

node --test                        # 211 项测试
node scripts/check-no-network.mjs  # 静态审计：零网络请求
node scripts/serve.mjs             # 本地预览 http://127.0.0.1:8080/
```

`serve.mjs` 只监听 `127.0.0.1`，不对外暴露。

---

## 怎么贡献

四条底线（**这是我按项目实际约束总结的，不是某份文件里的原文**；技术上的边界见 `docs/LIMITATIONS.md`）：

1. **不引入框架或第三方运行时依赖。** 这是产品属性，不是偏好——它保证了可审计性和十年后还能打开。
2. **新数学先进 `core.mjs` 并配单测。** 不要先在 UI 里试，再补测试。
3. **不加网络请求、遥测、持久化。** `check-no-network.mjs` 会拦住你。
4. **不把产品描述成预测或专业建议工具。** 这是它存在的理由。

欢迎的方向：更多真实使用场景的示例数据、可读性/无障碍改进、算法边界情况的测试。不欢迎的方向：加后端、加账号、加埋点、改成一个"AI 建议"产品。

---

## 边界（这些不是免责套话，是设计约束）

- 它**不是预测**，**不是成功率**，那些 0–100 的数字只是你自己打分在你自己权重下的加权和 × 10。
- 它**不知道你打的分对不对**。你给的分如果是猜的，它看不出来——所以它会提醒你去核实，而不是假装有把握。
- 它**不适用于医疗、法律、财务**等高风险决定。那些请找有资质的专业人士。
- **刷新就没了**。这是"零存储"的代价，不是 bug。需要保留请用界面里的「导出 JSON」。

---

*本项目由 Lead 加多个角色（产品、算法、视觉、示例、QA、安全、发布、宣传）协作完成，方式是角色分工 + 共享任务板 + 每人独立写入区。但不是"AI 自动完成了所有事"：测试与场景复核都真跑过；能否发布仍要人判断。*
