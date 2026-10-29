# SELFTEST — FACTORY_KIT 工具箱端到端自测

> 执行时间：2026-10-29 21:20 – 21:35（Asia/Shanghai）
> 执行者：release-engineer（W04-01）
> 方法：**假装第一次接触这套工具的陌生人**，在一个空白临时项目里从零走一遍
> 临时目录：`%TEMP%\fk-selftest-*`（已清理，109 项）
> 原则：**只记录，不改工具**（除 typo 外，任何 bug 都不在本次修复）

---

## 零、结论速览

| 维度 | 结果 |
|---|---|
| 端到端自测 | **7 步**，全部走通（含 2 处需绕行的坑） |
| 发现的问题 | **6 个**，其中 **1 个严重（假通过）**、3 个中等、2 个轻微 |
| 故障注入 | **6 / 6 正确失败** ✅ |
| 三个工具是否都有故意失败测试 | ✅ 都有（taskcard 靠未知角色、checkpoint 3 个、gate 3 个） |
| 是否修改工具行为 | ❌ 未修改任何工具（遵守红线） |

**最严重的问题**：`gate.mjs` 的 `release-freshness` 门用了 ESM 里不存在的 `require()`，
异常又被 `catch {}` 静默吞掉，**导致该门对任何带 zip 的项目永远显示绿色，实际从未检查过** —— 正是这个工具声称要消灭的"假通过"。

---

## 一、端到端自测（7 步，真实输出）

### 环境

模拟一个陌生人的处境：空目录、一个最小项目、没有任何前置知识。

```powershell
# 建临时项目
$S = "$env:TEMP\fk-selftest-<rand>"
mkdir "$S\proj\ops", "$S\proj\site"
# 最小文件
README.md / LICENSE / site/core.mjs
```

> 说明：只用了 `README.md`、`LICENSE`、`site/core.mjs` 三个文件，
> 因为 `gate.mjs` 的门禁依赖这些路径，而新手不会知道该准备什么（见问题 #6）。

---

### 步骤 1：`--list` 看看有哪些角色

```bash
node FACTORY_KIT/tools/taskcard.mjs --list
```

**真实输出**：

```text
可用角色：

  market-scout     产品定位、竞品、真实痛点证据
                   写入区: research/, ops/market/
  product-owner    价值优先级、用户路径、发布门槛
                   写入区: ops/product/
  ux-writer        易懂的解释、无障碍文案、语言包
                   写入区: ops/ux/
  logic-engineer   算法设计、数学独立验证
                   写入区: ops/logic/, proposals/math/
  ui-engineer      UI 交互与响应式
                   写入区: ops/ui/
  story-engineer   虚构示例、教学内容
                   写入区: ops/story/
  qa-engineer      回归、属性测试、盲审
                   写入区: ops/qa/
  red-team         隐私、安全、误导性审查
                   写入区: ops/red/
  growth-producer  真实演示、视频文字、社区适配
                   写入区: marketing/, ops/growth/
  release-engineer 版本、CI、发布、工具箱流程
                   写入区: ops/release/
  lead             合并、部署、派发、版本记录
                   写入区: site/, tests/, scripts/, docs/, .github/
[exit=0]
```

**评价**：✅ **这一步体验最好**。11 个角色 + 写入区一目了然，陌生人立刻知道该选哪个。
`写入区` 这一列尤其有用——它把"我不会踩到别人"这件事前置到了选择阶段。

---

### 步骤 2：生成一张任务卡 ⚠️ **卡住了**

按工具自己 `--help` 里的示例写法：

```bash
node FACTORY_KIT/tools/taskcard.mjs --role qa-engineer --task W01-07 \
     --title "重跑全部测试" --detail "跑 node --test" --out ops/qa/task.md
```

**真实输出（失败）**：

```text
node:fs:2483
    return binding.writeFileUtf8(
                   ^

Error: ENOENT: no such file or directory, open '...\proj\ops\qa\task.md'
    at writeFileSync (node:fs:2483:20)
    at file:///C:/Users/<用户名>/Desktop/.../taskcard.mjs:283:3
  errno: -4058,
  code: 'ENOENT',
  syscall: 'open',
  path: '...\\proj\\ops\\qa\\task.md'
[exit=1]
```

**卡点**：工具帮助里写的例子是 `--out ops/qa/task.md`，但 `ops/qa/` 子目录不存在时**不会自动创建**，直接抛 `ENOENT`。

陌生人此时会怀疑：「是我用错了，还是工具坏了？」——帮助文档给的示例跑不通，这是最伤信任的一类问题。

**绕行**：改用已存在的目录 → 成功。

```bash
node FACTORY_KIT/tools/taskcard.mjs --role qa-engineer --task W01-07 \
     --title "重跑全部测试" --detail "跑 node --test" --out ops/task.md
```

```text
已写入：ops/task.md
[exit=0]
```

> 对比：同一个工具的 `--all --outdir` **会自动建目录**（`mkdirSync(recursive:true)`），
> 但 `--out` 不会。两条路径行为不一致，属于遗漏。

**生成内容质量**：✅ 很好。强制了四个要素（写入区 / 任务 / 证据 / 红线），
汇报格式可直接照抄，`≤800 字` 的限制写在显眼处。

---

### 步骤 3：`--all` 批量生成

```bash
node FACTORY_KIT/tools/taskcard.mjs --all --outdir ops/cards
```

**真实输出**：

```text
已生成 11 张角色卡 → ops/cards
[exit=0]
```

验证：`ops/cards/` 下确实有 11 个 `.md`（growth-producer / lead / logic-engineer /
market-scout / product-owner / qa-engineer / red-team / release-engineer /
story-engineer / ui-engineer / ux-writer）。

**评价**：✅ 这条路径会自动建目录，体验正常。

**顺带测未知角色**：

```bash
node FACTORY_KIT/tools/taskcard.mjs --role nobody
```

```text
file:///C:/Users/<用户名>/Desktop/.../taskcard.mjs:166
  if (!r) throw new Error(`未知角色：${role}。可用：${Object.keys(ROLES).join(', ')}`);
                ^
Error: 未知角色：nobody。可用：market-scout, product-owner, ...
```

**问题**：错误信息本身是对的（列了所有可用角色），但以**未捕获异常 + 完整堆栈**的形式抛出。
堆栈里还带着本机绝对路径。对陌生人不友好，也不该在面向用户的报错里暴露路径。

---

### 步骤 4：`checkpoint create`（成功路径）

```bash
node FACTORY_KIT/tools/checkpoint.mjs create --dir ops --title "阶段2完成" \
     --done "算法推导;单测通过" --doing "UI 落地" --next "写文档" \
     --blocked "无" --commands "node --test"
```

**真实输出**：

```text
已写入：ops\CHECKPOINT.md
自动脱敏：0 处
校验通过 ✓
[exit=0]
```

生成的文件结构完整，7 个必需小节齐全，`## 下一步` 里给了 4 条可执行指引。

**评价**：✅ 这一步最顺。`--done "a;b"` 用分号分隔的约定需要看一眼帮助，但帮助里写了。

---

### 步骤 5：`checkpoint verify`（四种调用方式）

| 调用 | 真实输出 | 退出码 | 评价 |
|---|---|---|---|
| `verify ops\CHECKPOINT.md` | `✓ CHECKPOINT.md` + `全部通过 ✓` | 0 | ✅ 正常 |
| `verify --all ops/` | `✓ CHECKPOINT.md` + `全部通过 ✓` | 0 | ✅ 正常 |
| `verify --all`（不带目录） | `目录不存在：true` | 2 | ⚠️ 报错文案是机器话 |
| `verify ops/NOPE.md` | `跳过（不存在或不是文件）` + `1 个检查点未通过` | 1 | ✅ 语义正确 |
| `verify`（无参数） | `用法：node checkpoint.mjs verify <文件> \| verify --all <目录>` | 2 | ✅ 清晰 |

**问题（轻微）**：`verify --all` 不带目录时，输出 `目录不存在：true`。
这里的 `true` 是 `parseArgs` 把"参数缺省"编码成字符串 `'true'` 后漏到用户界面的结果。
不是功能错误（确实该失败），但文案让人困惑——陌生人会问「目录 true 是什么？」

---

### 步骤 6：`gate --list`

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
[exit=0]
```

**评价**：✅ 8 道门，阻断/提醒分级清楚。

---

### 步骤 7：对「故意有问题的」项目跑全门禁 ✅ **正确变红**

在只有 `README.md` / `LICENSE` / `site/core.mjs` 的裸项目上跑：

```bash
node FACTORY_KIT/tools/gate.mjs --project .
```

**真实输出**：

```text
❌ 单元测试全绿                         0 pass / 0 fail / 0 todo
❌ 静态审计（无网络 / 无持久化 / 无密钥）   找不到 scripts/check-no-network.mjs
❌ 模块加载链完整（ES Module 逐个 import） Cannot find module '...\site\features\narrative.mjs'
❌ 内部文件未被 git 跟踪                  不是 git 仓库或 git 不可用
❌ git 历史无密钥                       扫描失败：not a git repository
❌ 许可证存在                            找不到 LICENSE 文件
✅ 没有"双击 file:// 就能用"的错误承诺      未提及 file://
✅ 发行包比源码新                         无 dist/，跳过

6 道阻断门未通过
[exit=1]
```

**评价**：✅ **这正是期望的行为**——门禁真的会红，退出码 1，且每道门都给出了具体原因。

**但发现两个判断问题**：

1. **license 门误报**（详见问题 #4）：项目里**确实有 LICENSE**（38 字节的简短版），
   但门禁写的是「找不到 LICENSE 文件」。原因是 `statSync(p).size > 100` 这个阈值，
   文件存在但小于 100 字节就被当成不存在。**报错信息与实际原因不符**。

2. **`0 pass / 0 fail / 0 todo` 判为失败是对的**，但陌生人看不出"为什么 0 个测试是失败"。
   代码里是 `p > 0` 的要求（没测过 ≠ 没问题），这个设计是对的，只是没在输出里解释。

---

## 二、故障注入（6 / 6 全部正确失败）

> 方法：先建立一个**能全绿**的最小项目作为基线，再逐个注入故障，确认对应门变红。
> 基线（证明门禁不是"永远红"）：

```text
✅ 单元测试全绿                         1 pass / 0 fail / 0 todo
✅ 静态审计（无网络 / 无持久化 / 无密钥）         PASS
✅ 模块加载链完整（ES Module 逐个 import）   3/3 模块加载成功
✅ 内部文件未被 git 跟踪                  0 个内部文件被跟踪
✅ git 历史无密钥                      0 命中（占位符已排除）
✅ 许可证存在                          LICENSE（433 字节）
✅ 没有"双击 file:// 就能用"的错误承诺        未提及 file://
✅ 发行包比源码新                        无 dist/，跳过

所有阻断门通过 ✓
[exit=0]
```

### 2.1 checkpoint.mjs 三项注入

#### 注入 C1：塞入未脱敏的本机路径 → **正确 FAIL** ✅

先测自动脱敏：

```bash
node checkpoint.mjs create --dir ops --title "路径测试" \
     --done "读取 C:\Users\<用户名>\Desktop\secret.txt 完成" --doing "无" --next "无" --blocked "无"
```

```text
已写入：ops\CHECKPOINT.md
自动脱敏：1 处
校验通过 ✓
[exit=0]
```

生成内容里已经是 `- 读取 <用户目录> 完成` ✅

再手动把路径塞回去，测 `verify` 能否检出：

```text
✗ cp-leak.md
    ✗ 发现 1 处未脱敏内容

1 个检查点未通过
[verify exit=1]
```

**判定：正确失败** ✅（create 自动脱敏 + verify 拦截，两道防线都有效）

#### 注入 C2：删掉必需小节 → **正确 FAIL** ✅

删掉整个 `## 阻塞` 小节后：

```text
✗ cp-nosection.md
    ✗ 缺少必需小节：## 阻塞

1 个检查点未通过
[verify exit=1]
```

**判定：正确失败** ✅

#### 注入 C3：「已完成」和「待办」写成一样 → **正确 FAIL** ✅

把 `## 待办` 的 `- c` 改成 `- a`（与已完成相同）：

```text
  已完成: - a
  待办:   - a

✗ cp-same.md
    ✗ 「已完成」与「待办」内容完全相同——自相矛盾

1 个检查点未通过
[verify exit=1]
```

**判定：正确失败** ✅

---

### 2.2 gate.mjs 三项注入

#### 注入 G1：被 git 跟踪的 `work/` 文件 → **正确 FAIL** ✅

```bash
mkdir work && echo "internal notes" > work/secret.txt
git add -f work/secret.txt
node gate.mjs --project . --only tracked-internal
```

```text
❌ 内部文件未被 git 跟踪                  被跟踪的内部文件：work/secret.txt

1 道阻断门未通过
[exit=1]
```

**判定：正确失败** ✅（且明确指出了是哪个文件）

#### 注入 G2：改坏 import 路径 → **正确 FAIL** ✅

把 `site/features/narrative.mjs` 的 `from '../core.mjs'` 改成 `from '../WRONG-PATH.mjs'`：

```text
❌ 模块加载链完整（ES Module 逐个 import）
   模块加载失败：./site/features/narrative.mjs :: Cannot find module '...\WRONG-PATH.mjs'

1 道阻断门未通过
[exit=1]
```

**判定：正确失败** ✅

> 这道门的价值在这里体现得很清楚：`node --test` 此时**仍然是绿的**（测试只 import core.mjs），
> 只有 module-load 门能抓到"页面会白屏"这个问题。

#### 注入 G3：删掉 LICENSE → **正确 FAIL** ✅

```text
❌ 许可证存在                          找不到 LICENSE 文件

1 道阻断门未通过
[exit=1]
```

**判定：正确失败** ✅

---

## 三、发现的问题清单

> 按严重程度排序。**本次只记录，未修改任何工具行为。**

### 🔴 P0-1：`release-freshness` 门是「假通过」（严重）

**位置**：`FACTORY_KIT/tools/gate.mjs:254`

```js
function readdirSafe(d) {
  const { readdirSync } = require('node:fs');   // ← ESM 里没有 require
  return readdirSync(d);
}
```

**问题**：`gate.mjs` 是 ES Module（`import` 语法），里面没有 `require`。
调用 `readdirSafe()` 会抛 `ReferenceError: require is not defined`。

**更糟的是**：调用处（L238-241）把它包在 `try { ... } catch { /* ignore */ }` 里：

```js
let zips = [];
try {
  zips = readdirSafe(distDir).filter((f) => f.endsWith('.zip'));
} catch { /* ignore */ }
if (!zips.length) return { pass: true, detail: 'dist/ 无 zip，跳过' };
```

**结果**：`zips` 永远是 `[]`，于是**永远走 `pass: true` 的"无 zip，跳过"分支**。

**实测证据**：

```text
$ ls dist/
demo.zip   (10 字节，确实存在)

$ node gate.mjs --project . --only release-freshness
✅ 发行包比源码新     dist/ 无 zip，跳过      ← 撒谎
```

**直接验证 `require` 不可用**：

```text
$ node --input-type=module -e "require('node:fs')"
require 不可用: ReferenceError: require is not defined
```

**危害**：这是**假通过**——比报错更危险。门禁显示绿色，维护者以为"发行包新鲜度已检查"，
实际上这道门从未执行过。而这个工具的设计目标第一条就写着「不接受"我觉得没问题"」。

**注**：`release-freshness` 是**非阻断门**（`blocking: false`），所以不会让发布失败，
但会让报告里出现一个永远为真的"✅"。

**建议修复**（供 Lead 决定）：

```js
// 顶部已经 import 过 fs，直接用
import { existsSync, readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
// 删掉 readdirSafe 函数，调用处改为：
zips = readdirSync(distDir).filter((f) => f.endsWith('.zip'));
// 且 catch 里应该 pass:false，而不是静默忽略
```

---

### 🟡 P1-2：`--out` 不自动建目录，但帮助示例要求子目录

**位置**：`FACTORY_KIT/tools/taskcard.mjs:283`

```js
if (out) {
  writeFileSync(out, md, 'utf8');   // 父目录不存在 → ENOENT
```

**矛盾点**：
- 帮助文本（L262）示例：`--out ops/qa/task.md`（子目录）
- `--all` 分支（L241）却调用了 `mkdirSync(outdir, { recursive: true })`（会建目录）

**实测**：按帮助示例执行 → `Error: ENOENT: no such file or directory`（exit=1）。

**危害**：新人照着帮助文档操作，第一条命令就失败。中等严重度——不致命，但严重损害第一印象。

**建议**：`writeFileSync` 前加 `mkdirSync(dirname(out), { recursive: true })`。

---

### 🟡 P1-3：未知角色抛未捕获异常 + 暴露本机路径

**位置**：`FACTORY_KIT/tools/taskcard.mjs:166`

```js
if (!r) throw new Error(`未知角色：${role}。可用：${...}`);
```

**实测输出**：

```text
file:///C:/Users/<用户名>/Desktop/.../taskcard.mjs:166
  if (!r) throw new Error(...)
                ^
Error: 未知角色：nobody。可用：market-scout, ...
    at fileURLToPath ...
```

**问题**：
1. 以堆栈形式抛出，而不是友好的 `console.error` + `exit(2)`
2. **堆栈里带着本机绝对路径** `C:/Users/<用户名>/Desktop/...` —— 有隐私隐患
3. 退出码依赖 Node 默认行为，不符合其他工具"用法错误 = exit 2"的约定

**危害**：中等。功能上"确实报错了"，但体验差，且路径泄漏与这套工具"自动脱敏"的定位自相矛盾。

---

### 🟡 P1-4：`license` 门把「文件太短」误报成「文件不存在」

**位置**：`FACTORY_KIT/tools/gate.mjs:195`

```js
if (existsSync(p) && statSync(p).size > 100) {
  return { pass: true, detail: `${n}（${statSync(p).size} 字节）` };
}
...
return { pass: false, detail: '找不到 LICENSE 文件' };
```

**实测**：项目里有 38 字节的 LICENSE（简短的 MIT 声明）：

```text
❌ 许可证存在    找不到 LICENSE 文件
```

**问题**：文件**存在**，只是小于 100 字节。报错说"找不到"，会让人去查路径、查拼写，
浪费排查时间——真正的原因（太短）完全没提。

**危害**：中等。误判方向，且 100 字节这个阈值没有在文档里说明。

**建议**：区分三种情况——不存在 / 存在但过短 / 正常。

---

### 🟢 P2-5：`verify --all` 不带目录时报 `目录不存在：true`

**位置**：`FACTORY_KIT/tools/checkpoint.mjs:283`

```js
const dir = typeof args.all === 'string' ? args.all : 'ops';
```

`parseArgs` 在参数缺省时把值设为字符串 `'true'`（L226），所以 `typeof args.all === 'string'` 恒真，
`dir` 变成 `'true'`，报错就是 `目录不存在：true`。

**实测**：

```text
$ node checkpoint.mjs verify --all
目录不存在：true
[exit=2]
```

**危害**：轻微。行为正确（确实该失败），只是文案是机器话。

**建议**：判断 `args.all !== 'true'` 时再用它当路径。

---

### 🟢 P2-6：`gate.mjs` 没有 main-module 保护（被 import 时会直接跑 CLI）

**位置**：`FACTORY_KIT/tools/gate.mjs:325` 起，**没有任何** `isMainModule()` 判断

对比：`checkpoint.mjs:340` 有 `if (isMainModule()) { ... }` 保护，`taskcard.mjs` 也没有。

**后果**：任何 `import { runGates } from './gate.mjs'` 的代码，一 import 就会**立即执行全部门禁**
（包括跑 `node --test`、扫描 git 历史），并可能 `process.exit(1)` 直接杀掉宿主进程。

**实测**：本报告未触发（因为只通过 CLI 调用），但读代码可确认。

**危害**：轻微（当前只有 CLI 用法），但限制了"把门禁作为库调用"的可能性——
而这恰恰是 CI 集成最自然的用法。

**建议**：套用 `checkpoint.mjs` 的 `isMainModule()` 模式。

---

## 四、工具设计的亮点（值得保留）

不是只挑毛病，以下是实测中确实好用的地方：

1. **`--list` 的"写入区"列**：把冲突预防前置到了角色选择阶段，比事后协调有效得多。
2. **任务卡强制四要素**（写入范围 / 证据 / 红线 / 汇报格式）：拿到的卡片可以直接照着做。
3. **`gate` 每道门都带 `why`**：报告末尾会输出「为什么有这些门」，后人不至于随手删掉。
4. **`todo > 0 视为不通过`**（gate.mjs:53）：这个设计很清醒——本项目确实踩过"用 todo 掩盖真缺陷"的坑。
5. **占据位符豁免逻辑**（gate.mjs:153-176）：区分 `C:\Users\xxx`（占位）与 `C:\Users\xxx\Documents\secret.txt`（真实），
   这个细节做得很扎实，避免了"检测工具被自己的规则卡死"的死循环。
6. **`checkpoint` 的 `isMainModule()` 用 `fileURLToPath` + `realpathSync`**（L331-338），
   注释里写了 Windows 上 `new URL().pathname` 会得到 `/C:/...` 的坑——这是真实经验。

---

## 五、复现本报告的全部命令

> 以下命令按顺序执行即可复现。临时目录路径请自行替换。

```bash
# ── 准备 ──
S="$TEMP/fk-selftest-$$"
mkdir -p "$S/proj/ops" "$S/proj/site"
TK="/path/to/decision-arena-lab/FACTORY_KIT/tools"
cd "$S/proj"

# ── 步骤 1: 列角色 ──
node "$TK/taskcard.mjs" --list

# ── 步骤 2: 生成任务卡（先复现 ENOENT，再用可用的写法）──
node "$TK/taskcard.mjs" --role qa-engineer --task W01-07 --title "重跑测试" --out ops/qa/task.md   # ← 会失败
node "$TK/taskcard.mjs" --role qa-engineer --task W01-07 --title "重跑测试" --out ops/task.md       # ← 成功

# ── 步骤 3: 批量生成 ──
node "$TK/taskcard.mjs" --all --outdir ops/cards

# ── 步骤 4: checkpoint create ──
node "$TK/checkpoint.mjs" create --dir ops --title "阶段2完成" \
     --done "算法推导;单测通过" --doing "UI 落地" --next "写文档" \
     --blocked "无" --commands "node --test"

# ── 步骤 5: checkpoint verify ──
node "$TK/checkpoint.mjs" verify ops/CHECKPOINT.md
node "$TK/checkpoint.mjs" verify --all ops/

# ── 步骤 6: gate --list ──
node "$TK/gate.mjs" --list

# ── 步骤 7: gate 对有问题的项目（要 exit 1）──
node "$TK/gate.mjs" --project .
echo "exit=$?"    # 期望 1

# ── 故障注入 C1: 未脱敏路径 ──
node "$TK/checkpoint.mjs" create --dir ops --title "路径测试" \
     --done "读取 C:\\\\Users\\\\<用户名>\\Desktop\\secret.txt 完成" --doing "无" --next "无" --blocked "无"
# 生成的文件里应出现 <用户目录>，而不是真实路径

# ── 故障注入 C2: 删掉一个小节，verify 应 exit 1 ──
# 手工编辑 CHECKPOINT.md 删掉 "## 阻塞" 整节
node "$TK/checkpoint.mjs" verify ops/CHECKPOINT.md
echo "exit=$?"    # 期望 1

# ── 故障注入 C3: 已完成 = 待办，verify 应 exit 1 ──
# 手工把待办改成和已完成相同
node "$TK/checkpoint.mjs" verify ops/CHECKPOINT.md
echo "exit=$?"    # 期望 1

# ── 故障注入 G1/G2/G3: 建一个能过门禁的项目，再逐个破坏 ──
# （完整搭建见报告 §2.2；关键是 G2 改坏 import 后 module-load 必须红）

# ── 清理 ──
rm -rf "$S"
```

---

## 六、给 Lead 的建议（按优先级）

| 优先级 | 问题 | 建议 |
|---|---|---|
| **P0** | `release-freshness` 假通过（`require` 在 ESM 中未定义 + `catch{}` 吞异常） | 用顶部已 import 的 `readdirSync`；`catch` 改为 `pass:false`。**这条必须修**，否则门禁有"绿了但没检查"的黑洞 |
| **P1** | `--out` 不建父目录 | 加一行 `mkdirSync(dirname(out), { recursive: true })` |
| **P1** | `license` 门误报"找不到" | 区分"不存在"和"太短"，并说明 100 字节阈值 |
| **P1** | 未知角色抛堆栈 + 泄漏本机路径 | 改成 `console.error` + `exit(2)` |
| **P2** | `verify --all` 报 `目录不存在：true` | 判断 `args.all !== 'true'` |
| **P2** | `gate.mjs` 无 main-module 保护 | 套用 `checkpoint.mjs` 的 `isMainModule()` |

> 我在本次任务中**没有修改任何工具代码**。以上全部为记录，是否修复请 Lead 决定。

---

## 七、红线自查

| 红线 | 状态 |
|---|---|
| 为"让文档好看"而修改工具行为 | ✅ 未修改任何工具代码 |
| 自测发现的 bug 悄悄修掉 | ✅ 全部记录在案，一处未改 |
| 只测成功路径 | ✅ 三个工具都有故意失败测试（taskcard 未知角色 / checkpoint 3 项 / gate 3 项） |
| 临时目录未清理 | ✅ 109 项已删，`%TEMP%\fk-selftest-*` 无残留 |
| 动了 site/ tests/ scripts/ | ✅ 未触碰（本任务写入区仅 `FACTORY_KIT/`） |
| 自测产物含内部路径 | ✅ 本文件只出现 `C:\Users\<用户名>` 作为**待脱敏样本**，不含真实凭据；临时目录名已泛化 |
