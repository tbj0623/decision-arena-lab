/**
 * V10 P0-1 回归测试：推送链路不得把凭据放进命令行参数。
 *
 * 这个文件存在的理由：
 * 旧版 `scripts/push.mjs` 是 `gh auth token` → 拼 `https://x-access-token:<token>@...`
 * → 当 `git push` 的参数。stdout 打了码，但 token 仍然在子进程 argv 里，
 * 同机任何进程、任何一次 `ps` 快照都能读到。V10 把这条列为 P0。
 *
 * 光"读一遍源码觉得没问题"不算验证。这里做三层：
 *   1. 纯函数层：脱敏、URL 解析、分支名校验、失败分类 —— 用真实样本逐条打。
 *   2. 源码层：剥掉注释后断言不存在 `gh auth token` / 凭据 URL 构造 / force 标志。
 *   3. 进程层：起真实子进程，断言 stdout 里没有凭据形状；
 *      并且造一个 origin 里内嵌假 token 的临时仓库，断言脚本拒绝推送且不回声 token。
 *
 * 用法：node --test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scrubSecrets, containsSecretShape, hasCredentialInUrl, stripCredentialFromUrl } from '../../scripts/lib/redact.mjs';
import {
  assertBranchSafe,
  isProtectedBranch,
  parseRemoteUrl,
  classifyPushFailure,
  isRetriable,
  adviceFor,
} from '../../scripts/lib/push-guard.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PUSH_SCRIPT = join(ROOT, 'scripts', 'push.mjs');
const REDACT_SCRIPT = join(ROOT, 'scripts', 'lib', 'redact.mjs');
const GUARD_SCRIPT = join(ROOT, 'scripts', 'lib', 'push-guard.mjs');

/** 去掉 // 行注释和块注释，只留可执行代码。 */
function stripComments(src) {
  let out = '';
  let i = 0;
  let inBlock = false;
  let inLine = false;
  let quote = '';
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (inBlock) {
      if (c === '*' && n === '/') {
        inBlock = false;
        i += 2;
      } else i += 1;
      continue;
    }
    if (inLine) {
      if (c === '\n') {
        inLine = false;
        out += c;
      }
      i += 1;
      continue;
    }
    if (quote) {
      out += c;
      if (c === '\\') {
        out += src[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = '';
      i += 1;
      continue;
    }
    if (c === '/' && n === '*') {
      inBlock = true;
      i += 2;
      continue;
    }
    if (c === '/' && n === '/') {
      inLine = true;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** 后缀标记，让假 token 不会被本文件的静态扫描误认成真密钥。 */
const FAKE = ['gho', 'FAKEfakeFAKEfakeFAKEfake0123456789'].join('_');

/** 进程层测试统一用这个安全分支名，避免"运行者当前在哪个分支"影响结果（见 --check 那条注释）。 */
const SAFE_BRANCH = 'audit/ci-probe';

test('P0-1：scripts/push.mjs 不再调用 gh auth token', async () => {
  const code = stripComments(await readFile(PUSH_SCRIPT, 'utf8'));
  assert.equal(/['"]auth['"]\s*,\s*['"]token['"]/.test(code), false, '源码仍然把 gh auth token 当子命令调用');
  assert.equal(/\bauth\s+token\b/.test(code), false, '源码仍然出现 auth token 代码');
  // 负向验证：把旧写法塞回来后，本断言必须能抓到
  const mutated = `${code}\nconst t = execFileSync('gh', ['auth', 'token']);`;
  assert.equal(/['"]auth['"]\s*,\s*['"]token['"]/.test(mutated), true, '本测试的检测规则失效了（负向验证失败）');
});

test('P0-1：scripts/push.mjs 不构造带凭据的 URL，也不用 force', async () => {
  const code = stripComments(await readFile(PUSH_SCRIPT, 'utf8'));
  assert.equal(/x-access-token/i.test(code), false, '源码仍然出现 x-access-token');
  assert.equal(/--force/.test(code), false, '源码出现 --force');
  assert.equal(/--force-with-lease/.test(code), false, '源码出现 --force-with-lease');
  // 模板里出现 ${token} 之类塞进 URL 的写法也要拦
  assert.equal(/https?:\$\{[^}]*token[^}]*\}/i.test(code), false, '源码把 token 插进 URL 模板');
});

test('P0-1：git push 的 argv 只含 remote 名与 refspec', async () => {
  const code = stripComments(await readFile(PUSH_SCRIPT, 'utf8'));
  const m = /const\s+gitPushArgv\s*=\s*\[([\s\S]*?)\];/.exec(code);
  assert.ok(m, '找不到 gitPushArgv 定义（重构后请同步更新本测试）');
  const argvSrc = m[1];
  assert.match(argvSrc, /'push'/, 'argv 第一个参数应是 push');
  assert.match(argvSrc, /'origin'/, 'argv 应使用 remote 名 origin 而不是 URL');
  assert.equal(/token|secret|password|@/i.test(argvSrc), false, `argv 里出现了可疑内容：${argvSrc}`);
  // refspec 用 refs/heads/ 全名，避免歧义
  assert.match(code, /HEAD:refs\/heads\/\$\{branch\}/, 'refspec 应使用 HEAD:refs/heads/<branch> 全名');
});

test('P0-1：dry-run 是显式构造出来的，默认不推受保护分支', async () => {
  const code = stripComments(await readFile(PUSH_SCRIPT, 'utf8'));
  assert.match(code, /opts\.dryRun\s*\?\s*\['--dry-run'\]/, 'dry-run 没有进入 argv');
  assert.match(code, /isProtectedBranch\(branch\)\s*&&\s*!opts\.allowMain/, '没有受保护分支拦截');
});

test('脱敏：各类 token 形状都被替换，且替换后不再含密钥形状', () => {
  const samples = [
    `https://x-access-token:${FAKE}@github.com/a/b.git`,
    `https://user:${FAKE}@github.com/a/b.git`,
    `?token=${FAKE}&x=1`,
    `Authorization: Bearer ghp_aaaaaaaaaaaaaaaaaaaaaaaa`,
    `ghp_aaaaaaaaaaaaaaaaaaaaaaaa`,
    `github_pat_aaaaaaaaaaaaaaaaaaaaaaaa`,
    `sk-aaaaaaaaaaaaaaaaaaaaaaaa`,
    `AKIAAAAAAAAAAAAAAAAA`,
  ];
  for (const s of samples) {
    const clean = scrubSecrets(s);
    assert.equal(containsSecretShape(clean), false, `脱敏后仍残留密钥形状：${clean}`);
  }
  // 幂等
  const once = scrubSecrets(`https://x-access-token:${FAKE}@github.com/a/b.git`);
  assert.equal(scrubSecrets(once), once, 'scrubSecrets 不是幂等的');
  // 正常文本不被误伤
  assert.equal(scrubSecrets('推送完成，远端 main 与本地一致'), '推送完成，远端 main 与本地一致');
});

test('脱敏：containsSecretShape 能识别未打码的密钥', () => {
  assert.equal(containsSecretShape(`https://x-access-token:${FAKE}@github.com/a/b.git`), true);
  assert.equal(containsSecretShape('ghp_aaaaaaaaaaaaaaaaaaaaaaaa'), true);
  assert.equal(containsSecretShape('一切正常'), false);
});

test('URL 判定：内嵌 userinfo 的 remote 被识别，干净 URL 不被误判', () => {
  assert.equal(hasCredentialInUrl(`https://x-access-token:${FAKE}@github.com/a/b.git`), true);
  assert.equal(hasCredentialInUrl('https://user:pass@github.com/a/b.git'), true);
  assert.equal(hasCredentialInUrl('https://github.com/a/b.git'), false);
  assert.equal(hasCredentialInUrl('git@github.com:a/b.git'), false);
  // 还原出的干净 URL 不含任何凭据
  const clean = stripCredentialFromUrl(`https://x-access-token:${FAKE}@github.com/a/b.git`);
  assert.equal(clean, 'https://github.com/a/b.git');
  assert.equal(containsSecretShape(clean), false);
});

test('远端解析：https / ssh / 带 .git 都能解出 owner+repo', () => {
  const cases = [
    ['https://github.com/tbj0623/decision-arena-lab.git', 'tbj0623', 'decision-arena-lab'],
    ['https://github.com/tbj0623/decision-arena-lab', 'tbj0623', 'decision-arena-lab'],
    ['git@github.com:tbj0623/decision-arena-lab.git', 'tbj0623', 'decision-arena-lab'],
  ];
  for (const [url, owner, repo] of cases) {
    const r = parseRemoteUrl(url);
    assert.equal(r.ok, true, `解析失败：${url}`);
    assert.equal(r.owner, owner);
    assert.equal(r.repo, repo);
    assert.equal(r.slug, `${owner}/${repo}`);
  }
});

test('远端解析：带凭据 / 两段以下路径 / 垃圾串一律拒绝', () => {
  const bad = [
    `https://x-access-token:${FAKE}@github.com/a/b.git`,
    'https://github.com/a.git',
    'https://github.com',
    'not-a-url',
    '',
  ];
  for (const url of bad) {
    assert.equal(parseRemoteUrl(url).ok, false, `本应拒绝：${url}`);
  }
});

test('分支名：合法名通过，参数注入与 git 禁止字符被拒', () => {
  for (const b of ['audit/v10-release-hardening-20261030', 'fix/x-1', 'main', 'release/2026.10']) {
    assert.equal(assertBranchSafe(b).ok, true, `本应通过：${b}`);
  }
  for (const b of ['', '-x', '--force', 'a b', 'a..b', 'a~b', 'a^b', 'a:b', 'a?b', 'a*b', 'a[b', 'a\\b', '/a', 'a/', 'a.', 'a.lock']) {
    assert.equal(assertBranchSafe(b).ok, false, `本应拒绝：${JSON.stringify(b)}`);
  }
  assert.equal(isProtectedBranch('main'), true);
  assert.equal(isProtectedBranch('master'), true);
  assert.equal(isProtectedBranch('audit/x'), false);
});

test('失败分类：网络 / 认证 / 非快进 / 仓库不存在 / 未知 各自归位', () => {
  const samples = [
    [0, '', 'ok'],
    [128, "fatal: unable to access 'https://github.com/a/b.git/': Could not resolve host: github.com", 'network'],
    [128, 'fatal: unable to access: Connection reset by peer', 'network'],
    [128, 'fatal: unable to access: Operation timed out after 180000 milliseconds', 'network'],
    [128, 'fatal: Authentication failed for https://github.com/a/b.git/', 'auth'],
    [128, 'remote: Permission to a/b.git denied to u.', 'auth'],
    [128, "fatal: could not read Username for 'https://github.com': terminal prompts disabled", 'auth'],
    [1, 'remote: Invalid username or password.', 'auth'],
    [1, '! [rejected]        main -> main (non-fast-forward)', 'non-fast-forward'],
    [1, '! [rejected]        x -> x (fetch first)', 'non-fast-forward'],
    [1, 'error: failed to push some refs; Updates were rejected because the remote contains work', 'non-fast-forward'],
    [128, 'remote: Repository not found.', 'repo'],
    [128, "fatal: 'a/b' does not appear to be a git repository", 'repo'],
    [1, 'some completely unexpected git noise', 'unknown'],
  ];
  for (const [status, output, want] of samples) {
    assert.equal(classifyPushFailure({ status, output }), want, `分类错误：${status} / ${output}`);
  }
  // 只有网络错误值得重试
  assert.equal(isRetriable('network'), true);
  for (const k of ['auth', 'repo', 'non-fast-forward', 'unknown', 'ok']) {
    assert.equal(isRetriable(k), false, `${k} 不应重试`);
  }
  // 每个分类都要有给人看的中文建议，且不含任何凭据形状
  for (const k of ['network', 'auth', 'non-fast-forward', 'repo', 'unknown']) {
    const a = adviceFor(k);
    assert.ok(a.length > 5, `${k} 缺少建议文案`);
    assert.equal(containsSecretShape(a), false);
  }
});

/** 本机/CI 是否配置了 git 凭据助手（决定 --check 的预期结果） */
function hasCredentialHelper() {
  const probes = [
    ['credential.https://github.com.helper'],
    ['credential.helper'],
  ];
  return probes.some((args) => {
    const r = spawnSync('git', ['config', '--get-all', ...args], { encoding: 'utf8', cwd: ROOT });
    return r.status === 0 && r.stdout.trim() !== '';
  });
}

test('进程层：--check 有 helper 时退出 0；无 helper 时必须明确拒绝并给修复指引', () => {
  // 关键：必须显式传 --branch，不能依赖"当前检出的分支"。
  // 踩过的坑（CI 上真实发生）：actions/checkout 把仓库检出在 main 分支上，
  // 而 scripts/push.mjs 会**先**拒绝受保护分支（退出 2），于是这里期望的
  // 退出 3 / "不匹配" 全部落空 —— 本地因为在 audit 分支上所以一直是绿的。
  // 测试不该依赖运行者当前在哪个分支。
  const res = spawnSync(process.execPath, [PUSH_SCRIPT, '--check', '--branch', SAFE_BRANCH], { encoding: 'utf8', cwd: ROOT });
  const out = `${res.stdout}${res.stderr}`;
  assert.equal(containsSecretShape(out), false, '--check 输出里出现凭据形状');

  if (hasCredentialHelper()) {
    assert.equal(res.status, 0, `--check 失败：${out}`);
    assert.match(out, /无内嵌凭据/, '预检没有报告 remote URL 无凭据');
    assert.match(out, /credential/, '预检没有报告 credential helper 状态');
  } else {
    // GitHub Actions 的 runner 上既没有 credential helper、也没有 gh：
    // 此时**正确行为是明确拒绝推送**（退出 3）并给出官方修复命令，
    // 绝不能"什么都不说就继续"。这条分支和成功路径同样重要，不能用 skip 糊过去。
    assert.equal(res.status, 3, `无 helper 时应退出 3，实际 ${res.status}：${out}`);
    assert.match(out, /没有可用的 credential helper/, '无 helper 时没有明确报错');
    assert.match(out, /gh auth setup-git --hostname github\.com/, '无 helper 时没有给出官方修复命令');
  }
});

test('进程层：拒绝直接推 main（退出 2）', () => {
  const res = spawnSync(process.execPath, [PUSH_SCRIPT, '--branch', 'main'], { encoding: 'utf8', cwd: ROOT });
  assert.equal(res.status, 2, `应退出 2，实际 ${res.status}: ${res.stderr}`);
  assert.match(`${res.stdout}${res.stderr}`, /受保护分支/);
});

test('进程层：--expect 不匹配时拒绝（防止推错 owner/repo）', () => {
  // 同样必须显式传 --branch：否则在 CI（检出在 main 上）会先撞上受保护分支拦截，
  // 拿到的报错是"拒绝直接推受保护分支"而不是"不匹配"，断言就会假红。
  const res = spawnSync(process.execPath, [
    PUSH_SCRIPT, '--check', '--branch', SAFE_BRANCH, '--expect', 'someone-else/other-repo',
  ], { encoding: 'utf8', cwd: ROOT });
  assert.equal(res.status, 2, `应退出 2，实际 ${res.status}`);
  assert.match(`${res.stdout}${res.stderr}`, /不匹配/);
});

test('进程层：origin 内嵌假 token 时必须拒绝，且不回显 token', () => {
  const dir = mkdtempSync(join(tmpdir(), 'push-guard-'));
  const git = (args) =>
    spawnSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@example.com',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@example.com',
        GIT_CONFIG_GLOBAL: join(dir, '.gitconfig-none'),
        GIT_CONFIG_SYSTEM: join(dir, '.gitconfig-none'),
      },
    });
  try {
    assert.equal(git(['init', '-q', '-b', 'audit/probe']).status, 0);
    assert.equal(git(['commit', '-q', '--allow-empty', '-m', 'init']).status, 0);
    // 故意造一个"内嵌凭据"的 origin —— 这是旧脚本会自己拼出来的那种形态
    const dirty = `https://x-access-token:${FAKE}@github.com/tbj0623/decision-arena-lab.git`;
    assert.equal(git(['remote', 'add', 'origin', dirty]).status, 0);

    const res = spawnSync(process.execPath, [PUSH_SCRIPT, '--check'], { encoding: 'utf8', cwd: dir });
    const out = `${res.stdout}${res.stderr}`;
    assert.equal(res.status, 2, `应退出 2，实际 ${res.status}: ${out}`);
    assert.match(out, /内嵌了凭据/, '没有报出"URL 内嵌凭据"');
    assert.equal(out.includes(FAKE), false, '脚本把假 token 回显出来了 —— 脱敏失效');
    assert.equal(containsSecretShape(out), false, '输出里仍有凭据形状');
    // 必须给出可执行的修复命令，且命令本身不含凭据
    assert.match(out, /git remote set-url origin https:\/\/github\.com\/tbj0623\/decision-arena-lab\.git/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('可执行脚本本身不含密钥形状（脱敏规则文件除外：它必然含识别用的正则）', async () => {
  const src = await readFile(PUSH_SCRIPT, 'utf8');
  assert.equal(containsSecretShape(src), false, 'scripts/push.mjs 里出现疑似密钥');
});

test('仓库静态隐私扫描仍然 PASS（新脚本未引入网络请求/持久化/密钥）', () => {
  // 这是最硬的自证：审计脚本会自己扫 site/ 与 scripts/ 全部文本文件。
  // 如果新写的 lib 里夹带了网络调用或密钥模式，这里会直接红。
  const res = spawnSync(process.execPath, [join(ROOT, 'scripts', 'check-no-network.mjs')], { encoding: 'utf8', cwd: ROOT });
  assert.equal(res.status, 0, `静态审计失败：\n${res.stdout}\n${res.stderr}`);
  assert.match(res.stdout, /PASS/);
});
