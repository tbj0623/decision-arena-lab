/**
 * 多项评分联合不确定性工作台（确定性，不输出概率）。
 * 用户主动标记哪些单元格不确定，区间是当前评分 ±radius 并截到 0–10。
 * 未选择的单元格用 [score,score]；所有被标记项允许同时、独立变动。
 *
 * 复用已经独立对拍的 interval.mjs 闭式解，绝不采样或生成伪胜率。
 * 原始权重保持固定；本函数不修改用户的决策。
 */
import { scoreDecision, RATING_MIN, RATING_MAX, TIE_EPSILON } from '../core.mjs';
import { analyzeInterval } from './interval.mjs';

export const UNCERTAINTY_RADII = Object.freeze([0.5, 1, 2]);

export function analyzeSelectedUncertainty(raw, selections, radius = 1) {
  if (!UNCERTAINTY_RADII.includes(radius)) {
    throw new RangeError('波动幅度必须选择 0.5、1 或 2 分');
  }
  if (!Array.isArray(selections)) {
    throw new TypeError('Selections must be an array');
  }

  // 使用现有评分核心作为唯一输入校验入口，保留全部原始精度。
  const point = scoreDecision(raw);
  const flags = new Map(point.factors.map((f) => [f.id, new Set()]));
  for (const selected of selections) {
    if (!selected || typeof selected.factorId !== 'string' ||
      (selected.side !== 'A' && selected.side !== 'B') ||
      !flags.has(selected.factorId)) {
      throw new RangeError('存在未知因素或无效的选项');
    }
    flags.get(selected.factorId).add(selected.side);
  }

  const activeCount = [...flags.values()].reduce((sum, set) => sum + set.size, 0);
  if (activeCount === 0) {
    return { activeCount: 0, radius, point, interval: null, status: 'not-configured', witness: null };
  }

  const factors = point.factors.map((f) => {
    const chosen = flags.get(f.id);
    const intervals = {};
    for (const side of ['A', 'B']) {
      const value = f.ratings[side];
      intervals[side] = chosen.has(side)
        ? [Math.max(RATING_MIN, value - radius), Math.min(RATING_MAX, value + radius)]
        : [value, value];
    }
    return { id: f.id, label: f.label, weight: f.weight, intervals };
  });

  const interval = analyzeInterval({
    title: point.title,
    options: point.options,
    factors,
  });

  let status;
  if (interval.minDelta > TIE_EPSILON) status = 'always-A';
  else if (interval.maxDelta < -TIE_EPSILON) status = 'always-B';
  else if (interval.minDelta < -TIE_EPSILON && interval.maxDelta > TIE_EPSILON) {
    status = 'both-possible';
  } else status = 'boundary-possible';

  // 证明“当前倾向可能改变”的一组实际可行端点。
  // 当前 A 领先 ⇒ 取 A 最不利端点；B 领先 ⇒ 取 B 最不利端点。
  // 打平时固定取支持 A 的端点；不以任何一种结局的发生概率排序。
  const worstAgainst = point.winner === 'A' ? 'A' : point.winner === 'B' ? 'B' : 'tie';
  const endpoint = point.winner === 'A' ? interval.worstCase : interval.bestCase;
  const example = {
    title: point.title,
    options: point.options,
    factors: factors.map((f, index) => ({
      id: f.id, label: f.label, weight: f.weight,
      ratings: { A: endpoint.A[index], B: endpoint.B[index] },
    })),
  };
  const witnessScore = scoreDecision(example);
  const witness = {
    against: worstAgainst,
    winner: witnessScore.winner,
    difference: witnessScore.difference,
    scoreA: witnessScore.scoreA,
    scoreB: witnessScore.scoreB,
    changes: factors.flatMap((f, index) => ['A','B'].flatMap((side) => {
      const before = point.factors[index].ratings[side];
      const after = endpoint[side][index];
      return after === before ? [] : [{
        factorId: f.id, factorLabel: f.label, side,
        before, after, optionLabel: point.options[side === 'A' ? 0 : 1].label,
      }];
    })),
  };

  return {
    activeCount, radius, point, interval, status,
    canChangeWinner: interval.minDelta < -TIE_EPSILON && point.winner !== 'B' ||
      interval.maxDelta > TIE_EPSILON && point.winner !== 'A' ||
      interval.minDelta <= TIE_EPSILON && interval.maxDelta >= -TIE_EPSILON &&
      point.winner !== 'tie',
    witness,
  };
}
