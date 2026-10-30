/**
 * 精度与「同分」语义 —— 纯函数，不碰 DOM、不发网络、不读存储。
 *
 * 为什么单独成模块（V10 P1-1）：
 * 「打平」这件事有**三个不同的精度层级**，全站所有可见面
 * （首屏演示、结果卡、反转卡、分享摘要、打印、读屏播报、中英 README）
 * 必须共享同一套判据与措辞。放在 app.mjs 里就只能靠浏览器端到端验证，
 * ±1e-10 / ±1e-8 这种边界根本测不准；抽成纯模块后边界矩阵可以直接单测。
 *
 * 三个层级：
 *
 * 1) numericTie / exact
 *    `|Δ| < TIE_EPSILON`（核心 core.mjs 的 1e-9）。
 *    含义是「数值容差内视为同分」——**不是**无限精度下绝对相等。
 *    只有这一级才允许说「分数完全相同」。
 *
 * 2) displayTie / display
 *    两个分数各自保留 1 位小数后**显示相同**，但原始值可能差到 0.05。
 *    例：66.14 与 66.06 都显示 66.1，差值 0.08 确实存在。
 *    这一级必须写「显示为相同分数（四舍五入到 1 位小数），原始计算存在细微差异」。
 *
 * 3) none
 *    没有同分，正常比大小。
 *
 * 界面规则不变：**屏幕说打平 ⇔ 屏幕上两个数字一样**。
 * 这条规则防的是「66.1 / 66.1 却说 A 领先 0.0 分」这种硬矛盾；
 * 上面的分层防的是另一件事 —— 把「显示同分」说成「精确打平」。
 */
import { TIE_EPSILON } from './core.mjs';

/** 统一的一位小数显示：全站所有分数文本都必须过这个函数。 */
export function fmt1(n) {
  return (Math.round(n * 10) / 10).toFixed(1);
}

/**
 * 判断同分层级。
 * @param {{scoreA: number, scoreB: number, difference?: number, tie?: boolean}|null} analysis
 * @returns {'exact'|'display'|'none'}
 */
export function tieLevelOf(analysis) {
  if (!analysis || typeof analysis.scoreA !== 'number' || typeof analysis.scoreB !== 'number') return 'none';
  const numericTie = typeof analysis.difference === 'number'
    ? Math.abs(analysis.difference) < TIE_EPSILON
    : analysis.tie === true;
  if (numericTie) return 'exact';
  return fmt1(analysis.scoreA) === fmt1(analysis.scoreB) ? 'display' : 'none';
}

/**
 * 用户**看到**的那个差值：两个显示分数相减。
 * 保证「差 0.0 ⇔ 屏幕显示同分」，与 tieLevelOf 用同一套显示精度。
 * @returns {string} 形如 "0.0" / "0.1"
 */
export function shownGapOf(analysis) {
  if (!analysis) return '0.0';
  return Math.abs(Number(fmt1(analysis.scoreA)) - Number(fmt1(analysis.scoreB))).toFixed(1);
}

/**
 * 带符号的显示差值：A 高为正、B 高为负。
 * 贡献表「逐项相加 = 合计」的取整目标必须用它，
 * 不能用原始 analysis.difference —— 否则显示同分时会出现
 * 「合计 66.1 | 66.1 | +0.1」这种屏幕自相矛盾。
 * @returns {number}
 */
export function signedShownGap(analysis) {
  if (!analysis) return 0;
  const a = Number(fmt1(analysis.scoreA));
  const b = Number(fmt1(analysis.scoreB));
  if (a === b) return 0;
  const gap = Math.round(Math.abs(a - b) * 10) / 10;
  return a > b ? gap : -gap;
}

/**
 * 是否为「精确同分」。单独导出，避免调用方各自写 `Math.abs(d) < 1e-9`
 * （曾经的缺陷就是各处容差不一致：1e-9 / 1e-6 / 5e-4 三种并存）。
 */
export function isExactTieOf(analysis) {
  return tieLevelOf(analysis) === 'exact';
}
