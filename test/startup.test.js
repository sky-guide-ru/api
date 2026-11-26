// Сервер должен запускаться: ловит ошибки вроде забытого импорта в server/index.js,
// которые не видны юнит-тестам, а на ПК роняют сайт после автообновления
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('server/index.js запускается и слушает порт', { timeout: 60_000 }, async () => {
  const port = 39000 + Math.floor(Math.random() * 900);
  const child = spawn(process.execPath, ['src/index.js'], { cwd: root, env: { ...process.env, PORT: String(port), HYPIXEL_API_KEY: '', PRICE_BACKFILL: '0', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sb-start-')) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  const ok = await new Promise(resolve => {
    const t = setTimeout(() => resolve(false), 45_000);
    const on = d => { out += d; if (out.includes(`localhost:${port}`)) { clearTimeout(t); resolve(true); } };
    child.stdout.on('data', on); child.stderr.on('data', on);
    child.on('exit', () => { clearTimeout(t); resolve(false); });
  });
  if (ok) {
    const r = await fetch(`http://localhost:${port}/api/version`).then(r => r.status).catch(() => 0);
    assert.equal(r, 200);
    // Неизвестный адрес API — JSON с понятной ошибкой, а не HTML
    const nf = await fetch(`http://localhost:${port}/api/no-such-thing`).catch(() => null);
    assert.equal(nf?.status, 404);
    assert.match(nf.headers.get('content-type') || '', /json/);
    assert.match((await nf.json()).error, /Нет такого адреса/);
    // Лампочка нагрузки — всем; подробная панель — владельцу (с localhost вход не нужен)
    const st = await fetch(`http://localhost:${port}/api/status`).then(r => r.json());
    assert.equal(st.ok, true);
    assert.match(st.load, /^(low|medium|high)$/);
    const adm = await fetch(`http://localhost:${port}/api/admin/status`).then(r => r.json());
    assert.equal(adm.hypixel.limit5m, 300);
    assert.ok(adm.memory.rssMb > 0 && adm.uptimeSec >= 0);
    assert.deepEqual(adm.deploy.events, []);
  }
  child.kill();
  assert.ok(ok, 'сервер не запустился:\n' + out.slice(-2000));
});
