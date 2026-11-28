import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPerf, perfRoute, latPercentile, pageWeight, LIMITS } from '../src/monitor/perf.js';
import { createDiscordAlerts, alertMessage, statusMessage } from '../src/monitor/discord.js';
import { createMonitor } from '../src/monitor/index.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-perf-'));
const T0 = Date.parse('2026-11-28T10:00:00Z');
const OK_SAMPLE = { cpu: 20, cpuProcess: 10, rssMb: 500, limitMb: 1536, freeMb: 2000, totalMb: 4000, disk: { totalGb: 40, usedGb: 10, freeGb: 30 }, lagMs: 10, keyed5m: 20, paused: null };

function make(o = {}) {
  let now = o.now ?? T0;
  const alerts = [];
  let s = { ...OK_SAMPLE, ...o.sample };
  let usage = { day: '2026-11-28', total: 100, kind: { profiles: 40 }, deduped: 5, limited: 0 };
  const p = createPerf({
    dataDir: o.dir || tmp(), clock: () => now, tz: 'Asia/Yekaterinburg', sample: () => s, keyUsage: () => usage, webDist: o.webDist || '',
    alert: async (key, title, text) => { alerts.push({ key, title, text }); return true; },
  });
  return { p, alerts, set: t => { now = t; }, get now() { return now; }, setSample: x => { s = { ...s, ...x }; }, setUsage: x => { usage = { ...usage, ...x }; } };
}

test('адрес для учёта: шаблон маршрута, без ников; 404 — одной строкой; английская версия помечена', () => {
  assert.equal(perfRoute({ route: { path: '/api/item/:id' }, baseUrl: '' }), '/api/item/:id');
  assert.equal(perfRoute({ originalUrl: '/api/head/SomeNick?x=1' }), '/api/head');
  assert.equal(perfRoute({ originalUrl: '/api/<script>/x' }), '/api/:x');
  assert.equal(perfRoute({ originalUrl: '/wp-admin/x.php' }, 404), '(не найдено)');
  assert.equal(perfRoute({ originalUrl: '/en/guides/dungeons', sbLang: 'en' }), 'en страницы');
  assert.equal(perfRoute({ route: { path: '/api/state' }, sbLang: 'en' }), 'en /api/state');
});

test('p95 по корзинам: 95 быстрых и 5 медленных', () => {
  const b = [95, 0, 0, 0, 0, 0, 0, 0, 5];
  assert.equal(latPercentile(b, 0.5), 50);
  assert.equal(latPercentile(b, 0.95), 50);
  assert.equal(latPercentile(b, 0.96), 10_000);
  assert.equal(latPercentile([0, 0, 0, 0, 0, 0, 0, 0, 0], 0.95), null);
});

test('итог за сутки: запросы по адресам, 5xx, кэш профилей и прирост расхода Hypixel', async () => {
  const t = make();
  for (let i = 0; i < 90; i++) t.p.record('/api/state', 80, 200);
  for (let i = 0; i < 10; i++) t.p.record('/api/state', 2500, 200);
  t.p.record('/api/guides/:id', 300, 500);
  t.p.profileView(true); t.p.profileView(true); t.p.profileView(true); t.p.profileView(false);
  await t.p.tick(); // первый снимок — точка отсчёта расхода
  t.setUsage({ total: 160, kind: { profiles: 70 }, deduped: 9 });
  t.set(T0 + 60_000); await t.p.tick();
  const d = t.p.period(24);
  assert.equal(d.requests, 101);
  assert.equal(d.e5, 1);
  const st = d.routes.find(r => r.route === '/api/state');
  assert.equal(st.n, 100);
  assert.equal(st.p50, 100);
  assert.equal(st.p95, 3000);
  assert.equal(d.cache.rate, 75);
  assert.equal(d.hypixel.calls, 60);
  assert.equal(d.hypixel.profiles, 30);
  assert.equal(d.hypixel.deduped, 4);
  assert.equal(d.hypixel.peak5m, 20);
  assert.equal(d.sys.cpuMax, 20);
  const lines = t.p.digestLines().join('\n');
  assert.match(lines, /Запросов к серверу: 101/);
  assert.match(lines, /Кэш профилей: 75%/);
  assert.match(lines, /Hypixel: 60 запросов/);
  assert.doesNotMatch(lines, /undefined|NaN/);
});

test('новый день по UTC: расход Hypixel считается с нуля, а не уходит в минус', async () => {
  const t = make();
  await t.p.tick();
  t.setUsage({ day: '2026-11-29', total: 7, kind: { profiles: 3 }, deduped: 0 });
  t.set(T0 + 60_000); await t.p.tick();
  assert.equal(t.p.period(24).hypixel.calls, 7);
});

test('медленно отвечает весь сайт → одна тревога со списком медленных адресов', async () => {
  const t = make();
  for (let i = 0; i < 400; i++) t.p.record(i % 2 ? '/api/state' : '/api/market/money', 4000, 200);
  await t.p.tick();
  const a = t.alerts.find(x => x.key === 'perf-slow');
  assert.ok(a, 'нет тревоги');
  assert.match(a.text, /\/api\/state/);
  // Через 16 минут окно пустое — тревоги нет
  t.alerts.length = 0;
  t.set(T0 + 16 * 60_000); await t.p.tick();
  assert.equal(t.alerts.filter(x => x.key.startsWith('perf-slow')).length, 0);
});

test('один медленный адрес при быстром остальном сайте — не будит', async () => {
  const t = make();
  for (let i = 0; i < 1500; i++) t.p.record('/api/state', 60, 200);
  for (let i = 0; i < 50; i++) t.p.record('/api/compare', 5000, 200);
  await t.p.tick();
  assert.equal(t.alerts.length, 0);
});

test('память, CPU и задержка — тревога только когда держится несколько минут подряд', async () => {
  const t = make({ sample: { rssMb: 1500, cpu: 97, lagMs: 1500 } });
  for (let i = 0; i < LIMITS.memMinutes - 1; i++) { t.set(T0 + i * 60_000); await t.p.tick(); }
  assert.ok(!t.alerts.some(x => x.key === 'perf-mem'));
  t.set(T0 + 10 * 60_000); await t.p.tick();
  assert.ok(t.alerts.some(x => x.key === 'perf-mem'));
  for (let i = 0; i < 15; i++) { t.set(T0 + (11 + i) * 60_000); await t.p.tick(); }
  assert.ok(t.alerts.some(x => x.key === 'perf-cpu'));
  assert.ok(t.alerts.some(x => x.key === 'perf-lag'));
  // Одна хорошая минута сбрасывает счёт
  const t2 = make({ sample: { cpu: 97 } });
  for (let i = 0; i < 40; i++) { t2.setSample({ cpu: i % 10 === 9 ? 30 : 97 }); t2.set(T0 + i * 60_000); await t2.p.tick(); }
  assert.ok(!t2.alerts.some(x => x.key === 'perf-cpu'));
});

test('диск, свободная память VPS и пауза 429 — тревоги сразу; 90% ключа Hypixel — не будит', async () => {
  const t = make({ sample: { disk: { totalGb: 40, usedGb: 38.5, freeGb: 1.5 }, freeMb: 100, keyed5m: 270, paused: { until: T0 + 300_000, at: T0, daily: false } } });
  await t.p.tick();
  const keys = t.alerts.map(a => a.key);
  for (const k of ['perf-disk', 'perf-freemem', `perf-429:${T0}`]) assert.ok(keys.includes(k), k);
  assert.ok(!keys.includes('perf-hypixel'));
});

test('вес сайта: первая загрузка из index.html, новая сборка видна в итоге, но не будит', async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'assets'));
  const rnd = n => Array.from({ length: n }, (_, i) => `const v${i}=${(i * 7919) % 104729};`).join('\n');
  fs.writeFileSync(path.join(dir, 'assets', 'index-AAAAAA11.js'), rnd(3000));
  fs.writeFileSync(path.join(dir, 'assets', 'index-BBBBBB22.css'), 'body{color:red}'.repeat(50));
  fs.writeFileSync(path.join(dir, 'index.html'), '<script type="module" src="/assets/index-AAAAAA11.js"></script><link rel="stylesheet" href="/assets/index-BBBBBB22.css">');
  const w = pageWeight(dir);
  assert.equal(w.files, 2);
  assert.ok(w.js.gz > 0 && w.js.gz < w.js.raw);
  assert.equal(w.biggest[0].name, 'index.js');
  const t = make({ webDist: dir });
  await t.p.tick();
  assert.equal(t.p.summary().weight.id, w.id);
  // Новая сборка втрое тяжелее
  fs.writeFileSync(path.join(dir, 'assets', 'index-CCCCCC33.js'), rnd(12000));
  fs.writeFileSync(path.join(dir, 'index.html'), '<script type="module" src="/assets/index-CCCCCC33.js"></script><link rel="stylesheet" href="/assets/index-BBBBBB22.css">');
  const later = new Date(Date.now() + 5000); fs.utimesSync(path.join(dir, 'index.html'), later, later);
  t.set(T0 + 11 * 60_000); await t.p.tick();
  assert.equal(t.alerts.length, 0);
  assert.notEqual(t.p.summary().weight.id, w.id);
  assert.equal(t.p.summary().weightPrev.id, w.id);
  assert.match(t.p.digestLines().join('\n'), /Вес первой загрузки/);
  assert.equal(pageWeight(path.join(dir, 'нет')), null);
});

test('сохраняется на диск и переживает перезапуск; ников и параметров в файле нет', async () => {
  const dir = tmp();
  const a = make({ dir });
  a.p.record(perfRoute({ originalUrl: '/api/head/SecretNick?key=abc' }, 404), 30, 404);
  a.p.record('/api/state', 70, 200);
  a.p.flush();
  const raw = fs.readFileSync(path.join(dir, 'metrics', 'perf.json'), 'utf8');
  assert.ok(!raw.includes('SecretNick') && !raw.includes('abc'));
  const b = make({ dir });
  assert.equal(b.p.period(24).requests, 2);
});

test('middleware: оборванный посетителем запрос не считается, служебные адреса пропускаются', () => {
  const t = make();
  const fake = (p, finished, status = 200) => {
    const handlers = {};
    const res = { statusCode: status, writableFinished: finished, on: (e, f) => { handlers[e] = f; } };
    let called = false;
    t.p.track({ path: p, originalUrl: p, route: { path: p } }, res, () => { called = true; });
    assert.ok(called);
    (finished ? handlers.finish : handlers.close)?.();
  };
  fake('/api/state', true);
  fake('/api/state', false); // закрыли вкладку
  fake('/api/stream', true);
  fake('/api/t', true);
  assert.equal(t.p.period(1).requests, 1);
});

test('Discord: карточка без упоминаний, обрезка; куда идут тревоги — webhook, канал бота или личка владельцу', async () => {
  const m = alertMessage({ title: 'x'.repeat(300), text: '@everyone ' + 'y'.repeat(5000) });
  assert.deepEqual(m.allowed_mentions, { parse: [] });
  assert.equal(m.embeds[0].title.length, 256);
  assert.ok(m.embeds[0].description.length <= 4000);
  assert.equal(createDiscordAlerts({ webhook: 'https://evil.example/hook' }).enabled, false);
  const sent = [];
  const fetchFn = async (url, o) => { sent.push({ url, method: o.method, auth: o.headers.Authorization, body: o.body ? JSON.parse(o.body) : null }); return { ok: true, status: 200, json: async () => ({ id: '111111111111111111' }) }; };
  const wh = createDiscordAlerts({ webhook: 'https://discord.com/api/webhooks/123/abc-DEF', siteUrl: 'https://site.ru/', fetchFn });
  assert.equal(wh.mode(), 'webhook');
  assert.equal(await wh.send({ title: 'T', text: 'текст' }), true);
  assert.equal(sent[0].body.embeds[0].url, 'https://site.ru/#/status');
  assert.equal(sent[0].auth, undefined);
  sent.length = 0;
  let owner = null;
  const bot = createDiscordAlerts({ botToken: 'tok', userId: () => owner, fetchFn });
  assert.equal(bot.enabled, false, 'без привязки владельца слать некуда');
  owner = '222222222222222222';
  assert.equal(bot.mode(), 'dm');
  await bot.send({ title: 'T', text: '' });
  await bot.send({ title: 'T2', text: '' });
  assert.equal(sent.filter(x => x.url.endsWith('/users/@me/channels')).length, 1, 'личный канал открывается один раз');
  assert.ok(sent.at(-1).url.endsWith('/channels/111111111111111111/messages'));
  assert.equal(sent.at(-1).auth, 'Bot tok');
  assert.equal(createDiscordAlerts({ botToken: 'tok', channelId: '333333333333333333', fetchFn }).mode(), 'channel');
  const busy = createDiscordAlerts({ webhook: 'https://discord.com/api/webhooks/1/a', fetchFn: async () => ({ ok: false, status: 429, json: async () => ({ retry_after: 2 }) }) });
  await assert.rejects(busy.send({ title: 'T', text: '' }), /подождать/);
});

test('Discord: живое сообщение о состоянии создаётся один раз, дальше правится; удалили — создаётся заново', async () => {
  const dir = tmp(), calls = [];
  let gone = false;
  const fetchFn = async (url, o) => {
    calls.push({ url, method: o.method, body: o.body ? JSON.parse(o.body) : null });
    if (o.method === 'PATCH' && gone) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ id: '444444444444444444' }) };
  };
  const mk = () => createDiscordAlerts({ botToken: 'tok', statusChannelId: '555555555555555555', statusFile: path.join(dir, 's.json'), fetchFn });
  const s = { load: 'low', why: 'всё спокойно', uptimeSec: 7200, perHour: 4500, p95: 200, e5: 0, hypixel: { used5m: 120, limit: 300, paused: false }, cpu: 30, at: T0 };
  const d = mk();
  assert.equal(d.statusEnabled, true);
  await d.updateStatus(s);
  assert.equal(calls.filter(c => c.method === 'POST').length, 1);
  const text = calls[0].body.embeds[0].description;
  assert.match(text, /4 500/);
  assert.match(text, /40% лимита/);
  assert.match(text, /<t:\d+:R>/);
  await mk().updateStatus(s); // после перезапуска — правит то же сообщение
  assert.ok(calls.some(c => c.method === 'PATCH' && c.url.endsWith('/messages/444444444444444444')));
  gone = true; calls.length = 0;
  await d.updateStatus(s);
  assert.ok(calls.some(c => c.method === 'POST' && c.url.endsWith('/channels/555555555555555555/messages')));
  assert.match(statusMessage({ ...s, hypixel: { ...s.hypixel, paused: true } }).embeds[0].description, /на паузе/);
  assert.equal(createDiscordAlerts({ statusChannelId: '555555555555555555' }).statusEnabled, false, 'без бота не включается');
});

test('monitor: тревога уходит и на почту, и в Discord; сводка и лимит ИИ — только на почту', async () => {
  const dir = tmp();
  let now = Date.parse('2026-11-28T05:00:00Z'); // 10:00 по Екатеринбургу
  const mails = [], discord = [];
  const notify = { enabled: true, send: async m => { discord.push(m); return true; } };
  const m = createMonitor({ dataDir: dir, clock: () => now, tz: 'Asia/Yekaterinburg', sendMail: async x => { mails.push(x); return true; }, mailInfo: () => ({ configured: true }), notify });
  await m.alert('perf-disk', 'Мало места', 'Свободно 2 ГБ');
  assert.equal(mails.length, 1);
  assert.equal(discord.length, 1);
  await m.alert('ai:2026-11-28', 'Лимит ИИ', '…');
  assert.equal(discord.length, 1);
  await m.check();
  assert.ok(mails.some(x => /Сводка/.test(x.subject)));
  assert.equal(discord.length, 1, 'сводка в Discord не идёт');
  assert.equal(m.summary().discord.configured, true);
});
