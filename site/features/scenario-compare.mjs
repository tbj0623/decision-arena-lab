/**
 * 本地基准情景：只存用户主动保存的一份快照。
 * 纯函数，不触及网络、磁盘或浏览器持久化 API。
 */
import { normalizeInput, scoreDecision } from '../core.mjs';

/** 验证并创建独立的、无额外字段的深拷贝。 */
export function captureScenario(raw) {
  const input = normalizeInput(raw);
  return {
    title: input.title,
    options: input.options.map((o) => ({ id: o.id, label: o.label })),
    factors: input.factors.map((f) => ({
      id: f.id, label: f.label, weight: f.weight,
      ratings: { A: f.ratings.A, B: f.ratings.B },
    })),
  };
}

function changeCount(baseline, now) {
  let count = Number(baseline.title !== now.title);
  for (const side of [0, 1]) {
    count += Number(baseline.options[side].label !== now.options[side].label);
  }
  const beforeFactors = new Map(baseline.factors.map((f) => [f.id, f]));
  const nowFactors = new Map(now.factors.map((f) => [f.id, f]));
  for (const [id, old] of beforeFactors) {
    const cur = nowFactors.get(id);
    if (!cur) { count += 1; continue; }
    count += Number(old.label !== cur.label);
    count += Number(old.weight !== cur.weight);
    count += Number(old.ratings.A !== cur.ratings.A);
    count += Number(old.ratings.B !== cur.ratings.B);
  }
  for (const id of nowFactors.keys()) {
    if (!beforeFactors.has(id)) count += 1;
  }
  return count;
}

/**
 * 同一 A/B 身份下的两份主观打分情景，并非现实世界的两种结局。
 * 允许调整、增删因素；每份均用原有 core.mjs 独立计算。
 */
export function compareScenarios(baselineRaw, currentRaw) {
  const baseline = captureScenario(baselineRaw);
  const current = captureScenario(currentRaw);
  const before = scoreDecision(baseline);
  const after = scoreDecision(current);
  const optionNamesChanged = baseline.options.some((o, i) => o.label !== current.options[i].label);
  const originalFactors = new Map(baseline.factors.map((f) => [f.id, f.label]));
  const criteriaChanged = baseline.factors.length !== current.factors.length ||
    current.factors.some((f) => originalFactors.get(f.id) !== f.label);
  return {
    before,
    after,
    optionNamesChanged,
    criteriaChanged,
    changedFields: changeCount(baseline, current),
    changedWinner: before.winner !== after.winner,
    scoreDeltaA: after.scoreA - before.scoreA,
    scoreDeltaB: after.scoreB - before.scoreB,
    gapDelta: after.difference - before.difference,
  };
}
