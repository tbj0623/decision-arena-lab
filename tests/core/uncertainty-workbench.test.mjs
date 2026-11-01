import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyDecision, scoreDecision } from '../../site/core.mjs';
import { analyzeSelectedUncertainty } from '../../site/features/uncertainty-workbench.mjs';

function input() {
  const d = createEmptyDecision();
  d.title = '自己的判断';
  d.factors = d.factors.map((f, i) => ({
    ...f, weight: i === 0 ? 4 : 2,
    ratings: { A: i === 0 ? 8 : 5, B: i === 0 ? 2 : 5 },
  }));
  return d;
}
const select = (id, side) => ({ factorId: id, side });

test('不勾选任何评分时不暗示结论稳健，也不偷偷修改输入', () => {
  const d = input(), previous = JSON.stringify(d);
  const r = analyzeSelectedUncertainty(d, []);
  assert.equal(r.status, 'not-configured');
  assert.equal(r.interval, null);
  assert.equal(r.witness, null);
  assert.equal(r.activeCount, 0);
  assert.equal(JSON.stringify(d), previous);
});

test('一个因素的两种方案均可变，最坏最优差值由原核精确算出', () => {
  const d = input();
  const r = analyzeSelectedUncertainty(d, [select('f1','A'),select('f1','B')], 2);
  assert.equal(r.activeCount, 2);
  assert.equal(r.status, 'always-A');
  assert.ok(Math.abs(r.interval.minDelta - 8) < 1e-9);
  assert.ok(Math.abs(r.interval.maxDelta - 40) < 1e-9);
  assert.equal(r.witness.changes.length, 2);
  assert.equal(r.canChangeWinner, false);
  assert.ok(Math.abs(r.witness.difference-r.interval.minDelta) < 1e-9);
});

test('多个评分允许独立同时变化：能发现单项修改无法观察到的反转', () => {
  const d = createEmptyDecision();
  d.title = '交叉验证';
  d.factors.forEach((f) => { f.weight = 2; f.ratings.A = 6; f.ratings.B = 5.5; });
  const r = analyzeSelectedUncertainty(d, d.factors.map((f) => select(f.id,'A')), 1);
  assert.equal(r.point.winner, 'A');
  assert.equal(r.activeCount, 4);
  assert.equal(r.status, 'both-possible');
  assert.equal(r.canChangeWinner, true);
  assert.ok(r.interval.minDelta < 0);
  assert.ok(r.interval.maxDelta > 0);
  assert.equal(r.witness.winner, 'B');
  assert.equal(r.witness.changes.length, 4);
});

test('0 与 10 的评分波动会被正确裁剪，不静默越界', () => {
  const d = createEmptyDecision();
  d.title = '边界';
  d.factors[0].ratings.A = 0;
  d.factors[0].ratings.B = 10;
  const r = analyzeSelectedUncertainty(d, [select('f1','A'),select('f1','B')], 2);
  assert.ok(r.interval.minDelta <= r.interval.maxDelta);
  assert.ok(r.witness.changes.every((c) => c.after >= 0 && c.after <= 10));
  const a0 = r.interval.factors[0].intervals.A;
  const b0 = r.interval.factors[0].intervals.B;
  assert.deepEqual(a0, [0,2]);
  assert.deepEqual(b0, [8,10]);
});

test('只选择一个评分时，未勾选的任何评分保持原样', () => {
  const d = input();
  const r = analyzeSelectedUncertainty(d, [select('f2','B')], 0.5);
  assert.equal(r.activeCount, 1);
  for (const [i,f] of r.interval.factors.entries()) {
    const raw = d.factors[i];
    if (i === 1) {
      assert.deepEqual(f.intervals.A, [raw.ratings.A,raw.ratings.A]);
      assert.deepEqual(f.intervals.B, [raw.ratings.B-0.5,raw.ratings.B+0.5]);
    } else {
      assert.deepEqual(f.intervals.A, [raw.ratings.A,raw.ratings.A]);
      assert.deepEqual(f.intervals.B, [raw.ratings.B,raw.ratings.B]);
    }
  }
});

test('相同格子重复勾选只算一次；选择顺序不影响数值', () => {
  const d = input();
  const selected = [select('f1','A'), select('f2','B')];
  const a = analyzeSelectedUncertainty(d, selected);
  const b = analyzeSelectedUncertainty(d, [...selected].reverse().concat(selected));
  assert.equal(b.activeCount, 2);
  assert.equal(a.interval.minDelta, b.interval.minDelta);
  assert.equal(a.interval.maxDelta, b.interval.maxDelta);
});

test('非法幅度、未知因素、错误方案、无效决策必须明确拒绝', () => {
  const d = input();
  for (const radius of [0, -1, 1.5, 11, Number.NaN, '1']) {
    assert.throws(() => analyzeSelectedUncertainty(d, [select('f1','A')], radius), RangeError);
  }
  assert.throws(() => analyzeSelectedUncertainty(d, null), TypeError);
  assert.throws(() => analyzeSelectedUncertainty(d, [select('unknown','A')]), RangeError);
  assert.throws(() => analyzeSelectedUncertainty(d, [select('f1','Z')]), RangeError);
  assert.throws(() => analyzeSelectedUncertainty({options:[],factors:[]}, []));
});

test('对照闭式上下界用核心评分函数独立重算两种端点', () => {
  const d = input();
  const selects = [select('f1','A'),select('f2','B'),select('f3','A')];
  const r = analyzeSelectedUncertainty(d, selects, 1);
  for (const [name, endpoint, expected] of [
    ['min',r.interval.worstCase,r.interval.minDelta],
    ['max',r.interval.bestCase,r.interval.maxDelta],
  ]) {
    const candidate = structuredClone(d);
    for (const [i,f] of candidate.factors.entries()) {
      f.ratings = { A: endpoint.A[i], B: endpoint.B[i] };
    }
    const score = scoreDecision(candidate);
    assert.ok(Math.abs(score.difference-expected) < 1e-9,name);
  }
});

test('边界恰好可打平时不能宣称任何方案始终领先', () => {
  const d = createEmptyDecision();
  d.title = '恰好打平';
  d.factors.forEach((f) => { f.weight = 2; f.ratings.A=6; f.ratings.B=5.5; });
  const r = analyzeSelectedUncertainty(d, [select('f1','A'),select('f2','A')], 1);
  assert.equal(r.interval.minDelta, 0);
  assert.equal(r.status, 'boundary-possible');
});

test('暴力手动抽取所有被选角点，对比闭式区间结果', () => {
  const d=input();
  const selected = [select('f1','A'),select('f2','B'),select('f3','A')];
  const r=analyzeSelectedUncertainty(d,selected,1);
  const variants=[];
  for(let mask=0;mask<8;mask++){
    const c=structuredClone(d);
    for(let j=0;j<3;j++){
      const {factorId,side}=selected[j];
      const factor=c.factors.find(f=>f.id===factorId);
      const [lo,hi]=r.interval.factors.find(f=>f.factorId===factorId).intervals[side];
      factor.ratings[side] = mask & (1<<j) ? hi : lo;
    }
    variants.push(scoreDecision(c).difference);
  }
  assert.ok(Math.abs(Math.min(...variants)-r.interval.minDelta)<1e-9);
  assert.ok(Math.abs(Math.max(...variants)-r.interval.maxDelta)<1e-9);
});
