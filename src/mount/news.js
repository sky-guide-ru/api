// Адреса сервера для news/index.js (расчёты — в @sky-guide/core)
import { plainNews } from '@sky-guide/core/news/links.js';
import { NEWS } from '@sky-guide/core/news/entries.js';
import { newsView } from '@sky-guide/core/news/index.js';

export function mountNewsRoutes(app, { textRefs = null } = {}) {
  // Словарь подсказок: текст новостей меняется только с обновлением сайта, но база предметов после запуска
  // догружается не сразу — пересчитываем не чаще раза в 10 минут
  const cached = text => {
    let c = { at: 0, refs: null };
    return () => {
      if (!textRefs) return null;
      if (Date.now() - c.at > 600_000) {
        let refs = null;
        try { refs = textRefs(text); } catch { /* нет базы NEU — без подсказок */ }
        c = { at: Date.now(), refs };
      }
      return c.refs;
    };
  };
  const top = newsView().entries[0] || null;
  const allRefs = cached(plainNews(NEWS.flatMap(e => [e.title, ...e.items]).join('\n')));
  const topRefs = cached(top ? plainNews([top.title, ...top.items].join('\n')) : '');
  app.get('/api/news/latest', (req, res) => res.json({ latest: top?.id || null, ids: NEWS.map(e => e.id), top, refs: top ? topRefs() : null }));
  app.get('/api/news', (req, res) => res.json({ ...newsView(), refs: allRefs() }));
}
