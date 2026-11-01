import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyDecision, scoreDecision } from '../../site/core.mjs';
import { captureScenario, compareScenarios } from '../../site/features/scenario-compare.mjs';

function sample() {
  const input = createEmptyDecision();
  input.title = '换不换工作';
  input.factors[0].ratings.A = 8;
  input.factors[0].ratings.B = 4;
  return input;
}

test('基准深拷贝与原始输入隔离，且仅包含白名单字段', () => {
  const input = sample();
  input.privateNote = 'not exported';
  const original = JSON.stringify(input);
  const saved = captureScenario(input);
  input.factors[0].ratings.A = 0;
  input.options[0].label = '被修改的名字';
  assert.equal(saved.factors[0].ratings.A, 8);
  assert.equal(saved.options[0].label, '方案 A');
  assert.equal(saved.privateNote, undefined);
  assert.notEqual(JSON.stringify(input), original);
  assert.deepEqual(Object.keys(saved).sort(), ['factors', 'options', 'title']);
});

test('同一情景比较无差异，不修改原始数据', () => {
  const source = sample();
  const before = JSON.stringify(source);
  const saved = captureScenario(source);
  const result = compareScenarios(saved, source);
  assert.equal(result.changedFields, 0);
  assert.equal(result.changedWinner, false);
  assert.equal(result.scoreDeltaA, 0);
  assert.equal(result.scoreDeltaB, 0);
  assert.equal(result.gapDelta, 0);
  assert.equal(JSON.stringify(source), before);
});

test('修改评分后比较与核心评分公式严格一致', () => {
  const source = sample();
  const saved = captureScenario(source);
  source.factors[0].ratings.A = 2;
  const result = compareScenarios(saved, source);
  assert.equal(result.changedFields, 1);
  assert.equal(result.changedWinner, true);
  assert.equal(result.before.winner, 'A');
  assert.equal(result.after.winner, 'B');
  assert.ok(Math.abs(result.scoreDeltaA -
    (scoreDecision(source).scoreA - scoreDecision(saved).scoreA)) < 1e-9);
});

test('改变因素数量、权重和名称时比较仍然有效', () => {
  const source = sample();
  const saved = captureScenario(source);
  source.options[1].label = '方案 C';
  source.factors[0].weight = 10;
  source.factors[0].label = '关键因素';
  source.factors.push({ id: 'f5', label: '家庭时间', weight: 1, ratings: { A: 6, B: 7 } });
  const result = compareScenarios(saved, source);
  assert.equal(result.changedFields, 4);
  assert.equal(result.optionNamesChanged, true);
  assert.equal(result.criteriaChanged, true);
  assert.ok(Number.isFinite(result.gapDelta));
});

test('基准中的因素被删除，比较计入结构变化', () => {
  const source = sample();
  source.factors.push({ id: 'f5', label: '心情', weight: 1, ratings: { A: 5, B: 5 } });
  const saved = captureScenario(source);
  source.factors.pop();
  const result = compareScenarios(saved, source);
  assert.equal(result.changedFields, 1);
});

test('两份场景都独立走原核心校验：无效输入直接拒绝', () => {
  const source = sample();
  const saved = captureScenario(source);
  assert.throws(() => compareScenarios(saved, null));
  assert.throws(() => compareScenarios(null, source));
  source.factors.forEach((f) => { f.weight = 0; });
  assert.throws(() => compareScenarios(saved, source));
});

test('打平后的倾向变化与展示精度分离处理', () => {
  const source = createEmptyDecision();
  const saved = captureScenario(source);
  source.factors[0].ratings.A = 5.5;
  const result = compareScenarios(saved, source);
  assert.equal(result.before.winner, 'tie');
  assert.equal(result.after.winner, 'A');
  assert.equal(result.changedWinner, true);
});

test('恢复基准时重新拷贝，不能反向修改已保存的基准', () => {
  const source = sample();
  const saved = captureScenario(source);
  const restored = captureScenario(saved);
  restored.factors[0].ratings.A = 0;
  assert.equal(saved.factors[0].ratings.A, 8);
});
