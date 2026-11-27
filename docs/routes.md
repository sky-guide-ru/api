# Адреса сервера

Все маршруты api. Сайт ходит в `/api/*`, поэтому эти адреса заморожены: те же пути, параметры, cookie и форма ответов,
пока сайт не переедет на `/v1`. Новое — только в `/v1` с описанием в [`openapi.yaml`](../openapi.yaml).

Список сверяет с настоящим сервером `test/routes.test.js`. Добавил маршрут — допиши его сюда
(или `UPDATE_ROUTES=1 npm test` пересоберёт список). Убрал или переименовал — тест упадёт: сначала договорись с `web`.

## /api: остальное

- `GET /api/bank`
- `GET /api/bazaar`
- `GET /api/bits`
- `GET /api/calendar`
- `GET /api/collectibles/marks`
- `GET /api/collections`
- `GET /api/compare`
- `GET /api/coop`
- `GET /api/crafts`
- `GET /api/crops`
- `GET /api/essence`
- `GET /api/flips`
- `GET /api/guides`
- `GET /api/guides/:id`
- `GET /api/head/:who`
- `GET /api/history`
- `GET /api/icon/:id`
- `GET /api/img/:id`
- `GET /api/inventory`
- `GET /api/maxwell`
- `GET /api/me`
- `GET /api/minions`
- `GET /api/museum`
- `GET /api/museum/item/:id`
- `GET /api/my-auctions`
- `GET /api/news`
- `GET /api/news/latest`
- `GET /api/packs`
- `GET /api/part/:name`
- `GET /api/player-skin/:uuid`
- `GET /api/players/stats`
- `GET /api/quotes`
- `GET /api/refs/data`
- `GET /api/refs/lexicon`
- `GET /api/rift/marks`
- `GET /api/roadmap/hidden`
- `GET /api/sacks`
- `GET /api/search`
- `GET /api/skin/:hash`
- `GET /api/state`
- `GET /api/status`
- `GET /api/stream`
- `GET /api/texture/:name`
- `GET /api/version`
- `POST /api/collectibles/marks`
- `POST /api/feedback`
- `POST /api/icons`
- `POST /api/packs/reload`
- `POST /api/refresh`
- `POST /api/rift/marks`
- `POST /api/roadmap/hidden`
- `POST /api/t`

## /api/admin

- `GET /api/admin/feedback`
- `GET /api/admin/feedback/:id/shot`
- `GET /api/admin/leaderboard/removed`
- `GET /api/admin/mail/check`
- `GET /api/admin/monitor`
- `GET /api/admin/status`
- `POST /api/admin/feedback-test`
- `POST /api/admin/feedback/:id/delete`
- `POST /api/admin/feedback/:id/resend`
- `POST /api/admin/feedback/:id/status`
- `POST /api/admin/monitor/resolve`
- `POST /api/admin/monitor/test-mail`

## /api/docs

- `GET /api/docs`
- `GET /api/docs/:file`
- `GET /api/docs/init.js`
- `GET /api/docs/openapi.yaml`

## /api/item

- `GET /api/item/:id`
- `GET /api/item/:id/obtain`
- `GET /api/item/:id/upgrades`

## /api/leaderboard

- `GET /api/leaderboard`
- `POST /api/leaderboard/remove`
- `POST /api/leaderboard/restore`

## /api/live

- `GET /api/live/state`
- `POST /api/live/ask`
- `POST /api/live/chat/clear`
- `POST /api/live/goal/clear`
- `POST /api/live/refresh`
- `POST /api/live/settings`

## /api/market

- `GET /api/market/ah`
- `GET /api/market/ah-help`
- `GET /api/market/candles/:id`
- `GET /api/market/charts`
- `GET /api/market/crops`
- `GET /api/market/flips/bazaar`
- `GET /api/market/flips/craft`
- `GET /api/market/flips/forge`
- `GET /api/market/flips/npc`
- `GET /api/market/flips/snipes`
- `GET /api/market/help`
- `GET /api/market/item/:id`
- `GET /api/market/money`
- `GET /api/market/movers`
- `GET /api/market/sessions`
- `GET /api/market/settings`
- `GET /api/market/status`
- `GET /api/market/trend/:id`
- `POST /api/market/sessions`
- `POST /api/market/settings`

## /api/survey

- `GET /api/survey`
- `GET /api/survey/results`
- `GET /api/survey/results.csv`
- `POST /api/survey/answer`

## /v1

- `GET /v1/auctions`
- `GET /v1/bazaar`
- `GET /v1/calendar`
- `GET /v1/compare`
- `GET /v1/flips/:kind`
- `GET /v1/guides`
- `GET /v1/guides/:id`
- `GET /v1/items/:id`
- `GET /v1/items/:id/image`
- `GET /v1/items/:id/obtain`
- `GET /v1/leaderboard`
- `GET /v1/market/candles/:id`
- `GET /v1/market/crops`
- `GET /v1/market/movers`
- `GET /v1/market/trend/:id`
- `GET /v1/news`
- `GET /v1/players/:name/profiles`
- `GET /v1/players/:name/profiles/:profile/accessories`
- `GET /v1/players/:name/profiles/:profile/accessories/missing`
- `GET /v1/players/:name/profiles/:profile/auctions`
- `GET /v1/players/:name/profiles/:profile/bank`
- `GET /v1/players/:name/profiles/:profile/bits`
- `GET /v1/players/:name/profiles/:profile/collections`
- `GET /v1/players/:name/profiles/:profile/essence`
- `GET /v1/players/:name/profiles/:profile/gear`
- `GET /v1/players/:name/profiles/:profile/guides`
- `GET /v1/players/:name/profiles/:profile/guides/:id`
- `GET /v1/players/:name/profiles/:profile/history`
- `GET /v1/players/:name/profiles/:profile/items/:id/upgrades`
- `GET /v1/players/:name/profiles/:profile/map`
- `GET /v1/players/:name/profiles/:profile/maxwell`
- `GET /v1/players/:name/profiles/:profile/minions`
- `GET /v1/players/:name/profiles/:profile/money`
- `GET /v1/players/:name/profiles/:profile/museum`
- `GET /v1/players/:name/profiles/:profile/networth`
- `GET /v1/players/:name/profiles/:profile/pets`
- `GET /v1/players/:name/profiles/:profile/plan`
- `GET /v1/players/:name/profiles/:profile/progress`
- `GET /v1/players/:name/profiles/:profile/sacks`
- `GET /v1/players/:name/profiles/:profile/summary`
- `GET /v1/quotes`
- `GET /v1/refs/lexicon`
- `GET /v1/search`
- `GET /v1/status`
- `GET /v1/version`

## Вход и аккаунт

- `GET /account`
- `GET /login`
- `GET /logout`
- `POST /account/api-keys`
- `POST /account/api-keys/players`
- `POST /account/api-keys/revoke`
- `POST /account/logout-all`
- `POST /account/password`
- `POST /account/users`
- `POST /account/users/delete`
- `POST /account/users/reset`
- `POST /account/users/update`
- `POST /login`
- `POST /logout`

## Discord

- `GET /discord`
- `GET /discord/callback`
- `GET /discord/start`
- `GET /en/discord`

## Страницы и файлы

- `GET /`
- `GET /<INDEXNOW_KEY>.txt`
- `GET /^\/(?!api).*/`
- `GET /^\/en$/`
- `GET /^\/google([0-9a-f]{8,32})\.html$/`
- `GET /^\/yandex_([0-9a-f]{8,32})\.html$/`
- `GET /api-terms`
- `GET /consent`
- `GET /en/api-terms`
- `GET /en/consent`
- `GET /en/legal`
- `GET /en/privacy`
- `GET /en/terms`
- `GET /favicon.svg`
- `GET /healthz`
- `GET /index.html`
- `GET /legal`
- `GET /llms-full.txt`
- `GET /llms.txt`
- `GET /og.png`
- `GET /og-en.png`
- `GET /privacy`
- `GET /robots.txt`
- `GET /sitemap.xml`
- `GET /terms`
- `POST /discord/interactions`
