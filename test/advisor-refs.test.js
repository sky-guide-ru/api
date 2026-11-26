import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import express from 'express';
import { attachLiveAdvisor } from '../src/live-advisor/integration/attach.js';
import { enrichGuide } from '@sky-guide/core/guides/refs.js';

// Маленькая база NEU: NPC и предмет
const items = new Map(Object.entries({
  MADDOX_NPC: { id: 'MADDOX_NPC', name: 'Maddox the Slayer (NPC)', island: 'hub' },
  HYPERION: { id: 'HYPERION', name: 'Hyperion', rarity: 'LEGENDARY' },
}));

test('чат советчика: NPC и механики получают подсказки как в гайдах, ссылки на предметы не размечаются второй раз', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-refs-'));
  const a = 'Иди к Maddox the Slayer и возьми [[HYPERION|Hyperion]]. Хотспот тоже полезен.';
  fs.writeFileSync(path.join(dataDir, 'live-advisor.json'), JSON.stringify({ chat: [{ at: 1, q: 'что делать?', a, model: 'x', usd: 0, tools: [] }] }));
  const key = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  const app = express();
  let calls = 0;
  attachLiveAdvisor({ app, bus: new EventEmitter(), state: {}, dataDir, deps: {
    textRefs: text => { calls++; return enrichGuide({ status: 'ok', sections: [{ kind: 'text', text }] }, { items }).refs; },
  } });
  const srv = app.listen(0);
  try {
    const url = `http://localhost:${srv.address().port}/api/live/state`;
    const st = await fetch(url).then(r => r.json());
    const refs = st.chat.at(-1).refs;
    assert.equal(refs.phrases['Maddox the Slayer'], 'n:MADDOX_NPC');
    assert.equal(refs.phrases['Хотспот'], 't:hotspot');
    assert.equal(refs.phrases.Hyperion, undefined, 'предмет уже ссылка [[…]]');
    assert.equal(refs.data['n:MADDOX_NPC'].kind, 'npc');
    await fetch(url);
    assert.equal(calls, 1, 'словарь считается один раз на ответ');
  } finally { srv.close(); if (key) process.env.ANTHROPIC_API_KEY = key; }
});
