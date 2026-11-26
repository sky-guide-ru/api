// Ключи /v1: хранится только хеш, ключ показывается один раз, отзыв действует сразу; выдаёт и отзывает только владелец на /account
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createKeyStore, cleanLimit, DEFAULT_KEY_PER_MIN, MAX_KEY_PER_MIN } from '../src/v1/keys.js';
import { createAuth } from '../src/auth.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-keys-'));

test('ключ: в файле только хеш, проверка, отзыв', () => {
  const dir = tmp();
  const keys = createKeyStore({ dataDir: dir });
  assert.throws(() => keys.create({ name: '  ' }), /Назови ключ/);
  const k = keys.create({ name: 'Бот Discord', perMin: 30 });
  assert.match(k.key, /^sg_[A-Za-z0-9]{10}_[A-Za-z0-9_-]{32}$/);
  const disk = fs.readFileSync(path.join(dir, 'api-keys.json'), 'utf8');
  assert.ok(!disk.includes(k.key.split('_').slice(2).join('_')), 'секрет ключа не лежит на диске');
  assert.equal(JSON.parse(disk).keys[0].hash.length, 64);
  assert.deepEqual(keys.check(k.key), { ok: true, key: { id: k.id, name: 'Бот Discord', perMin: 30 } });
  assert.equal(keys.check(k.key.slice(0, -1) + (k.key.endsWith('A') ? 'B' : 'A')).code, 'BAD_KEY');
  assert.equal(keys.check('').code, 'BAD_KEY');
  assert.equal(keys.check(`sg_${k.id}_short`).code, 'BAD_KEY');
  assert.equal(keys.list()[0].uses, 1);
  assert.ok(!('hash' in keys.list()[0]), 'список без хешей');
  keys.revoke(k.id);
  assert.equal(keys.check(k.key).code, 'REVOKED');
  assert.throws(() => keys.revoke('nope'), /Нет такого ключа/);
});

test('ключ, выданный в другом процессе, виден без перезапуска', async () => {
  const dir = tmp();
  const a = createKeyStore({ dataDir: dir }), b = createKeyStore({ dataDir: dir });
  b.list();
  await new Promise(r => setTimeout(r, 15)); // другое время изменения файла
  const k = a.create({ name: 'Мод' });
  assert.equal(b.check(k.key).ok, true);
});

test('лимит ключа: от 1 до максимума, иначе по умолчанию', () => {
  assert.equal(cleanLimit(''), DEFAULT_KEY_PER_MIN);
  assert.equal(cleanLimit('abc'), DEFAULT_KEY_PER_MIN);
  assert.equal(cleanLimit(0), DEFAULT_KEY_PER_MIN);
  assert.equal(cleanLimit('60'), 60);
  assert.equal(cleanLimit(1e9), MAX_KEY_PER_MIN);
});

// ---------- Страница «Аккаунт» ----------
const viaTunnel = { 'cf-connecting-ip': '203.0.113.5', 'x-forwarded-for': '203.0.113.5' };
const formPost = (base, url, body, headers = {}) => fetch(`${base}${url}`, {
  method: 'POST', redirect: 'manual', headers: { ...viaTunnel, 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(body),
});
const cookieOf = r => (r.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).filter(c => c.startsWith('sb_auth=')).join('; ');

test('владелец выдаёт ключ на /account (виден один раз) и отзывает; без входа и с чужого сайта — нет', async () => {
  const dir = tmp();
  const apiKeys = createKeyStore({ dataDir: dir });
  const app = express();
  const auth = createAuth({ PLAYER: 'OwnerCat', PUBLIC_VIEW: '0', SITE_PASSWORD: 'owner-pass' }, { dataDir: dir, apiKeys });
  app.use(auth.router);
  const srv = app.listen(0);
  await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const login = await formPost(base, '/login', { name: 'OwnerCat', password: 'owner-pass' }, { 'x-forwarded-proto': 'https' });
    const cookie = cookieOf(login);
    assert.ok(cookie);
    const page = await fetch(`${base}/account`, { headers: { ...viaTunnel, cookie } }).then(r => r.text());
    assert.match(page, /Ключи API/);

    const made = await formPost(base, '/account/api-keys', { name: 'Бот Discord', perMin: '90' }, { cookie });
    assert.equal(made.status, 303);
    const shown = await fetch(base + made.headers.get('location'), { headers: { ...viaTunnel, cookie } }).then(r => r.text());
    const key = /sg_[A-Za-z0-9]{10}_[A-Za-z0-9_-]{32}/.exec(shown)?.[0];
    assert.ok(key, 'ключ показан после выдачи');
    assert.equal(apiKeys.check(key).key.perMin, 90);
    const again = await fetch(base + made.headers.get('location'), { headers: { ...viaTunnel, cookie } }).then(r => r.text());
    assert.ok(!again.includes(key), 'второй раз ключ не показывается');
    assert.match(again, /Бот Discord/);

    // запрос с чужого сайта и без входа — не проходит
    assert.equal((await formPost(base, '/account/api-keys', { name: 'x' }, { cookie, 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.notEqual((await formPost(base, '/account/api-keys', { name: 'x' })).status, 303);
    assert.equal(apiKeys.list().length, 1);

    const id = apiKeys.list()[0].id;
    await formPost(base, '/account/api-keys/revoke', { id }, { cookie });
    assert.equal(apiKeys.check(key).code, 'REVOKED');
  } finally { srv.close(); }
});
