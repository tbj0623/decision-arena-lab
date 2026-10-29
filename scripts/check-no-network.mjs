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

/**
 * 禁止出现的运行时 API / 关键字
 *
 * 历史缺陷（red-team V8 发现，已修）：
 * 早期规则只认「明文标识符 + 明文 URL」，于是 6 类变形写法可以完全绕过，
 * 让 CI 显示绿色而实际能外发数据：
 *
 *   B1  window["fetch"](...)          —— 方括号调用，不匹配 \bfetch\s*\(
 *   B2  window[\u0066etch](...)       —— Unicode 转义标识符
 *   B3  eval(atob("ZmV0Y2go..."))     —— 整段代码 base64 编码，无任何明文
 *   B4  String.fromCharCode(102,101,116,99,104)  —— 拼接函数名
 *   B5  url(\68 ttps://...)           —— CSS 八进制转义 URL
 *   B6  onerror="this.src=atob(...)"  —— 无明文 URL，靠 base64 还原
 *
 * 修法不是「再加几条正则」——那样永远追不上变体。这里改成**两层防御**：
 *   第一层：识别「危险的代码能力」本身，而不只是具体函数名
 *           （eval / Function / atob / fromCharCode / 方括号访问全局对象 /
 *             任何形式的外部 URL 字面量，包括被转义的）
 *   第二层：新增「动态执行能力」作为独立的阻断规则
 *           （只要出现 eval 或 new Function，就要求人工复核，不看它参数是什么）
 *
 * 原则：**宁可误报，不可漏报**。这个项目没有正常理由用 eval/atob/fromCharCode。
 */
const FORBIDDEN = [
  // ── 网络请求能力 ──
  { re: /\bfetch\s*\(/, label: 'fetch() 网络请求' },
  // 方括号调用的 fetch：window["fetch"](...) / globalThis['fetch'](...)
  // 注意：字符串内容可能是拼接或转义，所以只要求出现 "fetch" 字样的方括号访问
  { re: /\[\s*['"`](?:fe)?tch['"`]\s*\]/i, label: '方括号调用 fetch' },
  { re: /\[\s*['"`]fetch['"`]\s*\]/i, label: '方括号调用 fetch' },
  { re: /new\s+XMLHttpRequest\b/, label: 'XMLHttpRequest' },
  { re: /new\s+WebSocket\b/, label: 'WebSocket' },
  { re: /navigator\.sendBeacon\b/, label: 'sendBeacon 遥测' },
  { re: /new\s+EventSource\b/, label: 'EventSource' },
  { re: /new\s+Worker\s*\(/, label: 'Worker（可加载远程脚本）' },
  { re: /\bimport\s*\(\s*['"]https?:/i, label: '动态导入远程模块' },
  { re: /\bimportScripts\s*\(/, label: 'importScripts' },

  // ── 持久化能力 ──
  { re: /\blocalStorage\b/, label: 'localStorage 持久化' },
  { re: /\bsessionStorage\b/, label: 'sessionStorage 持久化' },
  { re: /\bindexedDB\b/i, label: 'IndexedDB 持久化' },
  { re: /document\.cookie\b/, label: 'cookie 写入' },

  // ── 动态代码执行能力（B3/B4/B6 的根因）──
  // 这些能力本身就该被质疑：静态站点没有任何正当理由在运行时求值字符串。
  { re: /\beval\s*\(/, label: 'eval() 动态执行' },
  { re: /\bnew\s+Function\s*\(/, label: 'new Function 动态执行' },
  { re: /\batob\s*\(/, label: 'atob() 解码（常被用于藏 URL/代码）' },
  { re: /\bbtoa\s*\(/, label: 'btoa() 编码（常被用于藏 URL/代码）' },
  { re: /String\.fromCharCode\s*\(/, label: 'fromCharCode 拼接（常被用于藏函数名）' },
  { re: /\bdocument\.write\s*\(/, label: 'document.write 注入' },

  // ── 外部 URL（含被转义的写法）──
  { re: /https?:\/\/(?!127\.0\.0\.1|localhost)[a-z0-9.-]+\//i, label: '外部 URL 引用' },
  // B5：CSS 八进制/十六进制转义后仍形如 URL。
  // 关键细节：CSS 八进制转义是 `\68 ` —— 反斜杠 + 八进制数 + **一个空格分隔符**，
  // 空格之后才是 `ttps://`。所以中间必须允许 \s*，否则 `url(\68 ttps://...)` 抓不到。
  { re: /\\[0-9a-f]{1,6}\s*ttps?\s*:\s*\/\//i, label: '转义混淆的 URL（八进制/十六进制）' },
  // 更宽的兜底：任何 css url() 内出现反斜杠转义，都要求人工复核
  { re: /url\(\s*[^)]*\\[0-9a-f]{1,6}/i, label: 'url() 中包含转义序列（可能用于隐藏 URL）' },
  // Unicode 转义形式的协议前缀：\u0068ttps:// / \x68ttps://
  { re: /(?:\\u0068|\\x68)\s*ttps?:\/\//i, label: 'Unicode 转义 URL' },
  // 协议相对 URL：//evil.example 或 //evil.example/x
  //
  // 历史缺陷（QA W02-05 发现的"第 9 类绕过"，已修）：
  // 原来的规则在域名后强制要求一个 `/`，于是 `<img src="//evil.example">` 这种
  // **没有尾斜杠**的写法完整漏过。但它在浏览器里完全合法、会真的发请求——
  // QA 起服务器实测过：页面里放一个 `<img src="//127.0.0.1:8123/?leak=pixel">`，
  // 浏览器确实发出了跨源请求。指向真实域名就是一次完整的像素追踪外发。
  //
  // 修法：结尾的 `/` 改成"域名后可以跟 / : ? # 空白 引号 > 或直接结束"。
  // 用 lookahead 而不是消费字符，避免把后续内容吃掉影响其它规则匹配。
  {
    re: /(?<![:/\\])\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+(?=[/:?#\s"'`>]|$)/i,
    label: '协议相对外部 URL',
  },
  // JS 字符串/属性里的转义协议前缀：'h\74 tps://' 等
  { re: /['"`]?[^'"`\s]{0,6}\\[0-9a-f]{1,6}\s*[^'"`\s]{0,4}ttps?\s*:\s*\/\//i, label: '字符串中转义混淆的 URL' },

  // ── 其它真实的出网/泄漏通道（QA W02-05 补充）──
  // WebRTC 的 STUN 可以拿到用户真实内网 IP，且完全不需要 fetch。
  { re: /\bRTCPeerConnection\b/, label: 'WebRTC（STUN 可泄漏真实内网 IP）' },
  // Service Worker 本身同源，但注册后能拦截并改写所有请求。
  // 单独用不算外发，但它常与其它外发代码配合，且静态站点没有正当理由用。
  { re: /\bserviceWorker\s*\.\s*register\b/, label: 'Service Worker 注册（可拦截全部请求）' },
  // dns-prefetch / preconnect：只泄漏"用户访问过本站"，不发数据，但仍是外部主机引用
  { re: /\b(?:dns-prefetch|preconnect)\b/i, label: 'DNS 预取/预连接（引用外部主机）' },
];

/**
 * 单独一类：把「全局对象的方括号访问 + 字符串字面量」当作可疑。
 * 因为 `window["fetch"]`、`globalThis["XMLHttpRequest"]` 这类写法在静态站点里没有正当用途。
 * 这条规则不依赖具体是哪个 API 名，所以更难绕过。
 */
const SUSPICIOUS_DYNAMIC_ACCESS = [
  {
    re: /(?:window|globalThis|self|top|parent|frames)\s*\[\s*['"`]/,
    label: '全局对象的方括号访问（常用于绕过静态检测）',
  },
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
/**
 * 安全片段：从一行里剔除的"看着像违规、实际不是"的片段。
 *
 * 导出它是有意的：tests/qa/audit-script.test.mjs 需要和真实审计用**同一份规则**。
 * 早先那个测试自己复制了一份，结果我在这里加了 OG 元数据豁免后，
 * 测试仍在用旧副本、断言"真实仓库无违规"直接 fail —— 两份规则漂移了。
 * 现在测试从本文件 import，规则只有一处定义。
 */
export const SAFE_FRAGMENTS = [
  // HTML 内联 data: URI 的 favicon（同源，不外发）——只剔除这个标签本身
  /<link\s+rel="icon"\s+href="data:[^"]*">/gi,
  // 审计脚本自身的规则定义行（形如 { re: /.../, label: '...' }）
  /\{\s*re:\s*\/.*?\/[a-z]*,\s*label:\s*'[^']*'\s*\},?/g,
  // XML 命名空间标识符：xmlns="http://www.w3.org/2000/svg" 这类
  //
  // 历史缺陷（red-team W06-02 发现，已修）：w3.org 的命名空间 URI 是**标识符**，
  // 不是要下载的资源，浏览器永远不请求它。但它在字面上完全符合"外部 URL"，
  // 于是加一个内联 SVG 图标就会让审计 FAIL。
  //
  // 这类误报比漏报更危险：它逼着维护者去加"整行豁免"，
  // 而整行豁免正是 V8 那个绕过 bug 的成因。
  // 这里只剔除**命名空间属性本身**，不是整行——同一行里其它位置照样扫。
  /\bxmlns(?::[\w-]+)?\s*=\s*["']https?:\/\/www\.w3\.org\/[^"']*["']/gi,
  // DOCTYPE 里的 W3C 公共标识符（HTML4/XHTML 老式 doctype）
  /<!DOCTYPE[^>]*w3\.org[^>]*>/gi,

  // Open Graph / Twitter Card 的 content 属性
  //
  // 这类 URL 是**给社交平台抓取器看的元数据**，不是页面运行时会发出的请求。
  //   <meta property="og:image" content="https://example.com/card.png">
  // 浏览器不会因为这个标签去下载那张图；只有分享到社交平台时，
  // 平台服务器才会去抓。所以它不违反"零外部请求"的承诺。
  //
  // 历史缺陷（qa-engineer V9-03 发现）：不加这条豁免，任何规范的 OG 元数据
  // 都会让审计 FAIL——而 OG 元数据本身是 V9 的硬要求。
  // 同样的原则：只豁免**这一个属性本身**，不是整行。
  /<meta\s+(?:property|name)\s*=\s*["'](?:og|twitter):[^"']*["']\s+content\s*=\s*["'][^"']*["']\s*\/?>/gi,
  // 属性顺序相反的写法（content 在前）
  /<meta\s+content\s*=\s*["'][^"']*["']\s+(?:property|name)\s*=\s*["'](?:og|twitter):[^"']*["']\s*\/?>/gi,
  // rel="canonical" 也是元数据，同理
  /<link\s+rel\s*=\s*["']canonical["']\s+href\s*=\s*["'][^"']*["']\s*\/?>/gi,
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

  // 审计脚本自身要排除「网络规则」的扫描，但**仍然扫描密钥**。
  //
  // 为什么：这个文件的注释里必须写下各种攻击 payload 的样子（否则后人不知道规则在防什么），
  // 比如 `window["fetch"](...)`、`eval(atob("..."))`。这些是**说明文字**，不是可执行调用。
  // 如果不排除，脚本会自己抓自己，永远 FAIL，于是维护者只能删掉注释——
  // 那正好把「这条规则为什么存在」的知识一起删掉了，下次有人就会把它改回去。
  //
  // 边界：只对这一个文件跳过网络规则；它对用户不可见（不参与部署，只跑在本地/CI）。
  // 密钥规则依然生效，防止有人在脚本里硬编码 token。
  const SELF_PATH = relative(ROOT, fileURLToPath(import.meta.url));

  for (const dir of SCAN_DIRS) {
    for await (const file of walk(join(ROOT, dir))) {
      scanned += 1;
      const text = await readFile(file, 'utf8');
      bytes += Buffer.byteLength(text, 'utf8');
      const rel = relative(ROOT, file);
      const isSelf = rel === SELF_PATH;
      const lines = text.split(/\r?\n/);
      lines.forEach((line, i) => {
        const scannedLine = scanLine(line);
        if (scannedLine === null) return; // 已确认为纯说明注释
        if (!isSelf) {
          for (const { re, label } of FORBIDDEN) {
            re.lastIndex = 0;
            if (re.test(scannedLine)) {
              violations.push({ file: rel, line: i + 1, label, snippet: line.trim().slice(0, 120) });
            }
          }
          // 动态访问类：不依赖具体 API 名，专门对付 window["fetch"] / globalThis["..."] 这类绕法
          for (const { re, label } of SUSPICIOUS_DYNAMIC_ACCESS) {
            re.lastIndex = 0;
            if (re.test(scannedLine)) {
              violations.push({ file: rel, line: i + 1, label, snippet: line.trim().slice(0, 120) });
            }
          }
        }
        for (const { re, label } of SECRETS) {
          re.lastIndex = 0;
          if (re.test(scannedLine)) {
            violations.push({ file: rel, line: i + 1, label, snippet: '[已隐藏]' });
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
