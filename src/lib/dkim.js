// DKIM-подпись писем, которые сервер шлёт сам (без Gmail и Resend). Почта получателя проверяет подпись
// по открытому ключу из DNS (запись «селектор._domainkey.домен») и так понимает, что письмо правда с нашего домена.
// Ключ создаётся один раз и лежит в data/mail/ — переживает пересборки. Открытую часть показывает панель «Сервер».
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** Закрытый ключ из data/mail/dkim-private.pem; нет файла — создаёт (RSA 2048, как просит Gmail) */
export function ensureDkimKey(dir) {
  const file = path.join(dir, 'dkim-private.pem');
  let pem = null;
  try { pem = fs.readFileSync(file, 'utf8'); } catch { /* ещё нет */ }
  if (!pem) {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, pem, { mode: 0o600 });
  }
  return { privateKey: pem, dnsValue: dkimDnsValue(pem) };
}

/** Текст TXT-записи для DNS: v=DKIM1; k=rsa; p=… */
export function dkimDnsValue(privatePem) {
  const pub = crypto.createPublicKey(privatePem).export({ type: 'spki', format: 'der' }).toString('base64');
  return `v=DKIM1; k=rsa; p=${pub}`;
}

// Канонизация «relaxed» (RFC 6376, 3.4.2 и 3.4.4)
const relaxHeader = line => {
  const i = line.indexOf(':');
  return `${line.slice(0, i).toLowerCase().trim()}:${line.slice(i + 1).replace(/\r\n(?=[ \t])/g, '').replace(/[ \t]+/g, ' ').trim()}`;
};
export function relaxBody(body) {
  let lines = body.split('\r\n').map(l => l.replace(/[ \t]+/g, ' ').replace(/ $/, ''));
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.length ? lines.join('\r\n') + '\r\n' : '';
}

const SIGNED = ['from', 'to', 'subject', 'date', 'message-id', 'mime-version', 'content-type'];

/**
 * Подписывает готовое письмо (заголовки + пустая строка + тело, строки через CRLF) и возвращает его
 * с заголовком DKIM-Signature в начале. Точки в начале строк удваивать уже после подписи.
 */
export function dkimSign(raw, { domain, selector, privateKey, now = Date.now() }) {
  const cut = raw.indexOf('\r\n\r\n');
  const head = raw.slice(0, cut), body = raw.slice(cut + 4);
  // Заголовки со строками-продолжениями (начинаются с пробела) склеиваем с предыдущими
  const fields = head.split(/\r\n(?![ \t])/);
  const byName = new Map();
  for (const f of fields) {
    const n = f.slice(0, f.indexOf(':')).toLowerCase().trim();
    if (!byName.has(n)) byName.set(n, f);
  }
  const names = SIGNED.filter(n => byName.has(n));
  const bh = crypto.createHash('sha256').update(relaxBody(body)).digest('base64');
  const sig = `DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=${domain}; s=${selector}; t=${Math.floor(now / 1000)}; h=${names.join(':')}; bh=${bh}; b=`;
  const data = names.map(n => relaxHeader(byName.get(n)) + '\r\n').join('') + relaxHeader(sig);
  const b = crypto.sign('sha256', Buffer.from(data, 'utf8'), privateKey).toString('base64');
  // Длинную подпись переносим по 76 символов: строка письма не должна быть длиннее 998
  const folded = sig + b.replace(/.{1,72}/g, '$&\r\n ').replace(/\r\n $/, '');
  return `${folded}\r\n${raw}`;
}
