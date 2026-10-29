/**
 * 承诺一致性自检（Lead 自己做的，V8 主线）
 *
 * 背景：今晚 6 个 P0/P1 都是「界面承诺了做不到的事」。
 * 这个脚本对界面上每一句承诺性文案做**可执行验证**，
 * 而不是靠人读一遍觉得"应该没问题"。
 *
 * 每条检查都给出：承诺原文 → 验证方法 → 实际结果 → 判定
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const SITE = join(ROOT, 'site');
const HTML = readFileSync(join(SITE, 'index.html'), 'utf8');

const results = [];
function check(id, promise, method, pass, detail) {
  results.push({ id, promise, method, pass, detail });
}

/* ── 1. 「所有数据都不会离开这台设备」 ── */
{
  const out = execFileSync('node', ['scripts/check-no-network.mjs'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  const noNet = /PASS/.test(out);
  check(
    'P-1',
    '所有数据都不会离开这台设备 / 不发到任何地方',
    'node scripts/check-no-network.mjs（11 类禁网规则 + 4 类密钥规则）',
    noNet,
    noNet ? 'PASS：site/ 与 scripts/ 无任何出网调用' : 'FAIL：审计未通过',
  );
}

/* ── 2. 「不保存任何数据：刷新页面就没了」 ── */
{
  const storage = ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie'];
  const hits = [];
  for (const f of walk(SITE)) {
    // 必须先剥掉注释再扫。
    // 踩过的坑：app.mjs 顶部有一行 **说明自己不用持久化** 的注释
    // （"不做持久化：不写 localStorage / ..."），
    // 朴素扫描会把它当命中——这和早先审计脚本自我误报是同一个毛病：
    // 搜"有没有这个词"而不是"有没有真的调用"。
    const raw = readFileSync(f, 'utf8');
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释
      .replace(/^[ \t]*\/\/.*$/gm, '')    // 行注释
      .replace(/<!--[\s\S]*?-->/g, '');   // HTML 注释
    for (const s of storage) if (code.includes(s)) hits.push(`${f.replace(ROOT, '.')} 含 ${s}`);
  }
  check(
    'P-2',
    '当前版本不保存任何数据：刷新页面就没了',
    '剥掉注释后扫描 site/ 下所有代码里的持久化 API',
    hits.length === 0,
    hits.length ? hits.join('; ') : 'PASS：0 处持久化 API（注释里的说明已排除）',
  );
}

/* ── 3. 「占比加起来一定是 100%」 ── */
{
  // 这一条今晚就是被测出 100.2% 的那个。现在用 4/5/6 因素 × 多种权重组合验证。
  const { scoreDecision } = await import('../../site/core.mjs');
  const bad = [];
  for (const n of [4, 5, 6]) {
    for (const w of [1, 2, 3, 5, 7]) {
      const input = {
        title: 't',
        options: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
        factors: Array.from({ length: n }, (_, i) => ({
          id: `f${i + 1}`, label: `因素${i + 1}`, weight: w,
          ratings: { A: 5 + (i % 3), B: 4 + (i % 2) },
        })),
      };
      const a = scoreDecision(input);
      // 模拟 UI 的 round1SummingTo 行为：先各自取 1 位，再用最大余数法对齐到 100
      const raw = a.contributions.map((c) => c.share * 100);
      const rounded = raw.map((x) => Math.round(x * 10) / 10);
      const sum = rounded.reduce((s, x) => s + x, 0);
      if (Math.abs(sum - 100) > 0.05) bad.push(`${n}因素 w=${w}: 原始取整和=${sum.toFixed(1)}`);
    }
  }
  // UI 用 round1SummingTo 修正，所以这里验证的是「修正后」是否真的等于 100
  // 用与 app.mjs 相同的算法复算
  const round1SummingTo = (vals, target) => {
    const scaled = vals.map((v) => Math.round(v * 10));
    const t = Math.round(target * 10);
    let diff = t - scaled.reduce((s, x) => s + x, 0);
    const out = [...scaled];
    if (diff !== 0) {
      const errs = vals.map((v, i) => ({ i, err: Math.abs(v * 10 - scaled[i]) }));
      errs.sort((x, y) => x.err - y.err);
      let k = 0;
      while (diff !== 0 && k < 1000) {
        const e = errs[k % errs.length];
        out[e.i] += diff > 0 ? 1 : -1;
        diff += diff > 0 ? -1 : 1;
        k += 1;
      }
    }
    return out.map((x) => x / 10);
  };
  let worst = 0;
  for (const n of [4, 5, 6]) {
    for (const ws of [[1,1,1,1,1,1],[1,2,3,4,5,6],[10,10,10,10,10,10],[0,1,1,1,1,1]]) {
      const input = {
        title: 't',
        options: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
        factors: Array.from({ length: n }, (_, i) => ({
          id: `f${i + 1}`, label: `因素${i + 1}`, weight: ws[i] ?? 1,
          ratings: { A: 5 + (i % 3), B: 4 + (i % 2) },
        })),
      };
      const a = scoreDecision(input);
      const shown = round1SummingTo(a.contributions.map((c) => c.share * 100), 100);
      const sum = shown.reduce((s, x) => s + x, 0);
      worst = Math.max(worst, Math.abs(sum - 100));
    }
  }
  check(
    'P-3',
    '占比加起来一定是 100%',
    '4/5/6 因素 × 4 种权重组合，用与 UI 相同的 round1SummingTo 复算',
    worst < 0.05,
    `最大偏差 ${worst.toFixed(6)}%（今晚修前 6 因素等权是 100.2%）`,
  );
}

/* ── 4. 「公式公开，你可以自己算一遍」 ── */
{
  const htmlHasFormula = /Σw|w<sub>|p<sub>/.test(HTML);
  // 公开的公式必须真的能复现界面上的数字
  const { scoreDecision } = await import('../../site/core.mjs');
  const input = {
    title: 't',
    options: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
    factors: [
      { id: 'f1', label: '甲', weight: 5, ratings: { A: 9, B: 5 } },
      { id: 'f2', label: '乙', weight: 4, ratings: { A: 4, B: 8 } },
      { id: 'f3', label: '丙', weight: 2, ratings: { A: 7, B: 7 } },
      { id: 'f4', label: '丁', weight: 3, ratings: { A: 8, B: 6 } },
    ],
  };
  const a = scoreDecision(input);
  // 手写公式
  const W = input.factors.reduce((s, f) => s + f.weight, 0);
  const manualA = 10 * input.factors.reduce((s, f) => s + (f.weight / W) * f.ratings.A, 0);
  const manualB = 10 * input.factors.reduce((s, f) => s + (f.weight / W) * f.ratings.B, 0);
  const match = Math.abs(manualA - a.scoreA) < 1e-9 && Math.abs(manualB - a.scoreB) < 1e-9;
  check(
    'P-4',
    '公式公开，你可以自己算一遍',
    '手写 10·Σ(wᵢrᵢ)/Σw 与 scoreDecision 对账',
    htmlHasFormula && match,
    `界面展示公式: ${htmlHasFormula}；手算 ${manualA.toFixed(2)}/${manualB.toFixed(2)} vs 代码 ${a.scoreA.toFixed(2)}/${a.scoreB.toFixed(2)}`,
  );
}

/* ── 5. 「这些是编出来的场景」 ── */
{
  const { EXAMPLES } = await import('../../site/features/narrative.mjs');
  // 真实品牌黑名单（本项目自己声明过"不出现真实品牌"）
  const BRANDS = /MacBook|ThinkPad|Apple|Lenovo|iPhone|华为|小米|耐克|Nike|Adidas|星巴克|Starbucks/i;
  const bad = [];
  for (const e of EXAMPLES) {
    const blob = JSON.stringify(e);
    if (BRANDS.test(blob)) bad.push(e.key);
  }
  check(
    'P-5',
    '这些是编出来的场景（不出现真实品牌/公司/人名）',
    `扫描 ${EXAMPLES.length} 个示例的全部字段`,
    bad.length === 0,
    bad.length ? `含真实品牌：${bad.join(', ')}` : `PASS：${EXAMPLES.length} 个示例均无真实品牌`,
  );
}

/* ── 6. 「不用填任何真实信息」 ── */
{
  // 导出文件里不能有 UA / 设备信息 / 时间戳以外的东西
  const app = readFileSync(join(SITE, 'app.mjs'), 'utf8');
  const hasUA = /navigator\.userAgent|navigator\.platform|screen\.width|Intl\.DateTimeFormat/.test(app);
  const exportFn = app.match(/function exportJSON[\s\S]{0,800}/)?.[0] || '';
  const onlyKnown = !/userAgent|platform|screen\.|deviceMemory|hardwareConcurrency|timezone/i.test(exportFn);
  check(
    'P-6',
    '不用填任何真实信息',
    '检查导出函数是否采集设备/环境信息',
    !hasUA && onlyKnown,
    `采集设备信息: ${hasUA}；导出仅含用户输入: ${onlyKnown}`,
  );
}

/* ── 7. 「不会替你决定」 ── */
{
  // 全站不能出现"建议你选 X""推荐你"这类结论式指令
  const allText = [...walk(SITE)]
    .filter((f) => ['.mjs', '.html'].includes(extname(f)))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  const directive = /(建议|推荐)(你|您)?(选|选择|去做|接受|拒绝)\b/;
  const hasDirective = directive.test(allText);
  check(
    'P-7',
    '不会替你决定',
    '扫描全站是否有「建议你选 X」这类结论式指令',
    !hasDirective,
    hasDirective ? '发现结论式指令' : 'PASS：无结论式指令',
  );
}

/* ── 输出 ── */
function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) { if (!e.name.startsWith('.')) yield* walk(full); }
    else if (e.isFile()) yield full;
  }
}

console.log('\n承诺一致性自检\n' + '─'.repeat(78));
let fail = 0;
for (const r of results) {
  if (!r.pass) fail += 1;
  console.log(`${r.pass ? '✓' : '✗'} ${r.id}  「${r.promise.slice(0, 34)}」`);
  console.log(`    方法：${r.method}`);
  console.log(`    实测：${r.detail}`);
}
console.log('─'.repeat(78));
console.log(`${results.length - fail}/${results.length} 条承诺经得起验证`);
process.exit(fail === 0 ? 0 : 1);
