// Discord-бот: подпись Discord, команды /profile /price /next, язык, лимиты, регистрация команд без повторов
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createDiscordBot, fileLinks } from '../src/discord-bot/index.js';
import { makeVerifier } from '../src/discord-bot/verify.js';
import { COMMANDS } from '../src/discord-bot/commands.js';
import { coins, langOf, priceMessage, profileMessage, planMessage, errorText } from '../src/discord-bot/render.js';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUB = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('hex');
const sign = (body, ts = String(Math.floor(Date.now() / 1000))) => ({ ts, sig: crypto.sign(null, Buffer.concat([Buffer.from(ts), Buffer.from(body)]), privateKey).toString('hex') });
const ENV = { DISCORD_PUBLIC_KEY: PUB, DISCORD_APP_ID: '1234567890', DISCORD_BOT_TOKEN: 'tok' };
const SITE = 'https://sky-guide.ru';

const V = {
  player: { name: 'Steve', uuid: 'u1' }, updatedAt: 1764230000000,
  member: { profileName: 'Apple' }, analysis: {},
};
const SUMMARY = {
  player: { name: 'Steve' }, profile: 'Apple', gameMode: 'normal', updatedAt: 1764230000000, sbLevel: 212.4, networth: { total: 1_250_000_000 },
  purse: 3_400_000, bank: 50_000_000, skillAverage: 47.123, dungeons: { level: 38.2, selectedClass: 'mage' },
  slayers: { zombie: { level: 9, boss: 'Revenant Horror' }, vampire: { level: 0, boss: 'Riftstalker Bloodfiend' } },
  accessories: { mp: 1234 }, pets: { active: { type: 'GOLDEN_DRAGON', tier: 'LEGENDARY', level: 102 } }, mining: { hotm: 7 },
};
const STEPS = [{ title: 'Купить Hyperion', why: 'Главный урон для Mage', cost: 900_000_000 }, { title: 'Скрафтить [Terminator](item)', why: '', cost: null }];

function makeBot(over = {}) {
  const edits = [];
  const fetch = async (url, o) => { edits.push({ url, method: o.method, body: JSON.parse(o.body), auth: o.headers.Authorization }); return { ok: true, status: 200 }; };
  const bot = createDiscordBot({
    env: ENV, site: () => SITE, fetch,
    view: async want => { if (want.player === 'Nobody') { const e = new Error('нет'); e.code = 'NOT_FOUND'; throw e; } return V; },
    hidden: n => String(n).toLowerCase() === 'secret', open: () => true,
    summary: () => SUMMARY, plan: () => ({ player: { name: 'Steve' }, profile: 'Apple', steps: STEPS }),
    translate: x => JSON.parse(JSON.stringify(x).replace('Купить', 'Buy')),
    search: (q, n) => [{ id: 'HYPERION', name: 'Hyperion', nameRu: 'Гиперион' }, { id: 'ENCHANTED_DIAMOND', name: 'Enchanted Diamond', nameRu: 'Зачарованный алмаз' }].filter(r => r.id === q || r.name.toLowerCase().includes(q.toLowerCase()) || r.nameRu.toLowerCase().includes(q.toLowerCase())).slice(0, n),
    quote: id => (id === 'HYPERION' ? { market: 'ah', buy: 525_000_000, sell: 520_000_000, sellFrom: 'sales', lots: 14, sold24: 3, d1: 1.24, d7: -3 } : { market: 'bazaar', buy: 172_000, sell: 160_000, sellNet: 158_000, buyWeek: 1e6, sellWeek: 2e6 }),
    linkOf: id => (id === 'linked' ? { name: 'Steve' } : null), linkPage: true,
    ...over,
  });
  return { bot, edits };
}
const cmd = (name, options = [], extra = {}) => ({ type: 2, token: 'itok', locale: 'ru', member: { user: { id: 'u42' } }, data: { name, options }, ...extra });

test('без ключа или с кривым ключом бот выключен', () => {
  assert.equal(createDiscordBot({ env: {} }).enabled, false);
  assert.equal(createDiscordBot({ env: { ...ENV, DISCORD_PUBLIC_KEY: 'zz' } }).enabled, false);
  assert.equal(createDiscordBot({ env: { DISCORD_PUBLIC_KEY: PUB, DISCORD_CLIENT_ID: '1234567890' } }).enabled, true); // id из привязки Discord подходит
});

test('подпись: верная проходит, чужая, изменённое тело и старое время — нет', () => {
  const v = makeVerifier(PUB);
  const body = '{"type":1}';
  const { ts, sig } = sign(body);
  assert.equal(v(sig, ts, Buffer.from(body)), true);
  assert.equal(v(sig, ts, Buffer.from('{"type":2}')), false);
  assert.equal(v('00'.repeat(64), ts, Buffer.from(body)), false);
  const old = sign(body, String(Math.floor(Date.now() / 1000) - 3600));
  assert.equal(v(old.sig, old.ts, Buffer.from(body)), false);
  assert.equal(v(undefined, undefined, Buffer.from(body)), false);
});

test('HTTP: PING → PONG, без подписи 401 (так Discord проверяет адрес)', async () => {
  const { bot } = makeBot();
  const app = express(); app.use(bot.router);
  const srv = app.listen(0); const url = `http://127.0.0.1:${srv.address().port}/discord/interactions`;
  try {
    const body = JSON.stringify({ type: 1 });
    const { ts, sig } = sign(body);
    const ok = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'X-Signature-Ed25519': sig, 'X-Signature-Timestamp': ts } });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { type: 1 });
    const bad = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'X-Signature-Ed25519': '00'.repeat(64), 'X-Signature-Timestamp': ts } });
    assert.equal(bad.status, 401);
  } finally { srv.close(); }
});

test('/profile: сначала «думаю», потом карточка с полями и кнопками на сайт', async () => {
  const { bot, edits } = makeBot();
  const out = bot.handle(cmd('profile', [{ name: 'nick', value: 'Steve' }]));
  assert.equal(out.reply.type, 5);
  assert.equal(out.reply.data.flags, 0);
  await out.after();
  assert.equal(edits.length, 1);
  assert.match(edits[0].url, /\/webhooks\/1234567890\/itok\/messages\/@original$/);
  const e = edits[0].body.embeds[0];
  assert.equal(e.title, 'Steve · Apple');
  const f = Object.fromEntries(e.fields.map(x => [x.name, x.value]));
  assert.equal(f['SkyBlock Level'], '212');
  assert.equal(f.Networth, '1.25B');
  assert.equal(f.Slayers, 'Revenant 9'); // нулевые не показываем
  assert.equal(f['Питомец'], 'Golden Dragon (Legendary, 102)');
  assert.match(f['Что делать дальше'], /1\. Купить Hyperion\n2\. Скрафтить Terminator/);
  assert.equal(edits[0].body.components[0].components[0].url, `${SITE}/?player=Steve&profile=Apple#/overview`);
  assert.deepEqual(edits[0].body.allowed_mentions, { parse: [] });
});

test('/profile без ника: привязанный аккаунт; без привязки — подсказка только тебе', async () => {
  const { bot, edits } = makeBot();
  const linked = bot.handle(cmd('profile', [], { member: { user: { id: 'linked' } } }));
  assert.equal(linked.reply.type, 5);
  await linked.after();
  assert.equal(edits[0].body.embeds[0].title, 'Steve · Apple');
  const none = bot.handle(cmd('profile'));
  assert.equal(none.reply.type, 4);
  assert.equal(none.reply.data.flags, 64);
  assert.match(none.reply.data.content, /sky-guide\.ru\/discord/);
});

test('/profile: скрытый игрок, плохой ник, ненайденный и закрытые профили', async () => {
  const { bot, edits } = makeBot();
  assert.match(bot.handle(cmd('profile', [{ name: 'nick', value: 'Secret' }])).reply.data.content, /попросил не показывать/);
  assert.match(bot.handle(cmd('profile', [{ name: 'nick', value: 'кот' }])).reply.data.content, /латиница/);
  const nf = bot.handle(cmd('profile', [{ name: 'nick', value: 'Nobody' }]));
  await nf.after();
  assert.match(edits[0].body.content, /«Nobody» не найден/);
  const closed = makeBot({ open: () => false }).bot;
  assert.match(closed.handle(cmd('profile', [{ name: 'nick', value: 'Steve' }])).reply.data.content, /закрыты/);
  // свою привязку видно и на закрытом сайте
  assert.equal(closed.handle(cmd('profile', [], { member: { user: { id: 'linked' } } })).reply.type, 5);
});

test('лимит разных ников: отказ без запроса профиля', () => {
  let views = 0;
  const { bot } = makeBot({ allowNick: () => false, view: async () => { views++; return V; } });
  const out = bot.handle(cmd('profile', [{ name: 'nick', value: 'Steve' }]));
  assert.match(out.reply.data.content, /Слишком много/);
  assert.equal(out.after, undefined);
  assert.equal(views, 0);
});

test('/next: личный ответ, шаги плана, английский — переведённые', async () => {
  const { bot, edits } = makeBot();
  const out = bot.handle(cmd('next', [{ name: 'nick', value: 'Steve' }], { locale: 'en-US' }));
  assert.equal(out.reply.data.flags, 64);
  await out.after();
  const e = edits[0].body.embeds[0];
  assert.equal(e.title, 'What to do next · Steve');
  assert.match(e.description, /\*\*1\. Buy Hyperion\*\*\nГлавный урон для Mage\nCost: ~900M/);
  assert.match(e.url, /^https:\/\/sky-guide\.ru\/en\/\?player=Steve&profile=Apple#\/roadmap$/);
});

test('/price: сразу отвечает; Auction House и Bazaar; не найден', () => {
  const { bot } = makeBot();
  const ah = bot.handle(cmd('price', [{ name: 'item', value: 'гиперион' }])).reply;
  assert.equal(ah.type, 4);
  const e = ah.data.embeds[0];
  assert.equal(e.title, 'Hyperion');
  assert.match(e.description, /Гиперион · Auction House/);
  assert.equal(e.url, `${SITE}/item/HYPERION`);
  assert.ok(e.fields.some(f => f.name === 'Lowest BIN' && f.value === '525M'));
  assert.ok(e.fields.some(f => f.value === '+1.2% за сутки · -3% за неделю'));
  const bz = bot.handle(cmd('price', [{ name: 'item', value: 'ENCHANTED_DIAMOND' }, { name: 'private', value: true }], { locale: 'en-GB' })).reply;
  assert.equal(bz.data.flags, 64);
  assert.equal(bz.data.embeds[0].title, 'Enchanted Diamond');
  assert.ok(bz.data.embeds[0].fields.some(f => f.name === 'Instant buy' && f.value === '172k'));
  assert.match(bot.handle(cmd('price', [{ name: 'item', value: 'zzzz' }])).reply.data.content, /«zzzz» не найден/);
});

test('подсказки предмета: id в value, русское название рядом', () => {
  const { bot } = makeBot();
  const r = bot.handle({ type: 4, locale: 'ru', data: { name: 'price', options: [{ name: 'item', value: 'гипер', focused: true }] } }).reply;
  assert.deepEqual(r, { type: 8, data: { choices: [{ name: 'Hyperion · Гиперион', value: 'HYPERION' }] } });
  assert.deepEqual(bot.handle({ type: 4, data: { options: [{ name: 'item', value: 'h', focused: true }] } }).reply.data.choices, []);
});

test('регистрация команд: один раз на список, повтор после изменения', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-'));
  const { bot, edits } = makeBot({ commandsFile: path.join(dir, 'c.json') });
  assert.equal(await bot.registerCommands(), true);
  assert.equal(edits[0].method, 'PUT');
  assert.equal(edits[0].url, 'https://discord.com/api/v10/applications/1234567890/commands');
  assert.equal(edits[0].auth, 'Bot tok');
  assert.equal(edits[0].body.length, COMMANDS.length);
  assert.equal(await bot.registerCommands(), false);
  assert.equal(edits.length, 1);
  assert.equal(await makeBot({ env: { ...ENV, DISCORD_BOT_TOKEN: '' } }).bot.registerCommands(), false);
});

test('команды: имена по правилам Discord, описания до 100 знаков, есть русский', () => {
  const walk = list => list.forEach(c => {
    assert.match(c.name, /^[-_a-z0-9]{1,32}$/);
    assert.match(c.name_localizations.ru, /^[-_\p{Ll}\p{N}]{1,32}$/u);
    for (const d of [c.description, c.description_localizations.ru]) assert.ok(d.length >= 1 && d.length <= 100, d);
    if (c.options) walk(c.options);
  });
  walk(COMMANDS);
});

test('привязки из файла модуля привязки Discord', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'links-'));
  const file = path.join(dir, 'discord-links.json');
  const linkOf = fileLinks(file);
  assert.equal(linkOf('1'), null); // файла ещё нет
  fs.writeFileSync(file, JSON.stringify({ 111: { uuid: 'abc', name: 'Steve', at: 1 } }));
  assert.deepEqual(linkOf('111'), { name: 'Steve', uuid: 'abc' });
  assert.equal(linkOf('222'), null);
});

test('мелочи: язык, монеты, ошибки, экранирование ника', () => {
  assert.equal(langOf('ru'), 'ru'); assert.equal(langOf('uk'), 'ru'); assert.equal(langOf('en-US'), 'en'); assert.equal(langOf(), 'en');
  assert.equal(coins(999), '999'); assert.equal(coins(12_345), '12.35k'); assert.equal(coins(2_500_000), '2.5M');
  assert.equal(errorText({ code: 'RATE' }, 'en', 'x'), 'Hypixel is not responding or the request limit is reached. Try again in a couple of minutes.');
  assert.match(errorText({ code: 'NOT_FOUND' }, 'ru', '__x__'), /\\_\\_x\\_\\_/);
  assert.equal(priceMessage({ id: 'X', name: 'X' }, null, { lang: 'en', site: SITE }).embeds[0].description, 'Not sold on the Bazaar or the Auction House right now.');
  assert.match(profileMessage({ ...SUMMARY, missingProfile: 'Kiwi' }, { site: SITE }).content, /«Kiwi» нет/);
  assert.equal(planMessage({ player: { name: 'S' }, steps: [] }, { site: SITE }).embeds[0].description, 'Главных шагов сейчас нет: профиль в отличной форме.');
});
