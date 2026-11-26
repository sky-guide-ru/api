// Адреса сервера для museum/index.js (расчёты — в @sky-guide/core)
import { museumItemStatus } from '@sky-guide/core/museum/analyze.js';
import { museumPage } from '@sky-guide/core/museum/index.js';

export function mountMuseumRoutes(app, { getView, deps }) {
  app.get('/api/museum', async (req, res) => {
    let v;
    try { v = await getView(req); } catch (e) { return res.status(200).json({ status: 'error', error: e.message }); }
    const m = v?.member;
    if (!m) return res.json({ status: 'error', error: v?.error || 'Профиль ещё не загружен' });
    try {
      res.json({ ...museumPage(m, deps()), player: v.player?.name || null, profile: m.profileName || null, self: !!v.self });
    } catch (e) { res.status(500).json({ status: 'error', error: e.message }); }
  });
  app.get('/api/museum/item/:id', async (req, res) => {
    const v = await getView(req).catch(() => null);
    const m = v?.member;
    try { res.json({ museum: m ? museumItemStatus(m, req.params.id, deps()) : museumItemStatus({}, req.params.id, deps()) }); } catch (e) { res.status(500).json({ error: e.message }); }
  });
}
