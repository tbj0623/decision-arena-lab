/**
 * 标准推送（V10 P0-1 加固版）
 *
 * ── 这个脚本解决什么问题 ──
 * 旧版做法是：用 `gh` 取到明文令牌，拼成带 userinfo 的远程地址，
 * 再作为 `git push` 的参数传进去。
 * 虽然 stdout 做了打码，但令牌会出现在：
 *   · 子进程的 argv（同机其他进程可读）
 *   · 一旦 git 把它写进错误信息/诊断日志，就跟着出去
 *   · 任何一次被 `ps`/任务管理器/崩溃报告抓到的快照
 * 这在 V10 里是 P0 缺陷。
 *
 * ── 现在的做法 ──
 * 完全不碰 token：
 *   1. 复用系统里已经配好的 credential helper（本机是 `gh auth git-credential`），
 *      让 git 自己去向 helper 要凭据 —— 走的是标准输入/管道，不进 argv。
 *   2. 脚本只提供"推送策略与防护"：分支白名单、受保护分支默认拒绝、
 *      远端 URL 无凭据校验、失败分类、仅网络错误重试、推完核对远端 SHA。
 *   3. 所有输出统一过 `scrubSecrets()`；打印前自检不含凭据形状。
 *
 * ── 用法 ──
 *   node scripts/push.mjs --check                 # 只做本地预检，不联网、不推送
 *   node scripts/push.mjs --dry-run               # 真的连远端，但只演练不写入
 *   node scripts/push.mjs                         # 推当前分支到同名远端分支
 *   node scripts/push.mjs --branch fix/x          # 显式指定目标分支
 *   node scripts/push.mjs --allow-main            # 允许推 main（发布时用，需显式给）
 *   node scripts/push.mjs --expect tbj0623/decision-arena-lab
 *
 * ── 退出码 ──
 *   0 成功   2 用法/配置不匹配   3 缺 credential helper
 *   4 网络重试耗尽   5 非快进被拒   6 认证失败   7 远端 SHA 核对不一致
 *
 * ── 红线 ──
 * 不调用 `gh auth token`；不构造带凭据 URL；不使用 --force / --force-with-lease；
 * 不打印、不落盘任何凭据。远端 URL 里如果已经内嵌凭据，直接拒绝并要求先修 remote。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { scrubSecrets, containsSecretShape, hasCredentialInUrl, stripCredentialFromUrl } from './lib/redact.mjs';
import {
  assertBranchSafe,
  isProtectedBranch,
  parseRemoteUrl,
  classifyPushFailure,
  isRetriable,
  adviceFor,
} from './lib/push-guard.mjs';

const EXIT = {
  OK: 0,
  USAGE: 2,
  NO_HELPER: 3,
  NETWORK: 4,
  NON_FF: 5,
  AUTH: 6,
  REMOTE_MISMATCH: 7,
};

const MAX_TRIES = 4;
const PUSH_TIMEOUT_MS = 180_000;
const VERIFY_TRIES = 4;
const VERIFY_WAIT_MS = 2_000;

/** 所有对外输出都走这里：先脱敏，再自检，再打印。 */
function say(line = '') {
  const clean = scrubSecrets(String(line));
  if (containsSecretShape(clean)) {
    // 理论上不该发生；发生了说明脱敏规则漏了一条，此时宁可不打印。
    process.stdout.write('[输出已拦截：检测到疑似凭据形状]\n');
    return;
  }
  process.stdout.write(`${clean}\n`);
}

function fail(code, message) {
  say(`\n✗ ${message}`);
  process.exit(code);
}

/** 在本地跑一条命令并拿到输出；失败不抛，返回 status/output。 */
function run(cmd, argv, opts = {}) {
  try {
    const out = execFileSync(cmd, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: opts.timeout ?? 30_000 });
    return { status: 0, output: out };
  } catch (e) {
    const output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    return { status: typeof e.status === 'number' ? e.status : 1, output };
  }
}

/** 休眠（同步，避免引入 Promise 打乱退出码） */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function parseArgs(argv) {
  const opts = { dryRun: false, check: false, allowMain: false, branch: '', expect: '', help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--check' || a === '--preflight') opts.check = true;
    else if (a === '--allow-main') opts.allowMain = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--branch') opts.branch = argv[++i] ?? '';
    else if (a === '--expect') opts.expect = argv[++i] ?? '';
    else return { error: `未知参数：${a}` };
  }
  return opts;
}

const USAGE = `标准推送（不会把凭据放进命令行）

用法：
  node scripts/push.mjs --check            只做本地预检（不联网、不推送）
  node scripts/push.mjs --dry-run          连远端演练一次，不写入
  node scripts/push.mjs                    推当前分支到同名远端分支
  node scripts/push.mjs --branch <name>    推 HEAD 到指定远端分支
  node scripts/push.mjs --allow-main       允许推受保护分支（发布时显式给）
  node scripts/push.mjs --expect <owner/repo>  断言 origin 就是它

退出码：0 成功 / 2 用法或配置不匹配 / 3 缺 credential helper /
        4 网络重试耗尽 / 5 非快进被拒 / 6 认证失败 / 7 远端 SHA 不一致`;

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.error) {
    say(USAGE);
    fail(EXIT.USAGE, opts.error);
  }
  if (opts.help) {
    say(USAGE);
    process.exit(EXIT.OK);
  }

  // ── 1. 必须在 git 仓库里 ──
  const inRepo = run('git', ['rev-parse', '--git-dir']);
  if (inRepo.status !== 0) fail(EXIT.USAGE, '当前目录不是 git 仓库');

  const head = run('git', ['rev-parse', 'HEAD']);
  if (head.status !== 0) fail(EXIT.USAGE, '仓库里还没有任何提交');
  const headSha = head.output.trim();
  const tree = run('git', ['rev-parse', 'HEAD^{tree}']);
  const treeSha = tree.output.trim();

  // ── 2. 确定要推的分支 ──
  let branch = opts.branch;
  if (!branch) {
    const cur = run('git', ['symbolic-ref', '--short', 'HEAD']);
    if (cur.status !== 0) fail(EXIT.USAGE, '当前是游离 HEAD，请用 --branch 指定目标分支');
    branch = cur.output.trim();
  }
  const safe = assertBranchSafe(branch);
  if (!safe.ok) fail(EXIT.USAGE, `分支名不可用：${safe.reason}`);
  branch = safe.branch;

  if (isProtectedBranch(branch) && !opts.allowMain) {
    if (!opts.dryRun) {
      fail(EXIT.USAGE, `拒绝直接推受保护分支 ${branch}（V10 规定发布走 PR 合并 / 快进）。确需发布时显式加 --allow-main。`);
    }
    say(`⚠ 目标分支是受保护分支 ${branch}；当前是 --dry-run，只演练不写入。`);
  }

  // ── 3. 校验 origin：必须存在、无内嵌凭据、owner/repo 可解析 ──
  const remoteUrlRes = run('git', ['remote', 'get-url', '--push', 'origin']);
  if (remoteUrlRes.status !== 0) fail(EXIT.USAGE, '找不到 origin remote');
  const remoteUrlRaw = remoteUrlRes.output.trim();

  if (hasCredentialInUrl(remoteUrlRaw)) {
    const cleanUrl = stripCredentialFromUrl(remoteUrlRaw);
    say(`✗ origin 的 URL 里内嵌了凭据。`);
    say(`  为安全起见拒绝推送。请先执行：`);
    say(`    git remote set-url origin ${cleanUrl}`);
    say(`  （该命令会在终端回显去掉凭据后的地址，可直接用）`);
    fail(EXIT.USAGE, 'origin URL 含凭据，未推送。');
  }

  const parsed = parseRemoteUrl(remoteUrlRaw);
  if (!parsed.ok) fail(EXIT.USAGE, `无法解析 origin：${parsed.reason}`);

  if (opts.expect) {
    const want = opts.expect.trim().replace(/\.git$/, '');
    if (want.toLowerCase() !== parsed.slug.toLowerCase()) {
      fail(EXIT.USAGE, `目标仓库不匹配：origin 是 ${parsed.slug}，但 --expect 要求 ${want}`);
    }
  }

  // ── 4. credential helper：只检查，不擅自改配置 ──
  const helperRes = run('git', ['config', '--get-all', 'credential.https://github.com.helper']);
  const helpers = helperRes.status === 0 ? helperRes.output.split(/\r?\n/).filter(Boolean) : [];
  const ghHelper = helpers.some((h) => /gh\b.*auth git-credential/.test(h));
  const otherHelper = helpers.some((h) => !/gh\b.*auth git-credential/.test(h) && h.trim() !== '');
  const globalHelper = run('git', ['config', '--get-all', 'credential.helper']);
  const hasAnyHelper = ghHelper || otherHelper || (globalHelper.status === 0 && globalHelper.output.trim() !== '');

  // ── 5. 已认证身份（只读身份，token 本身不碰） ──
  const authRes = run('gh', ['auth', 'status'], { timeout: 12_000 });
  const authText = `${authRes.output ?? ''}`;
  const accountMatch = /Logged in to github\.com account ([A-Za-z0-9-]+)/i.exec(authText);
  const account = accountMatch ? accountMatch[1] : '';

  // ── 6. 预检汇总 ──
  say('── 推送预检 ──');
  say(`  仓库      : ${parsed.slug}  (host: ${parsed.host})`);
  say(`  远端 URL  : ${scrubSecrets(remoteUrlRaw)}  (无内嵌凭据)`);
  say(`  本地 HEAD : ${headSha.slice(0, 12)}  tree: ${treeSha.slice(0, 12)}`);
  say(`  目标分支  : ${branch}  ${isProtectedBranch(branch) ? '(受保护)' : ''}`);
  say(`  凭据助手  : ${ghHelper ? 'gh auth git-credential ✓' : hasAnyHelper ? '其他 helper（可用，但未确认能认证 github.com）' : '缺失 ✗'}`);
  say(`  认证身份  : ${account ? `${account} ✓` : authRes.status === 0 ? '已登录（身份名解析失败）' : '无法确认（gh auth status 失败，可能是网络）'}`);
  say(`  模式      : ${opts.dryRun ? 'dry-run（只演练）' : opts.check ? '仅预检' : '真实推送'}`);

  if (!hasAnyHelper) {
    say('');
    say('✗ 没有可用的 credential helper，git 无法在非交互模式下认证。');
    say('  本机已授权 GitHub CLI 时，用官方方式配置（只改 credential.https://github.com.helper，不动别的设置）：');
    say('    gh auth setup-git --hostname github.com');
    fail(EXIT.NO_HELPER, '缺 credential helper，未推送。');
  }

  if (opts.check) {
    say('\n✓ 预检通过（--check 不联网、不推送）');
    process.exit(EXIT.OK);
  }

  // ── 7. 执行推送：argv 里只有 remote 名字和 refspec，没有任何凭据 ──
  const refspec = `HEAD:refs/heads/${branch}`;
  const gitPushArgv = ['push', '--porcelain', ...(opts.dryRun ? ['--dry-run'] : []), 'origin', refspec];
  say('');
  say(`执行: git ${gitPushArgv.join(' ')}`);

  let attempt = 0;
  let last = { status: 0, output: '' };
  let kind = 'ok';
  for (attempt = 1; attempt <= MAX_TRIES; attempt += 1) {
    const res = spawnSync('git', gitPushArgv, {
      encoding: 'utf8',
      // 关掉交互式凭据提示：宁可快速失败并给出明确原因，也不要挂在终端上等人输入
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      timeout: PUSH_TIMEOUT_MS,
    });
    const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
    last = { status: typeof res.status === 'number' ? res.status : 1, output };
    kind = classifyPushFailure(last);
    if (kind === 'ok') break;
    if (!isRetriable(kind) || attempt === MAX_TRIES) break;
    const wait = Math.min(30, 4 * 2 ** (attempt - 1));
    say(`  ⟳ 第 ${attempt} 次失败（网络），${wait}s 后重试…`);
    sleepSync(wait * 1000);
  }

  const printed = scrubSecrets(last.output).trim();
  if (printed) say(printed);

  if (kind !== 'ok') {
    say(`\n✗ 推送失败（exit ${last.status}，分类：${kind}）`);
    say(`  ${adviceFor(kind)}`);
    const codeByKind = { network: EXIT.NETWORK, auth: EXIT.AUTH, 'non-fast-forward': EXIT.NON_FF, repo: EXIT.USAGE };
    fail(codeByKind[kind] ?? EXIT.USAGE, '未完成推送。');
  }

  if (opts.dryRun) {
    say('\n✓ dry-run 通过（远端未发生任何写入）');
    process.exit(EXIT.OK);
  }

  // ── 8. 推完核对远端 ref：必须等于本地 HEAD ──
  say(`\n核对远端 refs/heads/${branch} …`);
  let remoteSha = '';
  for (let i = 1; i <= VERIFY_TRIES; i += 1) {
    const r = run('gh', ['api', `repos/${parsed.owner}/${parsed.repo}/git/refs/heads/${branch}`, '--jq', '.object.sha'], { timeout: 20_000 });
    if (r.status === 0 && r.output.trim()) {
      remoteSha = r.output.trim();
      if (remoteSha === headSha) break;
    }
    if (i < VERIFY_TRIES) sleepSync(VERIFY_WAIT_MS);
  }

  if (!remoteSha) {
    say('⚠ 推完了，但读不到远端 ref（gh 网络抖动）。这不等于失败，请稍后用 gh api 复核。');
    process.exit(EXIT.OK);
  }
  if (remoteSha !== headSha) {
    fail(EXIT.REMOTE_MISMATCH, `远端 ${branch} = ${remoteSha.slice(0, 12)}，本地 HEAD = ${headSha.slice(0, 12)}，不一致。`);
  }
  say(`✓ 远端 ${branch}: ${remoteSha.slice(0, 12)}，与本地 HEAD 一致`);
  say(`\n✓ 推送完成（凭据全程未进入命令行参数）`);
  process.exit(EXIT.OK);
}

main();
