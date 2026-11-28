// HTTP-маршруты модуля цен. Подключение в server/index.js:
//   import { mountPriceRoutes } from './routes/prices.js';
//   mountPriceRoutes(app, { getMember: () => state.member });
import express from 'express';
import { prices, priceInfo, priceTrend } from '@sky-guide/core/prices.js';
import * as money from '@sky-guide/core/analysis/money.js';
import { neu } from '@sky-guide/core/neu.js';
import { checkCrafttext, collectionsFromNeu } from '@sky-guide/core/market/requirements.js';
import { sendNoMember, loadMember } from '@sky-guide/core/lib/view-error.js';

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

// getView(req) — как req.sbView(): вид игрока или отказ. Нужен «Заработку», чтобы назвать настоящую причину, если профиля нет
export function mountPriceRoutes(app, { getMember = () => null, getView = null, getNetworth = () => 0, textRefs = null } = {}) {
  // Подсказки по тексту для разбора методов: считаем по всему тексту методов, держим в памяти по самому тексту
  const refsCache = new Map();
  const methodRefs = methods => {
    if (!textRefs) return null;
    const text = methods.flatMap(mt => [mt.title, mt.desc, mt.detail, mt.xp, mt.mayorNote, ...(mt.steps || []), ...(mt.risks || []),
      ...(mt.reqs || []).map(r => r.text), ...(mt.kit || []).map(k => k.text)]).filter(Boolean).join('\n');
    if (refsCache.has(text)) return refsCache.get(text);
    let refs = null;
    try { refs = textRefs(text); } catch { /* нет базы NEU — разбор останется без подсказок */ }
    refsCache.set(text, refs);
    if (refsCache.size > 50) refsCache.delete(refsCache.keys().next().value);
    return refs;
  };
  const r = express.Router();
  r.get('/status', (req, res) => res.json({ bazaarAt: prices.bazaarAt, binAt: prices.binAt, soldAt: prices.soldAt, bazaar: prices.bazaar.size, bin: prices.bin.size }));
  r.get('/flips/bazaar', (req, res) => res.json(money.bazaarFlips({ maxPrice: num(req.query.max, Infinity), budget: num(req.query.budget, 50_000_000), includeRisky: req.query.risky === '1', limit: Math.min(num(req.query.limit, 40), 200) })));
  r.get('/flips/npc', (req, res) => res.json(money.npcFlips({ mode: req.query.mode === 'instant' ? 'instant' : 'order' })));
  r.get('/flips/craft', async (req, res) => {
    const list = money.craftFlips({ limit: Math.min(num(req.query.limit, 40), 200), depth: num(req.query.depth, 1), buyMode: req.query.buy === 'order' ? 'order' : 'instant', sellMode: req.query.sell === 'instant' ? 'instant' : 'offer', includeForge: req.query.forge !== '0' });
    // Отмечаем рецепты, которые игрок ещё не открыл (коллекция / HotM / слеер)
    const m = await getMember(req);
    if (!m) return res.json(list);
    const colls = money.craftCollections || collectionsFromNeu(neu.items);
    res.json(list.map(f => {
      const c = checkCrafttext(f.crafttext, m, colls);
      return c.ok === false ? { ...f, locked: c.missing } : f;
    }));
  });
  r.get('/flips/forge', (req, res) => res.json(money.forgeFlips({ quickForge: num(req.query.quick, 0) })));
  r.get('/flips/snipes', (req, res) => res.json(money.binSnipes({ maxPrice: num(req.query.max, Infinity), limit: Math.min(num(req.query.limit, 30), 200) })));
  // Без ?fortune — та же Farming Fortune, что в «Методах» (ползунок владельца или оценка по снаряжению профиля)
  r.get('/crops', async (req, res) => {
    const m = req.query.fortune ? null : await getMember(req);
    res.json(money.cropProfits(req.query.fortune ? Number(req.query.fortune) : undefined, req.query.bps ? Number(req.query.bps) : undefined, m));
  });
  r.get('/movers', (req, res) => res.json(money.topMovers({ period: req.query.period === 'd7' ? 'd7' : 'd1' })));
  r.get('/trend/:id', (req, res) => res.json(priceTrend(req.params.id)));
  r.get('/item/:id', (req, res) => res.json(priceInfo(req.params.id)));
  r.get('/money', async (req, res) => {
    const out = {};
    const m = getView ? await loadMember({ sbView: () => getView(req) }, out) : await getMember(req);
    if (!m) return sendNoMember(res, out);
    const extra = { networth: Number(out.view ? out.view.analysis?.gear?.networth?.total : await getNetworth(req)) || 0 };
    const methods = money.moneyMethods(m, extra);
    res.json({ plan: money.moneyPlan(m, extra, methods), methods, refs: methodRefs(methods), settings: money.moneyState.settings });
  });
  r.get('/settings', (req, res) => res.json(money.moneyState.settings));
  // Общие настройки расчёта (налог, мэр, слоты Forge) меняет только владелец; друзьям Farming Fortune хранит их браузер
  // Гость (без входа) — тоже не владелец: раньше req.sbUser у гостя пустой и проверка его пропускала
  const notOwner = req => !!req.sbGuest || (!!req.sbUser && !req.sbUser.owner);
  r.post('/settings', express.json(), (req, res) => res.json(notOwner(req) ? money.moneyState.settings : money.setMoneySettings(req.body || {})));
  // Сессии заработка — личные записи владельца: друзьям их не показываем
  r.get('/sessions', (req, res) => res.json(notOwner(req) ? [] : money.moneyState.sessions));
  r.post('/sessions', express.json(), (req, res) => {
    if (notOwner(req)) return res.status(403).json({ error: 'Личные сессии заработка пока ведёт только владелец сайта' });
    try { res.json(money.addSession(req.body || {})); } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.use('/api/market', r);
}
