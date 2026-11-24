# QWEMU MUSIC 1.4.0 — Cloudflare Web Edition

Отдельная браузерная версия QWEMU MUSIC на Cloudflare Workers + Static Assets + D1. Desktop-приложение Tauri/Rust не входит в этот проект.

## QA

Статус проверок и тест-кейсы находятся в [QA.md](./QA.md).

## Архитектура

- `public/` — статический сайт, CSS, JS и правила заголовков Workers.
- `functions/api/[[path]].js` — API авторизации и синхронизации, собирается Wrangler в Worker.
- `scripts/dev.mjs` — кроссплатформенный dev-запуск: watcher Functions + Wrangler Worker.
- `tests/` — smoke, fingerprint и Worker/D1 integration tests.
- `dist/worker/` — генерируемый Worker bundle; не хранится в Git и не раздаётся как публичный файл.
- `migrations/` — миграции Cloudflare D1.
- `wrangler.jsonc` — единая конфигурация Worker, Static Assets и D1.
- `tests/` — локальные smoke-проверки.

Аудиофайлы выбираются пользователем и воспроизводятся браузером через HTML Audio. Они не загружаются в Cloudflare. В D1 сохраняются только учётные записи, сессии и метаданные (плейлисты, избранное, настройки).

## Требования

- Node.js 22 LTS или новее.
- npm.
- Аккаунт Cloudflare с Workers и D1.
- Wrangler 4 (устанавливается через npm).

## 1. Установка и локальная настройка

В корне проекта:

```bash
npm install
npx wrangler login
```

Создай локальный файл секретов (PowerShell):

```powershell
Copy-Item .dev.vars.example .dev.vars
```

Открой `.dev.vars` и задай собственный случайный `RATE_LIMIT_SECRET`. Не используй примерное значение из репозитория.

Открой `.dev.vars` и замени пример на длинное случайное значение `RATE_LIMIT_SECRET`. Файл `.dev.vars` игнорируется Git и не должен публиковаться.

Создай локальную D1-базу и примени миграции:

```bash
npm run db:migrate:local
```

Локальная база привязана к `preview_database_id` в `wrangler.jsonc`. Этот ID намеренно постоянный: замена production `database_id` не меняет локальную базу и не теряет локальные тестовые аккаунты. Не удаляй `preview_database_id`.

Запуск:

```bash
npm run dev
```

`npm run dev` сначала собирает Worker, затем одновременно запускает watcher `wrangler pages functions build --watch` и `wrangler dev`. Изменения в `functions/` пересобираются автоматически. Остановить оба процесса можно через `Ctrl+C`.

## 2. Создание D1 и подготовка production

Создай базу:

```bash
npm run db:create
```

Wrangler выведет настоящий `database_id`. Скопируй его в `wrangler.jsonc` вместо нулевого UUID:

```json
"database_id": "UUID_ИЗ_ВЫВОДА_WRANGLER"
```

Нулевой UUID в `database_id` — шаблон, его обязательно заменить реальным значением из вывода Wrangler. `preview_database_id` оставь без изменений: он используется только для локального хранилища.

Примени миграции к production D1:

```bash
npm run db:migrate:remote
```

Создай production secret:

```bash
npx wrangler secret put RATE_LIMIT_SECRET
```

Введи длинное случайное значение. Оно не должно совпадать с локальным значением из `.dev.vars`. Не добавляй секрет в Git, `.env`, `wrangler.jsonc` или frontend-код.

## 3. Проверка и публикация Workers

Быстрая проверка сборки и кода:

```bash
npm run check
```

Команда собирает Worker, проверяет синтаксис JS, структуру сайта, Workers/D1-конфигурацию, unit-тесты и выполняет `wrangler deploy --dry-run`. Она не поднимает локальный HTTP-сервер и не требует доступности локального D1 runtime — поэтому подходит для Cloudflare Workers Builds.

Полная интеграционная проверка локального Worker и изолированной временной D1:

```bash
npm run test:integration
```

Она проверяет health, API 404, Origin, регистрацию, cookies, сессии, CSRF, конфликты версий, удаление и logout. Временная тестовая база удаляется после завершения.

Обе группы проверок запускаются последовательно в GitHub Actions на Linux и Windows. Команда `npm run test:ci` запускает обе группы локально.

Публикация:

```bash
npm run deploy
```

Перед публикацией выполняются сборка Worker, синтаксические проверки, smoke-тесты и проверка настоящего D1 ID. Затем запускается `wrangler deploy`.

В Cloudflare Dashboard имя Worker должно быть **`qwemu-music`** — оно должно совпадать с `name` в `wrangler.jsonc`. В настройках Worker → **Settings → Builds** укажи:

- Root directory: `/` (корень репозитория).
- Build command: `npm run build`.
- Deploy command: `npx wrangler deploy`.
- В Cloudflare должен быть подключён именно Worker `qwemu-music`, а не Pages-проект с тем же репозиторием.

Затем проверь binding `DB` (D1 `qwemu-web`) и secret `RATE_LIMIT_SECRET`. Для собственного домена подключи Custom Domain в настройках Worker.

## Маршрутизация и заголовки

- `/api/*` всегда направляется в Worker через `assets.run_worker_first`.
- Worker `name` в Wrangler обязан совпадать с именем сервиса в Cloudflare Workers Builds; в этом репозитории это `qwemu-music`.
- Остальные запросы обслуживаются Static Assets; неизвестные frontend-маршруты возвращают SPA shell.
- `public/_headers` задаёт заголовки для статических ответов. API-ответы задают защитные заголовки непосредственно в Worker.
- Worker bundle находится в `dist/worker/`, вне `public/`; он не попадает в публичные Static Assets.
- Старый Pages-файл `_routes.json` не используется и удалён.

## Безопасность и ограничения

- Пароли обрабатываются PBKDF2-HMAC-SHA-256; число итераций сейчас 310 000. Перед production проверь CPU time регистрации и входа на выбранном тарифе Workers. Не уменьшай стойкость паролей для обхода CPU-лимита.
- Сессии хранятся в D1 в виде хэшей токенов; cookie сессии имеет `HttpOnly`, `Secure`, `SameSite=Lax`.
- Изменяющие запросы проверяют same-origin и CSRF-токен.
- Синхронизация использует `expectedUpdatedAt` (optimistic concurrency control). Устаревшая запись получает HTTP 409 и не перезаписывает новую версию на сервере. Конфликт можно разрешить в настройках, выбрав локальную или облачную копию.
- Несинхронизированные данные сохраняются в локальной очереди и повторяются при следующем подключении; если серверная версия уже изменилась, приложение просит выбрать копию, а не сливает данные молча.
- Rate limit использует секрет `RATE_LIMIT_SECRET` и D1.
- Аудиофайлы остаются локальными. R2 для текущей модели не требуется.
- `npm run check` проверяет Worker локально и не публикует его. Production deploy, удалённая D1-миграция и live-регистрация требуют доступ к Cloudflare-аккаунту. Не запускай `npm run db:migrate:remote`, пока не проверил целевую базу.

## Desktop и ошибка cpal

Windows-ошибка `cpal` / `Access is denied (os error 5)` относится к локальной сборке Desktop на Windows. Она не относится к Cloudflare Web Edition: в этом проекте нет Tauri, Rust, cpal или rodio. Не указывай Desktop-папку как корень Cloudflare-проекта.
