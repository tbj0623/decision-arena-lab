/**
 * diagnoseNoFlip —— "为什么翻不过来"的结构化诊断
 *
 * 目标：把笼统的"翻不过来"拆成可验证的成因，且**不改变** findFlipThresholds 的行为。
 *
 * 覆盖：
 *   1. 四/五种 reason 各自可达，且分类与 findFlipThresholds 的 feasible 严格一致
 *   2. 结构性定理：所有 d_k 严格同号 ⇒ 必然 0 可行（1000+ 随机）
 *   3. 结构性定理的逆否：严格异号（有正有负、无 0）⇒ 必然存在可行阈值
 *   4. ZERO_GAP（有 d_k=0）单独成类，不被误归为 OUT_OF_RANGE
 *   5. 纯函数：不修改入参、重复调用一致
 *   6. 9 个内置示例的端到端诊断
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  diagnoseNoFlip,
  findFlipThresholds,
  scoreDecision,
  ValidationError,
} from '../../site/core.mjs';
import { EXAMPLES, cloneBody } from '../../site/features/narrative.mjs';

// ────────────────────────────────────────────────────────────────
// 夹具
// ────────────────────────────────────────────────────────────────

/** w/a/b 数组 → 合法输入 */
function makeInput(ws, as, bs, labels) {
  return {
    options: [{ label: '甲' }, { label: '乙' }],
    factors: ws.map((w, i) => ({
      id: `f${i + 1}`,
      label: labels ? labels[i] : `因素${i + 1}`,
      weight: w,
      ratings: { A: as[i], B: bs[i] },
    })),
  };
}

/** 由 d_k 反推评分：固定 B=5，A=5+d（需保证 0..10） */
function fromGaps(ws, gaps) {
  return makeInput(ws, gaps.map((d) => 5 + d), gaps.map(() => 5));
}

function makeLcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const VALID_REASONS = new Set([
  'ALL_SAME_SIGN', 'ZERO_GAP', 'OUT_OF_RANGE', 'NO_LEVERAGE', 'UNKNOWN',
]);

// ════════════════════════════════════════════════════════════════
// 1. 基本契约
// ════════════════════════════════════════════════════════════════

test('diagnoseNoFlip 返回结构完整，reason 始终在枚举内', () => {
  const cases = [
    fromGaps([1, 1, 1, 1], [1, 2, 1, 3]),        // 全正
    fromGaps([1, 1, 1, 1], [-1, -2, -1, -3]),    // 全负
    fromGaps([1, 1, 1, 1], [0, 1, 0, 0]),        // 含 0
    fromGaps([1, 1, 1, 1], [0, 0, 0, 0]),        // 全 0
    fromGaps([5, 4, 2, 3], [4, -4, 0, 2]),       // offer：有可行
  ];
  for (const [i, input] of cases.entries()) {
    const d = diagnoseNoFlip(input);
    assert.ok(VALID_REASONS.has(d.reason), `case#${i} reason 非法：${d.reason}`);
    assert.equal(typeof d.detail, 'string');
    assert.ok(d.detail.length > 0, `case#${i} detail 不能为空`);
    assert.equal(typeof d.sameSign, 'boolean');
    assert.ok(Array.isArray(d.outOfRange), `case#${i} outOfRange 必须是数组`);
    assert.equal(typeof d.hasFlip, 'boolean');
    assert.ok(Array.isArray(d.codes), `case#${i} codes 必须是数组`);
    assert.equal(d.codes.length, input.factors.length, `case#${i} codes 条数应等于因素数`);

    // outOfRange 每一项都必须是有限数字
    for (const v of d.outOfRange) {
      assert.ok(Number.isFinite(v), `case#${i} outOfRange 含非有限值 ${v}`);
    }
    // 序列化干净
    assert.ok(!/NaN|Infinity|undefined/.test(JSON.stringify(d)), `case#${i} 序列化不干净`);
  }
});

test('hasFlip 必须与 findFlipThresholds 的 feasible 数严格一致', () => {
  for (let k = 0; k < 200; k += 1) {
    const rand = makeLcg(880011 + k * 7919);
    const n = 4 + Math.floor(rand() * 3);
    const ws = Array.from({ length: n }, () => Math.floor(rand() * 10));
    const as = Array.from({ length: n }, () => Math.floor(rand() * 11));
    const bs = Array.from({ length: n }, () => Math.floor(rand() * 11));
    if (ws.every((w) => w === 0)) ws[0] = 1;

    const input = makeInput(ws, as, bs);
    const d = diagnoseNoFlip(input);
    const feasible = findFlipThresholds(input).filter((t) => t.feasible).length;

    assert.equal(d.hasFlip, feasible > 0, `#${k} hasFlip=${d.hasFlip} 但 feasible=${feasible}`);
    assert.equal(d.codes.length, n);
  }
});

test('有可行阈值时返回 hasFlip=true 且不谎称"翻不过来"', () => {
  const input = fromGaps([5, 4, 2, 3], [4, -4, 0, 2]); // offer 的 d 结构
  const d = diagnoseNoFlip(input);
  assert.equal(d.hasFlip, true);
  assert.equal(d.reason, 'UNKNOWN');
  assert.match(d.detail, /存在 \d+ 个可行翻转阈值/);
  assert.doesNotMatch(d.detail, /不可能反号|结构性/);
});

// ════════════════════════════════════════════════════════════════
// 2. ALL_SAME_SIGN（结构性）
// ════════════════════════════════════════════════════════════════

test('ALL_SAME_SIGN：所有 d_k 严格为正', () => {
  const input = fromGaps([1, 1, 1, 1], [1, 2, 1, 3]);
  const d = diagnoseNoFlip(input);
  assert.equal(d.reason, 'ALL_SAME_SIGN');
  assert.equal(d.sameSign, true);
  assert.equal(d.hasFlip, false);
  assert.match(d.detail, /都是正的/);
  assert.match(d.detail, /不可能反号|结构性/);
  // 交叉验证：确实 0 可行
  assert.equal(findFlipThresholds(input).filter((t) => t.feasible).length, 0);
});

test('ALL_SAME_SIGN：所有 d_k 严格为负', () => {
  const input = fromGaps([1, 1, 1, 1], [-1, -2, -1, -3]);
  const d = diagnoseNoFlip(input);
  assert.equal(d.reason, 'ALL_SAME_SIGN');
  assert.equal(d.sameSign, true);
  assert.equal(d.hasFlip, false);
  assert.match(d.detail, /都是负的/);
});

test('ALL_SAME_SIGN 定理：同号 ⇒ 必然 0 可行（1000 组定向随机）', () => {
  let checked = 0;
  for (let k = 0; k < 1000; k += 1) {
    const rand = makeLcg(424242 + k * 104729);
    const n = 4 + Math.floor(rand() * 3);
    const sign = rand() < 0.5 ? 1 : -1;
    const ws = Array.from({ length: n }, () => 1 + Math.floor(rand() * 9));
    const gaps = Array.from({ length: n }, () => sign * (1 + Math.floor(rand() * 4)));

    const input = fromGaps(ws, gaps);
    const feasible = findFlipThresholds(input).filter((t) => t.feasible).length;
    assert.equal(feasible, 0, `#${k} 同号却出现可行阈值 ${feasible}：d=${JSON.stringify(gaps)}`);

    const d = diagnoseNoFlip(input);
    assert.equal(d.reason, 'ALL_SAME_SIGN', `#${k} d=${JSON.stringify(gaps)} 应判 ALL_SAME_SIGN`);
    assert.equal(d.sameSign, true);
    checked += 1;
  }
  assert.equal(checked, 1000);
});

test('ALL_SAME_SIGN 在权重悬殊/零权重下依然成立', () => {
  const cases = [
    fromGaps([100, 1, 1, 1], [3, 1, 1, 1]),
    fromGaps([1, 1, 1, 1], [1, 1, 1, 1]),
    fromGaps([0, 5, 0, 1], [2, 1, 3, 1]),
    fromGaps([9, 9, 1, 1], [1, 4, 2, 1]),
  ];
  for (const [i, input] of cases.entries()) {
    const d = diagnoseNoFlip(input);
    assert.equal(d.reason, 'ALL_SAME_SIGN', `case#${i} d=${JSON.stringify(input.factors.map((f) => f.ratings.A - f.ratings.B))}`);
    assert.equal(findFlipThresholds(input).filter((t) => t.feasible).length, 0);
  }
});

// ════════════════════════════════════════════════════════════════
// 3. ZERO_GAP（有 d_k=0）—— 本轮新增，不能误归 OUT_OF_RANGE
// ════════════════════════════════════════════════════════════════

test('ZERO_GAP：有 d_k=0 时不得报 OUT_OF_RANGE（否则说错原因）', () => {
  const cases = [
    fromGaps([1, 1, 1, 1], [0, 1, 0, 0]),
    fromGaps([1, 1, 1, 1], [0, -1, 0, 0]),
    fromGaps([1, 1, 1, 1], [0, 2, 0, 0]),
    fromGaps([3, 2, 1, 1], [0, 1, 3, 1]),
  ];
  for (const [i, input] of cases.entries()) {
    const d = diagnoseNoFlip(input);
    assert.equal(d.hasFlip, false, `case#${i} 夹具本身应 0 可行`);
    assert.equal(d.reason, 'ZERO_GAP', `case#${i} d=${JSON.stringify(input.factors.map((f) => f.ratings.A - f.ratings.B))} 应判 ZERO_GAP，实际 ${d.reason}`);
    assert.equal(d.sameSign, false, `case#${i} 含 0 不得算严格同号`);
    assert.ok(Number.isInteger(d.zeroGapCount) && d.zeroGapCount > 0, `case#${i} zeroGapCount 应 >0`);
    assert.match(d.detail, /区分度/);
  }
});

test('ZERO_GAP：全 0 时文案不得说"稀释其他因素的差距"（没有其他差距）', () => {
  const input = fromGaps([1, 1, 1, 1], [0, 0, 0, 0]);
  const d = diagnoseNoFlip(input);
  assert.equal(d.reason, 'ZERO_GAP');
  assert.equal(d.zeroGapCount, 4);
  // 全 0 时应有"完全打平"的措辞，而不是"稀释其他差距"
  assert.match(d.detail, /完全打平/);
  assert.doesNotMatch(d.detail, /稀释其他因素的差距/);
});

test('ZERO_GAP：部分为 0、其余同号时，文案说明偏向哪边', () => {
  const input = fromGaps([1, 1, 1, 1], [0, 1, 1, 2]);
  const d = diagnoseNoFlip(input);
  assert.equal(d.reason, 'ZERO_GAP');
  assert.match(d.detail, /偏向 A/);
  assert.doesNotMatch(d.detail, /偏向 B/);
});

// ════════════════════════════════════════════════════════════════
// 4. 严格异号 ⇒ 必然有可行阈值（定理的逆否）
// ════════════════════════════════════════════════════════════════

test('定理：严格异号（有正有负、无 0）⇒ 必然存在可行阈值（500 组）', () => {
  let checked = 0;
  for (let k = 0; k < 500; k += 1) {
    const rand = makeLcg(777001 + k * 7919);
    const n = 4 + Math.floor(rand() * 3);
    const ws = Array.from({ length: n }, () => 1 + Math.floor(rand() * 9));
    // 保证至少一个正、一个负，且都不为 0
    const gaps = Array.from({ length: n }, () => {
      const v = 1 + Math.floor(rand() * 4);
      return rand() < 0.5 ? v : -v;
    });
    const hasPos = gaps.some((d) => d > 0);
    const hasNeg = gaps.some((d) => d < 0);
    if (!hasPos || !hasNeg) continue;

    const input = fromGaps(ws, gaps);
    const feasible = findFlipThresholds(input).filter((t) => t.feasible).length;
    assert.ok(feasible > 0,
      `#${k} 严格异号却 0 可行：d=${JSON.stringify(gaps)} w=${JSON.stringify(ws)}`);

    const d = diagnoseNoFlip(input);
    assert.equal(d.hasFlip, true, `#${k} hasFlip 应为 true`);
    checked += 1;
  }
  assert.ok(checked >= 400, `有效样本太少：${checked}`);
});

// ════════════════════════════════════════════════════════════════
// 5. NO_LEVERAGE 与 UNKNOWN
// ════════════════════════════════════════════════════════════════

test('NO_LEVERAGE：所有 d_k 相等且非零 ⇒ 每项无杠杆（但同号优先）', () => {
  // d 全为 2：同号，按优先级应判 ALL_SAME_SIGN（更强、更根本）
  const input = fromGaps([1, 1, 1, 1], [2, 2, 2, 2]);
  const d = diagnoseNoFlip(input);
  assert.equal(d.reason, 'ALL_SAME_SIGN',
    '同号的 NO_LEVERAGE 应判 ALL_SAME_SIGN，因为"结构性不可能"比"无杠杆"更根本');
  assert.equal(findFlipThresholds(input).filter((t) => t.feasible).length, 0);
});

test('UNKNOWN：SOLE_FACTOR 场景不崩，reason 在枚举内', () => {
  const input = makeInput([5, 0, 0, 0], [9, 1, 3, 0], [2, 9, 3, 10]);
  const d = diagnoseNoFlip(input);
  assert.ok(VALID_REASONS.has(d.reason));
  // 该夹具实际有可行阈值（零权重因素可被撬动）
  const feasible = findFlipThresholds(input).filter((t) => t.feasible).length;
  assert.equal(d.hasFlip, feasible > 0);
});

// ════════════════════════════════════════════════════════════════
// 6. 纯函数性 & 不改原有行为
// ════════════════════════════════════════════════════════════════

test('纯函数：不修改入参，重复调用结果一致', () => {
  const input = fromGaps([5, 4, 2, 3], [4, -4, 0, 2]);
  const snapshot = JSON.stringify(input);
  const a = diagnoseNoFlip(input);
  const b = diagnoseNoFlip(input);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(input), snapshot, '不应修改入参');
});

test('不改变 findFlipThresholds 行为：诊断前后结果逐字段相同', () => {
  const input = fromGaps([4, 3, 2, 1], [3, -1, -5, 0]);
  const before = findFlipThresholds(input);
  diagnoseNoFlip(input);
  const after = findFlipThresholds(input);
  assert.deepEqual(after, before, 'diagnoseNoFlip 不得影响 findFlipThresholds');
});

test('非法输入抛 ValidationError（与 core 一致）', () => {
  assert.throws(() => diagnoseNoFlip(null), (e) => e instanceof ValidationError && e.code === 'INVALID_INPUT');
  assert.throws(() => diagnoseNoFlip({ options: [], factors: [] }), (e) => e instanceof ValidationError);
});

test('outOfRange 只收录 OUT_OF_RANGE / BOUNDARY 的 t*，且不含 -0', () => {
  const inputs = [
    fromGaps([5, 4, 2, 3], [4, -4, 0, 2]),
    fromGaps([1, 1, 1, 1], [-1, -2, -1, -1]),
    fromGaps([1, 1, 1, 1], [0, 0, 1, 0]),
  ];
  for (const [i, input] of inputs.entries()) {
    const d = diagnoseNoFlip(input);
    // 期望值也要做同样的 -0 → +0 规范化，否则 Object.is 比较会假失败
    const expected = findFlipThresholds(input)
      .filter((t) => t.code === 'OUT_OF_RANGE' || t.code === 'BOUNDARY')
      .map((t) => t.thresholdShare)
      .filter(Number.isFinite)
      .map((v) => (v === 0 ? 0 : v));
    assert.deepEqual(d.outOfRange, expected, `case#${i} outOfRange 口径不符`);
    for (const v of d.outOfRange) {
      assert.equal(Object.is(v, -0), false, `case#${i} outOfRange 含 -0`);
    }
  }
  // 反证：确认确实存在会产生 -0 的输入，否则上面的断言是空转
  const zeroCase = fromGaps([1, 1, 1, 1], [0, 0, 1, 0]);
  const raw = findFlipThresholds(zeroCase)
    .filter((t) => t.code === 'OUT_OF_RANGE' || t.code === 'BOUNDARY')
    .map((t) => t.thresholdShare)
    .filter(Number.isFinite);
  assert.ok(raw.some((v) => Object.is(v, -0)),
    '前提校验：该夹具的原始 t* 里应存在 -0（否则本测试抓不到 -0 问题）');
});

// ════════════════════════════════════════════════════════════════
// 7. 9 个内置示例端到端
// ════════════════════════════════════════════════════════════════

test('9 个内置示例：诊断结果与 feasible 一致，且 city/oldguitar 判 ALL_SAME_SIGN', () => {
  assert.equal(EXAMPLES.length, 9, '示例数应为 9');

  const reasons = {};
  for (const ex of EXAMPLES) {
    const input = cloneBody(ex.body);
    const d = diagnoseNoFlip(input);
    const feasible = findFlipThresholds(input).filter((t) => t.feasible).length;

    reasons[ex.key] = d.reason;
    assert.equal(d.hasFlip, feasible > 0, `${ex.key}: hasFlip=${d.hasFlip} 但 feasible=${feasible}`);
    // 有可行阈值时必须是 UNKNOWN（本诊断不适用），且不得出现"翻不过来"措辞
    if (feasible > 0) {
      assert.equal(d.reason, 'UNKNOWN', `${ex.key} 有 ${feasible} 个可行阈值，应为 UNKNOWN`);
      assert.doesNotMatch(d.detail, /不可能反号/, `${ex.key} 不应说结构性不可能`);
    }
  }

  // 两个"翻不过来"的示例：都必须是结构性同号
  assert.equal(reasons.city, 'ALL_SAME_SIGN', `city 应为 ALL_SAME_SIGN，实际 ${reasons.city}`);
  assert.equal(reasons.oldguitar, 'ALL_SAME_SIGN', `oldguitar 应为 ALL_SAME_SIGN，实际 ${reasons.oldguitar}`);

  // city 全负、oldguitar 全正，符号相反
  const cityD = cloneBody(EXAMPLES.find((e) => e.key === 'city').body).factors.map((f) => f.ratings.A - f.ratings.B);
  const guitarD = cloneBody(EXAMPLES.find((e) => e.key === 'oldguitar').body).factors.map((f) => f.ratings.A - f.ratings.B);
  assert.ok(cityD.every((x) => x < 0), `city 的 d 应全负，实际 ${JSON.stringify(cityD)}`);
  assert.ok(guitarD.every((x) => x > 0), `oldguitar 的 d 应全正，实际 ${JSON.stringify(guitarD)}`);
});

test('9 个内置示例：诊断不得改变示例对象的评分', () => {
  for (const ex of EXAMPLES) {
    const before = JSON.stringify(ex.body);
    diagnoseNoFlip(cloneBody(ex.body));
    assert.equal(JSON.stringify(ex.body), before, `${ex.key} 的 body 被污染`);
  }
});
