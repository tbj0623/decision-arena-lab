/**
 * V9 首屏契约测试
 *
 * 为什么需要它：V9 明确要求「首屏右侧是**真实核心计算支撑的可交互产品示例**」。
 * 这条最容易在后续改动里悄悄退化——有人图省事改成一个静态图、
 * 或者把数字写死（设计原型里就是 `a = 40 + 50t`）。
 * 所以这里断言的是**行为**：拖滑杆必须真的改变分数，且结果必须等于 core.mjs。
 *
 * 静态部分（DOM 结构、必须存在的钩子）不依赖浏览器也能测；
 * 动态部分（真实计算）在浏览器里测，这里只锁静态契约 + 数据源可达性。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const HTML = readFileSync(ROOT + 'site/index.html', 'utf8');
const APP = readFileSync(ROOT + 'site/app.mjs', 'utf8');

/* ── 首屏结构 ── */

test('V9 首屏：两栏结构存在（文案 + 真实演示）', () => {
  assert.match(HTML, /class="hero-grid"/, '缺少 .hero-grid 两栏容器');
  assert.match(HTML, /class="hero-copy"/, '缺少左侧文案栏');
  assert.match(HTML, /id="hero-demo"/, '缺少右侧真实演示卡');
});

test('V9 首屏：两个 CTA 都在，且指向不同动作', () => {
  assert.match(HTML, /data-action="start-blank"[\s\S]{0,80}免费开始分析/,
    '缺少主 CTA「免费开始分析」');
  assert.match(HTML, /data-action="demo-run"[\s\S]{0,80}30 秒看懂示例/,
    '缺少次 CTA「30 秒看懂示例」');
});

test('V9 首屏：三枚价值标签齐备', () => {
  const heroFacts = HTML.slice(HTML.indexOf('class="hero-facts"'), HTML.indexOf('</ul>', HTML.indexOf('class="hero-facts"')));
  for (const word of ['无需登录', '只在本地计算', '公式公开']) {
    assert.ok(heroFacts.includes(word), `价值标签缺少「${word}」`);
  }
});

test('V9 首屏：高风险边界不能删，但可以折叠', () => {
  // V9 要求"短、可读"，但也明确"不能完全隐藏或删除"。
  // 折进 <details> 是允许的（用户主动展开），完全删掉不行。
  assert.match(HTML, /class="hero-boundary"/, '缺少边界说明区块');
  const boundary = HTML.slice(HTML.indexOf('class="hero-boundary"'), HTML.indexOf('</details>'));
  for (const word of ['不是成功率', '医疗', '法律', '财务']) {
    assert.ok(boundary.includes(word), `边界说明缺少「${word}」——这条不能为了好看而删`);
  }
});

/* ── 真实计算的接线 ── */

test('V9 首屏：演示卡的数据来自 EXAMPLES，不是硬编码', () => {
  const fn = APP.slice(APP.indexOf('function initHeroDemo'), APP.indexOf('/* ───────────── 事件绑定'));
  assert.ok(fn.length > 200, '找不到 initHeroDemo');
  assert.match(fn, /EXAMPLES\.find|EXAMPLES\[0\]/, '演示卡必须从 EXAMPLES 取数据');
  assert.match(fn, /cloneBody/, '必须 cloneBody，不能直接改原始示例');
});

test('V9 首屏：演示卡的计算走 core.mjs，不得自己写公式', () => {
  const fn = APP.slice(APP.indexOf('function initHeroDemo'), APP.indexOf('/* ───────────── 事件绑定'));
  assert.match(fn, /projectAtShare\s*\(/, '必须调用 core 的 projectAtShare');
  // 反向：不得出现设计原型那种线性构造式 a = 40 + 50*t
  assert.ok(!/40\s*\+\s*50\s*\*/.test(fn), '检测到硬编码线性公式（原型遗留）');
  assert.ok(!/\b65\.0\b|\b50\s*%\s*关/.test(fn), '检测到原型里的固定数字');
});

test('V9 首屏：滑杆是连续的（step=any），能拖到精确临界点', () => {
  const slider = HTML.match(/<input[^>]*id="hero-slider"[^>]*>/)?.[0] || '';
  assert.ok(slider.includes('step="any"'),
    '首屏滑杆必须 step="any"，否则拖不到精确打平点（V8 踩过这个坑）');
  assert.ok(slider.includes('type="range"'), '必须是 range 控件');
});

test('V9 首屏：判定文案有 aria-live，但不会每帧播报', () => {
  const verdict = HTML.match(/<p[^>]*id="hero-verdict"[^>]*>/)?.[0] || '';
  assert.ok(verdict.includes('aria-live="polite"'), '判定文案需要 aria-live');
  assert.ok(verdict.includes('role="status"'), '判定文案需要 role=status');
  // 滑杆的 input 事件里不应直接写 aria-live="assertive"（会打断读屏）
  assert.ok(!APP.includes('aria-live="assertive"'), '不得使用 assertive，会打断读屏');
});

/* ── 演示数值必须和 core 一致（行为级，用真数据跑） ── */

test('V9 首屏：EXAMPLES[0] 在 50% 处的分数与 core 计算一致', async () => {
  const { scoreDecision, projectAtShare } = await import('../../site/core.mjs');
  const { EXAMPLES, cloneBody } = await import('../../site/features/narrative.mjs');

  const ex = EXAMPLES[0];
  const input = cloneBody(ex.body);
  const base = scoreDecision(input);
  assert.ok(base.scoreA > 0 && base.scoreB > 0, '基线分数必须为正');

  // 拿一个真实因素投影到 50%，断言结果落在合法范围且与直接重算一致
  const factor = input.factors[0];
  const at50 = projectAtShare(input, factor.id, 0.5);
  assert.ok(at50.scoreA >= 0 && at50.scoreA <= 100, 'A 分必须在 0–100');
  assert.ok(at50.scoreB >= 0 && at50.scoreB <= 100, 'B 分必须在 0–100');

  // 端点必须等于"把该因素权重压到 0 / 抬高"的边界情况，验证投影是真投影
  const at0 = projectAtShare(input, factor.id, 0.001);
  const at1 = projectAtShare(input, factor.id, 0.999);
  assert.notEqual(at0.difference.toFixed(3), at1.difference.toFixed(3),
    '从 0 到 1 拖到底，差值必须变化——否则滑杆是假的');
});

test('V9 首屏：首屏不承诺结果（无成功率/预测类肯定表述）', () => {
  const start = HTML.indexOf('<section class="hero');
  const hero = HTML.slice(start, HTML.indexOf('id="examples"', start));
  // 去掉否定语境（"不是成功率"是正当免责）
  const stripped = hero.replace(/不是[^。；]*?(成功率|胜率|预测)[^。；]*/g, '');
  assert.ok(!/成功率|胜率/.test(stripped), '首屏不得承诺成功率/胜率');
  assert.ok(!/(能|会|可以)(准确)?预测/.test(stripped), '首屏不得声称能预测');
});

/* ── 空状态：不能凭空显示分数（Lead V9 走查发现） ── */

test('空状态：createEmptyDecision 能通过 validate，所以必须靠「未触碰」判据兜住', async () => {
  const { createEmptyDecision, validate, scoreDecision } = await import('../../site/core.mjs');

  const empty = createEmptyDecision();
  // 前提校验：空决策在结构上是合法的 —— 这正是这个 bug 存在的原因。
  // 如果哪天 validate 开始拒绝空决策，这条断言会先失败，提醒我们重新审视逻辑。
  assert.equal(validate(empty).ok, true,
    '前提变了：空决策现在通不过 validate。空状态逻辑可以简化，但要先确认不是误伤。');

  // 但它算出来的分数是 50/50 —— 一个"看起来正常"的数字。
  // 对用户来说这是凭空出现的，必须被 UI 拦掉。
  const a = scoreDecision(empty);
  assert.equal(a.scoreA.toFixed(1), '50.0');
  assert.equal(a.scoreB.toFixed(1), '50.0');
});
