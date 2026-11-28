// Страница «Discord-бот»: настройки из .env по умолчанию, проверка значений, права бота в каналах, подсказки
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBotSettings, checkFeature, pageData, FEATURES } from '../src/discord-settings.js';
import { basePerms, channelPerms, missing, P, createGuild } from '../src/discord-guild.js';

const G = '100000000000000001', BOT = '200000000000000002', R_BOT = '300000000000000003', R_VER = '300000000000000004';
const CH_OK = '400000000000000005', CH_RO = '400000000000000006';
const feat = id => FEATURES.find(f => f.id === id);
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dset-')), 'discord-settings.json');

test('без сохранённого — значения из .env; сохранённое побеждает и переживает перезапуск', () => {
  const env = { DISCORD_STATUS_CHANNEL_ID: CH_OK, DISCORD_EVENTS_WEBHOOK: 'https://discord.com/api/webhooks/1/x', DISCORD_EVENTS_ROLES: `jacob=${R_VER}`, DISCORD_VERIFIED_ROLE_ID: R_VER, DISCORD_SYNC_NICK: '1', DISCORD_GUILD_ID: G };
  const file = tmp();
  const s = createBotSettings({ file, env });
  assert.deepEqual(s.get('status'), { on: true, channel: CH_OK });
  assert.equal(s.get('events').on, true);
  assert.deepEqual(s.get('events').roles, { jacob: R_VER });
  assert.deepEqual(s.get('verify'), { on: true, channel: '', role: R_VER, nick: true });
  assert.equal(s.get('alerts').to, 'dm');
  assert.equal(s.get('news').on, false);
  assert.equal(s.guildId(), G);

  let changed = null;
  s.onChange(id => { changed = id; });
  assert.deepEqual(s.set('status', { values: { channel: CH_RO } }), { ok: true });
  assert.equal(changed, 'status');
  assert.deepEqual(s.set('news', { on: true, values: { channel: CH_OK } }), { ok: true });
  assert.deepEqual(s.set('commands', { values: { off: ['price', 'bogus', 'price'] } }), { ok: true });
  const again = createBotSettings({ file, env });
  assert.equal(again.get('status').channel, CH_RO);
  assert.deepEqual(again.get('news'), { on: true, channel: CH_OK });
  assert.deepEqual(again.get('commands').off, ['price']);
});

test('неверные значения не сохраняются', () => {
  const s = createBotSettings({ env: {} });
  assert.equal(s.set('status', { values: { channel: 'abc' } }).ok, false);
  assert.equal(s.set('alerts', { values: { to: 'webhook' } }).ok, false); // webhook в .env не задан
  assert.equal(s.set('alerts', { values: { to: 'channel' } }).ok, true);
  assert.equal(s.set('nope', { on: true }).ok, false);
  assert.equal(s.set('verify', { values: { secret: 'x' } }).ok, false);
  assert.equal(s.set('verify', { on: 'yes' }).ok, false);
});

test('права в канале: @everyone, роли, участник; администратору всё', () => {
  const roles = [{ id: G, permissions: String(P.VIEW | P.SEND) }, { id: R_BOT, permissions: String(P.EMBED | P.MANAGE_ROLES) }];
  const member = { roles: [R_BOT] };
  const base = basePerms(member, roles, G);
  assert.ok(base & P.SEND && base & P.EMBED);
  const ro = { permission_overwrites: [{ id: G, type: 0, deny: String(P.SEND), allow: '0' }] };
  assert.equal(channelPerms(base, ro, member, G, BOT) & P.SEND, 0n);
  const back = { permission_overwrites: [{ id: G, type: 0, deny: String(P.SEND), allow: '0' }, { id: R_BOT, type: 0, allow: String(P.SEND), deny: '0' }] };
  assert.ok(channelPerms(base, back, member, G, BOT) & P.SEND);
  const userDeny = { permission_overwrites: [{ id: BOT, type: 1, deny: String(P.SEND), allow: '0' }] };
  assert.equal(channelPerms(base, userDeny, member, G, BOT) & P.SEND, 0n);
  assert.deepEqual(missing(P.VIEW | P.SEND | P.MANAGE_MESSAGES, ['send', 'pin']), []);
  assert.deepEqual(missing(P.VIEW, ['send', 'pin']), ['Отправлять сообщения', 'Закреплять сообщения']);
  const admin = basePerms({ roles: [R_BOT] }, [{ id: G, permissions: '0' }, { id: R_BOT, permissions: String(P.ADMIN) }], G);
  assert.deepEqual(missing(channelPerms(admin, ro, member, G, BOT), ['send', 'pin']), []);
});

const snap = {
  ok: true, guild: { id: G, name: 'Sky Guide' }, me: { id: BOT, name: 'Sky Guide' }, base: P.VIEW | P.SEND | P.EMBED | P.MANAGE_ROLES, top: 5,
  channels: [{ id: CH_OK, name: 'status', perms: P.VIEW | P.SEND | P.EMBED | P.MANAGE_MESSAGES | P.HISTORY }, { id: CH_RO, name: 'rules', perms: P.VIEW }],
  roles: [{ id: R_VER, name: 'Verified', position: 3, managed: false, mentionable: false }, { id: '300000000000000009', name: 'Mod', position: 9, managed: false, mentionable: true }],
};

test('проверки: канал без прав, роль выше бота, неупоминаемая роль, webhook пока работает', () => {
  const ctx = { token: true, env: { DISCORD_EVENTS_WEBHOOK: 'https://discord.com/api/webhooks/1/x' } };
  assert.deepEqual(checkFeature(feat('status'), { on: true, channel: CH_OK }, snap, ctx).problems, []);
  const ro = checkFeature(feat('status'), { on: true, channel: CH_RO }, snap, ctx).problems;
  assert.match(ro[0].text, /#rules.*Отправлять сообщения/);
  assert.match(ro[0].fix, /Права доступа/);
  assert.match(checkFeature(feat('verify'), { on: true, channel: CH_OK, role: '300000000000000009', nick: false }, snap, ctx).problems[0].text, /выше роли бота/);
  const nick = checkFeature(feat('verify'), { on: true, channel: '', role: R_VER, nick: true }, snap, ctx);
  assert.match(nick.problems[0].text, /никнеймами/);
  assert.match(nick.notes[0], /verify/);
  const ev = checkFeature(feat('events'), { on: true, channel: '', roles: { jacob: R_VER } }, snap, ctx);
  assert.equal(ev.via, 'webhook');
  assert.match(ev.problems[0].text, /нельзя упомянуть/);
  assert.match(checkFeature(feat('news'), { on: true, channel: '' }, snap, ctx).problems[0].text, /Не выбран канал/);
  assert.match(checkFeature(feat('alerts'), { on: true, to: 'dm', channel: '' }, snap, ctx).problems[0].text, /не привязан/);
  assert.deepEqual(checkFeature(feat('alerts'), { on: false, to: 'dm' }, snap, ctx).problems, []);
});

test('на страницу не уходят секреты — только «задан / не задан»', () => {
  const env = { DISCORD_BOT_TOKEN: 'secret-token-value-xxxxxxxxxxxxxxxxxxxx', DISCORD_CLIENT_SECRET: 'client-secret-yyyy', DISCORD_ALERTS_WEBHOOK: 'https://discord.com/api/webhooks/1/zzz' };
  const s = createBotSettings({ env });
  const out = JSON.stringify(pageData(s, snap, { env, token: true }));
  for (const v of Object.values(env)) assert.ok(!out.includes(v), `утекло: ${v.slice(0, 10)}`);
  const d = JSON.parse(out);
  assert.equal(d.secrets.find(x => x.k === 'token').set, true);
  assert.equal(d.secrets.find(x => x.k === 'publicKey').set, false);
  assert.ok(d.features.find(f => f.id === 'alerts').fields[0].opts.some(o => o.id === 'webhook'));
  assert.equal(d.features.find(f => f.id === 'status').status, 'off');
});

test('снимок сервера: каналы с правами бота, роли по порядку, кэш на минуту', async () => {
  let calls = 0, t = 0;
  const data = {
    '/users/@me': { id: BOT, username: 'Sky Guide' },
    '/users/@me/guilds': [{ id: G, name: 'Sky Guide' }],
    [`/guilds/${G}/channels`]: [{ id: '9', type: 4, name: 'Инфо', position: 0 }, { id: CH_OK, type: 0, name: 'status', parent_id: '9', position: 1, permission_overwrites: [] }, { id: '8', type: 2, name: 'voice' }],
    [`/guilds/${G}/roles`]: [{ id: G, permissions: String(P.VIEW | P.SEND), position: 0 }, { id: R_BOT, permissions: '0', position: 5, managed: true, name: 'Sky Guide' }, { id: R_VER, permissions: '0', position: 2, name: 'Verified' }],
    [`/guilds/${G}/members/${BOT}`]: { roles: [R_BOT] },
  };
  const fetchFn = async url => { calls++; const k = url.replace('https://discord.com/api/v10', ''); return { ok: k in data, status: k in data ? 200 : 404, json: async () => data[k] }; };
  const g = createGuild({ token: 'x'.repeat(40), guildId: () => '', fetchFn, now: () => t });
  const s = await g.snapshot();
  assert.equal(s.guild.id, G);
  assert.deepEqual(s.channels.map(c => [c.name, c.category]), [['status', 'Инфо']]);
  assert.ok(s.channels[0].perms & P.SEND);
  assert.deepEqual(s.roles.map(r => r.name), ['Sky Guide', 'Verified']);
  assert.equal(s.top, 5);
  const n = calls;
  await g.snapshot(); assert.equal(calls, n);
  t = 61_000; await g.snapshot(); assert.ok(calls > n);
});

test('новости и события: канал со страницы — от имени бота, без канала — webhook; выключено — молчат', async () => {
  const { createDiscordNews } = await import('../src/discord-news.js');
  const { createDiscordEvents } = await import('../src/discord-events.js');
  const calls = [];
  const fetchFn = async (url, o) => { calls.push({ url, method: o.method, auth: o.headers?.Authorization || null }); return { ok: true, status: 200, json: async () => ({ id: `m${calls.length}` }) }; };
  let ch = CH_OK, on = true;
  const news = createDiscordNews({ webhook: 'https://discord.com/api/webhooks/1/abc', channel: () => ch, on: () => on, botToken: 'tok', news: [{ id: 'a', date: '2026-11-28', kind: 'new', title: 'T', items: ['x'] }], fetchFn, log: { log() {}, warn() {} } });
  assert.equal(await news.tick(), 1);
  assert.equal(calls[0].url, `https://discord.com/api/v10/channels/${CH_OK}/messages`);
  assert.equal(calls[0].auth, 'Bot tok');
  ch = ''; assert.equal(news.enabled, true); on = false; assert.equal(news.enabled, false);

  calls.length = 0; ch = CH_OK; on = true;
  const T0 = Date.parse('2026-11-28T10:00:00Z');
  let list = [{ key: 'j1', role: 'jacob', at: T0 - 1, until: T0 + 1e6, start: T0, end: T0 + 1, emoji: '', title: 'J', ru: '', color: 1 }];
  let saved = null;
  const store = { load: () => (saved ? JSON.parse(JSON.stringify(saved)) : null), save: v => { saved = JSON.parse(JSON.stringify(v)); } };
  const ev = createDiscordEvents({ store, channel: () => ch, botToken: 'tok', roles: () => ({ jacob: R_VER }), due: () => list, crops: null, fetchFn, now: () => T0, log: { log() {}, warn() {} } });
  assert.equal(await ev.tick(), 1);
  list = [{ ...list[0], key: 'j2' }];
  assert.equal(await ev.tick(), 1);
  assert.deepEqual(calls.map(c => c.method), ['POST', 'POST', 'DELETE']);
  assert.equal(calls[2].url, `https://discord.com/api/v10/channels/${CH_OK}/messages/m1`);
});

test('бот: выключенные команды не регистрируются и отвечают «выключена»', async () => {
  const { createDiscordBot } = await import('../src/discord-bot/index.js');
  const crypto = await import('node:crypto');
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  const pk = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
  let sent = null;
  const bot = createDiscordBot({ env: { DISCORD_PUBLIC_KEY: pk, DISCORD_APP_ID: '123456789012345678', DISCORD_BOT_TOKEN: 'tok' }, commandsOff: () => ['price'],
    fetch: async (url, o) => { sent = JSON.parse(o.body); return { ok: true, status: 200 }; }, search: () => [], quote: () => null });
  assert.equal(await bot.registerCommands(), true);
  assert.ok(!sent.some(c => c.name === 'price'));
  assert.ok(sent.some(c => c.name === 'profile'));
  const r = bot.handle({ type: 2, data: { name: 'price', options: [] }, locale: 'ru' });
  assert.match(r.reply.data.content, /выключена/);
});
