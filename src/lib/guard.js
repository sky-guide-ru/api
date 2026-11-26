import { tx } from '@sky-guide/core/i18n/msg.js';
// Базовая защита сайта, открытого в интернет: заголовки безопасности и лимиты запросов с одного адреса.

/** Заголовки: страницу нельзя встроить в чужой сайт (кликджекинг), браузер не угадывает тип файла,
 *  в чужие сайты не уходит полный адрес страницы. Скрипты рекламы и Метрики не трогаем (без CSP на скрипты). */
export function securityHeaders() {
  return (req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': "frame-ancestors 'self'",
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    next();
  };
}

/**
 * Скользящий лимит: не больше max запросов за windowMs с одного адреса.
 * @param {{ max?: number, windowMs?: number, clock?: () => number }} [o]
 */
export function createRateLimiter(o = {}) {
  const max = o.max ?? 600, windowMs = o.windowMs ?? 60_000, clock = o.clock || (() => Date.now());
  const hits = new Map(); // ip → { n, until }
  return {
    hit(ip) {
      const now = clock();
      let e = hits.get(ip);
      if (!e || e.until <= now) { e = { n: 0, until: now + windowMs }; hits.set(ip, e); }
      if (hits.size > 20_000) for (const [k, v] of hits) if (v.until <= now) hits.delete(k);
      e.n++;
      return e.n <= max ? 0 : Math.ceil((e.until - now) / 1000);
    },
  };
}

/** Middleware для /api: превысил — 429 с Retry-After. Владелец сайта лимитом не ограничен */
export function apiRateLimit({ clientIp, max = 600, windowMs = 60_000, skip = () => false } = {}) {
  const lim = createRateLimiter({ max, windowMs });
  return (req, res, next) => {
    if (skip(req)) return next();
    const wait = lim.hit(clientIp(req));
    if (!wait) return next();
    res.set('Retry-After', String(wait)).status(429).json({ error: tx`Слишком много запросов. Подожди ${wait} с`, errorCode: 'RATE' });
  };
}

/** Сколько живых соединений (SSE) держим с одного адреса: иначе тысячи вкладок съели бы память */
export function createConnLimiter(max = 8) {
  const open = new Map();
  return {
    take(ip) {
      const n = open.get(ip) || 0;
      if (n >= max) return false;
      open.set(ip, n + 1);
      return true;
    },
    release(ip) {
      const n = (open.get(ip) || 1) - 1;
      if (n <= 0) open.delete(ip); else open.set(ip, n);
    },
  };
}
