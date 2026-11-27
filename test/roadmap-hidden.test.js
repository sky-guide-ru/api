import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { config } from '@sky-guide/core/config.js';
import { pruneHidden, getHidden, setHidden, _resetHidden, GONE_MS } from '@sky-guide/core/roadmap/hidden.js';
import { mountHiddenRoutes } from '../src/mount/roadmap-hidden.js';
import { hasWeb, WEB_SRC } from './_web.js';
const pruneClient = hasWeb ? (await import(pathToFileURL(path.join(WEB_SRC, 'hiddenPrune.js')).href)).pruneHidden : null;

config.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-hidden-'));
_resetHidden();

test('уборка: шаг пропал из плана — отметка живёт сутки, потом удаляется; вернулся — отметка снова обычная', () => {
  const t0 = 1_000_000;
  let r = pruneHidden({ a: { at: 1 }, b: true }, ['a', 'c'], t0);
  assert.ok(r.changed);
  assert.deepEqual(r.hidden, { a: { at: 1 }, b: { at: 0, gone: t0 } });
  r = pruneHidden(r.hidden, ['a', 'b'], t0 + 10);
  assert.deepEqual(r.hidden.b, { at: 0 });
  r = pruneHidden({ b: { at: 0, gone: t0 } }, ['a'], t0 + GONE_MS + 1);
  assert.deepEqual(r.hidden, {});
  // план не загрузился — ничего не трогаем
  assert.equal(pruneHidden({ a: { at: 1 } }, [], t0).changed, false);
});

test('клиент убирает отметки так же, как сервер', () => {
  const h = { a: { at: 1 }, b: { at: 2, gone: 5 }, c: true };
  for (const [ids, now] of [[['a'], 10], [['a', 'b'], 10], [['x'], 5 + GONE_MS + 1]]) {
    if (pruneClient) assert.deepEqual(pruneClient(h, ids, now), pruneHidden(h, ids, now));
  }
});

test('скрыть, вернуть, у каждого профиля свои; неверный id отклоняется', () => {
  setHidden('u1:p1', 'mp-cheap', true, 5);
  setHidden('u1:p1', ['gear-x', 'skill-farming'], true, 6);
  setHidden('u1:p1', 'gear-x', null);
  assert.deepEqual(Object.keys(getHidden('u1:p1', ['mp-cheap', 'skill-farming'])).sort(), ['mp-cheap', 'skill-farming']);
  assert.deepEqual(getHidden('u1:p2', ['mp-cheap']), {});
  assert.throws(() => setHidden('u1:p1', 'bad id!', true));
  assert.throws(() => setHidden(null, 'a', true));
  _resetHidden(); // с диска читается то же самое
  assert.ok(getHidden('u1:p1', ['mp-cheap'])['mp-cheap']);
});

async function serve(view) {
  const app = express();
  mountHiddenRoutes(app, { getView: async () => view, isGuest: () => false });
  const srv = app.listen(0);
  await new Promise(r => srv.once('listening', r));
  return { url: `http://127.0.0.1:${srv.address().port}/api/roadmap/hidden`, close: () => srv.close() };
}

test('маршруты: свой план можно менять, чужой — нет и отметки не видны', async () => {
  const roadmap = [{ id: 'mp-cheap' }, { id: 'cookie' }];
  const mine = await serve({ self: true, member: { uuid: 'own', profileId: 'pr' }, analysis: { roadmap } });
  try {
    let r = await fetch(mine.url, { method: 'POST', body: JSON.stringify({ id: 'cookie', value: true }) });
    assert.equal(r.status, 200);
    const j = await (await fetch(mine.url)).json();
    assert.equal(j.canWrite, true);
    assert.ok(j.hidden.cookie);
  } finally { mine.close(); }
  const other = await serve({ self: false, member: { uuid: 'own', profileId: 'pr' }, analysis: { roadmap } });
  try {
    const r = await fetch(other.url, { method: 'POST', body: JSON.stringify({ id: 'mp-cheap', value: true }) });
    assert.equal(r.status, 403);
    const j = await (await fetch(other.url)).json();
    assert.deepEqual(j, { hidden: {}, canWrite: false });
  } finally { other.close(); }
  assert.ok(!getHidden('own:pr', ['mp-cheap', 'cookie'])['mp-cheap']);
});
