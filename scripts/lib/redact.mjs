/**
 * 凭据脱敏与识别：把"看起来像密钥/带凭据 URL"的片段替换掉，并能判断一段文本里
 * 是否还残留未打码的密钥。
 *
 * 为什么单独成文件：
 * V10 P0-1 要求"验证失败路径不泄漏敏感信息"。把脱敏逻辑抽成纯函数后，
 * 可以用单元测试逐条打它（见 tests/qa/push-credential-safety.test.mjs），
 * 而不是只能靠"肉眼看一眼输出"。
 *
 * 为什么"替换规则"和"识别规则"是两份而不是一份：
 * 踩过的坑 —— 一开始让识别规则复用替换规则，结果替换产物 `https://***@host/x`
 * 又命中"URL 里带 userinfo"这条规则，`scrubSecrets()` 之后再 `containsSecretShape()`
 * 返回 true，自检永远失败。替换是"宁可多打码"，识别是"必须只看真秘密"，
 * 两者的判据本来就不同，强行合并只会两败俱伤。
 *
 * 纯字符串函数：不读环境变量、不读文件、不发网络请求。
 */

/**
 * 替换规则：[正则, 替换值]。顺序有讲究 —— 先处理"带密码的 URL"整体形态，
 * 再处理只带用户名的形态，最后处理裸 token。
 */
const REDACT_RULES = [
  // scheme://user:secret@host —— 两段 userinfo 一起打掉
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]*@/gi, '$1***:***@'],
  // scheme://something@host —— token 常被当成用户名单独出现
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@'],
  // git 的 x-access-token 形态（替换产物本身要保证不再命中识别规则）
  [/x-access-token:[^\s@]*@/gi, 'x-access-token:***@'],
  // GitHub 各种 token 前缀
  [/\bgh[pousr]_[A-Za-z0-9_]{8,}/g, 'gh?_***'],
  [/\bgithub_pat_[A-Za-z0-9_]{8,}/g, 'github_pat_***'],
  // 其他常见密钥前缀（本项目不该出现，出现了也必须打掉）
  [/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-***'],
  [/\bAKIA[0-9A-Z]{8,}\b/g, 'AKIA***'],
  // URL 查询串里的 token 参数
  [/([?&](?:token|access_token|auth|key|secret)=)[^&\s#]+/gi, '$1***'],
  // Authorization 头
  [/(authorization\s*:\s*)[^\r\n]+/gi, '$1***'],
  // 私钥块：保留首尾标记，中间打掉
  [/(-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----)[\s\S]*?(-----END (?:[A-Z]+ )?PRIVATE KEY-----)/g, '$1***$2'],
];

/**
 * 识别规则：只匹配**未打码的真秘密**。故意比替换规则窄 ——
 * 已打码的形态（`***`、`x-access-token:***`、`gh?_***`）必须全部放行，
 * 否则自检 `containsSecretShape(scrubSecrets(x)) === false` 就不成立。
 */
const SECRET_PATTERNS = [
  // 带密码的 URL（已打码时 userinfo 以 *** 开头，被排除）
  [/(\b[a-z][a-z0-9+.-]*:\/\/)(?!\*\*\*)[^\s/@]+:[^\s/@]+@/i, '带凭据的 URL'],
  // x-access-token 后面跟了真实内容
  [/\bx-access-token:(?!\*\*\*)[^\s@]+/i, 'git x-access-token 凭据'],
  // 各平台 token 前缀
  [/\bgh[pousr]_[A-Za-z0-9_]{8,}/, 'GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{8,}/, 'GitHub fine-grained token'],
  [/\bsk-[A-Za-z0-9_-]{8,}/, 'OpenAI 风格密钥'],
  [/\bAKIA[0-9A-Z]{8,}\b/, 'AWS Access Key'],
  // 查询串里的 token 参数（已打码为 *** 时放行）
  [/[?&](?:token|access_token|auth|key|secret)=(?!\*\*\*)[^&\s#]+/i, 'URL 查询串里的凭据'],
  // Authorization 头（已打码为 *** 时放行；注意 lookahead 里要自己吃掉空白，
  // 否则 `\s*` 会回溯成零个空格，让 ` ***` 又被判成明文）
  [/authorization\s*:\s*(?!\s*\*\*\*)[^\r\n]+/i, 'Authorization 头'],
  // 私钥
  [/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/, '私钥'],
];

/**
 * 判断一段文本里是否残留"未打码的凭据"。
 * @param {string} text
 * @returns {boolean}
 */
export function containsSecretShape(text) {
  const s = String(text ?? '');
  return SECRET_PATTERNS.some(([re]) => {
    re.lastIndex = 0;
    return re.test(s);
  });
}

/**
 * 找出文本里命中的凭据类别（用于日志/报告，不含具体值）。
 * @param {string} text
 * @returns {string[]}
 */
export function describeSecretShapes(text) {
  const s = String(text ?? '');
  const hits = [];
  for (const [re, label] of SECRET_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(s) && !hits.includes(label)) hits.push(label);
  }
  return hits;
}

/**
 * 把疑似凭据的片段换成固定标记。
 * @param {string} text
 * @returns {string}
 */
export function scrubSecrets(text) {
  let out = String(text ?? '');
  for (const [re, replacement] of REDACT_RULES) {
    re.lastIndex = 0;
    out = out.replace(re, replacement);
  }
  return out;
}

/**
 * 判断一个 git remote URL 里是否内嵌了凭据（userinfo 段）。
 *
 * 为什么需要它：P0-1 的判定标准是"源码/本机配置/进程参数无 Token URL"。
 * remote 配置里如果已经躺着一个带 token 的 URL，那么每一次 `git push`
 * 都会把 token 交给子进程，光改脚本没用。
 *
 * 注意：ssh 形态的 `git@host:owner/repo` 里那个 `git` 是固定用户名，不是凭据。
 *
 * @param {string} url
 * @returns {boolean} true 表示 URL 里带 userinfo（应当拒绝推送并提示修 remote）
 */
export function hasCredentialInUrl(url) {
  const s = String(url ?? '').trim();
  if (!s) return false;
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(s);
  if (!m) return false;
  const authority = m[1];
  if (!authority.includes('@')) return false;
  const userinfo = authority.slice(0, authority.lastIndexOf('@'));
  // ssh 的 git@host 不算凭据
  if (userinfo === 'git') return false;
  return true;
}

/**
 * 从带凭据的 URL 里还原出"干净 URL"，用于给出修复建议（不含任何秘密）。
 * @param {string} url
 * @returns {string}
 */
export function stripCredentialFromUrl(url) {
  const s = String(url ?? '').trim();
  const m = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)([\s\S]*)$/i.exec(s);
  if (!m) return scrubSecrets(s);
  const authority = m[2];
  const at = authority.lastIndexOf('@');
  const clean = at >= 0 ? authority.slice(at + 1) : authority;
  return scrubSecrets(`${m[1]}${clean}${m[3]}`);
}
