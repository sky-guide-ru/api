import 'dotenv/config'; // .env читает api, ядро его не грузит (core 0.2)
// Первым: учёт внешних API оборачивает fetch до того, как его возьмут остальные модули (SDK советчика и др.)
import { apiStats, keySince } from '@sky-guide/core/lib/api-stats.js';
import { PARTS, statePart, partVersions, lightAnalysis, lightMember } from '@sky-guide/core/lib/state-parts.js';
import { createStatus, HYPIXEL_LIMIT } from './status.js';
import { keyedCallsRecent, keyedPause, keyUsage, resolveUuid, getPlayer } from '@sky-guide/core/hypixel.js';
import { rankFor } from '@sky-guide/core/rank.js';
import { bingoRawFor, statusFor, knownStatus, skyblockNews } from '@sky-guide/core/live.js';
import { guildFor } from '@sky-guide/core/guild.js';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '@sky-guide/core/config.js';
import { neu, loadNeu, getItem, itemName } from '@sky-guide/core/neu.js';
import { auctionCacheSize } from '@sky-guide/core/prices.js';
import { prices, auctionHooks, refreshBazaar, refreshAuctions, loadHistory, priceInfo, priceOf, buyPriceOf, quoteOf, petPriceOf, priceTrend, refreshEndedAuctions, saveHistory, pricesReady, loadLowestBin } from '@sky-guide/core/prices.js';
import { backfillHistory } from '@sky-guide/core/market/backfill.js';
import { refreshMayor } from '@sky-guide/core/analysis/money.js';
import { mountPriceRoutes } from './routes/prices.js';
import { createCharts } from './routes/charts.js';
import { mountSkinRoutes } from './routes/skin.js';
import { mountItemUpgradeRoutes, itemUpgradeCopies } from './routes/item-upgrades.js';
import { variableView } from '@sky-guide/core/lib/variable-stats.js';
import { setItemsResource, itemProps, obtainmentOf } from '@sky-guide/core/lib/item-props.js';
import { soldStats } from '@sky-guide/core/market/auctions.js';
import { darkAuctionOf } from '@sky-guide/core/analysis/dark-auction.js';
import * as sbTime from '@sky-guide/core/calendar/time.js';
import { mountObtainRoutes } from './routes/obtain.js';
import { mountWealthRoutes, wealthViews } from './routes/wealth.js';
import { createPlayerAuctions } from '@sky-guide/core/player-auctions.js';
import * as moneyMod from '@sky-guide/core/analysis/money.js';
import { getItemsResource, getCollectionsResource } from '@sky-guide/core/hypixel.js';
import { setCollectionsResource } from '@sky-guide/core/analysis/roadmap.js';
import { setCraftCollections } from '@sky-guide/core/analysis/money.js';
import { state, bus, refreshProfile, reanalyze, reanalyzeForPrices, markOwnerWatched, ownerRefreshDue } from '@sky-guide/core/state.js';
import { bazaarFlips, craftFlips, cropProfits, npcPrices } from '@sky-guide/core/analysis/money.js';
import { iconMeta, getSkin, getTexture, getRender, getAvatar } from '@sky-guide/core/icons.js';
import { loadPacks, packs } from '@sky-guide/core/packs.js';
import { rarityRu } from '@sky-guide/core/i18n/ru.js';
import { fillPetLore } from '@sky-guide/core/lib/pet-lore.js';
import { getItemRu, getLoreRu, getLoreEn, allItems, searchItems, normalizeId, loadFromNeuAsync, translateLore as translateLoreRu, translateLoreLine as translateLoreLineRu } from '@sky-guide/core/items-ru/index.js';
import { createAuth } from './auth.js';
import { gzip } from './lib/gzip.js';
import { staticAssets } from './lib/static-assets.js';
import { createPlayers, readViewRequest, fixNick } from '@sky-guide/core/players.js';
import { createDiskCache } from '@sky-guide/core/lib/disk-cache.js';
import { createHistoryFiles, sliceRange } from '@sky-guide/core/history.js';
import { attachLiveAdvisor } from './live-advisor/integration/attach.js';
import { itemValue } from '@sky-guide/core/parse/gear.js';
import { buildGuides, GROUPS as GUIDE_GROUPS } from '@sky-guide/core/guides/index.js';
import { mountGuideRoutes, guideList, guideOne } from './mount/guides.js';
import { createSeo, jsonldScript, originOf, pingIndexNow, INDEXNOW_KEY } from './seo/index.js';
import { createDiscordNews } from './discord-news.js';
import { mountDiscordLink, createLinkStore } from './discord-link.js';
import { createDiscordBot } from './discord-bot/index.js';
import { createDiscordEvents } from './discord-events.js';
import { NEWS } from '@sky-guide/core/news/entries.js';
import { enrichGuide, lexiconPhrases, refsData } from '@sky-guide/core/guides/refs.js';
import { warpTable } from '@sky-guide/core/guides/warps.js';
import { GUI_ITEMS } from '@sky-guide/core/lib/gui-items.js';
import { setRiftOwner } from '@sky-guide/core/rift/marks.js';
import { mountRiftRoutes } from './mount/rift-marks.js';
import { mountCollectRoutes } from './mount/collectibles-marks.js';
import { mountHiddenRoutes } from './mount/roadmap-hidden.js';
import { mountCartRoutes } from './mount/roadmap-cart.js';
import { summarizeForCompare } from '@sky-guide/core/compare.js';
import { mountMuseumRoutes, museumView } from './mount/museum.js';
import { mountStashRoutes, createStash } from './mount/stash.js';
import { setCollectionsResource as setCollectionsPage, analyzeCollections } from '@sky-guide/core/collections/index.js';
import { mountCollectionRoutes, collectionsView } from './mount/collections.js';
import { mountMinionRoutes, minionsView } from './mount/minions.js';
import { collectOwned } from '@sky-guide/core/advisor/lib/util.js';
import { calendarBrief, bingoEvent, fiestaOutlook } from '@sky-guide/core/calendar/index.js';
import { createMiningEvents } from '@sky-guide/core/calendar/mining.js';
import { mountCalendarRoutes, createCalendar } from './mount/calendar.js';
import { electionNow } from '@sky-guide/core/calendar/election-store.js';
import { mountNewsRoutes } from './mount/news.js';
import { createSurveyStore, mountSurveyRoutes } from './survey/index.js';
import { mountPublicRoutes, renderIndexHtml, createGuestLimiter, publicConfig } from './public.js';
import { mountLegalRoutes, hiddenPlayers } from './legal.js';
import { createLeaderboard, createHiddenFilter, mountLeaderboardRoutes, leaderboardView } from './leaderboard.js';
import { seedFriends } from './users.js';
import { patchReqLabels } from '@sky-guide/core/rift/collections.js';
import { fixCrafttext } from '@sky-guide/core/market/requirements.js';
import { listBazaar } from '@sky-guide/core/market/bazaar-list.js';
import { dayChangePct } from '@sky-guide/core/market/history.js';
import { createAhList, AH_SORTS } from '@sky-guide/core/market/ah-list.js';
import { displayName, itemCategory, itemRarity } from '@sky-guide/core/names.js';
import { categoryKey } from '@sky-guide/core/market/categories.js';
import { refreshWiki } from '@sky-guide/core/wiki/watch.js';
import { securityHeaders, apiRateLimit, createConnLimiter, createRateLimiter } from './lib/guard.js';
import { createMonitor, beaconHandler } from './monitor/index.js';
import { createPerf } from './monitor/perf.js';
import { createDiscordAlerts } from './monitor/discord.js';
import { createGeo } from './monitor/geo.js';
import { sendMail, mailerInfo } from './lib/mailer.js';
import { smtpConfig, sendMail as sendSmtp } from './lib/smtp.js';
import { checkMailDns } from './lib/mail-dns.js';
import { createFeedback, mountFeedbackRoutes } from './feedback.js';
import { langMiddleware, isEn, inLang, translateDeep, getTranslator, preferredLang } from '@sky-guide/core/i18n/lang.js';
import { tx } from '@sky-guide/core/i18n/msg.js';
import { createV1 } from './v1/index.js';
import { createKeyStore } from './v1/keys.js';
import { missingAccessories, accessoriesView, networthView } from './v1/players.js';
import { mountDocs } from './v1/docs.js';
import { obtainGuide } from './routes/obtain.js';
import { newsView } from '@sky-guide/core/news/index.js';
import { plainNews } from '@sky-guide/core/news/links.js';
import { createRequire } from 'node:module';
// Английская версия показывает описания предметов как в игре (оригинал), русская — переведённые
const translateLore = lines => (isEn() ? { lines: lines || [] } : translateLoreRu(lines));
const translateLoreLine = line => (isEn() ? line : translateLoreLineRu(line));

const app = express();
app.disable('x-powered-by');
app.use(securityHeaders()); // нельзя встроить сайт в чужую страницу, браузер не угадывает типы файлов
app.use(gzip()); // сжатие JSON/JS/CSS: профиль и сайт грузятся быстрее, особенно с телефона
setTimeout(() => getTranslator(), 3000).unref(); // словарь английской версии собираем заранее, а не на первом запросе
app.use(langMiddleware()); // английская версия (/en/): язык запроса и перевод ответов — server/i18n/lang.js
// Ключи /v1 для своих бота и мода (data/api-keys.json): выдаёт и отзывает владелец на странице «Аккаунт»
const apiKeys = createKeyStore({ dataDir: config.dataDir });
const auth = createAuth(process.env, { dataDir: config.dataDir, apiKeys });
// Поиск и нейросети: обычные адреса открытых разделов (/guides/fishing, /item/HYPERION) с готовым текстом (server/seo)
// market — живые цены для гайда The Forge (выгодные рецепты), collections — пороги коллекций для «Requires: Mithril X»
const guideDeps = { priceOf, priceInfo, itemName: id => itemName(id)?.replace(/§./g, ''), get constants() { return neu.constants; }, get items() { return neu.items; },
  get market() { return moneyMod.marketCtx(); }, get collections() { return moneyMod.craftCollections; } };
// Лор питомцев — с числами для 100 уровня, как на самой странице, а не с {STRENGTH} и {0}
const seoLore = (id, lore) => (lore && /;\d$/.test(id) ? fillPetLore(id, '', lore, neu.constants?.petnums).lore : lore);
const seo = createSeo({
  guides: () => inLang('ru', () => buildGuides({ guest: true, inv: {} }, {}, guideDeps)), // кэш общий — собираем по-русски // как для гостя без ника: никаких профилей
  groups: GUIDE_GROUPS,
  news: NEWS,
  items: { all: allItems, get: id => getItemRu(id), lore: id => seoLore(id, getLoreRu(id)), loreEn: id => seoLore(id, getLoreEn(id)) },
  priceOf,
});
const siteOrigin = req => originOf(publicConfig(process.env).siteUrl, req.get('host'));
mountPublicRoutes(app, { env: process.env, seo, origin: siteOrigin, indexNowKey: INDEXNOW_KEY }); // robots.txt, sitemap.xml, llms.txt — до входа
// Правовые страницы, значок сайта и аватарки открыты всем, даже когда сайт закрыт паролем
mountLegalRoutes(app, { env: process.env, isOwner: req => auth.isOwnerRequest(req) });
// Привязка Discord к нику (роль Verified на сервере): /discord, тоже до входа. Привязки — data/discord-links.json, наружу не отдаются
const discordLinks = createLinkStore(path.join(config.dataDir, 'discord-links.json'));
const discordLinking = mountDiscordLink(app, { env: process.env, store: discordLinks, siteUrl: publicConfig(process.env).siteUrl, clientIp: auth.clientIp, resolveUuid, getPlayer });
app.get(['/og.png', '/og-en.png'], (req, res) => res.set('Cache-Control', 'public, max-age=86400').type('image/png').sendFile(path.join(config.webDist, req.path.slice(1))));
app.get('/favicon.svg', (req, res) => res.set('Cache-Control', 'public, max-age=86400').type('image/svg+xml').sendFile(path.join(config.webDist, 'favicon.svg')));
// Аватарки открыты и до входа (страница входа); незнакомый ник сервер скачивает с mc-heads.net — поэтому свой лимит
const headLimit = apiRateLimit({ clientIp: auth.clientIp, max: Number(process.env.HEADS_PER_MIN) || 240 });
app.get('/api/head/:who', headLimit, async (req, res) => {
  const buf = await getAvatar(req.params.who, req.query.size).catch(() => null);
  if (!buf) return res.status(404).end();
  res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=21600' }).send(buf);
});
// Место под историю графиков: свой профиль (profile-history.json, вместе с лентой) + файлы друзей
const historySize = () => {
  let own = 0; try { own = fs.statSync(path.join(config.dataDir, 'profile-history.json')).size; } catch { /* ещё нет */ }
  const f = historyFiles.size();
  return { points: state.history.length, ownBytes: own, friendFiles: f.files, friendBytes: f.bytes };
};
// Что из данных лежит в памяти сервера — чтобы на «Сервере» было видно, откуда берутся мегабайты
const countPoints = store => Object.values(store || {}).reduce((n, a) => n + (a?.length || 0), 0);
const memoryParts = () => [
  { label: 'База предметов NEU', count: neu.items.size, unit: 'предметов' },
  { label: 'Ресурс-паки (только оглавление)', count: packs.list.reduce((n, p) => n + (p.files?.size || 0), 0), unit: 'файлов', hint: 'Сами текстуры читаются с диска по запросу' },
  { label: 'История цен', count: countPoints(prices.history) + countPoints(prices.binHistory), unit: 'точек' },
  { label: 'Лоты аукциона в кэше', count: auctionCacheSize(), unit: 'лотов' },
  { label: 'Чужие профили в кэше', count: players.stats().rawProfiles, unit: 'игроков', hint: 'Не больше 16 и не дольше часа' },
];
const status = createStatus({
  dataDir: config.dataDir, keyedCallsRecent, keyedPause, keyUsage: () => ({ today: keyUsage.today(), recent: keyUsage.recent(7), perDay: keyUsage.recent(14).map(d => ({ day: d.day, calls: d.total, ...monitor.dayStats(d.day) })) }), state, prices, buildId: () => buildId(), historySize, memoryParts,
  marketCharts: () => charts.status(), // вызывается только из запроса, когда charts уже создан
  apis: () => apiStats.snapshot(), apiKey: config.apiKey, keySince: () => keySince(config.dataDir, config.apiKey),
});
app.use(status.track); // счётчик запросов для панели состояния
// Тревоги и сводка — ещё и в закрытый канал Discord (DISCORD_ALERTS_WEBHOOK в .env; пусто — только почта)
const discordAlerts = createDiscordAlerts({ webhook: process.env.DISCORD_ALERTS_WEBHOOK, siteUrl: String(process.env.SITE_URL || '') });
// Свой учёт посещений и ошибок (без внешних сервисов, IP не сохраняется) и тревоги на почту владельцу — server/monitor
const monitor = createMonitor({
  dataDir: config.dataDir, tz: process.env.LIVE_TZ || 'Europe/Moscow',
  // Тема «[Sky Guide] …» — письма легко найти в почте (отзывы приходят как «[Sky Guide] Отзыв · …»)
  sendMail: msg => sendMail({ ...msg, subject: tx`[Sky Guide] ${msg.subject}` }), mailInfo: () => mailerInfo(), apis: () => apiStats.snapshot(),
  ai: () => liveAdvisor?.budgetSummary?.() ?? null,
  deployLog: () => { try { return JSON.parse(fs.readFileSync(path.join(config.dataDir, 'deploy-log.json'), 'utf8')); } catch { return { events: [] }; } },
  siteUrl: String(process.env.SITE_URL || '').replace(/\/$/, ''),
  // Владелец, его кооп, друзья с аккаунтом и скрытые игроки в статистику ников не попадают
  // Кооп владельца в списке соседей есть только по uuid — сверяем и его
  excludedNick: (n, uuid) => excludedFromStats({ name: n, uuid }),
  notify: discordAlerts, digestExtra: () => perf.digestLines(),
});
app.use(monitor.track5xx);
// Скорость и нагрузка по часам: время ответа каждого адреса, кэш профилей, расход ключа Hypixel, CPU, память, диск, вес сайта
const perf = createPerf({
  dataDir: config.dataDir, tz: process.env.LIVE_TZ || 'Europe/Moscow', sample: () => status.sample(), keyUsage: () => keyUsage.today(),
  hypixelLimit: () => apiStats.snapshot()?.hypixel?.limit || HYPIXEL_LIMIT, webDist: config.webDist, alert: (...a) => monitor.alert(...a),
});
app.use(perf.track);
// События из браузера (просмотр раздела, время загрузки, ошибка) — до входа: ошибки на странице входа тоже нужны
// Страна посетителя — по офлайн-базе DB-IP в data/geo (скачивается сама, раз в месяц); IP не сохраняется
const geo = createGeo({ dataDir: config.dataDir });
geo.start();
app.post('/api/t', express.text({ type: () => true, limit: '16kb' }), beaconHandler(monitor, { clientIp: req => auth.clientIp(req), isOwner: req => auth.isOwnerRequest(req), build: () => buildId(), country: ip => geo.country(ip) }));
// Публичный API /v1 и страница Swagger (/api/docs) — до входа: им не нужны cookie сайта, данные игроков — только по ключу
mountDocs(app);
const corePkg = (() => { try { return createRequire(import.meta.url)('@sky-guide/core/package.json'); } catch { return {}; } })();
const playerView = want => (players.isOwner(want) ? Promise.resolve({ owner: true, want, ...state }) : players.get(want));
const v1Step = s => ({ id: s.id, cat: s.cat, priority: s.priority, effort: s.effort || null, title: s.title, why: s.why || '', how: s.how || [],
  items: s.items || [], cost: s.cost ?? null, payoff: s.payoff || null, needsSaving: !!s.needsSaving, link: s.link || null });
// Чек-лист улучшений своих экземпляров: и для сайта (/api/item/:id/upgrades), и для /v1
const upgradeDeps = { neu, priceOf, buyPriceOf, get binVar() { return prices.binVar; }, petPriceOf, translateLoreLine, translateLore };
// Расчёты разделов — общие для сайта (/api/*) и для /v1: те же зависимости, один кэш
const textRefsOf = text => enrichGuide({ status: 'ok', sections: [{ kind: 'text', text }] }, { items: neu.items, constants: neu.constants, price: priceOf }).refs;
const calendar = createCalendar({ textRefs: textRefsOf });
// Ивенты майнинга: трекер Soopy, не чаще раза в минуту. Пусто — ждём первый ответ (до 10 с), дальше обновляем в фоне
const miningEvents = createMiningEvents();
async function miningEventsNow() {
  if (!miningEvents.get()) await miningEvents.refresh();
  else miningEvents.refresh();
  // Mining Fiesta: идёт ли сейчас и шансы Cole на выборах — из данных календаря, без трекера
  return { ...(miningEvents.get() || { at: null, islands: [] }), fiesta: fiestaOutlook() };
}
const museumDeps = () => ({ constants: neu.constants, items: neu.items, price: priceOf, name: id => itemName(id) });
const stash = createStash(() => ({ pricesKey: () => `${prices.bazaarAt}:${prices.binAt}`, constants: neu.constants, price: priceOf, buy: buyPriceOf, name: id => itemName(id), bazaar: id => prices.bazaar.get(id) || null, npc: id => npcPrices.get(id) || 0, owned: collectOwned, items: neu.items, whereToGet: id => getItemRu(id)?.whereToGet || [],
  bin: id => prices.bin.get(id) || null, sold: id => soldStats(prices.sold, id), props: id => itemProps(id, { bazaar: prices.bazaar.has(id) }),
  textRefs: textRefsOf }));
const collectionDeps = () => ({ items: neu.items });
const minionDeps = m => {
  const owned = collectOwned(m);
  return { items: neu.items, constants: neu.constants, price: priceOf, name: id => itemName(id), owned: id => owned.has(id), collections: analyzeCollections(m, { items: neu.items, full: true }) };
};
const wealth = wealthViews({ prices, priceOf, itemName });
const GUEST = { member: { guest: true, inv: {} }, analysis: {} };
// /v1: куски разделов из разбора (как /api/part/:name), под понятными именами
const V1_PARTS = { gear: 'gear', progress: 'extras', pets: 'petScore', map: 'map' };
app.use('/v1', createV1({
  keys: apiKeys, clientIp: req => auth.clientIp(req), open: () => auth.publicView, openPerMin: Number(process.env.V1_PER_MIN) || 120,
  items: {
    card: (id, o) => itemCard(id, o),
    obtain: id => obtainGuide(id, { neu, prices, getCollections: () => moneyMod.craftCollections }),
    search: (q, limit) => searchList(q, limit),
  },
  market: {
    bazaar: q => (q.ids ? (items => ({ total: items.length, items }))(bazaarIds(q.ids)) : bazaarList(q)),
    auctions: q => (q.ids ? (items => ({ total: items.length, items }))(ahIds(q.ids, true)) : ahQuery(q)),
    candles: async (id, o) => { const c = await charts.candlesFor(id, o); return c.candles.length || c.live ? c : null; },
    flips: (kind, q) => (kind === 'bazaar' ? bazaarFlips({ maxPrice: q.max, limit: q.limit })
      : kind === 'craft' ? craftFlips({ limit: q.limit })
        : kind === 'forge' ? moneyMod.forgeFlips({}).slice(0, q.limit)
          : kind === 'snipes' ? moneyMod.binSnipes({ maxPrice: q.max, limit: q.limit })
            : moneyMod.npcFlips({ mode: 'order' }).slice(0, q.limit)),
  },
  lexicon: () => ({ v: neu.loadedAt || 0, ready: neu.items.size > 0, phrases: lexiconPhrases(neu.items, neu.constants), warps: warpTable(neu.constants) }),
  news: () => { const n = newsView(); return { latest: n.latest, entries: n.entries.map(e => ({ ...e, title: plainNews(e.title), items: e.items.map(plainNews) })) }; },
  status: () => ({ ...status.publicStatus(), prices: { bazaarAt: prices.bazaarAt || null, auctionsAt: prices.binAt || null } }),
  version: () => ({ build: buildId(), core: corePkg.version || null }),
  players: {
    view: playerView,
    hidden: name => hiddenPlayers().has(String(name).toLowerCase()),
  },
  summary: v => summarizeForCompare(v),
  plan: v => ({ player: { name: v.player?.name, uuid: v.player?.uuid || null }, profile: v.member?.profileName || null, updatedAt: v.updatedAt || 0,
    steps: (v.analysis?.roadmap || []).filter(s => s.priority > 0).map(v1Step) }),
  money: v => {
    const extra = { networth: Number(v.analysis?.gear?.networth?.total) || 0 };
    const methods = v.analysis?.methods || moneyMod.moneyMethods(v.member, extra);
    return { player: { name: v.player?.name, uuid: v.player?.uuid || null }, profile: v.member?.profileName || null, updatedAt: v.updatedAt || 0,
      plan: moneyMod.moneyPlan(v.member, extra, methods), methods };
  },
  accessories: (v, q) => accessoriesView(v, q),
  missing: (v, q) => missingAccessories(v, q, { whereToGet: id => getItemRu(id)?.whereToGet || [], priceOf }),
  networth: (v, q) => networthView(v, q),
  auctions: async v => { const a = await auctionsOf(v); return a && { player: { name: v.player?.name || null, uuid: v.player?.uuid || null }, profile: v.member?.profileName || null, ...a }; },
  upgrades: (v, id) => itemUpgradeCopies(v.member, id, upgradeDeps),
  // Открытые разделы
  calendar: year => calendar(year),
  election: () => electionNow(), // голоса, шансы, ближайшие мэры (core calendar/election-store.js)
  miningEvents: () => miningEventsNow(),
  leaderboard: q => leaderboardView(board, q),
  guides: { list: () => guideList(GUEST.member, GUEST.analysis, guideDeps), get: id => guideOne(id, GUEST.member, GUEST.analysis, guideDeps) },
  quotes: ids => Object.fromEntries(ids.map(id => [id, quoteOf(id)])),
  trend: id => priceTrend(id),
  movers: period => moneyMod.topMovers({ period }),
  crops: q => moneyMod.cropProfits(q.fortune, q.bps),
  image: id => getRender(id, { scope: 'public' }).catch(() => null),
  // Разделы игрока
  section: (name, v, q) => {
    const m = v.member;
    switch (name) {
      case 'collections': return collectionsView(v, collectionDeps);
      case 'minions': return minionsView(v, minionDeps);
      case 'museum': return museumView(v, museumDeps);
      case 'sacks': return stash.sacks(v);
      case 'essence': return stash.essence(v);
      case 'bank': return wealth.bank(m);
      case 'bits': return wealth.bits(m, q);
      case 'maxwell': return wealth.maxwell(m);
      case 'guides': return guideList(m, v.analysis || {}, guideDeps);
      default: return V1_PARTS[name] ? PARTS[V1_PARTS[name]]({ member: m, analysis: v.analysis }) ?? null : undefined;
    }
  },
  guide: (id, v) => guideOne(id, v.member, v.analysis || {}, guideDeps),
  // История графиков: у владельца и игроков с аккаунтом сайта она личная (как на сайте для посторонних) — не отдаём
  history: (v, days) => {
    const personal = !!v.owner || !!auth.users.get(String(v.player?.name || ''));
    const all = personal ? [] : (v.history || []);
    return { points: sliceRange(all, days * 24 * 3600_000), since: all[0]?.t || null, tracked: !personal && !!v.historyKey };
  },
}));
// Discord-бот (/profile, /price, /next): Discord шлёт команды на /discord/interactions — до входа, данные из общего кэша.
// Без DISCORD_PUBLIC_KEY и DISCORD_APP_ID в .env выключен. Разные ники: 10 на человека и 60 на всех за 10 минут
const botNickLimit = createGuestLimiter({ max: 10 }), botAllLimit = createGuestLimiter({ max: 60 });
const botLinkLimit = createRateLimiter({ max: 5, windowMs: 10 * 60_000 });
const discordBot = createDiscordBot({
  env: process.env, site: () => publicConfig(process.env).siteUrl,
  view: want => playerView(want), hidden: name => hiddenPlayers().has(String(name || '').toLowerCase()), open: () => auth.publicView,
  summary: v => summarizeForCompare(v),
  plan: v => ({ player: { name: v.player?.name }, profile: v.member?.profileName || null, updatedAt: v.updatedAt || 0,
    steps: (v.analysis?.roadmap || []).filter(s => s.priority > 0).map(v1Step) }),
  translate: (x, lang) => inLang(lang, () => translateDeep(x)),
  search: (q, limit) => searchList(q, limit), quote: id => quoteOf(id),
  linkOf: id => discordLinks.linkOf(id), linkPage: true, // привязки со страницы /discord (discord-link.js)
  // /link и /unlink в Discord — та же привязка, что на /discord; 5 попыток за 10 минут, чтобы не тратить лимит Hypixel
  ...(discordLinking.enabled ? { link: (u, n) => discordLinking.link(u, n), unlink: u => discordLinking.unlink(u), allowLink: id => botLinkLimit.hit(id) === 0 } : {}),
  allowNick: (user, nick) => players.isOwner({ player: nick, profile: '' }) || (botNickLimit.allow(`u:${user}`, nick) && botAllLimit.allow('all', nick)),
  commandsFile: path.join(config.dataDir, 'discord-commands.json'), verifyFile: path.join(config.dataDir, 'discord-verify.json'),
});
app.use(discordBot.router);
app.use(auth.router); // вход: ник + пароль сайта (data/users.json) — до всех страниц и /api; req.sbUser — кто вошёл
// Лимит запросов с одного адреса (владельцу не мешает): картинки — отдельно, их на странице сотни
const IMG_API = /^\/(img|texture|skin|head|icon)s?\//;
const isAdminReq = req => !!req.sbUser?.admin;
const apiLimit = apiRateLimit({ clientIp: auth.clientIp, max: Number(process.env.API_PER_MIN) || 600, skip: isAdminReq });
const imgLimit = apiRateLimit({ clientIp: auth.clientIp, max: Number(process.env.IMG_PER_MIN) || 3000, skip: isAdminReq });
const streams = createConnLimiter(Number(process.env.STREAMS_PER_IP) || 8);
app.use('/api', (req, res, next) => (IMG_API.test(req.path) ? next() : apiLimit(req, res, next)));
app.use('/api', (req, res, next) => (IMG_API.test(req.path) ? imgLimit(req, res, next) : next()));

// Чужие профили (друзья, кооп-соседи, свои другие профили): заголовки X-SB-Player / X-SB-Profile.
// Без них — свой основной профиль, как раньше. req.sbView() → { owner, member, analysis, ... } выбранного игрока
// Друг, вошедший под своим ником, без заголовков видит СВОЙ профиль (self) — как владелец свой.
// Открытый просмотр: держим в памяти до 60 чужих профилей (раньше 12 — хватало друзьям)
const historyFiles = createHistoryFiles(path.join(config.dataDir, 'history'));
// Скрытые от статистики посещений (панель владельца): владелец, его кооп, друзья, все аккаунты сайта и HIDDEN_PLAYERS.
// uuid хранятся на диске и при запуске дополняются по никам через Mojang: кооп-сосед известен только по uuid
const blockedFile = path.join(config.dataDir, 'leaderboard-blocked.json');
const boardBlocked = new Set((() => { try { return JSON.parse(fs.readFileSync(blockedFile, 'utf8')); } catch { return []; } })());
let blockedReady = false; // пока ники скрытых не переведены в uuid, соседей без ника считаем скрытыми
function addBlocked(uuid) {
  const u = String(uuid || '').replace(/-/g, '').toLowerCase();
  if (!u || boardBlocked.has(u)) return;
  boardBlocked.add(u);
  try { fs.mkdirSync(config.dataDir, { recursive: true }); fs.writeFileSync(blockedFile, JSON.stringify([...boardBlocked])); } catch (e) { console.warn('[рейтинг]', e.message); }
}
const boardHiddenNames = () => new Set([config.player, state.player?.name, ...auth.users.list().map(u => u.name), ...seedFriends().map(f => f.name), ...hiddenPlayers()]
  .filter(Boolean).map(n => String(n).toLowerCase()));
// Рейтинг: скрыты только игроки из HIDDEN_PLAYERS (попросили скрыть профиль) и те, кто сам нажал «Убрать меня».
// Владелец и друзья с 24.11.2026 стоят в рейтинге как обычные игроки (просьба владельца): без пометок и особого порядка
const boardFilter = createHiddenFilter({ names: () => hiddenPlayers(), resolveUuid });
async function resolveBoardBlocked() {
  let ok = true;
  for (const n of boardHiddenNames()) {
    try { const r = await resolveUuid(n); if (r?.uuid) addBlocked(r.uuid); else ok = false; } catch { ok = false; }
  }
  if (state.player?.uuid) addBlocked(state.player.uuid);
  blockedReady = ok;
  const okHidden = await boardFilter.resolve();
  return ok && okHidden;
}
function excludedFromStats({ uuid, name, profileId }) {
  const n = String(name || '').toLowerCase();
  const id = String(uuid || '').replace(/-/g, '').toLowerCase();
  if (id && boardBlocked.has(id)) return true;
  if (!n && !blockedReady) return true;
  const own = state.player, m = state.member;
  if (uuid && (uuid === own?.uuid || uuid === m?.uuid || (m?.coopRoster || []).some(c => c.uuid === uuid))) return true;
  if (profileId && profileId === m?.profileId) return true;
  const hide = n && boardHiddenNames().has(n);
  if (hide && id) addBlocked(id);
  return !!hide;
}
// Гильдии, которые сайт уже узнал (кэш ядра, без новых запросов): рейтинг показывает их сразу,
// не дожидаясь, пока профиль игрока запишут в таблицу заново
const knownGuilds = new Map();
const guildForBoard = (uuid, opts) => guildFor(uuid, opts).then(g => { if (g) knownGuilds.set(uuid, g); if (knownGuilds.size > 5000) knownGuilds.delete(knownGuilds.keys().next().value); return g; });
const board = createLeaderboard({ file: path.join(config.dataDir, 'leaderboard.json'), isExcluded: boardFilter.isExcluded, guildOf: uuid => knownGuilds.get(uuid), onlineOf: uuid => { const s = knownStatus(uuid); return s?.online ? { island: s.island || null } : null; } });
// Свой основной профиль владельца обновляет state.js, а не players.js — кладём его в рейтинг так же, как чужие.
// Только когда цены загружены: иначе богатство = одни монеты
const recordOwner = () => { if (state.status === 'ok' && state.member && pricesReady()) board.record({ player: state.player, member: state.member, analysis: state.analysis, updatedAt: state.updatedAt }); };
bus.on('profile', recordOwner); bus.on('prices', recordOwner);
bus.on('profile', () => warmEnAnalysis()); bus.on('prices', () => warmEnAnalysis());
const players = createPlayers({ owner: () => state, ownerName: () => config.player, maxViews: 60, diskCache: createDiskCache({ dir: path.join(config.dataDir, 'hypixel-cache') }), rankFor, guildFor: guildForBoard, bingoFor: bingoRawFor, bingoEvent, statusFor, historyFiles, keepHistory: name => !!auth.users.get(name), onUpdate: v => board.record(v) });
auth.setProfileLookup(name => players.profileNames(name)); // проверка профиля друга на /account
// Гость без входа может открыть не больше 30 разных ников за 10 минут с одного IP — чтобы перебор ников не съел лимит Hypixel
const guestLimiter = createGuestLimiter({ max: Number(process.env.GUEST_PLAYERS_PER_10MIN) || 30 });
app.use('/api', (req, res, next) => {
  const u = req.sbUser;
  let want = readViewRequest(req);
  if (req.sbGuest && want && !players.isOwner(want) && !guestLimiter.allow(auth.clientIp(req), `${want.player}/${want.profile}`.toLowerCase())) {
    return res.status(429).json({ status: 'error', error: 'Слишком много разных игроков за 10 минут. Подожди немного или войди на сайт', errorCode: 'RATE' });
  }
  const home = u && !auth.users.isOwner(u.name) ? { player: u.name, profile: u.profile || '' } : null;
  if (!want && home) want = home;
  // Игрок попросил скрыть профиль (HIDDEN_PLAYERS): посторонним не показываем, сам игрок и владелец видят
  if (want && String(want.player || '').toLowerCase() !== String(u?.name || '').toLowerCase() && !u?.admin && hiddenPlayers().has(String(want.player || '').toLowerCase())) {
    return res.status(404).json({ status: 'error', error: 'Игрок попросил не показывать его профиль на этом сайте', errorCode: 'HIDDEN' });
  }
  // Свой профиль — и когда друг явно выбрал себя в переключателе (любой из своих профилей); гость смотрит любой профиль как чужой
  const self = !req.sbGuest && (!want || (!!home && want.player.toLowerCase() === home.player.toLowerCase()));
  req.sbWant = want;
  req.sbSelf = self;
  // Вкладка в фоне (клиент шлёт X-SB-Hidden: 1): данные отдаём из кэша, ради неё лимит Hypixel не тратим
  const visible = req.get('X-SB-Hidden') !== '1';
  req.sbView = async ({ force = false } = {}) => {
    // Гость без ника не получает «профиль по умолчанию» (это профиль владельца) — сайт просит ввести ник
    if (!want && req.sbGuest) { const e = new Error('Введи ник игрока'); e.code = 'NO_PLAYER'; throw e; }
    if (!want || players.isOwner(want)) {
      if (visible || force) markOwnerWatched();
      const mine = !req.sbGuest && (self || !home);
      // Лента событий и история владельца — то, что сайт копит сам (когда играл, что покупал). Посторонним — нет
      return { owner: true, self: mine, want, ...state, ...(mine || u?.admin ? {} : { feed: [], history: [] }) };
    }
    // Свой профиль друга обновляется чаще (раз в минуту, пока открыт), чужие — раз в 3 минуты
    const t0 = Date.now();
    const v = await players.get(want, { force, ttlMs: self ? 3 * 60_000 : undefined, passive: !visible && !force });
    // Кэш профилей: данные собраны до этого запроса — ушли сразу из памяти; собраны сейчас — ждали Hypixel
    perf.profileView(!!v.member && v.updatedAt < t0);
    // У друзей с аккаунтом сайт хранит историю постоянно: она видна только им самим и владельцу
    // Ник берём уже определённый (по uuid или русской раскладке спросить могли иначе)
    const hideTracked = !self && !u?.admin && [want.player, v.player?.name, fixNick(want.player)].some(n => n && auth.users.get(n));
    return { owner: false, self, want, ...v, ...(hideTracked ? { feed: [], history: [], historyKey: null } : {}) };
  };
  next();
});

// Подсказки по тексту для всего сайта: общий словарь терминов и данные подсказок (server/guides/refs.js)
app.get('/api/refs/lexicon', (req, res) => {
  // Пока база NEU грузится (сразу после запуска), словарь неполный: без кеша и с ready:false — клиент спросит ещё раз
  const ready = neu.items.size > 0;
  res.set('Cache-Control', ready ? 'public, max-age=3600' : 'no-store');
  res.json({ v: neu.loadedAt || 0, ready, phrases: lexiconPhrases(neu.items, neu.constants), warps: warpTable(neu.constants) });
});
app.get('/api/refs/data', (req, res) => {
  const list = String(req.query.r || '').split('|').filter(Boolean).slice(0, 300);
  res.set('Cache-Control', 'public, max-age=600');
  res.json(refsData(list, { items: neu.items, constants: neu.constants, price: priceOf }));
});

// Живой советчик: сторож изменений + Claude (ключ ANTHROPIC_API_KEY в .env). Маршруты /api/live/* — за паролем сайта.
app.use('/api/live', auth.requireUser); // вторая защита: советчик гостю недоступен при любом написании адреса
const liveAdvisor = attachLiveAdvisor({
  app, bus, state, dataDir: config.dataDir,
  deps: {
    priceOf, priceInfo, priceTrend, itemName: id => itemName(id), getItemRu, searchItems, pricesRaw: prices, itemValue,
    history: () => state.history, // почасовая история своего профиля → «куда ушло время» в диагнозе советчика
    calendar: () => calendarBrief(), // мэр и события сейчас → раздел «Сейчас в игре» в сводке советчика
    neuItems: () => neu.items, // названия предметов в ответах чата → ссылки (live-advisor/lib/links.js)
    // NPC, мобы, места и механики в ответах чата — тем же словарём, что и в гайдах (server/guides/refs.js)
    textRefs: text => enrichGuide({ status: 'ok', sections: [{ kind: 'text', text }] }, { items: neu.items, constants: neu.constants, price: priceOf }).refs,
  },
});
// Удалили или переименовали аккаунт друга — его чат с советчиком удаляется или переезжает вместе с ним
auth.events.on('removed', name => { try { liveAdvisor.forgetUser(name); } catch (e) { console.warn('[советчик]', e.message); } });
auth.events.on('renamed', (from, to) => { try { liveAdvisor.renameUser(from, to); } catch (e) { console.warn('[советчик]', e.message); } });

// ---------- API ----------
function hideCoopMates(m) {
  return {
    ...m,
    coopRoster: (m.coopRoster || []).filter(c => c.uuid === m.uuid),
    coop: m.coop ? { ...m.coop, members: m.coop.members.map(x => (x.self || x.uuid === m.uuid ? x : { ...x, uuid: null })) } : m.coop,
  };
}
// Разбор для /api/state: тяжёлые куски разделов (снаряжение, аксессуары, нижние блоки «Прогресса», Pet Score, карта)
// уходят в /api/part/:name (server/lib/state-parts.js), methods (~170 КБ) «Заработок» грузит сам (/api/market/money).
// Было ~400 КБ (89 КБ сжатый) на каждое открытие и раз в минуту, стало в несколько раз меньше.
function slimAnalysis(a) {
  if (!a) return a;
  const { methods, ...rest } = a;
  return lightAnalysis(rest);
}
// Английский разбор (план, советы, подписи) переводим один раз на каждый новый разбор, а не на каждый запрос:
// разбор пересчитывается целиком (новый объект) при обновлении профиля или цен
const enAnalyses = new WeakMap();
let enSeenAt = 0; // когда последний раз открывали английскую версию — без гостей на /en/ заранее не переводим
function analysisFor(a) {
  if (!a || !isEn()) return slimAnalysis(a);
  enSeenAt = Date.now();
  let out = enAnalyses.get(a);
  if (!out) { out = translateDeep(slimAnalysis(a)); enAnalyses.set(a, out); }
  return out;
}
// После обновления своего профиля готовим английский разбор сразу, в простое, чтобы запрос не ждал перевода
function warmEnAnalysis() {
  if (Date.now() - enSeenAt > 3 * 3600_000) return;
  setImmediate(() => { const a = state.analysis; if (a && !enAnalyses.has(a)) inLang('en', () => analysisFor(a)); });
}
app.get('/api/state', async (req, res) => {
  // Гость без ника: пустое состояние без чьих-либо данных (только время цен рынка для открытых страниц)
  if (req.sbGuest && !req.sbWant) {
    return res.json({ status: 'empty', error: null, demo: false, view: { owner: false, guest: true }, player: null, profiles: [], member: null, analysis: null, feed: [], history: [], updatedAt: 0, pricesAt: { bazaar: prices.bazaarAt, auctions: prices.binAt, auctionsError: prices.binError } });
  }
  let v;
  try { v = await req.sbView(); } catch (e) {
    // Не нашли игрока / нет профилей / лимит API — сайт показывает ошибку и переключатель, а не падает
    const want = req.sbWant;
    return res.json({ status: 'error', error: e.message, errorCode: e.code || null, view: { owner: false, self: !!req.sbSelf, player: want?.player, profile: want?.profile, failed: true }, player: null, profiles: [], member: null, analysis: null, feed: [], history: [], updatedAt: 0, pricesAt: { bazaar: prices.bazaarAt, auctions: prices.binAt } });
  }
  // Статистика: какой ник открыли (кроме владельца, друзей и скрытых; один раз на посетителя за день)
  if (!v.owner && !v.self && v.player?.name) monitor.nick(v.player.name, { ip: auth.clientIp(req), ua: String(req.headers['user-agent'] || ''), owner: !!req.sbUser?.admin }, v.player.uuid);
  // Чужой профиль: не отдаём uuid соседей по коопу (по ним находится ник) — только сам игрок и число участников
  const m = v.member && !seesCoop(req, v) ? hideCoopMates(v.member) : v.member;
  res.json({
    status: v.status, error: v.error, errorCode: v.errorCode || null,
    // Ключ Hypixel на паузе после 429: показаны последние данные, обновятся после этого времени
    limitedUntil: keyedPause()?.until || null, demo: v.owner ? !!state.demo : false,
    // owner — «это мой профиль» для того, кто вошёл (у друга — его собственный); live — профиль владельца сайта с живыми событиями
    view: v.self ? { owner: true, live: !!v.owner } : { owner: false, player: v.player?.name, profile: v.want?.profile || '', missingProfile: v.missingProfile || null },
    player: v.player, profiles: v.profiles, updatedAt: v.updatedAt,
    pricesAt: { bazaar: prices.bazaarAt, auctions: prices.binAt, auctionsError: prices.binError },
    neu: { items: neu.items.size, source: neu.source },
    // Музей без разобранных предметов (их сотни, с описаниями): полный разбор — /api/museum
    parts: partVersions({ member: v.member, analysis: v.analysis }),
    member: m ? { ...lightMember(m), inv: undefined, collections: undefined, coop: m.coop ? { members: m.coop.members } : null, apiDisabled: !!m.inv?.apiDisabled, museum: m.museum ? { status: m.museum.status, value: m.museum.value, appraisal: m.museum.appraisal, count: m.museum.count } : null } : null,
    analysis: analysisFor(v.analysis),
    feed: v.feed.slice(0, 60),
    // Для мини-графика на «Обзоре» хватает стоимости за 30 дней; полная история всех показателей — /api/history
    history: sliceRange(v.history, 30 * 24 * 3600_000).map(h => ({ t: h.t, nw: h.nw })),
  });
});

// Кусок раздела выбранного игрока: /api/part/gear?v=<версия из state.parts>.
// Версия совпала — тот же адрес всегда отдаёт те же данные, браузер хранит ответ у себя и больше не спрашивает.
// Не совпала (профиль успел обновиться) — отдаём свежие данные с их версией и без долгого кэша.
// Английская версия куска: готовый JSON переводим один раз на версию (ответ отдаётся строкой, мимо res.json)
const enParts = new Map();
function enPart(name, p) {
  const key = `${name}:${p.v}`;
  let out = enParts.get(key);
  if (!out) {
    out = JSON.stringify({ status: 'ok', v: p.v, data: translateDeep(JSON.parse(p.json)) });
    if (enParts.size > 300) enParts.delete(enParts.keys().next().value);
    enParts.set(key, out);
  }
  return out;
}
app.get('/api/part/:name', async (req, res) => {
  if (!PARTS[req.params.name]) return res.status(404).json({ error: 'Нет такого раздела' });
  let v;
  try { v = await req.sbView(); } catch (e) { return res.json({ status: 'error', error: e.message, errorCode: e.code || null }); }
  const p = statePart({ member: v.member, analysis: v.analysis }, req.params.name);
  if (!p) return res.json({ status: 'empty', v: null, data: null });
  res.set('Cache-Control', req.query.v === p.v ? 'private, max-age=31536000, immutable' : 'private, no-cache');
  if (req.sbLang === 'en') return res.type('application/json').send(enPart(req.params.name, p));
  res.type('application/json').send(`{"status":"ok","v":"${p.v}","data":${p.json}}`);
});

// История всех показателей: /api/history?range=7d|30d|365d|all (по умолчанию all)
const RANGES = { '1d': 1, '7d': 7, '30d': 30, '365d': 365 };
app.get('/api/history', async (req, res) => {
  const v = await req.sbView().catch(() => null);
  if (!v) return res.json({ points: [], tracked: false });
  const days = RANGES[String(req.query.range || '')] || 0;
  const all = v.history || [];
  res.json({
    points: sliceRange(all, days * 24 * 3600_000),
    since: all[0]?.t || null,
    // У чужого профиля без аккаунта история живёт только пока его смотрят: так и пишем на странице
    tracked: !!(v.owner || v.historyKey),
  });
});

app.get('/api/inventory', async (req, res) => {
  const v = await req.sbView().catch(() => null);
  res.json(v?.member?.inv || null);
});

// «Сообщить об ошибке»: отправить может любой посетитель (и гость), список отзывов — только владельцу
const feedback = createFeedback({ dataDir: config.dataDir });
mountFeedbackRoutes(app, { express, feedback, clientIp: auth.clientIp, requireAdmin: auth.requireAdmin });
// «Опрос»: каким быть советчику (server/survey). Ответы — data/survey.json; SURVEY_GOAL — сколько прошедших до пилота
mountSurveyRoutes(app, { express, store: createSurveyStore(config.dataDir), clientIp: auth.clientIp, requireAdmin: auth.requireAdmin, goal: Number(process.env.SURVEY_GOAL) || 100, langOf: () => (isEn() ? 'en' : 'ru') });
app.get('/api/players/stats', (req, res) => res.json(players.stats()));
mountLeaderboardRoutes(app, { board, express, isAdmin: req => !req.sbGuest && (!req.sbUser || !!req.sbUser.admin) });

// Сравнение профилей: /api/compare?p=Steve/Apple&p=Alex/Banana (до 4 игроков). Пустой профиль — тот, где игрок играет
app.get('/api/compare', async (req, res) => {
  const raw = [].concat(req.query.p || []).map(String).filter(Boolean).slice(0, 4);
  if (!raw.length) return res.status(400).json({ error: 'Выбери хотя бы одного игрока' });
  const out = await Promise.all(raw.map(async s => {
    const [player, profile = ''] = s.split('/').map(x => x.trim());
    const want = { player: player.slice(0, 32), profile: profile.slice(0, 40) };
    if (!req.sbUser?.admin && want.player.toLowerCase() !== String(req.sbUser?.name || '').toLowerCase() && hiddenPlayers().has(want.player.toLowerCase())) {
      return { query: want, error: 'Игрок попросил не показывать его профиль на этом сайте', errorCode: 'HIDDEN' };
    }
    if (req.sbGuest && !players.isOwner(want) && !guestLimiter.allow(auth.clientIp(req), `${want.player}/${want.profile}`.toLowerCase())) {
      return { query: want, error: 'Слишком много разных игроков за 10 минут. Подожди немного или войди на сайт', errorCode: 'RATE' };
    }
    try {
      const v = players.isOwner(want) ? { ...state } : await players.get(want);
      if (!v.member) throw new Error(v.error || 'Профиль ещё не загружен');
      return summarizeForCompare(v);
    } catch (e) { return { query: want, error: e.message, errorCode: e.code || null }; }
  }));
  res.json({ players: out, at: Date.now() });
});

// Кооп-соседи открытого профиля с никами: быстрый переход к ним в переключателе и «Сравнить с коопом»
// Друзья и соседи анонимны: ники соседей видит только сам игрок на своём профиле и владелец сайта, гость — никогда
const seesCoop = (req, v) => !req.sbGuest && (!!v?.self || !!req.sbUser?.admin);
app.get('/api/coop', async (req, res) => {
  const v = await req.sbView().catch(() => null);
  if (!v?.member || !seesCoop(req, v)) return res.json({ profile: v?.member?.profileName || null, members: [] });
  try { res.json(await players.coopOf(v.member)); } catch (e) { res.json({ profile: v.member.profileName, members: [], error: e.message }); }
});

// Версия сборки сайта: меняется после npm run build. Открытые вкладки сравнивают её и сами перезагружаются
function buildId() {
  try {
    const html = fs.readFileSync(path.join(config.webDist, 'index.html'), 'utf8');
    return (/<script[^>]+type="module"[^>]+src="[^"]*\/assets\/([^"]+)"/.exec(html) || /src="[^"]*\/assets\/([^"]+\.js)"/.exec(html) || [])[1] || 'dev';
  } catch { return 'dev'; }
}
app.get('/api/version', (req, res) => res.json({ build: buildId() }));
// Лампочка нагрузки для игроков и подробная панель для владельца (#/status)
app.get('/api/status', (req, res) => res.set('Cache-Control', 'no-store').json(status.publicStatus()));
app.get('/api/admin/status', auth.requireAdmin, (req, res) => res.set('Cache-Control', 'no-store').json({ ...status.adminStatus(), perf: perf.summary() }));
// Посещения, ошибки, тревоги и почта — блоки на странице «Сервер»
app.get('/api/admin/monitor', auth.requireAdmin, (req, res) => res.set('Cache-Control', 'no-store').json({ ...monitor.summary(), geo: geo.info() }));
app.post('/api/admin/monitor/resolve', auth.requireAdmin, express.json({ limit: '1kb' }), (req, res) => res.json({ ok: monitor.resolve(String(req.body?.fp || '')) }));
app.post('/api/admin/monitor/test-mail', auth.requireAdmin, async (req, res) => {
  if (!mailerInfo().configured) return res.json({ ok: false, error: 'Почта не настроена: впиши в .env SMTP_USER и SMTP_PASS (или RESEND_API_KEY, или MAIL_DOMAIN)' });
  try {
    // Шлём через smtp.js напрямую, чтобы показать, каким способом письмо ушло и почему не ушло напрямую
    const r = await sendSmtp(smtpConfig(), { subject: '[Sky Guide] Проверка почты', text: tx`Если ты читаешь это письмо, тревоги и сводки будут приходить сюда.\n\nКак выглядит ежедневная сводка:\n\n${monitor.digestText()}` });
    res.json({ ok: true, via: r.via, failed: r.failed || [] });
  } catch (e) { res.json({ ok: false, error: String(e.message || e).slice(0, 200) }); }
});
app.post('/api/admin/monitor/test-discord', auth.requireAdmin, async (req, res) => {
  if (!discordAlerts.enabled) return res.json({ ok: false, error: 'Discord не настроен: впиши в .env DISCORD_ALERTS_WEBHOOK (webhook закрытого канала) и перезапусти сайт' });
  try { res.json({ ok: await discordAlerts.send({ title: 'Проверка: тревоги и сводка будут приходить сюда', text: `Как выглядит ежедневная сводка:\n\n${monitor.digestText()}`, kind: 'test' }) }); } catch (e) { res.json({ ok: false, error: String(e.message || e).slice(0, 200) }); }
});

// Прямая отправка писем: какие DNS-записи нужны и какие уже есть (docs/mail.md)
app.get('/api/admin/mail/check', auth.requireAdmin, async (req, res) => {
  const cfg = smtpConfig();
  if (cfg?.transport !== 'direct') return res.json({ ok: false, error: 'Прямая отправка выключена: впиши в .env MAIL_DOMAIN=домен сайта и перезапусти сайт' });
  try { res.set('Cache-Control', 'no-store').json({ ok: true, ...(await checkMailDns(cfg)) }); } catch (e) { res.json({ ok: false, error: String(e.message || e).slice(0, 200) }); }
});

app.get('/api/stream', (req, res) => {
  const ip = auth.clientIp(req);
  if (!streams.take(ip)) return res.status(429).json({ error: 'Слишком много открытых вкладок с одного адреса' });
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  const onProfile = () => send('profile', { updatedAt: state.updatedAt, status: state.status });
  const onPrices = () => send('prices', { bazaar: prices.bazaarAt, auctions: prices.binAt });
  const onLive = d => send('live', d);
  send('hello', { build: buildId() });
  bus.on('profile', onProfile); bus.on('prices', onPrices);
  if (!req.sbGuest) bus.on('live', onLive); // события советчика — про профиль владельца, гостю они не нужны
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => { streams.release(ip); bus.off('profile', onProfile); bus.off('prices', onPrices); bus.off('live', onLive); clearInterval(ping); });
});

let lastManualRefresh = 0;
app.post('/api/refresh', async (req, res) => {
  const want = req.sbWant;
  if (!want && req.sbGuest) return res.json({ ok: false, status: 'error', error: 'Введи ник игрока' });
  const lim = keyedPause();
  if (lim) return res.json({ ok: false, status: 'limited', errorCode: 'RATE', limitedUntil: lim.until, error: lim.daily ? 'Суточный лимит запросов к Hypixel исчерпан: показаны последние данные' : 'Hypixel просит подождать: показаны последние данные' });
  if (!want || players.isOwner(want)) {
    // Друзья тоже могут обновить профиль владельца, но не чаще раза в 20 секунд на всех (лимит Hypixel)
    if (req.sbUser?.admin || Date.now() - lastManualRefresh > 20_000) { lastManualRefresh = Date.now(); await refreshProfile(); }
    return res.json({ ok: true, status: state.status });
  }
  try { const v = await req.sbView({ force: true }); res.json({ ok: true, status: v.error ? 'error' : v.status, error: v.error }); }
  catch (e) { res.json({ ok: false, status: 'error', error: e.message }); }
});

// Товары Bazaar с подтипом («INK_SACK:3» — какао-бобы) в базе NEU записаны как «INK_SACK-3»
const neuIdOf = id => String(id).replace(/:(\d+)$/, '-$1');
// Изменение цен за сутки для списка «Рынка»: по почасовой истории, считается раз на обновление Bazaar
let dayCache = { at: -1, map: new Map() };
// Рост за сутки — только у живых товаров: обе цены есть и в неделю больше ~70 сделок (10 в день). Иначе у товаров
// почти без сделок (Dedication III, осколки) один ордер за 1 монету вчера давал миллионы процентов.
const MIN_WEEK_DEALS = 70;
// И стакан должен быть настоящим: покупка не дороже продажи больше чем в 3 раза. У Karma III (покупка 3 млн, продажа 12)
// или Cobblestone (продажа меньше монеты) одна сторона пустая или выставлена ради шутки — их «рост» ничего не значит.
const MAX_BUY_SELL = 3;
const dayChange = id => {
  if (dayCache.at !== prices.bazaarAt) dayCache = { at: prices.bazaarAt, map: new Map() };
  if (dayCache.map.has(id)) return dayCache.map.get(id);
  const pts = prices.history[id], p = prices.bazaar.get(id);
  let v = null;
  if (pts?.length && p && p.buy > 0 && p.sell >= 1 && p.buy <= p.sell * MAX_BUY_SELL && (p.buyWeek || 0) + (p.sellWeek || 0) >= MIN_WEEK_DEALS) {
    const buy = dayChangePct(pts, p.buy, 1), sell = dayChangePct(pts, p.sell, 2);
    if (buy != null || sell != null) v = { buy, sell };
  }
  dayCache.map.set(id, v);
  return v;
};
// Категория для фильтров «Рынка» (Farming, Mining, Книги…; у аукциона — Оружие, Броня, Питомцы…), кэш: правил много, товаров тысячи
let catCache = new Map(), catAt = -1;
const catOf = id => {
  if (catAt !== neu.loadedAt) { catCache = new Map(); catAt = neu.loadedAt; } // база предметов перезагрузилась — категории заново
  let c = catCache.get(id); if (!c) { c = categoryKey(id, { kind: itemCategory }); catCache.set(id, c); } return c; };
// ?cat=farming — только эта категория (ключи — CATEGORY_KEYS); ?rarity=EPIC — только эта редкость (аукцион)
const marketWhere = q => {
  const cat = q.cat ? String(q.cat) : '', rar = q.rarity ? String(q.rarity) : '';
  return cat || rar ? r => (!cat || r.cat === cat) && (!rar || r.rarity === rar) : null;
};
const bazaarRow = (id, p) => {
  const nid = neuIdOf(id);
  // Название по-русски из items-ru (имена собственные там английские), английское — для поиска и подсказки
  const row = { id, name: displayName(id, neu.items), nameEn: itemName(id), ...p, spread: p.buy - p.sell, d1: dayChange(id), cat: catOf(id) };
  if (nid !== id) row.neuId = nid; // для иконки и карточки предмета
  return row;
};
// ?paged=1 — { total, items } по всем товарам Bazaar (поиск, sort=ключ:направление, offset, limit); без него — массив (старый формат)
// Русский, транслит и жаргон («печенька», «рекомб», «зачарованный алмаз») — через базу items-ru
const marketSearchIds = q => { try { return new Map(searchItems(q, { limit: 300, scores: true }).map((r, i) => [r.id, { at: i, score: r.score }])); } catch { return null; } };
// Список Bazaar для /api/bazaar и /v1/bazaar: { total, items } (поиск, sort=ключ:направление, offset, limit, cat)
const bazaarIds = ids => [...new Set(ids)].filter(id => prices.bazaar.has(id)).map(id => bazaarRow(id, prices.bazaar.get(id)));
const bazaarList = q => listBazaar(prices.bazaar, {
  q: q.q, sort: q.sort, offset: q.offset, limit: q.limit || 200, row: bazaarRow,
  where: marketWhere(q), facets: { cat: r => r.cat },
  searchIds: marketSearchIds,
  keyOf: id => { try { return normalizeId(id); } catch { return id; } },
});
app.get('/api/bazaar', (req, res) => {
  // ?ids=A,B — конкретные товары (избранное), без фильтра по запросу и лимита
  if (req.query.ids) return res.json(bazaarIds(String(req.query.ids).split(',').filter(Boolean).slice(0, 200)));
  const out = bazaarList(req.query);
  res.json(req.query.paged ? out : out.items);
});
// Аукцион на «Рынке»: список предметов AH (lowest BIN, продажи, изменение за сутки) и их варианты
const ahList = createAhList({
  prices, name: id => displayName(id, neu.items), nameEn: id => itemName(id), cat: catOf, rarity: id => itemRarity(id),
  isPet: id => /;\d$/.test(id) && /^\[Lvl/.test(neu.items.get(id)?.name || ''),
});
// ?q=&sort=&offset=&limit= — { total, items } по всем предметам аукциона; ?ids=A,B — конкретные (избранное, карточка)
// &vars=1 — с вариантами (звёзды, Recomb, редкость питомца): для карточки выбранного предмета
const ahIds = (ids, vars = false) => ids.map(k => { const r = ahList.row(k); return r && vars ? { ...r, variants: ahList.variants(k) } : r; }).filter(Boolean);
const ahQuery = q => listBazaar(ahList.rows(), {
  q: q.q, sort: q.sort, offset: q.offset, limit: q.limit || 200, row: (id, r) => r, sorts: AH_SORTS,
  where: marketWhere(q), facets: { cat: r => r.cat, rarity: r => r.rarity },
  searchIds: marketSearchIds,
  keyOf: id => { try { return normalizeId(id.split(';')[0]); } catch { return id; } },
});
app.get('/api/market/ah', (req, res) => {
  if (req.query.ids) return res.json(ahIds(String(req.query.ids).split(',').filter(Boolean).slice(0, 200), !!req.query.vars));
  res.json(ahQuery(req.query));
});
// Биржевые графики «Рынка»: свечи Bazaar копятся на диске (data/market), аукциона — data/market-ah; API /api/market/candles/:id
const charts = createCharts({
  dataDir: config.dataDir, prices, itemName: id => itemName(id), ahList,
  textRefs: text => enrichGuide({ status: 'ok', sections: [{ kind: 'text', text }] }, { items: neu.items, constants: neu.constants, price: priceOf }).refs,
});
charts.mount(app);
auctionHooks.scan = (lowest, variants, ts) => charts.onAuctionScan(lowest, variants, ts);
// Продажи в свечи пишем временем «сейчас»: они приходят с опозданием до минуты, а свечи дописываются по порядку
auctionHooks.sale = (key, price, ts, qty) => charts.onAuctionSale(key, price, Date.now(), qty);
mountPriceRoutes(app, {
  getMember: async req => (await req.sbView().catch(() => null))?.member || null,
  getView: req => req.sbView(), // «Заработок»: если профиля нет — настоящая причина (сервер запускается, Hypixel не ответил…)
  // богатство игрока: чтобы не советовать крафты дороже того, что он может себе позволить
  getNetworth: async req => (await req.sbView().catch(() => null))?.analysis?.gear?.networth?.total || 0,
  // «Подсказки по тексту» (как в гайдах): словарь NPC, мобов, мест, механик и предметов для разбора методов
  textRefs: text => enrichGuide({ status: 'ok', sections: [{ kind: 'text', text }] }, { items: neu.items, constants: neu.constants, price: priceOf }).refs,
});
mountSkinRoutes(app);
// Ручные отметки Enigma Souls для гайда по Рифту — свои у каждого игрока (старые общие = владельца)
setRiftOwner(() => state.player?.uuid);
mountRiftRoutes(app, { getUuid: async req => (await req.sbView()).member?.uuid || null, canWrite: async req => !!(await req.sbView()).self });
// Ручные отметки Fairy Souls для гайда «Души и коллекции» (Hypixel отдаёт только их число)
mountCollectRoutes(app, { getUuid: async req => (await req.sbView()).member?.uuid || null, canWrite: async req => !!(await req.sbView()).self });
// Скрытые шаги плана: у вошедшего владельца профиля хранятся на сервере (видны на всех его устройствах)
mountHiddenRoutes(app, { getView: req => req.sbView(), isGuest: req => !!req.sbGuest });
// План покупок с правками игрока: убрать шаг, добавить свою вещь (у гостя список в браузере, сервер только считает)
mountCartRoutes(app, { getView: req => req.sbView(), isGuest: req => !!req.sbGuest, price: buyPriceOf, name: id => itemName(id)?.replace(/§./g, '') || id,
  items: () => neu.items, constants: () => neu.constants });
// Чек-лист улучшений своих экземпляров предмета: /api/item/:id/upgrades (для выбранного игрока — своего или друга)
mountNewsRoutes(app, { skyblockNews, // «Новости»: журнал изменений сайта, GET /api/news (записи — server/news/entries.js)
  textRefs: text => enrichGuide({ status: 'ok', sections: [{ kind: 'text', text }] }, { items: neu.items, constants: neu.constants, price: priceOf }).refs,
});
mountCalendarRoutes(app, { calendar }); // мэр, выборы и календарь событий: GET /api/calendar
mountMuseumRoutes(app, { getView: req => req.sbView(), deps: museumDeps });
// Мешки и эссенции выбранного игрока: /api/sacks, /api/essence
mountStashRoutes(app, { getView: req => req.sbView(), stash });
// Коллекции (тиры, что откроет следующий) и миньоны (слоты, что крафтить, доходность): /api/collections, /api/minions
mountCollectionRoutes(app, { getView: req => req.sbView(), deps: collectionDeps });
mountMinionRoutes(app, { getView: req => req.sbView(), deps: minionDeps });
mountObtainRoutes(app, { getMember: async req => (await req.sbView().catch(() => null))?.member || null, neu, prices, getCollections: () => moneyMod.craftCollections });
mountItemUpgradeRoutes(app, async req => (await req.sbView().catch(() => null))?.member || null, upgradeDeps);
// Bank (проценты, счета), Bits (Community Shop), Maxwell (силы и Tuning): /api/bank, /api/bits, /api/maxwell
mountWealthRoutes(app, { getMember: async req => (await req.sbView().catch(() => null))?.member || null, prices, priceOf, itemName });
// «Мои лоты»: свои лоты Auction House и ставки выбранного игрока. Запрос к Hypixel — только когда вкладку открыли,
// не чаще раза в 3 минуты на игрока (core/src/player-auctions.js); ордера Bazaar Hypixel API не отдаёт
const playerAuctions = createPlayerAuctions();
const auctionsOf = v => (v?.player?.uuid ? playerAuctions.view({ uuid: v.player.uuid, profileId: v.member?.profileId || null }) : null);
app.get('/api/my-auctions', async (req, res) => {
  res.set('Cache-Control', 'private, no-cache');
  if (req.sbGuest && !req.sbWant) return res.json({ status: 'empty' });
  try {
    const out = await auctionsOf(await req.sbView());
    res.json(out ? { status: 'ok', ...out } : { status: 'empty' });
  } catch (e) { res.json({ status: 'error', error: e.message, errorCode: e.code || null, limitedUntil: e.limitedUntil || null }); }
});
// Гайды по направлениям (данжи, слееры, Kuudra, Рифт, рыбалка…): /api/guides, /api/guides/:id
mountGuideRoutes(app, {
  // гайды — для выбранного игрока (свой профиль или друг); гость без ника читает их без привязки к профилю
  getView: req => (req.sbGuest && !req.sbWant ? Promise.resolve({ member: { guest: true, inv: {} }, analysis: {} }) : req.sbView()),
  deps: guideDeps,
});
app.get('/api/flips', (req, res) => res.json(bazaarFlips({ maxPrice: Number(req.query.max || Infinity) })));
app.get('/api/crafts', (req, res) => res.json(craftFlips()));
app.get('/api/crops', (req, res) => res.json(cropProfits(Number(req.query.fortune || 1500))));

// Поиск предметов: понимает русский, транслит и жаргон («гиперион», «терма», «аоте»)
// close — только похожее по звучанию («Refraction» → книги Reflection): поиск в шапке тогда ставит ник игрока выше
const searchList = (q, limit) => searchItems(q, { limit, scores: true })
  .map(r => ({ id: r.id, name: r.nameEn, nameRu: r.nameRu, rarity: r.rarity, type: r.typeRu || r.type, category: r.categoryRu, price: priceOf(r.id), ...(r.score < 60 ? { close: true } : {}) }));
app.get('/api/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  res.json(searchList(q, Math.max(1, Math.min(500, Number(req.query.limit) || 60))));
});

let usageIndex = null;
function usage(id) {
  if (!usageIndex) {
    usageIndex = new Map();
    for (const it of neu.items.values()) {
      const recs = [it.recipe, ...(it.recipes || [])].filter(Boolean);
      for (const r of recs) {
        const ings = [...Object.values(r).filter(v => typeof v === 'string' && v.includes(':')), ...(r.inputs || [])];
        for (const s of ings) {
          const iid = String(s).split(':')[0];
          if (!usageIndex.has(iid)) usageIndex.set(iid, new Set());
          usageIndex.get(iid).add(it.id);
        }
      }
    }
  }
  return [...(usageIndex.get(id) || [])].slice(0, 40).map(x => ({ id: x, name: itemName(x) || x }));
}

// Книги зачарований: на Bazaar id ENCHANTMENT_SHARPNESS_7, в NEU — SHARPNESS;7. Карточка из NEU, цены по id Bazaar
function bookIds(id) {
  const bz = /^ENCHANTMENT_(.+)_(\d+)$/.exec(id);
  if (bz) return { neuId: `${bz[1]};${bz[2]}`, priceId: id };
  const nu = /^([A-Z0-9_]+);(\d+)$/.exec(id);
  if (nu && /enchanted_book/i.test(neu.items.get(id)?.mcId || '')) return { neuId: id, priceId: `ENCHANTMENT_${nu[1]}_${nu[2]}` };
  return null;
}

// Две живые цены «купить / продать» для списка предметов (?ids=A,B; не больше 200): { id: quote | null }
app.get('/api/quotes', (req, res) => {
  const ids = String(req.query.ids || '').split(',').filter(Boolean).slice(0, 200);
  res.set('Cache-Control', 'no-store');
  res.json(Object.fromEntries(ids.map(id => [id, quoteOf(id)])));
});
// Карточка предмета: для /api/item/:id и /v1/items/{id}. null — нет ни в базе NEU, ни на рынке
async function itemCard(id, { lvl: wantLvl } = {}) {
  const book = bookIds(id);
  const it = (await getItem(id)) || (book && await getItem(book.neuId)) || (/:\d+$/.test(id) && await getItem(neuIdOf(id)));
  if (!it) {
    // Нет в базе NEU, но торгуется — отдаём хотя бы цены
    const pi = priceInfo(id);
    if (pi?.bazaar || pi?.bin) return { id, name: itemName(id) || id, lore: [], loreRu: [], prices: pi, npc: npcPrices.get(id) || null, usedIn: [], names: {} };
    return null;
  }
  // Цены Bazaar лежат под id рынка: «INK_SACK-3» из NEU → «INK_SACK:3»
  const priceId = book?.priceId || (/-\d+$/.test(it.id) && prices.bazaar.has(it.id.replace(/-(\d+)$/, ':$1')) ? it.id.replace(/-(\d+)$/, ':$1') : it.id);
  // Для книги понятное имя: «Ultimate Legion V» вместо общего «Enchanted Book»
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  const bookName = book && (() => { const [n, l] = book.neuId.split(';'); return `${n.toLowerCase().split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')} ${ROMAN[+l] || l}`; })();
  const names = ids => Object.fromEntries(ids.map(i => [i, neu.items.get(i.split(':')[0])?.name || i]));
  const ingIds = new Set();
  for (const r of [it.recipe, ...(it.recipes || [])].filter(Boolean)) {
    for (const v of Object.values(r)) if (typeof v === 'string' && v.includes(':')) ingIds.add(v.split(':')[0]);
    for (const v of r.inputs || []) ingIds.add(String(v).split(':')[0]);
    for (const d of r.drops || []) if (d.id) ingIds.add(String(d.id).split(':')[0]);
  }
  // Питомцы: числа из petnums вместо {STRENGTH}/{0}/{LVL} (по умолчанию для 100 уровня, ?lvl=N — для своего)
  const lvl = Math.max(1, Math.min(200, Number(wantLvl) || 100));
  const filled = fillPetLore(it.id, it.name, it.lore || [], neu.constants?.petnums, lvl);
  return {
    id: it.id, name: bookName || filled.name, rarity: it.rarity, rarityRu: rarityRu(it.rarity), type: it.type,
    lore: filled.lore, loreRu: translateLore(filled.lore).lines,
    recipe: it.recipe, recipes: it.recipes, info: it.info, crafttext: it.crafttext,
    names: names([...ingIds]),
    prices: priceInfo(priceId), npc: npcPrices.get(it.id) || null, priceId,
    usedIn: usage(it.id),
    gui: GUI_ITEMS[it.id] ? { ...GUI_ITEMS[it.id], refs: enrichGuide({ status: 'ok', sections: [{ kind: 'text', text: GUI_ITEMS[it.id].textRu }] }, { items: neu.items, constants: neu.constants, price: priceOf }).refs } : undefined,
    variable: variableView(it.id, Date.now(), sbTime),
    darkAuction: darkAuctionOf(it.id),
    props: itemProps(it.id, { bazaar: prices.bazaar.has(priceId) }),
    obtainment: obtainmentOf(it.id, x => itemName(x)?.replace(/§./g, '')),
    ru: withObtainment(patchReqLabels(getItemRu(it.id, { prices }), it.crafttext, fixCrafttext(it.crafttext, String(it.name || '').replace(/§./g, ''), moneyMod.craftCollections)), obtainmentOf(it.id, x => itemName(x)?.replace(/§./g, ''))),
  };
}
app.get('/api/item/:id', async (req, res) => {
  const card = await itemCard(req.params.id, { lvl: req.query.lvl });
  if (!card) return res.status(404).json({ error: 'Предмет не найден' });
  res.json(card);
});

// «Способ получения не указан в базе NEU» — если у Hypixel есть строка «откуда», подставляем её
function withObtainment(ru, obt) {
  if (!ru || !obt || !/способ получения не указан/i.test(ru.descriptionRu || '')) return ru;
  return { ...ru, descriptionRu: ru.descriptionRu.replace(/Как получить: способ получения не указан[^.]*\./i, tx`Как получить (по данным Hypixel): ${obt}`) };
}

let packInfo = [];
app.get('/api/packs', (req, res) => res.json(packInfo));
app.post('/api/packs/reload', auth.requireAdmin, (req, res) => { packInfo = loadPacks(); res.json(packInfo); });
app.get('/api/icon/:id', (req, res) => res.json(iconMeta(req.params.id)));
app.post('/api/icons', express.json({ limit: '200kb' }), (req, res) => {
  const ids = (req.body?.ids || []).slice(0, 500);
  res.json(Object.fromEntries(ids.map(i => [i, iconMeta(i)])));
});
app.get('/api/skin/:hash', async (req, res) => {
  const buf = await getSkin(req.params.hash).catch(() => null);
  if (!buf) return res.status(404).end();
  res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' }).send(buf);
});
// Иконки зависят от того, кто смотрит: текстуры чужих паков и рендеры Coflnet — только владельцу (см. packs.js, icons.js).
// Поэтому кэш только в браузере (private) и с Vary: Cookie, чтобы прокси/CDN не раздали картинку владельца Visitors.
const iconScope = req => (req.sbUser?.admin ? 'all' : 'public');
const sendIcon = (res, buf, maxAge) => res.set({ 'Content-Type': 'image/png', 'Cache-Control': `private, max-age=${maxAge}`, Vary: 'Cookie' }).send(buf);
app.get('/api/img/:id', async (req, res) => {
  const buf = await getRender(req.params.id, { scope: iconScope(req) }).catch(() => null);
  if (!buf) return res.status(404).set({ 'Cache-Control': 'private, max-age=3600', Vary: 'Cookie' }).end();
  sendIcon(res, buf, 86400);
});
app.get('/api/texture/:name', async (req, res) => {
  const buf = await getTexture(req.params.name, { scope: iconScope(req) }).catch(() => null);
  if (!buf) return res.status(404).end();
  sendIcon(res, buf, 604800);
});

// Неизвестный адрес /api — понятная ошибка в JSON, а не HTML-страница Express (интерфейс показывает её как есть)
app.use('/api', (req, res) => res.status(404).json({ error: 'Нет такого адреса API' }));

// ---------- Статика (собранный фронтенд) ----------
const dist = config.webDist;
if (fs.existsSync(dist)) {
  // index.html отдаём сами: в него подставляются счётчик Метрики, блоки рекламы и кнопка доната из .env
  // Открытые разделы — со своими заголовком, описанием и готовым текстом; профили игроков (?player=) и прочие адреса — noindex
  const sendIndex = (req, res) => {
    // Язык страницы — по адресу: / — русская версия, /en/… — английская
    const en = /^\/en(\/|$)/.test(req.path);
    const bare = en ? req.path.replace(/^\/en/, '') || '/' : req.path;
    // Сразу открываем версию на языке посетителя: выбранную раньше или по языку браузера (роботов не трогаем)
    res.set('Vary', 'Accept-Language, Cookie');
    const want = preferredLang(req);
    if (want && want !== (en ? 'en' : 'ru')) {
      const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      const to = want === 'en' ? (bare === '/' || bare === '/index.html' ? '/en/' : '/en' + bare) : (bare === '/index.html' ? '/' : bare);
      return res.set('Cache-Control', 'private, no-store').redirect(302, to + q);
    }
    req.sbLang = en ? 'en' : 'ru';
    let page = null;
    try { page = seo.pageFor(bare === '/index.html' ? '/' : bare, en ? 'en' : 'ru'); } catch (e) { console.warn('[seo]', e.message); }
    const noindex = !page || 'player' in req.query || 'profile' in req.query;
    if (noindex) res.set('X-Robots-Tag', 'noindex, follow');
    res.set('Cache-Control', 'no-cache').type('html')
      .send(renderIndexHtml(path.join(dist, 'index.html'), process.env, { seo: noindex && !page ? null : page, noindex, origin: siteOrigin(req), jsonld: jsonldScript, lang: req.sbLang }));
  };
  app.get(['/', '/index.html'], sendIndex);
  app.get(/^\/en$/, (req, res) => res.redirect(301, '/en/' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '')));
  app.use('/assets', staticAssets(path.join(dist, 'assets'))); // хэшированные файлы сборки: кэш навсегда + brotli
  app.use(express.static(dist, { index: false }));
  app.get(/^\/(?!api).*/, sendIndex);
}

// Ошибка в любом обработчике — в журнал ошибок (страница «Сервер») и понятный ответ вместо HTML Express
app.use(monitor.errorHandler);

// ---------- Фоновые обновления ----------
async function loop(fn, every, name) {
  const run = async () => {
    try { await status.background(name, fn); } catch (e) { console.error(`[${name}]`, e.message); monitor.serverError(e, tx`фон: ${name}`); }
    setTimeout(run, every);
  };
  run();
}

async function main() {
  loadHistory();
  // Аукцион с прошлого запуска (до 30 минут): «Рынок» и оценки работают сразу, а не после первого полного скана
  if (loadLowestBin()) console.log(`[AH] цены с прошлого запуска: ${prices.bin.size} предметов`);
  try { packInfo = loadPacks(); } catch (e) { console.warn('[паки]', e.message); }
  const server = app.listen(config.port, () => {
    console.log(`\n  Трекер SkyBlock: http://localhost:${config.port}`);
    console.log(auth.enabled ? '  Вход по нику и паролю включён (аккаунты: data/users.json, управление: /account)\n' : '  Паролей нет: сайт открыт только на этом ПК (задай пароль на http://localhost:' + config.port + '/account)\n');
  });
  server.on('error', e => {
    if (e.code === 'EADDRINUSE') console.error(`\n  Порт ${config.port} занят: скорее всего, ещё работает прошлый сервер. Закрой его (или перезагрузи ПК) и запусти снова.\n`);
    else console.error('[сервер]', e.message);
    process.exit(1);
  });
  // Запущен скриптом автообновления: если он завершился, завершаемся и мы, чтобы не остаться сиротой с портом и памятью
  if (process.send) process.on('disconnect', () => { try { saveHistory(true); charts.closeSync(); } catch { /* не страшно */ } process.exit(0); });
  await loadNeu();
  // Русская база предметов собирается в отдельном потоке (1,5–2 с CPU): сервер в это время отвечает на запросы
  loadFromNeuAsync(neu).then(r => { console.log(`[items-ru] база на русском: ${r.items} предметов за ${r.ms} мс`); r.en.then(e => console.log(`[items-ru] английский текст базы: ${e.n} строк за ${e.ms} мс`), e => console.warn('[items-ru] английский текст:', e.message)); }, e => console.warn('[items-ru]', e.message));
  // Сообщаем Яндексу и Bing (IndexNow) адреса страниц после обновления сайта — раз на сборку, только с SITE_URL
  setTimeout(() => {
    const stampFile = path.join(config.dataDir, 'indexnow.txt');
    const store = { get: () => { try { return fs.readFileSync(stampFile, 'utf8').trim(); } catch { return ''; } }, set: v => { try { fs.writeFileSync(stampFile, v); } catch { /* не страшно */ } } };
    pingIndexNow({ origin: publicConfig(process.env).siteUrl, urls: seo.urls().map(u => u.path), build: buildId(), store })
      .then(ok => ok && console.log('[seo] IndexNow: адреса страниц отправлены')).catch(() => {});
  }, 90_000).unref?.();
  // Новости сайта и патчноуты SkyBlock — в канал Discord (только с DISCORD_NEWS_WEBHOOK в .env; что отправлено — data/discord-news.json)
  const discordNews = createDiscordNews({
    webhook: process.env.DISCORD_NEWS_WEBHOOK, siteUrl: publicConfig(process.env).siteUrl, file: path.join(config.dataDir, 'discord-news.json'),
    patches: skyblockNews, translate: s => inLang('en', () => getTranslator().tr(s)),
  });
  if (discordNews.enabled) {
    setTimeout(() => discordNews.tick(), 120_000).unref?.();
    setInterval(() => discordNews.tick(), 15 * 60_000).unref?.();
  } else if (process.env.DISCORD_NEWS_WEBHOOK) console.warn('[discord] DISCORD_NEWS_WEBHOOK не похож на адрес webhook Discord — новости в канал не отправляются');
  // Слэш-команды бота — в Discord, если их список изменился (нужен DISCORD_BOT_TOKEN)
  if (discordBot.enabled) setTimeout(() => discordBot.registerCommands().catch(e => console.warn('[discord-бот]', e.message)), 10_000).unref?.();
  // Сообщение с кнопкой «Верификация» в #verify: само ставится и держится последним (раз в 15 минут)
  if (discordBot.enabled) {
    const panel = () => discordBot.ensurePanel().catch(e => console.warn('[discord-бот] верификация:', e.message));
    setTimeout(panel, 20_000).unref?.();
    setInterval(panel, 15 * 60_000).unref?.();
  }
  // События SkyBlock (Jacob, Dark Auction, мэр, Fire Sales, большие ивенты) — в свой канал с пингом ролей-подписок
  // (DISCORD_EVENTS_WEBHOOK и DISCORD_EVENTS_ROLES в .env; что отправлено — data/discord-events.json). Hypixel лишний раз не спрашиваем
  const discordEvents = createDiscordEvents({
    webhook: process.env.DISCORD_EVENTS_WEBHOOK, roles: process.env.DISCORD_EVENTS_ROLES, siteUrl: publicConfig(process.env).siteUrl,
    file: path.join(config.dataDir, 'discord-events.json'), translate: s => inLang('en', () => getTranslator().tr(s)),
  });
  if (discordEvents.enabled) {
    setTimeout(() => discordEvents.tick(), 60_000).unref?.(); // к этому времени refreshMayor уже принёс выборы и Fire Sales
    setInterval(() => discordEvents.tick(), 30_000).unref?.();
  } else if (process.env.DISCORD_EVENTS_WEBHOOK) console.warn('[discord] DISCORD_EVENTS_WEBHOOK не похож на адрес webhook Discord — события в канал не отправляются');
  // Цены NPC и пороги коллекций — параллельно с профилем и ценами, а не перед ними: раньше каждый перезапуск
  // ждал эти два запроса (а при сбое Hypixel — их таймауты) до первого профиля. Пришли — пересчитываем советы
  Promise.allSettled([
    getItemsResource().then(r => { for (const it of r.items || []) if (it.npc_sell_price) npcPrices.set(it.id, it.npc_sell_price); setItemsResource(r.items || []); })
      .catch(e => console.warn('[items] ', e.message)),
    // Пороги коллекций: советы по коллекциям и проверка, открыт ли рецепт крафт-флипа
    getCollectionsResource().then(r => { setCollectionsResource(r); setCraftCollections(r); setCollectionsPage(r); })
      .catch(e => console.warn('[коллекции]', e.message)),
  ]).then(async () => { if (state.member) { await reanalyze(); bus.emit('profile'); } });
  // Bazaar берём раз в ~20 с ради свечей «Рынка», а советы пересчитываем и рассылаем, как раньше, раз в минуту
  let analyzedAt = 0, bazaarErrAt = 0;
  loop(async () => {
    // Ошибка (Hypixel недоступен) в журнал и счётчик тревог — не чаще раза в минуту, как было до частых опросов
    try { await refreshBazaar(); } catch (e) { if (Date.now() - bazaarErrAt < 55_000) return; bazaarErrAt = Date.now(); throw e; }
    charts.onBazaar();
    if (Date.now() - analyzedAt >= config.bazaarRefresh - 2000) { analyzedAt = Date.now(); await reanalyzeForPrices(); bus.emit('prices'); }
  }, config.bazaarTick, 'bazaar');
  charts.start();
  // Свой профиль: цикл проверяет каждые 20 с, а запросы тратит только когда пора (state.js ownerRefreshDue)
  loop(async () => { if (ownerRefreshDue()) await refreshProfile(); }, 20_000, 'профиль');
  loop(async () => { await refreshAuctions(); await reanalyzeForPrices(); bus.emit('prices'); }, config.auctionRefresh, 'аукцион');
  loop(async () => { await refreshEndedAuctions(); }, 60_000, 'продажи AH');
  loop(refreshMayor, 5 * 60_000, 'мэр'); // и голоса выборов: снимок раз в 5 минут для тренда и шансов
  // Рейтинг: ники владельца, друзей и скрытых → uuid (повтор каждые 10 минут, пока не получится для всех)
  { const tryBlocked = () => resolveBoardBlocked().then(ok => { if (!ok) setTimeout(tryBlocked, 10 * 60_000).unref?.(); }); tryBlocked(); }
  // Вики: раз в сутки проверить, не правили ли страницы, по которым сверены гайды (один лёгкий запрос к API fandom)
  if (process.env.WIKI_WATCH !== '0') setTimeout(() => loop(refreshWiki, 24 * 3600_000, 'вики'), 2 * 60_000); // выборы: голоса меняются, мэр сменяется раз в ~5 суток
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { keyUsage.flush(); try { apiKeys.flush(); } catch { /* не записали счётчики ключей — не страшно */ } saveHistory(true); charts.closeSync(); board.flush(); monitor.flush(); perf.flush(); process.exit(0); });
  monitor.start(); // тревоги раз в минуту и сводка на почту в 9 утра
  perf.start(); // снимок нагрузки раз в минуту и тревоги по скорости, памяти, CPU, диску и ключу Hypixel
  // Через 4 минуты (когда есть Bazaar и первый скан аукциона) — дозаполнить прошлую неделю истории с Coflnet, потом раз в сутки
  const fill = () => backfillHistory(prices, { onSave: () => saveHistory(true) }).catch(e => console.warn('[история цен]', e.message));
  if (process.env.PRICE_BACKFILL !== '0') { setTimeout(fill, 4 * 60_000); setInterval(fill, 24 * 3600_000); }
  setInterval(() => loadNeu().then(() => loadFromNeuAsync(neu)).catch(() => {}), config.neuRefresh);
}

// Необработанные ошибки тоже попадают в журнал. Отказ промиса не роняет сервер; исключение — роняет как раньше
// (автообновление перезапустит), но сначала запишем его, чтобы было видно, что случилось
process.on('unhandledRejection', e => { console.error('[необработанный отказ]', e?.message || e); monitor.serverError(e instanceof Error ? e : new Error(String(e)), 'необработанный отказ промиса'); });
process.on('uncaughtException', e => { console.error(e); try { monitor.serverError(e, 'необработанное исключение'); monitor.flush(); } catch { /* уже падаем */ } process.exit(1); });

main();
