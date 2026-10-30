# ROLLBACK_V9 — 回滚预案

> **当前版本（2026-10-30）**：本文的**主线是 `git revert`**，因为它在本机已经完全可执行。
> **第二部分（附录）是 2026-10-29 网络阻断期的历史兜底方案**，保留作证据，
> 每条都标注了日期与「不适用当前条件」——不要在 2026-10-30 之后照着它跑。

---

## 0. 本轮实测前提（2026-10-30）

| 项 | 本轮实测 | 怎么复核 |
|---|---|---|
| 工作分支 | `audit/v10-release-hardening-20261030` | `git rev-parse --abbrev-ref HEAD` |
| 提交数 | `54` | `git rev-list --count HEAD` |
| `main` 与远端 main | **一致**，都是 `f763e9b` | `git rev-parse main` + `git ls-remote --heads origin main` |
| 历史是否连通 | **是**。`git cat-file -t 847eb57e` → `commit`（V8 基线对象本地存在） | `git cat-file -t 847eb57e` |
| `git revert` 是否可跑 | **可以**。`git revert --no-commit 90d7f39` → 退出码 `0`，输出 `Auto-merging site/app.mjs`（随后 `git revert --abort`，工作区干净） | `git status --porcelain` 应为空 |
| 测试 | `253 pass / 0 fail` | `node --test` |

> 数字会随提交变化（写作时 HEAD = `5a2f63b`）。**引用前请现查**，本文不把它们当常量。
> 本地 `origin/main` 这个远程跟踪引用可能停在旧的 fetch 结果（本轮实测停在 `5450e5d`），
> 这**不影响** `revert`；要看真实远端用 `git ls-remote`，或先 `git fetch origin` 刷新引用。

---

## 一、首选路径：`git revert`（当前唯一推荐）

`git revert` 产生一个**反向提交**，历史保留、可审计、不需要 force push。
这也是本项目唯一允许的回滚方式（红线：**禁止 `git push --force` / `--force-with-lease`**）。

```bash
# 0) 从仓库根开始（路径用相对路径，本文件不记录任何本机绝对路径）
cd decision-arena-lab
git status --porcelain          # 必须为空再动手

# 1) 找到要撤的提交
git log --oneline -10

# 2) 撤掉单个提交（生成反向提交，历史保留）
git revert <sha>

# 3) 撤掉一串：按从新到旧逐个 revert，最后一次性提交
git revert --no-commit <newest>
git revert --no-commit <next>
git commit -m "revert: 撤销 <newest>..<oldest>"

# 4) 只看历史文件长什么样，不动工作区
git show <sha>:site/app.mjs | head -40

# 5) 复测（这一步不能省）
node --test                                  # 应 253 pass / 0 fail
node scripts/check-no-network.mjs            # 退出码 0
```

**冲突怎么办**：`git revert` 冲突时要么 `git revert --abort` 干净退出，
要么解冲突后 `git add` + `git revert --continue`。
**不要**用 `git reset --hard` 去"绕过"冲突——那会丢工作区，且解决不了历史问题。

### 推送：用 `scripts/push.mjs`，不要手搓 `git push`

```bash
node scripts/push.mjs --check      # 只做本地预检，不联网、不推送
node scripts/push.mjs --dry-run    # 连远端演练一次，不写入
node scripts/push.mjs              # 推当前分支到同名远端分支
```

- **默认拒绝直推 `main`**（受保护分支），发布时要显式加 `--allow-main`。
- 凭据走系统 credential helper（`gh auth git-credential`），**token 不进 argv**。
- **已弃用**：早期版本用 `gh auth token` 取明文令牌、拼成带 userinfo 的远程 URL 再 `git push`。
  该做法会让令牌出现在子进程命令行里（同机其他进程可读），V10 起彻底移除。
  细节见 `scripts/push.mjs` 文件头注释。
- 脚本**不使用** `--force` / `--force-with-lease`；非快进会被拒绝（退出码 5），
  这时正确做法是 `git fetch` 后 `revert` 或 rebase，不是强推。

---

## 二、回滚决策速查

```text
问题严重吗？
├─ 站点完全不能用（白屏 / 核心功能坏）  → 整体 revert 到上一个可用版本（可能多个提交）
├─ 只是首屏难看 / 不好用，其它都好      → revert 对应的单个提交
└─ 只是某张图 / 某个文件有问题          → revert 那个文件所属的提交，或单独改回
```

回滚前必做：

1. `git branch backup-before-rollback-<时间>`（本地保底，几秒钟的事）
2. 记录当前远端 SHA：`git ls-remote --heads origin main`

回滚后必做：见第三节的 5 条。

---

## 三、回滚后必须验证的清单

> 回滚 ≠ 完成。**没有验证的回滚等于没回滚。**

### 3.1 等 Pages 部署完成（约 40–60 秒）

```bash
gh run list --limit 2          # 触发后应为 queued / in_progress
sleep 50
gh run list --limit 2          # 期望 completed / success
```

失败时：`gh run view <run-id> --log-failed`。
常见原因：`Failed to create deployment (status: 404)`（Pages 未启用）、测试门禁红（回滚不完整）。

### 3.2 线上 6 个核心资源全部 200

```powershell
$base = 'https://tbj0623.github.io/decision-arena-lab/'
foreach ($p in '','app.mjs','core.mjs','styles/app.css','features/narrative.mjs','data/validation-actions.mjs') {
  try {
    $r = Invoke-WebRequest -Uri ($base+$p) -UseBasicParsing -TimeoutSec 30
    Write-Output ("{0,-30} {1} {2,8} B" -f $(if($p){"/$p"}else{'/'}), $r.StatusCode, $r.RawContentLength)
  } catch { Write-Output ("{0,-30} ERR" -f $p) }
}
```

### 3.3 反向 404 校验（证明不是"全 200 假象"）

```powershell
try { Invoke-WebRequest -Uri 'https://tbj0623.github.io/decision-arena-lab/definitely-not-here-xyz.mjs' -UseBasicParsing }
catch { $_.Exception.Response.StatusCode.value__ }
# 期望输出：404
```

> 这条不能省。如果任意路径都 200（SPA 兜底），3.2 的"全部 200"就没有意义。

### 3.4 内容与目标提交逐字节一致

```bash
git rev-parse 'HEAD^{tree}'
git ls-remote --heads origin main          # 拿到远端 SHA
git rev-parse '<远端 SHA>^{tree}'          # 与上一行比较，必须相同
```

### 3.5 浏览器真实渲染，**必须清缓存**

```js
// Playwright
const client = await page.context().newCDPSession(page);
await client.send('Network.enable');
await client.send('Network.clearBrowserCache');
await client.send('Network.setCacheDisabled', { cacheDisabled: true });
await page.goto('https://tbj0623.github.io/decision-arena-lab/');
```

确认：无白屏 · Console 0 error · 9 个示例都能载入并算出分数 · 360px 无横向溢出。

> **为什么要 CDP**：GitHub Pages 返回 `Cache-Control: max-age=600`。
> 普通刷新会继续用旧 `app.mjs`，你会误判成"回滚没生效"。本项目在 V9 验证时被坑过一次。

---

## 四、附录：2026-10-29 网络阻断期的历史兜底方案

> **日期**：2026-10-29（前提失效于 2026-10-30 05:55 CST 网络恢复）。
> **适用性**：❌ **不适用当前条件**。仅当哪天 `git fetch` / `git ls-remote` 再次不可用、
> 历史再次断开时，才退回这里。
> **为什么保留**：这是当时真实跑通过的方案，也是"为什么会有这份乱七八糟的文档"的证据。

### 4.1 当时的前提（历史记录，勿照抄）

```text
$ git log --oneline
8102f77 chore(v9): 删除远端残留的陈旧截图 mobile-360.png     ← 只有 1 个

$ git cat-file -t 847eb57e
fatal: Not a valid object name 847eb57e        ← 当时确实取不到
```

- 本机 `github.com:443` 被阻断，`git fetch` 不可用。
- 每次发布通过 GitHub API 建**根提交**（`parents: []`）推上去，
  所以本地历史与远端历史**从来没有真正连起来过**。
- 后果：`ops/release/V9_DELIVERY.md` 第六节给的三种回滚命令
  （`git revert d49ba5c6` / `git checkout 847eb57e -- ...` / `git reset --hard 847eb57e`）
  **当时一条都跑不起来**，全部报 `Not a valid object name`。
- **上面这两段命令现在的实测结果已经相反**：`git cat-file -t 847eb57e` → `commit`（历史已连通）。

### 4.2 当时的回滚锚点（远端对象，非本地）

| 名称 | SHA | tree | 说明 |
|---|---|---|---|
| V9 前基线（V8 稳定版） | `847eb57e55cf8b4844eb556aaf736e5c232b65ef` | `fd507cfc2058da41f826d37b0e505ad2908140e8` | V9 的父提交 |
| V9 首次上线 | `d49ba5c63976ff0d65fd6e231d18ef4ea70923c4` | — | V9 品牌改版本体 |
| 当时远端 main | `4413fa9c1fde2550468e58be3239c9231d2bdb11` | `7682be637639cdaa60df1a3512b134e326b0b51f` | 含两轮 `mobile-360.png` 删除 |

> 这些 SHA 在 2026-10-30 之后都已经是**本地可达的普通历史对象**，
> 现在直接 `git revert` 即可，不需要下面这套 API 流程。

### 4.3 当时的三条路径（保留，供网络再断时参考）

| 路径 | 适用场景 | 影响范围 | 当时的风险 |
|---|---|---|---|
| A. 整体回滚到 V9 之前 | V9 整体不可用 | 全部文件回到 V8 状态 | 中（丢 V9 全部工作） |
| B. 只回滚首屏 | 品牌首屏坏，其它保留 | `site/index.html` / `site/app.mjs` / `site/styles/app.css` | 低 |
| C. 只回滚某个资产 | 单张图 / SVG / OG 卡 | 1 个文件 | 极低 |

**共同的关键手法**（当时唯一可行）：新建一个 commit，其 tree 等于目标版本的 tree，
而不是 `PATCH ref` 让远端历史倒退——倒退会让所有基于旧 SHA 的引用失效。

**路径 A 的步骤要点**（当时）：

```bash
git branch backup-before-rollback-<时间>

# 从远端取 V8 的 tree（当时用 tarball；Windows 用 $env:TEMP）
curl -L -o "$TMPDIR/v8-baseline.tar.gz" \
  https://api.github.com/repos/tbj0623/decision-arena-lab/tarball/847eb57e55cf8b4844eb556aaf736e5c232b65ef
mkdir -p "$TMPDIR/v8-baseline" && tar -xzf "$TMPDIR/v8-baseline.tar.gz" -C "$TMPDIR/v8-baseline" --strip-components=1

git rm -r --cached . -q
rsync -a --exclude='.git' "$TMPDIR/v8-baseline/" ./
git add -A
git commit -m "revert(v9): 整体回滚到 V8 基线 847eb57e"

node work/push-incremental.mjs --dry-run   # 当时 git push 不通，只能走 API
node work/push-incremental.mjs
```

**路径 B / C 的核心命令**：从 `847eb57e` 用 GitHub Contents API 取回单个文件，
再 `git hash-object` 与远端 blob sha 比对，确认取到的确实是那个版本。

> ⚠️ 路径 B 当时有个已知坑：`tests/qa/v9-hero-contract.test.mjs` 断言的是 V9 首屏结构，
> 把首屏回滚到 V8 后它必然红。**正确处理是把该测试一并回滚或标 skip，
> 不要为了让测试变绿去改断言**——那是掩盖问题。

### 4.4 当时踩过的坑（知识保留，条件已变）

**（1）`github.com:443` 不通，`git push` 必失败**

```text
$ git push
fatal: unable to access 'https://github.com/...': Failed to connect to github.com port 443
```

当时唯一可用推送通道是 `work/push-incremental.mjs`（走 `api.github.com`）。
判断通道是否恢复：`curl -sS -o /dev/null -w "%{http_code}\n" --max-time 20 https://github.com/`
（`000` = 仍阻断；`200` = 已恢复）。**别用 `Test-NetConnection`，它会误报 OPEN。**

**（2）`base_tree` 让删除永远推不掉（脚本已修，知识仍有效）**

早期 `work/push-incremental.mjs` 创建 tree 时传了 `base_tree: 远端tree`，注释还写"只增量改动"。
但 `base_tree` 的语义是**叠加**：远端有、本地没有的文件会被原样保留。
实际后果：删掉 `docs/screenshots/mobile-360.png` 并推送，显示"完成"，远端文件**还在**，
tree 哈希永远对不上，而且**不报错**。

现在的行为：**不传 `base_tree`**，把本地全部文件列进 tree（全量快照）；
推完**断言** `remoteTree === git rev-parse HEAD^{tree}`，不等就 `exit(1)`。

**（3）推送成功 ≠ 部署完成**

Pages 需要约 40–60 秒。推完立刻验证会看到旧内容，容易误判成"回滚失败"。

**（4）本地 `main` 曾经是过期的**

当时本地 `main` 停在 V1.0.0 时代的孤立根 `16052d0`，直接 `git checkout main` 再推会把远端倒退。
**已解决**：现在 `main` = 远端 main = `f763e9b`（见第 0 节）。
任何时候 `git fetch origin && git status -sb` 就能确认，不要凭记忆。

**（5）`work/` 和 `ops/` 是 gitignore 的**

内部报告不要提交。`push-incremental.mjs` 用 `git ls-files`，只要不 `git add -f ops/` 就不会带上去。

### 4.5 当时的备份（已脱敏）

当时在**仓库之外的某个本机目录**做过一份备份，内容包括：`repo.bundle`（完整 git 历史）、
`worktree-full.zip`（全量工作树，排除 `.git`）、发行包 zip 及其 SHA-256、`MANIFEST.txt`。

> **这份文档不记录那个目录的绝对路径**（本机个人路径不入库）。
> 需要时在本机自行查找，恢复方式：
> `git clone <备份目录>/repo.bundle <新目录>` 或解压 `worktree-full.zip`。
> 备份里的 `refs/heads/night-v8` → `7cb5ec51` 是 `docs/screenshots/manifest.json`
> 记录截图时所在的提交，它在 `night-v8` 分支上（不在 main）。

---

## 五、红线自查（本次文档整理轮）

| 红线 | 状态 |
|---|---|
| 实际执行了回滚 | ❌ 未执行（本文件是预案） |
| 修改了远端 main | ❌ 未修改（本轮只读核对：`git ls-remote`） |
| 使用 force push | ❌ 本文不含任何 `--force` / `--force-with-lease` 命令 |
| 修改 `site/` / `tests/` / `scripts/` | ❌ 未修改 |
| 在本文件写入日志片段 / 账号 / 本机路径 | ❌ 已清理（脚本与命令只用相对路径与 `$TMPDIR` / `$env:TEMP`） |
