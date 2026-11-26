// GET /api/item/:id/obtain — пошагово, как получить предмет: NPC (где и почём), крафт с деревом
// ингредиентов и живыми ценами, Forge, Kat, дропы (моб, место, шанс, требования) и ссылка на вики.
// Требования проверяются по выбранному игроку (свой профиль или друг).
import { buildObtainGuide } from '@sky-guide/core/analysis/obtain.js';
import { collectionsFromNeu } from '@sky-guide/core/market/requirements.js';
import { soldStats } from '@sky-guide/core/market/auctions.js';
import { ahNet, DEFAULT_BAZAAR_TAX } from '@sky-guide/core/market/util.js';

/**
 * Цена покупки сейчас: Bazaar (мгновенно и через заказ) или lowest BIN на аукционе.
 * Вместе с ней — цена продажи (sell): Bazaar Instant Sell, на аукционе медиана настоящих продаж (или второй лот), sellNet — после налога.
 */
export function makeBuy(prices) {
  return id => {
    const ids = [id];
    const m = /^([A-Z0-9_]+);(\d+)$/.exec(id);
    if (m) ids.push(`ENCHANTMENT_${m[1]}_${m[2]}`);
    for (const k of ids) {
      const bz = prices.bazaar?.get?.(k);
      if (bz && bz.buy > 0) return { price: bz.buy, order: bz.sell > 0 ? bz.sell : null, market: 'bazaar', sell: bz.sell || 0, sellNet: Math.round((bz.sell || 0) * (1 - DEFAULT_BAZAAR_TAX)) };
    }
    for (const k of ids) {
      const b = prices.bin?.get?.(k);
      if (b && b.price > 0) {
        const st = prices.sold ? soldStats(prices.sold, k) : null;
        const salesOk = st?.median > 0 && st.count7d >= 1;
        const capped = salesOk && st.median > b.price; // в продажах есть улучшенные экземпляры — дороже лота не продать
        const sell = salesOk ? Math.min(st.median, b.price) : b.second || 0;
        return { price: b.price, count: b.count || null, market: 'ah', sell, sellNet: Math.round(ahNet(sell)), sellFrom: salesOk ? (capped ? 'cap' : 'sales') : sell ? 'lots' : null, sold7: st?.count7d || 0 };
      }
    }
    return null;
  };
}

/** Как получить предмет: для /api/item/:id/obtain и /v1/items/{id}/obtain. member — чьи требования проверять (или null). null — нет предмета */
export function obtainGuide(id, { neu, prices, getCollections, member = null }) {
  const bz = /^ENCHANTMENT_(.+)_(\d+)$/.exec(id);
  if (bz && !neu.items.has(id)) id = `${bz[1]};${bz[2]}`;
  if (!neu.items.has(id)) return null;
  return buildObtainGuide(id, {
    items: neu.items, constants: neu.constants, buy: makeBuy(prices), member,
    collections: getCollections() || collectionsFromNeu(neu.items),
  });
}

export function mountObtainRoutes(app, { getMember, neu, prices, getCollections }) {
  app.get('/api/item/:id/obtain', async (req, res) => {
    if (!neu.items.has(req.params.id) && !/^ENCHANTMENT_/.test(req.params.id)) return res.status(404).json({ error: 'Предмет не найден' });
    const member = await getMember(req).catch(() => null);
    const guide = obtainGuide(req.params.id, { neu, prices, getCollections, member });
    if (!guide) return res.status(404).json({ error: 'Предмет не найден' });
    res.json(guide);
  });
}
