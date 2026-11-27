// «План добычи» вместо «Плана покупок» у профилей без рынка (Ironman, Stranded, Bingo)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { config } from '@sky-guide/core/config.js';
import { _resetCart } from '@sky-guide/core/roadmap/cart.js';
import { mountCartRoutes } from '../src/mount/roadmap-cart.js';

config.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-farm-'));
_resetCart();

const ITEMS = new Map([
  ['ADVENTURER_NPC', { id: 'ADVENTURER_NPC', name: 'Adventurer (NPC)', island: 'hub', x: 1, y: 70, z: 2, recipes: [{ type: 'npc_shop', cost: ['SKYBLOCK_COIN:500'], result: 'ZOMBIE_TALISMAN' }] }],
  ['ZOMBIE_TALISMAN', { id: 'ZOMBIE_TALISMAN', name: 'Zombie Talisman', recipes: [] }],
]);
const view = gameMode => ({
  self: true,
  member: { uuid: 'u', profileId: 'p', gameMode, inv: { inventory: [] }, pets: [] },
  analysis: { plan: [{ stepId: 'mp-cheap', title: 'Докупи', cost: 1000, cumulative: 1000 }], roadmap: [{ id: 'mp-cheap', title: 'Добудь', items: ['ZOMBIE_TALISMAN'] }], summary: { liquid: 0 } },
});

async function get(gameMode) {
  const app = express();
  mountCartRoutes(app, { getView: async () => view(gameMode), price: () => 0, name: id => ITEMS.get(id)?.name || id, items: () => ITEMS, constants: () => ({}) });
  const srv = app.listen(0);
  try { return await fetch(`http://127.0.0.1:${srv.address().port}/api/roadmap/cart`).then(r => r.json()); } finally { srv.close(); }
}

test('Ironman получает план добычи, обычный профиль — план покупок', async () => {
  const iron = await get('ironman');
  assert.equal(iron.farm, true);
  assert.equal(iron.rows[0].id, 'ZOMBIE_TALISMAN');
  assert.equal(iron.rows[0].source.kind, 'npc');
  assert.equal(iron.rows[0].source.coins, 500);
  const normal = await get('normal');
  assert.equal(normal.farm, undefined);
  assert.equal(normal.rows[0].stepId, 'mp-cheap');
});
