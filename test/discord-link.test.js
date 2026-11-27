// Привязка Discord: проверка ника через Hypixel, роль на сервере, отвязка, защита состояния входа
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mountDiscordLink, createLinkStore, discordLinkConfig, sameDiscord, signState, readState } from '../src/discord-link.js';

const ENV = {
  DISCORD_CLIENT_ID: '111111111111111111', DISCORD_CLIENT_SECRET: 'secret-secret-secret',
  DISCORD_BOT_TOKEN: 'bot.token.'.padEnd(40, 'x'), DISCORD_GUILD_ID: '222222222222222222', DISCORD_VERIFIED_ROLE_ID: '333333333333333333',
  DISCORD_SYNC_NICK: '1',
};
const USER = { id: '444444444444444444', username: 'steve_dc', discriminator: '0' };
const quiet = { log() {}, warn() {} };

function fakeDiscord({ member = true, user = USER } = {}) {
  const calls = [];
  const f = async (url, o = {}) => {
    const u = new URL(url), p = u.pathname.replace('/api/v10', '');
    calls.push({ method: o.method || 'GET', path: p, body: o.body, auth: o.headers?.Authorization });
    const res = (status, data) => ({ ok: status < 300, status, json: async () => data });
    if (p === '/oauth2/token') return res(200, { access_token: 'acc' });
    if (p === '/oauth2/token/revoke') return res(200, {});
    if (p === '/users/@me') return res(200, user);
    if (p.includes('/roles/')) return member ? res(204) : res(404, { code: 10007 });
    if (p.startsWith('/guilds/')) return res(200, {});
    return res(404, {});
  };
  f.calls = calls;
  return f;
}

async function server({ env = ENV, discordUser, member, social = 'steve_dc', store = createLinkStore(null) } = {}) {
  const app = express();
  const fetchFn = fakeDiscord({ member, user: discordUser });
  const players = { Steve: { uuid: 'aaaa', name: 'Steve' } };
  const m = mountDiscordLink(app, {
    env, store, siteUrl: 'https://sky.test', fetchFn, log: quiet,
    resolveUuid: async n => { const p = players[n]; if (!p) throw new Error('404'); return p; },
    getPlayer: async () => ({ player: { socialMedia: { links: social ? { DISCORD: social } : {} } } }),
  });
  const s = app.listen(0);
  await new Promise(r => s.once('listening', r));
  const base = `http://127.0.0.1:${s.address().port}`;
  const get = (p, cookie = '') => fetch(base + p, { redirect: 'manual', headers: cookie ? { cookie } : {} });
  // Полный путь: /discord/start → (Discord) → /discord/callback → страница результата
  async function flow(query) {
    const r1 = await get(`/discord/start?${query}`);
    assert.equal(r1.status, 303);
    const to = new URL(r1.headers.get('location'));
    assert.equal(to.host, 'discord.com');
    assert.equal(to.searchParams.get('scope'), 'identify');
    assert.equal(to.searchParams.get('redirect_uri'), 'https://sky.test/discord/callback');
    const cookie = r1.headers.get('set-cookie').split(';')[0];
    const r2 = await get(`/discord/callback?code=abc&state=${encodeURIComponent(to.searchParams.get('state'))}`, cookie);
    assert.equal(r2.status, 303);
    const page = await get(r2.headers.get('location'));
    return { loc: r2.headers.get('location'), html: await page.text() };
  }
  return { m, store, fetchFn, get, flow, close: () => s.close() };
}

test('настройки: без всех переменных выключено', () => {
  assert.equal(discordLinkConfig({}).enabled, false);
  assert.equal(discordLinkConfig({ ...ENV, DISCORD_GUILD_ID: 'abc' }).enabled, false);
  assert.equal(discordLinkConfig(ENV).enabled, true);
  assert.equal(discordLinkConfig({ ...ENV, DISCORD_SYNC_NICK: '' }).syncNick, false);
});

test('сверка имени Discord: новое имя, старое Имя#1234, регистр', () => {
  assert.ok(sameDiscord('Steve_DC', { username: 'steve_dc', discriminator: '0' }));
  assert.ok(sameDiscord('@steve_dc ', { username: 'steve_dc' }));
  assert.ok(sameDiscord('Steve#1234', { username: 'Steve', discriminator: '1234' }));
  assert.ok(!sameDiscord('other', { username: 'steve_dc' }));
  assert.ok(!sameDiscord('', { username: 'steve_dc' }));
});

test('состояние входа подписано и устаревает', () => {
  const s = signState({ a: 'link', x: 2000 }, 'k');
  assert.equal(readState(s, 'k', 1000).a, 'link');
  assert.equal(readState(s, 'k', 3000), null);
  assert.equal(readState(s, 'другой', 1000), null);
  assert.equal(readState(s.replace(/^./, 'A') , 'k', 1000), null);
});

test('без настроек /discord зовёт на сервер, а /discord/start никуда не ведёт', async () => {
  const t = await server({ env: {} });
  try {
    const html = await (await t.get('/discord')).text();
    assert.match(html, /discord\.gg\//);
    assert.doesNotMatch(html, /Войти через Discord/);
    assert.equal((await t.get('/discord/start?nick=Steve')).headers.get('location'), '/discord');
  } finally { t.close(); }
});

test('совпало: роль, ник как в игре, привязка сохранена', async () => {
  const t = await server();
  try {
    assert.match(await (await t.get('/discord')).text(), /Войти через Discord/);
    const { html } = await t.flow('nick=Steve&l=ru');
    assert.match(html, /Готово/);
    assert.deepEqual(t.store.linkOf(USER.id), { name: 'Steve', uuid: 'aaaa' });
    const role = t.fetchFn.calls.find(c => c.method === 'PUT');
    assert.equal(role.path, `/guilds/${ENV.DISCORD_GUILD_ID}/members/${USER.id}/roles/${ENV.DISCORD_VERIFIED_ROLE_ID}`);
    assert.ok(role.auth.startsWith('Bot '));
    const nick = t.fetchFn.calls.find(c => c.method === 'PATCH');
    assert.deepEqual(JSON.parse(nick.body), { nick: 'Steve' });
    assert.ok(t.fetchFn.calls.some(c => c.path === '/oauth2/token/revoke'), 'токен отозван');
  } finally { t.close(); }
});

test('английская версия возвращает на /en/discord', async () => {
  const t = await server();
  try { assert.match((await t.flow('nick=Steve&l=en')).loc, /^\/en\/discord\?f=/); } finally { t.close(); }
});

test('не совпало или не указано — роли нет, подсказка, где указать', async () => {
  for (const social of ['someone_else', null]) {
    const t = await server({ social });
    try {
      const { html } = await t.flow('nick=Steve');
      assert.match(html, /Discord не совпал/);
      assert.match(html, /Social Media/);
      assert.equal(t.store.size(), 0);
      assert.ok(!t.fetchFn.calls.some(c => c.method === 'PUT'));
    } finally { t.close(); }
  }
});

test('нет на сервере — привязка сохранена, зовёт зайти', async () => {
  const t = await server({ member: false });
  try {
    assert.match((await t.flow('nick=Steve')).html, /Почти готово/);
    assert.ok(t.store.get(USER.id));
  } finally { t.close(); }
});

test('неизвестный ник', async () => {
  const t = await server();
  try { assert.match((await t.flow('nick=Nobody')).html, /Игрок не найден/); } finally { t.close(); }
});

test('отвязка снимает роль и ник', async () => {
  const store = createLinkStore(null);
  store.set(USER.id, { uuid: 'aaaa', name: 'Steve', at: 1, nickSet: true });
  const t = await server({ store });
  try {
    assert.match((await t.flow('do=unlink')).html, /Привязка снята/);
    assert.equal(store.get(USER.id), null);
    assert.ok(t.fetchFn.calls.some(c => c.method === 'DELETE'));
    assert.deepEqual(JSON.parse(t.fetchFn.calls.find(c => c.method === 'PATCH').body), { nick: null });
  } finally { t.close(); }
});

test('ник у другого Discord: старая привязка снимается вместе с ролью', async () => {
  const store = createLinkStore(null);
  store.set('555555555555555555', { uuid: 'aaaa', name: 'Steve', at: 1 });
  const t = await server({ store });
  try {
    await t.flow('nick=Steve');
    assert.equal(store.get('555555555555555555'), null);
    assert.ok(t.fetchFn.calls.some(c => c.method === 'DELETE' && c.path.includes('555555555555555555')));
  } finally { t.close(); }
});

test('чужой state без cookie этого браузера не принимается', async () => {
  const t = await server();
  try {
    const r1 = await t.get('/discord/start?nick=Steve');
    const state = new URL(r1.headers.get('location')).searchParams.get('state');
    const r2 = await t.get(`/discord/callback?code=abc&state=${encodeURIComponent(state)}`);
    const html = await (await t.get(r2.headers.get('location'))).text();
    assert.match(html, /Ссылка устарела/);
    assert.ok(!t.fetchFn.calls.some(c => c.path === '/oauth2/token'));
  } finally { t.close(); }
});

test('отмена на стороне Discord', async () => {
  const t = await server();
  try {
    const r1 = await t.get('/discord/start?nick=Steve');
    const cookie = r1.headers.get('set-cookie').split(';')[0];
    const state = new URL(r1.headers.get('location')).searchParams.get('state');
    const r2 = await t.get(`/discord/callback?error=access_denied&state=${encodeURIComponent(state)}`, cookie);
    assert.match(await (await t.get(r2.headers.get('location'))).text(), /Вход отменён/);
  } finally { t.close(); }
});

test('политика конфиденциальности упоминает Discord, только когда привязка включена', async () => {
  const { privacyPage } = await import('../src/legal.js');
  assert.match(privacyPage(ENV), /Discord Inc\./);
  assert.match(privacyPage(ENV, { lang: 'en' }), /Discord Inc\./);
  assert.doesNotMatch(privacyPage({}), /Discord Inc\./);
});

test('имя Discord из Hypixel на странице экранируется', async () => {
  const t = await server({ social: '<img src=x onerror=alert(1)>' });
  try {
    const { html } = await t.flow('nick=Steve');
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /&lt;img src=x/);
  } finally { t.close(); }
});
