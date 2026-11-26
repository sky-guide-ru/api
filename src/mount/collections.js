// Адреса сервера для collections/index.js (расчёты — в @sky-guide/core)
import { analyzeCollections } from '@sky-guide/core/collections/index.js';

/** Коллекции игрока: для /api/collections и /v1/players/…/collections. v — вид игрока с member */
export function collectionsView(v, deps) {
  const m = v.member;
  return { ...analyzeCollections(m, { ...deps(), full: true }), player: v.player?.name || null, profile: m.profileName || null, self: !!v.self };
}

export function mountCollectionRoutes(app, { getView, deps }) {
  app.get('/api/collections', async (req, res) => {
    let v;
    try { v = await getView(req); } catch (e) { return res.json({ status: 'error', error: e.message }); }
    const m = v?.member;
    if (!m) return res.json({ status: 'error', error: v?.error || 'Профиль ещё не загружен' });
    try { res.json(collectionsView(v, deps)); } catch (e) { res.status(500).json({ status: 'error', error: e.message }); }
  });
}
