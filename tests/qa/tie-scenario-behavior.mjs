/**
 * 打平场景矛盾 — **行为级**回归（Lead 写，不依赖源码字符串）
 *
 * product-owner 的 verify-tie-contradiction.mjs 是静态检查
 * （正则抓 `if (!flip) return ...` 那一行）。它有用，但有两个弱点：
 *   1. 我把兜底分支改成 if/else 块之后，它就抓不到了
 *   2. 它匹配的是源码文本，注释里出现同一串字也会误报
 *
 * 这个脚本直接跑真实代码路径，断言的是**用户看到什么**，不是源码长什么样。
 * 这样无论以后怎么重写实现，只要行为对就一定 PASS。
 */
import { scoreDecision, findFlipThresholds, pickFlipHighlight } from '../../site/core.mjs';

let fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
  if (!ok) fail += 1;
}

function mk(allSame) {
  return {
    title: 't',
    options: [{ id: 'A', label: '甲' }, { id: 'B', label: '乙' }],
    factors: [
      { id: 'f1', label: '发展空间', weight: 3, ratings: { A: 5, B: allSame ? 5 : 8 } },
      { id: 'f2', label: '稳定性', weight: 3, ratings: { A: 5, B: allSame ? 5 : 4 } },
      { id: 'f3', label: '时间成本', weight: 3, ratings: { A: 5, B: allSame ? 5 : 6 } },
      { id: 'f4', label: '兴趣匹配', weight: 3, ratings: { A: 5, B: allSame ? 5 : 7 } },
    ],
  };
}

/* ── 场景 1：全部评分相同（product-owner 复现的那个） ── */
{
  const input = mk(true);
  const a = scoreDecision(input);
  const thresholds = findFlipThresholds(input);
  const flip = pickFlipHighlight(thresholds);
  const anyFeasible = thresholds.some((t) => t.feasible);

  check('场景1 确实打平（tie=true）', a.tie === true, `A=${a.scoreA} B=${a.scoreB}`);
  check('场景1 确实没有可行阈值', anyFeasible === false,
    thresholds.map((t) => `${t.label}:${t.feasible}`).join(','));
  check('场景1 flip 为 null（无高亮因素）', flip === null || flip === undefined,
    `flip=${flip ? flip.label : 'null'}`);
}

/* ── 场景 2：打平但存在可行阈值（互相抵消） ── */
{
  const input = {
    title: 't',
    options: [{ id: 'A', label: '甲' }, { id: 'B', label: '乙' }],
    factors: [
      { id: 'f1', label: '甲因素', weight: 5, ratings: { A: 9, B: 4 } },
      { id: 'f2', label: '乙因素', weight: 5, ratings: { A: 4, B: 9 } },
      { id: 'f3', label: '丙因素', weight: 5, ratings: { A: 6, B: 6 } },
      { id: 'f4', label: '丁因素', weight: 5, ratings: { A: 7, B: 7 } },
    ],
  };
  const a = scoreDecision(input);
  const thresholds = findFlipThresholds(input);
  const anyFeasible = thresholds.some((t) => t.feasible);
  check('场景2 确实打平', a.tie === true, `A=${a.scoreA} B=${a.scoreB}`);
  console.log(`       （此场景 anyFeasible=${anyFeasible}，两种分支都合法）`);
}

/* ── 场景 3：非打平、可翻转（示例 1） ── */
{
  const input = mk(false);
  const a = scoreDecision(input);
  const thresholds = findFlipThresholds(input);
  const flip = pickFlipHighlight(thresholds);
  check('场景3 未打平', a.tie === false, `A=${a.scoreA} B=${a.scoreB} 差=${a.difference.toFixed(2)}`);
  check('场景3 能找到可翻转因素', !!flip, flip ? flip.label : 'null');
}

/* ── 场景 4：非打平、不可翻转（所有 d 同号） ── */
{
  const input = {
    title: 't',
    options: [{ id: 'A', label: '甲' }, { id: 'B', label: '乙' }],
    factors: [
      { id: 'f1', label: '甲因素', weight: 3, ratings: { A: 9, B: 5 } },
      { id: 'f2', label: '乙因素', weight: 3, ratings: { A: 8, B: 4 } },
      { id: 'f3', label: '丙因素', weight: 3, ratings: { A: 7, B: 6 } },
      { id: 'f4', label: '丁因素', weight: 3, ratings: { A: 6, B: 5 } },
    ],
  };
  const a = scoreDecision(input);
  const thresholds = findFlipThresholds(input);
  const flip = pickFlipHighlight(thresholds);
  const anyFeasible = thresholds.some((t) => t.feasible);
  check('场景4 未打平', a.tie === false, `A=${a.scoreA} B=${a.scoreB}`);
  check('场景4 确实不可翻转', anyFeasible === false && !flip,
    `anyFeasible=${anyFeasible} flip=${flip ? flip.label : 'null'}`);
}

console.log('─'.repeat(62));
console.log(fail === 0 ? '✓ 行为级断言全部通过' : `✗ ${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
