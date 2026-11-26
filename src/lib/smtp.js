// Маленький SMTP-клиент без зависимостей: только отправка письма на свою почту (отзывы с сайта).
// Gmail: smtp.gmail.com, порт 465 (сразу TLS) или 587 (STARTTLS), вход — почта + пароль приложения.
import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import path from 'node:path';
import { ensureDkimKey, dkimSign } from './dkim.js';
import { tx } from '@sky-guide/core/i18n/msg.js';

const b64 = s => Buffer.from(s, 'utf8').toString('base64');
// Тема и имена файлов не по-английски — кодируем по RFC 2047, иначе почта покажет кракозябры
const encWord = s => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const wrap76 = s => s.replace(/.{1,76}/g, '$&\r\n');
const cleanHeader = s => String(s || '').replace(/[\r\n]+/g, ' ').trim();

/**
 * Читает настройки почты из .env. null — почта не настроена (отзывы только сохраняются на сервере).
 * Три способа отправки:
 *  - напрямую со своего сервера (MAIL_DOMAIN=sky-guide.ru) — сервер сам несёт письмо на почтовый сервер
 *    получателя (порт 25) с адреса noreply@домен и подписывает его DKIM. Нужны DNS-записи: docs/mail.md;
 *  - SMTP (SMTP_USER + SMTP_PASS) — обычная почта, например Gmail;
 *  - Resend по HTTPS (RESEND_API_KEY) — когда хостинг закрыл серверу почтовые порты 465/587.
 * Порядок: напрямую → Resend → SMTP; следующий способ — запасной, если предыдущий не смог.
 * MAIL_TRANSPORT=resend — без прямой отправки, MAIL_TRANSPORT=smtp — только SMTP.
 */
export function smtpConfig(env = process.env) {
  const rest = viaResendOrSmtp(env);
  const mode = String(env.MAIL_TRANSPORT || '').trim();
  const domain = String(env.MAIL_DOMAIN || '').trim().toLowerCase().replace(/^@/, '');
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) || mode === 'smtp' || mode === 'resend') return rest;
  const to = String(env.MAIL_TO || env.FEEDBACK_TO || env.SMTP_USER || '').trim();
  if (!to) return rest;
  const dataDir = env.DATA_DIR ? path.resolve(env.DATA_DIR) : path.resolve('data');
  return {
    transport: 'direct', host: domain, domain, to,
    from: String(env.MAIL_FROM || '').trim() || `noreply@${domain}`,
    // Имя сервера в приветствии: на него указывает A-запись, а на IP — PTR (обратная запись у хостера)
    helo: String(env.MAIL_HELO || '').trim() || `mail.${domain}`,
    selector: String(env.DKIM_SELECTOR || '').trim() || 'sky',
    keyDir: path.join(dataDir, 'mail'),
    fallback: rest,
  };
}

function viaResendOrSmtp(env) {
  const smtp = smtpOnly(env);
  const key = String(env.RESEND_API_KEY || '').trim();
  if (!key || (smtp && String(env.MAIL_TRANSPORT || '').trim() === 'smtp')) return smtp;
  const to = String(env.MAIL_TO || env.FEEDBACK_TO || env.SMTP_USER || '').trim();
  if (!to) return smtp;
  // Без своего домена Resend шлёт только с onboarding@resend.dev и только на почту, с которой зарегистрирован аккаунт
  const from = String(env.RESEND_FROM || '').trim() || 'onboarding@resend.dev';
  return { transport: 'resend', host: 'api.resend.com', key, to, from, smtp };
}

function smtpOnly(env) {
  const user = String(env.SMTP_USER || '').trim();
  const pass = String(env.SMTP_PASS || '').replace(/\s+/g, ''); // пароль приложения Google копируют с пробелами
  if (!user || !pass) return null;
  const host = String(env.SMTP_HOST || 'smtp.gmail.com').trim();
  const port = Number(env.SMTP_PORT) || 465;
  const to = String(env.MAIL_TO || env.FEEDBACK_TO || user).trim();
  // Без шифрования — только для проверок на этом же компьютере (тесты)
  const plain = env.SMTP_INSECURE_LOCAL === '1' && /^(127\.0\.0\.1|localhost)$/.test(host);
  return { transport: 'smtp', host, port, user, pass, to, from: String(env.SMTP_FROM || user).trim(), secure: plain ? 'none' : port === 465 ? 'tls' : 'starttls' };
}

/** Собирает письмо: текст + (необязательно) вложения { name, type, data: Buffer } */
export function buildMessage({ from, to, subject, text, attachments = [], date = new Date(), idDomain = 'skyblock-tracker' }) {
  const id = `<${crypto.randomUUID()}@${idDomain}>`;
  const head = [
    `From: ${encWord('Sky Guide')} <${cleanHeader(from)}>`,
    `To: <${cleanHeader(to)}>`,
    `Subject: ${encWord(cleanHeader(subject))}`,
    `Date: ${date.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: ${id}`,
    'MIME-Version: 1.0',
  ];
  const body = wrap76(b64(text));
  if (!attachments.length) {
    return [...head, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', body].join('\r\n');
  }
  const bnd = `sb-${crypto.randomBytes(12).toString('hex')}`;
  const parts = [`--${bnd}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', body];
  for (const a of attachments) {
    const name = encWord(cleanHeader(a.name));
    parts.push(`--${bnd}`, `Content-Type: ${a.type}; name="${name}"`, 'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${name}"`, '', wrap76(a.data.toString('base64')));
  }
  parts.push(`--${bnd}--`, '');
  return [...head, `Content-Type: multipart/mixed; boundary="${bnd}"`, '', ...parts].join('\r\n');
}

/** Диалог с SMTP-сервером: ждём ответ с нужным кодом на каждую команду */
function session(socket, timeoutMs) {
  let buf = '', waiter = null, failed = null;
  const onData = d => { buf += d.toString('utf8'); check(); };
  const check = () => {
    if (!waiter) return;
    // Ответ закончен, когда пришла строка «код пробел …» (многострочные — «код-…»)
    // Последний кусок без \r\n — строка ещё не дошла целиком (TCP режет ответы как угодно): его не смотрим
    const lines = buf.split('\r\n');
    const end = lines.slice(0, -1).findIndex(l => /^\d{3} /.test(l) || /^\d{3}$/.test(l));
    if (end < 0) return;
    const reply = lines.slice(0, end + 1).join('\n');
    buf = lines.slice(end + 1).join('\r\n');
    const w = waiter; waiter = null; clearTimeout(w.t);
    w.resolve({ code: Number(reply.slice(0, 3)), text: reply });
  };
  const fail = e => { failed = e; if (waiter) { const w = waiter; waiter = null; clearTimeout(w.t); w.reject(e); } };
  const attach = s => { s.on('data', onData); s.on('error', fail); s.on('close', () => fail(new Error('Почтовый сервер закрыл соединение'))); };
  attach(socket);
  return {
    swap(s) { socket.removeListener('data', onData); attach(s); socket = s; },
    read() {
      if (failed) return Promise.reject(failed);
      return new Promise((resolve, reject) => {
        waiter = { resolve, reject, t: setTimeout(() => fail(new Error('Почтовый сервер не ответил вовремя')), timeoutMs) };
        check();
      });
    },
    async cmd(line, ok) {
      if (line != null) socket.write(line + '\r\n');
      const r = await this.read();
      if (!ok.includes(r.code)) {
        const e = new Error(r.code === 535 ? 'Почта не пустила: неверный логин или пароль приложения (SMTP_USER / SMTP_PASS)' : tx`Почтовый сервер ответил: ${r.text.slice(0, 200)}`);
        e.smtpCode = r.code; throw e;
      }
      return r;
    },
    end() { try { socket.end(); } catch { /* уже закрыто */ } },
  };
}

/**
 * Отправляет письмо. cfg — из smtpConfig(); msg — { subject, text, attachments }.
 * Возвращает { via: 'direct' | 'resend' | 'smtp', failed?: [причины, почему не ушло способами раньше] }.
 */
export async function sendMail(cfg, msg, opts = {}) {
  const failed = [];
  for (let c = cfg; c; ) {
    const next = c.transport === 'direct' ? c.fallback : c.transport === 'resend' ? c.smtp : null;
    try {
      if (c.transport === 'direct') await directSend(c, msg, opts);
      else if (c.transport === 'resend') await resendSend(c, msg, opts);
      else await smtpSend(c, msg, opts);
      if (failed.length) console.warn('[почта] ушло запасным способом', c.transport, '—', failed.join('; '));
      return failed.length ? { via: c.transport, failed } : { via: c.transport };
    } catch (e) {
      if (!next) {
        if (!failed.length) throw e;
        throw new Error(tx`${failed.join('; ')}; запасная отправка ${c.transport === 'smtp' ? 'по SMTP' : 'через Resend'}: ${e.message}`);
      }
      failed.push(e.message);
      c = next;
    }
  }
}

/** Отправка через Resend (HTTPS, порт 443 — его хостинги не закрывают) */
async function resendSend(cfg, msg, { timeoutMs = 20_000, fetchImpl = fetch } = {}) {
  const body = {
    from: `${cleanHeader('Sky Guide')} <${cleanHeader(cfg.from).replace(/^.*<|>.*$/g, '')}>`,
    to: [cleanHeader(cfg.to)],
    subject: cleanHeader(msg.subject),
    text: msg.text,
  };
  if (msg.attachments?.length) body.attachments = msg.attachments.map(a => ({ filename: cleanHeader(a.name), content: a.data.toString('base64') }));
  let r;
  try {
    r = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new Error(tx`Resend недоступен: ${String(e.message || e).slice(0, 120)}`);
  }
  if (r.ok) return;
  let detail = '';
  try { const j = await r.json(); detail = String(j.message || j.name || ''); } catch { /* не JSON */ }
  const e = new Error(r.status === 401 || r.status === 403
    ? tx`Resend не пустил (${r.status}): проверь RESEND_API_KEY и что MAIL_TO — та же почта, на которую зарегистрирован Resend. ${detail}`.trim()
    : tx`Resend ответил ${r.status}: ${detail}`.slice(0, 200));
  e.status = r.status;
  throw e;
}

/** Почтовые серверы домена получателя (MX), ближайший первым. Нет MX — сам домен (RFC 5321, 5.1) */
async function mxHosts(domain, resolveMx = dns.resolveMx) {
  let mx = [];
  try { mx = await resolveMx(domain); } catch (e) { if (!['ENODATA', 'ENOTFOUND'].includes(e.code)) throw e; }
  if (!mx.length) return [domain];
  if (mx.length === 1 && mx[0].exchange === '') throw new Error(tx`Домен ${domain} не принимает почту`);
  return mx.sort((a, b) => a.priority - b.priority).map(m => m.exchange);
}

/**
 * Прямая отправка: сервер сам подключается к почте получателя на порт 25 (только IPv4 — у IPv6 сервера
 * нет обратной записи, без неё Gmail письмо не примет), шифрует STARTTLS и отдаёт письмо с подписью DKIM.
 */
async function directSend(cfg, msg, { timeoutMs = 20_000, resolveMx, connectOpts = {} } = {}) {
  const key = ensureDkimKey(cfg.keyDir);
  const rcptDomain = cleanHeader(cfg.to).split('@').pop().toLowerCase();
  const raw = dkimSign(buildMessage({ from: cfg.from, to: cfg.to, idDomain: cfg.domain, ...msg }),
    { domain: cfg.domain, selector: cfg.selector, privateKey: key.privateKey });
  const hosts = (connectOpts.hosts || await mxHosts(rcptDomain, resolveMx)).slice(0, 3);
  let last;
  for (const host of hosts) {
    try {
      await deliver(host, cfg, raw, { timeoutMs, ...connectOpts });
      return;
    } catch (e) {
      last = e;
      // 5xx — почта получателя отказала окончательно (например, не прошла проверку отправителя): другой MX ответит так же
      if (e.smtpCode >= 500) break;
    }
  }
  throw new Error(tx`Напрямую не ушло: ${String(last?.message || last).slice(0, 300)}`);
}

async function deliver(host, cfg, raw, { timeoutMs, port = 25, family = 4, tlsOpts = {} }) {
  const sock = await new Promise((resolve, reject) => {
    const s = net.connect({ host, port, family }, () => resolve(s));
    s.once('error', e => reject(new Error(e.code === 'ETIMEDOUT' || e.code === 'ECONNREFUSED'
      ? tx`не подключиться к ${host}:${port} — порт 25 закрыт у хостера?` : `${host}: ${e.message}`)));
    s.setTimeout(timeoutMs, () => s.destroy(new Error(tx`${host}:${port} не ответил вовремя — порт 25 закрыт у хостера?`)));
  });
  const c = session(sock, timeoutMs);
  try {
    await c.cmd(null, [220]);
    const ehlo = await c.cmd(`EHLO ${cfg.helo}`, [250]);
    if (/^250[ -]STARTTLS/mi.test(ehlo.text)) {
      await c.cmd('STARTTLS', [220]);
      const secured = await new Promise((resolve, reject) => {
        const t = tls.connect({ socket: sock, servername: host, ...tlsOpts }, () => resolve(t));
        t.once('error', reject);
      });
      c.swap(secured);
      await c.cmd(`EHLO ${cfg.helo}`, [250]);
    }
    await c.cmd(`MAIL FROM:<${cleanHeader(cfg.from)}>`, [250]);
    await c.cmd(`RCPT TO:<${cleanHeader(cfg.to)}>`, [250, 251]);
    await c.cmd('DATA', [354]);
    await c.cmd(raw.replace(/\r\n\./g, '\r\n..') + '\r\n.', [250]);
    await c.cmd('QUIT', [221]).catch(() => {});
  } finally {
    c.end();
  }
}

async function smtpSend(cfg, msg, { timeoutMs = 20_000 } = {}) {
  const raw = buildMessage({ from: cfg.from, to: cfg.to, ...msg });
  const connect = () => new Promise((resolve, reject) => {
    const s = cfg.secure === 'tls'
      ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host }, () => resolve(s))
      : net.connect({ host: cfg.host, port: cfg.port }, () => resolve(s));
    s.once('error', reject);
    s.setTimeout(timeoutMs, () => s.destroy(new Error('Почтовый сервер не ответил вовремя')));
  });
  const sock = await connect();
  const c = session(sock, timeoutMs);
  const me = os.hostname().replace(/[^A-Za-z0-9.-]/g, '') || 'localhost';
  try {
    await c.cmd(null, [220]);
    await c.cmd(`EHLO ${me}`, [250]);
    if (cfg.secure === 'starttls') {
      await c.cmd('STARTTLS', [220]);
      const secured = await new Promise((resolve, reject) => {
        const t = tls.connect({ socket: sock, servername: cfg.host }, () => resolve(t));
        t.once('error', reject);
      });
      c.swap(secured);
      await c.cmd(`EHLO ${me}`, [250]);
    }
    await c.cmd('AUTH LOGIN', [334]);
    await c.cmd(b64(cfg.user), [334]);
    await c.cmd(b64(cfg.pass), [235]);
    await c.cmd(`MAIL FROM:<${cleanHeader(cfg.from)}>`, [250]);
    await c.cmd(`RCPT TO:<${cleanHeader(cfg.to)}>`, [250, 251]);
    await c.cmd('DATA', [354]);
    // Строка из одной точки закончила бы письмо раньше времени — удваиваем точку в начале строк
    await c.cmd(raw.replace(/\r\n\./g, '\r\n..') + '\r\n.', [250]);
    await c.cmd('QUIT', [221]).catch(() => {});
  } finally {
    c.end();
  }
}
