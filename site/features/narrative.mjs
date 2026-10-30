/**
 * 反悔雷达 · Decision Arena — 示例数据与规则生成的叙事模板
 * 纯数据 + 纯函数，不含 DOM 操作。虚构场景，人物与细节均为编造。
 *
 * 约束（改这个文件时必须守住）
 *  - 不说"概率 / 胜率 / 预测"，不给结论式推荐，不编任何统计数字。
 *  - 示例全部虚构：不出现真实品牌、真实公司、真人姓名。
 *  - 示例数值与 docs/product/USER_JOURNEYS.md 的 J1–J4 完全一致（J5 见 FINDINGS 说明）。
 *  - 文案必须能处理三种 direction（increase / decrease / hold）和 flip === null。
 */

import { pickValidationActions, inferCategory } from '../data/validation-actions.mjs';
// 同分要分两级：exact 才是"分数完全相同"，display 只是四舍五入后显示相同。
// 这个文件的 chairLine / sideArgument 也是可见文案，必须共用同一套判据。
import { tieLevelOf } from '../precision.mjs';

/** @typedef {{id:string,label:string,weight:number,ratings:{A:number,B:number}}} Factor */

/**
 * 五个虚构示例。每个都能真的算出有意义的结果：
 *  - offer / laptop / rent / study 四个来自 USER_JOURNEYS 的 J1–J4，数值逐位一致（可回归对账）；
 *    但选项文案改成不含真实品牌的说法（原 J2 用了真实机型名，这里换成"很轻的笔记本"）。
 *  - 第五个（oldguitar）刻意设计成"各因素方向一致"，用来演示工具会诚实说翻不过来。
 *  - J5（健身房）没有被采用：它的"坚持难度"是 OUT_OF_RANGE 的边界用例，但会引入"能不能坚持"
 *    这类对个人意志的判断，不适合做示例卡；其边界语义已由 core 单测覆盖。
 */
export const EXAMPLES = [
  {
    key: 'offer',
    emoji: '🧭',
    tag: '职业',
    title: '换个地方，还是先待着',
    blurb: '小团队给的空间更大，可收入说不准；现在这份稳，却看得到三年后。两边都说得通，就是定不下来。',
    body: {
      title: '接不接这家小团队的 offer',
      options: [
        { id: 'A', label: '去那家刚起步的小团队' },
        { id: 'B', label: '留在现在的岗位' },
      ],
      factors: [
        { id: 'f1', label: '成长速度', weight: 5, ratings: { A: 9, B: 5 } },
        { id: 'f2', label: '收入确定性', weight: 4, ratings: { A: 4, B: 8 } },
        { id: 'f3', label: '通勤与作息', weight: 2, ratings: { A: 7, B: 7 } },
        { id: 'f4', label: '团队与直属上级', weight: 3, ratings: { A: 8, B: 6 } },
      ],
    },
  },
  {
    key: 'laptop',
    emoji: '💻',
    tag: '消费',
    title: '轻一点，还是顺手一点',
    blurb: '一台背着不累，一台敲起来舒服；续航到底算不算进去，你还没想清楚。',
    body: {
      title: '换哪一台主力电脑',
      options: [
        { id: 'A', label: '那台很轻的笔记本' },
        { id: 'B', label: '那台键盘更顺手的笔记本' },
      ],
      factors: [
        { id: 'f1', label: '便携重量', weight: 4, ratings: { A: 9, B: 7 } },
        { id: 'f2', label: '键盘手感', weight: 3, ratings: { A: 6, B: 9 } },
        { id: 'f3', label: '软件兼容', weight: 3, ratings: { A: 6, B: 8 } },
        // 这条权重为 0：用户暂时不考虑它。工具必须照常计算，不能报错。
        { id: 'f4', label: '续航', weight: 0, ratings: { A: 10, B: 4 } },
        { id: 'f5', label: '价格', weight: 2, ratings: { A: 5, B: 8 } },
      ],
    },
  },
  {
    key: 'rent',
    emoji: '🏠',
    tag: '居住',
    title: '每天多睡半小时，还是多一间房',
    blurb: '市区那套走路上班，郊区那套能摊得开；两套都看过，越想越分不出来。',
    body: {
      title: '签市区的小两居，还是郊区的大三居',
      options: [
        { id: 'A', label: '市区的小两居' },
        { id: 'B', label: '郊区的大三居' },
      ],
      factors: [
        { id: 'f1', label: '通勤时间', weight: 6, ratings: { A: 9, B: 3 } },
        { id: 'f2', label: '居住面积', weight: 4, ratings: { A: 4, B: 9 } },
        { id: 'f3', label: '每月租金', weight: 5, ratings: { A: 3, B: 8 } },
        { id: 'f4', label: '周边配套', weight: 2, ratings: { A: 9, B: 5 } },
      ],
    },
  },
  {
    key: 'study',
    emoji: '📖',
    tag: '升学',
    title: '再读一年，还是先去上班',
    blurb: '家里能支持一年，可同学已经在拿工资；你也不确定自己还坐不坐得住。',
    body: {
      title: '全职备考一年，还是直接去工作',
      options: [
        { id: 'A', label: '全职备考一年' },
        { id: 'B', label: '直接去工作' },
      ],
      factors: [
        { id: 'f1', label: '长期学历门槛', weight: 4, ratings: { A: 8, B: 4 } },
        { id: 'f2', label: '一年机会成本', weight: 4, ratings: { A: 3, B: 8 } },
        { id: 'f3', label: '当下学习状态', weight: 2, ratings: { A: 7, B: 6 } },
        { id: 'f4', label: '家里的经济支持', weight: 2, ratings: { A: 6, B: 6 } },
      ],
    },
  },
  {
    key: 'oldguitar',
    emoji: '🎸',
    tag: '断舍离',
    title: '这把旧吉他，留着还是送走',
    blurb: '你已经两年没弹过，可每次搬家都把它带上——说不太清是舍不得，还是觉得自己哪天会弹。',
    body: {
      title: '旧吉他处理掉，还是继续留着',
      options: [
        { id: 'A', label: '挂出去送人' },
        { id: 'B', label: '继续留着' },
      ],
      // 刻意做成"每一项都只差一点点、但方向全一致"：
      // 五个因素全部没有可行反转阈值（全是 OUT_OF_RANGE），用来演示"翻不过来"的诚实文案。
      factors: [
        { id: 'f1', label: '占的地方', weight: 5, ratings: { A: 8, B: 7 } },
        { id: 'f2', label: '看到它时那点愧疚', weight: 4, ratings: { A: 7, B: 6 } },
        { id: 'f3', label: '搬家时要搬的东西', weight: 3, ratings: { A: 8, B: 6 } },
        { id: 'f4', label: '卖掉能收回一点钱', weight: 3, ratings: { A: 6, B: 5 } },
        // f5 的方向修正（story-engineer 审查发现）：
        // 原先写「以后会不会真的想弹」A=8 B=5 —— 但"想弹"这件事是**留着才满足**的，
        // 分越高越该留着，却给了"送人"高分，方向反了。
        // 更要紧的是：这个示例"翻不过来"原本是靠这个错误撑住的
        // （前四个因素 d 全正，第五个也正，才全部同号）。
        //
        // 改法：换成方向自洽的「留着会不会让我一直惦记它」——
        // 送人 = 不再惦记（得 7 分），留着 = 一直惦记（得 5 分）。
        // 实测：A/B 74.7/58.9 → 72.6/58.9，d = [+1,+1,+2,+1,+2] 仍全同号，
        //       0 个可行阈值，「翻不过来」的教学价值保住了。
        { id: 'f5', label: '留着会不会让我一直惦记它', weight: 4, ratings: { A: 7, B: 5 } },
      ],
    },
  },
  {
    key: 'city',
    emoji: '🏙️',
    tag: '职业',
    title: '搬去那个新城市，还是留在现在的城市',
    blurb: '对方开的条件确实好，可你在这座城市住了七年，楼下那家店老板都认得你。',
    body: {
      title: '搬去那个新城市，还是留在现在的城市',
      options: [
        { id: 'A', label: '搬去那个新城市' },
        { id: 'B', label: '留在现在的城市' },
      ],
      // 刻意做成"每一项评分都偏向 B"：所有阈值都越界，用来演示"翻不过来"。
      // 与 oldguitar 的区别：这个更接近真实的搬家纠结，且差 12.2 分（结论清楚），
      // 不是"几乎打平"那种需要靠翻转判断的情形。
      factors: [
        { id: 'f1', label: '生活成本', weight: 5, ratings: { A: 6, B: 7 } },
        { id: 'f2', label: '离家人近一点', weight: 4, ratings: { A: 5, B: 7 } },
        { id: 'f3', label: '工作的稳定性', weight: 3, ratings: { A: 6, B: 7 } },
        { id: 'f4', label: '已经认识的人', weight: 4, ratings: { A: 5, B: 6 } },
        { id: 'f5', label: '每天通勤的时间', weight: 2, ratings: { A: 6, B: 7 } },
      ],
    },
  },
  {
    key: 'car',
    emoji: '🚗',
    tag: '消费',
    title: '买一台车，还是继续打车加公交',
    blurb: '周末想去郊区看朋友，来回要倒三趟车。可真要买车，光是停车位这一项就够你想半天了。',
    body: {
      title: '买一台车，还是继续打车加公交',
      options: [
        { id: 'A', label: '买一台车' },
        { id: 'B', label: '继续打车加公交' },
      ],
      factors: [
        { id: 'f1', label: '每个月的固定支出', weight: 5, ratings: { A: 5, B: 7 } },
        { id: 'f2', label: '周末出门的自由', weight: 4, ratings: { A: 8, B: 4 } },
        { id: 'f3', label: '停车和保养的麻烦', weight: 3, ratings: { A: 5, B: 7 } },
        { id: 'f4', label: '每天通勤的时间', weight: 4, ratings: { A: 7, B: 5 } },
        { id: 'f5', label: '下雨天的心情', weight: 2, ratings: { A: 8, B: 5 } },
      ],
    },
  },
  {
    key: 'longdist',
    emoji: '💌',
    tag: '关系',
    title: '搬去对方在的城市，还是继续异地',
    blurb: '你们已经异地两年，每个月见一次，每次分开都在车站站很久；可你这边的工作刚有起色。',
    body: {
      title: '搬去对方在的城市，还是继续异地',
      options: [
        { id: 'A', label: '搬去对方在的城市' },
        { id: 'B', label: '继续异地' },
      ],
      // 关系类：只摆出用户自己的判断，不评价这段关系值不值得。
      factors: [
        { id: 'f1', label: '多久能见一次', weight: 6, ratings: { A: 9, B: 3 } },
        { id: 'f2', label: '我这边的收入', weight: 5, ratings: { A: 4, B: 8 } },
        { id: 'f3', label: '关系稳不稳', weight: 5, ratings: { A: 8, B: 4 } },
        { id: 'f4', label: '重新找工作的成本', weight: 4, ratings: { A: 3, B: 8 } },
        { id: 'f5', label: '两边家里人的看法', weight: 2, ratings: { A: 5, B: 6 } },
      ],
    },
  },
  {
    key: 'pet',
    emoji: '🐕',
    tag: '生活',
    title: '养一只狗，还是先不养',
    blurb: '你在收容所看到那只混血小狗，它一直盯着你看。回家的路上你已经在想名字了，可你也知道自己下周就要出差三天。',
    body: {
      title: '养一只狗，还是先不养',
      options: [
        { id: 'A', label: '养一只狗' },
        { id: 'B', label: '先不养' },
      ],
      // 4 个因素（story-engineer 复审后删掉了第 5 个）：
      // 原第 5 个「每天能固定陪它的时间」与第 1 个「每天要花的时间」语义重复，
      // 会让"时间"这个维度被重复计到 37.5%。删掉后结论不变（63.3/68.8 → 63.8/68.6）。
      // 同时避免了"养得好的把握"这种会读成产品在评估你养宠能力的措辞。
      factors: [
        { id: 'f1', label: '每天要花的时间', weight: 6, ratings: { A: 5, B: 8 } },
        { id: 'f2', label: '每个月的开销', weight: 5, ratings: { A: 6, B: 8 } },
        { id: 'f3', label: '回家有人等的感觉', weight: 6, ratings: { A: 9, B: 4 } },
        { id: 'f4', label: '出门旅行还方不方便', weight: 4, ratings: { A: 5, B: 8 } },
      ],
    },
  },
];

export function findExample(key) {
  return EXAMPLES.find((e) => e.key === key) || null;
}

/** 深拷贝，防止示例数据被界面改动污染 */
export function cloneBody(body) {
  return JSON.parse(JSON.stringify(body));
}

/**
 * 高风险领域检测：命中则必须在界面显著位置给出警示。
 *
 * 为什么要做：用户完全可能把「要不要做心脏搭桥手术」「要不要签这份离婚协议」输进来，
 * 然后看到一个平静的「更倾向 X」。那比报错更危险——它会让一个不适合用加权打分处理的决定，
 * 看起来像被"算"过了。
 *
 * 这里只做**关键词命中**，不假装能理解语义。命中后不拒绝服务，而是：
 *   1) 在工作区顶部显示醒目警示
 *   2) 分享摘要里也带上这句警示
 * 判断标准偏宽（宁可多提醒），因为多提醒的代价远小于少提醒。
 */
const HIGH_RISK_PATTERNS = [
  { re: /手术|化疗|放疗|透析|靶向药|处方|停药|诊断|治疗方案|活检|要不要住院/, area: '医疗' },
  { re: /起诉|应诉|打官司|诉讼|离婚协议|抚养权|监护权|遗嘱|劳动仲裁|刑事|报警|签不签.*合同/, area: '法律' },
  { re: /投资|股票|基金|理财|贷款|房贷|抵押|保险|加杠杆|创业融资|要不要借钱/, area: '财务' },
  { re: /自杀|自残|伤害自己|不想活|结束生命|伤害他人/, area: '心理危机' },
];

/**
 * @param {object} input 含 title / options / factors 的对象
 * @returns {{risky:boolean, area:string|null, matched:string|null}}
 */
export function detectHighRisk(input) {
  if (!input || typeof input !== 'object') return { risky: false, area: null, matched: null };
  const haystack = [
    input.title || '',
    ...(Array.isArray(input.options) ? input.options.map((o) => (o && o.label) || '') : []),
    ...(Array.isArray(input.factors) ? input.factors.map((f) => (f && f.label) || '') : []),
  ].join(' ');

  for (const { re, area } of HIGH_RISK_PATTERNS) {
    const m = haystack.match(re);
    if (m) return { risky: true, area, matched: m[0] };
  }
  return { risky: false, area: null, matched: null };
}

/** 高风险时给用户看的完整提示文案 */
export function highRiskNotice(area, matched) {
  const body = area === '心理危机'
    ? '这不是一个适合用打分来权衡的问题。如果你现在有伤害自己的想法，请立刻联系当地的心理援助热线或急救电话，也请告诉一个你信任的人。'
    : `这类${area}决定不适合用「打分 + 加权平均」来做。本工具只能帮你把要素列出来，不能替你判断。请咨询有资质的专业${area === '医疗' ? '医生' : area === '法律' ? '律师' : '人士'}。`;
  return {
    title: `检测到「${matched}」——这属于${area}领域`,
    body,
    extra: '下面算出的分数仍然只是你打分的加权结果，不构成任何专业意见，请不要据此做决定。',
  };
}

/**
 * 规则生成的"三个视角"。不是法庭，不是专业人士，只是把同一个结果换个角度念一遍。
 *
 * 三种 direction 都要能读通：
 *  - increase：从现在的 X% 提高到 Y% 会打平
 *  - decrease：从现在的 X% 降低到 Y% 会打平
 *  - hold    ：现在就在打平点上，往哪边拨都会立刻偏向一边（不能写成"从 X% 挪到 X%"）
 * flip 为 null 时（各因素方向一致，或全部打平）走"翻不过来"的分支，并给出下一步动作。
 *
 * @param {object} analysis scoreDecision() 的返回值
 * @param {object|null} flip findFlipThresholds() 里挑出来的那一条
 * @param {object|null} hypothesis chooseValidationHypothesis() 的返回值
 */
export function buildViewpoints(analysis, flip, hypothesis) {
  if (!analysis || !Array.isArray(analysis.contributions) || !Array.isArray(analysis.options)) {
    return emptyViewpoints();
  }

  const { contributions, options, difference } = analysis;
  const aLabel = options[0]?.label || 'A';
  const bLabel = options[1]?.label || 'B';
  const tieLevel = tieLevelOf(analysis);

  const positives = contributions.filter((c) => c.delta > 1e-9).sort((x, y) => y.delta - x.delta);
  const negatives = contributions.filter((c) => c.delta < -1e-9).sort((x, y) => x.delta - y.delta);

  const supportText = sideArgument({
    sideLabel: aLabel,
    own: positives,
    other: negatives.map(toSideB),
    otherLabel: bLabel,
    tieLevel,
  });
  const opposeText = sideArgument({
    sideLabel: bLabel,
    own: negatives.map(toSideB),
    other: positives,
    otherLabel: aLabel,
    tieLevel,
  });

  return {
    support: { role: '支持 A 的一方会说', text: supportText },
    oppose: { role: '支持 B 的一方会说', text: opposeText },
    chair: {
      role: '主持这件事的人会说',
      text: chairLine({ flip, hypothesis, tieLevel, difference, contributions, aLabel, bLabel }),
    },
    disclaimer: '以上三句是规则模板生成的思考角度，不代表律师、心理咨询师或任何专业人士的意见，也不构成建议。',
  };
}

function emptyViewpoints() {
  return {
    support: { role: '支持 A 的一方会说', text: '还没有可分析的内容。' },
    oppose: { role: '支持 B 的一方会说', text: '还没有可分析的内容。' },
    chair: { role: '主持这件事的人会说', text: '先把两个方案和因素填好，这里才有话可说。' },
    disclaimer: '以上三句是规则模板生成的思考角度，不代表律师、心理咨询师或任何专业人士的意见，也不构成建议。',
  };
}

/**
 * 把"B 占优的因素"翻成 B 视角的一条论据：
 * 评分对调，差值取正，这样 A 视角和 B 视角可以共用同一段排版逻辑。
 */
function toSideB(c) {
  return {
    ...c,
    ratingA: c.ratingB,
    ratingB: c.ratingA,
    delta: -c.delta,
    otherRating: c.ratingA,
    ownRating: c.ratingB,
  };
}

/**
 * 一边的论据。关键边界：这一边如果一项占优都没有，就不能硬说"这几项偏向我"。
 */
function sideArgument({ sideLabel, own, other, otherLabel, tieLevel }) {
  if (own.length === 0) {
    if (tieLevel === 'exact') {
      return `说句公道话：「${sideLabel}」这边一项都没占上风——所有因素两边分数都一样，现在没有任何一条能拿出来说的理由。`;
    }
    if (tieLevel === 'display') {
      return `说句公道话：「${sideLabel}」这边一项都没占上风——两边分数四舍五入到 1 位小数后是一样的（原始计算仍有细微差异），所以这一边现在没有任何一条能拿出来说的理由。`;
    }
    return `说句公道话：「${sideLabel}」在所有因素上都没有拿到比对方更高的分，这一边现在一条站得住的理由都没有。真要支持它，得从你还没写进这张表的因素里找。`;
  }

  const items = own.slice(0, 2).map((c) => {
    const mine = c.ownRating !== undefined ? c.ownRating : c.ratingA;
    const theirs = c.otherRating !== undefined ? c.otherRating : c.ratingB;
    return `「${c.label}」（这一边 ${fmt(mine)} 对对面 ${fmt(theirs)}，折算进总分 ${signed(c.delta)}）`;
  });
  const head = own.length === 1
    ? `只有这一项能拿来说：${items[0]}。`
    : `最硬的两条是 ${joinCn(items)}。`;

  const tail = other.length > 0
    ? `但对面「${otherLabel}」在「${other[0].label}」上反过来领先 ${fmt(Math.abs(other[0].delta))} 分，这笔账不能不算。`
    : '对面在单项上一条反驳都拿不出来，这一边的优势是全面的。';

  return `${head}${tail}`;
}

/**
 * 主持者那句话：必须给出具体的下一步动作，而不是"再想想"。
 */
function chairLine({ flip, hypothesis, tieLevel, difference, contributions, aLabel, bLabel }) {
  const hypLabel = hypothesis && hypothesis.label ? hypothesis.label : null;
  // 不从 hypothesis.steps[0] 里复制整句：那句是通用模板，遇到"搬家要搬的东西"这类
  // 客观属性因素会读成"找人问一句「搬家要搬的东西」"，语义不通。
  // 这里只取动作标题（按因素类型挑的、本身是中性的），再套一层中性的动作描述。
  const actionTitle = hypLabel ? firstActionTitle(hypLabel) : null;
  const actionCategory = hypLabel ? inferCategory(hypLabel) : '未知';

  // "下一步"必须落到今天就能开始做的一件事上，不能停在"再想想"。
  // 归不进六类的因素（物品、客观属性）不给具体动作名，免得套上"去问人"之类不对路的句式。
  const nextStepText = !hypLabel
    ? '下一步先别调权重：挑一个你最有把握的因素，把它拆成 7 天内能核实的小问题，去问、去试，再回来改分。'
    : actionTitle && actionCategory !== '未知'
      ? `下一步别急着调权重：围绕「${hypLabel}」先做一件 7 天内能完成的小事——比如「${actionTitle}」；拿到答案就回来改这两个评分。`
      : `下一步别急着调权重：先把「${hypLabel}」变成一件 7 天内能查证的具体事实——数一次、量一次，或者问一个真的知道的人；拿到答案就回来改评分。`;

  // ① 有可行阈值，且当前就压在打平点上
  if (flip && flip.direction === 'hold') {
    return `「${flip.label}」现在的权重占比 ${pct(flip.currentShare)} 正好就是打平点，两边分数一样。往哪个方向拨都会立刻偏向一边——此刻缺的不是权重，是证据。${nextStepText}`;
  }

  // ② 有可行阈值，方向明确
  if (flip) {
    const verb = flip.direction === 'increase' ? '提高' : '降低';
    const beyond = flip.direction === 'increase' ? '再往上' : '再往下';
    const gap = Math.abs(flip.thresholdShare - flip.currentShare);
    // display 级同分时，屏幕上已经是同一个数了；直接说"提高到 X 就会打平"
    // 会让人以为现在还没打平。补一句：现在只是显示同分，下面说的是**精确**打平点。
    const displayNote = tieLevel === 'display'
      ? `（注意：你现在看到的两边是四舍五入后同一个数，原始计算还差 ${fmt(Math.abs(difference))} 分；下面讲的是精确打平的位置。）`
      : '';

    // 现在完全没参与计算的因素，单独说：它一旦被算进来就可能翻盘。
    // 阈值保留 2 位小数：1 位小数的临界值（如 39.4%）在数值上并不真的打平，
    // 让用户照着这个数去拖会发现"说打平却没打平"。
    if (flip.currentShare < 1e-9) {
      return `注意「${flip.label}」现在的权重是 0，等于完全没把它算进去。只要把它加回到约 ${pct(flip.thresholdShare, 2)} 的占比（精确 ${pct(flip.thresholdShare, 4)}），两边就会打平，${beyond}就翻过来——所以真正的问题不是权重数字，是这一项到底该不该算数。${nextStepText}`;
    }

    const remark = gap < 0.02
      ? '两者只差不到两个百分点，你现在这个结论几乎是踩在线上。'
      : gap < 0.12
        ? '挪得不算多，这个结论并不牢。'
        : '要挪比较大的幅度才会翻转，这个结论暂时算稳。';

    // 兜底：差值极小的时候 1 位小数可能把两边显示成同一个百分数，
    // 这时改成"略微"的说法，绝不输出"从 33.3% 提高到 33.3%"。
    if (pct(flip.currentShare) === pct(flip.thresholdShare)) {
      return `先别急着定。现在「${flip.label}」的权重占比 ${pct(flip.currentShare)} 几乎就压在打平点上，只要再${verb}一点点，${beyond}就翻过来——这个结论是踩在线上，不是站得稳。${nextStepText}`;
    }
    // 措辞改为"约 X（精确 Y）"：临界点一般是无理数级的数，任何有限位的小数都只能"约等于"。
    // 说成"降低到 39.4，两边就会打平"是错的——39.4% 处实测仍有 Δ=−0.004。
    return `先别急着定。${displayNote}把「${flip.label}」的权重占比从现在的 ${pct(flip.currentShare)} ${verb}到约 ${pct(flip.thresholdShare, 2)}（精确 ${pct(flip.thresholdShare, 4)}），两边就会打平，${beyond}就翻过来——${remark}${nextStepText}`;
  }

  // ③ 没有可行阈值，而且两边完全打平（此时每个因素要么同分、要么互相抵消到没有杠杆）
  if (tieLevel !== 'none') {
    const total = (contributions || []).length;
    const flat = (contributions || []).filter((c) => Math.abs(c.delta) < 1e-9).length;
    const allFlat = total > 0 && flat === total;
    const ask = hypLabel
      ? `先回答「${hypLabel}」这一个问题：你凭什么觉得两边一样？`
      : '先挑一个你最有把握的因素，把两边的分重新打一次。';
    // display 级不能说"完全打平"，也不能说"调权重不会有任何变化" ——
    // 原始值其实差一点点，只是四舍五入后看不出来。
    if (tieLevel === 'display') {
      return `两边显示为相同分数（四舍五入到 1 位小数），原始计算只差 ${fmt(Math.abs(difference))} 分。这个差距小到单个因素的权重怎么调都翻不过来——真正要做的是先把评分打出差别：${ask}`;
    }
    return `两边现在完全打平${allFlat ? '，而且每个因素的评分都一样' : ''}。这种局面下调权重不会有任何变化，因为没有任何一项在往里加分。真正要做的是先把评分打出差别——${ask}`;
  }

  // ④ 没有可行阈值，但确实分出胜负：各因素方向一致，翻不过来
  const leadLabel = difference > 0 ? `「${aLabel}」` : `「${bLabel}」`;
  const gapText = fmt(Math.abs(difference));
  // display 级同分走到这里（没有可行阈值）：屏幕上两边是同一个数，
  // 就绝不能说"领先的 0.1 分" —— 那是用户看不到、也验证不了的数字。
  if (tieLevel === 'display') {
    return `在只调一个因素权重的前提下，这个结论翻不过来：两边显示为相同分数（四舍五入到 1 位小数），原始计算只差 ${gapText} 分，而这个差距小到调权重抹不掉、也小到看不出来。别再和权重较劲了，能改变结论的只有评分本身——把真实差距打出来，结论才有意义。${nextStepText}`;
  }
  return `在只调一个因素权重的前提下，这个结论翻不过来：你给两个方案的评分在每个因素上方向都一致，领先的 ${gapText} 分不是靠某一项撑起来的，挪权重抹不掉它（${leadLabel}这一边）。别再和权重较劲了，能改变结论的只有评分本身。${nextStepText}`;
}

/** 从验证动作库里取第一条动作的标题，让"下一步"落到具体动作上 */
export function firstActionTitle(factorLabel) {
  try {
    const actions = pickValidationActions(factorLabel);
    return actions && actions.length > 0 ? actions[0].title : null;
  } catch {
    return null;
  }
}

function signed(n) {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;
}

function joinCn(items) {
  if (items.length <= 1) return items[0] || '';
  return `${items.slice(0, -1).join('、')} 和 ${items[items.length - 1]}`;
}

function fmt(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function pct(share, digits = 1) {
  return `${(share * 100).toFixed(digits)}%`;
}
