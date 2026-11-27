// Новости сайта и патчноуты SkyBlock — в канал Discord через webhook (DISCORD_NEWS_WEBHOOK в .env).
// Без переменной ничего не делает. Что уже отправлено, помним в data/discord-news.json, чтобы после
// перезапуска не повторять. Первый запуск: в канал уходит только самая свежая новость сайта, старые
// новости и уже вышедшие патчноуты просто запоминаются (без потока сообщений в канал).
import fs from 'node:fs';
import { NEWS, KIND_RU } from '@sky-guide/core/news/entries.js';
import { NEWS_LINK, plainNews } from '@sky-guide/core/news/links.js';

const WEBHOOK = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;
const COLOR = { new: 0x4caf50, better: 0x3b82f6, fix: 0xf59e0b };
const PATCH_COLOR = 0xfacc15;
const KEEP = 200; // сколько отправленных id хранить (новостей меньше, патчноуты старше 8 последних не вернутся)

export const validWebhook = url => WEBHOOK.test(String(url || '').trim());

/** Ссылки новостей [название](раздел#блок) → markdown-ссылки Discord на раздел сайта */
export function discordText(s, base) {
  return String(s ?? '').replace(NEWS_LINK, (_, label, p) => `[${label}](${base}/#/${p})`);
}

/** Сообщение для новости сайта: русская карточка и, если есть перевод, английская */
export function siteNewsMessage(e, { siteUrl, translate = null }) {
  const card = (t, base, kind, more) => ({
    title: plainNews(t(e.title)).slice(0, 256),
    url: `${base}/#/news`,
    description: e.items.map(i => `• ${discordText(t(i), base)}`).join('\n').slice(0, 4000),
    color: COLOR[e.kind] ?? COLOR.new,
    footer: { text: `${kind} · ${more}` },
    timestamp: `${e.date}T00:00:00.000Z`,
  });
  const ru = card(s => s, siteUrl, KIND_RU[e.kind] || 'Новое', 'Новости Sky Guide');
  const embeds = [ru];
  if (translate) {
    const t = s => translate(s) || s;
    const changed = [e.title, ...e.items].some(s => t(s) !== s);
    if (changed) embeds.push(card(t, `${siteUrl}/en`, t(KIND_RU[e.kind] || 'Новое'), 'Sky Guide news'));
  }
  return { embeds, allowed_mentions: { parse: [] } };
}

/** Сообщение для патчноута SkyBlock с форума Hypixel ({ title, date, link } из core/lib/live-status.js) */
export function patchNoteMessage(n) {
  return {
    embeds: [{
      title: String(n.title).slice(0, 256),
      url: n.link,
      description: 'Новый патчноут SkyBlock на форуме Hypixel\nNew SkyBlock patch notes on the Hypixel forums',
      color: PATCH_COLOR,
      footer: { text: n.date ? `Hypixel SkyBlock · ${n.date}` : 'Hypixel SkyBlock' },
    }],
    allowed_mentions: { parse: [] },
  };
}

function fileStore(file) {
  return {
    load() { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } },
    save(s) { try { fs.writeFileSync(file, JSON.stringify(s, null, 1)); } catch (e) { console.warn('[discord] не удалось сохранить, что отправлено:', e.message); } },
  };
}

/**
 * @param {{ webhook?: string, siteUrl?: string, file?: string, store?: { load: Function, save: Function },
 *   news?: object[], patches?: () => object[]|null, translate?: (s: string) => string,
 *   fetchFn?: typeof fetch, log?: Console }} o
 */
export function createDiscordNews(o = {}) {
  const webhook = String(o.webhook || '').trim();
  const enabled = validWebhook(webhook);
  const siteUrl = String(o.siteUrl || 'https://sky-guide.ru').replace(/\/$/, '');
  const store = o.store || (o.file ? fileStore(o.file) : { load: () => null, save: () => {} });
  const news = o.news || NEWS, patches = o.patches || (() => null);
  const fetchFn = o.fetchFn || globalThis.fetch, log = o.log || console;
  let busy = false, pauseUntil = 0;

  async function post(body) {
    const r = await fetchFn(`${webhook}?wait=true`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
    if (r.status === 429) {
      let wait = 60;
      try { wait = Math.ceil(Number((await r.json()).retry_after) || 60); } catch { /* по умолчанию минута */ }
      pauseUntil = Date.now() + wait * 1000;
      throw new Error(`Discord просит подождать ${wait} с`);
    }
    if (!r.ok) throw new Error(`Discord ответил ${r.status}`);
  }

  /** Отправить то, чего ещё не было. Возвращает число отправленных сообщений */
  async function tick() {
    if (!enabled || busy || Date.now() < pauseUntil) return 0;
    busy = true;
    let sent = 0;
    try {
      const s = store.load() || {};
      s.site ||= []; s.sb ||= [];
      const save = () => { s.site = s.site.slice(-KEEP); s.sb = s.sb.slice(-KEEP); store.save(s); };
      // Первый запуск: старые новости — «уже были», в канал только самая свежая
      if (!s.siteSeeded) { s.site = news.slice(1).map(e => e.id); s.siteSeeded = true; save(); }
      const sb = patches();
      if (!s.sbSeeded && Array.isArray(sb) && sb.length) { s.sb = sb.map(n => n.link); s.sbSeeded = true; save(); }

      const queue = [
        ...news.filter(e => !s.site.includes(e.id)).reverse().map(e => ({ kind: 'site', key: e.id, body: () => siteNewsMessage(e, { siteUrl, translate: o.translate }) })),
        ...(s.sbSeeded && Array.isArray(sb) ? sb.filter(n => !s.sb.includes(n.link)).reverse().map(n => ({ kind: 'sb', key: n.link, body: () => patchNoteMessage(n) })) : []),
      ].slice(0, 5); // за раз не больше 5 сообщений, остальное — в следующий раз
      for (const q of queue) {
        await post(q.body());
        s[q.kind].push(q.key); save(); sent++;
      }
      if (sent) log.log?.(`[discord] отправлено в канал новостей: ${sent}`);
    } catch (e) {
      log.warn?.('[discord]', e.message);
    } finally { busy = false; }
    return sent;
  }

  return { enabled, tick };
}
