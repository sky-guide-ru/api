// /v1: каждая ручка есть в openapi.yaml и наоборот, ответы на фикстурах проходят проверку по схемам описания,
// данные игроков — только по ключу, лимиты, ошибки в одном виде.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import YAML from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import { createV1 } from '../src/v1/index.js';
import { createKeyStore } from '../src/v1/keys.js';
import { SPEC_FILE, mountDocs } from '../src/v1/docs.js';
import { missingAccessories, accessoriesView, networthView } from '../src/v1/players.js';

const spec = YAML.parse(fs.readFileSync(SPEC_FILE, 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
ajv.addSchema({ $id: 'spec', components: spec.components });

// ---------- Фикстуры ----------
const ITEM = { id: 'HYPERION', name: 'Hyperion', rarity: 'LEGENDARY', rarityRu: 'Legendary', type: 'SWORD', lore: ['§7Damage: §c+260'], loreRu: ['§7Урон: §c+260'],
  recipe: { A1: 'NECRON_BLADE:1' }, recipes: null, names: { NECRON_BLADE: "Necron's Blade" }, prices: { bin: { price: 1e9 } }, npc: null, priceId: 'HYPERION',
  usedIn: [{ id: 'X', name: 'X' }], props: null, obtainment: null, ru: { descriptionRu: 'Меч' } };
const BZ = { id: 'ENCHANTED_DIAMOND', name: 'Enchanted Diamond', nameEn: 'Enchanted Diamond', buy: 1200, sell: 1100, spread: 100, buyVol: 1, sellVol: 2, buyWeek: 1e5, sellWeek: 1e5, buyOrders: 3, sellOrders: 4, d1: { buy: 1.5, sell: null }, cat: 'mining' };
const AH = { id: 'HYPERION', name: 'Hyperion', nameEn: 'Hyperion', price: 1e9, second: 1.1e9, count: 4, auction: null, sold24: 2, sold7: 9, median: 1.05e9, last: 1e9, lastAt: 1, cat: 'weapon', rarity: 'LEGENDARY', d1: null };
const MEMBER = { profileName: 'Apple', profileId: 'p1', uuid: 'u1', skills: {}, slayers: {}, dungeons: {} };
const VIEW = {
  player: { name: 'Steve', uuid: 'u1' }, member: MEMBER, updatedAt: 5, missingProfile: null,
  profiles: [{ id: 'p1', name: 'Apple', selected: true, mode: 'normal', members: 2 }],
  analysis: {
    roadmap: [{ id: 'acc-1', cat: 'Аксессуары', priority: 80, effort: 'минуты', title: 'Купи Talisman', why: 'MP', how: ['Bazaar'], items: ['X'], cost: 10 },
      { id: 'dng', cat: 'Dungeons', priority: 60, title: 'Пройди F5', why: 'XP', how: [] }, { id: 'zero', cat: 'x', priority: 0, title: 't', why: '', how: [] }],
    acc: {
      calculatedMp: 120, highestMp: 130, count: 20, notRecombCount: 3, recombGain: 9, recombPrice: 7e6, enrichPrice: 4e6,
      list: [{ id: 'SPEED_TALISMAN', name: 'Speed Talisman', rarity: 'COMMON', mp: 3, active: true, recomb: false, next: { id: 'SPEED_RING' }, canRecomb: true, value: 500 }],
      missing: [
        // линейка Speed: своя Talisman, апгрейды Ring и Artifact — в ответе один, с большим MP
        { id: 'SPEED_RING', name: 'Speed Ring', rarity: 'UNCOMMON', gain: 2, price: 1000, perMp: 500, upgradeFrom: 'Speed Talisman', family: ['SPEED_TALISMAN', 'SPEED_RING', 'SPEED_ARTIFACT'], tier: [2, 3], how: 'craft' },
        { id: 'SPEED_ARTIFACT', name: 'Speed Artifact', rarity: 'RARE', gain: 5, price: 50000, perMp: 10000, upgradeFrom: 'Speed Talisman', family: ['SPEED_TALISMAN', 'SPEED_RING', 'SPEED_ARTIFACT'], tier: [3, 3], how: 'craft' },
        { id: 'FEATHER_TALISMAN', name: 'Feather Talisman', rarity: 'COMMON', gain: 3, price: 300, perMp: 100, family: ['FEATHER_TALISMAN', 'FEATHER_RING'], tier: [1, 2], how: 'npc', req: 'Feather VI' },
        { id: 'FEATHER_RING', name: 'Feather Ring', rarity: 'UNCOMMON', gain: 5, price: 9000, perMp: 1800, family: ['FEATHER_TALISMAN', 'FEATHER_RING'], tier: [2, 2], how: 'craft' },
        { id: 'BAT_TALISMAN', name: 'Bat Talisman', rarity: 'RARE', gain: 8, price: 0, perMp: null, family: ['BAT_TALISMAN'], how: 'drop' },
      ],
      steps: [{ kind: 'buy', id: 'FEATHER_TALISMAN', name: 'Feather Talisman', rarity: 'COMMON', cost: 300, gain: 3 }, { kind: 'tier', id: 'SPEED_TALISMAN', target: 'SPEED_RING', name: 'Speed Ring', cost: 1000, gain: 2 }, { kind: 'enrich', id: 'X', name: 'X', cost: 4e6, gain: 0 }],
    },
    gear: {
      networth: { total: 1e9 + 0.4, items: 8e8, pets: 1e8, sacks: 5e7, essence: 2e7, museum: 2e7, coins: 1e7 },
      topItems: [{ id: 'HYPERION', name: 'Hyperion', rarity: 'LEGENDARY', value: 8e8, where: 'Inventory' }],
      topPets: [{ id: 'ENDER_DRAGON;4', type: 'ENDER_DRAGON', tier: 'LEGENDARY', level: 100, heldItem: null, value: 1e8 }],
    },
  },
};
const WHERE = { FEATHER_TALISMAN: [{ kind: 'npc', textRu: 'Купить у NPC Farmer за 250 монет', cost: [{ id: 'SKYBLOCK_COIN', count: 250 }] }, { kind: 'drop', subkind: 'unknown', textRu: '?' }],
  BAT_TALISMAN: [{ kind: 'drop', textRu: 'Дроп с Bat в Spooky Festival', cost: [] }, { kind: 'trade', textRu: 'Обмен на 64 Bits', cost: [{ id: 'SKYBLOCK_BITS', count: 64 }] }] };

function makeDeps(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-v1-'));
  const keys = createKeyStore({ dataDir: dir });
  const calls = [];
  return {
    keys, calls, clientIp: req => req.headers['x-test-ip'] || '127.0.0.1', open: () => true, openPerMin: 1000,
    items: {
      card: async id => (id === 'HYPERION' ? ITEM : null),
      obtain: async id => (id === 'HYPERION' ? { id, name: 'Hyperion', wiki: { page: 'https://x', search: 'https://y' }, methods: [{ kind: 'craft', title: 'Скрафтить', total: null, steps: [] }] } : null),
      search: (q, limit) => [{ id: 'HYPERION', name: 'Hyperion', nameRu: 'Гиперион', rarity: 'LEGENDARY', type: 'Sword', category: 'Оружие', price: 1e9 }].slice(0, limit),
    },
    market: {
      bazaar: q => ({ total: 1, items: [BZ], facets: { cat: { mining: 1 } }, q }),
      auctions: q => ({ total: 1, items: q.ids ? [{ ...AH, variants: [{ id: 'HYPERION@5', label: '5✪', price: 2e9, count: 1, sold24: 0, median: 0 }] }] : [AH] }),
      candles: async id => (id === 'HYPERION' ? { id, market: 'ah', name: 'Hyperion', tf: '1h', candles: [[1, 1, 2, 0.5, 1.5, 3]], hasMore: false, live: null, variants: [], keep: { '1h': 1 } } : null),
      flips: (kind, q) => { calls.push(['flips', kind, q]); return [{ id: 'A', name: 'A', profit: 5 }]; },
    },
    lexicon: () => ({ v: 1, ready: true, phrases: { Hyperion: 'i:HYPERION' } }),
    news: () => ({ latest: 'n1', entries: [{ id: 'n1', date: '2026-11-26', kind: 'new', kindRu: 'Новое', title: 'T', items: ['a'] }] }),
    status: () => ({ ok: true, load: 'low', why: 'всё спокойно', at: 1, hypixel: { limitedUntil: null, daily: false, keyBroken: false }, prices: { bazaarAt: 1, auctionsAt: null } }),
    version: () => ({ build: 'dev', core: '0.1.0' }),
    players: {
      view: async want => {
        calls.push(['view', want]);
        if (want.player === 'Nobody') { const e = new Error('Игрок не найден'); e.code = 'NOT_FOUND'; throw e; }
        if (want.player === 'Limited') { const e = new Error('Hypixel просит подождать'); e.code = 'RATE'; throw e; }
        if (want.player === 'Loading') return { ...VIEW, member: null };
        if (want.player === 'Broken') return { ...VIEW, member: null, error: 'fetch failed' };
        return { ...VIEW, missingProfile: want.profile && want.profile !== 'Apple' ? want.profile : null };
      },
      hidden: name => name.toLowerCase() === 'secret',
    },
    summary: v => ({ player: v.player, profile: v.member.profileName, profileId: 'p1', gameMode: null, coop: 2, updatedAt: 5, sbLevel: 100, networth: { total: 5 }, purse: 1, bank: null, skillAverage: 30,
      skills: { farming: { name: 'Farming', level: 50, maxLevel: 60, progress: 0.5, xp: 1 } }, slayers: {}, dungeons: { level: 30 }, next: [{ id: 'acc-1', title: 't', cat: 'c' }] }),
    plan: v => ({ player: v.player, profile: 'Apple', updatedAt: 5, steps: v.analysis.roadmap.filter(s => s.priority > 0).map(s => ({ effort: null, items: [], cost: null, payoff: null, needsSaving: false, link: null, ...s })) }),
    money: v => ({ player: v.player, profile: 'Apple', updatedAt: 5, plan: null, methods: [{ id: 'm', title: 'Farming' }] }),
    accessories: (v, q) => accessoriesView(v, q),
    missing: (v, q) => missingAccessories(v, q, { whereToGet: id => WHERE[id] || [], priceOf: () => 0 }),
    networth: (v, q) => networthView(v, q),
    auctions: async v => {
      if (v.player.name === 'Limited') { const e = new Error('Hypixel просит подождать'); e.code = 'RATE'; throw e; }
      return { player: v.player, profile: 'Apple', at: 5, scanAt: 4, error: null, errorCode: null, bazaar: false,
        listings: [{ id: 'a1', name: 'Hyperion', tier: 'LEGENDARY', key: 'HYPERION', count: 1, bin: true, status: 'sold', start: 1, end: 2, price: 9e8, bids: 1, coins: 9e8 },
          { id: 'a2', name: 'Juju Shortbow', tier: 'EPIC', key: 'JUJU_SHORTBOW', count: 1, bin: true, status: 'active', start: 1, end: 9, price: 2e6, bids: 0, undercut: 1e5, lowest: 1.9e6 }],
        bids: [{ id: 'b1', name: 'Terminator', tier: 'LEGENDARY', end: 9, mine: 1, top: 2, bids: 2, status: 'outbid' }],
        summary: { coins: 9e8, sold: 1, expired: 0, active: 1, undercut: 1, outbid: 1, bids: 1 } };
    },
    calendar: year => ({ year: year ? Number(year) : 400, mayor: { name: 'Diana' }, money: [] }),
    leaderboard: q => { calls.push(['leaderboard', q]); return { board: q.board, rows: [{ rank: 1, name: 'Steve', value: 1e9 }], mode: q.mode, tracked: 1, boards: [{ id: 'networth', label: 'Networth' }] }; },
    guides: { list: () => ({ groups: [{ id: 'combat', title: 'Combat' }], guest: true, guides: [{ id: 'dungeons', title: 'Dungeons' }] }), get: id => (id === 'dungeons' ? { id, title: 'Dungeons', sections: [] } : null) },
    quotes: ids => Object.fromEntries(ids.map(id => [id, id === 'NOPE' ? null : { buy: 10, sell: 9 }])),
    trend: id => (id === 'HYPERION' ? { id, market: 'Auction House', now: 1e9, d1: 1.5, d7: null, label: 'растёт' } : { id, market: null, now: 0, d1: null, d7: null, label: 'нет данных' }),
    movers: period => ({ up: [{ id: 'A', pct: 10, period }], down: [] }),
    crops: q => { calls.push(['crops', q]); return [{ id: 'WHEAT', perHour: 1e6 }]; },
    image: async id => (id === 'HYPERION' ? Buffer.from([0x89, 0x50, 0x4e, 0x47]) : null),
    section: (name, v, q) => (name === 'bank' ? null : { section: name, q, player: v.player.name, ...(name === 'guides' ? { groups: [], guides: [] } : {}) }),
    guide: (id, v) => (id === 'dungeons' ? { id, title: 'Dungeons', progress: 0.5, player: v.player.name } : null),
    history: (v, days) => ({ points: [{ t: 1, nw: 5 }], since: 1, tracked: true, days }),
    upgrades: (v, id) => (id === 'HYPERION' ? [{ uuid: 'u-1', where: 'Inventory', name: 'Heroic Hyperion ✪✪✪✪✪', rarity: 'MYTHIC', value: 9e8, recomb: true, market: null, family: null, plan: { kind: 'weapon', steps: [] } }] : []),
    ...over,
  };
}

async function withV1(over, fn) {
  const d = makeDeps(over);
  const app = express();
  app.use('/v1', createV1(d));
  mountDocs(app);
  const srv = app.listen(0);
  await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try { await fn(base, d); } finally { srv.close(); }
}

// Схема ответа из описания: путь шаблона /v1/items/{id} + код
function responseSchema(tpl, status) {
  const r = spec.paths[tpl].get.responses[String(status)];
  assert.ok(r, `в описании нет ответа ${status} для ${tpl}`);
  const resp = r.$ref ? spec.components.responses[r.$ref.split('/').pop()] : r;
  return resp.content['application/json'].schema;
}
function checkSchema(tpl, status, body) {
  const schema = JSON.parse(JSON.stringify(responseSchema(tpl, status)).replace(/"#\/components/g, '"spec#/components'));
  const ok = ajv.validate(schema, body);
  assert.ok(ok, `${tpl} ${status}: ${ajv.errorsText(ajv.errors)}\n${JSON.stringify(body).slice(0, 500)}`);
}
async function get(base, url, tpl, { headers = {}, status = 200 } = {}) {
  const r = await fetch(base + url, { headers });
  const body = await r.json();
  assert.equal(r.status, status, `${url}: ${JSON.stringify(body)}`);
  checkSchema(tpl, status, body);
  return { r, body };
}

// ---------- Описание ↔ код ----------
test('каждая ручка /v1 есть в openapi.yaml и наоборот', () => {
  const router = createV1(makeDeps());
  const inCode = router.stack.filter(l => l.route).map(l => `/v1${l.route.path}`.replace(/:(\w+)/g, '{$1}')).sort();
  const inSpec = Object.keys(spec.paths).filter(p => p.startsWith('/v1/')).sort();
  assert.deepEqual(inCode, inSpec);
  for (const p of inSpec) {
    assert.deepEqual(Object.keys(spec.paths[p]), ['get'], `${p}: в /v1 только GET`);
    const op = spec.paths[p].get;
    assert.ok(op.operationId && op.summary, `${p}: нужны operationId и summary`);
    assert.ok(op.responses['200'] && op.responses['429'], `${p}: нужны ответы 200 и 429`);
    // Данные игроков — только по ключу: в описании это security, в коде — 401 без ключа (проверка ниже)
    assert.equal(!!op.security, p.startsWith('/v1/players/') || p === '/v1/compare', `${p}: ключ нужен ровно для ручек игроков`);
  }
  const ids = inSpec.map(p => spec.paths[p].get.operationId);
  assert.equal(new Set(ids).size, ids.length, 'operationId повторяется');
});

test('описание — правильный OpenAPI 3.1, все $ref находятся', () => {
  assert.equal(spec.openapi, '3.1.0');
  const refs = JSON.stringify(spec).match(/"#\/components\/[^"]+"/g) || [];
  for (const ref of new Set(refs)) {
    const parts = JSON.parse(ref).slice(2).split('/');
    assert.ok(parts.reduce((o, k) => o?.[k], spec), `нет ${ref}`);
  }
  for (const name of Object.keys(spec.components.schemas)) ajv.getSchema(`spec#/components/schemas/${name}`); // компилируется
});

// ---------- Открытые ручки ----------
test('открытые ручки отвечают без ключа по схемам описания', () => withV1({}, async (base, d) => {
  await get(base, '/v1/version', '/v1/version');
  await get(base, '/v1/status', '/v1/status');
  const { r } = await get(base, '/v1/items/HYPERION', '/v1/items/{id}');
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.equal(r.headers.get('x-ratelimit-limit'), '1000');
  await get(base, '/v1/items/NOPE', '/v1/items/{id}', { status: 404 });
  await get(base, '/v1/items/bad%20id', '/v1/items/{id}', { status: 400 });
  await get(base, '/v1/items/HYPERION/obtain', '/v1/items/{id}/obtain');
  await get(base, '/v1/items/NOPE/obtain', '/v1/items/{id}/obtain', { status: 404 });
  await get(base, `/v1/search?q=${encodeURIComponent('гиперион')}&limit=5`, '/v1/search');
  await get(base, '/v1/search?q=h', '/v1/search', { status: 400 });
  await get(base, '/v1/bazaar?q=diamond&limit=1', '/v1/bazaar');
  await get(base, '/v1/auctions?ids=HYPERION', '/v1/auctions');
  await get(base, '/v1/auctions', '/v1/auctions');
  await get(base, '/v1/market/candles/HYPERION?market=ah&tf=1h', '/v1/market/candles/{id}');
  await get(base, '/v1/market/candles/NOPE', '/v1/market/candles/{id}', { status: 404 });
  for (const kind of ['bazaar', 'craft', 'forge', 'npc', 'snipes']) await get(base, `/v1/flips/${kind}?limit=3`, '/v1/flips/{kind}');
  await get(base, '/v1/flips/snipes', '/v1/flips/{kind}');
  await get(base, '/v1/flips/nope', '/v1/flips/{kind}', { status: 404 });
  assert.deepEqual(d.calls.find(c => c[0] === 'flips')[2], { limit: 3, max: Infinity });
  await get(base, '/v1/refs/lexicon', '/v1/refs/lexicon');
  await get(base, '/v1/news', '/v1/news');
}));

test('параметры списка обрезаются до разумных', () => withV1({}, async base => {
  const r = await fetch(`${base}/v1/bazaar?limit=99999&offset=-5&ids=A,B`).then(r => r.json());
  assert.deepEqual({ limit: r.q.limit, offset: r.q.offset, ids: r.q.ids }, { limit: 200, offset: 0, ids: ['A', 'B'] });
}));

test('CORS, только GET и ошибки в одном виде', () => withV1({}, async base => {
  const pre = await fetch(`${base}/v1/items/HYPERION`, { method: 'OPTIONS' });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-headers'), /X-API-Key/);
  const post = await fetch(`${base}/v1/items/HYPERION`, { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal((await post.json()).code, 'METHOD');
  const nf = await fetch(`${base}/v1/nope`);
  assert.equal(nf.status, 404);
  assert.deepEqual(Object.keys(await nf.json()).sort(), ['code', 'error']);
}));

test('без открытого просмотра (PUBLIC_VIEW=0) открытые ручки тоже требуют ключ', () => withV1({ open: () => false }, async (base, d) => {
  const r = await fetch(`${base}/v1/items/HYPERION`);
  assert.equal(r.status, 401);
  const { key } = d.keys.create({ name: 'Бот', players: true });
  assert.equal((await fetch(`${base}/v1/items/HYPERION`, { headers: { 'X-API-Key': key } })).status, 200);
}));

// ---------- Игроки и ключи ----------
test('данные игроков — только по ключу; неверный и отозванный ключ — 403', () => withV1({}, async (base, d) => {
  await get(base, '/v1/players/Steve/profiles', '/v1/players/{name}/profiles', { status: 401 });
  await get(base, '/v1/players/Steve/profiles/selected/summary', '/v1/players/{name}/profiles/{profile}/summary', { status: 401 });
  assert.equal(d.calls.filter(c => c[0] === 'view').length, 0, 'без ключа профиль не запрашивается');
  const bad = await fetch(`${base}/v1/players/Steve/profiles`, { headers: { 'X-API-Key': 'sg_AAAAAAAAAA_' + 'x'.repeat(32) } });
  assert.equal(bad.status, 403);
  assert.equal((await bad.json()).code, 'BAD_KEY');
  // неверный ключ на открытой ручке — тоже 403: ошибку в настройках клиента видно сразу
  assert.equal((await fetch(`${base}/v1/version`, { headers: { 'X-API-Key': 'oops' } })).status, 403);

  const k = d.keys.create({ name: 'Мод', players: true, perMin: 50 });
  const h = { 'X-API-Key': k.key };
  const { r } = await get(base, '/v1/players/Steve/profiles', '/v1/players/{name}/profiles', { headers: h });
  assert.equal(r.headers.get('x-ratelimit-limit'), '50');
  assert.equal(r.headers.get('x-ratelimit-remaining'), '49');
  await get(base, '/v1/players/Steve/profiles/selected/summary', '/v1/players/{name}/profiles/{profile}/summary', { headers: h });
  assert.deepEqual(d.calls.at(-1), ['view', { player: 'Steve', profile: '' }], 'selected — профиль, где игрок играет');
  const plan = await get(base, '/v1/players/Steve/profiles/Apple/plan', '/v1/players/{name}/profiles/{profile}/plan', { headers: h });
  assert.deepEqual(plan.body.steps.map(s => s.id), ['acc-1', 'dng'], 'шаги с нулевой важностью не отдаются');
  const one = await get(base, '/v1/players/Steve/profiles/Apple/plan?cat=dungeons&limit=5', '/v1/players/{name}/profiles/{profile}/plan', { headers: h });
  assert.deepEqual(one.body.steps.map(s => s.id), ['dng'], 'фильтр по разделу');
  assert.equal((await get(base, '/v1/players/Steve/profiles/Apple/plan?limit=1', '/v1/players/{name}/profiles/{profile}/plan', { headers: h })).body.steps.length, 1);
  await get(base, '/v1/players/Steve/profiles/Apple/money', '/v1/players/{name}/profiles/{profile}/money', { headers: h });

  // ошибки игрока
  const nop = await get(base, '/v1/players/Steve/profiles/Banana/summary', '/v1/players/{name}/profiles/{profile}/summary', { headers: h, status: 404 });
  assert.equal(nop.body.code, 'NO_PROFILE');
  assert.deepEqual(nop.body.profiles, ['Apple']);
  assert.equal((await get(base, '/v1/players/Secret/profiles', '/v1/players/{name}/profiles', { headers: h, status: 404 })).body.code, 'HIDDEN');
  assert.equal((await get(base, '/v1/players/Nobody/profiles', '/v1/players/{name}/profiles', { headers: h, status: 404 })).body.code, 'NOT_FOUND');
  assert.equal((await get(base, '/v1/players/bad-nick!/profiles', '/v1/players/{name}/profiles', { headers: h, status: 400 })).body.code, 'BAD_NAME');
  assert.equal((await get(base, '/v1/players/Limited/profiles/selected/plan', '/v1/players/{name}/profiles/{profile}/plan', { headers: h, status: 503 })).body.code, 'HYPIXEL_LIMIT');
  assert.equal((await get(base, '/v1/players/Loading/profiles/selected/plan', '/v1/players/{name}/profiles/{profile}/plan', { headers: h, status: 503 })).body.code, 'LOADING');
  const broken = await get(base, '/v1/players/Broken/profiles/selected/plan', '/v1/players/{name}/profiles/{profile}/plan', { headers: h, status: 503 });
  assert.equal(broken.body.code, 'HYPIXEL_UNAVAILABLE');
  assert.doesNotMatch(broken.body.error, /fetch/, 'внутренние ошибки наружу не идут');

  d.keys.revoke(k.id);
  const rv = await fetch(`${base}/v1/players/Steve/profiles`, { headers: h });
  assert.equal(rv.status, 403);
  assert.equal((await rv.json()).code, 'REVOKED');
}));

test('лимит ключа в минуту и лимит без ключа с одного адреса', () => withV1({ openPerMin: 3 }, async (base, d) => {
  for (let i = 0; i < 3; i++) assert.equal((await fetch(`${base}/v1/version`, { headers: { 'x-test-ip': '1.1.1.1' } })).status, 200);
  const r = await fetch(`${base}/v1/version`, { headers: { 'x-test-ip': '1.1.1.1' } });
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers.get('retry-after')) > 0);
  checkSchema('/v1/version', 429, await r.json());
  assert.equal((await fetch(`${base}/v1/version`, { headers: { 'x-test-ip': '2.2.2.2' } })).status, 200, 'у другого адреса свой лимит');
  // ключ: свой лимит, не зависит от адреса
  const { key } = d.keys.create({ name: 'Бот', players: true, perMin: 2 });
  const h = { 'X-API-Key': key, 'x-test-ip': '1.1.1.1' };
  assert.equal((await fetch(`${base}/v1/version`, { headers: h })).status, 200);
  assert.equal((await fetch(`${base}/v1/version`, { headers: h })).status, 200);
  assert.equal((await fetch(`${base}/v1/version`, { headers: h })).status, 429);
}));

// ---------- Готовые разборы для бота и мода ----------
test('недостающие аксессуары: по одному на линейку, цена, +MP и где взять', () => withV1({}, async (base, d) => {
  const T = '/v1/players/{name}/profiles/{profile}/accessories/missing';
  await get(base, '/v1/players/Steve/profiles/selected/accessories/missing', T, { status: 401 });
  const h = { 'X-API-Key': d.keys.create({ name: 'Бот Telegram', players: true }).key };
  const { body } = await get(base, '/v1/players/Steve/profiles/selected/accessories/missing', T, { headers: h });
  assert.deepEqual(body.items.map(r => r.id), ['FEATHER_RING', 'SPEED_ARTIFACT', 'BAT_TALISMAN'], 'старшая версия линейки, дешевле за 1 MP первыми, без цены — в конце');
  assert.equal(body.all, 3);
  assert.deepEqual(body.total, { count: 3, mp: 18, price: 59000, unpriced: 1 });
  assert.equal(body.items[1].upgradeFrom, 'Speed Talisman');
  const bat = body.items.find(r => r.id === 'BAT_TALISMAN');
  assert.deepEqual(bat.where, [{ text: 'Дроп с Bat в Spooky Festival', coins: null }, { text: 'Обмен на 64 Bits', coins: null }], 'Bits — не монеты');
  assert.equal(bat.howText, 'дроп');

  const cheap = await get(base, `${T.replace('{name}', 'Steve').replace('{profile}', 'Apple')}?sort=price&maxPrice=20000&upgrades=0`, T, { headers: h });
  assert.deepEqual(cheap.body.items.map(r => r.id), ['FEATHER_RING'], 'без апгрейдов своих и не дороже maxPrice');
  const byMp = await get(base, '/v1/players/Steve/profiles/Apple/accessories/missing?sort=mp&limit=1', T, { headers: h });
  assert.deepEqual(byMp.body.items.map(r => r.id), ['BAT_TALISMAN']);
  assert.equal((await get(base, '/v1/players/Steve/profiles/Apple/accessories/missing?sort=nope', T, { headers: h, status: 400 })).body.code, 'BAD_QUERY');
  assert.equal((await get(base, '/v1/players/Steve/profiles/Apple/accessories/missing?maxPrice=abc', T, { headers: h, status: 400 })).body.code, 'BAD_QUERY');
}));

test('аксессуары, networth и улучшения предмета по схемам описания', () => withV1({}, async (base, d) => {
  const h = { 'X-API-Key': d.keys.create({ name: 'Мод', players: true }).key };
  const acc = await get(base, '/v1/players/Steve/profiles/Apple/accessories', '/v1/players/{name}/profiles/{profile}/accessories', { headers: h });
  assert.equal(acc.body.magicalPower, 120);
  assert.deepEqual(acc.body.steps.map(s => [s.kind, s.perMp]), [['buy', 100], ['tier', 500], ['enrich', null]]);
  assert.equal(acc.body.owned[0].next, 'SPEED_RING');

  const nw = await get(base, '/v1/players/Steve/profiles/Apple/networth?limit=1', '/v1/players/{name}/profiles/{profile}/networth', { headers: h });
  assert.equal(nw.body.networth.total, 1e9, 'монеты — целые');
  assert.equal(nw.body.topItems[0].id, 'HYPERION');

  const T = '/v1/players/{name}/profiles/{profile}/items/{id}/upgrades';
  const up = await get(base, '/v1/players/Steve/profiles/Apple/items/HYPERION/upgrades', T, { headers: h });
  assert.equal(up.body.copies.length, 1);
  assert.deepEqual((await get(base, '/v1/players/Steve/profiles/Apple/items/DIRT/upgrades', T, { headers: h })).body.copies, []);
  await get(base, '/v1/players/Steve/profiles/Apple/items/bad%20id/upgrades', T, { headers: h, status: 400 });

  // профиль без разбора (Hypixel не отдал инвентарь) — 404 NO_DATA, а не пустой ответ
  const empty = { ...VIEW, analysis: { roadmap: [] } };
  d.players.view = async () => empty;
  assert.equal((await get(base, '/v1/players/Steve/profiles/Apple/accessories/missing', '/v1/players/{name}/profiles/{profile}/accessories/missing', { headers: h, status: 404 })).body.code, 'NO_DATA');
  assert.equal((await get(base, '/v1/players/Steve/profiles/Apple/networth', '/v1/players/{name}/profiles/{profile}/networth', { headers: h, status: 404 })).body.code, 'NO_DATA');
}));

test('свои лоты AH: только по ключу с данными игроков, по схеме описания', () => withV1({}, async (base, d) => {
  const T = '/v1/players/{name}/profiles/{profile}/auctions';
  await get(base, '/v1/players/Steve/profiles/Apple/auctions', T, { status: 401 });
  const h = { 'X-API-Key': d.keys.create({ name: 'Мод', players: true }).key };
  const { body } = await get(base, '/v1/players/Steve/profiles/Apple/auctions', T, { headers: h });
  assert.deepEqual(body.listings.map(l => l.status), ['sold', 'active']);
  assert.equal(body.bazaar, false);
  const other = { 'X-API-Key': d.keys.create({ name: 'Чужой бот' }).key };
  assert.equal((await get(base, '/v1/players/Steve/profiles/Apple/auctions', T, { headers: other, status: 403 })).body.code, 'NO_SCOPE');
}));

test('сравнение: до 4 игроков, ошибка одного не ломает ответ', () => withV1({}, async (base, d) => {
  await get(base, '/v1/compare?p=Steve', '/v1/compare', { status: 401 });
  const h = { 'X-API-Key': d.keys.create({ name: 'Бот', players: true }).key };
  const { body } = await get(base, '/v1/compare?p=Steve/Apple&p=Secret&p=Nobody&p=Steve/Banana', '/v1/compare', { headers: h });
  assert.equal(body.players[0].profile, 'Apple');
  assert.deepEqual(body.players.slice(1).map(p => p.code), ['HIDDEN', 'NOT_FOUND', 'NO_PROFILE']);
  assert.equal((await get(base, '/v1/compare', '/v1/compare', { headers: h, status: 400 })).body.code, 'BAD_QUERY');
  assert.equal((await get(base, '/v1/compare?p=a&p=b&p=c&p=d&p=e', '/v1/compare', { headers: h, status: 400 })).body.code, 'BAD_QUERY');
  assert.equal((await get(base, '/v1/compare?p=bad-nick!', '/v1/compare', { headers: h })).body.players[0].code, 'BAD_NAME');
}));

test('разделы сайта без ключа: календарь, лидерборды, гайды, цены, рынок, картинки', () => withV1({}, async (base, d) => {
  await get(base, '/v1/calendar?year=401', '/v1/calendar');
  const lb = await get(base, '/v1/leaderboard?board=skills&mode=ironman&limit=500', '/v1/leaderboard');
  assert.deepEqual(d.calls.find(c => c[0] === 'leaderboard')[1], { board: 'skills', mode: 'ironman', limit: 100, find: '' });
  assert.equal(lb.body.rows[0].name, 'Steve');
  await get(base, '/v1/guides', '/v1/guides');
  await get(base, '/v1/guides/dungeons', '/v1/guides/{id}');
  await get(base, '/v1/guides/nope', '/v1/guides/{id}', { status: 404 });
  await get(base, '/v1/guides/..%2Fx', '/v1/guides/{id}', { status: 404 });
  const qt = await get(base, '/v1/quotes?ids=HYPERION,NOPE,bad%20id', '/v1/quotes');
  assert.deepEqual(Object.keys(qt.body), ['HYPERION', 'NOPE'], 'неверные id отбрасываются');
  await get(base, '/v1/quotes', '/v1/quotes', { status: 400 });
  await get(base, '/v1/market/trend/HYPERION', '/v1/market/trend/{id}');
  await get(base, '/v1/market/trend/DIRT', '/v1/market/trend/{id}', { status: 404 });
  assert.equal((await get(base, '/v1/market/movers?period=d7', '/v1/market/movers')).body.up[0].period, 'd7');
  await get(base, '/v1/market/crops?fortune=99999', '/v1/market/crops');
  assert.deepEqual(d.calls.find(c => c[0] === 'crops')[1], { fortune: 5000, bps: undefined });
  const img = await fetch(`${base}/v1/items/HYPERION/image`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await img.arrayBuffer()).byteLength, 4);
  assert.equal((await fetch(`${base}/v1/items/DIRT/image`)).status, 404);
}));

test('разделы игрока по ключу: снаряжение, коллекции, Bits, гайды, история', () => withV1({}, async (base, d) => {
  const T = s => `/v1/players/{name}/profiles/{profile}/${s}`;
  await get(base, '/v1/players/Steve/profiles/Apple/gear', T('gear'), { status: 401 });
  const h = { 'X-API-Key': d.keys.create({ name: 'Бот', players: true }).key };
  for (const s of ['gear', 'progress', 'pets', 'map', 'collections', 'minions', 'museum', 'sacks', 'essence', 'maxwell', 'guides']) {
    const { body } = await get(base, `/v1/players/Steve/profiles/Apple/${s}`, T(s), { headers: h });
    assert.equal(body.player, 'Steve');
  }
  const bits = await get(base, '/v1/players/Steve/profiles/Apple/bits?bits=5000&fame=10', T('bits'), { headers: h });
  assert.deepEqual(bits.body.q, { bits: '5000', fame: '10' });
  assert.equal((await get(base, '/v1/players/Steve/profiles/Apple/bank', T('bank'), { headers: h, status: 404 })).body.code, 'NO_DATA');
  await get(base, '/v1/players/Steve/profiles/Apple/guides/dungeons', T('guides/{id}'), { headers: h });
  await get(base, '/v1/players/Steve/profiles/Apple/guides/nope', T('guides/{id}'), { headers: h, status: 404 });
  const hist = await get(base, '/v1/players/Steve/profiles/Apple/history?range=7d', T('history'), { headers: h });
  assert.equal(hist.body.range, '7d');
  assert.equal((await get(base, '/v1/players/Steve/profiles/Apple/history', T('history'), { headers: h })).body.range, 'all');
  assert.equal((await get(base, '/v1/players/Steve/profiles/Apple/history?range=2y', T('history'), { headers: h, status: 400 })).body.code, 'BAD_QUERY');
  assert.equal((await get(base, '/v1/players/Secret/profiles/Apple/museum', T('museum'), { headers: h, status: 404 })).body.code, 'HIDDEN');
}));

test('данные игроков — только ключам с отметкой players (собственные клиенты); условия в заголовках', () => withV1({}, async (base, d) => {
  const plain = d.keys.create({ name: 'Чужой бот' });
  const h = { 'X-API-Key': plain.key };
  for (const [url, tpl] of [['/v1/players/Steve/profiles', '/v1/players/{name}/profiles'], ['/v1/players/Steve/profiles/Apple/accessories/missing', '/v1/players/{name}/profiles/{profile}/accessories/missing'], ['/v1/compare?p=Steve', '/v1/compare']]) {
    assert.equal((await get(base, url, tpl, { headers: h, status: 403 })).body.code, 'NO_SCOPE');
  }
  assert.equal(d.calls.filter(c => c[0] === 'view').length, 0, 'без отметки профиль не запрашивается');
  const open = await get(base, '/v1/items/HYPERION', '/v1/items/{id}', { headers: h });
  assert.equal(open.r.headers.get('x-attribution'), 'Data: Sky Guide (https://sky-guide.ru)');
  assert.match(open.r.headers.get('link'), /api-terms.*terms-of-service/);
  d.keys.setPlayers(plain.id, true);
  await get(base, '/v1/players/Steve/profiles', '/v1/players/{name}/profiles', { headers: h });
  d.keys.setPlayers(plain.id, false);
  await get(base, '/v1/players/Steve/profiles', '/v1/players/{name}/profiles', { headers: h, status: 403 });
}));

// ---------- Swagger ----------
test('страница Swagger и описание открываются, файлы — свои, без CDN', () => withV1({}, async base => {
  const page = await fetch(`${base}/api/docs/`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.doesNotMatch(html, /https?:\/\//, 'никаких внешних адресов');
  assert.doesNotMatch(html, /<script>(?!<)/, 'без встроенных скриптов');
  for (const f of html.match(/\/api\/docs\/[\w.-]+/g)) assert.equal((await fetch(base + f)).status, 200, f);
  assert.equal((await fetch(`${base}/api/docs`, { redirect: 'manual' })).status, 301);
  const y = await fetch(`${base}/api/docs/openapi.yaml`);
  assert.match(y.headers.get('content-type'), /yaml/);
  assert.equal(YAML.parse(await y.text()).info.title, 'Sky Guide API');
  assert.equal((await fetch(`${base}/api/docs/package.json`)).status, 404, 'отдаём только файлы страницы');
}));
