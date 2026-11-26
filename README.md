# Sky Guide · api

Сервер сайта [sky-guide.ru](https://sky-guide.ru): адреса `/api/*`, вход и аккаунты, страницы для поисковиков, почта владельцу, мониторинг. Расчёты берёт из [core](https://github.com/sky-guide-ru/core).

## Что внутри

| Папка | Что там |
|---|---|
| `src/index.js` | сборка сервера: все адреса и фоновые обновления |
| `src/routes/`, `src/mount/` | адреса по разделам |
| `src/auth.js`, `src/users.js` | вход по нику и паролю сайта, аккаунты |
| `src/seo/`, `src/legal*.js`, `src/public.js` | страницы для поисковиков, правовые страницы, реклама и метрика |
| `src/monitor/`, `src/feedback.js`, `src/lib/mailer.js` | посещения без IP, ошибки, отзывы и письма владельцу |
| `test/` | `npm test` |

Сервер отдаёт и собранный сайт: папка из `WEB_DIST` (по умолчанию `../web/dist`). Данные — в `data/` рядом (`DATA_DIR`).
Все настройки — в [`deploy/.env.example`](https://github.com/sky-guide-ru/deploy/blob/main/.env.example).

## Дальше

`/v1` с описанием OpenAPI и страницей Swagger, ключи для своих бота и мода — в работе.

## Репо проекта

| Репо | Что там |
|---|---|
| [core](https://github.com/sky-guide-ru/core) | расчёты без HTTP: разбор профиля, план «Что делать», рынок, гайды, русская база предметов, переводы. Пакет `@sky-guide/core` |
| [api](https://github.com/sky-guide-ru/api) | сервер: адреса `/api/*`, вход и аккаунты, SEO-страницы, OpenAPI и Swagger |
| [web](https://github.com/sky-guide-ru/web) | сайт [sky-guide.ru](https://sky-guide.ru) на React + Vite, данные берёт только у api |
| [deploy](https://github.com/sky-guide-ru/deploy) | запуск на сервере: Docker, Caddy, автообновление, бэкапы, браузерный e2e |

Как запустить у себя и прислать правку — [CONTRIBUTING.md](CONTRIBUTING.md). Лицензия — [AGPL-3.0](LICENSE).
