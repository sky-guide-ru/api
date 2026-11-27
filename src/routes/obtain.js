// GET /api/item/:id/obtain — пошагово, как получить предмет: NPC (где и почём), крафт с деревом
// ингредиентов и живыми ценами, Forge, Kat, дропы (моб, место, шанс, требования) и ссылка на вики.
// Требования проверяются по выбранному игроку (свой профиль или друг).
import { buildObtainGuide } from '@sky-guide/core/analysis/obtain.js';
import { collectionsFromNeu } from '@sky-guide/core/market/requirements.js';
import { soldStats } from '@sky-guide/core/market/auctions.js';
import { makeBuy as makeBuyCore } from '@sky-guide/core/market/quote.js';
import { profileMode } from '@sky-guide/core/lib/profile-mode.js';

/** Цена покупки сейчас (Bazaar или аукцион, при разобранных лотах — по недавним продажам): расчёт в core, market/quote.js */
export const makeBuy = prices => makeBuyCore(prices, { soldStats });

/** Как получить предмет: для /api/item/:id/obtain и /v1/items/{id}/obtain. member — чьи требования проверять (или null). null — нет предмета */
export function obtainGuide(id, { neu, prices, getCollections, member = null }) {
  const bz = /^ENCHANTMENT_(.+)_(\d+)$/.exec(id);
  if (bz && !neu.items.has(id)) id = `${bz[1]};${bz[2]}`;
  if (!neu.items.has(id)) return null;
  return buildObtainGuide(id, {
    items: neu.items, constants: neu.constants, buy: makeBuy(prices), member,
    // Ironman, Stranded, Bingo: без Bazaar и аукциона — только NPC, крафт и дроп
    noMarket: !!member && profileMode(member.gameMode).market === false,
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
