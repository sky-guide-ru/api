import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApiStats, installFetchTracking, sourceOf, clean, keySince } from '@sky-guide/core/lib/api-stats.js';
import { createStatus } from '../src/status.js';

test('источники по адресу', () => {
  assert.equal(sourceOf('https://api.hypixel.net/v2/skyblock/profiles?uuid=x').id, 'hypixel-key');
  assert.equal(sourceOf('https://api.hypixel.net/v2/skyblock/auctions?page=3').id, 'hypixel-ah');
  assert.equal(sourceOf('https://api.hypixel.net/v2/skyblock/bazaar').id, 'hypixel-bazaar');
  assert.equal(sourceOf('https://github.com/NotEnoughUpdates/NotEnoughUpdates-REPO/archive/refs/heads/master.zip').id, 'neu');
  assert.equal(sourceOf('https://api.anthropic.com/v1/messages').id, 'claude');
  assert.equal(sourceOf('https://hypixel-skyblock.fandom.com/api.php').id, 'wiki');
  assert.equal(sourceOf('http://localhost:3000/api/x'), null);
});

test('ключи и токены не попадают в текст ошибки', () => {
  assert.doesNotMatch(clean('HTTP 403 для https://x/?key=abcd-1234'), /abcd/);
  assert.doesNotMatch(clean('ключ 0a1b2c3d-1111-2222-3333-444455556666 неверный'), /0a1b2c3d/);
  assert.doesNotMatch(clean('sk-ant-api03-SECRET'), /SECRET/);
});

test('fetch с учётом: лимит Hypixel из заголовков, неверный ключ, обрыв связи; ключ не сохраняется', async () => {
  const stats = createApiStats();
  const target = {
    fetch: async (url, init) => {
      if (String(url).includes('fail')) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
      if (init?.headers?.['API-Key'] === 'bad') return new Response('{"success":false,"cause":"Invalid API key"}', { status: 403 });
      return new Response('{}', { status: 200, headers: { 'RateLimit-Limit': '300', 'RateLimit-Remaining': '287', 'RateLimit-Reset': '120' } });
    },
  };
  installFetchTracking(stats, target);
  installFetchTracking(stats, target); // повторно не оборачивает
  await target.fetch('https://api.hypixel.net/v2/skyblock/profiles?uuid=1', { headers: { 'API-Key': 'secret-key' } });
  let snap = stats.snapshot();
  assert.deepEqual([snap.hypixel.limit, snap.hypixel.remaining, snap.hypixel.resetSec], [300, 287, 120]);
  assert.ok(snap.hypixel.keyOkAt > 0);
  await target.fetch('https://api.hypixel.net/v2/skyblock/profiles?uuid=1', { headers: { 'API-Key': 'bad' } });
  await assert.rejects(target.fetch('https://sky.coflnet.com/fail'));
  snap = stats.snapshot();
  const key = snap.sources.find(s => s.id === 'hypixel-key');
  assert.equal(key.state, 'error');
  assert.match(key.lastError, /403: Invalid API key/);
  assert.match(snap.sources.find(s => s.id === 'coflnet').lastError, /ECONNRESET/);
  assert.doesNotMatch(JSON.stringify(snap), /secret-key/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-api-'));
  const st = createStatus({ dataDir: dir, apis: () => snap, apiKey: 'secret-key', keySince: () => keySince(dir, 'secret-key') });
  try {
    const a = st.adminStatus().api;
    assert.equal(a.key.state, 'invalid');
    assert.equal(a.key.type, 'dev');
    assert.equal(a.rate.remaining, 287);
    assert.doesNotMatch(JSON.stringify(st.adminStatus()), /secret-key/);
    assert.equal(a.key.since, null, 'неверный ключ — без даты');
    keySince(dir, 'secret-key');
    assert.doesNotMatch(fs.readFileSync(path.join(dir, 'api-key-seen.json'), 'utf8'), /secret-key/);
  } finally { st.stop(); }
});

test('дата первого успеха ключа: тот же ключ — та же дата, новый ключ — новая', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-key-'));
  assert.equal(keySince(dir, 'k1', 100), 100);
  assert.equal(keySince(dir, 'k1', 200), 100);
  assert.equal(keySince(dir, 'k2', 300), 300);
  assert.equal(keySince(dir, '', 400), null);
});
