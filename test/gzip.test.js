import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import express from 'express';
import { gzip } from '../src/lib/gzip.js';

async function withApp(fn) {
  const app = express();
  app.use(gzip());
  const big = { items: Array.from({ length: 500 }, (_, i) => ({ id: `ITEM_${i}`, name: `Предмет ${i}` })) };
  app.get('/big', (req, res) => res.json(big));
  app.get('/small', (req, res) => res.json({ ok: true }));
  app.get('/png', (req, res) => res.type('png').send(Buffer.alloc(4096)));
  app.get('/sse', (req, res) => { res.set('Content-Type', 'text/event-stream'); res.flushHeaders(); res.write('event: x\ndata: 1\n\n'); setTimeout(() => res.end(), 20); });
  const srv = app.listen(0);
  await new Promise(r => srv.once('listening', r));
  try { await fn(`http://127.0.0.1:${srv.address().port}`, big); } finally { srv.close(); }
}

const get = (url, gz = true) => fetch(url, { headers: gz ? { 'accept-encoding': 'gzip' } : { 'accept-encoding': 'identity' }, decompress: false });

test('крупный JSON сжимается и разжимается в то же самое', () => withApp(async (base, big) => {
  // fetch в Node сам распаковывает gzip — проверяем через сырые байты http
  const http = await import('node:http');
  const raw = await new Promise((resolve, reject) => http.get(`${base}/big`, { headers: { 'accept-encoding': 'gzip' } }, res => {
    const c = []; res.on('data', d => c.push(d)); res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(c) }));
  }).on('error', reject));
  assert.equal(raw.headers['content-encoding'], 'gzip');
  assert.equal(Number(raw.headers['content-length']), raw.body.length);
  assert.deepEqual(JSON.parse(gunzipSync(raw.body)), big);
}));

test('без Accept-Encoding, мелкие ответы и картинки не сжимаются', () => withApp(async base => {
  assert.equal((await get(`${base}/big`, false)).headers.get('content-encoding'), null);
  const refused = await fetch(`${base}/big`, { headers: { 'accept-encoding': 'gzip;q=0, identity;q=1' } });
  assert.equal(refused.headers.get('content-encoding'), null, 'gzip;q=0 — не сжимаем');
  assert.equal((await get(`${base}/small`)).headers.get('content-encoding'), null);
  assert.equal((await get(`${base}/png`)).headers.get('content-encoding'), null);
}));

test('поток событий (SSE) идёт как есть', () => withApp(async base => {
  const r = await get(`${base}/sse`);
  assert.equal(r.headers.get('content-encoding'), null);
  assert.match(await r.text(), /event: x/);
}));

test('браузеру с br отдаём brotli, и он разжимается в то же самое', () => withApp(async (base, big) => {
  const { brotliDecompressSync } = await import('node:zlib');
  const http = await import('node:http');
  const raw = await new Promise((resolve, reject) => http.get(`${base}/big`, { headers: { 'accept-encoding': 'gzip, deflate, br, zstd' } }, res => {
    const c = []; res.on('data', d => c.push(d)); res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(c) }));
  }).on('error', reject));
  assert.equal(raw.headers['content-encoding'], 'br');
  assert.deepEqual(JSON.parse(brotliDecompressSync(raw.body)), big);
}));
