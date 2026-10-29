# QUICKSTART — 5 分钟上手 FACTORY_KIT 工具箱

> 三个零依赖的 Node 小工具，解决多智能体协作里最常炸的三件事。
> 全部只用 Node 内置模块，**不需要 npm install**。

---

## 这套工具解决什么问题？

不是"功能列表"，是三个具体的、你一定遇到过的场景：

### 场景一：任务发下去，Agent 给你的东西对不上

你在群里发一句「去把测试重跑一下」，收到的可能是十页重构方案，也可能是一句「已完成」。
你不知道它到底跑没跑、跑了什么、结果如何。

**任务卡（taskcard.mjs）** 把任务钉死成四个格子：能改哪些文件、必须交什么证据、
哪些事绝对不许做、报告按什么格式写。含糊的任务描述是免费的，返工不是。

### 场景二：会话断了，接手的 Agent 不知道信哪个文件

三个 Agent 各写了一份 `STATUS.md`，内容互相矛盾。新来的 Agent 读了错的，重复劳动
甚至覆盖掉别人的成果。

**检查点（checkpoint.mjs）** 强制一份标准格式的 `CHECKPOINT.md`：已完成 / 进行中 /
待办 / 阻塞 / 验证命令。并且**自动脱敏**本机路径和密钥——检查点是要进仓库的，
不知不觉把 `C:\Users\你的名字\...` 或 token 写进去，公开仓库就是永久泄漏。

### 场景三：「测试全绿，可以发了」——然后线上白屏

这条最贵。真实的两个坑：

- `node --test` 全绿，但某个 `.mjs` 的 import 路径写错了，页面加载时 404，白屏。
  测试根本没覆盖到加载链。
- `dist/` 里的 zip 是 3 小时前的，SHA-256 校验"通过"——因为哈希就是为那个旧包算的。

**门禁（gate.mjs）** 用 8 道检查拦住这些：跑测试、扫网络/密钥、**逐个 import 模块**、
查 git 是否跟踪了内部文件、扫 git 历史、查 LICENSE……

一句话总结：**这套工具不提高上限，它抬高下限。**

---

## 三个工具的最小可运行例子

先确认环境：

```bash
node --version     # 需要 >= 18（用到 node:test 和顶层 await）
```

把这三个文件放到项目里任意位置（下面假设在 `FACTORY_KIT/tools/`）：

```text
FACTORY_KIT/tools/taskcard.mjs
FACTORY_KIT/tools/checkpoint.mjs
FACTORY_KIT/tools/gate.mjs
```

---

### 1. taskcard.mjs —— 生成一张任务卡

**先看有哪些角色：**

```bash
node FACTORY_KIT/tools/taskcard.mjs --list
```

输出（节选）：

```text
  qa-engineer      回归、属性测试、盲审
                   写入区: ops/qa/
  red-team         隐私、安全、误导性审查
                   写入区: ops/red/
```

**生成一张卡：**

```bash
mkdir -p ops
node FACTORY_KIT/tools/taskcard.mjs \
  --role qa-engineer \
  --task W01-07 \
  --title "重跑全部测试" \
  --detail "跑 node --test，记录 pass/fail/todo 数量和 Node 版本" \
  --out ops/task.md
```

输出：

```text
已写入：ops/task.md
```

打开 `ops/task.md`，你会拿到一份包含「写入区 / 任务 / 必须交出的证据 / 红线 /
汇报格式」的卡片。

> ⚠️ `--out` 的**父目录必须已存在**（先 `mkdir -p ops`）。
> 官方示例里写 `--out ops/qa/task.md`，但 `ops/qa/` 不存在时会报 `ENOENT`。
> 这是已知问题，见 `SELFTEST.md` P1-2。

**批量生成全部 11 张模板：**

```bash
node FACTORY_KIT/tools/taskcard.mjs --all --outdir ops/cards
# → 已生成 11 张角色卡 → ops/cards   （这条会自动建目录）
```

**什么时候用**：同时有 2 个以上 Agent 在干活，且你不想事后收拾文件冲突。

---

### 2. checkpoint.mjs —— 生成和校验检查点

**创建：**

```bash
mkdir -p ops
node FACTORY_KIT/tools/checkpoint.mjs create \
  --dir ops \
  --title "阶段 2 完成" \
  --done "算法推导;单测 94/94" \
  --doing "UI 落地" \
  --next "写文档;补无障碍" \
  --blocked "无" \
  --commands "node --test;node scripts/check-no-network.mjs"
```

输出：

```text
已写入：ops\CHECKPOINT.md
自动脱敏：0 处
校验通过 ✓
```

> 列表用**分号** `;` 分隔（中文分号 `；` 也支持）。

**校验：**

```bash
node FACTORY_KIT/tools/checkpoint.mjs verify ops/CHECKPOINT.md
# → ✓ CHECKPOINT.md
# → 全部通过 ✓

node FACTORY_KIT/tools/checkpoint.mjs verify --all ops/
# → 校验目录下所有 CHECKPOINT*.md
```

**它到底检查什么**（这些都会让它退出码非 0）：

| 检查 | 失败示例 |
|---|---|
| 7 个必需小节齐全 | 删掉 `## 阻塞` → `缺少必需小节：## 阻塞` |
| 无未脱敏敏感信息 | 残留 `C:\Users\真实用户名\...` → `发现 1 处未脱敏内容` |
| 时间小节有日期 | `## 时间` 下写成"刚才" → 报错 |
| 已完成 ≠ 待办 | 两节内容一样 → `自相矛盾` |

**自动脱敏覆盖**：Windows 绝对路径、UNC 路径、`/home/` `/Users/`、OpenAI/GitHub/AWS/Slack
token、Bearer token、私钥块、内网 IP、模型网关地址。

> 💡 **这是这套工具里最该用、也最容易被忽略的一个。**
> 检查点天然要写"我在哪、在做什么"，而这类信息最容易夹带路径和凭据。

---

### 3. gate.mjs —— 发布前跑 8 道门禁

**先看有哪些门：**

```bash
node FACTORY_KIT/tools/gate.mjs --list
```

```text
[阻断] tests                  单元测试全绿
[阻断] audit                  静态审计（无网络 / 无持久化 / 无密钥）
[阻断] module-load            模块加载链完整（ES Module 逐个 import）
[阻断] tracked-internal       内部文件未被 git 跟踪
[阻断] history-secrets        git 历史无密钥
[阻断] license                许可证存在
[提醒] no-file-protocol-claims 没有"双击 file:// 就能用"的错误承诺
[提醒] release-freshness      发行包比源码新
```

**跑全部门禁：**

```bash
node FACTORY_KIT/tools/gate.mjs --project . --out ops/gate-report.md
```

通过时：

```text
✅ 单元测试全绿                         94 pass / 0 fail / 0 todo
✅ 模块加载链完整（ES Module 逐个 import）   3/3 模块加载成功
✅ 许可证存在                          LICENSE（1084 字节）
...
所有阻断门通过 ✓
[exit=0]
```

不通过时（**这才是它存在的意义**）：

```text
❌ 模块加载链完整（ES Module 逐个 import）
   模块加载失败：./site/features/narrative.mjs :: Cannot find module '.../WRONG-PATH.mjs'

1 道阻断门未通过
[exit=1]
```

**只跑某几道门**（调试时省时间）：

```bash
node FACTORY_KIT/tools/gate.mjs --project . --only module-load,license
```

**`--out` 会同时生成一份 Markdown 报告**，里面每道门都带「为什么有这道门」，
适合贴进 PR 或交接文档。

---

## 三道门值得单独说明

这三道是这套工具真正的价值所在，因为**它们拦住的是「测试全绿但仍然会炸」的情况**：

### `module-load`：测试测不到加载链

`node --test` 只 import 它需要的模块。页面的真实加载链（`app.mjs → features/*.mjs →
data/*.mjs`）不在测试范围内。这道门**逐个动态 import 真实模块**，路径写错立刻抛错。

### `tracked-internal`：内部文件被 git 跟踪 = 永久泄漏

`work/`、`dist/`、`_internal/`、`ops/` 一旦被 `git add` 过，即使后来删除，
历史里仍然在。公开仓库的**历史是全量公开的**，删文件救不回来。

### `history-secrets`：扫的是历史，不是当前文件

用 `git log -p --all` 扫所有 commit。当前文件干净不代表历史干净。
（它有占位符豁免逻辑：`C:\Users\xxx` 这种文档写法不算泄漏，但
`C:\Users\xxx\Documents\secret.txt` 会算。）

---

## 什么情况下**不要**用这套工具

这部分和上面的内容一样重要。**用错场景比不用更糟。**

### ❌ 1. 你只有一个人，且不打算让 Agent 参与

任务卡的四个格子（写入区/证据/红线/汇报格式）是**为了协调多个执行者**。
你一个人写代码时，这些格子只是额外的填表负担。直接干活更快。

### ❌ 2. 项目没有测试，也不打算写

`gate.mjs` 的 `tests` 门要求 `pass > 0`，`todo` 必须为 0。
一个零测试的项目跑门禁，结果必然是红的——但那个红没有信息量，只是告诉你"你没有测试"。
先把测试补上，再用门禁。

### ❌ 3. 你的项目不是 ES Module / 没有 `site/core.mjs`

`module-load` 门硬编码了三个路径：
```
./site/core.mjs
./site/features/narrative.mjs
./site/data/validation-actions.mjs
```
**这套门禁是为特定项目形状写的**，不是通用工具。换项目需要改代码。

同理 `audit` 门硬依赖 `scripts/check-no-network.mjs`，`history-secrets` 的规则里
硬编码了 `dshapi` 这类特定域名的模式。

### ❌ 4. 你需要的是「一次性的快速检查」

只想确认「测试过没过」：

```bash
node --test          # 够了，别上全套门禁
```

门禁跑一轮要做 git log 全量扫描 + 3 次动态 import + 子进程测试，几十秒起步。

### ❌ 5. 你的仓库历史已经脏了，且不打算重写

`history-secrets` 门会一直红。如果你已经决定接受现有历史（比如仓库已经公开很久、
有 fork），那这道门就是噪音。**但它红着不是 bug，是事实**——别为了让它变绿而删规则，
那才是真正的损失（`gate.mjs` 的注释里专门写了这件事）。

### ❌ 6. 你在 Windows 上，但项目路径含中文/空格且没测过

这三个工具本机测试通过（路径含中文 `十脑造物局`），但 `gate.mjs` 的
`module-load` 门用了 `'file:///' + process.cwd().replace(/\\/g,'/')` 这种手工拼 URL 的写法，
对特殊字符敏感。**新环境第一次用，先跑一遍 `--only module-load` 确认。**

---

## 一分钟速查

```bash
# 我该用哪个？
有 2+ 个 Agent 在干活        → taskcard.mjs
要交接 / 会话要断           → checkpoint.mjs
要发布 / 要 push 到公开仓库  → gate.mjs

# 最常用的三条命令
mkdir -p ops                                    # ← 先建目录，后两条都依赖它
node FACTORY_KIT/tools/taskcard.mjs --list
node FACTORY_KIT/tools/checkpoint.mjs verify --all ops/
node FACTORY_KIT/tools/gate.mjs --project . --out ops/gate-report.md
```

> ⚠️ 那个 `mkdir -p ops` 不是凑数：`checkpoint verify --all` 在 `ops/` 不存在时会报
> 「目录不存在」，`gate --out ops/...` 会抛 `ENOENT`。**这是实测踩出来的**，
> 少这一行，三条命令里有两条跑不通。

---

## 已知问题（使用前务必知道）

> 状态截至 2026-10-29 22:25，均已逐条实测（见 `SELFTEST.md`）。

| 问题 | 状态 | 影响 / 绕法 |
|---|---|---|
| `gate --out` 不建父目录 | ⚠️ **待修** | `ops/` 不存在时抛 `ENOENT`。先 `mkdir -p ops` |
| `taskcard.mjs` 被 import 会杀宿主进程 | ⚠️ **待修** | 想当库用会 `process.exit(2)`。只能用 CLI |
| `license` 门空文件报"找不到" | ⚠️ 轻微 | 空与不存在报同一句话。看文件到底在不在即可 |
| ~~`taskcard --out` 不建父目录~~ | ✅ 已修 | 现在会自动 `mkdir -p`（多层也行） |
| ~~`release-freshness` 门永远显示绿~~ | ✅ 已修 | 现在真比对 mtime，过期会报「过期：xxx.zip」 |
| ~~`license` 门要求 > 100 字节~~ | ✅ 已修 | 现在只要求非空（38 字节的短许可证也能过） |
| ~~`checkpoint verify --all` 报「目录不存在：true」~~ | ✅ 已修 | 不带目录时正确回退到默认 `ops` |
| ~~未知角色抛堆栈 + 泄漏本机路径~~ | ✅ 已修 | 现在友好提示 + `exit 2`，无堆栈 |
| ~~`gate.mjs` 被 import 会跑全门禁~~ | ✅ 已修 | 现在 import 仅 7ms，不执行任何门 |

> 完整的问题清单（含复现命令、代码位置、严重级别、修复前后对照）见 [`SELFTEST.md`](./SELFTEST.md)。

---

## 下一步

- 想知道这些工具**为什么这样设计**（每条红线背后踩过什么坑）→ `LESSONS.md`
- 想知道多智能体怎么分工、写入区怎么划 → `ROLES.md`、`FILE_OWNERSHIP.md`
- 想知道质量门禁的完整定义 → `QUALITY_GATES.md`
- 想复现本文所有结论 → `SELFTEST.md`
