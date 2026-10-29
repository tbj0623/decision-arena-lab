/**
 * Decision Arena — 反悔雷达
 * 区间敏感性分析（v1.1 新功能，独立模块）
 *
 * 设计边界（重要）
 * 1. 本模块 **不修改** core.mjs，也不复用其 normalizeInput：v1.0 的 normalizeInput
 *    硬性要求 ratings.A / ratings.B 是标量（Number.isFinite），数组会误报 INVALID_RATING。
 *    因此这里提供并列的 normalizeIntervalInput，但复用同一套常量与 ValidationError 约定。
 * 2. 输入是**主观允许范围** [lo, hi]，不是概率分布。本模块**永不**输出概率。
 * 3. 纯函数、零依赖、无 DOM、无网络，浏览器与 Node 通用。
 *
 * 数学结论
 *   Δ = S(A) − S(B) = 10·Σ p_i·(rA_i − rB_i)，是盒状约束上的仿射函数。
 *   因可行集是笛卡尔积、Δ 无交叉项 ⇒ 优化可分离 ⇒ 极值在端点且可闭式求解：
 *     minΔ = 10·Σ p_i·(loA_i − hiB_i)
 *     maxΔ = 10·Σ p_i·(hiA_i − loB_i)
 *   O(n)，不需要枚举 2^(2n) 个顶点（enumerateCorners 仅作测试用暴力 oracle）。
 */

import { ValidationError, MIN_FACTORS, MAX_FACTORS, RATING_MIN, RATING_MAX } from '../core.mjs';

export const INTERVAL_VERSION = '1.1.0';

const MAX_WEIGHT = 1e6;
const MAX_LABEL = 120;
const MAX_FACTOR_LABEL = 60;
/** 判定分类用的容差。与 core 的 TIE_EPSILON 同量级，但此处独立定义以免耦合语义 */
const VERDICT_EPSILON = 1e-9;

function fail(code, message, details) {
  throw new ValidationError(code, message, details);
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function requireText(value, code, field, max, details = {}) {
  if (typeof value !== 'string') {
    fail(code, `${field} 必须是文本`, { field, received: typeof value, ...details });
  }
  const text = value.trim();
  if (text.length === 0) {
    fail(code, `${field} 不能为空`, { field, ...details });
  }
  if (text.length > max) {
    fail(code, `${field} 过长（上限 ${max} 字）`, { field, length: text.length, max, ...details });
  }
  return text;
}

/**
 * 校验单个区间 [lo, hi]。
 * 顺序：结构 → 元素有限 → 元素在 [0,10] → lo <= hi。
 * 注意 lo > hi 必须报错，**不能**自动交换端点（那会静默猜测用户意图）。
 */
function requireInterval(value, code, field, details) {
  if (!Array.isArray(value) || value.length !== 2) {
    fail(code, `${field} 必须是 [lo, hi] 两元数组`, { field, received: String(value), ...details });
  }
  const [lo, hi] = value;
  for (const [index, v] of [['lo', lo], ['hi', hi]]) {
    if (!isFiniteNumber(v)) {
      fail('INVALID_RATING', `区间端点必须是有限数字（${field}.${index}）`, {
        field, index, received: String(v), ...details,
      });
    }
    if (v < RATING_MIN || v > RATING_MAX) {
      fail('RATING_OUT_OF_RANGE', `评分必须在 ${RATING_MIN}–${RATING_MAX} 之间`, {
        field, index, value: v, ...details,
      });
    }
  }
  if (lo > hi) {
    fail(code, `${field} 的下界不能大于上界（lo=${lo} > hi=${hi}）`, {
      field, lo, hi, ...details,
    });
  }
  return [lo, hi];
}

/**
 * 校验并规范化区间输入。
 * 输入结构：
 * {
 *   title?: string,
 *   options: [{ label: string }, { label: string }],
 *   factors: [{ id?: string, label: string, weight: number, intervals: { A: [lo,hi], B: [lo,hi] } }]
 * }
 * @returns {{title:string, options:{id:string,label:string}[], factors:{id:string,label:string,weight:number,intervals:{A:number[],B:number[]}}[], totalWeight:number}}
 */
export function normalizeIntervalInput(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('INVALID_INPUT', '输入必须是一个对象');
  }

  const rawOptions = raw.options;
  if (!Array.isArray(rawOptions) || rawOptions.length !== 2) {
    fail('INVALID_OPTIONS', '必须有且仅有两个选项');
  }
  const options = rawOptions.map((opt, index) => {
    if (opt === null || typeof opt !== 'object') {
      fail('INVALID_OPTION_LABEL', '选项必须是对象', { index });
    }
    const label = requireText(opt.label, 'INVALID_OPTION_LABEL', '选项名称', MAX_LABEL, { index });
    return { id: index === 0 ? 'A' : 'B', label };
  });
  if (options[0].label === options[1].label) {
    fail('DUPLICATE_OPTION_LABEL', '两个选项的名称不能完全相同');
  }

  const rawFactors = raw.factors;
  if (!Array.isArray(rawFactors)) {
    fail('INVALID_FACTORS', '因素必须是数组');
  }
  if (rawFactors.length < MIN_FACTORS || rawFactors.length > MAX_FACTORS) {
    fail('FACTOR_COUNT', `因素数量必须在 ${MIN_FACTORS}–${MAX_FACTORS} 之间`, {
      count: rawFactors.length,
    });
  }

  const seenIds = new Set();
  const seenLabels = new Set();
  const factors = rawFactors.map((factor, index) => {
    if (factor === null || typeof factor !== 'object' || Array.isArray(factor)) {
      fail('INVALID_FACTOR', '因素必须是对象', { index });
    }
    const label = requireText(
      factor.label, 'INVALID_FACTOR_LABEL', '因素名称', MAX_FACTOR_LABEL, { index },
    );
    // 因素名称唯一（与 core.mjs 一致）
    if (seenLabels.has(label)) {
      fail('DUPLICATE_FACTOR_LABEL', `因素名称重复：${label}`, { index, label });
    }
    seenLabels.add(label);

    let id = factor.id;
    if (id === undefined || id === null || id === '') {
      id = `f${index + 1}`;
    } else if (typeof id !== 'string') {
      fail('INVALID_FACTOR_ID', '因素 id 必须是文本', { index });
    }
    if (seenIds.has(id)) {
      fail('DUPLICATE_FACTOR_ID', `因素 id 重复：${id}`, { index, id });
    }
    seenIds.add(id);

    const weight = factor.weight;
    if (!isFiniteNumber(weight)) {
      fail('INVALID_WEIGHT', '权重必须是有限数字', { index, id, received: String(weight) });
    }
    if (weight < 0) {
      fail('NEGATIVE_WEIGHT', '权重不能为负数', { index, id, weight });
    }
    if (weight > MAX_WEIGHT) {
      fail('WEIGHT_TOO_LARGE', `权重超出允许范围（上限 ${MAX_WEIGHT}）`, { index, id });
    }

    const rawIntervals = factor.intervals;
    if (rawIntervals === null || typeof rawIntervals !== 'object' || Array.isArray(rawIntervals)) {
      fail('INVALID_INTERVAL', '区间必须是对象 { A: [lo,hi], B: [lo,hi] }', { index, id });
    }
    const intervals = {};
    for (const key of ['A', 'B']) {
      intervals[key] = requireInterval(
        rawIntervals[key], 'INVALID_INTERVAL', `intervals.${key}`, { index, id, key },
      );
    }

    return { id, label, weight, intervals: { A: intervals.A, B: intervals.B } };
  });

  const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
  if (totalWeight <= 0) {
    fail('ALL_ZERO_WEIGHTS', '所有因素的权重都是 0，无法计算。请至少给一个因素权重。');
  }

  let title = '';
  if (raw.title !== undefined && raw.title !== null) {
    if (typeof raw.title !== 'string') fail('INVALID_TITLE', '标题必须是文本');
    title = raw.title.trim().slice(0, MAX_LABEL);
  }

  return { title, options, factors, totalWeight };
}

/**
 * 判定分类。
 * 只做**可达性**判定，不涉及任何概率。
 * @param {number} minDelta
 * @param {number} maxDelta
 * @returns {'stableA'|'stableB'|'criticalA'|'criticalB'|'unstable'|'degenerate'}
 */
function classify(minDelta, maxDelta) {
  const eps = VERDICT_EPSILON;
  // 先判退化：区间没有带来任何不确定性
  if (Math.abs(maxDelta - minDelta) <= eps) return 'degenerate';
  if (minDelta > eps) return 'stableA';          // A 永远赢
  if (maxDelta < -eps) return 'stableB';         // B 永远赢
  if (Math.abs(minDelta) <= eps) return 'criticalA'; // A 永不输，但可以打平
  if (Math.abs(maxDelta) <= eps) return 'criticalB'; // B 永不输，但可以打平
  return 'unstable';                              // 两边都可能
}

/**
 * 把 IEEE-754 负零规范成正零。
 *
 * 为什么需要：`-0 - 0` 得到 `-0`，`10 * share * (-0)` 仍是 `-0`。
 * `-0` 在 JSON.stringify / 字符串模板里显示为 `0`（无害），但
 *   - `Object.is(-0, 0) === false` ⇒ 严格比较会失败；
 *   - `1 / -0 === -Infinity` ⇒ 任何下游除法会炸；
 *   - `(-0).toFixed(1)` 在部分版本显示 `0.0` 但 `(-1e-17).toFixed(1)` 显示 `-0.0`。
 * 这与 v1.0 中 `findFlipThresholds` 的 `thresholdShare` 存成 `-0` 是同类问题，
 * 在区间模块里统一在**写出前**规范化，顶层与逐因素两层都要处理
 * （因为求和会把 `[-0,-0]` 归约成 `+0`，只规范化顶层会漏掉逐因素字段）。
 */
function normalizeZero(v) {
  return v === 0 ? 0 : v;
}

/**
 * 区间敏感性分析主函数。
 * @returns {{
 *   ok:true, minDelta:number, maxDelta:number, pointDelta:number, spread:number,
 *   verdict:string, canTie:boolean, canFlipA:boolean, canFlipB:boolean,
 *   worstCase:{A:number[],B:number[]}, bestCase:{A:number[],B:number[]},
 *   factors:Array, totalWeight:number, options:Array, title:string, epsilon:number, version:string
 * }}
 */
export function analyzeInterval(raw) {
  const input = normalizeIntervalInput(raw);
  const { factors, totalWeight } = input;

  let minDelta = 0;
  let maxDelta = 0;
  let pointDelta = 0;
  const worstCase = { A: [], B: [] };
  const bestCase = { A: [], B: [] };
  const perFactor = [];

  for (const factor of factors) {
    const share = factor.weight / totalWeight; // ∈ [0,1]，Σ share = 1
    const [aLo, aHi] = factor.intervals.A;
    const [bLo, bHi] = factor.intervals.B;

    // 最坏：A 取最低、B 取最高 → 该因素对 A 最不利
    const minContribution = 10 * share * (aLo - bHi);
    // 最好：A 取最高、B 取最低
    const maxContribution = 10 * share * (aHi - bLo);
    const midContribution = 10 * share * ((aLo + aHi) / 2 - (bLo + bHi) / 2);

    minDelta += minContribution;
    maxDelta += maxContribution;
    pointDelta += midContribution;

    worstCase.A.push(aLo);
    worstCase.B.push(bHi);
    bestCase.A.push(aHi);
    bestCase.B.push(bLo);

    perFactor.push({
      factorId: factor.id,
      label: factor.label,
      weight: factor.weight,
      share,
      minContribution: normalizeZero(minContribution),
      maxContribution: normalizeZero(maxContribution),
      midContribution: normalizeZero(midContribution),
      uncertaintyWidth: normalizeZero(maxContribution - minContribution),
      intervals: { A: [aLo, aHi], B: [bLo, bHi] },
    });
  }

  minDelta = normalizeZero(minDelta);
  maxDelta = normalizeZero(maxDelta);
  pointDelta = normalizeZero(pointDelta);

  return {
    ok: true,
    minDelta,
    maxDelta,
    pointDelta,
    spread: normalizeZero(maxDelta - minDelta),
    verdict: classify(minDelta, maxDelta),
    canTie: minDelta <= VERDICT_EPSILON && maxDelta >= -VERDICT_EPSILON,
    canFlipA: minDelta < -VERDICT_EPSILON,
    canFlipB: maxDelta > VERDICT_EPSILON,
    worstCase,
    bestCase,
    factors: perFactor,
    totalWeight,
    options: input.options,
    title: input.title,
    epsilon: VERDICT_EPSILON,
    version: INTERVAL_VERSION,
  };
}

/**
 * 暴力 oracle：枚举盒的全部 2^(2n) 个角点求 min/max。
 * **仅供测试对拍**，不要在生产路径调用（n=6 时 4096 个角点）。
 * 与 analyzeInterval 不共享任何公式：这里只按 Δ 的定义逐点求值。
 * @returns {{min:number, max:number, count:number}}
 */
export function enumerateCorners(raw) {
  const input = normalizeIntervalInput(raw);
  const { factors, totalWeight } = input;
  const shares = factors.map((f) => f.weight / totalWeight);

  let min = Infinity;
  let max = -Infinity;
  let count = 0;

  const gaps = new Array(factors.length);

  const walk = (i) => {
    if (i === factors.length) {
      let delta = 0;
      for (let k = 0; k < gaps.length; k += 1) {
        delta += 10 * shares[k] * gaps[k];
      }
      if (delta < min) min = delta;
      if (delta > max) max = delta;
      count += 1;
      return;
    }
    const { A, B } = factors[i].intervals;
    for (const a of A) {
      for (const b of B) {
        gaps[i] = a - b;
        walk(i + 1);
      }
    }
  };
  walk(0);

  return { min: min === 0 ? 0 : min, max: max === 0 ? 0 : max, count };
}
