// Замороженные адреса сервера: список всех маршрутов лежит в docs/routes.md, тест сверяет его с настоящим сервером.
// Сайт ходит в эти адреса, поэтому убрать или переименовать маршрут случайно нельзя: тест упадёт.
// Новый маршрут — допиши в docs/routes.md (или UPDATE_ROUTES=1 npm test пересоберёт список; описания разделов останутся).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC = path.join(root, 'docs', 'routes.md');

// Ключ IndexNow в адресе файла зависит от настроек сервера
const norm = r => r.replace(/^GET \/[0-9a-f]{32}\.txt$/, 'GET /<INDEXNOW_KEY>.txt');
export const docRoutes = text => [...text.matchAll(/^- `((?:GET|POST|PUT|PATCH|DELETE|ALL) [^`]+)`/gm)].map(m => m[1]);

async function liveRoutes() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-routes-'));
  const web = path.join(tmp, 'web');
  fs.mkdirSync(web);
  fs.writeFileSync(path.join(web, 'index.html'), '<!doctype html><script type="module" src="/assets/index-x.js"></script>');
  const out = path.join(tmp, 'routes.json');
  const port = 39000 + Math.floor(Math.random() * 900);
  const child = spawn(process.execPath, ['--import', './test/_routes-hook.mjs', 'src/index.js'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), ROUTES_OUT: out, HYPIXEL_API_KEY: '', ANTHROPIC_API_KEY: '', PRICE_BACKFILL: '0', DATA_DIR: path.join(tmp, 'data'), WEB_DIST: web },
  });
  let log = '';
  child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  try {
    for (let i = 0; i < 450 && !fs.existsSync(out); i++) await new Promise(r => setTimeout(r, 100));
    assert.ok(fs.existsSync(out), 'сервер не запустился:\n' + log.slice(-2000));
    await new Promise(r => setTimeout(r, 50));
    return JSON.parse(fs.readFileSync(out, 'utf8')).map(norm);
  } finally { child.kill(); }
}

function render(routes, old) {
  // Разделы по началу адреса; описания разделов из старого файла сохраняются
  const notes = new Map([...old.matchAll(/^## (.+)\n\n((?:(?!- `)[^\n]+\n)*)/gm)].map(m => [m[1], m[2]]));
  const section = r => { const p = r.split(' ')[1]; return p.startsWith('/v1') ? '/v1' : p.startsWith('/api/') ? `/api/${p.split('/')[2]}` : p.startsWith('/account') || /^\/(login|logout)$/.test(p) ? 'Вход и аккаунт' : 'Страницы и файлы'; };
  const count = new Map();
  for (const r of routes) count.set(section(r), (count.get(section(r)) || 0) + 1);
  const groups = new Map();
  for (const r of routes) {
    const s = count.get(section(r)) >= 3 || !section(r).startsWith('/api/') ? section(r) : '/api: остальное';
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push(r);
  }
  const head = old.split('\n## ')[0].trimEnd();
  return `${head}\n\n${[...groups].sort(([a], [b]) => a.localeCompare(b)).map(([s, list]) => `## ${s}\n\n${notes.get(s) || ''}${list.map(r => `- \`${r}\``).join('\n')}\n`).join('\n')}`;
}

test('все маршруты сервера записаны в docs/routes.md, и ничего лишнего', { timeout: 90_000 }, async () => {
  const live = await liveRoutes();
  const text = fs.readFileSync(DOC, 'utf8');
  if (process.env.UPDATE_ROUTES === '1') { fs.writeFileSync(DOC, render(live, text)); return; }
  const doc = docRoutes(text);
  const missing = live.filter(r => !doc.includes(r)), gone = doc.filter(r => !live.includes(r));
  assert.deepEqual({ новые_не_записаны: missing, пропали_с_сервера: gone }, { новые_не_записаны: [], пропали_с_сервера: [] });
  assert.equal(new Set(doc).size, doc.length, 'маршрут записан дважды');
});
