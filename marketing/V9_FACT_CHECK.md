<!-- STATUS: DRAFT — NOT POSTED -->

# V9 素材真实性自检 · FACT CHECK

**自检时间**：2026-10-29 23:20–23:45（Asia/Shanghai）
**自检人**：growth-producer
**核对对象**：`launch_user_v9.md` / `launch_dev_v9.md` / `short_video_30s_v9.md`
**基准**：线上 https://tbj0623.github.io/decision-arena-lab/ （HTTP 200），本地 HEAD `8102f77`

---

## 零、基准先自己验，不采信转述

| 项 | 我的测法 | 结果 |
|---|---|---|
| 测试条数 | `node --test` | **187 tests / 187 pass / 0 fail / 0 todo** ✅ |
| 站点可用 | `curl -w %{http_code}` | **200** ✅ |
| **线上是否同一版本** | 下载线上 `app.mjs` / `core.mjs` / `index.html` / `features/narrative.mjs`，与仓库逐一比对 **sha256** | **四个文件哈希完全一致** ✅ |
| 与远端 main 的关系 | `git fetch` → 比对 `origin/main` 与我本地 HEAD 的 `site/` 文件哈希 | **site/ 四个文件完全相同**（提交历史不同：本地 `8102f77` 是 `design/v9-brand-experience`，远端 main 是 `4413fa9`，但**渲染出的站点是同一份**） |
| 版本号 | `site/core.mjs:24` | `export const VERSION = '1.1.3'` |

> 说明：Lead 给的是 `main: 4413fa9c`，我本地在 `8102f77`。两者 site/ 文件哈希一致，所以"线上显示什么"这件事没有分歧。**我没有在素材里写任何提交号或版本号**——读者在页面上找不到对应物，写了是噪音。

### 数字的验证方式

**不只跑 Node。** 我用 Playwright 打开线上真实页面，操作真实滑杆，读真实 DOM 文本。

---

## 一、逐条核对表

### A. `launch_user_v9.md`

| 断言 | 怎么验证的 | 判定 |
|---|---|---|
| 首屏有可拖动的真实示例 | 浏览器打开，`#hero-slider` 存在且 `step="any"` | **MATCH** |
| 「页面右上角」的位置描述 | 390×844 实测：`#hero-demo` 在 `y=577`，`.hero-copy` 底部在 `y=545` → **手机上是上下堆叠，不在右侧** | **MISMATCH → 已修**（改为"桌面端在右侧、手机上在下面"） |
| 示例标题「接不接这家小团队的 offer」 | 浏览器读 `#hero-demo-title`.textContent | **MATCH** |
| 方案 A「去那家刚起步的小团队」/ B「留在现在的岗位」 | 浏览器读两个 `.hero-demo-score-label` | **MATCH** |
| 初始 **A 70.7 / B 63.6**，差 **7.1**，倾向 A | 浏览器实读：`70.7` / `63.6` / 「更倾向『去那家刚起步的小团队』，差 7.1 分。」 | **MATCH** |
| 滑杆标签「调整『收入确定性』的权重占比」，起点 **28.6%** | 浏览器实读 label 与 output | **MATCH** |
| 拖到 **33%** → **68.8 / 64.6**，差 4.2 | 浏览器实读 | **MATCH** |
| 拖到 **40%** → **65.8 / 66.2**，差 0.4，倾向 B | 浏览器实读 | **MATCH** |
| 39.4% 附近 → **A 66.1 / B 66.1**，出现「临界」徽章 | 浏览器实读：`66.1`/`66.1`，`data-state="tie"`，`::before` content = `"临界"` | **MATCH** |
| 徽章文案「两个方案打平了——这是最容易被撬动的时刻。」 | 浏览器实读 `#hero-verdict` | **MATCH** |
| 按钮「免费开始分析」「30 秒看懂示例」 | 浏览器读 `.hero-actions .btn` | **MATCH** |
| 「30 秒看懂示例」会把示例载入决策台并滚动 | 浏览器实测：点击后 `#option-a` 从「那台很轻的笔记本」变成「去那家刚起步的小团队」，`scrollY` 从 0 变 1059 | **MATCH** |
| 示例有 **4 个因素** | `core.scoreDecision` 读 `factors.length` = 4 | **MATCH**（初稿误写"七个"，已改） |
| 提供「一个 7 天内做完的小动作」 | 浏览器读 `#verify-body`，含三条动作，第一条「找 1 位真实经历过其中一个选项的人…」 | **MATCH** |
| 不登录 / 不上传 / 刷新就没了 | 浏览器实测 `localStorage` `sessionStorage` `document.cookie` 全空；`performance.getEntriesByType('resource')` 无跨域资源 | **MATCH** |
| 页面底部有完整公式可自己算 | 浏览器读正文，含「得分 S = 10 × Σ（pi × 你给方案打的 0–10 分i）」 | **MATCH** |
| 不是概率 / 换权重就变 | 页面原文「换一套权重、换一天心情，它就会变。它不是概率。」 | **MATCH** |
| 不适合医疗法律财务 | 页面原文「医疗、法律、财务、危机处置等决定，请找有资质的专业人士。」 | **MATCH** |
| 示例为虚构 | `site/features/narrative.mjs` 文件头与页面章节标题「五个虚构例子」 | **MATCH** |

### B. `launch_dev_v9.md`

| 断言 | 怎么验证的 | 判定 |
|---|---|---|
| 原生 HTML/CSS/JS + ES Modules | 读 `site/index.html`（`<script type="module">`）与 `site/*.mjs` | **MATCH** |
| 零依赖、无 `package.json`、无构建 | `ls package.json` → 不存在；仓库根无构建配置 | **MATCH** |
| 无后端、无数据库、无 API | 全站静态资源；`check-no-network.mjs` PASS | **MATCH** |
| **187 项测试全通过** | `node --test` 实跑 | **MATCH** |
| `node --test tests/` 在 Node 24 报错 | 实跑 → `Cannot find module ...\tests`，`MODULE_NOT_FOUND`（Node v24.20.0） | **MATCH** |
| 公式 $p_i = w_i/\sum w_j$ | 页面原文「你给每个因素的权重是 wi，先算总和 Σw，再算占比 pi = wi / Σw」 | **MATCH** |
| 公式 $S = 10 \times \sum p_i r_i$ | 页面原文「得分 S = 10 × Σ（pi × 你给方案打的 0–10 分i）」 | **MATCH** |
| 闭式解 $t^* = -d_{others}/(d_k - d_{others})$ | 页面原文「Δ(t) = t·dk + (1−t)·dothers，解 Δ(t)=0 得 t* = −dothers / (dk − dothers)」 | **MATCH** |
| 三种状态码 FEASIBLE / BOUNDARY / OUT_OF_RANGE | `core.mjs` 源码；实跑 `oldguitar` 得 5 个全 `OUT_OF_RANGE` | **MATCH** |
| 「所有因素评分差同号 → 翻不过来，工具直说」 | 页面原文「如果所有因素的评分差都是同一个方向…工具会直接说"翻不了"，而不是编个数字哄你」；`oldguitar` 实测 0/5 feasible | **MATCH** |
| `oldguitar` 5 个因素全 OUT_OF_RANGE | 实跑 `findFlipThresholds` | **MATCH** |
| 审计脚本扫描 **12 个文件 / 约 248 KB** | 实跑 `node scripts/check-no-network.mjs` → 「扫描了 12 个文件，共 248096 字节」 | **MATCH**（初稿写"10 个 /213KB"，已改） |
| 审计覆盖 fetch/XHR/WebSocket/sendBeacon/localStorage/sessionStorage/indexedDB | `grep` 脚本源码，七种模式均在 | **MATCH** |
| 浏览器实测无跨域资源、存储全空 | Playwright 实测三种存储均为空，资源列表无跨域项 | **MATCH** |
| 核心导出清单（scoreDecision 等） | `grep "^export" site/core.mjs`，逐个对照 | **MATCH** |
| site/ 目录结构（含 `features/interval.mjs`） | `find site -type f` | **MATCH**（初稿漏了 `interval.mjs` 与 `assets/`，已补） |
| `serve.mjs` 只监听 127.0.0.1:8080 | 读 `scripts/serve.mjs` 源码注释与 `HOST` 常量 | **MATCH** |
| MIT 许可 | `LICENSE` 首行 "MIT License" | **MATCH** |
| 「四条底线」贡献规则 | ⚠️ **初稿写成"写在 docs/LIMITATIONS.md 里"是错的**——该文件没有这四条。已改为「我按项目实际约束总结的，不是某份文件原文」 | **MISMATCH → 已修** |
| 多角色协作但非"AI 自动完成" | 我无法枚举凭证 | **UNVERIFIABLE**（保留但未做量化断言） |

### C. `short_video_30s_v9.md`

| 断言 | 怎么验证的 | 判定 |
|---|---|---|
| 镜头 1 首屏文案「你真正犹豫的，也许只是一个条件。」 | 浏览器读 `.hero-copy h1` | **MATCH** |
| 镜头 1 两个按钮文案 | 浏览器读 `.hero-actions .btn` | **MATCH** |
| 镜头 1「真实示例 · 可拖动」+「LIVE」 | 读 `site/index.html:115-116` | **MATCH** |
| 判定行「此刻更倾向『…』，差 7.1 分。」格式 | 浏览器实读 | **MATCH** |
| 镜头 2 三格数字（28.6/33.0/40.0） | 浏览器逐点实读 | **MATCH** |
| 镜头 2 A 领先 → B 领先的换边 | 浏览器实读：28.6% state=lead(A)，40.0% 倾向「留在现在的岗位」 | **MATCH** |
| 镜头 3 A 66.1 = B 66.1 | 浏览器实读 | **MATCH** |
| 镜头 3「临界」徽章由 CSS `::before` 生成 | 读 `site/styles/app.css:826-832`，`content: "临界"` | **MATCH** |
| 镜头 3 打平窗口约 39.35%–39.45% | 浏览器逐点扫描：39.3% lead / 39.35% tie / 39.45% tie / **39.5% lead** | **MATCH**（初稿只说"40% 不打平"，已把窗口写清） |
| 镜头 3 输出框保留 1 位小数 | 浏览器实读 output = `39.4%`（拖到 39.39% 也是 `39.4%`） | **MATCH** |
| 镜头 4 点按钮载入示例 + 滚动 | 浏览器实测（同上） | **MATCH** |
| 镜头 4 五个区域标题 | 浏览器读 `#workspace` 内标题：1 你在纠结什么 / 2 你在意哪些因素 / 3 现在的倾向 / 4 什么条件会翻转结论 / 5 先去做这一件事 | **MATCH** |
| 镜头 4 区域 3 判定文案 | 浏览器实读「按你现在的打分，更倾向「去那家刚起步的小团队」。」 | **MATCH** |
| 镜头 4 区域 4 标题（约到 39.39%，精确 39.3939%，**再往上**） | 浏览器实读，**方向确为 increase** | **MATCH** |
| 镜头 4 免责小字「不是成功率、不是预测、也不是科学测量。」 | 浏览器读页面正文 | **MATCH** |

---

## 二、汇总

| 判定 | 条数 |
|---|---|
| **MATCH** | **50** |
| **MISMATCH（自检中发现并已修）** | **4** |
| **UNVERIFIABLE** | **1** |
| 合计 | **55** |

### 4 处 MISMATCH（均已修正）

| # | 文件 | 错在哪 | 怎么发现的 | 已改为 |
|---|---|---|---|---|
| 1 | `launch_user_v9.md` | 写「**七个**因素里哪个最该去核实」 | 跑 `factors.length` 发现只有 **4** 个 | 「**四个**因素里…」 |
| 2 | `launch_dev_v9.md` | 写审计扫描「**10 个文件、约 213 KB**」 | 实跑脚本输出「12 个文件，248096 字节」 | 「**12 个文件、约 248 KB**」 |
| 3 | `launch_dev_v9.md` | 写「四条底线**写在 docs/LIMITATIONS.md** 与贡献说明里」 | `grep` 该文件，**没有这四条** | 改为「我按项目实际约束总结的，不是某份文件原文」 |
| 4 | `launch_user_v9.md` | 写「页面**右上角**就有一个能拖的示例」 | 390×844 视口实测：演示卡在标题**下方**（`demo.top=577` > `copy.bottom=545`） | 改为「桌面端在标题右侧，手机上在标题下面」 |

> 第 3 条性质最严重：不是数字错，是**编造了一个出处**。这类错误最难自查，因为数字看起来都对。
> 第 4 条是**只在特定视口下才成立**的相对位置描述——数字全对，但换了屏幕就是错的。

### 1 处 UNVERIFIABLE

| 文件 | 断言 | 为什么无法核实 |
|---|---|---|
| `launch_dev_v9.md` | 「由 Lead 加多个角色协作完成」 | 我无法枚举本次协作的实际参与凭证。**已刻意不写具体人数与角色数**（上一版写过"8 个角色"，这版去掉了量化） |

---

## 三、红线自查

`node marketing/check-redlines.mjs` 结果见汇报。人工另查：

- [x] 三份文件首行均为 `<!-- STATUS: DRAFT — NOT POSTED -->`
- [x] **不得**出现肯定式的「成功率 X%」「准确率」「胜率」断言（全文检索：无）
- [x] **不得**出现「AI 帮你决定」「科学预测」类表述（全文检索：无）
- [x] **无任何用户数 / star 数 / 访问量 / 好评**（全文检索确认，一个都没有）
- [x] 无真实品牌名、公司名、真人名（示例全部来自虚构数据）
- [x] 所有数字均可在线上复现（见上表逐条）
- [x] 未写版本号、提交号（页面不显示，写了是噪音）

**当前状态：三份素材已按线上 v1.1.3 实况核对完毕，全部为待发草稿，未发布。**
