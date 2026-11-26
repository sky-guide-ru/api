// Прямая отправка писем со своего сервера: DKIM-подпись, диалог с почтой получателя, запасной Resend, проверка DNS
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { smtpConfig, sendMail, buildMessage } from '../src/lib/smtp.js';
import { ensureDkimKey, dkimSign, relaxBody } from '../src/lib/dkim.js';
import { checkMailDns, probePort25 } from '../src/lib/mail-dns.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mail-'));

// Проверка подписи так, как её делает почта получателя (RFC 6376, relaxed/relaxed), написанная отдельно от dkim.js
function verifyDkim(raw, dnsValue) {
  const cut = raw.indexOf('\r\n\r\n');
  const fields = raw.slice(0, cut).split(/\r\n(?![ \t])/);
  const body = raw.slice(cut + 4);
  const sigField = fields.find(f => /^dkim-signature:/i.test(f));
  const canon = f => {
    const i = f.indexOf(':');
    return f.slice(0, i).toLowerCase().trim() + ':' + f.slice(i + 1).replace(/\r\n/g, '').replace(/[ \t]+/g, ' ').trim();
  };
  const tags = Object.fromEntries(canon(sigField).slice('dkim-signature:'.length).split(';').map(t => t.trim()).filter(Boolean)
    .map(t => [t.slice(0, t.indexOf('=')), t.slice(t.indexOf('=') + 1).replace(/\s+/g, '')]));
  let b = body.split('\r\n').map(l => l.replace(/[ \t]+/g, ' ').replace(/ $/, '')).join('\r\n').replace(/(\r\n)*$/, '') + '\r\n';
  const bh = crypto.createHash('sha256').update(b).digest('base64');
  if (bh !== tags.bh) return { ok: false, why: 'bh' };
  const signed = tags.h.split(':').map(n => canon(fields.find(f => f.toLowerCase().startsWith(n + ':'))) + '\r\n').join('')
    + canon(sigField).replace(/b=[^;]*$/, 'b=');
  const pub = crypto.createPublicKey({ key: Buffer.from(/p=([^;\s]+)/.exec(dnsValue)[1], 'base64'), format: 'der', type: 'spki' });
  return { ok: crypto.verify('sha256', Buffer.from(signed), pub, Buffer.from(tags.b, 'base64')), tags };
}

test('прямая отправка включается MAIL_DOMAIN, запасные — Resend и SMTP', () => {
  const base = { MAIL_DOMAIN: 'sky-guide.ru', MAIL_TO: 'me@gmail.com', DATA_DIR: '/x' };
  const c = smtpConfig(base);
  assert.deepEqual([c.transport, c.from, c.helo, c.selector, c.fallback], ['direct', 'noreply@sky-guide.ru', 'mail.sky-guide.ru', 'sky', null]);
  assert.equal(c.keyDir, path.resolve('/x', 'mail'));
  assert.equal(smtpConfig({ ...base, RESEND_API_KEY: 'k' }).fallback.transport, 'resend');
  assert.equal(smtpConfig({ ...base, RESEND_API_KEY: 'k', MAIL_TRANSPORT: 'resend' }).transport, 'resend', 'выключить прямую отправку');
  assert.equal(smtpConfig({ MAIL_DOMAIN: 'sky-guide.ru' }), null, 'без получателя не настроено');
  assert.equal(smtpConfig({ ...base, MAIL_DOMAIN: 'bad domain' }), null);
});

test('DKIM: ключ создаётся один раз, подпись проходит проверку получателя', () => {
  const dir = tmp();
  const k1 = ensureDkimKey(dir), k2 = ensureDkimKey(dir);
  assert.equal(k1.privateKey, k2.privateKey, 'ключ не пересоздаётся при перезапуске');
  assert.match(k1.dnsValue, /^v=DKIM1; k=rsa; p=[A-Za-z0-9+/=]{300,}$/);
  const raw = buildMessage({ from: 'noreply@sky-guide.ru', to: 'me@gmail.com', subject: '[SkyBlock отзыв] Тест  с  пробелами', text: 'привет\n\nстрока', idDomain: 'sky-guide.ru',
    attachments: [{ name: 'скрин.png', type: 'image/png', data: crypto.randomBytes(500) }] });
  const signed = dkimSign(raw, { domain: 'sky-guide.ru', selector: 'sky', privateKey: k1.privateKey });
  const v = verifyDkim(signed, k1.dnsValue);
  assert.ok(v.ok, `подпись верна (${v.why || ''})`);
  assert.equal(v.tags.d, 'sky-guide.ru');
  assert.match(v.tags.h, /^from:to:subject:date:message-id:mime-version:content-type$/);
  assert.ok(signed.split('\r\n').every(l => l.length <= 998), 'строки письма не длиннее 998');
  // Испорченное письмо подпись не проходит
  assert.equal(verifyDkim(signed.replace('To: <me@gmail.com>', 'To: <evil@gmail.com>'), k1.dnsValue).ok, false);
  assert.equal(relaxBody('a  b \r\n\r\n\r\n'), 'a b\r\n');
  assert.equal(relaxBody(''), '');
});

function fakeMx({ rcptCode = 250 } = {}) {
  const got = { lines: [], data: '' };
  const srv = net.createServer(sock => {
    let inData = false, buf = '';
    sock.write('220 mx.test ESMTP\r\n');
    sock.on('data', d => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') { inData = false; sock.write('250 2.0.0 OK\r\n'); } else got.data += (line.startsWith('..') ? line.slice(1) : line) + '\r\n';
          continue;
        }
        got.lines.push(line);
        if (/^EHLO/.test(line)) sock.write('250-mx.test\r\n250 SIZE 1000000\r\n');
        else if (/^MAIL FROM/.test(line)) sock.write('250 ok\r\n');
        else if (/^RCPT TO/.test(line)) sock.write(rcptCode === 250 ? '250 ok\r\n' : `${rcptCode} 5.7.1 rejected: no PTR\r\n`);
        else if (line === 'DATA') { inData = true; sock.write('354 go\r\n'); }
        else if (line === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
      }
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, got, port: srv.address().port })));
}

test('прямая отправка: приветствие именем почтового сервера, адрес noreply@домен, подписанное письмо', async () => {
  const dir = tmp();
  const { srv, got, port } = await fakeMx();
  const cfg = smtpConfig({ MAIL_DOMAIN: 'sky-guide.ru', MAIL_TO: 'me@gmail.com', DATA_DIR: dir });
  const r = await sendMail(cfg, { subject: '[SkyBlock отзыв] Проверка', text: 'текст\n.точка' }, { connectOpts: { hosts: ['127.0.0.1'], port } });
  srv.close();
  assert.deepEqual(r, { via: 'direct' });
  assert.deepEqual(got.lines.slice(0, 3), ['EHLO mail.sky-guide.ru', 'MAIL FROM:<noreply@sky-guide.ru>', 'RCPT TO:<me@gmail.com>']);
  assert.match(got.data, /^DKIM-Signature: v=1; a=rsa-sha256; c=relaxed\/relaxed; d=sky-guide\.ru; s=sky;/);
  assert.match(got.data, /Message-ID: <[0-9a-f-]+@sky-guide\.ru>/);
  const v = verifyDkim(got.data.replace(/\r\n$/, ''), ensureDkimKey(path.join(dir, 'mail')).dnsValue);
  assert.ok(v.ok, 'подпись верна после доставки');
});

test('прямая отправка не прошла — письмо уходит через Resend, причина видна', async () => {
  const dir = tmp();
  const { srv, port } = await fakeMx({ rcptCode: 550 });
  const calls = [];
  const fetchImpl = async (url, o) => { calls.push(url); return { ok: true, status: 200, json: async () => ({}) }; };
  const cfg = smtpConfig({ MAIL_DOMAIN: 'sky-guide.ru', MAIL_TO: 'me@gmail.com', DATA_DIR: dir, RESEND_API_KEY: 'k' });
  const r = await sendMail(cfg, { subject: 's', text: 't' }, { fetchImpl, connectOpts: { hosts: ['127.0.0.1', '127.0.0.2'], port } });
  srv.close();
  assert.equal(r.via, 'resend');
  assert.match(r.failed[0], /550 5\.7\.1 rejected: no PTR/);
  assert.equal(calls.length, 1);
  // Без запасного способа ошибка уходит наверх
  const closed = await new Promise(res => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
  await assert.rejects(sendMail(smtpConfig({ MAIL_DOMAIN: 'sky-guide.ru', MAIL_TO: 'me@gmail.com', DATA_DIR: dir }), { subject: 's', text: 't' },
    { timeoutMs: 2000, connectOpts: { hosts: ['127.0.0.1'], port: closed } }), /Напрямую не ушло.*порт 25/);
});

test('проверка DNS: показывает нужные записи и что уже настроено', async () => {
  const dir = tmp();
  const cfg = smtpConfig({ MAIL_DOMAIN: 'sky-guide.ru', MAIL_TO: 'me@gmail.com', DATA_DIR: dir });
  const dkim = ensureDkimKey(cfg.keyDir).dnsValue;
  const zone = {
    A: { 'sky-guide.ru': ['203.0.113.10'], 'mail.sky-guide.ru': ['203.0.113.10'] },
    TXT: { 'sky-guide.ru': [['v=spf1 ip4:203.0.113.10 ~all'], ['google-site-verification=x']], 'sky._domainkey.sky-guide.ru': [[dkim.slice(0, 200), dkim.slice(200)]] },
  };
  const nf = () => Object.assign(new Error('nf'), { code: 'ENOTFOUND' });
  const dns = {
    resolve4: async n => zone.A[n] || Promise.reject(nf()),
    resolveTxt: async n => zone.TXT[n] || Promise.reject(nf()),
    reverse: async () => ['mail.sky-guide.ru'],
    resolveMx: async () => [{ priority: 5, exchange: 'gmail-smtp-in.l.google.com' }],
  };
  const r = await checkMailDns(cfg, { env: {}, dns, probe: async host => ({ ok: true, note: `220 ${host}` }) });
  const by = Object.fromEntries(r.records.map(x => [x.id, x]));
  assert.equal(r.ip, '203.0.113.10');
  assert.deepEqual([by.a.ok, by.ptr.ok, by.spf.ok, by.dkim.ok, by.dmarc.ok], [true, true, true, true, false]);
  assert.equal(by.dkim.want, dkim);
  assert.equal(r.ready, true, 'без DMARC письма уже можно слать');
  // SPF без IP сервера и с чужим include — подсказка дописать ip4, не теряя include
  zone.TXT['sky-guide.ru'] = [['v=spf1 include:_spf.resend.com ~all']];
  const r2 = await checkMailDns(cfg, { env: {}, dns, probe: async () => ({ ok: false, note: 'закрыт' }) });
  const spf = r2.records.find(x => x.id === 'spf');
  assert.equal(spf.ok, false);
  assert.equal(spf.want, 'v=spf1 ip4:203.0.113.10 include:_spf.resend.com ~all');
  assert.equal(r2.ready, false);
  zone.TXT['sky-guide.ru'] = [['v=spf1 ip4:192.0.2.10 -all']];
  const r3 = await checkMailDns(cfg, { env: {}, dns, probe: async () => ({ ok: true }) });
  assert.equal(r3.records.find(x => x.id === 'spf').want, 'v=spf1 ip4:203.0.113.10 ip4:192.0.2.10 -all', 'старые IP и политика остаются');
});

test('проверка порта 25 не зависает, если сервер закрыл соединение молча', async () => {
  const srv = net.createServer(sock => sock.end());
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const r = await probePort25('127.0.0.1', { port: srv.address().port, timeoutMs: 3000 });
  srv.close();
  assert.equal(r.ok, false);
  assert.match(r.note, /без приветствия/);
});
