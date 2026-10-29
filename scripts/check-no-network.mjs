/**
 * 静态审计：扫描 site/ 与 scripts/ 下所有文本文件，确认没有网络请求、
 * 没有持久化 API、没有遥测、没有硬编码密钥。
 *
 * 用法：node scripts/check-no-network.mjs
 * 退出码：0 = 通过；1 = 发现违规
 *
 * 这是发布前的 Gate C 门禁之一，会真的读文件、真的报行号。
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SCAN_DIRS = ['site', 'scripts'];
const TEXT_EXT = new Set(['.html', '.mjs', '.js', '.css', '.json', '.svg', '.txt', '.md']);

/** 禁止出现的运行时 API / 关键字 */
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

/** 明显的密钥模式（避免把真 token 提交进仓库） */
const SECRETS = [
  { re: /\bsk-[A-Za-z0-9]{16,}/, label: '疑似 OpenAI 风格密钥' },
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}/, label: '疑似 GitHub token' },
  { re: /\bAKIA[0-9A-Z]{16}\b/, label: '疑似 AWS Access Key' },
  { re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, label: '私钥' },
];

/**
 * 行级豁免：这些出现在注释 / 文档 / 数据 URI 里的字面量不是真实调用。
 *
 * 历史缺陷（已修）：早期版本用的是「整行匹配豁免」，只要行首是 data: 图标的 link 就整行跳过。
 * 于是「data: 图标 + 同行夹带网络请求」这种写法可以完整绕过审计。
 * 也就是说「行级白名单」把同一行里其它位置的违规也一起赦免了。
 *
 * 现在的规则：豁免只针对**被匹配到的那一处字面量本身**，不是整行。
 * 因此改为「先剔除已知安全片段，再在剩余文本上跑规则」。
 */
const SAFE_FRAGMENTS = [
  // HTML 内联 data: URI 的 favicon（同源，不外发）——只剔除这个标签本身
  /<link\s+rel="icon"\s+href="data:[^"]*">/gi,
  // 审计脚本自身的规则定义行（形如 { re: /.../, label: '...' }）
  /\{\s*re:\s*\/.*?\/[a-z]*,\s*label:\s*'[^']*'\s*\},?/g,
];

/**
 * 行级注释豁免：整行必须是一个**说明性注释**，且不带任何「调用形式」的危险字面量。
 *
 * 历史缺陷（已修）：早期版本只要行首是注释且出现否定词，整行就跳过。
 * 那样「说明性提及某 API」会通过，但「说明 + 真实调用同一行」也会通过。
 * 现在的规则：注释行只有在**不含任何调用形式**（即函数名紧跟左括号）时才豁免。
 * 详见下方 CALL_SHAPED 与 scanLine()。
 */
const ALLOWLIST_LINE = [
  /^\s*(\*|\/\/|\/\*).*(不写|不发起|没有|禁止|不做|不可)/,
];

/** 把一行里"注释标记 + 其后的纯说明文字"剥掉，只留下可能是代码的部分 */
function stripLeadingComment(line) {
  // 行首是 // 或 * 或 /* 时，把整段注释当说明文字处理
  return line.replace(/^\s*(\/\/|\*|\/\*)\s?/, '');
}
function stripSafeFragments(line) {
  let out = line;
  for (const re of SAFE_FRAGMENTS) {
    re.lastIndex = 0;
    out = out.replace(re, (m) => ' '.repeat(m.length));
  }
  return out;
}

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      yield* walk(full);
    } else if (TEXT_EXT.has(extname(entry.name).toLowerCase())) {
      yield full;
    }
  }
}

function isAllowlisted(line) {
  return ALLOWLIST_LINE.some((re) => re.test(line));
}

/**
 * 判定一行的"可扫描内容"：
 *  - 普通行：原样（只剔除已知安全字面量，如 favicon 的 data: URI）
 *  - 注释行：**仍然扫描**，但先剥掉注释标记 ——
 *    这样"我不写 fetch"这种纯说明不会命中（因为剥掉 `//` 后仍有 `fetch`……见下）
 *
 * 实际策略（保守优先）：
 * 注释行**不豁免**。宁可误报让维护者加豁免，也不要放过藏在注释里的真实调用。
 * 之所以还留 ALLOWLIST_LINE，是因为源码里有大量形如
 *    *  - 不做持久化：不写 localStorage / sessionStorage / IndexedDB / Cookie。
 * 的说明性注释，它们会让审计永远红。对这些行，我们要求：
 *   1) 整行确实是注释；
 *   2) 该行**不含**任何「调用形式」的危险字面量（即函数名紧跟左括号）。
 * 满足这两条才豁免。
 */
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

function scanLine(line) {
  if (isAllowlisted(line)) {
    // 注释豁免：只有在"不含任何调用形式的危险字面量"时才真正放行
    const looksLikeRealCall = CALL_SHAPED.some((re) => {
      re.lastIndex = 0;
      return re.test(line);
    });
    if (!looksLikeRealCall) return null; // 纯说明，放行
    // 含真实调用 → 继续往下走，让它被抓到
  }
  return stripSafeFragments(line);
}

async function main() {
  const violations = [];
  let scanned = 0;
  let bytes = 0;

  for (const dir of SCAN_DIRS) {
    for await (const file of walk(join(ROOT, dir))) {
      scanned += 1;
      const text = await readFile(file, 'utf8');
      bytes += Buffer.byteLength(text, 'utf8');
      const lines = text.split(/\r?\n/);
      lines.forEach((line, i) => {
        const scannedLine = scanLine(line);
        if (scannedLine === null) return; // 已确认为纯说明注释
        for (const { re, label } of FORBIDDEN) {
          re.lastIndex = 0;
          if (re.test(scannedLine)) {
            violations.push({ file: relative(ROOT, file), line: i + 1, label, snippet: line.trim().slice(0, 120) });
          }
        }
        for (const { re, label } of SECRETS) {
          re.lastIndex = 0;
          if (re.test(scannedLine)) {
            violations.push({ file: relative(ROOT, file), line: i + 1, label, snippet: '[已隐藏]' });
          }
        }
      });
    }
  }

  console.log(`扫描了 ${scanned} 个文件，共 ${bytes} 字节。`);

  if (violations.length === 0) {
    console.log('PASS：未发现网络请求、持久化 API 或密钥模式。');
    process.exit(0);
  }

  console.error(`FAIL：发现 ${violations.length} 处可疑内容：`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.label}]  ${v.snippet}`);
  }
  process.exit(1);
}

main().catch((error) => {
  console.error('审计脚本自身出错：', error);
  process.exit(2);
});
