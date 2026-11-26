import { tx } from '@sky-guide/core/i18n/msg.js';
// Готовый текст страниц для поисковиков и нейросетей: HTML (кладётся в <div id="root">, пока сайт грузится) и Markdown (llms-full.txt).
// Браузер с JavaScript этот текст не показывает (html.js .seo-pre) — сайт сразу рисует свой раздел с тем же содержимым.

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const strip = s => String(s ?? '').replace(/§./g, '').trim();
/** Обрезать по слову, с многоточием */
export const clip = (s, n) => (s.length <= n ? s : `${s.slice(0, n).replace(/\s+\S*$/, '')}…`);
const cellText = c => (c && typeof c === 'object' ? strip(c.text) : strip(c));

// Разделы гайда, которые у гостя выходят пустыми («Твоя рыбалка в цифрах», «у тебя 0») — для поиска не нужны
const PERSONAL = /(^|\s)(тво[йяеи]|у тебя)(\s|$)/i;
const PERSONAL_COL = /^(пройдено|у тебя|есть|твой|твоя|сейчас)$/i;
const MAX_ROWS = 80;

function tableParts(s) {
  const cols = (s.columns || []).map(strip);
  const keep = cols.map(c => !PERSONAL_COL.test(c));
  const rows = (s.rows || []).slice(0, MAX_ROWS).map(r => r.map(cellText).filter((_, i) => keep[i] !== false));
  return { cols: cols.filter((_, i) => keep[i]), rows };
}

const textLines = s => (Array.isArray(s.text) ? s.text : s.text ? [s.text] : []).map(strip).filter(Boolean);

/** Разделы гайда, годные для поиска (без пустых личных). */
export function publicSections(guide) {
  return (guide?.sections || []).filter(s => s && !PERSONAL.test(s.title || ''));
}

/** Раздел гайда → HTML. */
export function sectionHtml(s) {
  const head = s.title ? `<h2>${esc(strip(s.title))}</h2>` : '';
  const note = s.note && s.kind !== 'steps' ? `<p>${esc(strip(s.note))}</p>` : '';
  let body = '';
  if (s.kind === 'text') body = textLines(s).map(t => `<p>${esc(t)}</p>`).join('');
  else if (s.kind === 'steps') body = `<ol>${(s.items || []).map(i => `<li><b>${esc(strip(i.title))}</b>${i.text ? ` — ${esc(strip(i.text))}` : ''}</li>`).join('')}</ol>`;
  else if (s.kind === 'checklist') body = `<ul>${(s.items || []).map(i => `<li>${esc(strip(i.text))}${i.hint && i.hint !== '—' ? ` — ${esc(strip(i.hint))}` : ''}</li>`).join('')}</ul>`;
  else if (s.kind === 'table') {
    const { cols, rows } = tableParts(s);
    body = `<table>${cols.length ? `<tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr>` : ''}${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`;
  } else if (s.kind === 'tree') body = `<ul>${(s.perks || []).map(p => `<li><b>${esc(strip(p.name))}</b>${p.next || p.short ? ` — ${esc(strip(p.next || p.short))}` : ''}</li>`).join('')}</ul>`;
  else if (s.kind === 'sources') {
    const links = [...(s.data || []), ...(s.wiki || []), ...(s.videos || []).map(v => ({ title: v.label || v.title, url: v.url || (v.id ? `https://www.youtube.com/watch?v=${v.id}` : '') }))].filter(l => l.url);
    body = `<ul>${links.map(l => `<li><a href="${esc(l.url)}" rel="nofollow noopener">${esc(strip(l.title))}</a></li>`).join('')}</ul>`;
  } else if (Array.isArray(s.items)) body = `<ul>${s.items.map(i => `<li>${esc(strip(typeof i === 'string' ? i : i.text || i.title))}</li>`).join('')}</ul>`;
  return body ? `<section>${head}${note}${body}</section>` : '';
}

/** Раздел гайда → Markdown (для llms-full.txt). */
export function sectionMd(s) {
  const out = [];
  if (s.title) out.push(`### ${strip(s.title)}`);
  if (s.kind === 'text') out.push(...textLines(s));
  else if (s.kind === 'steps') (s.items || []).forEach((i, n) => out.push(`${n + 1}. **${strip(i.title)}**${i.text ? ` — ${strip(i.text)}` : ''}`));
  else if (s.kind === 'checklist') (s.items || []).forEach(i => out.push(`- ${strip(i.text)}${i.hint && i.hint !== '—' ? ` — ${strip(i.hint)}` : ''}`));
  else if (s.kind === 'table') {
    const { cols, rows } = tableParts(s);
    const fix = t => String(t).replace(/\|/g, '/').replace(/\n/g, ' ');
    if (cols.length) out.push(`| ${cols.map(fix).join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`);
    rows.forEach(r => out.push(`| ${r.map(fix).join(' | ')} |`));
  } else if (s.kind === 'tree') (s.perks || []).forEach(p => out.push(`- **${strip(p.name)}**${p.next || p.short ? ` — ${strip(p.next || p.short)}` : ''}`));
  else if (s.kind === 'sources') {
    [...(s.data || []), ...(s.wiki || [])].forEach(l => l.url && out.push(`- [${strip(l.title)}](${l.url})`));
    (s.videos || []).forEach(v => { const url = v.url || (v.id ? `https://www.youtube.com/watch?v=${v.id}` : ''); if (url) out.push(`- [${strip(v.label || v.title)}](${url})`); });
  }
  return out.length > (s.title ? 1 : 0) ? out.join('\n') : '';
}

/** Карточка предмета → { html, md, description }. */
export function itemParts(it, lore, price) {
  const name = it.nameRu && it.nameRu !== it.nameEn ? `${it.nameRu} (${it.nameEn})` : it.nameEn;
  const kind = [it.rarityRu, (it.typeRu || it.categoryRu || '').toLowerCase()].filter(Boolean).join(' ');
  const desc = strip(it.descriptionRu || '');
  const where = (it.whereToGet || []).map(w => strip(w.textRu)).filter(Boolean);
  const loreLines = (lore || []).map(strip);
  const priceLine = price > 0 ? tx`Примерная цена сейчас: ${Math.round(price).toLocaleString('ru-RU')} монет.` : '';
  const description = clip([tx`${name}${kind ? ` — ${kind.toLowerCase()}` : ''} в Hypixel SkyBlock.`, priceLine, desc || where[0] || ''].filter(Boolean).join(' '), 220);
  const html = [
    `<h1>${esc(name)}</h1>`,
    kind ? `<p>${esc(kind[0].toUpperCase() + kind.slice(1))}${it.categoryRu ? ` · ${esc(it.categoryRu)}` : ''}</p>` : '',
    desc ? `<p>${esc(desc)}</p>` : '',
    priceLine ? `<p>${esc(priceLine)}</p>` : '',
    loreLines.length ? tx`<h2>Описание в игре</h2><pre>${esc(loreLines.join('\n'))}</pre>` : '',
    where.length ? tx`<h2>Как получить</h2><ul>${where.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : '',
    (it.requirementsRu || []).length ? tx`<h2>Требования</h2><ul>${it.requirementsRu.map(r => `<li>${esc(strip(r))}</li>`).join('')}</ul>` : '',
  ].join('');
  return { name, html, description };
}
