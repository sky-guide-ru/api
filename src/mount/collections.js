// Адреса сервера для collections/index.js (расчёты — в @sky-guide/core)
import { analyzeCollections } from '@sky-guide/core/collections/index.js';

export function mountCollectionRoutes(app, { getView, deps }) {
  app.get('/api/collections', async (req, res) => {
    let v;
    try { v = await getView(req); } catch (e) { return res.json({ status: 'error', error: e.message }); }
    const m = v?.member;
    if (!m) return res.json({ status: 'error', error: v?.error || 'Профиль ещё не загружен' });
    try {
      res.json({ ...analyzeCollections(m, { ...deps(), full: true }), player: v.player?.name || null, profile: m.profileName || null, self: !!v.self });
    } catch (e) { res.status(500).json({ status: 'error', error: e.message }); }
  });
}
