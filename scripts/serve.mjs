/**
 * 零依赖本地静态服务器 —— 只用于本地预览，生产环境请用任意静态托管。
 * 用法：node scripts/serve.mjs [port]
 * 默认端口 8080，只监听 127.0.0.1，不对外暴露。
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../site/', import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const HOST = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const rel = normalize(decoded).replace(/^([/\\])+/, '');
  const target = join(root, rel);
  if (!target.startsWith(root.endsWith(sep) ? root : root + sep)) return null;
  return target;
}

const server = createServer(async (req, res) => {
  try {
    let pathname = req.url || '/';
    if (!pathname.startsWith('/')) pathname = '/' + pathname;
    if (pathname === '/' || pathname === '') pathname = '/index.html';

    const filePath = safeJoin(ROOT, pathname);
    if (!filePath) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden');
      return;
    }

    const info = await stat(filePath).catch(() => null);
    const finalPath = info && info.isDirectory() ? join(filePath, 'index.html') : filePath;

    const body = await readFile(finalPath);
    res.writeHead(200, {
      'content-type': MIME[extname(finalPath).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`反悔雷达 · 本地预览：http://${HOST}:${PORT}/`);
  console.log('按 Ctrl+C 停止。');
});
