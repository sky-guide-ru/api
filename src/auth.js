// Вход на сайт: ник Minecraft + пароль ОТ ЭТОГО САЙТА (аккаунты — server/users.js).
//
// Нет ни одного пароля (нет SITE_PASSWORD и аккаунтов с паролем) → сайт открыт только на этом ПК,
//   запросы через туннель/прокси блокируются (чтобы случайно не открыть профиль и ключи всему миру).
// Пароли есть → все страницы и /api требуют входа. С самого ПК (localhost без прокси) пускает
//   как владельца без пароля, если AUTH_LOCAL не равен 0.
//
// Открытый просмотр (PUBLIC_VIEW, по умолчанию включён; PUBLIC_VIEW=0 — выключить): гость без входа
//   вводит ник и смотрит любой профиль, как на SkyCrypt. Гостю можно только читать (GET) и обновить профиль;
//   советчик (/api/live), отметки, /account и всё, что тратит деньги или меняет данные, — только после входа.
//
// Владелец (PLAYER) — администратор: на /account создаёт аккаунты друзьям и выдаёт им пароли.
// Каждый друг после входа видит СВОЙ профиль как «свой сайт».
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { EventEmitter } from 'node:events';
import { createUserStore, generatePassword, MIN_PASSWORD, validNick, fixNick, cleanPastedPassword } from './users.js';
import { isEn } from '@sky-guide/core/i18n/lang.js';
import { tx } from '@sky-guide/core/i18n/msg.js';
import { DEFAULT_KEY_PER_MIN } from './v1/keys.js';

const COOKIE = 'sb_auth';
const ME_COOKIE = 'sb_me';   // кто вошёл — для интерфейса (не секрет, без него вход не работает)
const DAYS = 30;
const RENEW_AFTER = 86400_000; // вход продлевается сам (не чаще раза в сутки), пока человек заходит на сайт
const MAX_FAILS = 10;        // с одного IP
const MAX_NAME_FAILS = 30;   // на один ник со всех IP (подбор с разных адресов)
const FAIL_WINDOW = 15 * 60_000;

// Свой прокси: тот же компьютер или частная сеть (Docker, домашняя сеть). TRUST_PROXY=0 — не верить никому
export function trustedPeer(addr, env = process.env) {
  if (env.TRUST_PROXY === '0') return false;
  const a = String(addr || '').replace(/^::ffff:/, '');
  return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a) || a === '::1' || /^f[cd][0-9a-f]{2}:/i.test(a);
}

function loadSecret(env, dataDir) {
  if (env.SESSION_SECRET) return crypto.createHash('sha256').update(`v2:${env.SESSION_SECRET}`).digest();
  if (dataDir) {
    const f = path.join(dataDir, 'session-secret');
    try { const b = Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'base64'); if (b.length >= 32) return b; } catch { /* создадим */ }
    const b = crypto.randomBytes(32);
    try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(f, b.toString('base64'), { mode: 0o600 }); } catch (e) { console.warn('[вход] секрет сессий не сохранён, после перезапуска придётся войти заново:', e.message); }
    return b;
  }
  return crypto.randomBytes(32);
}

/**
 * @param {Object} [env]
 * @param {{ dataDir?: string|null, users?: ReturnType<typeof createUserStore>, clock?: () => number }} [o]
 */
export function createAuth(env = process.env, o = {}) {
  const dataDir = o.dataDir ?? null;
  const clock = o.clock || (() => Date.now());
  const apiKeys = o.apiKeys || null; // ключи /v1 для своих бота и мода (src/v1/keys.js): выдаёт владелец на /account
  const sitePassword = String(env.SITE_PASSWORD || '');
  const users = o.users || createUserStore({ file: dataDir ? path.join(dataDir, 'users.json') : null, ownerName: (env.PLAYER || 'Steve').trim(), sitePassword });
  const localBypass = env.AUTH_LOCAL !== '0';
  const publicView = env.PUBLIC_VIEW !== '0';
  const secret = loadSecret(env, dataDir);
  // Cookie старого входа «только пароль»: пускаем владельца, пока он не сменил пароль, и тихо меняем на новую
  const legacySecret = sitePassword ? crypto.createHmac('sha256', String(env.SESSION_SECRET || 'skyblock-tracker')).update(sitePassword).digest() : null;
  const ipFails = new Map(), nameFails = new Map(); // ключ → { n, until }
  const flashes = new Map(); // одноразовые сообщения для /account (выданный пароль показываем один раз)

  const b64 = s => Buffer.from(s, 'utf8').toString('base64url');
  const unb64 = s => { try { return Buffer.from(s, 'base64url').toString('utf8'); } catch { return ''; } };
  const hmac = (key, s) => crypto.createHmac('sha256', key).update(s).digest('base64url');
  const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

  // Поколение входа: версия (растёт при смене пароля и «выйти везде») + sid аккаунта (новый у пересозданного)
  const gen = u => `${u.ver || 1}-${u.sid || ''}`;
  function makeToken(u, now = clock()) {
    const body = `${b64(u.name)}.${gen(u)}.${now + DAYS * 86400_000}`;
    return `v2.${body}.${hmac(secret, body)}`;
  }
  function userFromToken(tok, now = clock()) {
    const parts = String(tok || '').split('.');
    if (parts[0] === 'v2' && parts.length === 5) {
      const [, n, ver, exp, sig] = parts;
      if (Number(exp) < now || !eq(sig, hmac(secret, `${n}.${ver}.${exp}`))) return null;
      const u = users.get(unb64(n));
      return u && eq(gen(u), ver) ? { u, exp: Number(exp) } : null;
    }
    if (parts.length === 2 && legacySecret) {
      const [exp, sig] = parts;
      const owner = users.get(users.ownerName());
      if (!owner?.legacy || Number(exp) < now || !eq(sig, hmac(legacySecret, String(exp)))) return null;
      return { u: owner, legacy: true };
    }
    return null;
  }

  const proxied = req => !!(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.headers['x-real-ip']);
  // Адрес посетителя из заголовков прокси верим, только если запрос пришёл от своего прокси: туннель на этом ПК
  // (127.0.0.1) или Caddy в сети Docker (частный адрес). Иначе любой подставил бы «X-Forwarded-For: 1.2.3.4»
  // и обходил лимиты попыток входа и ников, каждый раз притворяясь новым адресом
  const clientIp = req => {
    const peer = String(req.socket?.remoteAddress || '');
    if (!trustedPeer(peer)) return peer;
    return String(req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0] || peer).trim();
  };
  const isLocal = req => !proxied(req) && /^(127\.|::1$|::ffff:127\.)/.test(req.socket.remoteAddress || '');
  const isHttps = req => req.secure || req.headers['x-forwarded-proto'] === 'https';
  function readCookie(req, name = COOKIE) {
    for (const part of String(req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0 && part.slice(0, i).trim() === name) { try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; } }
    }
    return null;
  }
  const safeNext = n => (typeof n === 'string' && /^\/(?!\/)/.test(n) && !/^\/(login|logout)/.test(n) && !n.includes('\\') ? n : '/');
  const enabled = () => users.anyPassword();

  function cookieParts(req, name, value, { httpOnly = true, maxAge = DAYS * 86400 } = {}) {
    const p = [`${name}=${value}`, 'Path=/', 'SameSite=Lax', `Max-Age=${maxAge}`];
    if (httpOnly) p.push('HttpOnly');
    if (isHttps(req)) p.push('Secure');
    return p.join('; ');
  }
  // l: 1 — вход с самого ПК без пароля: в интерфейсе «Выйти» там ничего не делает, поэтому его прячем
const meValue = (u, local = false) => encodeURIComponent(JSON.stringify({ n: u.name, r: u.role, p: u.profile || '', ...(local ? { l: 1 } : {}) }));
  function loginCookies(req, u) {
    return [cookieParts(req, COOKIE, makeToken(u)), cookieParts(req, ME_COOKIE, meValue(u), { httpOnly: false })];
  }
  const clearCookies = req => [cookieParts(req, COOKIE, '', { maxAge: 0 }), cookieParts(req, ME_COOKIE, '', { httpOnly: false, maxAge: 0 })];

  /** Кто делает запрос: { u, legacy?, local? } или null */
  function whoIs(req) {
    const t = userFromToken(readCookie(req));
    if (t) return t;
    if (isLocal(req) && (localBypass || !enabled())) return { u: users.get(users.ownerName()), local: true };
    return null;
  }
  const view = (w) => {
    const u = w.u;
    return { name: u.name, role: u.role, admin: u.role === 'admin', owner: users.isOwner(u.name), profile: u.profile || '', dailyUsd: u.dailyUsd ?? null, local: !!w.local, mustChange: !!u.mustChange && !w.local };
  };

  function tooMany(map, k, max, now) { const f = map.get(k); return f && f.n >= max && f.until > now ? f : null; }
  function fail(map, k, now) {
    const f = map.get(k);
    const cur = f && f.until > now ? f : { n: 0, until: now + FAIL_WINDOW };
    cur.n++; map.set(k, cur);
    if (map.size > 5000) for (const [kk, v] of map) if (v.until < now) map.delete(kk);
  }

  // Формы /account и /login шлются только со своего сайта: чужая страница не может нажать кнопку за тебя
  const crossSite = req => req.headers['sec-fetch-site'] === 'cross-site';

  // События аккаунтов для других модулей: 'removed' (ник), 'renamed' (старый, новый)
  const events = new EventEmitter();
  const router = express.Router();
  const form = express.urlencoded({ extended: false, limit: '8kb' });
  router.get('/healthz', (req, res) => res.type('text').send('ok'));

  router.get('/login', (req, res) => {
    const w = whoIs(req);
    // С самого ПК без паролей вход не нужен: после «Выйти» не пугаем страницей «Доступ закрыт»
    if (!enabled()) return w?.local ? res.redirect(303, safeNext(req.query.next)) : res.status(403).type('html').send(loginPage({ blocked: true }));
    // Уже вошли (общий компьютер, закладка на /login): показываем, под кем, и даём войти под другим ником
    if (w && !w.local) return res.type('html').send(signedInPage(w.u, safeNext(req.query.next)));
    // Ошибка входа приходит сюда редиректом (POST → 303 → GET): «Назад» и «Обновить» не просят повторно отправить форму
    const name = String(req.query.name || '').trim().slice(0, 16);
    const e = String(req.query.e || '');
    // Одинаковый ответ для любого ника: по странице входа нельзя узнать, у кого на сайте есть аккаунт
    const error = e === 'bad' || e === 'nopass' ? 'Неверный ник или пароль'
      : e === 'nick' ? 'Ник пишется латиницей, как в Minecraft: буквы A–Z, цифры и _'
      : e === 'wait' ? tx`Слишком много попыток. Подожди ${Math.min(15, Math.max(1, Number(req.query.m) || 15))} мин.` : '';
    res.status(error ? (e === 'wait' ? 429 : 401) : 200).type('html').send(loginPage({ next: safeNext(req.query.next), name, error, local: !!w?.local, guest: publicView }));
  });
  const loginAgain = (res, { next, name, e, m }) => {
    const q = new URLSearchParams({ e });
    if (name) q.set('name', name);
    if (next && next !== '/') q.set('next', next);
    if (m) q.set('m', String(m));
    res.redirect(303, `/login?${q}`);
  };

  router.post('/login', form, async (req, res) => {
    if (!enabled()) return res.status(403).type('html').send(loginPage({ blocked: true }));
    if (crossSite(req)) return res.status(403).type('text').send('Вход только со страницы сайта');
    const ip = clientIp(req), now = clock();
    const next = safeNext(req.body?.next);
    // Пустой ник — как раньше: только пароль владельца (старые закладки и менеджеры паролей).
    // Ник в русской раскладке («Акшутв4шл»), с @ или пробелами — понимаем как латиницу
    const name = fixNick(String(req.body?.name || '').slice(0, 40)).slice(0, 32) || users.ownerName();
    const password = String(req.body?.password || '');
    const shown = String(req.body?.name || '').trim().slice(0, 16);
    const lim = tooMany(ipFails, ip, MAX_FAILS, now) || tooMany(nameFails, name.toLowerCase(), MAX_NAME_FAILS, now);
    if (lim) {
      const min = Math.ceil((lim.until - now) / 60_000);
      return loginAgain(res, { next, name: shown, e: 'wait', m: min });
    }
    let u = validNick(name) ? await users.check(name, password) : null;
    // Временный пароль от владельца часто копируют из мессенджера с пробелом или вместе с «Пароль:»
    if (!u && validNick(name) && users.get(name)?.mustChange) {
      const clean = cleanPastedPassword(password);
      if (clean && clean !== password) u = await users.check(name, clean);
    }
    if (!u) {
      fail(ipFails, ip, now); fail(nameFails, name.toLowerCase(), now);
      return loginAgain(res, { next, name: shown, e: !validNick(name) ? 'nick' : 'bad' });
    }
    ipFails.delete(ip); nameFails.delete(name.toLowerCase());
    users.touchLogin(u.name);
    console.log(`[вход] ${u.name} вошёл`); // адрес посетителя в журналы не пишем
    res.set('Set-Cookie', loginCookies(req, u)).redirect(303, u.mustChange ? `/account?must=1${next !== '/' ? `&next=${encodeURIComponent(next)}` : ''}` : next);
  });

  // Выход — только кнопкой (POST со своего сайта). Ссылка, картинка или закладка /logout лишь спрашивают «выйти?»
  router.get('/logout', (req, res) => {
    const w = whoIs(req);
    if (!w || w.local) return res.redirect(303, '/');
    res.set('Cache-Control', 'no-store').type('html').send(shell('Выход', tx`
      <div class="who"><img src="${head(w.u.name)}" alt=""><div><h1>Выйти из ${esc(w.u.name)}?</h1><div class="muted">На других устройствах вход останется</div></div></div>
      <form method="post" action="/logout"><button type="submit">Выйти</button></form>
      <a class="btn ghost" href="/">← Остаться на сайте</a>`));
  });
  router.post('/logout', form, (req, res) => {
    if (crossSite(req)) return res.redirect(303, '/');
    res.set('Set-Cookie', clearCookies(req)).redirect(303, '/login');
  });

  // Что гостю можно без входа: чтение страниц и /api, кроме советчика и аккаунта; из POST — только иконки, «Обновить» и «Убрать меня из рейтинга»
  const GUEST_POST = new Set(['/api/icons', '/api/refresh', '/api/leaderboard/remove', '/api/feedback', '/api/survey/answer']);
  function guestAllowed(req) {
    if (!publicView) return false;
    // Express сравнивает маршруты без учёта регистра (/api/Live = /api/live) — сравниваем так же
    const p = req.path.toLowerCase();
    if (p.startsWith('/account') || p.startsWith('/api/live')) return false;
    if (req.method === 'GET' || req.method === 'HEAD') return true;
    return req.method === 'POST' && GUEST_POST.has(p);
  }
  const GUEST_ME = encodeURIComponent(JSON.stringify({ g: 1 }));

  // ---------- Проверка входа для всего остального ----------
  router.use((req, res, next) => {
    const w = whoIs(req);
    if (!w && guestAllowed(req)) {
      req.sbUser = null; req.sbGuest = true;
      // Интерфейс узнаёт гостя по cookie sb_me = {g:1}: показывает поле для ника и кнопку «Войти»
      if (!req.path.startsWith('/api') && readCookie(req, ME_COOKIE) !== decodeURIComponent(GUEST_ME)) res.append('Set-Cookie', cookieParts(req, ME_COOKIE, GUEST_ME, { httpOnly: false }));
      return next();
    }
    if (!w) {
      if (!enabled()) {
        const msg = 'Доступ из сети закрыт: задай пароль (SITE_PASSWORD в .env или на странице /account с этого ПК)';
        return req.path.startsWith('/api') ? res.status(403).json({ error: msg }) : res.status(403).type('html').send(loginPage({ blocked: true }));
      }
      if (req.path.startsWith('/api')) return res.status(401).json({ error: 'Нужен вход', login: '/login' });
      return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    }
    req.sbUser = view(w);
    // Старая cookie владельца или устаревшая подпись интерфейса — выдаём новые без повторного входа
    const set = [];
    if (w.legacy || (w.exp && w.exp - clock() < DAYS * 86400_000 - RENEW_AFTER)) set.push(...loginCookies(req, w.u));
    else if (!req.path.startsWith('/api') && readCookie(req, ME_COOKIE) !== decodeURIComponent(meValue(w.u, w.local))) set.push(cookieParts(req, ME_COOKIE, meValue(w.u, w.local), { httpOnly: false }));
    if (set.length) res.append('Set-Cookie', set);
    // Временный пароль от владельца — сначала придумать свой
    if (req.sbUser.mustChange && !req.path.startsWith('/account')) {
      if (req.path.startsWith('/api')) return res.status(403).json({ error: 'Сначала придумай свой пароль', mustChange: true, login: '/account?must=1' });
      return res.redirect('/account?must=1');
    }
    next();
  });

  router.get('/api/me', (req, res) => {
    if (req.sbGuest) return res.json({ guest: true, name: null, admin: false, users: [] });
    const me = req.sbUser;
    // Список аккаунтов (ники друзей) — только владельцу: друзья анонимны, друг видит лишь себя
    res.json({ ...me, users: me.admin ? users.list().map(u => ({ name: u.name, profile: u.profile, role: u.role })) : [] });
  });

  // ---------- Аккаунт: смена пароля, выход; для владельца — друзья ----------
  const back = (res, msg, kind = 'ok', next = '') => {
    const id = crypto.randomBytes(9).toString('base64url');
    flashes.set(id, { msg, kind, at: clock(), next: next && next !== '/' ? next : '' });
    for (const [k, v] of flashes) if (clock() - v.at > 10 * 60_000) flashes.delete(k);
    res.redirect(303, `/account?f=${id}`);
  };
  const adminOnly = (req, res, next) => (req.sbUser?.admin ? next() : res.status(403).type('html').send(accountPage({ me: req.sbUser, flash: { kind: 'err', msg: 'Это может только владелец сайта' } })));
  const noCross = (req, res, next) => (crossSite(req) ? res.status(403).type('text').send('Запрос с чужого сайта') : next());

  router.get('/account', (req, res) => {
    const f = req.query.f && flashes.get(String(req.query.f));
    if (f) flashes.delete(String(req.query.f));
    res.set('Cache-Control', 'no-store').type('html').send(accountPage({
      me: req.sbUser, must: req.sbUser.mustChange, flash: f || null, next: f?.next || (req.query.next ? safeNext(String(req.query.next)) : ''), hasPassword: !!users.get(req.sbUser.name)?.hash,
      needConsent: !req.sbUser.owner && !users.get(req.sbUser.name)?.consentAt,
      users: req.sbUser.admin ? users.list() : null, keys: req.sbUser.admin && apiKeys ? apiKeys.list() : null, origin: `${isHttps(req) ? 'https' : 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}`,
    }));
  });

  // Смены пароля одного аккаунта идут по очереди: двойное нажатие «Сохранить» не должно выкинуть из аккаунта
  const pwQueue = new Map();
  router.post('/account/password', form, noCross, (req, res) => {
    const key = req.sbUser.name.toLowerCase();
    const run = (pwQueue.get(key) || Promise.resolve()).then(() => changePassword(req, res)).catch(e => { if (!res.headersSent) back(res, e.message, 'err'); });
    pwQueue.set(key, run);
    run.finally(() => { if (pwQueue.get(key) === run) pwQueue.delete(key); });
  });
  async function changePassword(req, res) {
    const me = req.sbUser, u = users.get(me.name);
    if (!u) return res.redirect(303, '/login');
    const { current = '', password = '', password2 = '', consent = '' } = req.body || {};
    const next = req.body?.next ? safeNext(String(req.body.next)) : '';
    // Друг даёт согласие на обработку данных (152-ФЗ, отдельный документ /consent) при первой смене пароля
    const needConsent = !me.owner && !u.consentAt;
    if (needConsent && consent !== '1') return back(res, 'Чтобы пользоваться аккаунтом, отметь согласие на обработку данных', 'err', next);
    if (password !== password2) return back(res, 'Новые пароли не совпадают', 'err', next);
    // Повтор той же формы (двойное нажатие, «Назад» и снова «Сохранить») — пароль уже такой, просто подтверждаем
    if (u.hash && !u.mustChange && u.passwordAt && clock() - u.passwordAt < 5 * 60_000 && await users.check(u.name, password)) {
      res.set('Set-Cookie', loginCookies(req, u));
      return back(res, 'Пароль сохранён. На других устройствах нужно будет войти заново.', 'ok', next);
    }
    // Временный пароль только что введён на странице входа — второй раз его не спрашиваем.
    // С самого ПК (вход без пароля) можно задать или сбросить пароль владельца, не зная старого
    const askCurrent = u.hash && !me.local && !u.mustChange;
    if (askCurrent && !(await users.check(u.name, current))) return back(res, 'Текущий пароль не подходит', 'err', next);
    if (u.hash && !me.local && (u.mustChange ? await users.check(u.name, password) : current === password)) {
      return back(res, u.mustChange ? 'Придумай новый пароль: временный от владельца не подойдёт' : 'Новый пароль должен отличаться от старого', 'err', next);
    }
    try { await users.setPassword(u.name, password); } catch (e) { return back(res, e.message, 'err', next); }
    if (needConsent) users.recordConsent(u.name);
    console.log(`[вход] ${u.name} сменил пароль`);
    res.set('Set-Cookie', loginCookies(req, users.get(u.name)));
    back(res, 'Пароль сохранён. На других устройствах нужно будет войти заново.', 'ok', next);
  }

  router.post('/account/logout-all', form, noCross, (req, res) => {
    users.bumpVersion(req.sbUser.name);
    res.set('Set-Cookie', clearCookies(req)).redirect(303, '/login');
  });

  // Профиль друга с опечаткой («Papya») раньше молча подменялся основным: сверяем со списком его профилей
  let profileLookup = null; // (ник) → Promise<string[]> — названия профилей SkyBlock игрока; подключает server/index.js
  async function checkProfile(u) {
    if (!u?.profile || !profileLookup) return { u, note: '' };
    const names = await Promise.race([profileLookup(u.name).catch(() => null), new Promise(r => setTimeout(() => r(null), 6000))]);
    if (!Array.isArray(names) || !names.length) return { u, note: '' }; // Hypixel не ответил — не мешаем сохранить
    const hit = names.find(n => n.toLowerCase() === u.profile.toLowerCase());
    if (hit) return { u: hit !== u.profile ? users.update(u.name, { profile: hit }) : u, note: '' };
    return { u, note: tx`У ${u.name} нет профиля «${u.profile}», поэтому сайт покажет основной. Его профили: ${names.join(', ')}.` };
  }

  router.post('/account/users', form, noCross, adminOnly, async (req, res) => {
    try {
      const { u, note } = await checkProfile(users.add({ name: req.body?.name, profile: req.body?.profile }));
      back(res, tx`Аккаунт ${u.name} создан. Нажми «Выдать пароль» и отправь пароль другу.${note ? ` ⚠️ ${note}` : ''}`, note ? 'warn' : 'ok');
    } catch (e) { back(res, e.message, 'err'); }
  });
  router.post('/account/users/reset', form, noCross, adminOnly, async (req, res) => {
    const name = String(req.body?.name || '');
    if (users.isOwner(name)) return back(res, 'Свой пароль меняй в блоке «Мой пароль»', 'err');
    try {
      const pw = generatePassword();
      const u = await users.setPassword(name, pw, { mustChange: true });
      console.log(`[вход] владелец выдал новый пароль для ${u.name}`);
      back(res, { password: pw, name: u.name }, 'password');
    } catch (e) { back(res, e.message, 'err'); }
  });
  router.post('/account/users/update', form, noCross, adminOnly, async (req, res) => {
    try {
      let name = String(req.body?.name || '');
      const old = name;
      // Опечатка в нике друга: исправляем, не удаляя аккаунт (пароль тот же, войти нужно заново)
      if (req.body?.newName && String(req.body.newName).trim() !== name) { name = users.rename(name, req.body.newName).name; if (name !== old) events.emit('renamed', old, name); }
      const { u, note } = await checkProfile(users.update(name, { profile: req.body?.profile, dailyUsd: req.body?.dailyUsd }));
      const renamed = old !== u.name ? tx`Ник исправлен: ${old} → ${u.name}. Другу нужно войти заново с новым ником (пароль тот же). ` : '';
      back(res, note ? tx`${renamed}Сохранено, но проверь профиль. ${note}` : renamed ? renamed.trim() : tx`Сохранено: ${u.name}`, note ? 'warn' : 'ok');
    } catch (e) { back(res, e.message, 'err'); }
  });
  router.post('/account/users/delete', form, noCross, adminOnly, (req, res) => {
    try {
      const name = String(req.body?.name || '');
      users.remove(name);
      events.emit('removed', name); // вместе с аккаунтом стираем историю его чата с советчиком
      back(res, tx`Аккаунт ${name} удалён вместе с историей его чата с советчиком`);
    } catch (e) { back(res, e.message, 'err'); }
  });

  // Ключи API (/v1): выдать (ключ показывается один раз) и отозвать — только владелец
  router.post('/account/api-keys', form, noCross, adminOnly, (req, res) => {
    if (!apiKeys) return back(res, 'Ключи API на этом сервере выключены', 'err');
    try {
      const k = apiKeys.create({ name: req.body?.name, perMin: req.body?.perMin });
      console.log(`[ключи API] владелец выдал ключ ${k.id} «${k.name}»`);
      back(res, { key: k.key, name: k.name, perMin: k.perMin }, 'apikey');
    } catch (e) { back(res, e.message, 'err'); }
  });
  router.post('/account/api-keys/revoke', form, noCross, adminOnly, (req, res) => {
    if (!apiKeys) return back(res, 'Ключи API на этом сервере выключены', 'err');
    try {
      const k = apiKeys.revoke(req.body?.id);
      console.log(`[ключи API] владелец отозвал ключ ${k.id}`);
      back(res, tx`Ключ «${k.name}» отозван: запросы с ним больше не проходят`);
    } catch (e) { back(res, e.message, 'err'); }
  });

  return {
    router, users, events,
    /** Откуда брать названия профилей игрока для проверки на /account */
    setProfileLookup(fn) { profileLookup = fn; },
    get enabled() { return enabled(); },
    publicView, clientIp,
    /** Запрос от владельца сайта (вошёл или открыл с самого ПК) — для служебных подсказок на открытых страницах */
    isOwnerRequest: req => { const w = whoIs(req); return !!w && users.isOwner(w.u.name); },
    /** Только для владельца/админа: middleware для опасных /api-маршрутов */
    requireAdmin: (req, res, next) => (!req.sbGuest && (!req.sbUser || req.sbUser.admin) ? next() : res.status(403).json({ error: 'Это может только владелец сайта' })),
    /** Только для вошедших (гостю — 401 с адресом входа) */
    requireUser: (req, res, next) => (req.sbGuest ? res.status(401).json({ error: 'Нужен вход', login: '/login' }) : next()),
    _test: { makeToken, userFromToken, isLocal },
  };
}

// ---------- Страницы ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const head = id => `/api/head/${encodeURIComponent(id || 'MHF_Steve')}?size=64`;

const CSS = `
  *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;
  background:radial-gradient(circle at 30% 20%,#1d2b4a,#0b0f1a 60%);color:#e8ecf5;padding:24px 0}
  .card{width:min(94vw,420px);padding:30px 28px;border-radius:18px;background:rgba(20,27,45,.88);border:1px solid #2a3758;box-shadow:0 20px 60px rgba(0,0,0,.45)}
  .wide{width:min(96vw,760px)}
  h1{margin:0 0 6px;font-size:22px;background:linear-gradient(90deg,#ffaa00,#ff55ff);-webkit-background-clip:text;background-clip:text;color:transparent}
  h2{margin:26px 0 10px;font-size:16px;color:#ffd27a}
  p{margin:0 0 16px;color:#9aa6c2;line-height:1.5}code{color:#ffd27a}
  label{display:block;font-size:13px;color:#9aa6c2;margin:12px 0 6px}
  input{width:100%;padding:12px 14px;font-size:16px;border-radius:10px;border:1px solid #33416a;background:#0e1424;color:#fff;outline:none}
  input:focus{border-color:#ffaa00}
  button,.btn{display:inline-block;text-align:center;text-decoration:none;width:100%;margin-top:14px;padding:12px;font-size:15px;font-weight:600;border:0;border-radius:10px;cursor:pointer;color:#1a1200;background:linear-gradient(90deg,#ffaa00,#ffcc4d)}
  .ghost{background:transparent;color:#cfd8ee;border:1px solid #33416a}
  .danger{background:transparent;color:#ff8a8a;border:1px solid #6a3341}
  .err{margin-top:10px;color:#ff6b6b;font-size:14px}
  .note{margin-top:14px;padding:10px 12px;border-radius:10px;background:#1a2440;border:1px solid #2a3758;color:#aab6d3;font-size:13px;line-height:1.45}
  .note b{color:#ffd27a}
  .who{display:flex;align-items:center;gap:12px;margin-bottom:10px}
  .who img{width:44px;height:44px;border-radius:8px;image-rendering:pixelated;background:#0e1424}
  .flash{padding:12px 14px;border-radius:10px;margin:0 0 14px;font-size:14px;line-height:1.45}
  .flash.ok{background:#11331f;border:1px solid #1f6b3d;color:#b9f5cf}.flash.err{background:#3a1520;border:1px solid #7a2a3b;color:#ffc2c9}
  .flash.warn{background:#2c2410;border:1px solid #8a6a1a;color:#ffe7a8}
  .flash.password{background:#2c2410;border:1px solid #8a6a1a;color:#ffe7a8}
  .pw{font:600 22px ui-monospace,Menlo,Consolas,monospace;letter-spacing:1px;color:#fff;background:#0e1424;border-radius:8px;padding:10px 12px;margin:8px 0;user-select:all;display:block}
  .users{display:grid;gap:12px}
  .u{display:grid;grid-template-columns:44px 1fr;gap:12px;padding:14px;border-radius:12px;background:#121a2e;border:1px solid #26314f}
  .u img{width:44px;height:44px;border-radius:8px;image-rendering:pixelated}
  .u .row{display:flex;flex-wrap:wrap;gap:8px;align-items:end}
  .u .row>*{flex:1 1 140px}.u .row button{flex:0 0 auto;width:auto;padding:10px 14px;margin-top:0}
  .u label{margin:6px 0 4px}.u input{padding:9px 10px;font-size:14px}
  .chip{display:inline-block;font-size:12px;padding:2px 8px;border-radius:99px;margin-left:6px;background:#26314f;color:#cfd8ee}
  .chip.ok{background:#14432a;color:#a6f3c4}.chip.wait{background:#4a3a12;color:#ffe08a}.chip.admin{background:#3b1e4d;color:#f1b8ff}
  .muted{color:#7d89a8;font-size:13px}
  .links{display:flex;gap:10px;flex-wrap:wrap}.links>*{flex:1 1 160px}
  label.check{display:flex;gap:10px;align-items:flex-start;line-height:1.45;margin-top:14px}label.check input{width:auto;margin-top:3px;flex:none}
  a{color:#9fb6ff}.legal{margin-top:16px;font-size:12px;color:#7d89a8;text-align:center}.legal a{color:#7d89a8}
  form.inline{display:inline}
`;

// Кнопка формы нажимается один раз: двойной клик не отправляет форму дважды
const ONCE = `document.addEventListener('submit',e=>{const b=e.target.querySelector('button[type=submit]');if(e.defaultPrevented||!b)return;if(b.dataset.sent){e.preventDefault();return}b.dataset.sent=1;setTimeout(()=>{b.style.opacity='.6'},0);setTimeout(()=>{delete b.dataset.sent;b.style.opacity=''},8000)});`;

function shell(title, body, { wide = false, script = '' } = {}) {
  return tx`<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} · SkyBlock Трекер</title><style>${CSS}</style></head>
<body><main class="card${wide ? ' wide' : ''}">${body}<div class="legal"><a href="${isEn() ? '/en' : ''}/privacy">Конфиденциальность</a> · <a href="${isEn() ? '/en' : ''}/terms">Условия</a> · <a href="${isEn() ? '/en' : ''}/legal">Правовая информация</a></div></main><script>${ONCE}${script}</script></body></html>`;
}

// Подсказка по-русски вместо «Введите данные в указанном формате»: что не так с ником и как правильно
const LOGIN_SCRIPT = `const n=document.getElementById('name'),a=document.getElementById('av'),f=n.form;let t;
const nx=f.querySelector('[name=next]');if(location.hash.length>1&&!nx.value.includes('#'))nx.value+=location.hash;
const why=v=>{v=v.trim();if(!v)return'Впиши ник из Minecraft';if(v.includes('@'))return'Нужен ник из игры, а не почта';
if(/[А-Яа-яЁё]/.test(v))return'Ник пишется латиницей, как в игре (например, Steve)';if(/\\s/.test(v))return'В нике не бывает пробелов';
if(v.length>16)return'Ник не длиннее 16 символов';if(/[^A-Za-z0-9_]/.test(v))return'В нике только латинские буквы, цифры и _';return''};
n.addEventListener('input',()=>{n.setCustomValidity('');clearTimeout(t);t=setTimeout(()=>{const v=n.value.trim();if(/^[A-Za-z0-9_]{3,16}$/.test(v))a.src='/api/head/'+v+'?size=64'},400)});
n.addEventListener('invalid',()=>n.setCustomValidity(why(n.value)));
f.addEventListener('submit',()=>{n.value=n.value.trim();const b=f.querySelector('button[type=submit]');setTimeout(()=>{b.disabled=true;b.textContent='Вхожу…'},0)});
addEventListener('pageshow',()=>{const b=f.querySelector('button[type=submit]');b.disabled=false;b.textContent='Войти'});`;

function loginPage({ next = '/', error = '', blocked = false, name = '', local = false, guest = false }) {
  if (blocked) {
    return shell('Доступ закрыт', `<h1>Доступ закрыт</h1><p>Сайт открыт из интернета, но ни одного пароля ещё нет.<br>Открой <code>http://localhost:3000/account</code> на самом ПК и задай пароль владельца (или впиши <code>SITE_PASSWORD=...</code> в <code>.env</code> и перезапусти сервер).</p>`);
  }
  return shell('Вход', tx`
    <div class="who"><img id="av" src="${head(name || 'MHF_Steve')}" alt=""><div><h1>SkyBlock Трекер</h1><div class="muted">Вход на сайт</div></div></div>
    <form method="post" action="/login">
      <input type="hidden" name="next" value="${esc(next)}">
      <label for="name">Ник в Minecraft</label>
      <input id="name" name="name" value="${esc(name)}" placeholder="например, Steve" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="20" title="Ник латиницей, как в игре: буквы, цифры и _, до 16 символов" required ${name ? '' : 'autofocus'}>
      <label for="password">Пароль</label>
      <input id="password" type="password" name="password" placeholder="Пароль" autocomplete="current-password" required ${name ? 'autofocus' : ''}>
      ${error ? `<div class="err">${esc(error)}</div>` : ''}
      <button type="submit">Войти</button>
    </form>
    ${local ? tx`<div class="note">На этом ПК сайт открывается и без пароля. <a href="${esc(next)}" style="color:#ffd27a">Вернуться на сайт →</a></div>` : ''}
    <div class="note">🔒 Пароль от Minecraft или Microsoft здесь не нужен — не вводи его на сторонних сайтах.</div>
    ${guest ? `<a class="btn ghost" href="/">← На сайт без входа</a>` : ''}`,
  { script: LOGIN_SCRIPT });
}

function signedInPage(u, next = '/') {
  return shell('Ты уже вошёл', tx`
    <div class="who"><img src="${head(u.name)}" alt=""><div><h1>Ты уже вошёл</h1><div class="muted">как <b>${esc(u.name)}</b></div></div></div>
    <p>Если это не ты (например, за этим компьютером сидел друг), выйди и войди под своим ником.</p>
    <div class="links"><a class="btn" href="${esc(next)}">Продолжить как ${esc(u.name)}</a>
      <form method="post" action="/logout"><button type="submit" class="ghost">Войти под другим ником</button></form></div>`);
}

const when = ts => (ts ? new Date(ts).toLocaleString('ru-RU', { timeZone: process.env.LIVE_TZ || 'Europe/Moscow', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'ни разу');

function accountPage({ me, must = false, flash = null, users = null, keys = null, hasPassword = true, origin = '', next = '', needConsent = false }) {
  let fl = '';
  if (flash?.kind === 'password') {
    fl = tx`<div class="flash password">Новый пароль для <b>${esc(flash.msg.name)}</b> (показывается один раз):
      <span class="pw">${esc(flash.msg.password)}</span>
      Отправь другу: сайт <b>${esc(origin)}</b>, ник <b>${esc(flash.msg.name)}</b> и этот пароль. При первом входе сайт попросит придумать свой.
      <button type="button" class="ghost" onclick="navigator.clipboard.writeText(${esc(JSON.stringify(tx`Сайт: ${origin}\nНик: ${flash.msg.name}\nПароль: ${flash.msg.password}\n(это пароль только для сайта, не от Minecraft; после входа придумай свой)`))}).then(()=>this.textContent='Скопировано ✓')">Скопировать для друга</button></div>`;
  } else if (flash?.kind === 'apikey') {
    fl = tx`<div class="flash password">Ключ API «${esc(flash.msg.name)}» (показывается один раз, ${flash.msg.perMin} запросов в минуту):
      <span class="pw" style="font-size:15px;word-break:break-all">${esc(flash.msg.key)}</span>
      Ключ передаётся в заголовке <code>X-API-Key</code>. Храни его в настройках бота или мода, не в открытом коде.
      <button type="button" class="ghost" onclick="navigator.clipboard.writeText(${esc(JSON.stringify(flash.msg.key))}).then(()=>this.textContent='Скопировано ✓')">Скопировать ключ</button></div>`;
  } else if (flash) fl = `<div class="flash ${flash.kind === 'err' ? 'err' : flash.kind === 'warn' ? 'warn' : 'ok'}">${esc(flash.msg)}</div>`;

  const pwForm = tx`
    <h2>${must ? 'Придумай свой пароль' : hasPassword ? 'Мой пароль' : 'Задать пароль'}</h2>
    ${must ? `<p>Ты вошёл по временному паролю от владельца сайта. Придумай свой — его будешь знать только ты.</p>` : ''}
    <form method="post" action="/account/password">${next ? `<input type="hidden" name="next" value="${esc(next)}">` : ''}
      ${hasPassword && !me.local && !must ? `<label>Текущий пароль</label><input type="password" name="current" autocomplete="current-password" required>` : ''}
      <label>Новый пароль (от ${MIN_PASSWORD} символов)</label><input type="password" name="password" autocomplete="new-password" minlength="${MIN_PASSWORD}" required>
      <label>Ещё раз</label><input type="password" name="password2" autocomplete="new-password" minlength="${MIN_PASSWORD}" required>
      ${needConsent ? tx`<label class="check"><input type="checkbox" name="consent" value="1" required> Даю <a href="${isEn() ? '/en' : ''}/consent" target="_blank">согласие на обработку персональных данных</a> (ник, профиль, хеш пароля, история чата советчика) на условиях <a href="${isEn() ? '/en' : ''}/privacy" target="_blank">политики</a>. Если мне нет 14 лет — с разрешения родителя.</label>` : ''}
      <button type="submit">Сохранить пароль</button>
    </form>
    <div class="note">Это пароль только для этого сайта. <b>Не используй</b> пароль от Minecraft/Microsoft.</div>`;

  const list = users ? tx`
    <h2>Аккаунты друзей</h2>
    <p>Друг входит со своим ником и паролем, который ты ему выдашь, и видит свой профиль. Пароли хранятся только в виде хеша — даже ты их не увидишь, можно лишь выдать новый.</p>
    <div class="users">${users.map(u => tx`
      <div class="u"><img src="${head(u.name)}" alt="">
        <div>
          <div><b>${esc(u.name)}</b>${u.owner ? '<span class="chip admin">владелец</span>' : ''}${u.hasPassword ? (u.mustChange && !u.owner ? '<span class="chip wait">ещё не сменил временный пароль</span>' : '<span class="chip ok">пароль задан</span>') : '<span class="chip wait">ждёт пароль</span>'}</div>
          <div class="muted">последний вход: ${when(u.lastLoginAt)}</div>
          ${u.owner ? '' : tx`
          <form method="post" action="/account/users/update" class="row">
            <input type="hidden" name="name" value="${esc(u.name)}">
            <div><label>Ник (если ошибся)</label><input name="newName" value="${esc(u.name)}" maxlength="20" autocapitalize="off" spellcheck="false"></div>
            <div><label>Профиль SkyBlock (пусто — тот, где играет)</label><input name="profile" value="${esc(u.profile)}" maxlength="40" placeholder="Pomegranate"></div>
            <div><label>Лимит ИИ-советчика, $/день</label><input name="dailyUsd" value="${u.dailyUsd ?? ''}" inputmode="decimal" placeholder="по умолчанию"></div>
            <button type="submit" class="ghost">Сохранить</button>
          </form>
          <div class="row" style="margin-top:8px">
            <form method="post" action="/account/users/reset" class="inline"><input type="hidden" name="name" value="${esc(u.name)}"><button type="submit">${u.hasPassword ? 'Выдать новый пароль' : 'Выдать пароль'}</button></form>
            <form method="post" action="/account/users/delete" class="inline" onsubmit="return confirm('Удалить аккаунт ${esc(u.name)}? Друг больше не сможет войти, история его чата с советчиком тоже удалится.')"><input type="hidden" name="name" value="${esc(u.name)}"><button type="submit" class="danger">Удалить</button></form>
          </div>`}
        </div>
      </div>`).join('')}
    </div>
    <h2>Добавить друга</h2>
    <form method="post" action="/account/users" class="u" style="grid-template-columns:1fr">
      <div class="row">
        <div><label>Ник в Minecraft</label><input name="name" required maxlength="16" pattern="[A-Za-z0-9_]{1,16}" placeholder="Ник"></div>
        <div><label>Профиль (необязательно)</label><input name="profile" maxlength="40" placeholder="тот, где играет"></div>
        <button type="submit">Создать</button>
      </div>
    </form>` : '';

  const keyList = keys ? tx`
    <h2>Ключи API</h2>
    <p>Ключ открывает данные игроков в <a href="/api/docs/">API /v1</a> для своих клиентов: бота и мода. Предметы и рынок открыты и без ключа. Хранится только хеш: потерянный ключ можно лишь отозвать и выдать новый.</p>
    ${keys.length ? `<div class="users">${keys.map(k => tx`
      <div class="u" style="grid-template-columns:1fr">
        <div>
          <div><b>${esc(k.name)}</b> <span class="muted">sg_${esc(k.id)}_…</span>${k.revokedAt ? '<span class="chip wait">отозван</span>' : '<span class="chip ok">работает</span>'}</div>
          <div class="muted">${k.perMin} запросов в минуту · выдан ${when(k.createdAt)} · последний запрос: ${when(k.lastUsedAt)} · всего запросов: ${k.uses}</div>
          ${k.revokedAt ? '' : tx`<form method="post" action="/account/api-keys/revoke" class="inline" onsubmit="return confirm('Отозвать ключ ${esc(k.name)}? Клиент с ним сразу перестанет получать данные.')"><input type="hidden" name="id" value="${esc(k.id)}"><button type="submit" class="danger" style="width:auto;padding:8px 14px">Отозвать</button></form>`}
        </div>
      </div>`).join('')}</div>` : ''}
    <form method="post" action="/account/api-keys" class="u" style="grid-template-columns:1fr;margin-top:12px">
      <div class="row">
        <div><label>Для кого ключ</label><input name="name" required maxlength="40" placeholder="Бот Discord"></div>
        <div><label>Запросов в минуту</label><input name="perMin" inputmode="numeric" placeholder="${DEFAULT_KEY_PER_MIN}"></div>
        <button type="submit">Выдать ключ</button>
      </div>
    </form>` : '';

  return shell(must ? 'Новый пароль' : 'Аккаунт', `
    <div class="who"><img src="${head(me.name)}" alt=""><div><h1>${esc(me.name)}</h1><div class="muted">${me.admin ? 'владелец сайта' : 'друг'}${me.local ? ' · вход с этого ПК без пароля' : ''}</div></div></div>
    ${fl}
    ${pwForm}
    ${must ? `<div class="links" style="margin-top:18px"><form method="post" action="/logout"><button type="submit" class="ghost">Это не мой аккаунт — выйти</button></form></div>` : tx`<div class="links" style="margin-top:18px"><a class="btn ghost" href="${esc(next || '/')}">← На сайт</a>
      <form method="post" action="/account/logout-all"><button type="submit" class="ghost">Выйти на всех устройствах</button></form>
      ${me.local ? '' : '<form method="post" action="/logout"><button type="submit" class="ghost">Выйти</button></form>'}</div>`}
    ${must ? '' : list}
    ${must ? '' : keyList}`, { wide: !!users && !must });
}
