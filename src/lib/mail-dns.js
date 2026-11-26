// Проверка настроек для прямой отправки писем: какие DNS-записи нужны, какие уже есть и открыт ли порт 25.
// Показывается владельцу на странице «Сервер» → «Почта», чтобы сверить свои шаги в DNS и в панели хостера.
import net from 'node:net';
import nodeDns from 'node:dns/promises';
import { ensureDkimKey } from './dkim.js';
import { tx } from '@sky-guide/core/i18n/msg.js';

const txt = async (dns, name) => {
  try { return (await dns.resolveTxt(name)).map(parts => parts.join('')); } catch { return []; }
};
const addrs = async (dns, name) => {
  try { return await dns.resolve4(name); } catch { return []; }
};
const pkey = v => (/(?:^|;)\s*p=([^;\s]+)/.exec(v) || [])[1] || '';

/** Открыт ли исходящий порт 25: подключаемся к почте получателя и ждём приветствие «220» */
export function probePort25(host, { port = 25, timeoutMs = 8000 } = {}) {
  return new Promise(resolve => {
    let done = false;
    const finish = (ok, note) => { if (done) return; done = true; s.destroy(); resolve({ ok, note }); };
    const s = net.connect({ host, port, family: 4 });
    s.setTimeout(timeoutMs, () => finish(false, tx`${host}:${port} не отвечает — порт закрыт`));
    s.once('error', e => finish(false, `${host}:${port}: ${e.code || e.message}`));
    s.once('data', d => finish(/^220/.test(d.toString()), d.toString().split('\r\n')[0].slice(0, 120)));
    s.once('close', () => finish(false, tx`${host}:${port} закрыл соединение без приветствия`));
  });
}

/**
 * cfg — из smtpConfig() с transport 'direct'. Возвращает { ip, records: [{ id, type, name, want, have, ok }], port25 }.
 * ip сервера: MAIL_IP из .env, иначе A-запись самого домена (сайт и почта на одном сервере).
 */
export async function checkMailDns(cfg, { env = process.env, dns = nodeDns, probe = probePort25 } = {}) {
  const { domain, helo, selector } = cfg;
  const ip = String(env.MAIL_IP || '').trim() || (await addrs(dns, domain))[0] || '';
  const dkim = ensureDkimKey(cfg.keyDir).dnsValue;
  const records = [];

  const heloA = await addrs(dns, helo);
  records.push({ id: 'a', type: 'A', name: helo, want: ip || 'IP сервера', have: heloA.join(', '), ok: !!ip && heloA.includes(ip) });

  let ptr = [];
  if (ip) { try { ptr = await dns.reverse(ip); } catch { /* нет записи */ } }
  records.push({ id: 'ptr', type: 'PTR', name: ip || 'IP сервера', want: helo, have: ptr.join(', '), ok: ptr.map(p => p.toLowerCase().replace(/\.$/, '')).includes(helo) });

  const spf = (await txt(dns, domain)).filter(t => /^v=spf1(\s|$)/i.test(t));
  const spfOk = spf.length === 1 && !!ip && new RegExp(`(^|\\s)\\+?ip4:${ip.replace(/\./g, '\\.')}(/32)?(\\s|$)`).test(spf[0]);
  // Уже есть одна SPF-запись — дописываем IP в неё, ничего из неё не теряя
  records.push({ id: 'spf', type: 'TXT', name: domain, want: spf.length === 1 && !spfOk
    ? spf[0].replace(/^v=spf1/i, `v=spf1 ip4:${ip || 'IP_сервера'}`) : `v=spf1 ip4:${ip || 'IP_сервера'} ~all`,
    have: spf.join(' | ') + (spf.length > 1 ? ' — SPF-записей больше одной, оставь одну' : ''), ok: spfOk });

  const dk = await txt(dns, `${selector}._domainkey.${domain}`);
  records.push({ id: 'dkim', type: 'TXT', name: `${selector}._domainkey.${domain}`, want: dkim, have: dk.join(' | '), ok: dk.some(v => pkey(v) === pkey(dkim)) });

  const dm = (await txt(dns, `_dmarc.${domain}`)).filter(t => /^v=DMARC1/i.test(t));
  records.push({ id: 'dmarc', type: 'TXT', name: `_dmarc.${domain}`, want: 'v=DMARC1; p=none; adkim=s; aspf=s', have: dm.join(' | '), ok: dm.length === 1 });

  let port25 = { ok: false, note: 'нет почтового сервера получателя' };
  const rcpt = String(cfg.to).split('@').pop();
  try {
    const mx = (await dns.resolveMx(rcpt)).sort((a, b) => a.priority - b.priority)[0];
    if (mx) port25 = await probe(mx.exchange);
  } catch (e) { port25 = { ok: false, note: `MX ${rcpt}: ${e.code || e.message}` }; }

  return { ip, domain, helo, from: cfg.from, records, port25, ready: port25.ok && records.every(r => r.ok || r.id === 'dmarc') };
}
