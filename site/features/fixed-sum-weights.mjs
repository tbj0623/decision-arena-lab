/**
 * V4: 在单项原始权重盒约束之外，保持原始权重总和与当前值完全一致。
 *
 * 集合：lo_i <= w_i <= hi_i, Σw_i=T>0。线性目标 Σw_i*d_i/T 的
 * 最大/最小值可在多面体顶点取得。顶点上最多一项权重不在其端点，
 * 枚举每一项作为自由项，其余所有可变权重取 lo/hi，共 <= n*2^(n-1)
 * 个候选（项目 core 强制 n<=6，所以最多 192）。
 *
 * 只负责生成可行权重，不负责评分/概率；保留原有全部核心约束。
 */
export function enumerateFixedSumWeightVertices(weightRanges, total, variableIndices) {
  if (!Array.isArray(weightRanges) || !Array.isArray(variableIndices) ||
    weightRanges.length < 1 || weightRanges.length > 6 ||
    !Number.isFinite(total) || total <= 0) {
    throw new RangeError('Invalid fixed-total weight bounds');
  }
  if (variableIndices.length > weightRanges.length ||
    new Set(variableIndices).size !== variableIndices.length ||
    variableIndices.some((i) => !Number.isInteger(i) || i < 0 || i >= weightRanges.length)) {
    throw new RangeError('Invalid varying weight index');
  }
  for (const r of weightRanges) {
    if (!r || !Number.isFinite(r.lo) || !Number.isFinite(r.hi) ||
      r.lo < 0 || r.hi < r.lo) throw new RangeError('Invalid weight interval');
  }

  const EPS = 1e-8; // 容忍 IEEE 浮点加减的微小舍入；不是允许的主观偏差幅度
  const sumLo = weightRanges.reduce((s, r) => s + r.lo, 0);
  const sumHi = weightRanges.reduce((s, r) => s + r.hi, 0);
  if (total < sumLo - EPS || total > sumHi + EPS) {
    throw new RangeError('Fixed total is outside the feasible box');
  }
  const candidates = [];
  const signatures = new Set();
  const add = (w) => {
    const sum = w.reduce((s, v) => s + v, 0);
    if (Math.abs(sum - total) > EPS) return;
    // 这里每个元素使用同样的数值精度检查；不要让上限浮点舍入越界。
    if (w.some((value, i) =>
      value < weightRanges[i].lo - EPS || value > weightRanges[i].hi + EPS)) return;
    const signature = w.map((value) => value.toPrecision(14)).join(':');
    if (!signatures.has(signature)) {
      signatures.add(signature);
      candidates.push(w);
    }
  };

  if (variableIndices.length === 0) {
    add(weightRanges.map((r) => r.lo));
    if (!candidates.length) throw new RangeError('No feasible fixed-total weight vector');
    return candidates;
  }

  for (const free of variableIndices) {
    const others = variableIndices.filter((i) => i !== free);
    for (let mask = 0; mask < 2 ** others.length; mask += 1) {
      const weights = weightRanges.map((r) => r.lo);
      others.forEach((index, j) => {
        if ((mask >> j) & 1) weights[index] = weightRanges[index].hi;
      });
      const currentSum = weights.reduce((s, w, i) => i === free ? s : s + w, 0);
      const desired = total - currentSum;
      const range = weightRanges[free];
      if (desired < range.lo - EPS || desired > range.hi + EPS) continue;
      weights[free] = Math.min(range.hi, Math.max(range.lo, desired));
      add(weights);
    }
  }

  if (!candidates.length) throw new RangeError('No feasible fixed-total weight vertex');
  return candidates;
}
