// Адреса сервера для roadmap/cart.js — план покупок с правками игрока (расчёты — в @sky-guide/core)
import { buildCart, applyCartOp, getCart, setCart, normCart } from '@sky-guide/core/roadmap/cart.js';
import { buildFarmPlan } from '@sky-guide/core/roadmap/farm.js';
import { profileMode } from '@sky-guide/core/lib/profile-mode.js';

const readBody = req => new Promise((ok, fail) => {
  let body = '';
  req.on('data', ch => { body += ch; if (body.length > 20_000) { req.destroy(); fail(new Error('Слишком большой запрос')); } });
  req.on('end', () => { try { ok(JSON.parse(body || '{}')); } catch { fail(new Error('Неверный запрос')); } });
});

/**
 * GET /api/roadmap/cart → { rows, skipped, bought, total, liquid, cart, mode }.
 *   mode 'server' — свой профиль у вошедшего (список на сервере), иначе 'none'.
 * POST /api/roadmap/cart { skip, value } | { add, qty } | { remove } → то же; только свой профиль у вошедшего.
 * GET /api/roadmap/cart?local=<JSON> — список гостя из его браузера: сервер только считает и ничего не сохраняет.
 * Профиль без рынка (Ironman, Stranded, Bingo): вместо плана покупок — «План добычи» (roadmap/farm.js),
 *   ответ { farm: true, rows, skipped, done, total, ready, coins, lack, cart, mode }; правки — те же операции.
 */
export function mountCartRoutes(app, { getView, isGuest = () => false, price, name, items = () => null, constants = () => null }) {
  const ctx = async req => {
    const v = await getView(req).catch(() => null);
    const m = v?.member;
    return {
      key: m?.uuid && m?.profileId ? `${m.uuid}:${m.profileId}` : null,
      can: !!v?.self && !isGuest(req),
      plan: v?.analysis?.plan || [],
      inv: m?.inv || null,
      liquid: v?.analysis?.summary?.liquid || 0,
      perHour: v?.analysis?.summary?.perHour || 0,
      farm: !!m && profileMode(m.gameMode).market === false,
      steps: v?.analysis?.roadmap || [],
      pets: m?.pets || null,
    };
  };
  const view = (c, cart, mode) => {
    if (c.farm) {
      const r = buildFarmPlan(c.steps, cart, { items: items(), constants: constants(), inv: c.inv, pets: c.pets, name });
      if (r.changed && mode === 'server') setCart(c.key, r.cart);
      const { changed, ...out } = r;
      return { farm: true, ...out, mode };
    }
    const r = buildCart(c.plan, cart, { price, name, inv: c.inv, liquid: c.liquid, perHour: c.perHour });
    if (r.changed && mode === 'server') setCart(c.key, r.cart);
    const { changed, ...out } = r;
    return { ...out, mode };
  };
  app.get('/api/roadmap/cart', async (req, res) => {
    const c = await ctx(req);
    if (req.query.local != null) {
      let local = {};
      try { local = JSON.parse(String(req.query.local).slice(0, 8000)); } catch { /* битый — пустой список */ }
      return res.json(view(c, normCart(local), 'local'));
    }
    const server = c.can && c.key;
    res.json(view(c, server ? getCart(c.key) : {}, server ? 'server' : 'none'));
  });
  app.post('/api/roadmap/cart', async (req, res) => {
    try {
      const op = await readBody(req);
      const c = await ctx(req);
      if (!c.can || !c.key) return res.status(403).json({ error: 'Править можно только свой план покупок' });
      const cart = setCart(c.key, applyCartOp(getCart(c.key), op));
      res.json(view(c, cart, 'server'));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
}
