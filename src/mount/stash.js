// Адреса сервера для stash/index.js (расчёты — в @sky-guide/core)
import { analyzeEssence, analyzeSackLadder, analyzeSacks } from '@sky-guide/core/stash/index.js';

export function mountStashRoutes(app, { getView, deps }) {
  // Готовый расчёт держим, пока не сменились профиль (новый объект member) или цены: страница спрашивает
  // мешки и эссенции при каждом обновлении, а считать их заново (рецепты, перки, подсказки по тексту) незачем
  const cache = new WeakMap();
  const cached = (member, kind, key, calc) => {
    let byMember = cache.get(member);
    if (!byMember) { byMember = new Map(); cache.set(member, byMember); }
    const hit = byMember.get(kind);
    if (hit && hit.key === key) return hit.out;
    const out = calc();
    byMember.set(kind, { key, out });
    return out;
  };
  const view = async (req, res) => {
    let v;
    try { v = await getView(req); } catch (e) { res.json({ status: 'error', error: e.message }); return null; }
    if (!v?.member) { res.json({ status: 'error', error: v?.error || 'Профиль ещё не загружен' }); return null; }
    return v;
  };
  app.get('/api/sacks', async (req, res) => {
    const v = await view(req, res); if (!v) return;
    try {
      const d = deps();
      const out = cached(v.member, 'sacks', d.pricesKey?.(), () => ({ ...analyzeSacks(v.member, d), ladder: analyzeSackLadder(v.member, { ...d, owned: d.owned?.(v.member) }) }));
      res.json({ status: 'ok', ...out, player: v.player?.name || null, self: !!v.self });
    } catch (e) { res.status(500).json({ status: 'error', error: e.message }); }
  });
  app.get('/api/essence', async (req, res) => {
    const v = await view(req, res); if (!v) return;
    try {
      const d = deps();
      const out = cached(v.member, 'essence', d.pricesKey?.(), () => {
        const r = analyzeEssence(v.member, { ...d, owned: d.owned?.(v.member) });
        // «Подсказки по тексту»: словарь терминов для описаний эссенций и советов на карточках
        let refs = null;
        try { refs = d.textRefs?.(r.types.flatMap(t => [t.info.what, ...t.info.get, ...t.info.use, t.info.shop || '', t.sellNote]).join('\n')) || null; } catch { refs = null; }
        return { ...r, refs };
      });
      res.json({ status: 'ok', ...out, player: v.player?.name || null, self: !!v.self });
    } catch (e) { res.status(500).json({ status: 'error', error: e.message }); }
  });
}
