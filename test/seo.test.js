import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSeo, jsonldScript, originOf, pingIndexNow, itemPath } from '../src/seo/index.js';
import { renderIndexHtml } from '../src/public.js';
import { buildGuides } from '@sky-guide/core/guides/index.js';
import { NEWS } from '@sky-guide/core/news/entries.js';
import { allItems, getItemRu, getLoreRu } from '@sky-guide/core/items-ru/index.js';

const seo = createSeo({
  guides: () => buildGuides({ guest: true, inv: {} }, {}, { priceOf: () => 0 }),
  news: NEWS,
  items: { all: allItems, get: id => getItemRu(id), lore: id => getLoreRu(id) },
  priceOf: id => (id === 'HYPERION' ? 1_000_000_000 : 0),
});
const O = 'https://sky.example.ru';
const BAD = ['OwnerCat', 'Friend4ik', 'Nightowl', 'ИИ-советчик', 'советчик'];

test('открытые разделы и гайды: свои заголовок, описание и готовый текст', () => {
  const home = seo.pageFor('/');
  assert.equal(home.path, '/');
  assert.ok(home.body.includes('href="/guides/fishing"'), 'с главной есть ссылки на гайды');
  for (const p of ['/guides', '/market', '/wiki', '/events', '/news', '/top']) {
    const x = seo.pageFor(p);
    assert.ok(x && x.title && x.description.length > 50, p);
    assert.equal(seo.pageFor(p + '/').path, p, 'слэш в конце не мешает');
  }
  const g = seo.pageFor('/guides/fishing');
  assert.equal(g.page, 'guides');
  assert.equal(g.sub, 'fishing');
  assert.ok(g.body.includes('<h1>Fishing</h1>') && g.body.includes('<ol>'), 'пошаговая инструкция в тексте');
  assert.ok(!/Твоя рыбалка в цифрах/.test(g.body), 'пустые личные разделы гостя убраны');
  assert.equal(seo.pageFor('/guides/nope'), null);
  assert.equal(seo.pageFor('/compare'), null, 'сравнение профилей не индексируем');
  assert.equal(seo.pageFor('/%E0%A4%A'), null, 'кривой адрес не роняет сервер');
});

test('страница предмета', () => {
  const it = seo.pageFor('/item/HYPERION');
  assert.equal(it.item, 'HYPERION');
  assert.match(it.title, /^Hyperion — /);
  assert.match(it.description, /цена сейчас: 1\s000\s000\s000 монет/);
  assert.ok(it.description.length <= 221);
  assert.ok(it.body.includes('Как получить'));
  assert.equal(seo.pageFor(itemPath('SHARPNESS;7')).item, 'SHARPNESS;7', 'id с ; через %3B');
  assert.equal(seo.pageFor('/item/NO_SUCH_ITEM_X'), null);
  assert.equal(seo.pageFor('/item/<script>'), null);
});

test('карта сайта, llms.txt и llms-full.txt без ников и советчика', () => {
  const sm = seo.sitemap(O);
  assert.ok(sm.startsWith('<?xml'));
  assert.ok(sm.includes(`<loc>${O}/guides/dungeons</loc>`) && sm.includes(`<loc>${O}/item/HYPERION</loc>`));
  assert.ok(!sm.includes('player='), 'профилей в карте нет');
  const n = (sm.match(/<url>/g) || []).length;
  assert.ok(n > 1000 && n < 50_000, `адресов: ${n}`);
  const llms = seo.llms(O), full = seo.llmsFull(O);
  assert.ok(llms.startsWith('# ') && llms.includes(`${O}/guides/fishing`));
  assert.ok(full.length > 50_000 && full.includes('## Fishing'));
  const all = [llms, full, seo.pageFor('/').body, seo.pageFor('/guides').body, seo.pageFor('/top').body, seo.pageFor('/news').body];
  for (const t of all) for (const bad of BAD) assert.ok(!t.includes(bad), `нашлось: ${bad}`);
});

test('страница с готовым текстом: заголовок, canonical, JSON-LD; профиль — noindex', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-seo-'));
  const f = path.join(dir, 'index.html');
  fs.writeFileSync(f, '<html><head><title>x</title><meta name="description" content="d" /><meta property="og:title" content="t" /><meta property="og:type" content="website" /></head><body><div id="root"></div></body></html>');
  const page = seo.pageFor('/guides/kuudra');
  const html = renderIndexHtml(f, {}, { seo: page, origin: O, jsonld: jsonldScript });
  assert.ok(html.includes('<title>Kuudra: гайд по Hypixel SkyBlock</title>'));
  assert.ok(html.includes(`<link rel="canonical" href="${O}/guides/kuudra" />`));
  assert.ok(html.includes('og:type" content="article"') && html.includes(`${O}/og.png`));
  assert.ok(html.includes('<div id="root"><div class="seo-pre"><article><h1>Kuudra</h1>'));
  const ld = JSON.parse(/<script type="application\/ld\+json">(.+?)<\/script>/.exec(html)[1]);
  assert.equal(ld['@graph'][0]['@type'], 'Article');
  assert.equal(ld['@graph'][0].url, `${O}/guides/kuudra`);
  const prof = renderIndexHtml(f, {}, { seo: null, noindex: true, origin: O });
  assert.ok(prof.includes('<meta name="robots" content="noindex, follow" />') && !prof.includes('canonical'));
  const v = renderIndexHtml(f, { GOOGLE_SITE_VERIFICATION: 'abcDEF_123-x', BING_SITE_VERIFICATION: '0123456789ABCDEF' }, {});
  assert.ok(v.includes('name="google-site-verification" content="abcDEF_123-x"') && v.includes('name="msvalidate.01" content="0123456789ABCDEF"'));
});

test('адрес сайта и IndexNow', async () => {
  assert.equal(originOf('https://a.ru/', 'evil.com'), 'https://a.ru');
  assert.equal(originOf('', 'sky-guide.ru'), 'https://sky-guide.ru');
  assert.equal(originOf('', 'localhost:3000'), 'http://localhost:3000');
  assert.equal(originOf('', 'bad host/"><'), '');
  let saved = '', calls = 0;
  const store = { get: () => saved, set: v => { saved = v; } };
  const fetchFn = async () => { calls++; return { ok: true, status: 200 }; };
  assert.equal(await pingIndexNow({ origin: O, urls: ['/', '/guides'], build: 'b1', store, fetchFn }), true);
  assert.equal(calls, 2);
  assert.equal(await pingIndexNow({ origin: O, urls: ['/', '/guides'], build: 'b1', store, fetchFn }), false, 'повторно ту же сборку не шлём');
  assert.equal(await pingIndexNow({ origin: '', urls: ['/'], build: 'b2', store, fetchFn }), false, 'без SITE_URL не шлём');
});

test('английская карточка предмета — не копия русской (иначе Google склеивает /en/item/… с /item/…)', () => {
  const it = allItems().find(x => x?.id && x.nameRu && x.nameRu !== x.nameEn && x.descriptionRu);
  assert.ok(it, 'в базе есть предмет с русским именем и описанием');
  const seo = createSeo({ guides: () => [], items: { all: allItems, get: getItemRu, lore: getLoreRu, loreEn: () => ['Original lore line'] } });
  const ru = seo.pageFor(itemPath(it.id));
  const en = seo.pageFor(itemPath(it.id), 'en');
  assert.ok(ru.body.includes(it.nameRu));
  assert.ok(!en.body.includes(it.nameRu), 'на /en/ нет русского имени');
  assert.ok(en.body.includes(it.nameEn) && en.body.includes('Original lore line'), 'на /en/ английское имя и лор из игры');
  assert.equal(en.jsonld[0].inLanguage, 'en');
});

test('новости на /en/ переводятся по исходной строке со ссылками', () => {
  const e = NEWS.find(x => x.items.some(i => /\]\(/.test(i)));
  assert.ok(e, 'есть новость со ссылкой');
  const seo = createSeo({ guides: () => [], news: [e] });
  const en = seo.pageFor('/news', 'en');
  const articles = (en.body.match(/<article>[\s\S]*?<\/article>/g) || []).join('');
  assert.ok(articles.length > 0);
  assert.doesNotMatch(articles, /[А-Яа-яЁё]{4,}/);
});
