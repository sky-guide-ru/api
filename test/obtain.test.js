import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildObtainGuide, costTree, nearestWarp, mobContext, reqRu, wikiLinks } from '@sky-guide/core/analysis/obtain.js';
import { makeBuy } from '../src/routes/obtain.js';

const items = new Map(Object.entries({
  ADVENTURER_NPC: { id: 'ADVENTURER_NPC', name: 'Combat Merchant (NPC)', island: 'hub', x: -50, y: 69, z: -67, recipes: [
    { type: 'npc_shop', cost: ['SKYBLOCK_COIN:500.0'], result: 'ZOMBIE_TALISMAN:1' },
    { type: 'npc_shop', cost: ['SKYBLOCK_COIN:10.0'], result: 'STRING:1' },
  ] },
  ZOMBIE_TALISMAN: { id: 'ZOMBIE_TALISMAN', name: 'Zombie Talisman', info: ['https://hypixelskyblock.minecraft.wiki/w/Zombie_Talisman'], recipes: [] },
  STRING: { id: 'STRING', name: 'String', recipes: [] },
  ENCHANTED_STRING: { id: 'ENCHANTED_STRING', name: 'Enchanted String', recipe: { A1: 'STRING:32', A2: 'STRING:32', A3: 'STRING:32', B1: 'STRING:32', B2: 'STRING:32' }, crafttext: 'Requires: String I', recipes: [] },
  GRAPPLING_HOOK: { id: 'GRAPPLING_HOOK', name: 'Grappling Hook', recipe: { A3: 'ENCHANTED_STRING:1', B2: 'ENCHANTED_STRING:1', B3: 'STICK:1', C1: 'ENCHANTED_STRING:1', C3: 'STICK:1' }, crafttext: 'Requires: String IV', info: [], recipes: [] },
  STICK: { id: 'STICK', name: 'Stick', recipes: [] },
  SADAN_BOSS: { id: 'SADAN_BOSS', name: 'Sadan (BOSS)', recipes: [
    { type: 'drops', name: '§cSadan', panorama: 'dungeon', drops: [{ id: 'SUMMONING_RING', chance: '0.375%' }] },
    { type: 'drops', name: '§cSadan (Master Mode)', panorama: 'dungeon', drops: [{ id: 'SUMMONING_RING', chance: '0.369%' }] },
  ] },
  SUMMONING_RING: { id: 'SUMMONING_RING', name: 'Summoning Ring', recipes: [] },
  REVENANT_HORROR_4_BOSS: { id: 'REVENANT_HORROR_4_BOSS', name: 'Revenant Horror IV', recipes: [
    { type: 'drops', name: 'Revenant Horror IV', panorama: 'hub', level: 0, drops: [{ id: 'SCYTHE_BLADE', chance: '0.07%' }] },
  ] },
  SCYTHE_BLADE: { id: 'SCYTHE_BLADE', name: 'Scythe Blade', recipes: [] },
}));
const constants = { islands: { area_names: { hub: 'Hub' }, island_warps: [{ warp: 'stonks', mode: 'hub', x: -52, y: 70, z: -49 }, { warp: 'castle', mode: 'hub', x: -250, y: 130, z: 45 }] } };
const P = { STRING: { price: 6, market: 'bazaar' }, ENCHANTED_STRING: { price: 1100, market: 'bazaar' }, STICK: { price: 5, market: 'bazaar' } };
const ctx = (extra = {}) => ({ items, constants, buy: id => P[id] || null, ...extra });

test('NPC: остров, телепорт, координаты и цена', () => {
  const g = buildObtainGuide('ZOMBIE_TALISMAN', ctx());
  const m = g.methods.find(x => x.kind === 'npc');
  assert.equal(m.title, 'Купить у NPC Combat Merchant');
  assert.equal(m.total, 500);
  const text = m.steps.map(s => s.text).join(' ');
  assert.match(text, /Hub/);
  assert.match(text, /\/warp stonks/);
  assert.match(text, /X -50, Y 69, Z -67/);
  assert.match(text, /500 монет/);
  assert.equal(g.wiki.page, 'https://hypixelskyblock.minecraft.wiki/w/Zombie_Talisman');
  assert.equal(g.cheapest.kind, 'npc');
});

test('крафт: требование, дерево ингредиентов и где взять каждый', () => {
  const g = buildObtainGuide('GRAPPLING_HOOK', ctx());
  const m = g.methods.find(x => x.kind === 'craft');
  assert.equal(m.req.text, 'коллекция String IV');
  const tree = m.steps.find(s => s.tree).tree;
  const es = tree.find(n => n.id === 'ENCHANTED_STRING');
  assert.equal(es.count, 3);
  // 160 String по 6 (960) дешевле 1100 на Bazaar → крафт, с поддеревом
  assert.equal(es.via, 'craft');
  assert.equal(es.children[0].id, 'STRING');
  assert.equal(es.children[0].count, 480);
  assert.equal(es.alt.via, 'bazaar');
  assert.equal(m.total, 3 * 960 + 2 * 5);
  assert.ok(m.grid);
});

test('требование проверяется по профилю игрока', () => {
  const member = { unlockedCollTiers: ['STRING_3'], collections: { STRING: 4000 } };
  const collections = new Map([['string', { id: 'STRING', tiers: [50, 100, 250, 1000, 2500] }]]);
  const m = buildObtainGuide('GRAPPLING_HOOK', ctx({ member, collections })).methods.find(x => x.kind === 'craft');
  assert.equal(m.req.ok, false);
  assert.match(m.req.have, /String III \(4\s000 из 1\s000 шт\.\)/);
  const m2 = buildObtainGuide('GRAPPLING_HOOK', ctx({ member: { ...member, unlockedCollTiers: ['STRING_5'] }, collections })).methods.find(x => x.kind === 'craft');
  assert.equal(m2.req.ok, true);
});

test('дроп с босса данжа: этаж, Master Mode, ожидаемое число ранов', () => {
  const g = buildObtainGuide('SUMMONING_RING', ctx({ member: { dungeons: { catacombs: { level: 30 }, floors: { 5: 3, 6: 1, 7: 2 }, masterFloors: { 5: 1 } } } }));
  const [f6, m6] = g.methods.filter(m => m.kind === 'drop');
  assert.match(f6.steps[0].text, /F6/);
  assert.match(f6.steps.map(s => s.text).join(' '), /~267 ранов/);
  assert.equal(f6.steps.find(s => s.req).req.ok, true);
  assert.match(m6.steps[0].text, /M6/);
  const req = m6.steps.find(s => s.req).req;
  assert.equal(req.ok, false); // Catacombs 30 < 34
  assert.equal(f6.guide, 'dungeons');
});

test('дроп со слеер-босса: квест, цена, ссылка на гайд', () => {
  const g = buildObtainGuide('SCYTHE_BLADE', ctx());
  const m = g.methods[0];
  assert.equal(m.kind, 'drop');
  assert.match(m.steps[0].text, /Maddox the Slayer/);
  assert.match(m.steps[0].text, /50 тыс\. монет/);
  assert.equal(m.guide, 'slayer-zombie');
  assert.match(m.steps.map(s => s.text).join(' '), /Magic Find/);
});

test('мелочи: варп, требования, вики-поиск, цены рынка', () => {
  assert.equal(nearestWarp('hub', -50, -67, constants).warp, 'stonks');
  assert.equal(nearestWarp('hub', 0, -72, constants).warp, 'hub');
  assert.equal(reqRu('Requires: Zombie Slayer 7 & HotM 5'), 'Zombie Slayer 7 и Heart of the Mountain 5');
  assert.match(mobContext('LIVID_BOSS', 'Livid (Master Mode)').how, /M5/);
  assert.equal(wikiLinks(null, 'Aspect of the End').search, 'https://hypixelskyblock.minecraft.wiki/index.php?search=Aspect%20of%20the%20End');
  const buy = makeBuy({ bazaar: new Map([['ENCHANTMENT_SHARPNESS_6', { buy: 100, sell: 90 }]]), bin: new Map([['HYPERION', { price: 1e9, count: 3 }]]) });
  assert.deepEqual(buy('SHARPNESS;6'), { price: 100, order: 90, market: 'bazaar', sell: 90, sellNet: 89 });
  assert.equal(buy('HYPERION').market, 'ah');
  // без продаж цена продажи на аукционе — второй лот
  const ah = makeBuy({ bazaar: new Map(), bin: new Map([['X', { price: 100, second: 120, count: 2 }]]) })('X');
  assert.equal(ah.sell, 120);
  assert.equal(ah.sellFrom, 'lots');
  assert.equal(costTree('NOPE', 1, ctx()).via, 'none');
});

test('без известного количества дропа оценку «в среднем даёт» не выдумываем', () => {
  const g = buildObtainGuide('SCYTHE_BLADE', ctx());
  const m = g.methods.find(x => x.kind === 'drop');
  if (m.amount) return; // количество известно из вики — тогда оценка законна
  assert.equal(m.perRun, null);
  assert.doesNotMatch(m.steps.map(s => s.text).join(' '), /В среднем/);
});
