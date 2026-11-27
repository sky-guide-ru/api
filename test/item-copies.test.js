// Свои экземпляры предмета в карточке: можно ли продать именно этот (Museum, Soulbound)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemUpgradeCopies } from '../src/routes/item-upgrades.js';

const deps = {
  neu: { constants: { misc: {} }, items: new Map([['THEORETICAL_HOE_SUNFLOWER_3', { name: 'Eclipse Sickle Mk. III', rarity: 'EPIC', lore: [] }]]) },
  priceOf: () => 0, translateLoreLine: l => l,
};

test('экземпляр из Museum (одолжен обратно) и Soulbound продать нельзя, обычный — можно', () => {
  const it = { id: 'THEORETICAL_HOE_SUNFLOWER_3', name: 'Blessed Eclipse Sickle Mk. III', rarity: 'LEGENDARY', lore: [] };
  const member = { inv: { backpacks: { 4: [{ ...it, uuid: 'a', museum: true }], 0: [{ ...it, uuid: 'b' }, { ...it, uuid: 'c', lore: ['§8§l* §8Co-op Soulbound §8§l*'] }] } } };
  const by = Object.fromEntries(itemUpgradeCopies(member, it.id, deps).map(c => [c.uuid, c]));
  assert.equal(by.a.museum, true);
  assert.equal(by.a.sellable, false);
  assert.equal(by.b.sellable, true);
  assert.equal(by.c.sellable, false);
});
