// Сервер Discord глазами бота: какие у него каналы и роли и что бот может в каждом канале.
// Нужно странице «Discord-бот»: списки для выбора и проверка «бот сможет писать сюда?».
// Только REST от имени бота (DISCORD_BOT_TOKEN), без постоянного подключения. Ответ запоминаем на минуту.

const API = 'https://discord.com/api/v10';
const SNOWFLAKE = /^\d{17,20}$/;

// Права Discord (битовая маска). PIN_MESSAGES — новое отдельное право на закрепление (раньше хватало MANAGE_MESSAGES)
export const P = {
  ADMIN: 1n << 3n, MANAGE_CHANNELS: 1n << 4n, VIEW: 1n << 10n, SEND: 1n << 11n, MANAGE_MESSAGES: 1n << 13n, EMBED: 1n << 14n,
  HISTORY: 1n << 16n, MENTION_EVERYONE: 1n << 17n, MANAGE_NICKNAMES: 1n << 27n, MANAGE_ROLES: 1n << 28n, PIN_MESSAGES: 1n << 51n,
};
const ALL = (1n << 64n) - 1n;

/** Что нужно функции → права и их названия в настройках канала Discord (русский клиент) */
export const NEEDS = {
  view: { bits: [P.VIEW], name: 'Просматривать канал' },
  send: { bits: [P.SEND], name: 'Отправлять сообщения' },
  embed: { bits: [P.EMBED], name: 'Встраивать ссылки' },
  history: { bits: [P.HISTORY], name: 'Читать историю сообщений' },
  pin: { bits: [P.PIN_MESSAGES, P.MANAGE_MESSAGES], name: 'Закреплять сообщения' }, // хватит любого из двух
};

/** Права участника на сервере: @everyone + его роли; администратору — всё */
export function basePerms(member, roles, guildId) {
  const byId = new Map(roles.map(r => [r.id, r]));
  let p = BigInt(byId.get(guildId)?.permissions || 0);
  for (const id of member.roles || []) p |= BigInt(byId.get(id)?.permissions || 0);
  return p & P.ADMIN ? ALL : p;
}

/** Права в канале: базовые → запреты/разрешения @everyone → ролей → самого участника (порядок Discord) */
export function channelPerms(base, channel, member, guildId, userId) {
  if (base === ALL) return ALL;
  let p = base;
  const ow = channel.permission_overwrites || [];
  const apply = o => { if (o) { p &= ~BigInt(o.deny || 0); p |= BigInt(o.allow || 0); } };
  apply(ow.find(o => o.id === guildId));
  let deny = 0n, allow = 0n;
  const mine = new Set(member.roles || []);
  for (const o of ow) if (o.type === 0 && mine.has(o.id)) { deny |= BigInt(o.deny || 0); allow |= BigInt(o.allow || 0); }
  p &= ~deny; p |= allow;
  apply(ow.find(o => o.type === 1 && o.id === userId));
  return p;
}

/** Каких прав из списка не хватает: ['send', 'pin'] → названия недостающих */
export function missing(perms, needs) {
  return needs.filter(n => NEEDS[n] && !NEEDS[n].bits.some(b => perms & b)).map(n => NEEDS[n].name);
}

/**
 * @param {{ token: string, guildId: () => string, fetchFn?: typeof fetch, ttlMs?: number, now?: () => number }} o
 */
export function createGuild({ token = '', guildId = () => '', fetchFn = globalThis.fetch, ttlMs = 60_000, now = () => Date.now() } = {}) {
  const auth = String(token || '').trim();
  let cache = null, me = null;

  async function api(path, { method = 'GET', body, reason } = {}) {
    const headers = { Authorization: `Bot ${auth}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (reason) headers['X-Audit-Log-Reason'] = encodeURIComponent(reason);
    const r = await fetchFn(`${API}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000) });
    let data = null;
    try { data = r.status === 204 ? null : await r.json(); } catch { /* пустой ответ */ }
    if (!r.ok) {
      const e = new Error(r.status === 403 ? 'Discord не разрешил: у бота нет нужного права' : r.status === 401 ? 'Discord не принял токен бота' : `Discord ответил ${r.status}`);
      e.status = r.status; e.code = data?.code; throw e;
    }
    return data;
  }

  /** Серверы, где есть бот: [{ id, name }] */
  async function guilds() {
    const list = await api('/users/@me/guilds');
    return (Array.isArray(list) ? list : []).map(g => ({ id: g.id, name: g.name }));
  }

  /** Какой сервер: выбранный на странице (или из .env), иначе единственный/первый, где есть бот */
  async function pickGuild() {
    const set = String(guildId() || '').trim();
    const all = await guilds();
    const g = (SNOWFLAKE.test(set) && all.find(x => x.id === set)) || all[0] || null;
    return { guild: g, all };
  }

  /**
   * Всё для страницы: сервер, каналы (текстовые и объявлений) с правами бота, роли, права бота на сервере.
   * fresh — не брать из кэша (кнопка «Обновить списки»)
   */
  async function snapshot(fresh = false) {
    if (!auth) return { ok: false, error: 'Нет токена бота' };
    const want = String(guildId() || '').trim();
    if (!fresh && cache && now() - cache.at < ttlMs && (!want || cache.guild?.id === want)) return cache;
    me ||= await api('/users/@me');
    const { guild, all } = await pickGuild();
    if (!guild) { cache = { ok: true, at: now(), me: { id: me.id, name: me.username }, guilds: all, guild: null, channels: [], roles: [] }; return cache; }
    const [chs, roles, member] = await Promise.all([api(`/guilds/${guild.id}/channels`), api(`/guilds/${guild.id}/roles`), api(`/guilds/${guild.id}/members/${me.id}`)]);
    const base = basePerms(member, roles, guild.id);
    const cats = new Map((chs || []).filter(c => c.type === 4).map(c => [c.id, c]));
    const top = Math.max(0, ...(member.roles || []).map(id => roles.find(r => r.id === id)?.position || 0));
    const channels = (chs || []).filter(c => c.type === 0 || c.type === 5)
      .map(c => ({ id: c.id, name: c.name, type: c.type, category: cats.get(c.parent_id)?.name || '', pos: [cats.get(c.parent_id)?.position ?? -1, c.position], perms: channelPerms(base, c, member, guild.id, me.id) }))
      .sort((a, b) => a.pos[0] - b.pos[0] || a.pos[1] - b.pos[1]);
    const list = (roles || []).filter(r => r.id !== guild.id).sort((a, b) => b.position - a.position)
      .map(r => ({ id: r.id, name: r.name, color: r.color || 0, position: r.position, managed: !!r.managed, mentionable: !!r.mentionable }));
    cache = { ok: true, at: now(), me: { id: me.id, name: me.username }, guilds: all, guild, channels, roles: list, base, top };
    return cache;
  }

  /** Новый текстовый канал; боту — права на запись и закрепление прямо в нём */
  async function createChannel(name, { parentOf = null } = {}) {
    const s = await snapshot();
    if (!s.guild) throw new Error('Бот не добавлен ни на один сервер');
    const allow = String(P.VIEW | P.SEND | P.EMBED | P.HISTORY | P.MANAGE_MESSAGES);
    const parent = parentOf ? s.channels.find(c => c.id === parentOf) : null;
    const body = { name: String(name).toLowerCase().replace(/[^a-zа-яё0-9_-]+/gi, '-').slice(0, 90) || 'sky-guide', type: 0, permission_overwrites: [{ id: s.me.id, type: 1, allow }] };
    if (parent) { const ch = await api(`/channels/${parent.id}`).catch(() => null); if (ch?.parent_id) body.parent_id = ch.parent_id; }
    const c = await api(`/guilds/${s.guild.id}/channels`, { method: 'POST', body, reason: 'Sky Guide: канал для бота' });
    cache = null;
    return c;
  }

  /** Новая роль без прав, которую можно упоминать (для пингов событий и Verified) */
  async function createRole(name) {
    const s = await snapshot();
    if (!s.guild) throw new Error('Бот не добавлен ни на один сервер');
    const r = await api(`/guilds/${s.guild.id}/roles`, { method: 'POST', body: { name: String(name).slice(0, 100), permissions: '0', mentionable: true }, reason: 'Sky Guide: роль для бота' });
    cache = null;
    return r;
  }

  /** Пробное сообщение в канал; бот сам удаляет его через deleteAfterMs */
  async function testMessage(channelId, text, deleteAfterMs = 20_000) {
    const m = await api(`/channels/${channelId}/messages`, { method: 'POST', body: { content: text, allowed_mentions: { parse: [] } } });
    if (m?.id && deleteAfterMs) setTimeout(() => api(`/channels/${channelId}/messages/${m.id}`, { method: 'DELETE' }).catch(() => {}), deleteAfterMs).unref?.();
    return true;
  }

  return { enabled: !!auth, guildIdNow: () => cache?.guild?.id || '', snapshot, guilds, createChannel, createRole, testMessage, forget: () => { cache = null; } };
}
