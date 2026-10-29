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
      role: 'listitem',
      'aria-label': `载入示例：${ex.title}`,
      dataset: { example: ex.key },
      onclick: () => loadExample(ex.key),
    },
      el('span', { class: 'ex-emoji', 'aria-hidden': 'true', text: ex.emoji }),
      el('span', { class: 'ex-tag', text: ex.tag }),
      el('strong', { text: ex.title }),
      el('span', { class: 'ex-blurb', text: ex.blurb }));
    grid.append(card);
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
      maxlength: '60',
      autocomplete: 'off',
      value: factor.label,
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
      min: '0', max: '10', step: '1',
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

    const item = el('li', { class: 'factor-item', dataset: { factorId: factor.id } },
      el('div', { class: 'factor-top' },
        el('span', { class: 'sr-only', text: `因素 ${index + 1}` }),
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

  const showError = (lastValid) => {
    error.textContent = `评分必须在 0 到 10 之间。下面显示的结果仍按上一次有效评分 ${lastValid} 计算，离开这个输入框会恢复到 ${lastValid}。`;
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
    oninput: (e) => {
      const raw = e.target.value;
      if (raw === '') { e.target.dataset.pending = '1'; clearError(); e.target.removeAttribute('aria-invalid'); return; }
      delete e.target.dataset.pending;
      const num = Number(raw);
      if (!Number.isFinite(num) || num < 0 || num > 10) {
        e.target.setAttribute('aria-invalid', 'true');
        e.target.setAttribute('aria-describedby', errId);
        showError(factor.ratings[side]);
        return;
      }
      e.target.removeAttribute('aria-invalid');
      e.target.removeAttribute('aria-describedby');
      clearError();
      factor.ratings[side] = num;
      scheduleRecalc();
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
  return Math.min(10, Math.max(0, Math.round(n)));
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

function friendlyError(code) {
  switch (code) {
    case 'INVALID_OPTION_LABEL': return '两个方案都要有个名字才能开始算。';
    case 'DUPLICATE_OPTION_LABEL': return '两个方案的名字不能一模一样。';
    case 'INVALID_FACTOR_LABEL': return '每个因素都要有名字。';
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
      el('td', { text: pct(c.share) }),
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

  if (!anyFeasible) {
    box.append(el('p', { class: 'flip-headline', text: '在只调整单个因素权重的情况下，结论翻不过来。' }));
    box.append(el('p', {
      class: 'result-empty',
      text: '这不代表你的决定就一定对，只代表你给两个方案的评分在各因素上方向一致。想真正改变结论，需要去修改那几条评分本身（也就是去核实事实），而不是继续纠结权重。',
    }));
    box.append(buildThresholdList(thresholds));
    return;
  }

  box.append(el('p', {
    class: 'flip-headline',
    text: flipDescription(flip),
  }));

  box.append(buildThresholdList(thresholds));

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
function flipDescription(flip) {
  const scope = '（前提：只调这一个因素，其余因素按原来的比例重分剩下的权重）';
  if (!flip) return `存在可以翻转结论的权重调整。${scope}`;

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
      numText = t.direction === 'hold' ? '已打平' : pct(t.thresholdShare);
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
    const absDiff = Math.abs(projected.difference);
    let verdictText;
    if (absDiff < 1e-6) verdictText = '两边打平';
    else if (projected.difference > 0) verdictText = analysisLabel('A');
    else verdictText = analysisLabel('B');
    const near = Math.abs(t - flip.thresholdShare) < 5e-4 ? '（就在临界点上）' : '';
    clear(live);
    live.append(
      el('span', { text: `权重占比 ${pct(t, 2)}${near}：` }),
      el('strong', { text: `A ${fmt1(projected.scoreA)} / B ${fmt1(projected.scoreB)}` }),
      el('span', { text: `，${verdictText}（差 ${fmt1(absDiff)}）` }));
    return projected;
  };

  // 用 step="any" 而不是 0.1/0.01：临界点几乎总是无理数级的数（如 39.393939…%），
  // 任何固定刻度都会让它「够不着」。有限刻度下按钮只能改数字、却让滑杆拇指停在原处，
  // 界面就出现两个互相矛盾的位置指示（red-team P0-5）。step="any" 让滑杆精确停在 t*：
  // 拇指位置、输出数字、真实分数三者永远一致。
  const slider = el('input', {
    type: 'range',
    id: sliderId,
    min: '0', max: '100', step: 'any',
    value: String(flip.currentShare * 100),
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
    el('label', { for: sliderId },
      el('span', {}, '亲手拨一下：把「', el('strong', { text: flip.label }), '」的权重占比拖到 ',
        pct(flip.thresholdShare, 2), ' 附近看看'),
      out),
    slider,
    live);

  // 「跳到精确临界点」：因为 step="any"，这里可以同时把滑杆拇指也挪到 t*，
  // 不再出现"数字变了但拇指没动"的矛盾状态。
  const jumpBtn = el('button', {
    type: 'button',
    class: 'btn btn-mini flip-jump',
    onclick: () => {
      const projected = describe(flip.thresholdShare, { moveSlider: true });
      jumpHint.textContent = Math.abs(projected.difference) < 1e-6
        ? `已把滑杆拨到精确临界点 ${pct(flip.thresholdShare, 4)}：两边分数相同。`
        : `注意：此处残差 ${projected.difference.toExponential(2)}，未达到打平阈值。`;
    },
  }, '跳到精确临界点');

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
    lines.push(`最关键的一条：把「${lastFlip.label}」的权重占比调到 ${pct(lastFlip.thresholdShare)}，两边就会打平，再越过就翻过来。`);
  } else {
    lines.push('关键发现：各因素的评分方向一致，单靠调权重翻不过来——真正该做的是去核实那几条评分。');
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
  if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
  else if (dialog) dialog.setAttribute('open', '');
}

function resetAll() {
  if (!confirm('清空当前所有输入？这个操作不能撤销，而且不会留下副本。')) return;
  state = createEmptyDecision();
  renderAll();
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

/* ───────────── 事件绑定 ───────────── */

function bindEvents() {
  // 顶部「自己开始」
  for (const btn of document.querySelectorAll('[data-action="start-blank"]')) {
    btn.addEventListener('click', () => {
      const ws = $('#workspace');
      if (ws) ws.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
      const opA = $('#option-a');
      if (opA && !opA.value) setTimeout(() => opA.focus({ preventScroll: true }), 400);
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
  }

  // Esc 关闭原生 dialog 已由浏览器处理
}

/* ───────────── 启动 ───────────── */

function boot() {
  renderExamples();
  bindEvents();
  renderAll();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
