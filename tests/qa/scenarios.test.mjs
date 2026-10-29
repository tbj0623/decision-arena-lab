/**
 * 端到端场景回归（无浏览器依赖，直接跑 DOM 无关的逻辑层）
 *
 * 目的：把 product-owner 的 5 条用户旅程 + 边界场景固化成可重复执行的断言，
 * 覆盖"输入 → 校验 → 得分 → 阈值 → 验证假设"这条完整链路，
 * 并额外检查 UI 层依赖的取整一致性规则。
 *
 * 用法：node tests/qa/scenarios.test.mjs
 * 或用 node:test 跑：node --test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  scoreDecision,
  findFlipThresholds,
  pickFlipHighlight,
  chooseValidationHypothesis,
  projectAtShare,
  validate,
  applyEqualWeights,
  ValidationError,
} from '../../site/core.mjs';

/** 构造标准输入 */
function mk(title, opts, factors) {
  return {
    title,
    options: [
      { id: 'A', label: opts[0] },
      { id: 'B', label: opts[1] },
    ],
    factors: factors.map(([id, label, weight, a, b]) => ({
      id, label, weight, ratings: { A: a, B: b },
    })),
  };
}

/* ═══════════════ 场景 1：先观摩（J1 创业公司 offer） ═══════════════ */

const J1 = mk('要不要接 offer', ['去创业公司', '留在现公司'], [
  ['f1', '成长速度', 5, 9, 5],
  ['f2', '收入确定性', 4, 4, 8],
  ['f3', '通勤与作息', 2, 7, 7],
  ['f4', '团队与直属上级', 3, 8, 6],
]);

test('场景1 J1：分数、差值、胜方与 USER_JOURNEYS 一致', () => {
  const s = scoreDecision(J1);
  assert.ok(Math.abs(s.scoreA - 70.71428571428571) < 1e-9, `A 应为 70.714…，实际 ${s.scoreA}`);
  assert.ok(Math.abs(s.scoreB - 63.57142857142857) < 1e-9, `B 应为 63.571…，实际 ${s.scoreB}`);
  assert.equal(s.winner, 'A');
  assert.equal(s.closeness, 'close');
  assert.ok(Math.abs(s.difference - 7.142857142857139) < 1e-9);
  // 显示值
  assert.equal(s.scoreA.toFixed(1), '70.7');
  assert.equal(s.scoreB.toFixed(1), '63.6');
  assert.equal(s.difference.toFixed(1), '7.1');
});

test('场景1 J1：同分因素贡献恒为 0，且没有被当成可行反转点', () => {
  const s = scoreDecision(J1);
  const commute = s.contributions.find((c) => c.factorId === 'f3');
  assert.equal(commute.ratingGap, 0);
  assert.equal(commute.delta, 0, 'A=B 时贡献必须恒为 0');

  const th = findFlipThresholds(J1).find((t) => t.factorId === 'f3');
  assert.equal(th.feasible, false, '同分因素不得被当作可行反转点');
});

test('场景1 J1：高亮反转点是收入确定性，且把权重调到 t* 真的打平', () => {
  const th = findFlipThresholds(J1);
  const flip = pickFlipHighlight(th);
  assert.ok(flip, 'J1 应该有可行反转点');
  assert.equal(flip.factorId, 'f2', `高亮应是收入确定性(f2)，实际 ${flip.factorId}`);
  assert.equal(flip.direction, 'increase');
  assert.ok(Math.abs(flip.thresholdShare - 0.393939393939394) < 1e-9);

  const at = projectAtShare(J1, 'f2', flip.thresholdShare);
  assert.ok(Math.abs(at.difference) < 1e-6, `t* 处应打平，实际差 ${at.difference}`);

  // 两侧符号必须相反 —— 这才叫"翻转"
  const below = projectAtShare(J1, 'f2', flip.thresholdShare - 0.02);
  const above = projectAtShare(J1, 'f2', flip.thresholdShare + 0.02);
  assert.ok(below.difference > 0, 't* 以下应仍偏向 A');
  assert.ok(above.difference < 0, 't* 以上应翻向 B');
});

/* ═══════════════ 场景 2：0 权重因素（J2 笔记本） ═══════════════ */

const J2 = mk('买哪台笔记本', ['很轻的那台', '键盘更好的那台'], [
  ['f1', '便携重量', 4, 9, 7],
  ['f2', '键盘手感', 3, 6, 9],
  ['f3', '软件兼容', 3, 6, 8],
  ['f4', '续航', 0, 10, 4],
  ['f5', '价格', 2, 5, 8],
]);

test('场景2 J2：0 权重因素不影响分数，也不报错', () => {
  const s = scoreDecision(J2);
  assert.equal(s.scoreA.toFixed(1), '68.3');
  assert.equal(s.scoreB.toFixed(1), '79.2');
  assert.equal(s.difference.toFixed(1), '-10.8');
  assert.equal(s.winner, 'B');

  const battery = s.contributions.find((c) => c.factorId === 'f4');
  assert.equal(battery.share, 0);
  assert.equal(battery.delta, 0, '0 权重因素贡献必须是 0');
});

test('场景2 J2：改动 0 权重因素的评分，总分一位小数都不变', () => {
  const before = scoreDecision(J2);
  const mutated = JSON.parse(JSON.stringify(J2));
  mutated.factors[3].ratings = { A: 10, B: 0 };
  const after = scoreDecision(mutated);
  assert.equal(after.scoreA.toFixed(1), before.scoreA.toFixed(1));
  assert.equal(after.scoreB.toFixed(1), before.scoreB.toFixed(1));
});

test('场景2 J2：验证假设不能因为 0 权重因素评分差大就选中它', () => {
  const s = scoreDecision(J2);
  const hyp = chooseValidationHypothesis(J2, s);
  assert.equal(hyp.factorId, 'f2', `应选键盘手感(f2)，实际 ${hyp.factorId}（续航评分差 6 但权重 0）`);
});

/* ═══════════════ 场景 3：极小差值（J3 租房） ═══════════════ */

const J3 = mk('租房', ['市区小两居', '郊区大三居'], [
  ['f1', '通勤时间', 6, 9, 3],
  ['f2', '居住面积', 4, 4, 9],
  ['f3', '每月租金', 5, 3, 8],
  ['f4', '周边配套', 2, 9, 5],
]);

test('场景3 J3：0.6 分差距判为「非常接近」而不是「持平」', () => {
  const s = scoreDecision(J3);
  assert.equal(s.scoreA.toFixed(1), '60.6');
  assert.equal(s.scoreB.toFixed(1), '61.2');
  assert.equal(s.difference.toFixed(1), '-0.6');
  assert.equal(s.winner, 'B');
  assert.equal(s.closeness, 'very-close');
  assert.equal(s.tie, false, '0.6 的差不是平局，平局只在 |diff| < 1e-9');
});

test('场景3 J3：四个因素全部有可行反转点，且都离当前很近', () => {
  const th = findFlipThresholds(J3);
  const feasible = th.filter((t) => t.feasible);
  assert.equal(feasible.length, 4, `应有 4 个可行反转点，实际 ${feasible.length}`);
  for (const t of feasible) {
    assert.ok(t.distance < 0.02, `${t.label} 的距离应 < 2pp，实际 ${(t.distance * 100).toFixed(2)}pp`);
  }
  const flip = pickFlipHighlight(th);
  assert.equal(flip.factorId, 'f1', '高亮应是通勤时间（距离最近）');
});

/* ═══════════════ 场景 4：不会反转（J5 部分 + 同向） ═══════════════ */

test('场景4：各因素同向支持 A 时，明确报告"翻不过来"', () => {
  const sameDir = mk('同向', ['A 方案', 'B 方案'], [
    ['f1', '甲', 3, 9, 2],
    ['f2', '乙', 3, 8, 3],
    ['f3', '丙', 2, 7, 4],
    ['f4', '丁', 2, 6, 5],
  ]);
  const s = scoreDecision(sameDir);
  assert.equal(s.winner, 'A');

  const th = findFlipThresholds(sameDir);
  const feasible = th.filter((t) => t.feasible);
  assert.equal(feasible.length, 0, '同向时不应有可行反转点');
  assert.equal(pickFlipHighlight(th), null, '不应高亮任何反转点');

  // 每个因素都必须有可读的解释，而不是 null / undefined
  for (const t of th) {
    assert.equal(typeof t.explanation, 'string');
    assert.ok(t.explanation.length > 0, `${t.label} 必须有解释文案`);
    assert.ok(['OUT_OF_RANGE', 'NO_LEVERAGE', 'BOUNDARY', 'SOLE_FACTOR', 'NOT_COMPUTABLE'].includes(t.code),
      `不可行因素应有明确 code，实际 ${t.code}`);
  }
});

test('场景4：J5 越界阈值显示为 OUT_OF_RANGE 而非 BOUNDARY', () => {
  const J5 = mk('健身', ['年卡', '居家'], [
    ['f1', '训练动作丰富度', 4, 9, 4],
    ['f2', '年花费', 3, 4, 9],
    ['f3', '坚持难度', 3, 7, 3],
    ['f4', '通勤到馆时间', 2, 5, 6],
  ]);
  const th = findFlipThresholds(J5).find((t) => t.factorId === 'f3');
  assert.equal(th.feasible, false);
  assert.equal(th.code, 'OUT_OF_RANGE', `坚持难度 t* 为负，必须是 OUT_OF_RANGE，实际 ${th.code}`);
  assert.ok(th.thresholdShare < 0, `t* 应为负数，实际 ${th.thresholdShare}`);
});

/* ═══════════════ 场景 5：极端与非法输入 ═══════════════ */

test('场景5：全零权重阻断，且不静默返回结论', () => {
  const zero = JSON.parse(JSON.stringify(J1));
  zero.factors.forEach((f) => { f.weight = 0; });
  assert.throws(() => scoreDecision(zero), (e) => e instanceof ValidationError && e.code === 'ALL_ZERO_WEIGHTS');

  const check = validate(zero);
  assert.equal(check.ok, false);
  assert.equal(check.code, 'ALL_ZERO_WEIGHTS');
});

test('场景5：applyEqualWeights 能把全零权重救回来，且不改入参', () => {
  const zero = JSON.parse(JSON.stringify(J1));
  zero.factors.forEach((f) => { f.weight = 0; });
  const snapshot = JSON.stringify(zero);

  const fixed = applyEqualWeights(zero);
  assert.equal(JSON.stringify(zero), snapshot, '不得修改入参');
  assert.equal(validate(fixed).ok, true, '等权修复后应可计算');
  const s = scoreDecision(fixed);
  assert.ok(Number.isFinite(s.scoreA) && Number.isFinite(s.scoreB));
});

test('场景5：超长文本被拒绝，不进入计算', () => {
  const long = JSON.parse(JSON.stringify(J1));
  long.options[0].label = '啊'.repeat(200);
  assert.throws(() => scoreDecision(long), (e) => e.code === 'INVALID_OPTION_LABEL');

  const longFactor = JSON.parse(JSON.stringify(J1));
  longFactor.factors[0].label = 'x'.repeat(200);
  assert.throws(() => scoreDecision(longFactor), (e) => e.code === 'INVALID_FACTOR_LABEL');
});

test('场景5：所有非法输入都抛带 code 的 ValidationError，不抛裸 Error', () => {
  const cases = [
    ['负权重', (d) => { d.factors[0].weight = -1; }, 'NEGATIVE_WEIGHT'],
    ['NaN 权重', (d) => { d.factors[0].weight = NaN; }, 'INVALID_WEIGHT'],
    ['Infinity 评分', (d) => { d.factors[0].ratings.A = Infinity; }, 'INVALID_RATING'],
    ['评分 11', (d) => { d.factors[0].ratings.A = 11; }, 'RATING_OUT_OF_RANGE'],
    ['评分 -1', (d) => { d.factors[0].ratings.B = -1; }, 'RATING_OUT_OF_RANGE'],
    ['只有 3 个因素', (d) => { d.factors = d.factors.slice(0, 3); }, 'FACTOR_COUNT'],
    ['两个选项同名', (d) => { d.options[1].label = d.options[0].label; }, 'DUPLICATE_OPTION_LABEL'],
    ['空因素名', (d) => { d.factors[0].label = '   '; }, 'INVALID_FACTOR_LABEL'],
    ['只有 1 个选项', (d) => { d.options = [d.options[0]]; }, 'INVALID_OPTIONS'],
  ];
  for (const [name, mutate, expected] of cases) {
    const d = JSON.parse(JSON.stringify(J1));
    mutate(d);
    assert.throws(
      () => scoreDecision(d),
      (e) => {
        assert.ok(e instanceof ValidationError, `${name} 应抛 ValidationError，实际 ${e.constructor.name}`);
        assert.equal(e.code, expected, `${name} 的 code 应为 ${expected}，实际 ${e.code}`);
        return true;
      },
    );
  }
});

/* ═══════════════ 取整一致性（UI 层规则） ═══════════════ */

test('取整一致性：按"误差最小项挪 0.1"分配的贡献值加总必须等于显示差值', () => {
  // 这是 app.mjs 里 round1SummingTo 的独立复刻，用于回归该规则本身
  function round1SummingTo(values, target) {
    const r1 = (x) => Math.round(x * 10) / 10;
    const target1 = r1(target);
    const out = values.map(r1);
    let steps = Math.round((target1 - out.reduce((a, b) => a + b, 0)) * 10);
    let guard = 0;
    while (steps !== 0 && guard < values.length * 4) {
      guard += 1;
      const dir = steps > 0 ? 1 : -1;
      let bestIdx = -1;
      let bestCost = Infinity;
      for (let i = 0; i < values.length; i += 1) {
        const currentErr = Math.abs(out[i] - values[i]);
        const nextErr = Math.abs(out[i] + dir * 0.1 - values[i]);
        const cost = nextErr - currentErr;
        if (cost < bestCost - 1e-12) { bestCost = cost; bestIdx = i; }
      }
      if (bestIdx < 0) break;
      out[bestIdx] = Math.round((out[bestIdx] + dir * 0.1) * 10) / 10;
      steps -= dir;
    }
    return out;
  }

  // J1 就是会失败的经典例子
  const s = scoreDecision(J1);
  const shown = round1SummingTo(s.contributions.map((c) => c.delta), s.difference);
  const sum = shown.reduce((a, b) => a + b, 0);
  assert.ok(
    Math.abs(Math.round(sum * 10) / 10 - Number(s.difference.toFixed(1))) < 1e-9,
    `贡献加总 ${sum.toFixed(1)} 应等于显示差值 ${s.difference.toFixed(1)}`,
  );

  // 每项偏移不得超过 0.1
  s.contributions.forEach((c, i) => {
    assert.ok(Math.abs(shown[i] - c.delta) < 0.1 + 1e-9, `第 ${i} 项偏移过大`);
  });

  // 随机压力：500 组
  let seed = 987654321;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let k = 0; k < 500; k += 1) {
    const n = 4 + Math.floor(rnd() * 3);
    const vals = Array.from({ length: n }, () => rnd() * 200 - 100);
    const target = vals.reduce((a, b) => a + b, 0);
    const out = round1SummingTo(vals, target);
    const outSum = Math.round(out.reduce((a, b) => a + b, 0) * 10) / 10;
    assert.equal(outSum, Math.round(target * 10) / 10, `第 ${k} 组随机数据加总失配`);
  }
});

/* ═══════════════ 产品定位守卫 ═══════════════ */

test('定位守卫：所有示例的文案里不得出现概率/预测类词汇', () => {
  const forbidden = ['成功率', '胜率', '概率', '预测未来', '保证', '一定能', '最优解'];
  // 只检查"会显示给用户的结果对象"里的动态文案，静态文案由静态审计负责
  const s = scoreDecision(J1);
  const hyp = chooseValidationHypothesis(J1, s);
  const dynamicText = [s.title, ...s.options.map((o) => o.label), hyp.question, ...hyp.steps, hyp.caveat].join(' ');
  for (const word of forbidden) {
    assert.ok(!dynamicText.includes(word), `结果文案不应包含「${word}」：${dynamicText.slice(0, 100)}`);
  }
});

test('定位守卫：hypothesis 必须带 caveat 说明这是启发式而非客观不确定性', () => {
  const s = scoreDecision(J1);
  const hyp = chooseValidationHypothesis(J1, s);
  assert.ok(hyp.caveat && hyp.caveat.length > 10, 'caveat 不能为空');
  assert.ok(
    /启发式|不代表|不是对现实不确定性/.test(hyp.caveat),
    `caveat 必须明确说明是启发式，实际：「${hyp.caveat}」`,
  );
});
