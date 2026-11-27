// Слэш-команды бота: имена и описания на английском и русском (Discord покажет по языку клиента).
// Список регистрируется в Discord при запуске api, только если он изменился (хэш в data/discord-commands.json).
import crypto from 'node:crypto';

const STRING = 3, BOOLEAN = 5;
const nick = { type: STRING, name: 'nick', name_localizations: { ru: 'ник' }, description: 'Minecraft nickname (empty: your linked account)', description_localizations: { ru: 'Ник в Minecraft (пусто — привязанный аккаунт)' }, required: false, min_length: 1, max_length: 16 };
const profile = { type: STRING, name: 'profile', name_localizations: { ru: 'профиль' }, description: 'SkyBlock profile name, e.g. Apple (empty: the active one)', description_localizations: { ru: 'Название профиля, например Apple (пусто — активный)' }, required: false, max_length: 20 };
const hidden = { type: BOOLEAN, name: 'private', name_localizations: { ru: 'скрыто' }, description: 'Show the answer only to you', description_localizations: { ru: 'Показать ответ только тебе' }, required: false };

// contexts: 0 — сервер, 1 — ЛС с ботом, 2 — личные чаты (если бота поставили себе); integration_types: 0 — на сервер, 1 — себе
const base = { type: 1, contexts: [0, 1, 2], integration_types: [0, 1] };

export const COMMANDS = [
  { ...base, name: 'profile', name_localizations: { ru: 'профиль' },
    description: 'SkyBlock profile: level, networth, skills, Dungeons, Slayers',
    description_localizations: { ru: 'Профиль SkyBlock: уровень, networth, скиллы, Dungeons, Slayers' },
    options: [nick, profile, hidden] },
  { ...base, name: 'price', name_localizations: { ru: 'цена' },
    description: 'Bazaar and Auction House price of an item',
    description_localizations: { ru: 'Цена предмета на Bazaar и Auction House' },
    options: [{ type: STRING, name: 'item', name_localizations: { ru: 'предмет' }, description: 'Item name (English or Russian)', description_localizations: { ru: 'Название предмета (по-английски или по-русски)' }, required: true, autocomplete: true, min_length: 2, max_length: 80 }, hidden] },
  { ...base, name: 'next', name_localizations: { ru: 'дальше' },
    description: 'What to do next: top steps of the Sky Guide plan',
    description_localizations: { ru: 'Что делать дальше: главные шаги плана Sky Guide' },
    options: [nick, profile] },
  // Привязка ника: только на сервере Sky Guide (там выдаётся роль Verified)
  { type: 1, contexts: [0], integration_types: [0], name: 'link', name_localizations: { ru: 'привязать' },
    description: 'Link your Minecraft nickname: Verified role and server nickname',
    description_localizations: { ru: 'Привязать ник Minecraft: роль Verified и ник на сервере' },
    options: [{ ...nick, description: 'Your Minecraft nickname', description_localizations: { ru: 'Твой ник в Minecraft' }, required: true }] },
  { type: 1, contexts: [0], integration_types: [0], name: 'unlink', name_localizations: { ru: 'отвязать' },
    description: 'Unlink your Minecraft nickname from Discord',
    description_localizations: { ru: 'Отвязать ник Minecraft от Discord' } },
];

export const commandsHash = (list = COMMANDS) => crypto.createHash('sha256').update(JSON.stringify(list)).digest('hex').slice(0, 16);
