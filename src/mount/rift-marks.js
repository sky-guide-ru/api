// Адреса сервера для rift/marks.js (расчёты — в @sky-guide/core)
import { getMarks, setMark } from '@sky-guide/core/rift/marks.js';

export function mountRiftRoutes(app, { getUuid = async () => null, canWrite = async () => true } = {}) {
  app.get('/api/rift/marks', async (req, res) => res.json(getMarks(await getUuid(req).catch(() => null))));
  app.post('/api/rift/marks', (req, res) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 10_000) req.destroy(); });
    req.on('end', async () => {
      try {
        const { id, value } = JSON.parse(body || '{}');
        if (!(await canWrite(req).catch(() => false))) return res.status(403).json({ error: 'Отмечать души можно только в своём профиле' });
        res.json(setMark(await getUuid(req).catch(() => null), id, value));
      } catch (e) { res.status(400).json({ error: e.message }); }
    });
  });
}
