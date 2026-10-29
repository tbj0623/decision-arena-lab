/**
 * Decision Arena — 5 条用户旅程的数值回归校验
 * 用法（在 decision-arena-lab 根目录）：node docs/product/verify-journeys.mjs
 * 退出码 0 = 全部通过；1 = 有失败项。
 *
 * 校验对象：site/core.mjs（唯一权威实现）
 * 校验契约：显示保留 1 位小数，且差值必须由未取整的原始值计算（不是两个显示值相减）
 */
import {
  scoreDecision,
  findFlipThresholds,
  pickFlipHighlight,
  chooseValidationHypothesis,
  validate,
} from '../../site/core.mjs';

const r1 = (n) => Math.round((n + Number.EPSILON) * 10) / 10;

const JOURNEYS = [
  {
    id: 'J1',
    title: '要不要接创业公司的 offer',
    raw: {
      title: '要不要接创业公司的 offer',
      options: [{ label: '去创业公司' }, { label: '留在现公司' }],
      factors: [
        { id: 'f1', label: '成长速度', weight: 5, ratings: { A: 9, B: 5 } },
        { id: 'f2', label: '收入确定性', weight: 4, ratings: { A: 4, B: 8 } },
        { id: 'f3', label: '通勤与作息', weight: 2, ratings: { A: 7, B: 7 } },
        { id: 'f4', label: '团队与直属上级', weight: 3, ratings: { A: 8, B: 6 } },
      ],
    },
    expect: {
      scoreA: 70.7, scoreB: 63.6, difference: 7.1, winner: 'A', closeness: 'close',
      highlight: { factorId: 'f2', direction: 'increase', thresholdShare: 0.394 },
      hypothesis: 'f1',
      thresholds: { f1: 0.217, f2: 0.394, f3: null, f4: null },
    },
  },
  {
    id: 'J2',
    title: '买哪台笔记本（含 0 权重因素）',
    raw: {
      title: '买哪台笔记本',
      options: [{ label: 'MacBook Air' }, { label: 'ThinkPad X1' }],
      factors: [
        { id: 'f1', label: '便携重量', weight: 4, ratings: { A: 9, B: 7 } },
        { id: 'f2', label: '键盘手感', weight: 3, ratings: { A: 6, B: 9 } },
        { id: 'f3', label: '软件兼容', weight: 3, ratings: { A: 6, B: 8 } },
        { id: 'f4', label: '续航', weight: 0, ratings: { A: 10, B: 4 } },
        { id: 'f5', label: '价格', weight: 2, ratings: { A: 5, B: 8 } },
      ],
    },
    expect: {
      scoreA: 68.3, scoreB: 79.2, difference: -10.8, winner: 'B', closeness: 'clear',
      highlight: { factorId: 'f4', direction: 'increase', thresholdShare: 0.153 },
      hypothesis: 'f2',
      thresholds: { f1: 0.568, f2: null, f3: null, f4: 0.153, f5: null },
    },
  },
  {
    id: 'J3',
    title: '租房：市区小两居 vs 郊区大三居',
    raw: {
      title: '租房：市区小两居 vs 郊区大三居',
      options: [{ label: '市区小两居' }, { label: '郊区大三居' }],
      factors: [
        { id: 'f1', label: '通勤时间', weight: 6, ratings: { A: 9, B: 3 } },
        { id: 'f2', label: '居住面积', weight: 4, ratings: { A: 4, B: 9 } },
        { id: 'f3', label: '每月租金', weight: 5, ratings: { A: 3, B: 8 } },
        { id: 'f4', label: '周边配套', weight: 2, ratings: { A: 9, B: 5 } },
      ],
    },
    expect: {
      scoreA: 60.6, scoreB: 61.2, difference: -0.6, winner: 'B', closeness: 'very-close',
      highlight: { factorId: 'f1', direction: 'increase', thresholdShare: 0.359 },
      hypothesis: 'f1',
      thresholds: { f1: 0.359, f2: 0.226, f3: 0.286, f4: 0.13 },
    },
  },
  {
    id: 'J4',
    title: '考研还是直接就业',
    raw: {
      title: '考研还是直接就业',
      options: [{ label: '全职考研一年' }, { label: '直接就业' }],
      factors: [
        { id: 'f1', label: '长期学历门槛', weight: 4, ratings: { A: 8, B: 4 } },
        { id: 'f2', label: '一年机会成本', weight: 4, ratings: { A: 3, B: 8 } },
        { id: 'f3', label: '当下学习状态', weight: 2, ratings: { A: 7, B: 6 } },
        { id: 'f4', label: '家里的经济支持', weight: 2, ratings: { A: 6, B: 6 } },
      ],
    },
    expect: {
      scoreA: 58.3, scoreB: 60.0, difference: -1.7, winner: 'B', closeness: 'very-close',
      highlight: { factorId: 'f2', direction: 'decrease', thresholdShare: 0.31 },
      hypothesis: 'f2',
      thresholds: { f1: 0.36, f2: 0.31, f3: 0.286, f4: null },
    },
  },
  {
    id: 'J5',
    title: '健身房年卡还是居家训练',
    raw: {
      title: '健身房年卡还是居家训练',
      options: [{ label: '办健身房年卡' }, { label: '居家训练' }],
      factors: [
        { id: 'f1', label: '训练动作丰富度', weight: 4, ratings: { A: 9, B: 4 } },
        { id: 'f2', label: '年花费', weight: 3, ratings: { A: 4, B: 9 } },
        { id: 'f3', label: '坚持难度', weight: 3, ratings: { A: 7, B: 3 } },
        { id: 'f4', label: '通勤到馆时间', weight: 2, ratings: { A: 5, B: 6 } },
      ],
    },
    expect: {
      scoreA: 65.8, scoreB: 53.3, difference: 12.5, winner: 'A', closeness: 'clear',
      highlight: { factorId: 'f2', direction: 'increase', thresholdShare: 0.4 },
      hypothesis: 'f1',
      thresholds: { f1: 0.111, f2: 0.4, f3: null, f4: 0.63 },
    },
  },
];

let failures = 0;
const fail = (journeyId, what, actual, expected) => {
  failures += 1;
  console.log(`  [FAIL] ${journeyId} ${what}: 实际=${actual} 期望=${expected}`);
};
const eq = (journeyId, what, actual, expected) => {
  if (actual !== expected) fail(journeyId, what, actual, expected);
};

for (const journey of JOURNEYS) {
  const { id, raw, expect: want } = journey;
  const v = validate(raw);
  if (!v.ok) {
    fail(id, '输入校验', `${v.code} ${v.message}`, 'ok:true');
    continue;
  }

  const s = scoreDecision(raw);
  eq(id, 'scoreA(1位小数)', r1(s.scoreA), want.scoreA);
  eq(id, 'scoreB(1位小数)', r1(s.scoreB), want.scoreB);
  eq(id, 'difference(1位小数,原始值算)', r1(s.difference), want.difference);
  eq(id, 'winner', s.winner, want.winner);
  eq(id, 'closeness', s.closeness, want.closeness);

  const thresholds = findFlipThresholds(raw);
  for (const [factorId, wantShare] of Object.entries(want.thresholds)) {
    const t = thresholds.find((x) => x.factorId === factorId);
    if (!t) { fail(id, `阈值 ${factorId}`, '缺失', wantShare); continue; }
    if (wantShare === null) {
      eq(id, `阈值 ${factorId} 应不可行`, t.feasible, false);
    } else {
      eq(id, `阈值 ${factorId} 应可行`, t.feasible, true);
      eq(id, `阈值 ${factorId} 占比`, Math.round(t.thresholdShare * 1000) / 1000, wantShare);
    }
  }

  const highlight = pickFlipHighlight(thresholds);
  if (!highlight) {
    fail(id, 'highlight', 'null', want.highlight.factorId);
  } else {
    eq(id, 'highlight.factorId', highlight.factorId, want.highlight.factorId);
    eq(id, 'highlight.direction', highlight.direction, want.highlight.direction);
    eq(id, 'highlight.thresholdShare', Math.round(highlight.thresholdShare * 1000) / 1000, want.highlight.thresholdShare);
  }

  const hyp = chooseValidationHypothesis(raw, s);
  eq(id, 'hypothesis.factorId', hyp.factorId, want.hypothesis);
  eq(id, 'hypothesis.steps 数量', hyp.steps.length, 3);
  if (!hyp.caveat || hyp.caveat.length === 0) fail(id, 'hypothesis.caveat', '空', '非空');

  const tied = s.contributions.filter((c) => Math.abs(c.delta) < 1e-9).map((c) => c.factorId);
  console.log(
    `${id} ${s.winner} ${r1(s.scoreA)}:${r1(s.scoreB)} diff=${r1(s.difference)} ` +
    `${s.closeness} | highlight=${highlight ? highlight.factorId : 'null'} | ` +
    `hyp=${hyp.factorId} | 零贡献=${tied.join(',') || '无'}`,
  );
}

console.log('');
if (failures === 0) {
  console.log(`PASS 全部通过：${JOURNEYS.length} 条旅程与 site/core.mjs 输出一致`);
  process.exit(0);
}
console.log(`FAIL 共 ${failures} 项不一致`);
process.exit(1);
