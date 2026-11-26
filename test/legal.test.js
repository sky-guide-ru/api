import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legalPage, privacyPage, consentPage, termsPage, operatorInfo, hiddenPlayers, servicesInUse } from '../src/legal.js';

test('без данных владельца — предупреждение; с данными — ФИО и почта на всех страницах', () => {
  assert.ok(privacyPage({}, { owner: true }).includes('OPERATOR_NAME'), 'владелец видит, что заполнить');
  for (const fn of [legalPage, privacyPage, consentPage, termsPage]) {
    const pub = fn({});
    assert.ok(!pub.includes('OPERATOR_NAME') && !pub.includes('.env'), `${fn.name}: посетитель не видит подсказку для владельца`);
    assert.ok(!pub.includes('указывается в настройках') && !pub.includes('владелец сайта — владелец'), `${fn.name}: без заглушек`);
  }
  const env = { OPERATOR_NAME: 'Тестов Тест', CONTACT_EMAIL: 'mail@example.ru', OPERATOR_INN: '123456789012' };
  for (const fn of [legalPage, privacyPage, consentPage, termsPage]) {
    const html = fn(env);
    assert.ok(html.includes('Тестов Тест') && html.includes('ИНН 123456789012'), fn.name);
    assert.ok(!html.includes('Владельцу сайта: заполните'), fn.name);
  }
  assert.ok(privacyPage(env).includes('mailto:mail@example.ru'));
  assert.deepEqual(operatorInfo({ CONTACT_EMAIL: 'bad"><script>' }).email, '');
  assert.ok(!privacyPage({ OPERATOR_NAME: '<script>x</script>' }).includes('<script>x'), 'экранирование');
});

test('политика описывает только включённые сервисы', () => {
  const bare = privacyPage({ SITE_URL: 'https://sky.example.ru' });
  assert.ok(!bare.includes('Яндекс Метрика') && !bare.includes('Anthropic') && !bare.includes('Cloudflare'));
  const full = privacyPage({ YANDEX_METRIKA_ID: '12345678', YANDEX_RTB_BOTTOM: 'R-A-1234567-1', ANTHROPIC_API_KEY: 'k', SITE_URL: 'https://x.trycloudflare.com' });
  assert.ok(full.includes('Яндекс Метрика') && full.includes('Рекламная сеть Яндекса') && full.includes('Anthropic PBC (США)') && full.includes('Cloudflare'));
  assert.ok(consentPage({ ANTHROPIC_API_KEY: 'k' }).includes('трансграничная'));
  assert.equal(servicesInUse({ SITE_URL: 'https://sky.example.ru' }).cloudflare, false);
});

test('обязательная оговорка Mojang/Hypixel, лицензия NEU и подпись SkyCofl', () => {
  const html = legalPage({ DONATE_URL: 'https://boosty.to/x' });
  assert.ok(html.includes('NOT AN OFFICIAL MINECRAFT SERVICE. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.'));
  assert.ok(html.includes('not affiliated with or endorsed by Hypixel'));
  assert.ok(html.includes('MIT License, Copyright (c) 2020 Moulberry'));
  assert.ok(html.includes('Prices provided by SkyCofl'));
  assert.ok(html.includes('ничего не дают взамен'), 'донат без привилегий');
});

test('скрытые игроки', () => {
  assert.deepEqual([...hiddenPlayers({ HIDDEN_PLAYERS: ' Foo, bar ,,' })], ['foo', 'bar']);
});

test('/legal называет авторов паков, пока их текстуры видны всем', () => {
  assert.ok(legalPage({}).includes('FurfSky Reborn') && legalPage({}).includes('CC BY-NC-ND 4.0'));
  assert.ok(!legalPage({ YANDEX_RTB_BOTTOM: 'R-A-1234567-1' }).includes('The Reborn Team'));
});

test('английские правовые страницы: свой текст без русского, ссылки на /en/, раздел GDPR в обеих версиях', () => {
  const env = { OPERATOR_NAME: 'Test Owner', CONTACT_EMAIL: 'mail@example.ru', YANDEX_METRIKA_ID: '12345678', ANTHROPIC_API_KEY: 'k', SITE_URL: 'https://sky.example.ru' };
  for (const fn of [legalPage, privacyPage, consentPage, termsPage]) {
    const html = fn(env, { lang: 'en' });
    assert.match(html, /<html lang="en"/, fn.name);
    const ru = html.replace(/<a [^>]*lang="ru"[^>]*>[^<]*<\/a>/, '').match(/[А-Яа-яЁё]+/g);
    assert.equal(ru, null, `${fn.name}: русский текст ${ru}`);
    assert.ok(html.includes('href="/en/privacy"') && html.includes('hreflang="ru"'), `${fn.name}: навигация по английским страницам`);
    assert.ok(html.includes('mailto:mail@example.ru') || fn === legalPage, fn.name);
  }
  assert.ok(legalPage(env, { lang: 'en' }).includes('NOT AN OFFICIAL MINECRAFT SERVICE'));
  const en = privacyPage(env, { lang: 'en' }), ru = privacyPage(env);
  assert.ok(en.includes('id="gdpr"') && en.includes('art. 49(1)(a)') && en.includes('CNIL') && en.includes('France'));
  assert.ok(ru.includes('id="gdpr"') && ru.includes('CNIL') && ru.includes('во Франции'));
  assert.ok(termsPage(env, { lang: 'en' }).includes('governed by the law of the Russian Federation'));
  assert.ok(!privacyPage({}, { lang: 'en' }).includes('Yandex'), 'английская политика тоже описывает только включённые сервисы');
});
