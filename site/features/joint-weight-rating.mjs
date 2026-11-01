/**
 * V3.0: 主观评分区间 × 主观权重区间的联合确定性边界。
 * 对所选评分保留 V2 闭式区间语义；对所选原始权重围绕当前值 ±r。
 * 权重最终仍归一化为 w_i / Σw_i；各项允许同时、独立地变化。
 *
 * Δ=10 Σ w_i d_i / Σw_i，d_i=a_i-b_i。给定非负权重和独立评分盒，
 * 最小 Δ 用全部 d_i 下界，最大用上界。对固定 d_i，Δ 是线性分式函数，
 * 在非负权重盒上，其极值可在有效角点取得。n<=6，最多 64 个角点。
 * 全零权重角点不存在分数，明确排除；所有其它可行点均有正分母。
 *
 * 不生成概率、没有网络或持久化，不变更原核心评分算法。
 */
import { scoreDecision, RATING_MIN, RATING_MAX, TIE_EPSILON } from '../core.mjs';
import { analyzeSelectedUncertainty, UNCERTAINTY_RADII } from './uncertainty-workbench.mjs';

export const WEIGHT_RADII = Object.freeze([0.5, 1, 2]);
const MAX_WEIGHT = 1e6;

function classify(lo, hi) {
  if (lo > TIE_EPSILON) return 'always-A';
  if (hi < -TIE_EPSILON) return 'always-B';
  if (lo < -TIE_EPSILON && hi > TIE_EPSILON) return 'both-possible';
  return 'boundary-possible';
}

export function analyzeJointUncertainty(raw, ratingSelections = [], ratingRadius = 1,
  weightSelections = [], weightRadius = 1) {
  if (!WEIGHT_RADII.includes(weightRadius)) {
    throw new RangeError('权重幅度必须选择 0.5、1 或 2');
  }
  if (!Array.isArray(weightSelections)) throw new TypeError('权重选择必须是数组');
  // 旧版函数继续承担评分校验、默认参数、有效状态的原有行为。
  const rating = analyzeSelectedUncertainty(raw, ratingSelections, ratingRadius);
  const point = rating.point;
  const factorIds = new Set(point.factors.map((f) => f.id));
  const selectedWeights = new Set();
  for (const id of weightSelections) {
    if (typeof id !== 'string' || !factorIds.has(id)) {
      throw new RangeError('出现不存在的因素权重');
    }
    selectedWeights.add(id);
  }

  const weightCount = selectedWeights.size;
  const activeCount = rating.activeCount;
  if (!weightCount) {
    // 兼容 V2：不勾权重时保持先前计算的精确边界与见证结果。
    return {
      ...rating, weightCount, weightRadius, weightCornersEvaluated: 0,
      weightRanges: point.factors.map((f) => ({
        factorId: f.id, label: f.label, lo: f.weight, hi: f.weight,
      })),
      witness: rating.witness && { ...rating.witness, weightChanges: [] },
    };
  }

  const weightRanges = point.factors.map((f) => ({
    factorId: f.id, label: f.label,
    lo: selectedWeights.has(f.id) ? Math.max(0, f.weight - weightRadius) : f.weight,
    hi: selectedWeights.has(f.id) ? Math.min(MAX_WEIGHT, f.weight + weightRadius) : f.weight,
  }));
  const intervals = point.factors.map((f, i) => {
    if (rating.interval) return rating.interval.factors[i].intervals;
    return { A: [f.ratings.A, f.ratings.A], B: [f.ratings.B, f.ratings.B] };
  });
  const lowerGaps = intervals.map((v) => v.A[0] - v.B[1]);
  const upperGaps = intervals.map((v) => v.A[1] - v.B[0]);
  const variable = point.factors.flatMap((f, i) => selectedWeights.has(f.id) ? [i] : []);
  // 直接枚举 k 个可变权重的 2^k 角点，k<=6。
  let minDelta = Infinity, maxDelta = -Infinity;
  let minWeights = null, maxWeights = null, weightCornersEvaluated = 0;
  const count = 2 ** variable.length;
  for (let mask = 0; mask < count; mask += 1) {
    const weights = weightRanges.map((r) => r.lo);
    for (let j = 0; j < variable.length; j += 1) {
      if (mask & (1 << j)) weights[variable[j]] = weightRanges[variable[j]].hi;
    }
    const total = weights.reduce((sum, value) => sum + value, 0);
    if (total <= 0) continue; // 全零权重无法定义归一化分数
    weightCornersEvaluated++;
    const candidateMin = 10 * weights.reduce((sum, w, i) => sum + w * lowerGaps[i], 0) / total;
    const candidateMax = 10 * weights.reduce((sum, w, i) => sum + w * upperGaps[i], 0) / total;
    if (candidateMin < minDelta) { minDelta = candidateMin; minWeights = weights; }
    if (candidateMax > maxDelta) { maxDelta = candidateMax; maxWeights = weights; }
  }
  if (!minWeights || !maxWeights) throw new RangeError('没有任何正权重可行组合');

  const endpoint = point.winner === 'B' ? 'max' : 'min';
  const weights = endpoint === 'max' ? maxWeights : minWeights;
  const example = {
    title: point.title,
    options: point.options,
    factors: point.factors.map((f, i) => ({
      id: f.id, label: f.label, weight: weights[i],
      ratings: {
        A: endpoint === 'max' ? intervals[i].A[1] : intervals[i].A[0],
        B: endpoint === 'max' ? intervals[i].B[0] : intervals[i].B[1],
      },
    })),
  };
  const proof = scoreDecision(example);
  const changes = example.factors.flatMap((f, i) => ['A', 'B'].flatMap((side) => {
    const before = point.factors[i].ratings[side], after = f.ratings[side];
    return before === after ? [] : [{
      factorId: f.id, factorLabel: f.label, side, before, after,
      optionLabel: point.options[side === 'A' ? 0 : 1].label,
    }];
  }));
  const weightChanges = example.factors.flatMap((f, i) => {
    const before = point.factors[i].weight;
    return f.weight === before ? [] : [{
      factorId: f.id, factorLabel: f.label, before, after: f.weight,
    }];
  });
  const normalizedMin = minDelta === 0 ? 0 : minDelta;
  const normalizedMax = maxDelta === 0 ? 0 : maxDelta;

  return {
    point, activeCount, radius: ratingRadius,
    weightCount, weightRadius, weightCornersEvaluated, weightRanges,
    status: classify(normalizedMin, normalizedMax),
    interval: { minDelta: normalizedMin, maxDelta: normalizedMax },
    canChangeWinner: point.winner === 'A'
      ? normalizedMin <= TIE_EPSILON
      : point.winner === 'B'
        ? normalizedMax >= -TIE_EPSILON
        : normalizedMin < -TIE_EPSILON || normalizedMax > TIE_EPSILON,
    witness: {
      winner: proof.winner, difference: proof.difference,
      scoreA: proof.scoreA, scoreB: proof.scoreB,
      against: point.winner,
      changes, weightChanges,
    },
  };
}
