// Адреса сервера для guides/index.js (расчёты — в @sky-guide/core)
import { loadMember, sendNoMember } from '@sky-guide/core/lib/view-error.js';
import { enrichGuide } from '@sky-guide/core/guides/refs.js';
import { GROUPS, brief, buildGuide, buildGuides, forGuest } from '@sky-guide/core/guides/index.js';

export function mountGuideRoutes(app, { getView, getMember, getAnalysis, deps = {} }) {
  const view = async req => {
    if (getView) { const out = {}; const m = await loadMember({ sbView: () => getView(req) }, out); return { m, a: out.view?.analysis || {}, out }; }
    return { m: getMember?.() || null, a: getAnalysis?.() || {} };
  };
  app.get('/api/guides', async (req, res) => {
    const { m, a } = await view(req);
    // Гость без ника: гайды общие — без «не начато», уровней и итогов пустого профиля
    res.json({ groups: GROUPS, guest: !!m?.guest, guides: buildGuides(m, a, deps).map(brief).map(g => (m?.guest ? forGuest(g) : g)) });
  });
  app.get('/api/guides/:id', async (req, res) => {
    const { m, a, out } = await view(req);
    if (!m) return out ? sendNoMember(res, out) : res.status(503).json({ error: 'Профиль ещё не загружен' });
    const g = buildGuide(req.params.id, m, a, deps);
    if (!g) return res.status(404).json({ error: 'Гайд не найден' });
    // ссылки на предметы/NPC/мобов и подсказки к терминам (refs.js)
    try { enrichGuide(g, { items: deps.items, constants: deps.constants, price: deps.priceOf }); } catch (e) { console.warn('[guides] refs:', e.message); }
    res.json(m.guest ? forGuest(g) : g);
  });
}
