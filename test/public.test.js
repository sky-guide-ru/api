import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { publicConfig, renderIndexHtml, robotsTxt, sitemapXml, createGuestLimiter, safeUrl } from '../src/public.js';

test('без настроек в .env ничего чужого не подключается', () => {
  const c = publicConfig({});
  assert.deepEqual(c.rtb, { bottom: '', landing: '' });
  assert.equal(c.metrika, null);
  assert.equal(c.donateUrl, '');
  assert.equal(c.contactEmail, '');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pub-'));
  const f = path.join(dir, 'index.html');
  fs.writeFileSync(f, '<html><head><title>x</title></head><body></body></html>');
  const html = renderIndexHtml(f, {});
  assert.ok(html.includes('window.SB_PUBLIC='));
  assert.ok(!html.includes('mc.yandex.ru') && !html.includes('context.js'));
});

test('Метрика, РСЯ, донат и подтверждение Вебмастера подставляются, мусор отбрасывается', () => {
  const env = { YANDEX_METRIKA_ID: '98765432', YANDEX_RTB_BOTTOM: 'R-A-1234567-1', YANDEX_RTB_LANDING: 'bad"><script>', DONATE_URL: 'https://boosty.to/test', YANDEX_VERIFICATION: 'abc123def', SITE_URL: 'https://sky.example.ru/' };
  const c = publicConfig(env);
  assert.equal(c.metrika, 98765432);
  assert.deepEqual(c.rtb, { bottom: 'R-A-1234567-1', landing: 'R-A-1234567-1' }, 'неверный id блока заменён нижним');
  assert.equal(c.siteUrl, 'https://sky.example.ru');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pub-'));
  const f = path.join(dir, 'index.html');
  fs.writeFileSync(f, '<html><head></head><body></body></html>');
  const html = renderIndexHtml(f, env);
  assert.ok(html.includes('"metrika":98765432') && !html.includes('ym(98765432'), 'номер счётчика передан, сам счётчик не запущен');
  // скрипты Яндекса до согласия на cookie в страницу не попадают — их подгружает браузер после «Принять»
  assert.ok(!html.includes('yandex.ru/ads/system/context.js') && !html.includes('mc.yandex.ru'));
  assert.ok(html.includes('name="yandex-verification" content="abc123def"'));
  assert.ok(!html.includes('<script>"'), 'нет внедрения из .env');
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('http://x.ru'), '', 'только https');
  assert.equal(publicConfig({ YANDEX_METRIKA_ID: '12;alert(1)' }).metrika, null);
  assert.equal(publicConfig({ CONTACT_EMAIL: ' help@sky.example.ru ' }).contactEmail, 'help@sky.example.ru');
  assert.equal(publicConfig({ CONTACT_EMAIL: 'x"><script>@a.ru' }).contactEmail, '', 'мусор вместо почты отброшен');
});

test('robots.txt и sitemap.xml', () => {
  assert.match(robotsTxt({}), /Disallow: \/api\//);
  assert.match(robotsTxt({ SITE_URL: 'https://a.ru' }), /Sitemap: https:\/\/a\.ru\/sitemap\.xml/);
  assert.match(robotsTxt({}, 'https://b.ru'), /Sitemap: https:\/\/b\.ru\/sitemap\.xml/, 'адрес сайта по запросу, если SITE_URL пуст');
  for (const bot of ['GPTBot', 'OAI-SearchBot', 'PerplexityBot', 'ClaudeBot', 'Yandex', 'Bingbot']) assert.match(robotsTxt({}), new RegExp(`User-agent: ${bot}\n`));
  assert.match(robotsTxt({}), /Clean-param: player&profile/);
  assert.equal(robotsTxt({ PUBLIC_VIEW: '0' }), 'User-agent: *\nDisallow: /\n');
  assert.equal(sitemapXml({}), null);
  assert.match(sitemapXml({ SITE_URL: 'https://a.ru' }), /<loc>https:\/\/a\.ru\/<\/loc>/);
});

test('лимит гостя: разные ники с одного IP, повтор уже открытого — бесплатно, окно сбрасывается', () => {
  let now = 0;
  const l = createGuestLimiter({ max: 2, windowMs: 1000, clock: () => now });
  assert.ok(l.allow('1.1.1.1', 'a'));
  assert.ok(l.allow('1.1.1.1', 'b'));
  assert.ok(l.allow('1.1.1.1', 'a'));
  assert.ok(!l.allow('1.1.1.1', 'c'));
  assert.ok(l.allow('2.2.2.2', 'c'), 'другой IP — свой счёт');
  now = 1500;
  assert.ok(l.allow('1.1.1.1', 'c'));
});

test('файлы подтверждения Яндекса и Google', async () => {
  const { default: express } = await import('express');
  const { mountPublicRoutes } = await import('../src/public.js');
  const app = express(); mountPublicRoutes(app, { env: {} });
  app.use((req, res) => res.status(404).send('нет'));
  const srv = app.listen(0); const port = srv.address().port;
  try {
    const ok = await fetch(`http://127.0.0.1:${port}/yandex_19aa7ebe71b656bf.html`);
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /<body>Verification: 19aa7ebe71b656bf<\/body>/);
    assert.equal((await fetch(`http://127.0.0.1:${port}/yandex_0000000000000000.html`)).status, 404);
    const g = await fetch(`http://127.0.0.1:${port}/googlecf3a4e7c47d359f6.html`);
    assert.equal(await g.text(), 'google-site-verification: googlecf3a4e7c47d359f6.html\n', 'ровно 53 байта, как в файле Google');
    assert.equal((await fetch(`http://127.0.0.1:${port}/google0000000000000000.html`)).status, 404);
  } finally { srv.close(); }
});
