import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLeaderboard, entryFromView, createActionLimiter, createHiddenFilter } from '../src/leaderboard.js';

const view = (name, uuid, o = {}) => ({
  player: { name, uuid },
  updatedAt: 1000,
  member: {
    uuid, profileId: o.profileId || `p-${uuid}`, profileName: o.profile || 'Apple', gameMode: o.mode || 'normal',
    sbLevel: o.level ?? 100, skillAverage: o.skills ?? 30, coopRoster: o.roster || [{ uuid }],
    dungeons: { catacombs: { level: o.cata ?? 20, xp: o.cataXp ?? 100000 }, selectedClass: 'mage' },
    slayers: { zombie: { level: 5, xp: o.slayer ?? 10000 }, wolf: { level: 3, xp: 1000 } },
    inv: o.apiOff ? { apiDisabled: true } : {},
  },
  analysis: { gear: { networth: { total: o.nw ?? 1e6 } } },
});

const hiddenNames = new Set(['owner', 'friend']);
const make = (extra = {}) => createLeaderboard({ isExcluded: ({ uuid, name }) => hiddenNames.has(name.toLowerCase()) || uuid === 'owneruuid', ...extra });

test('сводка профиля: числа для таблиц, без открытого API инвентаря — без богатства', () => {
  const e = entryFromView(view('Steve', 'aaa', { nw: 5e6 }));
  assert.equal(e.nw, 5000000);
  assert.equal(e.slayerXp, 11000);
  assert.equal(e.cata, 20);
  assert.equal(entryFromView(view('Steve', 'aaa', { apiOff: true })).nw, null);
});

test('рейтинг богатства: по убыванию, по одной строке на игрока (лучший профиль)', () => {
  const b = make();
  b.record(view('Steve', 'aaa', { nw: 5e6, profileId: 'x1' }));
  b.record(view('Steve', 'aaa', { nw: 9e6, profileId: 'x2', profile: 'Banana' }));
  b.record(view('Alex', 'bbb', { nw: 7e6 }));
  const r = b.top('networth');
  assert.deepEqual(r.rows.map(x => [x.place, x.name, x.value, x.profile]), [[1, 'Steve', 9e6, 'Banana'], [2, 'Alex', 7e6, 'Apple']]);
  assert.equal(b.top('networth', { find: 'alex' }).me.place, 2);
});

test('владелец, друзья и их кооп-острова в рейтинг не попадают', () => {
  const b = make();
  assert.equal(b.record(view('Owner', 'owneruuid', { nw: 1e12 })), false);
  assert.equal(b.record(view('Friend', 'fff', { nw: 1e11 })), false);
  // Чужой игрок на одном острове с владельцем тоже скрыт — по нему видно владельца
  assert.equal(b.record(view('Mate', 'mmm', { nw: 1e10, roster: [{ uuid: 'mmm' }, { uuid: 'owneruuid' }] })), false);
  b.record(view('Steve', 'aaa'));
  assert.deepEqual(b.top('networth').rows.map(x => x.name), ['Steve']);
  // Игроку завели аккаунт на сайте позже — пропадает из выдачи сразу
  hiddenNames.add('steve');
  assert.equal(b.top('networth').rows.length, 0);
  hiddenNames.delete('steve');
});

test('игрок убирает себя: запись удаляется и больше не возвращается, владелец может вернуть', () => {
  const b = make();
  b.record(view('Steve', 'aaa'));
  assert.equal(b.remove({ name: 'steve', uuid: 'aaa' }), 1);
  assert.equal(b.record(view('Steve', 'aaa')), false);
  // сменил ник — отказ держится по uuid
  assert.equal(b.record(view('Steve2', 'aaa')), false);
  assert.equal(b.restore({ name: 'steve' }), true);
  assert.equal(b.record(view('Steve2', 'aaa')), true);
});

test('режим и другие таблицы', () => {
  const b = make();
  b.record(view('Iron', 'iii', { mode: 'ironman', level: 300 }));
  b.record(view('Norm', 'nnn', { level: 200 }));
  assert.deepEqual(b.top('level', { mode: 'ironman' }).rows.map(x => x.name), ['Iron']);
  assert.deepEqual(b.top('level').rows.map(x => x.name), ['Iron', 'Norm']);
  assert.equal(b.top('nope').board, 'networth');
});

test('хранится в файле вместе со списком отказов; старые записи уходят', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-'));
  const file = path.join(dir, 'leaderboard.json');
  let now = 0;
  const b = make({ file, clock: () => now, saveDelayMs: 1 });
  b.record(view('Steve', 'aaa'));
  b.remove({ name: 'alex' });
  b.flush();
  const b2 = make({ file, clock: () => now });
  assert.equal(b2.size(), 1);
  assert.equal(b2.isOptedOut({ name: 'Alex' }), true);
  now = 61 * 24 * 3600_000;
  b2.record(view('Bob', 'bbb'));
  assert.deepEqual(b2.top('networth').rows.map(x => x.name), ['Bob']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('лимит на кнопку «убрать меня»', () => {
  const allow = createActionLimiter({ max: 2, windowMs: 1000, clock: () => 0 });
  assert.equal(allow('ip'), true);
  assert.equal(allow('ip'), true);
  assert.equal(allow('ip'), false);
  assert.equal(allow('other'), true);
});

test('записи старше срока не показываются, даже если новых профилей давно не было', () => {
  let now = 10_000;
  const b = make({ clock: () => now, maxAgeMs: 1000 });
  b.record(view('Steve', 'aaa'));
  assert.equal(b.top('networth').rows.length, 1);
  now += 5000; // никто ничего не открывал — prune не запускался
  assert.equal(b.top('networth').rows.length, 0);
});

test('отказ только по нику привязывается к uuid при первом появлении профиля и переживает смену ника', () => {
  const b = make();
  b.remove({ name: 'steve' });
  assert.equal(b.record(view('Steve', 'aaa')), false);
  assert.equal(b.record(view('Steve2', 'aaa')), false); // сменил ник — всё равно скрыт
});

test('фильтр рейтинга: скрыты только игроки из HIDDEN_PLAYERS (и их кооп-острова), остальные — как все', async () => {
  const names = new Set(['hidden']);
  const f = createHiddenFilter({ names: () => names, resolveUuid: async n => (n === 'hidden' ? { uuid: 'hid-uuid' } : null) });
  const b = createLeaderboard({ isExcluded: f.isExcluded });
  // пока uuid скрытых не известны, соседа без ника не пускаем
  assert.equal(b.record(view('Steve', 'aaa', { roster: [{ uuid: 'aaa' }, { uuid: 'zzz' }] })), false);
  assert.equal(await f.resolve(), true);
  assert.equal(b.record(view('Steve', 'aaa', { roster: [{ uuid: 'aaa' }, { uuid: 'zzz' }] })), true);
  assert.equal(b.record(view('Hidden', 'hiduuid')), false);
  assert.equal(b.record(view('Mate', 'mmm', { roster: [{ uuid: 'mmm' }, { uuid: 'hiduuid' }] })), false);
  // владелец сайта и друзья — обычные строки, без особых полей
  assert.equal(b.record(view('SiteOwner', 'own', { nw: 9e9 })), true);
  const row = b.top('networth').rows[0];
  assert.equal(row.name, 'SiteOwner');
  assert.deepEqual(Object.keys(row).filter(k => /owner|friend|self|^me$|mine|you/i.test(k)), []);
});

test('фильтр рейтинга без скрытых игроков пускает всех сразу', () => {
  const f = createHiddenFilter({ names: () => new Set(), resolveUuid: async () => null });
  assert.equal(f.isExcluded({ uuid: 'x', name: '' }), false);
  assert.equal(f.isExcluded({ uuid: 'x', name: 'Steve' }), false);
});

test('убрать ник из рейтинга может только владелец; гость получает отказ и подсказку про запрос', async () => {
  const { mountLeaderboardRoutes } = await import('../src/leaderboard.js');
  const express = (await import('express')).default;
  const b = make();
  b.record(view('Steve', 'aaa'));
  let admin = false;
  const app = express();
  mountLeaderboardRoutes(app, { board: b, express, isAdmin: () => admin });
  const srv = app.listen(0);
  const url = `http://127.0.0.1:${srv.address().port}`;
  const post = p => fetch(`${url}/api/leaderboard/remove`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ player: p }) });
  try {
    const g = await post('Steve');
    assert.equal(g.status, 403);
    assert.match((await g.json()).error, /Убрать ник/);
    assert.equal(b.top('networth').rows.length, 1, 'гость ничего не убрал');
    assert.equal((await fetch(`${url}/api/admin/leaderboard/removed`)).status, 403);
    admin = true;
    const r = await post('Steve');
    assert.deepEqual(await r.json(), { ok: true, removed: 1 });
    assert.equal(b.top('networth').rows.length, 0);
    assert.deepEqual((await (await fetch(`${url}/api/admin/leaderboard/removed`)).json()).items, [{ uuid: 'aaa', name: 'steve' }]);
  } finally { srv.close(); }
});
