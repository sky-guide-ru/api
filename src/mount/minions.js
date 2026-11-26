// Адреса сервера для minions/index.js (расчёты — в @sky-guide/core)
import { FUELS, UPGRADES, analyzeMinions } from '@sky-guide/core/minions/index.js';

/** Миньоны игрока: для /api/minions и /v1/players/…/minions. deps(member) — зависимости расчёта */
export function minionsView(v, deps) {
  const m = v.member;
  const d = deps(m);
  const a = analyzeMinions(m, d);
  const extra = id => ({ id, name: d.name(id), price: d.price(id) || null, owned: !!d.owned?.(id) });
  return {
    status: (m.minions || []).length || m.coop?.minions?.length ? 'ok' : 'empty',
    ...a,
    upgrades: UPGRADES.map(([id, why]) => ({ ...extra(id), why })),
    fuels: FUELS.map(([id, why]) => ({ ...extra(id), why })),
    player: v.player?.name || null, profile: m.profileName || null, self: !!v.self,
  };
}

export function mountMinionRoutes(app, { getView, deps }) {
  app.get('/api/minions', async (req, res) => {
    let v;
    try { v = await getView(req); } catch (e) { return res.json({ status: 'error', error: e.message }); }
    if (!v?.member) return res.json({ status: 'error', error: v?.error || 'Профиль ещё не загружен' });
    try { res.json(minionsView(v, deps)); } catch (e) { res.status(500).json({ status: 'error', error: e.message }); }
  });
}
