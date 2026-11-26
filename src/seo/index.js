// Сайт в поиске и нейросетях: обычные адреса открытых разделов с готовым текстом, заголовками и превью,
// sitemap.xml, robots.txt, llms.txt (краткая карта для нейросетей) и llms-full.txt (все гайды текстом), IndexNow.
//
// Профили игроков (?player=…) не индексируются: noindex + Clean-param для Яндекса. Ники в эти страницы не попадают:
// гайды собираются как для гостя без профиля, рейтинг и сравнение отдают только общее описание.
import { SECTIONS, HOME, GUIDE_DESCRIPTIONS, ITEM_SKIP, SITE_NAME } from './pages.js';
import { plainNews } from '@sky-guide/core/news/links.js';
import { esc, publicSections, sectionHtml, sectionMd, itemParts } from './render.js';
import { tx } from '@sky-guide/core/i18n/msg.js';

export const INDEXNOW_KEY = process.env.INDEXNOW_KEY || '00000000000000000000000000000000';
const TTL = 10 * 60_000;
const ID_RE = /^[A-Za-z0-9_;:\-.]{1,80}$/;

export const itemPath = id => `/item/${encodeURIComponent(id)}`;

/** Нормальный адрес сайта: SITE_URL или https://<Host> (только похожий на домен). */
export function originOf(siteUrl, host) {
  if (siteUrl) return siteUrl.replace(/\/$/, '');
  const h = String(host || '').toLowerCase();
  return /^[a-z0-9.-]+(:\d+)?$/.test(h) ? `${/^(localhost|127\.)/.test(h) ? 'http' : 'https'}://${h}` : '';
}

/**
 * @param {{
 *   guides: () => Array<{ id, title, group, sections }>,    гайды, собранные для гостя без профиля
 *   groups?: Record<string,string>,
 *   news?: Array<{ id, date, title, items }>,
 *   items?: { all: () => object[], get: (id) => object|null, lore: (id) => string[]|null },
 *   priceOf?: (id) => number,
 *   clock?: () => number,
 * }} deps
 */
export function createSeo(deps) {
  const clock = deps.clock || Date.now;
  const news = deps.news || [];
  const lastmod = news[0]?.date || null;
  let cache = { at: -Infinity, guides: [] };
  const guides = () => {
    if (clock() - cache.at > TTL) {
      let list = [];
      try { list = deps.guides() || []; } catch { list = cache.guides; }
      cache = { at: clock(), guides: list.filter(g => g && g.status !== 'error') };
    }
    return cache.guides;
  };
  const guideTitle = g => tx`${g.title}: гайд по Hypixel SkyBlock`;
  const guideDesc = g => GUIDE_DESCRIPTIONS[g.id] || tx`Гайд «${g.title}» по Hypixel SkyBlock на русском.`;

  const nav = () => tx`<nav><a href="/">Главная</a> · ${SECTIONS.map(s => tx`<a href="${s.path}">${esc(s.h1)}</a>`).join(' · ')}</nav>`;
  const guideLinks = () => tx`<ul>${guides().map(g => tx`<li><a href="/guides/${encodeURIComponent(g.id)}">${esc(g.title)}</a> — ${esc(guideDesc(g))}</li>`).join('')}</ul>`;
  const crumbs = list => ({ '@type': 'BreadcrumbList', itemListElement: list.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: path })) });

  /** Страница по адресу → { path, page, sub?, item?, title, description, body, jsonld, ogType } или null. */
  function pageFor(pathname) {
    let p;
    try { p = decodeURIComponent(String(pathname || '/')).replace(/\/+$/, '') || '/'; } catch { return null; }
    if (p === '/') {
      return {
        ...HOME, ogType: 'website',
        body: tx`<h1>${esc(HOME.h1)}</h1>${HOME.intro.map(t => tx`<p>${esc(t)}</p>`).join('')}<ul>${HOME.features.map(f => tx`<li>${esc(f)}</li>`).join('')}</ul>${nav()}<h2>Гайды</h2>${guideLinks()}`,
        jsonld: [{ '@type': 'WebSite', name: SITE_NAME, description: HOME.description, inLanguage: 'ru', url: '/' }],
      };
    }
    const sec = SECTIONS.find(s => s.path === p);
    if (sec) {
      let extra = '';
      if (sec.page === 'guides') extra = guideLinks();
      if (sec.page === 'news') extra = news.slice(0, 30).map(e => tx`<article><h2>${esc(plainNews(e.title))}</h2><p><time datetime="${esc(e.date)}">${esc(e.date)}</time></p><ul>${e.items.map(i => tx`<li>${esc(plainNews(i))}</li>`).join('')}</ul></article>`).join('');
      return {
        ...sec, ogType: 'website',
        body: tx`<h1>${esc(sec.h1)}</h1>${sec.intro.map(t => tx`<p>${esc(t)}</p>`).join('')}${extra}${nav()}`,
        jsonld: [{ '@type': 'CollectionPage', name: sec.h1, description: sec.description, inLanguage: 'ru', url: sec.path }, crumbs([['Главная', '/'], [sec.h1, sec.path]])],
      };
    }
    let m = /^\/guides\/([a-z0-9-]{1,40})$/.exec(p);
    if (m) {
      const g = guides().find(x => x.id === m[1]);
      if (!g) return null;
      const path = `/guides/${g.id}`;
      const sections = publicSections(g).map(sectionHtml).filter(Boolean).join('');
      return {
        path, page: 'guides', sub: g.id, title: guideTitle(g), description: guideDesc(g), ogType: 'article',
        body: tx`<article><h1>${esc(g.title)}</h1><p>${esc(guideDesc(g))}</p>${sections}</article>${nav()}`,
        jsonld: [
          { '@type': 'Article', headline: guideTitle(g), description: guideDesc(g), inLanguage: 'ru', url: path, ...(lastmod ? { dateModified: lastmod } : {}), author: { '@type': 'Organization', name: SITE_NAME }, about: 'Hypixel SkyBlock' },
          crumbs([['Главная', '/'], ['Гайды', '/guides'], [g.title, path]]),
        ],
      };
    }
    m = /^\/item\/(.+)$/.exec(p);
    if (m && deps.items && ID_RE.test(m[1])) {
      const it = deps.items.get(m[1]);
      if (!it || ITEM_SKIP.has(it.category)) return null;
      const path = itemPath(it.id);
      const { name, html, description } = itemParts(it, deps.items.lore(it.id), deps.priceOf?.(it.id) || 0);
      return {
        path, page: 'wiki', item: it.id, title: tx`${name} — ${(it.categoryRu || 'предмет').toLowerCase()} в Hypixel SkyBlock: как получить и цена`, description, ogType: 'article',
        body: tx`<article>${html}</article>${nav()}`,
        jsonld: [{ '@type': 'WebPage', name, description, inLanguage: 'ru', url: path }, crumbs([['Главная', '/'], ['Вики', '/wiki'], [name, path]])],
      };
    }
    return null;
  }

  function urls() {
    const out = [{ path: '/', freq: 'daily', pri: '1.0' }, ...SECTIONS.map(s => ({ path: s.path, freq: 'daily', pri: '0.8' })),
      ...guides().map(g => ({ path: `/guides/${g.id}`, freq: 'weekly', pri: '0.9' }))];
    const items = deps.items ? deps.items.all().filter(it => it?.id && !ITEM_SKIP.has(it.category) && ID_RE.test(it.id)) : [];
    return [...out.map(u => ({ ...u, lastmod })), ...items.map(it => ({ path: itemPath(it.id), freq: 'weekly', pri: '0.5' }))];
  }

  // Каждая страница — на двух языках: / (русский) и /en/… (английский), со ссылками друг на друга (hreflang)
  function sitemap(origin) {
    const enPath = p => (p === '/' ? '/en/' : `/en${p}`);
    const alt = u => tx`<xhtml:link rel="alternate" hreflang="ru" href="${esc(origin + u.path)}"/><xhtml:link rel="alternate" hreflang="en" href="${esc(origin + enPath(u.path))}"/><xhtml:link rel="alternate" hreflang="x-default" href="${esc(origin + u.path)}"/>`;
    const row = (u, loc) => tx`  <url><loc>${esc(origin + loc)}</loc>${alt(u)}${u.lastmod ? tx`<lastmod>${u.lastmod}</lastmod>` : ''}<changefreq>${u.freq}</changefreq><priority>${u.pri}</priority></url>`;
    const rows = urls().flatMap(u => [row(u, u.path), row(u, enPath(u.path))]);
    return tx`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${rows.join('\n')}\n</urlset>\n`;
  }

  function llms(origin) {
    return [
      tx`# ${SITE_NAME} — ${HOME.h1}`, '',
      tx`> ${HOME.description}`, '',
      ...HOME.intro, '',
      '## Разделы', '',
      ...SECTIONS.map(s => `- [${s.h1}](${origin}${s.path}): ${s.description}`), '',
      '## Гайды', '',
      ...guides().map(g => `- [${g.title}](${origin}/guides/${g.id}): ${guideDesc(g)}`), '',
      '## Предметы', '',
      tx`- Карточка любого предмета: ${origin}/item/<SkyBlock ID>, например [Hyperion](${origin}/item/HYPERION) — русское описание, характеристики, как получить и цена.`,
      tx`- Все адреса: ${origin}/sitemap.xml`, '',
      '## Полный текст', '',
      tx`- [Все гайды одним файлом](${origin}/llms-full.txt)`, '',
    ].join('\n');
  }

  function llmsFull(origin) {
    const parts = [tx`# ${SITE_NAME}: все гайды по Hypixel SkyBlock на русском`, '', tx`> Источник: ${origin}/guides. Названия предметов, NPC и мест — по-английски, как в игре.`, ''];
    for (const g of guides()) {
      parts.push(`## ${g.title}`, '', tx`Адрес: ${origin}/guides/${g.id}`, '', guideDesc(g), '');
      for (const s of publicSections(g)) { const md = sectionMd(s); if (md) parts.push(md, ''); }
    }
    return parts.join('\n');
  }

  return { pageFor, urls, sitemap, llms, llmsFull, guides };
}

/** JSON-LD: относительные адреса → полные. */
export function jsonldScript(list, origin) {
  const abs = v => (typeof v === 'string' && v.startsWith('/') ? origin + v : v);
  const walk = x => (Array.isArray(x) ? x.map(walk) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, k === 'url' || k === 'item' ? abs(v) : walk(v)])) : x);
  const data = { '@context': 'https://schema.org', '@graph': walk(list) };
  return tx`<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

/**
 * IndexNow (Яндекс, Bing и др.): после обновления сайта сообщаем адреса страниц, чтобы их быстрее переобошли.
 * Шлём не чаще раза на версию сборки; ключ лежит по адресу /<KEY>.txt.
 */
export async function pingIndexNow({ origin, urls, build, store, fetchFn = globalThis.fetch, log = console }) {
  if (!origin || !/^https:\/\//.test(origin) || !urls.length || !fetchFn) return false;
  const stamp = `${build}:${urls.length}`;
  if (store.get() === stamp) return false;
  const host = new URL(origin).host;
  const body = JSON.stringify({ host, key: INDEXNOW_KEY, keyLocation: `${origin}/${INDEXNOW_KEY}.txt`, urlList: urls.slice(0, 10_000).map(u => origin + u) });
  let ok = false;
  for (const ep of ['https://yandex.com/indexnow', 'https://api.indexnow.org/indexnow']) {
    try {
      const r = await fetchFn(ep, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body, signal: AbortSignal.timeout(20_000) });
      if (r.ok || r.status === 202) ok = true; else log.warn?.(`[seo] IndexNow ${ep}: ${r.status}`);
    } catch (e) { log.warn?.(`[seo] IndexNow ${ep}: ${e.message}`); }
  }
  if (ok) store.set(stamp);
  return ok;
}
