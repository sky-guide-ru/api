// Новости сайта и патчноуты — в Discord: без повторов, первый запуск без потока старых сообщений
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDiscordNews, siteNewsMessage, validWebhook, discordText } from '../src/discord-news.js';

const HOOK = 'https://discord.com/api/webhooks/123456/abc_DEF-ghi';
const N = id => ({ id, date: '2026-11-27', kind: 'new', title: `Заголовок ${id}`, items: [`Пункт про [план](roadmap#hidden) ${id}`] });
const memStore = () => { let s = null; return { load: () => (s ? JSON.parse(JSON.stringify(s)) : null), save: v => { s = JSON.parse(JSON.stringify(v)); }, peek: () => s }; };
const fakeFetch = (status = 204) => { const calls = []; const f = async (url, o) => { calls.push({ url, body: JSON.parse(o.body) }); return { ok: status < 300, status, json: async () => ({ retry_after: 5 }) }; }; f.calls = calls; return f; };
const quiet = { log() {}, warn() {} };

test('без webhook или с чужим адресом — ничего не отправляет', async () => {
  const f = fakeFetch();
  assert.equal(await createDiscordNews({ fetchFn: f, log: quiet }).tick(), 0);
  assert.equal(createDiscordNews({ webhook: 'https://evil.example/api/webhooks/1/x' }).enabled, false);
  assert.equal(f.calls.length, 0);
  assert.ok(validWebhook(HOOK));
  assert.ok(!validWebhook(HOOK + '/../x'));
});

test('первый запуск: только свежая новость, старые и вышедшие патчноуты запоминаются; повторов нет', async () => {
  const f = fakeFetch(), store = memStore();
  let news = [N('b'), N('a')], sb = null;
  const make = () => createDiscordNews({ webhook: HOOK, store, news, patches: () => sb, fetchFn: f, log: quiet });
  assert.equal(await make().tick(), 1);
  assert.equal(f.calls[0].body.embeds[0].title, 'Заголовок b');
  assert.ok(f.calls[0].url.startsWith(HOOK));
  // Патчноуты пришли позже — первые просто запоминаются
  sb = [{ title: 'Patch 1', link: 'https://hypixel.net/threads/1/' }];
  assert.equal(await make().tick(), 0);
  // «Перезапуск» с тем же файлом — ничего заново
  assert.equal(await make().tick(), 0);
  // Новая новость и новый патчноут — уходят, по одному сообщению
  news = [N('c'), ...news];
  sb = [{ title: 'Patch 2', link: 'https://hypixel.net/threads/2/' }, ...sb];
  assert.equal(await make().tick(), 2);
  assert.deepEqual(f.calls.slice(1).map(c => c.body.embeds[0].title), ['Заголовок c', 'Patch 2']);
  assert.equal(await make().tick(), 0);
  assert.deepEqual(store.peek().site.sort(), ['a', 'b', 'c']);
});

test('ошибка Discord: сообщение не помечается отправленным и уйдёт в следующий раз', async () => {
  const store = memStore();
  const bad = fakeFetch(500);
  assert.equal(await createDiscordNews({ webhook: HOOK, store, news: [N('a')], fetchFn: bad, log: quiet }).tick(), 0);
  const ok = fakeFetch();
  assert.equal(await createDiscordNews({ webhook: HOOK, store, news: [N('a')], fetchFn: ok, log: quiet }).tick(), 1);
});

test('карточка: ссылки ведут на разделы сайта, английская — только при переводе, без упоминаний', () => {
  assert.equal(discordText('[план](roadmap#hidden)', 'https://x.ru'), '[план](https://x.ru/#/roadmap)');
  const ru = siteNewsMessage(N('a'), { siteUrl: 'https://x.ru', translate: s => s });
  assert.equal(ru.embeds.length, 1);
  assert.match(ru.embeds[0].description, /\(https:\/\/x\.ru\/#\/roadmap\)/);
  assert.deepEqual(ru.allowed_mentions, { parse: [] });
  const en = siteNewsMessage(N('a'), { siteUrl: 'https://x.ru', translate: s => `EN ${s}` });
  assert.equal(en.embeds.length, 2);
  assert.match(en.embeds[1].description, /https:\/\/x\.ru\/en\/#\/roadmap/);
});
