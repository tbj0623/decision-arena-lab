#!/usr/bin/env node
/**
 * checkpoint.mjs — 多智能体协作的检查点生成与校验工具
 *
 * 解决的问题（来自真实踩坑）：
 *   1. 会话中断后，新接手的 Agent 不知道该信哪个文件
 *   2. 检查点里混进了密钥/本机路径，跟着仓库一起被公开
 *   3. "上次做到哪了"靠人回忆，导致重复劳动或漏做
 *
 * 设计原则：
 *   - 零依赖，只用 Node 内置
 *   - 生成时自动脱敏（绝对路径、密钥形态、内网地址）
 *   - 校验时严格的"必填字段 + 格式"检查，不合格就退出码非 0
 *   - 检查点本身是可读的 Markdown，人和机器都能看
 *
 * 用法：
 *   node checkpoint.mjs create --dir ops --title "阶段 2 完成" \
 *        --done "算法推导;单测" --next "UI 落地" --blocked "无"
 *   node checkpoint.mjs verify ops/CHECKPOINT.md
 *   node checkpoint.mjs verify --all ops/
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

/* ───────────── 脱敏 ───────────── */

/**
 * 不能被写进检查点的东西。
 * 这里的模式故意写得宽：宁可多遮，不可漏遮。
 */
const REDACTIONS = [
  // Windows 绝对路径（C:\Users\xxx\...）
  { re: /[A-Za-z]:\\Users\\[^\\\s"']+(\\[^\s"',;)]*)*/g, to: '<用户目录>' },
  // UNC 路径
  { re: /\\\\[A-Za-z0-9._-]+\\[^\s"',;)]*/g, to: '<网络路径>' },
  // POSIX 家目录
  { re: /\/home\/[^/\s"']+(\/[^\s"',;)]*)*/g, to: '<用户目录>' },
  { re: /\/Users\/[^/\s"']+(\/[^\s"',;)]*)*/g, to: '<用户目录>' },
  // 常见密钥形态
  { re: /\bsk-[A-Za-z0-9_-]{16,}/g, to: '<疑似密钥已脱敏>' },
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}/g, to: '<疑似 GitHub token 已脱敏>' },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, to: '<疑似 AWS Key 已脱敏>' },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, to: '<疑似 Slack token 已脱敏>' },
  // Bearer token
  { re: /\bBearer\s+[A-Za-z0-9._-]{20,}/gi, to: 'Bearer <已脱敏>' },
  // 私钥块
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, to: '<私钥已脱敏>' },
  // 内网 IP
  { re: /\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g, to: '<内网地址>' },
  // 第三方模型网关（本项目实际踩过的坑）
  { re: /https?:\/\/[a-z0-9.-]*(?:dshapi|openai-proxy|api-proxy)[a-z0-9.-]*\.[a-z]{2,}[^\s"',;)]*/gi, to: '<模型网关已脱敏>' },
];

/**
 * @param {string} text
 * @returns {{text: string, hits: number}}
 */
export function redact(text) {
  let out = String(text ?? '');
  let hits = 0;
  for (const { re, to } of REDACTIONS) {
    const before = out;
    out = out.replace(re, to);
    if (out !== before) hits += 1;
  }
  return { text: out, hits };
}

/* ───────────── 生成 ───────────── */

/** 检查点必须有这些小节，缺一不可 */
export const REQUIRED_SECTIONS = [
  '时间',
  '已完成',
  '进行中',
  '待办',
  '阻塞',
  '验证命令',
  '下一步',
];

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {string[]} [opts.done]
 * @param {string[]} [opts.doing]
 * @param {string[]} [opts.next]
 * @param {string[]} [opts.blocked]
 * @param {string[]} [opts.commands]
 * @param {object} [opts.meta]  额外键值对（会被脱敏）
 * @returns {{markdown: string, redactions: number}}
 */
export function buildCheckpoint(opts) {
  const {
    title = '未命名检查点',
    done = [],
    doing = [],
    next = [],
    blocked = [],
    commands = [],
    meta = {},
  } = opts || {};

  const now = new Date();
  const stamp = now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  let redactions = 0;
  const clean = (s) => {
    const r = redact(s);
    redactions += r.hits;
    return r.text;
  };
  const bullet = (arr, empty) =>
    (arr && arr.length ? arr.map((x) => `- ${clean(x)}`).join('\n') : `- ${empty}`);

  const metaLines = Object.entries(meta)
    .map(([k, v]) => `| ${clean(k)} | ${clean(String(v))} |`)
    .join('\n');

  const md = `# 检查点：${clean(title)}

## 时间
${stamp}

${metaLines ? `| 键 | 值 |\n|---|---|\n${metaLines}\n` : ''}
## 已完成
${bullet(done, '（无）')}

## 进行中
${bullet(doing, '（无）')}

## 待办
${bullet(next, '（无）')}

## 阻塞
${bullet(blocked, '（无）')}

## 验证命令
${commands && commands.length
    ? '```bash\n' + commands.map(clean).join('\n') + '\n```'
    : '（无）'}

## 下一步
1. 读本文件，确认"已完成"里的每一项都能被下方命令验证
2. 不要重复"已完成"里的工作
3. 从"待办"里按顺序取第一项
4. 完成后更新本文件，而不是新开一个

---
<sub>由 checkpoint.mjs 生成 · 已自动脱敏 ${redactions} 处</sub>
`;

  return { markdown: md, redactions };
}

/* ───────────── 校验 ───────────── */

/**
 * @param {string} markdown
 * @returns {{ok: boolean, problems: string[], warnings: string[], redactionLeaks: string[]}}
 */
export function verifyCheckpoint(markdown) {
  const text = String(markdown ?? '');
  const problems = [];
  const warnings = [];

  // 1. 必须有所有必需小节
  for (const sec of REQUIRED_SECTIONS) {
    if (!new RegExp(`^##\\s*${sec}`, 'm').test(text)) {
      problems.push(`缺少必需小节：## ${sec}`);
    }
  }

  // 2. 不能残留未脱敏的敏感信息
  const redactionLeaks = [];
  for (const { re, to } of REDACTIONS) {
    // 重置 lastIndex（全局正则有状态）
    re.lastIndex = 0;
    const m = text.match(re);
    if (m) redactionLeaks.push(`${m[0].slice(0, 40)} → 应替换为 ${to}`);
  }
  if (redactionLeaks.length) {
    problems.push(`发现 ${redactionLeaks.length} 处未脱敏内容`);
  }

  // 3. 时间小节必须含可识别的日期
  const timeSection = text.match(/^##\s*时间\s*\n([\s\S]*?)(?=^##\s|\Z)/m);
  if (timeSection && !/\d{4}-\d{2}-\d{2}/.test(timeSection[1])) {
    problems.push('## 时间 小节里没有可识别的日期（应为 YYYY-MM-DD）');
  }

  // 4. 空检查点警告（全小节都是"（无）"）
  const empties = (text.match(/^- （无）$/gm) || []).length;
  if (empties >= 5) {
    warnings.push('检查点几乎全空——是否忘了填写？');
  }

  // 5. "已完成"和"待办"不能完全相同（自相矛盾）
  const grab = (sec) => {
    const m = text.match(new RegExp(`^##\\s*${sec}\\s*\\n([\\s\\S]*?)(?=^##\\s|\\Z)`, 'm'));
    return m ? m[1].trim() : '';
  };
  const doneBlock = grab('已完成');
  const nextBlock = grab('待办');
  if (doneBlock && nextBlock && doneBlock === nextBlock && doneBlock !== '- （无）') {
    problems.push('「已完成」与「待办」内容完全相同——自相矛盾');
  }

  return {
    ok: problems.length === 0,
    problems,
    warnings,
    redactionLeaks,
  };
}

/* ───────────── CLI ───────────── */

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      out[key] = val;
    } else out._.push(a);
  }
  return out;
}

/**
 * 取位置参数里的「第一个文件/目录」。
 * 不能直接用 `args._[0]`：因为 `_` 里第一个元素是子命令本身（verify/create），
 * 之前就是把 "verify" 当成文件名去读了，导致任何一次校验都报"不存在"。
 */
function firstPositional(args, skip = 1) {
  return args._[skip];
}

function splitList(s) {
  if (!s || s === 'true') return [];
  return String(s)
    .split(/[;；\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function cmdCreate(args) {
  const dir = args.dir || 'ops';
  const { markdown, redactions } = buildCheckpoint({
    title: args.title || '未命名检查点',
    done: splitList(args.done),
    doing: splitList(args.doing),
    next: splitList(args.next),
    blocked: splitList(args.blocked),
    commands: splitList(args.commands),
    meta: args.version ? { 版本: args.version, 分支: args.branch || '' } : {},
  });

  if (!existsSync(dir)) {
    console.error(`目录不存在：${dir}`);
    process.exit(2);
  }
  const outPath = join(dir, 'CHECKPOINT.md');
  writeFileSync(outPath, markdown, 'utf8');

  const v = verifyCheckpoint(markdown);
  console.log(`已写入：${outPath}`);
  console.log(`自动脱敏：${redactions} 处`);
  if (!v.ok) {
    console.error('但校验未通过：');
    for (const p of v.problems) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  console.log('校验通过 ✓');
}

function cmdVerify(args) {
  const targets = [];
  if (args.all) {
    // parseArgs 把裸 --all 解析成字符串 'true'，那不是目录名，要退回默认值
    const dir = typeof args.all === 'string' && args.all !== 'true' ? args.all : 'ops';
    if (!existsSync(dir)) {
      console.error(`目录不存在：${dir}`);
      process.exit(2);
    }
    for (const f of readdirSync(dir)) {
      if (/CHECKPOINT.*\.md$/i.test(f)) targets.push(join(dir, f));
    }
  } else if (firstPositional(args)) {
    targets.push(firstPositional(args));
  } else {
    console.error('用法：node checkpoint.mjs verify <文件> | verify --all <目录>');
    process.exit(2);
  }

  if (!targets.length) {
    console.error('没找到任何 CHECKPOINT 文件');
    process.exit(2);
  }

  let bad = 0;
  for (const t of targets) {
    if (!existsSync(t) || statSync(t).isDirectory()) {
      console.error(`跳过（不存在或不是文件）：${t}`);
      bad += 1;
      continue;
    }
    const v = verifyCheckpoint(readFileSync(t, 'utf8'));
    console.log(`${v.ok ? '✓' : '✗'} ${basename(t)}`);
    for (const p of v.problems) console.log(`    ✗ ${p}`);
    for (const w of v.warnings) console.log(`    ⚠ ${w}`);
    if (!v.ok) bad += 1;
  }
  if (bad) {
    console.error(`\n${bad} 个检查点未通过`);
    process.exit(1);
  }
  console.log('\n全部通过 ✓');
}

// 判断"是否被直接运行"。
// 注意：不能用 `new URL(import.meta.url).pathname` 再手工剥前导斜杠——
// 在 Windows 上那会得到 `/C:/...`，和 process.argv[1] 的 `C:\...` 永远不等，
// 结果是脚本被 import 时静默不执行 main，直接运行时又什么都不做。
// 正确做法是用 fileURLToPath 转成原生路径再比较。
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (cmd === 'create') cmdCreate(args);
  else if (cmd === 'verify') cmdVerify(args);
  else {
    console.log(`checkpoint.mjs — 多智能体协作检查点工具

用法：
  node checkpoint.mjs create --dir ops --title "标题" \\
       --done "a;b" --doing "c" --next "d" --blocked "e" \\
       --commands "node --test;node scripts/audit.mjs"
  node checkpoint.mjs verify ops/CHECKPOINT.md
  node checkpoint.mjs verify --all ops/

设计要点：
  - 生成时自动脱敏（路径 / 密钥 / 内网地址 / 模型网关）
  - 校验时强制 7 个必需小节
  - 检测"已完成=待办"的自相矛盾
  - 退出码：0 通过 / 1 校验失败 / 2 用法错误`);
    process.exit(2);
  }
}
