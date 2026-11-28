// Адреса сервера для guides/index.js (расчёты — в @sky-guide/core)
import { loadMember, sendNoMember } from '@sky-guide/core/lib/view-error.js';
import { enrichGuide } from '@sky-guide/core/guides/refs.js';
import { GROUPS, brief, buildGuide, buildGuides, forGuest } from '@sky-guide/core/guides/index.js';

/** Список гайдов для игрока m (гость — { guest: true, inv: {} }): для /api/guides и /v1 */
export function guideList(m, a, deps) {
  // Гость без ника: гайды общие — без «не начато», уровней и итогов пустого профиля
  return { groups: GROUPS, guest: !!m?.guest, guides: buildGuides(m, a, deps).map(brief).map(g => (m?.guest ? forGuest(g) : g)) };
}

/** Один гайд с подсказками по тексту или null */
export function guideOne(id, m, a, deps) {
  const g = buildGuide(id, m, a, deps);
  if (!g) return null;
  // ссылки на предметы/NPC/мобов и подсказки к терминам (refs.js)
  try { enrichGuide(g, { items: deps.items, constants: deps.constants, price: deps.priceOf }); } catch (e) { console.warn('[guides] refs:', e.message); }
  return m.guest ? forGuest(g) : g;
}

// Список собирает все гайды целиком (~100 мс CPU), а открывают его часто: один и тот же ответ на разбор игрока
// держим минуту. Тот же объект ответа — и английский перевод берётся из памяти, а не делается заново
const GUEST = {};
const listMemo = new WeakMap();
function cachedList(m, a, deps, clock = Date.now) {
  const key = a && Object.keys(a).length ? a : m || GUEST;
  const hit = listMemo.get(key), now = clock();
  if (hit && hit.m === m && now - hit.at < 60_000) return hit.out;
  const out = guideList(m, a, deps);
  listMemo.set(key, { m, at: now, out });
  return out;
}

export function mountGuideRoutes(app, { getView, getMember, getAnalysis, deps = {} }) {
  const view = async req => {
    if (getView) { const out = {}; const m = await loadMember({ sbView: () => getView(req) }, out); return { m, a: out.view?.analysis || {}, out }; }
    return { m: getMember?.() || null, a: getAnalysis?.() || {} };
  };
  app.get('/api/guides', async (req, res) => {
    const { m, a } = await view(req);
    res.json(cachedList(m, a, deps));
  });
  app.get('/api/guides/:id', async (req, res) => {
    const { m, a, out } = await view(req);
    if (!m) return out ? sendNoMember(res, out) : res.status(503).json({ error: 'Профиль ещё не загружен' });
    const g = guideOne(req.params.id, m, a, deps);
    if (!g) return res.status(404).json({ error: 'Гайд не найден' });
    res.json(g);
  });
}
