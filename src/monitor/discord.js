// Тревоги и ежедневная сводка сервера — в закрытый канал Discord через webhook (DISCORD_ALERTS_WEBHOOK в .env).
// Только для владельца: канал должен быть приватным. В тексты уже не попадают ключи, почта, IP и ники (scrub в monitor).
import { validWebhook } from '../discord-news.js';

const COLORS = { alert: 0xe5484d, digest: 0x5865f2, test: 0x30a46c };

/** Сообщение Discord: заголовок и текст в одной карточке (embed), упоминания выключены — @everyone из текста ошибки не сработает */
export function alertMessage({ title, text, kind = 'alert', url = '' }) {
  const desc = String(text || '');
  return {
    username: 'Sky Guide · сервер',
    allowed_mentions: { parse: [] },
    embeds: [{
      title: String(title || '').slice(0, 256),
      description: desc.length > 4000 ? `${desc.slice(0, 3990)}\n…` : desc,
      color: COLORS[kind] ?? COLORS.alert,
      ...(url ? { url } : {}),
    }],
  };
}

/**
 * @param {{ webhook?: string, siteUrl?: string, fetchFn?: typeof fetch }} o
 * @returns {{ enabled: boolean, send: (m: { title: string, text: string, kind?: string }) => Promise<boolean> }}
 */
export function createDiscordAlerts({ webhook = '', siteUrl = '', fetchFn = globalThis.fetch } = {}) {
  const hook = String(webhook || '').trim();
  const enabled = validWebhook(hook);
  const url = siteUrl ? `${String(siteUrl).replace(/\/$/, '')}/#/status` : '';
  let pauseUntil = 0;
  async function send(m) {
    if (!enabled) return false;
    if (Date.now() < pauseUntil) throw new Error('Discord просил подождать');
    const r = await fetchFn(hook, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(alertMessage({ ...m, url })), signal: AbortSignal.timeout(15_000),
    });
    if (r.status === 429) {
      let wait = 60;
      try { wait = Math.ceil(Number((await r.json()).retry_after) || 60); } catch { /* по умолчанию минута */ }
      pauseUntil = Date.now() + wait * 1000;
      throw new Error(`Discord просит подождать ${wait} с`);
    }
    if (!r.ok) throw new Error(`Discord ответил ${r.status}`);
    return true;
  }
  return { enabled, send };
}
