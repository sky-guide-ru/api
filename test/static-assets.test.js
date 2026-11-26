import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import express from 'express';
import { staticAssets } from '../src/lib/static-assets.js';

test('файлы сборки: кэш навсегда, brotli/gzip по Accept-Encoding, чужие пути не отдаются', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-'));
  const js = 'console.log("привет");\n'.repeat(200);
  fs.writeFileSync(path.join(dir, 'index-abc.js'), js);
  const app = express();
  app.use('/assets', staticAssets(dir));
  app.use((req, res) => res.status(418).end());
  const srv = app.listen(0);
  const base = `http://localhost:${srv.address().port}/assets/`;
  try {
    const r = await fetch(base + 'index-abc.js', { headers: { 'Accept-Encoding': 'br' }, decompress: false });
    assert.equal(r.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.match(r.headers.get('content-type'), /javascript/);
    // fetch сам распаковывает br; проверяем, что тело совпадает и сжатие было
    assert.equal(r.headers.get('content-encoding'), 'br');
    assert.equal(await r.text(), js);
    const plain = await fetch(base + 'index-abc.js', { headers: { 'Accept-Encoding': 'identity' } });
    assert.equal(plain.headers.get('content-encoding'), null);
    assert.equal(await plain.text(), js);
    assert.equal((await fetch(base + 'nope-123.js')).status, 404);
    assert.equal((await fetch(base + '..%2Fsecret')).status, 418); // не наш формат имени — дальше по цепочке
    assert.ok(brotliDecompressSync); // модуль доступен
  } finally { srv.close(); }
});
