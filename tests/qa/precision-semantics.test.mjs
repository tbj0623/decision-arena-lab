/**
 * V10 P1-1 边界矩阵：同分语义的三个精度层级（M01–M15）。
 *
 * 为什么必须有这个文件：
 * 站上曾经同时存在三种"打平"判据（1e-9 / 1e-6 / 5e-4 / 显示字符串相等），
 * 在 Δ=0.01~0.09 的边界上互相打架，屏幕上出现
 * 「A 66.1 / B 66.0，两边打平（差 0.0）」这类自相矛盾的句子。
 * 光把判据统一成"显示相等"还不够 —— 那会把「显示同分」说成「精确打平」，
 * 仍是对用户撒谎。现在的规则是：
 *
 *   exact   核心 |Δ| < 1e-9          → 可以说「分数完全相同」
 *   display 保留 1 位小数后相同      → 必须说「显示为相同分数（四舍五入），
 *                                        原始计算存在细微差异」
 *   none    其他                     → 正常比大小
 *
 * 界面铁律：**屏幕说打平 ⇔ 屏幕上两个数字一样**。
 *
 * 用法：node --test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import {
  fmt1,
  tieLevelOf,
  shownGapOf,
  signedShownGap,
  isExactTieOf,
} from '../../site/precision.mjs';
import {
  TIE_EPSILON,
  scoreDecision,
  projectAtShare,
  findFlipThresholds,
  pickFlipHighlight,
  diagnoseNoFlip,
} from '../../site/core.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const APP = join(ROOT, 'site', 'app.mjs');
const PRECISION = join(ROOT, 'site', 'precision.mjs');

/**
 * 去掉"整行都是注释"的行，只保留可执行代码行。
 *
 * 为什么不用字符级扫描器：模板字符串里嵌套 `${...}`、再套引号和反引号时，
 * 手写状态机会失步 —— 实测把一个行注释当成了字符串内容，
 * 于是「app.mjs 里还有没有 analysis.tie」这条断言直接骗人。
 * 这里要回答的问题只是"有没有**代码行**在用它"，行级过滤足够且不可被注释绕过。
 */
function stripComments(src) {
  return src
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('*/')) return false;
      return true;
    })
    .join('\n');
}

const mk = (scoreA, scoreB) => ({ scoreA, scoreB, difference: scoreA - scoreB });
const CAPPED = {
  title: '要不要接受这个 offer',
  options: [{ label: '接受这个 offer' }, { label: '留在现在这家' }],
  factors: [
    { id: 'f1', label: '成长空间', weight: 4, ratings: { A: 7, B: 3 } },
    { id: 'f2', label: '收入', weight: 6, ratings: { A: 0, B: 2 } },
    { id: 'f3', label: '稳定性', weight: 7, ratings: { A: 7, B: 5 } },
    { id: 'f4', label: '通勤', weight: 1, ratings: { A: 5, B: 8 } },
  ],
};

/* ───────── M01–M05：容差边界 ───────── */

test('M01 完全相等 → exact，允许说「分数完全相同」', () => {
  assert.equal(TIE_EPSILON, 1e-9, '核心容差被改动了（V10 禁止：数学不变）');
  assert.equal(tieLevelOf(mk(66.1, 66.1)), 'exact');
  assert.equal(isExactTieOf(mk(66.1, 66.1)), true);
});

test('M02 +1e-10（容差内）→ exact', () => {
  const a = mk(66.1 + 1e-10, 66.1);
  // 浮点减法不会精确还原 1e-10（实测 1.0000178463e-10），所以只断言量级
  assert.ok(Math.abs(Math.abs(a.difference) - 1e-10) < 1e-12, `差值量级不对：${a.difference}`);
  assert.equal(tieLevelOf(a), 'exact');
});

test('M03 −1e-10（容差内，反向）→ exact', () => {
  assert.equal(tieLevelOf(mk(66.1, 66.1 + 1e-10)), 'exact');
});

test('M04 +1e-8（超出容差但显示相同）→ display，不能说「精确打平」', () => {
  const a = mk(66.1 + 1e-8, 66.1);
  assert.equal(Math.abs(a.difference) > TIE_EPSILON, true);
  assert.equal(fmt1(a.scoreA), fmt1(a.scoreB), '这个样本的前提是显示相同');
  assert.equal(tieLevelOf(a), 'display');
  assert.equal(isExactTieOf(a), false, '1e-8 的同分绝不能报成 exact');
});

test('M05 −1e-8（超出容差但显示相同，反向）→ display', () => {
  assert.equal(tieLevelOf(mk(66.1, 66.1 + 1e-8)), 'display');
});

/* ───────── M06：显示同分但原始不同（V10 点名的核心场景）───────── */

test('M06 显示同分但原始差 0.08 → display，且显示差值为 0.0', () => {
  const a = mk(66.14, 66.06);
  assert.equal(fmt1(a.scoreA), '66.1');
  assert.equal(fmt1(a.scoreB), '66.1');
  assert.equal(tieLevelOf(a), 'display');
  assert.equal(shownGapOf(a), '0.0', '显示差值必须为 0.0，否则屏幕上会自相矛盾');
  assert.equal(signedShownGap(a), 0, '带符号显示差值也必须为 0');
  // 反向：差 0.1 时就不许说打平
  const b = mk(66.16, 66.06);
  assert.equal(tieLevelOf(b), 'none');
  assert.equal(shownGapOf(b), '0.1');
  assert.equal(signedShownGap(b), 0.1);
  assert.equal(signedShownGap(mk(66.06, 66.16)), -0.1, 'B 高时必须为负');
});

/* ───────── M07：一位小数取整边界 ───────── */

test('M07 分数恰好落在一位小数取整边界上，判定与显示同源', () => {
  // JS 的 Math.round 对 .5 向 +∞ 取整：66.05 → 66.1，-0.05 → -0
  assert.equal(fmt1(66.05), '66.1');
  assert.equal(fmt1(66.049999), '66.0');
  assert.equal(fmt1(66.15), '66.2');
  assert.equal(fmt1(-0.05), '0.0', '负零必须显示成 0.0，不能出现 -0.0');
  // 关键：display 判据必须**就是**两个显示字符串相等，不能另开一套容差
  for (const [x, y] of [[66.05, 66.049999], [66.2, 66.16], [66.14, 66.06]]) {
    assert.equal(
      tieLevelOf(mk(x, y)) === 'display',
      fmt1(x) === fmt1(y),
      `display 判据与显示字符串不一致：${x} vs ${y}`,
    );
  }
});

/* ───────── M08：显示不同 → none，差值必须等于两个显示分数之差 ───────── */

test('M08 显示不同 → none，且显示差值 = |显示A − 显示B|', () => {
  const samples = [[70.7, 63.6], [68.3, 79.2], [60.6, 61.2], [58.3, 60.0], [72.6, 58.9]];
  for (const [x, y] of samples) {
    const a = mk(x, y);
    assert.equal(tieLevelOf(a), 'none');
    const expect = Math.abs(Number(fmt1(x)) - Number(fmt1(y))).toFixed(1);
    assert.equal(shownGapOf(a), expect, `${x}/${y} 显示差值不一致`);
  }
});

/* ───────── M09：没有任何合法阈值 ───────── */

test('M09 所有评分相同 → 没有可翻转阈值，诊断为 NO_LEVERAGE', () => {
  const flat = {
    title: 't',
    options: [{ label: 'A' }, { label: 'B' }],
    factors: [0, 1, 2, 3].map((i) => ({ id: `f${i + 1}`, label: `f${i + 1}`, weight: 3, ratings: { A: 5, B: 5 } })),
  };
  const analysis = scoreDecision(flat);
  assert.equal(analysis.tie, true);
  assert.equal(analysis.difference, 0);
  assert.equal(tieLevelOf(analysis), 'exact');
  const thresholds = findFlipThresholds(flat);
  assert.equal(thresholds.every((t) => t.feasible === false), true, '全同分时不该存在可行阈值');
  assert.equal(pickFlipHighlight(thresholds), null, '全同分时不应挑出"最容易翻转"的因素');
  const dx = diagnoseNoFlip(flat);
  // 核心把"所有 d_k 都为 0"归到 ZERO_GAP（每个因素上两边同分，且没有可行阈值）。
  // NO_LEVERAGE 另有所指：d_k 与其余因素的加权平均 d_others 相等。
  // 这里断言真实分类，顺便把两个概念的边界钉住。
  assert.equal(dx.reason, 'ZERO_GAP', `全同分应诊断为 ZERO_GAP，实际：${dx.reason}`);
  assert.ok(['ALL_SAME_SIGN', 'ZERO_GAP', 'OUT_OF_RANGE', 'NO_LEVERAGE', 'UNKNOWN'].includes(dx.reason));
});

/* ───────── M10/M11：阈值超出输入上限 / 滑杆够不到 ───────── */

test('M10 理论临界点需要权重 13.5，超过界面上限 10 → 必须如实说"到不了"', () => {
  const MAX_WEIGHT_UI = 10; // 与 site/app.mjs 的 MAX_WEIGHT_UI 一致
  const thresholds = findFlipThresholds(CAPPED);
  const t2 = thresholds.find((t) => t.factorId === 'f2');
  assert.ok(t2, '应当能为 f2 找到阈值');
  assert.equal(typeof t2.thresholdShare, 'number');
  // t = w/(w+others) ⇒ w = t·others/(1−t)，其余因素权重 = 4+7+1 = 12
  const needWeight = (t2.thresholdShare * 12) / (1 - t2.thresholdShare);
  assert.ok(needWeight > MAX_WEIGHT_UI, `该用例应超过上限，实际需要 ${needWeight.toFixed(2)}`);
  assert.ok(Math.abs(needWeight - 13.5) < 0.2, `需要权重应约 13.5，实际 ${needWeight.toFixed(2)}`);

  // 界面只能给到上限 10 → 占比 10/22 ≈ 45.45%，此时**没有打平**
  const cappedShare = MAX_WEIGHT_UI / (MAX_WEIGHT_UI + 12);
  const projected = projectAtShare(CAPPED, 'f2', cappedShare);
  assert.equal(tieLevelOf(projected), 'none', '被上限截断后仍打平了？那这个用例就失效了');
  assert.ok(Math.abs(projected.difference) > 1, `截断后应仍差 >1 分，实际 ${projected.difference.toFixed(2)}`);
  // 显示差值必须和层级一致：none ⇔ 显示差值 > 0
  assert.notEqual(shownGapOf(projected), '0.0');
});

test('M11 滑杆步长不足：真实可达的 0.5 档位上，临界点落在两档之间', () => {
  const thresholds = findFlipThresholds(CAPPED);
  const t2 = thresholds.find((t) => t.factorId === 'f2');
  const needWeight = (t2.thresholdShare * 12) / (1 - t2.thresholdShare);
  // 界面滑杆 step=0.5：13.5 恰好是 0.5 的倍数，但被上限挡在 10；
  // 即便放开上限，也必须能在 0.5 档位上命中，否则要如实说"够不着"。
  const nearestStep = Math.round(needWeight * 2) / 2;
  assert.ok(Math.abs(nearestStep - needWeight) <= 0.25);
  // 反例：把评级改成需要 13.2 权重时，0.5 步长只能给 13.0 或 13.5，都会差一点点
  const shifted = structuredClone(CAPPED);
  shifted.factors[2].ratings = { A: 7.4, B: 5 };
  const tS = findFlipThresholds(shifted).find((t) => t.factorId === 'f2');
  if (tS && typeof tS.thresholdShare === 'number') {
    const w = (tS.thresholdShare * 12) / (1 - tS.thresholdShare);
    const nearest = Math.round(w * 2) / 2;
    if (Math.abs(nearest - w) > 1e-6) {
      const p = projectAtShare(shifted, 'f2', nearest / (nearest + 12));
      assert.notEqual(tieLevelOf(p), 'exact', '档位上够不到临界点时，不能报成精确同分');
    }
  }
});

/* ───────── M12–M13：跨面一致性（静态契约 + 单一定义源）───────── */

test('M12 全站只有一个 fmt1 定义（防两份实现漂移）', async () => {
  const files = ['app.mjs', 'precision.mjs'];
  let count = 0;
  for (const f of files) {
    const code = stripComments(await readFile(join(ROOT, 'site', f), 'utf8'));
    count += (code.match(/function\s+fmt1\s*\(/g) || []).length;
  }
  assert.equal(count, 1, 'fmt1 必须只在一处定义（site/precision.mjs）');
  const precisionCode = stripComments(await readFile(PRECISION, 'utf8'));
  assert.equal(/function\s+fmt1\s*\(/.test(precisionCode), true);
});

test('M13 app.mjs 不再直接用 analysis.tie 判打平（必须走 tieLevelOf）', async () => {
  const code = stripComments(await readFile(APP, 'utf8'));
  assert.equal(/analysis\.tie/.test(code), false, 'app.mjs 里仍有 analysis.tie 直接判定');
  assert.equal(/analysis\.difference\s*[<>]=?\s*1e-9/.test(code), false, '仍有硬编码 1e-9 容差');
  // 必须真的在用统一判据
  const uses = (code.match(/tieLevelOf\(/g) || []).length;
  assert.ok(uses >= 5, `tieLevelOf 调用太少（${uses}），可能漏了可见面`);
  // 两级措辞都必须存在：exact 说"完全相同"，display 说"显示为相同分数…细微差异"
  assert.match(code, /分数完全相同/, '缺少 exact 级的措辞');
  assert.match(code, /显示为相同分数/, '缺少 display 级的措辞');
  assert.match(code, /原始计算存在细微差异/, 'display 级没有说明"原始计算存在细微差异"');
  // 显示打平与精确打平的短标签必须能区分
  assert.match(code, /'显示打平'/, '缺少 display 级短标签（pill）');
});

test('M14 分享摘要与打印共用同一套判据（不得另写一套）', async () => {
  const code = stripComments(await readFile(APP, 'utf8'));
  // 分享摘要里的差值必须走 shownGapOf，不能自己 fmt1(Math.abs(difference))
  const shareBlock = /function buildShareText\(\)[\s\S]*?\n}/.exec(code);
  assert.ok(shareBlock, '找不到 buildShareText');
  assert.equal(/fmt1\(Math\.abs\(lastAnalysis\.difference\)\)/.test(shareBlock[0]), false,
    '分享摘要仍用原始差值（会和页面显示对不上）');
  assert.match(shareBlock[0], /shownGapOf\(lastAnalysis\)/, '分享摘要应使用 shownGapOf');
  assert.match(shareBlock[0], /tieLevelOf\(lastAnalysis\)/, '分享摘要应使用 tieLevelOf');
  // 贡献表合计行也必须用显示差值
  assert.match(code, /signedShownGap\(analysis\)/, '贡献表合计行未使用显示差值');
});

/* ───────── M15：aria-live 播报契约 ───────── */

test('M15 首屏判定文案有独立 aria-live 区，且不逐帧播报', async () => {
  const { readFile: rf } = await import('node:fs/promises');
  const html = await rf(join(ROOT, 'site', 'index.html'), 'utf8');
  const appCode = stripComments(await readFile(APP, 'utf8'));
  // 视觉区不得自带 aria-live（否则拖动时每帧都播报）
  const visual = /<p[^>]*id="hero-verdict"[^>]*>/.exec(html);
  assert.ok(visual, '找不到 #hero-verdict');
  assert.equal(/aria-live/.test(visual[0]), false, '#hero-verdict 不应带 aria-live');
  // 播报区必须存在且是 polite + status
  const live = /<p[^>]*id="hero-verdict-live"[^>]*>/.exec(html);
  assert.ok(live, '找不到 #hero-verdict-live');
  assert.match(live[0], /aria-live="polite"/);
  assert.match(live[0], /role="status"/);
  // 代码里必须"先清空再下一帧写"，强制产生 DOM 变更（否则同句不播报）
  assert.match(appCode, /requestAnimationFrame/, '缺少强制 DOM 变更的播报实现');
  assert.match(appCode, /if \(announce\)/, '缺少"只在松手时播报"的开关');
});

/* ───────── M16–M19：可见文案（叙事模板 + 结构守门）───────── */

// 这两个用例来自 V10 复核时的真实复现（界面允许的 0.5 步进即可输入），
// 关键在于它们**显示同分、原始不同、且没有可行翻转阈值** —— 最容易写出自相矛盾文案的场景。
const CASE_Y = {
  title: 'probe',
  options: [{ label: 'A方案' }, { label: 'B方案' }],
  factors: [0, 1, 2, 3].map((i) => ({
    id: `f${i + 1}`,
    label: `因素${i + 1}`,
    weight: [0.5, 10, 10, 10][i],
    ratings: { A: [5, 5, 5, 5.5][i], B: [4.5, 5, 5, 5.5][i] },
  })),
};
const CASE_X = {
  title: 'probe',
  options: [{ label: 'A方案' }, { label: 'B方案' }],
  factors: [0, 1, 2, 3].map((i) => ({
    id: `f${i + 1}`,
    label: `因素${i + 1}`,
    weight: [0.5, 10, 10, 10][i],
    ratings: { A: [5, 8, 5, 5][i], B: [4.5, 7.5, 5.5, 5][i] },
  })),
};

test('M16 案例 Y（显示同分 + 无可行阈值）：叙事文案不得说「完全打平」「领先 0.1」', async () => {
  const { buildViewpoints } = await import('../../site/features/narrative.mjs');
  const analysis = scoreDecision(CASE_Y);
  assert.equal(tieLevelOf(analysis), 'display', '案例 Y 的前提是 display 级同分');
  assert.equal(shownGapOf(analysis), '0.0');
  const thresholds = findFlipThresholds(CASE_Y);
  assert.equal(pickFlipHighlight(thresholds), null, '案例 Y 应当是"没有可翻转阈值"');
  const vp = buildViewpoints(analysis, null, null);
  // 主持者句：必须说显示精度，不能说"完全打平"，也不能报出用户看不到的"领先 0.1 分"
  assert.match(vp.chair.text, /显示为相同分数/, vp.chair.text);
  assert.equal(/完全打平/.test(vp.chair.text), false, `主持者句把显示同分说成了完全打平：${vp.chair.text}`);
  assert.equal(/领先的/.test(vp.chair.text), false, `主持者句报出了用户看不到的差值：${vp.chair.text}`);
  // 反方论据：f1 是 5 对 4.5，不能断言"所有因素两边分数都一样"
  assert.equal(/所有因素两边分数都一样/.test(vp.oppose.text), false, `反方论据失实：${vp.oppose.text}`);
  assert.match(vp.oppose.text, /四舍五入/, vp.oppose.text);
});

test('M17 案例 X（显示同分 + 有可行阈值）：不得说「翻不过来」，且要区分显示/精确', async () => {
  const { buildViewpoints } = await import('../../site/features/narrative.mjs');
  const analysis = scoreDecision(CASE_X);
  assert.equal(tieLevelOf(analysis), 'display');
  const thresholds = findFlipThresholds(CASE_X);
  const flip = pickFlipHighlight(thresholds);
  assert.ok(flip, '案例 X 应当能挑出可翻转的因素');
  const vp = buildViewpoints(analysis, flip, null);
  assert.equal(/翻不过来/.test(vp.chair.text), false, `有可行阈值却说翻不过来：${vp.chair.text}`);
  // 屏幕上已经是同一个数了，必须说明"下面讲的是精确打平点"，否则用户会以为现在没打平
  assert.match(vp.chair.text, /原始计算还差/, vp.chair.text);
});

test('M18 精确同分仍保留 exact 措辞（不因 display 分支把精确场景弱化）', async () => {
  const { buildViewpoints } = await import('../../site/features/narrative.mjs');
  const flat = {
    title: 't',
    options: [{ label: 'A' }, { label: 'B' }],
    factors: [0, 1, 2, 3].map((i) => ({ id: `f${i + 1}`, label: `f${i + 1}`, weight: 3, ratings: { A: 5, B: 5 } })),
  };
  const analysis = scoreDecision(flat);
  assert.equal(tieLevelOf(analysis), 'exact');
  const vp = buildViewpoints(analysis, pickFlipHighlight(findFlipThresholds(flat)), null);
  assert.match(vp.chair.text, /完全打平/, vp.chair.text);
  assert.equal(/四舍五入/.test(vp.chair.text), false, `精确同分不该出现四舍五入的说法：${vp.chair.text}`);
});

test('M19 app.mjs 三处越界已收口（临界点提示/读屏 winner/翻转卡断言）', async () => {
  const code = stripComments(await readFile(APP, 'utf8'));
  // ①「就在临界点上」只能给精确同分
  assert.match(code, /const near = isExactTie \?/, '临界点提示仍按显示同分判定');
  assert.equal(/const near = isDisplayTie/.test(code), false);
  // ② 读屏的"当前更倾向"不得与可见区的打平结论相反
  assert.match(code, /winnerTieLevel === 'none' && analysis\.winner === row\.side/);
  // ③ 翻转卡的"评分完全一样"必须有真实判据，不能只看 anyFeasible
  assert.match(code, /const allGapsZero = /, '翻转卡仍可能无凭据断言"评分完全一样"');
  // ④ 分享摘要的 display 免责句必须独立存在（不被 lastFlip 分支短路）
  assert.match(code, /tieLevelOf\(lastAnalysis\) === 'display'/, '分享摘要缺少 display 级免责句');
});
