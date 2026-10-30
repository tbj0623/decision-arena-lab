/**
 * 回归测试：打平判据必须与"两个显示出来的分数"同源。
 *
 * 为什么加这条（最终验收报的阻断 1）：
 *   原判据 `fmt1(|Δ|) === "0.0"` 与展示 `fmt1(scoreA)` / `fmt1(scoreB)` 精度不同源。
 *   Δ=0.017~0.063 时：差值显示 0.0（判打平），但 66.05→66.1 / 65.98→66.0（不相等）。
 *   实测 39.32~39.34% 和 39.42~39.46% 都会这样，41 个采样点里 8 个矛盾。
 *
 * 这条测试直接锁语义：**只要 UI 说"打平"，两个显示出来的分数就必须相等。**
 * 不锁实现（不检查源码里怎么写），锁用户看到的结果。
 *
 * 用 JSDOM 不行（要真实渲染），所以起一个最小 HTTP 服务 + Playwright 跑。
 * 如果环境没有 Playwright，跳过而不是失败（CI 上没有浏览器时不该红）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

// 必须用 fileURLToPath —— 工作区路径含中文（十脑造物局），
// `new URL(...).pathname` 会给出百分号编码的 %E5%8D%81...，
// 拼出来的路径读不到文件，而症状是"页面加载了但 JS 没执行、元素找不到"。
const ROOT = fileURLToPath(new URL('../../site/', import.meta.url));

/**
 * 解析 Playwright 的入口 URL。
 *
 * 为什么不在源码里写死绝对路径：本机把 Playwright 装在全局 npm 目录，
 * 而那个绝对路径里带着**本机用户名** —— 那是个人路径，不该出现在公开仓库
 * （V10 发布门禁：无个人路径入库）。改成运行时向 npm 询问全局根目录，
 * 换机器 / 换用户都不用改代码。
 */
async function resolvePlaywrightEntry() {
  if (process.env.PLAYWRIGHT_ENTRY) return pathToFileURL(process.env.PLAYWRIGHT_ENTRY).href;
  // ① 项目内能解析到就用项目内的（有 node_modules 的环境）
  try {
    return import.meta.resolve('playwright');
  } catch { /* 继续走全局 */ }

  const candidates = [];
  // ② 问 npm 要全局目录。
  //    注意：Windows 上 npm 是 npm.cmd，`execFile` 直接调 .cmd 会 EINVAL，
  //    必须经过 `cmd /d /s /c`（这里踩过，症状是测试静默变成 skip）。
  try {
    const [cmd, args] = process.platform === 'win32'
      ? ['cmd', ['/d', '/s', '/c', 'npm root -g']]
      : ['npm', ['root', '-g']];
    const root = execFileSync(cmd, args, { encoding: 'utf8', timeout: 30000 }).trim();
    if (root) candidates.push(join(root, 'playwright', 'index.mjs'));
  } catch { /* 继续走兜底 */ }

  // ③ Windows 全局 npm 的默认位置：%APPDATA%\npm\node_modules。
  //    用环境变量拼，不写死用户名 —— 换用户/换机器都不用改代码。
  if (process.platform === 'win32' && process.env.APPDATA) {
    candidates.push(join(process.env.APPDATA, 'npm', 'node_modules', 'playwright', 'index.mjs'));
  }

  for (const entry of candidates) {
    try {
      await readFile(entry);
      return pathToFileURL(entry).href;
    } catch { /* 下一个候选 */ }
  }
  throw new Error('找不到 Playwright（可用 PLAYWRIGHT_ENTRY 显式指定入口）');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
};

let server;
let baseUrl;

test.before(async () => {
  server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
      const file = join(ROOT, normalize(rel));
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
});

test.after(async () => {
  if (server) await new Promise((r) => server.close(r));
});

test('UI 说"打平"时，两个显示出来的分数必须相等（不打平则必须不等）', async (t) => {
  let chromium;
  try {
    ({ chromium } = await import(await resolvePlaywrightEntry()));
  } catch {
    t.skip('环境里没有 Playwright，跳过浏览器级断言');
    return;
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    const contradictions = [];

    // 扫首屏滑杆整个"可能打平"的区间，步长 0.01%
    for (let pct = 39.0; pct <= 39.8; pct += 0.01) {
      const r = await page.evaluate((v) => {
        const s = document.querySelector('#hero-slider');
        s.value = String(v);
        s.dispatchEvent(new Event('input', { bubbles: true }));
        s.dispatchEvent(new Event('change', { bubbles: true }));
        return {
          a: document.querySelector('#hero-score-a')?.textContent?.trim(),
          b: document.querySelector('#hero-score-b')?.textContent?.trim(),
          text: document.querySelector('#hero-verdict')?.textContent?.trim() || '',
          state: document.querySelector('#hero-verdict')?.dataset?.state,
        };
      }, pct.toFixed(4));

      const saysTie = r.state === 'tie' || /打平/.test(r.text);
      // 判据：说打平 ⇔ 两个显示分数相等
      if (saysTie && r.a !== r.b) {
        contradictions.push({ pct: pct.toFixed(2), a: r.a, b: r.b, why: '说打平但分数不等' });
      }
      if (!saysTie && r.a === r.b) {
        contradictions.push({ pct: pct.toFixed(2), a: r.a, b: r.b, why: '分数相等却说没打平' });
      }
      // 判据：文案里的「差 X」必须等于两个**显示出来的**分数之差。
      // （跨浏览器审计 F2：之前文案用未取整的真实差值，
      //   出现「更倾向 X，差 0.0 分」而分数是 66.1/66.0 —— 同屏自相矛盾。）
      const m = r.text.match(/差\s*([\d.]+)\s*分/);
      if (!saysTie && m) {
        const expect = Math.abs(Number(r.a) - Number(r.b)).toFixed(1);
        if (m[1] !== expect) {
          contradictions.push({
            pct: pct.toFixed(2), a: r.a, b: r.b,
            why: `差值不同源：文案"差 ${m[1]}"，两个显示分数相减是 ${expect}`,
          });
        }
      }
    }

    assert.deepEqual(
      contradictions,
      [],
      `发现 ${contradictions.length} 处自相矛盾：\n` +
        contradictions.slice(0, 5).map((c) => `  · ${c.pct}% → ${c.a}/${c.b}（${c.why}）`).join('\n'),
    );
  } finally {
    await browser.close();
  }
});
