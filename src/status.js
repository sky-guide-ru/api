// Состояние сервера: для владельца — подробная панель (#/status), для игроков — одна лампочка «нагрузка».
// Считаем сами, без внешних сервисов: задержка цикла событий Node, запросы в работе и за минуту,
// расход лимита ключа Hypixel (300 запросов за 5 минут), память, CPU, последнее обновление и откат.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { createStalls } from '@sky-guide/core/lib/stalls.js';

export const HYPIXEL_LIMIT = 300; // запросов на ключ за 5 минут

/** Уровень нагрузки по метрикам: 'low' | 'medium' | 'high' и причина по-русски. */
export function loadLevel({ lagMs = 0, inFlight = 0, keyed5m = 0, rpm = 0, paused = null }) {
  const keyShare = keyed5m / HYPIXEL_LIMIT;
  // Ключ на паузе после 429 — сервер не перегружен, просто профили пока не обновляются
  if (paused && lagMs <= 200 && inFlight <= 25) return { level: 'medium', why: paused.daily ? 'исчерпан суточный лимит запросов к Hypixel — профили показаны по последним данным' : 'Hypixel просит подождать — профили обновятся через несколько минут' };
  if (lagMs > 200 || inFlight > 25 || keyShare > 0.85) return { level: 'high', why: lagMs > 200 ? 'сервер отвечает с задержкой' : keyShare > 0.85 ? 'почти исчерпан лимит запросов к Hypixel' : 'много одновременных запросов' };
  if (lagMs > 60 || inFlight > 8 || keyShare > 0.55 || rpm > 600) return { level: 'medium', why: keyShare > 0.55 ? 'много запросов к Hypixel — чужие профили могут обновляться реже' : 'сервер занят' };
  return { level: 'low', why: 'всё спокойно' };
}

/** Лимит памяти контейнера (mem_limit в docker-compose.yml) из cgroup. Без лимита (сайт запущен не в Docker) — null.
 *  os.totalmem() в контейнере показывает память всего VPS, поэтому лимит берём отдельно. */
export function containerMemory({ constrained = process.constrainedMemory?.() ?? 0, total = os.totalmem() } = {}) {
  return { limitMb: constrained > 0 && constrained < total ? Math.round(constrained / 1048576) : null };
}

/** Диск, на котором лежит папка данных (в Docker это папка на VPS, значит и диск самого сервера) */
export function diskInfo(dir) {
  try {
    const s = fs.statfsSync(dir);
    const gb = n => Math.round(n * s.bsize / 1073741824 * 10) / 10;
    return { totalGb: gb(s.blocks), usedGb: gb(s.blocks - s.bfree), freeGb: gb(s.bavail) }; // bavail — без запаса для root
  } catch { return null; }
}

export function createStatus({ dataDir, keyedCallsRecent = () => 0, keyedPause = () => null, keyUsage = () => null, state, prices, buildId = () => 'dev', clock = () => Date.now(), historySize = () => null, marketCharts = () => null, memoryParts = () => [], apis = () => null, apiKey = '', keySince = () => null } = {}) {
  const started = clock();
  const lag = monitorEventLoopDelay({ resolution: 20 });
  lag.enable();
  // Задержка — за последнюю минуту, а не за всё время работы: иначе часовое спокойствие прятало минутное замирание
  let lagPrev = 0;
  const lagTimer = setInterval(() => { lagPrev = lag.percentile(95); lag.reset(); }, 60_000);
  lagTimer.unref?.();
  const stalls = createStalls({ clock });
  let inFlight = 0;
  const hits = []; // время запросов за последнюю минуту
  // CPU: процесс сайта и весь сервер — в % от всех ядер (100% = сервер загружен полностью).
  // os.cpus() в Docker без лимита CPU отдаёт ядра и время самого VPS, так что «весь сервер» — это VPS.
  const cores = Math.max(1, os.cpus().length);
  const hostTimes = () => os.cpus().reduce((a, c) => { const t = c.times; a.busy += t.user + t.nice + t.sys + t.irq; a.all += t.user + t.nice + t.sys + t.irq + t.idle; return a; }, { busy: 0, all: 0 });
  let cpuPrev = process.cpuUsage(), cpuAt = clock(), cpuPct = 0, hostPrev = hostTimes(), hostPct = 0;
  const cpuTimer = setInterval(() => {
    const now = clock(), d = process.cpuUsage(cpuPrev), h = hostTimes();
    cpuPct = Math.min(100, Math.round(((d.user + d.system) / 1000) / Math.max(1, now - cpuAt) / cores * 100));
    hostPct = h.all > hostPrev.all ? Math.round((h.busy - hostPrev.busy) / (h.all - hostPrev.all) * 100) : hostPct;
    cpuPrev = process.cpuUsage(); cpuAt = now; hostPrev = h;
  }, 10_000);
  cpuTimer.unref?.();

  /** middleware: считает запросы к /api */
  function track(req, res, next) {
    if (!req.path.startsWith('/api') || req.path === '/api/stream') return next();
    inFlight++;
    const now = clock();
    hits.push(now);
    while (hits.length && now - hits[0] > 60_000) hits.shift();
    let done = false;
    const fin = stalls.begin(req.path, req.sbLang === 'en');
    const end = () => { if (!done) { done = true; inFlight--; fin(); } };
    res.on('finish', end); res.on('close', end);
    next();
  }

  const lagMs = () => Math.round(Math.max(lagPrev, lag.percentile(95)) / 1e6);
  const rpm = () => { const now = clock(); while (hits.length && now - hits[0] > 60_000) hits.shift(); return hits.length; };

  function deployInfo() {
    try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'deploy-log.json'), 'utf8')); } catch { return { events: [] }; }
  }

  /** Внешние API: ключ Hypixel (без самого ключа), лимит из заголовков, источники с последним успехом и ошибкой */
  function apiInfo() {
    let snap = null;
    try { snap = apis(); } catch { snap = null; }
    if (!snap) return null;
    const h = snap.hypixel || {};
    const key = !apiKey ? 'none' : h.keyErrorAt && h.keyErrorAt > (h.keyOkAt || 0) ? 'invalid' : h.keyOkAt ? 'ok' : 'unknown';
    const limit = h.limit || null;
    return {
      key: {
        state: key,
        // У ключей разработчика Hypixel лимит 300 запросов за 5 минут; у одобренных ключей приложений — больше
        type: !limit ? null : limit <= HYPIXEL_LIMIT ? 'dev' : 'production',
        since: key === 'ok' ? (() => { try { return keySince(); } catch { return null; } })() : null,
        error: key === 'invalid' ? h.keyError : null,
      },
      rate: limit ? { limit, remaining: h.remaining, resetSec: h.resetSec, at: h.at } : null,
      sources: snap.sources || [],
    };
  }

  function publicStatus() {
    const l = loadLevel({ lagMs: lagMs(), inFlight, keyed5m: keyedCallsRecent(), rpm: rpm(), paused: keyedPause() });
    // Для баннера у всех посетителей: профили не обновляются из-за лимита Hypixel или нерабочего ключа
    const p = keyedPause();
    let keyBroken = false;
    try { const h = apis()?.hypixel; keyBroken = !!(apiKey && h?.keyErrorAt && h.keyErrorAt > (h.keyOkAt || 0)); } catch { /* нет данных */ }
    return { ok: true, load: l.level, why: l.why, at: clock(), hypixel: { limitedUntil: p?.until || null, daily: !!p?.daily, keyBroken } };
  }

  function adminStatus() {
    const mem = process.memoryUsage();
    const keyed5m = keyedCallsRecent();
    const l = loadLevel({ lagMs: lagMs(), inFlight, keyed5m, rpm: rpm(), paused: keyedPause() });
    const deploy = deployInfo();
    return {
      ...publicStatus(), load: l.level, why: l.why,
      uptimeSec: Math.round((clock() - started) / 1000),
      build: buildId(), node: process.version, platform: `${os.type()} ${os.release()}`,
      cpu: { process: cpuPct, server: hostPct, cores, loadavg: os.loadavg().map(x => Math.round(x * 100) / 100) },
      memory: {
        rssMb: Math.round(mem.rss / 1048576), heapMb: Math.round(mem.heapUsed / 1048576), heapTotalMb: Math.round(mem.heapTotal / 1048576),
        buffersMb: Math.round(mem.external / 1048576),
        // Весь сервер (VPS): Docker не прячет /proc/meminfo, а freemem в Node 22 — это MemAvailable (кэш считается свободным)
        systemFreeMb: Math.round(os.freemem() / 1048576), systemTotalMb: Math.round(os.totalmem() / 1048576),
        ...containerMemory(),
        // что из данных сайта лежит в памяти: [{ label, count, unit, hint }]
        parts: (() => { try { return memoryParts(); } catch { return []; } })(),
      },
      disk: diskInfo(dataDir),
      requests: { inFlight, perMinute: rpm(), lagMs: lagMs() },
      stalls: stalls.summary(),
      hypixel: { used5m: keyed5m, limit5m: HYPIXEL_LIMIT, paused: keyedPause(), usage: (() => { try { return keyUsage(); } catch { return null; } })() },
      api: apiInfo(),
      profile: { status: state?.status ?? null, error: state?.error ?? null, updatedAt: state?.updatedAt || null },
      prices: { bazaarAt: prices?.bazaarAt || null, auctionsAt: prices?.binAt || null },
      history: (() => { try { return historySize(); } catch { return null; } })(),
      marketCharts: (() => { try { return marketCharts(); } catch { return null; } })(),
      deploy: { last: deploy.events?.[0] || null, events: (deploy.events || []).slice(0, 10), autoUpdate: process.env.AUTO_UPDATE !== '0' },
    };
  }

  /** Короткий снимок раз в минуту для учёта скорости и тревог (monitor/perf.js) */
  function sample() {
    const mem = process.memoryUsage();
    return {
      cpu: hostPct, cpuProcess: cpuPct, rssMb: Math.round(mem.rss / 1048576), limitMb: containerMemory().limitMb,
      freeMb: Math.round(os.freemem() / 1048576), totalMb: Math.round(os.totalmem() / 1048576), disk: diskInfo(dataDir),
      lagMs: lagMs(), inFlight, rpm: rpm(), keyed5m: keyedCallsRecent(), paused: keyedPause(),
    };
  }

  return { track, publicStatus, adminStatus, sample, background: stalls.background, stop: () => { lag.disable(); clearInterval(cpuTimer); clearInterval(lagTimer); stalls.stop(); } };
}
