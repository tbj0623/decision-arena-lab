/**
 * 内存中的有限撤销／重做历史。只保存编辑器字段，不存个人账号、网络信息或基准快照。
 * 包括不完整的编辑（如空方案名），使错误状态也可以被撤销。
 * 此文件是无 DOM 的纯计算模块，刷新即消失。
 */
export const DEFAULT_HISTORY_LIMIT = 30;
export const DEFAULT_MERGE_WINDOW_MS = 750;

export function cloneEditorState(raw) {
  if (!raw || !Array.isArray(raw.options) || !Array.isArray(raw.factors)) {
    throw new TypeError('Invalid editor state');
  }
  return {
    title: raw.title ?? '',
    options: raw.options.map((o) => ({ id: o.id, label: o.label })),
    factors: raw.factors.map((f) => ({
      id: f.id, label: f.label, weight: f.weight,
      ratings: { A: f.ratings.A, B: f.ratings.B },
    })),
  };
}

/**
 * record() 记录一次已经生效的模型编辑；只有相同的输入框、短时连续改动才合并一步。
 * reset() 是隐私边界：清空、导入或切换决策后，旧历史从内存里全部丢弃。
 */
export function createEditorHistory(initial, { limit = DEFAULT_HISTORY_LIMIT, mergeWindowMs = DEFAULT_MERGE_WINDOW_MS } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Invalid history limit');
  if (!Number.isFinite(mergeWindowMs) || mergeWindowMs < 0) throw new RangeError('Invalid merge window');
  let current = cloneEditorState(initial);
  const past = [];
  const future = [];
  let lastGroup = null;
  let lastTime = -Infinity;

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const forgetMerge = () => { lastGroup = null; lastTime = -Infinity; };

  return {
    record(raw, { group = null, time = Date.now() } = {}) {
      const next = cloneEditorState(raw);
      if (same(next, current)) return false;
      const coalesce = Boolean(group) && group === lastGroup &&
        Number.isFinite(time) && time >= lastTime && time - lastTime <= mergeWindowMs &&
        past.length > 0 && future.length === 0;
      if (!coalesce) {
        past.push(current);
        if (past.length > limit) past.shift();
      }
      current = next;
      future.length = 0;
      lastGroup = group || null;
      lastTime = Number.isFinite(time) ? time : -Infinity;
      return true;
    },
    undo() {
      if (!past.length) return null;
      future.push(current);
      current = past.pop();
      forgetMerge();
      return cloneEditorState(current);
    },
    redo() {
      if (!future.length) return null;
      past.push(current);
      current = future.pop();
      forgetMerge();
      return cloneEditorState(current);
    },
    reset(raw) {
      current = cloneEditorState(raw);
      past.length = 0;
      future.length = 0;
      forgetMerge();
    },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
    get undoDepth() { return past.length; },
    get redoDepth() { return future.length; },
    get current() { return cloneEditorState(current); },
  };
}
