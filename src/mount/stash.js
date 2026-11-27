// Адреса сервера для stash/index.js (расчёты — в @sky-guide/core)
import { analyzeEssence, analyzeSackLadder, analyzeSacks, marketId } from '@sky-guide/core/stash/index.js';
import { analyzeSell } from '@sky-guide/core/stash/sell.js';
import { analyzeCraft } from '@sky-guide/core/stash/craft.js';
import { getCart } from '@sky-guide/core/roadmap/cart.js';

/** Мешки, эссенции и «Что продать»: { sacks(v), essence(v), sell(v) } — для /api/sacks, /api/essence, /api/sell и /v1 (кэш общий) */
export function createStash(deps) {
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
  return {
    sacks(v) {
      const d = deps();
      const out = cached(v.member, 'sacks', d.pricesKey?.(), () => ({ ...analyzeSacks(v.member, d), ladder: analyzeSackLadder(v.member, { ...d, owned: d.owned?.(v.member) }) }));
      return { status: 'ok', ...out, player: v.player?.name || null, self: !!v.self };
    },
    // «Что продать»: что лежит без дела и где выгоднее продать, и «На что потратить» по рецептам плана
    sell(v) {
      const d = deps();
      const m = v.member;
      const roadmap = v.analysis?.roadmap || [];
      const cartIds = Object.keys((m.uuid && m.profileId && getCart(`${m.uuid}:${m.profileId}`)?.custom) || {});
      const out = cached(m, 'sell', `${d.pricesKey?.()}:${roadmap.length}:${cartIds.join(',')}`, () => {
        const o = { ...d, roadmap, cartIds };
        const r = analyzeSell(m, o);
        // С рынком крафт показываем, только если докупить недостающее дешевле готовой вещи
        const buy = r.market && d.buy ? id => d.buy(marketId(id)) || d.buy(id) : null;
        return { ...r, craft: analyzeCraft(m, buy ? { ...o, buy } : o).items };
      });
      return { status: 'ok', ...out, player: v.player?.name || null, self: !!v.self };
    },
    essence(v) {
      const d = deps();
      const out = cached(v.member, 'essence', d.pricesKey?.(), () => {
        const r = analyzeEssence(v.member, { ...d, owned: d.owned?.(v.member) });
        // «Подсказки по тексту»: словарь терминов для описаний эссенций и советов на карточках
        let refs = null;
        try { refs = d.textRefs?.(r.types.flatMap(t => [t.info.what, ...t.info.get, ...t.info.use, t.info.shop || '', t.sellNote]).join('\n')) || null; } catch { refs = null; }
        return { ...r, refs };
      });
      return { status: 'ok', ...out, player: v.player?.name || null, self: !!v.self };
    },
  };
}

export function mountStashRoutes(app, { getView, stash }) {
  const view = async (req, res) => {
    let v;
    try { v = await getView(req); } catch (e) { res.json({ status: 'error', error: e.message }); return null; }
    if (!v?.member) { res.json({ status: 'error', error: v?.error || 'Профиль ещё не загружен' }); return null; }
    return v;
  };
  for (const kind of ['sacks', 'essence', 'sell']) {
    app.get(`/api/${kind}`, async (req, res) => {
      const v = await view(req, res); if (!v) return;
      try { res.json(stash[kind](v)); } catch (e) { res.status(500).json({ status: 'error', error: e.message }); }
    });
  }
}
