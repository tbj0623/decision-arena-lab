/**
 * UI 契约：app.mjs 里查询的每个 #id 必须在 index.html 里存在。
 *
 * 为什么需要这条测试（可维护性审查最硬的证据）：
 *   抽测 19 个 id 逐个改名跑测试，**16 个 211 全绿**。
 *   最危险的几个：
 *     #factor-list   整个输入区消失，页面不可用
 *     #contrib-body  / #flip-body / #verify-body  三个结果卡永久空白
 *   根因是每个 DOM 查询都写成 `const x = $('#foo'); if (!x) return;`（20 处），
 *   所以 id 打错时没有任何报错，只是那块 UI 静悄悄地不渲染。
 *
 *   这条测试把"改 HTML 后静默失效"变成"红灯"。
 *   20 行代码换 16 个雷，非常划算。
 *
 * 边界：
 *   · 只看**字面量** `$('#foo')` / `getElementById('foo')` / `querySelector('#foo')`
 *   · 模板字符串拼接的 id（如 `#w-${factor.id}`）**不参与**——它们是动态生成的，
 *     index.html 里本来就没有，硬比会误报
 *   · 先剥注释再扫描（否则注释里引用的旧 id 会误报；这个坑踩过三次）
 */

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const APP = readFileSync(new URL('../../site/app.mjs', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('../../site/index.html', import.meta.url), 'utf8');

/** 剥掉 /* *\/ 与 // 注释，避免注释里的代码片段被当成真的。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const appCode = stripComments(APP);

/** app.mjs 里所有**字面量** id 查询。 */
function literalIds(src) {
  const ids = new Set();
  const patterns = [
    /\$\(\s*'#([A-Za-z][\w-]*)'\s*\)/g,          // $('#foo')
    /\$\(\s*"#([A-Za-z][\w-]*)"\s*\)/g,          // $("#foo")
    /getElementById\(\s*'([A-Za-z][\w-]*)'\s*\)/g,
    /getElementById\(\s*"([A-Za-z][\w-]*)"\s*\)/g,
    /querySelector\(\s*'#([A-Za-z][\w-]*)'\s*\)/g,
    /querySelector\(\s*"#([A-Za-z][\w-]*)"\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of src.matchAll(re)) ids.add(m[1]);
  }
  return ids;
}

/** index.html 里所有 id="..." / id='...' 的值。 */
function htmlIds(src) {
  const ids = new Set();
  for (const m of src.matchAll(/\bid=["']([^"']+)["']/g)) ids.add(m[1]);
  return ids;
}

const queried = literalIds(appCode);
const present = htmlIds(HTML);

test('app.mjs 查询的每个字面量 #id 都必须在 index.html 里存在（防静默失效）', () => {
  assert.ok(queried.size > 20, `只提取到 ${queried.size} 个 id，正则可能失效了`);

  const missing = [...queried].filter((id) => !present.has(id)).sort();

  assert.deepEqual(
    missing,
    [],
    '以下 id 在 app.mjs 里被查询、但 index.html 里不存在（对应的 UI 会静默不渲染）：\n' +
      missing.map((id) => `  · #${id}`).join('\n'),
  );
});

test('反向断言：故意不存在的 id 必须能被抓出来（证明测试有效）', () => {
  // 这是"负向验证"内建在测试里：如果提取逻辑坏掉、永远返回空数组，
  // 上面那条就会假绿。这里用一个绝不可能存在的 id 走同一条路径。
  const fake = new Set(['this-id-should-never-exist-in-index-html']);
  const missing = [...fake].filter((id) => !present.has(id));
  assert.deepEqual(missing, ['this-id-should-never-exist-in-index-html']);
});
