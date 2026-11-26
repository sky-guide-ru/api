// Две живые цены «купить / продать», Dark Auction как способ получения, предметы с меняющимися статами
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeQuote } from '@sky-guide/core/market/quote.js';
import { darkAuctionOf } from '@sky-guide/core/analysis/dark-auction.js';
import { variableInfo, currentBonus } from '@sky-guide/core/lib/variable-stats.js';
import { accessoryFamily } from '../src/routes/item-upgrades.js';
import { buildObtainGuide } from '@sky-guide/core/analysis/obtain.js';

test('котировка Bazaar: купить — Instant Buy, продать — Instant Sell', () => {
  const q = makeQuote({ bazaar: { buy: 110, sell: 100, buyWeek: 5, sellWeek: 7 } });
  assert.equal(q.market, 'bazaar');
  assert.equal(q.buy, 110);
  assert.equal(q.sell, 100);
  assert.ok(q.sellNet < 100, 'после налога меньше');
});

test('котировка аукциона: продать — медиана продаж, без продаж — второй лот', () => {
  const sales = makeQuote({ bin: { price: 172e6, second: 175e6, count: 15 }, sold: { median: 170e6, count7d: 9, count24h: 2 } });
  assert.equal(sales.market, 'ah');
  assert.equal(sales.buy, 172e6);
  assert.equal(sales.sell, 170e6);
  assert.equal(sales.sellFrom, 'sales');
  assert.equal(sales.lots, 15);
  assert.ok(sales.sellNet < sales.sell);
  const lots = makeQuote({ bin: { price: 100, second: 120, count: 2 }, sold: null });
  assert.equal(lots.sell, 120);
  assert.equal(lots.sellFrom, 'lots');
  assert.equal(makeQuote({}), null, 'не торгуется — null');
  // медиана продаж с улучшенными копиями не выше самого дешёвого лота (Hyperion: 990 млн при BIN 525 млн)
  const hyp = makeQuote({ bin: { price: 525e6, count: 30 }, sold: { median: 990e6, count7d: 40 } });
  assert.equal(hyp.sell, 525e6);
  assert.equal(hyp.sellFrom, 'cap');
  // тренд приходит объектами { from, pct }
  const tr = makeQuote({ bazaar: { buy: 2, sell: 1 }, trend: { d1: { from: 1, pct: 2.5 }, d7: null } });
  assert.equal(tr.d1, 2.5);
  assert.equal(tr.d7, null);
});

test('Dark Auction: список с вики, книги и по Bazaar-ID', () => {
  assert.equal(darkAuctionOf('MAGIC_8_BALL').minBid, 20e6);
  assert.equal(darkAuctionOf('HEGEMONY_ARTIFACT').darker, true);
  assert.ok(darkAuctionOf('ENCHANTMENT_POWER_6'));
  assert.equal(darkAuctionOf('HYPERION'), null);
});

test('Dark Auction появляется в «Как получить» и сравнивается с аукционом', () => {
  const items = new Map([['MAGIC_8_BALL', { id: 'MAGIC_8_BALL', name: '§5Magic 8 Ball', lore: [], info: [] }]]);
  const g = buildObtainGuide('MAGIC_8_BALL', { items, constants: {}, buy: () => ({ price: 172e6, count: 15, market: 'ah', sell: 170e6, sellNet: 165e6, sellFrom: 'sales' }) });
  const da = g.methods.find(m => m.kind === 'dark-auction');
  assert.ok(da);
  assert.equal(da.minBid, 20e6);
  const ah = g.methods.find(m => m.kind === 'market');
  assert.equal(ah.quote.sell, 170e6);
  assert.ok(ah.steps.some(s => /Продать/.test(s.text)));
});

test('Magic 8 Ball: описание по вики и текущий бонус из лора', () => {
  const v = variableInfo('MAGIC_8_BALL');
  assert.equal(v.kind, 'season');
  assert.match(v.text, /один бонус из пяти/);
  assert.doesNotMatch(v.text, /\+50/);
  const lore = ['§7Accessory Power: §6+16', '', '§7✧ It is certain.', '§a✦ My sources say no.', '§7+25❁ Strength', '§7+1☯ Combat Wisdom'];
  assert.deepEqual(currentBonus('MAGIC_8_BALL', lore), { answer: 'My sources say no.', stats: '+25 Strength, +1 Combat Wisdom' });
  assert.equal(currentBonus('HYPERION', lore), null);
  assert.equal(variableInfo('HYPERION'), null);
});

test('линейка аксессуара: старшая версия в сумке перекрывает младшую', () => {
  const raw = { ENDER_ARTIFACT: ['ENDER_RELIC'] };
  const f = accessoryFamily('ENDER_ARTIFACT', ['ENDER_ARTIFACT', 'ENDER_RELIC'], raw);
  assert.equal(f.active, false);
  assert.equal(f.coveredBy, 'ENDER_RELIC');
  const top = accessoryFamily('ENDER_RELIC', ['ENDER_ARTIFACT', 'ENDER_RELIC'], raw);
  assert.equal(top.active, true);
  assert.deepEqual(top.duplicates, ['ENDER_ARTIFACT']);
  assert.equal(accessoryFamily('X', [], raw), null);
});

test('свойства предмета: продажа NPC, обмен, аукцион, музей и строка «откуда» от Hypixel', async () => {
  const { setItemsResource, itemProps, obtainmentOf } = await import('@sky-guide/core/lib/item-props.js');
  setItemsResource([
    { id: 'MAGIC_8_BALL', obtainment: 'Purchased at the {zone:dark_auction}.' },
    { id: 'HYPERION', npc_sell_price: 0, museum_data: { category: 'WEAPONS' } },
    { id: 'ARACHNE_BELT', soulbound: 'COOP', npc_sell_price: 10 },
    { id: 'ENCHANTED_DIAMOND', npc_sell_price: 1280 },
    { id: 'ATMOSPHERIC_FILTER', obtainment: 'Dropped rarely from %%dark_green%%Mites%%gray%% in {zone:garden}.' },
    { id: 'NIGHT_CRYSTAL', obtainment: 'Crafted after unlocking {recipe_unlock:NIGHT_CRYSTAL}.' },
  ]);
  assert.ok(!/%%/.test(obtainmentOf('ATMOSPHERIC_FILTER')), 'цветовые коды убраны');
  assert.equal(obtainmentOf('NIGHT_CRYSTAL'), null, 'строку про рецепт не показываем');
  assert.deepEqual(itemProps('MAGIC_8_BALL'), { salable: false, npc: 0, tradeable: true, soulbound: null, auctionable: true, bazaar: false, museum: false });
  assert.equal(itemProps('HYPERION').museum, true);
  const belt = itemProps('ARACHNE_BELT');
  assert.equal(belt.tradeable, false);
  assert.equal(belt.auctionable, false);
  assert.equal(itemProps('ENCHANTED_DIAMOND', { bazaar: true }).auctionable, false, 'товар Bazaar на аукцион не выставить');
  assert.equal(obtainmentOf('MAGIC_8_BALL'), 'Purchased at the Dark Auction.');
  assert.equal(itemProps('NOPE'), null);
});
