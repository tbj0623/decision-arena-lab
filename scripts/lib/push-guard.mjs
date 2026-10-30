/**
 * 推送安全判定：全是纯函数，不读磁盘、不读环境、不发网络。
 *
 * 为什么抽出来：V10 P0-1 明确要求失败路径测试覆盖
 * 「未授权、网络超时、403/401、非快进冲突、dry-run、目标仓库不匹配、远端 SHA 不相等」。
 * 这些场景不能每个都在测试里真的制造一次（会依赖网络、会污染远端），
 * 所以把"读 git 的错误输出做分类"这一步做成纯函数，用真实 git 报错样本逐条打。
 */

/** 受保护分支：默认不允许直接推（发布走 PR 合并 / fast-forward）。 */
const PROTECTED_BRANCHES = ['main', 'master'];

/**
 * 分支名合法性。
 *
 * 目的有两个：
 * 1. 挡住以 `-` 开头的名字 —— 否则会变成 git 的选项（参数注入）。
 * 2. 挡住 git 本身不接受的分支名（空格、`..`、`~^:?*[`、结尾 `.` 或 `.lock`）。
 *
 * @param {string} branch
 * @returns {{ok: true, branch: string} | {ok: false, reason: string}}
 */
export function assertBranchSafe(branch) {
  const b = String(branch ?? '').trim();
  if (!b) return { ok: false, reason: '分支名为空' };
  if (b.startsWith('-')) return { ok: false, reason: '分支名不能以 - 开头（会被 git 当成选项）' };
  if (/\s/.test(b)) return { ok: false, reason: '分支名不能含空白字符' };
  if (/[~^:?*[\\]/.test(b)) return { ok: false, reason: '分支名含 git 禁止字符（~ ^ : ? * [ \\）' };
  if (b.includes('..')) return { ok: false, reason: '分支名不能含连续两个点' };
  if (b.startsWith('/') || b.endsWith('/') || b.endsWith('.')) return { ok: false, reason: '分支名不能以 / 或 . 开头结尾' };
  if (b.endsWith('.lock')) return { ok: false, reason: '分支名不能以 .lock 结尾' };
  if (!/^[A-Za-z0-9._/-]+$/.test(b)) return { ok: false, reason: '分支名只能含字母、数字、. _ / -' };
  return { ok: true, branch: b };
}

/**
 * 是否是受保护分支（默认不推）。
 * @param {string} branch
 * @returns {boolean}
 */
export function isProtectedBranch(branch) {
  return PROTECTED_BRANCHES.includes(String(branch ?? '').trim());
}

/**
 * 解析 git remote URL，取出 host / owner / repo。
 *
 * 支持两种形态：
 * - https 形态：scheme://host/owner/repo(.git)
 * - ssh 形态：git@host:owner/repo(.git)
 *
 * 带凭据的 URL 一律拒绝 —— 调用方应当先提示修 remote，而不是"带着 token 推"。
 *
 * @param {string} url
 * @returns {{ok: true, host: string, owner: string, repo: string, slug: string} | {ok: false, reason: string}}
 */
export function parseRemoteUrl(url) {
  const raw = String(url ?? '').trim();
  if (!raw) return { ok: false, reason: 'remote URL 为空' };

  // 先拦凭据
  const schemeMatch = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(raw);
  const userinfo = schemeMatch ? schemeMatch[1] : '';
  if (userinfo.includes('@')) {
    const beforeAt = userinfo.slice(0, userinfo.lastIndexOf('@'));
    // ssh 形态的 git@host 不是凭据，是固定用户名
    if (!(beforeAt === 'git' && /^git@[^/]+:.+/.test(raw))) {
      return { ok: false, reason: 'remote URL 内嵌了凭据（userinfo），必须先改为无凭据 URL' };
    }
  }

  let host = '';
  let path = '';
  const https = /^[a-z][a-z0-9+.-]*:\/\/(?:git@)?([^/?#]+)\/([^?#]+?)(?:\.git)?\/?$/i.exec(raw);
  if (https) {
    host = https[1];
    path = https[2];
  } else {
    const ssh = /^(?:[A-Za-z0-9._-]+)@([^:]+):([^?#]+?)(?:\.git)?\/?$/.exec(raw);
    if (ssh) {
      host = ssh[1];
      path = ssh[2];
    }
  }

  if (!host || !path) return { ok: false, reason: 'remote URL 不是可识别的仓库地址' };
  if (host.includes('@') || path.includes('@')) return { ok: false, reason: 'remote URL 内嵌了凭据（userinfo），必须先改为无凭据 URL' };

  const parts = path.replace(/^\/+/, '').split('/').filter(Boolean);
  if (parts.length !== 2) return { ok: false, reason: 'remote URL 路径不是 owner/repo 两段' };
  const [owner, repo] = parts;
  if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) {
    return { ok: false, reason: 'owner 或 repo 名含非法字符' };
  }
  return { ok: true, host: host.toLowerCase(), owner, repo, slug: `${owner}/${repo}` };
}

/**
 * 把 `git push` 的 (exitCode, stdout+stderr) 归类。
 *
 * 分类决定"要不要重试"：
 * - network        → 幂等安全，可退避重试
 * - auth           → 认证失败，重试无用，要求重新 gh auth login
 * - non-fast-forward / rejected → 需要先 fetch 合并，重试无用
 * - repo           → 目标仓库不对/无权限，重试无用且危险
 * - unknown        → 不重试，原样报错，交给人看
 *
 * 这个函数是 P0-1 失败路径测试的主要目标。
 *
 * @param {{status: number|null, output: string}} result
 * @returns {'ok'|'network'|'auth'|'non-fast-forward'|'repo'|'unknown'}
 */
export function classifyPushFailure(result) {
  const status = result?.status;
  const out = String(result?.output ?? '');
  if (status === 0) return 'ok';

  // 顺序很重要：先判不可重试的确定性失败，再判网络类。
  // 否则一个"认证失败 + 网络抖动"的混合输出会被误判成可重试，白白推五次。
  const AUTH = [
    /Authentication failed/i,
    /Invalid username or password/i,
    /could not read Username/i,
    /Permission to .+ denied/i,
    /\b403\b/,
    /\b401\b/,
    /Bad credentials/i,
    /Support for password authentication was removed/i,
    /terminal prompts disabled/i,
  ];
  if (AUTH.some((re) => re.test(out))) return 'auth';

  const REPO = [
    /Repository not found/i,
    /does not appear to be a git repository/i,
    /remote: Repository not found/i,
    /is not a valid repository/i,
    /not found\./i,
  ];
  if (REPO.some((re) => re.test(out))) return 'repo';

  const NON_FF = [
    /non-fast-forward/i,
    /\[rejected\]/i,
    /\bfetch first\b/i,
    /Updates were rejected/i,
    /\bstale info\b/i,
    /cannot lock ref/i,
  ];
  if (NON_FF.some((re) => re.test(out))) return 'non-fast-forward';

  const NETWORK = [
    /Could not resolve host/i,
    /Couldn't resolve host/i,
    /Temporary failure in name resolution/i,
    /Connection (was )?reset/i,
    /Connection reset by peer/i,
    /timed out/i,
    /Failed to connect/i,
    /\bTLS\b/i,
    /\bSSL\b/i,
    /\bECONNRESET\b/,
    /network is unreachable/i,
    /\bRPC failed\b/i,
    /early EOF/i,
    /The remote end hung up/i,
    /unable to access/i,
    /\b503\b/,
    /\b502\b/,
    /\b500\b/,
  ];
  if (NETWORK.some((re) => re.test(out))) return 'network';

  return 'unknown';
}

/** 哪些分类值得重试。 */
export function isRetriable(kind) {
  return kind === 'network';
}

/** 分类对应的中文建议（不含任何敏感信息）。 */
export function adviceFor(kind) {
  switch (kind) {
    case 'auth':
      return '认证失败：先 `gh auth login`（或 `gh auth status` 看当前身份），不要怀疑网络。';
    case 'repo':
      return '目标仓库不对或没有推送权限：核对 origin 的 owner/repo 是否就是本仓库。';
    case 'non-fast-forward':
      return '远端有本地没有的提交（非快进）：先 `git fetch` 并合并，禁止 force push。';
    case 'network':
      return '网络问题：已按退避重试仍失败。本机网络是间歇性的，稍后再试。';
    default:
      return '未知失败：不自动重试，请按上面的原始输出人工判断。';
  }
}
