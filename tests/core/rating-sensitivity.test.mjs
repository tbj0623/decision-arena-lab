import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyDecision, scoreDecision } from '../../site/core.mjs';
import { probeRatingSensitivity } from '../../site/features/rating-sensitivity.mjs';

function makeDecision() {
  const input = createEmptyDecision();
  input.title = '我的测试决策';
  input.factors[0].ratings.A = 6;
  input.factors[0].ratings.B = 5;
  return input;
}

test('评分压力测试：零修改输入；无网络、无依赖，返回有限枚举结果', () => {
  const input = makeDecision();
  const snapshot = JSON.stringify(input);
  const r = probeRatingSensitivity(input);
  assert.equal(JSON.stringify(input), snapshot);
  assert.equal(r.tested, 16);
  assert.equal(r.baseWinner, 'A');
  assert.ok(r.changedCount > 0);
  assert.ok(r.changes.length <= 3);
  assert.ok(r.closest);
});

test('评分压力测试：0/10 边界不允许越界候选', () => {
  const input = makeDecision();
  for (const f of input.factors) {
    f.ratings.A = 0;
    f.ratings.B = 10;
  }
  const r = probeRatingSensitivity(input);
  assert.equal(r.tested, 8, '4 个因素 × 2 方案 × 仅一个合法方向');
  assert.equal(r.baseWinner, 'B');
  assert.equal(r.changedCount, 0);
});

test('评分压力测试：十分明显的领先，在逐项 ±1 分下保持不变', () => {
  const input = makeDecision();
  for (const f of input.factors) {
    f.ratings.A = 9;
    f.ratings.B = 2;
  }
  const r = probeRatingSensitivity(input);
  assert.equal(r.baseWinner, 'A');
  assert.equal(r.changedCount, 0);
  assert.equal(r.changes.length, 0);
});

test('评分压力测试：原本打平时，任一微调可能决定倾向', () => {
  const input = createEmptyDecision();
  const r = probeRatingSensitivity(input);
  assert.equal(r.baseWinner, 'tie');
  assert.equal(r.tested, 16);
  assert.equal(r.changedCount, 16);
  for (const c of r.changes) assert.notEqual(c.winner, 'tie');
});

test('评分压力测试：权重为零时改评分不影响结果', () => {
  const input = makeDecision();
  input.factors.forEach((f, i) => { f.weight = i === 0 ? 1 : 0; });
  input.factors[0].ratings.A = 9;
  input.factors[0].ratings.B = 1;
  const r = probeRatingSensitivity(input);
  assert.equal(r.changedCount, 0);
  assert.equal(r.baseWinner, 'A');
});

test('评分压力测试：最多六因素，全部合法候选数量准确', () => {
  const input = makeDecision();
  input.factors.push({ id: 'f5', label: '家庭', weight: 2, ratings: { A: 6, B: 6 } });
  input.factors.push({ id: 'f6', label: '通勤', weight: 2, ratings: { A: 6, B: 6 } });
  const r = probeRatingSensitivity(input);
  assert.equal(r.tested, 24);
});

test('评分压力测试：每条展示的变化都可由原算法独立重算', () => {
  const input = makeDecision();
  const r = probeRatingSensitivity(input);
  for (const c of r.changes) {
    const changed = structuredClone(input);
    const factor = changed.factors.find((f) => f.id === c.factorId);
    assert.ok(factor);
    assert.equal(factor.ratings[c.side], c.before);
    factor.ratings[c.side] = c.after;
    const rechecked = scoreDecision(changed);
    assert.equal(rechecked.winner, c.winner);
    assert.ok(Math.abs(rechecked.difference - c.difference) < 1e-9);
  }
});

test('评分压力测试：无效输入沿用原算法校验，不返回编造结果', () => {
  assert.throws(() => probeRatingSensitivity({ factors: [] }));
  assert.throws(() => probeRatingSensitivity(null));
});
