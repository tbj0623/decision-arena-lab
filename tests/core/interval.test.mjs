/**
 * Decision Arena — 区间敏感性分析（v1.1）单元测试
 *
 * 覆盖
 *   A. 提案 INTERVAL_ANALYSIS.md §7 的 23 个用例（T1–T23）
 *   B. 不变量 minΔ ≤ pointΔ ≤ maxΔ（≥100 组随机）
 *   C. 见证点代回 scoreDecision 必须精确达到极值
 *   D. 退化区间（lo===hi）必须与 v1.0 scoreDecision 一致
 *   E. O(n) 与 2^(2n) 暴力枚举完全相等
 *
 * 约定：浮点一律用 Math.abs(a-b) < 1e-9，不用 assert.equal。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeInterval,
  normalizeIntervalInput,
  enumerateCorners,
} from '../../site/features/interval.mjs';
import { scoreDecision, ValidationError } from '../../site/core.mjs';

// ────────────────────────────────────────────────────────────────
// 夹具辅助
// ────────────────────────────────────────────────────────────────

/** factors: [{ id?, label?, w, A:[lo,hi], B:[lo,hi] }] */
function makeIntervalInput(factors) {
  return {
    options: [{ label: '甲' }, { label: '乙' }],
    factors: factors.map((f, i) => ({
      id: f.id ?? `f${i + 1}`,
      label: f.label ?? `因素${i + 1}`,
      weight: f.w,
      intervals: { A: f.A, B: f.B },
    })),
  };
}

/** 4 因素等权（w=1 ⇒ p=0.25 ⇒ Δ = 2.5·Σd） */
function equalFour(specs) {
  return makeIntervalInput(specs.map((s) => ({ w: 1, A: s.A, B: s.B })));
}

/** 浮点断言：|actual - expected| < 1e-9 */
function assertDelta(actual, expected, label) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${label}: 期望 ${expected}，实际 ${actual}（差 ${actual - expected}）`,
  );
}

/** 把 analyzeInterval 的见证点还原成 scoreDecision 能吃的点估计输入 */
function witnessToPointInput(input, witness) {
  return {
    options: input.options,
    factors: input.factors.map((f, i) => ({
      id: f.id,
      label: f.label,
      weight: f.weight,
      ratings: { A: witness.A[i], B: witness.B[i] },
    })),
  };
}

/** 断言抛出指定 code 的 ValidationError */
function assertCode(fn, code, label) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof ValidationError, `${label}: 应抛 ValidationError，实际 ${err?.name}`);
    assert.equal(err.code, code, `${label}: 期望 code=${code}，实际 ${err.code}`);
    return true;
  }, label);
}

/** 确定性 LCG（不用 Math.random） */
function makeLcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 递归找对象里所有非有限数（NaN / ±Infinity） */
function findNonFinite(value, path = '$') {
  const bad = [];
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) bad.push(path);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => bad.push(...findNonFinite(v, `${path}[${i}]`)));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) bad.push(...findNonFinite(v, `${path}.${k}`));
  }
  return bad;
}

// ════════════════════════════════════════════════════════════════
// A. 提案 §7 的 23 个用例
// ════════════════════════════════════════════════════════════════

test('T1 全部区间退化：min===max===scoreDecision.difference', () => {
  const input = equalFour(Array(4).fill({ A: [8, 8], B: [6, 6] }));
  const r = analyzeInterval(input);
  // 手算：d_i = 8-6 = 2；Σd = 8；Δ = 2.5 × 8 = 20
  assertDelta(r.minDelta, 20, 'T1.min');
  assertDelta(r.maxDelta, 20, 'T1.max');
  assertDelta(r.pointDelta, 20, 'T1.point');
  assert.equal(r.verdict, 'degenerate');
  assertDelta(r.spread, 0, 'T1.spread');

  // 与 v1.0 一致
  const sd = scoreDecision(witnessToPointInput(input, r.worstCase));
  assertDelta(sd.difference, 20, 'T1.scoreDecision');
});

test('T2 单因素区间 [6,8]：min=0, max=5，criticalA', () => {
  const input = equalFour([
    { A: [6, 8], B: [6, 6] },
    ...Array(3).fill({ A: [5, 5], B: [5, 5] }),
  ]);
  const r = analyzeInterval(input);
  // 手算：d_1 ∈ [0,2]，其余 0 ⇒ minΔ = 2.5×0 = 0，maxΔ = 2.5×2 = 5
  assertDelta(r.minDelta, 0, 'T2.min');
  assertDelta(r.maxDelta, 5, 'T2.max');
  assert.equal(r.verdict, 'criticalA');
  assert.equal(r.canTie, true);
  assert.equal(r.canFlipA, false); // A 永不落后
  assert.equal(r.canFlipB, true);
  // pointDelta 必须取区间**中点**：d_1 中点 = 1 ⇒ 2.5 × 1 = 2.5
  // （若误用 lo 端点会得 0，误用 hi 端点会得 5，这里锁死中点语义）
  assertDelta(r.pointDelta, 2.5, 'T2.point');
  // 该因素的逐项贡献也必须锁死
  assertDelta(r.factors[0].minContribution, 0, 'T2.f0.min');
  assertDelta(r.factors[0].maxContribution, 5, 'T2.f0.max');
  assertDelta(r.factors[0].midContribution, 2.5, 'T2.f0.mid');
  assertDelta(r.factors[0].uncertaintyWidth, 5, 'T2.f0.width');
});

test('T3 单因素区间 [0,10]×[0,10]：min=-25, max=25，unstable', () => {
  const input = equalFour([
    { A: [0, 10], B: [0, 10] },
    ...Array(3).fill({ A: [5, 5], B: [5, 5] }),
  ]);
  const r = analyzeInterval(input);
  // 手算：d_1 ∈ [-10,10] ⇒ minΔ = 2.5×(-10) = -25，maxΔ = 2.5×10 = 25
  assertDelta(r.minDelta, -25, 'T3.min');
  assertDelta(r.maxDelta, 25, 'T3.max');
  assert.equal(r.verdict, 'unstable');
});

test('T4 权重 4/3/2/1、混合区间：min=-8, max=10', () => {
  const input = makeIntervalInput([
    { w: 4, A: [7, 9], B: [4, 5] },
    { w: 3, A: [5, 6], B: [6, 7] },
    { w: 2, A: [3, 3], B: [8, 8] },
    { w: 1, A: [5, 5], B: [5, 5] },
  ]);
  const r = analyzeInterval(input);
  // 手算：W=10，p=(0.4,0.3,0.2,0.1)
  //   f1 d∈[2,5]  → 贡献 [8, 20]
  //   f2 d∈[-2,0] → 贡献 [-6, 0]
  //   f3 d=-5     → 贡献 [-10,-10]
  //   f4 d=0      → 贡献 [0,0]
  //   minΔ = 8-6-10 = -8 ; maxΔ = 20+0-10 = 10
  assertDelta(r.minDelta, -8, 'T4.min');
  assertDelta(r.maxDelta, 10, 'T4.max');
  assert.equal(r.verdict, 'unstable');
});

test('T5 全体宽区间但仍稳固：min=20, max=40，stableA', () => {
  const input = equalFour(Array(4).fill({ A: [8, 9], B: [5, 6] }));
  const r = analyzeInterval(input);
  // 手算：d_i ∈ [2,4] ⇒ minΔ = 2.5×8 = 20，maxΔ = 2.5×16 = 40
  assertDelta(r.minDelta, 20, 'T5.min');
  assertDelta(r.maxDelta, 40, 'T5.max');
  assert.equal(r.verdict, 'stableA');
  // 区间很宽但结论稳固：0 不在 [20,40] 内
  assert.equal(r.canTie, false);
});

test('T6 全体宽区间但稳固（B）：min=-40, max=-20，stableB', () => {
  const input = equalFour(Array(4).fill({ A: [5, 6], B: [8, 9] }));
  const r = analyzeInterval(input);
  // 手算：d_i ∈ [-4,-2] ⇒ minΔ = 2.5×(-16) = -40，maxΔ = 2.5×(-8) = -20
  assertDelta(r.minDelta, -40, 'T6.min');
  assertDelta(r.maxDelta, -20, 'T6.max');
  assert.equal(r.verdict, 'stableB');
  assert.equal(r.canTie, false);
});

test('T7 零权重因素的巨大区间不影响结果', () => {
  const input = makeIntervalInput([
    { w: 1, A: [5, 5], B: [5, 5] },
    { w: 1, A: [5, 5], B: [5, 5] },
    { w: 1, A: [5, 5], B: [5, 5] },
    { w: 0, A: [0, 10], B: [0, 10] },
  ]);
  const r = analyzeInterval(input);
  // 手算：p4 = 0 ⇒ f4 贡献恒为 0；其余 d=0
  assertDelta(r.minDelta, 0, 'T7.min');
  assertDelta(r.maxDelta, 0, 'T7.max');
  assert.equal(r.verdict, 'degenerate');
  // 零权重因素的 uncertaintyWidth 必须是 0
  assertDelta(r.factors[3].uncertaintyWidth, 0, 'T7.zeroWeightWidth');
});

test('T8 确定性差距 15，零权重区间无法撼动', () => {
  const input = makeIntervalInput([
    { w: 1, A: [8, 8], B: [5, 5] },
    { w: 1, A: [5, 5], B: [5, 5] },
    { w: 0, A: [0, 10], B: [0, 10] },
    { w: 0, A: [10, 10], B: [0, 0] },
  ]);
  const r = analyzeInterval(input);
  // 手算：W=2，p1=p2=0.5；f1 d=3 ⇒ 10×0.5×3 = 15
  assertDelta(r.minDelta, 15, 'T8.min');
  assertDelta(r.maxDelta, 15, 'T8.max');
  assert.equal(r.verdict, 'degenerate');
});

test('T9 lo>hi 必须报 INVALID_INTERVAL，不自动交换', () => {
  const bad = equalFour([
    { A: [8, 3], B: [5, 5] },
    ...Array(3).fill({ A: [5, 5], B: [5, 5] }),
  ]);
  assertCode(() => analyzeInterval(bad), 'INVALID_INTERVAL', 'T9');
  // 也要确认"反向"同样非法
  const bad2 = equalFour([
    { A: [5, 5], B: [9, 2] },
    ...Array(3).fill({ A: [5, 5], B: [5, 5] }),
  ]);
  assertCode(() => analyzeInterval(bad2), 'INVALID_INTERVAL', 'T9.B');
});

test('T10 端点超出 [0,10] 报 RATING_OUT_OF_RANGE', () => {
  for (const A of [[-1, 5], [5, 11], [0, 10.5], [-0.001, 5]]) {
    const input = equalFour([
      { A, B: [5, 5] },
      ...Array(3).fill({ A: [5, 5], B: [5, 5] }),
    ]);
    assertCode(() => analyzeInterval(input), 'RATING_OUT_OF_RANGE', `T10 A=${JSON.stringify(A)}`);
  }
  // 边界值本身必须合法
  for (const A of [[0, 0], [10, 10], [0, 10]]) {
    const input = equalFour([
      { A, B: [5, 5] },
      ...Array(3).fill({ A: [5, 5], B: [5, 5] }),
    ]);
    assert.doesNotThrow(() => analyzeInterval(input), `T10 边界 ${JSON.stringify(A)} 应合法`);
  }
});

test('T11 NaN / Infinity 端点报 INVALID_RATING', () => {
  for (const bad of [NaN, Infinity, -Infinity, '7', null, undefined, true, {}]) {
    const input = equalFour([
      { A: [5, bad], B: [5, 5] },
      ...Array(3).fill({ A: [5, 5], B: [5, 5] }),
    ]);
    assertCode(() => analyzeInterval(input), 'INVALID_RATING', `T11 端点=${String(bad)}`);
  }
});

test('T12 区间含 0 分是合法的：min=0, max=7.5，criticalA', () => {
  const input = equalFour([
    { A: [0, 3], B: [0, 0] },
    ...Array(3).fill({ A: [5, 5], B: [5, 5] }),
  ]);
  const r = analyzeInterval(input);
  // 手算：d_1 ∈ [0-0, 3-0] = [0,3] ⇒ minΔ = 0，maxΔ = 2.5×3 = 7.5
  assertDelta(r.minDelta, 0, 'T12.min');
  assertDelta(r.maxDelta, 7.5, 'T12.max');
  assert.equal(r.verdict, 'criticalA');
});

test('T13 5 因素全部不确定：min=-10, max=10，unstable', () => {
  const input = makeIntervalInput(
    Array.from({ length: 5 }, () => ({ w: 1, A: [5, 6], B: [5, 6] })),
  );
  const r = analyzeInterval(input);
  // 手算：n=5，p=0.2；d_i ∈ [-1,1]；Δ = 2·Σd，Σd ∈ [-5,5]
  assertDelta(r.minDelta, -10, 'T13.min');
  assertDelta(r.maxDelta, 10, 'T13.max');
  assert.equal(r.verdict, 'unstable');
});

test('T14 全零权重报 ALL_ZERO_WEIGHTS', () => {
  const input = makeIntervalInput(
    Array.from({ length: 4 }, () => ({ w: 0, A: [0, 10], B: [0, 10] })),
  );
  assertCode(() => analyzeInterval(input), 'ALL_ZERO_WEIGHTS', 'T14');
});

test('T15 因素数 3 或 7 报 FACTOR_COUNT', () => {
  for (const n of [3, 7]) {
    const input = makeIntervalInput(
      Array.from({ length: n }, () => ({ w: 1, A: [5, 5], B: [5, 5] })),
    );
    assertCode(() => analyzeInterval(input), 'FACTOR_COUNT', `T15 n=${n}`);
  }
  // 4 / 6 必须合法
  for (const n of [4, 6]) {
    const input = makeIntervalInput(
      Array.from({ length: n }, () => ({ w: 1, A: [5, 5], B: [5, 5] })),
    );
    assert.doesNotThrow(() => analyzeInterval(input), `T15 n=${n} 应合法`);
  }
});

test('T16 A∈[2,6] vs B=6：min=-10, max=0，criticalB', () => {
  const input = equalFour([
    { A: [2, 6], B: [6, 6] },
    ...Array(3).fill({ A: [5, 5], B: [5, 5] }),
  ]);
  const r = analyzeInterval(input);
  // 手算：d_1 ∈ [-4,0] ⇒ minΔ = -10，maxΔ = 0
  assertDelta(r.minDelta, -10, 'T16.min');
  assertDelta(r.maxDelta, 0, 'T16.max');
  assert.equal(r.verdict, 'criticalB');
  assert.equal(r.canFlipB, false); // A 不可能反超
  assert.equal(r.canFlipA, true);
});

test('T17 全部 A=B=5：min=max=0', () => {
  const input = equalFour(Array(4).fill({ A: [5, 5], B: [5, 5] }));
  const r = analyzeInterval(input);
  assertDelta(r.minDelta, 0, 'T17.min');
  assertDelta(r.maxDelta, 0, 'T17.max');
  assert.equal(r.verdict, 'degenerate');
  // -0 防护：三个 0 都必须正零
  for (const [k, v] of [['minDelta', r.minDelta], ['maxDelta', r.maxDelta], ['pointDelta', r.pointDelta], ['spread', r.spread]]) {
    assert.equal(Object.is(v, -0), false, `T17 ${k} 不应是 -0`);
  }
});

test('T18 见证点代回 scoreDecision 必须精确等于声明的极值', () => {
  const input = makeIntervalInput([
    { w: 4, A: [7, 9], B: [4, 5] },
    { w: 3, A: [5, 6], B: [6, 7] },
    { w: 2, A: [3, 3], B: [8, 8] },
    { w: 1, A: [5, 5], B: [5, 5] },
  ]);
  const r = analyzeInterval(input);

  const worst = scoreDecision(witnessToPointInput(input, r.worstCase));
  const best = scoreDecision(witnessToPointInput(input, r.bestCase));

  assertDelta(worst.difference, r.minDelta, 'T18.worst');
  assertDelta(best.difference, r.maxDelta, 'T18.best');

  // 见证点必须真的落在各自区间内
  for (let i = 0; i < input.factors.length; i += 1) {
    const iv = input.factors[i].intervals;
    assert.ok(r.worstCase.A[i] >= iv.A[0] && r.worstCase.A[i] <= iv.A[1], `T18 worst.A[${i}] 越界`);
    assert.ok(r.worstCase.B[i] >= iv.B[0] && r.worstCase.B[i] <= iv.B[1], `T18 worst.B[${i}] 越界`);
    assert.ok(r.bestCase.A[i] >= iv.A[0] && r.bestCase.A[i] <= iv.A[1], `T18 best.A[${i}] 越界`);
    assert.ok(r.bestCase.B[i] >= iv.B[0] && r.bestCase.B[i] <= iv.B[1], `T18 best.B[${i}] 越界`);
  }
});

test('T19 交换 A/B 后 min/max 镜像取负', () => {
  const base = [
    { w: 4, A: [7, 9], B: [4, 5] },
    { w: 3, A: [5, 6], B: [6, 7] },
    { w: 2, A: [3, 3], B: [8, 8] },
    { w: 1, A: [5, 5], B: [5, 5] },
  ];
  const r1 = analyzeInterval(makeIntervalInput(base));
  const r2 = analyzeInterval(makeIntervalInput(base.map((f) => ({ ...f, A: f.B, B: f.A }))));
  // 手算：原 [-8,10] ⇒ 交换后 [-10,8]
  assertDelta(r2.minDelta, -r1.maxDelta, 'T19.min');
  assertDelta(r2.maxDelta, -r1.minDelta, 'T19.max');
  assertDelta(r2.minDelta, -10, 'T19.min.abs');
  assertDelta(r2.maxDelta, 8, 'T19.max.abs');
});

test('T20 区间变宽后 min 不增、max 不减', () => {
  const narrow = analyzeInterval(equalFour(Array(4).fill({ A: [6, 7], B: [5, 6] })));
  const wide = analyzeInterval(equalFour(Array(4).fill({ A: [4, 9], B: [2, 8] })));
  assert.ok(wide.minDelta <= narrow.minDelta + 1e-9, `T20 min: wide=${wide.minDelta} narrow=${narrow.minDelta}`);
  assert.ok(wide.maxDelta >= narrow.maxDelta - 1e-9, `T20 max: wide=${wide.maxDelta} narrow=${narrow.maxDelta}`);
  // 手算核对：narrow=[0,20]，wide=[-40,70]
  assertDelta(narrow.minDelta, 0, 'T20.narrow.min');
  assertDelta(narrow.maxDelta, 20, 'T20.narrow.max');
  assertDelta(wide.minDelta, -40, 'T20.wide.min');
  assertDelta(wide.maxDelta, 70, 'T20.wide.max');
});

test('T21 权重整体 ×7 后边界不变', () => {
  const spec = [
    { A: [7, 9], B: [4, 5] },
    { A: [5, 6], B: [6, 7] },
    { A: [3, 3], B: [8, 8] },
    { A: [5, 5], B: [5, 5] },
  ];
  const w1 = [4, 3, 2, 1];
  const a = analyzeInterval(makeIntervalInput(spec.map((s, i) => ({ w: w1[i], ...s }))));
  const b = analyzeInterval(makeIntervalInput(spec.map((s, i) => ({ w: w1[i] * 7, ...s }))));
  assertDelta(b.minDelta, a.minDelta, 'T21.min');
  assertDelta(b.maxDelta, a.maxDelta, 'T21.max');
  assertDelta(a.minDelta, -8, 'T21.base.min');
  assertDelta(a.maxDelta, 10, 'T21.base.max');
});

test('T22 LCG 随机 100 组：O(n) 结果必须等于 4^n 暴力枚举结果', () => {
  for (let k = 0; k < 100; k += 1) {
    const rand = makeLcg(20261030 + k * 7919);
    const n = 4 + Math.floor(rand() * 3);
    const factors = Array.from({ length: n }, () => {
      const loA = rand() * 10;
      const hiA = loA + rand() * (10 - loA);
      const loB = rand() * 10;
      const hiB = loB + rand() * (10 - loB);
      return { w: Math.floor(rand() * 10), A: [loA, hiA], B: [loB, hiB] };
    });
    if (factors.every((f) => f.w === 0)) factors[0].w = 1;

    const input = makeIntervalInput(factors);
    const fast = analyzeInterval(input);
    const slow = enumerateCorners(input);

    assertDelta(fast.minDelta, slow.min, `T22#${k}.min`);
    assertDelta(fast.maxDelta, slow.max, `T22#${k}.max`);
    // 角点数必须是 4^n
    assert.equal(slow.count, 4 ** n, `T22#${k} 角点数`);
  }
});

test('T23 通用不变量：min<=mid<=max、有限性、序列化干净', () => {
  const input = makeIntervalInput([
    { w: 4, A: [7, 9], B: [4, 5] },
    { w: 3, A: [5, 6], B: [6, 7] },
    { w: 2, A: [3, 3], B: [8, 8] },
    { w: 1, A: [5, 5], B: [5, 5] },
  ]);
  const r = analyzeInterval(input);
  assert.ok(r.minDelta <= r.maxDelta, 'I1');
  assert.ok(r.minDelta <= r.pointDelta + 1e-9, 'I2.min');
  assert.ok(r.pointDelta <= r.maxDelta + 1e-9, 'I2.max');
  for (const [k, v] of Object.entries({ min: r.minDelta, max: r.maxDelta, point: r.pointDelta, spread: r.spread })) {
    assert.ok(Number.isFinite(v), `I11 ${k} 应有限`);
  }
  const json = JSON.stringify(r);
  assert.ok(!/NaN|Infinity|undefined/.test(json), `I12 序列化不干净：${json.slice(0, 200)}`);
  assert.deepEqual(findNonFinite(r), [], 'I11 全字段无 NaN/Infinity');
});

// ════════════════════════════════════════════════════════════════
// B. 不变量 minΔ ≤ pointΔ ≤ maxΔ（≥100 组随机）
// ════════════════════════════════════════════════════════════════

test('不变量：minΔ ≤ pointΔ ≤ maxΔ（LCG 随机 200 组）', () => {
  let checked = 0;
  for (let k = 0; k < 200; k += 1) {
    const rand = makeLcg(770010 + k * 104729);
    const n = 4 + Math.floor(rand() * 3);
    const factors = Array.from({ length: n }, () => {
      const loA = rand() * 10;
      const hiA = loA + rand() * (10 - loA);
      const loB = rand() * 10;
      const hiB = loB + rand() * (10 - loB);
      return { w: Math.floor(rand() * 11), A: [loA, hiA], B: [loB, hiB] };
    });
    if (factors.every((f) => f.w === 0)) factors[0].w = 1;

    const r = analyzeInterval(makeIntervalInput(factors));

    // I1：硬保证，不需要容差
    assert.ok(r.minDelta <= r.maxDelta,
      `#${k} I1 违反：min=${r.minDelta} > max=${r.maxDelta}`);
    // I2：点估计（区间中点）必在范围内
    assert.ok(r.minDelta <= r.pointDelta + 1e-9,
      `#${k} I2.min 违反：min=${r.minDelta} point=${r.pointDelta}`);
    assert.ok(r.pointDelta <= r.maxDelta + 1e-9,
      `#${k} I2.max 违反：point=${r.pointDelta} max=${r.maxDelta}`);
    // I11
    assert.ok(Number.isFinite(r.minDelta) && Number.isFinite(r.maxDelta) && Number.isFinite(r.pointDelta),
      `#${k} 出现非有限值`);
    checked += 1;
  }
  assert.equal(checked, 200);
});

// ════════════════════════════════════════════════════════════════
// C. 见证点必须真的达到极值
// ════════════════════════════════════════════════════════════════

test('见证点代回 scoreDecision 必须达到极值（LCG 随机 100 组）', () => {
  for (let k = 0; k < 100; k += 1) {
    const rand = makeLcg(424242 + k * 15485863);
    const n = 4 + Math.floor(rand() * 3);
    const factors = Array.from({ length: n }, () => {
      const loA = rand() * 10;
      const hiA = loA + rand() * (10 - loA);
      const loB = rand() * 10;
      const hiB = loB + rand() * (10 - loB);
      return { w: 1 + Math.floor(rand() * 9), A: [loA, hiA], B: [loB, hiB] };
    });
    const input = makeIntervalInput(factors);
    const r = analyzeInterval(input);

    const worst = scoreDecision(witnessToPointInput(input, r.worstCase));
    const best = scoreDecision(witnessToPointInput(input, r.bestCase));

    assert.ok(Math.abs(worst.difference - r.minDelta) < 1e-9,
      `#${k} worstCase 代回得 ${worst.difference}，但声称 minDelta=${r.minDelta}`);
    assert.ok(Math.abs(best.difference - r.maxDelta) < 1e-9,
      `#${k} bestCase 代回得 ${best.difference}，但声称 maxDelta=${r.maxDelta}`);

    // 见证点必须在盒内
    for (let i = 0; i < n; i += 1) {
      const iv = input.factors[i].intervals;
      for (const [tag, w] of [['worst', r.worstCase], ['best', r.bestCase]]) {
        assert.ok(w.A[i] >= iv.A[0] - 1e-12 && w.A[i] <= iv.A[1] + 1e-12, `#${k} ${tag}.A[${i}] 越界`);
        assert.ok(w.B[i] >= iv.B[0] - 1e-12 && w.B[i] <= iv.B[1] + 1e-12, `#${k} ${tag}.B[${i}] 越界`);
      }
    }
  }
});

test('见证点：手工夹具逐一校验（含零权重与单点区间）', () => {
  const cases = [
    makeIntervalInput([
      { w: 4, A: [7, 9], B: [4, 5] },
      { w: 3, A: [5, 6], B: [6, 7] },
      { w: 2, A: [3, 3], B: [8, 8] },
      { w: 1, A: [5, 5], B: [5, 5] },
    ]),
    // 含零权重
    makeIntervalInput([
      { w: 0, A: [0, 10], B: [0, 10] },
      { w: 5, A: [2, 8], B: [1, 9] },
      { w: 0, A: [10, 10], B: [0, 0] },
      { w: 5, A: [6, 6], B: [4, 4] },
    ]),
    // 全退化
    equalFour(Array(4).fill({ A: [5, 5], B: [5, 5] })),
  ];
  for (const [idx, input] of cases.entries()) {
    const r = analyzeInterval(input);
    const worst = scoreDecision(witnessToPointInput(input, r.worstCase));
    const best = scoreDecision(witnessToPointInput(input, r.bestCase));
    assert.ok(Math.abs(worst.difference - r.minDelta) < 1e-9, `case#${idx} worst`);
    assert.ok(Math.abs(best.difference - r.maxDelta) < 1e-9, `case#${idx} best`);
  }
});

// ════════════════════════════════════════════════════════════════
// D. 退化区间（lo === hi）必须与 v1.0 scoreDecision 一致
// ════════════════════════════════════════════════════════════════

test('退化区间等价性：lo===hi 时结果必须等于 scoreDecision', () => {
  for (let k = 0; k < 100; k += 1) {
    const rand = makeLcg(31337 + k * 2654435761);
    const n = 4 + Math.floor(rand() * 3);
    const factors = Array.from({ length: n }, () => {
      const a = Math.round(rand() * 100) / 10;
      const b = Math.round(rand() * 100) / 10;
      return { w: Math.floor(rand() * 10), A: [a, a], B: [b, b] };
    });
    if (factors.every((f) => f.w === 0)) factors[0].w = 1;

    const input = makeIntervalInput(factors);
    const r = analyzeInterval(input);

    // 用点估计输入喂给 v1.0
    const pointInput = {
      options: input.options,
      factors: input.factors.map((f) => ({
        id: f.id,
        label: f.label,
        weight: f.weight,
        ratings: { A: f.intervals.A[0], B: f.intervals.B[0] },
      })),
    };
    const sd = scoreDecision(pointInput);

    // min === max === point === scoreDecision.difference
    assert.ok(Math.abs(r.minDelta - sd.difference) < 1e-9,
      `#${k} minDelta=${r.minDelta} != scoreDecision.difference=${sd.difference}`);
    assert.ok(Math.abs(r.maxDelta - sd.difference) < 1e-9,
      `#${k} maxDelta=${r.maxDelta} != scoreDecision.difference=${sd.difference}`);
    assert.ok(Math.abs(r.pointDelta - sd.difference) < 1e-9,
      `#${k} pointDelta=${r.pointDelta} != scoreDecision.difference=${sd.difference}`);
    assert.equal(r.verdict, 'degenerate', `#${k} 全退化应为 degenerate`);
    assert.ok(Math.abs(r.spread) < 1e-9, `#${k} spread 应为 0，实际 ${r.spread}`);
  }
});

test('退化区间：非等权夹具也必须与 scoreDecision 一致', () => {
  const input = makeIntervalInput([
    { w: 4, A: [7, 7], B: [4, 4] },
    { w: 3, A: [5, 5], B: [6, 6] },
    { w: 2, A: [3, 3], B: [8, 8] },
    { w: 1, A: [5, 5], B: [5, 5] },
  ]);
  const r = analyzeInterval(input);
  const sd = scoreDecision(witnessToPointInput(input, r.worstCase));
  // 手算：W=10，p=(0.4,0.3,0.2,0.1)；d=(3,-1,-5,0)
  //   Δ = 10×(0.4×3 + 0.3×(-1) + 0.2×(-5) + 0.1×0) = 10×(1.2 - 0.3 - 1.0) = -1
  assertDelta(sd.difference, -1, 'D.manual');
  assertDelta(r.minDelta, -1, 'D.min');
  assertDelta(r.maxDelta, -1, 'D.max');
});

// ════════════════════════════════════════════════════════════════
// E. O(n) vs 暴力枚举（小规模 4 因素全等）
// ════════════════════════════════════════════════════════════════

test('O(n) vs 暴力枚举：4 因素下必须完全相等（含随机 100 组）', () => {
  for (let k = 0; k < 100; k += 1) {
    const rand = makeLcg(99991 + k * 7919);
    const factors = Array.from({ length: 4 }, () => {
      const loA = rand() * 10;
      const hiA = loA + rand() * (10 - loA);
      const loB = rand() * 10;
      const hiB = loB + rand() * (10 - loB);
      return { w: Math.floor(rand() * 10), A: [loA, hiA], B: [loB, hiB] };
    });
    if (factors.every((f) => f.w === 0)) factors[0].w = 1;

    const input = makeIntervalInput(factors);
    const fast = analyzeInterval(input);
    const slow = enumerateCorners(input);

    assert.equal(slow.count, 4 ** 4, `#${k} 4 因素应有 256 个角点`);
    // 小规模、同样是 4 项求和同序 ⇒ 应当逐位相等
    assert.equal(fast.minDelta, slow.min, `#${k} min 不完全相等：${fast.minDelta} vs ${slow.min}`);
    assert.equal(fast.maxDelta, slow.max, `#${k} max 不完全相等：${fast.maxDelta} vs ${slow.max}`);
  }
});

test('enumerateCorners：角点数恒为 4^n，且边界与 analyzeInterval 一致（n=4..6）', () => {
  for (const n of [4, 5, 6]) {
    const input = makeIntervalInput(
      Array.from({ length: n }, () => ({ w: 1, A: [1, 9], B: [2, 8] })),
    );
    const slow = enumerateCorners(input);
    assert.equal(slow.count, 4 ** n, `n=${n} 角点数应为 4^n=${4 ** n}`);
    const fast = analyzeInterval(input);
    assertDelta(fast.minDelta, slow.min, `n=${n}.min`);
    assertDelta(fast.maxDelta, slow.max, `n=${n}.max`);
  }
});

// ════════════════════════════════════════════════════════════════
// F. verdict 六档与 -0 防护
// ════════════════════════════════════════════════════════════════

test('verdict 六档全覆盖，且与 canTie/canFlip 自洽', () => {
  const scenarios = [
    ['stableA', equalFour(Array(4).fill({ A: [8, 9], B: [5, 6] }))],
    ['stableB', equalFour(Array(4).fill({ A: [5, 6], B: [8, 9] }))],
    ['criticalA', equalFour([{ A: [6, 8], B: [6, 6] }, ...Array(3).fill({ A: [5, 5], B: [5, 5] })])],
    ['criticalB', equalFour([{ A: [2, 6], B: [6, 6] }, ...Array(3).fill({ A: [5, 5], B: [5, 5] })])],
    ['unstable', equalFour([{ A: [0, 10], B: [0, 10] }, ...Array(3).fill({ A: [5, 5], B: [5, 5] })])],
    ['degenerate', equalFour(Array(4).fill({ A: [5, 5], B: [5, 5] }))],
  ];
  const seen = new Set();
  for (const [expected, input] of scenarios) {
    const r = analyzeInterval(input);
    assert.equal(r.verdict, expected, `期望 ${expected}，实际 ${r.verdict}`);
    seen.add(r.verdict);

    // 自洽性：分类与边界必须一致
    if (r.verdict === 'stableA') assert.ok(r.minDelta > 1e-9);
    if (r.verdict === 'stableB') assert.ok(r.maxDelta < -1e-9);
    if (r.verdict === 'unstable') assert.ok(r.minDelta < 0 && r.maxDelta > 0);
    if (r.verdict === 'criticalA') assert.ok(Math.abs(r.minDelta) <= 1e-9 && r.maxDelta > 0);
    if (r.verdict === 'criticalB') assert.ok(Math.abs(r.maxDelta) <= 1e-9 && r.minDelta < 0);
    if (r.verdict === 'degenerate') assert.ok(Math.abs(r.maxDelta - r.minDelta) <= 1e-9);

    // canTie 的定义：0 落在 [min,max] 内
    assert.equal(r.canTie, r.minDelta <= 1e-9 && r.maxDelta >= -1e-9, `${expected}.canTie`);
  }
  assert.equal(seen.size, 6, '六档必须全部出现');
});

test('-0 防护：任何 0 值都必须是正零，不是 -0', () => {
  const inputs = [
    equalFour(Array(4).fill({ A: [5, 5], B: [5, 5] })),                    // 全 0
    equalFour(Array(4).fill({ A: [0, 0], B: [0, 0] })),                    // 0 - 0
    equalFour([{ A: [3, 3], B: [3, 3] }, ...Array(3).fill({ A: [1, 1], B: [1, 1] })]),
    makeIntervalInput([                                                      // 零权重 + 零差
      { w: 1, A: [0, 10], B: [0, 10] },
      { w: 1, A: [0, 10], B: [0, 10] },
      { w: 1, A: [0, 10], B: [0, 10] },
      { w: 0, A: [10, 10], B: [10, 10] },
    ]),
    // ★ 真正能触发 -0 的输入：端点字面量写 -0。
    // `-0 - 0 === -0`，`10 * 0.25 * (-0) === -0`。
    // 注意：求和会把 [-0,-0,-0,-0] 归约成 +0，所以**顶层 minDelta 本来就不是 -0**，
    // 但**逐因素 minContribution 会是 -0** —— 这正是只规范化顶层会漏掉的地方。
    equalFour(Array(4).fill({ A: [-0, 0], B: [0, 0] })),
    makeIntervalInput([
      { w: 1, A: [-0, 0], B: [0, 0] },
      { w: 0, A: [5, 5], B: [5, 5] },
      { w: 0, A: [5, 5], B: [5, 5] },
      { w: 0, A: [5, 5], B: [5, 5] },
    ]),
    // 负零出现在 max 侧：hiA=+0, loB=-0
    equalFour(Array(4).fill({ A: [0, 0], B: [-0, 0] })),
  ];
  for (const [i, input] of inputs.entries()) {
    const r = analyzeInterval(input);
    for (const key of ['minDelta', 'maxDelta', 'pointDelta', 'spread']) {
      assert.equal(Object.is(r[key], -0), false, `case#${i}.${key} 是 -0`);
    }
    for (const [j, f] of r.factors.entries()) {
      for (const key of ['minContribution', 'maxContribution', 'midContribution', 'uncertaintyWidth']) {
        assert.equal(Object.is(f[key], -0), false, `case#${i}.factors[${j}].${key} 是 -0`);
      }
    }
  }
  // 反证：确认这些输入在没有规范化时**确实**会产生 -0（否则上面断言是空转）
  assert.equal(Object.is(-0 - 0, -0), true, '前提校验：-0 - 0 应为 -0');
  assert.equal(Object.is(10 * 0.25 * (-0), -0), true, '前提校验：10*share*(-0) 应为 -0');
  assert.equal(Object.is([-0, -0, -0, -0].reduce((s, v) => s + v, 0), -0), false,
    '前提校验：求和会把 -0 归约成 +0（所以只规范化顶层是不够的）');
});

test('spread 恒等于 maxDelta - minDelta 且非负', () => {
  for (let k = 0; k < 50; k += 1) {
    const rand = makeLcg(5150 + k * 7919);
    const n = 4 + Math.floor(rand() * 3);
    const factors = Array.from({ length: n }, () => {
      const loA = rand() * 10;
      const hiA = loA + rand() * (10 - loA);
      const loB = rand() * 10;
      const hiB = loB + rand() * (10 - loB);
      return { w: 1 + Math.floor(rand() * 9), A: [loA, hiA], B: [loB, hiB] };
    });
    const r = analyzeInterval(makeIntervalInput(factors));
    assert.ok(r.spread >= 0, `#${k} spread=${r.spread} 为负`);
    assertDelta(r.spread, r.maxDelta - r.minDelta, `#${k}.spread`);
  }
});

// ════════════════════════════════════════════════════════════════
// G. normalizeIntervalInput 单独校验
// ════════════════════════════════════════════════════════════════

test('normalizeIntervalInput：合法输入规范化正确', () => {
  const norm = normalizeIntervalInput(makeIntervalInput([
    { w: 4, A: [7, 9], B: [4, 5] },
    { w: 3, A: [5, 6], B: [6, 7] },
    { w: 2, A: [3, 3], B: [8, 8] },
    { w: 1, A: [5, 5], B: [5, 5] },
  ]));
  assert.equal(norm.totalWeight, 10);
  assert.equal(norm.factors.length, 4);
  assert.deepEqual(norm.options.map((o) => o.id), ['A', 'B']);
  // 区间原样保留
  assert.deepEqual(norm.factors[0].intervals, { A: [7, 9], B: [4, 5] });
  // 不修改入参
  const raw = makeIntervalInput([{ w: 1, A: [1, 2], B: [3, 4] }, ...Array(3).fill({ w: 1, A: [5, 5], B: [5, 5] })]);
  const snapshot = JSON.stringify(raw);
  normalizeIntervalInput(raw);
  assert.equal(JSON.stringify(raw), snapshot, '不应修改入参');
});

test('normalizeIntervalInput：结构错误各自报对应 code', () => {
  assertCode(() => normalizeIntervalInput(null), 'INVALID_INPUT', 'null');
  assertCode(() => normalizeIntervalInput([]), 'INVALID_INPUT', 'array');
  assertCode(() => normalizeIntervalInput({}), 'INVALID_OPTIONS', 'no options');
  assertCode(() => normalizeIntervalInput({ options: [{ label: 'a' }], factors: [] }), 'INVALID_OPTIONS', 'one option');
  assertCode(
    () => normalizeIntervalInput({ options: [{ label: 'a' }, { label: 'a' }], factors: [] }),
    'DUPLICATE_OPTION_LABEL', 'same label',
  );
  // 缺 factors
  assertCode(
    () => normalizeIntervalInput({ options: [{ label: 'a' }, { label: 'b' }] }),
    'INVALID_FACTORS', 'no factors',
  );
  // 区间结构错误
  const noIntervals = {
    options: [{ label: 'a' }, { label: 'b' }],
    factors: Array.from({ length: 4 }, (_, i) => ({ id: `f${i}`, label: `L${i}`, weight: 1 })),
  };
  assertCode(() => normalizeIntervalInput(noIntervals), 'INVALID_INTERVAL', 'no intervals');
  // 区间长度不是 2
  const badLen = makeIntervalInput([{ w: 1, A: [1, 2, 3], B: [5, 5] }, ...Array(3).fill({ w: 1, A: [5, 5], B: [5, 5] })]);
  assertCode(() => normalizeIntervalInput(badLen), 'INVALID_INTERVAL', 'interval length 3');
  // 权重非法
  const negW = makeIntervalInput([{ w: -1, A: [1, 2], B: [5, 5] }, ...Array(3).fill({ w: 1, A: [5, 5], B: [5, 5] })]);
  assertCode(() => normalizeIntervalInput(negW), 'NEGATIVE_WEIGHT', 'negative weight');
  const nanW = makeIntervalInput([{ w: NaN, A: [1, 2], B: [5, 5] }, ...Array(3).fill({ w: 1, A: [5, 5], B: [5, 5] })]);
  assertCode(() => normalizeIntervalInput(nanW), 'INVALID_WEIGHT', 'nan weight');
  const bigW = makeIntervalInput([{ w: 1e7, A: [1, 2], B: [5, 5] }, ...Array(3).fill({ w: 1, A: [5, 5], B: [5, 5] })]);
  assertCode(() => normalizeIntervalInput(bigW), 'WEIGHT_TOO_LARGE', 'too large weight');
  // 重复 id / 空 label / 过长 label
  const dupId = makeIntervalInput(Array.from({ length: 4 }, () => ({ id: 'same', w: 1, A: [5, 5], B: [5, 5] })));
  assertCode(() => normalizeIntervalInput(dupId), 'DUPLICATE_FACTOR_ID', 'dup id');
  const emptyLabel = makeIntervalInput([{ label: '   ', w: 1, A: [5, 5], B: [5, 5] }, ...Array(3).fill({ w: 1, A: [5, 5], B: [5, 5] })]);
  assertCode(() => normalizeIntervalInput(emptyLabel), 'INVALID_FACTOR_LABEL', 'empty label');
  const longLabel = makeIntervalInput([{ label: 'x'.repeat(61), w: 1, A: [5, 5], B: [5, 5] }, ...Array(3).fill({ w: 1, A: [5, 5], B: [5, 5] })]);
  assertCode(() => normalizeIntervalInput(longLabel), 'INVALID_FACTOR_LABEL', 'long label');
  // 边界长度 60 必须合法
  const okLabel = makeIntervalInput([{ label: 'x'.repeat(60), w: 1, A: [5, 5], B: [5, 5] }, ...Array(3).fill({ w: 1, A: [5, 5], B: [5, 5] })]);
  assert.doesNotThrow(() => normalizeIntervalInput(okLabel), '60 字 label 应合法');
});

test('normalizeIntervalInput 复用 core 的 ValidationError 类型（UI 可统一处理）', () => {
  try {
    analyzeInterval({ options: [], factors: [] });
    assert.fail('应当抛错');
  } catch (err) {
    assert.ok(err instanceof ValidationError, '必须是 core 导出的 ValidationError 实例');
    assert.equal(typeof err.code, 'string');
    assert.equal(err.name, 'ValidationError');
  }
});

// ════════════════════════════════════════════════════════════════
// H. 纯函数性
// ════════════════════════════════════════════════════════════════

test('纯函数性：同样输入重复调用结果完全一致，且不修改入参', () => {
  const input = makeIntervalInput([
    { w: 4, A: [7, 9], B: [4, 5] },
    { w: 3, A: [5, 6], B: [6, 7] },
    { w: 2, A: [3, 3], B: [8, 8] },
    { w: 1, A: [5, 5], B: [5, 5] },
  ]);
  const snapshot = JSON.stringify(input);
  const a = analyzeInterval(input);
  const b = analyzeInterval(input);
  assert.deepEqual(a, b, '两次调用结果应完全一致');
  assert.equal(JSON.stringify(input), snapshot, '不应修改入参');
});
