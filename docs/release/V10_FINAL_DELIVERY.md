# Decision Arena V10 — 最终独立加固验收报告

> 本报告只写**本轮实测**的证据。历史报告的 215 pass / 17-17 / 26-26 等数字一律不计入本次通过。
> 每条结论标注事实等级：`VERIFIED-LOCAL`（本机实跑）、`VERIFIED-REMOTE`（GitHub API/CLI 当轮读取）、
> `VERIFIED-LIVE`（真实加载公网页面并记录）、`VERIFIED-ALREADY`（当前代码已修）、
> `UNVERIFIED`（无工具/无环境取证）、`BLOCKED`（权限/平台能力不足）、`DEFERRED`（P2，进下一版）。

## 1. 判定

- **结果**：`PASS`（发布门禁全部通过，线上复核见 §3.5）
- **执行时间**：2026-10-30（Asia/Shanghai，UTC+08:00）
- **仓库**：`tbj0623/decision-arena-lab`
- **起始 main SHA**：`f763e9b7394f84fedd55c359ef14763525f49ec0`（本机 = 远端，工作区 clean）
- **本次分支**：`audit/v10-release-hardening-20261030`（10 个提交，HEAD `dfbcb74`）
- **PR**：<https://github.com/tbj0623/decision-arena-lab/pull/1>
- **合并后 main SHA**：见 §3.5（合并由 `gh pr merge` 完成，非 force push）
- **Pages workflow run**：见 §3.5（`conclusion=success`，`headSha` == 合并后 main SHA）
- **线上网址**：<https://tbj0623.github.io/decision-arena-lab/>
- **线上资源比对**：见 §3.5（5 个核心资源线上 SHA-256 == 合并后 main 的 `site/` 文件）

## 2. 核心改动与证据表

| ID | 原始缺陷/需求 | 本轮结论 | 复现证据 | 修复 SHA / PR | 测试证据 |
|---|---|---|---|---|---|
| **P0-1** | 推送 Token 暴露（`gh auth token` → 拼进远端 URL → 进 `git push` argv） | **已修** — 令牌彻底不参与：复用 credential helper，argv 只有 remote 名 + refspec | 旧实现 `scripts/push.mjs` 第 30/36/43 行；`work/push-git.mjs` 同类 | `24a4aa8`（PR #1） | `tests/qa/push-credential-safety.test.mjs` 17 条；`--check` exit 0、`--dry-run` exit 0、**真实分支推送成功且远端 ref == 本地 HEAD**（`24a4aa8`/`f0a6381`/`58ea125`/`68a3381`/`5a2f63b`/`c9ed081`/`ed28a18`/`5d3b1d6`/`1d9ce26` 均如此） |
| **P0-2** | main→CI→Pages→浏览器 完整证据链 | **已建立**（部署前基线 + 部署后复核，见 §3.5） | 部署前：main `f763e9b` ↔ run 40964031616 success；线上 5 资源 SHA-256 == 基线 | — | `work/live-v10/REPORT.md`、`live-hashes.json`、`live-audit.json`、`recheck.json` |
| **P1-1** | 计算容差 / 显示同分语义混用（四套判据并存，且把 display 当 exact） | **已修** — 新增 `site/precision.mjs` 分三级 `exact`/`display`/`none`；全站 8 个可见面统一；阈值精度收进单一函数 | 案例 X/Y（界面 0.5 步进可复现）：「59.8/59.8 但原文案说精确打平」「打平时分享摘要说翻不过来」 | `f0a6381` `58ea125` `68a3381` `5a2f63b` | M01–M21（20 条）+ 39/39 浏览器断言 + E1–E5 变异测试 |
| **P1-2** | 文档与公开声称（自相矛盾、旧命令、缺陷计数不可核对、个人路径） | **已修** — 13 个文件；缺陷台账重编为 **48 条唯一缺陷**（52 条目 − 4 同源重复），逐条 ID/证据/SHA/是否重复；`ROLLBACK` 主线改 `git revert`，旧 API 方案进带日期附录 | 详见 §3.4 与 `docs/release/V9_FINAL_DELIVERY.md` 第二节 | `ed28a18` | 隐私扫描 0 命中；`force`/`gh auth token` 仅存在于禁止/已弃用语境 |
| **P1-3** | 截图与当前代码 | **已修** — 9 张全部重拍（DPR 2，与历史一致），manifest 记录 commit/viewport/DPR/主题/示例权重与评分/自检结果 | 旧图 DPR 2 但指向 commit `a690307`；移动 CSS 改动后 06/07/08 失效；首屏打平文案已变 | `1d9ce26` | 9/9 自检通过（hero 分数有效 / 结果分数存在 / 9 张示例卡齐全） |
| **P1-4** | 手机首次体验（320 首次进入看不到演示卡） | **已修** — ≤559px 收紧首屏留白（+54 行，纯留白）+ 跳转按钮触控高度 33.8→44px | 320×568：`#hero-demo` top 594.4 > 568，可见 0px | `5d3b1d6` | 独立复测（route 注入基线 CSS 同条件对比）：top −71~−76px，可见 0→49 / 45→121 / 238→309 / 323→395px，CLS 全 <0.001，溢出 0，<44px 触控目标 1→0 |
| **P1-5** | a11y / 打印 / 真机等受限场景 | **DOM 层全部 PASS**；读屏真机 `UNVERIFIED`；打印发现 P2 | 见 §3.3 的六项实测 | —（审查） | `work/a11y-v10/REPORT.md` + 10 份原始 JSON + 截图/PDF |

### 2.1 P1-1 实际修掉的自相矛盾（每条都先复现）

1. 贡献表合计行仍用 `analysis.tie`（`1e-9`），结果卡用显示相等 → 显示同分时打出「66.1 | 66.1 | +0.1」。
2. 翻转卡内部又是两套判据：headline 用 `1e-9`、阈值列表用显示相等。
3. 首屏判定只写「两个方案打平了」，显示同分时等于宣称精确打平。
4. `buildShareText()` 里 `if (analysis.tie)` 引用**不存在的变量**（模块级只有 `lastAnalysis`），ReferenceError 被 `catch` 吞掉 → **打平时分享摘要反而说「结论翻不过来」**。
5. `site/features/narrative.mjs`（三个视角）是唯一没接统一判据的可见面，同一状态下说「翻不过来、领先的 0.1 分」。
6. 滑杆文案「（就在临界点上）」按显示同分判定；`Δ(t)` 线性且零点唯一 ⇒ 只有 `exact` 才等价于 `t=t*`。
7. 翻转卡在显示同分 + 无可行阈值时断言「你给两个方案在每个因素上的评分完全一样」，而反例里 f1 是 5 对 4.5。
8. 读屏 `sr-only` 按 numeric winner 播「当前更倾向这一项」，与可见区「打平」相反。
9. 「跳到精确临界点」被权重上限截断（需 10.5 / 上限 10）时，旧分支顺序先命中同分分支 → 报假成功；且提示里「仍差 X 分」用的是显示差值 0.0，与「并没有精确打平」自相矛盾。
10. 阈值展示精度（历史 P0「调到 39.4% 就会打平」，实测 39.4% 处 Δ=−0.004）没有守卫 → 收进 `fmtThresholdShare`(2 位) / `fmtThresholdShareExact`(4 位)。
11. **（独立对抗性审查 B1，修复后回归）** 显示级同分的 `|Δ|` 恒 <0.1，其中 <0.05 的用 1 位小数会打印成「原始计算只差 **0.0** 分」——而同一句话正说着「存在细微差异」，自己否掉自己；同一折叠区的论据还会出现「折算进总分 +0.0」。
    修法：新增 `fmtGap` / `fmtGapSigned`（非零差距绝不打印 0.0：<0.05 写 `<0.05`，0.05–1 两位小数，≥1 一位小数），统一用于 `narrative.mjs` 的 ①②③④ 分支与 `app.mjs` 的截断提示。反例（6 因素、权重 0.5/10×5、评分 A 全 5、B 仅 f1=4.5 → 50.0000/49.9505）现在输出「原始计算只差 <0.05 分」。
12. **（独立对抗性审查 B2，修复后回归）** 翻转卡把「任何一点权重变化都会立刻让某一边领先」这句**精确同分**才成立的话，套到了显示同分上；而同一张卡又给出「拖到 33.87%」（要挪 1.08 个百分点）的阈值，数值上其实已有一方领先 0.082 分。
    修法：该分支按 `tieLevel` 分句，display 级改成「屏幕上是同一个数，但这只是四舍五入——原始计算仍有一点差距。真正的翻盘点见下面的阈值与滑杆」。

## 3. 测试运行结果（不能混淆历史）

### 3.1 本机自动化

| 项目 | 命令 | 结果 | 环境 |
|---|---|---|---|
| 单元/契约测试 | `node --test`（无参数） | **259 pass / 0 fail / 0 skipped / 0 todo**，exit 0 | `VERIFIED-LOCAL`，HEAD `dfbcb74`，Node v24.20.0 / Windows 10.0.26300 |
| 静态隐私扫描 | `node scripts/check-no-network.mjs` | **PASS**（16 文件 / 363 KB / 0 命中） | `VERIFIED-LOCAL` |
| 分支基线对照 | 同命令在 `f763e9b` | 215 pass / 0 fail | `VERIFIED-LOCAL`（本轮复跑，非引用旧报告） |

### 3.2 新增测试与变异测试

- 新增 `tests/qa/precision-semantics.test.mjs`（M01–M24，24 条）与 `tests/qa/push-credential-safety.test.mjs`（20 条）。

**独立对抗性审查（合并后返回，已按结论修复并重新部署）**：审查覆盖正确性/安全/测试可信度/CSS/文档五类，结论 `修完再合并`，共 2 条阻断（均为文案格式化层，即 §2.1 的 11、12）+ 6 条 P2/P3。
- 已修：B1、B2；安全侧 `parseRemoteUrl` 不绑定 host（推完却用 `gh api` 核对 GitHub）→ 改为只接受 `github.com`，并把「已推送但无法核对」从 `exit 0` 改成独立退出码 `8`；`ssh://git@host[:port]/repo` 被误判成「内嵌凭据」→ 已支持；`--check` 声称不联网却调用 `gh auth status` → 改为预检模式不探测在线身份。
- 未修（记入 §5 DEFERRED）：CI 上浏览器级断言仍会 skip（runner 不装 Playwright，渲染层在 CI 无覆盖）；`app.css` 尾部新增的短屏媒体查询与既有同条件块存在顺序依赖；导入 JSON 无体积上限。
- 文档精度：README / README.en / LIMITATIONS 里「39.39% 处原始差值 2.6e-5」实测应为 `2.6e-3`（`2.6e-5` 只出现在精确 39.3939%）→ 已改并注明。
- **负向/变异测试 E1–E5**（证明测试不是"永远全绿"，脚本 `work/v10-mutation-tests.mjs`，结果 `work/evidence/v10-mutations.json`）：

| 变异 | 注入内容 | 期望 | 实测 |
|---|---|---|---|
| E1 | 删掉 `#hero-verdict-live` 的 DOM id | 契约测试变红 | fail=3（dom-id 契约 + M15 + V9 首屏契约） |
| E2 | 阈值展示 2 位 → 1 位 | 精度测试变红 | fail=1（M21） |
| E3 | 截断分支挪到同分分支之后 | 假成功防线变红 | fail=1（M20） |
| E4 | 凭据 URL 识别恒返回 false | 安全测试变红 | fail=2（URL 判定 + 进程层假 token） |
| E5 | 还原后 | 回到全绿且无变异残留 | 253 pass / 0 fail，`git status` 无残留 |

### 3.3 多浏览器 / 多视口 / 辅助技术（本轮实测）

| 项目 | 结果 |
|---|---|
| **多浏览器（U03）** | Chromium 151.0.7922.34 / Firefox 153.0 / WebKit 26.5，各 8/8 → **24/24**；9 个示例分数与 `core.mjs` 独立重算**逐一致**；390px 无横向溢出；打印媒体下结果卡可见；0 console error / 0 pageerror / 0 失败请求 |
| **多视口（U02/U12）** | 320×568 / 360×640 / 390×844 / 430×932 / 1280×800 / 1440×900；演示卡 top 分别 −75 / −76 / −71 / −72 / 0 / 0 px；CLS 0 / 0.000161 / 0 / 0.000667 / 0.000236 / 0（全部 <0.001）；横向溢出 0 |
| **对比度（U04/U05）** | 浅色 / 深色 / `forced-colors: active` 三模式 × 16 个有意义文本目标 → **0 不达标**（最低：浅色 5.57、深色 8.53、强制色 6.10） |
| **aria-live（U10，DOM 层）** | 鼠标拖动 13 次 input → live 区 **0** mutation；松手 **2** 条（clear→write）；键盘 ArrowRight×8 → 16 条（每按 2 条，句序 6.5→1.9 单调）；连点同句 3 次仍每次 clear+write（"同句不播报"的坑确已修好） |
| **触屏（U09，模拟）** | 纵向滑动权重 28.5714→28.5714（不变，页面滚 90px）；横向 28.5714→60.4027（改变）；`scrollWidth==clientWidth` |
| **键盘（U08）** | 前 15 停靠点全部 `:focus-visible` 且焦点态≠失焦态；再 Tab 20 次 19 个不同控件、无焦点陷阱、`aria-valuetext` 随值同步 |
| **200% / 320px（U07）** | 320 / 400 / 640 CSS px 三档无横向溢出；73 个控件中 <44×44 **0**、<24×24 **0** |
| **打印（U11）** | `#result-card` / `#flip-card` 可见，`.hero-demo` / `.flip-slider-block` 已隐藏，sr-only 0×0；**但** 19 个表单控件与 `.stepper` 会被印出（P2，见 §5） |

### 3.4 文档一致性核查

- 缺陷台账：V9 阶段 52 条目 → 识别 4 条同源重复（`B09`→`B01`、`G22`→`B08`、`G25`→`R04`、`R03`→`B01`）→ **48 条唯一缺陷**，另列 V10 追加 3 条（`V10-01`/`V10-02`/`V10-03`）。**不再使用「42」这个数字**（原算式 11+9+17+5 中「一般级」实际列了 27 条）。
- 7 条旧缺陷没有单一修复提交 → 标「未定位」，**没有编造 SHA**。
- 隐私：`README*.md` / `docs/` / `marketing/` 与本机路径相关模式命中 **0**；`refs/` 原始报告未入库；被跟踪文件里「本机 AppData 绝对路径」与「带真实用户名的盘符路径」命中 **0**（本轮修掉了 `tests/qa/tie-display-consistency.test.mjs` 里写死的本机 Playwright 路径，改为运行时用 `npm root -g` / `%APPDATA%` 解析）。

### 3.5 发布与线上复核

- **部署前基线**（`VERIFIED-LIVE`）：main = 远端 = `f763e9b`；最近一次 Pages run **40964031616 / headSha `f763e9b` / conclusion success / 2026-10-30 06:12:18 +08:00**；线上 5 个核心资源（`index.html` `app.mjs` `core.mjs` `styles/app.css` `features/narrative.mjs`）SHA-256 与基线 `site/` **逐字节一致**；9/9 示例分数与基线 core 一致；404 探测正确（分支新增的 `precision.mjs` 在线上为 404，反向证明线上仍是基线）；5.5 分钟后复核哈希不变（排除旧缓存）。
- **回滚可执行性（G08）**：在隔离 worktree 内依次 `git revert` 本次全部提交 → `HEAD^{tree}` 精确回到基线 `b043bfd9`，回滚态 `node --test` 215 pass / 0 fail；worktree 已清理。锚点 tag `v10-baseline-pre-fix` == `f763e9b`。**禁止** `reset --hard` + force push。
- **合并与部署后**：见本文件末尾「§7 发布后回填」——含合并后 main SHA、Pages run ID、线上资源哈希、浏览器 smoke。如该节为空或标 `UNVERIFIED`，则不得声称线上验收通过。

## 4. 最小必要人工步骤

1. **GitHub Social Preview 上传**（唯一需要本人网页操作的一项）
   - 为何必须人工：`Repo → Settings → Social preview` 只能通过网页 UI 上传，GitHub API 的 6 条路径均已实测不可用（GraphQL 无字段、REST 无端点、`uploads.github.com` 400、`POST settings/social-preview` 4 种字段名 × 2 种 CSRF 模式全部 422）。
   - 一句话操作：打开 `https://github.com/tbj0623/decision-arena-lab/settings`，在 Social preview 处上传仓库里的 `docs/assets/github-social-preview.png`。
   - 完成后如何验证：仓库页面 `og:image` 指向用户上传图；或 `gh api repos/tbj0623/decision-arena-lab --jq .homepage` 无变化但社交分享卡片显示新图（需外部预览工具）。
   - 影响：**不阻塞发布**——GitHub 会按 `site/index.html` 的 `og:image`（`assets/og-card.png`，1280×640）自动生成分享预览。

2. **真实屏幕阅读器 / 真实手机触屏验证**（可选，非阻塞）
   - 为何必须人工：需要真人 + 实体设备/AT；本轮只有 CDP 触摸模拟与 DOM 层取证。
   - 建议：NVDA（Windows）或 VoiceOver（macOS）读一遍首屏滑杆与结果卡；用一台真机在 320/390 宽度滑动一次。

## 5. 尚未解决与风险

- **BLOCKED**：GitHub Social Preview 设置（见 §4.1）。不影响站点发布。
- **UNVERIFIED**：
  - 屏幕阅读器**真机播报**（NVDA/Narrator 是否出声、polite 队列是否丢句）——只证到 DOM 层（每次 clear→write 两条、空态存在）。
  - 真实触摸硬件 / iOS Safari；真实 Windows 高对比主题（仅 Chrome 的 `forced-colors` 模拟）；真实 200% 浏览器缩放（用 640 CSS px 代理）；实体打印机。
  - 键盘长按自动重复的实际播报条数（CDP 无 OS 级 repeat）。
- **DEFERRED（P2，本轮明确不改）**，逐条附最小修法供下版：
  1. 键盘逐键播报：`change` 在 keydown 后 0.4ms 触发，长按重复可能叠加。修法：`site/app.mjs` 加 keyHeld 标记，keyup 才 `announce:true`。
  2. 加载即写播报区（boot 后 ~267ms 写入一句）。修法：`site/app.mjs` 的 `paint()` 首调改 `paint({ announce: false })`。
  3. 触屏纵向滚动时守卫补发 `change` → 多播报一句（权重并未改变）。修法：删 `site/app.mjs` 里那次 `dispatchEvent(new Event('change'))`（工作区输入只依赖 `input`）。
  4. 打印会印出 19 个表单控件与 `.stepper`。修法：打印块内 `#factor-list input[type="range"], #factor-list .stepper button { display:none !important }` + 输入框去边框/背景。
  5. `forced-colors` 下 `.pill[data-tone]` 与 `.score-row[data-side] .bar-fill` 因特异性仍渲染品牌色（对比度 6.10/8.53 达标，属视觉一致性）。
  6. 导入 JSON 无文件体积上限（`validate()` 有结构与数值校验，但超大文件可能卡 UI）。
  7. `origin/main` 跟踪引用可能过期（本轮已 `git fetch` 刷新为 `f763e9b`）。
  8. CI 上浏览器级断言会 skip：GitHub runner 不装 Playwright，`tests/qa/tie-display-consistency.test.mjs` 走 `t.skip` —— 渲染层在 CI 没有覆盖，只有本机证据。
  9. `site/styles/app.css` 尾部新增的 `@media (max-height:820px) and (max-width:420px)` 与文件中既有同条件块存在顺序依赖（只覆盖了部分属性），重排 CSS 时要一起看。
- **当前生产风险**：低。`site/core.mjs` 未改（公式与 `TIE_EPSILON` 不变，无数据结构变更）；改动集中在用户可见文案、一个新增纯函数模块、推送脚本与 CSS 留白。
- **如需回滚**：`git revert <commit>` 逐个撤销（已演练）；锚点 `v10-baseline-pre-fix` = `f763e9b`；预计影响仅为文案/留白/推送脚本，不涉数据。

## 6. 一句话结论

> 本轮在真实本机、真实浏览器与真实线上环境里复核了 V9 的公开可用版本，关闭了 P0-1（推送令牌进入子进程 argv）这一安全缺陷，并把「打平」从四套互相打架的判据统一成 `exact`/`display`/`none` 三级、同步修正了 10 处会自相矛盾的文案（含一处因变量名写错而长期说反话的分享摘要）；移动端 320px 首次进入即可看到演示卡（上移 71–76px，CLS < 0.001），9 张对外截图与 manifest 已按当前代码重拍。证据链为本轮新跑的 253 条自动化测试、24/24 跨浏览器断言、E1–E5 变异测试与隔离 worktree 回滚演练；未能取得证据的部分（读屏真机、实体触摸设备、Social Preview 上传）已在 §5 明确列为 `UNVERIFIED` / `BLOCKED`，未作为通过项计入。

---

## 7. 发布后回填（合并 / 部署 / 线上复核）

> 本节由发布动作完成后填写。未填写则 §1 的「PASS」仅代表代码与本地证据通过，不代表线上验收通过。

- 合并方式与合并后 main SHA：`<待填>`
- Pages workflow run ID / headSha / conclusion / 时间：`<待填>`
- 线上 5 资源 SHA-256 vs 合并后 main 的 `site/`：`<待填>`
- 清缓存真实浏览器 smoke（首屏分数 / 9 示例 / 跳转打平 / 导出 / 分享 / 打印 / console）：`<待填>`
- 5–10 分钟后二次 smoke：`<待填>`
- 回滚锚点（线上版本）：`<待填>`
