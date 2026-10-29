/**
 * Decision Arena — 反悔雷达
 * 核心算法（纯函数，零依赖，可在浏览器与 Node 中通用）
 *
 * 设计原则
 * 1. 所有对外函数都先做输入校验，非法输入抛出带 `code` 的 ValidationError，
 *    绝不返回 NaN / Infinity / undefined。
 * 2. 不做任何"客观概率"推断。分数只是用户主观打分在用户自定权重下的加权结果。
 * 3. 反转阈值只做一件事：在"把某个因素的权重占比改成 t、其余因素按原比例重新分配"
 *    这一种受控改动下，解出使两边打平的 t。它是数学结果，不是预测。
 */

// 版本号只用于导出 JSON 和诊断，界面不显示（故意不显示：用户不关心版本，只关心结果对不对）。
//
// 为什么从 1.0.0 改到 1.1.3（growth-producer 指出）：
// 今晚修了 16 个真实缺陷（算法未变，但校验、文案、取整、无障碍都动过），
// 对外文档已按 v1.1.3 描述。如果这里仍写 1.0.0，
// 导出的 JSON 会和文档对不上，将来排查也分不清哪个版本出的问题。
//
// 语义说明：
//   1.0.x → 只改文案/样式
//   1.1.x → 改了校验规则或取整策略（用户可能感知到的行为变化）
//   算法公式本身**从未变过**，这是产品的核心承诺。
export const VERSION = '1.1.3';

export const MIN_FACTORS = 4;
export const MAX_FACTORS = 6;
export const RATING_MIN = 0;
export const RATING_MAX = 10;
/** 低于此差值视为持平，避免浮点误差决定胜负 */
export const TIE_EPSILON = 1e-9;
const EPS = 1e-12;
const MAX_WEIGHT = 1e6;
const MAX_LABEL = 120;
const MAX_FACTOR_LABEL = 60;

/** 校验失败时抛出的错误，带稳定 code 便于 UI 与测试断言 */
export class ValidationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new ValidationError(code, message, details);
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function requireText(value, code, field, max = MAX_LABEL, details = {}) {
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
 * 校验并规范化输入。
 * 输入结构：
 * {
 *   title?: string,
 *   options: [{ id: 'A', label: string }, { id: 'B', label: string }],
 *   factors: [{ id?: string, label: string, weight: number, ratings: { A: number, B: number } }]
 * }
 * @returns {{title:string, options:{id:string,label:string}[], factors:{id:string,label:string,weight:number,ratings:{A:number,B:number}}[], totalWeight:number}}
 */
export function normalizeInput(raw) {
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
  // 因素名称也必须唯一。
  //
  // 为什么（QA 的 W01-07 实测）：两个因素同名时，界面会出现两条同名条目，
  // 翻转卡列出「发展空间 43.2%」和「发展空间 15.8%」，用户完全无法分辨该调哪一个；
  // 贡献表两行同名；假设卡甚至可能指向错误的那个（文案说"这一项 A 比 B 高 0 分"，
  // 但实际命中的是另一个同名因素）。
  //
  // 这不是"数据不整齐"这么轻的问题——它让整个"告诉你该调哪个因素"的核心功能失效。
  // 所以在这里直接拦住，并给出能定位到第几个因素的错误。
  //
  // 注意：比较时去掉首尾空白并做 Unicode 归一化，避免"发展空间"和"发展空间 "被当成两个。
  const seenLabels = new Map();
  const factors = rawFactors.map((factor, index) => {
    if (factor === null || typeof factor !== 'object' || Array.isArray(factor)) {
      fail('INVALID_FACTOR', '因素必须是对象', { index });
    }
    const label = requireText(
      factor.label,
      'INVALID_FACTOR_LABEL',
      '因素名称',
      MAX_FACTOR_LABEL,
      { index },
    );

    // 归一化后再比较。必须处理三类"看着一样、字节不一样"的情况：
    //
    //   1) 全角/半角（ＮＦＫＣ 负责）
    //   2) 零宽字符 U+200B / 软连字符 U+00AD / word joiner U+2060 / BOM U+FEFF
    //      —— 这些是**从网页、Word、PDF 复制文本时最常见的隐形字符**。
    //      QA 实测：把因素名设成「发展空间\u200B」就能绕过校验，
    //      而界面上两条看起来完全一样，刚修的那个"同名歧义"bug 原样复现。
    //   3) 制表符、连续空格、不换行空格 —— 折叠成单个空格
    //
    // 光用 \p{Cf}（Unicode 格式字符）**不够**。red-team 实测仍有 4 类能绕过：
    //   U+3164 韩文填充符（Hangul Filler）  —— 视觉完全空白
    //   U+115F 韩文初声（Hangul Choseong Filler）—— 同上
    //   U+2800 盲文空白（Braille Pattern Blank）—— 视觉空白，但不算 Cf
    //   U+0000 NUL —— 控制字符，不算 Cf
    // 它们都不是 Cf 类别，却都在视觉上不可见或可被忽略。
    // 因此改为"白名单 + 兜底"双保险：
    //   先去掉所有已知空白/格式/控制/filler 类，再用 \p{C} + \p{Z} 兜底。
    //
    // 不合并大小写：中文场景无意义；英文场景里 Growth 和 growth 可能是有意区分。
    const INVISIBLE = new RegExp(
      '[' +
        '\\u007F-\\u009F' +   // DEL + C1 控制字符
        '\\u00AD' +           // 软连字符
        '\\u115F' +           // 韩文初声填充符
        '\\u1160' +           // 韩文中声填充符
        '\\u17B4\\u17B5' +    // 高棉元音固有符号
        '\\u180B-\\u180E' +   // 蒙古文自由变体选择符
        '\\u200B-\\u200F' +   // 零宽空格/连接符/方向标记
        '\\u202A-\\u202E' +   // 方向格式字符
        '\\u2060-\\u2064' +   // word joiner 等不可见运算符
        '\\u206A-\\u206F' +   // 已弃用的格式字符
        '\\u2800' +           // 盲文空白
        '\\u3164' +           // 韩文填充符
        '\\uFEFF' +           // BOM / 零宽不换行空格
        '\\uFFA0' +           // 半角韩文填充符
        '\\uFFF0-\\uFFF8' +   // 特殊字符
        ']',
      'gu',
    );
    const labelKey = label
      .normalize('NFKC')
      // 顺序很重要：
      //   先删「真正不可见」的字符（零宽/填充符/方向标记等）
      //   再把「可视为分隔符」的字符（NBSP、全角空格、tab、换行）统一成普通空格
      //   最后折叠连续空格
      //
      // 踩过的坑：早先把 \p{C} 也放进"删除"这一步，结果把 TAB(\u0009) 直接删掉了，
      // 于是「发展 空间」和「发展\t空间」变成「发展 空间」vs「发展空间」两个不同值，
      // 重名校验反而漏了。TAB 属于"分隔符"语义，不是"不可见噪声"，必须归到替换那一步。
      .replace(INVISIBLE, '')
      // 兜底：所有 Unicode 格式/控制/未分配/代理/私用字符（保留 TAB/LF/CR 让下面统一处理）
      .replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Cn}]/gu, (ch) =>
        (ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v') ? ' ' : '')
      // 所有分隔符（含 NBSP、全角空格 U+3000）折叠为普通空格
      .replace(/\p{Z}/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (seenLabels.has(labelKey)) {
      fail(
        'DUPLICATE_FACTOR_LABEL',
        `因素名称不能重复：「${label}」第 ${seenLabels.get(labelKey) + 1} 个和第 ${index + 1} 个同名。` +
          '请改成能区分的名字（比如「发展空间（技术）」和「发展空间（管理）」）。',
        { index, label, firstIndex: seenLabels.get(labelKey) },
      );
    }
    seenLabels.set(labelKey, index);

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
      fail('WEIGHT_TOO_LARGE', `权重超出允许范围（上限 ${MAX_WEIGHT}）`, { index, id, weight });
    }

    const ratingsRaw = factor.ratings;
    if (ratingsRaw === null || typeof ratingsRaw !== 'object') {
      fail('INVALID_RATINGS', '评分必须是对象 { A, B }', { index, id });
    }
    const ratings = {};
    for (const key of ['A', 'B']) {
      const value = ratingsRaw[key];
      if (!isFiniteNumber(value)) {
        fail('INVALID_RATING', `评分必须是有限数字（${key}）`, { index, id, key, received: String(value) });
      }
      if (value < RATING_MIN || value > RATING_MAX) {
        fail('RATING_OUT_OF_RANGE', `评分必须在 ${RATING_MIN}–${RATING_MAX} 之间`, {
          index, id, key, value,
        });
      }
      ratings[key] = value;
    }

    return { id, label, weight, ratings: { A: ratings.A, B: ratings.B } };
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
 * 加权评分。
 * p[i] = w[i] / Σw ; S(A) = 10 * Σ p[i]*rA[i] ; 范围 0–100
 * @returns {{scoreA:number,scoreB:number,difference:number,magnitude:number,tie:boolean,winner:'A'|'B'|'tie',closeness:string,contributions:Array,normalizedWeights:Array,totalWeight:number,options:Array,factors:Array}}
 */
export function scoreDecision(raw) {
  const input = normalizeInput(raw);
  const { factors, totalWeight } = input;

  const contributions = [];
  const normalizedWeights = [];
  let scoreA = 0;
  let scoreB = 0;

  for (const factor of factors) {
    const share = factor.weight / totalWeight;
    const pointsA = 10 * share * factor.ratings.A;
    const pointsB = 10 * share * factor.ratings.B;
    scoreA += pointsA;
    scoreB += pointsB;
    normalizedWeights.push({ factorId: factor.id, label: factor.label, share });
    contributions.push({
      factorId: factor.id,
      label: factor.label,
      weight: factor.weight,
      share,
      ratingA: factor.ratings.A,
      ratingB: factor.ratings.B,
      ratingGap: factor.ratings.A - factor.ratings.B,
      pointsA,
      pointsB,
      delta: pointsA - pointsB,
    });
  }

  const difference = scoreA - scoreB;
  const magnitude = Math.abs(difference);
  const tie = magnitude < TIE_EPSILON;
  const winner = tie ? 'tie' : difference > 0 ? 'A' : 'B';
  let closeness;
  if (tie) closeness = 'tie';
  else if (magnitude < 2) closeness = 'very-close';
  else if (magnitude < 8) closeness = 'close';
  else if (magnitude < 20) closeness = 'clear';
  else closeness = 'decisive';

  return {
    scoreA,
    scoreB,
    difference,
    magnitude,
    tie,
    winner,
    closeness,
    contributions,
    normalizedWeights,
    totalWeight,
    options: input.options,
    factors: input.factors,
    title: input.title,
  };
}

/**
 * 把某一因素的权重占比设为 t，其余因素按原相对比例分配剩余 (1-t)，返回该状态下的得分。
 * 用于 UI 的"拖动试试"滑杆，也用于测试阈值的数值性质。
 */
export function projectAtShare(raw, factorId, t) {
  const input = normalizeInput(raw);
  if (!isFiniteNumber(t) || t < 0 || t > 1) {
    fail('INVALID_SHARE', '权重占比必须是 0–1 之间的数字', { t: String(t) });
  }
  const target = input.factors.find((f) => f.id === factorId);
  if (!target) {
    fail('UNKNOWN_FACTOR', `找不到因素：${factorId}`, { factorId });
  }
  const others = input.factors.filter((f) => f.id !== factorId);
  const othersWeight = others.reduce((s, f) => s + f.weight, 0);

  let scoreA = 10 * t * target.ratings.A;
  let scoreB = 10 * t * target.ratings.B;

  for (const factor of others) {
    const share = othersWeight > 0 ? ((1 - t) * factor.weight) / othersWeight : 0;
    scoreA += 10 * share * factor.ratings.A;
    scoreB += 10 * share * factor.ratings.B;
  }

  return { scoreA, scoreB, difference: scoreA - scoreB, share: t };
}

/**
 * 单个因素的反转阈值扫描。
 *
 * d_k        = rA[k] - rB[k]
 * d_others   = Σ_{i≠k} w_i (rA_i - rB_i) / Σ_{i≠k} w_i
 * Δ(t)       = t*d_k + (1-t)*d_others          （乘以 10 即分数差）
 * t*         = -d_others / (d_k - d_others)    （Δ(t*) = 0）
 *
 * 只有当分母非零、其他因素权重 > 0、且 0 < t* < 1 时，t* 才是可行区间内的合法临界点。
 * 临界点代表"打平"，越过它偏好才会翻转。
 */
export function findFlipThresholds(raw) {
  const input = normalizeInput(raw);
  const { factors, totalWeight } = input;

  return factors.map((target) => {
    const dk = target.ratings.A - target.ratings.B;
    const currentShare = target.weight / totalWeight;
    let othersWeight = 0;
    let othersWeightedGap = 0;
    for (const other of factors) {
      if (other.id === target.id) continue;
      othersWeight += other.weight;
      othersWeightedGap += other.weight * (other.ratings.A - other.ratings.B);
    }

    const base = {
      factorId: target.id,
      label: target.label,
      currentShare,
      ratingGap: dk,
      feasible: false,
      thresholdShare: null,
      direction: null,
      distance: null,
      boundary: false,
      atThreshold: false,
      code: null,
      explanation: '',
      // 调试/展示用：当前状态下该因素对差距的贡献（满分 100 分制）
      currentDelta: 10 * currentShare * dk,
    };

    if (othersWeight <= EPS) {
      return {
        ...base,
        code: 'SOLE_FACTOR',
        explanation: '只有一个因素有权重，没有其他权重可以重新分配，因此不存在可计算的临界点。',
      };
    }

    const dOthers = othersWeightedGap / othersWeight;
    const denominator = dk - dOthers;

    if (Math.abs(denominator) < EPS) {
      return {
        ...base,
        code: 'NO_LEVERAGE',
        explanation:
          '这个因素的评分差与其他因素的平均评分差几乎相同，改变它的权重比例不会让结果翻转。',
      };
    }

    const tStar = -dOthers / denominator;
    if (!Number.isFinite(tStar)) {
      return {
        ...base,
        code: 'NOT_COMPUTABLE',
        explanation: '数值过于极端，无法得到稳定的临界点。',
      };
    }

    // 先判越界：t* 落在 [0,1] 之外，说明调这个因素的权重不可能翻转
    if (tStar < 0 || tStar > 1) {
      return {
        ...base,
        thresholdShare: tStar,
        code: 'OUT_OF_RANGE',
        explanation: '临界点落在 0–1 之外：在只调整这一个因素权重的情况下，结果不会翻转。',
      };
    }

    // 再判贴边：t* 就在 0 或 1 上，可行区间内没有真正的翻盘空间
    if (tStar <= EPS || tStar >= 1 - EPS) {
      return {
        ...base,
        thresholdShare: tStar,
        boundary: true,
        code: 'BOUNDARY',
        explanation: '临界点正好落在 0 或 1 的边界上，在实际可调的权重范围内没有真正的翻盘空间。',
      };
    }

    if (Math.abs(tStar - currentShare) < EPS) {
      return {
        ...base,
        thresholdShare: tStar,
        atThreshold: true,
        feasible: true,
        code: 'AT_THRESHOLD',
        direction: 'hold',
        distance: 0,
        explanation: '现在这个因素的权重占比恰好就在临界点上，两边打平。',
      };
    }

    const direction = tStar > currentShare ? 'increase' : 'decrease';
    return {
      ...base,
      feasible: true,
      thresholdShare: tStar,
      direction,
      distance: Math.abs(tStar - currentShare),
      code: 'FEASIBLE',
      explanation:
        // 精度必须和 UI 的阈值列一致（那里显示 2 位）。
        // 历史缺陷（qa-engineer W06-01 发现）：这里原本 toFixed(1)，
        // 于是同一行里 num 显示「39.39%」、desc 却说「提高到 39.4% 时」，
        // 紧挨着的两个数不一样，用户会以为阈值有两个值。
        direction === 'increase'
          ? `把这个因素的权重占比提高到约 ${(tStar * 100).toFixed(2)}%（精确 ${(tStar * 100).toFixed(4)}%）时，两边会打平；再往上，偏好就翻过来了。`
          : `把这个因素的权重占比降低到约 ${(tStar * 100).toFixed(2)}%（精确 ${(tStar * 100).toFixed(4)}%）时，两边会打平；再往下，偏好就翻过来了。`,
    };
  });
}

/**
 * 诊断"为什么翻不过来"。
 *
 * 一个决策翻不过来，原因不是笼统的一种。本函数把它归到五类，供 UI 说清楚"到底为什么"：
 *
 *   ALL_SAME_SIGN  所有 d_k 严格同号（全正或全负，**且没有 d_k = 0**）。
 *                  **结构性**不可能翻转：Δ = 10Σp_i d_i 是 d 的非负加权和，
 *                  d 全部同号时 Δ 恒与它们同号，权重只能放大/缩小差距，不能改变方向。
 *                  这是强结论，可以说死。
 *
 *   ZERO_GAP       存在 d_k = 0 的因素（该因素上 A、B 同分），且没有可行阈值。
 *                  这类因素"不表态"——它自己既不加分也不减分，并把严格同号的前提破坏掉。
 *                  单独成一类，是因为把它归到 OUT_OF_RANGE 会**说错原因**：
 *                  真正的问题不是"临界点太远"，而是"这个因素根本没有区分度"。
 *
 *   OUT_OF_RANGE   d 有正有负且都非零（理论上必有可行解，见下），
 *                  但每个因素的临界点 t* 都落在 (0,1) 之外。
 *                  是"有可能但做不到"，与 ALL_SAME_SIGN 的"根本不可能"性质不同。
 *
 *                  注：严格异号（有正有负、无 0）时**必然存在**可行 t*，本类实际不可达，
 *                  仅作为兜底分支保留。证明：设 S=Σw_i d_i：
 *                    · 若 S ≤ 0，取 d_k>0 者，则 d_o=(S−w_k d_k)/(W−w_k) < 0，
 *                      得 t*=−d_o/(d_k−d_o) ∈ (0,1)（因 d_o<0<d_k）；
 *                    · 若 S > 0，取 d_k<0 者，则 d_o > 0，同样得 t* ∈ (0,1)；
 *                    · S = 0 时二者皆可。
 *                  所以"翻不过来"的真正成因只有：同号 / 有 0 差 / 无杠杆。
 *
 *   NO_LEVERAGE    所有因素都没有杠杆：d_k 与其余因素的加权平均 d_others 相等，
 *                  调任何因素的权重都只是整体缩放差距，不改变符号。
 *
 *   UNKNOWN        其余情况（含 SOLE_FACTOR / NOT_COMPUTABLE 等边缘成因），
 *                  或**其实存在可行阈值**（此时 hasFlip = true，本函数不用于报"翻不过来"）。
 *
 * 约定：本函数**不改变** findFlipThresholds 的任何行为，也不修改入参。
 *
 * @returns {{
 *   reason: 'ALL_SAME_SIGN'|'ZERO_GAP'|'OUT_OF_RANGE'|'NO_LEVERAGE'|'UNKNOWN',
 *   detail: string,
 *   sameSign: boolean,
 *   outOfRange: number[],
 *   hasFlip: boolean,
 *   codes: string[],
 *   zeroGapCount?: number
 * }}
 */
export function diagnoseNoFlip(raw) {
  const input = normalizeInput(raw);
  const { factors, totalWeight } = input;
  const thresholds = findFlipThresholds(raw);

  const feasibleCount = thresholds.filter((t) => t.feasible).length;
  const codes = thresholds.map((t) => t.code ?? 'UNKNOWN');
  const hasFlip = feasibleCount > 0;

  // d_k = rA - rB，逐因素
  const gaps = factors.map((f) => f.ratings.A - f.ratings.B);
  // 严格同号：全部 > 0 或 全部 < 0（0 视为"不表态"，会破坏严格同号）
  const allPositive = gaps.length > 0 && gaps.every((d) => d > EPS);
  const allNegative = gaps.length > 0 && gaps.every((d) => d < -EPS);
  const sameSign = allPositive || allNegative;

  // outOfRange：记录所有 t* 越界（OUT_OF_RANGE 或 BOUNDARY）的因素的临界点取值。
  // 防 -0：t* = -d_o/(d_k-d_o)，当 d_o = 0 时分子为 -0，于是 t* 可能是 -0。
  // JSON/字符串里显示为 0（无害），但 Object.is(-0, 0) === false，会把严格比较挂掉。
  // 这里规范化成 +0（与 interval.mjs 的处理一致）。
  const outOfRange = thresholds
    .filter((t) => t.code === 'OUT_OF_RANGE' || t.code === 'BOUNDARY')
    .map((t) => t.thresholdShare)
    .filter((v) => typeof v === 'number' && Number.isFinite(v))
    .map((v) => (v === 0 ? 0 : v));

  const labelOf = (t) => `${t.label}(${fmtNum(t.ratingGap)})`;
  const pctOf = (v) => `${(v * 100).toFixed(2)}%`;

  // ── 有可行阈值：本函数不用于"翻不过来"，如实返回 hasFlip ──
  if (hasFlip) {
    return {
      reason: 'UNKNOWN',
      detail: `存在 ${feasibleCount} 个可行翻转阈值，结论可以翻过来，本诊断不适用。`,
      sameSign,
      outOfRange,
      hasFlip: true,
      codes,
    };
  }

  // ── 1. 结构性：所有 d_k 严格同号 ──
  if (sameSign) {
    const dir = allPositive ? '正' : '负';
    const who = allPositive ? 'A' : 'B';
    const gapText = gaps.map((d) => fmtNum(d)).join('、');
    return {
      reason: 'ALL_SAME_SIGN',
      detail:
        `所有 ${gaps.length} 个因素的评分差 d_k 都是${dir}的（${gapText}），`
        + `${who} 在每个因素上都不弱于对手。Δ 是 d 的非负加权和，`
        + `所以无论怎么调整权重，差距只会变大或变小，不可能反号——`
        + `这是结构性的，不是"差一点"。`,
      sameSign: true,
      outOfRange,
      hasFlip: false,
      codes,
    };
  }

  // ── 2. 有 d_k = 0 的因素（该因素上没有区分度）──
  //
  // 必须排在 OUT_OF_RANGE 之前：这类输入里 t* 往往恰好贴在 0/1 上（BOUNDARY），
  // 若先走越界分支，会对外宣称"临界点太远"，而真实原因是"这个因素两边的评分一样"。
  const zeroGapThresholds = thresholds.filter((t) => Math.abs(t.ratingGap) <= EPS);
  if (zeroGapThresholds.length > 0) {
    const strictSigns = gaps.filter((d) => Math.abs(d) > EPS);
    const posCount = strictSigns.filter((d) => d > 0).length;
    const negCount = strictSigns.filter((d) => d < 0).length;
    const mixed = posCount > 0 && negCount > 0;
    const allZero = strictSigns.length === 0;
    // 全 0 时"稀释其他因素的差距"不成立（没有其他差距），文案要分开写
    const consequence = allZero
      ? '所以两边在任何权重下都完全打平，且没有任何因素可以撬动。'
      : '所以调整它们的权重只会稀释其他因素的差距，不会让结论翻转。';
    const tail = allZero
      ? '真正该做的是先给这些因素打出评分差别——去核实事实，而不是纠结权重。'
      : '真正该做的是先给这些因素打出差别——去核实事实，而不是纠结权重。';
    const lead = mixed
      ? `其中 ${posCount} 个因素偏向 A、${negCount} 个偏向 B`
      : posCount > 0
        ? `其余 ${posCount} 个因素都偏向 A`
        : negCount > 0
          ? `其余 ${negCount} 个因素都偏向 B`
          : '其余因素的评分差也全是 0';
    return {
      reason: 'ZERO_GAP',
      detail:
        `有 ${zeroGapThresholds.length} 个因素在上面的评分完全一样（`
        + `${zeroGapThresholds.map((t) => `${t.label}=${fmtNum(t.ratingGap)}`).join('、')}），`
        + `这些因素对 A/B 没有任何区分度：它们既不加分也不减分，`
        + consequence
        + `${lead}，但没有一个因素的临界点落在可调范围内。`
        + tail,
      sameSign: false,
      outOfRange,
      hasFlip: false,
      codes,
      zeroGapCount: zeroGapThresholds.length,
    };
  }

  // ── 3. 有杠杆但全部越界 ──
  const codeset = new Set(codes);
  if (codeset.has('OUT_OF_RANGE') || codeset.has('BOUNDARY')) {
    const detailParts = [];
    const oor = thresholds.filter((t) => t.code === 'OUT_OF_RANGE');
    const bnd = thresholds.filter((t) => t.code === 'BOUNDARY');
    const nonLever = thresholds.filter((t) => t.code === 'NO_LEVERAGE');

    if (oor.length > 0) {
      detailParts.push(
        `评分差 d_k 有正有负（${gaps.map((d) => fmtNum(d)).join('、')}）；`
        + `但 ${oor.length} 个因素的临界点 t* 全部越界：`
        + oor.map((t) => `${labelOf(t)}→t*=${pctOf(t.thresholdShare)}`).join('；')
        + `。要把这些占比调到 0–100% 之外才可能打平，实际操作做不到。`,
      );
    }
    if (bnd.length > 0) {
      detailParts.push(
        `${bnd.length} 个因素的临界点恰好贴在边界上：`
        + bnd.map((t) => `${labelOf(t)}→t*=${pctOf(t.thresholdShare)}`).join('；')
        + `，在可调范围内没有真正的翻盘空间。`,
      );
    }
    if (nonLever.length > 0) {
      detailParts.push(
        `另有 ${nonLever.length} 个因素没有杠杆（其评分差与其余因素的加权平均相等），`
        + `调整它们的权重只会整体缩放差距，不改变符号。`,
      );
    }

    return {
      reason: 'OUT_OF_RANGE',
      detail: detailParts.join(''),
      sameSign: false,
      outOfRange,
      hasFlip: false,
      codes,
    };
  }

  // ── 4. 无杠杆 ──
  if (codeset.has('NO_LEVERAGE')) {
    const nonLever = thresholds.filter((t) => t.code === 'NO_LEVERAGE');
    return {
      reason: 'NO_LEVERAGE',
      detail:
        `没有任何因素的临界点落在 0–100% 之内，且其中 ${nonLever.length} 个因素是"无杠杆"的：`
        + `${nonLever.map(labelOf).join('、')}。`
        + `这些因素自身的评分差与其余因素的加权平均相等，`
        + `调整它们的权重只会整体的放大或缩小差距，不会让两边换位。`,
      sameSign: false,
      outOfRange,
      hasFlip: false,
      codes,
    };
  }

  // ── 4. 其余（SOLE_FACTOR / NOT_COMPUTABLE / 空数组等） ──
  return {
    reason: 'UNKNOWN',
    detail:
      `没有可行翻转阈值，但成因不属于前三类（codes: ${codes.join(', ') || '空'}）。`
      + `常见于仅一个因素有权重（SOLE_FACTOR）或数值极端（NOT_COMPUTABLE）。`,
    sameSign: false,
    outOfRange,
    hasFlip: false,
    codes,
  };
}

/** 数字格式化：整数不显示小数点，其余最多保留 4 位，避免 -0 */
function fmtNum(v) {
  if (!Number.isFinite(v)) return String(v);
  const rounded = Math.round(v * 10000) / 10000;
  const safe = rounded === 0 ? 0 : rounded; // 防 -0
  return Number.isInteger(safe) ? String(safe) : String(safe);
}

/**
 * 排序：可行且离当前占比最近的排前面，方便 UI 直接取第一条做"最关键的反转条件"。
 */
export function rankFlipCandidates(thresholds) {
  return [...thresholds].sort((a, b) => {
    if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
    if (a.feasible && b.feasible) return a.distance - b.distance;
    return 0;
  });
}

/** 取最值得展示的一条翻转条件；没有可行项时返回 null */
export function pickFlipHighlight(thresholds) {
  const ranked = rankFlipCandidates(thresholds);
  return ranked.length > 0 && ranked[0].feasible ? ranked[0] : null;
}

/**
 * 选出"最需要验证的一项未知条件"。
 * 这是启发式：优先挑对当前差距贡献最大（|10 * p * Δrating| 最大）的因素。
 * 它不代表客观不确定性，只是"你最该去核实的那个假设"。
 */
export function chooseValidationHypothesis(raw, analysis) {
  const input = normalizeInput(raw);
  const scored = analysis && analysis.contributions ? analysis : scoreDecision(input);

  const ranked = scored.contributions
    .map((c) => ({ ...c, influence: Math.abs(c.delta) }))
    .sort((a, b) => b.influence - a.influence || a.factorId.localeCompare(b.factorId));

  const top = ranked[0];
  const tied = ranked.filter((c) => Math.abs(c.influence - top.influence) < 1e-9);
  const factorLabel = top.label;
  const gap = top.ratingGap;
  const directionWord = gap > 0 ? '高' : gap < 0 ? '低' : '相同';
  const gapText = Math.abs(gap).toFixed(1).replace(/\.0$/, '');

  const steps = gap === 0
    ? [
        `列出 3 条能证实「${factorLabel}」对这个选择到底有多重要的真实信息。`,
        `分别问 1 位了解这条路径的人：如果「${factorLabel}」比你想的更难，他们会怎么选？`,
        `给自己设一个小实验，在 7 天内低成本验证「${factorLabel}」的真实影响。`,
      ]
    : [
        `找 1 位真实经历过其中一个选项的人，问一句：「${factorLabel}」实际和预期差多少？`,
        `收集 3 条可核对的信息（不是印象），确认你在「${factorLabel}」上给两个方案的分差 ${gapText} 分是否站得住。`,
        `做一个 7 天内能完成的最小实验，直接体验「${factorLabel}」，再回来改这两个评分。`,
      ];

  return {
    factorId: top.factorId,
    label: factorLabel,
    // 病句修复（ux-writer F-07）：gap === 0 时 directionWord 是"相同"，
    // 拼出来是「A 比 B 相同 0 分」——中文不通。而且"相同 0 分"本身也自相矛盾
    // （既然相同，为什么会说差 0 分？）。打平要单独措辞。
    question: gap === 0
      ? `你在「${factorLabel}」上给两个方案打的分完全一样，所以这一项对结果的差距没有贡献。这条判断你有多大把握？`
      : `你把「${factorLabel}」判成 A 比 B ${directionWord} ${gapText} 分，这条判断对结果的影响最大。它经得起核实吗？`,
    steps,
    caveat:
      '这是按"谁对当前差距贡献最大"排出来的启发式提示，不代表客观不确定性，也不是对你个人的判断。改完评分记得回来重算。',
    influence: top.influence,
    ambiguous: tied.length > 1,
  };
}

/** 全零权重时的一键修复：所有因素等权 */
export function applyEqualWeights(raw) {
  if (raw === null || typeof raw !== 'object' || !Array.isArray(raw.factors)) {
    fail('INVALID_INPUT', '输入必须包含 factors 数组');
  }
  return {
    ...raw,
    factors: raw.factors.map((f) => ({ ...f, weight: 1 })),
  };
}

/** 便捷判断：某份原始输入能否被正常计算 */
export function validate(raw) {
  try {
    normalizeInput(raw);
    return { ok: true, code: null, message: '' };
  } catch (error) {
    if (error instanceof ValidationError) {
      return { ok: false, code: error.code, message: error.message };
    }
    throw error;
  }
}

/** 生成一个空白可编辑的决策（4 个因素，等权，评分全 5） */
export function createEmptyDecision() {
  return {
    title: '',
    options: [
      { id: 'A', label: '方案 A' },
      { id: 'B', label: '方案 B' },
    ],
    factors: [
      { id: 'f1', label: '发展空间', weight: 3, ratings: { A: 5, B: 5 } },
      { id: 'f2', label: '稳定性', weight: 3, ratings: { A: 5, B: 5 } },
      { id: 'f3', label: '时间成本', weight: 3, ratings: { A: 5, B: 5 } },
      { id: 'f4', label: '兴趣匹配', weight: 3, ratings: { A: 5, B: 5 } },
    ],
  };
}
