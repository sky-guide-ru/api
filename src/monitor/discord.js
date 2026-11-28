// Discord для владельца: тревоги о серьёзных сбоях и живое сообщение «состояние сайта».
// Куда идут тревоги (первое, что настроено):
//   1. DISCORD_ALERTS_WEBHOOK — webhook закрытого канала;
//   2. DISCORD_ALERTS_CHANNEL_ID — канал, куда пишет бот Sky Guide (DISCORD_BOT_TOKEN уже есть);
//   3. личные сообщения владельцу от бота: DISCORD_ALERTS_USER_ID или Discord, привязанный к нику владельца в #verify.
// Состояние сайта: DISCORD_STATUS_CHANNEL_ID — бот держит там одно сообщение и правит его раз в минуту.
// Со страницы «Discord-бот» (live) то же выбирается из списков и действует сразу; .env — значения по умолчанию.
// В тексты не попадают ключи, почта, IP и ники (scrub в monitor, в состоянии — только числа).
import fs from 'node:fs';
import { validWebhook } from '../discord-news.js';

const API = 'https://discord.com/api/v10';
const SNOWFLAKE = /^\d{17,20}$/;
const COLORS = { alert: 0xe5484d, digest: 0x5865f2, test: 0x30a46c, ok: 0x30a46c, mid: 0xf5a524, bad: 0xe5484d };

/** Карточка Discord (embed); упоминания выключены — @everyone из текста ошибки не сработает */
export function alertMessage({ title, text, kind = 'alert', url = '' }) {
  const desc = String(text || '');
  return {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: String(title || '').slice(0, 256),
      description: desc.length > 4000 ? `${desc.slice(0, 3990)}\n…` : desc,
      color: COLORS[kind] ?? COLORS.alert,
      ...(url ? { url } : {}),
    }],
  };
}

const LOAD = { low: ['🟢', 'спокойно', 'ok'], medium: ['🟡', 'занят', 'mid'], high: ['🔴', 'перегружен', 'bad'] };
const fmtSec = ms => (ms == null ? '—' : ms >= 10_000 ? 'дольше 6 с' : ms < 1000 ? `${ms} мс` : `${(ms / 1000).toFixed(1).replace('.', ',')} с`);
const ru = n => String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
function dur(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  return d ? `${d} д ${h} ч` : h ? `${h} ч ${m} мин` : `${m} мин`;
}

/**
 * Живое сообщение «состояние сайта». Время обновления — меткой Discord <t:…:R>: она сама тикает у читателя,
 * поэтому если сайт упал и сообщение перестало обновляться, видно «обновлено 12 минут назад».
 * @param {{ load: string, why: string, uptimeSec: number, perHour: number, p95: number|null, e5: number,
 *   hypixel: { used5m: number, limit: number, paused: boolean }, cpu: number|null, at: number, url?: string }} s
 */
export function statusMessage(s) {
  const [dot, label, color] = LOAD[s.load] || LOAD.low;
  const hp = s.hypixel.limit ? Math.round(s.hypixel.used5m / s.hypixel.limit * 100) : 0;
  const lines = [
    `${dot} **Сайт работает**, нагрузка: ${label} (${s.why})`,
    `Без перерыва: ${dur(s.uptimeSec)}`,
    `Запросов за час: ${ru(s.perHour)} · у 95% ответ до ${fmtSec(s.p95)}${s.e5 ? ` · ошибок: ${s.e5}` : ''}`,
    `Ключ Hypixel: ${s.hypixel.paused ? 'на паузе, профили обновятся позже' : `${hp}% лимита за 5 минут`}`,
    s.cpu != null ? `Процессор сервера: ${s.cpu}%` : null,
    '',
    `Обновлено <t:${Math.floor(s.at / 1000)}:R>. Если давно не обновлялось — сайт, скорее всего, лежит.`,
  ].filter(l => l != null);
  return {
    allowed_mentions: { parse: [] },
    embeds: [{ title: 'Состояние Sky Guide', description: lines.join('\n'), color: COLORS[color], ...(s.url ? { url: s.url } : {}) }],
  };
}

/**
 * @param {{ webhook?: string, botToken?: string, channelId?: string, userId?: () => string|null,
 *   statusChannelId?: string, statusFile?: string, siteUrl?: string, fetchFn?: typeof fetch }} o
 */
export function createDiscordAlerts({ webhook = '', botToken = '', channelId = '', userId = () => null, statusChannelId = '', statusFile = '', siteUrl = '', fetchFn = globalThis.fetch, live = null } = {}) {
  const hook = String(webhook || '').trim(), token = String(botToken || '').trim();
  const snow = v => (SNOWFLAKE.test(String(v || '').trim()) ? String(v).trim() : '');
  // live() — настройки со страницы «Discord-бот»: { alerts: { on, to: 'dm'|'channel'|'webhook', channel }, status: { on, channel } }.
  // Читаются при каждой отправке, поэтому смена канала на странице действует сразу. Без live — как раньше, из .env
  const cur = () => { try { return live?.() || null; } catch { return null; } };
  const chan = () => { const l = cur()?.alerts; return snow(l ? l.channel : channelId); };
  const statusChan = () => { const l = cur()?.status; return token ? snow(l ? (l.on === false ? '' : l.channel) : statusChannelId) : ''; };
  const site = String(siteUrl || '').replace(/\/$/, '');
  const url = site ? `${site}/#/status` : '';
  const owner = () => { try { const id = String(userId() || '').trim(); return SNOWFLAKE.test(id) ? id : null; } catch { return null; } };
  const mode = () => {
    const l = cur()?.alerts;
    if (!l) return validWebhook(hook) ? 'webhook' : token && chan() ? 'channel' : token && owner() ? 'dm' : null;
    if (l.on === false) return null;
    if (l.to === 'webhook') return validWebhook(hook) ? 'webhook' : null;
    if (l.to === 'channel') return token && chan() ? 'channel' : null;
    return token && owner() ? 'dm' : null;
  };
  let pauseUntil = 0, dmChannel = null;

  async function call(u, method, body, auth = true) {
    if (Date.now() < pauseUntil) throw new Error('Discord просил подождать');
    const r = await fetchFn(u, {
      method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bot ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000),
    });
    if (r.status === 429) {
      let wait = 60;
      try { wait = Math.ceil(Number((await r.json()).retry_after) || 60); } catch { /* по умолчанию минута */ }
      pauseUntil = Date.now() + wait * 1000;
      throw new Error(`Discord просит подождать ${wait} с`);
    }
    if (!r.ok) { const e = new Error(`Discord ответил ${r.status}`); e.status = r.status; throw e; }
    try { return r.status === 204 ? null : await r.json(); } catch { return null; }
  }

  /** Тревога. true — ушла */
  async function send(m) {
    const how = mode();
    if (!how) return false;
    const body = alertMessage({ ...m, url });
    if (how === 'webhook') { await call(hook, 'POST', { username: 'Sky Guide · сервер', ...body }, false); return true; }
    let target = chan();
    if (how === 'dm') {
      const id = owner();
      if (dmChannel?.user !== id) dmChannel = { user: id, id: (await call(`${API}/users/@me/channels`, 'POST', { recipient_id: id }))?.id };
      target = dmChannel.id;
      if (!target) throw new Error('Discord не открыл личные сообщения');
    }
    await call(`${API}/channels/${target}/messages`, 'POST', body);
    return true;
  }

  // ---------- Живое сообщение о состоянии ----------
  const readSaved = () => { try { return JSON.parse(fs.readFileSync(statusFile, 'utf8')); } catch { return {}; } };
  let saved = statusFile ? readSaved() : {};
  const save = () => { if (statusFile) { try { fs.writeFileSync(statusFile, JSON.stringify(saved)); } catch { /* в следующий раз */ } } };

  /** Обновить сообщение (создать, если его нет или его удалили). true — обновилось */
  async function updateStatus(s) {
    const ch = statusChan();
    if (!ch) return false;
    const body = statusMessage({ ...s, url: site });
    if (saved.channel === ch && saved.message) {
      try { await call(`${API}/channels/${ch}/messages/${saved.message}`, 'PATCH', body); return true; } catch (e) { if (e.status !== 404) throw e; }
    }
    // Канал сменили на странице — старое сообщение убираем, чтобы в прошлом канале не висело замершее состояние
    if (saved.channel && saved.channel !== ch && saved.message) call(`${API}/channels/${saved.channel}/messages/${saved.message}`, 'DELETE').catch(() => {});
    const m = await call(`${API}/channels/${ch}/messages`, 'POST', body);
    saved = { channel: ch, message: m?.id || null };
    save();
    // Закрепить, чтобы не терялось в чате; без права «Управлять сообщениями» просто не закрепится
    if (m?.id) call(`${API}/channels/${ch}/pins/${m.id}`, 'PUT').catch(() => {});
    return true;
  }

  return {
    get enabled() { return !!mode(); },
    mode, send,
    get statusEnabled() { return !!statusChan(); }, updateStatus,
  };
}
