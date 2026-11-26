import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadLevel, createStatus, containerMemory, diskInfo } from '../src/status.js';

test('loadLevel: спокойно, занят, перегружен', () => {
  assert.equal(loadLevel({}).level, 'low');
  assert.equal(loadLevel({ lagMs: 80 }).level, 'medium');
  assert.equal(loadLevel({ keyed5m: 200 }).level, 'medium');
  assert.match(loadLevel({ keyed5m: 200 }).why, /Hypixel/);
  assert.equal(loadLevel({ keyed5m: 280 }).level, 'high');
  assert.equal(loadLevel({ inFlight: 40 }).level, 'high');
  assert.equal(loadLevel({ lagMs: 500 }).level, 'high');
});

test('createStatus: считает запросы к /api и читает журнал обновлений', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-status-'));
  fs.writeFileSync(path.join(dir, 'deploy-log.json'), JSON.stringify({ events: [{ kind: 'rollback', why: 'сборка не удалась', at: 1 }] }));
  const s = createStatus({ dataDir: dir, keyedCallsRecent: () => 42, state: { status: 'ok' }, buildId: () => 'abc' });
  try {
    const handlers = {};
    const res = { on: (e, f) => { handlers[e] = f; } };
    let nexts = 0;
    s.track({ path: '/api/profile' }, res, () => nexts++);
    s.track({ path: '/style.css' }, { on() {} }, () => nexts++);
    assert.equal(nexts, 2);
    let a = s.adminStatus();
    assert.equal(a.requests.inFlight, 1);
    assert.equal(a.requests.perMinute, 1);
    assert.equal(a.hypixel.used5m, 42);
    assert.equal(a.build, 'abc');
    assert.equal(a.deploy.last.kind, 'rollback');
    handlers.finish(); handlers.close(); // закрытие после finish не уводит счётчик в минус
    a = s.adminStatus();
    assert.equal(a.requests.inFlight, 0);
    const p = s.publicStatus();
    assert.deepEqual(Object.keys(p).sort(), ['at', 'hypixel', 'load', 'ok', 'why']); // игрокам — без подробностей (только флаги для баннера)
  } finally { s.stop(); }
});

test('publicStatus: пауза ключа и нерабочий ключ видны всем для баннера', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-status-'));
  const until = Date.now() + 3600_000;
  const s = createStatus({ dataDir: dir, keyedPause: () => ({ until, daily: true }), apiKey: 'k', apis: () => ({ hypixel: { keyErrorAt: 0, keyOkAt: 1 } }) });
  try {
    const p = s.publicStatus();
    assert.deepEqual(p.hypixel, { limitedUntil: until, daily: true, keyBroken: false });
    assert.equal(p.load, 'medium');
    assert.match(p.why, /суточный лимит/);
  } finally { s.stop(); }
  const s2 = createStatus({ dataDir: dir, apiKey: 'k', apis: () => ({ hypixel: { keyErrorAt: 5, keyOkAt: 1 } }) });
  try { assert.equal(s2.publicStatus().hypixel.keyBroken, true); } finally { s2.stop(); }
});

test('память контейнера и диск сервера: лимит из cgroup, диск папки данных', () => {
  const MB = 1048576;
  assert.deepEqual(containerMemory({ constrained: 900 * MB, total: 3905 * MB }), { limitMb: 900 });
  assert.deepEqual(containerMemory({ constrained: 0, total: 3905 * MB }), { limitMb: null }); // не в Docker
  assert.deepEqual(containerMemory({ constrained: 2 ** 62, total: 3905 * MB }), { limitMb: null }); // «без лимита» в cgroup
  const d = diskInfo(os.tmpdir());
  assert.ok(d.totalGb > 0 && d.usedGb >= 0 && d.freeGb <= d.totalGb);
  assert.equal(diskInfo(path.join(os.tmpdir(), 'нет-такой-папки-' + Date.now())), null);
  const s = createStatus({ dataDir: os.tmpdir() });
  try {
    const a = s.adminStatus();
    assert.ok(a.disk.totalGb > 0);
    assert.ok(a.cpu.server >= 0 && a.cpu.process >= 0 && a.cpu.cores >= 1);
    assert.ok('limitMb' in a.memory);
  } finally { s.stop(); }
});
