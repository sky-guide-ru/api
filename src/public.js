// Открытая часть сайта: robots.txt, sitemap.xml, настройки для браузера (номер Метрики, блоки РСЯ, донат —
// сами скрипты Яндекса грузятся только после согласия на cookie), лимит Visitors на просмотр чужих ников.
//
// Всё включается из .env (без них ничего не подключается и сайт работает как раньше):
//   SITE_URL=https://твой-домен.ru         адрес сайта: canonical, sitemap
//   YANDEX_VERIFICATION=abc123              код подтверждения сайта в Яндекс Вебмастере (мета-тег)
//   GOOGLE_SITE_VERIFICATION=… / BING_SITE_VERIFICATION=…  то же для Google Search Console и Bing Webmaster
//   YANDEX_METRIKA_ID=12345678              номер счётчика Метрики
//   YANDEX_RTB_BOTTOM=R-A-1234567-1         id рекламного блока РСЯ внизу страниц
//   YANDEX_RTB_LANDING=R-A-1234567-2        id блока на стартовой странице (если пусто — берётся BOTTOM)
//   DONATE_URL=https://boosty.to/...        кнопка «Поддержать» (Boosty, DonationAlerts, ЮMoney и т.п.)
//   CONTACT_EMAIL=почта@домен.ru            почта для связи: ссылка «Написать на почту» в подвале сайта (и в /legal)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { discordLinkConfig } from './discord-link.js';

const RTB = /^R-A-\d{4,12}-\d{1,6}$/;
const DIGITS = /^\d{4,12}$/;
const TOKEN = /^[A-Za-z0-9_-]{4,80}$/;
const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[a-z]{2,24}$/i;

/** Безопасная https-ссылка (без кавычек и пробелов) или '' */
export function safeUrl(u) {
  try {
    const x = new URL(String(u || '').trim());
    return x.protocol === 'https:' && !/["'<>\s]/.test(x.href) ? x.href : '';
  } catch { return ''; }
}

/** Что из .env попадает в браузер (window.SB_PUBLIC). Неправильные значения молча отбрасываются. */
export function publicConfig(env = process.env) {
  const bottom = RTB.test(String(env.YANDEX_RTB_BOTTOM || '').trim()) ? env.YANDEX_RTB_BOTTOM.trim() : '';
  const landing = RTB.test(String(env.YANDEX_RTB_LANDING || '').trim()) ? env.YANDEX_RTB_LANDING.trim() : bottom;
  const metrika = DIGITS.test(String(env.YANDEX_METRIKA_ID || '').trim()) ? Number(env.YANDEX_METRIKA_ID.trim()) : null;
  return {
    siteUrl: safeUrl(env.SITE_URL).replace(/\/$/, ''),
    metrika,
    rtb: { bottom, landing },
    donateUrl: safeUrl(env.DONATE_URL),
    publicView: env.PUBLIC_VIEW !== '0',
    discordLink: discordLinkConfig(env).enabled, // страница /discord с привязкой ника (иначе там просто ссылка на сервер)
    contactEmail: EMAIL.test(String(env.CONTACT_EMAIL || '').trim()) ? env.CONTACT_EMAIL.trim() : '',
  };
}

// Коды подтверждения прав на сайт. Можно задать в .env, а можно вписать сюда (они не секретные: всё равно видны в коде страницы)
export const VERIFY = { yandex: '', google: '', bing: '' };
// Подтверждение файлом: Яндекс Вебмастер (способ «HTML-файл») — /yandex_<код>.html
// Google Search Console (способ «HTML-файл») — /google<код>.html
export const VERIFY_FILES = { yandex: ['19aa7ebe71b656bf'], google: ['cf3a4e7c47d359f6'] };

function verifyTags(env) {
  const out = [];
  const pick = (k, v) => { const x = String(env[k] || v || '').trim(); return TOKEN.test(x) ? x : ''; };
  const y = pick('YANDEX_VERIFICATION', VERIFY.yandex), g = pick('GOOGLE_SITE_VERIFICATION', VERIFY.google), b = pick('BING_SITE_VERIFICATION', VERIFY.bing);
  if (y) out.push(`<meta name="yandex-verification" content="${y}" />`);
  if (g) out.push(`<meta name="google-site-verification" content="${g}" />`);
  if (b) out.push(`<meta name="msvalidate.01" content="${b}" />`);
  return out;
}

const escAttr = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * @param {object} env
 * @param {{ origin?: string, seo?: object|null, noindex?: boolean, jsonld?: (list, origin) => string }} [o]
 */
function headTags(env, o = {}) {
  const c = publicConfig(env);
  const origin = o.origin || c.siteUrl;
  const tags = [`<script>window.SB_PUBLIC=${JSON.stringify(c).replace(/</g, '\\u003c')}</script>`, ...verifyTags(env)];
  if (o.noindex) tags.push('<meta name="robots" content="noindex, follow" />');
  else if (origin) {
    // Английская версия — та же страница с /en в начале адреса; обе ссылаются друг на друга (hreflang)
    const p = o.seo?.path || '/', en = p === '/' ? '/en/' : `/en${p}`;
    const url = origin + (o.lang === 'en' ? en : p);
    tags.push(`<link rel="canonical" href="${escAttr(url)}" />`, `<meta property="og:url" content="${escAttr(url)}" />`,
      `<link rel="alternate" hreflang="ru" href="${escAttr(origin + p)}" />`, `<link rel="alternate" hreflang="en" href="${escAttr(origin + en)}" />`,
      `<link rel="alternate" hreflang="x-default" href="${escAttr(origin + p)}" />`);
  }
  const og = o.lang === 'en' ? 'og-en.png' : 'og.png';
  if (origin) tags.push(`<meta property="og:image" content="${origin}/${og}${ogVersion(o.dir, og)}" />`, '<meta property="og:image:width" content="1200" />', '<meta property="og:image:height" content="630" />');
  tags.push('<meta property="og:site_name" content="Sky Guide" />', '<meta name="twitter:card" content="summary_large_image" />');
  if (o.seo?.jsonld && o.jsonld && origin) tags.push(o.jsonld(o.seo.jsonld, origin));
  // Метрику и рекламу РСЯ сервер в страницу НЕ вставляет: их скрипты ставят cookie и передают Яндексу IP посетителя,
  // поэтому браузер подгружает их только после согласия в баннере cookie (client/src/ads.js, consent.js).
  return tags.join('\n    ');
}

// ?v=… по содержимому картинки превью: Discord, Telegram и ВК кэшируют превью по адресу,
// поэтому новая og.png получает новый адрес сама, без ручного номера
const ogCache = new Map();
function ogVersion(dir, name) {
  if (!dir) return '';
  const file = path.join(dir, name);
  let st;
  try { st = fs.statSync(file); } catch { return ''; }
  const hit = ogCache.get(file);
  if (hit?.mtime === st.mtimeMs && hit.size === st.size) return hit.v;
  const v = `?v=${crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 8)}`;
  ogCache.set(file, { mtime: st.mtimeMs, size: st.size, v });
  return v;
}

const cache = { file: '', mtime: 0, html: '' };
/** index.html со вставками из .env перед </head>; для открытых страниц — свои заголовок, описание и готовый текст */
export function renderIndexHtml(file, env = process.env, o = {}) {
  let st;
  try { st = fs.statSync(file); } catch { return '<!doctype html><title>SkyBlock трекер</title><p>Сайт ещё не собран: npm run build</p>'; }
  if (cache.file !== file || cache.mtime !== st.mtimeMs) Object.assign(cache, { file, mtime: st.mtimeMs, html: fs.readFileSync(file, 'utf8') });
  let html = cache.html;
  const seo = o.seo;
  if (seo) {
    const t = escAttr(seo.title), d = escAttr(seo.description);
    html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${t}</title>`)
      .replace(/<meta name="description" content="[^"]*"\s*\/?>/, () => `<meta name="description" content="${d}" />`)
      .replace(/<meta property="og:title" content="[^"]*"\s*\/?>/, () => `<meta property="og:title" content="${t}" />`)
      .replace(/<meta property="og:description" content="[^"]*"\s*\/?>/, () => `<meta property="og:description" content="${d}" />`)
      .replace(/<meta property="og:type" content="[^"]*"\s*\/?>/, () => `<meta property="og:type" content="${seo.ogType || 'website'}" />`);
    if (seo.body) html = html.replace('<div id="root"></div>', () => `<div id="root"><div class="seo-pre">${seo.body}</div></div>`);
  }
  return html.replace('</head>', () => `    ${headTags(env, { ...o, dir: path.dirname(file) })}\n  </head>`);
}

// Поисковые роботы и роботы нейросетей, которым явно разрешён сайт (кроме /api и входа)
export const BOTS = ['Yandex', 'Googlebot', 'Bingbot', 'DuckDuckBot', 'Applebot', 'OAI-SearchBot', 'ChatGPT-User', 'GPTBot',
  'PerplexityBot', 'Perplexity-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'Google-Extended', 'Applebot-Extended', 'YandexAdditional', 'meta-externalagent', 'MistralAI-User', 'cohere-ai'];
const CLOSED = ['/api/', '/account', '/login', '/logout'];

export function robotsTxt(env = process.env, origin = '') {
  const c = publicConfig(env);
  if (!c.publicView) return 'User-agent: *\nDisallow: /\n';
  const site = origin || c.siteUrl;
  const block = agents => [...agents.map(a => `User-agent: ${a}`), 'Allow: /', ...CLOSED.map(p => `Disallow: ${p}`)];
  return [
    '# Сайт открыт для поисковиков и нейросетей. Профили игроков (?player=) не индексируются.',
    ...block(['*']), 'Allow: /privacy', 'Allow: /terms', 'Allow: /legal', 'Allow: /api-terms', '',
    ...block(BOTS),
    // Яндекс: адреса с ?player= — это тот же сайт с чужим профилем, отдельно их не обходить (директива действует в любом месте файла)
    'Clean-param: player&profile', '',
    ...(site ? [`Sitemap: ${site}/sitemap.xml`, ''] : []),
  ].join('\n');
}

/** Карта сайта: только главная (без модуля seo). */
export function sitemapXml(env = process.env) {
  const c = publicConfig(env);
  if (!c.siteUrl) return null;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${c.siteUrl}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n</urlset>\n`;
}

/**
 * robots.txt, sitemap.xml, llms.txt, llms-full.txt и ключ IndexNow.
 * @param {{ env?: object, seo?: ReturnType<import('./seo/index.js').createSeo>, origin?: (req) => string, indexNowKey?: string }} [o]
 */
export function mountPublicRoutes(app, { env = process.env, seo = null, origin = () => '', indexNowKey = '' } = {}) {
  const site = req => publicConfig(env).siteUrl || origin(req);
  const day = res => res.set('Cache-Control', 'public, max-age=3600');
  app.get('/robots.txt', (req, res) => day(res).type('text/plain').send(robotsTxt(env, site(req))));
  app.get('/sitemap.xml', (req, res) => {
    const o = site(req);
    const x = seo && o ? seo.sitemap(o) : sitemapXml(env);
    return x ? day(res).type('application/xml').send(x) : res.status(404).type('text').send('Задай SITE_URL в .env');
  });
  if (seo) {
    app.get('/llms.txt', (req, res) => day(res).type('text/plain; charset=utf-8').send(seo.llms(site(req))));
    app.get('/llms-full.txt', (req, res) => day(res).type('text/plain; charset=utf-8').send(seo.llmsFull(site(req))));
  }
  app.get(/^\/yandex_([0-9a-f]{8,32})\.html$/, (req, res, next) => {
    const code = req.params[0];
    if (!VERIFY_FILES.yandex.includes(code)) return next();
    res.type('html').send(`<html>\n    <head>\n        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">\n    </head>\n    <body>Verification: ${code}</body>\n</html>\n`);
  });
  app.get(/^\/google([0-9a-f]{8,32})\.html$/, (req, res, next) => {
    const code = req.params[0];
    if (!VERIFY_FILES.google.includes(code)) return next();
    res.type('html').send(`google-site-verification: google${code}.html\n`);
  });
  if (indexNowKey) app.get(`/${indexNowKey}.txt`, (req, res) => res.type('text/plain').send(indexNowKey));
}

/**
 * Лимит гостя: сколько РАЗНЫХ игроков можно открыть с одного IP за окно. Повторно открыть уже открытого — можно всегда.
 * @param {{ max?: number, windowMs?: number, clock?: () => number }} [o]
 */
export function createGuestLimiter(o = {}) {
  const max = o.max ?? 30, windowMs = o.windowMs ?? 10 * 60_000, clock = o.clock || (() => Date.now());
  const byIp = new Map(); // ip → { keys: Set, until }
  return {
    allow(ip, key) {
      const now = clock();
      let e = byIp.get(ip);
      if (!e || e.until <= now) { e = { keys: new Set(), until: now + windowMs }; byIp.set(ip, e); }
      if (byIp.size > 10_000) for (const [k, v] of byIp) if (v.until <= now) byIp.delete(k);
      if (e.keys.has(key)) return true;
      if (e.keys.size >= max) return false;
      e.keys.add(key);
      return true;
    },
  };
}
