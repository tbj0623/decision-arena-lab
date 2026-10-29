# ROLLBACK_V9 — V9 回滚预案

> ══════════════════════════════════════════════════════════════════
> **2026-10-30 05:55 CST 更新：网络恢复，本文件的前提已改变**
>
> 下面的「三、先读这一节」写的是 **2026-10-29 的情况**：当时 `github.com:443` 被阻断，
> `git fetch` 不可用，本地只有 1 个孤立提交，所以 `git revert` / `git reset --hard`
> 一条都跑不了，只能靠 API 逐个取文件。
>
> **现在网络已恢复，本地历史已经和远端真正接通。上面那个前提作废了。**
> 实测（都已验证过）：
> ```text
> $ git rev-list --count HEAD
> 46                                  ← 不再是 1
>
> $ git log --oneline -3
> 06b552b docs(v9.32): 报告补到 42 个缺陷
> f1ac5b6 fix(v9.32): 跳转按钮在权重被截断时谎报打平 + 两卡判据不一致
> 882b620 docs(v9.31): 报告补到 40 个缺陷 / 11 条阻断
>
> $ git cat-file -t 882b620           ← 远端提交对象本地已存在
> commit
>
> $ git show 90d7f39:site/app.mjs | wc -l
> 1685                                ← 能直接读历史版本的文件
>
> $ git revert --no-commit 90d7f39    ← 真的能跑（试跑后已 --abort）
> Auto-merging site/app.mjs
> ```
>
> **所以：回滚现在优先用「一、最简回滚（git revert）」，它是首选路径。**
> 「二」及以后的 API 取文件方案降级为**兜底**（万一以后网络又断）。
> ══════════════════════════════════════════════════════════════════

---

## 一、最简回滚（git revert）—— **网络恢复后的首选**

```bash
cd C:/Users/11930/Desktop/十脑造物局/decision-arena-lab

# 1) 先确认要撤哪些提交（从最新往回看）
git log --oneline -10

# 2) 撤掉单个提交（产生一个反向提交，历史保留）
git revert <sha>

# 3) 撤掉一串（比如 v9.29 到 v9.32 共 4 个提交，按从新到旧逐个 revert）
git revert --no-commit <newest>
git revert --no-commit <next>
...
git commit -m "回滚：撤销 v9.29–v9.32"

# 4) 只想看看历史文件长什么样（不改工作区）
git show <sha>:site/app.mjs | head -40

# 5) 验证之后再推送
node --test                 # 应 215 pass / 0 fail
node work/push-incremental.mjs
```

**注意两点：**

1. `git push` 直连仍会在认证环节挂住（实测 `--dry-run` 卡住），
   **推送继续用 `node work/push-incremental.mjs`**。它推送后会断言
   `远端 tree === 本地 HEAD tree`，不等就报错。
2. revert 之后**必须复测**：`node --test` + 在浏览器里点一遍
   （首屏「跳到打平点」、9 个示例、「跳到精确临界点」、评分输入失焦生效）。
   这个项目有过「撤销 A 导致 B 回退」的记录。

---

## 二、兜底：网络再断时用 API 取文件

> 以下是 2026-10-29 网络被阻断时写的方案，**仍然可用**，
> 但除非 `git fetch` 又不可用，否则用上面「一」的那条命令就够。
## 三、先读这一节（历史记录：2026-10-29 当时的前提）

### ⚠️ 本地仓库没有 V9 之前的 commit

```text
$ git log --oneline
8102f77 chore(v9): 删除远端残留的陈旧截图 mobile-360.png     ← 只有 1 个

$ git cat-file -t 847eb57e
fatal: Not a valid object name 847eb57e

$ git cat-file -t d49ba5c6
fatal: Not a valid object name d49ba5c6
```

**原因**：这台机器 `github.com:443` 被阻断，`git fetch` 用不了；
每次发布都是通过 GitHub API 建「根提交」推上去的（`push-via-api.mjs` 的 `parents: []`），
所以本地历史与远端历史**从来没有真正连起来过**。

**后果**：`ops/release/V9_DELIVERY.md` 第六节给的三种回滚命令
（`git revert d49ba5c6` / `git checkout 847eb57e -- ...` / `git reset --hard 847eb57e`）
**在本机一条都跑不起来**，全部报 `Not a valid object name`。

### 回滚锚点（在**远端**，不在本地）

| 名称 | SHA | tree | 说明 |
|---|---|---|---|
| **V9 前基线** | `847eb57e55cf8b4844eb556aaf736e5c232b65ef` | `fd507cfc2058da41f826d37b0e505ad2908140e8` | V8 稳定版，V9 的父提交 |
| **V9 首次上线** | `d49ba5c63976ff0d65fd6e231d18ef4ea70923c4` | — | V9 品牌改版本体 |
| **当前远程 main** | `4413fa9c1fde2550468e58be3239c9231d2bdb11` | `7682be637639cdaa60df1a3512b134e326b0b51f` | 含两轮 `mobile-360.png` 删除 |

> 表格里的 SHA 是 2026-10-29 23:23 实测读到的。**执行回滚前请重读一次**（见下），
> 因为这期间可能有人推了新东西。

```bash
cd "C:\Users\11930\Desktop\十脑造物局\decision-arena-lab"
gh api /repos/tbj0623/decision-arena-lab/git/ref/heads/main --jq '.object.sha'
```

---

## 四、三条回滚路径（2026-10-29 网络阻断时期的方案）

| 路径 | 适用场景 | 影响范围 | 风险 |
|---|---|---|---|
| **A. 整体回滚到 V9 之前** | V9 整体不可用（首屏白屏、关键功能坏了） | 全部 43→84 文件回到 V8 状态 | 中（丢失 V9 全部工作） |
| **B. 只回滚首屏** | 品牌首屏有问题，但品牌素材/README/其他改进要保留 | 3 个文件 | 低 |
| **C. 只回滚某个资产** | 某张图/某个 SVG 有问题 | 1 个文件 | 极低 |

---

## 五、路径 A：整体回滚到 V9 之前（`847eb57e`）

### 适用

V9 把站点搞坏了，需要立刻恢复到 V8 的可用状态。

### 关键难点

**不能 `git revert`**（本地没这个 commit），**不能直接 `PATCH ref` 指回 `847eb57e`** ——
因为那会让远端历史**倒退**（丢掉 `d49ba5c6` / `4413fa9c` 两个 commit），
下次任何人基于旧 SHA 操作都会出问题。

**正确做法：新建一个 commit，其 tree 等于 `847eb57e` 的 tree。**
这正是 `work/push-incremental.mjs` 能做但需要一点手工准备的操作。

### 步骤

#### A-1. 先把 `847eb57e` 的内容下载到本地

```bash
cd "C:\Users\11930\Desktop\十脑造物局\decision-arena-lab"

# 备份当前状态（万一回滚错了还能回来）
git branch backup-before-rollback-$(date +%Y%m%d_%H%M%S)

# 从远端把 V8 的 tree 下载下来，替换本地工作区
# 用 GitHub API 逐个文件取太慢，直接用 tarball
curl -L -o /tmp/v8-baseline.tar.gz \
  https://api.github.com/repos/tbj0623/decision-arena-lab/tarball/847eb57e55cf8b4844eb556aaf736e5c232b65ef

# 解压到临时目录，确认内容
mkdir -p /tmp/v8-baseline && tar -xzf /tmp/v8-baseline.tar.gz -C /tmp/v8-baseline --strip-components=1
ls /tmp/v8-baseline
```

> **Windows 上如果没有 `tar`/`curl`**，用 PowerShell：
> ```powershell
> $sha = '847eb57e55cf8b4844eb556aaf736e5c232b65ef'
> Invoke-WebRequest -Uri "https://api.github.com/repos/tbj0623/decision-arena-lab/tarball/$sha" `
>   -OutFile "$env:TEMP\v8-baseline.tar.gz" -Headers @{ 'User-Agent'='rollback' }
> New-Item -ItemType Directory -Force -Path "$env:TEMP\v8-baseline" | Out-Null
> tar -xzf "$env:TEMP\v8-baseline.tar.gz" -C "$env:TEMP\v8-baseline" --strip-components=1
> ```

#### A-2. 用 V8 的内容覆盖本地，然后提交

```bash
cd "C:\Users\11930\Desktop\十脑造物局\decision-arena-lab"

# 删除所有被跟踪的文件（保留 .git）
git rm -r --cached . -q
# 用 V8 的内容替换工作区（注意排除 .git）
rsync -a --exclude='.git' /tmp/v8-baseline/ ./
# 重新加入
git add -A
git commit -m "revert(v9): 整体回滚到 V8 基线 847eb57e"
```

> Windows 没有 `rsync` 的话，用 PowerShell：
> ```powershell
> git rm -r --cached . -q
> Get-ChildItem -Force | Where-Object { $_.Name -ne '.git' } | Remove-Item -Recurse -Force
> Copy-Item "$env:TEMP\v8-baseline\*" . -Recurse -Force
> git add -A
> git commit -m "revert(v9): 整体回滚到 V8 基线 847eb57e"
> ```

#### A-3. 推送（**必须走 API，`git push` 不通**）

```bash
# 先演练，确认校验都过
node work/push-incremental.mjs --dry-run

# 真推
node work/push-incremental.mjs
```

**期望输出**（关键看最后两行）：

```text
[6/6] 更新 refs/heads/main（force: false）…
完成。
远端 main 现在是 <新 sha>
内容校验：远端 tree <xxx> == 本地 HEAD tree ✓
```

#### A-4. 验证 tree 是否真的等于 V8

```bash
# 本地 tree 应该等于 847eb57e 的 tree
git rev-parse 'HEAD^{tree}'
# 期望：fd507cfc2058da41f826d37b0e505ad2908140e8

# 远端 tree
gh api /repos/tbj0623/decision-arena-lab/git/ref/heads/main --jq '.object.sha' | xargs -I{} \
  gh api repos/tbj0623/decision-arena-lab/git/commits/{} --jq '.tree.sha'
# 期望：同一串
```

---

## 六、路径 B：只回滚首屏（保留品牌素材）

### 适用

V9 的首屏改坏了（比如 CTA 点不动、演示卡崩了），但 `docs/assets/` 的品牌素材、
README 重写、测试改进都想保留。

### 需要回滚的文件（只有 3 个）

```text
site/index.html
site/app.mjs
site/styles/app.css
```

> **注意**：V9 还改了 `site/assets/` 下的新增文件。如果只回滚上面 3 个文件，
> 新素材会**留在原地**（成为孤儿文件），但不影响功能 —— 属于可接受的残留。
> 若要一并清理见路径 C。

### 步骤

#### B-1. 从 `847eb57e` 取回这 3 个文件

```bash
cd "C:\Users\11930\Desktop\十脑造物局\decision-arena-lab"

# Windows PowerShell（本机推荐）
$sha = '847eb57e55cf8b4844eb556aaf736e5c232b65ef'
$base = "https://api.github.com/repos/tbj0623/decision-arena-lab/contents"
foreach ($f in 'site/index.html','site/app.mjs','site/styles/app.css') {
  $r = Invoke-RestMethod -Uri "$base/$f`?ref=$sha" -Headers @{ 'User-Agent'='rollback' }
  $bytes = [Convert]::FromBase64String($r.content)
  [IO.File]::WriteAllBytes((Join-Path (Get-Location) ($f -replace '/','\')), $bytes)
  Write-Output ("已恢复 $f (" + $bytes.Length + " B)")
}
```

```bash
# macOS / Linux
SHA=847eb57e55cf8b4844eb556aaf736e5c232b65ef
for f in site/index.html site/app.mjs site/styles/app.css; do
  curl -sL -H "Accept: application/vnd.github.raw" \
    "https://api.github.com/repos/tbj0623/decision-arena-lab/contents/$f?ref=$SHA" -o "$f"
  echo "已恢复 $f ($(wc -c < "$f") B)"
done
```

#### B-2. 交叉验证：确认拿到的确实是 V8 版本

```bash
# 比对本地文件 hash 与远端 blob sha
git hash-object site/index.html
gh api "repos/tbj0623/decision-arena-lab/contents/site/index.html?ref=847eb57e55cf8b4844eb556aaf736e5c232b65ef" --jq '.sha'
# 两个值必须相同
```

#### B-3. 跑测试，确认没破坏其他东西

```bash
node --test
node scripts/check-no-network.mjs
```

> ⚠️ **这里大概率会红**：V9 新增的 `tests/qa/v9-hero-contract.test.mjs`
> 断言的是**V9 的新首屏结构**（两栏、两个 CTA、演示卡）。
> 你把首屏回滚到 V8 后，这些断言必然失败。
>
> **处理**：把那个测试文件也一起回滚掉，或者临时标记为 skip。
> **不要为了让它变绿去改测试断言** —— 那是掩盖问题。

```bash
# 如果决定一并回滚测试契约
git rm tests/qa/v9-hero-contract.test.mjs
node --test    # 应该恢复全绿
```

#### B-4. 提交并推送

```bash
git add -A
git commit -m "revert(v9): 首屏回滚到 V8 基线，保留品牌素材"
node work/push-incremental.mjs --dry-run   # 先看
node work/push-incremental.mjs             # 再推
```

---

## 七、路径 C：只回滚某个资产

### 适用

某一张截图/SVG/OG 卡片有问题（比如图里文字写错了），其余全部保留。

### 步骤

#### C-1. 从 V8 取回单个文件

```powershell
# 例：回滚 site/assets/og-card.png
$sha = '847eb57e55cf8b4844eb556aaf736e5c232b65ef'
$f = 'site/assets/og-card.png'
$r = Invoke-RestMethod -Uri "https://api.github.com/repos/tbj0623/decision-arena-lab/contents/$f`?ref=$sha" -Headers @{ 'User-Agent'='rollback' }
[IO.File]::WriteAllBytes((Join-Path (Get-Location) ($f -replace '/','\')), [Convert]::FromBase64String($r.content))
```

> ⚠️ 如果这个文件在 V8 **不存在**（是 V9 新增的），上面的命令会 404。
> 那就说明"回滚"其实是"删除"：
> ```bash
> git rm site/assets/og-card.png
> ```

#### C-2. 如果是删除，还要清理引用它的地方

```bash
# 找出哪里引用了这个文件
grep -rn "og-card" site/ --include=*.html --include=*.mjs --include=*.css
```

**必须把引用一起处理**，否则线上会 404。这也是"只回滚资产"最容易翻车的地方。

#### C-3. 提交并推送

```bash
git add -A
git commit -m "revert(v9): 回滚资产 <文件名>"
node work/push-incremental.mjs --dry-run
node work/push-incremental.mjs
```

---

## 八、回滚后必须验证的清单

> 回滚 ≠ 完成。**没有验证的回滚等于没回滚。**
> 按顺序做完，五条全过才算成功。

### ✅ 5.1 等部署完成（约 40–60 秒）

```bash
# 触发后立刻查（应该是 queued / in_progress）
gh run list --limit 2

# 等 50 秒再看
sleep 50
gh run list --limit 2
# 期望：completed / success
```

**如果失败**：

```bash
gh run list --limit 3                                  # 找到失败的 run id
gh run view <run-id> --log-failed                      # 看失败原因
```

常见失败原因：
- `Failed to create deployment (status: 404)` → Pages 未启用（本项目开局踩过）
- 测试门禁红了 → 说明回滚不完整，缺文件

### ✅ 5.2 线上 6 个核心资源全部 200

```powershell
$base = 'https://tbj0623.github.io/decision-arena-lab/'
foreach ($p in '','app.mjs','core.mjs','styles/app.css','features/narrative.mjs','data/validation-actions.mjs') {
  try {
    $r = Invoke-WebRequest -Uri ($base+$p) -UseBasicParsing -TimeoutSec 30
    Write-Output ("{0,-30} {1} {2,8} B" -f $(if($p){"/$p"}else{'/'}), $r.StatusCode, $r.RawContentLength)
  } catch { Write-Output ("{0,-30} ERR" -f $p) }
}
# 期望：6 行全部 200
```

### ✅ 5.3 反向 404 校验（证明不是"全 200 假象"）

```powershell
try { Invoke-WebRequest -Uri 'https://tbj0623.github.io/decision-arena-lab/definitely-not-here-xyz.mjs' -UseBasicParsing }
catch { $_.Exception.Response.StatusCode.value__ }
# 期望输出：404
```

> 这条**不能省**。如果任意路径都返回 200（SPA 兜底），
> 上面 5.2 的"全部 200"就毫无意义。

### ✅ 5.4 内容与目标 tree 逐字节一致

```bash
cd "C:\Users\11930\Desktop\十脑造物局\decision-arena-lab"
gh api /repos/tbj0623/decision-arena-lab/git/ref/heads/main --jq '.object.sha'
# 记下这个 SHA，然后：
gh api repos/tbj0623/decision-arena-lab/git/commits/<上一步的SHA> --jq '.tree.sha'
# 与本地 git rev-parse HEAD^{tree} 对比，必须相同
```

> **回滚到 V8 时期望 tree = `fd507cfc2058da41f826d37b0e505ad2908140e8`**

### ✅ 5.5 浏览器真实渲染，**必须 CDP 清缓存**

```js
// Playwright
const client = await page.context().newCDPSession(page);
await client.send('Network.enable');
await client.send('Network.clearBrowserCache');
await client.send('Network.setCacheDisabled', { cacheDisabled: true });
await page.goto('https://tbj0623.github.io/decision-arena-lab/');
```

然后确认：
- [ ] 页面能打开，无白屏
- [ ] Console **0 error**
- [ ] 5 个示例卡片都能点开，分数能算出来
- [ ] 360px 视口无横向溢出

> **为什么要 CDP**：GitHub Pages 返回 `Cache-Control: max-age=600`。
> 普通刷新会让浏览器继续用旧 `app.mjs`，你会误判成"回滚没生效"。
> 本项目在 V9 验证时就被这个坑过一次。

---

## 九、已知陷阱（每条都踩过）

### 6.1 `github.com:443` 不通，`git push` 必失败

```text
$ git push
fatal: unable to access 'https://github.com/...': Failed to connect to github.com port 443
```

**唯一可用的推送通道**：`work/push-incremental.mjs`（走 `api.github.com`）。

**判断通道是否恢复**（别用 `Test-NetConnection`，它会误报 OPEN）：

```bash
curl -sS -o /dev/null -w "%{http_code}\n" --max-time 20 https://github.com/
# 000 = 仍阻断；200 = 已恢复
```

### 6.2 `base_tree` 导致删除不生效（已修，但要知道这段历史）

`work/push-incremental.mjs` 早期版本在创建 tree 时传了 `base_tree: 远端tree`，
注释还写着"这样只增量改动"。但 `base_tree` 的语义是**叠加**：

> 远端有、而本地没有的文件会被**原样保留**。

**实际后果**：从本地删除 `docs/screenshots/mobile-360.png` 并提交、推送，
显示"完成"，但远端那个文件**依然在**。tree 哈希永远对不上，而且**不报错**。

**现在的行为**（脚本 L171-189 有完整注释）：
- **不传 `base_tree`**，而是把本地全部文件列进 tree（全量快照）
- 推完**断言** `remoteTree === git rev-parse HEAD^{tree}`，不等就 `exit(1)`

```js
// 脚本最后的硬校验
const localTree = git('rev-parse', 'HEAD^{tree}');
const finalRemoteTree = JSON.parse(gh('GET', `${API}/git/commits/${commit.sha}`)).tree.sha;
if (localTree !== finalRemoteTree) {
  console.error('✗ 推送完成，但远端内容与本地不一致！');
  process.exit(1);
}
```

**所以你看到 `内容校验：远端 tree xxx == 本地 HEAD tree ✓` 这一行，才说明推送真的成功了。**
没有这行 = 别信。

### 6.3 推送后必须等 Pages 部署完成

`work/push-incremental.mjs` 推完之后，GitHub 会自动触发 Pages workflow，
**但推送成功 ≠ 部署完成**。大约需要 **40–60 秒**。

如果你推完立刻验证线上，会看到**旧的**内容，然后误以为"回滚失败"。

```bash
sleep 50
gh run list --limit 2     # 等到 completed/success 再验证
```

### 6.4 本地 `main` 分支是过期的

```text
$ git rev-parse main
16052d0a5a3b05bdb45df8ae01d9b1d3298a590d    ← V1.0.0 时代的 SHA

$ gh api .../git/ref/heads/main --jq '.object.sha'
4413fa9c1fde2550468e58be3239c9231d2bdb11    ← 真实远端
```

**不要 `git checkout main` 后直接推** —— 那会把远端倒退几十个 commit。
始终以 `gh api` 读到的远端 SHA 为准。

### 6.5 `work/` 和 `ops/` 是 gitignore 的

回滚操作**不要**把 `ops/release/` 里的报告提交上去（它们是内部文件）。
`push-incremental.mjs` 用的是 `git ls-files`，只要你不 `git add -f ops/`，就不会带上去。

---

## 十、回滚决策速查

```text
问题严重吗？
├─ 站点完全不能用（白屏/核心功能坏）  → 路径 A（整体回滚）
├─ 只是首屏难看/不好用，其他都好      → 路径 B（只回滚首屏）
└─ 只是某张图/某个文件有问题          → 路径 C（只回滚资产）

回滚前必做：
  1. git branch backup-before-rollback-<时间>   （本地保底）
  2. gh api .../git/ref/heads/main              （记录当前 SHA）

回滚后必做：
  1. 等 50 秒，确认 run success
  2. 6 个资源全 200
  3. 不存在的路径返回 404
  4. 远端 tree == 本地 tree
  5. CDP 清缓存后浏览器实测
```

---

## 十一、如果回滚也失败了

说明问题不在代码，在发布链路。按这个顺序排查：

1. **`push-incremental.mjs` 报"拒绝推送：远端有本地没有的提交"**
   → 别人推过东西。先 `gh api` 读远端最新 SHA，重新确认基线，**不要强推**。

2. **推成功了但线上没变**
   → 看 `gh run list` 有没有触发；没触发就 `gh workflow run pages.yml`

3. **run 成功但线上还是旧的**
   → 99% 是缓存。用 CDP 清缓存重测；或者直接比对线上字节的 SHA-256。

4. **连 API 也不通了**
   → 用本次备份恢复：`C:\Users\11930\Desktop\十脑造物局\_v9_backup_20261029_232612\`
   里面有 `repo.bundle`（完整 git 历史）和 `worktree-full.zip`（全量文件）。

---

## 十二、本次备份位置（回滚的兜底）

```text
C:\Users\11930\Desktop\十脑造物局\_v9_backup_20261029_232612\
├── repo.bundle              5,246,779 B   完整 git 历史（6 个 ref）
├── worktree-full.zip       46,981,965 B   全量工作树（569 条目，已排除 .git）
├── decision-arena-release.zip  6,497,403 B  V9 重建的发行包
├── decision-arena-release.zip.sha256
├── MANIFEST.txt
└── SHA256SUMS.txt                         以上所有文件的校验和
```

**恢复命令**：

```bash
# 用 bundle 恢复完整仓库
git clone "C:\Users\11930\Desktop\十脑造物局\_v9_backup_20261029_232612\repo.bundle" 恢复目录

# 只恢复文件
Expand-Archive -Path "...\worktree-full.zip" -DestinationPath 恢复目录 -Force
```

> **重要**：`repo.bundle` 里包含 `refs/heads/night-v8` → `7cb5ec51`。
> 这正是 `docs/screenshots/manifest.json` 记录的截图对应 commit ——
> 但它在 `night-v8` 分支上，**不在 main 上、也不在远端**。
> 见 `V9_DELIVERY.md` 核对报告中的相关说明。

---

## 十三、红线自查

| 红线 | 状态 |
|---|---|
| 实际执行了回滚 | ❌ 未执行（本文件是预案，等 Lead 决定） |
| 修改了远端 main | ❌ 未修改 |
| 删除了备份 | ❌ 未删除，新增了一份 |
| 修改 site/ | ❌ 未修改 |
| 命令可直接复制 | ✅ 全部给出完整可运行版本（含 Windows 变体） |
