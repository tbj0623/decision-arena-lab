import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyDecision } from '../../site/core.mjs';
import { cloneEditorState, createEditorHistory, DEFAULT_HISTORY_LIMIT } from '../../site/features/editor-history.mjs';

function make() {
  const d = createEmptyDecision();
  d.title = '一份个人决策';
  d.factors[0].ratings.A = 8;
  return d;
}

test('历史默认没有撤销、重做；初始快照和外部引用隔离', () => {
  const d = make();
  const h = createEditorHistory(d);
  d.factors[0].ratings.A = 0;
  assert.equal(h.current.factors[0].ratings.A, 8);
  assert.equal(h.canUndo, false);
  assert.equal(h.canRedo, false);
  const got = h.current;
  got.options[0].label = '污染';
  assert.notEqual(h.current.options[0].label, '污染');
});

test('普通编辑可撤销、重做，输入源不能反向污染历史', () => {
  const d = make();
  const h = createEditorHistory(d);
  const modified = cloneEditorState(d);
  modified.factors[0].ratings.A = 2;
  assert.equal(h.record(modified), true);
  modified.factors[0].ratings.A = 0;
  assert.equal(h.current.factors[0].ratings.A, 2);
  assert.equal(h.undo().factors[0].ratings.A, 8);
  assert.equal(h.canRedo, true);
  assert.equal(h.redo().factors[0].ratings.A, 2);
  assert.equal(h.canRedo, false);
});

test('相同内容不会入历史；连贯拖动同一输入框会合并成一次撤销', () => {
  const d = make();
  const h = createEditorHistory(d);
  assert.equal(h.record(d), false);
  const a = cloneEditorState(d);
  a.factors[0].weight = 4;
  h.record(a, { group: 'input:w-f1', time: 1000 });
  const b = cloneEditorState(a);
  b.factors[0].weight = 5;
  h.record(b, { group: 'input:w-f1', time: 1150 });
  const c = cloneEditorState(b);
  c.factors[0].weight = 6;
  h.record(c, { group: 'input:w-f1', time: 1450 });
  assert.equal(h.undoDepth, 1);
  assert.equal(h.undo().factors[0].weight, d.factors[0].weight);
  assert.equal(h.redo().factors[0].weight, 6);
});

test('不同输入框不合并；同一输入框超时后也算新的一步', () => {
  const d = make();
  const h = createEditorHistory(d);
  const a = cloneEditorState(d); a.factors[0].weight = 4;
  const b = cloneEditorState(a); b.factors[1].weight = 5;
  const c = cloneEditorState(b); c.factors[1].weight = 6;
  h.record(a, { group: 'input:w-f1', time: 1000 });
  h.record(b, { group: 'input:w-f2', time: 1200 });
  h.record(c, { group: 'input:w-f2', time: 3000 });
  assert.equal(h.undoDepth, 3);
  assert.equal(h.undo().factors[1].weight, 5);
  assert.equal(h.undo().factors[1].weight, d.factors[1].weight);
});

test('撤销后进行新编辑，旧的重做分支必须失效', () => {
  const d = make();
  const h = createEditorHistory(d);
  const a = cloneEditorState(d); a.factors[0].weight = 4;
  const b = cloneEditorState(a); b.factors[0].weight = 8;
  h.record(a); h.record(b);
  h.undo();
  assert.equal(h.canRedo, true);
  const branch = cloneEditorState(a); branch.options[1].label = '新分支';
  h.record(branch);
  assert.equal(h.canRedo, false);
  assert.equal(h.redo(), null);
});

test('空名称等临时无效的表单模型也能撤销，不用伪造有效结果', () => {
  const d = make();
  const h = createEditorHistory(d);
  const invalid = cloneEditorState(d); invalid.options[0].label = '';
  h.record(invalid);
  assert.equal(h.current.options[0].label, '');
  assert.equal(h.undo().options[0].label, d.options[0].label);
});

test('结构编辑：增加或删除因素可撤销且恢复原顺序与身份', () => {
  const d = make();
  const h = createEditorHistory(d);
  const added = cloneEditorState(d);
  added.factors.push({ id: 'f5', label: '新因素', weight: 3, ratings: { A: 5, B: 7 } });
  h.record(added);
  assert.equal(h.undo().factors.length, 4);
  assert.equal(h.redo().factors[4].id, 'f5');
});

test('隐私清除：reset 会舍弃过去及未来编辑，无法撤销找回旧决策', () => {
  const d = make();
  const h = createEditorHistory(d);
  const a = cloneEditorState(d); a.title = '秘密决策内容';
  h.record(a);
  h.undo();
  const fresh = createEmptyDecision();
  h.reset(fresh);
  assert.equal(h.canUndo, false);
  assert.equal(h.canRedo, false);
  assert.equal(h.undo(), null);
  assert.equal(h.redo(), null);
  assert.notEqual(h.current.title, '秘密决策内容');
});

test('有界记录最多保存 30 步，不能无限增长', () => {
  const d = make();
  const h = createEditorHistory(d);
  for (let i = 1; i <= 80; i += 1) {
    const next = cloneEditorState(d); next.title = '版本 ' + i;
    h.record(next);
  }
  assert.equal(DEFAULT_HISTORY_LIMIT, 30);
  assert.equal(h.undoDepth, 30);
  for (let i = 0; i < 30; i += 1) assert.ok(h.undo());
  assert.equal(h.undo(), null);
  assert.equal(h.current.title, '版本 50');
});

test('编辑历史仅保留白名单字段，不捕获额外的私有信息', () => {
  const d = make();
  d.extraPrivateData = '不要进入撤销历史';
  d.factors[0].metadata = { private: true };
  const copy = cloneEditorState(d);
  assert.deepEqual(Object.keys(copy).sort(), ['factors', 'options', 'title']);
  assert.equal(copy.extraPrivateData, undefined);
  assert.equal(copy.factors[0].metadata, undefined);
});

test('非法历史参数或结构必须拒绝', () => {
  const d = make();
  assert.throws(() => createEditorHistory(d, { limit: -3 }), RangeError);
  assert.throws(() => createEditorHistory(d, { limit: 101 }), RangeError);
  assert.throws(() => createEditorHistory(d, { mergeWindowMs: -2 }), RangeError);
  assert.throws(() => cloneEditorState({ title: 'x' }), TypeError);
});
