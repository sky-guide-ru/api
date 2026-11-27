// Discord-бот Sky Guide: /profile, /price, /next.
//
// Как устроен: Discord сам присылает команды POST-запросом на /discord/interactions (Interactions Endpoint URL
// в Developer Portal), сайт проверяет подпись и отвечает. Отдельного процесса, gateway и библиотек нет:
// бот живёт внутри api и берёт данные из того же кэша, что и сайт, поэтому лишних запросов к Hypixel не делает
// и отдельного ключа не требует (правила Hypixel). Минус — в списке участников бот «не в сети».
//
// Настройки (.env): DISCORD_PUBLIC_KEY и DISCORD_APP_ID (или DISCORD_CLIENT_ID того же приложения) — включают бота;
// DISCORD_BOT_TOKEN — чтобы зарегистрировать команды при запуске. Без них ничего не делает.
// Привязка Discord → ник (data/discord-links.json) — из модуля привязки; без неё /profile просит ник.
import express from 'express';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeVerifier } from './verify.js';
import { COMMANDS, commandsHash } from './commands.js';
import { langOf, T, profileMessage, planMessage, priceMessage, errorText, linkText } from './render.js';

const API = 'https://discord.com/api/v10';
const EPHEMERAL = 64;
const NICK = /^[A-Za-z0-9_]{1,16}$/;
// Интеракции: 1 — проверка адреса, 2 — команда, 4 — подсказки при наборе. Ответы: 1 — pong, 4 — сообщение,
// 5 — «думаю…» (потом правим сообщение), 8 — варианты подсказки
const PING = 1, COMMAND = 2, AUTOCOMPLETE = 4;

const optionsOf = data => Object.fromEntries((data?.options || []).map(o => [o.name, o.value]));
const userOf = body => body.member?.user || body.user || null;

/** Привязки из data/discord-links.json: { "<discord id>": { uuid, name, at } } — формат модуля привязки */
export function fileLinks(file) {
  let cache = null, mtime = 0;
  return id => {
    try {
      const st = fs.statSync(file);
      if (!cache || st.mtimeMs !== mtime) { cache = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; mtime = st.mtimeMs; }
    } catch { return null; }
    const e = cache?.[String(id)];
    return e?.name ? { name: e.name, uuid: e.uuid || null } : null;
  };
}

/**
 * @param {object} o
 *   env — process.env; site() — адрес сайта; fetch;
 *   view({ player, profile }) → вид игрока (как на сайте, кэш общий); hidden(name); open() — PUBLIC_VIEW;
 *   summary(v), plan(v) — те же расчёты, что /v1; translate(obj, lang) — перевод текстов core на английский;
 *   search(q, limit) → [{ id, name, nameRu }]; quote(id); linkOf(discordId) → { name } | null; linkPage — есть ли страница привязки;
 *   allowNick(userId, nick) → boolean — лимит разных ников (чтобы перебор не съел лимит Hypixel); commandsFile;
 *   link(user, nick), unlink(user) — привязка ника из discord-link.js (роль Verified); allowLink(userId) — лимит попыток
 */
export function createDiscordBot(o) {
  const env = o.env || {};
  const appId = String(env.DISCORD_APP_ID || env.DISCORD_CLIENT_ID || '').trim();
  const verify = makeVerifier(env.DISCORD_PUBLIC_KEY);
  const token = String(env.DISCORD_BOT_TOKEN || '').trim();
  const doFetch = o.fetch || fetch;
  const enabled = !!(verify && /^\d{5,25}$/.test(appId));
  // Discord принимает в карточках только полные адреса: без SITE_URL (тестовый запуск) — адрес живого сайта
  const site = () => String(o.site?.() || 'https://sky-guide.ru').replace(/\/$/, '');

  /** Правим ответ «думаю…» готовым сообщением (токен интеракции живёт 15 минут) */
  async function edit(interactionToken, msg) {
    const r = await doFetch(`${API}/webhooks/${appId}/${interactionToken}/messages/@original`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg),
    });
    if (!r.ok) console.warn('[discord-бот] не удалось отправить ответ:', r.status);
  }

  /** Чей профиль: ник из команды или привязанный аккаунт. { want } или { error } */
  function target(body, opts, lang) {
    const t = T[lang];
    const typed = String(opts.nick || '').trim();
    const linked = typed ? null : o.linkOf?.(userOf(body)?.id);
    const nick = typed || linked?.name || '';
    if (!nick) return { error: t.needNick(site(), !!o.linkPage) };
    if (!NICK.test(nick)) return { error: t.badName };
    if (o.hidden?.(nick)) return { error: t.hidden };
    if (!linked && o.open && !o.open()) return { error: t.closed };
    if (o.allowNick && !o.allowNick(userOf(body)?.id || 'dm', nick.toLowerCase())) return { error: t.rate };
    return { want: { player: nick, profile: String(opts.profile || '').trim().slice(0, 20) } };
  }

  async function loadView(want) {
    const v = await o.view(want);
    if (!v?.member) { const e = new Error('нет данных'); e.code = v?.errorCode || 'FAILED'; throw e; }
    if (o.hidden?.(v.player?.name)) { const e = new Error('скрыт'); e.code = 'HIDDEN'; throw e; }
    return v;
  }

  const tr = (x, lang) => (lang === 'en' && o.translate ? o.translate(x, 'en') : x);

  async function runProfile(body, opts, lang, want) {
    try {
      const v = await loadView(want);
      const s = o.summary(v);
      const next = tr((o.plan(v).steps || []).slice(0, 3).map(x => ({ title: x.title })), lang);
      await edit(body.token, profileMessage(s, { lang, site: site(), next }));
    } catch (e) {
      if (!e?.code) console.warn('[discord-бот] /profile:', e?.message || e);
      await edit(body.token, { content: errorText(e, lang, want.player), allowed_mentions: { parse: [] } });
    }
  }

  async function runNext(body, opts, lang, want) {
    try {
      const v = await loadView(want);
      const p = o.plan(v);
      const steps = tr(p.steps.slice(0, 5).map(x => ({ title: x.title, why: x.why, cost: x.cost })), lang);
      await edit(body.token, planMessage({ ...p, steps }, { lang, site: site() }));
    } catch (e) {
      if (!e?.code) console.warn('[discord-бот] /next:', e?.message || e);
      await edit(body.token, { content: errorText(e, lang, want.player), allowed_mentions: { parse: [] } });
    }
  }

  /** /link и /unlink: проверка Discord в профиле Hypixel, роль и ник — тем же кодом, что страница /discord */
  async function runLink(body, lang, name, nick) {
    const u = userOf(body);
    const user = { id: u.id, username: u.username, discriminator: u.discriminator };
    let res;
    try { res = name === 'link' ? await o.link(user, nick) : await o.unlink(user); } catch (e) {
      console.warn(`[discord-бот] /${name}:`, e?.message || e);
      res = { r: 'error' };
    }
    await edit(body.token, { content: linkText(res, lang), allowed_mentions: { parse: [] } });
  }

  function linkCommand(body, name, opts, lang) {
    const l = T[lang].link;
    const say = content => ({ reply: { type: 4, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } } } });
    const id = userOf(body)?.id;
    if (!o.link || !o.unlink || !id) return say(l.off);
    const nick = String(opts.nick || '').trim().replace(/^@+/, '');
    if (name === 'link' && !NICK.test(nick)) return say(T[lang].badName);
    if (name === 'link' && o.allowLink && !o.allowLink(id)) return say(l.rate);
    return { reply: { type: 5, data: { flags: EPHEMERAL } }, after: () => runLink(body, lang, name, nick) };
  }

  function price(opts, lang) {
    const q = String(opts.item || '').trim().slice(0, 80);
    const exact = /^[A-Z0-9_:;\-.]{2,80}$/.test(q) ? o.search(q, 5).find(r => r.id === q) : null; // из подсказки приходит id
    const item = exact || o.search(q, 1)[0];
    if (!item) return { content: T[lang].itemNotFound(q.replace(/[`*_~|]/g, '')), allowed_mentions: { parse: [] } };
    return priceMessage(item, o.quote(item.id), { lang, site: site() });
  }

  function autocomplete(body, lang) {
    const focused = (body.data?.options || []).find(x => x.focused);
    const q = String(focused?.value || '').trim();
    if (q.length < 2) return { type: 8, data: { choices: [] } };
    const choices = o.search(q, 25).map(r => ({
      name: (lang === 'ru' && r.nameRu && r.nameRu !== r.name ? `${r.name} · ${r.nameRu}` : r.name || r.id).replace(/§./g, '').slice(0, 100),
      value: r.id.slice(0, 100),
    }));
    return { type: 8, data: { choices } };
  }

  /**
   * Ответ на интеракцию. { reply } — отправить сразу; after — что сделать после ответа (долгая загрузка профиля)
   */
  function handle(body) {
    if (body?.type === PING) return { reply: { type: 1 } };
    const lang = langOf(body?.locale);
    if (body?.type === AUTOCOMPLETE) return { reply: autocomplete(body, lang) };
    if (body?.type !== COMMAND) return { reply: { type: 4, data: { content: '?', flags: EPHEMERAL } } };
    const name = body.data?.name;
    const opts = optionsOf(body.data);
    const flags = opts.private ? EPHEMERAL : 0;
    if (name === 'price') return { reply: { type: 4, data: { ...price(opts, lang), flags } } };
    if (name === 'link' || name === 'unlink') return linkCommand(body, name, opts, lang);
    if (name === 'profile' || name === 'next') {
      const tg = target(body, opts, lang);
      if (tg.error) return { reply: { type: 4, data: { content: tg.error, flags: EPHEMERAL, allowed_mentions: { parse: [] } } } };
      // План — личный совет: виден только тому, кто спросил
      const f = name === 'next' ? EPHEMERAL : flags;
      const run = name === 'next' ? runNext : runProfile;
      return { reply: { type: 5, data: { flags: f } }, after: () => run(body, opts, lang, tg.want) };
    }
    return { reply: { type: 4, data: { content: '?', flags: EPHEMERAL } } };
  }

  /** express-обработчик POST /discord/interactions (тело — сырые байты: подпись считается по ним) */
  const router = express.Router();
  // Значок для подвала карточек: Discord не показывает SVG, поэтому отдельный PNG
  const logo = new URL('./logo.png', import.meta.url);
  router.get('/discord/logo.png', (req, res) => res.set('Cache-Control', 'public, max-age=86400').type('image/png').sendFile(fileURLToPath(logo)));
  router.post('/discord/interactions', express.raw({ type: () => true, limit: '64kb' }), (req, res) => {
    if (!enabled) return res.status(404).json({ error: 'Бот не настроен' });
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!verify(req.get('X-Signature-Ed25519'), req.get('X-Signature-Timestamp'), raw)) return res.status(401).end('invalid request signature');
    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).end(); }
    let out;
    try { out = handle(body); } catch (e) {
      console.warn('[discord-бот]', e?.message || e);
      out = { reply: { type: 4, data: { content: T[langOf(body?.locale)].failed, flags: EPHEMERAL } } };
    }
    res.json(out.reply);
    if (out.after) Promise.resolve().then(out.after).catch(e => console.warn('[discord-бот]', e?.message || e));
  });

  /** Регистрация команд при запуске — только если список изменился с прошлого раза */
  async function registerCommands() {
    if (!enabled || !token) return false;
    const hash = commandsHash();
    const file = o.commandsFile;
    try { if (file && JSON.parse(fs.readFileSync(file, 'utf8')).hash === `${appId}:${hash}`) return false; } catch { /* первый запуск */ }
    const r = await doFetch(`${API}/applications/${appId}/commands`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bot ${token}` }, body: JSON.stringify(COMMANDS),
    });
    if (!r.ok) { console.warn('[discord-бот] команды не зарегистрированы:', r.status); return false; }
    try { if (file) fs.writeFileSync(file, JSON.stringify({ hash: `${appId}:${hash}`, at: Date.now() })); } catch { /* зарегистрируем ещё раз при следующем запуске */ }
    console.log('[discord-бот] команды зарегистрированы');
    return true;
  }

  return { enabled, router, handle, registerCommands };
}
