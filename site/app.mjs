/**
 * 反悔雷达 · Decision Arena — 界面控制层
 * 只做 DOM 事件与渲染。所有数学都在 core.mjs，示例数据在 features/narrative.mjs。
 *
 * 安全约定：
 *  - 用户输入一律通过 textContent / value 写入 DOM，绝不拼接进 innerHTML。
 *  - 不发起任何网络请求（没有 fetch / XHR / WebSocket / 外部图片 / 外部字体）。
 *  - 不做持久化：不写 localStorage / sessionStorage / IndexedDB / Cookie。
 */

import {
  scoreDecision,
  findFlipThresholds,
  pickFlipHighlight,
  chooseValidationHypothesis,
  validate,
  createEmptyDecision,
  projectAtShare,
  diagnoseNoFlip,
  ValidationError,
} from './core.mjs';

import { EXAMPLES, cloneBody, buildViewpoints, detectHighRisk, highRiskNotice } from './features/narrative.mjs';

/* ───────────── 小工具 ───────────── */

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function $(sel, root = document) {
  return root.querySelector(sel);
}

function fmt1(n) {
  return (Math.round(n * 10) / 10).toFixed(1);
}

/**
 * 把一组数四舍五入到 1 位小数，并保证它们的和恰好等于 target 四舍五入后的值。
 *
 * 为什么需要：各项贡献独立四舍五入后相加，可能和总分差 0.1（例如 14.2857 / -11.4286 /
 * 0 / 4.2857 → 14.3 / -11.4 / 0 / 4.3，相加 7.2，而真实差值 7.1428 → 显示 7.1）。
 * 用户会当场认为"这工具算错了"。
 *
 * 用最大余数法把这点误差分摊给余数最大的几项，保证：Σround1(x) === round1(Σx)，
 * 且每一项与它独立的四舍五入值最多差 1 个最小单位（0.1）。
 */
function round1SummingTo(values, target) {
  const r1 = (x) => Math.round(x * 10) / 10;
  const target1 = r1(target);
  const out = values.map(r1);

  // 目标值（已取 1 位）与逐项取整之和的差，单位是 0.1
  let steps = Math.round((target1 - out.reduce((a, b) => a + b, 0)) * 10);

  // 每次把误差最小的一项挪 0.1，直到补齐。最多挪 n 次，不会死循环。
  let guard = 0;
  while (steps !== 0 && guard < values.length * 4) {
    guard += 1;
    const dir = steps > 0 ? 1 : -1;
    let bestIdx = -1;
    let bestCost = Infinity;
    for (let i = 0; i < values.length; i += 1) {
      const currentErr = Math.abs(out[i] - values[i]);
      const nextErr = Math.abs(out[i] + dir * 0.1 - values[i]);
      const cost = nextErr - currentErr;
      if (cost < bestCost - 1e-12) {
        bestCost = cost;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    out[bestIdx] = Math.round((out[bestIdx] + dir * 0.1) * 10) / 10;
    steps -= dir;
  }

  return out;
}

function pct(share, digits = 1) {
  return `${(share * 100).toFixed(digits)}%`;
}

/* ───────────── 状态 ───────────── */

const DEFAULT_FACTOR_NAMES = ['发展空间', '稳定性', '时间成本', '兴趣匹配', '风险', '他人影响'];

let state = createEmptyDecision();
let lastAnalysis = null;
let lastThresholds = [];
let lastFlip = null;
let lastHypothesis = null;
let lastDialogTrigger = null;
/** 高风险命中结果：{risky, area, matched} 或 null */
let lastHighRisk = null;

/* ───────────── 示例卡 ───────────── */

function renderExamples() {
  const grid = $('#example-grid');
  if (!grid) return;
  clear(grid);
  for (const ex of EXAMPLES) {
    const card = el('button', {
      type: 'button',
      class: 'example-card',
      // 不要写 role="listitem"！
      //
      // 历史缺陷（性能/可访问性审计 FAIL-1）：
      // 这里原来是 `<button role="listitem">`。HTML 中 role 会**覆盖**元素的原生语义，
      // 于是读屏把 9 张示例卡念成"列表项"而不是"按钮"，用户不知道它们能点。
      // 键盘 Enter 仍能触发（原生 button 行为还在），所以是语义丢失而非功能损坏 ——
      // 这种缺陷只有查 AX 树或用真读屏才能发现。
      //
      // 正确做法：容器 #example-grid 保留 role="list"，卡片本身保持 button 语义。
      // 列表语义由容器提供，不靠子元素伪造。
      // 不要加「（按钮）」后缀 —— role=button 已经会让读屏念「按钮」，
      // 再写一遍会变成「…（按钮），按钮」（a11y 审计发现的新冗余）。
      'aria-label': `载入示例：${ex.title}`,
      dataset: { example: ex.key },
      onclick: () => loadExample(ex.key),
    },
      el('span', { class: 'ex-emoji', 'aria-hidden': 'true', text: ex.emoji }),
      el('span', { class: 'ex-tag', text: ex.tag }),
      el('strong', { text: ex.title }),
      el('span', { class: 'ex-blurb', text: ex.blurb }));
    // 用 <li> 提供列表项语义，<button> 保持按钮语义 —— 两者不冲突。
    grid.append(el('li', { class: 'example-item' }, card));
  }
}

function loadExample(key) {
  const ex = EXAMPLES.find((e) => e.key === key);
  if (!ex) return;
  state = cloneBody(ex.body);
  renderAll();
  const ws = $('#workspace');
  if (ws) ws.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
}

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ───────────── 因素列表 ───────────── */

function renderFactorList() {
  const list = $('#factor-list');
  if (!list) return;
  clear(list);

  state.factors.forEach((factor, index) => {
    const labelInput = el('input', {
      type: 'text',
      // id 是给因素卡容器的 aria-labelledby 用的：
      // 容器需要"指向一个真实存在的、有文字的元素"才能获得可访问名。
      // 没有 id 的 aria-labelledby 等于没写（浏览器会忽略，名字仍是空）。
      id: `label-${factor.id}`,
      maxlength: '60',
      autocomplete: 'off',
      value: factor.label,
      // 有可见/半可见的 label 关系后，aria-label 会**覆盖**它，
      // 所以这里保留"第 N 个因素的名称"作为兜底（容器分组靠 aria-labelledby）。
      'aria-label': `第 ${index + 1} 个因素的名称`,
      dataset: { factorId: factor.id, field: 'label' },
      oninput: (e) => { factor.label = e.target.value; scheduleRecalc(); },
    });

    const removeBtn = el('button', {
      type: 'button',
      class: 'icon-btn',
      'aria-label': `删除因素「${factor.label || '未命名'}」`,
      title: '删除这个因素',
      disabled: state.factors.length <= 4,
      onclick: () => removeFactor(factor.id),
    }, '✕');

    const ratingA = makeRatingRow(factor, 'A');
    const ratingB = makeRatingRow(factor, 'B');

    const weightRange = el('input', {
      type: 'range',
      min: '0', max: '10', step: '0.5',
      value: String(factor.weight),
      id: `w-${factor.id}`,
      'aria-describedby': `w-out-${factor.id}`,
      oninput: (e) => {
        factor.weight = clampWeight(Number(e.target.value));
        const out = document.getElementById(`w-out-${factor.id}`);
        if (out) out.value = String(factor.weight);
        scheduleRecalc();
      },
    });

    const weightOut = el('output', {
      id: `w-out-${factor.id}`,
      for: `w-${factor.id}`,
      value: String(factor.weight),
    }, String(factor.weight));

    // 因素卡必须有**分组边界 + 可区分的名字**（AX 树审计最严重的问题）。
    //
    // 实测：4 张因素卡 × (4 个加减按钮 + 2 个评分框 + 1 个权重滑杆) = 28 个控件，
    // 在 AX 树上只归并出 **7 个逐字相同的名字**，父链 `none ← listitem ← list`
    // （listitem 自己的 name 是空串，那个 .sr-only 的「因素 1」根本没挂到容器上）。
    // 读屏用户连按 4 次 Tab，听到的是同一句话，**不知道自己正在改哪一项**。
    //
    // 修法：li 加 role="group" + aria-labelledby 指向因素名输入框。
    // 一行的结构改动同时消解「名字不可区分」和「没有分组边界」两件事。
    const item = el('li', {
      class: 'factor-item',
      dataset: { factorId: factor.id },
      role: 'group',
      'aria-labelledby': `label-${factor.id}`,
    },
      el('div', { class: 'factor-top' },
        labelInput,
        removeBtn),
      el('div', { class: 'rating-block' }, ratingA, ratingB),
      el('div', { class: 'weight-block' },
        el('label', { for: `w-${factor.id}` },
          el('span', {}, '重要性权重 ', el('span', { class: 'hint', text: '（0 = 完全不考虑，10 = 最重要）' })),
          weightOut),
        weightRange));

    list.append(item);
  });

  const addBtn = $('#add-factor');
  if (addBtn) {
    addBtn.disabled = state.factors.length >= 6;
    addBtn.hidden = state.factors.length >= 6;
  }
}

function makeRatingRow(factor, side) {
  const value = factor.ratings[side];
  const numId = `r-${factor.id}-${side}`;
  const errId = `e-${factor.id}-${side}`;
  const optionLabel = state.options[side === 'A' ? 0 : 1].label || (side === 'A' ? '方案 A' : '方案 B');

  // 非法输入的提示必须可见且被读屏软件播报。
  // 之前的实现只设 aria-invalid 就 return，既不显示文字也不回滚 ——
  // 结果是输入框里写着 11、实际却按 1 在算（因为敲第一个 "1" 时已经提交过一次）。
  // 界面显示与实际计算不一致，比直接报错危险得多，所以这里做三件事：
  //   1) 显示一行 role="alert" 的文字，说明合法范围、以及"下面结果仍按上一次有效值计算"
  //   2) 设 aria-invalid + aria-describedby，让读屏软件能关联到原因
  //   3) 失焦时回滚到上一次有效值，保证静止状态下"看到的数 = 参与计算的数"
  const error = el('p', {
    class: 'rating-error',
    id: errId,
    role: 'alert',
    hidden: true,
  });

  // 错误提示要说清两件事：合法范围是什么、以及**当前是按哪个值在算**。
  // 后半句很重要 —— 用户必须知道自己看到的分数对应哪个输入，
  // 否则「按上一次有效值 1 计算」这种话会让从没输过 1 的人一头雾水。
  const showError = (lastValid, kind = null) => {
    const rangeText = kind === 'step'
      ? '评分必须是 0 到 10 之间、且以 0.5 为步进的数'
      : '评分必须在 0 到 10 之间';
    error.textContent = `${rangeText}。目前的结果仍按你上一次输入的 ${lastValid} 计算；离开这个输入框会恢复成 ${lastValid}。`;
    error.hidden = false;
  };
  const clearError = () => {
    error.textContent = '';
    error.hidden = true;
  };

  const input = el('input', {
    type: 'number',
    id: numId,
    min: '0', max: '10', step: '0.5',
    value: String(value),
    inputmode: 'decimal',
    'aria-label': `${side === 'A' ? '方案 A' : '方案 B'} 在这项上的评分（0–10）`,
    dataset: { factorId: factor.id, side },
    // 评分输入：**只在值合法时才写进 factor.ratings 并重算**。
    //
    // 历史缺陷（边界压测 BUG-03，最严重的一个）：
    // 原实现是"边打边提交" —— 用户敲 `11` 时，第一下敲的 `1` 是合法值，
    // 于是立刻被写进 ratings 并重算（70.7/63.6 → 42.1/63.6）；
    // 第二下 `1` 拼成 `11` 后虽然标了 aria-invalid，但**分数已经被污染**。
    // 失焦时又按"回滚到上一次有效值"把输入框填成 `1` ——
    // 用户从没输过 1，界面却变成了 1。
    //
    // 连带后果：告警还亮着时点导出，写进文件的就是那个中间值。
    //
    // 修法：非法值只标记错误、**不写入、不重算**。
    // 这样失焦回滚时回到的是"用户上一次真正确认过的值"，不是中间态。
    // 空串同样不写入（用户可能在清空后重新输入）。
    oninput: (e) => {
      const raw = e.target.value;
      if (raw === '') {
        e.target.dataset.pending = '1';
        e.target.removeAttribute('aria-invalid');
        e.target.removeAttribute('aria-describedby');
        clearError();
        return;
      }
      delete e.target.dataset.pending;
      const num = Number(raw);
      // 同时校验 step（HTML 的 step="0.5" 只约束浏览器 UI，不约束 Number()）
      const stepOk = Number.isInteger(num * 2);
      const invalid = !Number.isFinite(num) || num < 0 || num > 10 || !stepOk;
      if (invalid) {
        e.target.setAttribute('aria-invalid', 'true');
        e.target.setAttribute('aria-describedby', errId);
        // 提示里说清楚"当前按哪个值算"，而这个值一定是用户自己输过的
        showError(factor.ratings[side], stepOk ? null : 'step');
        return; // ← 关键：不写 factor.ratings，不 scheduleRecalc
      }
      e.target.removeAttribute('aria-invalid');
      e.target.removeAttribute('aria-describedby');
      clearError();
      // ── 提交时机：只改"确认后才生效"，不用防抖毫秒数 ──
      //
      // 历史缺陷（最终验收发现，260/270/300/400ms 间隔全部失败）：
      // 我上一版用 260ms 防抖，理由是"人类打字间隔 80–200ms"。
      // **这个前提是错的** —— 实测人类正常打字 150–300ms/键。
      // 于是输 "11" 时：第一下 "1" 在 260ms 后被提交（70.7→42.1），
      // 第二下 "1" 拼成非法值，失焦回滚成 1 —— 而用户从未输入过 1。
      //
      // 根因不是毫秒数不够大，而是**思路错了**：
      // 只要有"未确认的编辑"，就不该提交。
      //
      // 修法：oninput 只校验 + 标记，**完全不改 factor.ratings、不重算**；
      // 提交只发生在 change（失焦 / 回车）。
      // 这是数字输入框的标准语义 —— 确认后生效。
      // 加号减号（bumpRating）是明确点击，仍立即生效。
      e.target.dataset.dirty = '1';
    },
    // 失焦 / 回车：这里才提交（或回滚）
    onchange: (e) => {
      const target = e.target;
      const raw = target.value;
      const num = Number(raw);

      // 合法：写入并重算
      if (raw !== '' && Number.isFinite(num) && num >= 0 && num <= 10 && Number.isInteger(num * 2)) {
        factor.ratings[side] = num;
        target.removeAttribute('aria-invalid');
        target.removeAttribute('aria-describedby');
        delete target.dataset.dirty;
        clearError();
        scheduleRecalc();
        return;
      }
      // 不合法 / 空：回滚到上一次**确认过**的值（也就是 factor.ratings 里的）
      target.value = String(factor.ratings[side]);
      target.removeAttribute('aria-invalid');
      target.removeAttribute('aria-describedby');
      delete target.dataset.dirty;
      clearError();
    },
    onblur: (e) => {
      // 回滚统一在这里做：空值、以及任何非法值，都恢复成"真正参与计算的那个数"。
      // 注意不要在这里顺手 removeAttribute('aria-invalid') 却又不回滚 —— 那正是原来的 bug。
      const raw = e.target.value;
      const num = Number(raw);
      const invalid = raw === '' || !Number.isFinite(num) || num < 0 || num > 10;
      if (invalid) {
        e.target.value = String(factor.ratings[side]);
        clearError();
      }
      e.target.removeAttribute('aria-invalid');
      e.target.removeAttribute('aria-describedby');
      delete e.target.dataset.pending;
    },
  });

  const dec = el('button', {
    type: 'button', 'aria-label': `减少${optionLabel}在这项上的评分`,
    onclick: () => bumpRating(input, factor, side, -1),
  }, '−');

  const inc = el('button', {
    type: 'button', 'aria-label': `增加${optionLabel}在这项上的评分`,
    onclick: () => bumpRating(input, factor, side, +1),
  }, '＋');

  return el('div', { class: 'rating-row' },
    el('span', { class: 'rating-label', dataset: { side }, text: optionLabel.slice(0, 8) || `${side}` }),
    el('div', { class: 'stepper' }, dec, input, inc),
    error);
}

function bumpRating(input, factor, side, delta) {
  const next = Math.min(10, Math.max(0, Math.round((factor.ratings[side] + delta) * 2) / 2));
  factor.ratings[side] = next;
  input.value = String(next);
  input.removeAttribute('aria-invalid');
  input.removeAttribute('aria-describedby');
  delete input.dataset.pending;
  const err = input.parentElement?.parentElement?.querySelector('.rating-error');
  if (err) { err.textContent = ''; err.hidden = true; }
  scheduleRecalc();
}

function clampWeight(n) {
  if (!Number.isFinite(n)) return 0;
  // 支持 0.5 步进（不是只有整数）。
  //
  // 历史缺陷（首次触达体验走查 B-2，阻断级）：
  // 权重滑杆原来 step=1、且这里 Math.round() 强制取整。
  // 但翻转发生在细粒度的权重占比上 —— 实测 offer 的临界点是 39.39%，
  // 而整数权重只能落到 33.33% / 37.50% / 41.18%，
  // **用户永远够不到"打平"那一刻**，翻转卡片说的数字在界面上做不到。
  //
  // 改成 0.5 步进后，占比粒度足够逼近临界点（配合「跳到精确临界点」按钮）。
  return Math.min(10, Math.max(0, Math.round(n * 2) / 2));
}

function addFactor() {
  if (state.factors.length >= 6) return;
  const used = new Set(state.factors.map((f) => f.label));
  const name = DEFAULT_FACTOR_NAMES.find((n) => !used.has(n)) || `新因素 ${state.factors.length + 1}`;
  let n = state.factors.length + 1;
  while (state.factors.some((f) => f.id === `f${n}`)) n += 1;
  state.factors.push({ id: `f${n}`, label: name, weight: 3, ratings: { A: 5, B: 5 } });
  renderFactorList();
  recalc();
}

function removeFactor(id) {
  if (state.factors.length <= 4) return;
  state.factors = state.factors.filter((f) => f.id !== id);
  renderFactorList();
  recalc();
}

/* ───────────── 计算与渲染 ───────────── */

let recalcTimer = null;
function scheduleRecalc() {
  if (recalcTimer !== null) clearTimeout(recalcTimer);
  recalcTimer = setTimeout(() => { recalcTimer = null; recalc(); }, 90);
}

function readStateFromInputs() {
  const title = $('#decision-title');
  const opA = $('#option-a');
  const opB = $('#option-b');
  if (title) state.title = title.value.trim();
  if (opA) state.options[0].label = opA.value.trim();
  if (opB) state.options[1].label = opB.value.trim();
}

function recalc() {
  readStateFromInputs();

  const resultBody = $('#result-body');
  const empty = $('#result-empty');
  const pill = $('#closeness-pill');

  // 高风险领域警示：只要命中关键词就显示，且**不依赖是否有有效结果**。
  // 预警必须在"看到分数"之前出现，否则用户已经先被那个平静的数字影响了。
  renderHighRiskBanner(state);

  // 先用业务校验，给出友好提示
  const check = validate(state);

  // 「用户还没开始填」和「填错了」是两件不同的事，不能混在一个分支里。
  //
  // 历史缺陷（Lead V9 端到端走查发现）：createEmptyDecision() 返回的
  // **是完全合法的默认状态**——「方案 A / 方案 B」+ 4 个具名因素（发展空间/稳定性/
  // 时间成本/兴趣匹配）+ 全 5 分。它当然能通过 validate。
  // 于是点「清空重来」之后，页面渲染出 50.0 / 50.0 两个分数，
  // 而"上面填好两个方案的名字"那句提示是隐藏的——
  // 用户看到的是一个**凭空出现的分数**，而他的标题框是空的。
  //
  // 判据：**与出厂默认值完全一致** 才算"还没开始"。
  //
  // 历史缺陷（边界压测 BUG-10）：原判据只看标题 + 两个方案名。
  // 于是这些情况全部被误判成"还没开始"，结果区整块隐藏、
  // 提示"上面填好两个方案的名字"，而用户明明已经动过了：
  //   · 只改了评分（5 → 8）
  //   · 只拖了权重滑杆
  //   · 只点了「权重全部拉平」
  //   · 只改了因素名
  //   · 导入了一份 title 为空、方案名恰好是「方案 A」「方案 B」的合法数据 ← 最坑
  //
  // 正确判据：拿 createEmptyDecision() 的出厂值做基准，逐字段比。
  // 任何一处不同 = 用户动过 = 该出结果。
  const baseline = createEmptyDecision();
  const untouched =
    !state.title &&
    state.options[0].label === baseline.options[0].label &&
    state.options[1].label === baseline.options[1].label &&
    state.factors.length === baseline.factors.length &&
    state.factors.every((f, i) => {
      const b = baseline.factors[i];
      return f.label === b.label && f.weight === b.weight &&
        f.ratings.A === b.ratings.A && f.ratings.B === b.ratings.B;
    });

  if (check.ok && untouched) {
    if (resultBody) resultBody.hidden = true;
    if (empty) {
      empty.hidden = false;
      empty.textContent = '上面填好两个方案的名字，结果就会自动出现。';
    }
    if (pill) pill.hidden = true;
    renderFlipEmpty();
    renderVerifyEmpty();
    lastAnalysis = null;
    lastFlip = null;
    lastHypothesis = null;
    return;
  }

  if (!check.ok) {
    // 只有当用户已经填了东西时才显示错误，避免一进页面就红一片
    const touched = state.options[0].label || state.options[1].label || state.options.some((o) => o.label !== '方案 A' && o.label !== '方案 B');
    showFieldError('#options-error', touched && !state.options[0].label ? '方案 A 还没有名字。' : '');
    if (touched && !state.options[1].label) showFieldError('#options-error', '方案 B 还没有名字。');
    if (resultBody) resultBody.hidden = true;
    if (empty) {
      empty.hidden = false;
      empty.textContent = touched
        ? friendlyError(check.code)
        : '上面填好两个方案的名字，结果就会自动出现。';
    }
    // 因素类错误必须**同时**显示在因素列表下方。
    // 只放在结果区会把错误推到离问题很远的地方：用户改坏了因素名，
    // 眼睛却盯着下面的分数区，不知道要去上面找。错误提示应该贴着出错的地方。
    if (touched && FACTOR_ERROR_CODES.has(check.code)) {
      showFieldError('#factors-error', friendlyError(check.code));
    }
    if (pill) pill.hidden = true;
    renderFlipEmpty();
    renderVerifyEmpty();
    lastAnalysis = null;
    return;
  }

  showFieldError('#options-error', '');
  showFieldError('#factors-error', '');

  let analysis;
  try {
    analysis = scoreDecision(state);
  } catch (error) {
    if (error instanceof ValidationError) {
      showFieldError('#factors-error', error.message);
      if (resultBody) resultBody.hidden = true;
      return;
    }
    throw error;
  }

  const thresholds = findFlipThresholds(state);
  const flip = pickFlipHighlight(thresholds);
  const hypothesis = chooseValidationHypothesis(state, analysis);

  lastAnalysis = analysis;
  lastThresholds = thresholds;
  lastFlip = flip;
  lastHypothesis = hypothesis;

  if (empty) empty.hidden = true;
  if (resultBody) resultBody.hidden = false;

  renderScores(analysis);
  renderContribTable(analysis);
  renderFlip(analysis, thresholds, flip);
  renderVerify(hypothesis);
  updateClosenessPill(analysis);
}

/**
 * 这些错误属于「因素」区域，提示必须贴着因素列表显示，不能只丢在结果区。
 *
 * 为什么：用户改坏了因素名（比如两个因素重名），眼睛却盯着下面的分数区，
 * 只看结果区的话他不知道要回上面找。错误提示应该贴在出错的地方。
 */
const FACTOR_ERROR_CODES = new Set([
  'DUPLICATE_FACTOR_LABEL',
  'DUPLICATE_FACTOR_ID',
  'INVALID_FACTOR_LABEL',
  'INVALID_FACTOR',
  'FACTOR_COUNT',
  'ALL_ZERO_WEIGHTS',
  'INVALID_WEIGHT',
  'NEGATIVE_WEIGHT',
  'WEIGHT_TOO_LARGE',
]);

function friendlyError(code) {
  switch (code) {
    case 'INVALID_OPTION_LABEL': return '两个方案都要有个名字才能开始算。';
    case 'DUPLICATE_OPTION_LABEL': return '两个方案的名字不能一模一样。';
    case 'INVALID_FACTOR_LABEL': return '每个因素都要有名字。';
    // 重名不是"不整齐"这么轻的问题：会让翻转卡/贡献表出现两条同名条目，
    // 用户不知道该调哪一个，核心功能直接失效。所以文案要说清"改成能区分的名字"。
    case 'DUPLICATE_FACTOR_LABEL': return '有两个因素用了同一个名字。请改成能区分的名字，比如「发展空间（技术）」和「发展空间（管理）」。';
    case 'ALL_ZERO_WEIGHTS': return '所有因素的权重都是 0，没法算。请至少给一个因素加点权重。';
    case 'FACTOR_COUNT': return '因素数量要在 4–6 个之间。';
    case 'RATING_OUT_OF_RANGE': return '评分必须在 0 到 10 之间。';
    case 'INVALID_RATING':
    case 'INVALID_WEIGHT': return '有评分或权重不是有效数字，请检查一下。';
    default: return '输入还有问题，检查一下上面的字段。';
  }
}

function showFieldError(sel, message) {
  const node = $(sel);
  if (!node) return;
  node.textContent = message || '';
  node.hidden = !message;
}

/* ───────────── 高风险警示 ───────────── */

/**
 * 把高风险警示渲染到结果卡顶部（分数条之前）。
 * 命中时插入/更新，未命中时移除。
 */
function renderHighRiskBanner(input) {
  const host = $('#result-card');
  if (!host) return;
  const existing = host.querySelector('.high-risk-banner');
  const hit = detectHighRisk(input);
  lastHighRisk = hit.risky ? hit : null;

  if (!hit.risky) {
    if (existing) existing.remove();
    return;
  }

  const notice = highRiskNotice(hit.area, hit.matched);
  const banner = el('div', { class: 'high-risk-banner', role: 'alert' },
    el('p', { class: 'high-risk-title', text: '⚠️ ' + notice.title }),
    el('p', { class: 'high-risk-body', text: notice.body }),
    el('p', { class: 'high-risk-extra', text: notice.extra }));

  if (existing) existing.replaceWith(banner);
  else host.insertBefore(banner, host.querySelector('.card-head')?.nextSibling || null);
}

function renderScores(analysis) {
  const box = $('#score-bars');
  if (!box) return;
  clear(box);

  const rows = [
    { side: 'A', label: analysis.options[0].label, score: analysis.scoreA },
    { side: 'B', label: analysis.options[1].label, score: analysis.scoreB },
  ];

  for (const row of rows) {
    const width = Math.max(0, Math.min(100, row.score));
    const isWinner = analysis.winner === row.side;
    box.append(el('div', { class: 'score-row', dataset: { side: row.side } },
      el('div', { class: 'score-row-head' },
        el('span', { class: 'score-name', text: row.label }),
        el('span', { class: 'score-num', text: fmt1(row.score) })),
      el('div', {
        class: 'bar-track',
        role: 'img',
        'aria-label': `${row.label} 得分 ${fmt1(row.score)}，满分 100`,
      },
        el('div', { class: 'bar-fill', style: `width:${width}%` })),
      el('span', { class: 'sr-only', text: isWinner ? '当前更倾向这一项' : '' })));
  }

  const verdict = $('#verdict');
  const sub = $('#verdict-sub');
  const diff = analysis.difference;
  const absDiff = Math.abs(diff);
  const a = analysis.options[0].label;
  const b = analysis.options[1].label;

  if (verdict) {
    if (analysis.tie) verdict.textContent = `按你现在的打分，两边打平。`;
    else verdict.textContent = `按你现在的打分，更倾向「${analysis.winner === 'A' ? a : b}」。`;
  }

  if (sub) {
    if (analysis.tie) {
      sub.textContent = '差值为 0。任何一点权重或评分的改动都可能让结果偏向一边。';
    } else {
      const gapText = fmt1(absDiff);
      const tone = analysis.closeness === 'very-close' ? '这个差距非常接近，稍微改一下权重就可能翻过来。'
        : analysis.closeness === 'close' ? '这个差距不算大，结论并不牢靠。'
        : analysis.closeness === 'clear' ? '差距比较明显，但还不是决定性的。'
        : '差距很大，除非大幅改动输入，否则不容易翻转。';
      sub.textContent = `领先 ${gapText} 分（满分 100）。${tone} 这是你自己打分的加权结果，不是成功率。`;
    }
  }
}

function updateClosenessPill(analysis) {
  const pill = $('#closeness-pill');
  if (!pill) return;
  pill.hidden = false;
  let text = '差距很大';
  let tone = 'ok';
  if (analysis.tie) { text = '打平'; tone = 'neutral'; }
  else if (analysis.closeness === 'very-close') { text = '几乎打平'; tone = 'warn'; }
  else if (analysis.closeness === 'close') { text = '很接近'; tone = 'warn'; }
  else if (analysis.closeness === 'clear') { text = '比较明确'; tone = 'neutral'; }
  pill.textContent = text;
  pill.dataset.tone = tone;
}

function renderContribTable(analysis) {
  const body = $('#contrib-body');
  const foot = $('#contrib-foot');
  if (!body) return;
  clear(body);
  if (foot) clear(foot);

  // 贡献值按"加总后必须等于显示差值"的规则取整，避免用户看到 7.2 vs 7.1 而以为算错
  const rawDeltas = analysis.contributions.map((c) => c.delta);
  const shownDeltas = round1SummingTo(rawDeltas, analysis.difference);
  // 得分点数的列也必须满足"逐项相加 = 合计"，否则用户一验算就发现对不上
  const shownPointsA = round1SummingTo(analysis.contributions.map((c) => c.pointsA), analysis.scoreA);
  const shownPointsB = round1SummingTo(analysis.contributions.map((c) => c.pointsB), analysis.scoreB);
  // 占比列也必须满足"逐项相加 = 100.0%"。
  //
  // 历史缺陷（product-owner W01-02 真机实测，已修）：
  // 这一列原本用的是普通 `pct(c.share)`（各自四舍五入到 1 位小数），
  // 而同一张表的 A/B 分和贡献列已经用了最大余数法。
  // 6 因素等权时 100/6 = 16.6667%，六行各显示 16.7%，合计 100.2% ——
  // 而页面下方明写"占比加起来一定是 100%"，用户一验算就发现对不上。
  // 4 因素、5 因素恰好整除，所以这个问题只在 6 因素时暴露。
  //
  // 注意：这里不能用 round1SummingTo（它是"和必须等于指定值"的取整），
  // 因为 share 是 0–1 的小数，要的是百分比口径。先转成百分数再取整。
  const shownShares = round1SummingTo(
    analysis.contributions.map((c) => c.share * 100),
    100,
  );

  analysis.contributions.forEach((c, i) => {
    const shown = shownDeltas[i];
    const cls = shown > 1e-9 ? 'delta-pos' : shown < -1e-9 ? 'delta-neg' : 'delta-zero';
    const sign = shown > 1e-9 ? '+' : '';
    // 权重为 0 的因素：贡献恒为 0，必须明确解释"它没有参与计算"，
    // 否则用户会以为"这一项算出来是 0 分"，而不是"这一项根本没算进去"
    const nameCell = c.weight === 0
      ? el('td', {},
          el('span', { text: c.label }),
          el('span', { class: 'zero-weight-tag', text: '（权重为 0，不参与本次计算）' }))
      : el('td', { text: c.label });
    body.append(el('tr', {},
      nameCell,
      el('td', { text: `${fmt1(shownShares[i])}%` }),
      // 关键：这里必须显示「加权后折算进总分的点数」（0–100 量纲），
      // 不能显示原始的 0–10 主观评分，否则这一列加总 ≠ 表尾总分，用户会认为算错
      el('td', { text: fmt1(shownPointsA[i]) }),
      el('td', { text: fmt1(shownPointsB[i]) }),
      el('td', { class: cls, text: `${sign}${fmt1(shown)}` })));
  });

  if (foot) {
    foot.append(el('tr', {},
      el('td', { text: '合计' }),
      el('td', { text: '100.0%' }),
      el('td', { text: fmt1(analysis.scoreA) }),
      el('td', { text: fmt1(analysis.scoreB) }),
      el('td', { text: analysis.tie ? '0.0' : `${analysis.difference > 0 ? '+' : ''}${fmt1(analysis.difference)}` })));
  }
}

/* ───────────── 翻转分析 ───────────── */

function renderFlipEmpty() {
  const box = $('#flip-body');
  if (!box) return;
  clear(box);
  box.append(el('p', { class: 'result-empty', text: '等上面有结果之后，这里会显示反转条件。' }));
}

function renderFlip(analysis, thresholds, flip) {
  const box = $('#flip-body');
  if (!box) return;
  clear(box);

  const anyFeasible = thresholds.some((t) => t.feasible);

  // 打平是一种**极其容易被翻转**的状态，绝不能归到"翻不过来"里。
  //
  // 历史缺陷（ux-writer F-06 发现，已修）：
  // 原先只看 `anyFeasible`。当所有因素的评分都相同时（d 全为 0），
  // 每个阈值都是 NO_LEVERAGE（没有杠杆可调），于是 anyFeasible=false，
  // 页面显示「在只调整单个因素权重的情况下，结论翻不过来。」
  // 但此刻 A 和 B 分数完全相等 —— 这才是最不稳的状态，
  // 同一屏上还能看到"领先 0.0 分"和"翻不过来"，两句话互相矛盾。
  //
  // 打平必须单独说：现在两边一样，往任一方向调都会立刻分出胜负。
  if (analysis.tie) {
    box.append(el('p', { class: 'flip-headline', text: '现在两边分数完全相同——这是最容易翻过去的状态。' }));
    box.append(el('p', {
      class: 'result-empty',
      text: anyFeasible
        ? '任何一点权重变化都会立刻让某一边领先。所以此刻真正该问的不是"怎么调权重"，而是"我对哪一项最没把握"——去核实那一项。'
        : '你给两个方案在每个因素上的评分完全一样，所以调权重不会有任何变化（没有哪一项在往里加分）。真正要做的是先把评分打出差别——去核实事实，而不是纠结权重。',
    }));
    box.append(buildThresholdList(thresholds));

    // 打平分支已经把「现在是什么状态」讲清楚了，所以**不要再显示第二条 headline**。
    // 但滑杆必须保留 —— 打平时拖动滑杆最能说明问题
    // （往左偏一点 A 领先、往右偏一点 B 领先），砍掉它等于把最有说服力的交互删了。
    //
    // 踩过的坑（product-owner 真机 + ux-writer 复核）：这里原先 fall through 到
    // 下面的通用分支，于是同一张卡里出现两句互相打架的标题。
    // 我第一次修的时候图省事写了 `return`，那会**连同滑杆一起砍掉** ——
    // ux-writer 明确指出这一点，已改回"不 return，只是跳过 headline"。
    //
    // 同理，打平时 buildThresholdList 已经在上面 append 过，
    // 下面要跳过，否则列表会出现两遍。
    if (flip) {
      const block = buildFlipSlider(flip);
      if (block) box.append(block);
    }
    return;
  }

  if (!anyFeasible && !analysis.tie) {
    box.append(el('p', { class: 'flip-headline', text: '在只调整单个因素权重的情况下，结论翻不过来。' }));

    // 说清**为什么**翻不过来 —— 不是所有"翻不过来"都是同一个原因。
    //
    // diagnoseNoFlip 区分三种真实成因（logic-engineer 用 2 万组随机输入验证）：
    //   ① ALL_SAME_SIGN  所有 d_k 同号（city 全负 / oldguitar 全正）
    //                    Δ 是 d 的非负加权和，同号则 Δ 恒同号，调权重改不了方向
    //   ② ZERO_GAP       至少一个因素上 A/B 同分 —— 它"不表态"，破坏同号前提
    //                    实测占 0 可行样本的 57%，**不是边角情况**
    //   ③ NO_LEVERAGE    所有 d_k 都是 0（两边评分完全一样）—— 已被上面的 tie 分支接走
    //
    // 为什么必须分开说：之前只有一句笼统的"方向一致"，
    // 对 ZERO_GAP 是**说错原因** —— 真相是那些因素毫无区分度，
    // 用户该做的是先打出评分差别，而不是继续调权重。
    let whyText = '这不代表你的决定就一定对，只代表你给两个方案的评分在各因素上方向一致。想真正改变结论，需要去修改那几条评分本身（也就是去核实事实），而不是继续纠结权重。';
    try {
      const dx = diagnoseNoFlip(state);
      if (dx && dx.reason === 'ALL_SAME_SIGN') {
        // 「方向一致 → 结论稳」这句话会**主动帮倒忙**（方法论审计发现）。
        //
        // 数学上没错：同号则 Δ 恒同号，调权重确实改不了。
        // 但"每一项都一样偏向同一边"恰恰是**某一列评分填反**的典型指纹。
        // 实测（54449 个真实两难决策）：一格填反后有 6.3% 会变成
        // "同向 + 翻不了"，工具说"结论稳，不用看了" —— 而数据是错的。
        // 这是全站唯一一处"防线起反作用"的地方。
        //
        // 所以措辞必须从"结论稳"改成"先去核对有没有填反"。
        // 仍然如实说"调权重改不了"（这是数学事实），但不再给出虚假的确定感。
        whyText = '你在每个因素上都给了同一个方案更高（或更低）的分——评分方向完全一致，所以调权重确实改不了结论。不过这种"全票通过"恰恰要先警惕一件事：有没有哪一项的评分方向填反了？建议逐项核对一遍再下判断。';
      } else if (dx && dx.reason === 'ZERO_GAP') {
        whyText = '有几个因素上，你给两个方案打的分完全一样——它们对结果没有区分作用。在这种前提下调权重是白费力气，因为那些因素本来就"不表态"。想改变结论，先回去给这些因素打出真实的差别。';
      } else if (dx && dx.reason === 'OUT_OF_RANGE') {
        whyText = '理论上某个因素的权重稍微一调就能翻过来，但那需要把权重调到一个现实中做不到的位置（超出 0–100%）。所以按你现在打的分数，它其实是个稳定的倾向。想验证它稳不稳，去核实那几条评分本身。';
      }
    } catch { /* 诊断失败就用默认文案，不影响主流程 */ }

    box.append(el('p', { class: 'result-empty', text: whyText }));
    box.append(buildThresholdList(thresholds));
    return;
  }

  box.append(el('p', {
    class: 'flip-headline',
    text: flipDescription(flip, analysis),
  }));

  box.append(buildThresholdList(thresholds));

  // 一句澄清（logic-engineer 的观察）：
  // 当所有因素都"可翻转"时（如 rent 4/4、longdist 5/5），列表会有好几条。
  // 用户很容易读成"有 5 条独立的行动建议"。
  // 但数学上它们是**同一个结论的 5 种撬法**——任何一条做到，结论都会翻。
  // 不澄清的话，用户会以为要同时满足所有条件，反而更焦虑。
  if (feasibleCount(thresholds) >= 3) {
    box.append(el('p', {
      class: 'flip-note',
      text: '上面几条不是「要同时满足的条件」，而是「随便做到哪一条都能翻」——挑你觉得最容易做到的那条去验证就行。',
    }));
  }

  if (flip) {
    const block = buildFlipSlider(flip);
    if (block) box.append(block);
  }
}

/**
 * 把一条反转条件翻译成人话。
 *
 * 精度诚实性（red-team P0 修复）：
 * 临界点 t* 通常是无理数级的数（如 39.3939…%），**不可能被滑杆精确拖到**。
 * 早期文案写"调到 39.4%，两边就会打平"，实测 Δ=−0.004，承诺兑现不了。
 * 现在的措辞：
 *   - 给出精确到 2 位的临界值，并标明"约"
 *   - 明确说明"越靠近越接近打平，越过就翻"
 *   - 不声称滑杆某档能精确命中
 */
function flipDescription(flip, analysis) {
  const scope = '（前提：只调这一个因素，其余因素按原来的比例重分剩下的权重）';

  // 历史缺陷（product-owner 真机实测发现，已修）：
  // 原先这里的兜底分支返回"可翻转"的肯定句 —— 而 flip 为 null
  // **恰恰说明没有可翻转的因素**，等于把语义写反了。
  // 复现：4 因素、权重全 3、所有评分全 5（全部打平）。
  // 此时同一屏上同时出现三句互相打架的话：
  //   「调权重不会有任何变化」        ← 打平分支（对）
  //   「（兜底分支说）能翻转」        ← 这一行（错）
  //   「每一项都不会让结果翻转」      ← 阈值列表（对）
  // 两真一假，而假的那句还带着一长串"前提"限定语，
  // 看起来反而比真话更权威——这种误导比留白更糟。
  if (!flip) {
    if (analysis && analysis.tie) {
      return `现在两边分数完全相同，而且你给每个因素的评分也一样，所以调整权重不会改变任何东西——没有哪一项在往里加分。想真正改变结论，需要先去核实事实、把评分打出差别，而不是继续调权重。${scope}`;
    }
    return `在你目前打的这些分数下，无论怎么调整单个因素的权重，结论都翻不过来。${scope}`;
  }

  const cur = pct(flip.currentShare, 1);
  const thr = pct(flip.thresholdShare, 2);
  const holdPrecise = pct(flip.thresholdShare, 4);

  if (flip.direction === 'hold') {
    return `「${flip.label}」现在的权重占比 ${cur} 恰好就在打平点附近。此刻两边分数相同——往任一方向拨动都会立刻偏向一方。${scope}`;
  }
  if (flip.direction === 'increase') {
    return `最容易被撬动的是「${flip.label}」：它的权重占比约到 ${thr}（精确 ${holdPrecise}）时两边打平；再往上就翻过来了。${scope}`;
  }
  return `最容易被撬动的是「${flip.label}」：它的权重占比约降到 ${thr}（精确 ${holdPrecise}）时两边打平；再往下就翻过来了。${scope}`;
}

/** 数一下有几个"可翻转"的阈值（用于决定要不要加澄清说明） */
function feasibleCount(thresholds) {
  return thresholds.filter((t) => t.feasible).length;
}

function buildThresholdList(thresholds) {
  const list = el('ul', { class: 'flip-list' });
  const sorted = [...thresholds].sort((a, b) => {
    if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
    if (a.feasible && b.feasible) return a.distance - b.distance;
    return 0;
  });

  for (const t of sorted) {
    const feasible = t.feasible;
    const name = el('span', { class: 'flip-name', text: t.label });
    let numText = '—';
    if (feasible && t.thresholdShare !== null) {
      // 精度必须和上面的翻转卡标题一致（那里是 2 位）。
      // 历史缺陷（growth-producer W02-01 发现）：标题行显示「39.39%（精确 39.3939%）」，
      // 这张列表却显示「39.4%」——同一页面两种精度，用户会以为是两个不同的数，
      // 对外素材逐字引用界面时也会因此写错。
      numText = t.direction === 'hold' ? '已打平' : pct(t.thresholdShare, 2);
    }
    const item = el('li', { class: 'flip-item', dataset: { state: feasible ? 'feasible' : 'infeasible' } },
      name,
      el('span', { class: 'flip-num', text: numText }),
      el('span', { class: 'flip-desc', text: t.explanation }));
    list.append(item);
  }
  return list;
}

function buildFlipSlider(flip) {
  const block = el('div', { class: 'flip-slider-block' });
  const sliderId = 'flip-slider';

  const live = el('p', { class: 'flip-live', 'aria-live': 'polite' });

  /** 把给定占比画到界面上：同时更新 output、滑杆拇指位置、实时文案。 */
  const describe = (t, { moveSlider = true } = {}) => {
    const projected = projectAtShare(state, flip.factorId, t);
    out.value = pct(t, 2);
    // 关键：滑杆位置必须跟着走，否则界面会同时存在两个矛盾的位置指示（red-team P0-5）
    if (moveSlider) slider.value = String(t * 100);

    // 无障碍：可访问值和可访问名也要跟着更新。
    //
    // 历史缺陷（端到端走查发现）：原来 describe() 只更新了 out.value 和 slider.value，
    // **没更新 aria-valuetext / aria-label**。
    // 实测拖到 76.71% 后：output 显示 76.71%、滑杆 value=76.71，
    // 但 aria-valuetext 仍是初始的「28.57%」，aria-label 里也写着"当前 28.57%"。
    // 读屏用户听到的永远是那一开始的值 —— 而视觉用户看到的完全正确。
    // 这类缺陷只有真正用读屏/查 AX tree 才会发现；首屏那根滑杆是对的，只有工作区这根漏了。
    const pctText = pct(t, 2);
    slider.setAttribute('aria-valuetext', pctText);
    // aria-label 里嵌了当前值，也必须同步，否则读屏会念出两个不同的数
    slider.setAttribute('aria-label', `「${flip.label}」的权重占比（0–100%，当前 ${pctText}）`);
    const absDiff = Math.abs(projected.difference);
    let verdictText;
    // 「打平」的判据必须和**显示的差值**一致，不能各说各话。
    //
    // 历史缺陷（两轮才修干净，记下来免得再犯）：
    //   第一轮：判打平用 1e-6，标"就在临界点上"用 5e-4，差 500 倍 → 中间地带文案自相矛盾
    //   第二轮（改成同源后仍然存在）：判打平用 1e-6（精确值），但显示用 fmt1() 只保留 1 位小数。
    //     拖到 39.39%（文案自己写的数）时真实 Δ = 0.0026，既不小于 1e-6，
    //     fmt1 又把它显示成 "0.0" → 屏幕上出现「差 0.0，更倾向「X」」。
    //     根因不是容差，是**显示精度和被比较的精度不一致**。
    //
    // 现在：先算出"用户真正看到的那个数"，用它判断打平。
    // 显示成 0.0 就必须说打平；显示成 0.1 就不许说打平。
    // 同源修复（见首屏那段注释）：判据必须和"两个显示出来的分数"一致，
    // 否则会出现「A 66.0 / B 66.1，两边打平（差 0.0）」这种自相矛盾的句子。
    const isTie = fmt1(projected.scoreA) === fmt1(projected.scoreB);
    if (isTie) verdictText = '两边打平';
    else if (projected.difference > 0) verdictText = analysisLabel('A');
    else verdictText = analysisLabel('B');
    const near = isTie ? '（就在临界点上）' : '';
    clear(live);
    live.append(
      el('span', { text: `权重占比 ${pct(t, 2)}${near}：` }),
      el('strong', { text: `A ${fmt1(projected.scoreA)} / B ${fmt1(projected.scoreB)}` }),
      // 同源修复（见首屏注释）：差值用两个**显示出来的**分数相减
    el('span', { text: `，${verdictText}（差 ${Math.abs(Number(fmt1(projected.scoreA)) - Number(fmt1(projected.scoreB))).toFixed(1)}）` }));
    return projected;
  };

  // 用 step="any" 而不是 0.1/0.01：临界点几乎总是无理数级的数（如 39.393939…%），
  // 任何固定刻度都会让它「够不着」。有限刻度下按钮只能改数字、却让滑杆拇指停在原处，
  // 界面就出现两个互相矛盾的位置指示（red-team P0-5）。step="any" 让滑杆精确停在 t*：
  // 拇指位置、输出数字、真实分数三者永远一致。
  // 滑杆的可访问名。
  //
  // 历史缺陷（product-owner W01-02 实测发现）：滑杆没有 aria-label，
  // 而包着它的 <label> 里同时有说明文字**和** <output> 元素，
  // 于是屏幕阅读器算出来的名字是「亲手拨一下：…拖到 39.39% 附近看看28.57%」——
  // 把当前值 "28.57%" 也吞进名字里，而且每次拖动都会变。
  // 更糟的是有些读屏组合干脆读不出名字，只说"滑块 28"。
  //
  // 修法：给滑杆一个稳定的 aria-label（说明它是什么 + 范围），
  // 并把 <output> 从 <label> 里挪出来。
  //
  // 为什么必须挪出来（product-owner 复查发现我第一版没做到）：
  // <label> 里的所有文本（含 <output> 的当前值）都会被算进滑杆的可访问名。
  // 于是名字变成「…拖到 39.39% 附近看看28.57%」——**当前值被吞进名字里**，
  // 而且每拖动一次名字就变一次。读屏用户听到的会是一个不断变长的名字。
  // 现在 <output> 放在 label 外面，靠 for= 与滑杆关联，
  // 它是"值"的显示，不该是"名字"的一部分。
  const sliderLabelText = `「${flip.label}」的权重占比（0–100%，当前 ${pct(flip.currentShare, 2)}）`;
  const slider = el('input', {
    type: 'range',
    id: sliderId,
    min: '0', max: '100', step: 'any',
    value: String(flip.currentShare * 100),
    'aria-label': sliderLabelText,
    'aria-valuetext': pct(flip.currentShare, 2),
    oninput: (e) => {
      try {
        describe(Number(e.target.value) / 100, { moveSlider: false });
      } catch {
        /* 滑到极端值时忽略 */
      }
    },
  });

  function analysisLabel(side) {
    const label = lastAnalysis ? lastAnalysis.options[side === 'A' ? 0 : 1].label : side;
    return `更倾向「${label}」`;
  }

  // 输出框显示到 2 位小数，让 t* 附近能看出微小变化
  const out = el('output', { for: sliderId, text: pct(flip.currentShare, 2) });

  block.append(
    // 「这是演示」的标识必须显式给出来（首次触达走查 B-1）。
    //
    // 原来这里只有一句"亲手拨一下"，用户会以为拖动它等于修改自己的方案 ——
    // 而它其实是**只读的投影**（改的是 t，不是 state）。
    // 拖到 62.94% 时演示区说 B 领先 15.5，上方结果卡还是 A 领先 7.1，
    // 同一屏两个互斥结论而页面不解释 → 用户会认为工具算错了。
    //
    // 两种解法：① 标清"演示"；② 让它真的驱动真实权重。
    // 我两个都做了：
    //   · 这里加清晰的"预览"标识
    //   · 「跳到精确临界点」按钮现在会真写 state（见下面 onclick）
    el('p', { class: 'flip-preview-tag' },
      el('span', { class: 'flip-preview-dot', 'aria-hidden': 'true' }),
      el('span', {}, '试算：拖这根滑杆只影响下面这张卡，不改动你上面填的方案'),
    ),
    el('label', { for: sliderId },
      el('span', {}, '亲手拨一下：把「', el('strong', { text: flip.label }), '」的权重占比拖到 ',
        pct(flip.thresholdShare, 2), ' 附近看看')),
    // <output> 在 <label> 之外：它是当前值的显示，不是控件名字的一部分
    out,
    slider,
    live);

  // 「跳到精确临界点」：因为 step="any"，这里可以同时把滑杆拇指也挪到 t*，
  // 不再出现"数字变了但拇指没动"的矛盾状态。
  const jumpBtn = el('button', {
    type: 'button',
    class: 'btn btn-mini flip-jump',
    onclick: () => {
      // 关键：这个按钮必须**同时写回工作区的真实权重**，否则会出现
      // 「同一屏两个互斥结论」—— 演示区说"打平 66.1/66.1"，
      // 上方结果卡还是 70.7/63.6，左边权重滑杆纹丝不动。
      //
      // 历史缺陷（首次触达体验走查 B-1，阻断级）：
      // 原实现只调 describe()（那是演示区的只读投影），没有 touch state。
      // 用户以为"我把它调到临界点了"，但真正参与计算的数据没变。
      //
      // 正确做法：反解出"要让占比等于 t* 需要什么权重"，写进 state.factors，
      // 然后重渲染 + recalc，让整个页面（结果卡、贡献表、权重滑杆、翻转卡）
      // 全部同步到同一个世界。
      const targetShare = flip.thresholdShare;
      const idx = state.factors.findIndex((f) => f.id === flip.factorId);
      if (idx >= 0) {
        // 其余因素权重之和（保持它们之间的比例不变，与 t* 的定义一致）
        const othersWeight = state.factors
          .reduce((acc, f, i) => (i === idx ? acc : acc + f.weight), 0);
        // t = w / (w + others)  ⇒  w = t * others / (1 - t)
        if (targetShare < 1 && othersWeight > 0) {
          const newWeight = (targetShare * othersWeight) / (1 - targetShare);
          state.factors[idx].weight = Math.min(MAX_WEIGHT_UI, Math.max(0, Number(newWeight.toFixed(4))));
          renderFactorList();   // 让权重滑杆/数字跟着走
          recalc();             // 让结果卡、贡献表、翻转卡全部重算
        }
      }
      const projected = describe(targetShare, { moveSlider: true });
      // 注意：上面 renderFactorList() + recalc() 会把整个翻转卡重建，
      // 所以**不能**往自己这个 jumpHint 里写提示 —— 它已经不在文档里了。
      // 实测（端到端走查发现）：点了按钮后确认文案消失、元素数量 1→0，
      // 等于"悄悄改了用户的数据还不告诉人"。
      //
      // 改写到卡片外的常驻状态区（recalc 不会重建它），并声明这是真实改动。
      const msg = Math.abs(projected.difference) < 1e-6
        ? `已把「${flip.label}」的权重真的改成 ${state.factors.find(f => f.id === flip.factorId)?.weight}（占比 ${pct(targetShare, 4)}）。上方结果、左侧权重滑杆、导出数据都已同步——两边分数相同。`
        : `注意：此处残差 ${projected.difference.toExponential(2)}，未达到打平阈值。`;
      const live = document.querySelector('#equal-weights-note') || document.querySelector('#factors-error');
      if (live) {
        live.textContent = msg;
        live.hidden = false;
        // 5 秒后自动收起，避免长期占位
        clearTimeout(window.__jumpMsgTimer);
        window.__jumpMsgTimer = setTimeout(() => { live.hidden = true; live.textContent = ''; }, 6000);
      }
    },
  }, '跳到精确临界点（会真的改权重）');

  const jumpHint = el('p', { class: 'flip-jump-hint', 'aria-live': 'polite' });

  if (flip.direction !== 'hold') block.append(jumpBtn, jumpHint);

  // 初始化实时文案
  try { describe(flip.currentShare); } catch { /* ignore */ }

  return block;
}

/* ───────────── 验证行动 ───────────── */

function renderVerifyEmpty() {
  const box = $('#verify-body');
  if (!box) return;
  clear(box);
  box.append(el('p', {
    class: 'result-empty',
    text: '这里会挑出最该被核实的一条假设，并给一个 7 天内能做完的小动作。',
  }));
}

function renderVerify(hypothesis) {
  const box = $('#verify-body');
  if (!box) return;
  clear(box);

  if (!hypothesis) {
    box.append(el('p', { class: 'result-empty', text: '还没有可分析的内容。' }));
    return;
  }

  box.append(el('p', { class: 'hypothesis-q', text: hypothesis.question }));

  const steps = el('ol', { class: 'step-list' });
  for (const step of hypothesis.steps) steps.append(el('li', { text: step }));
  box.append(steps);

  box.append(el('p', { class: 'caveat', text: hypothesis.caveat }));

  // 三个视角必须**总是**渲染，包括"翻不过来"的场景（oldguitar）。
  // 早期这里写成 `lastAnalysis && lastFlip`，导致没有可行阈值的示例整块消失 ——
  // 而那种场景恰恰最需要用三个视角解释"为什么翻不过来"。
  if (lastAnalysis) {
    const vp = buildViewpoints(lastAnalysis, lastFlip, hypothesis);
    const details = el('details', { class: 'disclosure' },
      el('summary', { text: '换个角度看看：三个视角' }));
    for (const key of ['support', 'oppose', 'chair']) {
      const item = vp[key];
      if (!item || !item.text) continue;
      details.append(el('p', { class: 'verdict-sub' },
        el('strong', { text: String(item.role || '') + '：' }),
        el('span', { text: item.text })));
    }
    if (vp.disclaimer) details.append(el('p', { class: 'caveat', text: vp.disclaimer }));
    box.append(details);
  }
}

/* ───────────── 全局渲染 ───────────── */

function renderAll() {
  const titleInput = $('#decision-title');
  const opA = $('#option-a');
  const opB = $('#option-b');
  if (titleInput) titleInput.value = state.title || '';
  if (opA) opA.value = state.options[0].label;
  if (opB) opB.value = state.options[1].label;

  renderFactorList();
  recalc();
}

/* ───────────── 导出 / 导入 / 分享 / 清空 ───────────── */

function exportJSON() {
  readStateFromInputs();
  const payload = {
    app: 'decision-arena',
    version: 1,
    exportedAt: new Date().toISOString(),
    notice: '本文件由浏览器本地生成，未上传到任何服务器。得分来自用户主观评分，不构成预测或专业建议。',
    decision: state,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const base = (state.title || 'decision').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 40);
  a.href = url;
  a.download = `反悔雷达-${base}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      const decision = parsed && parsed.decision ? parsed.decision : parsed;
      if (!decision || !Array.isArray(decision.options) || !Array.isArray(decision.factors)) {
        throw new Error('结构不对');
      }
      const check = validate(decision);
      if (!check.ok) {
        alert(`导入失败：${check.message}`);
        return;
      }
      state = {
        title: typeof decision.title === 'string' ? decision.title : '',
        options: decision.options.map((o, i) => ({ id: i === 0 ? 'A' : 'B', label: String(o.label) })),
        factors: decision.factors.map((f, i) => ({
          id: typeof f.id === 'string' && f.id ? f.id : `f${i + 1}`,
          label: String(f.label),
          weight: Number(f.weight),
          ratings: { A: Number(f.ratings.A), B: Number(f.ratings.B) },
        })),
      };
      renderAll();
    } catch {
      alert('这个文件不是反悔雷达导出的 JSON，或者已经损坏。');
    }
  };
  reader.readAsText(file);
}

/**
 * 生成分享摘要。
 *
 * 隐私要求（由 UI 文案承诺、由 tests/qa/ui-contract.test.mjs 守护）：
 * **绝不包含用户写的方案名称。** 用户可能在方案名里写真实公司名、人名、地点，
 * 而这些正是最不该被无意复制到社交平台的东西。
 * 摘要里只出现"方案 A / 方案 B"这种中性占位，加上得分、因素名和反转条件。
 */
function buildShareText() {
  if (!lastAnalysis) return '';
  const lines = [];
  lines.push('我用「反悔雷达」算了一个纠结中的选择。');
  lines.push('');
  lines.push('两个方案我分别叫 A 和 B（具体是什么就不写在这了）。');
  lines.push(`结果：A ${fmt1(lastAnalysis.scoreA)} 分 / B ${fmt1(lastAnalysis.scoreB)} 分（差 ${fmt1(Math.abs(lastAnalysis.difference))}）。`);
  lines.push('');
  if (lastFlip) {
    // 精度必须与页面内一致（2 位），否则分享出去的数字说不到做到的事。
    //
    // red-team 的 P0：这里原本 `pct(lastFlip.thresholdShare)` 用的是默认值 1 位小数，
    // 于是分享文本写"调到 39.4% 就会打平"，而实测 39.4% 处 Δ=−0.004（没打平）。
    // 页面内其他 9 处调用全部显式传了 2 或 4 —— 当初修 P0-3 时唯独漏了分享这一条路径。
    //
    // 为什么这条特别严重：页面内的错误用户当场能发现；
    // 分享出去的错误会**离开产品语境**，别人照着调到 39.4% 发现没打平，
    // 只会得出"这工具算错了"，而作者不在场无法澄清。
    //
    // 措辞也学页面内的 flipDescription：说"约 X（精确 Y）"，不声称某个两位小数值能精确命中。
    const sharePct = pct(lastFlip.thresholdShare, 2);
    const shareExact = pct(lastFlip.thresholdShare, 4);
    lines.push(`最关键的一条：把「${lastFlip.label}」的权重占比调到约 ${sharePct}（精确 ${shareExact}），两边就会打平，再越过就翻过来。`);
  } else {
    // lastFlip 为 null 有**三种**不同情况，不能一律说"方向一致"。
    //
    // 历史缺陷（方法论审计发现）：原来这里无条件写"各因素的评分方向一致"。
    // 但 lastFlip 在打平态也是 null —— 而打平恰恰是**最容易翻**的状态，
    // 说成"翻不过来"与同一屏的 UI 直接打架。
    // ZERO_GAP（有因素两边同分）同样不是"方向一致"（sameSign=false）。
    //
    // 现在按真实原因分支，与页面内的 diagnoseNoFlip 口径一致。
    let reasonText;
    try {
      const dx = diagnoseNoFlip(state);
      if (analysis.tie) {
        reasonText = '关键发现：两个方案现在分数完全相同——这是最容易翻过去的状态，往任一方向调都会立刻分出胜负。此刻真正该问的是"我对哪一项最没把握"。';
      } else if (dx && dx.reason === 'ZERO_GAP') {
        reasonText = '关键发现：有几个因素上两个方案同分，它们对结果没有区分作用。调权重是白费力气，该做的是先给这些因素打出真实的差别。';
      } else if (dx && dx.reason === 'ALL_SAME_SIGN') {
        reasonText = '关键发现：各因素的评分方向完全一致，单靠调权重翻不过来。不过这种"全票通过"要先警惕评分有没有填反——建议逐项核对后再下判断。';
      } else {
        reasonText = '关键发现：单靠调整某一个因素的权重，结论翻不过来。';
      }
    } catch {
      reasonText = '关键发现：单靠调整某一个因素的权重，结论翻不过来。';
    }
    lines.push(reasonText);
  }
  lines.push('');
  if (lastHypothesis) {
    lines.push(`我准备先去做的验证：${lastHypothesis.steps[0]}`);
  }
  lines.push('');
  lines.push('（得分是我自己打分的加权结果，不是成功率，也不是预测。工具在本地运行，不上传数据。）');
  // 高风险场景：分享摘要必须带上同一句警示，否则复制出去就丢了上下文
  if (lastHighRisk) {
    const notice = highRiskNotice(lastHighRisk.area, lastHighRisk.matched);
    lines.push('');
    lines.push(`⚠️ 注意：这是一个${lastHighRisk.area}领域的决定，本工具只能帮忙列要素，不构成专业意见。${notice.body}`);
  }
  return lines.join('\n');
}

function openShare() {
  const dialog = $('#share-dialog');
  const text = $('#share-text');
  const status = $('#copy-status');
  if (status) status.textContent = '';
  if (!lastAnalysis) {
    alert('先把两个方案填好、算出结果，才有摘要可以分享。');
    return;
  }
  const body = buildShareText();
  if (text) text.value = body;

  // 记住是哪个元素打开的对话框。
  //
  // 无障碍缺陷（Lead 键盘走查发现）：
  // Esc 关闭后 focus 会掉到 BODY，下一次 Tab 从页面最顶上重新开始——
  // 键盘用户等于被踢回起点。原生 <dialog> 不会自动恢复焦点。
  lastDialogTrigger = document.activeElement;

  if (dialog && typeof dialog.showModal === 'function') {
    dialog.showModal();
    // 打开后把焦点放进对话框内（<textarea> 是可聚焦的只读区，
    // 读屏会念出摘要内容，也保证 Tab 从对话框里开始而不是页面顶部）
    if (text) setTimeout(() => text.focus(), 0);
  } else if (dialog) {
    dialog.setAttribute('open', '');
  }
}

function resetAll() {
  if (!confirm('清空当前所有输入？这个操作不能撤销，而且不会留下副本。')) return;
  state = createEmptyDecision();
  renderAll();
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

/* ───────────── 首屏真实交互示例 ─────────────
 *
 * V9 P0-C 要求：首屏右侧那张卡必须是**真实计算支撑的可交互产品示例**，
 * 数字来自 site/core.mjs，不能像设计原型那样写死 `a = 40 + 50t`。
 *
 * 实现要点：
 *  - 数据取自 EXAMPLES[0]（offer），与工作区点开的是同一份
 *  - 拖动滑杆 = 调「第一个因素」的权重占比，其余因素按原比例重分，
 *    用的就是工作区同一个 projectAtShare，所以数字必然一致
 *  - 不新建第二套算法，也不缓存一份"演示用的结果"
 */
const HERO_DEMO_KEY = 'offer';

// 权重滑杆的最大值（与 HTML 的 max 一致）。反解临界权重时用它做上界。
const MAX_WEIGHT_UI = 10;

function initHeroDemo() {
  const box = $('#hero-demo');
  if (!box) return;

  const example = EXAMPLES.find((e) => e.key === HERO_DEMO_KEY) || EXAMPLES[0];
  if (!example) return;
  const input = cloneBody(example.body);

  // 找"最容易被撬动"的那个因素作为演示旋钮 —— 它最能说明问题
  const thresholds = findFlipThresholds(input);
  const highlight = pickFlipHighlight(thresholds);
  const knobFactor = highlight
    ? input.factors.find((f) => f.id === highlight.factorId) || input.factors[0]
    : input.factors[0];

  const titleEl = $('#hero-demo-title');
  const labelEl = $('#hero-slider-label');
  const outEl = $('#hero-slider-out');
  const slider = $('#hero-slider');
  const scoreA = $('#hero-score-a');
  const scoreB = $('#hero-score-b');
  const barA = $('#hero-bar-a');
  const barB = $('#hero-bar-b');
  const verdict = $('#hero-verdict');
  if (!slider || !titleEl) return;

  titleEl.textContent = example.body.title;
  labelEl.textContent = `调整「${knobFactor.label}」的权重占比`;
  // 侧栏显示真实方案名，让用户立刻看到这是他自己的两个选项
  const [optA, optB] = input.options;
  const aLabel = box.querySelector('[data-side="A"] .hero-demo-score-label');
  const bLabel = box.querySelector('[data-side="B"] .hero-demo-score-label');
  if (aLabel) aLabel.textContent = optA.label;
  if (bLabel) bLabel.textContent = optB.label;

  // 初始位置取当前真实占比，而不是随便给个 50%
  const base = scoreDecision(input);
  const baseShare = base.contributions.find((c) => c.factorId === knobFactor.id)?.share ?? 0.5;
  slider.value = String(baseShare * 100);

  function paint(opts = {}) {
    const { announce = true } = opts;
    const share = Number(slider.value) / 100;
    let projected;
    try {
      projected = projectAtShare(input, knobFactor.id, share);
    } catch {
      return; // 极端值下不更新，保持上一帧
    }
    const a = projected.scoreA;
    const b = projected.scoreB;
    const diff = Math.abs(projected.difference);

    scoreA.textContent = fmt1(a);
    scoreB.textContent = fmt1(b);
    barA.style.width = `${Math.max(0, Math.min(100, a))}%`;
    barB.style.width = `${Math.max(0, Math.min(100, b))}%`;
    outEl.textContent = `${pct(share, 1)}`;

    // 读屏要能听到"当前值代表什么"，光念「39.4」没有意义。
    // （ux-writer 指出：不加这个，读屏只说"39.4"）
    slider.setAttribute('aria-valuetext', `「${knobFactor.label}」权重占比 ${pct(share, 1)}`);

    // aria-live 的播报策略：拖动过程中**不**逐格播报长句。
    // ── 视觉 vs 播报：必须解耦（这是 GIF 自查抓出来的真实缺陷）──
    //
    // 原实现：`if (!announce) return;` —— 拖动时**连判定行都不更新**，
    // 只有松手才刷新。理由是"拖动时每秒几十次 input，读屏会被刷屏"。
    // 这个理由本身是对的，但解法错了：它把「不播报」实现成了「不渲染」。
    //
    // 实测后果（growth-producer 逐帧解码 demo-30s.gif 发现，第 108–114 帧）：
    // 在打平点松手后继续拖动到 42.8%，屏幕上是 **A 64.6 / B 66.8（明显没打平）**，
    // 但「临界」徽章和"两个方案打平了"还挂着 —— 约 1.8 秒的自相矛盾画面。
    // 这段 GIF 直接发出去，观众会认为工具在骗人。
    //
    // 正确解法：**判定行始终更新（视觉正确），只有 aria-live 播报在拖动中跳过**。
    // 这样屏幕上永远自洽，读屏也不会被刷屏。
    // 靠"拍摄纪律"防不住这个 —— 只要有任何第二个素材（截图、录屏、别人自己用），
    // 这个瞬间就会被反复撞上。只能改代码。
    // 视觉与播报彻底分家（见 index.html 里的注释）：
    //   #hero-verdict       只负责视觉，永远跟着更新
    //   #hero-verdict-live  sr-only 播报区，只在松手（announce=true）时写入
    // 这样拖动中不会刷屏，松手时一定播报 —— 即使句子和上一帧一模一样。

    // 「打平」的判据必须和**显示的差值**一致。
    //
    // 踩过两个坑：
    //   1) projectAtShare 返回的字段是 { scoreA, scoreB, difference, share }，
    //      **没有 tie 字段**（scoreDecision 才有）。我一开始写 projected.tie，
    //      永远 undefined → 打平分支从不触发，页面打出「差 0.0 分」却不说是打平。
    //   2) 即使改用精确的 |Δ| < TIE_EPSILON 也不行：滑杆是 step="any"，
    //      用户很难停在精确的 39.393939%，通常会停在 39.39% 附近（Δ≈2.6e-7），
    //      界面却把差值四舍五入显示成「0.0」。显示 0.0 就必须说打平，不能自相矛盾。
    //
    // 所以统一用「显示出来的那个数」做判据 —— 和工作区滑杆用的是同一个规则。
    /* ===== 打平判据：显示字符串相等（P0 修复）===== */
    //
    // 历史缺陷（最终验收发现，8/41 个采样点必现）：
    // 原来判据是"差值的 1 位小数是 0"（fmt1(|Δ|) === "0.0"），
    // 但分数是**各自**四舍五入展示的。
    // Δ=0.017~0.063 时：差值显示 0.0（判打平），
    // 而 66.05 显示 66.1、65.98 显示 66.0 —— 屏幕上两个数字不相等却说打平。
    // 实测 39.32~39.34% 和 39.42~39.46% 都会这样。
    //
    // 修法：判据改成"两个**显示出来的字符串**相等"。
    // 这样"说打平" ⇔ "屏幕上两个数字一样"，永远不可能自相矛盾。
    const shownA = fmt1(projected.scoreA);
    const shownB = fmt1(projected.scoreB);
    const isTie = shownA === shownB;

    if (isTie) {
      verdict.textContent = '两个方案打平了——这是最容易被撬动的时刻。';
      verdict.dataset.state = 'tie';
    } else {
      const leading = projected.difference > 0 ? optA.label : optB.label;
      // 差值必须和两个分数**同源**（跨浏览器审计 F2）。
      // 原来用未取整的真实差值 fmt1(diff)：A 显示 66.1、B 显示 66.0，
      // 差值却是 0.0 → 屏幕上「更倾向 X，差 0.0 分」自相矛盾。
      // 现在用两个**显示出来的数字**相减：66.1 − 66.0 = 0.1。
      // 于是「差 0.0」当且仅当「两个分数相等」，与打平判据完全一致。
      const diffShown = Math.abs(Number(shownA) - Number(shownB)).toFixed(1);
      verdict.textContent = `此刻更倾向「${leading}」，差 ${diffShown} 分。`;
      verdict.dataset.state = 'lead';
    }

    // 只在松手时播报。先清空、下一帧再写 —— **强制产生 DOM 变更**。
    // 不这么做的话：松手时的句子与拖动末帧完全相同，
    // textContent 写同值不会触发 live 事件，读屏用户永远听不到结论。
    if (announce) {
      const live = document.querySelector('#hero-verdict-live');
      if (live) {
        live.textContent = '';
        const sentence = verdict.textContent;
        requestAnimationFrame(() => {
          // 防御：万一这之间又拖了，只播最新那句
          if (!live.textContent) live.textContent = sentence;
        });
      }
    }
  }

  // 「跳到打平点」：解决"拖不到打平窗口"（跨浏览器审计 F1）
  const jumpBtn = $('#hero-jump-tie');
  if (jumpBtn) {
    if (highlight && Number.isFinite(highlight.thresholdShare)) {
      // 注意：**不要**用 hidden 属性控制显隐。
      // 这个按钮在 HTML 里默认就是渲染出来的（首绘即占位）；
      // 如果改成"先 hidden、JS 再显示"，hero 卡高度会在首绘后增长，
      // 把下方 #examples 推下去 —— 实测 CLS 从 0.00006 涨到 0.018~0.034，
      // 而且位移来源明确指向 #hero-demo / #examples（我自己引入的回归）。
      // 没有可跳目标时用 visibility 隐藏，保留布局占位。
      jumpBtn.style.visibility = 'visible';
      jumpBtn.addEventListener('click', () => {
        slider.value = String(highlight.thresholdShare * 100);
        // 先 input（刷新视觉）再 change（触发播报），模拟一次真实的"拖到并松手"
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        slider.dispatchEvent(new Event('change', { bubbles: true }));
        slider.focus();
      });
    } else {
      jumpBtn.style.visibility = 'hidden';
    }
  }

  // 拖动中：只动数字，不播报；松手：更新播报文字
  slider.addEventListener('input', () => paint({ announce: false }));
  slider.addEventListener('change', () => paint({ announce: true }));
  paint();

  // 「30 秒看懂示例」：把这条示例真正载入工作区并滚过去，
  // 而不是仅仅滚动到示例列表（那样用户还得再点一次）。
  for (const btn of document.querySelectorAll('[data-action="demo-run"]')) {
    btn.addEventListener('click', () => {
      loadExample(example.key);
      const ws = $('#workspace');
      if (ws) {
        ws.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
      }
      // 键盘用户点完这个按钮，焦点还停在按钮上；页面滚到了工作区，
      // 但他们接下来的 Tab 会从源位置继续，感觉像"跳过去了但没跟过来"。
      // 把焦点送到工作区标题（可聚焦但不可编辑，读屏会念出"你的决策台"），
      // 让 tab 顺序从用户眼前的位置继续。
      // （ux-writer 建议）
      setTimeout(() => {
        const heading = $('#workspace-title');
        if (heading) {
          heading.setAttribute('tabindex', '-1');
          heading.focus({ preventScroll: true });
        }
      }, prefersReducedMotion() ? 0 : 420);
    });
  }
}

/* ───────────── 事件绑定 ───────────── */

function bindEvents() {
  // 顶部「自己开始」
  for (const btn of document.querySelectorAll('[data-action="start-blank"]')) {
    btn.addEventListener('click', () => {
      const ws = $('#workspace');
      if (ws) ws.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });

      const opA = $('#option-a');
      if (!opA) return;

      // 历史缺陷（ux-writer F-08，product-owner 定位根因，已修）：
      // 这里原本用一个「值为空才聚焦」的裸判空条件，但 #option-a 的初始值是 "方案 A"
      // 而不是空串 —— 那个条件**恒为假**，
      // 这个 focus 分支从上线起就没有对任何人生效过。
      // 用户点「自己开始」后页面滚到决策台，光标却还停在按钮上，敲键盘没反应。
      //
      // 现在的判据：只有 input 里还是**默认占位名**时才聚焦并全选，
      // 这样已经把方案名改过的用户不会被抢走焦点，也不会被全选覆盖。
      const DEFAULT_A = '方案 A';
      const isPlaceholder = opA.value === '' || opA.value === DEFAULT_A;
      if (!isPlaceholder) return;

      // 400ms 等滚动动画结束再聚焦，避免浏览器把页面又滚回去
      setTimeout(() => {
        opA.focus({ preventScroll: true });
        // 仅当仍是默认占位名时全选 —— 用户直接输入就能覆盖，省一次删除
        if (opA.value === '方案 A') opA.select();
      }, prefersReducedMotion() ? 0 : 400);
    });
  }

  for (const input of document.querySelectorAll('[data-bind]')) {
    input.addEventListener('input', scheduleRecalc);
  }

  const addBtn = $('#add-factor');
  if (addBtn) addBtn.addEventListener('click', addFactor);

  // 「权重全部拉平」：core 里早就导出了 applyEqualWeights，但一直没接进界面，
  // 用户只能一格一格把权重调成一样。这个动作的价值很具体——当你想知道
  // "如果我不偏心，结论会不会变"，手动调 4–6 个滑杆既费事又不精确。
  const equalBtn = $('#equal-weights');
  if (equalBtn) {
    equalBtn.addEventListener('click', () => {
      state.factors = state.factors.map((f) => ({ ...f, weight: 1 }));
      renderFactorList();
      recalc();
      // 让用户知道刚才发生了什么，而不是默默改掉他们的数字
      const note = $('#equal-weights-note');
      if (note) {
        note.textContent = '已把所有因素的权重都设为 1（占比相同）。你原来的权重没有备份，需要的话请手动调回。';
        note.hidden = false;
      }
    });
  }

  const toolbar = $('.toolbar');
  if (toolbar) {
    toolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'export-json') exportJSON();
      else if (action === 'import-json') $('#import-file')?.click();
      else if (action === 'reset') resetAll();
      else if (action === 'print') window.print();
      else if (action === 'share') openShare();
      else if (action === 'load-example') loadExample(EXAMPLES[0].key);
    });
  }

  const fileInput = $('#import-file');
  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (file) importJSON(file);
      fileInput.value = '';
    });
  }

  const dialog = $('#share-dialog');
  if (dialog) {
    dialog.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'close-share') {
        dialog.close();
      } else if (btn.dataset.action === 'copy-share') {
        const text = $('#share-text');
        const status = $('#copy-status');
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text.value);
          } else {
            text.select();
            document.execCommand('copy');
          }
          if (status) status.textContent = '已复制到剪贴板。';
        } catch {
          text.select();
          if (status) status.textContent = '浏览器不让自动复制，已帮你全选，按 Ctrl/Cmd+C 即可。';
        }
      }
    });

    // 关闭后把焦点还给打开它的按钮。
    //
    // 无障碍缺陷（Lead 键盘走查实测）：原生 <dialog> 关闭时**不会**恢复焦点。
    // Esc 之后 activeElement 变成 BODY，下一次 Tab 从页面最顶上重来——
    // 键盘用户按 Esc 想"回去继续"，结果被扔回起点。
    dialog.addEventListener('close', () => {
      if (lastDialogTrigger && document.contains(lastDialogTrigger)) {
        lastDialogTrigger.focus();
      }
      lastDialogTrigger = null;
    });

    // 焦点陷阱：Tab / Shift+Tab 在对话框内循环，不跑到背景页面。
    //
    // 实测漏洞：原版 Tab 到最后一个按钮后，焦点跳到 BODY（背景），
    // 用户能在模态开着时操作背后的页面——违反模态语义。
    dialog.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const focusables = [...dialog.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )].filter((el) => !el.disabled && el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  // Esc 关闭原生 dialog 由浏览器处理；焦点恢复见上面的 close 监听
}

/* ───────────── 启动 ───────────── */

function boot() {
  renderExamples();
  bindEvents();
  renderAll();
  // 首屏真实交互示例要在示例数据渲染之后初始化（它要读 EXAMPLES）
  initHeroDemo();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

/* ===== 触屏滑杆手势防护（P0）===== */
/**
 * 手指落在滑杆上想上下滚页面时，浏览器会把权重"跳"到触点位置，且不还原。
 * 实测：工作区 w-f2 从 4 跳到 8，页面滚了 105px，值没回来。
 *
 * 修法：不阻止跳值（阻止不了，见下），而是跳了之后能还原。
 *   · pointerdown：快照值
 *   · 首次 touchmove：判断方向
 *       纵向为主 → 用户在滚页面 → 还原快照
 *       横向为主 → 用户在拖滑杆 → 不动
 *   · 点按（无位移）→ 保留原生"点哪跳哪"
 *
 * 为什么不能靠 CSS / preventDefault：
 *   实测 touch-action: pan-y、capture 阶段 preventDefault、两者合用，
 *   在 Chromium 里全部无效 —— 原生 range 的跳值发生在 pointerdown
 *   的默认动作里，早于任何监听器。
 *
 * 用委托挂在 document 上，动态重建的滑杆自动覆盖。
 */
(function installTouchSliderGuard() {
  if (typeof window === 'undefined') return;

  /** sliding 状态下已快照的元素 → 原始值 */
  const snapshots = new WeakMap();
  /** 已经判定为"纵向滚动"的元素（后续 move 不再处理） */
  const verticalGesture = new WeakSet();

  const isRange = (el) => el instanceof HTMLInputElement && el.type === 'range';

  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!isRange(e.target)) return;
      // 只对触摸/笔生效；鼠标拖动本来就是用户明确要拖
      if (e.pointerType === 'mouse') return;
      snapshots.set(e.target, e.target.value);
      verticalGesture.delete(e.target);
    },
    true,
  );

  document.addEventListener(
    'touchmove',
    (e) => {
      const el = e.target;
      if (!isRange(el)) return;
      if (!snapshots.has(el)) return;
      if (verticalGesture.has(el)) return;

      const t = e.touches && e.touches[0];
      if (!t) return;
      // 用"当前触点相对视口"的位移不可靠（页面在滚），
      // 所以只判**单帧内的相对方向**：记录上一次触点位置。
      const prev = el.__lastTouch;
      el.__lastTouch = { x: t.clientX, y: t.clientY };
      if (!prev) return;

      const dx = t.clientX - prev.x;
      const dy = t.clientY - prev.y;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      el.__accX = (el.__accX || 0) + absX;
      el.__accY = (el.__accY || 0) + absY;

      // 累计位移超过 8px 才判定，避免手指微抖误判
      if (el.__accX + el.__accY < 8) return;

      if (el.__accY > 8 && el.__accY > el.__accX * 1.2) {
        // 纵向为主 → 用户在滚页面 → 还原被误改的值
        el.value = snapshots.get(el);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        verticalGesture.add(el);
      }
      // 横向为主 → 保持原生拖拽，不做任何事
    },
    { passive: true },
  );

  const reset = (e) => {
    const el = e.target;
    if (isRange(el)) {
      el.__accX = 0;
      el.__accY = 0;
      el.__lastTouch = null;
      snapshots.delete(el);
      verticalGesture.delete(el);
    }
  };
  document.addEventListener('touchend', reset, true);
  document.addEventListener('touchcancel', reset, true);
})();

