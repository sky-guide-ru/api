// События SkyBlock — в Discord: пинг ролей, без повторов после перезапуска, часовые сообщения не копятся
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDiscordEvents, eventMessage, parseRoles } from '../src/discord-events.js';

const HOOK = 'https://discord.com/api/webhooks/123456/abc_DEF-ghi';
const memStore = () => { let s = null; return { load: () => (s ? JSON.parse(JSON.stringify(s)) : null), save: v => { s = JSON.parse(JSON.stringify(v)); }, peek: () => s }; };
const fakeFetch = () => {
  const calls = []; let n = 0;
  const f = async (url, o) => { calls.push({ url, method: o.method, body: o.body ? JSON.parse(o.body) : null }); return { ok: true, status: 200, json: async () => ({ id: `m${++n}` }) }; };
  f.calls = calls; return f;
};
const quiet = { log() {}, warn() {} };
const T = Date.parse('2026-11-27T08:11:00Z');
const A = (key, role, start, extra = {}) => ({ key, role, at: start - 5 * 60_000, until: start, start, end: start + 20 * 60_000, emoji: '🌾', title: key, ru: 'Текст', color: 1, ...extra });

test('роли: только известные и числовые id', () => {
  assert.deepEqual(parseRoles('jacob=1234567890, darkauction:2234567890;bogus=3234567890 mayor=abc'), { jacob: '1234567890', darkauction: '2234567890' });
  assert.deepEqual(parseRoles(''), {});
});

test('сообщение: пинг только своей роли, культуры, время Discord, английская строка', () => {
  const m = eventMessage(A('jacob:1', 'jacob', T + 240_000, { crops: ['Wheat', 'Cactus', 'Melon'] }), { roleId: '42', translate: s => (s === 'Текст' ? 'Text' : s) });
  assert.equal(m.content, '<@&42>');
  assert.deepEqual(m.allowed_mentions, { parse: [], roles: ['42'] });
  const d = m.embeds[0].description;
  assert.match(d, /\*\*Wheat · Cactus · Melon\*\*/);
  assert.match(d, new RegExp(`<t:${Math.floor((T + 240_000) / 1000)}:R>`));
  assert.match(d, /Текст\n\*Text\*/);
  const quietMsg = eventMessage(A('x', 'events', T));
  assert.equal(quietMsg.content, undefined);
  assert.deepEqual(quietMsg.allowed_mentions.roles, []);
  const mayor = eventMessage({ ...A('mayor:525:diana', 'mayor', T), perks: [{ name: 'Lucky!', ru: '+25 Pet Luck.', en: 'Gain +25 Pet Luck.' }], minister: { name: 'Marina', perk: { name: 'Fishing Festival', ru: 'Акулы', en: 'Sharks' } } });
  assert.deepEqual(mayor.embeds[0].fields.map(f => f.name), ['Lucky!', 'Minister Marina · Fishing Festival']);
});

test('без повторов после перезапуска; прошлое часовое сообщение удаляется', async () => {
  const f = fakeFetch(), store = memStore();
  let now = T, list = [A('jacob:1', 'jacob', T + 240_000), A('mayor:525:diana', 'mayor', T, { at: 0, until: T + 1e9 })];
  const make = () => createDiscordEvents({ webhook: HOOK, roles: 'jacob=1234567', store, due: () => list, crops: null, fetchFn: f, now: () => now, log: quiet });
  assert.equal(await make().tick(), 2);
  const by = k => f.calls.find(c => c.body?.embeds[0].title.endsWith(k)).body;
  assert.equal(by('mayor:525:diana').content, undefined, 'мэр без роли — без пинга');
  assert.equal(by('jacob:1').content, '<@&1234567>');
  assert.equal(await make().tick(), 0, 'перезапуск — ничего заново');
  // Следующий час: новый Jacob уходит, прошлый удаляется
  now = T + 3600_000;
  list = [A('jacob:2', 'jacob', now + 240_000), A('mayor:525:diana', 'mayor', T, { at: 0, until: T + 1e9 })];
  assert.equal(await make().tick(), 1);
  const del = f.calls.find(c => c.method === 'DELETE');
  assert.equal(del.url, `${HOOK}/messages/m1`);
  assert.equal(store.peek().last.jacob, 'm3');
  // Поздно: объявление, у которого прошло until, не догоняем
  list = [A('jacob:3', 'jacob', now - 60_000)];
  assert.equal(await make().tick(), 0);
});

test('без webhook ничего не делает', async () => {
  const f = fakeFetch();
  const d = createDiscordEvents({ fetchFn: f, crops: null, due: () => [A('x', 'jacob', T + 1000)], log: quiet });
  assert.equal(d.enabled, false);
  assert.equal(await d.tick(), 0);
  assert.equal(f.calls.length, 0);
});
