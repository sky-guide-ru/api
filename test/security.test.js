// Аудит безопасности (23.11.2026): подделка адреса, лимиты, личные данные владельца для гостей
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAuth, trustedPeer } from '../src/auth.js';
import { createRateLimiter, createConnLimiter, securityHeaders } from '../src/lib/guard.js';
import { mountPriceRoutes } from '../src/routes/prices.js';

const fakeReq = (remoteAddress, headers = {}) => ({ socket: { remoteAddress }, headers });

test('адрес из заголовков прокси берём только от своего прокси', () => {
  const { clientIp } = createAuth({ PLAYER: 'OwnerCat',  PUBLIC_VIEW: '1' });
  // туннель на этом ПК и Caddy в сети Docker — им верим
  assert.equal(clientIp(fakeReq('127.0.0.1', { 'cf-connecting-ip': '203.0.113.5' })), '203.0.113.5');
  assert.equal(clientIp(fakeReq('::ffff:172.18.0.3', { 'x-forwarded-for': '198.51.100.7, 10.0.0.1' })), '198.51.100.7');
  // напрямую из интернета: подделанный заголовок не меняет адрес
  assert.equal(clientIp(fakeReq('198.51.100.9', { 'x-forwarded-for': '1.2.3.4', 'cf-connecting-ip': '5.6.7.8' })), '198.51.100.9');
  assert.equal(trustedPeer('172.32.0.1'), false);
  assert.equal(trustedPeer('192.168.1.5'), true);
  assert.equal(trustedPeer('127.0.0.1', { TRUST_PROXY: '0' }), false);
});

test('лимит запросов и живых соединений с одного адреса', () => {
  let now = 0;
  const lim = createRateLimiter({ max: 3, windowMs: 1000, clock: () => now });
  assert.deepEqual([lim.hit('a'), lim.hit('a'), lim.hit('a')], [0, 0, 0]);
  assert.ok(lim.hit('a') > 0);
  assert.equal(lim.hit('b'), 0, 'другой адрес не страдает');
  now = 1001;
  assert.equal(lim.hit('a'), 0, 'окно прошло');
  const c = createConnLimiter(2);
  assert.ok(c.take('x') && c.take('x'));
  assert.equal(c.take('x'), false);
  c.release('x');
  assert.ok(c.take('x'));
});

async function serve(setup, fn) {
  const app = express();
  setup(app);
  const srv = app.listen(0);
  await new Promise(r => srv.once('listening', r));
  try { await fn(`http://127.0.0.1:${srv.address().port}`); } finally { srv.close(); }
}

test('гость не видит личные сессии заработка владельца', () => serve(app => {
  app.use((req, res, next) => { req.sbGuest = req.headers['x-guest'] === '1'; req.sbUser = req.sbGuest ? null : { name: 'Owner', owner: true }; next(); });
  mountPriceRoutes(app);
}, async base => {
  const guest = await (await fetch(`${base}/api/market/sessions`, { headers: { 'x-guest': '1' } })).json();
  assert.deepEqual(guest, []);
  const r = await fetch(`${base}/api/market/sessions`, { method: 'POST', headers: { 'x-guest': '1', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);
  assert.ok(Array.isArray(await (await fetch(`${base}/api/market/sessions`)).json()));
}));

test('заголовки безопасности: сайт нельзя встроить в чужую страницу', () => serve(app => {
  app.use(securityHeaders());
  app.get('/', (req, res) => res.send('ok'));
}, async base => {
  const r = await fetch(base);
  assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'self'/);
}));
