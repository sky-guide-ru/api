// Привязка Discord к нику Minecraft: роль Verified на сервере Discord сайта (и, по желанию, ник как в игре).
//
// Проверка — через сам Hypixel, без паролей: игрок указывает свой Discord в игре (профиль → Social Media → Discord),
// сайт сверяет это имя с аккаунтом, через который человек вошёл в Discord (OAuth, только scope identify).
// Роль и ник выдаются одним запросом от имени бота (DISCORD_BOT_TOKEN), постоянного подключения бота нет.
// Привязки лежат в data/discord-links.json и наружу не отдаются: ими пользуется только свой бот (/profile без ника).
//
// .env: DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, DISCORD_VERIFIED_ROLE_ID,
// DISCORD_SYNC_NICK=1 (ник на сервере = ник в игре). Пока чего-то нет — страница /discord зовёт просто на сервер.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { tx } from '@sky-guide/core/i18n/msg.js';
import { isEn } from '@sky-guide/core/i18n/lang.js';
import { createRateLimiter } from './lib/guard.js';
import { shell, esc, head } from './auth.js';

const API = 'https://discord.com/api/v10';
const SNOWFLAKE = /^\d{17,20}$/;
const NICK = /^[A-Za-z0-9_]{1,16}$/;
const STATE_TTL = 10 * 60_000;
const COOKIE = 'sb_dc';
export const INVITE = 'https://discord.gg/hHgJJFCGQe';

/** Настройки из .env; enabled — всё на месте и похоже на настоящие значения */
export function discordLinkConfig(env = process.env) {
  const c = {
    clientId: String(env.DISCORD_CLIENT_ID || '').trim(),
    secret: String(env.DISCORD_CLIENT_SECRET || '').trim(),
    botToken: String(env.DISCORD_BOT_TOKEN || '').trim(),
    guildId: String(env.DISCORD_GUILD_ID || '').trim(),
    roleId: String(env.DISCORD_VERIFIED_ROLE_ID || '').trim(),
    syncNick: String(env.DISCORD_SYNC_NICK || '').trim() === '1',
  };
  c.enabled = SNOWFLAKE.test(c.clientId) && c.secret.length >= 16 && c.botToken.length >= 30
    && SNOWFLAKE.test(c.guildId) && SNOWFLAKE.test(c.roleId);
  return c;
}

/** Discord, указанный в Hypixel, — тот же, что вошёл через OAuth? Новые имена (без #) и старые «Имя#1234» */
export function sameDiscord(hypixelValue, user) {
  const v = String(hypixelValue || '').trim().replace(/^@/, '').toLowerCase();
  const name = String(user?.username || '').toLowerCase();
  if (!v || !name) return false;
  const d = String(user.discriminator || '0');
  return v === name || (d !== '0' && v === `${name}#${d}`);
}

/**
 * Привязки: { [discord user id]: { uuid, name, at, nickSet } }. Один uuid — не больше одного Discord.
 * @param {string|null} file  null — только в памяти (тесты)
 */
export function createLinkStore(file = null) {
  let data = null;
  const load = () => {
    if (data) return data;
    try { data = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}; } catch { data = {}; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
    return data;
  };
  const save = () => {
    if (!file) return;
    try { fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 1)); fs.renameSync(`${file}.tmp`, file); } catch (e) { console.warn('[discord] не удалось сохранить привязки:', e.message); }
  };
  const store = {
    get: id => load()[String(id)] || null,
    byUuid: uuid => Object.entries(load()).find(([, v]) => v.uuid === uuid)?.[0] || null,
    /** → id других Discord, у которых был этот uuid (им снимается роль) */
    set(id, v) {
      const d = load(), old = [];
      for (const [k, x] of Object.entries(d)) if (x.uuid === v.uuid && k !== String(id)) { old.push(k); delete d[k]; }
      d[String(id)] = v;
      save();
      return old;
    },
    del(id) { const d = load(), had = d[String(id)] || null; if (had) { delete d[String(id)]; save(); } return had; },
    size: () => Object.keys(load()).length,
  };
  /** Для бота: discord user id → { name, uuid } или null */
  store.linkOf = id => { const v = store.get(id); return v ? { name: v.name, uuid: v.uuid } : null; };
  return store;
}

const hmac = (key, body) => crypto.createHmac('sha256', key).update(body).digest('base64url');
export function signState(payload, key) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${hmac(key, body)}`;
}
export function readState(state, key, now = Date.now()) {
  const [body, mac] = String(state || '').split('.');
  if (!body || !mac) return null;
  const want = hmac(key, body);
  if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); return p && p.x > now ? p : null; } catch { return null; }
}

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/**
 * @param {import('express').Express} app
 * @param {{ env?: object, store?: ReturnType<typeof createLinkStore>, siteUrl?: string, clientIp?: (req) => string,
 *   fetchFn?: typeof fetch, resolveUuid: (nick: string) => Promise<{uuid: string, name: string}>,
 *   getPlayer: (uuid: string) => Promise<{player?: object}>, clock?: () => number, log?: Console }} o
 */
export function mountDiscordLink(app, o) {
  const cfg = discordLinkConfig(o.env || process.env);
  const store = o.store || createLinkStore(null);
  const fetchFn = o.fetchFn || globalThis.fetch, clock = o.clock || (() => Date.now()), log = o.log || console;
  const clientIp = o.clientIp || (req => String(req.socket?.remoteAddress || ''));
  const startLimit = createRateLimiter({ max: 8, windowMs: 10 * 60_000, clock });
  const flashes = new Map(); // id → { r, ...подробности } — результат показывается уже на /discord нужного языка

  const isHttps = req => req.secure || req.headers['x-forwarded-proto'] === 'https';
  // Адрес возврата должен в точности совпадать с записанным в Discord: берём SITE_URL, без него — адрес запроса
  const origin = req => String(o.siteUrl || '').replace(/\/+$/, '') || `${isHttps(req) ? 'https' : 'http'}://${req.get('host')}`;
  const redirectUri = req => `${origin(req)}/discord/callback`;
  const nonceCookie = (req, v, maxAge) => [`${COOKIE}=${v}`, 'Path=/discord', 'SameSite=Lax', `Max-Age=${maxAge}`, 'HttpOnly', ...(isHttps(req) ? ['Secure'] : [])].join('; ');

  // ---------- Запросы к Discord ----------
  async function discord(path, { method = 'GET', auth, body, form, reason } = {}) {
    const headers = auth ? { Authorization: auth } : {};
    if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    else if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (reason) headers['X-Audit-Log-Reason'] = encodeURIComponent(reason);
    const r = await fetchFn(`${API}${path}`, {
      method, headers, signal: AbortSignal.timeout(15_000),
      body: form ? new URLSearchParams(form).toString() : body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = r.status === 204 ? null : await r.json(); } catch { /* пустой ответ */ }
    return { ok: r.ok, status: r.status, data };
  }
  const bot = `Bot ${cfg.botToken}`;
  const member = uid => `/guilds/${cfg.guildId}/members/${uid}`;
  const addRole = uid => discord(`${member(uid)}/roles/${cfg.roleId}`, { method: 'PUT', auth: bot, reason: 'Sky Guide: ник Minecraft подтверждён' });
  const removeRole = uid => discord(`${member(uid)}/roles/${cfg.roleId}`, { method: 'DELETE', auth: bot, reason: 'Sky Guide: привязка снята' });
  const setNick = (uid, nick) => discord(member(uid), { method: 'PATCH', auth: bot, body: { nick }, reason: 'Sky Guide: ник как в игре' });

  async function whoOnDiscord(code, req) {
    const t = await discord('/oauth2/token', {
      method: 'POST',
      form: { client_id: cfg.clientId, client_secret: cfg.secret, grant_type: 'authorization_code', code, redirect_uri: redirectUri(req) },
    });
    if (!t.ok || !t.data?.access_token) throw new Error(`token ${t.status}`);
    const me = await discord('/users/@me', { auth: `Bearer ${t.data.access_token}` });
    // Токен больше не нужен: отзываем сразу, у сайта не остаётся доступа к аккаунту
    discord('/oauth2/token/revoke', { method: 'POST', form: { client_id: cfg.clientId, client_secret: cfg.secret, token: t.data.access_token } }).catch(() => {});
    if (!me.ok || !SNOWFLAKE.test(String(me.data?.id || ''))) throw new Error(`users/@me ${me.status}`);
    return me.data;
  }

  // ---------- Привязка и отвязка ----------
  async function link(user, nick) {
    let mc;
    try { mc = await o.resolveUuid(nick); } catch { return { r: 'nonick', nick }; }
    if (!mc?.uuid) return { r: 'nonick', nick };
    let player;
    try { player = (await o.getPlayer(mc.uuid))?.player; } catch (e) { return { r: e.code === 'RATE' ? 'busy' : 'error', nick: mc.name }; }
    if (!player) return { r: 'nonick', nick: mc.name };
    const set = player.socialMedia?.links?.DISCORD;
    if (!sameDiscord(set, user)) return { r: 'mismatch', nick: mc.name, set: set ? String(set).slice(0, 40) : '', you: user.username };

    const role = await addRole(user.id).catch(() => ({ ok: false, status: 0 }));
    const notMember = role.status === 404 && role.data?.code === 10007;
    if (!role.ok && !notMember) log.warn(`[discord] роль не выдана: ${role.status} ${role.data?.code ?? ''}`);
    let nickSet = false;
    if (cfg.syncNick && role.ok) nickSet = (await setNick(user.id, mc.name).catch(() => ({ ok: false }))).ok;
    const prev = store.get(user.id);
    const old = store.set(user.id, { uuid: mc.uuid, name: mc.name, at: clock(), nickSet: nickSet || (prev?.uuid === mc.uuid && !!prev?.nickSet) });
    for (const id of old) removeRole(id).catch(() => {}); // этот ник раньше был у другого Discord
    if (notMember) return { r: 'join', nick: mc.name };
    return { r: role.ok ? 'ok' : 'norole', nick: mc.name, nickSet };
  }

  async function unlink(user) {
    const had = store.del(user.id);
    if (!had) return { r: 'none' };
    await removeRole(user.id).catch(() => {});
    if (had.nickSet) await setNick(user.id, null).catch(() => {});
    return { r: 'unlinked', nick: had.name };
  }

  // ---------- Страницы ----------
  const L = () => (isEn() ? '/en' : '');
  const back = () => `<a class="btn ghost" href="${L()}/">← На сайт</a>`;
  const ext = 'target="_blank" rel="noopener noreferrer"';
  const howTo = () => tx`<div class="note"><b>Сначала в игре:</b> в лобби Hypixel открой профиль (голова в хотбаре) → Social Media → Discord и отправь в чат свой ник Discord.</div>`;

  function formPage(nick = '') {
    return shell('Discord', tx`
      <div class="who"><img id="av" src="${head(nick || 'MHF_Steve')}" alt=""><div><h1>Discord</h1><div class="muted">Роль Verified на сервере Sky Guide</div></div></div>
      <p>${cfg.syncNick ? tx`Ник из Minecraft привязывается к Discord: на сервере появится роль Verified, а ник станет как в игре.` : tx`Ник из Minecraft привязывается к Discord: на сервере появится роль Verified.`}</p>
      ${howTo()}
      <form method="get" action="/discord/start">
        <input type="hidden" name="l" value="${isEn() ? 'en' : 'ru'}">
        <label for="nick">Ник в Minecraft</label>
        <input id="nick" name="nick" value="${esc(nick)}" placeholder="например, Steve" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="16" pattern="[A-Za-z0-9_]{1,16}" title="Ник латиницей, как в игре: буквы, цифры и _, до 16 символов" required ${nick ? '' : 'autofocus'}>
        <button type="submit">Войти через Discord</button>
      </form>
      <div class="note">Сайт узнаёт только имя и id в Discord: ни почты, ни серверов, ни сообщений. Ник нигде не показывается.</div>
      <div class="links" style="margin-top:4px"><a class="btn ghost" href="${INVITE}" ${ext}>Сервер Discord</a><a class="btn ghost" href="/discord/start?do=unlink&amp;l=${isEn() ? 'en' : 'ru'}">Отвязать</a></div>
      ${back()}`,
    { script: `const n=document.getElementById('nick'),a=document.getElementById('av');let t;n.addEventListener('input',()=>{clearTimeout(t);t=setTimeout(()=>{const v=n.value.trim();if(/^[A-Za-z0-9_]{3,16}$/.test(v))a.src='/api/head/'+v+'?size=64'},400)});` });
  }

  function offPage() {
    return shell('Discord', tx`
      <div class="who"><img src="${head('MHF_Steve')}" alt=""><div><h1>Discord</h1><div class="muted">Сервер Sky Guide</div></div></div>
      <p>Новости сайта, патчноуты SkyBlock и помощь с профилем.</p>
      <a class="btn" href="${INVITE}" ${ext}>Открыть сервер Discord</a>
      ${back()}`);
  }

  function resultPage(f) {
    const nick = esc(f.nick || '');
    const again = `<a class="btn" href="${L()}/discord?nick=${encodeURIComponent(f.nick || '')}">${tx`Попробовать ещё раз`}</a>`;
    const who = (title, sub = '') => `<div class="who"><img src="${head(f.nick || 'MHF_Steve')}" alt=""><div><h1>${title}</h1>${sub ? `<div class="muted">${sub}</div>` : ''}</div></div>`;
    const flash = (kind, msg) => `<div class="flash ${kind}">${msg}</div>`;
    const pages = {
      ok: () => who(tx`Готово`, nick) + flash('ok', cfg.syncNick ? tx`Ник подтверждён: на сервере выдана роль Verified, ник — как в игре.` : tx`Ник подтверждён: на сервере выдана роль Verified.`)
        + `<a class="btn" href="${INVITE}" ${ext}>${tx`Открыть Discord`}</a>${back()}`,
      join: () => who(tx`Почти готово`, nick) + flash('warn', tx`Ник подтверждён, но тебя ещё нет на сервере. Зайди на сервер и привяжи ещё раз — роль выдастся сразу.`)
        + `<div class="links"><a class="btn" href="${INVITE}" ${ext}>${tx`Зайти на сервер`}</a>${again}</div>${back()}`,
      norole: () => who(tx`Ник подтверждён`, nick) + flash('warn', tx`Привязка сохранена, но роль выдать не получилось. Напиши модераторам на сервере.`) + back(),
      mismatch: () => who(tx`Discord не совпал`, nick)
        + flash('err', f.set ? tx`В Hypixel у ${nick} указан Discord «${esc(f.set)}», а вход был через «${esc(f.you)}».` : tx`У ${nick} в Hypixel не указан Discord.`)
        + howTo() + `<p class="muted" style="margin-top:12px">${tx`Hypixel обновляет профиль не сразу: если только что указал — подожди пару минут.`}</p>` + again + back(),
      nonick: () => who(tx`Игрок не найден`) + flash('err', tx`Ника ${nick || '?'} нет в Minecraft или на Hypixel. Проверь, как он пишется в игре.`) + again + back(),
      busy: () => who(tx`Hypixel занят`) + flash('warn', tx`Hypixel ограничил запросы сайта. Попробуй через несколько минут.`) + again + back(),
      unlinked: () => who(tx`Привязка снята`, nick) + flash('ok', tx`Роль Verified снята, Discord больше не связан с ником.`) + back(),
      none: () => who(tx`Привязки нет`) + flash('warn', tx`Этот Discord не был привязан ни к одному нику.`) + back(),
      cancel: () => who(tx`Вход отменён`) + `<p>${tx`Discord не дал доступ — ничего не изменилось.`}</p>` + again + back(),
      expired: () => who(tx`Ссылка устарела`) + `<p>${tx`Начни заново со страницы привязки.`}</p>` + again + back(),
      error: () => who(tx`Не получилось`) + flash('err', tx`Discord или Hypixel не ответил. Попробуй ещё раз чуть позже.`) + again + back(),
    };
    return shell('Discord', (pages[f.r] || pages.error)());
  }

  const showResult = (res, lang, f) => {
    const id = crypto.randomBytes(9).toString('base64url');
    flashes.set(id, { ...f, at: clock() });
    for (const [k, v] of flashes) if (clock() - v.at > 10 * 60_000) flashes.delete(k);
    res.redirect(303, `${lang === 'en' ? '/en' : ''}/discord?f=${id}`);
  };

  // ---------- Адреса ----------
  app.get(['/discord', '/en/discord'], (req, res) => {
    res.set('Cache-Control', 'no-store');
    const f = req.query.f && flashes.get(String(req.query.f));
    if (f) return res.type('html').send(resultPage(f));
    if (!cfg.enabled) return res.type('html').send(offPage());
    const nick = NICK.test(String(req.query.nick || '')) ? String(req.query.nick) : '';
    res.type('html').send(formPage(nick));
  });

  app.get('/discord/start', (req, res) => {
    const lang = req.query.l === 'en' ? 'en' : 'ru';
    if (!cfg.enabled) return res.redirect(303, `${lang === 'en' ? '/en' : ''}/discord`);
    const act = req.query.do === 'unlink' ? 'unlink' : 'link';
    const nick = String(req.query.nick || '').trim().replace(/^@+/, '');
    if (act === 'link' && !NICK.test(nick)) return res.redirect(303, `${lang === 'en' ? '/en' : ''}/discord`);
    const wait = startLimit.hit(clientIp(req));
    if (wait) return res.status(429).set('Retry-After', String(wait)).type('text').send(tx`Слишком много попыток. Подожди ${Math.ceil(wait / 60)} мин`);
    const nonce = crypto.randomBytes(12).toString('base64url');
    const state = signState({ a: act, n: act === 'link' ? nick : '', l: lang, k: nonce, x: clock() + STATE_TTL }, cfg.secret);
    res.set('Set-Cookie', nonceCookie(req, nonce, STATE_TTL / 1000));
    const q = new URLSearchParams({ response_type: 'code', client_id: cfg.clientId, scope: 'identify', redirect_uri: redirectUri(req), state, prompt: 'none' });
    res.redirect(303, `https://discord.com/oauth2/authorize?${q}`);
  });

  app.get('/discord/callback', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!cfg.enabled) return res.redirect(303, '/discord');
    const st = readState(req.query.state, cfg.secret, clock());
    const lang = st?.l === 'en' ? 'en' : 'ru';
    // Состояние подписано и привязано к этому браузеру (cookie): чужую ссылку с кодом подсунуть нельзя
    if (!st || readCookie(req, COOKIE) !== st.k) return showResult(res, lang, { r: 'expired' });
    res.append('Set-Cookie', nonceCookie(req, '', 0));
    if (req.query.error || !req.query.code) return showResult(res, lang, { r: 'cancel', nick: st.n });
    let user;
    try { user = await whoOnDiscord(String(req.query.code), req); } catch (e) { log.warn('[discord] вход не удался:', e.message); return showResult(res, lang, { r: 'error', nick: st.n }); }
    try {
      showResult(res, lang, st.a === 'unlink' ? await unlink(user) : await link(user, st.n));
    } catch (e) {
      log.warn('[discord] привязка не удалась:', e.message);
      showResult(res, lang, { r: 'error', nick: st.n });
    }
  });

  // link/unlink — и для команд бота /link и /unlink (тот же Discord-пользователь, только без OAuth)
  return { enabled: cfg.enabled, store, link, unlink, _test: { link, unlink } };
}
