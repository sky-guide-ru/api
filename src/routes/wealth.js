// GET /api/bank — проценты банка, GET /api/bits — выгода Bits в Community Shop, GET /api/maxwell — силы и Tuning.
// Всё считается по выбранному игроку (свой профиль или друг).
import { bankAnalysis } from '@sky-guide/core/analysis/bank.js';
import { bitsAnalysis } from '@sky-guide/core/analysis/bits.js';
import { maxwellAnalysis } from '@sky-guide/core/analysis/maxwell.js';

export function mountWealthRoutes(app, { getMember, prices, priceOf, itemName, now = () => Date.now() }) {
  app.get('/api/bank', async (req, res) => {
    const m = await getMember(req);
    res.json(m ? bankAnalysis(m, now()) : null);
  });
  app.get('/api/bits', async (req, res) => {
    const m = await getMember(req);
    res.json(bitsAnalysis(m, {
      sellPrice: priceOf,
      buyPrice: id => prices.bazaar?.get?.(id)?.buy || prices.bin?.get?.(id)?.price || 0,
      itemName, bits: Number(req.query.bits) || 0, fame: Number(req.query.fame) || 0,
    }));
  });
  app.get('/api/maxwell', async (req, res) => {
    const m = await getMember(req);
    res.json(m ? maxwellAnalysis(m) : null);
  });
}
