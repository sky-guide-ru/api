// Общая отправка писем владельцу сайта (отзывы, сводки, срочные алерты). Настройки — в .env:
//   SMTP_USER — почта (Gmail), SMTP_PASS — пароль приложения Google, MAIL_TO — куда слать (пусто = SMTP_USER),
//   SMTP_HOST / SMTP_PORT — если не Gmail (по умолчанию smtp.gmail.com:465).
//   RESEND_API_KEY — отправка через Resend по HTTPS, если хостинг закрыл почтовые порты (см. smtp.js).
//   MAIL_DOMAIN — слать напрямую со своего сервера с noreply@домен (DNS-записи — docs/mail.md); Resend/SMTP — запасные.
// Адрес владельца наружу не отдаём: mailerInfo() показывает его только маской.
import { smtpConfig, sendMail as smtpSend } from './smtp.js';

/** Отправить письмо владельцу. Без настроенной почты — false (ничего не делает) */
export async function sendMail({ subject, text, attachments = [] }, { env = process.env, send = smtpSend } = {}) {
  const cfg = smtpConfig(env);
  if (!cfg) return false;
  await send(cfg, { subject, text, attachments });
  return true;
}

export function mailerInfo(env = process.env) {
  const cfg = smtpConfig(env);
  return { configured: !!cfg, to: cfg ? cfg.to.replace(/^(.).*?(.)?@/, (m, a, b) => `${a}…${b || ''}@`) : null, host: cfg?.host || null, transport: cfg?.transport || null, from: cfg?.transport === 'direct' ? cfg.from : null, fallback: cfg?.fallback?.transport || null };
}
