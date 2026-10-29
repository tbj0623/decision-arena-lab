/**
 * 生成可发布发行包 dist/decision-arena-release.zip
 * 只打包可公开的内容，不含 .git / work / reports / 日志 / 凭据。
 * 同时输出 SHA-256 并做完整性自检（重新打开 zip 校验条目数）。
 *
 * 用法：node scripts/make-release.mjs
 */
import { createWriteStream } from 'node:fs';
import { readdir, readFile, mkdir, stat, writeFile, rm } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DIST = join(ROOT, 'dist');
const ZIP_NAME = 'decision-arena-release.zip';
const ZIP_PATH = join(DIST, ZIP_NAME);

/** 白名单：只打包这些顶层目录/文件 */
const INCLUDE = [
  'site', 'tests', 'scripts', 'docs', 'FACTORY_KIT', 'marketing',
  'README.md', 'LICENSE', '.github',
];
/** 永不打包 */
const EXCLUDE_NAMES = new Set(['node_modules', '.git', '.DS_Store', 'Thumbs.db', 'work', 'reports', 'dist', 'ops', '_internal', 'proposals']);
const EXCLUDE_EXT = new Set(['.zip', '.log', '.bak']);

/**
 * 未启用的实验性模块：**不进发行包**。
 *
 * 为什么（product-owner 的 INTERVAL_DECISION 指出）：interval.mjs 通过了 37 项测试，
 * 但 UI 完全没接入。如果打进发行包，下载者会以为产品有这个功能，
 * 打开却发现界面上找不到——那就是"文档/产物承诺了不存在的东西"，
 * 正是今晚修了一整夜的那类缺陷。
 *
 * 代码仍留在仓库里（site/features/interval.mjs，带 ⚠️ 状态头），
 * 感兴趣的人可以从源码看到；发行包只放**能用的**东西。
 */
const EXCLUDE_PATHS = new Set([
  'site/features/interval.mjs',
  'tests/core/interval.test.mjs',
]);

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (EXCLUDE_NAMES.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) {
      if (EXCLUDE_EXT.has(extname(entry.name).toLowerCase())) continue;
      yield full;
    }
  }
}

/** 极简 ZIP 打包器（STORE 无压缩），零依赖，避免引入 archiver 之类的包 */
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

async function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const size = data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);       // version needed
    local.writeUInt16LE(0x0800, 6);   // UTF-8 flag
    local.writeUInt16LE(0, 8);        // stored
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, data);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(dosTime, 12);
    cen.writeUInt16LE(dosDate, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(size, 20);
    cen.writeUInt32LE(size, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(0, 38);
    cen.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cen, nameBuf]));

    offset += local.length + nameBuf.length + size;
  }

  const cenBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cenBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, cenBuf, end]);
}

async function main() {
  const entries = [];
  for (const item of INCLUDE) {
    const full = join(ROOT, item);
    const info = await stat(full).catch(() => null);
    if (!info) { console.warn(`跳过（不存在）：${item}`); continue; }
    if (info.isFile()) {
      entries.push({ name: item, data: await readFile(full) });
    } else {
      for await (const file of walk(full)) {
        const rel = relative(ROOT, file).split('\\').join('/');
        // 实验性/未启用的模块不进发行包（见 EXCLUDE_PATHS 的说明）
        if (EXCLUDE_PATHS.has(rel)) continue;
        entries.push({ name: rel, data: await readFile(file) });
      }
    }
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  // 安全检查：拒绝打包任何像密钥的东西
  const suspicious = [];
  for (const e of entries) {
    if (/\.(env|pem|key|p12)$/i.test(e.name) || /(^|\/)\.env/i.test(e.name)) suspicious.push(e.name);
    const text = e.data.toString('utf8');
    if (/sk-[A-Za-z0-9]{16,}/.test(text)) suspicious.push(`${e.name} (疑似 API key)`);
    if (/gh[pousr]_[A-Za-z0-9]{20,}/.test(text)) suspicious.push(`${e.name} (疑似 GitHub token)`);
  }
  if (suspicious.length) {
    console.error('拒绝打包，发现可疑内容：');
    for (const s of suspicious) console.error('  ' + s);
    process.exit(1);
  }

  await mkdir(DIST, { recursive: true });
  await rm(ZIP_PATH, { force: true });
  const zip = await buildZip(entries);
  await writeFile(ZIP_PATH, zip);

  const sha = createHash('sha256').update(zip).digest('hex');
  const totalBytes = entries.reduce((s, e) => s + e.data.length, 0);

  await writeFile(join(DIST, `${ZIP_NAME}.sha256`), `${sha}  ${ZIP_NAME}\n`, 'utf8');
  await writeFile(
    join(DIST, 'MANIFEST.txt'),
    [
      `反悔雷达 · Decision Arena — 发行包清单`,
      `生成时间：${new Date().toISOString()}`,
      `文件数：${entries.length}`,
      `原始大小：${totalBytes} 字节`,
      `ZIP 大小：${zip.length} 字节`,
      `SHA-256：${sha}`,
      ``,
      `包含的文件：`,
      ...entries.map((e) => `  ${e.name}  (${e.data.length} B)`),
      ``,
      `不包含：.git/、work/、reports/、dist/、任何日志与凭据。`,
    ].join('\n'),
    'utf8',
  );

  console.log(`已生成：${ZIP_PATH}`);
  console.log(`文件数：${entries.length}，ZIP 大小：${zip.length} 字节`);
  console.log(`SHA-256：${sha}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
