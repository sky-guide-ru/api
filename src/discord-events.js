// События SkyBlock — в канал Discord: от имени бота в канал со страницы «Discord-бот» или через webhook (DISCORD_EVENTS_WEBHOOK): Jacob, Dark Auction, мэр и выборы,
// Fire Sales, большие события года. Каждое объявление пингует свою роль-подписку (страница или DISCORD_EVENTS_ROLES), если она задана.
// Что и когда объявлять, считает core (calendar/announce.js) по уже загруженным данным: лишних запросов к Hypixel нет.
// Что отправлено, помним в data/discord-events.json — после перезапуска не повторяем, а прошедшее не догоняем.
// Jacob и Dark Auction идут каждый час, поэтому прошлое такое сообщение удаляем, когда выходит новое: канал не зарастает.
import fs from 'node:fs';
import { dueAnnouncements, ROLES } from '@sky-guide/core/calendar/announce.js';
import { createJacobCrops } from '@sky-guide/core/calendar/jacob.js';
import { makeTarget } from './discord-news.js';

const HOURLY = new Set(['jacob', 'darkauction']);
const PER_TICK = 5;
const KEEP_MS = 2 * 86400_000; // сколько помнить ключ после того, как объявление стало неактуальным

/** «jacob=123, darkauction:456» → { jacob: '123', darkauction: '456' } (только известные роли и числовые id) */
export function parseRoles(s) {
  const out = {};
  for (const part of String(s || '').split(/[,;\s]+/)) {
    const m = /^([a-z]+)[=:](\d{5,25})$/.exec(part.trim());
    if (m && ROLES.includes(m[1])) out[m[1]] = m[2];
  }
  return out;
}

const ts = (ms, f) => `<t:${Math.floor(ms / 1000)}:${f}>`;
const num = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** Объявление из core → тело сообщения webhook */
export function eventMessage(a, { roleId = null, translate = null, siteUrl = 'https://sky-guide.ru' } = {}) {
  const en = s => (s && translate ? (t => (t && t !== s ? t : null))(translate(s)) : null);
  const both = (ru, enText) => [ru, enText ? `*${enText}*` : null].filter(Boolean).join('\n');
  const lines = [];
  if (a.crops?.length) lines.push(`**${a.crops.join(' · ')}**`);
  if (a.role === 'mayor' && a.key.startsWith('mayor:')) lines.push(`⏳ ${ts(a.end, 'R')}`);
  else if (a.role === 'firesale') lines.push(`⏰ ${ts(a.start, 'f')} — ${ts(a.end, 'f')}`);
  else lines.push(`⏰ ${ts(a.start, 't')} · ${ts(a.start, 'R')}`);
  if (a.sale) lines.push(`**${num(a.sale.amount)}** шт. / pcs · **${num(a.sale.price)}** SkyBlock Gems`);
  const text = both(a.ru, a.en || en(a.ru));
  if (text) lines.push('', text);

  const fields = [];
  for (const p of a.perks || []) fields.push({ name: p.name, value: both(p.ru, p.en).slice(0, 1024) || '—' });
  if (a.minister) {
    const p = a.minister.perk;
    fields.push({ name: `Minister ${a.minister.name}${p ? ` · ${p.name}` : ''}`, value: (p ? both(p.ru, p.en) : '—').slice(0, 1024) || '—' });
  }

  const embed = {
    title: `${a.emoji} ${a.title}`.slice(0, 256),
    url: `${siteUrl}/#/events`,
    description: lines.join('\n').slice(0, 4000),
    color: a.color,
    ...(fields.length ? { fields: fields.slice(0, 10) } : {}),
    footer: { text: 'Sky Guide · События / Events' },
  };
  return {
    ...(roleId ? { content: `<@&${roleId}>` } : {}),
    embeds: [embed],
    allowed_mentions: { parse: [], roles: roleId ? [roleId] : [] },
  };
}

function fileStore(file) {
  return {
    load() { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } },
    save(s) { try { fs.writeFileSync(file, JSON.stringify(s, null, 1)); } catch (e) { console.warn('[discord-события] не удалось сохранить, что отправлено:', e.message); } },
  };
}

/**
 * @param {{ webhook?: string, roles?: string|object, siteUrl?: string, file?: string, store?: { load: Function, save: Function },
 *   due?: (now: number, o: object) => object[], crops?: { refresh: Function, cropsAt: Function }|null,
 *   translate?: (s: string) => string, fetchFn?: typeof fetch, now?: () => number, log?: Console }} o
 */
export function createDiscordEvents(o = {}) {
  const target = makeTarget(o);
  // Роли можно менять на странице «Discord-бот»: функция читается перед каждой отправкой
  const rolesNow = () => { const r = typeof o.roles === 'function' ? o.roles() : o.roles; return typeof r === 'object' && r ? r : parseRoles(r); };
  const siteUrl = String(o.siteUrl || 'https://sky-guide.ru').replace(/\/$/, '');
  const store = o.store || (o.file ? fileStore(o.file) : { load: () => null, save: () => {} });
  const due = o.due || dueAnnouncements;
  const crops = o.crops === undefined ? createJacobCrops() : o.crops;
  const fetchFn = o.fetchFn || globalThis.fetch, now = o.now || (() => Date.now()), log = o.log || console;
  let busy = false, pauseUntil = 0;

  async function call(method, url, body, headers = { 'Content-Type': 'application/json' }) {
    const r = await fetchFn(url, {
      method, headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000),
    });
    if (r.status === 429) {
      let wait = 60;
      try { wait = Math.ceil(Number((await r.json()).retry_after) || 60); } catch { /* по умолчанию минута */ }
      pauseUntil = now() + wait * 1000;
      throw new Error(`Discord просит подождать ${wait} с`);
    }
    if (!r.ok && !(method === 'DELETE' && r.status === 404)) throw new Error(`Discord ответил ${r.status}`);
    return r;
  }

  /** Отправить объявления, которым пора. Возвращает число отправленных сообщений */
  async function tick() {
    if (!target() || busy || now() < pauseUntil) return 0;
    busy = true;
    let sent = 0;
    try {
      const t = now();
      if (crops) await crops.refresh().catch(() => false);
      const s = store.load() || {};
      s.sent ||= {}; s.last ||= {};
      for (const [k, until] of Object.entries(s.sent)) if (until + KEEP_MS < t) delete s.sent[k];
      const list = due(t, crops ? { cropsAt: x => crops.cropsAt(x) } : {}).filter(a => !s.sent[a.key] && t >= a.at && t < a.until).slice(0, PER_TICK);
      const roles = rolesNow();
      for (const a of list) {
        const tg = target();
        if (!tg) break;
        const r = await call('POST', tg.url, eventMessage(a, { roleId: roles[a.role] || null, translate: o.translate, siteUrl }), tg.headers);
        let id = null;
        try { id = (await r.json())?.id || null; } catch { /* без id просто не удалим потом */ }
        s.sent[a.key] = a.until; sent++;
        if (HOURLY.has(a.role)) {
          // Прошлое сообщение: строка — id сообщения webhook (как раньше), { ch, id } — сообщение бота в канале
          const prev = s.last[a.role];
          s.last[a.role] = id ? (tg.ch ? { ch: tg.ch, id } : id) : null;
          store.save(s);
          const del = !prev ? null : typeof prev === 'object'
            ? (tg.ch ? { url: `${tg.url.replace(/\/channels\/\d+\/messages$/, `/channels/${prev.ch}/messages`)}/${prev.id}`, headers: tg.headers } : null)
            : (tg.hook ? { url: `${tg.hook}/messages/${prev}` } : null);
          if (del) await call('DELETE', del.url, undefined, del.headers).catch(e => log.warn?.('[discord-события] не удалось убрать прошлое сообщение:', e.message));
        } else store.save(s);
      }
      if (sent) log.log?.(`[discord-события] отправлено: ${sent}`);
    } catch (e) {
      log.warn?.('[discord-события]', e.message);
    } finally { busy = false; }
    return sent;
  }

  return { get enabled() { return !!target(); }, get roles() { return rolesNow(); }, tick };
}
