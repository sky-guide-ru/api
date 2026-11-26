// Адреса сервера для calendar/index.js (расчёты — в @sky-guide/core)
import { calendarView } from '@sky-guide/core/calendar/index.js';

/** Календарь с подсказками по тексту: (year?) → вид. Для /api/calendar и /v1/calendar */
export function createCalendar({ textRefs = null } = {}) {
  const refsCache = new Map();
  return year => {
    const y = year != null && year !== '' ? Number(year) : undefined;
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
    return view;
  };
}

export function mountCalendarRoutes(app, { calendar }) {
  app.get('/api/calendar', (req, res) => res.json(calendar(req.query.year)));
}
