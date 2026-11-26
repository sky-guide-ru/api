// Аккаунты сайта: ник Minecraft + пароль ОТ ЭТОГО САЙТА (не от Minecraft/Microsoft).
// Хранятся в data/users.json. Пароли — только хешем scrypt (соль на каждый пароль), сам пароль нигде не лежит.
//
// Владелец (PLAYER из .env, по умолчанию Steve) — администратор: создаёт друзей и сбрасывает им пароли.
// Переход со старого входа по одному паролю: при первом запуске владелец получает пароль из SITE_PASSWORD,
// то есть входит как раньше, только теперь пишет ещё и ник.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { tx } from '@sky-guide/core/i18n/msg.js';

const scryptAsync = promisify(crypto.scrypt);
const newSid = () => crypto.randomBytes(9).toString('base64url');
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

// Друзья, которым при первом запуске заводятся аккаунты без пароля (пароль владелец выдаёт на странице «Аккаунты»).
// Список не хранится в коде: SEED_FRIENDS в .env, формат «Ник:Профиль,Ник2:Профиль».
export const parseSeedFriends = raw => String(raw || '').split(',').map(x => x.trim()).filter(Boolean)
  .map(x => { const [name, profile = ''] = x.split(':').map(t => t.trim()); return { name, profile }; })
  .filter(f => /^[A-Za-z0-9_]{1,16}$/.test(f.name));
export const seedFriends = () => parseSeedFriends(process.env.SEED_FRIENDS);

export const validNick = n => typeof n === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(n);
export const MIN_PASSWORD = 6;

// Ник, набранный в русской раскладке («Акшутв4шл» → Friend4ik) или с лишним @ и пробелами — приводим к латинице.
// Регистр не важен: аккаунт ищется без учёта регистра.
const RU_KEYS = 'йцукенгшщзхъфывапролджэячсмитьбю';
const EN_KEYS = "qwertyuiop[]asdfghjkl;'zxcvbnm,.";
export function fixNick(raw) {
  const s = String(raw ?? '').trim().replace(/^@+/, '').replace(/\s+/g, '');
  if (!/[а-яё]/i.test(s)) return s;
  const t = [...s.toLowerCase()].map(c => { const i = RU_KEYS.indexOf(c === 'ё' ? 'е' : c); return i < 0 ? c : EN_KEYS[i]; }).join('');
  return validNick(t) ? t : s;
}

/** Временный пароль скопировали из сообщения вместе с пробелами или подписью «Пароль:» — достаём сам пароль */
export function cleanPastedPassword(pw) {
  return String(pw ?? '').trim().replace(/^(пароль|password|pass|пасс)\s*[:=-]?\s*/i, '').trim();
}

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(String(pw).normalize('NFC'), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}
function hashPasswordSync(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pw).normalize('NFC'), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

// Хеш-пустышка: проверка несуществующего ника занимает столько же времени, сколько настоящего
let dummyHash = null;
export async function verifyPassword(pw, stored) {
  const s = stored || (dummyHash ||= hashPasswordSync(crypto.randomBytes(8).toString('hex')));
  const [alg, N, r, p, saltB64, keyB64] = String(s).split('$');
  if (alg !== 'scrypt') return false;
  const want = Buffer.from(keyB64 || '', 'base64');
  if (!want.length) return false;
  const got = await scryptAsync(String(pw ?? '').normalize('NFC'), Buffer.from(saltB64, 'base64'), want.length, { N: +N, r: +r, p: +p });
  return crypto.timingSafeEqual(got, want) && !!stored;
}

/** Пароль, который удобно продиктовать другу: 3 слога + 4 цифры, без похожих букв */
export function generatePassword() {
  const C = 'bdfghkmnprstvz', V = 'aeiou';
  const pick = s => s[crypto.randomInt(s.length)];
  let w = '';
  for (let i = 0; i < 3; i++) w += pick(C) + pick(V) + pick(C);
  return `${w}-${String(crypto.randomInt(10000)).padStart(4, '0')}`;
}

/**
 * @param {{ file?: string|null, ownerName: string, sitePassword?: string, seed?: {name,profile}[] }} o
 *   file: null — хранить только в памяти (тесты)
 */
export function createUserStore(o) {
  const file = o.file || null;
  const ownerName = String(o.ownerName || 'Steve');
  let data = { version: 1, users: [] };
  let fresh = false;
  if (file) {
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); if (!Array.isArray(data.users)) throw new Error('битый файл'); }
    catch (e) {
      if (e.code !== 'ENOENT' && fs.existsSync(file)) {
        // Испорченный файл не затираем молча: откладываем копию, чтобы аккаунты можно было вернуть руками
        try { fs.copyFileSync(file, `${file}.broken-${Date.now()}`); } catch { /* */ }
        console.warn('[аккаунты] data/users.json не читается, создаю заново (копия рядом):', e.message);
      }
      data = { version: 1, users: [] }; fresh = true;
    }
  } else fresh = true;

  const key = n => String(n || '').toLowerCase();
  const find = n => data.users.find(u => key(u.name) === key(n));
  const now = () => Date.now();

  function save() {
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 1));
    fs.renameSync(file + '.tmp', file);
  }

  // ---- переход со старого входа ----
  let changed = false;
  let owner = find(ownerName);
  if (!owner) {
    owner = { name: ownerName, role: 'admin', profile: '', hash: null, ver: 1, mustChange: false, createdAt: now() };
    data.users.unshift(owner); changed = true;
  }
  if (owner.role !== 'admin') { owner.role = 'admin'; changed = true; }
  if (!owner.hash && o.sitePassword) {
    // Пароль владельца = старый SITE_PASSWORD; старые cookie «по паролю» тоже пока действуют (legacy)
    owner.hash = hashPasswordSync(o.sitePassword); owner.legacy = true; owner.passwordAt = now(); changed = true;
  }
  if (fresh) {
    for (const f of o.seed || seedFriends()) {
      if (!find(f.name)) { data.users.push({ name: f.name, role: 'friend', profile: f.profile || '', hash: null, ver: 1, mustChange: true, createdAt: now() }); changed = true; }
    }
  }
  // У каждого аккаунта свой случайный sid в cookie: удалённый и заново созданный с тем же ником аккаунт
  // не оживляет старые входы, даже если счётчик версий совпадёт
  for (const u of data.users) if (!u.sid) { u.sid = newSid(); changed = true; }
  if (changed) { try { save(); } catch (e) { console.warn('[аккаунты] не удалось сохранить:', e.message); } }

  const pub = u => u && ({
    name: u.name, role: u.role, profile: u.profile || '', hasPassword: !!u.hash, mustChange: !!u.mustChange,
    createdAt: u.createdAt || null, lastLoginAt: u.lastLoginAt || null, passwordAt: u.passwordAt || null,
    dailyUsd: u.dailyUsd ?? null, owner: key(u.name) === key(ownerName), consentAt: u.consentAt || null,
  });

  return {
    ownerName: () => owner.name,
    get: n => find(n) || null,
    isOwner: n => key(n) === key(owner.name),
    list: () => data.users.map(pub),
    pub,
    anyPassword: () => data.users.some(u => u.hash),

    /** Проверить ник и пароль. → пользователь или null */
    async check(name, password) {
      const u = find(name);
      const ok = await verifyPassword(password, u?.hash || null);
      return ok ? u : null;
    },

    async setPassword(name, password, { mustChange = false } = {}) {
      const u = find(name);
      if (!u) throw new Error('Нет такого аккаунта');
      if (String(password).length < MIN_PASSWORD) throw new Error(tx`Пароль слишком короткий: нужно хотя бы ${MIN_PASSWORD} символов`);
      if (String(password).length > 200) throw new Error('Пароль слишком длинный');
      u.hash = await hashPassword(password);
      u.ver = (u.ver || 1) + 1;           // все старые входы этого аккаунта перестают действовать
      u.mustChange = !!mustChange;
      u.passwordAt = now();
      delete u.legacy;
      save();
      return pub(u);
    },

    add({ name, profile = '', role = 'friend' }) {
      name = String(name || '').trim();
      if (!validNick(name)) throw new Error('Ник: латиница, цифры и _, до 16 символов');
      if (find(name)) throw new Error(tx`Аккаунт ${name} уже есть`);
      const u = { name, role: role === 'admin' ? 'admin' : 'friend', profile: String(profile || '').trim().slice(0, 40), hash: null, ver: 1, sid: newSid(), mustChange: true, createdAt: now() };
      data.users.push(u); save();
      return pub(u);
    },

    update(name, patch = {}) {
      const u = find(name);
      if (!u) throw new Error('Нет такого аккаунта');
      if ('profile' in patch) u.profile = String(patch.profile || '').trim().slice(0, 40);
      if ('dailyUsd' in patch) {
        const raw = String(patch.dailyUsd ?? '').trim().replace(',', '.').replace(/^\$|\$$/g, '');
        const v = raw === '' ? null : Number(raw);
        // «0,1» и «$0.1» понимаем; мусор не превращаем молча в «по умолчанию»
        if (v != null && !Number.isFinite(v)) throw new Error('Лимит ИИ: число в долларах, например 0.05 (или пусто — по умолчанию)');
        u.dailyUsd = v == null ? null : Math.max(0, Math.min(5, v));
      }
      if ('role' in patch && key(u.name) !== key(owner.name)) u.role = patch.role === 'admin' ? 'admin' : 'friend';
      save();
      return pub(u);
    },

    /** Исправить ник друга (опечатка при создании). Пароль остаётся, старые входы перестают действовать */
    rename(name, newName) {
      const u = find(name);
      if (!u) throw new Error('Нет такого аккаунта');
      if (key(u.name) === key(owner.name)) throw new Error('Ник владельца меняется в .env (PLAYER)');
      const n = fixNick(newName);
      if (!validNick(n)) throw new Error('Ник: латиница, цифры и _, до 16 символов');
      if (n === u.name) return pub(u);
      if (key(n) !== key(u.name) && find(n)) throw new Error(tx`Аккаунт ${n} уже есть`);
      u.name = n; u.ver = (u.ver || 1) + 1; u.sid = newSid();
      save();
      return pub(u);
    },

    remove(name) {
      if (key(name) === key(owner.name)) throw new Error('Аккаунт владельца удалить нельзя');
      const i = data.users.findIndex(u => key(u.name) === key(name));
      if (i < 0) throw new Error('Нет такого аккаунта');
      data.users.splice(i, 1); save();
    },

    /** Выйти на всех устройствах */
    bumpVersion(name) { const u = find(name); if (u) { u.ver = (u.ver || 1) + 1; delete u.legacy; save(); } },

    /** Друг дал согласие на обработку персональных данных (152-ФЗ, отдельный документ /consent) */
    recordConsent(name) { const u = find(name); if (u) { u.consentAt = now(); save(); } },

    touchLogin(name) { const u = find(name); if (u) { u.lastLoginAt = now(); try { save(); } catch { /* */ } } },
  };
}
