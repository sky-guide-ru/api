// Настройки Discord-бота со страницы «Discord-бот» (только владельцу): каналы, роли и включение функций.
// Хранятся в data/discord-settings.json и читаются функциями бота при каждой отправке — изменения действуют сразу.
// Пока на странице ничего не сохраняли, значения берутся из .env, как раньше (перенос без ручной работы).
// Секреты (токен, Public Key, Client Secret) остаются только в .env: на страницу уходит лишь «задан / не задан».
//
// Новая функция бота — новая запись в FEATURES: страница сама покажет её карточку, списки и проверки.
import fs from 'node:fs';
import { parseRoles } from './discord-events.js';
import { missing, P } from './discord-guild.js';

const SNOWFLAKE = /^\d{17,20}$/;
const snow = v => (SNOWFLAKE.test(String(v || '').trim()) ? String(v).trim() : '');
export const TOGGLE_COMMANDS = ['profile', 'price', 'next', 'link', 'unlink'];
export const EVENT_ROLES = [['jacob', 'Jacob'], ['darkauction', 'Dark Auction'], ['mayor', 'Mayor'], ['firesale', 'Fire Sale'], ['events', 'Большие ивенты']];

/**
 * Функции бота. Поле: k — ключ, type — channel | role | roles | choice | toggle | cmds, label — подпись,
 * need — права в канале, env — переменная .env со значением по умолчанию, when — показывать при значении другого поля.
 * on(env) — включена ли по умолчанию; webhook — переменная .env с webhook, который работает, пока канал не выбран.
 */
export const FEATURES = [
  { id: 'status', title: 'Состояние сайта', desc: 'Одно сообщение в канале, бот правит его раз в минуту',
    on: env => !!snow(env.DISCORD_STATUS_CHANNEL_ID),
    fields: [{ k: 'channel', type: 'channel', label: 'Канал', need: ['view', 'send', 'embed', 'pin'], env: 'DISCORD_STATUS_CHANNEL_ID', create: 'sky-guide-status' }] },
  { id: 'alerts', title: 'Тревоги о сбоях', desc: 'Сайт упал, кончается память или диск, ключ Hypixel на паузе',
    on: () => true,
    fields: [
      { k: 'to', type: 'choice', label: 'Куда писать', opts: [['dm', 'Мне в личку'], ['channel', 'В канал'], ['webhook', 'Webhook из файла сервера', env => !!String(env.DISCORD_ALERTS_WEBHOOK || '').trim()]],
        def: env => (String(env.DISCORD_ALERTS_WEBHOOK || '').trim() ? 'webhook' : snow(env.DISCORD_ALERTS_CHANNEL_ID) ? 'channel' : 'dm') },
      { k: 'channel', type: 'channel', label: 'Канал', need: ['view', 'send', 'embed'], env: 'DISCORD_ALERTS_CHANNEL_ID', when: ['to', 'channel'], create: 'sky-guide-alerts' },
    ] },
  { id: 'news', title: 'Новости сайта и патчноуты', desc: 'Новые записи «Новостей» и патчноуты SkyBlock',
    on: env => !!String(env.DISCORD_NEWS_WEBHOOK || '').trim(), webhook: 'DISCORD_NEWS_WEBHOOK',
    fields: [{ k: 'channel', type: 'channel', label: 'Канал', need: ['view', 'send', 'embed'], create: 'news' }] },
  { id: 'events', title: 'События SkyBlock', desc: 'Jacob, Dark Auction, мэр и выборы, Fire Sales, большие ивенты',
    on: env => !!String(env.DISCORD_EVENTS_WEBHOOK || '').trim(), webhook: 'DISCORD_EVENTS_WEBHOOK',
    fields: [
      { k: 'channel', type: 'channel', label: 'Канал', need: ['view', 'send', 'embed', 'history'], create: 'events' },
      { k: 'roles', type: 'roles', label: 'Кого пинговать', keys: EVENT_ROLES, env: 'DISCORD_EVENTS_ROLES' },
    ] },
  { id: 'verify', title: 'Верификация', desc: 'Кнопки «Верификация» и «Отвязать», роль после проверки ника',
    on: () => true,
    fields: [
      { k: 'channel', type: 'channel', label: 'Канал с кнопками', need: ['view', 'send', 'embed', 'history'], env: 'DISCORD_VERIFY_CHANNEL_ID', create: 'verify', auto: 'канал с «verify» в названии' },
      { k: 'role', type: 'role', label: 'Роль после проверки', env: 'DISCORD_VERIFIED_ROLE_ID', create: 'Verified' },
      { k: 'nick', type: 'toggle', label: 'Ник как в игре', env: 'DISCORD_SYNC_NICK' },
    ] },
  { id: 'commands', title: 'Команды', desc: 'Какие команды бота доступны',
    on: () => true,
    fields: [{ k: 'off', type: 'cmds', label: 'Включены', cmds: TOGGLE_COMMANDS }] },
];

const CMD_RU = { profile: '/профиль', price: '/цена', next: '/дальше', link: '/привязать', unlink: '/отвязать' };

/** Значение поля по умолчанию — из .env */
function envDefault(f, env) {
  if (f.def) return f.def(env);
  const raw = f.env ? String(env[f.env] || '').trim() : '';
  if (f.type === 'channel' || f.type === 'role') return snow(raw);
  if (f.type === 'roles') return parseRoles(raw);
  if (f.type === 'toggle') return raw === '1';
  if (f.type === 'cmds') return [];
  return raw;
}

/** Проверка значения поля с формы; undefined — не принимаем */
function clean(f, v, env) {
  if (f.type === 'channel' || f.type === 'role') return v === '' || v == null ? '' : snow(v) || undefined;
  if (f.type === 'toggle') return typeof v === 'boolean' ? v : undefined;
  if (f.type === 'choice') return f.opts.some(([id, , ok]) => id === v && (!ok || ok(env))) ? v : undefined;
  if (f.type === 'roles') {
    if (!v || typeof v !== 'object') return undefined;
    const out = {};
    for (const [k] of f.keys) { const id = snow(v[k]); if (id) out[k] = id; }
    return out;
  }
  if (f.type === 'cmds') return Array.isArray(v) ? [...new Set(v.filter(x => f.cmds.includes(x)))] : undefined;
  return undefined;
}

/**
 * @param {{ file?: string, env?: object }} o
 */
export function createBotSettings({ file = '', env = process.env } = {}) {
  let data = {};
  try { data = file ? JSON.parse(fs.readFileSync(file, 'utf8')) || {} : {}; } catch { data = {}; }
  data.features ||= {};
  const subs = new Set();
  const save = () => { if (!file) return; try { fs.writeFileSync(file, JSON.stringify(data, null, 1)); } catch (e) { console.warn('[discord-настройки] не удалось сохранить:', e.message); } };

  /** Текущие значения функции: сохранённые на странице, иначе из .env. { on, ...поля } */
  function get(id) {
    const feat = FEATURES.find(f => f.id === id);
    if (!feat) return null;
    const s = data.features[id] || {};
    const out = { on: typeof s.on === 'boolean' ? s.on : feat.on(env) };
    for (const f of feat.fields) out[f.k] = s[f.k] !== undefined ? s[f.k] : envDefault(f, env);
    return out;
  }

  /** Сохранить правку одной функции: { on?, values? }. → { ok, error? } */
  function set(id, { on, values } = {}) {
    const feat = FEATURES.find(f => f.id === id);
    if (!feat) return { ok: false, error: 'Нет такой функции' };
    const next = { ...(data.features[id] || {}) };
    if (on !== undefined) { if (typeof on !== 'boolean') return { ok: false, error: 'Неверное значение' }; next.on = on; }
    for (const [k, v] of Object.entries(values || {})) {
      const f = feat.fields.find(x => x.k === k);
      if (!f) return { ok: false, error: `Нет поля ${k}` };
      const c = clean(f, v, env);
      if (c === undefined) return { ok: false, error: `Неверное значение: ${f.label}` };
      next[k] = c;
    }
    data.features[id] = next; data.updatedAt = Date.now();
    save();
    for (const fn of subs) { try { fn(id); } catch (e) { console.warn('[discord-настройки]', e.message); } }
    return { ok: true };
  }

  const guildId = () => snow(data.guildId) || snow(env.DISCORD_GUILD_ID);
  function setGuild(id) {
    const g = snow(id);
    if (!g) return { ok: false, error: 'Неверный сервер' };
    data.guildId = g; data.updatedAt = Date.now(); save();
    for (const fn of subs) { try { fn('guild'); } catch { /* ничего */ } }
    return { ok: true };
  }

  return { get, set, guildId, setGuild, onChange: fn => subs.add(fn), updatedAt: () => data.updatedAt || 0 };
}

const has = (perms, bit) => !!(perms & bit);

/** Проблемы функции по снимку сервера: [{ text, fix }]. via — 'webhook', если пока работает через webhook */
export function checkFeature(feat, val, snap, ctx = {}) {
  const env = ctx.env || {};
  const out = { problems: [], via: null, notes: [] };
  if (!val.on) return out;
  const p = (text, fix = '') => out.problems.push({ text, fix });
  if (!ctx.token) { p('Бот не настроен: в файле сервера нет токена', 'Токен вписывается один раз при установке.'); return out; }
  if (!snap?.guild) { p('Бот не добавлен ни на один сервер Discord', 'Пригласи бота ссылкой из Developer Portal → OAuth2 → URL Generator.'); return out; }
  const ch = id => snap.channels.find(c => c.id === id);
  const role = id => snap.roles.find(r => r.id === id);
  const shown = f => !f.when || val[f.when[0]] === f.when[1];

  for (const f of feat.fields) {
    if (!shown(f)) continue;
    const v = val[f.k];
    if (f.type === 'channel') {
      if (!v) {
        if (feat.webhook && String(env[feat.webhook] || '').trim()) { out.via = 'webhook'; out.notes.push('Сейчас отправляется через webhook из файла сервера. Выбери канал, и бот будет писать сам.'); continue; }
        if (f.auto) { out.notes.push(`Канал не выбран: бот ищет ${f.auto}.`); continue; }
        p('Не выбран канал'); continue;
      }
      const c = ch(v);
      if (!c) { p('Выбранный канал удалён или бот его не видит', 'Выбери другой канал или нажми «Создать канал».'); continue; }
      const miss = missing(c.perms, f.need || []);
      if (miss.length) p(`В #${c.name} у бота нет права «${miss.join('», «')}»`, `Discord: правый клик по #${c.name} → Изменить канал → Права доступа → роль бота → включить «${miss.join('», «')}». Или «Создать канал»: бот создаст новый со всеми правами.`);
    }
    if (f.type === 'role') {
      if (!v) { p(`Не выбрана роль: ${f.label.toLowerCase()}`); continue; }
      const r = role(v);
      if (!r) { p('Выбранная роль удалена', 'Выбери другую или нажми «Создать роль».'); continue; }
      if (!has(snap.base, P.MANAGE_ROLES)) p('У бота нет права «Управлять ролями»', 'Настройки сервера → Роли → роль бота → включить «Управлять ролями».');
      else if (r.managed) p(`Роль ${r.name} принадлежит другому боту, её нельзя выдать`);
      else if (r.position >= snap.top) p(`Роль ${r.name} выше роли бота, выдать её бот не сможет`, 'Настройки сервера → Роли → перетащи роль бота выше этой роли.');
    }
    if (f.type === 'toggle' && f.k === 'nick' && v && !has(snap.base, P.MANAGE_NICKNAMES)) p('Для «ник как в игре» у бота нет права «Управлять никнеймами»', 'Настройки сервера → Роли → роль бота → включить «Управлять никнеймами».');
    if (f.type === 'roles') {
      const c = val.channel ? ch(val.channel) : null;
      const canAll = c ? has(c.perms, P.MENTION_EVERYONE) : has(snap.base, P.MENTION_EVERYONE);
      for (const [k, label] of f.keys) {
        if (!v?.[k]) continue;
        const r = role(v[k]);
        if (!r) p(`Роль для «${label}» удалена`, 'Выбери другую или нажми «Создать недостающие роли».');
        else if (!r.mentionable && !canAll) p(`Роль ${r.name} нельзя упомянуть: пинга не будет`, `Настройки сервера → Роли → ${r.name} → включить «Позволить всем @упоминать эту роль».`);
      }
    }
  }
  if (feat.id === 'alerts') {
    if (val.to === 'dm' && !ctx.ownerDiscord) p('Твой Discord не привязан к нику сайта', 'Пройди верификацию кнопкой в канале верификации своим ником, и тревоги придут в личку.');
    if (val.to === 'webhook' && !String(env.DISCORD_ALERTS_WEBHOOK || '').trim()) p('В файле сервера нет webhook для тревог');
  }
  return out;
}

/** Страница целиком: секреты (только задан/нет), бот, сервер, списки, функции с проверками */
export function pageData(settings, snap, ctx = {}) {
  const env = ctx.env || {};
  const set = k => !!String(env[k] || '').trim();
  const features = FEATURES.map(feat => {
    const val = settings.get(feat.id);
    const chk = snap?.ok ? checkFeature(feat, val, snap, ctx) : { problems: [], notes: [], via: null };
    return {
      id: feat.id, title: feat.title, desc: feat.desc, on: val.on,
      status: !val.on ? 'off' : !snap?.ok ? 'unknown' : chk.problems.length ? 'bad' : 'ok',
      problems: chk.problems, notes: chk.notes, via: chk.via,
      fields: feat.fields.map(f => ({
        k: f.k, type: f.type, label: f.label, value: val[f.k], when: f.when || null, create: f.create || null, auto: f.auto || null,
        ...(f.opts ? { opts: f.opts.filter(([, , ok]) => !ok || ok(env)).map(([id, label]) => ({ id, label })) } : {}),
        ...(f.keys ? { keys: f.keys.map(([id, label]) => ({ id, label })) } : {}),
        ...(f.cmds ? { cmds: f.cmds.map(id => ({ id, label: `/${id}`, ru: CMD_RU[id] || '' })) } : {}),
      })),
    };
  });
  return {
    secrets: [
      { k: 'token', label: 'Токен бота', set: set('DISCORD_BOT_TOKEN') },
      { k: 'publicKey', label: 'Public Key приложения', set: set('DISCORD_PUBLIC_KEY') },
      { k: 'appId', label: 'Application ID', set: set('DISCORD_APP_ID') || set('DISCORD_CLIENT_ID') },
      { k: 'clientSecret', label: 'Client Secret (вход через Discord)', set: set('DISCORD_CLIENT_SECRET') },
    ],
    bot: snap?.ok ? { ok: true, name: snap.me?.name || 'бот', commands: !!ctx.commandsOk } : { ok: false, error: snap?.error || 'Бот не отвечает' },
    guilds: snap?.guilds || [], guild: snap?.guild || null,
    channels: (snap?.channels || []).map(c => ({ id: c.id, name: c.name, category: c.category })),
    roles: (snap?.roles || []).filter(r => !r.managed).map(r => ({ id: r.id, name: r.name, color: r.color })),
    readAt: snap?.at || 0, updatedAt: settings.updatedAt(),
    features,
  };
}

/**
 * Адреса страницы (только владельцу).
 * @param {import('express').Express} app
 * @param {{ express: any, requireAdmin: Function, settings: ReturnType<typeof createBotSettings>, guild: ReturnType<import('./discord-guild.js').createGuild>,
 *   env: object, ownerDiscord: () => string|null, testAlert?: () => Promise<any> }} o
 */
export function mountBotSettings(app, o) {
  const { settings, guild, env } = o;
  const json = o.express.json({ limit: '16kb' });
  const ctx = () => ({ env, token: guild.enabled, ownerDiscord: o.ownerDiscord?.() || null, commandsOk: true });
  async function page(res, fresh = false, extra = {}) {
    let snap;
    try { snap = await guild.snapshot(fresh); } catch (e) { snap = { ok: false, error: e.message }; }
    res.set('Cache-Control', 'no-store').json({ ...pageData(settings, snap, ctx()), ...extra });
  }
  const fail = (res, e) => res.status(400).json({ error: String(e?.message || e).slice(0, 200) });

  app.get('/api/admin/discord', o.requireAdmin, (req, res) => page(res, req.query.fresh === '1'));
  app.put('/api/admin/discord/guild', o.requireAdmin, json, (req, res) => {
    const r = settings.setGuild(req.body?.id);
    if (!r.ok) return fail(res, r.error);
    guild.forget();
    return page(res, true);
  });
  app.put('/api/admin/discord/feature/:id', o.requireAdmin, json, (req, res) => {
    const r = settings.set(String(req.params.id), { on: req.body?.on, values: req.body?.values });
    if (!r.ok) return fail(res, r.error);
    return page(res);
  });
  // «Создать канал»: бот создаёт канал с правами для себя и сразу выбирает его в функции
  app.post('/api/admin/discord/feature/:id/channel', o.requireAdmin, json, async (req, res) => {
    const feat = FEATURES.find(f => f.id === req.params.id);
    const f = feat?.fields.find(x => x.type === 'channel' && x.k === (req.body?.k || 'channel'));
    if (!f) return fail(res, 'Нет такого поля');
    try {
      const near = Object.values(settings.get(feat.id)).find(v => typeof v === 'string' && SNOWFLAKE.test(v)) || null;
      const c = await guild.createChannel(f.create || feat.id, { parentOf: near });
      settings.set(feat.id, { values: { [f.k]: c.id } });
      return page(res, true, { done: `Канал #${c.name} создан, у бота в нём все нужные права` });
    } catch (e) { return fail(res, e.status === 403 ? 'У бота нет права «Управлять каналами». Дай его роли бота или создай канал сам и выбери в списке.' : e); }
  });
  // «Создать роль» / «Создать недостающие роли»: роли без прав, которые можно упоминать
  app.post('/api/admin/discord/feature/:id/roles', o.requireAdmin, json, async (req, res) => {
    const feat = FEATURES.find(f => f.id === req.params.id);
    if (!feat) return fail(res, 'Нет такой функции');
    try {
      const snap = await guild.snapshot(true);
      const val = settings.get(feat.id);
      const values = {};
      let made = 0;
      for (const f of feat.fields) {
        if (f.type === 'role' && !snap.roles.some(r => r.id === val[f.k])) {
          const same = snap.roles.find(r => r.name.toLowerCase() === String(f.create).toLowerCase() && !r.managed);
          values[f.k] = same ? same.id : (made++, (await guild.createRole(f.create)).id);
        }
        if (f.type === 'roles') {
          const cur = { ...(val[f.k] || {}) };
          for (const [k, label] of f.keys) {
            if (cur[k] && snap.roles.some(r => r.id === cur[k])) continue;
            const name = k === 'events' ? 'Events' : label;
            const same = snap.roles.find(r => r.name.toLowerCase() === name.toLowerCase() && !r.managed);
            cur[k] = same ? same.id : (made++, (await guild.createRole(name)).id);
          }
          values[f.k] = cur;
        }
      }
      if (Object.keys(values).length) settings.set(feat.id, { values });
      return page(res, true, { done: made ? `Создано ролей: ${made}. Они без прав, их можно упоминать` : 'Все роли уже есть, выбраны в списках' });
    } catch (e) { return fail(res, e.status === 403 ? 'У бота нет права «Управлять ролями»' : e); }
  });
  // «Проверить всё»: пробное сообщение в каждый выбранный канал (бот удалит его через 20 с) и тревога-проверка
  app.post('/api/admin/discord/test', o.requireAdmin, async (req, res) => {
    const results = [];
    for (const feat of FEATURES) {
      const val = settings.get(feat.id);
      if (!val.on) continue;
      if (feat.id === 'alerts') {
        try { const r = await o.testAlert?.(); results.push({ id: feat.id, ok: !!r?.ok, error: r?.error || null }); } catch (e) { results.push({ id: feat.id, ok: false, error: e.message }); }
        continue;
      }
      const f = feat.fields.find(x => x.type === 'channel' && (!x.when || val[x.when[0]] === x.when[1]));
      if (!f || !val[f.k]) continue;
      try { await guild.testMessage(val[f.k], `Проверка Sky Guide: сюда приходит «${feat.title}». Сообщение исчезнет само.`); results.push({ id: feat.id, ok: true }); } catch (e) { results.push({ id: feat.id, ok: false, error: e.message }); }
    }
    return page(res, true, { results });
  });
}
