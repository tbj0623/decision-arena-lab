# GitHub 仓库设置物料

> 目的：把 GitHub 仓库首页的「About」区域一次性配好，让陌生人在 3 秒内看懂这是什么。

## 更新（2026-10-30）：大部分已经用 API 设置好了

**下面这份文件原本假设"全部要手工设置"。实测这个假设是错的** ——
本机的 `gh` CLI 已认证为仓库 owner，PATCH / PUT 都返回 2xx。

**2026-10-30 本轮 `gh api` 回读实测（可复现，见文末命令）：**

| 字段 | 值 |
|---|---|
| Description | 把纠结的两个选择拆成因素和权重，算出哪个权重改变多少会让结论翻转。纯前端静态站，不联网、不上传数据、无需登录，公式公开可核验。 |
| Homepage | https://tbj0623.github.io/decision-arena-lab/ |
| Topics | 12 个：`accessibility` `chinese` `decision-making` `decision-support` `github-pages` `multi-criteria-decision-analysis` `no-dependencies` `offline-first` `privacy-first` `sensitivity-analysis` `static-site` `vanilla-javascript` |
| has_wiki | ❌ `false`（关闭） |
| has_projects | ❌ `false`（关闭） |
| has_issues | ✅ `true`（开启） |

验证方式：设置后重新 `gh api repos/tbj0623/decision-arena-lab` 独立回读，全部一致。
详见 `ops/release/GITHUB_METADATA_SET.md`（内部文件，不在仓库内）。

> **`offline-first` 这个 topic 的准确含义**：它指的是「运行时不发任何外部请求、数据不出本机」，
> **不是**「离线 PWA」或「可安装的离线应用」。站点没有 Service Worker，Chrome 不会给可安装提示。
> 对外解释 topic 时请用前者，别用后者。

**仍然需要你手动做的只有一项：Social preview（见文末第 4 节）。**
GitHub 没有提供设置 Social preview 的公开 API 端点。

> ⚠️ 一个环境坑（记下来省得下次踩）：本机 Git Bash（MSYS）会把 `gh api /repos/...`
> 的**前导斜杠当成路径转换**，把 `/repos/...` 误当成盘符路径拼进错误信息里
> （报 `invalid API endpoint`，里面还会带出本机工作目录）。
> 把前导斜杠去掉（写成 `repos/tbj0623/...`）就正常。
> 另外 `-f` 传字符串、`-F` 传类型推断（布尔要用 `-F`，否则会被发成 `"false"` 字符串）。

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

- 实测 **HTTP 200**（2026-10-30 本轮）。
- 本轮 `gh api` 回读：`homepage` **已填好**，就是上面这个地址。
  （本文件早前写着"当前 API 读到 homepage 为空、需要手工填"——那是旧状态，已过期。）

---

## 3. Topics（历史建议稿，实际已设置的是第 1 节那 12 个）

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

> **与实际的差异**（2026-10-30 回读）：实际设置里没有 `local-first`、`offline-capable`、`mit-license`，
> 取而代之的是 `chinese`、`offline-first`、`vanilla-javascript`。以第 1 节的实际清单为准。
> `offline-capable` 之所以没采用：它容易被读成"可离线安装使用"，而本项目**没有** Service Worker。

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

### 🔍 怎么验证 Social preview 真的生效了

上传完**不要只看 Settings 页面里有没有图**——那只能证明你传了，不能证明 CDN 已经生效。
按下面任一种方式做**外部验证**：

#### 方式 1：GitHub 的 OpenGraph 图片端点（最快，30 秒）

GitHub 为每个仓库生成一个 OG 图端点。**设置生效后**，这个地址会返回你自己上传的那张图：

```bash
# 把返回的 HTTP 状态和 Content-Type 记下来
curl -sS -o /dev/null -w "%{http_code}  %{content_type}  %{size_download} B\n" \
  -L https://opengraph.githubassets.com/1/tbj0623/decision-arena-lab
```

**判读**：

| 现象 | 含义 |
|---|---|
| `200  image/png`，且下载体积 ≈ 90–200 KB | ✅ 大概率是你的图（GitHub 会重新编码，体积会变） |
| 返回的是 GitHub 默认的灰色卡片 | ❌ 还没生效，或传的是默认图 |
| **`429 Too Many Requests`** | ⚠️ **GitHub 对这个端点限流了**，这不代表设置有问题。等几分钟重试，或直接用方式 2 |
| `404` / `302` 到别处 | 端点变了，改用方式 2 |

> 📌 **本机实测记录（2026-10-29 23:35）**：从本机访问该端点返回 `429`。
> 所以方式 1 **在本环境下不能作为判据**，请优先用方式 2（贴真实平台）。
> 写在这里是为了避免下一个人看到 429 就以为 Social preview 配错了。

> ⚠️ 这个端点有缓存（`Cache-Control` 较长），**设置后可能几分钟到几小时才更新**。
> 如果刚才才上传，先等 5 分钟再试。

#### 方式 2：贴到真实平台（最可信，但要手动）

**这是唯一能 100% 确认的方式**，因为每个平台的抓取器行为不同：

| 平台 | 操作 | 期望 |
|---|---|---|
| **Slack** | 在任意频道粘贴 `https://github.com/tbj0623/decision-arena-lab` 并发送 | 消息下方展开卡片，缩略图是你的图 |
| **Twitter/X** | 发一条仅自己可见的推文，粘贴链接 | 链接预览图是品牌图 |
| **Telegram** | 发给「Saved Messages」 | 同上 |
| **Discord** | 粘贴到任意频道 | 同上 |

> **微信不支持标准 OG 抓取**，不要用微信验证——它会显示自己的降级样式，不能作为判据。

#### 方式 3：Facebook / LinkedIn 调试器（可强制刷新缓存）

```text
https://developers.facebook.com/tools/debug/
→ 输入 https://github.com/tbj0623/decision-arena-lab
→ 点 "Scrape Again"（强制重新抓取，绕过缓存）
```

或：

```text
https://www.linkedin.com/post-inspector/
→ 输入仓库链接 → Inspect
```

这两个工具会**明确列出它抓到的 og:image URL**，比肉眼看卡片更可靠。

#### 验证通过的判据（三条全中才算生效）

- [ ] 外部抓取器返回的 `og:image` 指向 `github.com/...` 的 OG 图，**不是** `avatars.githubusercontent.com` 默认图
- [ ] 实际渲染出来的卡片图片是**品牌图**（深色背景 + 产品名），不是 GitHub 默认灰卡
- [ ] 至少 **2 个不同平台**都显示正确（单平台可能是个例缓存）

> **如果你只做了 Settings 里的上传、没做上面的验证，就还不能说"Social preview 已设置好"。**
> 上传是动作，生效是结果，两者之间隔着 CDN 缓存。

---

## 5. 其他建议（可选）

| 项 | 建议 | 理由 |
|---|---|---|
| Releases | 打一个 `v1.1.3` tag 并写 release notes | 用户能直接下载 zip；也可指向 `docs/CHANGELOG.md` |
| License | 确认 GitHub 识别为 MIT | 仓库根有 `LICENSE`（1084 B），GitHub 通常能自动识别 |
| 默认分支 | 当前为 `main` | ✅ 正常 |
| 分支保护 | 建议对 `main` 开启 PR 要求 | 防止直接推主干（本项目今晚就出现过本地领先远端多 commit 的情况） |

---

## 6. 执行状态清单

**2026-10-30 本轮 `gh api` 回读结论**：Description / Homepage / Topics / 关 wiki / 关 projects
这 5 项**已经生效**（值与第 1 节的表逐项一致）。**只有 Social preview 仍是待办。**

- [x] Description 已设置（回读一致）
- [x] Website URL 已填入 `https://tbj0623.github.io/decision-arena-lab/`（回读一致）
- [x] Topics 已添加 12 个（回读一致，共 12 条）
- [ ] Social preview 已**在 Settings 中单独上传**（不是仅提交文件）——**仍需人工操作**
- [ ] 已在浏览器里确认仓库首页 About 区域显示正确（回读一致 ≠ 你看过页面，建议亲自看一眼）

复核命令：

```bash
gh api repos/tbj0623/decision-arena-lab \
  --jq '{description, homepage, topics, wiki: .has_wiki, projects: .has_projects, issues: .has_issues}'
```

> 除 Social preview 外的各项都有上面的回读证据；**Social preview 一项没有任何证据**，
> 所以它不能勾。上传是动作，生效是结果，两者之间隔着 CDN 缓存。
