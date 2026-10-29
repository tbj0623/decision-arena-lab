/**
 * UI 契约测试（无浏览器依赖，只读 site/ 源码做静态契约断言）
 *
 * 定位：tests/qa/scenarios.test.mjs 覆盖的是"算法 + 数据"层；
 * 本文件覆盖"界面层对用户做出的承诺"——可访问性布线、隐私承诺、措辞限定语、
 * 以及导出文件的数据边界。它读真实文件、按行号定位，不做 DOM 模拟。
 *
 * 用法：node --test（或 node tests/qa/ui-contract.test.mjs）
 *
 * 约定：
 *  - 已经满足的契约用普通断言（红了就是回归）。
 *  - 已知缺口用 `{ todo: true }`：断言仍是真实断言，但失败不会拖垮 CI，
 *    只会在输出里以 `# TODO` 呈现。每个 todo 都对应 work/qa/DEFECTS.md 里的编号，
 *    修好之后把 todo 去掉，它就会变成真正的回归守卫。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const HTML = read('site/index.html');
const APP = read('site/app.mjs');
const CSS = read('site/styles/app.css');
const CORE = read('site/core.mjs');
const NARRATIVE = read('site/features/narrative.mjs');

/** 按行号定位，方便断言失败时直接给出现场 */
function findLines(source, re) {
  const hits = [];
  source.split(/\r?\n/).forEach((line, i) => { if (re.test(line)) hits.push({ line: i + 1, text: line.trim() }); });
  return hits;
}

/* ───────────────────────── 结构与可访问性布线 ───────────────────────── */

test('UI 契约：文档语言、viewport 与首屏定位语齐备', () => {
  assert.match(HTML, /<html lang="zh-CN">/);
  assert.match(HTML, /<meta name="viewport" content="[^"]*width=device-width/);
  // V9 品牌改版换了首屏主标题，定位语随之更新。
  //
  // 这条测试的价值不在于锁死某一句话，而在于**保证首屏确实有一句明确定位**，
  // 不是空着也不是放了一堆营销词。所以检查的是"核心承诺还在不在"：
  //   1) 标题点出「犹豫的只是一个条件」这个产品主张
  //   2) 副文案说清"找到临界点 + 去验证"，而不是承诺结果
  assert.ok(
    HTML.includes('一个条件') && HTML.includes('临界点'),
    '首屏定位语必须包含产品主张（一个条件 → 临界点）',
  );
  // 反向：首屏绝不能**承诺**成功率/胜率。
  // 注意要放过否定语境——"不是成功率"这句是正当的免责声明，
  // 而且必须保留（V9 要求高风险边界不能删）。
  const heroStart = HTML.indexOf('<section class="hero');
  const heroBlock = HTML.slice(heroStart, HTML.indexOf('id="examples"', heroStart));
  const withoutNegation = heroBlock.replace(/不是[^。；]*?(成功率|胜率)[^。；]*/g, '');
  assert.ok(!/成功率|胜率/.test(withoutNegation),
    '首屏不得承诺成功率/胜率（否定语境如"不是成功率"允许）');
});

test('UI 契约：跳过导航链接指向真实存在的 #main', () => {
  const skip = findLines(HTML, /class="skip-link"/);
  assert.equal(skip.length, 1, '应当恰好有一个 skip-link');
  const href = HTML.match(/class="skip-link" href="#([^"]+)"/);
  assert.ok(href, 'skip-link 必须带 href="#id"');
  assert.ok(HTML.includes(`id="${href[1]}"`), `跳转目标 #${href[1]} 必须存在`);
});

test('UI 契约：结果区是 aria-live 直播区，错误提示带 role="alert"', () => {
  assert.ok(/id="result-card"[^>]*aria-live="polite"/.test(HTML), '结果卡必须是 aria-live="polite"');
  const alerts = findLines(HTML, /class="field-error"[^>]*role="alert"/);
  assert.ok(alerts.length >= 2, `至少两个字段级 role="alert"，实际 ${alerts.length}`);
});

test('UI 契约：评分输入框必须由 JS 注入 aria-label（0–10 说明）', () => {
  const labels = findLines(APP, /'aria-label': `\$\{side === 'A' \? '方案 A' : '方案 B'\} 在这项上的评分（0–10）`/);
  assert.ok(labels.length >= 1, 'makeRatingRow 必须给 number 输入框设置含 0–10 的 aria-label');
});

test('UI 契约：分享对话框是原生 <dialog>，因此 Esc 由浏览器负责关闭', () => {
  assert.match(HTML, /<dialog id="share-dialog"/);
  // 代码注释声称"Esc 关闭原生 dialog 已由浏览器处理"，此处只校验没有反向拦截 Esc。
  assert.ok(!/keydown[\s\S]{0,200}Escape[\s\S]{0,80}preventDefault/.test(APP), '不得拦截 Esc 默认行为');
});

/* ───────────────────────── 渲染安全 ───────────────────────── */

test('UI 契约：用户输入绝不拼进 innerHTML', () => {
  const hits = findLines(APP, /\.innerHTML\s*=/);
  assert.deepEqual(hits, [], `发现 innerHTML 赋值：${JSON.stringify(hits)}`);
  assert.ok(APP.includes('textContent'), '应当用 textContent 写文本');
});

test('UI 契约：页面不引用任何外部 URL（data: URI 与元数据除外）', () => {
  const files = { 'site/index.html': HTML, 'site/app.mjs': APP, 'site/core.mjs': CORE, 'site/features/narrative.mjs': NARRATIVE };
  const offenders = [];
  for (const [file, src] of Object.entries(files)) {
    src.split(/\r?\n/).forEach((line, i) => {
      if (/^\s*(\*|\/\/|<!--)/.test(line)) return;        // 注释里的说明不算
      if (/data:image\//.test(line)) return;              // 内联图标是同源的

      // V9 起页面必须带 OG / Twitter Card / canonical 元数据，
      // 这些 URL 是**给社交平台抓取器看的标识**，浏览器不会因为它发请求。
      // 所以先剥掉这些标签，再扫剩下的部分 —— 不是整行豁免
      // （同一行里其它位置若有外链，照样会被抓到）。
      const withoutMeta = line
        .replace(/<meta\s+[^>]*(?:og:|twitter:)[^>]*>/gi, '')
        .replace(/<link\s+rel\s*=\s*["']canonical["'][^>]*>/gi, '')
        .replace(/<meta\s+name\s*=\s*["'](?:description|color-scheme|viewport|theme-color)["'][^>]*>/gi, '');

      const m = withoutMeta.match(/https?:\/\/(?!127\.0\.0\.1|localhost)[a-z0-9.-]+/i);
      if (m) offenders.push(`${file}:${i + 1} ${m[0]}`);
    });
  }
  assert.deepEqual(offenders, [], `发现外部 URL：${offenders.join(' | ')}`);
});

test('UI 契约：样式表覆盖焦点可见、减少动效与打印三套降级', () => {
  assert.match(CSS, /:focus-visible/);
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(CSS, /@media print/);
  assert.match(CSS, /@media \(forced-colors: active\)/);
  assert.match(CSS, /@media \(prefers-contrast: more\)/);
});

/* ───────────────────────── 隐私与数据边界 ───────────────────────── */

test('UI 契约：导出负载只含白名单字段，不含 UA/设备/屏幕信息', () => {
  const tail = APP.slice(APP.indexOf('function exportJSON'));
  const body = tail.slice(0, tail.indexOf('function importJSON'));
  for (const key of ['app:', 'version:', 'exportedAt:', 'notice:', 'decision:']) {
    assert.ok(body.includes(key), `导出负载应包含 ${key}`);
  }
  for (const banned of ['navigator', 'userAgent', 'screen.', 'devicePixelRatio', 'language', 'platform']) {
    assert.ok(!body.includes(banned), `导出负载不得包含设备信息字段：${banned}`);
  }
});

test('UI 契约：分享摘要不得包含用户写的方案名称（D-01 回归）', () => {
  const start = APP.indexOf('function buildShareText');
  const end = APP.indexOf('function openShare');
  assert.ok(start > 0 && end > start, '应当能定位到 buildShareText');
  const fn = APP.slice(start, end);
  const leaks = findLines(fn, /options\[[01]\]\.label/);
  assert.deepEqual(leaks, [], `buildShareText 引用了方案名称：${JSON.stringify(leaks)}`);
});

/* ───────────────────────── 措辞与边界 ───────────────────────── */

test('UI 契约：全站不出现概率/胜率/推荐类表述，除非处于否定语境', () => {
  const banned = /概率|胜率|准确率|confidence|probability/;
  const negated = /不是|没有|不做|不说|不得|不算|别把|非/;
  const offenders = [];
  for (const [file, src] of Object.entries({ 'site/index.html': HTML, 'site/app.mjs': APP, 'site/core.mjs': CORE, 'site/features/narrative.mjs': NARRATIVE })) {
    src.split(/\r?\n/).forEach((line, i) => {
      if (/^\s*(\*|\/\/)/.test(line)) return;              // 注释里的元说明不算用户可见文案
      if (banned.test(line) && !negated.test(line)) offenders.push(`${file}:${i + 1} ${line.trim().slice(0, 80)}`);
    });
  }
  assert.deepEqual(offenders, [], `非否定语境的概率类表述：${offenders.join(' | ')}`);
});

test('UI 契约：越界临界点文案必须说"不会翻转"，不得混用"边界/没有翻盘空间"', () => {
  assert.ok(CORE.includes("code: 'OUT_OF_RANGE'"), 'core 必须保留 OUT_OF_RANGE 分支');
  // 精确切到 OUT_OF_RANGE 那个 return 对象，别把下面 BOUNDARY 的文案一起圈进来
  const at = CORE.indexOf("code: 'OUT_OF_RANGE'");
  const objStart = CORE.lastIndexOf('return {', at);
  const objEnd = CORE.indexOf('};', at);
  const outOfRange = CORE.slice(objStart, objEnd + 2);
  assert.ok(outOfRange.includes('结果不会翻转'), 'OUT_OF_RANGE 的解释必须包含"结果不会翻转"');
  assert.ok(!outOfRange.includes('没有真正的翻盘空间'), 'OUT_OF_RANGE 不得复用 BOUNDARY 的文案');
});

test('UI 契约：阈值卡必须自带"只调这一个因素、其余按原比例重分"的限定语（D-04 回归）', () => {
  const start = APP.indexOf('function flipDescription');
  const end = APP.indexOf('function buildThresholdList');
  assert.ok(start > 0 && end > start);
  const fn = APP.slice(start, end);
  assert.match(fn, /只调这一个|其余按原比例|其余因素按原来的比例/);
});

test('UI 契约：0 权重因素必须在结果区被解释（D-03 回归）', () => {
  assert.ok(
    /不参与本次计算|不参与计算|权重为 0，不参与/.test(APP) || /不参与本次计算|不参与计算/.test(HTML),
    '结果区应当出现"该因素不参与本次计算"之类的解释',
  );
});

test('UI 契约：无 JS 时必须有 noscript 兜底提示（D-05 回归）', () => {
  const noscript = HTML.match(/<noscript>([\s\S]*?)<\/noscript>/);
  assert.ok(noscript, 'index.html 必须有 <noscript> 块');
  assert.match(noscript[1], /JavaScript|脚本/, 'noscript 内容必须说明需要 JavaScript');
});

test('UI 契约：示例区标题必须与实际示例数量一致（D-06 回归）', () => {
  const heading = HTML.match(/id="examples-title">([^<]+)</);
  assert.ok(heading, '应当能取到示例区标题');
  const keys = [...NARRATIVE.matchAll(/^\s{4}key: '([^']+)'/gm)].length;
  const numeral = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }[heading[1].match(/[一二三四五六]/)?.[0]];
  assert.equal(numeral, keys, `标题说「${heading[1]}」，实际有 ${keys} 个示例`);
});

// D-07 已修复：.card-note 原先写"默认的六个"而实际只有 4 个因素。
// 注意这条曾经是 { todo: ... } —— todo 不会让测试变红，等于用绿灯盖住首屏可见的事实错误。
// 现在改成普通断言：文案再和真实默认数量不一致，CI 会直接红。
test('UI 契约：因素卡说明文案不得与默认因素数量矛盾（D-07）', () => {
  const note = HTML.match(/<p class="card-note">([^<]+)<\/p>/);
  assert.ok(note, '应当能取到因素卡说明');
  const claimed = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7 }[note[1].match(/默认的([一二三四五六七])个/)?.[1]];
  const defaults = (CORE.match(/id: 'f\d+', label: '[^']+', weight: 3, ratings: \{ A: 5, B: 5 \}/g) || []).length;
  assert.equal(claimed, defaults, `说明写「默认的${claimed}个」，createEmptyDecision 实际给 ${defaults} 个`);
});

// ─────────────────────────────────────────────────────────────
// D-02 回归守卫：非法评分输入不得让「显示值」与「计算值」背离
//
// 曾经的 bug：输入 11 时只设 aria-invalid 就 return，既不提示也不回滚。
// 结果是输入框里写着 11、实际按 1 计算（因为敲第一个 "1" 时已经提交过一次），
// 用户看到 11、拿到的是 1 的结果，中间零反馈。
//
// 这是「承诺一致性」缺陷的一个切面，所以不只是修，还要有断言守着：
// 一旦有人把 role="alert" 的提示或失焦回滚删掉，这条会立刻红。
// ─────────────────────────────────────────────────────────────
test('UI 契约：评分框非法输入必须可见报错并可回滚（D-02）', () => {
  const app = read('site/app.mjs');
  const css = read('site/styles/app.css');

  // 1) 必须有 role="alert" 的错误节点，且与控制台/错误文案绑定
  assert.match(app, /class:\s*'rating-error'[\s\S]{0,120}role:\s*'alert'/, '评分框必须有 role="alert" 的错误提示节点');
  assert.match(app, /评估|评分必须在 0 到 10 之间/, '必须有说明合法范围的文案');

  // 2) 非法分支必须同时做三件事：设 aria-invalid、设 aria-describedby、显示错误
  assert.match(app, /setAttribute\('aria-invalid',\s*'true'\)/, '非法输入必须设 aria-invalid');
  assert.match(app, /setAttribute\('aria-describedby'/, '非法输入必须用 aria-describedby 关联错误原因');
  assert.match(app, /showError\(/, '非法输入必须真的显示错误（不能只设属性就 return）');

  // 3) 失焦必须回滚到参与计算的真实值（这是"显示=计算"的最后一道保证）
  assert.match(app, /onblur[\s\S]{0,400}e\.target\.value\s*=\s*String\(factor\.ratings\[side\]\)/, '失焦必须把输入框回滚到真正参与计算的值');

  // 4) CSS 特异性：.stepper input[type="number"] 声明了 border，会压过 input[aria-invalid]
  //    必须存在与之一致或更高特异度的规则，否则红框永远不显示
  assert.match(
    css,
    /\.stepper input\[type="number"\]\[aria-invalid="true"\]/,
    '必须有与 .stepper input[type="number"] 同特异度的 aria-invalid 规则，否则红框不生效',
  );
});

// ─────────────────────────────────────────────────────────────
// A-7 回归守卫：「权重全部拉平」按钮必须真的接到 core.applyEqualWeights
//
// 曾经的问题：core.mjs 导出了 applyEqualWeights，但没有任何 UI 调用它，
// 用户想比较"如果我不偏心"只能手动调 4–6 个滑杆，既费事又不精确。
// 这条守的是"功能存在且被接线"，不是"按钮画出来"。
// ─────────────────────────────────────────────────────────────
test('UI 契约：权重拉平按钮必须接线并给出状态反馈（A-7）', () => {
  const html = read('site/index.html');
  const app = read('site/app.mjs');

  assert.match(html, /id="equal-weights"/, '页面上必须有「权重全部拉平」按钮');
  assert.match(html, /id="equal-weights-note"/, '必须有状态提示节点，告知用户权重已被改动');
  // 关键：必须有 click 处理器把 weight 设成同一个值（否则就是"画了个按钮但不干活"）
  assert.match(app, /#equal-weights[\s\S]{0,400}weight:\s*1/, '按钮必须真的把权重设为 1 并触发重算');
});
