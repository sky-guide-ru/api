import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('карточка предмета переводит лор по абзацам, а не построчно', () => {
  const src = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(src, /loreRu: translateLore\(filled\.lore\)\.lines/);
});
