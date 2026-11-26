// Биржевые графики раздела «Рынок»: сбор свечей Bazaar и аукциона, API для графика.
//   GET /api/market/candles/:id?tf=1h&to=<сек>&limit=1000 — свечи товара (см. server/market/candles.js)
//   GET /api/market/candles/:key?m=ah&… — свечи аукциона (lowest BIN и настоящие продажи, server/market/ah-candles.js)
//   GET /api/market/charts — сколько накоплено (для страницы «Сервер»)
import path from 'node:path';
import { createChartStore } from '@sky-guide/core/market/chart-store.js';
import { TIMEFRAMES, BASES, compact, coflToCandles, hourlyToCandles, openCandle, aggregate } from '@sky-guide/core/market/candles.js';
import { backfillCandles } from '@sky-guide/core/market/backfill.js';
import { AH_BASES, ahOpen, ahAddBin, ahAddSale, ahMerge, ahClean } from '@sky-guide/core/market/ah-candles.js';

// Пояснения под графиком. Идут через «подсказки по тексту» (refs), как и весь текст сайта
export const MARKET_HELP = [
  'Цена покупки — за сколько ты сразу купишь товар на Bazaar (самый дешёвый ордер на продажу). Цена продажи — за сколько сразу продашь (самый дорогой ордер на покупку). Разница между ними — спред: на нём зарабатывают перекупщики, выставляя ордера.',
  'Свеча показывает цену за период: открытие, максимум, минимум и закрытие. Зелёная — за период цена выросла, красная — упала.',
  'Hypixel отдаёт только текущие цены, поэтому историю копит сам сайт: цены записываются каждые 20 секунд. Минутные свечи хранятся 3 дня, пятиминутные — месяц, часовые — год, дневные — всё время. Самые ходовые товары дозаполнены прошлым месяцем.',
  'Объём — оценка по недельным счётчикам Hypixel: отдельные сделки игра не показывает, поэтому это примерное число купленных и проданных штук.',
  'Управление: колесо мыши или щипок двумя пальцами — масштаб, перетаскивание — прокрутка, перетаскивание шкалы цены — растянуть по высоте, двойной клик по шкале — сброс. Esc отменяет рисование и выходит из полного экрана.',
  'Время на графике — твоё местное. Дневные, недельные и месячные свечи начинаются в полночь по всемирному времени (UTC).',
];

// Пояснения под графиком аукциона
export const AH_HELP = [
  'Lowest BIN — самый дешёвый лот «Buy It Now» на Auction House: за столько предмет можно купить сразу. Сайт просматривает весь аукцион раз в 3 минуты.',
  'Продажи — цены, по которым предмет на самом деле купили (только BIN-лоты, ставочные аукционы не учитываются). Объём на графике — настоящее число проданных штук.',
  'Самый дешёвый лот обычно «голый»: без чар, reforge и улучшений. У брони, оружия и питомцев цены отдельно по вариантам — звёзды, Recombobulator, редкость питомца.',
  'Подробная история аукциона хранится 30 дней, дневные свечи — дольше. Свечи бывают от 5 минут.',
];

/**
 * @param {{ dataDir: string, prices: any, itemName: (id:string)=>string, textRefs?: (text:string)=>any, log?: Function,
 *   ahList?: ReturnType<typeof import('@sky-guide/core/market/ah-list.js').createAhList> }} deps
 */
export function createCharts({ dataDir, prices, itemName, textRefs = null, log = console.log, ahList = null }) {
  const store = createChartStore({ dir: path.join(dataDir, 'market'), log });
  // Аукцион — отдельная папка и свои сроки: всё по 30 дней (5 мин и 1 ч), дневные свечи всегда
  const ah = createChartStore({ dir: path.join(dataDir, 'market-ah'), log, bases: AH_BASES, merge: ahMerge, clean: ahClean });
  const ahBin = new Map(); // ключ → последний lowest BIN (свеча, открытая продажей, начинается с него)

  /** Скан аукциона (раз в 3 минуты): lowest BIN каждого предмета и варианта — в свечи. */
  const onAuctionScan = (lowest, variants, tsMs = Date.now()) => {
    for (const map of [lowest, variants]) {
      for (const [k, v] of map || []) {
        if (!(v?.price > 0)) continue;
        ahBin.set(k, v.price);
        ah.observe(k, tsMs, t => ahOpen(t, v.price), c => ahAddBin(c, v.price));
      }
    }
  };
  /** Настоящая продажа (auctions_ended раз в минуту). Время — сейчас: продажи приходят с опозданием до минуты, а свечи пишутся по порядку. */
  const onAuctionSale = (key, price, tsMs = Date.now(), qty = 1) => {
    if (!key || !(price > 0)) return;
    ah.observe(key, tsMs, t => ahOpen(t, ahBin.get(key) || 0, price, qty), c => ahAddSale(c, price, qty));
  };
  const timers = [];

  /** Каждое обновление Bazaar — в свечи. */
  const onBazaar = () => { if (prices.bazaar.size) store.tick(prices.bazaar, prices.bazaarAt || Date.now()); };

  /** Старая почасовая история (14 дней, data/price-history.json) → часовые и дневные свечи до начала своих. */
  async function seedFromHourly() {
    let added = 0;
    for (const [id, pts] of Object.entries(prices.history || {})) {
      if (!pts?.length) continue;
      const first = await store.firstTime(id, '1h');
      if (first != null && first <= Math.floor(pts[0][0] / 1000)) continue;
      added += await store.insertOlder(id, '1h', hourlyToCandles(pts, '1h'));
      added += await store.insertOlder(id, '1d', hourlyToCandles(pts, '1d'));
    }
    if (added) log(`[рынок] перенёс почасовую историю цен в свечи: ${added}`);
    return added;
  }

  /**
   * Демо без сети (цены из data/fixture-bazaar.json): чтобы графики было на чём посмотреть, рисуем случайное блуждание
   * вокруг текущей цены. Только в демо-режиме и только если своей истории нет совсем.
   */
  async function seedDemo() {
    // Только демо без ключа: на боевом сервере с ключом разовый сбой Hypixel не должен дорисовать фейковую историю
    if (!prices.bazaarDemo || process.env.HYPIXEL_API_KEY?.trim() || store.hasData()) return 0;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const now = Math.floor(Date.now() / 1000);
    let added = 0;
    for (const [id, p] of [...prices.bazaar].slice(0, 60)) {
      if (!(p.buy > 0 && p.sell > 0)) continue;
      const make = (sec, count) => {
        const out = [];
        let b = p.buy, s = p.sell;
        const end = Math.floor(now / sec) * sec - sec; // до текущей (её начнёт живой поток)
        for (let i = 0; i < count; i++) {
          const t = end - i * sec;
          const nb = b * (1 + (rnd() - 0.5) * 0.03), ns = Math.min(nb * 0.985, s * (1 + (rnd() - 0.5) * 0.03));
          const c = openCandle(t, nb, ns, rnd() * (p.buyWeek || 1000) / (604800 / sec), rnd() * (p.sellWeek || 1000) / (604800 / sec));
          c[1] = b; c[2] = Math.max(b, nb) * (1 + rnd() * 0.01); c[3] = Math.min(b, nb) * (1 - rnd() * 0.01);
          c[5] = s; c[6] = Math.max(s, ns) * (1 + rnd() * 0.01); c[7] = Math.min(s, ns) * (1 - rnd() * 0.01);
          out.push(c); b = nb; s = ns;
        }
        return out.reverse();
      };
      added += await store.insertOlder(id, '1m', make(60, 600));
      added += await store.insertOlder(id, '5m', make(300, 2000));
      const hours = make(3600, 24 * 120);
      added += await store.insertOlder(id, '1h', hours);
      added += await store.insertOlder(id, '1d', aggregate(hours, '1d'));
    }
    if (added) log(`[рынок] демо: нарисовал примерную историю свечей (${added})`);
    return added;
  }

  function start({ backfill = process.env.PRICE_BACKFILL !== '0' } = {}) {
    const every = (fn, ms) => { const t = setInterval(() => fn().catch(e => log(`[рынок] ${e.message}`)), ms); t.unref?.(); timers.push(t); };
    every(store.flush, 30_000);
    every(store.compact, 3600_000);
    every(ah.flush, 60_000);
    every(ah.compact, 3600_000);
    const later = (fn, ms) => { const t = setTimeout(() => fn().catch(e => log(`[рынок] ${e.message}`)), ms); t.unref?.(); timers.push(t); };
    later(async () => { await seedDemo(); await seedFromHourly(); }, 15_000);
    if (backfill) {
      const fill = () => backfillCandles(store, prices, { coflToCandles, log });
      later(fill, 8 * 60_000); // после дозаполнения почасовой истории (4 мин), чтобы не долбить Coflnet одновременно
      every(fill, 24 * 3600_000);
    }
  }

  function mount(app) {
    app.get('/api/market/candles/:id', async (req, res) => {
      const id = String(req.params.id);
      const tf = TIMEFRAMES[req.query.tf] ? String(req.query.tf) : '1h';
      const limit = Math.max(10, Math.min(Number(req.query.limit) || 1000, 3000));
      const to = req.query.to ? Number(req.query.to) : Infinity;
      if (req.query.m === 'ah') return ahCandles(req, res, id, tf, { to, limit });
      try {
        const { candles, hasMore } = await store.candles(id, tf, { to, limit });
        const bz = prices.bazaar.get(id);
        res.set('Cache-Control', 'no-store');
        res.json({
          id, name: itemName(id) || id, tf, candles: candles.map(compact), hasMore,
          live: bz ? { buy: bz.buy, sell: bz.sell, buyWeek: bz.buyWeek, sellWeek: bz.sellWeek, buyOrders: bz.buyOrders, sellOrders: bz.sellOrders, buyVol: bz.buyVol, sellVol: bz.sellVol, at: prices.bazaarAt } : null,
          keep: { [TIMEFRAMES[tf].base]: BASES[TIMEFRAMES[tf].base].keep },
        });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.get('/api/market/charts', (req, res) => res.json(status()));
    let ahHelp = { at: 0, refs: null };
    app.get('/api/market/ah-help', (req, res) => {
      if (Date.now() - ahHelp.at > 600_000) { try { ahHelp = { at: Date.now(), refs: textRefs ? textRefs(AH_HELP.join('\n')) : null }; } catch { /* без подсказок */ } }
      res.json({ texts: AH_HELP, refs: ahHelp.refs });
    });
    // Словарь подсказок пересчитываем раз в 10 минут: сразу после запуска база NEU может быть ещё не загружена
    let help = { at: 0, refs: null };
    app.get('/api/market/help', (req, res) => {
      if (Date.now() - help.at > 600_000) { try { help = { at: Date.now(), refs: textRefs ? textRefs(MARKET_HELP.join('\n')) : null }; } catch { /* без подсказок */ } }
      res.json({ texts: MARKET_HELP, refs: help.refs });
    });
  }

  /** Свечи аукциона + сводка предмета (lowest BIN, продажи, варианты) для карточки «Рынка». */
  async function ahCandles(req, res, key, tf, { to, limit }) {
    // Минутных свечей у аукциона нет (скан раз в 3 минуты): 1 мин показываем как 5 мин
    const tfa = tf === '1m' ? '5m' : tf;
    try {
      const { candles, hasMore } = await ah.candles(key, tfa, { to, limit });
      const row = ahList?.row(key) || null;
      res.set('Cache-Control', 'no-store');
      res.json({
        id: key, market: 'ah', name: row?.name || itemName(key) || key, tf: tfa, candles: candles.map(compact), hasMore,
        live: row ? { ...row, buy: row.price, sell: row.median, at: prices.binAt } : null,
        variants: ahList?.variants(key) || [],
        keep: { [TIMEFRAMES[tfa].base]: AH_BASES[TIMEFRAMES[tfa].base]?.keep ?? 0 },
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  }

  // Обход десятков тысяч файлов — в фоне и не чаще раза в 10 минут (панель «Сервер» спрашивает каждые 5 с):
  // ответ панели не ждёт обхода и показывает последний подсчёт
  let disk = { at: 0, v: null, ah: null }, counting = false;
  const status = () => {
    if (!counting && Date.now() - disk.at > 10 * 60_000) {
      counting = true;
      Promise.all([store.diskUsage(), ah.diskUsage()])
        .then(([v, a]) => { disk = { at: Date.now(), v, ah: a }; })
        .catch(() => { disk = { ...disk, at: Date.now() }; })
        .finally(() => { counting = false; });
    }
    return { ...disk.v, products: store.products(), ...store.stats, ah: { ...disk.ah, products: ah.products(), ...ah.stats } };
  };

  return {
    store, ah, onBazaar, onAuctionScan, onAuctionSale, start, mount, status, seedFromHourly, seedDemo,
    close: () => Promise.all([store.close(), ah.close()]), closeSync: () => { store.closeSync(); ah.closeSync(); }, stop: () => timers.forEach(t => clearInterval(t)),
  };
}
