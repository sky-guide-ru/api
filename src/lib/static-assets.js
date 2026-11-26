import fs from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

// Файлы сборки из dist/assets: у каждого в имени хэш содержимого (index-BZxQlNxl.js), новое содержимое — новое имя.
// Поэтому браузер может хранить их «навсегда» и не спрашивать сервер при каждом открытии
// (раньше max-age=0: телефон через туннель на каждый заход делал запрос на каждый файл).
// Текстовые файлы сжимаем один раз (brotli — на ~15–20% меньше gzip) и держим в памяти, а не жмём на каждый запрос.
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.webp': 'image/webp' };
const TEXT = new Set(['.js', '.css', '.svg', '.json']);
const SAFE = /^[\w.-]+$/;

export function staticAssets(dir) {
  const cache = new Map();
  const load = name => {
    if (cache.has(name)) return cache.get(name);
    const file = path.join(dir, name);
    let raw;
    try { raw = fs.readFileSync(file); } catch { return null; }
    const ext = path.extname(name).toLowerCase();
    const e = { raw, type: TYPES[ext] || 'application/octet-stream', br: null, gz: null };
    if (TEXT.has(ext) && raw.length > 1024) {
      e.br = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } });
      e.gz = gzipSync(raw, { level: 9 });
    }
    if (cache.size > 300) cache.clear(); // старые сборки после автообновления
    cache.set(name, e);
    return e;
  };
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const name = decodeURIComponent(req.path.replace(/^\//, ''));
    if (!SAFE.test(name)) return next();
    const e = load(name);
    if (!e) return res.status(404).set('Cache-Control', 'no-store').end();
    res.set({ 'Content-Type': e.type, 'Cache-Control': 'public, max-age=31536000, immutable' });
    let body = e.raw;
    if (e.br || e.gz) {
      res.vary('Accept-Encoding');
      const enc = req.acceptsEncodings('br', 'gzip', 'identity');
      if (enc === 'br' && e.br) { body = e.br; res.set('Content-Encoding', 'br'); }
      else if (enc === 'gzip' && e.gz) { body = e.gz; res.set('Content-Encoding', 'gzip'); }
    }
    res.set('Content-Length', String(body.length));
    if (req.method === 'HEAD') return res.end();
    res.end(body);
  };
}
