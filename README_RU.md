# QWEMU MUSIC 1.4.0 — Cloudflare Web Edition

Отдельная браузерная версия QWEMU MUSIC на Cloudflare Workers + Static Assets + D1. Desktop-приложение Tauri/Rust не входит в этот проект.

## Архитектура

- `public/` — статический сайт, CSS, JS и правила заголовков Workers.
- `functions/api/[[path]].js` — API авторизации и синхронизации, собирается Wrangler в Worker.
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

Создай локальный файл секретов:

```bash
copy .dev.vars.example .dev.vars
```

Открой `.dev.vars` и замени пример на длинное случайное значение `RATE_LIMIT_SECRET`. Файл `.dev.vars` игнорируется Git и не должен публиковаться.

Создай локальную D1-базу и примени миграции:

```bash
npm run db:migrate:local
```

Для первого локального запуска Wrangler создаст локальную базу автоматически. Если Wrangler сообщит, что база не найдена, сначала выполни `npm run db:create` только для удалённой базы после входа в Cloudflare и настрой её ID, как описано ниже; для локальной базы используй команду миграций с флагом `--local`.

Запуск:

```bash
npm run dev
```

Команда сначала собирает Pages Functions в Worker bundle, затем запускает `wrangler dev`. Открой локальный адрес, указанный Wrangler.

## 2. Создание D1 и подготовка production

Создай базу:

```bash
npm run db:create
```

Wrangler выведет настоящий `database_id`. Скопируй его в `wrangler.jsonc` вместо нулевого UUID:

```json
"database_id": "UUID_ИЗ_ВЫВОДА_WRANGLER"
```

Нулевой UUID в репозитории — только безопасный шаблон. Скрипт публикации намеренно остановится, пока он не заменён реальным ID.

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

Локальные проверки:

```bash
npm run check
```

Публикация:

```bash
npm run deploy
```

Перед публикацией выполняются сборка Worker, синтаксические проверки, smoke-тесты и проверка настоящего D1 ID. Затем запускается `wrangler deploy`.

В Cloudflare Dashboard проверь Worker `qwemu`, binding `DB` (D1 `qwemu-web`) и secret `RATE_LIMIT_SECRET`. Для собственного домена подключи Custom Domain в настройках Worker.

## Маршрутизация и заголовки

- `/api/*` всегда направляется в Worker через `assets.run_worker_first`.
- Остальные запросы обслуживаются Static Assets; неизвестные frontend-маршруты возвращают SPA shell.
- `public/_headers` задаёт заголовки для статических ответов. API-ответы задают защитные заголовки непосредственно в Worker.
- Worker bundle находится в `dist/worker/`, вне `public/`; он не попадает в публичные Static Assets.
- Старый Pages-файл `_routes.json` не используется и удалён.

## Безопасность и ограничения

- Пароли обрабатываются PBKDF2-HMAC-SHA-256; число итераций сейчас 310 000. Перед production проверь CPU time регистрации и входа на выбранном тарифе Workers. Не уменьшай стойкость паролей для обхода CPU-лимита.
- Сессии хранятся в D1 в виде хэшей токенов; cookie сессии имеет `HttpOnly`, `Secure`, `SameSite=Lax`.
- Изменяющие запросы проверяют same-origin и CSRF-токен.
- Rate limit использует секрет `RATE_LIMIT_SECRET` и D1.
- Аудиофайлы остаются локальными. R2 для текущей модели не требуется.
- Production deploy, удалённая D1-миграция и live-регистрация требуют твоего Cloudflare-аккаунта и здесь не выполнялись.

## Desktop и ошибка cpal

Windows-ошибка `cpal` / `Access is denied (os error 5)` относится к локальной сборке Desktop на Windows. Она не относится к Cloudflare Web Edition: в этом проекте нет Tauri, Rust, cpal или rodio. Не указывай Desktop-папку как корень Cloudflare-проекта.
