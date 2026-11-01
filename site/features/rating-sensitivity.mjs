/**
 * 单项主观评分 ±1 分的确定性压力测试。
 * 每次只改变「一个因素 × 一个方案」的一项评分，其余评分及权重全部保持不变。
 * 不估计误差的真实分布、不输出胜率或概率、不预测未来。
 */
import { scoreDecision, RATING_MIN, RATING_MAX } from '../core.mjs';

function candidateFor(base, factor, side, direction) {
  const before = factor.ratings[side];
  const after = before + direction;
  if (after < RATING_MIN || after > RATING_MAX) return null;

  const changedFactors = base.factors.map((f) => f.id === factor.id
    ? { ...f, ratings: { ...f.ratings, [side]: after } }
    : f);
  const result = scoreDecision({
    title: base.title,
    options: base.options,
    factors: changedFactors,
  });
  return {
    factorId: factor.id,
    factorLabel: factor.label,
    side,
    optionLabel: base.options.find((o) => o.id === side).label,
    before,
    after,
    winner: result.winner,
    difference: result.difference,
    changedWinner: result.winner !== base.winner,
  };
}

/**
 * @returns {{baseWinner:string, tested:number, changes:Array, closest:object|null, changedCount:number}}
 */
export function probeRatingSensitivity(raw) {
  // 先调用原有计算内核验证输入，不独立发明第二套得分规则。
  const base = scoreDecision(raw);
  const changes = [];
  for (const factor of base.factors) {
    for (const side of ['A', 'B']) {
      for (const direction of [-1, 1]) {
        const candidate = candidateFor(base, factor, side, direction);
        if (candidate) changes.push(candidate);
      }
    }
  }

  // 变化后最接近计算容差意义上的打平，是「最值得核实」的候选，
  // 不代表它发生概率更高。
  const byClosest = [...changes].sort((a, b) =>
    Math.abs(a.difference) - Math.abs(b.difference)
    || a.factorLabel.localeCompare(b.factorLabel, 'zh-CN')
    || a.side.localeCompare(b.side)
    || a.after - b.after);
  const changed = byClosest.filter((c) => c.changedWinner);
  return {
    baseWinner: base.winner,
    tested: changes.length,
    changedCount: changed.length,
    changes: changed.slice(0, 3),
    closest: byClosest[0] ?? null,
  };
}
