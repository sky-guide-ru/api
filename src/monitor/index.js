// Свой учёт посещений и ошибок — без внешних сервисов (как устроено: docs/monitoring.md).
// Посещения: только счётчики за день (разделы, откуда пришли, телефон/ПК, время загрузки, сколько разных ников).
// IP не сохраняется: уникальный посетитель = хеш(IP + браузер + соль дня), соль меняется каждые сутки.
// Страна — по офлайн-базе (geo.js) в момент захода, язык браузера — из Accept-Language, метки utm — из адреса входа;
// всё это только прибавляет +1 к дневному счётчику («RU: 12»), отдельных записей о посетителях нет.
// Ошибки браузера и сервера группируются по отпечатку (текст + место). Тревоги и сводка — письмом владельцу.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
export const LOAD_EDGES = [300, 600, 1000, 1500, 2500, 4000, 7000]; // мс; последняя корзина — «дольше 7 с»
const KEEP_DAYS = 90, MAX_GROUPS = 300, GROUP_TTL = 30 * DAY, ALERT_EVERY = 3 * HOUR;
const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|curl|wget|python|node-fetch|axios|go-http|java\//i;
const MOBILE_UA = /Mobi|Android|iPhone|iPad|iPod/i;
const MAX_KEYS = 100; // потолок разных меток utm за день: адрес с метками может придумать кто угодно

/** Браузер и система по User-Agent — только название семейства, без версий */
export function browserOf(ua = '') {
  return /YaBrowser|YaSearchBrowser/.test(ua) ? 'Yandex' : /Edg(e|A|iOS)?\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Chrome|CriOS|Chromium/.test(ua) ? 'Chrome'
      : /Safari/.test(ua) ? 'Safari' : 'другой';
}
export function osOf(ua = '') {
  return /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'другая';
}

/** Группа источника по домену: поиск, соцсети и мессенджеры, другие сайты, прямой заход */
export function refGroup(host) {
  const h = String(host || '');
  if (!h || h === 'прямой заход') return 'direct';
  if (/(^|\.)(yandex\.[a-z.]+|ya\.ru|google\.[a-z.]+|bing\.com|duckduckgo\.com|yahoo\.com|ecosia\.org|search\.brave\.com|go\.mail\.ru|rambler\.ru|startpage\.com)$/.test(h)) return 'search';
  if (/(^|\.)(discord(app)?\.com|discord\.gg|t\.me|telegram\.(org|me)|vk\.(com|ru)|ok\.ru|youtube\.com|youtu\.be|reddit\.com|tiktok\.com|twitter\.com|x\.com|t\.co|facebook\.com|instagram\.com|twitch\.tv)$/.test(h)) return 'social';
  return 'sites';
}


/** Основной язык браузера из Accept-Language: «ru-RU,ru;q=0.9,en;q=0.8» → «ru»; непонятное — «?» */
export function browserLang(header) {
  const tag = String(header || '').split(',')[0].split(';')[0].trim().toLowerCase().split('-')[0];
  return /^[a-z]{2,3}$/.test(tag) ? tag : '?';
}

/** Метки utm из адреса входа: «?utm_source=Discord&utm_campaign=nov» → «discord · nov»; без utm_source — '' */
export function utmKey(search) {
  let q;
  try { q = new URLSearchParams(String(search || '').slice(0, 500)); } catch { return ''; }
  const clean = v => String(v || '').toLowerCase().replace(/[^a-z0-9а-яё_.-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  const src = clean(q.get('utm_source'));
  if (!src) return '';
  const camp = clean(q.get('utm_campaign'));
  return camp ? `${src} · ${camp}` : src;
}

export function dayKey(ts, tz) {
  try { return new Date(ts).toLocaleDateString('sv-SE', { timeZone: tz }); } catch { return new Date(ts).toISOString().slice(0, 10); }
}
function hourIn(ts, tz) {
  try { return Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date(ts))) % 24; } catch { return new Date(ts).getUTCHours(); }
}
const prevDay = (key) => new Date(Date.parse(`${key}T12:00:00Z`) - DAY).toISOString().slice(0, 10);

/** Убрать из текста ошибки всё лишнее: ключи, токены, UUID, почту, адреса сайта и параметры запросов */
export function scrub(s, max = 300) {
  return String(s ?? '')
    .replace(/(key|api[-_]?key|token|pass(word)?|secret)=[^&\s"']+/gi, '$1=***')
    .replace(/sk-ant-[\w-]+/g, '***')
    .replace(/[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/gi, '***')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '***@***')
    .replace(/https?:\/\/[^/\s)]+/g, '') // адрес сайта (туннель меняется) — оставляем только путь
    .replace(/\?[^\s):]*/g, '')
    .slice(0, max);
}

/** Место ошибки без номеров колонок и хешей сборки: index-AbC123.js:1:2345 → index.js:1 */
function normWhere(stack) {
  const line = String(stack || '').split('\n').map(l => l.trim()).find(l => /\.(m?js|jsx)\b/.test(l)) || '';
  return scrub(line, 200).replace(/-[\w]{6,}(\.m?js)/g, '$1').replace(/(:\d+):\d+/g, '$1');
}

/** Маршрут сервера без ников, чисел и id: /api/item/ASPECT_OF_THE_END → /api/item/:x */
export function routeOf(req) {
  if (req.route?.path && typeof req.route.path === 'string') return `${req.baseUrl || ''}${req.route.path}`;
  return String(req.path || '/').split('/').slice(0, 4).map((p, i) => (i < 3 && /^[a-z-]+$/.test(p) ? p : p ? ':x' : p)).join('/');
}

function emptyDay(day) {
  return { day, views: 0, visitors: 0, sections: {}, refs: {}, devices: { mobile: 0, desktop: 0 }, who: { guest: 0, user: 0 }, langs: { ru: 0, en: 0 },
    countries: {}, blangs: {}, utm: {}, browsers: {}, oses: {}, entries: {}, hours: Array(24).fill(0),
    load: { mobile: LOAD_EDGES.map(() => 0).concat(0), desktop: LOAD_EDGES.map(() => 0).concat(0) },
    nicksN: 0, errors: { client: 0, server: 0, api: 0 }, s5xx: 0 };
}

/** Перцентиль по корзинам: верхняя граница корзины, где набралась доля p */
export function percentile(buckets, p) {
  const total = buckets.reduce((a, b) => a + b, 0);
  if (!total) return null;
  let acc = 0;
  for (let i = 0; i < buckets.length; i++) { acc += buckets[i]; if (acc / total >= p) return i < LOAD_EDGES.length ? LOAD_EDGES[i] : 10_000; }
  return 10_000;
}

const add = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
const top = (o, n = 10) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]).slice(0, n);
const sumMaps = (list, f) => list.reduce((acc, d) => { for (const [k, v] of Object.entries(f(d) || {})) add(acc, k, v); return acc; }, {});
// Сколько разных ников открыли за день. Сами ники не храним (решение владельца 25.11.2026), только число;
// в старых файлах дня был список ников — считаем по нему
const nickCount = d => (typeof d.nicksN === 'number' ? d.nicksN : Object.keys(d.nicks || {}).length + (d.nicksOver || 0));
const sumArr = (list, f) => list.reduce((acc, d) => f(d).map((v, i) => (acc[i] || 0) + v), []);

export function createMonitor({
  dataDir, tz = 'Europe/Moscow', clock = () => Date.now(),
  sendMail = async () => false, mailInfo = () => ({ configured: false }),
  apis = () => null, ai = () => null, deployLog = () => ({ events: [] }), siteUrl = '',
  excludedNick = () => false, uptimeStart = clock(),
} = {}) {
  const dir = path.join(dataDir, 'metrics');
  const daysDir = path.join(dir, 'days');
  const read = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } };
  const write = (f, v) => { try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v)); } catch (e) { console.warn('[статистика]', e.message); } };

  // Соль дня — случайная, живёт только сутки: при смене дня стирается вместе с отпечатками, поэтому
  // ни сегодня завтра, ни владелец сервера не свяжет посетителя между днями и не восстановит по хешу его адрес.
  // Файл нужен, чтобы перезапуск после обновления в тот же день не удваивал посетителей
  const saltFile = path.join(dir, 'day-salt.json');
  try { fs.unlinkSync(path.join(dir, 'secret')); } catch { /* старого постоянного секрета уже нет */ }
  function daySalt(k) {
    const t = read(saltFile, {});
    if (t.day === k && /^[0-9a-f]{64}$/.test(t.salt || '')) return t.salt;
    const salt = crypto.randomBytes(32).toString('hex');
    try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(saltFile, JSON.stringify({ day: k, salt }), { mode: 0o600 }); } catch { /* только в памяти */ }
    return salt;
  }

  // Старые файлы дней хранили список открытых ников — оставляем от него только число
  try {
    for (const f of fs.readdirSync(daysDir)) {
      if (!f.endsWith('.json')) continue;
      const d = read(path.join(daysDir, f), null);
      if (d && (d.nicks || d.nicksOver != null)) { d.nicksN = nickCount(d); delete d.nicks; delete d.nicksOver; write(path.join(daysDir, f), d); }
    }
  } catch { /* папки ещё нет */ }

  let today = dayKey(clock(), tz);
  let salt = daySalt(today);
  let cur = { ...emptyDay(today), ...read(path.join(daysDir, `${today}.json`), {}) };
  const seenFile = read(path.join(dir, 'today-seen.json'), {});
  let seen = new Set(seenFile.day === today ? seenFile.h || [] : []);
  // Ники за сегодня — только хешами с солью дня (чтобы не посчитать один ник дважды), сами ники не пишутся
  let nickSeen = new Set(seenFile.day === today ? seenFile.n || [] : []);
  const groups = new Map(Object.entries(read(path.join(dir, 'errors.json'), {})));
  const alerts = { sent: {}, log: [], lastDeployAt: 0, digestDay: null, digestTriedAt: 0, ...read(path.join(dir, 'alerts.json'), {}) };
  if (!alerts.lastDeployAt) alerts.lastDeployAt = clock() - 10 * MIN; // падение прямо перед включением учёта тоже заметим
  const s5xx = []; // время ответов 5xx за последние 10 минут
  let dirty = false;

  function rotate() {
    const k = dayKey(clock(), tz);
    if (k === today) return;
    flush();
    today = k; salt = daySalt(k); cur = emptyDay(k); seen = new Set(); nickSeen = new Set(); dirty = true;
    // Старше 90 дней — удалить
    try {
      const cutoff = dayKey(clock() - KEEP_DAYS * DAY, tz);
      for (const f of fs.readdirSync(daysDir)) if (f.endsWith('.json') && f.slice(0, 10) < cutoff) fs.unlinkSync(path.join(daysDir, f));
    } catch { /* папки ещё нет */ }
  }

  function flush() {
    if (!dirty) return;
    dirty = false;
    write(path.join(daysDir, `${today}.json`), cur);
    write(path.join(dir, 'today-seen.json'), { day: today, h: [...seen], n: [...nickSeen] });
    write(path.join(dir, 'errors.json'), Object.fromEntries(groups));
    write(path.join(dir, 'alerts.json'), alerts);
  }

  const visitorHash = (ip, ua) => crypto.createHash('sha256').update(`${salt}|${ip}|${ua}`).digest('hex').slice(0, 16);

  /** Просмотр раздела. who: { ip, ua, owner, guest, host } — owner и боты не считаются */
  function view({ section, ref, ms, dnt, lang, utm }, who) {
    rotate();
    if (who.owner || BOT_UA.test(who.ua || '') || dnt) return false;
    const sec = /^[a-z0-9-]{1,24}$/.test(section || '') ? section : 'other';
    const mobile = MOBILE_UA.test(who.ua || '');
    cur.views++; add(cur.sections, sec);
    // Когда заходят: просмотры по часам (время LIVE_TZ)
    if (!Array.isArray(cur.hours) || cur.hours.length !== 24) cur.hours = Array(24).fill(0);
    cur.hours[hourIn(clock(), tz)]++;
    const h = visitorHash(who.ip, who.ua);
    if (!seen.has(h)) {
      seen.add(h); cur.visitors++;
      cur.devices[mobile ? 'mobile' : 'desktop']++;
      cur.who[who.guest ? 'guest' : 'user']++;
      // Язык версии сайта (/ или /en/) — сколько игроков приходит на английскую версию
      cur.langs ||= { ru: 0, en: 0 };
      cur.langs[lang === 'en' ? 'en' : 'ru']++;
      // Откуда пришли — только при первом заходе за день и только домен
      let host = '';
      try { host = ref ? new URL(ref).hostname.replace(/^www\./, '') : ''; } catch { host = ''; }
      const own = String(who.host || '').split(':')[0];
      if (!host || host === own) host = 'прямой заход';
      add(cur.refs, host.slice(0, 60));
      // Страна (код из офлайн-базы, IP сюда не доходит) и основной язык браузера
      cur.countries ||= {}; cur.blangs ||= {}; cur.utm ||= {};
      add(cur.countries, /^[A-Z]{2}$/.test(who.country || '') ? who.country : '?');
      add(cur.blangs, /^([a-z]{2,3}|\?)$/.test(who.blang || '') ? who.blang : '?');
      // Метки utm своих ссылок (Discord, форум, видео) — какая ссылка привела людей
      const u = utmKey(utm);
      if (u) add(cur.utm, cur.utm[u] != null || Object.keys(cur.utm).length < MAX_KEYS ? u : 'другое');
      // С какого раздела начали, браузер и система (только семейство, без версий)
      cur.entries ||= {}; cur.browsers ||= {}; cur.oses ||= {};
      add(cur.entries, sec);
      add(cur.browsers, browserOf(who.ua || ''));
      add(cur.oses, osOf(who.ua || ''));
    }
    const t = Number(ms);
    if (t > 0 && t < 120_000) {
      const i = LOAD_EDGES.findIndex(e => t <= e);
      cur.load[mobile ? 'mobile' : 'desktop'][i < 0 ? LOAD_EDGES.length : i]++;
    }
    dirty = true;
    return true;
  }

  /** Открыли ник: считаем, сколько разных ников открыли за день. Владелец, его кооп, друзья и скрытые не считаются */
  function nick(name, who = {}, uuid = '') {
    rotate();
    const n = String(name || '').trim().toLowerCase();
    if (!/^[a-z0-9_]{1,16}$/.test(n) || who.owner || excludedNick(n, uuid)) return false;
    if (nickSeen.size >= 50_000) return false;
    const k = crypto.createHash('sha256').update(`${salt}|nick|${n}`).digest('hex').slice(0, 16);
    if (nickSeen.has(k)) return false;
    nickSeen.add(k);
    cur.nicksN = nickCount(cur) + 1; dirty = true;
    return true;
  }

  function addError(kind, msg, where, stack, extra = {}) {
    rotate();
    const m = scrub(msg, 300) || 'Без текста';
    const w = scrub(where, 200);
    const fp = crypto.createHash('sha1').update(`${kind}|${m.replace(/\d+/g, 'N')}|${w}`).digest('hex').slice(0, 12);
    const now = clock();
    let g = groups.get(fp);
    if (!g) {
      if (groups.size >= MAX_GROUPS) { const oldest = [...groups.values()].sort((a, b) => a.last - b.last)[0]; groups.delete(oldest.fp); }
      g = { fp, kind, msg: m, where: w, stack: scrub(stack, 1200).split('\n').slice(0, 6).join('\n'), count: 0, first: now, last: now, recent: [], sections: {}, mobile: 0 };
      groups.set(fp, g);
    }
    g.count++; g.last = now;
    g.recent = [...g.recent.filter(t => now - t < 10 * MIN), now].slice(-30);
    if (extra.section) add(g.sections, String(extra.section).slice(0, 24));
    if (extra.mobile) g.mobile++;
    if (extra.build) g.build = String(extra.build).slice(0, 20);
    cur.errors[kind] = (cur.errors[kind] || 0) + 1;
    dirty = true;
    return g;
  }

  /** Ошибка из браузера (окно, промис, падение раздела React) */
  function clientError({ msg, stack, section, kind, build }, who) {
    if (BOT_UA.test(who.ua || '')) return null;
    const where = normWhere(stack) || (kind === 'react' ? 'React' : '');
    return addError('client', msg, where, stack, { section, mobile: MOBILE_UA.test(who.ua || ''), build });
  }

  /** Ошибка сервера: исключение в обработчике, фоновая задача, необработанный отказ.
   *  Сбой сети или ответ внешнего API (Hypixel, Coflnet…) — отдельный вид 'api': о нём тревожит «Hypixel молчит», а не всплеск ошибок */
  function serverError(err, where = '') {
    const msg = err?.message || String(err);
    const net = err?.cause?.code || err?.name === 'AbortError' || err?.name === 'TimeoutError' || /fetch failed|HTTP \d{3}|таймаут|timeout|ECONN|ENOTFOUND|EAI_AGAIN|socket hang up|network/i.test(msg);
    return addError(net && where.startsWith('фон:') ? 'api' : 'server', msg, where || normWhere(err?.stack), err?.stack || '');
  }

  /** middleware: каждый ответ 5xx — в счётчик (и в группу, если обработчик не сообщил ошибку сам) */
  function track5xx(req, res, next) {
    res.on('finish', () => {
      // sbExpected: ожидаемая недоступность (сервер только что перезапустился, Hypixel не ответил) — не сбой сервера
      if (res.statusCode < 500 || res.locals?.sbExpected) return;
      const now = clock();
      s5xx.push(now); while (s5xx.length && now - s5xx[0] > 10 * MIN) s5xx.shift();
      cur.s5xx++; dirty = true;
      if (!res.locals.sbErrorRecorded) addError('server', `HTTP ${res.statusCode}`, `${req.method} ${routeOf(req)}`, '');
    });
    next();
  }

  /** Обработчик ошибок Express (ставится последним) */
  function errorHandler(err, req, res, next) {
    const status = err.status || err.statusCode || 500;
    // 4xx — плохой запрос, а не сбой сервера: обрыв связи браузером («request aborted»: закрыли вкладку, пропала сеть
    // на телефоне, пока уходил запрос), кривой JSON, слишком большое тело. В журнал ошибок сервера не пишем
    if (status >= 500) { serverError(err, `${req.method} ${routeOf(req)}`); res.locals.sbErrorRecorded = true; }
    if (res.headersSent) return next(err);
    if (err.type === 'request.aborted') return res.status(400).end(); // отвечать уже некому
    if (status < 500) return res.status(status).json({ error: err.expose ? err.message : 'Неверный запрос' });
    res.status(500).json({ error: 'Ошибка на сервере. Она уже записана — владелец сайта увидит её' });
  }

  // ---------- Тревоги ----------
  async function alert(key, title, text) {
    const now = clock();
    if (alerts.sent[key] && now - alerts.sent[key] < ALERT_EVERY) return false;
    alerts.sent[key] = now;
    for (const [k, t] of Object.entries(alerts.sent)) if (now - t > DAY) delete alerts.sent[k];
    const entry = { at: now, key, title, mailed: false };
    alerts.log.unshift(entry); alerts.log.length = Math.min(alerts.log.length, 50);
    dirty = true;
    try { entry.mailed = await sendMail({ subject: `⚠ ${title}`, text: `${text}\n\n${linkLine()}` }); } catch (e) { entry.error = scrub(e.message, 160); }
    flush();
    return true;
  }
  const linkLine = () => (siteUrl ? `Подробно: ${siteUrl}/#/status` : 'Подробно: страница «Сервер» на сайте');

  /** Проверки раз в минуту: падения, ключ Hypixel, Hypixel молчит, всплеск ошибок, лимит ИИ, сводка */
  async function check() {
    rotate();
    const now = clock();
    const fired = [];
    // 1. Падение или откат сервера (журнал автообновления)
    const evs = (deployLog().events || []).filter(e => e.at > alerts.lastDeployAt);
    if (evs.length) alerts.lastDeployAt = Math.max(...evs.map(e => e.at)), dirty = true;
    for (const e of evs) {
      if (e.kind === 'crash') fired.push(alert(`crash:${e.at}`, 'Сервер сайта упал', `Сервер упал (код ${e.code ?? '—'}) ${new Date(e.at).toLocaleString('ru-RU', { timeZone: tz })}. Автообновление его перезапустило.`));
      if (e.kind === 'rollback') fired.push(alert(`rollback:${e.at}`, 'Обновление откачено', `Новая версия ${e.from || ''} не запустилась, вернул ${e.to || 'прошлую'}. Причина: ${e.why || 'неизвестна'}.`));
    }
    // 2–3. Hypixel: неверный ключ; не отвечает больше 15 минут
    const snap = (() => { try { return apis(); } catch { return null; } })();
    if (snap) {
      const h = snap.hypixel || {};
      if (h.keyErrorAt && h.keyErrorAt > (h.keyOkAt || 0)) fired.push(alert('hypixel-key', 'Ключ Hypixel не работает', `Hypixel отклоняет ключ: ${h.keyError || 'ошибка 403'}. Профили не обновляются. Выпусти новый ключ на developer.hypixel.net и впиши в .env (HYPIXEL_API_KEY).`));
      const hyp = (snap.sources || []).filter(s => s.id.startsWith('hypixel'));
      const down = hyp.length && hyp.every(s => s.lastErrAt > s.lastOkAt && now - s.lastErrAt < 5 * MIN && now - Math.max(s.lastOkAt || uptimeStart, uptimeStart) > 15 * MIN);
      if (down) fired.push(alert('hypixel-down', 'Hypixel не отвечает больше 15 минут', `Последняя ошибка: ${hyp[0].lastError || '—'}. Цены и профили не обновляются, сайт показывает старые данные.`));
    }
    // 4. Всплеск ошибок: новая группа 5+ раз за 10 минут; 20+ ответов 5xx за 10 минут
    for (const g of groups.values()) {
      const recent = g.recent.filter(t => now - t < 10 * MIN).length;
      if (g.kind !== 'api' && recent >= 5 && now - g.first < DAY) fired.push(alert(`err:${g.fp}`, `Новая ошибка ${g.kind === 'client' ? 'в браузере' : 'на сервере'} (${recent} раз за 10 мин)`, `${g.msg}\nГде: ${g.where || '—'}${Object.keys(g.sections).length ? `\nРаздел: ${top(g.sections, 3).map(([k]) => k).join(', ')}` : ''}\n\n${g.stack || ''}`));
    }
    while (s5xx.length && now - s5xx[0] > 10 * MIN) s5xx.shift();
    if (s5xx.length >= 20) fired.push(alert('5xx', `Сервер отвечает ошибками: ${s5xx.length} за 10 минут`, `Самые частые: ${[...groups.values()].filter(g => g.kind === 'server').sort((a, b) => b.last - a.last).slice(0, 3).map(g => `${g.msg} (${g.where})`).join('; ')}`));
    // 5. Дневной лимит ИИ-советчика
    const b = (() => { try { return ai(); } catch { return null; } })();
    if (b && b.today?.usd > 0 && b.leftUsd <= 0) fired.push(alert(`ai:${today}`, 'Дневной лимит ИИ-советчика исчерпан', `Потрачено $${b.today.usd.toFixed(3)} из $${b.dailyUsd}. До конца суток советчик отвечает только шаблонами. Лимит меняется в настройках советчика или LIVE_DAILY_USD.`));
    await Promise.all(fired);
    // 6. Сводка раз в сутки в 9 утра (если не вышло — повтор через час)
    if (hourIn(now, tz) >= 9 && alerts.digestDay !== today && now - (alerts.digestTriedAt || 0) > HOUR) {
      alerts.digestTriedAt = now; dirty = true;
      if (!mailInfo().configured) alerts.digestDay = today;
      else {
        try { if (await sendMail({ subject: `Сводка за ${prevDay(today).slice(8, 10)}.${prevDay(today).slice(5, 7)}`, text: digestText() })) alerts.digestDay = today; } catch (e) { console.warn('[сводка]', e.message); }
      }
    }
    flush();
    return fired.length;
  }

  // ---------- Чтение ----------
  function loadDay(k) { return k === today ? cur : { ...emptyDay(k), ...read(path.join(daysDir, `${k}.json`), {}) }; }
  function lastDays(n) { const out = []; let k = today; for (let i = 0; i < n; i++) { out.push(loadDay(k)); k = prevDay(k); } return out; }
  function sumDays(list) {
    return {
      visitors: list.reduce((a, d) => a + d.visitors, 0), views: list.reduce((a, d) => a + d.views, 0),
      sections: top(sumMaps(list, d => d.sections), 20), refs: top(sumMaps(list, d => d.refs), 15),
      refGroups: (() => { const g = { search: 0, social: 0, sites: 0, direct: 0 }; for (const [k, v] of Object.entries(sumMaps(list, d => d.refs))) g[refGroup(k)] += v; return g; })(),
      entries: top(sumMaps(list, d => d.entries), 10), browsers: top(sumMaps(list, d => d.browsers), 8), oses: top(sumMaps(list, d => d.oses), 8),
      hours: list.reduce((acc, d) => (Array.isArray(d.hours) && d.hours.length === 24 ? acc.map((v, i) => v + d.hours[i]) : acc), Array(24).fill(0)),
      devices: { mobile: list.reduce((a, d) => a + d.devices.mobile, 0), desktop: list.reduce((a, d) => a + d.devices.desktop, 0) },
      who: { guest: list.reduce((a, d) => a + d.who.guest, 0), user: list.reduce((a, d) => a + d.who.user, 0) },
      langs: { ru: list.reduce((a, d) => a + (d.langs?.ru || 0), 0), en: list.reduce((a, d) => a + (d.langs?.en || 0), 0) },
      countries: top(sumMaps(list, d => d.countries), 20), blangs: top(sumMaps(list, d => d.blangs), 12), utm: top(sumMaps(list, d => d.utm), 15),
      load: Object.fromEntries(['mobile', 'desktop'].map(k => { const b = sumArr(list, d => d.load[k]); return [k, { p50: percentile(b, 0.5), p75: percentile(b, 0.75), n: b.reduce((x, y) => x + y, 0) }]; })),
      // За период — сумма по дням: один ник в разные дни считается в каждом (связать дни нельзя)
      nicks: { distinct: list.reduce((a, d) => a + nickCount(d), 0) },
      errors: { client: list.reduce((a, d) => a + d.errors.client, 0), server: list.reduce((a, d) => a + d.errors.server, 0), api: list.reduce((a, d) => a + (d.errors.api || 0), 0) }, s5xx: list.reduce((a, d) => a + d.s5xx, 0),
    };
  }

  function errorList() {
    const now = clock();
    for (const [k, g] of groups) if (now - g.last > GROUP_TTL) { groups.delete(k); dirty = true; }
    return [...groups.values()].sort((a, b) => b.last - a.last).slice(0, 100)
      .map(({ recent, ...g }) => ({ ...g, last10m: recent.filter(t => now - t < 10 * MIN).length, sections: top(g.sections, 3).map(([k]) => k) }));
  }

  /** Для страницы «Сервер» (только владелец) */
  function summary() {
    rotate();
    const all = lastDays(KEEP_DAYS);
    const days30 = all.slice(0, 30);
    // Прошлый такой же период — для «▲ 12% к прошлой неделе» (у 90 дней сравнивать не с чем: старше не храним)
    const brief = l => { const x = sumDays(l); return { visitors: x.visitors, views: x.views, mobile: x.devices.mobile, en: x.langs.en, nicks: x.nicks.distinct }; };
    return {
      tz, today: sumDays([cur]), yesterday: sumDays([days30[1]]), week: sumDays(days30.slice(0, 7)), month: sumDays(days30), quarter: sumDays(all),
      prev: { yesterday: brief([all[2]]), week: brief(all.slice(7, 14)), month: brief(all.slice(30, 60)) },
      days: all.map(d => ({ day: d.day, visitors: d.visitors, views: d.views, en: d.langs?.en || 0, nicks: nickCount(d), errors: d.errors.client + d.errors.server })).reverse(),
      errors: errorList(), alerts: alerts.log.slice(0, 20),
      mail: { ...mailInfo(), digestDay: alerts.digestDay },
    };
  }

  function resolve(fp) { const ok = groups.delete(fp); if (ok) { dirty = true; flush(); } return ok; }

  const ru = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const sec = ms => (ms == null ? '—' : ms >= 10_000 ? 'дольше 7 с' : `до ${(ms / 1000).toFixed(1).replace('.', ',')} с`);
  const diff = (a, b) => (!b ? '' : ` (неделю назад ${ru(b)}, ${a >= b ? '+' : ''}${Math.round((a - b) / b * 100)}%)`);

  /** Текст ежедневной сводки за вчера */
  function digestText() {
    const y = prevDay(today), weekAgo = loadDay(dayKey(Date.parse(`${y}T12:00:00Z`) - 7 * DAY, 'UTC'));
    const s = sumDays([loadDay(y)]);
    const now = clock();
    const fresh = [...groups.values()].filter(g => now - g.first < DAY).sort((a, b) => b.count - a.count);
    const errs24 = [...groups.values()].filter(g => now - g.last < DAY);
    const snap = (() => { try { return apis(); } catch { return null; } })();
    const bad = (snap?.sources || []).filter(x => x.state === 'error');
    const key = snap?.hypixel ? (snap.hypixel.keyErrorAt > (snap.hypixel.keyOkAt || 0) ? 'НЕ РАБОТАЕТ' : snap.hypixel.keyOkAt ? 'работает' : 'ещё не проверялся') : '—';
    const b = (() => { try { return ai(); } catch { return null; } })();
    const evs = (deployLog().events || []).filter(e => now - e.at < DAY);
    const cnt = k => evs.filter(e => e.kind === k).length;
    const lines = [
      `Сводка за ${y.split('-').reverse().join('.')}`,
      '',
      `Посетители: ${ru(s.visitors)}${diff(s.visitors, weekAgo.visitors)}`,
      `Просмотры разделов: ${ru(s.views)}`,
      `С телефона: ${s.visitors ? Math.round(s.devices.mobile / s.visitors * 100) : 0}% · вошедших: ${s.who.user}`,
      `Загрузка (у половины): ПК ${sec(s.load.desktop.p50)}, телефон ${sec(s.load.mobile.p50)}`,
      s.sections.length ? `Разделы: ${s.sections.slice(0, 6).map(([k, v]) => `${k} ${v}`).join(', ')}` : null,
      `Версия сайта: русская ${s.langs.ru}, английская ${s.langs.en}`,
      s.countries.length ? `Страны: ${s.countries.slice(0, 6).map(([k, v]) => `${k} ${v}`).join(', ')}` : null,
      s.blangs.length ? `Язык браузера: ${s.blangs.slice(0, 6).map(([k, v]) => `${k} ${v}`).join(', ')}` : null,
      s.refs.length ? `Откуда: ${s.refs.slice(0, 5).map(([k, v]) => `${k} ${v}`).join(', ')}` : null,
      s.utm.length ? `Метки utm: ${s.utm.slice(0, 5).map(([k, v]) => `${k} ${v}`).join(', ')}` : null,
      `Ники: открыли ${s.nicks.distinct} разных`,
      '',
      `Ошибки за сутки: браузер ${s.errors.client}, сервер ${s.errors.server}, сбоев внешних API ${s.errors.api}, ответов 5xx ${s.s5xx}. Активных групп: ${errs24.length}.`,
      ...fresh.filter(g => g.kind !== 'api').slice(0, 5).map(g => `  • новая (${g.kind === 'client' ? 'браузер' : 'сервер'}, ${g.count} раз): ${g.msg.slice(0, 140)}${g.where ? ` — ${g.where.slice(0, 80)}` : ''}`),
      `Ключ Hypixel: ${key}`,
      bad.length ? `Внешние API с ошибкой сейчас: ${bad.map(x => `${x.name} (${x.lastError || '—'})`).join('; ')}` : 'Внешние API: все отвечают',
      b ? `ИИ-советчик: сегодня $${(b.today?.usd || 0).toFixed(3)} из $${b.dailyUsd}, за месяц $${(b.monthUsd || 0).toFixed(2)}` : null,
      `Сервер: обновлений ${cnt('update')}, откатов ${cnt('rollback')}, падений ${cnt('crash')}`,
      '',
      linkLine(),
    ];
    return lines.filter(l => l != null).join('\n');
  }

  let timer = null;
  function start(every = MIN) { if (!timer) { timer = setInterval(() => check().catch(e => console.warn('[тревоги]', e.message)), every); timer.unref?.(); } }
  function stop() { clearInterval(timer); timer = null; flush(); }

  /** Посетители, открытые ники и языки за день (для расчёта «запросов к Hypixel на посетителя») */
  function dayStats(k) { rotate(); const d = loadDay(k); return { visitors: d.visitors, nicks: nickCount(d), langs: { ru: d.langs?.ru || 0, en: d.langs?.en || 0 } }; }

  return { view, nick, dayStats, clientError, serverError, track5xx, errorHandler, check, summary, resolve, digestText, flush, start, stop, alert };
}

/**
 * Приём событий из браузера: POST /api/t, тело — текст с JSON (так работает navigator.sendBeacon).
 * { t: 'view', p: 'money', r: referrer, u: '?utm_source=…', ms, g: 1, l: 'ru' } или { t: 'err', m, s, p, k, b } или массив до 10 событий.
 */
export function beaconHandler(monitor, { clientIp, isOwner, build = () => '', country = () => '' }) {
  const hits = new Map(); // ip → [время]
  return (req, res) => {
    res.status(204).end();
    const ip = clientIp(req) || '';
    const now = Date.now();
    const list = (hits.get(ip) || []).filter(t => now - t < MIN);
    if (list.length >= 60) return;
    list.push(now); hits.set(ip, list);
    if (hits.size > 5000) hits.clear();
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return; } }
    if (Buffer.isBuffer(body)) { try { body = JSON.parse(body.toString('utf8')); } catch { return; } }
    const events = (Array.isArray(body) ? body : [body]).slice(0, 10).filter(e => e && typeof e === 'object');
    const who = { ip, ua: String(req.headers['user-agent'] || '').slice(0, 300), owner: !!isOwner(req), host: req.headers.host };
    // Страну и язык браузера узнаём только для просмотра; IP дальше хеша посетителя не уходит
    if (events.some(e => e.t === 'view')) {
      try { who.country = country(ip) || ''; } catch { who.country = ''; }
      who.blang = browserLang(req.headers['accept-language']);
    }
    for (const e of events) {
      if (e.t === 'view') monitor.view({ section: String(e.p || ''), ref: typeof e.r === 'string' ? e.r.slice(0, 300) : '', ms: e.ms, dnt: !!e.dnt, lang: e.l === 'en' ? 'en' : 'ru', utm: typeof e.u === 'string' ? e.u.slice(0, 500) : '' }, { ...who, guest: !!e.g });
      else if (e.t === 'err') monitor.clientError({ msg: String(e.m || '').slice(0, 500), stack: String(e.s || '').slice(0, 3000), section: String(e.p || '').slice(0, 24), kind: e.k, build: build() }, who);
    }
  };
}
