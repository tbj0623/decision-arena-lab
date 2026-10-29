/**
 * 把 promise-consistency.mjs（235 行、7 条承诺检查）接进 node --test。
 *
 * 为什么需要这个薄壳（可维护性审查发现）：
 *   那个文件从诞生起就跑不起来 —— import 路径写错成 '../site/core.mjs'。
 *   而且它的文件名没有 `.test.`，所以 `node --test` **永远不发现它**。
 *   235 行、7 条承诺一致性检查（含"占比加起来一定是 100%"）就这样一直是死的。
 *
 *   路径已修好（改成 '../../'）。这里用薄壳让它进入 CI。
 *
 * 踩坑记录：一开始用 `new URL(...).pathname` 拿路径，
 * 但工作区路径里有中文（十脑造物局），pathname 会给出百分号编码的
 * `%E5%8D%81...`，直接传给 node 就是 MODULE_NOT_FOUND。
 * 必须用 fileURLToPath()。
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('7 条对外承诺经得起验证（promise-consistency）', () => {
  const script = fileURLToPath(new URL('./promise-consistency.mjs', import.meta.url));
  let out = '';
  try {
    out = execFileSync(process.execPath, [script], { encoding: 'utf8', timeout: 120000 });
  } catch (e) {
    out = `${e.stdout || ''}${e.stderr || ''}`;
    assert.fail(`承诺一致性检查未通过：\n${out.slice(-2000)}`);
  }
  assert.match(out, /7\/7 条承诺经得起验证/, '脚本没有报告 7/7');
});
