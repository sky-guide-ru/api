// Проверка подписи запросов Discord (Ed25519): без неё любой мог бы слать сайту «команды от Discord».
// Ключ — Public Key приложения (DISCORD_PUBLIC_KEY, 64 hex-символа). Discord сам проверяет, что
// неподписанный запрос получает 401, иначе не даст сохранить адрес Interactions Endpoint URL.
import crypto from 'node:crypto';

const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex'); // DER-обёртка для «голого» ключа Ed25519
const MAX_SKEW_SEC = 5 * 60; // старые запросы (повтор перехваченного) не принимаем

/** @returns {null | ((sig, ts, body: Buffer, nowSec?) => boolean)} */
export function makeVerifier(publicKeyHex) {
  const hex = String(publicKeyHex || '').trim();
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  const key = crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(hex, 'hex')]), format: 'der', type: 'spki' });
  return (sig, ts, body, nowSec = Date.now() / 1000) => {
    if (!/^[0-9a-f]{128}$/i.test(String(sig || '')) || !/^\d{1,12}$/.test(String(ts || ''))) return false;
    if (Math.abs(nowSec - Number(ts)) > MAX_SKEW_SEC) return false;
    try { return crypto.verify(null, Buffer.concat([Buffer.from(String(ts)), Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''))]), key, Buffer.from(sig, 'hex')); } catch { return false; }
  };
}
