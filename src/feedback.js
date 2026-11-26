// Отзывы с сайта: кнопка «Сообщить об ошибке» на каждой странице.
// Каждый отзыв сохраняется на сервере (data/feedback.json, скриншоты — data/feedback/) и, если в .env настроена почта
// (SMTP_USER / SMTP_PASS, адрес — MAIL_TO), уходит письмом владельцу. Тема письма всегда начинается с
// «[Sky Guide] Отзыв» (раньше «[SkyBlock отзыв]») — по этой метке Claude находит письма в Gmail и разбирает их.
// Адрес почты владельца живёт только в .env: в ответах API и на страницах его нет.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { smtpConfig, sendMail } from './lib/smtp.js';
import { tx } from '@sky-guide/core/i18n/msg.js';

export const SUBJECT_TAG = '[Sky Guide] Отзыв';
export const TYPES = { bug: 'Ошибка', translate: 'Перевод', data: 'Неверные данные', idea: 'Идея' };
const MAX_TEXT = 4000, MIN_TEXT = 5, MAX_SHOT = 1_500_000, KEEP = 1000;

/**
 * Браузер для разбора ошибки — коротко: «Chrome 131 · Android». Полную строку user-agent не храним:
 * для разбора хватает браузера, версии и системы (решение владельца 25.11.2026)
 */
export function shortUa(ua) {
  const s = String(ua || '');
  if (!s) return '';
  const b = [['YaBrowser', /YaBrowser\/(\d+)/], ['Opera', /OPR\/(\d+)/], ['Edge', /Edg(?:A|iOS)?\/(\d+)/], ['Samsung Internet', /SamsungBrowser\/(\d+)/],
    ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/], ['Chrome', /(?:Chrome|CriOS)\/(\d+)/], ['Safari', /Version\/(\d+)[\d.]* (?:Mobile\/\S+ )?Safari/]]
    .map(([name, re]) => { const m = re.exec(s); return m ? `${name} ${m[1]}` : null; }).find(Boolean) || 'другой браузер';
  const os = /Android/.test(s) ? 'Android' : /iPhone|iPad|iPod/.test(s) ? 'iOS' : /Windows/.test(s) ? 'Windows'
    : /Mac OS X|Macintosh/.test(s) ? 'macOS' : /CrOS/.test(s) ? 'ChromeOS' : /Linux/.test(s) ? 'Linux' : 'другая система';
  return `${b} · ${os}`;
}

const clip = (s, n) => String(s ?? '').replace(/\u0000/g, '').trim().slice(0, n);

/** Проверка присланного с формы. Возвращает { error } или { item } */
export function validateFeedback(body = {}, { now = Date.now() } = {}) {
  // Ловушка для ботов: невидимое поле, человек его не заполнит
  if (clip(body.website, 200)) return { spam: true };
  // Форму открыли меньше 3 секунд назад — так быстро пишет только бот
  const openedAt = Number(body.openedAt) || 0;
  if (openedAt && now - openedAt < 3000) return { spam: true };
  const type = Object.hasOwn(TYPES, body.type) ? body.type : 'bug';
  const text = clip(body.text, MAX_TEXT);
  if (text.length < MIN_TEXT) return { error: 'Опиши подробнее — хотя бы пару слов' };
  const nick = clip(body.player, 36);
  let shot = null;
  if (body.screenshot) {
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.screenshot));
    if (!m) return { error: 'Скриншот не похож на картинку' };
    const data = Buffer.from(m[2], 'base64');
    if (data.length > MAX_SHOT) return { error: 'Скриншот слишком большой' };
    shot = { ext: m[1] === 'jpeg' ? 'jpg' : m[1], type: `image/${m[1]}`, data };
  }
  return {
    item: {
      type, text,
      page: clip(body.page, 300),
      player: /^[A-Za-z0-9_]{1,16}$/.test(nick) ? nick : '',
      profile: clip(body.profile, 24).replace(/[^\p{L}\p{N} _-]/gu, ''),
      build: clip(body.build, 40),
      contact: clip(body.contact, 120),
      screen: clip(body.screen, 40),
      ua: shortUa(clip(body.ua, 300)),
    },
    shot,
  };
}

/** Текст письма — всё, что нужно, чтобы воспроизвести проблему, без лишнего */
export function mailFor(f, { siteUrl = '' } = {}) {
  const first = f.text.split('\n')[0].slice(0, 70);
  const subject = `${SUBJECT_TAG} · ${TYPES[f.type] || 'Отзыв'}: ${first}${f.text.length > first.length ? '…' : ''}`;
  const lines = [
    tx`Тип: ${TYPES[f.type] || f.type}`,
    tx`Номер: ${f.id}`,
    tx`Время: ${new Date(f.at).toISOString()}`,
    tx`Страница: ${f.page || '—'}${siteUrl && f.page && f.page.startsWith('/') ? ` (${siteUrl.replace(/\/$/, '')}${f.page})` : ''}`,
    tx`Ник в поле: ${f.player || '—'}${f.profile ? tx` / профиль ${f.profile}` : ''}`,
    tx`Кто отправил: ${f.user ? tx`вошёл как ${f.user}` : 'гость'}`,
    tx`Сборка сайта: ${f.build || '—'}`,
    f.contact ? tx`Как связаться: ${f.contact}` : null,
    f.screen ? tx`Экран: ${f.screen}` : null,
    f.ua ? tx`Браузер: ${f.ua}` : null,
    f.shot ? 'Скриншот: во вложении' : null,
    '',
    '—— Текст ——',
    f.text,
    '',
    '—',
    'Письмо отправил сайт Sky Guide. Все отзывы — в разделе «Отзывы» (только для владельца).',
  ].filter(l => l != null);
  return { subject, text: lines.join('\n') };
}

/**
 * Хранилище отзывов + отправка писем.
 * @param {{ dataDir: string, env?: object, send?: Function, clock?: () => number }} o
 */
export function createFeedback({ dataDir, env = process.env, send = sendMail, clock = () => Date.now() }) {
  const file = path.join(dataDir, 'feedback.json');
  const shotDir = path.join(dataDir, 'feedback');
  let list = [];
  try { list = JSON.parse(fs.readFileSync(file, 'utf8')); if (!Array.isArray(list)) list = []; } catch { list = []; }
  let lastMail = { at: 0, ok: null, error: null };
  const save = () => {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify(list));
      fs.renameSync(file + '.tmp', file);
    } catch (e) { console.warn('[отзывы]', e.message); }
  };
  // В старых отзывах лежит полная строка браузера — оставляем от неё только «браузер версия · система»
  let shortened = false;
  for (const f of list) if (f && f.ua && !/ · /.test(f.ua)) { f.ua = shortUa(f.ua); shortened = true; }
  if (shortened) save();
  const shotPath = f => (f.shot ? path.join(shotDir, `${f.id}.${f.shot}`) : null);
  const mailCfg = () => smtpConfig(env);

  async function mail(f, shotData) {
    const cfg = mailCfg();
    if (!cfg) return false;
    const m = mailFor(f, { siteUrl: env.SITE_URL || '' });
    const attachments = shotData ? [{ name: tx`скриншот-${f.id}.${f.shot}`, type: f.shotType, data: shotData }] : [];
    try {
      await send(cfg, { ...m, attachments });
      f.mailed = clock(); delete f.mailError;
      lastMail = { at: clock(), ok: true, error: null };
    } catch (e) {
      f.mailError = String(e.message || e).slice(0, 200);
      lastMail = { at: clock(), ok: false, error: f.mailError };
      console.warn('[отзывы] письмо не ушло:', f.mailError);
    }
    save();
    return !!f.mailed;
  }

  return {
    /** Новый отзыв. Письмо отправляется в фоне — посетитель не ждёт почту */
    add(item, shot, { user = null } = {}) {
      const f = { id: crypto.randomBytes(5).toString('hex'), at: clock(), status: 'new', ...item, user: user || null };
      if (shot) {
        try {
          fs.mkdirSync(shotDir, { recursive: true });
          f.shot = shot.ext; f.shotType = shot.type;
          fs.writeFileSync(shotPath(f), shot.data);
        } catch (e) { console.warn('[отзывы] скриншот:', e.message); delete f.shot; delete f.shotType; }
      }
      list.unshift(f);
      // Храним последние KEEP отзывов; скриншоты старых удаляем вместе с ними
      for (const old of list.splice(KEEP)) { const p = shotPath(old); if (p) fs.rm(p, { force: true }, () => {}); }
      save();
      const sending = mail(f, shot?.data || null);
      return { id: f.id, mailing: !!mailCfg(), sending };
    },
    list: () => list,
    get: id => list.find(f => f.id === id) || null,
    shotFile: id => { const f = list.find(x => x.id === id); return f ? shotPath(f) : null; },
    setStatus(id, status) {
      const f = list.find(x => x.id === id);
      if (!f || !['new', 'done'].includes(status)) return false;
      f.status = status; save(); return true;
    },
    remove(id) {
      const i = list.findIndex(x => x.id === id);
      if (i < 0) return false;
      const [f] = list.splice(i, 1);
      const p = shotPath(f); if (p) fs.rm(p, { force: true }, () => {});
      save(); return true;
    },
    /** Повторить письмо (после того как владелец настроил почту) */
    async resend(id) {
      const f = list.find(x => x.id === id);
      if (!f) return false;
      let data = null; try { data = f.shot ? fs.readFileSync(shotPath(f)) : null; } catch { /* скриншот потерян */ }
      return mail(f, data);
    },
    /** Письмо-проверка с раздела «Отзывы» */
    async test() {
      const cfg = mailCfg();
      if (!cfg) return { ok: false, error: 'Почта не настроена: в .env нет SMTP_USER и SMTP_PASS (или RESEND_API_KEY, или MAIL_DOMAIN)' };
      try {
        await send(cfg, { subject: tx`${SUBJECT_TAG} Проверка почты`, text: 'Почта для отзывов настроена: письма с сайта будут приходить сюда.' });
        lastMail = { at: clock(), ok: true, error: null };
        return { ok: true };
      } catch (e) {
        lastMail = { at: clock(), ok: false, error: String(e.message || e).slice(0, 200) };
        return { ok: false, error: lastMail.error };
      }
    },
    /** Что видно владельцу: настроена ли почта (без адреса целиком) и как прошла последняя отправка */
    mailStatus() {
      const cfg = mailCfg();
      const mask = a => a.replace(/^(.).*?(.)?@/, (m, a1, a2) => `${a1}…${a2 || ''}@`);
      return { configured: !!cfg, to: cfg ? mask(cfg.to) : null, host: cfg?.host || null, last: lastMail };
    },
  };
}

/** Скользящие лимиты: с одного адреса 5 отзывов за 10 минут и 20 за сутки, со всего сайта — 300 за сутки */
export function createFeedbackLimiter({ clock = () => Date.now() } = {}) {
  const hits = new Map(); let all = [];
  return ip => {
    const now = clock();
    const h = (hits.get(ip) || []).filter(t => now - t < 86_400_000);
    all = all.filter(t => now - t < 86_400_000);
    if (h.filter(t => now - t < 600_000).length >= 5 || h.length >= 20 || all.length >= 300) { hits.set(ip, h); return false; }
    h.push(now); all.push(now); hits.set(ip, h);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(t => now - t < 86_400_000)) hits.delete(k);
    return true;
  };
}

/** Маршруты: отправка — всем (и Visitors), список и действия — только владельцу */
export function mountFeedbackRoutes(app, { express, feedback, clientIp = req => req.ip, requireAdmin }) {
  const limit = createFeedbackLimiter();
  // Скриншот в base64 весит на треть больше файла
  const json = express.json({ limit: '2.2mb' });
  app.post('/api/feedback', json, (req, res) => {
    if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Только со страницы сайта' });
    const v = validateFeedback(req.body || {});
    // Боту отвечаем «принято», чтобы не подбирал обход
    if (v.spam) return res.json({ ok: true });
    if (v.error) return res.status(400).json({ error: v.error });
    if (!limit(clientIp(req))) return res.status(429).json({ error: 'Слишком много отзывов подряд. Попробуй позже' });
    const r = feedback.add(v.item, v.shot, { user: req.sbGuest ? null : req.sbUser?.name || null });
    res.json({ ok: true, id: r.id });
  });

  app.get('/api/admin/feedback', requireAdmin, (req, res) => {
    res.set('Cache-Control', 'no-store').json({ items: feedback.list(), mail: feedback.mailStatus(), types: TYPES, tag: SUBJECT_TAG });
  });
  app.get('/api/admin/feedback/:id/shot', requireAdmin, (req, res) => {
    const p = feedback.shotFile(req.params.id);
    if (!p || !fs.existsSync(p)) return res.status(404).end();
    res.set('Cache-Control', 'private, max-age=3600').sendFile(p);
  });
  const small = express.json({ limit: '2kb' });
  app.post('/api/admin/feedback/:id/status', requireAdmin, small, (req, res) => res.json({ ok: feedback.setStatus(req.params.id, req.body?.status) }));
  app.post('/api/admin/feedback/:id/delete', requireAdmin, (req, res) => res.json({ ok: feedback.remove(req.params.id) }));
  app.post('/api/admin/feedback/:id/resend', requireAdmin, async (req, res) => {
    const ok = await feedback.resend(req.params.id);
    res.json({ ok, error: ok ? null : feedback.get(req.params.id)?.mailError || 'Почта не настроена' });
  });
  app.post('/api/admin/feedback-test', requireAdmin, async (req, res) => res.json(await feedback.test()));
}
