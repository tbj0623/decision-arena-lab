/**
 * 反悔雷达 · Decision Arena — 7 天验证动作模板库
 * 纯数据 + 纯函数，零依赖，不含 DOM 操作，不发任何网络请求。
 *
 * 用途
 *   假设卡只负责挑出"最该被核实的那一条判断"，这里负责回答更难的问题：
 *   具体去问谁、问什么、怎么记下来。
 *
 * 每条动作的硬约束（写新动作时必须同时满足）
 *   1. 7 天内能做完，单次不超过 90 分钟；
 *   2. 不需要花钱（不报班、不买课、不买工具、不付费查数据）；
 *   3. 必须说清"问谁 / 问什么 / 怎么记"，而不是"多了解一下"；
 *   4. 产出必须是能被写下来的东西（一行数字、一句原话、一张清单），
 *      用户拿它回来改评分，才算闭环。
 *
 * 这些动作不提供答案，也不替用户判断哪个方案更好。
 * 它们只做一件事：把"你猜的"换成"你知道的"。
 */

/** @typedef {{id:string,title:string,text:string,record:string,minutes:number}} ValidationAction */

/**
 * 六个分类。顺序即匹配优先级：先命中者为准。
 * unknown 永远放最后兜底。
 */
export const VALIDATION_CATEGORIES = [
  {
    id: 'people',
    label: '人相关',
    hint: '和某个人、某群人的相处、配合、沟通有关',
    keywords: ['人', '关系', '团队', '同事', '上级', '领导', '老板', '家人', '父母', '朋友', '同伴', '搭档', '沟通', '配合', '氛围', '客户'],
  },
  {
    id: 'money',
    label: '钱相关',
    hint: '和价格、花费、收入、成本有关',
    keywords: ['钱', '价', '费', '租', '收入', '工资', '薪', '预算', '花销', '支出', '押金', '经济', '账'],
  },
  {
    id: 'time',
    label: '时间相关',
    hint: '和通勤、耗时、周期、能不能挤出时间有关',
    keywords: ['时间', '通勤', '路程', '耗时', '时长', '加班', '周期', '等待', '排期', '作息', '忙', '来回', '排队'],
  },
  {
    id: 'skill',
    label: '技能相关',
    hint: '和能力、经验、学习曲线、上手难度有关',
    keywords: ['技能', '能力', '经验', '学习', '学会', '上手', '熟练', '门槛', '专业', '水平', '成长', '掌握'],
  },
  {
    id: 'mood',
    label: '情绪相关',
    hint: '和心情、压力、后悔、喜不喜欢有关',
    keywords: ['心情', '情绪', '焦虑', '压力', '后悔', '喜欢', '开心', '难受', '踏实', '纠结', '怕', '在意', '心里', '安心', '负担'],
  },
  { id: 'unknown', label: '未知', hint: '暂时说不清属于哪一类', keywords: [] },
];

/**
 * 每个分类 3 条动作。{factor} 会被替换成真实的因素名。
 * @type {Record<string, ValidationAction[]>}
 */
const ACTIONS = {
  people: [
    {
      id: 'people-1',
      title: '问一个待满一年的人',
      text: '找 1 位在你要选的那条路上待满一年的人，问三句：最费劲的是什么、最没料到的是什么、重来会改哪一步。',
      record: '答案记进手机备忘录，一行一条原话，不要总结成"还行"。',
      minutes: 40,
    },
    {
      id: 'people-2',
      title: '问一个已经离开的人',
      text: '问 1 位从那条路上退出来的人：当初为什么走、走的时候最舍不得什么。',
      record: '只记他说的第一个理由，7 天后回来对照你给「{factor}」打的分。',
      minutes: 30,
    },
    {
      id: 'people-3',
      title: '让一个朋友反驳你',
      text: '把「{factor}」写成一句能被反驳的话，发给 1 位了解你的朋友，请他只回"同意 / 不同意 + 一句为什么"。',
      record: '把回复原样贴进备忘录，别删掉不同意的部分。',
      minutes: 15,
    },
  ],
  money: [
    {
      id: 'money-1',
      title: '翻三个月的流水',
      text: '翻出最近 3 个月和「{factor}」有关的实际支出，一笔一笔加总。',
      record: '把总数写下来，和你凭印象估的数字并排放，差多少就写多少。',
      minutes: 25,
    },
    {
      id: 'money-2',
      title: '列两张真实支出单',
      text: '给两个方案各列一张 7 天内确定会发生的支出清单，固定支出和可能要发生的分两栏。',
      record: '只写数字和日期，不写值不值。',
      minutes: 20,
    },
    {
      id: 'money-3',
      title: '问一个刚花过这笔钱的人',
      text: '问 1 位最近半年做过同样选择的人：实际花掉的钱比事先预计多了多少、多在哪一项。',
      record: '记成三格：预计 X / 实际 Y / 差在 Z。',
      minutes: 20,
    },
  ],
  time: [
    {
      id: 'time-1',
      title: '用计时器真走一遍',
      text: '按其中一个方案完整走一遍（含等待、换乘、排队），全程用手机计时。',
      record: '记下总分钟数和最卡的那一段；地图上的估算不算。',
      minutes: 90,
    },
    {
      id: 'time-2',
      title: '数一遍你真实的空闲',
      text: '翻最近 14 天的日历和聊天记录，数出真正空着的晚上有几个。',
      record: '写下这个数字——它是你能投入的上限，不是"应该能挤出来"的时间。',
      minutes: 20,
    },
    {
      id: 'time-3',
      title: '做一次 60 分钟的最小尝试',
      text: '把「{factor}」拆成一次 60 分钟内能做完的最小尝试，周末找一段不被打断的时间做完。',
      record: '做完写两行：实际用了多少分钟、卡在第几步。',
      minutes: 60,
    },
  ],
  skill: [
    {
      id: 'skill-1',
      title: '跟做一段 20 分钟入门',
      text: '找一段 20 分钟的入门教程，跟着做出一个最小成品（不用报班、不用买课）。',
      record: '记下你卡住的第一个具体步骤，不要写"感觉很难"。',
      minutes: 30,
    },
    {
      id: 'skill-2',
      title: '问一个已经会的人',
      text: '问 1 位已经会这项技能的人：从零到能独立做完一件像样的事，花了多久、每天投入多少。',
      record: '只要两个数字：多少天、每天多少分钟。',
      minutes: 20,
    },
    {
      id: 'skill-3',
      title: '做一次 3 题小测',
      text: '找 3 道入门级的现成题，限时 20 分钟做完，不查答案。',
      record: '只记对了几题、错的是哪一类题。',
      minutes: 25,
    },
  ],
  mood: [
    {
      id: 'mood-1',
      title: '连打 5 天情绪分',
      text: '接下来 5 天，每天睡前给"想到「{factor}」时的难受程度"打 0–10 分。',
      record: '5 个数字写在同一行，7 天后看它是在变还是没变。',
      minutes: 10,
    },
    {
      id: 'mood-2',
      title: '写下你最怕的那一幕',
      text: '写下去做其中一个方案时你最怕发生的具体一幕：什么时间、在哪、有谁在场。',
      record: '写完补一句"真发生了我会怎么处理"，原文存备忘录，别改。',
      minutes: 20,
    },
    {
      id: 'mood-3',
      title: '把怕的事说给一个人听',
      text: '找 1 位你信任的人，把"我怕的是……"完整说一遍，不解释也不辩论，请他只复述他听到的。',
      record: '记下他的复述和你原话的差别——差别通常在你说不清的那一块。',
      minutes: 30,
    },
  ],
  unknown: [
    {
      id: 'unknown-1',
      title: '拆成 3 个能一句话回答的问题',
      text: '把「{factor}」拆成 3 个能一句话回答的具体问题——不是"好不好"，而是"是什么 / 有多少 / 需要什么条件"。',
      record: '每个问题写一句你现在的答案，并在后面标一个来源等级：确定 / 听说的 / 猜的。',
      minutes: 30,
    },
    {
      id: 'unknown-2',
      title: '讲给一个外行听',
      text: '用 2 分钟把两个方案讲给 1 位完全不了解这件事的人，让他复述他以为你在纠结什么。',
      record: '记下他答偏的地方——那一般就是你自己也没想清楚的那块。',
      minutes: 15,
    },
    {
      id: 'unknown-3',
      title: '写一句判断 + 一句没底',
      text: '给「{factor}」写一句你现在敢下的判断，再写一句你最没把握的部分。',
      record: '原文存进备忘录，7 天后只回来看后半句有没有被新信息补上。',
      minutes: 15,
    },
  ],
};

/** 所有动作 id，供测试遍历 */
export const VALIDATION_ACTION_IDS = Object.values(ACTIONS).flat().map((a) => a.id);

/**
 * 把一个分类的 id 或中文名解析成分类对象。
 * @param {string} category
 * @returns {{id:string,label:string,hint:string,keywords:string[]}|null}
 */
export function resolveCategory(category) {
  if (typeof category !== 'string' || category.trim() === '') return null;
  const key = category.trim();
  return (
    VALIDATION_CATEGORIES.find((c) => c.id === key) ||
    VALIDATION_CATEGORIES.find((c) => c.label === key) ||
    null
  );
}

/**
 * 从因素名里猜分类。猜不出就返回「未知」——猜错也不会误导，
 * 因为未知类的三条动作对任何因素都成立。
 * @param {string} factorLabel
 * @returns {string} 分类中文名
 */
export function inferCategory(factorLabel) {
  if (typeof factorLabel !== 'string') return '未知';
  const label = factorLabel.trim();
  if (!label) return '未知';
  for (const category of VALIDATION_CATEGORIES) {
    if (category.id === 'unknown') continue;
    if (category.keywords.some((word) => label.includes(word))) return category.label;
  }
  return '未知';
}

/**
 * 取某个因素的 3 条 7 天验证动作。
 *
 * @param {string} factorLabel 因素名，会被嵌进动作文本里
 * @param {string} [category] 分类（id 或中文名）。省略/无法识别时按因素名推断
 * @returns {ValidationAction[]} 恰好 3 条，且是副本，调用方随便改不会污染模板
 */
export function pickValidationActions(factorLabel, category) {
  const safeLabel = typeof factorLabel === 'string' && factorLabel.trim() ? factorLabel.trim() : '这一项';
  const resolved = resolveCategory(category);
  const key = resolved ? resolved.id : (VALIDATION_CATEGORIES.find((c) => c.label === inferCategory(safeLabel)) || {}).id || 'unknown';
  const template = ACTIONS[key] || ACTIONS.unknown;

  return template.map((action) => ({
    ...action,
    category: resolved ? resolved.label : inferCategory(safeLabel),
    factorLabel: safeLabel,
    text: action.text.split('{factor}').join(safeLabel),
    record: action.record.split('{factor}').join(safeLabel),
  }));
}

/** 拿到全部动作（测试与文档用），按分类分组 */
export function listValidationActions() {
  return VALIDATION_CATEGORIES.map((category) => ({
    id: category.id,
    label: category.label,
    hint: category.hint,
    actions: pickValidationActions('某个因素', category.id),
  }));
}
