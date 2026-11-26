// Адреса сервера для calendar/index.js (расчёты — в @sky-guide/core)
import { calendarView } from '@sky-guide/core/calendar/index.js';

export function mountCalendarRoutes(app, { textRefs = null } = {}) {
  const refsCache = new Map();
  app.get('/api/calendar', (req, res) => {
    const y = req.query.year != null ? Number(req.query.year) : undefined;
    const view = calendarView(Date.now(), { year: Number.isInteger(y) ? y : undefined });
    if (textRefs && view.money.length) {
      const text = view.money.map(h => `${h.title}: ${h.note}`).join('\n');
      if (!refsCache.has(text)) {
        let refs = null;
        try { refs = textRefs(text); } catch { /* нет базы NEU — блок останется без подсказок */ }
        refsCache.clear(); refsCache.set(text, refs);
      }
      view.moneyRefs = refsCache.get(text);
    }
    res.json(view);
  });
}
