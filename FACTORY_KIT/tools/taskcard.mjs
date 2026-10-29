#!/usr/bin/env node
/**
 * taskcard.mjs — 给每个 Agent 生成"开箱即用"的任务卡
 *
 * 解决的问题（来自真实踩坑）：
 *   1. 任务描述含糊，Agent 自由发挥，交付物对不上预期
 *   2. 多个 Agent 同时改同一个文件，互相覆盖
 *   3. Agent 报"完成"但没有可验证证据，Lead 还得重做一遍
 *
 * 任务卡强制要求四件事：
 *   - 写入范围（谁也别碰别人的文件）
 *   - 验收标准（可命令验证，不接受"我觉得没问题"）
 *   - 必须回报的证据格式
 *   - 红线（明确禁止什么）
 *
 * 用法：
 *   node taskcard.mjs --list
 *   node taskcard.mjs --role qa-engineer --task "重跑测试" --out ops/qa/task.md
 *   node taskcard.mjs --all --outdir ops/cards
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

/* ───────────── 角色定义 ───────────── */

/**
 * 每个角色定义：主线、独占写入区、必须交出的证据、典型红线。
 * 这些不是凭空设的——每一条的"红线"都对应本项目真实踩过的一次坑。
 */
export const ROLES = {
  'market-scout': {
    line: '产品定位、竞品、真实痛点证据',
    scope: ['research/', 'ops/market/'],
    evidence: ['来源 URL（可点击）', '对比框架', '结论的适用边界'],
    redlines: [
      '不许编造竞品数据或用户量',
      '拿不到证据的写 UNVERIFIED，不要猜',
      '不许把"我觉得"写成"用户需要"',
    ],
  },
  'product-owner': {
    line: '价值优先级、用户路径、发布门槛',
    scope: ['ops/product/'],
    evidence: ['PRD 变更说明', '验收规则（可命令验证）', '砍掉的项 + 理由'],
    redlines: [
      '不许用"用户会喜欢"代替证据',
      '优先级要给理由，不能只贴 P0/P1 标签',
      '必须写清"不做什么"',
    ],
  },
  'ux-writer': {
    line: '易懂的解释、无障碍文案、语言包',
    scope: ['ops/ux/'],
    evidence: ['改动前后对照', '用户路线审查', '读屏播报注意点'],
    redlines: [
      '不许为了简短牺牲准确性',
      '字数统计要真实，不许估',
      '不许出现"概率/成功率/预测"',
    ],
  },
  'logic-engineer': {
    line: '算法设计、数学独立验证',
    scope: ['ops/logic/', 'proposals/math/'],
    evidence: ['推导过程', '测试', '边界证明'],
    redlines: [
      '不许直接改 site/core.mjs（Lead 的合并权限）',
      '不许改现有函数语义',
      '拿不准的边界标 OPEN QUESTION，不要猜',
    ],
  },
  'ui-engineer': {
    line: 'UI 交互与响应式',
    scope: ['ops/ui/'],
    evidence: ['浏览器截图', 'A11y 结果', '最小 diff'],
    redlines: [
      '不许引入外部依赖或 CDN',
      '改动必须可在 360px 下验证',
      '不许只测桌面就声称"响应式没问题"',
    ],
  },
  'story-engineer': {
    line: '虚构示例、教学内容',
    scope: ['ops/story/'],
    evidence: ['每例可复现的输入与输出', '独立复核方法'],
    redlines: [
      '不许生成伪数据',
      '不许用真实品牌名/真人名',
      '复核必须独立于原实现，不能自证',
    ],
  },
  'qa-engineer': {
    line: '回归、属性测试、盲审',
    scope: ['ops/qa/'],
    evidence: ['重现实验记录', '失败记录', '准确命令与版本号'],
    redlines: [
      '不许把"我的报告"当证据，要有命令输出',
      '未测的必须写 NOT_TESTED 并说明原因',
      '不许因为测试全绿就说"没问题"（覆盖不到的要说清）',
    ],
  },
  'red-team': {
    line: '隐私、安全、误导性审查',
    scope: ['ops/red/'],
    evidence: ['风险清单 + 严重级别', '可验证的攻击/复现步骤', '未验证项'],
    redlines: [
      '发现 P0 必须明确说"阻止"',
      '不许对线上做写操作或压力测试',
      '凭据泄漏只写位置和类型，不要贴全文',
    ],
  },
  'growth-producer': {
    line: '真实演示、视频文字、社区适配',
    scope: ['marketing/', 'ops/growth/'],
    evidence: ['每条素材的事实核验状态', '数字出处'],
    redlines: [
      '不许代发社交平台',
      '不许编造访问量/好评/用户数',
      '每份素材标注 DRAFT — NOT POSTED',
    ],
  },
  'release-engineer': {
    line: '版本、CI、发布、工具箱流程',
    scope: ['ops/release/'],
    evidence: ['SHA', '部署验证（真实 HTTP）', '回退点'],
    redlines: [
      '不许假称部署成功',
      '不许碰其他仓库',
      '不许付费',
      '部署验证必须 CDP 清缓存，否则会读到旧版',
    ],
  },
  lead: {
    line: '合并、部署、派发、版本记录',
    scope: ['site/', 'tests/', 'scripts/', 'docs/', '.github/'],
    evidence: ['最终 diff', '全量测试', '真实链接'],
    redlines: [
      '只有 Lead 能改 site/ 正式源码',
      '只有 Lead 能 git commit / push',
      '合并前必须自己复跑关键测试，不以"成员说完成"为依据',
    ],
  },
};

/* ───────────── 生成 ───────────── */

/**
 * @param {object} opts
 * @param {string} opts.role
 * @param {string} opts.taskId
 * @param {string} opts.title
 * @param {string} [opts.detail]
 * @param {string} [opts.projectDir]
 * @param {string} [opts.branch]
 * @param {string[]} [opts.extraRedlines]
 * @returns {string} markdown
 */
export function buildTaskCard(opts) {
  const {
    role, taskId, title, detail = '',
    projectDir = '<项目根>', branch = 'night-v8',
    extraRedlines = [],
  } = opts;

  const r = ROLES[role];
  if (!r) {
    // 不抛异常：异常堆栈里含本机绝对路径（会跟着报告泄漏出去），
    // 而且对使用者来说"可用角色有哪些"比堆栈有用得多。
    console.error(`未知角色：${role}`);
    console.error(`可用角色：${Object.keys(ROLES).join(', ')}`);
    process.exit(2);
  }

  const scopeLines = r.scope.map((s) => `- \`${s}\``).join('\n');
  const evidenceLines = r.evidence.map((e) => `- ${e}`).join('\n');
  const redlineLines = [...r.redlines, ...extraRedlines].map((x) => `- ⛔ ${x}`).join('\n');

  return `# ${taskId} · ${title}

**角色**：\`${role}\` — ${r.line}
**项目根**：\`${projectDir}\`
**工作分支**：\`${branch}\`（**不要切回 main**）
**派发时间**：${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC

---

## 你可以写这些地方

${scopeLines}

**范围之外一律不写。** 如果确实需要改别人的文件，先在报告里提"需要 Lead 合并"，不要自己动手。

## 任务

${detail || '（未填写，由派发者补充）'}

## 你必须交出的证据

${evidenceLines}

**没有证据 = 没完成。** "我做完了"不是证据。

## 红线

${redlineLines}

## 汇报格式（严格照抄这个结构）

\`\`\`
${taskId} / <DONE|PARTIAL|BLOCKED> / <产物文件路径>
做了什么: <一句话>
证据: <命令 + 真实输出摘要 / 文件行号 / HTTP 状态码>
未做/未验证: <诚实列出，没有就写"无">
风险: <一句话>
下一步建议: <一句话>
\`\`\`

**≤800 字。** 超了我不会读。

## 完成后

1. 不要自己 git commit / push（那是 Lead 的权限）
2. 不要标任务 completed 就完事——Lead 会复跑你的关键证据
3. 如果中途发现前置任务有错，**立刻单独发消息**，别埋在报告里
`;
}

/* ───────────── CLI ───────────── */

const args = process.argv.slice(2);
const get = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

if (args.includes('--list')) {
  console.log('可用角色：\n');
  for (const [k, v] of Object.entries(ROLES)) {
    console.log(`  ${k.padEnd(16)} ${v.line}`);
    console.log(`  ${''.padEnd(16)} 写入区: ${v.scope.join(', ')}`);
  }
  process.exit(0);
}

if (args.includes('--all')) {
  const outdir = get('outdir', 'ops/cards');
  mkdirSync(outdir, { recursive: true });
  for (const role of Object.keys(ROLES)) {
    const md = buildTaskCard({
      role,
      taskId: `CARD-${role}`,
      title: `${role} 角色任务卡（模板）`,
      detail: '（这是模板，派发时把具体任务填进 --detail）',
    });
    writeFileSync(join(outdir, `${role}.md`), md, 'utf8');
  }
  console.log(`已生成 ${Object.keys(ROLES).length} 张角色卡 → ${outdir}`);
  process.exit(0);
}

const role = get('role');
if (!role) {
  console.log(`taskcard.mjs — 生成 Agent 任务卡

用法：
  node taskcard.mjs --list
  node taskcard.mjs --role qa-engineer --task W01-07 \\
       --title "重跑全部测试" --detail "..." --out ops/qa/task.md
  node taskcard.mjs --all --outdir ops/cards

为什么要有这个工具：
  含糊的任务描述 → Agent 自由发挥 → 交付物对不上
  不划写入区   → 两个 Agent 互相覆盖
  不要求证据   → "完成"变成主观判断，Lead 还得重做一遍`);
  process.exit(2);
}

const md = buildTaskCard({
  role,
  taskId: get('task', 'TASK'),
  title: get('title', '未命名任务'),
  detail: get('detail', ''),
  projectDir: get('project', '<项目根>'),
  branch: get('branch', 'night-v8'),
});

const out = get('out');
if (out) {
  // 父目录可能不存在（官方示例 `--out ops/qa/task.md` 就会 ENOENT）。
  // 建目录是使用者的预期，不该让他自己去 mkdir。
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, md, 'utf8');
  console.log(`已写入：${out}`);
} else {
  console.log(md);
}
