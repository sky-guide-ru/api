// Рейтинг профилей («самые богатые» и т.п.). Общего списка всех игроков Hypixel не даёт, поэтому рейтинг
// собирается только из профилей, которые посетители сами открывали на сайте: после каждого обновления чужого
// профиля (players.js, не чаще раза в 3 минуты) сюда кладётся короткая сводка. Отдельных запросов к Hypixel
// рейтинг не делает и никого не перебирает.
//
// Приватность: в рейтинг не попадают игроки, попросившие скрыть профиль (HIDDEN_PLAYERS), — проверка и при записи,
// и при каждой выдаче. Владелец сайта и его друзья с 24.11.2026 стоят в рейтинге как обычные игроки (по просьбе
// владельца): без пометок «владелец»/«друг» и без особого порядка.
// Убрать ник из рейтинга может только владелец (раздел «Отзывы»): игрок присылает запрос кнопкой «Убрать ник» —
// это обычный отзыв с типом nick. Раньше убрать мог любой гость, и любой ник — так чужие ники пропадали из таблицы.
// После удаления ник/uuid запоминается, чтобы не вернуться при следующем просмотре.
import fs from 'node:fs';
import path from 'node:path';

const DAY = 24 * 3600_000;

/** Таблицы рейтинга: что сравниваем и как показать. value(entry) → число или null (тогда игрока в таблице нет) */
export const BOARDS = {
  networth: { label: 'Networth', unit: 'монет', value: e => e.nw },
  level: { label: 'Уровень SkyBlock', value: e => e.level },
  catacombs: { label: 'Catacombs', value: e => (e.cataXp > 0 ? e.cataXp : null) },
  slayer: { label: 'Slayers', unit: 'опыта', value: e => (e.slayerXp > 0 ? e.slayerXp : null) },
  skills: { label: 'Skill Average', value: e => (e.skillAvg > 0 ? e.skillAvg : null) },
};

const SLAYER_KEYS = ['zombie', 'spider', 'wolf', 'enderman', 'blaze', 'vampire'];
const round1 = x => Math.round((Number(x) || 0) * 10) / 10;

/** Сводка профиля для рейтинга: только числа для таблиц, без инвентаря */
export function entryFromView(v, now = Date.now()) {
  const m = v?.member;
  const uuid = String(v?.player?.uuid || m?.uuid || '').replace(/-/g, '').toLowerCase();
  if (!m || !uuid || !m.profileId) return null;
  const nw = v.analysis?.gear?.networth?.total;
  const d = m.dungeons || {};
  const slayers = {};
  let slayerXp = 0;
  for (const k of SLAYER_KEYS) {
    const s = m.slayers?.[k];
    if (!s) continue;
    slayers[k] = s.level || 0;
    slayerXp += Number(s.xp) || 0;
  }
  return {
    uuid,
    name: String(v.player?.name || m.name || ''),
    profileId: String(m.profileId),
    profile: m.profileName || '',
    mode: m.gameMode || 'normal',
    coop: Math.max(1, (m.coopRoster || []).length || m.coopMembers || 1),
    // Кооп-соседи по uuid — чтобы при выдаче убрать остров, на котором живёт кто-то из скрытых
    mates: (m.coopRoster || []).map(c => String(c.uuid || '').replace(/-/g, '').toLowerCase()).filter(id => id && id !== uuid),
    rank: m.rank || null,
    // Без открытого API инвентаря стоимость занижена в разы — в таблицу «Богатство» такой профиль не ставим
    nw: !m.inv?.apiDisabled && nw > 0 ? Math.round(nw) : null,
    level: round1(m.sbLevel) || null,
    cata: Math.floor(d.catacombs?.level || 0),
    cataXp: Math.round(d.catacombs?.xp || 0),
    cls: d.selectedClass || null,
    slayerXp: Math.round(slayerXp),
    slayers,
    skillAvg: round1(m.skillAverage),
    at: v.updatedAt || now,
  };
}

/**
 * @param {{
 *   file?: string,                         // где хранить (data/leaderboard.json); без файла — только в памяти
 *   clock?: () => number,
 *   isExcluded: (who: { uuid: string, name: string, profileId?: string }) => boolean, // владелец, друзья, аккаунты сайта, скрытые
 *   maxEntries?: number, maxAgeMs?: number, saveDelayMs?: number,
 * }} o
 */
/**
 * Кого не пускать в рейтинг: только скрытые игроки (HIDDEN_PLAYERS). Соседа по коопу знаем лишь по uuid,
 * поэтому ники скрытых переводим в uuid (resolve()); пока не перевели — соседей без ника не пускаем.
 * @param {{ names: () => Set<string>, resolveUuid: (nick: string) => Promise<{ uuid: string } | null> }} o
 */
export function createHiddenFilter(o) {
  const uuids = new Set();
  let ready = false;
  const norm = u => String(u || '').replace(/-/g, '').toLowerCase();
  return {
    async resolve() {
      let ok = true;
      for (const n of o.names()) {
        try { const r = await o.resolveUuid(n); if (r?.uuid) uuids.add(norm(r.uuid)); else ok = false; } catch { ok = false; }
      }
      ready = ok;
      return ok;
    },
    isExcluded({ uuid, name }) {
      const n = String(name || '').toLowerCase();
      const id = norm(uuid);
      if (id && uuids.has(id)) return true;
      const names = o.names();
      if (!n && !ready && names.size) return true;
      const hide = !!n && names.has(n);
      if (hide && id) uuids.add(id);
      return hide;
    },
  };
}

export function createLeaderboard(o) {
  const clock = o.clock || (() => Date.now());
  const maxEntries = o.maxEntries ?? 3000;
  const maxAgeMs = o.maxAgeMs ?? 60 * DAY; // профиль, который два месяца никто не открывал, уходит из рейтинга
  const entries = new Map(); // `${uuid}:${profileId}` → запись
  const optOut = new Map();  // uuid и ник (в нижнем регистре) → { uuid, name } того, кто попросил убрать себя
  const addOpt = (u, n) => { const r = { uuid: u || '', name: n || '' }; if (u) optOut.set(u, r); if (n) optOut.set(n, r); };

  if (o.file) {
    try {
      const j = JSON.parse(fs.readFileSync(o.file, 'utf8'));
      for (const e of j.entries || []) if (e?.uuid && e.profileId) entries.set(`${e.uuid}:${e.profileId}`, e);
      for (const x of j.optOut || []) addOpt(String(x?.uuid || '').toLowerCase(), String(x?.name || '').toLowerCase());
    } catch { /* файла ещё нет */ }
    prune(); // после долгого простоя старые записи уходят сразу при запуске
  }

  let timer = null;
  function save() {
    if (!o.file) return;
    clearTimeout(timer);
    timer = setTimeout(flush, o.saveDelayMs ?? 5000);
    timer.unref?.();
  }
  function flush() {
    if (!o.file) return;
    clearTimeout(timer); timer = null;
    try {
      fs.mkdirSync(path.dirname(o.file), { recursive: true });
      const tmp = `${o.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ entries: [...entries.values()], optOut: [...new Set(optOut.values())] }));
      fs.renameSync(tmp, o.file);
    } catch (e) { console.warn('[рейтинг] не удалось сохранить:', e.message); }
  }

  const opted = e => optOut.has(e.uuid) || optOut.has(String(e.name).toLowerCase());
  const hidden = e => {
    if (opted(e)) return true;
    try {
      if (o.isExcluded({ uuid: e.uuid, name: e.name, profileId: e.profileId })) return true;
      return (e.mates || []).some(id => o.isExcluded({ uuid: id, name: '', profileId: e.profileId }));
    } catch { return true; } // не смогли проверить — лучше не показать
  };

  function prune() {
    const now = clock();
    for (const [k, e] of entries) if (now - (e.seen || e.at || 0) > maxAgeMs) entries.delete(k);
    if (entries.size <= maxEntries) return;
    const old = [...entries.entries()].sort((a, b) => (a[1].seen || 0) - (b[1].seen || 0));
    for (const [k] of old.slice(0, entries.size - maxEntries)) entries.delete(k);
  }

  return {
    /** Профиль обновился (players.js). Скрытых не записываем вовсе. */
    record(view) {
      const e = entryFromView(view, clock());
      if (!e) return false;
      // Отказ был только по нику (профиль тогда ещё не знали) — запоминаем и uuid: отказ переживёт смену ника
      if (!optOut.has(e.uuid) && optOut.has(String(e.name).toLowerCase())) { addOpt(e.uuid, String(e.name).toLowerCase()); save(); }
      if (hidden(e)) return false;
      e.seen = clock();
      // Ник сменился — у старых записей игрока тоже новый ник
      for (const x of entries.values()) if (x.uuid === e.uuid) x.name = e.name;
      entries.set(`${e.uuid}:${e.profileId}`, e);
      prune();
      save();
      return true;
    },

    /**
     * Таблица: по одной строке на игрока (его лучший профиль по этому показателю).
     * @param {string} board ключ из BOARDS
     * @param {{ mode?: 'all'|'normal'|'ironman'|'other', limit?: number, find?: string }} opts
     */
    top(board, { mode = 'all', limit = 100, find = '' } = {}) {
      const b = BOARDS[board] || BOARDS.networth;
      const best = new Map(); // uuid → запись
      for (const e of entries.values()) {
        const v = b.value(e);
        if (v == null || !(v > 0)) continue;
        if (mode === 'ironman' && e.mode !== 'ironman') continue;
        if (mode === 'normal' && e.mode !== 'normal') continue;
        if (mode === 'other' && (e.mode === 'normal' || e.mode === 'ironman')) continue;
        if (clock() - (e.seen || e.at || 0) > maxAgeMs) continue; // устаревшие не показываем, даже если prune давно не запускался
        if (hidden(e)) continue;
        const cur = best.get(e.uuid);
        if (!cur || b.value(cur) < v) best.set(e.uuid, e);
      }
      const sorted = [...best.values()].sort((a, c) => b.value(c) - b.value(a) || (a.name > c.name ? 1 : -1));
      const row = (e, i) => ({
        place: i + 1, name: e.name, uuid: e.uuid, profile: e.profile, mode: e.mode, coop: e.coop, rank: e.rank,
        value: b.value(e), nw: e.nw, level: e.level, cata: e.cata, cls: e.cls, slayerXp: e.slayerXp, slayers: e.slayers,
        skillAvg: e.skillAvg, at: e.at,
      });
      const rows = sorted.slice(0, Math.max(1, Math.min(200, limit))).map(row);
      const f = String(find || '').trim().toLowerCase();
      const i = f ? sorted.findIndex(e => e.name.toLowerCase() === f) : -1;
      return { board: b === BOARDS[board] ? board : 'networth', rows, total: sorted.length, me: i >= 0 ? row(sorted[i], i) : null };
    },

    /** Владелец убирает игрока (по его запросу): удаляем все его профили и больше не записываем */
    remove({ uuid, name }) {
      const u = String(uuid || '').replace(/-/g, '').toLowerCase();
      const n = String(name || '').trim().toLowerCase();
      let removed = 0;
      for (const [k, e] of entries) if ((u && e.uuid === u) || (n && e.name.toLowerCase() === n)) { entries.delete(k); removed++; }
      const old = optOut.get(u) || optOut.get(n);
      addOpt(u || old?.uuid, n || old?.name);
      save();
      return removed;
    },

    /** Владелец возвращает игрока, который убрал себя по ошибке */
    restore({ uuid, name }) {
      const r = optOut.get(String(uuid || '').replace(/-/g, '').toLowerCase()) || optOut.get(String(name || '').trim().toLowerCase());
      if (!r) return false;
      optOut.delete(r.uuid); optOut.delete(r.name);
      save();
      return true;
    },

    /** Кто убран из рейтинга — для раздела «Отзывы» (только владелец) */
    removed: () => [...new Set(optOut.values())].map(r => ({ uuid: r.uuid, name: r.name })),
    isOptedOut: ({ uuid, name }) => optOut.has(String(uuid || '').replace(/-/g, '').toLowerCase()) || optOut.has(String(name || '').toLowerCase()),
    size: () => entries.size,
    flush,
    _entries: entries,
  };
}

/** Простой лимит «не больше N действий за окно» по IP */
export function createActionLimiter({ max = 5, windowMs = 3600_000, clock = () => Date.now() } = {}) {
  const hits = new Map();
  return ip => {
    const now = clock();
    const list = (hits.get(ip) || []).filter(t => now - t < windowMs);
    if (list.length >= max) { hits.set(ip, list); return false; }
    list.push(now);
    hits.set(ip, list);
    if (hits.size > 10_000) for (const [k, v] of hits) if (!v.some(t => now - t < windowMs)) hits.delete(k);
    return true;
  };
}

/**
 * GET  /api/leaderboard?board=networth&mode=all&find=Ник  — таблица (find — место этого игрока, если он есть)
 * POST /api/leaderboard/remove { player }                — убрать из рейтинга (только владелец; игрок просит через отзыв)
 * POST /api/leaderboard/restore { player }               — вернуть (только владелец)
 * GET  /api/admin/leaderboard/removed                    — кто убран (только владелец)
 */
/** Таблица лидеров: для /api/leaderboard и /v1/leaderboard. q: { board, mode, limit, find } */
export function leaderboardView(board, q = {}) {
  const mode = ['all', 'normal', 'ironman', 'other'].includes(q.mode) ? q.mode : 'all';
  const r = board.top(String(q.board || 'networth'), { mode, limit: Number(q.limit) || 100, find: String(q.find || '').trim().slice(0, 36) });
  return { ...r, mode, tracked: board.size(), boards: Object.entries(BOARDS).map(([id, b]) => ({ id, label: b.label })) };
}

export function mountLeaderboardRoutes(app, { board, isAdmin = () => false, express }) {
  const json = express.json({ limit: '2kb' });
  const nick = s => String(s || '').trim().slice(0, 36);
  const valid = s => /^[A-Za-z0-9_]{1,16}$/.test(s) || /^[0-9a-f]{32}$/i.test(s.replace(/-/g, ''));

  app.get('/api/leaderboard', (req, res) => res.set('Cache-Control', 'no-store').json(leaderboardView(board, req.query)));

  app.post('/api/leaderboard/remove', json, (req, res) => {
    if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Только со страницы сайта' });
    if (!isAdmin(req)) return res.status(403).json({ error: 'Убрать ник из рейтинга можно запросом: кнопка «Убрать ник» в рейтинге' });
    const p = nick(req.body?.player);
    if (!valid(p)) return res.status(400).json({ error: 'Нужен ник Minecraft' });
    const asUuid = /^[0-9a-f]{32}$/i.test(p.replace(/-/g, '')) ? p : '';
    // uuid берём из записей: так отказ переживёт смену ника
    const found = [...board._entries.values()].find(e => (asUuid ? e.uuid === asUuid.replace(/-/g, '').toLowerCase() : e.name.toLowerCase() === p.toLowerCase()));
    const removed = board.remove({ uuid: found?.uuid || asUuid, name: asUuid ? found?.name : p });
    res.json({ ok: true, removed });
  });

  app.post('/api/leaderboard/restore', json, (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Это может только владелец сайта' });
    const p = nick(req.body?.player);
    res.json({ ok: board.restore({ name: p, uuid: p }) });
  });

  app.get('/api/admin/leaderboard/removed', (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Это может только владелец сайта' });
    res.set('Cache-Control', 'no-store').json({ items: board.removed() });
  });
}
