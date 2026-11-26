// Страна посетителя по IP — офлайн, на своём сервере, без внешних запросов на каждый заход.
// База: DB-IP «IP to Country Lite» (бесплатная, CC BY 4.0, https://db-ip.com), файл .mmdb ~7 МБ в data/geo/.
// Скачивается при запуске, если её нет или ей больше 35 дней, и раз в сутки проверяется снова.
// IP только сверяется с базой и сразу забывается: в статистику попадает лишь код страны («RU»).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { Reader } from 'mmdb-lib';

const DAY = 24 * 3600_000, MAX_AGE = 35 * DAY;
const urlFor = d => `https://download.db-ip.com/free/dbip-country-lite-${d.toISOString().slice(0, 7)}.mmdb.gz`;

/** Код страны из записи базы (формат DB-IP и MaxMind GeoLite2 одинаковый) */
export function isoOf(rec) {
  const c = rec?.country?.iso_code || rec?.registered_country?.iso_code || '';
  return /^[A-Z]{2}$/.test(c) ? c : '';
}

export function createGeo({ dataDir, fetchImpl = globalThis.fetch, clock = () => Date.now(), url = process.env.GEO_DB_URL || '', off = process.env.GEO_OFF === '1', log = console } = {}) {
  const file = path.join(dataDir, 'geo', 'country.mmdb');
  let reader = null, loadedAt = 0, busy = null, timer = null, lastError = '';

  function load() {
    try {
      const st = fs.statSync(file);
      reader = new Reader(fs.readFileSync(file));
      loadedAt = st.mtimeMs;
      return true;
    } catch { reader = null; return false; }
  }

  async function download() {
    // Новый месяц на DB-IP появляется не в первый же день — пробуем текущий и прошлый
    const now = new Date(clock());
    const tries = url ? [url] : [urlFor(now), urlFor(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)))];
    for (const u of tries) {
      try {
        const r = await fetchImpl(u, { signal: AbortSignal.timeout(60_000) });
        if (!r.ok) { lastError = `HTTP ${r.status}`; continue; }
        let buf = Buffer.from(await r.arrayBuffer());
        if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
        new Reader(buf); // проверка, что файл целый, до замены старого
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(`${file}.tmp`, buf);
        fs.renameSync(`${file}.tmp`, file);
        lastError = '';
        return load();
      } catch (e) { lastError = e.message; }
    }
    log.warn?.('[страны] база не скачалась:', lastError);
    return false;
  }

  function refresh() {
    if (off || busy) return busy;
    if (reader && clock() - loadedAt < MAX_AGE) return null;
    busy = download().finally(() => { busy = null; });
    return busy;
  }

  /** 'RU' / 'DE' / … или '' (база не загружена, адрес частный или неизвестный) */
  function country(ip) {
    if (!reader) return '';
    const a = String(ip || '').replace(/^::ffff:/, '');
    if (!a || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80)/i.test(a)) return '';
    try { return isoOf(reader.get(a)); } catch { return ''; }
  }

  function start() {
    if (off) return;
    load();
    refresh();
    timer = setInterval(refresh, DAY); timer.unref?.();
  }
  function stop() { clearInterval(timer); timer = null; }

  return { country, start, stop, refresh, load, info: () => ({ ready: !!reader, loadedAt, lastError, off }) };
}
