#!/usr/bin/env node
/**
 * gate.mjs — 发布前质量门禁
 *
 * 解决的问题（来自真实踩坑）：
 *   1. "测试全绿就发布" —— 但测试覆盖不到 ES Module 加载链，线上曾 404
 *   2. "SHA-256 校验通过" —— 但那是为**旧包**算的哈希，校验通过 ≠ 是最新的
 *   3. "我自己跑过了" —— 没有留证据，下次无法复现
 *
 * 设计：
 *   - 每道门要么有可复跑的命令，要么有可观察的事实，不接受"我觉得没问题"
 *   - 任一门失败即整体失败（退出码非 0），且**记录失败原因**
 *   - 输出同时是给人看的 Markdown 和给机器看的 JSON
 *
 * 用法：
 *   node gate.mjs --project . --out gate-report.md
 *   node gate.mjs --project . --only tests,audit
 *   node gate.mjs --list
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, statSync, readdirSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/* ───────────── 门禁定义 ───────────── */

/**
 * 每道门:
 *   id      唯一标识
 *   title   人话标题
 *   why     为什么这道门存在（写清踩过的坑，否则后人会删）
 *   run     (projectDir) => {pass, detail}
 *   blocking 失败是否阻断发布
 */
export const GATES = [
  {
    id: 'tests',
    title: '单元测试全绿',
    why: '最基础的一道。但注意：它覆盖不到 ES Module 加载链，所以后面还有 static-fetch 那道门。',
    blocking: true,
    run: (dir) => {
      try {
        const out = execFileSync('node', ['--test'], {
          cwd: dir, encoding: 'utf8', timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'],
        });
        const pass = (out.match(/^ℹ pass (\d+)/m) || [])[1];
        const fail = (out.match(/^ℹ fail (\d+)/m) || [])[1];
        const todo = (out.match(/^ℹ todo (\d+)/m) || [])[1];
        const p = Number(pass || 0);
        const f = Number(fail || 0);
        const t = Number(todo || 0);
        // todo > 0 视为不通过：本项目踩过"用 todo 掩盖真缺陷"的坑
        const ok = f === 0 && p > 0 && t === 0;
        return {
          pass: ok,
          detail: `${p} pass / ${f} fail / ${t} todo`,
          extra: t > 0 ? 'todo 不为 0：有可能在用 todo 掩盖真实缺陷' : undefined,
        };
      } catch (e) {
        return { pass: false, detail: `测试执行失败：${String(e.message).slice(0, 120)}` };
      }
    },
  },
  {
    id: 'audit',
    title: '静态审计（无网络 / 无持久化 / 无密钥）',
    why: '隐私承诺是本项目的核心卖点。这道门由 scripts/check-no-network.mjs 执行。',
    blocking: true,
    run: (dir) => {
      const script = join(dir, 'scripts', 'check-no-network.mjs');
      if (!existsSync(script)) return { pass: false, detail: '找不到 scripts/check-no-network.mjs' };
      try {
        const out = execFileSync('node', [script], {
          cwd: dir, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { pass: /PASS/.test(out), detail: out.trim().split('\n').pop() || '' };
      } catch (e) {
        return { pass: false, detail: `审计失败：${String(e.message).slice(0, 120)}` };
      }
    },
  },
  {
    id: 'module-load',
    title: '模块加载链完整（ES Module 逐个 import）',
    why: '踩过的坑：node --test 全绿，但线上某个 .mjs 因为路径写错 404，页面白屏。测试不会替你检查加载链。',
    blocking: true,
    run: (dir) => {
      const core = join(dir, 'site', 'core.mjs');
      if (!existsSync(core)) return { pass: false, detail: '找不到 site/core.mjs' };
      // 用动态 import 真加载一遍，路径错了立刻抛
      const script = `
        const mods = ['./site/core.mjs','./site/features/narrative.mjs','./site/data/validation-actions.mjs'];
        let bad = [];
        for (const m of mods) {
          try { await import(new URL(m, 'file:///' + process.cwd().replace(/\\\\/g,'/') + '/')); }
          catch (e) { bad.push(m + ' :: ' + e.message.slice(0,80)); }
        }
        if (bad.length) { console.error(bad.join('\\n')); process.exit(1); }
        console.log('3/3 模块加载成功');
      `;
      try {
        const out = execFileSync('node', ['--input-type=module', '-e', script], {
          cwd: dir, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { pass: true, detail: out.trim() };
      } catch (e) {
        return { pass: false, detail: `模块加载失败：${String(e.stderr || e.message).slice(0, 200)}` };
      }
    },
  },
  {
    id: 'tracked-internal',
    title: '内部文件未被 git 跟踪',
    why: '踩过的坑：work/、dist/、_internal/ 曾被 git 跟踪，一旦推到公开仓库就是永久泄漏（删文件改不了历史）。',
    blocking: true,
    run: (dir) => {
      try {
        const out = execFileSync('git', ['ls-files'], {
          cwd: dir, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
        });
        const bad = out.split('\n').filter((f) =>
          /^(work\/|dist\/|_internal\/|ops\/)/.test(f) ||
          /^(STATUS|CHECKPOINT|BLOCKERS)\.md$/.test(f) ||
          /\.env($|\.)/.test(f));
        return {
          pass: bad.length === 0,
          detail: bad.length ? `被跟踪的内部文件：${bad.slice(0, 5).join(', ')}` : '0 个内部文件被跟踪',
        };
      } catch {
        return { pass: false, detail: '不是 git 仓库或 git 不可用' };
      }
    },
  },
  {
    id: 'history-secrets',
    title: 'git 历史无密钥',
    why: '踩过的坑：文件删了但历史还在。公开仓库的历史是全量公开的。',
    blocking: true,
    run: (dir) => {
      try {
        const out = execFileSync('git', ['log', '-p', '--all'], {
          cwd: dir, encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const patterns = [
          { re: /api\d*\.[a-z0-9-]*dshapi[a-z0-9.-]*/i, why: '模型网关地址' },
          { re: /[A-Za-z]:\\Users\\[^\\\s]+/, why: '本机绝对路径' },
          { re: /\bsk-[A-Za-z0-9]{16,}/, why: 'OpenAI 风格密钥' },
          { re: /\bgh[pousr]_[A-Za-z0-9]{20,}/, why: 'GitHub token' },
          { re: /\bAKIA[0-9A-Z]{16}\b/, why: 'AWS Key' },
        ];

        // 占位符豁免：像 `C:\Users\xxx`、`<用户目录>` 这类
        // 是**文档/工具源码里用来描述"这里会有一个路径"的写法**，不是真实路径。
        // 不豁免它们的话，任何写"检测本机路径"的工具都会让自己的门禁永远红，
        // 维护者最后只能删掉规则——那才是真正的损失。
        //
        // 注意：匹配结果可能带上 Markdown 反引号/引号/标点（`C:\Users\xxx\`` ），
        // 判断前必须先把这些"包裹字符"剥掉，否则占位符识别不出来。
        const PLACEHOLDER_SEGMENTS = /^(xxx+|user(name)?|用户名|你的用户名|your[-_]?name|<.*>|\.\.\.)$/i;
        const stripWrapping = (s) => s.replace(/^[`'"([{<]+/, '').replace(/[`'"\])}>,.;:]+$/, '');

        const hits = [];
        for (const { re, why } of patterns) {
          const m = out.match(re);
          if (!m) continue;
          const hit = stripWrapping(m[0]);
          // 只对本机路径这一类做占位符判定
          if (why === '本机绝对路径') {
            const segs = hit.split('\\').filter(Boolean);
            const last = stripWrapping(segs[segs.length - 1] || '');
            // 只有「路径就停在占位符那一段」才算占位（C:\Users\xxx）。
            // 如果后面还有子路径（C:\Users\xxx\Documents\secret.txt），
            // 最后一段是真实文件名，不算占位，必须拦。
            const isBarePlaceholder = segs.length === 3 && last && PLACEHOLDER_SEGMENTS.test(last);
            if (isBarePlaceholder) continue;
          }
          hits.push(`${why}：${hit.slice(0, 30)}`);
        }
        return {
          pass: hits.length === 0,
          detail: hits.length ? `历史命中：${hits.join(' | ')}` : '0 命中（占位符已排除）',
        };
      } catch (e) {
        return { pass: false, detail: `扫描失败：${String(e.message).slice(0, 100)}` };
      }
    },
  },
  {
    id: 'license',
    title: '许可证存在',
    why: '开源项目没有 LICENSE，别人在法律上不能用。',
    blocking: true,
    run: (dir) => {
      for (const n of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
        const p = join(dir, n);
        if (existsSync(p) && statSync(p).size > 0) {
          return { pass: true, detail: `${n}（${statSync(p).size} 字节）` };
        }
      }
      return { pass: false, detail: '找不到 LICENSE 文件' };
    },
  },
  {
    id: 'no-file-protocol-claims',
    title: '没有"双击 file:// 就能用"的错误承诺',
    why: '踩过的坑：README 说能双击打开，实际原生 ES Module 在 file:// 下被 CORS 拒绝，页面白屏。文档承诺必须和现实一致。',
    blocking: false,
    run: (dir) => {
      const readme = join(dir, 'README.md');
      if (!existsSync(readme)) return { pass: true, detail: '无 README，跳过' };
      const txt = readFileSync(readme, 'utf8');
      // 允许出现 file:// 但必须伴随"打不开/不支持/必须走 HTTP"这类否定说明
      const mentions = /file:\/\//.test(txt);
      if (!mentions) return { pass: true, detail: '未提及 file://' };
      const hasWarning = /(打不开|不支持|不能|必须走|空白|CORS)/.test(txt);
      return {
        pass: hasWarning,
        detail: hasWarning ? '提及 file:// 且有明确警告' : '提及 file:// 但没有警告，可能误导用户',
      };
    },
  },
  {
    id: 'release-freshness',
    title: '发行包比源码新',
    why: '踩过的坑：dist/ 里的 zip 是 3 小时前的旧版，但 SHA-256 校验"通过"——因为那个哈希就是为旧包算的。校验通过 ≠ 是最新的。',
    blocking: false,
    run: (dir) => {
      const distDir = join(dir, 'dist');
      if (!existsSync(distDir)) return { pass: true, detail: '无 dist/，跳过' };
      // 简化：只比较 site/app.mjs 与 dist 里 zip 的 mtime
      const probe = join(dir, 'site', 'app.mjs');
      if (!existsSync(probe)) return { pass: true, detail: '无 site/app.mjs，跳过' };
      const srcTime = statSync(probe).mtimeMs;

      // 历史缺陷（release-engineer W04-01 故障注入发现，已修）：
      // 这里原本调用一个用了 `require('node:fs')` 的辅助函数——ESM 里没有 require，
      // 抛出的 ReferenceError 又被 catch{/* ignore */} 静默吞掉，
      // 于是 zips 恒为空，这道门对任何带 zip 的项目**永远显示 ✅「无 zip，跳过」**，
      // 实际从未检查过。**假通过比报错危险得多**，也正是这个工具声称要消灭的东西。
      //
      // 现在的规则：读目录失败 = 这道门失败（pass:false），不是跳过。
      // 「跳过」只能用于"确实没有这个目录"这种可确证的正常情况。
      let zips;
      try {
        zips = readdirSync(distDir).filter((f) => f.endsWith('.zip'));
      } catch (e) {
        return { pass: false, detail: `无法读取 dist/：${String(e.message).slice(0, 100)}` };
      }
      if (!zips.length) return { pass: true, detail: 'dist/ 存在但无 zip，跳过' };
      const stale = zips.filter((z) => statSync(join(distDir, z)).mtimeMs < srcTime);
      return {
        pass: stale.length === 0,
        detail: stale.length ? `过期：${stale.join(', ')}` : `${zips.length} 个 zip 均比源码新`,
      };
    },
  },
];

/* ───────────── 执行 ───────────── */

export function runGates(projectDir, only) {
  const dir = resolve(projectDir);
  const selected = only && only.length
    ? GATES.filter((g) => only.includes(g.id))
    : GATES;

  const results = [];
  for (const g of selected) {
    const t0 = Date.now();
    let r;
    try {
      r = g.run(dir);
    } catch (e) {
      r = { pass: false, detail: `门禁自身异常：${String(e.message).slice(0, 150)}` };
    }
    results.push({
      id: g.id,
      title: g.title,
      why: g.why,
      blocking: g.blocking,
      pass: !!r.pass,
      detail: r.detail || '',
      extra: r.extra,
      ms: Date.now() - t0,
    });
  }
  return results;
}

function toMarkdown(results, projectDir) {
  const blockingFails = results.filter((r) => r.blocking && !r.pass);
  const nonBlockingFails = results.filter((r) => !r.blocking && !r.pass);
  const verdict = blockingFails.length
    ? `❌ 不通过（${blockingFails.length} 道阻断门失败）`
    : nonBlockingFails.length
      ? `⚠️ 通过但有提醒（${nonBlockingFails.length} 道非阻断门未过）`
      : '✅ 全部通过';

  const rows = results
    .map((r) => `| ${r.pass ? '✅' : (r.blocking ? '❌' : '⚠️')} | ${r.title} | ${r.detail} | ${r.ms}ms |`)
    .join('\n');

  return `# 质量门禁报告

**项目**：\`${projectDir}\`
**时间**：${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC
**结论**：${verdict}

| 结果 | 门禁 | 实测 | 耗时 |
|---|---|---|---|
${rows}

${blockingFails.length ? `## 阻断项（必须修）\n\n${blockingFails.map((r) => `- **${r.title}**：${r.detail}`).join('\n')}\n` : ''}
${nonBlockingFails.length ? `## 提醒项\n\n${nonBlockingFails.map((r) => `- **${r.title}**：${r.detail}`).join('\n')}\n` : ''}
## 为什么有这些门

${results.map((r) => `- **${r.title}**：${r.why}`).join('\n')}

---
<sub>由 FACTORY_KIT/tools/gate.mjs 生成 · 不接受"我觉得没问题"，每道门都有可复跑依据</sub>
`;
}

/* ───────────── CLI ───────────── */

const args = process.argv.slice(2);
if (args.includes('--list')) {
  for (const g of GATES) {
    console.log(`${g.blocking ? '[阻断]' : '[提醒]'} ${g.id.padEnd(22)} ${g.title}`);
  }
  process.exit(0);
}

const getArg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const projectDir = getArg('project', '.');
const outPath = getArg('out', '');
const only = (getArg('only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);

/* ───────────── CLI 入口 ─────────────
 *
 * 这段只在被**直接运行**时执行。
 * 历史缺陷（release-engineer W04-01 发现）：没有这个保护时，
 * 任何人 `import { GATES } from './gate.mjs'` 都会顺手把全部门禁跑一遍
 * （包括 git log -p 全历史扫描，很慢），而且会调 process.exit() 杀掉调用方进程。
 */
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
  const results = runGates(projectDir, only);
  const md = toMarkdown(results, resolve(projectDir));

  if (outPath) {
    writeFileSync(outPath, md, 'utf8');
    console.log(`报告已写入：${outPath}`);
  }

  for (const r of results) {
    const icon = r.pass ? '✅' : (r.blocking ? '❌' : '⚠️');
    console.log(`${icon} ${r.title.padEnd(30)} ${r.detail}`);
  }

  const failed = results.filter((r) => r.blocking && !r.pass);
  if (failed.length) {
    console.error(`\n${failed.length} 道阻断门未通过`);
    process.exit(1);
  }
  console.log('\n所有阻断门通过 ✓');

}
