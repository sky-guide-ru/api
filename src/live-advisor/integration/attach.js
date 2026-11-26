// Подключение к ядру трекера (server/index.js и server/state.js).
// Скопируйте папку модуля в server/live-advisor/ и вызовите attachLiveAdvisor(...) в main().
import express from 'express';
import { createLiveAdvisor } from '@sky-guide/core/live-advisor/index.js';
import { isEn, translateDeep } from '@sky-guide/core/i18n/lang.js';

/**
 * @param {{
 *   app: import('express').Express,
 *   bus: import('node:events').EventEmitter,   // bus ядра: события 'profile' и 'prices'
 *   state: { member: Object, analysis: Object },
 *   deps: Object,                              // priceOf, priceTrend, priceInfo, itemName, getItemRu, searchItems, pricesRaw
 *   dataDir: string,
 * }} o
 */
export function attachLiveAdvisor({ app, bus, state, deps, dataDir }) {
  const live = createLiveAdvisor({
    apiKey: (process.env.ANTHROPIC_API_KEY || '').trim(),
    model: process.env.LIVE_MODEL || undefined,
    dailyUsd: process.env.LIVE_DAILY_USD ? Number(process.env.LIVE_DAILY_USD) : undefined,
    tz: process.env.LIVE_TZ || undefined,
    friendDailyUsd: process.env.LIVE_FRIEND_DAILY_USD ? Number(process.env.LIVE_FRIEND_DAILY_USD) : undefined,
    friendDailyQuestions: process.env.LIVE_FRIEND_DAILY_QUESTIONS ? Number(process.env.LIVE_FRIEND_DAILY_QUESTIONS) : undefined,
    ownerDailyQuestions: process.env.LIVE_OWNER_DAILY_QUESTIONS ? Number(process.env.LIVE_OWNER_DAILY_QUESTIONS) : undefined,
    dataDir,
    deps,
  });

  // Бесплатная проверка после каждого обновления профиля/цен; ИИ — только при важных изменениях
  let timer = null;
  const kick = () => {
    clearTimeout(timer);
    // небольшая задержка: профиль и цены часто приходят почти одновременно
    timer = setTimeout(() => {
      if (state.member) live.update({ member: state.member, analysis: state.analysis }).catch(e => console.error('[live-advisor]', e.message));
    }, 2000);
  };
  bus.on('profile', kick);
  bus.on('prices', kick);
  // Пересылаем события советчика в SSE ядра (/api/stream слушает bus)
  live.bus.on('advice', a => bus.emit('live', { kind: 'advice', at: a.at }));
  live.bus.on('chat', c => bus.emit('live', { kind: 'chat', at: c.at }));
  live.bus.on('view', v => bus.emit('live', { kind: 'view', at: v.at }));
  live.bus.on('check', c => bus.emit('live', { kind: 'check', at: c.at, score: c.score }));

  const r = express.Router();
  r.use(express.json({ limit: '8kb' }));
  // req.sbUser — кто вошёл (server/auth.js). Друзья: свой чат и свой лимит; настройки и автосоветы — только владельцу
  // Язык ответа ИИ: английская версия сайта (/en/) — ответы и советы по-английски
  const langOf = () => (isEn() ? 'en' : 'ru');
  const who = req => (req.sbUser ? { name: req.sbUser.name, owner: !!req.sbUser.owner, dailyUsd: req.sbUser.dailyUsd } : null);
  const ownerOnly = (req, res, next) => (!req.sbUser || req.sbUser.owner ? next() : res.status(403).json({ error: 'Это может только владелец сайта' }));
  // Словарь ссылок (NPC, мобы, места, механики) для ответов чата: считаем один раз на ответ, держим в памяти
  const refsCache = new Map();
  const refsFor = text => {
    if (!deps?.textRefs || !text) return null;
    if (refsCache.has(text)) return refsCache.get(text);
    let refs = null;
    try {
      // [[ID|Название]] уже ссылка на предмет — её текст не размечаем второй раз
      const r = deps.textRefs(text.replace(/\[\[[^\]]*\]\]/g, ' '));
      refs = r && Object.keys(r.phrases || {}).length ? r : null;
    } catch { /* нет базы NEU — ответ останется без подсказок */ }
    refsCache.set(text, refs);
    if (refsCache.size > 300) refsCache.delete(refsCache.keys().next().value);
    return refs;
  };
  // Какой профиль открыт. null — владелец на своём основном профиле (обычные автосоветы и сводка).
  // Друг на своём профиле — self; кооп-сосед владельца — coopMate (ИИ пишет совет ему, а не владельцу)
  async function viewOf(req) {
    const v = req.sbView ? await req.sbView().catch(() => null) : null;
    const ownerSelf = v?.owner && (!req.sbUser || req.sbUser.owner);
    if (!v || ownerSelf || !v.member) return null;
    const ownUuid = state.member?.uuid;
    const coopMate = !!ownUuid && ownUuid !== v.member.uuid && (v.member.coopRoster || []).some(c => c.uuid === ownUuid);
    return { member: v.member, analysis: v.analysis, name: v.player?.name, profile: v.member.profileName, self: !!v.self, coopMate, updatedAt: v.updatedAt };
  }

  // Английская версия: карточка совета — из английского варианта, который ИИ пишет вместе с русским
  const inPageLang = st => {
    if (!st || !isEn()) return st;
    const en = a => (a?.en ? { ...a, ...a.en, en: undefined } : a);
    return { ...st, advice: en(st.advice), adviceHistory: Array.isArray(st.adviceHistory) ? st.adviceHistory.map(en) : st.adviceHistory };
  };
  r.get('/state', async (req, res) => {
    const view = await viewOf(req);
    const user = who(req);
    // Открыли чужой профиль — совет по его данным готовится сам (если его нет или он старше 3 часов)
    if (view) live.ensureViewAdvice(view, user, langOf());
    const st = live.getState(user, view);
    if (Array.isArray(st?.chat)) {
      const from = Math.max(0, st.chat.length - 30); // подсказки только у последних ответов: ответ не раздувается
      st.chat = st.chat.map((c, i) => (i >= from && c.a && !c.blocked ? { ...c, refs: refsFor(c.a) } : c));
    }
    res.json(inPageLang(st));
  });
  r.post('/ask', async (req, res) => {
    try {
      // Смотрим чужой профиль — вопрос про него (общий дневной лимит, автосоветы остаются про свой профиль)
      // Друг спрашивает про свой профиль (self) или про чужой; владелец про свой — обычная сводка без view
      const view = await viewOf(req);
      const user = who(req);
      if (!req.body?.stream) return res.json(await live.ask(req.body?.question, { deep: !!req.body?.deep, view, user, lang: langOf() }));
      // Потоковый ответ: события text/tool приходят на сайт сразу, итог — событием done.
      // text/event-stream не сжимается и не буферизуется туннелем
      res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
      res.flushHeaders();
      // Поток идёт мимо перевода res.json: итог и ошибку переводим сами (текст ответа ИИ уже на нужном языке)
      const send = ev => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(isEn() && ev.type !== 'text' && ev.type !== 'tool' ? translateDeep(ev) : ev)}\n\n`); };
      try { send({ type: 'done', entry: await live.ask(req.body?.question, { deep: !!req.body?.deep, view, user, onEvent: send, lang: langOf() }) }); }
      catch (e) { send({ type: 'error', error: e.message }); }
      res.end();
    }
    catch (e) { if (res.headersSent) res.end(); else res.status(400).json({ error: e.message }); }
  });
  r.post('/refresh', async (req, res) => {
    try {
      const view = await viewOf(req);
      const user = who(req);
      // Чужой профиль: совет по нему (друг платит из своего лимита). Свой основной — только владелец
      if (view) await live.refreshViewAdvice(view, user, langOf());
      else if (req.sbUser && !req.sbUser.owner) return res.status(403).json({ error: 'Это может только владелец сайта' });
      else await live.refreshAdvice();
      res.json(inPageLang(live.getState(user, view)));
    }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  r.post('/settings', ownerOnly, (req, res) => res.json(live.setSettings(req.body || {})));
  r.post('/chat/clear', (req, res) => { live.clearChat(who(req)); res.json({ ok: true }); });
  // Убрать цель (поставить новую можно в чате: «хочу M7»)
  r.post('/goal/clear', async (req, res) => {
    try { const view = await viewOf(req); live.clearGoal(who(req), view); res.json(inPageLang(live.getState(who(req), view))); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.use('/api/live', r);

  if (state.member) kick();
  return live;
}
