// Публичный API /v1: описание — openapi.yaml в корне репо (сначала описание, потом код), страница Swagger — /api/docs.
//
// Открыто всем (без ключа): предметы и картинки, поиск, Bazaar, аукцион, свечи, цены, тренды, флипы, календарь, лидерборды,
// гайды, словарь терминов, новости, статус. Данные игроков (разборы и разделы сайта) — только по ключу X-API-Key
// с отметкой players: это собственные клиенты Sky Guide (свой бот, свой мод), так требуют правила Hypixel.
// Условия использования — страница /api-terms (подпись «Данные: Sky Guide», без перепродажи).
// Все ответы — наши расчёты и переводы, а не пересказ ответа Hypixel. Язык: ?lang=en или заголовок X-Lang: en.
//
// Старые адреса /api/* сайт использует как раньше: /v1 только добавляется.
import express from 'express';
import { createRateLimiter } from '../lib/guard.js';

export const V1_VERSION = '1.5.0';
const FLIPS = ['bazaar', 'craft', 'forge', 'npc', 'snipes'];
// Разделы игрока — те же расчёты, что страницы сайта
export const SECTIONS = ['gear', 'progress', 'pets', 'map', 'collections', 'minions', 'museum', 'sacks', 'essence', 'bank', 'bits', 'maxwell', 'guides'];
const RANGES = { '1d': 1, '7d': 7, '30d': 30, '365d': 365, all: 0 };
const GUIDE_ID = /^[a-z0-9-]{1,40}$/;
const NICK = /^[A-Za-z0-9_]{1,16}$/;
const ITEM_ID = /^[A-Za-z0-9_:;\-.]{1,80}$/;
const MISSING_SORTS = ['perMp', 'price', 'mp'];

/** Ошибка в одном виде для всех ручек: { error, code } */
function fail(res, status, code, error, extra = {}) {
  return res.status(status).json({ error, code, ...extra });
}
const int = (v, d, min, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) && v !== '' && v != null ? Math.max(min, Math.min(max, n)) : d; };

// Ошибки разбора профиля → коды HTTP
const PLAYER_ERRORS = {
  BAD_NAME: [400, 'BAD_NAME'], NOT_FOUND: [404, 'NOT_FOUND'], NO_PROFILE: [404, 'NO_PROFILE'], HIDDEN: [404, 'HIDDEN'],
  RATE: [503, 'HYPIXEL_LIMIT'], NO_KEY: [503, 'HYPIXEL_UNAVAILABLE'],
};

/**
 * @param {object} d зависимости (всё — функции, вызываются на запросе):
 *   keys — хранилище ключей (createKeyStore); clientIp(req); open() — открыты ли ручки без ключа (PUBLIC_VIEW);
 *   openPerMin — лимит без ключа с одного адреса;
 *   items: { card(id, { lvl }), obtain(id), search(q, limit) }; market: { bazaar(q), auctions(q), candles(id, o), flips(kind, q) };
 *   lexicon(), news(), status(), version();
 *   players: { view({ player, profile }), hidden(name) }; summary(v), plan(v), money(v);
 *   accessories(v, q), missing(v, q), networth(v, q), upgrades(v, id) — null, если у профиля нет этих данных;
 *   auctions(v) — свои лоты Auction House и ставки (async);
 *   calendar(year), miningEvents() → { at, islands } (async), leaderboard(q), guides: { list(), get(id) }, quotes(ids), trend(id), movers(period), crops(q), image(id) → png;
 *   section(name, v, q) для SECTIONS, guide(id, v), history(v, days)
 */
export function createV1(d) {
  const r = express.Router({ caseSensitive: true });
  const openLimit = createRateLimiter({ max: d.openPerMin || 120 });
  const keyHits = new Map(); // id ключа → { n, until }: у каждого ключа свой лимит в минуту

  // CORS: ключ передаётся заголовком, cookie не нужны — читать /v1 можно с любого сайта
  r.use((req, res, next) => {
    // Условия API (/api-terms): рядом с данными — видимая подпись «Данные: Sky Guide» со ссылкой на sky-guide.ru
    res.set('X-Attribution', 'Data: Sky Guide (https://sky-guide.ru)');
    res.set('Link', '</api-terms>; rel="terms-of-service"');
    res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'X-API-Key, X-Lang, Content-Type', 'Access-Control-Expose-Headers': 'X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After, X-Attribution, Link', 'Access-Control-Max-Age': '86400' });
    res.vary('X-Lang');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'METHOD', 'В /v1 только чтение (GET)');
    next();
  });

  // Ключ: есть заголовок — проверяем всегда (неверный ключ = 403, даже на открытых ручках, чтобы ошибку было видно сразу)
  r.use((req, res, next) => {
    const raw = req.get('X-API-Key');
    if (raw == null || raw === '') { req.v1Key = null; return next(); }
    const c = d.keys.check(raw);
    if (!c.ok) return fail(res, 403, c.code, c.code === 'REVOKED' ? 'Ключ отозван' : 'Неверный ключ API');
    req.v1Key = c.key;
    next();
  });

  // Лимиты: с ключом — лимит ключа в минуту, без ключа — общий лимит с одного адреса
  r.use((req, res, next) => {
    let max, wait, left;
    if (req.v1Key) {
      max = req.v1Key.perMin;
      const now = Date.now();
      let e = keyHits.get(req.v1Key.id);
      if (!e || e.until <= now) { e = { n: 0, until: now + 60_000 }; keyHits.set(req.v1Key.id, e); }
      e.n++;
      wait = e.n <= max ? 0 : Math.ceil((e.until - now) / 1000);
      left = Math.max(0, max - e.n);
    } else {
      max = d.openPerMin || 120;
      wait = openLimit.hit(d.clientIp(req));
    }
    res.set('X-RateLimit-Limit', String(max));
    if (left != null) res.set('X-RateLimit-Remaining', String(left));
    if (wait) return res.set('Retry-After', String(wait)).status(429).json({ error: `Слишком много запросов. Подожди ${wait} с`, code: 'RATE' });
    next();
  });

  const open = (req, res, next) => (d.open() || req.v1Key ? next() : fail(res, 401, 'NO_KEY', 'Нужен ключ API (заголовок X-API-Key)'));
  // Данные игроков — только собственным клиентам Sky Guide (ключ с отметкой players): правила Hypixel
  // запрещают отдавать данные их API сторонним разработчикам
  const needKey = (req, res, next) => (!req.v1Key ? fail(res, 401, 'NO_KEY', 'Данные игроков — только по ключу API (заголовок X-API-Key)')
    : req.v1Key.players ? next()
      : fail(res, 403, 'NO_SCOPE', 'Этот ключ не открывает данные игроков: они доступны только собственным клиентам Sky Guide. Открытые ручки работают'));
  const wrap = fn => async (req, res) => {
    try { await fn(req, res); } catch (e) {
      const [status, code] = PLAYER_ERRORS[e?.code] || [500, 'INTERNAL'];
      if (status === 500) console.warn('[v1]', req.path, e?.message || e);
      if (!res.headersSent) fail(res, status, code, status === 500 ? 'Ошибка сервера' : String(e?.message || e));
    }
  };
  const itemId = (req, res) => {
    const id = String(req.params.id || '');
    if (!ITEM_ID.test(id)) { fail(res, 400, 'BAD_ID', 'Неверный id предмета'); return null; }
    return id;
  };
  const cache = (res, s) => res.set('Cache-Control', s ? `public, max-age=${s}` : 'no-store');

  // ---------- Открытые ----------
  r.get('/version', open, (req, res) => res.json({ api: V1_VERSION, ...d.version() }));
  r.get('/status', open, (req, res) => { cache(res, 0); res.json(d.status()); });

  r.get('/items/:id', open, wrap(async (req, res) => {
    const id = itemId(req, res); if (!id) return;
    const card = await d.items.card(id, { lvl: int(req.query.lvl, 100, 1, 200) });
    if (!card) return fail(res, 404, 'NOT_FOUND', 'Предмет не найден');
    cache(res, 60); res.json(card);
  }));
  r.get('/items/:id/obtain', open, wrap(async (req, res) => {
    const id = itemId(req, res); if (!id) return;
    const g = await d.items.obtain(id);
    if (!g) return fail(res, 404, 'NOT_FOUND', 'Предмет не найден');
    cache(res, 60); res.json(g);
  }));
  r.get('/search', open, (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 80);
    if (q.length < 2) return fail(res, 400, 'BAD_QUERY', 'Запрос — от 2 символов (параметр q)');
    cache(res, 300); res.json({ query: q, items: d.items.search(q, int(req.query.limit, 20, 1, 100)) });
  });

  const listQuery = q => ({ q: q.q ? String(q.q).slice(0, 80) : '', sort: q.sort ? String(q.sort) : '', cat: q.cat ? String(q.cat) : '', rarity: q.rarity ? String(q.rarity) : '',
    offset: int(q.offset, 0, 0, 100_000), limit: int(q.limit, 50, 1, 200), ids: q.ids ? String(q.ids).split(',').filter(Boolean).slice(0, 200) : null });
  r.get('/bazaar', open, (req, res) => { cache(res, 30); res.json(d.market.bazaar(listQuery(req.query))); });
  r.get('/auctions', open, (req, res) => { cache(res, 30); res.json(d.market.auctions(listQuery(req.query))); });
  r.get('/market/candles/:id', open, wrap(async (req, res) => {
    const id = itemId(req, res); if (!id) return;
    const market = req.query.market === 'ah' ? 'ah' : 'bazaar';
    const out = await d.market.candles(id, { market, tf: String(req.query.tf || '1h'), limit: int(req.query.limit, 500, 10, 3000), to: req.query.to ? Number(req.query.to) : Infinity });
    if (!out) return fail(res, 404, 'NOT_FOUND', 'Нет свечей для этого предмета');
    cache(res, 0); res.json(out);
  }));
  r.get('/flips/:kind', open, (req, res) => {
    const kind = String(req.params.kind);
    if (!FLIPS.includes(kind)) return fail(res, 404, 'NOT_FOUND', `Флипы бывают: ${FLIPS.join(', ')}`);
    cache(res, 30);
    res.json({ kind, items: d.market.flips(kind, { limit: int(req.query.limit, 40, 1, 200), max: req.query.max ? Number(req.query.max) : Infinity }) });
  });
  r.get('/calendar', open, (req, res) => { cache(res, 60); res.json(d.calendar(req.query.year)); });
  r.get('/mining-events', open, async (req, res) => {
    const v = await d.miningEvents().catch(() => null);
    cache(res, 30); res.json(v || { at: null, islands: [] });
  });
  r.get('/leaderboard', open, (req, res) => {
    cache(res, 60);
    res.json(d.leaderboard({ board: String(req.query.board || 'networth'), mode: String(req.query.mode || 'all'), limit: int(req.query.limit, 100, 1, 100), find: String(req.query.find || '').slice(0, 36) }));
  });
  r.get('/guides', open, (req, res) => { cache(res, 300); res.json(d.guides.list()); });
  r.get('/guides/:id', open, (req, res) => {
    const id = String(req.params.id);
    const g = GUIDE_ID.test(id) ? d.guides.get(id) : null;
    if (!g) return fail(res, 404, 'NOT_FOUND', 'Гайд не найден — список на /v1/guides');
    cache(res, 300); res.json(g);
  });
  r.get('/quotes', open, (req, res) => {
    const ids = String(req.query.ids || '').split(',').map(x => x.trim()).filter(x => ITEM_ID.test(x)).slice(0, 200);
    if (!ids.length) return fail(res, 400, 'BAD_QUERY', 'Нужен параметр ids=A,B (до 200 id)');
    cache(res, 30); res.json(d.quotes(ids));
  });
  r.get('/market/trend/:id', open, (req, res) => {
    const id = itemId(req, res); if (!id) return;
    const t = d.trend(id);
    if (!t?.market) return fail(res, 404, 'NOT_FOUND', 'Нет цены этого предмета на Bazaar и аукционе');
    cache(res, 60); res.json(t);
  });
  r.get('/market/movers', open, (req, res) => { cache(res, 60); res.json(d.movers(req.query.period === 'd7' ? 'd7' : 'd1')); });
  r.get('/market/crops', open, (req, res) => {
    const num = (v, min, max) => (v == null || v === '' || !Number.isFinite(Number(v)) ? undefined : Math.max(min, Math.min(max, Number(v))));
    cache(res, 60); res.json(d.crops({ fortune: num(req.query.fortune, 0, 5000), bps: num(req.query.bps, 1, 40) }));
  });
  r.get('/items/:id/image', open, wrap(async (req, res) => {
    const id = itemId(req, res); if (!id) return;
    const buf = await d.image(id);
    if (!buf) return fail(res, 404, 'NOT_FOUND', 'Нет картинки для этого предмета');
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }).send(buf);
  }));
  r.get('/refs/lexicon', open, (req, res) => { const l = d.lexicon(); cache(res, l.ready ? 3600 : 0); res.json(l); });
  r.get('/news', open, (req, res) => { cache(res, 300); res.json(d.news()); });

  // ---------- Игроки (только по ключу) ----------
  async function view(req, res, { exact = true } = {}) {
    const name = String(req.params.name || '');
    if (!NICK.test(name)) { fail(res, 400, 'BAD_NAME', 'Ник Minecraft: латиница, цифры и _, до 16 символов'); return null; }
    if (d.players.hidden(name)) { fail(res, 404, 'HIDDEN', 'Игрок попросил не показывать его профиль'); return null; }
    const raw = req.params.profile == null ? '' : String(req.params.profile);
    const profile = raw === 'selected' ? '' : raw.slice(0, 40);
    const v = await d.players.view({ player: name, profile });
    if (!v.member && exact) {
      if (v.error) fail(res, 503, 'HYPIXEL_UNAVAILABLE', 'Hypixel не ответил, профиль пока не загружен. Повтори через минуту', { retryAfter: 60 });
      else fail(res, 503, 'LOADING', 'Профиль ещё загружается, повтори через минуту', { retryAfter: 30 });
      return null;
    }
    if (exact && profile && v.missingProfile) { fail(res, 404, 'NO_PROFILE', `У игрока нет профиля «${profile}»`, { profiles: (v.profiles || []).map(p => p.name) }); return null; }
    return v;
  }
  r.get('/players/:name/profiles', needKey, wrap(async (req, res) => {
    const v = await view(req, res, { exact: false }); if (!v) return;
    cache(res, 0);
    res.json({ player: { name: v.player?.name || req.params.name, uuid: v.player?.uuid || null }, profiles: (v.profiles || []).map(p => ({ id: p.id, name: p.name, selected: !!p.selected, mode: p.mode || 'normal', members: p.members || 1 })) });
  }));
  for (const part of ['summary', 'money']) {
    r.get(`/players/:name/profiles/:profile/${part}`, needKey, wrap(async (req, res) => {
      const v = await view(req, res); if (!v) return;
      cache(res, 0); res.json(d[part](v));
    }));
  }
  r.get('/players/:name/profiles/:profile/plan', needKey, wrap(async (req, res) => {
    const v = await view(req, res); if (!v) return;
    const out = d.plan(v);
    const cat = req.query.cat ? String(req.query.cat).toLowerCase() : '';
    if (cat) out.steps = out.steps.filter(s => String(s.cat).toLowerCase() === cat);
    if (req.query.limit != null) out.steps = out.steps.slice(0, int(req.query.limit, 100, 1, 100));
    cache(res, 0); res.json(out);
  }));

  // Готовые разборы: у профиля их может не быть (Hypixel не отдал инвентарь) — тогда 404 NO_DATA
  const noData = res => fail(res, 404, 'NO_DATA', 'Для этого профиля нет таких данных: игрок закрыл инвентарь в настройках API SkyBlock');
  const part = (path, fn) => r.get(`/players/:name/profiles/:profile/${path}`, needKey, wrap(async (req, res) => {
    const v = await view(req, res); if (!v) return;
    const out = await fn(v, req, res);
    if (res.headersSent) return;
    if (out == null) return noData(res);
    cache(res, 0); res.json(out);
  }));
  part('accessories', (v, req) => d.accessories(v, { limit: int(req.query.limit, 20, 1, 200) }));
  part('accessories/missing', (v, req, res) => {
    const sort = req.query.sort ? String(req.query.sort) : 'perMp';
    if (!MISSING_SORTS.includes(sort)) return fail(res, 400, 'BAD_QUERY', `sort бывает: ${MISSING_SORTS.join(', ')}`);
    const maxPrice = req.query.maxPrice != null && req.query.maxPrice !== '' ? Number(req.query.maxPrice) : Infinity;
    if (Number.isNaN(maxPrice) || maxPrice < 0) return fail(res, 400, 'BAD_QUERY', 'maxPrice — число монет');
    return d.missing(v, { sort, maxPrice, limit: int(req.query.limit, 50, 1, 500), upgrades: req.query.upgrades !== '0' && req.query.upgrades !== 'false' });
  });
  part('networth', (v, req) => d.networth(v, { limit: int(req.query.limit, 10, 1, 50) }));
  // Свои лоты AH и ставки: Hypixel спрашивается не чаще раза в 3 минуты на игрока, ордеров Bazaar в API Hypixel нет
  part('auctions', v => d.auctions(v));
  part('items/:id/upgrades', (v, req, res) => {
    const id = itemId(req, res); if (!id) return null;
    return { player: { name: v.player?.name || null, uuid: v.player?.uuid || null }, profile: v.member?.profileName || null, updatedAt: v.updatedAt || 0, id, copies: d.upgrades(v, id) || [] };
  });

  // Разделы сайта для игрока: те же ответы, что видит страница раздела
  for (const name of SECTIONS) part(name, (v, req) => d.section(name, v, { bits: req.query.bits, fame: req.query.fame }));
  part('guides/:id', (v, req, res) => {
    const id = String(req.params.id);
    const g = GUIDE_ID.test(id) ? d.guide(id, v) : null;
    if (!g) { fail(res, 404, 'NOT_FOUND', 'Гайд не найден — список в …/guides'); return null; }
    return g;
  });
  part('history', (v, req, res) => {
    const range = req.query.range == null ? 'all' : String(req.query.range);
    if (!(range in RANGES)) { fail(res, 400, 'BAD_QUERY', `range бывает: ${Object.keys(RANGES).join(', ')}`); return null; }
    return { player: { name: v.player?.name || null, uuid: v.player?.uuid || null }, profile: v.member?.profileName || null, range, ...d.history(v, RANGES[range]) };
  });

  // Сравнение: ?p=Ник/Профиль (2–4 раза). Ошибка одного игрока не ломает ответ — у него будет error и code
  r.get('/compare', needKey, wrap(async (req, res) => {
    const raw = [].concat(req.query.p || []).map(String).filter(Boolean);
    if (!raw.length || raw.length > 4) return fail(res, 400, 'BAD_QUERY', 'Параметр p=Ник или p=Ник/Профиль — от 1 до 4 раз');
    const players = await Promise.all(raw.map(async s => {
      const [player, profile = ''] = s.split('/').map(x => x.trim());
      const query = { player, profile: profile === 'selected' ? '' : profile.slice(0, 40) };
      const err = (code, error) => ({ query, error, code });
      if (!NICK.test(player)) return err('BAD_NAME', 'Ник Minecraft: латиница, цифры и _, до 16 символов');
      if (d.players.hidden(player)) return err('HIDDEN', 'Игрок попросил не показывать его профиль');
      try {
        const v = await d.players.view(query);
        if (!v.member) return v.error ? err('HYPIXEL_UNAVAILABLE', 'Hypixel не ответил, повтори через минуту') : err('LOADING', 'Профиль ещё загружается, повтори через минуту');
        if (query.profile && v.missingProfile) return err('NO_PROFILE', `У игрока нет профиля «${query.profile}»`);
        return d.summary(v);
      } catch (e) {
        const [, code] = PLAYER_ERRORS[e?.code] || [500, 'INTERNAL'];
        if (code === 'INTERNAL') console.warn('[v1] compare', e?.message || e);
        return err(code, code === 'INTERNAL' ? 'Ошибка сервера' : String(e?.message || e));
      }
    }));
    cache(res, 0); res.json({ players, at: Date.now() });
  }));

  r.use((req, res) => fail(res, 404, 'NOT_FOUND', 'Нет такого адреса в /v1 — список на /api/docs'));
  return r;
}
