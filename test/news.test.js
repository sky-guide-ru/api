// /api/news: ответ сервера (записи и проверки текста — в @sky-guide/core, test/news.test.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEWS, KIND_RU } from '@sky-guide/core/news/entries.js';
import { newsView } from '@sky-guide/core/news/index.js';
import { mountNewsRoutes } from '../src/mount/news.js';

test('/api/news отдаёт записи с подписью вида и словарь подсказок; /api/news/latest — id свежей', async () => {
  const routes = {};
  let calls = 0;
  mountNewsRoutes({ get: (p, h) => { routes[p] = h; } }, { textRefs: t => { calls++; assert.ok(t.includes(NEWS[0].title)); return { phrases: {}, data: {} }; } });
  const call = p => new Promise(res => routes[p]({}, { json: res }));
  const full = await call('/api/news');
  assert.equal(full.latest, NEWS[0].id);
  assert.equal(full.entries.length, NEWS.length);
  assert.equal(full.entries[0].kindRu, KIND_RU[NEWS[0].kind]);
  assert.deepEqual(full.refs, { phrases: {}, data: {} });
  await call('/api/news');
  assert.equal(calls, 1, 'словарь считается один раз, а не на каждый запрос');
  assert.equal((await call('/api/news/latest')).latest, NEWS[0].id);
  assert.equal(newsView([]).latest, null);
});

test('/api/news/latest: id всех записей по порядку и свежая запись для окошка', async () => {
  const routes = {};
  mountNewsRoutes({ get: (p, h) => { routes[p] = h; } }, { textRefs: () => ({ phrases: {}, data: {} }) });
  const r = await new Promise(res => routes['/api/news/latest']({}, { json: res }));
  assert.deepEqual(r.ids, NEWS.map(e => e.id));
  assert.equal(r.top.id, NEWS[0].id);
  assert.equal(r.top.kindRu, KIND_RU[NEWS[0].kind]);
  assert.ok(r.top.items.length);
  assert.ok(r.refs);
});
