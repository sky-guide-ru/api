// Правовые страницы на английском (/en/legal, /en/privacy, /en/consent, /en/terms) — отдельный текст, а не перевод
// словарём: юридические формулировки пишутся целиком. По смыслу совпадают с русскими страницами (server/legal.js);
// при расхождении действует русский текст. Раздел про GDPR есть в обеих версиях.
import { publicPackNames } from '@sky-guide/core/packs.js';
import { esc, operatorInfo, servicesInUse, gdprRows, LEGAL_VERSION_EN } from './legal.js';

const who = op => (op.name ? `${esc(op.name)}${op.inn ? ` (Russian taxpayer ID ${esc(op.inn)})` : ''}` : 'the site owner');
const mail = op => (op.email ? `<a href="mailto:${esc(op.email)}">${esc(op.email)}</a>` : "the site owner's email");
const site = s => (s.siteUrl ? `the website ${esc(s.siteUrl)}` : 'this website');

export const EN_TITLES = { '/legal': 'Legal information', '/privacy': 'Privacy policy', '/consent': 'Consent to data processing', '/terms': 'Terms of use' };
export const EN_NOTE = `<div class="box">This English version is provided for visitors outside Russia. The site owner lives in Russia, so these documents follow Russian law (Federal Law No. 152-FZ "On Personal Data"); visitors in the EU, EEA and UK also have the rights under the GDPR described in <a href="/en/privacy#gdpr">section 9 of the privacy policy</a>. If the English and Russian versions differ, the Russian version prevails, except where the GDPR gives you more protection.</div>`;

export function legalEn(env) {
  const op = operatorInfo(env), s = servicesInUse(env);
  return `
<h2>Unofficial website</h2>
<p>SkyBlock tracker is an unofficial fan website about the SkyBlock game mode on the Hypixel server. It is <b>not affiliated with</b>, <b>endorsed by</b> or <b>supported by</b> Hypixel Inc., Mojang AB or Microsoft Corporation.</p>
<p><b>NOT AN OFFICIAL MINECRAFT SERVICE. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.</b> This website is not affiliated with or endorsed by Hypixel Inc.</p>
<p>Minecraft is a trademark of Mojang Synergies AB. Hypixel and Hypixel SkyBlock are trademarks of Hypixel Inc. Item names, texts and images from the game belong to their owners and are used only to show players their own data and reference information about the game.</p>

<h2>Site owner and contact</h2>
<p>The site is run by ${op.name ? who(op) : 'a private individual'}.${op.email ? ` Email: ${mail(op)}.` : ''}</p>
<p>Rights holders: if you believe material on the site infringes your rights, write to ${mail(op)} and say which material and on what grounds. Disputed material is removed within 3 business days of receiving a substantiated complaint.</p>

<h2>Data sources</h2>
<table>
<tr><th>What</th><th>Source</th><th>Terms</th></tr>
<tr><td>Player profiles, Bazaar and auction prices</td><td><a href="https://api.hypixel.net" rel="noopener">Hypixel Public API</a></td><td>Under the Hypixel <a href="https://developer.hypixel.net/policies" rel="noopener">API Policy</a>. Only data that Hypixel makes public is shown.</td></tr>
<tr><td>Name ↔ UUID, player skins</td><td>Mojang API, textures.minecraft.net</td><td>Public Mojang services.</td></tr>
<tr><td>Price history</td><td><a href="https://sky.coflnet.com" rel="noopener">SkyCofl (Coflnet)</a></td><td>Prices provided by SkyCofl.</td></tr>
<tr><td>Market charts</td><td><a href="https://www.tradingview.com/" rel="noopener">TradingView Lightweight Charts™</a></td><td>Apache 2.0 license. TradingView Lightweight Charts™. Copyright (c) 2025 TradingView, Inc. https://www.tradingview.com/. A link to TradingView is shown under every chart.</td></tr>
<tr><td>Item database, recipes</td><td><a href="https://github.com/NotEnoughUpdates/NotEnoughUpdates-REPO" rel="noopener">NotEnoughUpdates-REPO</a></td><td>MIT License, Copyright (c) 2020 Moulberry. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files, to deal in the Software without restriction, subject to the following conditions: the above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.</td></tr>
<tr><td>"More on the wiki" links</td><td><a href="https://hypixelskyblock.minecraft.wiki" rel="noopener">Hypixel SkyBlock Wiki</a></td><td>The site links to the wiki and retells game facts in its own words; wiki texts and images are not copied.</td></tr>
<tr><td>Item icons</td><td>Minecraft textures and models; item heads are skins from textures.minecraft.net</td><td>${publicPackNames(env).length ? 'Some icons come from the resource packs <a href="https://modrinth.com/resourcepack/hypixel-plus" rel="noopener">Hypixel Plus</a> (ic22487, CC BY-NC-ND 4.0) and <a href="https://modrinth.com/resourcepack/furfsky-reborn" rel="noopener">FurfSky Reborn</a> (The Reborn Team); all rights belong to their authors.' : 'Third-party resource packs are not shown to visitors without their authors\' permission.'}</td></tr>
<tr><td>Fonts</td><td>Inter, Rubik, Pixelify Sans</td><td>SIL Open Font License 1.1; font files are hosted on the site's server.</td></tr>
${s.ai ? '<tr><td>AI assistant answers (signed-in users only)</td><td>Claude models (Anthropic)</td><td>AI answers may be inaccurate.</td></tr>' : ''}
</table>
<p class="muted">Prices, advice and income estimates are guidance, not a guarantee: data updates with a delay and the in-game economy changes.</p>
${s.ads ? '<h2>Advertising</h2><p>The site shows ads from the Yandex Advertising Network (only after you accept cookies). Ads are labeled as advertising and include information about the advertiser. The site owner is not responsible for the content of third-party ads.</p>' : ''}
${s.donate ? `<h2>Supporting the site</h2><p>Donations via ${esc(s.donate)} are voluntary and give nothing in return: no in-game advantages, locked features or privileges on the site.</p>` : ''}
`;
}

export function privacyEn(env) {
  const op = operatorInfo(env), s = servicesInUse(env);
  const third = [
    s.metrika && ['YANDEX LLC (Russia), Yandex Metrica', 'cookies, IP address, browser and device information, pages viewed', 'visit statistics', 'only after consent in the cookie banner; Session Replay is off'],
    s.ads && ['YANDEX LLC (Russia), Yandex Advertising Network', 'cookies, IP address, browser and device information', 'showing ads', 'only after consent in the cookie banner'],
    s.ai && ['Anthropic PBC (USA), AI assistant', 'the question text and a summary of the game profile (name, game progress)', 'answering the question in the assistant chat', 'only for signed-in users who write to the assistant themselves; cross-border transfer'],
    s.mail && ['Google LLC (USA), the site owner\'s Gmail', 'what the visitor sent with the "Report a problem" button, plus page and browser information', 'delivering the feedback to the site owner', 'only if the visitor sends feedback; cross-border transfer'],
    s.cloudflare && ['Cloudflare, Inc. (USA), traffic delivery', 'IP address, technical request headers', 'delivering site pages to the visitor', 'cross-border transfer; used while the site runs through a Cloudflare tunnel'],
    ['Hypixel Inc., Mojang AB (outside Russia)', 'only the player name the visitor entered (not the visitor\'s data)', 'getting the public game profile', 'the request is made by the site\'s server; the visitor\'s IP is not passed on'],
    ['mc-heads.net, textures.minecraft.net, SkyCofl', 'player name or UUID (not the visitor\'s data)', 'avatars, skins, price history', 'the request is made by the site\'s server; the visitor\'s IP is not passed on'],
  ].filter(Boolean);
  return `
<p>This policy follows Russian Federal Law No. 152-FZ of 27.07.2006 "On Personal Data" and, for visitors in the EU, EEA and UK, the General Data Protection Regulation (GDPR). It describes what data ${site(s)} (the "site") processes, why, and how it is protected.</p>

<h2>1. Controller</h2>
<p>The controller (operator) of personal data is ${who(op)}. For any question about your data, write to ${mail(op)}.</p>

<h2>2. What data and why</h2>
<table>
<tr><th>Who</th><th>Data</th><th>Purpose</th><th>Legal basis</th><th>Retention</th></tr>
<tr><td>Any visitor</td><td>IP address: only in the server's memory, never written to files or logs; player names the visitor entered</td><td>running the site, protection against brute force and abuse (no more than 30 different names per 10 minutes from one IP)</td><td>the operator's legitimate interest (152-FZ art. 6(1)(7); GDPR art. 6(1)(f))</td><td>in server memory up to a day (usually up to 10 minutes); not kept after a server restart</td></tr>
<tr><td>Any visitor</td><td>anonymous statistics: section opened, referring domain, phone or computer, page load time, program error texts; how many different player names were opened per day (a number only; the names themselves are not stored). The IP address is not stored in statistics: a daily visitor is counted by a hash of the IP and browser with a salt that changes every day, so visits on different days cannot be linked</td><td>understanding which sections are used, finding and fixing errors, monitoring site speed</td><td>the operator's legitimate interest (152-FZ art. 6(1)(7); GDPR art. 6(1)(f))</td><td>daily counters 90 days; errors up to 30 days; visitor hashes only for the current day. With "Do Not Track" enabled, views are not counted</td></tr>
<tr><td>Visitor who sent feedback with "Report a problem"</td><td>feedback text, type, page address, name from the search box, account name (if signed in), site version, window size and browser type, optionally a screenshot and contact details. The IP address is not stored with feedback</td><td>fixing errors and improving the site, replying</td><td>consent: feedback is sent only by the visitor's own action (152-FZ art. 6(1)(1); GDPR art. 6(1)(a))</td><td>until the feedback is handled, no longer than 1 year; deletion on request</td></tr>
<tr><td>User with an account (accounts are created only by the site owner by invitation)</td><td>Minecraft name, SkyBlock profile name, password as an irreversible hash (scrypt), dates of creation, sign-in and password change, date of consent, AI assistant chat history, personal assistant limit</td><td>signing in, showing your profile, running the assistant</td><td>consent (152-FZ art. 6(1)(1)); for the GDPR, performance of the service you asked for (art. 6(1)(b))</td><td>while the account exists; deleted within 30 days after the account is deleted or consent is withdrawn</td></tr>
${s.metrika || s.ads ? '<tr><td>Visitor who clicked "Accept" in the cookie banner</td><td>cookies and IP address received by Yandex</td><td>' + [s.metrika && 'statistics', s.ads && 'advertising'].filter(Boolean).join(', ') + '</td><td>consent (GDPR art. 6(1)(a))</td><td>under Yandex rules; consent can be withdrawn at any time</td></tr>' : ''}
</table>
<p>The site never asks for or stores Minecraft, Microsoft or Hypixel passwords, real names, phone numbers, addresses or payment details. Do not enter such information on the site or in the assistant chat.</p>

<h2>3. Other players' game profiles</h2>
<p>The site shows game statistics by player name: data that Hypixel gives to anyone through its public API. A Minecraft name is a game nickname; the site does not try to link it to a real person and does not reveal hidden nicknames (/nick). If you don't want your profile to be viewable by others on the site, write to ${mail(op)} and the name will be added to the hidden list. Under the GDPR this processing relies on legitimate interest (art. 6(1)(f)), and you can object to it the same way.</p>

<h2 id="cookie">4. Cookies and browser storage</h2>
<table>
<tr><th>Name</th><th>Purpose</th><th>Lifetime</th></tr>
<tr><td><code>sb_auth</code></td><td>signing in (signed token, not accessible to scripts)</td><td>up to 30 days or until sign-out</td></tr>
<tr><td><code>sb_me</code></td><td>lets the interface know whether you are a guest or signed in, and under which name</td><td>up to 30 days</td></tr>
<tr><td><code>sb-lang</code></td><td>remembers the site language you chose</td><td>up to 1 year</td></tr>
<tr><td>localStorage (<code>sb-*</code>)</td><td>interface settings, recently opened names, your cookie banner choice; stored only in your browser</td><td>until you clear your browser</td></tr>
${s.metrika ? '<tr><td>Yandex Metrica cookies (<code>_ym_*</code>, <code>yandexuid</code> etc.)</td><td>visit statistics</td><td>under Yandex rules; set only after "Accept"</td></tr>' : ''}
${s.ads ? '<tr><td>Yandex Advertising Network cookies</td><td>showing ads</td><td>under Yandex rules; set only after "Accept"</td></tr>' : ''}
</table>
${s.metrika || s.ads ? '<p>The necessary cookies are needed for the site to work. Yandex services are loaded only if you click "Accept" in the banner. You can change your choice with the "Cookie" link at the bottom of the site; if you decline, the page reloads without Yandex services. You can also disable cookies in your browser settings.</p>' : '<p>Right now the site sets only the necessary cookies from the table; there are no third-party counters or ads.</p>'}
<p>The site's own statistics (section 2) use no cookies or browser storage and are not passed to anyone: they are kept on the site's server.</p>

<h2>5. Who receives data</h2>
<table><tr><th>Recipient</th><th>What</th><th>Why</th><th>Conditions</th></tr>
${third.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}
</table>
<p>Data is not sold or used for mailings. The site's databases (accounts, logs) are stored on a server in France (EU).</p>

<h2>6. Security</h2>
<p>Passwords are stored only as salted scrypt hashes; sign-in cookies are signed and not accessible to page scripts; sign-in attempts are limited; forms are protected against submission from other sites; only the site owner has access to account data.</p>

<h2>7. Your rights</h2>
<p>You can find out what data about you is processed, ask for it to be corrected or deleted, and withdraw your consent (152-FZ art. 9, 14). Write to ${mail(op)} from the name or email that identifies the account. You will get a reply within 10 business days. You may also contact Roskomnadzor (the Russian data protection authority) or a court. Visitors in the EU, EEA and UK have additional rights, see section 9.</p>
<p>If you are under 16 (or the lower age set in your country), an account can be created only with the consent of a parent or legal guardian.</p>

<h2>8. Changes</h2>
<p>The policy may be updated; a new version takes effect when published on this page. The version date is shown at the top.</p>

<h2 id="gdpr">9. Visitors in the EU, EEA and UK (GDPR)</h2>
${gdprRows('en', op, s).map(([h, t]) => `<h3>${h}</h3><p>${t}</p>`).join('\n')}
`;
}

export function consentEn(env) {
  const op = operatorInfo(env), s = servicesInUse(env);
  return `
<p>This consent is a separate document, as required by art. 9 of Russian Federal Law No. 152-FZ "On Personal Data". For visitors in the EU, EEA and UK it is also consent under art. 6(1)(a) and 7 of the GDPR.</p>
<div class="box">
<p>Acting freely, of my own will and in my own interest, I give ${op.name ? who(op) : 'the site owner'} (the "operator") consent to process my personal data on the terms below.</p>
<h3>For users with an account</h3>
<p><b>Data:</b> Minecraft name, SkyBlock profile name, password hash, dates of account creation, sign-in and password change, history of my messages to the AI assistant.<br>
<b>Purpose:</b> signing in to ${site(s)}, showing my game profile and progress, running the assistant.<br>
<b>Actions:</b> collection, recording, storage, correction, use, deletion and destruction, by automated means.${s.ai ? '<br><b>Transfer:</b> the text of my questions to the assistant and a summary of my game profile are sent to Anthropic PBC (USA) to prepare an answer (cross-border transfer).' : ''}<br>
<b>Duration:</b> while the account exists or until consent is withdrawn.</p>
${s.metrika || s.ads ? `<h3>For visitors who clicked "Accept" in the cookie banner</h3>
<p><b>Data:</b> cookies, IP address, browser and device information, pages viewed.<br>
<b>Purpose:</b> ${[s.metrika && 'visit statistics (Yandex Metrica)', s.ads && 'showing ads (Yandex Advertising Network)'].filter(Boolean).join(', ')}.<br>
<b>Transfer:</b> YANDEX LLC (Russia). Russia has no EU adequacy decision, so my data may have less protection there; I agree to this transfer explicitly (GDPR art. 49(1)(a)).<br>
<b>Duration:</b> until consent is withdrawn.</p>` : ''}
<p>Consent can be withdrawn at any time: by writing to ${mail(op)}, by deleting the account, or (for cookies) with the "Cookie" link at the bottom of the site. Withdrawal does not affect the lawfulness of processing before it.</p>
</div>
<p>Details about the data are in the <a href="/en/privacy">privacy policy</a>.</p>
`;
}

export function termsEn(env) {
  const op = operatorInfo(env), s = servicesInUse(env);
  return `
<p>By using ${s.siteUrl ? `the website ${esc(s.siteUrl)}` : 'this website'}, you agree to these terms. If you don't agree, don't use the site.</p>
<h2>1. What this site is</h2>
<p>A free, unofficial fan guide and progress tracker for Hypixel SkyBlock. The site is not affiliated with or endorsed by Hypixel Inc., Mojang AB or Microsoft.${op.name ? ` The site owner is ${who(op)}.` : ''}</p>
<h2>2. No warranty</h2>
<p>The site is provided "as is". Prices, income estimates, advice (including AI advice) and translations are for reference and may be inaccurate or out of date. You make your own decisions in the game, including buying and selling for in-game coins. The owner is not responsible for in-game losses or for interruptions in the site's operation, to the extent permitted by law.</p>
<h2>3. Rules</h2>
<ul>
<li>Don't use the site for mass automated data collection, name enumeration, bypassing limits or attacks.</li>
<li>Don't enter Minecraft, Microsoft or Hypixel passwords on the site: they are never needed here.</li>
<li>Don't use the site to track specific players or reveal hidden nicknames.</li>
<li>Accounts are issued by the site owner; don't share your password. The owner may delete an account that breaks the rules.</li>
</ul>
<h2>4. Rights to materials</h2>
<p>Game names, texts and images belong to Mojang, Microsoft and Hypixel. Data from third-party sources is used under their terms (see <a href="/en/legal">legal information</a>). The site's code, translations and its own guide texts belong to the site owner.</p>
${s.ads || s.donate ? `<h2>5. Ads and support</h2><p>${s.ads ? 'The site shows ads from the Yandex Advertising Network; advertisers and Yandex are responsible for ad content. ' : ''}${s.donate ? 'Donations are voluntary, non-refundable and give no advantages, either in the game or on the site.' : ''}</p>` : ''}
<h2>${s.ads || s.donate ? 6 : 5}. Other</h2>
<p>These terms are governed by the law of the Russian Federation. This does not deprive you of the protection of mandatory rules of the law of the country where you live (for example, consumer and data protection law in the EU and UK). The terms may change; a new version takes effect when published here. Send questions and complaints to ${mail(op)}.</p>
`;
}

export { LEGAL_VERSION_EN };
