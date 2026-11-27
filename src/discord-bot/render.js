// Ответы бота: карточки (embeds) Discord из готовых расчётов core. Чистые функции — их проверяют тесты.
// Язык — по языку клиента Discord (interaction.locale): ru/uk/be → русский, остальное → английский.
// Игровые термины везде по-английски, как в игре; по-русски — пояснения.

export const langOf = locale => (/^(ru|uk|be)/i.test(String(locale || '')) ? 'ru' : 'en');

const COLOR = 0x7c5cff; // фирменный фиолетовый Sky Guide
const MAX_FIELD = 1024;

export const T = {
  ru: {
    level: 'SkyBlock Level', networth: 'Networth', coins: 'Монеты', skillAvg: 'Skill Average', cata: 'Catacombs', slayers: 'Slayers',
    mp: 'Magical Power', pet: 'Питомец', hotm: 'HOTM', next: 'Что делать дальше', openProfile: 'Открыть на сайте', openPlan: 'Весь план',
    openItem: 'Открыть на сайте', bank: 'Bank', noPet: 'нет',
    planTitle: n => `Что делать дальше · ${n}`, planEmpty: 'Главных шагов сейчас нет: профиль в отличной форме.',
    cost: 'Стоимость', missingProfile: p => `Профиля «${p}» нет, показан активный.`,
    needNick: (site, link) => `Впиши ник: \`/профиль ник:Steve\`.${link ? ` Или привяжи Discord к нику на [сайте](${site}/discord), тогда ник можно не писать.` : ''}`,
    hidden: 'Этот игрок попросил не показывать его профиль.',
    closed: 'Профили других игроков сейчас закрыты.',
    rate: 'Слишком много разных ников за 10 минут. Подожди немного.',
    hypixel: 'Hypixel сейчас не отвечает или лимит запросов исчерпан. Попробуй через пару минут.',
    notFound: n => `Игрок «${n}» не найден.`, noProfile: n => `У игрока «${n}» нет профилей SkyBlock.`, badName: 'Ники Minecraft — латиница, цифры и _, до 16 символов.',
    failed: 'Не получилось загрузить профиль. Попробуй ещё раз позже.',
    itemNotFound: q => `Предмет «${q}» не найден.`, noPrice: 'Сейчас не продаётся ни на Bazaar, ни на Auction House.',
    bzBuy: 'Купить сразу', bzSell: 'Продать сразу', bzNet: 'после налога', bzWeek: 'За неделю', ahBin: 'Lowest BIN', ahSell: 'Продать за ~',
    ahLots: 'Лоты', ahSold: 'продано за 24 ч', change: 'Изменение', d1: 'за сутки', d7: 'за неделю', bazaar: 'Bazaar', ah: 'Auction House',
    soldFrom: { sales: 'по продажам', lots: 'по лотам', cap: 'не дороже лота' },
    link: {
      ok: (n, nick) => `✅ Ник **${n}** привязан: выдана роль Verified${nick ? ', ник на сервере — как в игре' : ''}.`,
      norole: n => `Ник **${n}** привязан, но роль выдать не получилось. Напиши модераторам.`,
      join: n => `Ник **${n}** привязан. Зайди на сервер Sky Guide и повтори команду, чтобы получить роль.`,
      mismatch: (n, set, you) => (set ? `В Hypixel у **${n}** указан Discord «${set}», а у тебя — «${you}».` : `У **${n}** в Hypixel не указан Discord.`),
      how: 'Как указать: в лобби Hypixel открой профиль (голова в хотбаре) → Social Media → Discord и отправь в чат свой ник Discord. Через минуту повтори команду.',
      nonick: n => `Ника «${n}» нет в Minecraft или на Hypixel. Проверь, как он пишется в игре.`,
      error: 'Не получилось привязать ник. Попробуй ещё раз позже.',
      rate: 'Слишком много попыток. Подожди 10 минут.',
      unlinked: n => `Ник **${n}** отвязан, роль Verified снята.`,
      none: 'К твоему Discord не привязан ник.',
      off: 'Привязка ника сейчас не работает.',
      modal: 'Верификация', label: 'Ник в Minecraft',
      panelOk: 'Сообщение с кнопкой поставлено.', panelFail: s => `Не получилось поставить сообщение (${s}). Нужны права боту на этот канал: просмотр, отправка, встраивание ссылок.`,
    },
  },
  en: {
    level: 'SkyBlock Level', networth: 'Networth', coins: 'Coins', skillAvg: 'Skill Average', cata: 'Catacombs', slayers: 'Slayers',
    mp: 'Magical Power', pet: 'Pet', hotm: 'HOTM', next: 'What to do next', openProfile: 'Open on the site', openPlan: 'Full plan',
    openItem: 'Open on the site', bank: 'Bank', noPet: 'none',
    planTitle: n => `What to do next · ${n}`, planEmpty: 'No major steps right now: the profile is in great shape.',
    cost: 'Cost', missingProfile: p => `There is no profile “${p}”, showing the active one.`,
    needNick: (site, link) => `Add a nickname: \`/profile nick:Steve\`.${link ? ` Or link Discord to your nickname on the [site](${site}/en/discord) to skip it.` : ''}`,
    hidden: 'This player asked not to show their profile.',
    closed: 'Other players’ profiles are closed right now.',
    rate: 'Too many different nicknames in 10 minutes. Please wait a bit.',
    hypixel: 'Hypixel is not responding or the request limit is reached. Try again in a couple of minutes.',
    notFound: n => `Player “${n}” not found.`, noProfile: n => `Player “${n}” has no SkyBlock profiles.`, badName: 'Minecraft nicknames use Latin letters, digits and _, up to 16 characters.',
    failed: 'Could not load the profile. Please try again later.',
    itemNotFound: q => `Item “${q}” not found.`, noPrice: 'Not sold on the Bazaar or the Auction House right now.',
    bzBuy: 'Instant buy', bzSell: 'Instant sell', bzNet: 'after tax', bzWeek: 'Weekly volume', ahBin: 'Lowest BIN', ahSell: 'Sells for ~',
    ahLots: 'Listings', ahSold: 'sold in 24h', change: 'Change', d1: '24h', d7: '7d', bazaar: 'Bazaar', ah: 'Auction House',
    soldFrom: { sales: 'by sales', lots: 'by listings', cap: 'capped by lowest BIN' },
    link: {
      ok: (n, nick) => `✅ **${n}** is linked: you have the Verified role${nick ? ' and your server nickname matches the game' : ''}.`,
      norole: n => `**${n}** is linked, but the role could not be given. Please contact the moderators.`,
      join: n => `**${n}** is linked. Join the Sky Guide server and run the command again to get the role.`,
      mismatch: (n, set, you) => (set ? `On Hypixel, **${n}** has Discord “${set}”, but you are “${you}”.` : `**${n}** has no Discord set on Hypixel.`),
      how: 'To set it: in a Hypixel lobby open your profile (head in the hotbar) → Social Media → Discord and send your Discord username in chat. Try again in a minute.',
      nonick: n => `“${n}” was not found in Minecraft or on Hypixel. Check the spelling.`,
      error: 'Could not link the nickname. Please try again later.',
      rate: 'Too many attempts. Please wait 10 minutes.',
      unlinked: n => `**${n}** is unlinked, the Verified role is removed.`,
      none: 'No nickname is linked to your Discord.',
      off: 'Nickname linking is not available right now.',
      modal: 'Verification', label: 'Minecraft nickname',
      panelOk: 'The button message is posted.', panelFail: s => `Could not post the message (${s}). The bot needs View, Send Messages and Embed Links in this channel.`,
    },
  },
};

/** 1 234 567 → 1.23M; монеты в SkyBlock везде пишут k/M/B */
export function coins(n) {
  const x = Number(n) || 0, a = Math.abs(x);
  const f = (v, s) => `${(Math.round(v * 100) / 100).toString()}${s}`;
  if (a >= 1e9) return f(x / 1e9, 'B');
  if (a >= 1e6) return f(x / 1e6, 'M');
  if (a >= 1e4) return f(x / 1e3, 'k');
  return String(Math.round(x));
}
const pct = v => (v == null || !Number.isFinite(Number(v)) ? null : `${v > 0 ? '+' : ''}${Math.round(v * 10) / 10}%`);
// переносы строк оставляем
const cut = (s, n) => { s = String(s ?? '').replace(/[^\S\n]+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const titleCase = id => String(id || '').toLowerCase().split('_').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
const plain = s => String(s ?? '').replace(/\s+/g, ' ').replace(/§./g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'); // ссылки новостей и цвета Minecraft — просто текст
const esc = s => String(s ?? '').replace(/([\\*_`~|>[\]])/g, '\\$1'); // ник вида __Steve__ не должен превращаться в разметку

// Слееры — значком и уровнем: шесть боссов умещаются в одну строку
const SLAYER_ICON = { zombie: '🧟', spider: '🕸️', wolf: '🐺', enderman: '🔮', blaze: '🔥', vampire: '🩸' };
const RARITY_ICON = { common: '⚪', uncommon: '🟢', rare: '🔵', epic: '🟣', legendary: '🟡', mythic: '🩷', divine: '🩵', special: '🔴', very_special: '🔴' };

/** Ссылки на сайт: профиль, план и предмет. ?player= — так ссылкой можно поделиться и на самом сайте */
export function siteLinks(site, lang, name, profile) {
  const base = `${site}${lang === 'en' ? '/en' : ''}`;
  const q = name ? `?player=${encodeURIComponent(name)}${profile ? `&profile=${encodeURIComponent(profile)}` : ''}` : '';
  return { profile: `${base}/${q}#/overview`, plan: `${base}/${q}#/roadmap`, item: id => `${base}/item/${encodeURIComponent(id)}` };
}
const linkRow = buttons => [{ type: 1, components: buttons.map(b => ({ type: 2, style: 5, label: b.label, url: b.url, ...(b.emoji ? { emoji: { name: b.emoji } } : {}) })) }];
// Подвал карточки: значок и адрес сайта (Discord показывает картинки только по полному адресу и только PNG/JPG)
const footer = site => ({ text: 'sky-guide.ru', icon_url: `${site}/discord/logo.png` });
const head = (site, name) => `${site}/api/head/${encodeURIComponent(name)}?size=128`;
const field = (icon, name, value, inline = true) => ({ name: `${icon} ${name}`, value: cut(value, MAX_FIELD) || '—', inline });

/** /profile: карточка из summarizeForCompare (core/compare.js) */
export function profileMessage(s, { lang = 'ru', site, next = [] } = {}) {
  const t = T[lang];
  const name = s.player?.name || '?';
  const links = siteLinks(site, lang, name, s.missingProfile ? '' : s.profile);
  const slayers = Object.entries(s.slayers || {}).filter(([, x]) => x.level > 0).map(([k, x]) => `${SLAYER_ICON[k] || x.boss} ${x.level}`).join(' · ');
  const d = s.dungeons || {};
  const cls = d.selectedClass ? ` · ${titleCase(d.selectedClass)}` : '';
  const pet = s.pets?.active;
  const nw = s.networth?.total;
  const fields = [
    field('⭐', t.level, String(Math.floor(s.sbLevel || 0))),
    field('💎', t.networth, nw ? coins(nw) : '—'),
    field('💰', t.coins, `${coins(s.purse)}${s.bank != null ? ` · ${t.bank} ${coins(s.bank)}` : ''}`),
    field('📚', t.skillAvg, (Math.round((s.skillAverage || 0) * 100) / 100).toFixed(2)),
    field('💀', t.cata, `${Math.floor(d.level || 0)}${cls}`),
    field('✨', t.mp, String(s.accessories?.mp || 0)),
    field('🐣', t.pet, pet ? `${RARITY_ICON[String(pet.tier).toLowerCase()] || ''} ${titleCase(pet.type)} · ${pet.level}`.trim() : t.noPet),
    ...(s.mining?.hotm ? [field('⛏️', t.hotm, String(s.mining.hotm))] : []),
    ...(slayers ? [field('⚔️', t.slayers, slayers, false)] : []),
    ...(next.length ? [field('🧭', t.next, next.slice(0, 3).map((x, i) => `\`${i + 1}\` ${esc(plain(x.title))}`).join('\n'), false)] : []),
  ];
  const mode = s.gameMode && s.gameMode !== 'normal' ? ` · ${titleCase(s.gameMode)}` : '';
  return {
    content: s.missingProfile ? t.missingProfile(s.missingProfile) : undefined,
    embeds: [{
      title: cut(`${name} · ${s.profile || 'SkyBlock'}${mode}`, 256), url: links.profile, color: COLOR,
      thumbnail: { url: head(site, name) },
      fields, footer: footer(site), ...(s.updatedAt ? { timestamp: new Date(s.updatedAt).toISOString() } : {}),
    }],
    components: linkRow([{ label: t.openProfile, url: links.profile, emoji: '🌐' }, { label: t.openPlan, url: links.plan, emoji: '🧭' }]),
    allowed_mentions: { parse: [] },
  };
}

/** /next: главные шаги плана (v1 plan: steps с title, why, cost) */
export function planMessage(p, { lang = 'ru', site, limit = 5 } = {}) {
  const t = T[lang];
  const name = p.player?.name || '?';
  const links = siteLinks(site, lang, name, p.profile);
  const steps = (p.steps || []).slice(0, limit);
  const description = steps.length
    ? steps.map((s, i) => `**${i + 1}. ${esc(cut(plain(s.title), 120))}**${s.why ? `\n${cut(plain(s.why), 160)}` : ''}${s.cost ? `\n💰 ~${coins(s.cost)}` : ''}`).join('\n\n')
    : t.planEmpty;
  return {
    embeds: [{
      title: cut(`🧭 ${t.planTitle(name)}`, 256), url: links.plan, color: COLOR, description: cut(description, 4000),
      thumbnail: { url: head(site, name) },
      footer: footer(site), ...(p.updatedAt ? { timestamp: new Date(p.updatedAt).toISOString() } : {}),
    }],
    components: linkRow([{ label: t.openPlan, url: links.plan, emoji: '🧭' }]),
    allowed_mentions: { parse: [] },
  };
}

const trend = (v, label) => { const x = pct(v); return x && `${v > 0 ? '📈' : v < 0 ? '📉' : '➖'} ${x} ${label}`; };

/** /price: котировка из core/market/quote.js (makeQuote) */
export function priceMessage(item, q, { lang = 'ru', site } = {}) {
  const t = T[lang];
  const links = siteLinks(site, lang);
  const change = q ? [trend(q.d1, t.d1), trend(q.d7, t.d7)].filter(Boolean).join(' · ') : '';
  let fields = [];
  if (q?.market === 'bazaar') {
    fields = [
      field('🛒', t.bzBuy, coins(q.buy)),
      field('💸', t.bzSell, `${coins(q.sell)}\n${coins(q.sellNet)} ${t.bzNet}`),
      ...(q.buyWeek || q.sellWeek ? [field('📦', t.bzWeek, `${coins(q.buyWeek)} / ${coins(q.sellWeek)}`)] : []),
    ];
  } else if (q?.market === 'ah') {
    fields = [
      field('🏷️', t.ahBin, q.buy ? coins(q.buy) : '—'),
      field('💸', t.ahSell, `${coins(q.sell)}${q.sellFrom ? `\n${t.soldFrom[q.sellFrom] || q.sellFrom}` : ''}`),
      field('📦', t.ahLots, `${q.lots || 0}\n${q.sold24 || 0} ${t.ahSold}`),
    ];
  }
  const sub = lang === 'ru' && item.nameRu && item.nameRu !== item.name ? item.nameRu : '';
  const market = q ? (q.market === 'bazaar' ? `🏪 ${t.bazaar}` : `🔨 ${t.ah}`) : t.noPrice;
  return {
    embeds: [{
      title: cut(plain(item.name || item.id), 256), url: links.item(item.id), color: COLOR,
      description: [[market, sub].filter(Boolean).join(' · '), change].filter(Boolean).join('\n'),
      thumbnail: { url: `${site}/v1/items/${encodeURIComponent(item.id)}/image` },
      fields, footer: footer(site), timestamp: new Date().toISOString(),
    }],
    components: linkRow([{ label: t.openItem, url: links.item(item.id), emoji: '🌐' }]),
    allowed_mentions: { parse: [] },
  };
}

/** Сообщение с кнопками в канале верификации: одно на оба языка (его читают все) */
export function verifyPanel(site) {
  return {
    embeds: [{
      title: '✅ Верификация · Verification', color: COLOR,
      description: [
        'Нажми **Верификация** и впиши ник Minecraft: бот сверит его с Discord в профиле Hypixel и откроет чаты.',
        'Press **Verify** and enter your Minecraft nickname: the bot checks the Discord in your Hypixel profile and opens the chats.',
        '',
        '**Где указать Discord · Where to set it:** Hypixel → профиль / profile (голова в хотбаре / head in the hotbar) → Social Media → Discord.',
      ].join('\n'),
      footer: footer(site),
    }],
    components: [{ type: 1, components: [
      { type: 2, style: 3, custom_id: VERIFY_ID, label: 'Верификация · Verify', emoji: { name: '✅' } },
      { type: 2, style: 2, custom_id: UNLINK_ID, label: 'Отвязать · Unlink' },
    ] }],
    allowed_mentions: { parse: [] },
  };
}
export const VERIFY_ID = 'sg:verify', UNLINK_ID = 'sg:unlink';

/** Окно с полем для ника (ответ на кнопку «Верификация») */
export function verifyModal(lang) {
  const l = T[lang].link;
  return { type: 9, data: { custom_id: VERIFY_ID, title: l.modal, components: [{ type: 1, components: [
    { type: 4, custom_id: 'nick', style: 1, label: l.label, placeholder: 'Steve', min_length: 1, max_length: 16, required: true },
  ] }] } };
}

/** Итог /link и /unlink (результаты link()/unlink() из discord-link.js) → текст */
export function linkText(res, lang) {
  const t = T[lang], l = t.link, n = esc(res?.nick || '');
  switch (res?.r) {
    case 'ok': return l.ok(n, res.nickSet);
    case 'norole': return l.norole(n);
    case 'join': return l.join(n);
    case 'mismatch': return `${l.mismatch(n, esc(res.set || ''), esc(res.you || ''))}\n${l.how}`;
    case 'nonick': return l.nonick(n);
    case 'busy': return t.hypixel;
    case 'unlinked': return l.unlinked(n);
    case 'none': return l.none;
    default: return l.error;
  }
}

/** Ошибка загрузки профиля (коды из core/players.js) → понятный текст */
export function errorText(e, lang, nick) {
  const t = T[lang];
  switch (e?.code) {
    case 'BAD_NAME': return t.badName;
    case 'NOT_FOUND': return t.notFound(esc(nick));
    case 'NO_PROFILE': return t.noProfile(esc(nick));
    case 'HIDDEN': return t.hidden;
    case 'RATE': case 'NO_KEY': return t.hypixel;
    default: return t.failed;
  }
}
