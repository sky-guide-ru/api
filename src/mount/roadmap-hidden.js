// Адреса сервера для roadmap/hidden.js (расчёты — в @sky-guide/core)
import { getHidden, setHidden } from '@sky-guide/core/roadmap/hidden.js';

export function mountHiddenRoutes(app, { getView, isGuest = () => false } = {}) {
  const ctx = async req => {
    const v = await getView(req).catch(() => null);
    const m = v?.member;
    return {
      key: m?.uuid && m?.profileId ? `${m.uuid}:${m.profileId}` : null,
      can: !!v?.self && !isGuest(req),
      ids: (v?.analysis?.roadmap || []).map(s => s.id),
    };
  };
  app.get('/api/roadmap/hidden', async (req, res) => {
    const c = await ctx(req);
    res.json({ hidden: c.can ? getHidden(c.key, c.ids) : {}, canWrite: c.can && !!c.key });
  });
  app.post('/api/roadmap/hidden', (req, res) => {
    let body = '';
    req.on('data', ch => { body += ch; if (body.length > 20_000) req.destroy(); });
    req.on('end', async () => {
      try {
        const { ids, id, value } = JSON.parse(body || '{}');
        const c = await ctx(req);
        if (!c.can) return res.status(403).json({ error: 'Скрывать шаги можно только в своём плане' });
        res.json({ hidden: setHidden(c.key, ids ?? id, value), canWrite: true });
      } catch (e) { res.status(400).json({ error: e.message }); }
    });
  });
}
