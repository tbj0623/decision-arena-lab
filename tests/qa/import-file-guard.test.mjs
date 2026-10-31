import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkImportFile, MAX_IMPORT_FILE_BYTES } from '../../site/import-guard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = readFileSync(join(ROOT, 'site', 'app.mjs'), 'utf8');

test('JSON 导入：正常文件与 1 MiB 边界允许通过', () => {
  assert.equal(MAX_IMPORT_FILE_BYTES, 1_048_576);
  assert.deepEqual(checkImportFile({ size: 0 }), { ok: true, code: 'OK' });
  assert.deepEqual(checkImportFile({ size: 4096 }), { ok: true, code: 'OK' });
  assert.deepEqual(checkImportFile({ size: MAX_IMPORT_FILE_BYTES }), { ok: true, code: 'OK' });
});

test('JSON 导入：超过 1 MiB 必须在读取前拒绝', () => {
  assert.deepEqual(checkImportFile({ size: MAX_IMPORT_FILE_BYTES + 1 }), {
    ok: false,
    code: 'FILE_TOO_LARGE',
  });
  assert.deepEqual(checkImportFile({ size: 50 * 1024 * 1024 }), {
    ok: false,
    code: 'FILE_TOO_LARGE',
  });
});

test('JSON 导入：无效文件元数据必须安全拒绝', () => {
  for (const file of [null, undefined, {}, { size: -1 }, { size: 1.5 }, { size: Infinity }, { size: '12' }]) {
    assert.deepEqual(checkImportFile(file), { ok: false, code: 'INVALID_FILE' });
  }
});

test('JSON 导入：UI 必须先执行体积守卫，再创建 FileReader', () => {
  const start = APP.indexOf('function importJSON(file)');
  const end = APP.indexOf('function buildShareText', start);
  assert.ok(start >= 0 && end > start, '必须能定位 importJSON');
  const fn = APP.slice(start, end);
  assert.ok(fn.indexOf('checkImportFile(file)') >= 0, '导入流程必须调用体积守卫');
  assert.ok(fn.indexOf('checkImportFile(file)') < fn.indexOf('new FileReader()'),
    '必须在创建 FileReader 前检查文件大小');
  assert.match(fn, /FILE_TOO_LARGE/);
  assert.match(fn, /reader\.onerror/);
});
