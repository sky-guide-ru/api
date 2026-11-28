// Скорость и нагрузка сайта по часам — для ежедневной сводки, тревог и страницы «Сервер» (только владелец).
// Считаем сами, без внешних сервисов, и только счётчики: ни IP, ни ников, ни параметров запросов.
// - Ответы сервера: время по каждому адресу (корзинами, отсюда p50/p95) и ответы 5xx.
// - Кэш профилей: сколько открытий чужих профилей отдано из памяти сразу, а сколько ждали Hypixel.
// - Hypixel: запросов с ключом за час, пик за 5 минут против лимита ключа, паузы после 429.
// - Сервер: CPU, память api против лимита контейнера, свободная память VPS, диск, задержка цикла событий.
// - Вес сайта: сколько весит первая загрузка (JS и CSS из index.html, сжатыми) — по каждой новой сборке.
// Тревоги — только о серьёзном — уходят через monitor.alert (почта и Discord, не чаще раза в 3 часа на одну тему).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { gzipSync } from 'node:zlib';

const MIN = 60_000, HOUR = 60 * MIN;
export const LAT_EDGES = [50, 100, 200, 400, 800, 1500, 3000, 6000]; // мс; последняя корзина — дольше 6 с
const KEEP_HOURS = 7 * 24, MAX_ROUTES = 60, WINDOW = 15 * MIN, MAX_WINDOW = 50_000, KEEP_BUILDS = 20;

// Пороги тревог — только серьёзное (просьба владельца 28.11): сайт заметно тормозит у всех, вот-вот упадёт
// или профили перестали обновляться. Медленный отдельный адрес и вес сборки видны на странице «Сервер», но не будят
export const LIMITS = {
  slowP95Ms: 3000, slowMinRequests: 300, // все адреса за 15 минут: у 95% ответ дольше 3 с
  memShare: 0.95, memMinutes: 5, // память api ≥ 95% лимита контейнера 5 минут подряд — скоро перезапуск
  freeMemMb: 150, // у всего VPS свободно меньше 150 МБ
  cpuPct: 95, cpuMinutes: 15, // CPU всего сервера ≥ 95% 15 минут подряд
  lagMs: 1000, lagMinutes: 5, // задержка цикла событий ≥ 1 с 5 минут подряд: сайт почти не отвечает
  diskFreeGb: 2, diskFreeShare: 0.05, // на диске меньше 2 ГБ или меньше 5%
};

const hourKey = t => new Date(t).toISOString().slice(0, 13); // UTC: 2026-11-28T18
const emptyBuckets = () => LAT_EDGES.map(() => 0).concat(0);
const SAFE_SEG = /^[\w.:-]{1,40}$/;

/** Перцентиль по корзинам LAT_EDGES: верхняя граница корзины, где набралась доля p; дольше 6 с — 10 000 */
export function latPercentile(b, p) {
  const total = b.reduce((a, x) => a + x, 0);
  if (!total) return null;
  let acc = 0;
  for (let i = 0; i < b.length; i++) { acc += b[i]; if (acc / total >= p) return i < LAT_EDGES.length ? LAT_EDGES[i] : 10_000; }
  return 10_000;
}
const bucketOf = ms => { const i = LAT_EDGES.findIndex(e => ms <= e); return i < 0 ? LAT_EDGES.length : i; };

/** Адрес для учёта: шаблон маршрута Express (/api/item/:id), без ников и параметров; английская версия — с пометкой «en» */
export function perfRoute(req, status = 200) {
  const en = req.sbLang === 'en';
  let r;
  if (status === 404) r = '(не найдено)'; // сканеры и опечатки не плодят тысячи адресов
  else if (req.route?.path && typeof req.route.path === 'string') r = `${req.baseUrl || ''}${req.route.path}`;
  else {
    const p = String(req.originalUrl || req.url || '/').split('?')[0].replace(/^\/en(?=\/|$)/, '') || '/';
    const segs = p.split('/').filter(Boolean);
    r = /^(api|v1|discord|auth)$/.test(segs[0] || '') ? '/' + segs.slice(0, 2).map(s => (SAFE_SEG.test(s) ? s : ':x')).join('/') : 'страницы';
  }
  if (r.length > 60) r = r.slice(0, 60);
  return (en ? 'en ' : '') + r;
}

/** Вес первой загрузки сайта: файлы JS и CSS, на которые ссылается index.html сборки (сжатые gzip — как их получит браузер) */
export function pageWeight(dir) {
  if (!dir) return null;
  let html, mtime;
  try { const f = path.join(dir, 'index.html'); html = fs.readFileSync(f, 'utf8'); mtime = fs.statSync(f).mtimeMs; } catch { return null; }
  const names = [...new Set([...html.matchAll(/(?:src|href)="\.?\/?(assets\/[\w./-]+?\.(?:js|css))"/g)].map(m => m[1]))].filter(n => !n.includes('..'));
  const out = { id: crypto.createHash('sha1').update(names.join('|')).digest('hex').slice(0, 10), at: Math.round(mtime), files: 0, js: { raw: 0, gz: 0 }, css: { raw: 0, gz: 0 }, biggest: [] };
  for (const n of names) {
    let buf;
    try { buf = fs.readFileSync(path.join(dir, n)); } catch { continue; }
    const gz = gzipSync(buf, { level: 9 }).length, k = n.endsWith('.css') ? 'css' : 'js';
    out[k].raw += buf.length; out[k].gz += gz; out.files++;
    out.biggest.push({ name: path.basename(n).replace(/-[\w-]{6,}(?=\.(js|css)$)/, ''), gz });
  }
  out.biggest = out.biggest.sort((a, b) => b.gz - a.gz).slice(0, 3);
  return out.files ? out : null;
}

/**
 * @param {{ dataDir: string, clock?: () => number, sample?: () => object|null, keyUsage?: () => object|null,
 *   hypixelLimit?: () => number, webDist?: string, alert?: (key: string, title: string, text: string) => Promise<boolean>,
 *   tz?: string }} o
 */
export function createPerf({ dataDir, clock = () => Date.now(), sample = () => null, keyUsage = () => null, hypixelLimit = () => 300, webDist = '', alert = async () => false, tz = 'Europe/Moscow' } = {}) {
  const file = path.join(dataDir, 'metrics', 'perf.json');
  const read = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } };
  const saved = read(file, {});
  const hours = new Map(Object.entries(saved.hours || {}));
  let builds = Array.isArray(saved.builds) ? saved.builds : [];
  const win = []; // ответы за последние 15 минут: [время, мс, адрес, 5xx]
  let prevUsage = null, streak = { mem: 0, cpu: 0, lag: 0 }, dirty = false, lastWeightCheck = 0, weightMtime = 0, lastSave = 0;

  function hour(t = clock()) {
    const k = hourKey(t);
    let h = hours.get(k);
    if (!h) {
      h = { routes: {}, hyp: { calls: 0, profiles: 0, deduped: 0, limited: 0, peak5m: 0, pausedMin: 0, limit: 0 }, cache: { hit: 0, miss: 0 },
        sys: { n: 0, cpuSum: 0, cpuMax: 0, rssMax: 0, limitMb: null, freeMin: null, lagMax: 0, diskFreeGb: null, diskTotalGb: null } };
      hours.set(k, h);
      const keys = [...hours.keys()].sort();
      for (const old of keys.slice(0, Math.max(0, keys.length - KEEP_HOURS))) hours.delete(old);
    }
    return h;
  }

  /** Ответ сервера закончился */
  function record(route, ms, status) {
    const now = clock(), h = hour(now);
    let r = h.routes[route];
    if (!r) {
      if (Object.keys(h.routes).length >= MAX_ROUTES) route = '(прочие)';
      r = h.routes[route] ||= { n: 0, b: emptyBuckets(), e5: 0, sum: 0 };
    }
    r.n++; r.b[bucketOf(ms)]++; r.sum += ms;
    if (status >= 500) r.e5++;
    win.push([now, ms, route, status >= 500 ? 1 : 0]);
    while (win.length && (now - win[0][0] > WINDOW || win.length > MAX_WINDOW)) win.shift();
    dirty = true;
  }

  /** middleware: время ответа каждого запроса, который дошёл до api (файлы сборки отдаёт Caddy и сюда не попадают) */
  function track(req, res, next) {
    const path0 = req.path;
    if (path0 === '/api/stream' || path0 === '/api/t' || path0 === '/healthz') return next(); // поток SSE открыт минутами, маяк и проверка — служебные
    const t0 = process.hrtime.bigint();
    let done = false;
    const fin = () => {
      if (done) return;
      done = true;
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      // Оборванный посетителем запрос (закрыл вкладку) — не «медленный ответ», а его отсутствие
      if (!res.writableFinished && res.statusCode < 500) return;
      record(perfRoute(req, res.statusCode), ms, res.statusCode);
    };
    res.on('finish', fin); res.on('close', fin);
    next();
  }

  /** Открыли чужой профиль: hit — данные уже были в памяти и ушли сразу, miss — ждали загрузку из Hypixel */
  function profileView(hit) { const h = hour(); h.cache[hit ? 'hit' : 'miss']++; dirty = true; }

  function windowStats(now = clock()) {
    while (win.length && now - win[0][0] > WINDOW) win.shift();
    const all = emptyBuckets(), per = new Map();
    let e5 = 0;
    for (const [, ms, route, bad] of win) {
      const i = bucketOf(ms);
      all[i]++; e5 += bad;
      let p = per.get(route); if (!p) per.set(route, p = { n: 0, b: emptyBuckets() });
      p.n++; p.b[i]++;
    }
    const routes = [...per].map(([route, p]) => ({ route, n: p.n, p95: latPercentile(p.b, 0.95) })).sort((a, b) => b.p95 - a.p95 || b.n - a.n);
    return { n: win.length, p95: latPercentile(all, 0.95), e5, routes };
  }

  const sec = ms => (ms == null ? '—' : ms >= 10_000 ? 'дольше 6 с' : ms < 1000 ? `${ms} мс` : `${(ms / 1000).toFixed(1).replace('.', ',')} с`);
  const ru = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const kb = b => `${ru(b / 1024)} КБ`;

  /** Раз в минуту: снимок сервера и расхода Hypixel в текущий час, проверка порогов */
  async function tick() {
    const now = clock(), h = hour(now), fired = [];
    // Hypixel: прирост счётчика расхода за минуту (счётчик дневной, по UTC: новый день — счёт с нуля)
    const u = (() => { try { return keyUsage(); } catch { return null; } })();
    if (u) {
      const cur = { day: u.day, total: u.total || 0, profiles: u.kind?.profiles || 0, deduped: u.deduped || 0, limited: u.limited || 0 };
      if (prevUsage) {
        const same = prevUsage.day === cur.day;
        for (const k of ['total', 'profiles', 'deduped', 'limited']) h.hyp[k === 'total' ? 'calls' : k] += Math.max(0, same ? cur[k] - prevUsage[k] : cur[k]);
      }
      prevUsage = cur;
    }
    const s = (() => { try { return sample(); } catch { return null; } })();
    const limit = Math.max(1, (() => { try { return hypixelLimit(); } catch { return 300; } })() || 300);
    if (s) {
      const y = h.sys;
      y.n++; y.cpuSum += s.cpu || 0; y.cpuMax = Math.max(y.cpuMax, s.cpu || 0);
      y.rssMax = Math.max(y.rssMax, s.rssMb || 0); y.limitMb = s.limitMb ?? y.limitMb;
      if (s.freeMb != null) y.freeMin = y.freeMin == null ? s.freeMb : Math.min(y.freeMin, s.freeMb);
      y.lagMax = Math.max(y.lagMax, s.lagMs || 0);
      if (s.disk) { y.diskFreeGb = s.disk.freeGb; y.diskTotalGb = s.disk.totalGb; }
      h.hyp.peak5m = Math.max(h.hyp.peak5m, s.keyed5m || 0); h.hyp.limit = limit;
      if (s.paused) h.hyp.pausedMin++;

      // Тревоги по серверу
      streak.mem = s.limitMb && s.rssMb >= s.limitMb * LIMITS.memShare ? streak.mem + 1 : 0;
      if (streak.mem >= LIMITS.memMinutes) fired.push(alert('perf-mem', `Память сервера сайта почти кончилась: ${ru(s.rssMb)} из ${ru(s.limitMb)} МБ`, `Сервер сайта (api) держит ${ru(s.rssMb)} МБ из ${ru(s.limitMb)} МБ лимита уже ${streak.mem} мин. Дойдёт до лимита — Docker перезапустит его, сайт пропадёт на полминуты. Что лежит в памяти — на странице «Сервер», блок «Память».`));
      if (s.freeMb != null && s.freeMb < LIMITS.freeMemMb) fired.push(alert('perf-freemem', `На сервере свободно всего ${ru(s.freeMb)} МБ памяти`, `У всего VPS осталось ${ru(s.freeMb)} МБ из ${ru(s.totalMb || 0)} МБ. Если память кончится, система начнёт убивать процессы (api, Caddy, сборку обновления).`));
      streak.cpu = (s.cpu || 0) >= LIMITS.cpuPct ? streak.cpu + 1 : 0;
      if (streak.cpu >= LIMITS.cpuMinutes) fired.push(alert('perf-cpu', `Процессор сервера загружен на ${s.cpu}% уже ${streak.cpu} мин`, `Весь VPS: ${s.cpu}%, из них сайт (api) — ${s.cpuProcess ?? '—'}%. Ответы замедляются. Если долго держится — посмотреть «Замирания» на странице «Сервер» или взять тариф с бо́льшим числом ядер.`));
      streak.lag = (s.lagMs || 0) >= LIMITS.lagMs ? streak.lag + 1 : 0;
      if (streak.lag >= LIMITS.lagMinutes) fired.push(alert('perf-lag', `Сервер сайта подтормаживает ${streak.lag} мин подряд`, `Задержка цикла событий Node ${sec(s.lagMs)} (норма — до 0,05 с): все запросы ждут, пока сервер освободится. Кто держит — блок «Замирания» на странице «Сервер».`));
      if (s.disk && (s.disk.freeGb < LIMITS.diskFreeGb || s.disk.freeGb < s.disk.totalGb * LIMITS.diskFreeShare)) fired.push(alert('perf-disk', `На диске сервера осталось ${String(s.disk.freeGb).replace('.', ',')} ГБ`, `Свободно ${String(s.disk.freeGb).replace('.', ',')} из ${String(s.disk.totalGb).replace('.', ',')} ГБ. Когда место кончится, обновления не соберутся, а данные перестанут сохраняться. Обычно место съедает Docker: docker system df, затем docker image prune.`));
      // Hypixel поставил ключ на паузу (429): профили не обновляются
      if (s.paused) fired.push(alert(`perf-429:${s.paused.at || s.paused.until}`, s.paused.daily ? 'Суточный лимит ключа Hypixel исчерпан' : 'Hypixel поставил ключ на паузу (ответ 429)', `Профили не обновляются до ${new Date(s.paused.until).toLocaleString('ru-RU', { timeZone: tz })}, сайт показывает последние данные.`));
    }
    // Скорость ответов за 15 минут
    const w = windowStats(now);
    if (w.n >= LIMITS.slowMinRequests && w.p95 >= LIMITS.slowP95Ms) {
      fired.push(alert('perf-slow', `Сайт отвечает медленно: у 5% запросов дольше ${sec(w.p95)}`, `За 15 минут ${ru(w.n)} запросов, 95% из них быстрее ${sec(w.p95)}. Медленнее всех: ${w.routes.slice(0, 4).map(r => `${r.route} ${sec(r.p95)} (${r.n})`).join(', ')}.`));
    }
    // Вес сайта: раз в 10 минут смотрим, не вышла ли новая сборка
    if (now - lastWeightCheck >= 10 * MIN) {
      lastWeightCheck = now;
      let m = 0; try { m = fs.statSync(path.join(webDist, 'index.html')).mtimeMs; } catch { /* сборки нет (тесты, запуск без web) */ }
      if (m && m !== weightMtime) {
        weightMtime = m;
        const pw = pageWeight(webDist);
        if (pw && builds.at(-1)?.id !== pw.id) {
          builds = [...builds, { ...pw, seenAt: now }].slice(-KEEP_BUILDS);
          dirty = true;
        }
      }
    }
    dirty = true;
    await Promise.all(fired);
    if (now - lastSave >= 5 * MIN) flush();
    return fired.length;
  }

  function flush() {
    if (!dirty) return;
    dirty = false; lastSave = clock();
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ hours: Object.fromEntries(hours), builds })); } catch (e) { console.warn('[скорость]', e.message); }
  }

  /** Итог за последние n часов */
  function period(n = 24) {
    const now = clock(), list = [];
    for (let i = n - 1; i >= 0; i--) { const k = hourKey(now - i * HOUR); list.push({ h: k, ...(hours.get(k) || {}) }); }
    const routes = new Map(), all = emptyBuckets();
    let reqs = 0, e5 = 0, peak = { n: 0, h: null };
    const hyp = { calls: 0, profiles: 0, deduped: 0, limited: 0, peak5m: 0, pausedMin: 0, limit: 0 }, cache = { hit: 0, miss: 0 };
    const sys = { cpuSum: 0, n: 0, cpuMax: 0, rssMax: 0, limitMb: null, freeMin: null, lagMax: 0, diskFreeGb: null, diskTotalGb: null };
    const perHour = [];
    for (const h of list) {
      let hn = 0, he5 = 0; const hb = emptyBuckets();
      for (const [route, r] of Object.entries(h.routes || {})) {
        let t = routes.get(route); if (!t) routes.set(route, t = { n: 0, b: emptyBuckets(), e5: 0, sum: 0 });
        t.n += r.n; t.e5 += r.e5; t.sum += r.sum;
        r.b.forEach((v, i) => { t.b[i] += v; all[i] += v; hb[i] += v; });
        hn += r.n; he5 += r.e5;
      }
      reqs += hn; e5 += he5;
      if (hn > peak.n) peak = { n: hn, h: h.h };
      if (h.hyp) { for (const k of ['calls', 'profiles', 'deduped', 'limited', 'pausedMin']) hyp[k] += h.hyp[k] || 0; hyp.peak5m = Math.max(hyp.peak5m, h.hyp.peak5m || 0); hyp.limit = h.hyp.limit || hyp.limit; }
      if (h.cache) { cache.hit += h.cache.hit; cache.miss += h.cache.miss; }
      const y = h.sys;
      if (y?.n) {
        sys.cpuSum += y.cpuSum; sys.n += y.n; sys.cpuMax = Math.max(sys.cpuMax, y.cpuMax); sys.rssMax = Math.max(sys.rssMax, y.rssMax);
        sys.limitMb = y.limitMb ?? sys.limitMb; sys.lagMax = Math.max(sys.lagMax, y.lagMax);
        if (y.freeMin != null) sys.freeMin = sys.freeMin == null ? y.freeMin : Math.min(sys.freeMin, y.freeMin);
        if (y.diskFreeGb != null) { sys.diskFreeGb = y.diskFreeGb; sys.diskTotalGb = y.diskTotalGb; }
      }
      perHour.push({ h: h.h, n: hn, p95: latPercentile(hb, 0.95), e5: he5, hyp: h.hyp?.calls || 0, peak5m: h.hyp?.peak5m || 0, cpuMax: y?.cpuMax || 0, rssMax: y?.rssMax || 0 });
    }
    return {
      hours: n, requests: reqs, e5, p50: latPercentile(all, 0.5), p95: latPercentile(all, 0.95), peak,
      routes: [...routes].map(([route, t]) => ({ route, n: t.n, e5: t.e5, avg: Math.round(t.sum / t.n), p50: latPercentile(t.b, 0.5), p95: latPercentile(t.b, 0.95) })),
      hypixel: hyp, cache: { ...cache, rate: cache.hit + cache.miss ? Math.round(cache.hit / (cache.hit + cache.miss) * 100) : null },
      sys: { cpuAvg: sys.n ? Math.round(sys.cpuSum / sys.n) : null, cpuMax: sys.cpuMax, rssMax: sys.rssMax, limitMb: sys.limitMb, freeMin: sys.freeMin, lagMax: sys.lagMax, diskFreeGb: sys.diskFreeGb, diskTotalGb: sys.diskTotalGb },
      perHour,
    };
  }

  const localHour = k => { try { return new Date(`${k}:00:00Z`).toLocaleTimeString('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' }); } catch { return k.slice(11) + ':00'; } };

  /** Строки для ежедневной сводки (за последние сутки) */
  function digestLines() {
    const p = period(24);
    if (!p.requests && !p.sys.cpuAvg) return [];
    const slow = p.routes.filter(r => r.n >= 30).sort((a, b) => b.p95 - a.p95 || b.n - a.n).slice(0, 4);
    const busy = [...p.routes].sort((a, b) => b.n - a.n).slice(0, 3);
    const w = builds.at(-1), wPrev = builds.at(-2);
    const hp = p.hypixel.limit ? Math.round(p.hypixel.peak5m / p.hypixel.limit * 100) : null;
    return [
      'Скорость и нагрузка за последние сутки',
      `Запросов к серверу: ${ru(p.requests)}${p.peak.h ? ` (пик ${ru(p.peak.n)} в час, в ${localHour(p.peak.h)})` : ''}`,
      `Ответ сервера: у половины до ${sec(p.p50)}, у 95% до ${sec(p.p95)}; ответов 5xx: ${p.e5}`,
      slow.length ? `Медленнее всех (95%): ${slow.map(r => `${r.route} ${sec(r.p95)}`).join(', ')}` : null,
      busy.length ? `Чаще всех: ${busy.map(r => `${r.route} ${ru(r.n)}`).join(', ')}` : null,
      p.cache.rate != null ? `Кэш профилей: ${p.cache.rate}% открытий чужих профилей сразу из памяти (${ru(p.cache.hit)} из ${ru(p.cache.hit + p.cache.miss)})` : null,
      `Hypixel: ${ru(p.hypixel.calls)} запросов с ключом, пик ${p.hypixel.peak5m} из ${p.hypixel.limit || 300} за 5 мин${hp != null ? ` (${hp}%)` : ''}${p.hypixel.deduped ? `, склеено одинаковых ${ru(p.hypixel.deduped)}` : ''}${p.hypixel.pausedMin ? `, на паузе после 429: ${p.hypixel.pausedMin} мин` : ''}`,
      p.sys.cpuAvg != null ? `Сервер: CPU в среднем ${p.sys.cpuAvg}%, пик ${p.sys.cpuMax}%; память api до ${ru(p.sys.rssMax)}${p.sys.limitMb ? ` из ${ru(p.sys.limitMb)}` : ''} МБ${p.sys.freeMin != null ? `, у VPS свободно не меньше ${ru(p.sys.freeMin)} МБ` : ''}; задержка до ${sec(p.sys.lagMax)}` : null,
      p.sys.diskFreeGb != null ? `Диск: свободно ${String(p.sys.diskFreeGb).replace('.', ',')} из ${String(p.sys.diskTotalGb).replace('.', ',')} ГБ` : null,
      w ? `Вес первой загрузки: ${kb(w.js.gz + w.css.gz)} сжатыми (JS ${kb(w.js.gz)}, CSS ${kb(w.css.gz)})${wPrev ? `, прошлая сборка ${kb(wPrev.js.gz + wPrev.css.gz)}` : ''}` : null,
    ].filter(l => l != null);
  }

  /** Для страницы «Сервер» */
  function summary() {
    const day = period(24), w = windowStats();
    return {
      window: { minutes: WINDOW / MIN, n: w.n, p95: w.p95, e5: w.e5 },
      day: { ...day, routes: day.routes.sort((a, b) => b.p95 - a.p95 || b.n - a.n).slice(0, 25) },
      weight: builds.at(-1) || null, weightPrev: builds.at(-2) || null,
      limits: LIMITS, edges: LAT_EDGES,
    };
  }

  let timer = null;
  function start(every = MIN) { if (!timer) { timer = setInterval(() => tick().catch(e => console.warn('[скорость]', e.message)), every); timer.unref?.(); } }
  function stop() { clearInterval(timer); timer = null; flush(); }

  return { track, record, profileView, tick, flush, period, digestLines, summary, windowStats, start, stop };
}
