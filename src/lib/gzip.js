import { gzipSync, brotliCompressSync, constants as zc } from 'node:zlib';

// Сжатие ответов без лишних зависимостей. /api/state весит ~200 КБ, а сжатый — в несколько раз меньше:
// на телефоне через туннель профиль и сам сайт открываются заметно быстрее.
// Сжимаем только текст (JSON, JS, CSS, HTML, SVG) крупнее 1 КБ. Картинки и поток событий (SSE) не трогаем.
const COMPRESSIBLE = /^(application\/(json|javascript)|text\/(html|css|javascript|plain)|image\/svg\+xml)/;
const MIN_SIZE = 1024;

export function gzip() {
  return (req, res, next) => {
    // acceptsEncodings учитывает веса: «gzip;q=0» — значит, сжатие запрещено
    if (req.method === 'HEAD') return next();
    // brotli (br) жмёт JSON профиля на ~15–20% сильнее gzip; качество 5 — быстро даже для ответов, которые собираются на лету
    // Браузеры пишут «gzip, deflate, br, zstd» с равным весом — выбираем br сами, если он не запрещён
    const coding = req.acceptsEncodings('br') === 'br' ? 'br' : req.acceptsEncodings('gzip', 'identity');
    if (coding !== 'br' && coding !== 'gzip') { res.vary('Accept-Encoding'); return next(); }
    const write = res.write.bind(res);
    const end = res.end.bind(res);
    let mode = null; // null — ещё не решили, 'pass' — отдаём как есть, 'buf' — копим и сожмём в конце
    const chunks = [];
    const restore = () => { res.write = write; res.end = end; };
    const decide = () => {
      if (mode) return mode;
      const type = String(res.getHeader('Content-Type') || '');
      // Заголовки уже ушли (SSE делает flushHeaders) или ответ не текстовый — не вмешиваемся
      mode = res.headersSent || res.getHeader('Content-Encoding') || !COMPRESSIBLE.test(type) ? 'pass' : 'buf';
      if (mode === 'pass') restore();
      return mode;
    };
    const toBuf = (chunk, enc) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof enc === 'string' ? enc : 'utf8'));
    res.write = (chunk, enc, cb) => {
      if (decide() === 'pass') return write(chunk, enc, cb);
      if (chunk != null) chunks.push(toBuf(chunk, enc));
      if (typeof enc === 'function') enc(); else if (typeof cb === 'function') cb();
      return true;
    };
    res.end = (chunk, enc, cb) => {
      if (typeof chunk === 'function') { cb = chunk; chunk = null; } else if (typeof enc === 'function') { cb = enc; enc = null; }
      if (decide() === 'pass') return end(chunk, enc, cb);
      restore();
      if (chunk != null) chunks.push(toBuf(chunk, enc));
      const body = Buffer.concat(chunks);
      res.vary('Accept-Encoding');
      if (body.length < MIN_SIZE || res.statusCode === 204 || res.statusCode === 304) {
        if (body.length) res.setHeader('Content-Length', body.length);
        return end(body.length ? body : undefined, cb);
      }
      const gz = coding === 'br'
        ? brotliCompressSync(body, { params: { [zc.BROTLI_PARAM_QUALITY]: 5, [zc.BROTLI_PARAM_SIZE_HINT]: body.length, [zc.BROTLI_PARAM_MODE]: zc.BROTLI_MODE_TEXT } })
        : gzipSync(body, { level: 6 });
      res.setHeader('Content-Encoding', coding);
      res.setHeader('Content-Length', gz.length);
      // ETag описывает несжатое тело — помечаем слабым, чтобы кэши не путали варианты
      const etag = res.getHeader('ETag');
      if (etag && !String(etag).startsWith('W/')) res.setHeader('ETag', `W/${etag}`);
      return end(gz, cb);
    };
    next();
  };
}
