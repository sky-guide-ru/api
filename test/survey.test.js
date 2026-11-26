import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GROUPS, QUESTIONS } from '../src/survey/questions.js';
import express from 'express';
import { cleanAnswer, createSurveyStore, summarize, toCsv, COUNT_FROM, mountSurveyRoutes } from '../src/survey/index.js';

test('опрос: не меньше 20 вопросов, у каждого 2+ варианта, id уникальны', () => {
  assert.ok(QUESTIONS.length >= 20, `вопросов ${QUESTIONS.length}`);
  assert.ok(GROUPS.length >= 5);
  const ids = new Set();
  for (const q of QUESTIONS) {
    assert.ok(!ids.has(q.id), `повтор id ${q.id}`); ids.add(q.id);
    assert.ok(q.options.length >= 2, q.id);
    assert.equal(new Set(q.options.map(o => o[0])).size, q.options.length, `повтор варианта в ${q.id}`);
  }
});

test('опрос: ответ чистится — чужие варианты, лимит выбора, свой вариант', () => {
  assert.match(cleanAnswer({ q: 'nope' }).error, /Нет такого/);
  assert.deepEqual(cleanAnswer({ q: 'main', o: ['next', 'money', 'hack'] }).answer, { o: ['next'], other: '' });
  assert.equal(cleanAnswer({ q: 'top', o: ['diag', 'chat', 'goal', 'event'] }).answer.o.length, 3);
  assert.equal(cleanAnswer({ q: 'main', o: [], other: '   ' }).answer, null);
  const long = cleanAnswer({ q: 'main', o: [], other: 'x'.repeat(1000) }).answer.other;
  assert.equal(long.length, 300);
});

test('опрос: ответы сохраняются, меняются и сбрасываются; прошедшие считаются с 10 ответов', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'survey-'));
  const s = createSurveyStore(dir);
  assert.equal(s.answer('g:a', 'main', null), 0);
  assert.equal(s.size(), 0, 'пустой ответ не создаёт анкету');
  s.answer('g:a', 'main', { o: ['next'], other: '' });
  s.answer('g:a', 'main', { o: ['money'], other: 'давно' });
  assert.deepEqual(s.mine('g:a').main, { o: ['money'], other: 'давно' });
  assert.equal(s.count(), 0);
  for (const q of QUESTIONS.slice(1, COUNT_FROM)) s.answer('g:a', q.id, { o: [q.options[0][0]], other: '' });
  assert.equal(s.count(), 1);
  s.answer('g:a', QUESTIONS[1].id, null);
  assert.equal(s.count(), 0, 'сброс ответа убирает из прошедших');
  s.flush();
  const s2 = createSurveyStore(dir);
  assert.deepEqual(s2.mine('g:a').main.o, ['money']);
  const r = summarize({ a: { answers: { main: { o: ['money'], other: 'давно' } } }, b: { answers: { main: { o: ['next'], other: '' } } } });
  const y = r.questions.find(q => q.id === 'main');
  assert.equal(y.answered, 2);
  assert.equal(y.options.find(o => o.id === 'money').pct, 50);
  assert.equal(y.others[0].text, 'давно');
});

test('опрос: CSV без ников, с подписями вариантов и кавычками', () => {
  const csv = toCsv({ 'u:secretnick': { at: 1, updated: 2, answers: { main: { o: ['money'], other: 'да, "давно"' } } } });
  assert.ok(csv.startsWith('﻿№,'));
  assert.doesNotMatch(csv, /secretnick/);
  assert.match(csv, /Помочь зарабатывать больше/);
  assert.ok(csv.includes('"да, ""давно"""'));
});

test('опрос: придуманная cookie гостя — тоже новая анкета и попадает под лимит с одного адреса', async () => {
  const app = express();
  app.use((req, _res, next) => { req.sbGuest = true; next(); });
  const store = createSurveyStore(null);
  mountSurveyRoutes(app, { express, store, clientIp: () => '1.2.3.4', requireAdmin: (_q, r) => r.status(403).end() });
  const srv = app.listen(0);
  const url = `http://localhost:${srv.address().port}/api/survey/answer`;
  try {
    const body = JSON.stringify({ q: QUESTIONS[0].id, o: [QUESTIONS[0].options[0][0]] });
    const codes = [];
    for (let i = 0; i < 8; i++) {
      const c = i.toString(16).padStart(32, 'a');
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `sb_survey=${c}` }, body });
      codes.push(r.status);
    }
    assert.deepEqual(codes, [200, 200, 200, 200, 200, 200, 429, 429]);
    assert.equal(store.size(), 6);
    // уже существующая анкета отвечает дальше без лимита
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `sb_survey=${'0'.padStart(32, 'a')}` }, body: JSON.stringify({ q: QUESTIONS[1].id, o: [QUESTIONS[1].options[0][0]] }) });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).answered, 2);
  } finally { srv.close(); }
});

test('опрос один для RU и EN: ответы общие, язык анкеты в итогах и CSV', () => {
  const store = createSurveyStore(null);
  const qs = QUESTIONS.slice(0, COUNT_FROM);
  for (const q of qs) store.answer('g:ru', q.id, { o: [q.options[0][0]], other: '' }, 'ru');
  for (const q of qs) store.answer('g:en', q.id, { o: [q.options[0][0]], other: q === qs[0] ? 'more guides' : '' }, 'en');
  assert.equal(store.count(), 2, 'оба идут в счётчик до пилота');
  const s = store.results();
  assert.deepEqual(s.byLang, { ru: 1, en: 1 });
  assert.equal(s.questions[0].options[0].n, 2, 'варианты считаются вместе');
  assert.equal(s.questions[0].others[0].lang, 'en');
  const csv = store.csv().split('\r\n');
  assert.match(csv[0], /Язык/);
  assert.ok(csv.slice(1).some(l => l.split(',')[2] === 'en'));
});
