# Sky Guide · api

Сервер сайта [sky-guide.ru](https://sky-guide.ru): адреса `/api/*`, вход и аккаунты, страницы для поисковиков, почта владельцу, мониторинг. Расчёты берёт из [core](https://github.com/sky-guide-ru/core).

## Что внутри

| Папка | Что там |
|---|---|
| `src/index.js` | сборка сервера: все адреса и фоновые обновления |
| `src/routes/`, `src/mount/` | адреса по разделам |
| `src/v1/`, `openapi.yaml` | публичный API `/v1`, ключи доступа, страница Swagger |
| `src/auth.js`, `src/users.js` | вход по нику и паролю сайта, аккаунты |
| `src/seo/`, `src/legal*.js`, `src/public.js` | страницы для поисковиков, правовые страницы, реклама и метрика |
| `src/monitor/`, `src/feedback.js`, `src/lib/mailer.js` | посещения без IP, ошибки, отзывы и письма владельцу |
| `test/` | `npm test` |

Сервер отдаёт и собранный сайт: папка из `WEB_DIST` (по умолчанию `../web/dist`). Данные — в `data/` рядом (`DATA_DIR`).
Все настройки — в [`deploy/.env.example`](https://github.com/sky-guide-ru/deploy/blob/main/.env.example).

## API /v1

Открытый API с описанием [`openapi.yaml`](openapi.yaml) и страницей Swagger на [`/api/docs`](https://sky-guide.ru/api/docs/).

- **Без ключа:** предметы (`/v1/items/{id}`, `/obtain`), поиск, Bazaar, аукцион, свечи, флипы, словарь терминов, новости, статус.
  Лимит — `V1_PER_MIN` запросов в минуту с одного адреса (по умолчанию 120).
- **По ключу** `X-API-Key`: данные игроков `/v1/players/{name}/profiles/{profile}/summary|plan|money`. Только для своих клиентов
  (бот, мод) — так требуют правила Hypixel. Ключи выдаёт и отзывает владелец на странице «Аккаунт», у каждого свой лимит в минуту;
  в `data/api-keys.json` лежит только хеш ключа.
- Язык — `?lang=en` или `X-Lang: en`. Ошибки — `{ "error", "code" }`.

Сначала описание, потом код: `test/v1.test.js` проверяет, что каждая ручка `/v1` есть в описании и наоборот, а ответы проходят
схемы описания. Старые адреса `/api/*` заморожены — их список в [`docs/routes.md`](docs/routes.md) сверяет `test/routes.test.js`.

## Репо проекта

| Репо | Что там |
|---|---|
| [core](https://github.com/sky-guide-ru/core) | расчёты без HTTP: разбор профиля, план «Что делать», рынок, гайды, русская база предметов, переводы. Пакет `@sky-guide/core` |
| [api](https://github.com/sky-guide-ru/api) | сервер: адреса `/api/*`, вход и аккаунты, SEO-страницы, OpenAPI и Swagger |
| [web](https://github.com/sky-guide-ru/web) | сайт [sky-guide.ru](https://sky-guide.ru) на React + Vite, данные берёт только у api |
| [deploy](https://github.com/sky-guide-ru/deploy) | запуск на сервере: Docker, Caddy, автообновление, бэкапы, браузерный e2e |

Как запустить у себя и прислать правку — [CONTRIBUTING.md](CONTRIBUTING.md). Лицензия — [AGPL-3.0](LICENSE).
