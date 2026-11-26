// Замирания сервера: журнал на странице «Сервер» и нагрузочная проверка «лёгкий запрос отвечает быстро,
// пока несколько посетителей открывают тяжёлые разделы» (25.11.2026 сайт вставал на 25–30 с при 2–3 посетителях)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createStalls, routeOf } from '@sky-guide/core/lib/stalls.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const busy = ms => { const end = Date.now() + ms; while (Date.now() < end) { /* держим цикл событий */ } };

test('routeOf: без ников и параметров', () => {
  assert.equal(routeOf('/api/head/SomeNick'), '/api/head');
  assert.equal(routeOf('/api/state?x=1'), '/api/state');
  assert.equal(routeOf('/'), '/');
});

test('замирание записывается вместе с запросом, который держал сервер, и фоновой задачей', async () => {
  const st = createStalls({ tickMs: 20, stallMs: 150, slowMs: 100 });
  try {
    const fastDone = st.begin('/api/version');
    fastDone();
    let release;
    const bgRun = st.background('аукцион', () => new Promise(r => { release = r; }));
    const done = st.begin('/api/state', true);
    await sleep(50);
    busy(400); // синхронная работа обработчика: сервер никому не отвечает
    done();
    await sleep(60);
    release(); await bgRun;
    const s = st.summary();
    assert.equal(s.stalls.length, 1);
    assert.ok(s.stalls[0].ms >= 300, `длительность ${s.stalls[0].ms}`);
    assert.deepEqual(s.stalls[0].requests.map(r => r.route), ['en /api/state']);
    assert.deepEqual(s.stalls[0].background, ['аукцион']);
    assert.equal(s.slow[0].route, '/api/state');
    assert.equal(s.lastHour.stalls, 1);
    assert.equal(s.lastHour.requests, 2);
  } finally { st.stop(); }
});

test('без тяжёлой работы замираний нет', async () => {
  const st = createStalls({ tickMs: 20, stallMs: 150 });
  try {
    for (let i = 0; i < 10; i++) { st.begin('/api/version')(); await sleep(10); }
    assert.equal(st.summary().stalls.length, 0);
  } finally { st.stop(); }
});

test('нагрузка: пока три посетителя открывают разделы, /api/version отвечает быстро', { timeout: 90_000 }, async () => {
  const port = 41000 + Math.floor(Math.random() * 900);
  const child = spawn(process.execPath, ['src/index.js'], { cwd: root, env: { ...process.env, PORT: String(port), HYPIXEL_API_KEY: '', PRICE_BACKFILL: '0', WIKI_WATCH: '0', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sb-load-')) }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    let out = '';
    const ok = await new Promise(resolve => {
      const t = setTimeout(() => resolve(false), 45_000);
      const on = d => { out += d; if (out.includes(`localhost:${port}`)) { clearTimeout(t); resolve(true); } };
      child.stdout.on('data', on); child.stderr.on('data', on);
      child.on('exit', () => { clearTimeout(t); resolve(false); });
    });
    assert.ok(ok, 'сервер не запустился:\n' + out.slice(-2000));
    await sleep(4000); // после запуска сервер собирает словари (английский — через 3 с): меряем уже рабочий
    const base = `http://localhost:${port}`;
    const PAGES = ['/api/state', '/api/refs/lexicon', '/api/bazaar', '/api/market/ah', '/api/search?q=hyperion', '/api/news', '/api/guides', '/api/status', '/api/admin/status'];
    const visitor = async lang => {
      for (let round = 0; round < 3; round++) {
        await Promise.all(PAGES.map(p => fetch(base + p, { headers: lang ? { 'X-Lang': lang } : {} }).then(r => r.arrayBuffer()).catch(() => null)));
      }
    };
    const times = [];
    let stop = false;
    const probe = (async () => {
      while (!stop) {
        const t = Date.now();
        await fetch(base + '/api/version').then(r => r.json());
        times.push(Date.now() - t);
        await sleep(50);
      }
    })();
    await Promise.all([visitor(), visitor(), visitor('en')]);
    stop = true; await probe;
    const worst = Math.max(...times);
    const adm = await fetch(base + '/api/admin/status').then(r => r.json());
    assert.ok(adm.stalls && adm.stalls.lastHour.requests > 0, 'журнал замираний в панели «Сервер»');
    assert.ok(worst < 1500, `/api/version ждал ${worst} мс (замирания: ${JSON.stringify(adm.stalls.stalls.slice(0, 3))})`);
  } finally { child.kill(); }
});
