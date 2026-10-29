/**
 * 标准推送：git push（token 从 gh auth 取，不出现在命令行/历史里）
 *
 * ── 为什么需要这个包装 ──
 * 本机 git 没有配置 credential helper，直接 `git push` 会卡在认证环节（实测 --dry-run 挂死）。
 * 把 token 拼进 URL 就能正常推（2026-10-30 网络恢复后实测通过）。
 *
 * 用法：
 *   node scripts/push.mjs              # 推到 main
 *   node scripts/push.mjs --dry-run    # 只看会推什么
 *
 * 与 work/push-incremental.mjs 的分工：
 *   · scripts/push.mjs      —— 网络正常时的首选，秒级完成，历史连续（git push + token URL）
 *   · push-incremental.mjs  —— 兜底，走 GitHub API 逐文件重建 tree，
 *                              几分钟，但不需要 git push 通道；
 *                              推完会断言「远端 tree === 本地 HEAD tree」
 *
 * 安全：token 只存在于子进程环境与 git 的远程 URL 实参中，
 * 本脚本不会把它打印出来（输出里已做替换）。
 */
import { execFileSync, spawnSync } from 'node:child_process';

const OWNER = 'tbj0623';
const REPO = 'decision-arena-lab';
const BRANCH = 'main';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
if (!token) {
  console.error('✗ 拿不到 gh token，先跑 gh auth login');
  process.exit(1);
}

const url = `https://x-access-token:${token}@github.com/${OWNER}/${REPO}.git`;

// 先报一下本地状态，便于对照
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
console.log(`本地 HEAD: ${head.slice(0, 8)}  tree: ${tree.slice(0, 8)}`);

const gitArgs = ['push', ...(dryRun ? ['--dry-run'] : []), url, `HEAD:${BRANCH}`];
console.log(`执行: git push${dryRun ? ' --dry-run' : ''} <token-url> HEAD:${BRANCH}`);

// 本机网络是间歇性抖动的（实测 06:00 通 / 06:04 断 / 06:07 通），
// 所以带重试。DNS 解析失败、连接被重置都重试；认证失败（403/401）不重试。
const MAX_TRIES = 5;
let res = null;
for (let attempt = 1; attempt <= MAX_TRIES; attempt += 1) {
  res = spawnSync('git', gitArgs, {
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    timeout: 180_000,
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  const retriable = /Could not resolve host|Couldn't resolve host|Connection (was )?reset|timed out|Failed to connect|TLS|ECONNRESET|network is unreachable/i.test(out);
  if (res.status === 0 || !retriable || attempt === MAX_TRIES) break;
  const wait = Math.min(30, 4 * 2 ** (attempt - 1));
  console.log(`  ⟳ 第 ${attempt} 次失败（网络），${wait}s 后重试…`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait * 1000);
}

const scrub = (s) => String(s || '').replace(/x-access-token:[^@]+@/g, 'x-access-token:***@');
if (res.stdout) console.log(scrub(res.stdout).trimEnd());
if (res.stderr) console.log(scrub(res.stderr).trimEnd());

if (res.status !== 0) {
  console.error(`\n✗ 推送失败（exit ${res.status}）`);
  console.error('  常见原因：网络抖动。本机网络是间歇性的，重试通常就好。');
  console.error('  仍然不行就换兜底：node work/push-incremental.mjs');
  process.exit(res.status ?? 1);
}

if (dryRun) {
  console.log('\n✓ dry-run 通过（未真正推送）');
  process.exit(0);
}

// 推完核对远端 ref
try {
  const remote = execFileSync('gh', [
    'api', `repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, '--jq', '.object.sha',
  ], { encoding: 'utf8' }).trim();
  console.log(`\n远端 ${BRANCH}: ${remote.slice(0, 8)}`);
  if (remote === head) {
    console.log('✓ 远端与本地一致');
  } else {
    console.error('✗ 远端与本地不一致！');
    process.exit(1);
  }
} catch (e) {
  console.warn('⚠ 推完了，但核对远端 ref 失败（可能是 gh 网络抖动）：', String(e.message).slice(0, 80));
}
