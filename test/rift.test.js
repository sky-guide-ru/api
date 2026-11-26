import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOULS, AREAS, TIMECHARMS, EYES, CATS } from '@sky-guide/core/rift/data.js';
import { analyzeRift, soulStatus, eyeStatus, visitedAreas } from '@sky-guide/core/rift/index.js';
import rift from '@sky-guide/core/guides/rift.js';
import { ownercatMember } from '@sky-guide/core/test/fixtures/ownercat.js';

// Реальные данные Рифта профиля Zucchini (2026-11-23), без инвентаря
const ZUCCHINI = {
  motes: 72617, enigmaSouls: 18, boughtCloak: true,
  foundSouls: ['RIFT_1', 'WOODS_WATER_SOUL', 'FROG_JUMP_PAD', 'PIECE_TREE', 'WOODS_FLOWER_POT', 'SOUL_IN_A_BOX', 'WOODS_PHANTOM', 'BETWEEN_BRANCHES', 'BARK_TREE', 'TELKAR', 'ROCKS_GAME_SOUL', 'LAGOON_PARKOUR', 'LAGOON_SHOP_SOUL', 'LONG_SHROOM', 'RIFT_CAKE_2', 'RIFT_CAKE', 'DOLPHIN_PARKOUR', 'TREE_LAUNCH'],
  trophies: ['wyldly_supreme', 'mirrored'], eliseStep: 5,
  eyes: ['wizard_tower', 'fisherman_hut', 'dreadfarm'],
  cats: ['first', 'third', 'second', 'fourth'], catDetector: true,
  montezuma: { type: 'FRACTURED_MONTEZUMA_SOUL', exp: 12626665, active: true, tier: 'RARE' },
  boundaries: ['black_lagoon', 'mirrorverse', 'west_village'],
  areasSeen: ['black_lagoon', 'wizard_tower', 'west_village', 'wyld_woods', 'dreadfarm'],
};
const member = () => ({ ...ownercatMember(), rift: { ...ZUCCHINI }, riftPrism: false });

test('справочник: 52 души, у каждой зона, координаты и русская подсказка; коды не повторяются', () => {
  assert.equal(SOULS.length, 52);
  const areas = new Set(AREAS.map(a => a.id));
  const codes = new Set();
  for (const s of SOULS) {
    assert.ok(areas.has(s.area), s.id);
    assert.match(s.pos, /^-?\d+:-?\d+:-?\d+$/, s.id);
    assert.match(s.hint, /[а-яё]/i, s.id);
    for (const c of s.api) { assert.ok(!codes.has(c), `дубль кода ${c}`); codes.add(c); }
  }
  assert.equal(TIMECHARMS.length, 8);
  assert.equal(EYES.length, 7);
  assert.equal(CATS.length, 9);
});

test('души Zucchini: 15 подтверждено, 3 неоднозначных кода → кандидаты «возможно» только в посещённых зонах', () => {
  const s = soulStatus(ZUCCHINI);
  assert.equal(s.found, 18);
  assert.equal(s.confirmed, 15);
  assert.equal(s.unexplained, 3);
  const maybe = s.list.filter(x => x.status === 'maybe');
  assert.ok(maybe.length >= 3);
  assert.ok(maybe.every(x => ['wyld_woods', 'west_village', 'dreadfarm'].includes(x.area)));
  assert.ok(s.list.filter(x => x.area === 'black_lagoon').every(x => x.status === 'found'));
  assert.ok(s.list.filter(x => x.area === 'mountaintop').every(x => x.status === 'missing'));
});

test('ручные отметки уточняют неоднозначные души', () => {
  const s = soulStatus(ZUCCHINI, { enigma_two_plates: true, enigma_wither_cage: true, hot_dog: true });
  assert.equal(s.unexplained, 0);
  assert.equal(s.list.filter(x => x.status === 'maybe').length, 0);
  assert.equal(s.list.filter(x => x.status === 'found').length, 18);
  const s2 = soulStatus(ZUCCHINI, { kat_soul: false });
  assert.equal(s2.list.find(x => x.id === 'kat_soul').status, 'missing');
});

test('глаза Porhtal, зоны и таймчармы читаются из профиля', () => {
  assert.deepEqual(eyeStatus(ZUCCHINI).filter(e => e.done).map(e => e.name), ['The Intruder', 'The Gillman', 'The Baba Yaga']);
  const v = visitedAreas(ZUCCHINI);
  assert.ok(v.has('west_village') && v.has('dreadfarm') && !v.has('village_plaza') && !v.has('stillgore_chateau'));
  const r = analyzeRift(member());
  assert.deepEqual(r.charms.filter(c => c.secured).map(c => c.type), ['wyldly_supreme', 'mirrored']);
  assert.equal(r.cats.filter(c => c.done).length, 4);
  assert.equal(r.riftTimeFromSouls, 360);
  // Призма стоит на аукционе больше миллиарда: советуем употребить, только если она уже у игрока
  assert.ok(!r.next.some(n => /Rift Prism/.test(n.title)), 'призмы нет — не советуем');
  const withPrism = member();
  withPrism.inv = { ...withPrism.inv, inventory: [...(withPrism.inv?.inventory || []), { id: 'RIFT_PRISM' }] };
  assert.ok(analyzeRift(withPrism).next.some(n => /Rift Prism/.test(n.title)), 'призма в инвентаре — употребить');
  assert.ok(r.next.some(n => /Village Plaza/.test(n.title)), 'следующая зона');
});

test('гайд Рифта собирается, на русском, без мусора', () => {
  const g = rift.build(member());
  assert.match(g.summary, /18\/52/);
  assert.equal(g.level.value, 18);
  assert.ok(g.next.length >= 3);
  for (let i = 1; i < g.next.length; i++) assert.ok(g.next[i - 1].priority >= g.next[i].priority);
  const text = JSON.stringify(g);
  assert.doesNotMatch(text, /undefined|NaN|\[object/);
  assert.match(text, /Enigma Souls/);
  const table = g.sections.find(s => s.kind === 'table' && s.title.startsWith('Недостающие'));
  assert.equal(table.rows.length, 52 - 15);
  for (const row of table.rows) assert.equal(row.length, table.columns.length);
});

test('пустой профиль без данных Рифта не ломает гайд', () => {
  const g = rift.build({ ...ownercatMember(), rift: { motes: 0, enigmaSouls: 0 } });
  assert.equal(g.status, 'start');
  assert.ok(g.next.some(n => /Enigma Cloak/.test(n.title)));
});

test('отметки душ: друг, открывший чужой профиль, не может их менять', async () => {
  const { default: express } = await import('express');
  const { mountRiftRoutes } = await import('../src/mount/rift-marks.js');
  const { config } = await import('@sky-guide/core/config.js');
  const os = await import('node:os'), fs = await import('node:fs'), path = await import('node:path');
  const realDir = config.dataDir;
  config.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-rift-')); // настоящие отметки в data/ не трогаем
  const app = express();
  let self = false;
  mountRiftRoutes(app, { getUuid: async () => 'f'.repeat(32), canWrite: async () => self });
  const srv = app.listen(0); await new Promise(r => srv.once('listening', r));
  const post = () => fetch(`http://127.0.0.1:${srv.address().port}/api/rift/marks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: SOULS[0].id, value: true }) });
  try {
    const r = await post();
    assert.equal(r.status, 403);
    assert.match((await r.json()).error, /своём профиле/);
    self = true;
    const ok = await post();
    assert.equal(ok.status, 200);
    assert.equal((await ok.json())[SOULS[0].id], true);
  } finally { srv.close(); config.dataDir = realDir; }
});
