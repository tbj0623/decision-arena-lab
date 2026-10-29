# GitHub 仓库设置物料

> 目的：把 GitHub 仓库首页的「About」区域一次性配好，让陌生人在 3 秒内看懂这是什么。
> **本文件只是物料清单。以下所有操作都需要在 GitHub 网页 Settings 里手工完成——DSH 没有写入 GitHub 设置的权限，我不会假装已经设置好。**

仓库：`https://github.com/tbj0623/decision-arena-lab`

---

## 1. Description（简介）

**GitHub 上限 350 字符。** 下面给出两个版本，推荐用短版。

### 推荐（英文，107 字符）

```
Not a prediction. A decision sensitivity explorer — see what would change your mind. Local-only, zero deps.
```

字符数：**107**（含空格与标点；UTF-8 109 字节），远低于 350 上限。

### 备选（英文，强调隐私，133 字符）

```
Compare two options, find the exact weight that flips your decision. Runs fully in your browser — no account, no server, no tracking.
```

字符数：**133**。

### 中文版（若希望仓库简介为中文，42 字符）

```
不是预测，是敏感性分析：看清什么条件会让你的选择翻转。纯本地运行，无需登录与服务器。
```

字符数：**42**（UTF-8 126 字节——GitHub 上限按字符计，不受影响）。

> **为什么这样写**
> - 首词 `Not a prediction` 直接挡住"这又是一个 AI 算命工具"的误解——这是本产品最大的定位风险。
> - 没有出现 probability / accuracy / success rate 任何一词。
> - `Local-only` 与 `zero deps` 是两个可被验证的事实（`scripts/check-no-network.mjs` 可核验），不是形容词。

> **当前仓库已有的 description**（通过 GitHub API 读到，2026-10-29 22:35）：
> `An open-source, private-by-default decision sensitivity explorer. Not professional advice.`
> 这条**本身没错**，可以保留。如需替换，用上面的推荐版。

---

## 2. Website URL

```
https://tbj0623.github.io/decision-arena-lab/
```

- 实测 **HTTP 200**（2026-10-29 22:33）。
- 当前 API 读到 `homepage` 为**空**——即这一项尚未设置，需要手工填入。

---

## 3. Topics（建议 12 个）

GitHub Topics 用小写、连字符分隔。按"相关性"排序，不堆砌：

```
decision-making
decision-support
sensitivity-analysis
multi-criteria-decision-analysis
privacy-first
local-first
offline-capable
vanilla-javascript
no-dependencies
static-site
github-pages
mit-license
```

### 取舍说明（为什么不加某些热门词）

| 不加 | 原因 |
|---|---|
| `ai`、`llm`、`gpt` | **本产品不含任何 AI 模型调用**。加上会带来错误的流量与期待，是明确的误导 |
| `machine-learning`、`data-science` | 产品不做统计推断，没有模型、没有训练 |
| `productivity`、`life-hacks` | 过于宽泛，会被淹没在无关仓库里，且不描述技术实质 |
| `react`、`vue`、`typescript` | 技术栈不是这些，加标签等于虚假标注 |
| `visualization` | 有分数条与贡献表，但不是以可视化为核心卖点 |

> Topics 上限 20 个。**12 个足够**——堆到 20 个只会稀释相关性。

---

## 4. Social Preview（社交预览图）

### 素材规格核对

| 检查项 | 要求 | 实测 | 结论 |
|---|---|---|---|
| 尺寸 | 推荐 1280×640 | **1280 × 640** | ✅ 符合 |
| 文件大小 | < 1 MB | **94,149 B ≈ 91.9 KB** | ✅ 符合 |
| 格式 | PNG / JPG / GIF | **PNG**（魔数校验 `PNG`） | ✅ 符合 |
| 路径 | — | `docs/assets/github-social-preview.png` | ✅ 存在 |

**结论：规格完全符合 GitHub 要求。**

### ⚠️ 关键提醒：上传到仓库 ≠ 设置生效

`docs/assets/github-social-preview.png` 只是**放在仓库里的一个文件**。它不会自动成为社交预览图。

要让它在 Twitter / Slack / 微信等平台分享链接时显示，**必须**：

1. 打开 `https://github.com/tbj0623/decision-arena-lab/settings`
2. 滚动到 **Social preview** 区域
3. 点 **Edit** → **Upload an image...**
4. 选择 `docs/assets/github-social-preview.png`
5. 点 **Save**

> **我不会写"已设置好 Social preview"**——那是 GitHub 网页上的 Settings 操作，当前工具链无法完成，只能由人手动执行。请把它当作一条**待办**，而不是已完成项。

### 另一个容易混淆的点

GitHub Social Preview 只影响 **GitHub 仓库链接**在社交平台的卡片。
**线上站点**（`tbj0623.github.io/...`）的分享卡片由 `site/index.html` 里的 `<meta property="og:image">` 决定，两者是**两套独立配置**，不要以为设了一个另一个也好了。

---

## 5. 其他建议（可选）

| 项 | 建议 | 理由 |
|---|---|---|
| Releases | 打一个 `v1.1.3` tag 并写 release notes | 用户能直接下载 zip；也可指向 `docs/CHANGELOG.md` |
| License | 确认 GitHub 识别为 MIT | 仓库根有 `LICENSE`（1084 B），GitHub 通常能自动识别 |
| 默认分支 | 当前为 `main` | ✅ 正常 |
| 分支保护 | 建议对 `main` 开启 PR 要求 | 防止直接推主干（本项目今晚就出现过本地领先远端多 commit 的情况） |

---

## 6. 执行状态清单（供你勾选）

- [ ] Description 已设置
- [ ] Website URL 已填入 `https://tbj0623.github.io/decision-arena-lab/`
- [ ] Topics 已添加 12 个
- [ ] Social preview 已**在 Settings 中单独上传**（不是仅提交文件）
- [ ] 已在浏览器里确认仓库首页 About 区域显示正确

> 以上 5 项均为**人工操作项**。本文件不声称其中任何一项已完成。
