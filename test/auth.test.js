import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createAuth } from '../src/auth.js';
import { createUserStore, verifyPassword, generatePassword } from '../src/users.js';

// Друзья для проверок первого запуска: в настоящем .env это SEED_FRIENDS
process.env.SEED_FRIENDS ??= 'Friend4ik:Pomegranate,Nightowl:Zucchini';

const viaTunnel = { 'cf-connecting-ip': '203.0.113.5', 'x-forwarded-for': '203.0.113.5' };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-auth-'));

async function withServer(env, fn, o = {}) {
  const app = express();
  const auth = createAuth({ PLAYER: 'OwnerCat',  PUBLIC_VIEW: '0', ...env }, o);
  app.use(auth.router);
  app.get('/api/state', (req, res) => res.json({ ok: true, user: req.sbUser?.name }));
  app.post('/api/admin-thing', auth.requireAdmin, (req, res) => res.json({ ok: true }));
  app.post('/api/refresh', (req, res) => res.json({ ok: true, guest: !!req.sbGuest }));
  app.post('/api/rift/marks', (req, res) => res.json({ ok: true }));
  app.post('/api/feedback', (req, res) => res.json({ ok: true, guest: !!req.sbGuest }));
  app.get('/api/live/state', (req, res) => res.json({ ok: true }));
  app.get('/', (req, res) => res.send('home'));
  const srv = app.listen(0);
  await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try { await fn(base, auth); } finally { srv.close(); }
}
const formPost = (base, url, body, headers = {}) => fetch(`${base}${url}`, {
  method: 'POST', redirect: 'manual',
  headers: { ...viaTunnel, 'content-type': 'application/x-www-form-urlencoded', ...headers },
  body: new URLSearchParams(body),
});
const cookieOf = r => (r.headers.getSetCookie?.() || [r.headers.get('set-cookie')]).map(c => c.split(';')[0]).filter(c => c.startsWith('sb_auth=')).join('; ');
// Неудачный вход: 303 обратно на GET /login с кодом ошибки (форма не «зависает» в истории браузера)
async function failed(base, r, e = 'bad') {
  assert.equal(r.status, 303);
  const loc = r.headers.get('location');
  assert.match(loc, new RegExp(`^/login\\?e=${e}`));
  const page = await fetch(`${base}${loc}`, { headers: viaTunnel });
  return { status: page.status, text: await page.text(), loc };
}
async function login(base, name, password) {
  const r = await formPost(base, '/login', { name, password }, { 'x-forwarded-proto': 'https' });
  return { r, cookie: cookieOf(r) };
}

test('без паролей: локально открыто, через туннель закрыто', () => withServer({}, async base => {
  assert.equal((await fetch(`${base}/api/state`)).status, 200);
  assert.equal((await fetch(`${base}/api/state`, { headers: viaTunnel })).status, 403);
  assert.equal((await fetch(`${base}/healthz`, { headers: viaTunnel })).status, 200);
}));

test('переход: владелец входит с ником и старым паролем SITE_PASSWORD', () => withServer({ SITE_PASSWORD: 'секрет1' }, async base => {
  assert.equal((await fetch(`${base}/api/state`, { headers: viaTunnel })).status, 401);
  const r = await fetch(`${base}/`, { headers: viaTunnel, redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /^\/login\?next=/);
  // локально без прокси пускает как владельца (AUTH_LOCAL по умолчанию)
  assert.equal((await (await fetch(`${base}/api/state`)).json()).user, 'OwnerCat');

  assert.equal((await failed(base, await formPost(base, '/login', { name: 'OwnerCat', password: 'nope' }))).status, 401);
  const ok = await formPost(base, '/login', { name: 'ownercat', password: 'секрет1', next: '//evil.com' }, { 'x-forwarded-proto': 'https' });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/');
  const all = ok.headers.getSetCookie();
  assert.ok(all.some(c => /^sb_auth=.*HttpOnly/.test(c) && /Secure/.test(c)));
  assert.ok(all.some(c => /^sb_me=/.test(c) && !/HttpOnly/.test(c)), 'ник для интерфейса — в читаемой cookie');
  const res = await fetch(`${base}/api/state`, { headers: { ...viaTunnel, cookie: cookieOf(ok) } });
  assert.equal((await res.json()).user, 'OwnerCat');
  // пустой ник = владелец (старые закладки и менеджеры паролей)
  assert.equal((await formPost(base, '/login', { password: 'секрет1' })).status, 303);
}));

test('старая cookie «только пароль» пускает владельца и меняется на новую', () => {
  const env = { SITE_PASSWORD: 'p' };
  const secret = crypto.createHmac('sha256', 'skyblock-tracker').update('p').digest();
  const exp = Date.now() + 86400_000;
  const legacy = `${exp}.${crypto.createHmac('sha256', secret).update(String(exp)).digest('base64url')}`;
  return withServer(env, async (base, auth) => {
    const r = await fetch(`${base}/api/state`, { headers: { ...viaTunnel, cookie: `sb_auth=${legacy}` } });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).user, 'OwnerCat');
    assert.ok(r.headers.getSetCookie().some(c => c.startsWith('sb_auth=v2.')));
    // сменил пароль — старая cookie больше не действует
    await auth.users.setPassword('OwnerCat', 'новый-пароль');
    assert.equal((await fetch(`${base}/api/state`, { headers: { ...viaTunnel, cookie: `sb_auth=${legacy}` } })).status, 401);
  });
});

test('подделанный, просроченный или отозванный токен не проходит', () => {
  const a = createAuth({ PLAYER: 'OwnerCat',  SITE_PASSWORD: 'p' });
  const b = createAuth({ PLAYER: 'OwnerCat',  SITE_PASSWORD: 'p' }); // другой секрет сессий
  const u = a.users.get('OwnerCat');
  assert.ok(a._test.userFromToken(a._test.makeToken(u)));
  assert.ok(!b._test.userFromToken(a._test.makeToken(u)));
  assert.ok(!a._test.userFromToken(a._test.makeToken(u, Date.now() - 31 * 86400_000)));
  assert.ok(!a._test.userFromToken('v2.abc.1.123.sig'));
  const tok = a._test.makeToken(u);
  a.users.bumpVersion('OwnerCat'); // «выйти на всех устройствах» / смена пароля
  assert.ok(!a._test.userFromToken(tok));
});

test('блокировка после 10 неверных попыток с одного IP', () => withServer({ SITE_PASSWORD: 'p' }, async base => {
  const post = () => formPost(base, '/login', { name: 'OwnerCat', password: 'no' });
  for (let i = 0; i < 10; i++) assert.equal((await failed(base, await post())).status, 401);
  const lim = await failed(base, await post(), 'wait');
  assert.equal(lim.status, 429);
  assert.match(lim.text, /Слишком много попыток\. Подожди 15 мин/);
}));

test('AUTH_LOCAL=0 спрашивает пароль и локально', () => withServer({ SITE_PASSWORD: 'x', AUTH_LOCAL: '0' }, async base => {
  assert.equal((await fetch(`${base}/api/state`)).status, 401);
}));

test('друг: владелец выдаёт временный пароль, друг обязан придумать свой и видит себя', () => withServer({ SITE_PASSWORD: 'owner-pass' }, async (base, auth) => {
  const owner = await login(base, 'OwnerCat', 'owner-pass');
  const h = { cookie: owner.cookie };
  // аккаунт без пароля — войти нельзя, а ответ такой же, как для любого ника: по входу не узнать, у кого есть аккаунт
  const noPw = await formPost(base, '/login', { name: 'Friend4ik', password: 'whatever' });
  const noPwPage = await failed(base, noPw, 'bad');
  assert.equal(noPwPage.status, 401);
  assert.doesNotMatch(noPwPage.text, /нет пароля|Friend4ik ещё/);
  const stranger = await failed(base, await formPost(base, '/login', { name: 'NoSuchUser1', password: 'whatever' }), 'bad');
  assert.equal(stranger.text.match(/class="err">[^<]*/)[0], noPwPage.text.match(/class="err">[^<]*/)[0]);

  const reset = await formPost(base, '/account/users/reset', { name: 'Friend4ik' }, h);
  assert.equal(reset.status, 303);
  const page = await (await fetch(`${base}${reset.headers.get('location')}`, { headers: { ...viaTunnel, ...h } })).text();
  const pw = /class="pw">([^<]+)</.exec(page)?.[1];
  assert.ok(pw && pw.length >= 8, 'пароль показан владельцу один раз');
  assert.ok(!/class="pw"/.test(await (await fetch(`${base}${reset.headers.get('location')}`, { headers: { ...viaTunnel, ...h } })).text()), 'второй раз не показывается');
  assert.ok(!JSON.stringify(auth.users.get('Friend4ik')).includes(pw), 'пароль не хранится открытым текстом');

  const f = await login(base, 'friend4ik', pw);
  assert.equal(f.r.headers.get('location'), '/account?must=1');
  const fh = { cookie: f.cookie };
  const api = await fetch(`${base}/api/state`, { headers: { ...viaTunnel, ...fh } });
  assert.equal(api.status, 403);
  assert.equal((await api.json()).mustChange, true);
  // без согласия на обработку данных (152-ФЗ) пароль не сохраняется
  const noConsent = await formPost(base, '/account/password', { current: pw, password: 'my-own-pass', password2: 'my-own-pass' }, fh);
  assert.equal(noConsent.status, 303);
  assert.equal(cookieOf(noConsent), '', 'вход не выдан');
  assert.equal(auth.users.get('Friend4ik').consentAt, undefined);
  const accPage = await (await fetch(`${base}/account`, { headers: { ...viaTunnel, ...fh } })).text();
  assert.ok(accPage.includes('name="consent"') && accPage.includes('href="/consent"'), 'на странице есть галочка согласия со ссылкой');
  // свой пароль + согласие
  const ch = await formPost(base, '/account/password', { current: pw, password: 'my-own-pass', password2: 'my-own-pass', consent: '1' }, fh);
  assert.equal(ch.status, 303);
  assert.ok(auth.users.get('Friend4ik').consentAt, 'дата согласия записана');
  const fresh = cookieOf(ch);
  const me = await (await fetch(`${base}/api/me`, { headers: { ...viaTunnel, cookie: fresh } })).json();
  assert.equal(me.name, 'Friend4ik'); assert.equal(me.profile, 'Pomegranate'); assert.equal(me.admin, false);
  assert.deepEqual(me.users, [], 'друг не видит список аккаунтов: друзья анонимны');
  const ownerMe = await (await fetch(`${base}/api/me`, { headers: { ...viaTunnel, ...h } })).json();
  assert.ok(ownerMe.users.some(u => u.name === 'Nightowl'), 'владелец видит аккаунты');
  // старый вход (временный пароль) больше не действует, новый — да
  assert.equal((await fetch(`${base}/api/state`, { headers: { ...viaTunnel, ...fh } })).status, 401);
  assert.equal((await (await fetch(`${base}/api/state`, { headers: { ...viaTunnel, cookie: fresh } })).json()).user, 'Friend4ik');
  await failed(base, (await login(base, 'Friend4ik', pw)).r);
  // друг не может управлять аккаунтами и админскими /api
  assert.equal((await formPost(base, '/account/users/reset', { name: 'Nightowl' }, { cookie: fresh })).status, 403);
  assert.equal((await fetch(`${base}/api/admin-thing`, { method: 'POST', headers: { ...viaTunnel, cookie: fresh } })).status, 403);
  assert.equal((await fetch(`${base}/api/admin-thing`, { method: 'POST', headers: { ...viaTunnel, ...h } })).status, 200);
  // запрос с чужого сайта не проходит
  assert.equal((await formPost(base, '/account/users/reset', { name: 'Nightowl' }, { ...h, 'sec-fetch-site': 'cross-site' })).status, 403);
}));

test('владелец добавляет и удаляет друга, себя удалить нельзя', () => withServer({ SITE_PASSWORD: 'owner-pass' }, async (base, auth) => {
  const { cookie } = await login(base, 'OwnerCat', 'owner-pass');
  await formPost(base, '/account/users', { name: 'New_Friend', profile: 'Kiwi' }, { cookie });
  assert.equal(auth.users.get('new_friend')?.profile, 'Kiwi');
  await formPost(base, '/account/users', { name: 'bad name!' }, { cookie });
  assert.equal(auth.users.get('bad name!'), null);
  await formPost(base, '/account/users/delete', { name: 'New_Friend' }, { cookie });
  assert.equal(auth.users.get('New_Friend'), null);
  await formPost(base, '/account/users/delete', { name: 'OwnerCat' }, { cookie });
  assert.ok(auth.users.get('OwnerCat'));
}));

test('аккаунты сохраняются в файл без паролей открытым текстом и переживают перезапуск', async () => {
  const dir = tmp();
  const file = path.join(dir, 'users.json');
  const s1 = createUserStore({ file, ownerName: 'OwnerCat', sitePassword: 'old-site-pass' });
  assert.deepEqual(s1.list().map(u => [u.name, u.role, u.hasPassword]), [['OwnerCat', 'admin', true], ['Friend4ik', 'friend', false], ['Nightowl', 'friend', false]]);
  await s1.setPassword('Nightowl', 'nighto-pass');
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(!text.includes('old-site-pass') && !text.includes('nighto-pass'));
  const s2 = createUserStore({ file, ownerName: 'OwnerCat', sitePassword: 'другой' }); // смена SITE_PASSWORD не перетирает уже заданный пароль
  assert.ok(await s2.check('OwnerCat', 'old-site-pass'));
  assert.ok(await s2.check('nightowl', 'nighto-pass'));
  assert.equal(await s2.check('Nightowl', 'nope'), null);
  // удалённый друг не возвращается после перезапуска
  s2.remove('Friend4ik');
  assert.equal(createUserStore({ file, ownerName: 'OwnerCat' }).get('Friend4ik'), null);
  await assert.rejects(() => s2.setPassword('Nightowl', '123'), /короткий/);
  assert.equal(await verifyPassword('x', null), false);
  assert.match(generatePassword(), /^[a-z]{9}-\d{4}$/);
});

test('секрет сессий хранится в data/: вход переживает перезапуск сервера', () => {
  const dir = tmp();
  const a = createAuth({ PLAYER: 'OwnerCat',  SITE_PASSWORD: 'p' }, { dataDir: dir });
  const tok = a._test.makeToken(a.users.get('OwnerCat'));
  const b = createAuth({ PLAYER: 'OwnerCat',  SITE_PASSWORD: 'p' }, { dataDir: dir });
  assert.equal(b._test.userFromToken(tok)?.u.name, 'OwnerCat');
});

test('удалённый и заново созданный аккаунт не оживляет старые входы', async () => {
  const a = createAuth({ PLAYER: 'OwnerCat',  SITE_PASSWORD: 'p' });
  await a.users.setPassword('Friend4ik', 'temp-pass', { mustChange: true });
  await a.users.setPassword('Friend4ik', 'own-pass-1');
  const old = a._test.makeToken(a.users.get('Friend4ik'));
  a.users.remove('Friend4ik');
  a.users.add({ name: 'Friend4ik' });
  await a.users.setPassword('Friend4ik', 'temp-pass', { mustChange: true });
  await a.users.setPassword('Friend4ik', 'new-pass-2');
  assert.equal(a.users.get('Friend4ik').ver, 3);
  assert.equal(a._test.userFromToken(old), null);
  assert.ok(a._test.userFromToken(a._test.makeToken(a.users.get('Friend4ik'))));
});

test('владелец на самом ПК: «Выйти» без паролей не ведёт на «Доступ закрыт», а кнопок выхода нет', () => withServer({}, async base => {
  const r = await fetch(`${base}/logout`, { redirect: 'follow' });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'home');
  const home = await fetch(`${base}/`);
  const me = (home.headers.getSetCookie?.() || []).find(c => c.startsWith('sb_me='));
  assert.ok(me && JSON.parse(decodeURIComponent(me.split(';')[0].slice(6))).l === 1, 'интерфейс знает, что это вход с ПК');
  const acc = await (await fetch(`${base}/account`)).text();
  assert.doesNotMatch(acc, /\/logout"/);
}));

test('лимит ИИ друга: «0,1» понимается, мусор — ошибка, а не тихий сброс', () => {
  const s = createUserStore({ file: null, ownerName: 'OwnerCat' });
  assert.equal(s.update('Friend4ik', { dailyUsd: '0,1' }).dailyUsd, 0.1);
  assert.equal(s.update('Friend4ik', { dailyUsd: '$0.2' }).dailyUsd, 0.2);
  assert.throws(() => s.update('Friend4ik', { dailyUsd: 'десять' }), /Лимит ИИ/);
  assert.equal(s.get('Friend4ik').dailyUsd, 0.2);
  assert.equal(s.update('Friend4ik', { dailyUsd: '' }).dailyUsd, null);
});

test('формы аккаунта защищены от двойного клика', () => withServer({}, async base => {
  const html = await (await fetch(`${base}/account`)).text();
  assert.match(html, /dataset\.sent/);
}));

test('открытый просмотр: гость читает сайт и /api без входа, но не советчик, отметки и аккаунт', () => withServer({ SITE_PASSWORD: 'owner-pass', PUBLIC_VIEW: '1' }, async base => {
  const st = await fetch(`${base}/api/state`, { headers: viaTunnel });
  assert.equal(st.status, 200);
  assert.equal((await st.json()).user, undefined, 'гость не становится владельцем');
  const page = await fetch(`${base}/`, { headers: viaTunnel, redirect: 'manual' });
  assert.equal(page.status, 200);
  assert.ok(page.headers.getSetCookie().some(c => c.startsWith('sb_me=') && decodeURIComponent(c).includes('"g":1')), 'интерфейс узнаёт гостя');
  const me = await (await fetch(`${base}/api/me`, { headers: viaTunnel })).json();
  assert.equal(me.guest, true);
  assert.deepEqual(me.users, [], 'гость не видит список аккаунтов');
  assert.equal((await fetch(`${base}/api/refresh`, { method: 'POST', headers: viaTunnel })).status, 200);
  assert.equal((await fetch(`${base}/api/live/state`, { headers: viaTunnel })).status, 401);
  assert.equal((await fetch(`${base}/api/Live/state`, { headers: viaTunnel })).status, 401, 'регистр адреса не обходит защиту');
  assert.equal((await fetch(`${base}/ACCOUNT`, { headers: viaTunnel, redirect: 'manual' })).status, 302);
  assert.equal((await fetch(`${base}/api/rift/marks`, { method: 'POST', headers: viaTunnel })).status, 401);
  const fb = await fetch(`${base}/api/feedback`, { method: 'POST', headers: viaTunnel });
  assert.equal(fb.status, 200, 'гость может сообщить об ошибке');
  assert.equal((await fb.json()).guest, true);
  assert.equal((await fetch(`${base}/api/admin-thing`, { method: 'POST', headers: viaTunnel })).status, 401);
  const acc = await fetch(`${base}/account`, { headers: viaTunnel, redirect: 'manual' });
  assert.equal(acc.status, 302);
  assert.match(acc.headers.get('location'), /^\/login/);
  // вошедший — как раньше
  const { cookie } = await login(base, 'OwnerCat', 'owner-pass');
  assert.equal((await (await fetch(`${base}/api/state`, { headers: { ...viaTunnel, cookie } })).json()).user, 'OwnerCat');
}));

test('открытый просмотр включён по умолчанию, PUBLIC_VIEW=0 возвращает вход для всех', async () => {
  assert.equal(createAuth({ PLAYER: 'OwnerCat',  SITE_PASSWORD: 'p' }).publicView, true);
  assert.equal(createAuth({ PLAYER: 'OwnerCat',  SITE_PASSWORD: 'p', PUBLIC_VIEW: '0' }).publicView, false);
});

test('requireAdmin не пускает гостя', async () => {
  const auth = createAuth({ PLAYER: 'OwnerCat',  SITE_PASSWORD: 'p' });
  let code = 0;
  auth.requireAdmin({ sbGuest: true, sbUser: null }, { status: c => { code = c; return { json: () => {} }; } }, () => { code = 200; });
  assert.equal(code, 403);
});

// ---------- Друг-новичок: проверка «вживую» (опечатки, двойные нажатия, два устройства) ----------
async function friendWithTempPassword(base) {
  const owner = await login(base, 'OwnerCat', 'owner-pass');
  const reset = await formPost(base, '/account/users/reset', { name: 'Friend4ik' }, { cookie: owner.cookie });
  const page = await (await fetch(`${base}${reset.headers.get('location')}`, { headers: { ...viaTunnel, cookie: owner.cookie } })).text();
  return /class="pw">([^<]+)</.exec(page)[1];
}
const flashOf = async (base, r, cookie) => {
  const html = await (await fetch(`${base}${r.headers.get('location')}`, { headers: { ...viaTunnel, cookie } })).text();
  return /class="flash (\w+)">([^<]+)/.exec(html)?.slice(1) || [];
};

test('друг: ник в русской раскладке и пароль, скопированный с пробелом или «Пароль:», — вход проходит', () => withServer({ SITE_PASSWORD: 'owner-pass' }, async base => {
  const pw = await friendWithTempPassword(base);
  assert.equal((await login(base, 'Акшутв4шл', `${pw} `)).r.headers.get('location'), '/account?must=1');
  assert.equal((await login(base, ' @friend4ik', `Пароль: ${pw}\n`)).r.headers.get('location'), '/account?must=1');
  // ник кириллицей, который латиницей не становится, — понятная подсказка
  const bad = await failed(base, await formPost(base, '/login', { name: 'Френдчик!', password: pw }), 'nick');
  assert.equal(bad.status, 401);
  assert.match(bad.text, /латиницей/);
  // поле ника без pattern: браузер не блокирует отправку непонятной английской ошибкой
  assert.ok(!/pattern=/.test(await (await fetch(`${base}/login`, { headers: viaTunnel })).text()));
}));

test('друг: свой пароль уже задан — с пробелом не пускает, а ошибка подсказывает, что делать, если забыл', () => withServer({ SITE_PASSWORD: 'owner-pass' }, async base => {
  const pw = await friendWithTempPassword(base);
  const f = await login(base, 'Friend4ik', pw);
  const ch = await formPost(base, '/account/password', { password: 'secret-77', password2: 'secret-77', consent: '1' }, { cookie: f.cookie });
  assert.equal(ch.status, 303);
  assert.match((await login(base, 'Friend4ik', 'secret-77 ')).r.headers.get('location'), /^\/login\?e=bad/, 'свой пароль сравнивается точно');
  const wrong = await failed(base, await formPost(base, '/login', { name: 'Friend4ik', password: 'nope-nope' }));
  assert.match(wrong.text, /Неверный ник или пароль/);
  const page = await (await fetch(`${base}/login`, { headers: viaTunnel })).text();
  assert.doesNotMatch(page, /OwnerCat|Friend4ik|Nightowl|владел/, 'страница входа не выдаёт владельца и друзей');
}));

test('друг: временный пароль второй раз не спрашивают, со страницы смены можно выйти, временный как новый не подходит', () => withServer({ SITE_PASSWORD: 'owner-pass' }, async base => {
  const pw = await friendWithTempPassword(base);
  const f = await login(base, 'Friend4ik', pw);
  const page = await (await fetch(`${base}/account?must=1`, { headers: { ...viaTunnel, cookie: f.cookie } })).text();
  assert.ok(!/name="current"/.test(page), 'поля «текущий пароль» нет');
  assert.match(page, /action="\/logout"/);
  const same = await formPost(base, '/account/password', { password: pw, password2: pw, consent: '1' }, { cookie: f.cookie });
  assert.deepEqual(await flashOf(base, same, f.cookie), ['err', 'Придумай новый пароль: временный от владельца не подойдёт']);
  const ok = await formPost(base, '/account/password', { password: 'brand-new', password2: 'brand-new', consent: '1' }, { cookie: f.cookie });
  assert.equal((await flashOf(base, ok, cookieOf(ok)))[0], 'ok');
  // после смены пароль уже свой: без текущего пароля поменять нельзя
  const again = await formPost(base, '/account/password', { password: 'other-one', password2: 'other-one' }, { cookie: cookieOf(ok) });
  assert.deepEqual(await flashOf(base, again, cookieOf(ok)), ['err', 'Текущий пароль не подходит']);
}));

test('друг: двойное нажатие «Сохранить пароль» не выкидывает из аккаунта', () => withServer({ SITE_PASSWORD: 'owner-pass' }, async base => {
  const pw = await friendWithTempPassword(base);
  const f = await login(base, 'Friend4ik', pw);
  const body = { password: 'double-click', password2: 'double-click', consent: '1' };
  const [a, b] = await Promise.all([formPost(base, '/account/password', body, { cookie: f.cookie }), formPost(base, '/account/password', body, { cookie: f.cookie })]);
  for (const r of [a, b]) {
    assert.equal((await flashOf(base, r, cookieOf(r)))[0], 'ok');
    // какая бы cookie ни пришла последней — вход действует
    assert.equal((await (await fetch(`${base}/api/state`, { headers: { ...viaTunnel, cookie: cookieOf(r) } })).json()).user, 'Friend4ik');
  }
}));

test('после входа по временному паролю друг возвращается туда, куда шёл (#/guides)', () => withServer({ SITE_PASSWORD: 'owner-pass' }, async base => {
  const pw = await friendWithTempPassword(base);
  const r = await formPost(base, '/login', { name: 'Friend4ik', password: pw, next: '/#/guides/rift' });
  assert.equal(r.headers.get('location'), `/account?must=1&next=${encodeURIComponent('/#/guides/rift')}`);
  const c = cookieOf(r);
  const page = await (await fetch(`${base}${r.headers.get('location')}`, { headers: { ...viaTunnel, cookie: c } })).text();
  assert.match(page, /name="next" value="\/#\/guides\/rift"/);
  const ch = await formPost(base, '/account/password', { password: 'new-pass-1', password2: 'new-pass-1', next: '/#/guides/rift', consent: '1' }, { cookie: c });
  const done = await (await fetch(`${base}${ch.headers.get('location')}`, { headers: { ...viaTunnel, cookie: cookieOf(ch) } })).text();
  assert.match(done, /href="\/#\/guides\/rift">← На сайт/);
}));

test('вход продлевается сам, пока друг заходит; без визитов 30 дней — истекает', async () => {
  let now = Date.UTC(2026, 10, 1);
  const users = createUserStore({ file: null, ownerName: 'OwnerCat', sitePassword: 'owner-pass' });
  await withServer({ SITE_PASSWORD: 'owner-pass', SESSION_SECRET: 's' }, async base => {
    const { cookie } = await login(base, 'OwnerCat', 'owner-pass');
    now += 3600_000; // через час — ничего не переписываем
    let r = await fetch(`${base}/api/state`, { headers: { ...viaTunnel, cookie } });
    assert.ok(!cookieOf(r));
    now += 20 * 86400_000; // через 20 дней — вход продлён ещё на 30
    r = await fetch(`${base}/api/state`, { headers: { ...viaTunnel, cookie } });
    const renewed = cookieOf(r);
    assert.ok(renewed, 'новая cookie выдана');
    now += 25 * 86400_000; // 45 дней с первого входа, 25 с продления — пускает
    assert.equal((await fetch(`${base}/api/state`, { headers: { ...viaTunnel, cookie: renewed } })).status, 200);
    assert.equal((await fetch(`${base}/api/state`, { headers: { ...viaTunnel, cookie } })).status, 401, 'старая непродлённая истекла');
  }, { users, clock: () => now });
});

test('ссылка «выйти» с чужого сайта не выкидывает из аккаунта', () => withServer({ SITE_PASSWORD: 'owner-pass' }, async base => {
  const { cookie } = await login(base, 'OwnerCat', 'owner-pass');
  const r = await fetch(`${base}/logout`, { headers: { ...viaTunnel, cookie, 'sec-fetch-site': 'cross-site' }, redirect: 'manual' });
  assert.ok(!(r.headers.getSetCookie() || []).some(c => /^sb_auth=;/.test(c)));
  // GET со своего сайта тоже не выходит — только спрашивает; выход — кнопкой (POST)
  const ask = await fetch(`${base}/logout`, { headers: { ...viaTunnel, cookie, 'sec-fetch-site': 'same-origin' }, redirect: 'manual' });
  assert.ok(!(ask.headers.getSetCookie() || []).some(c => /^sb_auth=;/.test(c)));
  assert.match(await ask.text(), /method="post" action="\/logout"/);
  const own = await formPost(base, '/logout', {}, { cookie, 'sec-fetch-site': 'same-origin' });
  assert.ok(own.headers.getSetCookie().some(c => /^sb_auth=;/.test(c)));
  const foreign = await formPost(base, '/logout', {}, { cookie, 'sec-fetch-site': 'cross-site' });
  assert.ok(!(foreign.headers.getSetCookie() || []).some(c => /^sb_auth=;/.test(c)));
}));

test('вход с ошибкой: редирект на GET /login с ником и next; лишние пробелы в нике не мешают', () => withServer({ SITE_PASSWORD: 'owner-pass' }, async base => {
  const bad = await failed(base, await formPost(base, '/login', { name: ' OwnerCat ', password: 'nope', next: '/?player=Kotik_228' }));
  assert.match(bad.loc, /name=OwnerCat&next=%2F%3Fplayer%3DKotik_228/);
  assert.match(bad.text, /Неверный ник или пароль/);
  assert.match(bad.text, /value="OwnerCat"/);
  assert.match(bad.text, /name="next" value="\/\?player=Kotik_228"/);
  // ник с пробелом или в русской раскладке: поле без pattern пропускает, сервер обрезает и переводит
  assert.doesNotMatch(bad.text, /pattern=/);
  const ok = await formPost(base, '/login', { name: 'OwnerCat ', password: 'owner-pass', next: '/?player=Kotik_228' });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/?player=Kotik_228');
  // подделанная ссылка «нет пароля» не выдумывает аккаунты
  const fake = await fetch(`${base}/login?e=nopass&name=Hacker`, { headers: viaTunnel });
  assert.doesNotMatch(await fake.text(), /У аккаунта Hacker/);
  // ссылка с #/страницей (сравнение, вики) не теряет её после входа: хеш не доходит до сервера, его дописывает страница
  assert.match(bad.text, /nx\.value\+=location\.hash/);
  // просто открыть /login — без ошибки и с кодом 200
  assert.equal((await fetch(`${base}/login`, { headers: viaTunnel })).status, 200);
}));

test('владелец исправляет опечатку в нике друга: пароль тот же, старый вход не действует', () => withServer({ SITE_PASSWORD: 'owner-pass' }, async (base, auth) => {
  const owner = await login(base, 'OwnerCat', 'owner-pass');
  await formPost(base, '/account/users', { name: 'Frend4ik' }, { cookie: owner.cookie });
  const reset = await formPost(base, '/account/users/reset', { name: 'Frend4ik' }, { cookie: owner.cookie });
  const pw = /class="pw">([^<]+)</.exec(await (await fetch(`${base}${reset.headers.get('location')}`, { headers: { ...viaTunnel, cookie: owner.cookie } })).text())[1];
  const old = await login(base, 'Frend4ik', pw);
  const r = await formPost(base, '/account/users/update', { name: 'Frend4ik', newName: 'Friend4ik_2', profile: '' }, { cookie: owner.cookie });
  assert.match((await flashOf(base, r, owner.cookie))[1], /Ник исправлен: Frend4ik → Friend4ik_2/);
  assert.equal(auth.users.get('Frend4ik'), null);
  assert.equal((await fetch(`${base}/api/state`, { headers: { ...viaTunnel, cookie: old.cookie } })).status, 401);
  assert.equal((await login(base, 'Friend4ik_2', pw)).r.headers.get('location'), '/account?must=1');
  // занятый ник и ник владельца не подходят
  const taken = await formPost(base, '/account/users/update', { name: 'Friend4ik_2', newName: 'Nightowl' }, { cookie: owner.cookie });
  assert.equal((await flashOf(base, taken, owner.cookie))[0], 'err');
  assert.throws(() => auth.users.rename('OwnerCat', 'Other'), /владельца/);
}));

test('открыл /login, уже войдя: видно, под кем, и можно войти под другим ником', () => withServer({ SITE_PASSWORD: 'owner-pass' }, async base => {
  const { cookie } = await login(base, 'OwnerCat', 'owner-pass');
  const r = await fetch(`${base}/login?next=%2F%23%2Fcompare`, { headers: { ...viaTunnel, cookie }, redirect: 'manual' });
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /Ты уже вошёл/);
  assert.match(html, /href="\/#\/compare">Продолжить как OwnerCat/);
  assert.match(html, /action="\/logout"/);
}));

test('удаление и переименование друга сообщают другим модулям (чат советчика)', () => withServer({ SITE_PASSWORD: 'owner-pass' }, async (base, auth) => {
  const got = [];
  auth.events.on('removed', n => got.push(['removed', n]));
  auth.events.on('renamed', (a, b) => got.push(['renamed', a, b]));
  const owner = await login(base, 'OwnerCat', 'owner-pass');
  await formPost(base, '/account/users/update', { name: 'Friend4ik', newName: 'Friend4ik_2', profile: '' }, { cookie: owner.cookie });
  await formPost(base, '/account/users/update', { name: 'Friend4ik_2', newName: 'Friend4ik_2', profile: 'Kiwi' }, { cookie: owner.cookie });
  const del = await formPost(base, '/account/users/delete', { name: 'Nightowl' }, { cookie: owner.cookie });
  assert.match((await flashOf(base, del, owner.cookie))[1], /историей его чата/);
  assert.deepEqual(got, [['renamed', 'Friend4ik', 'Friend4ik_2'], ['removed', 'Nightowl']]);
}));

test('профиль друга с опечаткой: владелец видит предупреждение, верный регистр исправляется сам', () => withServer({ SITE_PASSWORD: 'owner-pass' }, async (base, auth) => {
  auth.setProfileLookup(async () => ['Pomegranate', 'Kiwi']);
  const { cookie } = await login(base, 'OwnerCat', 'owner-pass');
  const flashOf = async r => (await (await fetch(`${base}${r.headers.get('location')}`, { headers: { ...viaTunnel, cookie } })).text());
  let html = await flashOf(await formPost(base, '/account/users/update', { name: 'Friend4ik', profile: 'Papya' }, { cookie }));
  assert.match(html, /flash warn/);
  assert.match(html, /нет профиля «Papya».*Pomegranate, Kiwi/s);
  html = await flashOf(await formPost(base, '/account/users/update', { name: 'Friend4ik', profile: 'pomegranate' }, { cookie }));
  assert.match(html, /Сохранено: Friend4ik/);
  assert.equal(auth.users.get('Friend4ik').profile, 'Pomegranate');
  // Hypixel не ответил — сохранить всё равно можно
  auth.setProfileLookup(async () => { throw new Error('нет связи'); });
  html = await flashOf(await formPost(base, '/account/users/update', { name: 'Friend4ik', profile: 'Kiwi' }, { cookie }));
  assert.match(html, /Сохранено: Friend4ik/);
}));
