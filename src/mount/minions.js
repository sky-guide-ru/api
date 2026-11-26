// Адреса сервера для minions/index.js (расчёты — в @sky-guide/core)
import { FUELS, UPGRADES, analyzeMinions } from '@sky-guide/core/minions/index.js';

export function mountMinionRoutes(app, { getView, deps }) {
  app.get('/api/minions', async (req, res) => {
    let v;
    try { v = await getView(req); } catch (e) { return res.json({ status: 'error', error: e.message }); }
    const m = v?.member;
    if (!m) return res.json({ status: 'error', error: v?.error || 'Профиль ещё не загружен' });
    try {
      const d = deps(m);
      const a = analyzeMinions(m, d);
      const extra = id => ({ id, name: d.name(id), price: d.price(id) || null, owned: !!d.owned?.(id) });
      res.json({
        status: (m.minions || []).length || m.coop?.minions?.length ? 'ok' : 'empty',
        ...a,
        upgrades: UPGRADES.map(([id, why]) => ({ ...extra(id), why })),
        fuels: FUELS.map(([id, why]) => ({ ...extra(id), why })),
        player: v.player?.name || null, profile: m.profileName || null, self: !!v.self,
      });
    } catch (e) { res.status(500).json({ status: 'error', error: e.message }); }
  });
}
