// Адреса сервера для collectibles/marks.js (расчёты — в @sky-guide/core)
import { getCollectMarks, setCollectMarks } from '@sky-guide/core/collectibles/marks.js';

export function mountCollectRoutes(app, { getUuid = async () => null, canWrite = async () => true } = {}) {
  app.get('/api/collectibles/marks', async (req, res) => res.json(getCollectMarks(await getUuid(req).catch(() => null))));
  app.post('/api/collectibles/marks', (req, res) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 20_000) req.destroy(); });
    req.on('end', async () => {
      try {
        const { kind = 'fairy', ids, id, value } = JSON.parse(body || '{}');
        if (!(await canWrite(req).catch(() => false))) return res.status(403).json({ error: 'Отмечать можно только в своём профиле' });
        res.json(setCollectMarks(await getUuid(req).catch(() => null), kind, ids ?? id, value));
      } catch (e) { res.status(400).json({ error: e.message }); }
    });
  });
}
