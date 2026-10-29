/**
 * Decision Arena — core.mjs 单元测试
 *
 * 运行：node --test tests/core/
 * 约定：所有断言都基于「任务书给出的数学定义」，而不是 core.mjs 的实现细节。
 *      能写成不变式（invariant）的，一律用不变式 + 独立重算，避免把 bug 固化进期望值。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  scoreDecision,
  normalizeInput,
  projectAtShare,
  findFlipThresholds,
  rankFlipCandidates,
  pickFlipHighlight,
  chooseValidationHypothesis,
  applyEqualWeights,
  validate,
  createEmptyDecision,
  ValidationError,
  TIE_EPSILON,
  MIN_FACTORS,
  MAX_FACTORS,
} from '../../site/core.mjs';

/* ─────────────────────────── 测试夹具 ─────────────────────────── */

/** 与题面一致的基准夹具：A 领先 23.33 分，f3 是唯一有杠杆的因素 */
const FIXTURE_MAIN = {
  title: '要不要换工作',
  options: [{ label: '留在大厂' }, { label: '去小公司' }],
  factors: [
    { id: 'f1', label: '薪资', weight: 5, ratings: { A: 9, B: 4 } },
    { id: 'f2', label: '成长', weight: 3, ratings: { A: 8, B: 5 } },
    { id: 'f3', label: '通勤', weight: 2, ratings: { A: 3, B: 7 } },
    { id: 'f4', label: '团队', weight: 2, ratings: { A: 6, B: 5 } },
  ],
};

/** 4 个等权、评分全部相同的因素，用作可变基线 */
function equalFactors() {
  return [
    { id: 'a', label: 'a', weight: 1, ratings: { A: 5, B: 5 } },
    { id: 'b', label: 'b', weight: 1, ratings: { A: 5, B: 5 } },
    { id: 'c', label: 'c', weight: 1, ratings: { A: 5, B: 5 } },
    { id: 'd', label: 'd', weight: 1, ratings: { A: 5, B: 5 } },
  ];
}

/** 生成一份合法输入；factors 可整体替换 */
function makeInput(factors, options = [{ label: '甲' }, { label: '乙' }]) {
  return { options, factors };
}

/** 只有一个因素有非零权重，其余三个权重为 0 */
function soleFactorInput() {
  return makeInput([
    { id: 's', label: '唯一权重', weight: 7, ratings: { A: 9, B: 2 } },
    { id: 'z1', label: '零权重 1', weight: 0, ratings: { A: 0, B: 10 } },
    { id: 'z2', label: '零权重 2', weight: 0, ratings: { A: 5, B: 5 } },
    { id: 'z3', label: '零权重 3', weight: 0, ratings: { A: 10, B: 0 } },
  ]);
}

/** 断言抛出指定 code 的 ValidationError */
function assertCode(fn, code, message) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof ValidationError, `${message}：应抛出 ValidationError，实际是 ${error?.name}`);
    assert.equal(error.code, code, `${message}：错误码应为 ${code}，实际是 ${error.code}`);
    return true;
  }, message);
}

/** 独立重算：按数学定义实现一遍，用来和 core.mjs 对拍 */
function manualScores(raw) {
  const total = raw.factors.reduce((sum, f) => sum + f.weight, 0);
  const weightedA = raw.factors.reduce((sum, f) => sum + f.weight * f.ratings.A, 0);
  const weightedB = raw.factors.reduce((sum, f) => sum + f.weight * f.ratings.B, 0);
  return { scoreA: (10 * weightedA) / total, scoreB: (10 * weightedB) / total };
}

/** 独立重算单个因素的 d_others 与 t* */
function manualThreshold(raw, factorId) {
  const target = raw.factors.find((f) => f.id === factorId);
  const others = raw.factors.filter((f) => f.id !== factorId);
  const othersWeight = others.reduce((sum, f) => sum + f.weight, 0);
  const othersGap = others.reduce((sum, f) => sum + f.weight * (f.ratings.A - f.ratings.B), 0);
  const dk = target.ratings.A - target.ratings.B;
  const dOthers = othersGap / othersWeight;
  return { dk, dOthers, tStar: -dOthers / (dk - dOthers), currentShare: target.weight / raw.factors.reduce((s, f) => s + f.weight, 0) };
}

/** 确定性 LCG（数值取自 Numerical Recipes），不用 Math.random */
function makeLcg(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** 用 LCG 生成一整份随机但可复现的输入 */
function randomInput(seed) {
  const rand = makeLcg(seed);
  const count = MIN_FACTORS + Math.floor(rand() * (MAX_FACTORS - MIN_FACTORS + 1));
  const factors = [];
  for (let i = 0; i < count; i += 1) {
    factors.push({
      id: `f${i + 1}`,
      label: `因素 ${i + 1}`,
      weight: Math.floor(rand() * 11),
      ratings: { A: Math.floor(rand() * 11), B: Math.floor(rand() * 11) },
    });
  }
  if (factors.every((f) => f.weight === 0)) {
    factors[0].weight = 1 + Math.floor(rand() * 5);
  }
  return makeInput(factors);
}

/** 递归检查一个值里有没有 NaN / Infinity / undefined */
function findNonFinite(value, path = '$', hits = []) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) hits.push(`${path}=${value}`);
  } else if (value === undefined) {
    hits.push(`${path}=undefined`);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => findNonFinite(item, `${path}[${index}]`, hits));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) findNonFinite(item, `${path}.${key}`, hits);
  }
  return hits;
}

/* ─────────────────────── 1. 权重归一化 ─────────────────────── */

test('权重归一化：normalizedWeights 之和为 1，且与 w[i]/Σw 逐个相符', () => {
  const result = scoreDecision(FIXTURE_MAIN);
  const total = FIXTURE_MAIN.factors.reduce((sum, f) => sum + f.weight, 0);

  assert.equal(result.totalWeight, 12);
  const sum = result.normalizedWeights.reduce((acc, item) => acc + item.share, 0);
  assert.ok(Math.abs(sum - 1) < 1e-12, `权重占比之和应为 1，实际 ${sum}`);

  for (const [index, factor] of FIXTURE_MAIN.factors.entries()) {
    const item = result.normalizedWeights[index];
    assert.equal(item.factorId, factor.id);
    assert.ok(Math.abs(item.share - factor.weight / total) < 1e-15,
      `${factor.id} 的占比应为 ${factor.weight / total}，实际 ${item.share}`);
  }
  // 非等权才真正检验归一化：占比不能等于原始权重
  assert.ok(Math.abs(result.normalizedWeights[0].share - 5) > 1, '占比必须是归一化后的值，不是原始权重');
});

/* ─────────────────── 2–3. 单评分边界 0 / 10 ─────────────────── */

test('单评分边界 0：全部 rating 为 0 时两个总分都是 0 且判平', () => {
  const factors = equalFactors().map((f) => ({ ...f, ratings: { A: 0, B: 0 } }));
  const result = scoreDecision(makeInput(factors));

  assert.equal(result.scoreA, 0);
  assert.equal(result.scoreB, 0);
  assert.equal(result.difference, 0);
  assert.equal(result.tie, true);
  assert.equal(result.winner, 'tie');
});

test('单评分边界 10：某一侧全为 10 时总分为 100，另一侧为 0', () => {
  const factors = equalFactors().map((f) => ({ ...f, ratings: { A: 10, B: 0 } }));
  const allA = scoreDecision(makeInput(factors));

  assert.equal(allA.scoreA, 100);
  assert.equal(allA.scoreB, 0);
  assert.ok(Math.abs(allA.difference - 100) < 1e-12);
  assert.equal(allA.winner, 'A');

  // 交换后应镜像
  const factorsB = equalFactors().map((f) => ({ ...f, ratings: { A: 0, B: 10 } }));
  const allB = scoreDecision(makeInput(factorsB));
  assert.equal(allB.scoreA, 0);
  assert.equal(allB.scoreB, 100);
  assert.equal(allB.winner, 'B');
});

test('评分 10 与非等权：总分为 100 与权重分配无关，且不超过 100', () => {
  const factors = [
    { id: 'a', label: 'a', weight: 13, ratings: { A: 10, B: 10 } },
    { id: 'b', label: 'b', weight: 1, ratings: { A: 10, B: 10 } },
    { id: 'c', label: 'c', weight: 7, ratings: { A: 10, B: 10 } },
    { id: 'd', label: 'd', weight: 3, ratings: { A: 10, B: 10 } },
  ];
  const result = scoreDecision(makeInput(factors));
  assert.ok(result.scoreA <= 100 + 1e-9 && result.scoreA >= 100 - 1e-9, `实际 ${result.scoreA}`);
  assert.ok(result.scoreB <= 100 + 1e-9 && result.scoreB >= 100 - 1e-9, `实际 ${result.scoreB}`);
});

/* ───────────────────── 4. 相同评分判平 ───────────────────── */

test('相同评分判平：所有因素 A/B 评分相同时 difference=0、tie=true、winner=tie', () => {
  const result = scoreDecision(makeInput(equalFactors()));

  assert.equal(result.difference, 0);
  assert.equal(result.magnitude, 0);
  assert.equal(result.tie, true);
  assert.equal(result.winner, 'tie');
  assert.equal(result.closeness, 'tie');
  assert.equal(result.scoreA, 50);
  assert.equal(result.scoreB, 50);
});

test('相同评分但权重悬殊时仍然判平（归一化后差为 0）', () => {
  const factors = [
    { id: 'a', label: 'a', weight: 999, ratings: { A: 7, B: 7 } },
    { id: 'b', label: 'b', weight: 1, ratings: { A: 7, B: 7 } },
    { id: 'c', label: 'c', weight: 0, ratings: { A: 7, B: 7 } },
    { id: 'd', label: 'd', weight: 500, ratings: { A: 7, B: 7 } },
  ];
  const result = scoreDecision(makeInput(factors));
  assert.ok(Math.abs(result.difference) < TIE_EPSILON);
  assert.equal(result.tie, true);
  assert.equal(result.winner, 'tie');
});

/* ─────────────── 5. 权重整体等比缩放结果不变 ─────────────── */

test('权重整体等比缩放：分数、差值、占比完全不变', () => {
  const base = scoreDecision(FIXTURE_MAIN);
  for (const scale of [0.001, 0.5, 1000, 50000]) {
    const scaled = {
      ...FIXTURE_MAIN,
      factors: FIXTURE_MAIN.factors.map((f) => ({ ...f, weight: f.weight * scale })),
    };
    const result = scoreDecision(scaled);
    assert.ok(Math.abs(result.scoreA - base.scoreA) < 1e-9, `scale=${scale} scoreA`);
    assert.ok(Math.abs(result.scoreB - base.scoreB) < 1e-9, `scale=${scale} scoreB`);
    assert.ok(Math.abs(result.difference - base.difference) < 1e-9, `scale=${scale} difference`);
    assert.equal(result.winner, base.winner);
    assert.ok(Math.abs(result.totalWeight - base.totalWeight * scale) < 1e-6, `scale=${scale} totalWeight`);
    for (const [index, item] of result.normalizedWeights.entries()) {
      assert.ok(Math.abs(item.share - base.normalizedWeights[index].share) < 1e-15,
        `scale=${scale} ${item.factorId} 占比应不变`);
    }
  }
});

test('权重整体等比缩放：t* 与 feasible 判定不变（算法应只看占比）', () => {
  const base = findFlipThresholds(FIXTURE_MAIN);
  const scaled = findFlipThresholds({
    ...FIXTURE_MAIN,
    factors: FIXTURE_MAIN.factors.map((f) => ({ ...f, weight: f.weight * 1000 })),
  });

  assert.equal(scaled.length, base.length);
  for (const [index, item] of scaled.entries()) {
    assert.equal(item.factorId, base[index].factorId);
    assert.equal(item.feasible, base[index].feasible, `${item.factorId} feasible 应不变`);
    assert.equal(item.code, base[index].code, `${item.factorId} code 应不变`);
    assert.ok(Math.abs(item.currentShare - base[index].currentShare) < 1e-15, `${item.factorId} currentShare 应不变`);
    if (base[index].thresholdShare === null) {
      assert.equal(item.thresholdShare, null);
    } else {
      assert.ok(Math.abs(item.thresholdShare - base[index].thresholdShare) < 1e-9,
        `${item.factorId} t* 应不变`);
    }
  }
});

/* ───────────────── 6. 主导因素压倒弱因素 ───────────────── */

test('主导因素压倒弱因素：权重 97:3 时高分一侧获胜，且分数接近满分', () => {
  const factors = [
    { id: 'd1', label: '主导', weight: 97, ratings: { A: 10, B: 0 } },
    { id: 'd2', label: '弱 1', weight: 1, ratings: { A: 0, B: 10 } },
    { id: 'd3', label: '弱 2', weight: 1, ratings: { A: 0, B: 10 } },
    { id: 'd4', label: '弱 3', weight: 1, ratings: { A: 0, B: 10 } },
  ];
  const result = scoreDecision(makeInput(factors));

  assert.equal(result.winner, 'A');
  assert.ok(result.scoreA > 95, `主导因素 10 分应把 A 拉到 95 分以上，实际 ${result.scoreA}`);
  assert.ok(result.scoreB < 5, `弱因素最多只能贡献不到 5 分，实际 ${result.scoreB}`);
  assert.ok(result.difference > 90, `差值应远大于 90，实际 ${result.difference}`);
  // 单项贡献：主导因素贡献 97% 的权重
  const dominant = result.contributions.find((c) => c.factorId === 'd1');
  assert.ok(Math.abs(dominant.delta - 97) < 1e-9, `主导因素贡献应为 100*0.97 = 97，实际 ${dominant.delta}`);
});

test('主导因素压倒弱因素：小权重也可能翻盘（t*=1/3），翻不动要由 t* 越界决定而非权重大小', () => {
  // 反直觉但正确：60/10/10/10 的夹具里，弱因素 d2 只有 10 权重，却是可行临界点。
  // 机制不是"比大小"，而是把占比 t 给 d2、其余 1-t 按原比例分给 d1/d3/d4。
  //   dk      = 1 - 10 = -9
  //   dOthers = (60*9 + 10*(-9) + 10*(-9)) / 80 = 4.5
  //   t*      = -4.5 / (-9 - 4.5) = 1/3  ∈ (0,1)  → 可行
  const factors = [
    { id: 'd1', label: '主导', weight: 60, ratings: { A: 10, B: 1 } },
    { id: 'd2', label: '弱 1', weight: 10, ratings: { A: 1, B: 10 } },
    { id: 'd3', label: '弱 2', weight: 10, ratings: { A: 1, B: 10 } },
    { id: 'd4', label: '弱 3', weight: 10, ratings: { A: 1, B: 10 } },
  ];
  const raw = makeInput(factors);
  const byId = Object.fromEntries(findFlipThresholds(raw).map((t) => [t.factorId, t]));

  assert.equal(byId.d1.feasible, true, '主导因素应存在可行临界点');
  for (const weak of ['d2', 'd3', 'd4']) {
    assert.equal(byId[weak].feasible, true,
      `${weak} 权重虽只有 10，但 t*=1/3 落在 (0,1) 内，属于合法临界点`);
    assert.ok(Math.abs(byId[weak].thresholdShare - 1 / 3) < 1e-12,
      `${weak} 的解析解应为 1/3，实际 ${byId[weak].thresholdShare}`);
    // 代回必须打平，且两侧翻转——这才是"能翻盘"的真正判据
    const at = projectAtShare(raw, weak, byId[weak].thresholdShare);
    assert.ok(Math.abs(at.difference) < 1e-6, `${weak} 在 t*=1/3 处应打平，实际 ${at.difference}`);
    assert.ok(projectAtShare(raw, weak, 0.32).difference > 0, `${weak} 在 t* 之下仍 A 领先`);
    assert.ok(projectAtShare(raw, weak, 0.35).difference < 0, `${weak} 越过 t* 后应翻成 B 领先`);
  }
});

test('真正"翻不动"的弱因素：评分差与多数项同向导致 t* 落到 (0,1) 之外', () => {
  // 让弱因素 d2 与主导因素 d1 同向（都偏 A），它就没有反向杠杆可用了：
  //   dk(d2)  = 1
  //   dOthers = (60*6 + 10*0 + 10*0) / 80 = 4.5
  //   t*      = -4.5 / (1 - 4.5) = 1.2857… > 1  → OUT_OF_RANGE，翻不动
  const raw = makeInput([
    { id: 'd1', label: '主导', weight: 60, ratings: { A: 10, B: 4 } },
    { id: 'd2', label: '同向弱', weight: 10, ratings: { A: 5, B: 4 } },
    { id: 'd3', label: '中性 1', weight: 10, ratings: { A: 5, B: 5 } },
    { id: 'd4', label: '中性 2', weight: 10, ratings: { A: 5, B: 5 } },
  ]);
  const byId = Object.fromEntries(findFlipThresholds(raw).map((t) => [t.factorId, t]));

  assert.equal(byId.d2.feasible, false, 't*=1.2857>1，在可调范围内翻不动');
  assert.equal(byId.d2.code, 'OUT_OF_RANGE');
  assert.ok(Math.abs(byId.d2.thresholdShare - 9 / 7) < 1e-12,
    `解析解应为 9/7≈1.2857，实际 ${byId.d2.thresholdShare}`);
  // 端点也证实翻不动：t=0 与 t=1 都是 A 领先
  assert.ok(projectAtShare(raw, 'd2', 0).difference > 0, 't=0 时仍 A 领先');
  assert.ok(projectAtShare(raw, 'd2', 1).difference > 0, 't=1 时仍 A 领先（弱因素拉不回来）');
});

/* ──────────────── 7–9. 合法 t* 的三条性质 ──────────────── */

test('存在合法 t*：t* 落在 (0,1) 内，且与解析解 t* = -d_others/(d_k-d_others) 一致', () => {
  const thresholds = findFlipThresholds(FIXTURE_MAIN).filter((t) => t.feasible);

  assert.equal(thresholds.length, 1, '基准夹具应恰好有一个可行因素 f3');
  const f3 = thresholds[0];
  assert.equal(f3.factorId, 'f3');
  assert.equal(f3.code, 'FEASIBLE');
  assert.ok(f3.thresholdShare > 0 && f3.thresholdShare < 1, `t* 必须在 (0,1)，实际 ${f3.thresholdShare}`);

  const { tStar } = manualThreshold(FIXTURE_MAIN, 'f3');
  assert.ok(Math.abs(f3.thresholdShare - tStar) < 1e-12, `解析解应为 ${tStar}，实际 ${f3.thresholdShare}`);
  assert.ok(Math.abs(tStar - 0.4736842105263158) < 1e-12, '解析解应约为 0.4737');
});

test('把 t* 代回 projectAtShare 应得 |difference| < 1e-6', () => {
  const feasible = findFlipThresholds(FIXTURE_MAIN).filter((t) => t.feasible);
  assert.ok(feasible.length > 0, '需要至少一个可行因素');

  for (const item of feasible) {
    const projected = projectAtShare(FIXTURE_MAIN, item.factorId, item.thresholdShare);
    assert.ok(projected.scoreA >= 0 && projected.scoreA <= 100, `${item.factorId} scoreA 越界：${projected.scoreA}`);
    assert.ok(Math.abs(projected.difference) < 1e-6,
      `把 ${item.factorId} 的占比设成 t*=${item.thresholdShare} 应打平，实际 difference=${projected.difference}`);
    // 打平点上两侧总分应该相等，而不只是差值为 0
    assert.ok(Math.abs(projected.scoreA - projected.scoreB) < 1e-6);
  }
});

test('t* 两侧（t*±0.05）符号相反：越过临界点偏好翻转', () => {
  // 用 5 因素夹具，保证 t*=0.1765 时 ±0.05 不越界
  const five = makeInput([
    { id: 'f1', label: '薪资', weight: 5, ratings: { A: 9, B: 4 } },
    { id: 'f2', label: '成长', weight: 3, ratings: { A: 8, B: 5 } },
    { id: 'f3', label: '通勤', weight: 2, ratings: { A: 3, B: 7 } },
    { id: 'f4', label: '团队', weight: 2, ratings: { A: 6, B: 5 } },
    { id: 'f5', label: '城市', weight: 4, ratings: { A: 2, B: 8 } },
  ]);
  const target = findFlipThresholds(five).find((t) => t.factorId === 'f3');
  assert.ok(target.feasible, 'f3 应为可行临界点');
  assert.ok(target.thresholdShare - 0.05 > 0 && target.thresholdShare + 0.05 < 1,
    '夹具应保证 ±0.05 仍在合法区间内');

  const below = projectAtShare(five, 'f3', target.thresholdShare - 0.05);
  const above = projectAtShare(five, 'f3', target.thresholdShare + 0.05);
  const at = projectAtShare(five, 'f3', target.thresholdShare);

  assert.ok(Math.abs(at.difference) < 1e-6, '临界点本身应打平');
  assert.notEqual(Math.sign(below.difference), 0);
  assert.notEqual(Math.sign(above.difference), 0);
  assert.equal(Math.sign(below.difference), -Math.sign(above.difference),
    `两侧符号应相反，实际 ${below.difference} / ${above.difference}`);
  // 方向语义：t* 是 increase 时，低于 t* 应维持原来的 A 领先
  const current = scoreDecision(five).difference;
  assert.ok(Math.sign(current) > 0, '当前应为 A 领先');
  assert.ok(below.difference > 0, '低于 t* 时仍应 A 领先');
  assert.ok(above.difference < 0, '高于 t* 时应翻成 B 领先');
});

test('t* 是打平点而非翻转点：当前占用率处 difference 与 scoreDecision 一致', () => {
  const analysis = scoreDecision(FIXTURE_MAIN);
  for (const item of findFlipThresholds(FIXTURE_MAIN)) {
    const projected = projectAtShare(FIXTURE_MAIN, item.factorId, item.currentShare);
    assert.ok(Math.abs(projected.scoreA - analysis.scoreA) < 1e-9, `${item.factorId} scoreA 不一致`);
    assert.ok(Math.abs(projected.scoreB - analysis.scoreB) < 1e-9, `${item.factorId} scoreB 不一致`);
    assert.ok(Math.abs(projected.difference - analysis.difference) < 1e-9, `${item.factorId} difference 不一致`);
  }
});

/* ────────── 10. 不存在阈值：各因素差同号、无杠杆 ────────── */

test('不存在阈值：所有因素评分差同号时每个因素都不可行，且 t* 全在 [0,1] 之外', () => {
  const factors = [
    { id: 'a', label: 'a', weight: 3, ratings: { A: 9, B: 5 } },
    { id: 'b', label: 'b', weight: 2, ratings: { A: 8, B: 4 } },
    { id: 'c', label: 'c', weight: 4, ratings: { A: 7, B: 6 } },
    { id: 'd', label: 'd', weight: 1, ratings: { A: 10, B: 2 } },
  ];
  const raw = makeInput(factors);
  const thresholds = findFlipThresholds(raw);

  assert.equal(thresholds.length, factors.length);
  const analysis = scoreDecision(raw);
  assert.ok(analysis.difference > 0, '夹具本身应明显 A 领先');

  for (const item of thresholds) {
    assert.equal(item.feasible, false, `${item.factorId} 不应可行`);
    assert.equal(item.code, 'OUT_OF_RANGE', `${item.factorId} 应报 OUT_OF_RANGE`);
    assert.notEqual(item.thresholdShare, null, '解析解仍应给出 t*');
    assert.ok(item.thresholdShare < 0 || item.thresholdShare > 1,
      `${item.factorId} 的 t* 应落在 [0,1] 之外，实际 ${item.thresholdShare}`);
    // 边界处（t=0 和 t=1）都翻不过来
    assert.ok(projectAtShare(raw, item.factorId, 0).difference > 0, `${item.factorId} 在 t=0 仍应 A 领先`);
    assert.ok(projectAtShare(raw, item.factorId, 1).difference > 0, `${item.factorId} 在 t=1 仍应 A 领先`);
  }

  assert.equal(pickFlipHighlight(thresholds), null, '没有可行项时 highlight 必须是 null');
});

test('不存在阈值：所有因素评分差相同（无杠杆）报 NO_LEVERAGE，且不含 NaN', () => {
  const factors = [
    { id: 'a', label: 'a', weight: 1, ratings: { A: 7, B: 5 } },
    { id: 'b', label: 'b', weight: 2, ratings: { A: 7, B: 5 } },
    { id: 'c', label: 'c', weight: 3, ratings: { A: 7, B: 5 } },
    { id: 'd', label: 'd', weight: 4, ratings: { A: 7, B: 5 } },
  ];
  const raw = makeInput(factors);
  const thresholds = findFlipThresholds(raw);

  for (const item of thresholds) {
    assert.equal(item.code, 'NO_LEVERAGE');
    assert.equal(item.feasible, false);
    assert.equal(item.thresholdShare, null, '无杠杆时不应给出 t*');
    assert.equal(item.distance, null);
    assert.equal(Number.isNaN(item.currentShare), false);
  }
  assert.equal(findNonFinite(thresholds).length, 0, findNonFinite(thresholds).join(', '));
  assert.equal(pickFlipHighlight(thresholds), null);
});

/* ─────────────────── 11. 校验类错误码 ─────────────────── */

test('全零权重抛 ALL_ZERO_WEIGHTS', () => {
  const factors = equalFactors().map((f) => ({ ...f, weight: 0 }));
  assertCode(() => scoreDecision(makeInput(factors)), 'ALL_ZERO_WEIGHTS', '全零权重');
  // 负零也属于零
  const negZero = equalFactors().map((f) => ({ ...f, weight: -0 }));
  assertCode(() => scoreDecision(makeInput(negZero)), 'ALL_ZERO_WEIGHTS', '负零权重');
  // projectAtShare / findFlipThresholds 也必须先校验
  assertCode(() => findFlipThresholds(makeInput(factors)), 'ALL_ZERO_WEIGHTS', '全零权重 findFlipThresholds');
  assertCode(() => projectAtShare(makeInput(factors), 'a', 0.5), 'ALL_ZERO_WEIGHTS', '全零权重 projectAtShare');
});

test('负权重抛 NEGATIVE_WEIGHT，且 details 记录下标与数值', () => {
  const factors = equalFactors();
  factors[2].weight = -3;
  assert.throws(() => scoreDecision(makeInput(factors)), (error) => {
    assert.ok(error instanceof ValidationError);
    assert.equal(error.code, 'NEGATIVE_WEIGHT');
    assert.equal(error.details.index, 2);
    assert.equal(error.details.weight, -3);
    return true;
  });
  // 极小负数（不是 -0）也必须拒绝
  const tinyNegative = equalFactors();
  tinyNegative[0].weight = -1e-300;
  assertCode(() => scoreDecision(makeInput(tinyNegative)), 'NEGATIVE_WEIGHT', '极小负权重');
});

test('NaN / Infinity 权重抛 INVALID_WEIGHT；NaN / Infinity 评分抛 INVALID_RATING', () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    const factors = equalFactors();
    factors[1].weight = bad;
    assertCode(() => scoreDecision(makeInput(factors)), 'INVALID_WEIGHT', `权重 ${bad}`);
  }
  // 非数字类型也归到 INVALID_WEIGHT
  for (const bad of ['5', null, undefined, {}, true]) {
    const factors = equalFactors();
    factors[1].weight = bad;
    assertCode(() => scoreDecision(makeInput(factors)), 'INVALID_WEIGHT', `权重类型 ${String(bad)}`);
  }
  for (const bad of [NaN, Infinity, -Infinity]) {
    const factors = equalFactors();
    factors[1].ratings.A = bad;
    assertCode(() => scoreDecision(makeInput(factors)), 'INVALID_RATING', `评分 ${bad}`);
  }
  // 缺失评分
  const missing = equalFactors();
  delete missing[1].ratings.B;
  assertCode(() => scoreDecision(makeInput(missing)), 'INVALID_RATING', '缺失评分');
});

test('仅一个非零权重抛... 不：应报 SOLE_FACTOR 且不出现除零/NaN', () => {
  const raw = soleFactorInput();
  const analysis = scoreDecision(raw);
  assert.ok(Number.isFinite(analysis.scoreA) && Number.isFinite(analysis.scoreB));
  assert.equal(analysis.scoreA, 90); // 唯一权重因素 A=9 -> 10*1*9
  assert.equal(analysis.scoreB, 20);
  assert.equal(findNonFinite(analysis).length, 0, findNonFinite(analysis).join(', '));

  const thresholds = findFlipThresholds(raw);
  const sole = thresholds.find((t) => t.factorId === 's');
  assert.equal(sole.code, 'SOLE_FACTOR');
  assert.equal(sole.feasible, false);
  assert.equal(sole.thresholdShare, null);
  assert.equal(sole.distance, null);
  assert.equal(Number.isNaN(sole.currentShare), false);
  assert.equal(sole.currentShare, 1);
  // 其余权重为 0 的因素不应抛除零，而且必须有确定的 code
  for (const item of thresholds) {
    assert.ok(typeof item.code === 'string' && item.code.length > 0, `${item.factorId} 必须有 code`);
    assert.equal(findNonFinite(item).length, 0, `${item.factorId} 含非有限值`);
  }
  // 全零权重才是错误；只有一个是非零时不报错
  assert.doesNotThrow(() => findFlipThresholds(raw));
});

test('评分越界抛 RATING_OUT_OF_RANGE（含 0/10 的紧邻外侧）', () => {
  for (const [key, bad] of [['A', -0.0001], ['B', 10.0001], ['A', 11], ['B', -1]]) {
    const factors = equalFactors();
    factors[0].ratings[key] = bad;
    assert.throws(() => scoreDecision(makeInput(factors)), (error) => {
      assert.equal(error.code, 'RATING_OUT_OF_RANGE');
      assert.equal(error.details.key, key);
      assert.equal(error.details.value, bad);
      return true;
    }, `评分 ${key}=${bad}`);
  }
  // 边界值 0 与 10 本身必须合法
  const edges = equalFactors();
  edges[0].ratings = { A: 0, B: 10 };
  edges[1].ratings = { A: 10, B: 0 };
  assert.doesNotThrow(() => scoreDecision(makeInput(edges)));
});

/* ─────────── 12. 交换 A/B：difference 变号、magnitude 相等 ─────────── */

test('交换 A/B：difference 变号、magnitude 相等、winner 对调', () => {
  const swapped = {
    ...FIXTURE_MAIN,
    factors: FIXTURE_MAIN.factors.map((f) => ({ ...f, ratings: { A: f.ratings.B, B: f.ratings.A } })),
  };
  const original = scoreDecision(FIXTURE_MAIN);
  const mirrored = scoreDecision(swapped);

  assert.ok(Math.abs(original.difference + mirrored.difference) < 1e-9,
    `difference 应互为相反数：${original.difference} vs ${mirrored.difference}`);
  assert.ok(Math.abs(original.magnitude - mirrored.magnitude) < 1e-9, 'magnitude 应相等');
  // magnitude 必须严格等于 |difference|（不能是别的缩放），且非负
  assert.equal(original.magnitude, Math.abs(original.difference));
  assert.equal(mirrored.magnitude, Math.abs(mirrored.difference));
  assert.ok(original.magnitude > 0, '该夹具差值非零');
  assert.equal(original.magnitude, 23.33333333333333, 'magnitude 应为 70/3，不能有任何放大/缩小');
  assert.equal(mirrored.winner, 'B');
  assert.equal(mirrored.closeness, original.closeness);
  assert.ok(Math.abs(original.scoreA - mirrored.scoreB) < 1e-9);
  assert.ok(Math.abs(original.scoreB - mirrored.scoreA) < 1e-9);
});

test('交换 A/B：每个因素的 t* 不变，但 direction 与翻盘方向对调', () => {
  const swapped = {
    ...FIXTURE_MAIN,
    factors: FIXTURE_MAIN.factors.map((f) => ({ ...f, ratings: { A: f.ratings.B, B: f.ratings.A } })),
  };
  const before = findFlipThresholds(FIXTURE_MAIN);
  const after = findFlipThresholds(swapped);

  for (const [index, item] of before.entries()) {
    const mirror = after[index];
    assert.equal(mirror.factorId, item.factorId);
    if (item.thresholdShare !== null) {
      assert.ok(Math.abs(mirror.thresholdShare - item.thresholdShare) < 1e-9,
        `${item.factorId} 的 t* 不应随 A/B 交换而改变`);
    }
    assert.equal(mirror.feasible, item.feasible);
    if (item.feasible) {
      assert.equal(mirror.direction, item.direction);
      // 原 side 在 t* 之下领先，交换后应是 B 在 t* 之下领先
      const probeBelow = Math.max(0.001, item.thresholdShare - 0.01);
      const originalBelow = projectAtShare(FIXTURE_MAIN, item.factorId, probeBelow).difference;
      const mirrorBelow = projectAtShare(swapped, item.factorId, probeBelow).difference;
      assert.ok(Math.abs(originalBelow + mirrorBelow) < 1e-9, `${item.factorId} 交换后差值应变号`);
    }
  }
});

/* ───────────── 13–16. 结构化校验补充用例 ───────────── */

test('因素数 3 个和 7 个都抛 FACTOR_COUNT，4–6 个合法', () => {
  const three = equalFactors().slice(0, 3);
  const seven = [...equalFactors(), ...equalFactors().slice(0, 3).map((f, i) => ({ ...f, id: `x${i}` }))];
  assertCode(() => scoreDecision(makeInput(three)), 'FACTOR_COUNT', '3 个因素');
  assertCode(() => scoreDecision(makeInput(seven)), 'FACTOR_COUNT', '7 个因素');

  assert.throws(() => scoreDecision(makeInput(three)), (error) => {
    assert.equal(error.details.count, 3);
    return true;
  });
  assert.throws(() => scoreDecision(makeInput(seven)), (error) => {
    assert.equal(error.details.count, 7);
    return true;
  });

  for (const count of [4, 5, 6]) {
    const factors = Array.from({ length: count }, (_, i) => ({
      id: `f${i + 1}`, label: `F${i + 1}`, weight: 1, ratings: { A: 5, B: 5 },
    }));
    assert.doesNotThrow(() => scoreDecision(makeInput(factors)), `${count} 个因素应合法`);
    assert.equal(normalizeInput(makeInput(factors)).factors.length, count);
  }
});

test('选项同名抛 DUPLICATE_OPTION_LABEL（trim 后相同也算）', () => {
  const factors = equalFactors();
  assertCode(() => scoreDecision(makeInput(factors, [{ label: '同' }, { label: '同' }])),
    'DUPLICATE_OPTION_LABEL', '完全同名');
  assertCode(() => scoreDecision(makeInput(factors, [{ label: ' 同 ' }, { label: '同' }])),
    'DUPLICATE_OPTION_LABEL', 'trim 后同名');
  assertCode(() => scoreDecision(makeInput(factors, [{ label: '甲' }, { label: '乙' }, { label: '丙' }])),
    'INVALID_OPTIONS', '三个选项');
  assertCode(() => scoreDecision(makeInput(factors, [{ label: '只有甲' }])), 'INVALID_OPTIONS', '一个选项');
  // 不同名必须通过
  assert.doesNotThrow(() => scoreDecision(makeInput(factors, [{ label: '甲' }, { label: '乙' }])));
});

test('空 label 抛错：选项与因素都走 INVALID_*_LABEL', () => {
  const factors = equalFactors();
  for (const blank of ['', '   ', '\t\n', '\u3000']) {
    assertCode(() => scoreDecision(makeInput(factors, [{ label: blank }, { label: '乙' }])),
      'INVALID_OPTION_LABEL', `选项空 label ${JSON.stringify(blank)}`);
  }
  const blankFactor = equalFactors();
  blankFactor[1].label = '   ';
  assertCode(() => scoreDecision(makeInput(blankFactor)), 'INVALID_FACTOR_LABEL', '因素空 label');
  const notString = equalFactors();
  notString[0].label = 123;
  assertCode(() => scoreDecision(makeInput(notString)), 'INVALID_FACTOR_LABEL', '因素 label 非字符串');
});

test('超长 label 抛错：选项 >120、因素 >60，边界长度必须通过', () => {
  const factors = equalFactors();
  assertCode(() => scoreDecision(makeInput(factors, [{ label: 'x'.repeat(121) }, { label: '乙' }])),
    'INVALID_OPTION_LABEL', '选项 121 字');
  assert.throws(() => scoreDecision(makeInput(factors, [{ label: 'x'.repeat(121) }, { label: '乙' }])), (error) => {
    assert.equal(error.details.max, 120);
    assert.equal(error.details.length, 121);
    return true;
  });
  assert.doesNotThrow(() => scoreDecision(makeInput(factors, [{ label: 'x'.repeat(120) }, { label: '乙' }])),
    '选项 120 字应合法');

  const longFactor = equalFactors();
  longFactor[0].label = 'x'.repeat(61);
  assertCode(() => scoreDecision(makeInput(longFactor)), 'INVALID_FACTOR_LABEL', '因素 61 字');
  const edgeFactor = equalFactors();
  edgeFactor[0].label = 'x'.repeat(60);
  assert.doesNotThrow(() => scoreDecision(makeInput(edgeFactor)), '因素 60 字应合法');
});

test('其它校验：非法输入结构、重复因素 id、权重过大、非字符串标题', () => {
  const factors = equalFactors();
  assertCode(() => scoreDecision(null), 'INVALID_INPUT', 'null 输入');
  assertCode(() => scoreDecision([]), 'INVALID_INPUT', '数组输入');
  assertCode(() => scoreDecision('x'), 'INVALID_INPUT', '字符串输入');
  assertCode(() => scoreDecision({ options: factors, factors }), 'INVALID_OPTIONS', '选项不是数组');
  assertCode(() => scoreDecision({ options: [{ label: '甲' }, { label: '乙' }] }), 'INVALID_FACTORS', 'factors 缺失');
  assertCode(() => scoreDecision(makeInput([null, ...equalFactors().slice(1)])), 'INVALID_FACTOR', '因素为 null');

  const dupId = equalFactors().map((f) => ({ ...f, id: 'same' }));
  assertCode(() => scoreDecision(makeInput(dupId)), 'DUPLICATE_FACTOR_ID', '重复 id');

  const heavy = equalFactors();
  heavy[0].weight = 1e6 + 1;
  assertCode(() => scoreDecision(makeInput(heavy)), 'WEIGHT_TOO_LARGE', '权重超上限');

  assertCode(() => scoreDecision({ ...makeInput(factors), title: 42 }), 'INVALID_TITLE', '标题非字符串');

  const numericId = equalFactors();
  numericId[0].id = 7;
  assertCode(() => scoreDecision(makeInput(numericId)), 'INVALID_FACTOR_ID', 'id 非字符串');
});

/* ─────────────────── 17. projectAtShare 边界 ─────────────────── */

test('projectAtShare 的 t 越界抛 INVALID_SHARE（含非数字类型）', () => {
  for (const bad of [-0.0001, 1.0001, -1, 2, NaN, Infinity, -Infinity, '0.5', null, undefined, {}]) {
    assertCode(() => projectAtShare(FIXTURE_MAIN, 'f3', bad), 'INVALID_SHARE', `t=${String(bad)}`);
  }
  assertCode(() => projectAtShare(FIXTURE_MAIN, '不存在的因素', 0.5), 'UNKNOWN_FACTOR', '未知因素');
  // t=0 与 t=1 本身是合法的闭区间端点
  assert.doesNotThrow(() => projectAtShare(FIXTURE_MAIN, 'f3', 0));
  assert.doesNotThrow(() => projectAtShare(FIXTURE_MAIN, 'f3', 1));
});

test('projectAtShare 在 t=0 / t=1 两个端点行为正确', () => {
  const target = FIXTURE_MAIN.factors.find((f) => f.id === 'f3');
  const others = FIXTURE_MAIN.factors.filter((f) => f.id !== 'f3');
  const othersWeight = others.reduce((s, f) => s + f.weight, 0);
  const expectedAAt0 = (10 * others.reduce((s, f) => s + f.weight * f.ratings.A, 0)) / othersWeight;
  const expectedBAt0 = (10 * others.reduce((s, f) => s + f.weight * f.ratings.B, 0)) / othersWeight;

  const atZero = projectAtShare(FIXTURE_MAIN, 'f3', 0);
  assert.equal(atZero.share, 0);
  assert.ok(Math.abs(atZero.scoreA - expectedAAt0) < 1e-12, `t=0 时其余因素应按原比例分满 1：期望 ${expectedAAt0}，实际 ${atZero.scoreA}`);
  assert.ok(Math.abs(atZero.scoreB - expectedBAt0) < 1e-12);
  // 目标因素评分为 0 分时不应再贡献
  assert.ok(atZero.scoreA > 0 && atZero.difference > 0, 't=0 时 f3 完全退出，A 应领先');

  const atOne = projectAtShare(FIXTURE_MAIN, 'f3', 1);
  assert.equal(atOne.share, 1);
  assert.ok(Math.abs(atOne.scoreA - 10 * target.ratings.A) < 1e-12, `t=1 时只剩目标因素：期望 ${10 * target.ratings.A}`);
  assert.ok(Math.abs(atOne.scoreB - 10 * target.ratings.B) < 1e-12);
  assert.equal(atOne.difference, 10 * (target.ratings.A - target.ratings.B));
  assert.ok(atOne.difference < 0, 't=1 时只剩通勤因素，应翻成 B 领先');
  assert.equal(findNonFinite(atOne).length, 0);
});

test('projectAtShare：t 从 0 到 1 单调移动，且中间值等于解析式', () => {
  const target = FIXTURE_MAIN.factors.find((f) => f.id === 'f3');
  const others = FIXTURE_MAIN.factors.filter((f) => f.id !== 'f3');
  const othersWeight = others.reduce((s, f) => s + f.weight, 0);
  const dOthers = others.reduce((s, f) => s + f.weight * (f.ratings.A - f.ratings.B), 0) / othersWeight;
  const dk = target.ratings.A - target.ratings.B;

  let previous = Infinity;
  for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
    const projected = projectAtShare(FIXTURE_MAIN, 'f3', t);
    const expected = 10 * (t * dk + (1 - t) * dOthers);
    assert.ok(Math.abs(projected.difference - expected) < 1e-9,
      `t=${t} 的差值应为 ${expected}，实际 ${projected.difference}`);
    assert.ok(projected.difference < previous, '差值应随 t 单调下降');
    previous = projected.difference;
  }
});

/* ──────────── 18. findFlipThresholds 完整性 / 不含 NaN ──────────── */

test('findFlipThresholds 对每个因素都返回一条，且所有数值字段有限', () => {
  for (const raw of [FIXTURE_MAIN, soleFactorInput(), makeInput(equalFactors())]) {
    const factors = normalizeInput(raw).factors;
    const thresholds = findFlipThresholds(raw);
    assert.equal(thresholds.length, factors.length, '每个因素必须恰好一条');
    assert.deepEqual(thresholds.map((t) => t.factorId), factors.map((f) => f.id), '顺序应与输入因素一致');

    for (const item of thresholds) {
      assert.equal(typeof item.label, 'string');
      assert.ok(item.label.length > 0);
      assert.ok(Number.isFinite(item.currentShare), `${item.factorId} currentShare 非有限`);
      assert.ok(Number.isFinite(item.ratingGap), `${item.factorId} ratingGap 非有限`);
      assert.ok(Number.isFinite(item.currentDelta), `${item.factorId} currentDelta 非有限`);
      assert.equal(typeof item.feasible, 'boolean');
      assert.equal(typeof item.boundary, 'boolean');
      assert.equal(typeof item.atThreshold, 'boolean');
      assert.equal(typeof item.explanation, 'string');
      assert.ok(item.explanation.length > 0, `${item.factorId} 必须有解释文案`);
      // thresholdShare / distance 要么是 null，要么是有限数
      for (const key of ['thresholdShare', 'distance']) {
        const value = item[key];
        assert.ok(value === null || Number.isFinite(value), `${item.factorId}.${key} 必须是 null 或有限数，实际 ${value}`);
      }
      if (item.feasible) {
        assert.ok(item.thresholdShare > 0 && item.thresholdShare < 1, `${item.factorId} 可行 t* 必须在 (0,1)`);
        assert.ok(Number.isFinite(item.distance) && item.distance >= 0, `${item.factorId} distance 应非负有限`);
        assert.ok(['increase', 'decrease', 'hold'].includes(item.direction), `${item.factorId} direction 非法`);
      }
    }
    assert.equal(findNonFinite(thresholds).length, 0, findNonFinite(thresholds).join(', '));
    assert.ok(!JSON.stringify(thresholds).includes('NaN'));
  }
});

test('findFlipThresholds 的 code 与 feasible/direction/distance 自洽', () => {
  const thresholds = findFlipThresholds(FIXTURE_MAIN);
  for (const item of thresholds) {
    if (item.code === 'FEASIBLE') {
      assert.equal(item.feasible, true);
      assert.equal(item.boundary, false);
      assert.equal(item.atThreshold, false);
      assert.ok(Number.isFinite(item.distance) && item.distance > 0);
      assert.equal(item.direction, item.thresholdShare > item.currentShare ? 'increase' : 'decrease');
    } else if (item.code === 'AT_THRESHOLD') {
      assert.equal(item.feasible, true);
      assert.equal(item.atThreshold, true);
      assert.equal(item.direction, 'hold');
      assert.equal(item.distance, 0);
      assert.ok(Math.abs(item.thresholdShare - item.currentShare) < 1e-9);
    } else {
      assert.equal(item.feasible, false, `${item.factorId} code=${item.code} 不应 feasible`);
      assert.equal(item.direction, null);
      assert.equal(item.distance, null);
    }
  }
});

test('AT_THRESHOLD 的 UI 契约守卫：direction="hold" 时 distance=0 且 t* 就是当前占比', () => {
  // 上面那条"自洽"测试虽然写了 AT_THRESHOLD 分支，但 FIXTURE_MAIN 里没有任何 AT_THRESHOLD
  // 因素，那个分支其实是死代码。这里用真正的打平夹具把它跑起来。
  //
  // 夹具构造：k 的 dk=+8，其余三项 dk=-4 且等权 → 整体恰好打平（46.66 / 46.66）。
  // 打平时每个因素的 t* 都等于它自己的当前占比，于是全部落进 AT_THRESHOLD。
  const tieRaw = makeInput([
    { id: 'k', label: 'k', weight: 2, ratings: { A: 8, B: 0 } },
    { id: 'o1', label: 'o1', weight: 1, ratings: { A: 3, B: 7 } },
    { id: 'o2', label: 'o2', weight: 1, ratings: { A: 3, B: 7 } },
    { id: 'o3', label: 'o3', weight: 2, ratings: { A: 3, B: 7 } },
  ]);

  // 前提：这份夹具确实是打平的
  const analysis = scoreDecision(tieRaw);
  assert.equal(analysis.tie, true, '夹具本身必须是打平状态');
  assert.ok(Math.abs(analysis.difference) < TIE_EPSILON);

  const thresholds = findFlipThresholds(tieRaw);
  assert.equal(thresholds.length, 4);
  assert.ok(thresholds.every((t) => t.code === 'AT_THRESHOLD'),
    `打平时所有因素都应是 AT_THRESHOLD，实际 ${thresholds.map((t) => t.code).join(',')}`);

  for (const item of thresholds) {
    // ── 这就是要锁定的契约 ──
    assert.equal(item.direction, 'hold', `${item.factorId} 必须用 'hold' 表达"已在临界点"`);
    assert.equal(item.distance, 0, `${item.factorId} distance 必须严格为 0`);
    assert.equal(item.atThreshold, true);
    assert.equal(item.feasible, true);
    assert.equal(item.boundary, false, 'AT_THRESHOLD 不是 BOUNDARY');

    // thresholdShare 与 currentShare 的关系：必须用 EPSILON 比较，不能用 ===。
    // 实测 o1/o2 两者相差 2.7755575615628914e-17（浮点误差），严格 === 会失败。
    // 这不是缺陷：t* = -dOthers/(dk-dOthers) 与 weight/Σw 是两条不同的浮点计算路径。
    assert.ok(Math.abs(item.thresholdShare - item.currentShare) < 1e-12,
      `${item.factorId} t* 应等于当前占比，实际差 ${item.thresholdShare - item.currentShare}`);

    // 防止有人"顺手"把它改成二元的 increase/decrease：hold 必须是一个独立取值
    assert.notEqual(item.direction, 'increase');
    assert.notEqual(item.direction, 'decrease');

    // UI 依赖「当前就在打平点」这个事实，代回必须确实打平
    const at = projectAtShare(tieRaw, item.factorId, item.currentShare);
    assert.ok(Math.abs(at.difference) < 1e-6, `${item.factorId} 在 currentShare 处应打平`);
    // 而且往任一方向拨都会立刻偏向一方（这正是 UI 文案承诺的行为）
    const shift = 1e-4;
    if (item.currentShare > shift && item.currentShare < 1 - shift) {
      const down = projectAtShare(tieRaw, item.factorId, item.currentShare - shift).difference;
      const up = projectAtShare(tieRaw, item.factorId, item.currentShare + shift).difference;
      assert.equal(Math.sign(down), -Math.sign(up), `${item.factorId} 往两边拨应偏向相反的两方`);
      assert.notEqual(down, 0);
      assert.notEqual(up, 0);
    }
  }

  // direction 的取值域必须是闭集，UI 才能穷举分支（新增值必须同步 UI，见 FINDINGS F-01）
  const allowed = new Set(['increase', 'decrease', 'hold', null]);
  for (const item of findFlipThresholds(FIXTURE_MAIN).concat(thresholds)) {
    assert.ok(allowed.has(item.direction), `出现了 UI 未处理的 direction: ${item.direction}`);
  }
});

test('P0 性能守卫：6 因素 × 1000 次 scoreDecision + findFlipThresholds 应 < 500ms', () => {
  // 依据：UI 拖动权重滑杆时每 90ms 重算一次，单次预算远小于 90ms。
  // 1000 次的总预算定 500ms，等于单次 0.5ms，比 90ms 的交互预算宽 180 倍，不会误报。
  const sixFactors = makeInput([
    { id: 'f1', label: '薪资', weight: 5, ratings: { A: 9, B: 4 } },
    { id: 'f2', label: '成长', weight: 3, ratings: { A: 8, B: 5 } },
    { id: 'f3', label: '通勤', weight: 2, ratings: { A: 3, B: 7 } },
    { id: 'f4', label: '团队', weight: 2, ratings: { A: 6, B: 5 } },
    { id: 'f5', label: '城市', weight: 4, ratings: { A: 2, B: 8 } },
    { id: 'f6', label: '家庭', weight: 6, ratings: { A: 7, B: 6 } },
  ]);

  // 预热：让 JIT 先编译，避免把首次编译成本算进来
  for (let i = 0; i < 200; i += 1) {
    scoreDecision(sixFactors);
    findFlipThresholds(sixFactors);
  }

  const iterations = 1000;
  const started = performance.now();
  for (let i = 0; i < iterations; i += 1) {
    const analysis = scoreDecision(sixFactors);
    const thresholds = findFlipThresholds(sixFactors);
    // 防止引擎把"无副作用"的计算整个优化掉
    if (analysis.contributions.length !== 6 || thresholds.length !== 6) {
      throw new Error('计算结果长度异常，可能被优化掉了');
    }
  }
  const elapsed = performance.now() - started;

  assert.ok(Number.isFinite(elapsed) && elapsed > 0, `计时异常：${elapsed}`);
  assert.ok(elapsed < 500,
    `6 因素 × 1000 次总耗时 ${elapsed.toFixed(1)}ms，超出 500ms 预算（单次 ${(elapsed / iterations).toFixed(4)}ms）`);

  // 记录真实耗时，便于在 CI 日志里追踪性能回归
  console.log(`    ⏱  6 因素 × 1000 次 scoreDecision+findFlipThresholds = ${elapsed.toFixed(1)}ms ` +
    `（单次 ${(elapsed / iterations).toFixed(4)}ms，预算 500ms，用量 ${((elapsed / 500) * 100).toFixed(1)}%）`);
});

test('rankFlipCandidates / pickFlipHighlight：可行项按距离升序，无可行项返回 null', () => {
  const thresholds = findFlipThresholds(FIXTURE_MAIN);
  const ranked = rankFlipCandidates(thresholds);

  assert.equal(ranked.length, thresholds.length);
  const feasibleFlags = ranked.map((t) => t.feasible);
  assert.deepEqual(feasibleFlags, [...feasibleFlags].sort((a, b) => (a === b ? 0 : a ? -1 : 1)),
    '所有可行项应排在不可行项之前');

  const feasible = ranked.filter((t) => t.feasible);
  for (let i = 1; i < feasible.length; i += 1) {
    assert.ok(feasible[i - 1].distance <= feasible[i].distance + 1e-12, '可行项应按 distance 升序');
  }
  const highlight = pickFlipHighlight(thresholds);
  assert.equal(highlight.factorId, 'f3');
  assert.equal(pickFlipHighlight(ranked), highlight);
  assert.equal(rankFlipCandidates([]).length, 0);
  assert.equal(pickFlipHighlight([]), null);
  // 不应修改入参顺序
  assert.equal(thresholds[0].factorId, 'f1');
});

test('全平决策（项目自带 createEmptyDecision）判平且没有任何可行翻转', () => {
  const empty = createEmptyDecision();
  const analysis = scoreDecision(empty);
  assert.equal(analysis.tie, true);
  assert.equal(analysis.winner, 'tie');
  assert.equal(analysis.totalWeight, 12);

  const thresholds = findFlipThresholds(empty);
  assert.equal(thresholds.length, 4);
  assert.ok(thresholds.every((t) => t.feasible === false), '全平时不应有可行翻转项');
  assert.ok(thresholds.every((t) => t.code === 'NO_LEVERAGE'));
  assert.equal(pickFlipHighlight(thresholds), null);
});

/* ─────────────────── 19. 无 NaN 序列化 ─────────────────── */

test('所有输出值 JSON.stringify 后不含 "NaN" / "Infinity" / "undefined"', () => {
  const samples = [FIXTURE_MAIN, soleFactorInput(), makeInput(equalFactors()), createEmptyDecision()];
  for (const raw of samples) {
    const analysis = scoreDecision(raw);
    const thresholds = findFlipThresholds(raw);
    const hypothesis = chooseValidationHypothesis(raw, analysis);
    const projected = projectAtShare(raw, analysis.factors[0].id, 0.37);
    const ranked = rankFlipCandidates(thresholds);
    const highlight = pickFlipHighlight(thresholds);
    const validated = validate(raw);

    for (const [name, value] of Object.entries({ analysis, thresholds, hypothesis, projected, ranked, highlight, validated })) {
      const json = JSON.stringify(value);
      assert.equal(typeof json, 'string', `${name} 应可序列化`);
      for (const token of ['NaN', 'Infinity', 'undefined']) {
        assert.ok(!json.includes(token), `${name} 的 JSON 含 ${token}: ${json.slice(0, 200)}`);
      }
    }
    assert.equal(findNonFinite(analysis).length, 0, findNonFinite(analysis).join(', '));
  }
});

/* ──────────────── 20. 确定性随机 200 组 ──────────────── */

test('确定性 LCG 随机 200 组：不产生 NaN/Infinity，且核心不变式成立', () => {
  const SEEDS = 200;
  let feasibleCount = 0;
  let infeasibleCount = 0;

  for (let i = 0; i < SEEDS; i += 1) {
    const seed = 20261029 + i * 7919; // 固定种子，可复现
    const raw = randomInput(seed);
    const analysis = scoreDecision(raw);

    // 1) 与独立重算一致
    const expected = manualScores(raw);
    assert.ok(Math.abs(analysis.scoreA - expected.scoreA) < 1e-9, `seed=${seed} scoreA`);
    assert.ok(Math.abs(analysis.scoreB - expected.scoreB) < 1e-9, `seed=${seed} scoreB`);

    // 2) 归一化
    const shareSum = analysis.normalizedWeights.reduce((sum, item) => sum + item.share, 0);
    assert.ok(Math.abs(shareSum - 1) < 1e-12, `seed=${seed} 占比和 ${shareSum}`);

    // 3) 各因素贡献之和 = 总分差
    const deltaSum = analysis.contributions.reduce((sum, c) => sum + c.delta, 0);
    assert.ok(Math.abs(deltaSum - analysis.difference) < 1e-9, `seed=${seed} 贡献和`);

    // 4) 分数范围
    assert.ok(analysis.scoreA >= 0 && analysis.scoreA <= 100, `seed=${seed} scoreA=${analysis.scoreA}`);
    assert.ok(analysis.scoreB >= 0 && analysis.scoreB <= 100, `seed=${seed} scoreB=${analysis.scoreB}`);

    // 5) 阈值：数量、有限性、可行项代回必打平
    const thresholds = findFlipThresholds(raw);
    assert.equal(thresholds.length, raw.factors.length, `seed=${seed} 阈值条数`);
    for (const item of thresholds) {
      assert.equal(findNonFinite(item).length, 0, `seed=${seed} ${item.factorId} 含非有限值`);
      assert.ok(!JSON.stringify(item).includes('NaN'), `seed=${seed} ${item.factorId} 序列化含 NaN`);

      if (item.feasible) {
        feasibleCount += 1;
        assert.ok(item.thresholdShare > 0 && item.thresholdShare < 1);
        const at = projectAtShare(raw, item.factorId, item.thresholdShare);
        assert.ok(Math.abs(at.difference) < 1e-6,
          `seed=${seed} ${item.factorId} 在 t*=${item.thresholdShare} 未打平：${at.difference}`);
        // t* 两侧符号相反（用安全步长）
        const step = Math.min(0.02, item.thresholdShare / 2, (1 - item.thresholdShare) / 2);
        const below = projectAtShare(raw, item.factorId, item.thresholdShare - step).difference;
        const above = projectAtShare(raw, item.factorId, item.thresholdShare + step).difference;
        assert.equal(Math.sign(below), -Math.sign(above),
          `seed=${seed} ${item.factorId} 两侧未翻转：${below} / ${above}`);
      } else {
        infeasibleCount += 1;
        // 不可行项若给了 t*，必须落在闭区间外
        if (item.thresholdShare !== null && item.code === 'OUT_OF_RANGE') {
          assert.ok(item.thresholdShare < 0 || item.thresholdShare > 1,
            `seed=${seed} ${item.factorId} OUT_OF_RANGE 的 t* 应在 [0,1] 外：${item.thresholdShare}`);
        }
      }
    }

    // 6) 同一输入重复计算必须完全一致（纯函数）
    assert.equal(scoreDecision(raw).difference, analysis.difference, `seed=${seed} 非纯函数`);
    // 7) magnitude 必须是 |difference| 本身，且 winner 与符号一致
    assert.equal(analysis.magnitude, Math.abs(analysis.difference), `seed=${seed} magnitude 定义`);
    if (analysis.tie) {
      assert.equal(analysis.winner, 'tie', `seed=${seed} 判平却给出了胜者`);
    } else {
      assert.equal(analysis.winner, analysis.difference > 0 ? 'A' : 'B', `seed=${seed} winner 与符号不符`);
    }
    assert.ok(['tie', 'very-close', 'close', 'clear', 'decisive'].includes(analysis.closeness),
      `seed=${seed} closeness 非法：${analysis.closeness}`);
  }

  assert.ok(feasibleCount > 0, '随机样本里应出现过可行临界点');
  assert.ok(infeasibleCount > 0, '随机样本里应出现过不可行项');
});

/* ────────────── 其它导出函数的契约 ────────────── */

test('normalizeInput 规范化：trim 文本、补齐 id、title 截断', () => {
  const raw = {
    ...FIXTURE_MAIN,
    title: '  换不换  ',
    options: [{ label: '  甲  ' }, { label: ' 乙 ' }],
    factors: FIXTURE_MAIN.factors.map(({ id, ...rest }) => rest),
  };
  const normalized = normalizeInput(raw);

  assert.deepEqual(normalized.options, [{ id: 'A', label: '甲' }, { id: 'B', label: '乙' }]);
  assert.deepEqual(normalized.factors.map((f) => f.id), ['f1', 'f2', 'f3', 'f4'], '缺省 id 应为 f1..f4');
  assert.equal(normalized.title, '换不换');
  assert.equal(normalized.details, undefined);
  // 超长标题被截断而不是抛错
  const longTitle = normalizeInput({ ...FIXTURE_MAIN, title: '字'.repeat(500) });
  assert.equal(longTitle.title.length, 120);
});

test('validate：合法返回 ok，非法返回稳定 code 且不抛出', () => {
  assert.deepEqual(validate(FIXTURE_MAIN), { ok: true, code: null, message: '' });

  const zero = validate(makeInput(equalFactors().map((f) => ({ ...f, weight: 0 }))));
  assert.equal(zero.ok, false);
  assert.equal(zero.code, 'ALL_ZERO_WEIGHTS');
  assert.ok(zero.message.length > 0);

  assert.equal(validate(null).code, 'INVALID_INPUT');
  assert.equal(validate(makeInput(equalFactors().slice(0, 3))).code, 'FACTOR_COUNT');
  assert.equal(validate(makeInput(equalFactors(), [{ label: '同' }, { label: '同' }])).code, 'DUPLICATE_OPTION_LABEL');
  // validate 绝不能把 ValidationError 泄漏出去
  assert.doesNotThrow(() => validate(undefined));
});

test('applyEqualWeights：全零权重一键修复为等权，且不修改入参', () => {
  const broken = makeInput(equalFactors().map((f, i) => ({ ...f, weight: i === 0 ? 5 : 0 })));
  const snapshot = JSON.stringify(broken);
  const fixed = applyEqualWeights(broken);

  assert.deepEqual(fixed.factors.map((f) => f.weight), [1, 1, 1, 1]);
  assert.equal(JSON.stringify(broken), snapshot, 'applyEqualWeights 不应修改入参');
  assert.equal(validate(fixed).ok, true, '修复后必须能通过校验');
  assert.equal(scoreDecision(fixed).tie, true, '全 5 分等权后应判平');
  assertCode(() => applyEqualWeights({ options: [] }), 'INVALID_INPUT', '缺少 factors');
});

test('chooseValidationHypothesis：选中 |delta| 最大的因素，文案自洽', () => {
  const analysis = scoreDecision(FIXTURE_MAIN);
  const hypothesis = chooseValidationHypothesis(FIXTURE_MAIN, analysis);

  const top = [...analysis.contributions].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  assert.equal(hypothesis.factorId, top.factorId);
  assert.equal(hypothesis.label, top.label);
  assert.ok(Math.abs(hypothesis.influence - Math.abs(top.delta)) < 1e-12);
  assert.equal(hypothesis.ambiguous, false);
  assert.equal(typeof hypothesis.question, 'string');
  assert.ok(hypothesis.question.includes(top.label), '问题文案应包含因素名');
  assert.equal(hypothesis.steps.length, 3);
  assert.ok(hypothesis.caveat.includes('启发式'), '必须保留"非客观概率"的免责说明');
  assert.equal(findNonFinite(hypothesis).length, 0);

  // 不传 analysis 时应自行计算，结果一致
  assert.deepEqual(chooseValidationHypothesis(FIXTURE_MAIN), hypothesis);

  // 两个因素影响并列时 ambiguous 应为 true
  const tied = makeInput([
    { id: 'a', label: 'a', weight: 1, ratings: { A: 8, B: 5 } },
    { id: 'b', label: 'b', weight: 1, ratings: { A: 1, B: 4 } },
    { id: 'c', label: 'c', weight: 1, ratings: { A: 5, B: 5 } },
    { id: 'd', label: 'd', weight: 1, ratings: { A: 5, B: 5 } },
  ]);
  const tiedHypothesis = chooseValidationHypothesis(tied, scoreDecision(tied));
  assert.equal(tiedHypothesis.ambiguous, true);
  assert.ok(['a', 'b'].includes(tiedHypothesis.factorId), '并列时应按 factorId 稳定选择');
});

test('closeness 分档与 TIE_EPSILON 的语义符合定义', () => {
  // 4 等权因素、只有一个因素产生 gap，difference = 10*gap/4 = 2.5*gap
  const withGap = (gap) => makeInput([
    { id: 'a', label: 'a', weight: 1, ratings: { A: 5, B: 5 } },
    { id: 'b', label: 'b', weight: 1, ratings: { A: 5, B: 5 } },
    { id: 'c', label: 'c', weight: 1, ratings: { A: 5, B: 5 } },
    { id: 'd', label: 'd', weight: 1, ratings: { A: 5 + gap / 2, B: 5 - gap / 2 } },
  ]);

  assert.equal(TIE_EPSILON, 1e-9, '题目规定的容差不得被改动');
  assert.equal(scoreDecision(withGap(0.1)).closeness, 'very-close'); // diff 0.25
  assert.equal(scoreDecision(withGap(0.8)).closeness, 'close'); // diff 2
  assert.equal(scoreDecision(withGap(2)).closeness, 'close'); // diff 5
  assert.equal(scoreDecision(withGap(3.2)).closeness, 'clear'); // diff 8
  assert.equal(scoreDecision(withGap(6)).closeness, 'clear'); // diff 15
  assert.equal(scoreDecision(withGap(8)).closeness, 'decisive'); // diff 20

  // 严格小于 TIE_EPSILON 才判平：4.9999e-10 < 1e-9
  const tiny = scoreDecision(withGap(2e-10));
  assert.ok(tiny.difference !== 0, '差值本身不是 0（不是硬判等）');
  assert.ok(Math.abs(tiny.difference) < TIE_EPSILON);
  assert.equal(tiny.tie, true);
  assert.equal(tiny.winner, 'tie');
});
