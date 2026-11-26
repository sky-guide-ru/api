import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { validateFeedback, mailFor, createFeedback, createFeedbackLimiter, SUBJECT_TAG } from '../src/feedback.js';
import { smtpConfig, sendMail, buildMessage } from '../src/lib/smtp.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-fb-'));
const PNG = 'data:image/png;base64,' + Buffer.from('fakepng').toString('base64');

test('проверка формы: ловушка для ботов, слишком быстро, короткий текст, ник и скриншот', () => {
  const now = 1_000_000;
  assert.ok(validateFeedback({ text: 'всё сломалось', website: 'http://spam' }, { now }).spam);
  assert.ok(validateFeedback({ text: 'всё сломалось', openedAt: now - 500 }, { now }).spam);
  assert.ok(validateFeedback({ text: 'ой' }, { now }).error);
  const ok = validateFeedback({ type: 'translate', text: '  кривой перевод  ', player: 'Steve', page: '/#/wiki', openedAt: now - 10_000, screenshot: PNG }, { now });
  assert.equal(ok.item.type, 'translate');
  assert.equal(ok.item.text, 'кривой перевод');
  assert.equal(ok.item.player, 'Steve');
  assert.equal(ok.shot.ext, 'png');
  assert.equal(validateFeedback({ text: 'текст отзыва', player: '<script>' }).item.player, '', 'кривой ник не сохраняем');
  assert.equal(validateFeedback({ text: 'текст отзыва', type: 'hack' }).item.type, 'bug');
  for (const t of ['__proto__', 'constructor', 'toString']) assert.equal(validateFeedback({ text: 'текст отзыва', type: t }).item.type, 'bug', t);
  assert.ok(validateFeedback({ text: 'текст отзыва', screenshot: 'data:text/html;base64,PGI+' }).error);
});

test('письмо: метка в теме, все сведения в тексте, адреса владельца нет', () => {
  const f = { id: 'abc', at: 0, type: 'data', text: 'Цена Hyperion 0 монет\nвторая строка', page: '/#/wiki/HYPERION', player: 'Steve', user: null, build: 'b1', contact: 'tg @x' };
  const m = mailFor(f, { siteUrl: 'https://sky.example.ru/' });
  assert.ok(m.subject.startsWith(SUBJECT_TAG + ' · Неверные данные: Цена Hyperion 0 монет'));
  for (const s of ['Номер: abc', 'Ник в поле: Steve', 'Кто отправил: гость', 'Сборка сайта: b1', 'tg @x', 'https://sky.example.ru/#/wiki/HYPERION', 'вторая строка']) assert.ok(m.text.includes(s), s);
});

test('без почты отзыв сохраняется на диск; с почтой — уходит письмом со скриншотом', async () => {
  const dir = tmp();
  const plain = createFeedback({ dataDir: dir, env: {} });
  const r = plain.add({ type: 'bug', text: 'не грузится' }, null);
  assert.equal(r.mailing, false);
  assert.equal(await r.sending, false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'feedback.json'), 'utf8'))[0].text, 'не грузится');
  assert.equal(plain.mailStatus().configured, false);

  const sent = [];
  const env = { SMTP_USER: 'owner@gmail.com', SMTP_PASS: 'abcd efgh ijkl mnop' };
  const fb = createFeedback({ dataDir: dir, env, send: async (cfg, msg) => sent.push({ cfg, msg }) });
  assert.equal(fb.list().length, 1, 'старые отзывы подхватились с диска');
  const v = validateFeedback({ text: 'кнопка не жмётся', screenshot: PNG });
  const r2 = fb.add(v.item, v.shot, { user: 'Friend' });
  assert.equal(await r2.sending, true);
  assert.equal(sent[0].cfg.pass, 'abcdefghijklmnop', 'пробелы из пароля приложения убраны');
  assert.equal(sent[0].cfg.to, 'owner@gmail.com');
  assert.ok(sent[0].msg.subject.startsWith(SUBJECT_TAG));
  assert.equal(sent[0].msg.attachments.length, 1);
  assert.ok(fs.existsSync(fb.shotFile(r2.id)));
  assert.ok(fb.get(r2.id).mailed);
  assert.equal(fb.mailStatus().to, 'o…r@gmail.com', 'адрес только маской');
  assert.ok(!JSON.stringify(fb.mailStatus()).includes('owner@'));
  assert.ok(fb.setStatus(r2.id, 'done') && fb.get(r2.id).status === 'done');
  assert.ok(!fb.setStatus(r2.id, 'hacked'));
  const shot = fb.shotFile(r2.id);
  assert.ok(fb.remove(r2.id));
  await new Promise(res => setTimeout(res, 50));
  assert.ok(!fs.existsSync(shot), 'скриншот удалён вместе с отзывом');

  // Почта упала — отзыв всё равно сохранён, ошибка видна владельцу
  const bad = createFeedback({ dataDir: dir, env, send: async () => { throw new Error('нет сети'); } });
  const r3 = bad.add({ type: 'idea', text: 'добавьте тёмную тему' }, null);
  assert.equal(await r3.sending, false);
  assert.equal(bad.get(r3.id).mailError, 'нет сети');
  assert.equal(bad.mailStatus().last.ok, false);
});

test('лимит: 5 отзывов за 10 минут с адреса, потом отказ; другой адрес не задет', () => {
  let t = 0;
  const lim = createFeedbackLimiter({ clock: () => t });
  for (let i = 0; i < 5; i++) assert.ok(lim('1.1.1.1'));
  assert.equal(lim('1.1.1.1'), false);
  assert.ok(lim('2.2.2.2'));
  t += 11 * 60_000;
  assert.ok(lim('1.1.1.1'), 'через 10 минут снова можно');
});

test('настройки почты: Gmail по умолчанию, MAIL_TO, порт 587 — STARTTLS', () => {
  assert.equal(smtpConfig({}), null);
  const c = smtpConfig({ SMTP_USER: 'a@gmail.com', SMTP_PASS: 'p' });
  assert.deepEqual([c.host, c.port, c.secure, c.to], ['smtp.gmail.com', 465, 'tls', 'a@gmail.com']);
  assert.equal(smtpConfig({ SMTP_USER: 'a@gmail.com', SMTP_PASS: 'p', SMTP_PORT: '587', MAIL_TO: 'b@x.ru' }).secure, 'starttls');
  assert.equal(smtpConfig({ SMTP_USER: 'a@gmail.com', SMTP_PASS: 'p', MAIL_TO: 'b@x.ru' }).to, 'b@x.ru');
  assert.equal(smtpConfig({ SMTP_USER: 'a', SMTP_PASS: 'p', SMTP_HOST: 'evil.com', SMTP_INSECURE_LOCAL: '1' }).secure, 'tls', 'без шифрования — только на localhost');
});

test('письмо в формате MIME: русская тема закодирована, точка в начале строки не обрывает письмо', () => {
  const raw = buildMessage({ from: 'a@b.c', to: 'd@e.f', subject: '[SkyBlock отзыв] Тест', text: 'привет', attachments: [{ name: 'скрин.png', type: 'image/png', data: Buffer.from('x') }] });
  assert.match(raw, /Subject: =\?UTF-8\?B\?/);
  assert.match(raw, /multipart\/mixed/);
  assert.ok(!/\r\nTo: <d@e\.f>\r\nX/.test(raw));
  const inj = buildMessage({ from: 'a@b.c', to: 'd@e.f\r\nBcc: x@y.z', subject: 's\r\nBcc: x@y.z', text: 't' });
  assert.ok(!/\r\nBcc:/.test(inj), 'переносы строк в заголовках не дают дописать получателя');
});

test('SMTP-диалог с настоящим (тестовым) сервером: вход, получатель, текст письма', async () => {
  const got = { lines: [], data: '' };
  const srv = net.createServer(sock => {
    let inData = false, buf = '', n = 0;
    sock.write('220 test ESMTP\r\n');
    sock.on('data', d => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') { inData = false; sock.write('250 OK queued\r\n'); } else got.data += line + '\n';
          continue;
        }
        got.lines.push(line); n++;
        // Ответ на EHLO приходит кусками, как бывает в сети: «250 » отдельно от остального
        if (/^EHLO/.test(line)) { sock.write('250-test\r\n250 '); setTimeout(() => sock.write('AUTH LOGIN\r\n'), 30); }
        else if (line === 'AUTH LOGIN') sock.write('334 VXNlcm5hbWU6\r\n');
        else if (n === 3) sock.write('334 UGFzc3dvcmQ6\r\n');
        else if (n === 4) sock.write(Buffer.from(line, 'base64').toString() === 'secret' ? '235 ok\r\n' : '535 bad\r\n');
        else if (/^MAIL FROM|^RCPT TO/.test(line)) sock.write('250 ok\r\n');
        else if (line === 'DATA') { inData = true; sock.write('354 go\r\n'); }
        else if (line === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
      }
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const env = { SMTP_USER: 'me@gmail.com', SMTP_PASS: 'secret', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), SMTP_INSECURE_LOCAL: '1' };
  await sendMail(smtpConfig(env), { subject: `${SUBJECT_TAG} Проверка`, text: 'строка\n.точка в начале' });
  assert.ok(got.lines.includes('RCPT TO:<me@gmail.com>'));
  assert.match(got.data, /Subject: =\?UTF-8\?B\?/);
  await assert.rejects(sendMail(smtpConfig({ ...env, SMTP_PASS: 'wrong' }), { subject: 's', text: 't' }), /пароль приложения/);
  srv.close();
});

test('почта через Resend: ключ важнее SMTP, письмо уходит по HTTPS, при ошибке — запасной SMTP', async () => {
  const env = { RESEND_API_KEY: 're_test', MAIL_TO: 'me@gmail.com' };
  const c = smtpConfig(env);
  assert.deepEqual([c.transport, c.to, c.from, c.smtp], ['resend', 'me@gmail.com', 'onboarding@resend.dev', null]);
  assert.equal(smtpConfig({ RESEND_API_KEY: 'k' }), null, 'без адреса получателя не настроено');
  assert.equal(smtpConfig({ ...env, SMTP_USER: 'a@gmail.com', SMTP_PASS: 'p', MAIL_TRANSPORT: 'smtp' }).transport, 'smtp');

  const calls = [];
  const ok = async (url, o) => { calls.push({ url, o: { ...o, body: JSON.parse(o.body) } }); return { ok: true, status: 200, json: async () => ({ id: '1' }) }; };
  await sendMail(c, { subject: 'Тема\r\nBcc: x@y.z', text: 'привет', attachments: [{ name: 'скрин.png', type: 'image/png', data: Buffer.from('x') }] }, { fetchImpl: ok });
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].o.headers.Authorization, 'Bearer re_test');
  assert.deepEqual(calls[0].o.body.to, ['me@gmail.com']);
  assert.ok(!/\n/.test(calls[0].o.body.subject), 'перенос строки в теме убран');
  assert.equal(calls[0].o.body.attachments[0].content, Buffer.from('x').toString('base64'));

  const denied = async () => ({ ok: false, status: 403, json: async () => ({ message: 'only to your own email' }) });
  await assert.rejects(sendMail(c, { subject: 's', text: 't' }, { fetchImpl: denied }), /RESEND_API_KEY/);
  // Запасной SMTP тоже не отвечает (порт закрыт) — в ошибке видны обе причины
  const both = smtpConfig({ ...env, SMTP_USER: 'a', SMTP_PASS: 'p', SMTP_HOST: '127.0.0.1', SMTP_PORT: '1', SMTP_INSECURE_LOCAL: '1' });
  await assert.rejects(sendMail(both, { subject: 's', text: 't' }, { fetchImpl: denied, timeoutMs: 2000 }), /Resend.*запасная отправка по SMTP/s);
});

test('браузер в отзыве хранится коротко: браузер, версия, система', async () => {
  const { shortUa } = await import('../src/feedback.js');
  assert.equal(shortUa('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'), 'Chrome 131 · Windows');
  assert.equal(shortUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'), 'Safari 17 · iOS');
  assert.equal(shortUa('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 YaBrowser/24.10.1 Mobile Safari/537.36'), 'YaBrowser 24 · Android');
  assert.equal(shortUa(''), '');
});
