// Скин игрока для 3D-модели на главной (как на SkyCrypt).
// Mojang sessionserver → хэш текстуры → PNG через общий кэш скинов.
import { getJson } from '@sky-guide/core/http.js';
import { getSkin } from '@sky-guide/core/icons.js';

const cache = new Map(); // uuid -> { hash, slim, cape, at }
const TTL = 6 * 3600_000;
const misses = new Map(); // uuid -> время неудачи

async function playerTextures(uuid) {
  const hit = cache.get(uuid);
  if (hit && Date.now() - hit.at < TTL) return hit;
  const prof = await getJson(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`, { timeout: 5000, retries: 0 });
  const raw = prof?.properties?.find(p => p.name === 'textures')?.value;
  const tex = raw ? JSON.parse(Buffer.from(raw, 'base64').toString('utf8')).textures : {};
  const hashOf = url => url ? url.split('/').pop() : null;
  const info = { hash: hashOf(tex.SKIN?.url), slim: tex.SKIN?.metadata?.model === 'slim', cape: hashOf(tex.CAPE?.url), at: Date.now() };
  cache.set(uuid, info);
  return info;
}

export function mountSkinRoutes(app) {
  app.get('/api/player-skin/:uuid', async (req, res) => {
    const uuid = String(req.params.uuid).replace(/-/g, '').toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(uuid)) return res.status(400).end();
    // Неудачу тоже запоминаем на 10 минут, чтобы не ждать Mojang при каждом открытии страницы
    const miss = misses.get(uuid);
    if (miss && Date.now() - miss < 600_000) return res.status(404).json({ error: 'нет скина' });
    const t = await playerTextures(uuid).catch(() => null);
    if (!t?.hash) misses.set(uuid, Date.now());
    if (!t?.hash) return res.status(404).json({ error: 'нет скина' });
    res.json({ skin: `/api/skin/${t.hash}`, slim: t.slim, cape: t.cape ? `/api/skin/${t.cape}` : null });
  });
}
