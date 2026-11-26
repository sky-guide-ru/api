// Опрос игроков (раздел «Опрос»): ответы хранятся в data/survey.json, каждый ответ сохраняется сразу,
// вернуться и изменить можно в любой момент. Гость узнаётся по своей cookie, вошедший — по нику.
// GET  /api/survey          → вопросы, мои ответы, сколько прошли, цель пилота
// POST /api/survey/answer   → { q, o: [id…], other } — один вопрос (пустой ответ = сброс)
// GET  /api/survey/results  → итоги для владельца: проценты по вариантам и все «свои варианты»
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { GROUPS, QUESTIONS, OTHER_MAX, SURVEY_ID } from './questions.js';
import { tx } from '@sky-guide/core/i18n/msg.js';

const COOKIE = 'sb_survey';
const YEAR = 365 * 86400;
/** С какого числа отвеченных вопросов человек считается «прошедшим» (для счётчика до пилота) */
export const COUNT_FROM = 10;
const MAX_RESPONDENTS = 20_000;
const NEW_PER_IP_DAY = 6;
const byId = new Map(QUESTIONS.map(q => [q.id, q]));
const clip = (s, n) => String(s ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Проверка одного ответа. null — ответ пустой (сбросить). Ошибка — строкой */
export function cleanAnswer(body) {
  const q = byId.get(String(body?.q || ''));
  if (!q) return { error: 'Нет такого вопроса' };
  const allowed = new Set(q.options.map(o => o[0]));
  let o = [...new Set((Array.isArray(body.o) ? body.o : []).map(String))].filter(x => allowed.has(x));
  if (!q.multi) o = o.slice(0, 1);
  else if (q.max) o = o.slice(0, q.max);
  const other = clip(body.other, OTHER_MAX);
  return { q: q.id, answer: o.length || other ? { o, other } : null };
}

/** Итоги: по каждому вопросу — сколько выбрали каждый вариант, сколько ответили, свои варианты */
export function summarize(responses) {
  const list = Object.values(responses || {});
  const done = list.filter(r => Object.keys(r.answers || {}).length >= COUNT_FROM);
  // Опрос один для обеих версий сайта: ответы общие, язык анкеты — для разбивки
  const byLang = { ru: 0, en: 0 };
  for (const r of done) byLang[r.lang === 'en' ? 'en' : 'ru']++;
  const out = { respondents: done.length, started: list.length, byLang, questions: [] };
  for (const g of GROUPS) {
    for (const q of g.questions) {
      const counts = Object.fromEntries(q.options.map(o => [o[0], 0]));
      const others = [];
      let answered = 0;
      for (const r of list) {
        const a = r.answers?.[q.id];
        if (!a) continue;
        answered++;
        for (const id of a.o || []) if (id in counts) counts[id]++;
        if (a.other) others.push({ text: a.other, at: r.updated || r.at || 0, lang: r.lang === 'en' ? 'en' : 'ru' });
      }
      out.questions.push({
        id: q.id, group: g.title, text: q.text, multi: !!q.multi, answered,
        options: q.options.map(([id, label]) => ({ id, label, n: counts[id], pct: answered ? Math.round(counts[id] / answered * 100) : 0 })),
        others: others.sort((a, b) => b.at - a.at),
      });
    }
  }
  return out;
}

/** Все анкеты таблицей (без ников и cookie): строка — человек, по два столбца на вопрос (выбор и свой вариант) */
export function toCsv(responses) {
  const cell = v => { const s = String(v ?? ''); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ['№', 'Обновлено', 'Язык'];
  for (const q of QUESTIONS) head.push(q.text, tx`${q.text} — свой вариант`);
  const rows = [head];
  Object.values(responses || {}).sort((a, b) => (a.at || 0) - (b.at || 0)).forEach((r, i) => {
    const row = [i + 1, r.updated ? new Date(r.updated).toISOString().slice(0, 16).replace('T', ' ') : '', r.lang === 'en' ? 'en' : 'ru'];
    for (const q of QUESTIONS) {
      const a = r.answers?.[q.id];
      const labels = new Map(q.options);
      row.push((a?.o || []).map(id => labels.get(id) || id).join('; '), a?.other || '');
    }
    rows.push(row);
  });
  // BOM — чтобы Excel сразу открыл кириллицу
  return '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n');
}

export function createSurveyStore(dataDir, { clock = () => Date.now() } = {}) {
  const file = dataDir ? path.join(dataDir, 'survey.json') : null;
  let data = { id: SURVEY_ID, responses: {} };
  try { if (file) { const d = JSON.parse(fs.readFileSync(file, 'utf8')); if (d?.responses) data = d; } } catch { /* ещё нет */ }
  if (!data.responses || typeof data.responses !== 'object') data.responses = {};
  let timer = null;
  const save = () => {
    if (!file || timer) return;
    timer = setTimeout(() => {
      timer = null;
      try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data)); } catch (e) { console.error('[опрос] не сохранить:', e.message); }
    }, 1500);
  };
  const has = rid => Object.hasOwn(data.responses, rid);
  return {
    mine: rid => (rid && has(rid) ? data.responses[rid].answers : null),
    count: () => Object.values(data.responses).filter(r => Object.keys(r.answers || {}).length >= COUNT_FROM).length,
    size: () => Object.keys(data.responses).length,
    has,
    /** Сохранить ответ. Возвращает число отвеченных вопросов у этого человека. lang — версия сайта (последняя) */
    answer(rid, q, answer, lang = 'ru') {
      const now = clock();
      if (!has(rid)) {
        if (!answer) return 0;
        data.responses[rid] = { at: now, updated: now, answers: {} };
      }
      const r = data.responses[rid];
      if (answer) r.answers[q] = answer; else delete r.answers[q];
      r.lang = lang === 'en' ? 'en' : 'ru';
      r.updated = now;
      save();
      return Object.keys(r.answers).length;
    },
    results: () => summarize(data.responses),
    csv: () => toCsv(data.responses),
    flush() { if (timer) { clearTimeout(timer); timer = null; } if (file) fs.writeFileSync(file, JSON.stringify(data)); },
  };
}

function readCookie(req, name) {
  const m = String(req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(`${name}=`));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : '';
}

/**
 * @param {import('express').Express} app
 * @param {{ express: any, store: ReturnType<typeof createSurveyStore>, clientIp?: (req)=>string, requireAdmin: Function, goal?: number }} o
 */
export function mountSurveyRoutes(app, { express, store, clientIp = req => req.ip, requireAdmin, goal = 100, langOf = () => 'ru' }) {
  const ipNew = new Map(); // ip → время создания новых анкет за сутки
  // Кто отвечает: вошедший — по нику (его ответы видны на любом устройстве), гость — по своей cookie
  const ridOf = req => {
    if (req.sbUser?.name) return `u:${String(req.sbUser.name).toLowerCase()}`;
    if (!req.sbUser && !req.sbGuest) return 'u:@owner'; // сайт без паролей (свой ПК)
    const c = readCookie(req, COOKIE);
    return /^[a-f0-9]{32}$/.test(c) ? `g:${c}` : null;
  };
  const state = req => ({ id: SURVEY_ID, groups: GROUPS, mine: store.mine(ridOf(req)), count: store.count(), goal, countFrom: COUNT_FROM });

  app.get('/api/survey', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(state(req)); });

  app.post('/api/survey/answer', express.json({ limit: '4kb' }), (req, res) => {
    if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Только со страницы сайта' });
    const a = cleanAnswer(req.body || {});
    if (a.error) return res.status(400).json({ error: a.error });
    let rid = ridOf(req);
    // Новая анкета гостя — и без cookie, и с cookie, которой ещё нет в базе (её можно придумать самому)
    const fresh = !rid || (rid.startsWith('g:') && !store.has(rid));
    if (fresh) {
      if (!a.answer) return res.json({ ok: true, answered: 0, count: store.count() });
      // Новый гость: ограничение на число новых анкет с одного адреса и всего
      const ip = clientIp(req) || '?';
      const now = Date.now();
      const hits = (ipNew.get(ip) || []).filter(t => now - t < 86_400_000);
      if (hits.length >= NEW_PER_IP_DAY || store.size() >= MAX_RESPONDENTS) return res.status(429).json({ error: 'Слишком много новых анкет с этого адреса, попробуй завтра' });
      hits.push(now); ipNew.set(ip, hits);
      if (ipNew.size > 5000) ipNew.delete(ipNew.keys().next().value);
      if (!rid) {
        const token = crypto.randomBytes(16).toString('hex');
        const secure = req.secure || String(req.headers['x-forwarded-proto'] || '').startsWith('https');
        res.append('Set-Cookie', `${COOKIE}=${token}; Path=/; Max-Age=${YEAR}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
        rid = `g:${token}`;
      }
    }
    const answered = store.answer(rid, a.q, a.answer, langOf(req));
    res.json({ ok: true, answered, count: store.count() });
  });

  app.get('/api/survey/results.csv', requireAdmin, (req, res) => {
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': tx`attachment; filename="survey-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' });
    res.send(store.csv());
  });
  app.get('/api/survey/results', requireAdmin, (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ ...store.results(), goal }); });
}
