// Правовые страницы сайта: политика обработки персональных данных, согласие, пользовательское соглашение,
// правовая информация (оговорки, источники данных и лицензии). Отдаются сервером как обычный HTML —
// открываются без входа, без JavaScript и индексируются поисковиками.
//
// Данные владельца берутся из .env (без них на страницах видно предупреждение — заполни до запуска рекламы):
//   OPERATOR_NAME=Иванов Иван Иванович     ФИО владельца сайта (оператора персональных данных)
//   OPERATOR_INN=000000000000               ИНН (необязательно; самозанятому полезно для доверия рекламодателей)
//   CONTACT_EMAIL=почта@домен.ru            почта для запросов по персональным данным и жалоб правообладателей
//   HIDDEN_PLAYERS=Ник1,Ник2                игроки, попросившие скрыть свой профиль от посторонних
//
// ВНИМАНИЕ: тексты подготовлены ИИ по открытым источникам и не являются юридической консультацией.
import { publicConfig } from './public.js';
import { publicPackNames } from '@sky-guide/core/packs.js';
import { legalEn, privacyEn, consentEn, termsEn, apiTermsEn, EN_TITLES, EN_NOTE } from './legal-en.js';

export const LEGAL_VERSION = '25 ноября 2026';
export const LEGAL_VERSION_EN = '25 November 2026';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[a-z]{2,24}$/i;

/** Сведения о владельце из .env; missing — чего не хватает */
export function operatorInfo(env = process.env) {
  const name = String(env.OPERATOR_NAME || '').trim().slice(0, 120);
  const inn = /^\d{10}(\d{2})?$/.test(String(env.OPERATOR_INN || '').trim()) ? env.OPERATOR_INN.trim() : '';
  const email = EMAIL.test(String(env.CONTACT_EMAIL || '').trim()) ? env.CONTACT_EMAIL.trim() : '';
  const missing = [!name && 'OPERATOR_NAME (ФИО)', !email && 'CONTACT_EMAIL (почта для обращений)'].filter(Boolean);
  return { name, inn, email, missing };
}

/** Ники, чьи профили не показываются посторонним (по просьбе игрока) */
export function hiddenPlayers(env = process.env) {
  return new Set(String(env.HIDDEN_PLAYERS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
}

/** Какие внешние сервисы реально включены — чтобы политика описывала то, что есть, а не шаблон */
export function servicesInUse(env = process.env) {
  const c = publicConfig(env);
  return {
    metrika: !!c.metrika,
    ads: !!(c.rtb.bottom || c.rtb.landing),
    donate: c.donateUrl ? new URL(c.donateUrl).hostname.replace(/^www\./, '') : '',
    ai: !!String(env.ANTHROPIC_API_KEY || '').trim(),
    mail: !!String(env.SMTP_USER || '').trim() && !!String(env.SMTP_PASS || '').trim(),
    // Быстрый туннель Cloudflare (npm run share) пропускает весь трафик через серверы Cloudflare за рубежом
    cloudflare: !c.siteUrl || /trycloudflare\.com/i.test(c.siteUrl) || env.BEHIND_CLOUDFLARE === '1',
    siteUrl: c.siteUrl,
  };
}

const CSS = `
  *{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#0b0f1a;color:#dfe5f2;line-height:1.6}
  main{max-width:860px;margin:0 auto;padding:28px 20px 60px}
  h1{font-size:26px;margin:8px 0 4px;color:#fff}h2{font-size:18px;margin:28px 0 8px;color:#ffd27a}h3{font-size:15px;margin:18px 0 6px;color:#fff}
  p,li{color:#c3cbe0}a{color:#9fb6ff}code{color:#ffd27a}
  table{border-collapse:collapse;width:100%;font-size:14px;margin:8px 0}td,th{border:1px solid #26314f;padding:6px 8px;text-align:left;vertical-align:top}th{background:#121a2e;color:#fff}
  nav.top{display:flex;gap:14px;flex-wrap:wrap;font-size:14px;padding:12px 0;border-bottom:1px solid #1d2742}
  nav.top a{text-decoration:none}nav.top a.on{color:#fff;font-weight:600}
  .muted{color:#7d89a8;font-size:13px}.warn{padding:12px 14px;border-radius:10px;background:#3a2a10;border:1px solid #8a6a1a;color:#ffe7a8;margin:14px 0}
  .box{padding:12px 14px;border-radius:10px;background:#121a2e;border:1px solid #26314f;margin:12px 0}
`;

// canonical и hreflang — полными адресами: относительные Google в hreflang не принимает, а без canonical выбирает сам
function legalLinks(env, active, en) {
  const o = String(publicConfig(env).siteUrl || '').replace(/\/+$/, '');
  return `<link rel="canonical" href="${esc(o + (en ? '/en' : '') + active)}"><link rel="alternate" hreflang="ru" href="${esc(o + active)}"><link rel="alternate" hreflang="en" href="${esc(o + '/en' + active)}">`;
}

function page(env, active, title, body, { owner = false, lang = 'ru' } = {}) {
  const op = operatorInfo(env);
  const en = lang === 'en', pre = en ? '/en' : '';
  const links = en ? Object.entries(EN_TITLES)
    : [['/legal', 'Правовая информация'], ['/privacy', 'Политика конфиденциальности'], ['/consent', 'Согласие на обработку данных'], ['/terms', 'Пользовательское соглашение'], ['/api-terms', 'API и правила']];
  const other = en ? `<a href="${active}" hreflang="ru" lang="ru">Русская версия</a>` : `<a href="/en${active}" hreflang="en" lang="en">English</a>`;
  return `<!doctype html><html lang="${en ? 'en' : 'ru'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Sky Guide</title><link rel="icon" href="/favicon.svg" type="image/svg+xml">
${legalLinks(env, active, en)}<style>${CSS}</style></head>
<body><main>
<nav class="top"><a href="${pre}/">${en ? '← Back to the site' : '← На сайт'}</a>${links.map(([h, t]) => `<a href="${pre}${h}"${h === active ? ' class="on"' : ''}>${t}</a>`).join('')}${other}</nav>
${owner && op.missing.length ? `<div class="warn">Это видно только владельцу: заполните в <code>.env</code> ${op.missing.map(esc).join(' и ')} — без этого документы неполные.</div>` : ''}
<h1>${esc(title)}</h1><p class="muted">${en ? `Version of ${LEGAL_VERSION_EN}` : `Редакция от ${LEGAL_VERSION}`}</p>
${en ? EN_NOTE : ''}
${body}
</main></body></html>`;
}

// Английская версия страницы: свой текст из legal-en.js в той же обёртке
const enPage = (env, path, fn, opts) => page(env, path, EN_TITLES[path], fn(env), { ...opts, lang: 'en' });

/**
 * Раздел для посетителей из ЕС, ЕЭЗ и Великобритании (GDPR): сайт открыт для них (английская версия),
 * сервер во Франции. Одинаковый по смыслу в обеих версиях политики. Возвращает [[заголовок, текст], …].
 */
export function gdprRows(lang, op, s) {
  const m = op.email ? `<a href="mailto:${esc(op.email)}">${esc(op.email)}</a>` : (lang === 'en' ? "the site owner's email" : 'почту владельца сайта');
  const yandex = s.metrika || s.ads, us = [s.ai && 'Anthropic', s.mail && 'Google', s.cloudflare && 'Cloudflare'].filter(Boolean);
  if (lang === 'en') return [
    ['Controller', `${op.name ? `${esc(op.name)}, Russia` : 'The site owner (a private individual in Russia)'}. Contact: ${m}. The site has no establishment in the EU and processes only a small amount of low-risk data, so it has not appointed an EU representative; write to the address above.`],
    ['Legal bases', `Server logs, anonymous statistics, abuse protection and showing public game profiles: legitimate interest (art. 6(1)(f)): keeping the site working and safe. ${['Feedback', yandex && 'cookies for Yandex services', s.ai && 'the AI assistant'].filter(Boolean).join(', ')}: your consent (art. 6(1)(a)). Accounts: providing the service you asked for (art. 6(1)(b)).`],
    ['Where data goes', `The site's server and databases are in France (EU). ${yandex ? 'Yandex (Russia) receives data only after you click "Accept" in the cookie banner; Russia has no EU adequacy decision, so this transfer relies on your explicit consent (art. 49(1)(a)) and you can decline it without losing access to the site. ' : ''}${us.length ? `${us.join(', ')} (USA) ${us.length > 1 ? 'receive' : 'receives'} data as described in section 5, under the EU–US Data Privacy Framework or standard contractual clauses offered by the recipient. ` : ''}Data is not sold, and there is no automated decision-making or profiling with legal or similarly significant effects.`],
    ['Your rights', `You have the right to access your data, have it corrected or erased, restrict processing, data portability, object to processing based on legitimate interest, and withdraw consent at any time without affecting earlier processing. Write to ${m}; you will get a reply within one month. You can also complain to the data protection authority in your country of residence or to the French CNIL (cnil.fr). UK visitors can complain to the ICO (ico.org.uk).`],
  ];
  return [
    ['Оператор', `${op.name ? `${esc(op.name)}, Россия` : 'Владелец сайта (частное лицо в России)'}. Связь: ${m}. Представительства в ЕС у сайта нет; данных мало и они низкого риска, поэтому представитель в ЕС не назначен — пишите на адрес выше.`],
    ['Основания', `Технические журналы, обезличенная статистика, защита от злоупотреблений и показ публичных игровых профилей — законный интерес (ст. 6(1)(f) GDPR): чтобы сайт работал и был защищён. ${['Отзывы', yandex && 'cookie сервисов Яндекса', s.ai && 'ИИ-советчик'].filter(Boolean).join(', ')} — согласие (ст. 6(1)(a)). Аккаунты — оказание услуги, которую вы запросили (ст. 6(1)(b)).`],
    ['Куда идут данные', `Сервер и базы данных сайта находятся во Франции (ЕС). ${yandex ? 'Яндекс (Россия) получает данные только после «Принять» в баннере cookie; для России нет решения ЕС о достаточной защите, поэтому передача идёт по вашему явному согласию (ст. 49(1)(a)), и отказ не мешает пользоваться сайтом. ' : ''}${us.length ? `${us.join(', ')} (США) получают данные, как описано в разделе 5, по EU–US Data Privacy Framework или стандартным договорным условиям получателя. ` : ''}Данные не продаются; автоматических решений и профилирования с юридическими или сходными последствиями нет.`],
    ['Ваши права', `Вы вправе получить доступ к своим данным, исправить или удалить их, ограничить обработку, получить их в переносимом виде, возразить против обработки по законному интересу и в любой момент отозвать согласие (без влияния на обработку до отзыва). Пишите на ${m}; ответ — в течение месяца. Также можно пожаловаться в надзорный орган по защите данных своей страны или во французский CNIL (cnil.fr); жителям Великобритании — в ICO (ico.org.uk).`],
  ];
}

// Пока данные владельца не заполнены, посетитель видит нейтральные слова, а не «указывается в настройках»
const who = op => (op.name ? `${esc(op.name)}${op.inn ? `, ИНН ${esc(op.inn)}` : ''}` : 'владелец сайта');
const whoTo = op => (op.name ? who(op) : 'владельцу сайта'); // «даю согласие кому»
const mail = op => (op.email ? `<a href="mailto:${esc(op.email)}">${esc(op.email)}</a>` : 'почту владельца сайта');
const site = s => (s.siteUrl ? `сайт ${esc(s.siteUrl)}` : 'этот сайт');

export function legalPage(env = process.env, opts = {}) {
  if (opts.lang === 'en') return enPage(env, '/legal', legalEn, opts);
  const op = operatorInfo(env), s = servicesInUse(env);
  return page(env, '/legal', 'Правовая информация', `
<h2>Неофициальный сайт</h2>
<p>Sky Guide — неофициальный фанатский сайт о режиме SkyBlock на сервере Hypixel. Сайт <b>не связан</b> с Hypixel Inc., Mojang AB и Microsoft Corporation, <b>не одобрен</b> и <b>не поддерживается</b> ими.</p>
<p>Это не официальный сервис Minecraft: он не одобрен Mojang и Microsoft и не связан с ними. Сайт не связан с Hypixel Inc. и не одобрен ею.</p>
<p class="muted">Оригинал оговорки на английском, как требуют правила Mojang: <b>NOT AN OFFICIAL MINECRAFT SERVICE. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.</b> This website is not affiliated with or endorsed by Hypixel Inc.</p>
<p>Minecraft — товарный знак Mojang Synergies AB. Hypixel и Hypixel SkyBlock — товарные знаки Hypixel Inc. Названия предметов, тексты и изображения из игры принадлежат их правообладателям и используются только чтобы показать игроку его собственные данные и справку по игре.</p>

<h2>Владелец сайта и связь</h2>
<p>Сайт ведёт ${op.name ? who(op) : 'частное лицо'}.${op.email ? ` Почта: ${mail(op)}.` : ''}</p>
<p>Правообладателям: если вы считаете, что материал на сайте нарушает ваши права, напишите на ${mail(op)}, указав, какой материал и на каком основании. Спорный материал убирается в течение 3 рабочих дней с момента получения обоснованной жалобы.</p>

<h2>Откуда данные</h2>
<table>
<tr><th>Что</th><th>Источник</th><th>Условия</th></tr>
<tr><td>Профили игроков, цены Bazaar и аукциона</td><td><a href="https://api.hypixel.net" rel="noopener">Hypixel Public API</a></td><td>По <a href="https://developer.hypixel.net/policies" rel="noopener">API Policy Hypixel</a>. Показываются только данные, которые Hypixel отдаёт публично.</td></tr>
<tr><td>Ник ↔ UUID, скины игроков</td><td>Mojang API, textures.minecraft.net</td><td>Публичные сервисы Mojang.</td></tr>
<tr><td>История цен</td><td><a href="https://sky.coflnet.com" rel="noopener">SkyCofl (Coflnet)</a></td><td>Цены предоставлены SkyCofl <span class="muted">(Prices provided by SkyCofl)</span>.</td></tr>
<tr><td>Биржевые графики на «Рынке»</td><td><a href="https://www.tradingview.com/" rel="noopener">TradingView Lightweight Charts™</a></td><td>Лицензия Apache 2.0. Уведомление об авторстве (оригинал): <span class="muted">TradingView Lightweight Charts™. Copyright (с) 2025 TradingView, Inc. https://www.tradingview.com/</span>. Ссылка на TradingView стоит под каждым графиком.</td></tr>
<tr><td>Справочник предметов, рецепты</td><td><a href="https://github.com/NotEnoughUpdates/NotEnoughUpdates-REPO" rel="noopener">NotEnoughUpdates-REPO</a></td><td>Лицензия MIT: можно свободно использовать с сохранением уведомления об авторских правах; предоставляется «как есть», без гарантий. Текст лицензии (оригинал): <span class="muted">MIT License, Copyright (c) 2020 Moulberry. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files, to deal in the Software without restriction, subject to the following conditions: the above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.</span></td></tr>
<tr><td>Ссылки «подробнее на вики»</td><td><a href="https://hypixelskyblock.minecraft.wiki" rel="noopener">Hypixel SkyBlock Wiki</a></td><td>Сайт ставит ссылки на вики и пересказывает игровые факты своими словами; тексты и картинки вики не копируются.</td></tr>
<tr><td>Иконки предметов</td><td>Текстуры и модели Minecraft; головы предметов — скины с textures.minecraft.net</td><td>${publicPackNames(env).length ? 'Часть иконок — из ресурс-паков <a href="https://modrinth.com/resourcepack/hypixel-plus" rel="noopener">Hypixel Plus</a> (ic22487, CC BY-NC-ND 4.0) и <a href="https://modrinth.com/resourcepack/furfsky-reborn" rel="noopener">FurfSky Reborn</a> (The Reborn Team); все права на них у авторов.' : 'Ресурс-паки сторонних авторов посетителям не показываются без разрешения их авторов.'}</td></tr>
<tr><td>Шрифты</td><td>Inter, Rubik, Pixelify Sans</td><td>SIL Open Font License 1.1, файлы шрифтов хранятся на сервере сайта.</td></tr>
${s.ai ? '<tr><td>Ответы ИИ-советчика (только для вошедших)</td><td>Модели Claude (Anthropic)</td><td>Ответы ИИ могут быть неточными.</td></tr>' : ''}
</table>
<p class="muted">Цены, советы и расчёты заработка — ориентир, а не гарантия: данные обновляются с задержкой, а игровая экономика меняется.</p>
${s.ads ? '<h2>Реклама</h2><p>На сайте показывается реклама Рекламной сети Яндекса (только после согласия на cookie). Маркировку объявлений и передачу сведений в ЕРИР выполняет Яндекс; объявления подписаны «Реклама» и содержат сведения о рекламодателе. Владелец сайта не отвечает за содержание чужих объявлений.</p>' : ''}
${s.donate ? `<h2>Поддержка сайта</h2><p>Пожертвования через ${esc(s.donate)} добровольные и ничего не дают взамен: никаких игровых преимуществ, закрытых функций или привилегий на сайте.</p>` : ''}
`, opts);
}

export function privacyPage(env = process.env, opts = {}) {
  if (opts.lang === 'en') return enPage(env, '/privacy', privacyEn, opts);
  const op = operatorInfo(env), s = servicesInUse(env);
  const third = [
    s.metrika && ['ООО «ЯНДЕКС» (Россия), Яндекс Метрика', 'cookie, IP-адрес, сведения о браузере и устройстве, просмотренные страницы', 'статистика посещаемости', 'только после согласия в баннере cookie; Вебвизор выключен'],
    s.ads && ['ООО «ЯНДЕКС» (Россия), Рекламная сеть Яндекса', 'cookie, IP-адрес, сведения о браузере и устройстве', 'показ рекламы', 'только после согласия в баннере cookie'],
    s.ai && ['Anthropic PBC (США), ИИ-советчик', 'текст вопроса и сводка игрового профиля (ник, прогресс в игре)', 'ответ на вопрос в чате советчика', 'только для вошедших пользователей, которые сами пишут советчику; трансграничная передача'],
    s.mail && ['Google LLC (США), почта Gmail владельца сайта', 'то, что посетитель сам отправил кнопкой «Сообщить об ошибке», и сведения о странице и браузере', 'доставка отзыва владельцу сайта на почту', 'только если посетитель сам отправил отзыв; трансграничная передача'],
    s.cloudflare && ['Cloudflare, Inc. (США), доставка трафика', 'IP-адрес, технические заголовки запроса', 'доставка страниц сайта до посетителя', 'трансграничная передача; используется, пока сайт работает через туннель Cloudflare'],
    ['Hypixel Inc., Mojang AB (за рубежом)', 'только ник игрока, который ввёл посетитель (не данные посетителя)', 'получение публичного игрового профиля', 'запрос делает сервер сайта, IP посетителя не передаётся'],
    ['mc-heads.net, textures.minecraft.net, SkyCofl', 'ник или UUID игрока (не данные посетителя)', 'аватарки, скины, история цен', 'запрос делает сервер сайта, IP посетителя не передаётся'],
  ].filter(Boolean);
  return page(env, '/privacy', 'Политика обработки персональных данных', `
<p>Политика составлена по Федеральному закону от 27.07.2006 № 152-ФЗ «О персональных данных», а для посетителей из ЕС, ЕЭЗ и Великобритании — также по Общему регламенту ЕС о защите данных (GDPR). Она описывает, какие данные обрабатывает ${site(s)} (далее — сайт), зачем и как их защищает.</p>

<h2>1. Оператор</h2>
<p>Оператор персональных данных — ${who(op)}. По любым вопросам о данных пишите на ${mail(op)}.</p>

<h2>2. Какие данные и зачем</h2>
<table>
<tr><th>Кто</th><th>Данные</th><th>Цель</th><th>Основание</th><th>Срок</th></tr>
<tr><td>Любой посетитель</td><td>IP-адрес — только в оперативной памяти сервера, в файлы и журналы он не записывается; ники, которые посетитель ввёл для просмотра</td><td>работа сайта, защита от перебора и злоупотреблений (не более 30 разных ников за 10 минут с одного IP)</td><td>законный интерес оператора (п. 7 ч. 1 ст. 6 152-ФЗ)</td><td>в памяти сервера — до суток (обычно до 10 минут), после перезапуска сервера не сохраняется</td></tr>
<tr><td>Любой посетитель</td><td>обезличенная статистика: открытый раздел сайта, домен, с которого пришли, телефон или компьютер, время загрузки страницы, тексты ошибок программы; сколько разных ников открыли за день (только число, сами ники не сохраняются). IP-адрес в статистику не записывается: посетитель за день считается по хешу от IP и браузера с солью, которая меняется каждые сутки, поэтому связать посещения разных дней нельзя</td><td>понять, какими разделами пользуются, находить и исправлять ошибки, следить за скоростью сайта</td><td>законный интерес оператора (п. 7 ч. 1 ст. 6 152-ФЗ)</td><td>счётчики за день — 90 дней; ошибки — до 30 дней; хеши посетителей — только текущие сутки. Если в браузере включено «Не отслеживать», просмотры не учитываются</td></tr>
<tr><td>Посетитель, отправивший отзыв кнопкой «Сообщить об ошибке»</td><td>текст отзыва, тип, адрес страницы, ник из поля поиска, ник аккаунта (если вошёл), версия сайта, размер окна и тип браузера, по желанию — скриншот и контакт для связи. IP-адрес с отзывом не сохраняется</td><td>исправление ошибок и улучшение сайта, ответ на обращение</td><td>согласие — отзыв отправляется только по действию посетителя (п. 1 ч. 1 ст. 6 152-ФЗ)</td><td>до разбора отзыва, не дольше 1 года; удаление — по письму оператору</td></tr>
<tr><td>Пользователь с аккаунтом (аккаунт создаёт только владелец сайта по приглашению)</td><td>ник Minecraft, название профиля SkyBlock, пароль в виде необратимого хеша (scrypt), даты создания, входа и смены пароля, дата согласия, история чата с ИИ-советчиком, личный лимит советчика</td><td>вход на сайт, показ своего профиля, работа советчика</td><td>согласие (п. 1 ч. 1 ст. 6 152-ФЗ)</td><td>пока существует аккаунт; после удаления аккаунта или отзыва согласия — удаление в течение 30 дней</td></tr>
${s.metrika || s.ads ? '<tr><td>Посетитель, нажавший «Принять» в баннере cookie</td><td>cookie и IP-адрес, которые получает Яндекс</td><td>' + [s.metrika && 'статистика', s.ads && 'реклама'].filter(Boolean).join(', ') + '</td><td>согласие</td><td>по правилам Яндекса; согласие можно отозвать в любой момент</td></tr>' : ''}
</table>
<p>Сайт не просит и не хранит пароли от Minecraft, Microsoft или Hypixel, настоящие имена, телефоны, адреса и платёжные данные. Не вводите такие сведения в поля сайта и в чат советчика.</p>

<h2>3. Игровые профили других игроков</h2>
<p>Сайт показывает игровую статистику по нику — те данные, которые Hypixel отдаёт любому желающему через публичный API. Ник Minecraft — игровой псевдоним; сайт не пытается связать его с реальным человеком и не раскрывает скрытые ники (/nick). Если вы не хотите, чтобы ваш профиль открывался на сайте посторонним, напишите на ${mail(op)} — ник будет добавлен в список скрытых.</p>

<h2 id="cookie">4. Cookie и хранилище браузера</h2>
<table>
<tr><th>Название</th><th>Зачем</th><th>Срок</th></tr>
<tr><td><code>sb_auth</code></td><td>вход в аккаунт (подписанный токен, недоступен скриптам)</td><td>до 30 дней или до выхода</td></tr>
<tr><td><code>sb_me</code></td><td>интерфейс знает, гость вы или вошли, и под каким ником</td><td>до 30 дней</td></tr>
<tr><td><code>sb-lang</code></td><td>запоминает выбранный язык сайта</td><td>до 1 года</td></tr>
<tr><td>localStorage (<code>sb-*</code>)</td><td>настройки интерфейса, последние открытые ники, выбор в баннере cookie — хранятся только в вашем браузере</td><td>пока не очистите браузер</td></tr>
${s.metrika ? '<tr><td>cookie Яндекс Метрики (<code>_ym_*</code>, <code>yandexuid</code> и др.)</td><td>статистика посещений</td><td>по правилам Яндекса; ставятся только после «Принять»</td></tr>' : ''}
${s.ads ? '<tr><td>cookie Рекламной сети Яндекса</td><td>показ рекламы</td><td>по правилам Яндекса; ставятся только после «Принять»</td></tr>' : ''}
</table>
${s.metrika || s.ads ? '<p>Необходимые cookie (<code>sb_auth</code>, <code>sb_me</code>) нужны для работы сайта. Сервисы Яндекса подключаются, только если вы нажали «Принять» в баннере. Выбор можно поменять ссылкой «Cookie» внизу сайта; при отказе страница перезагрузится без сервисов Яндекса. Отключить cookie можно и в настройках браузера.</p>' : '<p>Сейчас сайт ставит только необходимые cookie из таблицы — сторонних счётчиков и рекламы нет.</p>'}
<p>Собственная статистика сайта (раздел 2) cookie и хранилище браузера не использует и данные никуда не передаёт — она хранится на сервере сайта.</p>

<h2>5. Кому передаются данные</h2>
<table><tr><th>Получатель</th><th>Что</th><th>Зачем</th><th>Условия</th></tr>
${third.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}
</table>
<p>Данные не продаются и не передаются для рассылок. Базы данных сайта (аккаунты, журналы) хранятся на сервере во Франции (ЕС).</p>

<h2>6. Защита</h2>
<p>Пароли хранятся только в виде хеша scrypt с солью; cookie входа подписаны и недоступны скриптам страницы; число попыток входа ограничено; формы защищены от отправки с чужих сайтов; доступ к данным аккаунтов есть только у владельца сайта.</p>

<h2>7. Ваши права</h2>
<p>Вы можете узнать, какие ваши данные обрабатываются, потребовать их уточнения или удаления, отозвать согласие (ст. 14, 9 152-ФЗ). Напишите на ${mail(op)} с ника или почты, по которым можно понять, о каком аккаунте речь. Ответ — в течение 10 рабочих дней. Вы также вправе обратиться в Роскомнадзор или в суд. У посетителей из ЕС, ЕЭЗ и Великобритании есть дополнительные права — см. раздел 9.</p>
<p>Если вам нет 14 лет, аккаунт на сайте можно завести только с согласия родителя или законного представителя.</p>

<h2>8. Изменения</h2>
<p>Политика может обновляться; новая редакция действует с момента публикации на этой странице. Дата редакции указана вверху.</p>

<h2 id="gdpr">9. Посетителям из ЕС, ЕЭЗ и Великобритании (GDPR)</h2>
${gdprRows('ru', op, s).map(([h, t]) => `<h3>${h}</h3><p>${t}</p>`).join('\n')}
`, opts);
}

export function consentPage(env = process.env, opts = {}) {
  if (opts.lang === 'en') return enPage(env, '/consent', consentEn, opts);
  const op = operatorInfo(env), s = servicesInUse(env);
  return page(env, '/consent', 'Согласие на обработку персональных данных', `
<p>Это согласие оформлено отдельным документом, как требует ст. 9 Федерального закона № 152-ФЗ «О персональных данных».</p>
<div class="box">
<p>Я, действуя свободно, своей волей и в своём интересе, даю ${whoTo(op)} (далее — оператор) согласие на обработку моих персональных данных на условиях ниже.</p>
<h3>Для пользователей с аккаунтом</h3>
<p><b>Данные:</b> ник Minecraft, название профиля SkyBlock, хеш пароля, даты создания аккаунта, входа и смены пароля, история моих сообщений ИИ-советчику.<br>
<b>Цель:</b> вход на ${site(s)}, показ моего игрового профиля и прогресса, работа советчика.<br>
<b>Действия:</b> сбор, запись, хранение, уточнение, использование, удаление, уничтожение — с использованием средств автоматизации.${s.ai ? `<br><b>Передача:</b> текст моих вопросов советчику и сводка моего игрового профиля передаются Anthropic PBC (США) для подготовки ответа (трансграничная передача).` : ''}<br>
<b>Срок:</b> пока существует аккаунт или до отзыва согласия.</p>
${s.metrika || s.ads ? `<h3>Для посетителей, нажавших «Принять» в баннере cookie</h3>
<p><b>Данные:</b> cookie, IP-адрес, сведения о браузере и устройстве, просмотренные страницы.<br>
<b>Цель:</b> ${[s.metrika && 'статистика посещаемости (Яндекс Метрика)', s.ads && 'показ рекламы (Рекламная сеть Яндекса)'].filter(Boolean).join(', ')}.<br>
<b>Передача:</b> ООО «ЯНДЕКС» (Россия).<br>
<b>Срок:</b> до отзыва согласия.</p>` : ''}
<p>Согласие можно отозвать в любой момент: письмом на ${mail(op)}, удалением аккаунта или (для cookie) ссылкой «Cookie» внизу сайта. Отзыв не влияет на законность обработки до него.</p>
</div>
<p>Подробно о данных — в <a href="/privacy">политике обработки персональных данных</a>.</p>
`, opts);
}

export function termsPage(env = process.env, opts = {}) {
  if (opts.lang === 'en') return enPage(env, '/terms', termsEn, opts);
  const op = operatorInfo(env), s = servicesInUse(env);
  return page(env, '/terms', 'Пользовательское соглашение', `
<p>Пользуясь ${s.siteUrl ? `сайтом ${esc(s.siteUrl)}` : 'этим сайтом'}, вы соглашаетесь с этими условиями. Если не согласны — не пользуйтесь сайтом.</p>
<h2>1. Что это за сайт</h2>
<p>Бесплатный неофициальный фанатский справочник и трекер прогресса в Hypixel SkyBlock. Сайт не связан с Hypixel Inc., Mojang AB и Microsoft и не одобрен ими.${op.name ? ` Владелец сайта — ${who(op)}.` : ''}</p>
<h2>2. Без гарантий</h2>
<p>Сайт предоставляется «как есть». Цены, прогнозы заработка, советы (включая советы ИИ) и переводы — справочные и могут быть неточными или устаревшими. Решения в игре, в том числе покупки и продажи за игровые монеты, вы принимаете сами. Владелец не отвечает за потери в игре и за перерывы в работе сайта.</p>
<h2>3. Правила</h2>
<ul>
<li>Не используйте сайт для массового автоматического сбора данных, перебора ников, обхода ограничений и атак.</li>
<li>Не вводите на сайте пароли от Minecraft, Microsoft или Hypixel — они здесь никогда не нужны.</li>
<li>Не используйте сайт для слежки за конкретными игроками или раскрытия скрытых ников.</li>
<li>Аккаунт выдаёт владелец сайта; не передавайте свой пароль другим. Владелец может удалить аккаунт при нарушении правил.</li>
</ul>
<h2>4. Права на материалы</h2>
<p>Игровые названия, тексты и изображения принадлежат Mojang, Microsoft и Hypixel. Данные из сторонних источников используются по их условиям (см. <a href="/legal">правовую информацию</a>). Код сайта, переводы и собственные тексты гайдов принадлежат владельцу сайта.</p>
${s.ads || s.donate ? `<h2>5. Реклама и поддержка</h2><p>${s.ads ? 'Сайт показывает рекламу Рекламной сети Яндекса; за содержание объявлений отвечают рекламодатели и Яндекс. ' : ''}${s.donate ? 'Пожертвования добровольны, не возвращаются и не дают никаких преимуществ — ни в игре, ни на сайте.' : ''}</p>` : ''}
<h2>${s.ads || s.donate ? 6 : 5}. Прочее</h2>
<p>К соглашению применяется право Российской Федерации. Это не лишает вас защиты обязательных норм права страны, где вы живёте (например, законов о защите прав потребителей и данных в ЕС и Великобритании). Условия могут меняться; новая редакция действует с момента публикации здесь. Вопросы и жалобы присылайте на ${mail(op)}.</p>
`, opts);
}

export function apiTermsPage(env = process.env, opts = {}) {
  if (opts.lang === 'en') return enPage(env, '/api-terms', apiTermsEn, opts);
  const op = operatorInfo(env);
  return page(env, '/api-terms', 'API и правила', `
<p>У Sky Guide есть открытый API <code>/v1</code>, описание — на <a href="/api/docs/">/api/docs</a>. Пользуясь им, вы соглашаетесь с этими условиями и с <a href="/terms">пользовательским соглашением</a> сайта.</p>
<h2>1. Что открыто</h2>
<p>Предметы, поиск, цены Bazaar и аукциона, тренды, флипы, календарь, лидерборды, гайды и новости открыты без ключа — до 120 запросов в минуту с одного адреса. Ключ от владельца сайта даёт только свой лимит запросов.</p>
<h2>2. Данные игроков</h2>
<p>Профили игроков и их разбор (<code>/v1/players/…</code>, <code>/v1/compare</code>) доступны только собственным клиентам Sky Guide — боту и моду самого сайта. Сторонним разработчикам ключи с доступом к данным игроков не выдаются: <a href="https://developer.hypixel.net/policies" rel="noopener">правила API Hypixel</a> запрещают передавать данные их API другим.</p>
<h2>3. Условия</h2>
<ul>
<li><b>Подпись.</b> Рядом с данными из API — видимая подпись «Данные: Sky Guide» со ссылкой на <a href="https://sky-guide.ru">https://sky-guide.ru</a>: в сообщении бота, в окне мода, на странице.</li>
<li><b>Без перепродажи.</b> Нельзя продавать данные API и доступ к нему, в том числе через ключи, прокси и зеркала.</li>
<li><b>Платные функции</b> на основе API — только с письменного разрешения владельца сайта.</li>
<li>Нельзя обходить лимиты, скачивать данные целиком и выдавать данные Sky Guide за свои.</li>
<li>Ключ личный: не передавайте его другим.</li>
</ul>
<h2>4. Нарушения</h2>
<p>За нарушение условий ключ отзывается, запросы с адреса могут быть ограничены. Владелец может отказать в доступе без объяснения причин.</p>
<h2>5. Без гарантий</h2>
<p>API предоставляется «как есть», без гарантий работы и точности. В <code>/v1</code> только добавляется новое, ломающие изменения — в <code>/v2</code>. Вопросы и запросы разрешений — на ${mail(op)}.</p>
`, opts);
}

const PAGES = { '/legal': legalPage, '/privacy': privacyPage, '/consent': consentPage, '/terms': termsPage, '/api-terms': apiTermsPage };
export const LEGAL_PATHS = Object.keys(PAGES);

export function mountLegalRoutes(app, { env = process.env, isOwner = null } = {}) {
  for (const [p, fn] of Object.entries(PAGES)) {
    // Подсказку «что заполнить в .env» видит только владелец сайта. Язык — только по адресу: /privacy — русский
    // текст (словарь его не трогает), /en/privacy — английский текст из legal-en.js
    for (const lang of ['ru', 'en']) {
      app.get(lang === 'en' ? `/en${p}` : p, (req, res) => {
        req.sbLang = 'ru'; // текст уже на нужном языке: словарь его не переводит
        res.set('Cache-Control', 'no-cache').type('html').send(fn(env, { owner: !!isOwner?.(req), lang }));
      });
    }
  }
}
