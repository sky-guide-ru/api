// Ключи доступа к /v1 для своих клиентов (бот, мод): заголовок X-API-Key.
// Данные игроков /v1 отдаёт только по ключу — так требуют правила Hypixel (нельзя раздавать их данные сторонним разработчикам).
//
// Ключ вида sg_<id>_<секрет>. В data/api-keys.json лежат только id, название, лимит и sha256 секрета:
// сам ключ показывается один раз при выдаче, потом его не узнать даже владельцу (можно только отозвать и выдать новый).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_KEY_PER_MIN = 120;
export const MAX_KEY_PER_MIN = 6000;
const KEY_RE = /^sg_([A-Za-z0-9]{10})_([A-Za-z0-9_-]{32,64})$/;
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const B62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const randomId = (n = 10) => Array.from(crypto.randomBytes(n), b => B62[b % 62]).join('');

/** Лимит запросов в минуту из формы или JSON: число от 1 до MAX_KEY_PER_MIN, иначе по умолчанию */
export function cleanLimit(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_KEY_PER_MIN) : DEFAULT_KEY_PER_MIN;
}

/**
 * Хранилище ключей.
 * @param {{ dataDir?: string, file?: string, clock?: () => number }} o
 */
export function createKeyStore(o = {}) {
  const file = o.file || path.join(o.dataDir || 'data', 'api-keys.json');
  const clock = o.clock || (() => Date.now());
  let keys = [];
  let mtime = -1;
  const used = new Map(); // id → { at, n } — когда и сколько раз ключом пользовались (на диск — не чаще раза в 10 минут)
  let flushAt = 0;

  function load() {
    let st = null;
    try { st = fs.statSync(file); } catch { /* файла ещё нет */ }
    const m = st ? st.mtimeMs : 0;
    if (m === mtime) return;
    mtime = m;
    try { keys = st ? (JSON.parse(fs.readFileSync(file, 'utf8')).keys || []) : []; } catch (e) { console.warn('[ключи API]', e.message); keys = []; }
  }
  function save() {
    for (const k of keys) { const u = used.get(k.id); if (u) { k.lastUsedAt = u.at; k.uses = (k.uses || 0) + u.n; } }
    used.clear();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ keys }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
    try { mtime = fs.statSync(file).mtimeMs; } catch { mtime = -1; }
    flushAt = clock();
  }
  const pub = k => ({ id: k.id, name: k.name, perMin: k.perMin, createdAt: k.createdAt, lastUsedAt: used.get(k.id)?.at || k.lastUsedAt || null, uses: (k.uses || 0) + (used.get(k.id)?.n || 0), revokedAt: k.revokedAt || null });

  return {
    file,
    /** Все ключи без секретов: для страницы «Аккаунт» */
    list() { load(); return keys.map(pub); },
    /** Выдать ключ. Возвращает { key, ...описание } — key показать один раз */
    create({ name, perMin } = {}) {
      load();
      const title = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!title) throw new Error('Назови ключ: для кого он (например, «Бот Discord»)');
      const id = randomId();
      const secret = crypto.randomBytes(24).toString('base64url');
      const k = { id, name: title, perMin: cleanLimit(perMin), hash: sha(secret), createdAt: clock(), lastUsedAt: null, uses: 0, revokedAt: null };
      keys.push(k);
      save();
      return { key: `sg_${id}_${secret}`, ...pub(k) };
    },
    /** Отозвать ключ: запросы с ним сразу получают 403 */
    revoke(id) {
      load();
      const k = keys.find(x => x.id === String(id || ''));
      if (!k) throw new Error('Нет такого ключа');
      if (!k.revokedAt) { k.revokedAt = clock(); save(); }
      return pub(k);
    },
    /**
     * Проверка заголовка X-API-Key: { ok: true, key } | { ok: false, code: 'BAD_KEY' | 'REVOKED' }.
     * Секрет сравнивается за постоянное время.
     */
    check(raw) {
      load();
      const m = KEY_RE.exec(String(raw || '').trim());
      const k = m && keys.find(x => x.id === m[1]);
      if (!k) return { ok: false, code: 'BAD_KEY' };
      const a = Buffer.from(sha(m[2]), 'hex'), b = Buffer.from(String(k.hash || ''), 'hex');
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, code: 'BAD_KEY' };
      if (k.revokedAt) return { ok: false, code: 'REVOKED' };
      const u = used.get(k.id) || { at: 0, n: 0 };
      u.at = clock(); u.n++;
      used.set(k.id, u);
      if (clock() - flushAt > 10 * 60_000) { try { save(); } catch (e) { console.warn('[ключи API]', e.message); } }
      return { ok: true, key: { id: k.id, name: k.name, perMin: k.perMin } };
    },
    /** Записать счётчики использования на диск (при остановке сервера) */
    flush() { if (used.size) { load(); save(); } },
  };
}
