import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMonitor, beaconHandler, scrub, percentile, routeOf, browserLang, utmKey } from '../src/monitor/index.js';
import { createGeo, isoOf } from '../src/monitor/geo.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0) Chrome/130';
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Mobile Safari';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-mon-'));
// 23.11.2026 12:00 по Екатеринбургу (UTC+5)
const T0 = Date.parse('2026-11-23T07:00:00Z');

function make(o = {}) {
  let now = o.now ?? T0;
  const mails = [];
  const m = createMonitor({
    dataDir: o.dir || tmp(), clock: () => now, tz: 'Asia/Tashkent',
    sendMail: async msg => { mails.push(msg); return true; }, mailInfo: () => ({ configured: o.mail !== false }),
    excludedNick: (n, uuid) => ['ownername', 'friendnick'].includes(n) || uuid === 'coopmateuuid', ...o.extra,
  });
  return { m, mails, set: t => { now = t; }, get now() { return now; } };
}

test('уникальные посетители: один человек за день считается один раз, телефон отдельно', () => {
  const { m } = make();
  const who = { ip: '1.2.3.4', ua: UA, guest: true, host: 'site.ru' };
  m.view({ section: 'money', ref: 'https://yandex.ru/search?q=x', ms: 800 }, who);
  m.view({ section: 'guides' }, who);
  m.view({ section: 'overview', ms: 3000 }, { ip: '5.6.7.8', ua: PHONE, guest: false, host: 'site.ru' });
  const s = m.summary().today;
  assert.equal(s.visitors, 2);
  assert.equal(s.views, 3);
  assert.deepEqual(s.devices, { mobile: 1, desktop: 1 });
  assert.deepEqual(s.who, { guest: 1, user: 1 });
  assert.deepEqual(Object.fromEntries(s.refs), { 'yandex.ru': 1, 'прямой заход': 1 });
  assert.equal(s.load.desktop.p50, 1000);
  assert.equal(s.load.mobile.p50, 4000);
});

test('владелец, боты и «Не отслеживать» не считаются; раздел из адреса проверяется', () => {
  const { m } = make();
  assert.equal(m.view({ section: 'money' }, { ip: '1', ua: UA, owner: true }), false);
  assert.equal(m.view({ section: 'money' }, { ip: '2', ua: 'Googlebot/2.1' }), false);
  assert.equal(m.view({ section: 'money', dnt: true }, { ip: '3', ua: UA }), false);
  m.view({ section: '<script>' }, { ip: '4', ua: UA });
  const s = m.summary().today;
  assert.equal(s.visitors, 1);
  assert.deepEqual(s.sections, [['other', 1]]);
});

test('IP и отпечатки не попадают в файлы за день; новый день — новая соль', () => {
  const dir = tmp();
  const t = make({ dir });
  t.m.view({ section: 'money' }, { ip: '203.0.113.7', ua: UA });
  t.m.flush();
  const file = fs.readFileSync(path.join(dir, 'metrics', 'days', '2026-11-23.json'), 'utf8');
  assert.ok(!file.includes('203.0.113.7'));
  assert.ok(!/[0-9a-f]{16}/.test(file));
  t.set(T0 + 24 * 3600_000);
  t.m.view({ section: 'money' }, { ip: '203.0.113.7', ua: UA });
  assert.equal(t.m.summary().today.visitors, 1);
  assert.equal(t.m.summary().yesterday.visitors, 1);
  const seen = JSON.parse(fs.readFileSync(path.join(dir, 'metrics', 'today-seen.json'), 'utf8'));
  assert.equal(seen.day, '2026-11-23'); // файл перезапишется при следующем сохранении
});

test('перезапуск в тот же день не удваивает посетителей', () => {
  const dir = tmp();
  const a = make({ dir });
  a.m.view({ section: 'money' }, { ip: '9.9.9.9', ua: UA });
  a.m.flush();
  const b = make({ dir });
  b.m.view({ section: 'money' }, { ip: '9.9.9.9', ua: UA });
  assert.equal(b.m.summary().today.visitors, 1);
  assert.equal(b.m.summary().today.views, 2);
});

test('ники: владелец и друзья не пишутся, каждый ник считается один раз за день, сами ники не хранятся', () => {
  const dir = tmp();
  const { m } = make({ dir });
  const w = { ip: '1.1.1.1', ua: UA };
  assert.equal(m.nick('OwnerName', w), false);
  assert.equal(m.nick('friendnick', w), false);
  assert.equal(m.nick('Steve', w), true);
  assert.equal(m.nick('steve', w), false);
  assert.equal(m.nick('Steve', { ip: '2.2.2.2', ua: UA }), false); // тот же ник от другого посетителя — уже посчитан
  assert.equal(m.nick('Steve', { ip: '3.3.3.3', ua: UA, owner: true }), false);
  assert.equal(m.nick('bad nick!', w), false);
  assert.equal(m.nick('CoopMate', w, 'coopmateuuid'), false);
  assert.equal(m.nick('Alex', { ip: '2.2.2.2', ua: UA }), true);
  const n = m.summary().today.nicks;
  assert.equal(n.distinct, 2);
  assert.equal(n.top, undefined);
  // Сами ники нигде не сохраняются — только число и хеши с солью дня
  m.flush();
  const files = [path.join(dir, 'metrics/today-seen.json'), ...fs.readdirSync(path.join(dir, 'metrics/days')).map(f => path.join(dir, 'metrics/days', f))];
  for (const f of files) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /steve|alex/i, f);
  // После перезапуска тот же ник за день не считается второй раз
  const again = make({ dir }).m;
  assert.equal(again.nick('Steve', w), false);
  assert.equal(again.summary().today.nicks.distinct, 2);
});

test('старые файлы дней со списком ников превращаются в число', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'metrics/days'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'metrics/days/2026-11-20.json'), JSON.stringify({ day: '2026-11-20', views: 5, visitors: 2, nicks: { steve: 3, alex: 1 }, nicksOver: 4 }));
  const { m } = make({ dir });
  const raw = fs.readFileSync(path.join(dir, 'metrics/days/2026-11-20.json'), 'utf8');
  assert.doesNotMatch(raw, /steve|alex/);
  assert.equal(JSON.parse(raw).nicksN, 6);
  assert.equal(m.dayStats('2026-11-20').nicks, 6);
});

test('аудитория: браузер, система, входной раздел, часы, группы источников, сравнение', () => {
  const { m } = make();
  m.view({ section: 'money', ref: 'https://yandex.ru/search' }, { ip: '1.1.1.1', ua: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/130 YaBrowser/24 Safari', host: 'site.ru' });
  m.view({ section: 'guides', ref: 'https://discord.com/channels/1' }, { ip: '2.2.2.2', ua: PHONE, host: 'site.ru' });
  m.view({ section: 'overview', ref: 'https://hypixel.net/threads/x' }, { ip: '3.3.3.3', ua: 'Mozilla/5.0 (Macintosh; Mac OS X) Firefox/130', host: 'site.ru' });
  m.view({ section: 'wiki' }, { ip: '1.1.1.1', ua: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/130 YaBrowser/24 Safari', host: 'site.ru' });
  const s = m.summary();
  const t = s.today;
  assert.deepEqual(Object.fromEntries(t.browsers), { Yandex: 1, Safari: 1, Firefox: 1 });
  assert.deepEqual(Object.fromEntries(t.oses), { Windows: 1, iOS: 1, macOS: 1 });
  assert.deepEqual(Object.fromEntries(t.entries), { money: 1, guides: 1, overview: 1 });
  assert.deepEqual(t.refGroups, { search: 1, social: 1, sites: 1, direct: 0 });
  assert.equal(t.hours[12], 4); // 12:00 по Екатеринбургу
  assert.equal(s.days.length, 90);
  assert.ok(s.quarter && s.prev.week && s.prev.month);
});

test('scrub убирает ключи, токены, UUID, почту и адрес сайта', () => {
  const s = scrub('GET https://x.trycloudflare.com/api/p?key=abc123&x=1 sk-ant-api03-zzz 12345678-1234-1234-1234-123456789abc me@mail.ru');
  assert.ok(!/abc123|sk-ant|123456789abc|me@mail|trycloudflare/.test(s), s);
});

test('ошибки группируются по тексту и месту; числа в тексте не плодят группы', () => {
  const { m } = make();
  const who = { ip: '1', ua: UA };
  m.clientError({ msg: 'Cannot read x of undefined (item 12)', stack: 'TypeError\n at f (https://s.ru/assets/index-AbCdEf12.js:1:2345)', section: 'money' }, who);
  m.clientError({ msg: 'Cannot read x of undefined (item 99)', stack: 'TypeError\n at f (https://s.ru/assets/index-ZZZZZZ99.js:1:999)', section: 'gear' }, who);
  m.serverError(new Error('boom'), 'GET /api/x');
  const e = m.summary().errors;
  assert.equal(e.length, 2);
  const c = e.find(g => g.kind === 'client');
  assert.equal(c.count, 2);
  assert.equal(c.where, 'at f (/assets/index.js:1)');
  assert.deepEqual(c.sections.sort(), ['gear', 'money']);
  assert.equal(m.resolve(c.fp), true);
  assert.equal(m.summary().errors.length, 1);
});

test('тревога о всплеске ошибки уходит один раз за 3 часа', async () => {
  const t = make();
  for (let i = 0; i < 5; i++) t.m.serverError(new Error('db down'), 'GET /api/state');
  await t.m.check();
  await t.m.check();
  const spikes = t.mails.filter(x => /Новая ошибка/.test(x.subject));
  assert.equal(spikes.length, 1);
  assert.match(spikes[0].text, /db down/);
  assert.equal(t.m.summary().alerts[0].mailed, true);
});

test('падение сервера из журнала автообновления — сразу письмо; старые события — нет', async () => {
  const events = [{ kind: 'crash', at: T0 - 60_000, code: 1 }, { kind: 'crash', at: T0 - 3 * 3600_000, code: 1 }];
  const t = make({ extra: { deployLog: () => ({ events }) } });
  await t.m.check();
  assert.equal(t.mails.filter(x => /упал/.test(x.subject)).length, 1);
  await t.m.check();
  assert.equal(t.mails.filter(x => /упал/.test(x.subject)).length, 1);
});

test('ключ Hypixel не принят и кончился лимит ИИ — тревоги', async () => {
  const t = make({ extra: {
    apis: () => ({ hypixel: { keyErrorAt: T0 - 1000, keyOkAt: T0 - 9000, keyError: 'HTTP 403: Invalid API key' }, sources: [] }),
    ai: () => ({ dailyUsd: 0.2, leftUsd: 0, today: { usd: 0.2 }, monthUsd: 1 }),
  } });
  await t.m.check();
  const subj = t.mails.map(x => x.subject).join('|');
  assert.match(subj, /Ключ Hypixel/);
  assert.match(subj, /лимит ИИ/);
});

test('сводка уходит раз в сутки после 9 утра и считает вчерашний день', async () => {
  const t = make({ now: Date.parse('2026-11-23T02:00:00Z') }); // 7:00 по Екатеринбургу
  t.m.view({ section: 'money' }, { ip: '1', ua: UA });
  await t.m.check();
  assert.equal(t.mails.length, 0);
  t.set(Date.parse('2026-11-24T04:30:00Z')); // 9:30 следующего дня
  await t.m.check();
  await t.m.check();
  const d = t.mails.filter(x => /Сводка/.test(x.subject));
  assert.equal(d.length, 1);
  assert.match(d[0].subject, /23\.11/);
  assert.match(d[0].text, /Посетители: 1/);
});

test('без почты сводка не пытается отправляться каждую минуту', async () => {
  const t = make({ mail: false, now: Date.parse('2026-11-23T05:00:00Z') });
  await t.m.check();
  assert.equal(t.mails.length, 0);
});

test('приём событий из браузера: текст JSON, пачка, лимит и неизвестный мусор', () => {
  const { m } = make();
  const h = beaconHandler(m, { clientIp: () => '7.7.7.7', isOwner: () => false, build: () => 'abc' });
  const res = { status() { return this; }, end() {} };
  const req = body => ({ body, headers: { 'user-agent': UA, host: 'site.ru' } });
  h(req(JSON.stringify([{ t: 'view', p: 'money', ms: 500, g: 1 }, { t: 'err', m: 'oops', s: 'x\n at a (/assets/a.js:1:2)', p: 'money' }, { t: 'hack' }])), res);
  h(req('не json'), res);
  const s = m.summary();
  assert.equal(s.today.views, 1);
  assert.equal(s.errors[0].msg, 'oops');
  assert.equal(s.errors[0].build, 'abc');
  for (let i = 0; i < 70; i++) h(req(JSON.stringify({ t: 'view', p: 'p' + i })), res);
  assert.ok(m.summary().today.views < 62);
});

test('обработчик ошибок Express: 500 записан, ответ без подробностей', () => {
  const { m } = make();
  let code, body;
  const res = { headersSent: false, locals: {}, status(c) { code = c; return this; }, json(b) { body = b; } };
  m.errorHandler(new Error('secret path C:\\x key=123'), { method: 'GET', path: '/api/item/ABC', route: { path: '/api/item/:id' }, baseUrl: '' }, res, () => {});
  assert.equal(code, 500);
  assert.ok(!/secret/.test(body.error));
  assert.equal(m.summary().errors[0].where, 'GET /api/item/:id');
  assert.ok(!/123/.test(m.summary().errors[0].msg));
});

test('percentile и routeOf', () => {
  assert.equal(percentile([0, 0, 0, 0, 0, 0, 0, 0], 0.5), null);
  assert.equal(percentile([1, 1, 0, 0, 0, 0, 0, 2], 0.75), 10_000);
  assert.equal(routeOf({ path: '/api/player/Steve/extra' }), '/api/player/:x');
});

test('сбой сети в фоновой задаче — вид «внешний API», без тревоги о всплеске', async () => {
  const t = make();
  for (let i = 0; i < 8; i++) t.m.serverError(new TypeError('fetch failed'), 'фон: bazaar');
  await t.m.check();
  assert.equal(t.m.summary().errors[0].kind, 'api');
  assert.equal(t.m.summary().today.errors.api, 8);
  assert.equal(t.mails.filter(x => !/Сводка/.test(x.subject)).length, 0);
});

test('обрыв связи браузером и 4xx — не ошибка сервера', () => {
  const { m } = make();
  let code, ended = false;
  const res = { headersSent: false, locals: {}, status(c) { code = c; return this; }, json() {}, end() { ended = true; } };
  const req = { method: 'POST', path: '/api/icons', route: { path: '/api/icons' }, baseUrl: '' };
  m.errorHandler(Object.assign(new Error('request aborted'), { status: 400, type: 'request.aborted' }), req, res, () => {});
  assert.equal(code, 400); assert.ok(ended);
  m.errorHandler(Object.assign(new Error('Unexpected token'), { status: 400, type: 'entity.parse.failed' }), req, { ...res, locals: {} }, () => {});
  assert.equal(m.summary().errors.length, 0);
});

test('ожидаемый 503 (сайт запускается) не попадает в журнал, обычный 503 — попадает', () => {
  const { m } = make();
  const fire = locals => {
    let fin;
    const res = { statusCode: 503, locals, on(ev, fn) { fin = fn; } };
    m.track5xx({ method: 'GET', path: '/api/market/money', baseUrl: '' }, res, () => {});
    fin();
  };
  fire({ sbExpected: true });
  assert.equal(m.summary().errors.length, 0);
  fire({});
  assert.equal(m.summary().errors.length, 1);
});

test('страна, язык браузера и метки utm: только счётчики, один раз за день на посетителя', () => {
  const dir = tmp();
  const { m } = make({ dir });
  const h = beaconHandler(m, { clientIp: req => req.ip, isOwner: () => false, country: ip => ({ '1.1.1.1': 'RU', '2.2.2.2': 'KZ' })[ip] || '' });
  const res = { status() { return this; }, end() {} };
  const req = (ip, lang, body) => ({ ip, body: JSON.stringify(body), headers: { 'user-agent': UA, host: 'site.ru', 'accept-language': lang } });
  h(req('1.1.1.1', 'ru-RU,ru;q=0.9,en;q=0.8', { t: 'view', p: 'overview', l: 'ru', u: '?utm_source=Discord&utm_campaign=nov' }), res);
  h(req('1.1.1.1', 'ru-RU', { t: 'view', p: 'money', l: 'ru', u: '?utm_source=discord' }), res); // тот же посетитель — не второй раз
  h(req('2.2.2.2', 'en-US,en', { t: 'view', p: 'overview', l: 'en' }), res);
  h(req('3.3.3.3', '*', { t: 'view', p: 'overview', l: 'en', u: '?utm_source=youtube' }), res);
  const s = m.summary().today;
  assert.deepEqual(Object.fromEntries(s.countries), { RU: 1, KZ: 1, '?': 1 });
  assert.deepEqual(Object.fromEntries(s.blangs), { ru: 1, en: 1, '?': 1 });
  assert.deepEqual(Object.fromEntries(s.utm), { 'discord · nov': 1, youtube: 1 });
  assert.deepEqual(s.langs, { ru: 1, en: 2 });
  m.flush();
  const raw = fs.readFileSync(path.join(dir, 'metrics', 'days', '2026-11-23.json'), 'utf8');
  assert.ok(!raw.includes('1.1.1.1') && !raw.includes('2.2.2.2'), 'IP не попадает в файл');
  assert.match(m.digestText(), /Версия сайта/);
});

test('метки utm: чистка, потолок разных меток; язык браузера из заголовка', () => {
  assert.equal(utmKey('?utm_source=VK%20Group&utm_medium=x'), 'vk-group');
  assert.equal(utmKey('?utm_campaign=only'), '');
  assert.equal(utmKey('?utm_source=<script>'), 'script');
  assert.equal(browserLang('uk-UA,uk;q=0.9'), 'uk');
  assert.equal(browserLang(''), '?');
  const { m } = make();
  for (let i = 0; i < 120; i++) m.view({ section: 'overview', utm: `?utm_source=s${i}` }, { ip: `9.9.9.${i}`, ua: UA, host: 'site.ru' });
  const u = Object.fromEntries(m.summary().today.utm);
  assert.equal(u['другое'], 20);
});

test('база стран: без файла и без сети — страна пустая, сайт не падает', async () => {
  const g = createGeo({ dataDir: tmp(), fetchImpl: async () => ({ ok: false, status: 404 }), log: { warn() {} } });
  g.start();
  await g.refresh();
  assert.equal(g.country('1.2.3.4'), '');
  assert.equal(g.info().ready, false);
  assert.equal(g.info().lastError, 'HTTP 404');
  g.stop();
  assert.equal(isoOf({ country: { iso_code: 'RU' } }), 'RU');
  assert.equal(isoOf({ registered_country: { iso_code: 'DE' } }), 'DE');
  assert.equal(isoOf(null), '');
});
