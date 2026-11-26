// GET /api/bank — проценты банка, GET /api/bits — выгода Bits в Community Shop, GET /api/maxwell — силы и Tuning.
// Всё считается по выбранному игроку (свой профиль или друг). Те же расчёты отдаёт /v1 (wealthViews).
import { bankAnalysis } from '@sky-guide/core/analysis/bank.js';
import { bitsAnalysis } from '@sky-guide/core/analysis/bits.js';
import { maxwellAnalysis } from '@sky-guide/core/analysis/maxwell.js';

/** { bank(m), bits(m, { bits, fame }), maxwell(m) } — m может быть null */
export function wealthViews({ prices, priceOf, itemName, now = () => Date.now() }) {
  return {
    bank: m => (m ? bankAnalysis(m, now()) : null),
    bits: (m, q = {}) => bitsAnalysis(m, {
      sellPrice: priceOf,
      buyPrice: id => prices.bazaar?.get?.(id)?.buy || prices.bin?.get?.(id)?.price || 0,
      itemName, bits: Number(q.bits) || 0, fame: Number(q.fame) || 0,
    }),
    maxwell: m => (m ? maxwellAnalysis(m) : null),
  };
}

export function mountWealthRoutes(app, { getMember, ...deps }) {
  const w = wealthViews(deps);
  app.get('/api/bank', async (req, res) => res.json(w.bank(await getMember(req))));
  app.get('/api/bits', async (req, res) => res.json(w.bits(await getMember(req), req.query)));
  app.get('/api/maxwell', async (req, res) => res.json(w.maxwell(await getMember(req))));
}
