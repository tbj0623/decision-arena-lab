/**
 * 本地 JSON 导入的轻量防护。
 * 导出文件通常只有几 KB；1 MiB 已远大于正常决策数据。
 * 在创建 FileReader / JSON.parse 之前执行，避免超大文件占用浏览器内存。
 */
export const MAX_IMPORT_FILE_BYTES = 1_048_576;

export function checkImportFile(file) {
  if (!file || !Number.isSafeInteger(file.size) || file.size < 0) {
    return { ok: false, code: 'INVALID_FILE' };
  }
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return { ok: false, code: 'FILE_TOO_LARGE' };
  }
  return { ok: true, code: 'OK' };
}
