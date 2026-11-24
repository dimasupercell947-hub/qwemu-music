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

Открой `.dev.vars` и задай собственный случайный `RATE_LIMIT_SECRET`. Файл `.dev.vars` игнорируется Git и не должен публиковаться. Не используй примерное значение из репозитория.

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
- Deploy command: `npm run deploy` (выполняет полный набор проверок и проверяет настоящий D1 UUID перед публикацией).
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

## 4. Production-публикация через GitHub Actions

В репозитории есть ручной workflow `.github/workflows/deploy.yml`. Он проводит проверки, применяет remote D1 migrations, публикует Worker и устанавливает `RATE_LIMIT_SECRET`. Production-публикация не запускается автоматически при каждом push.

### Подготовка Cloudflare

1. В своём Cloudflare аккаунте создай D1 с именем `qwemu-web` (например, командой `npm run db:create` после `npx wrangler login`). Сохрани выданный UUID.
2. Получи Account ID из панели Cloudflare.
3. Создай API Token с правами D1 Edit и Workers Scripts Edit, а также Account Settings Read для проверки аккаунта. При самой первой публикации, если Worker ещё не существует, токену может потребоваться Workers Admin на уровне продукта; после создания Worker доступ можно сузить до Editor для этого Worker.
4. Не передавай API Token или значения секретов в чат и не добавляй их в файлы репозитория.

### GitHub Actions secrets

Открой GitHub → Settings → Secrets and variables → Actions → New repository secret и добавь:

| Имя секрета | Значение |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token |
| `CLOUDFLARE_ACCOUNT_ID` | 32-символьный Account ID |
| `CLOUDFLARE_D1_DATABASE_ID` | UUID D1 базы `qwemu-web` |
| `RATE_LIMIT_SECRET` | Случайное значение длиной не менее 32 байт |

Секрет `RATE_LIMIT_SECRET` нужен именно Worker для rate limit. Скрипт создаёт временный `wrangler.deploy.jsonc` с ID аккаунта и D1, но не записывает значение секрета в этот файл. Временная конфигурация игнорируется Git и удаляется в конце workflow.

### Запуск

1. Открой вкладку **Actions** репозитория.
2. Выбери **Deploy QWEMU to Cloudflare** → **Run workflow**.
3. Для `confirm_production` выбери **yes**.
4. В необязательное поле `health_url` можно вставить полный адрес endpoint, например `https://<твой-worker-домен>/api/health`. Тогда workflow дополнительно проверит HTTP 200 и `databaseReady=true`.

Workflow последовательно запускает `npm run check`, `npm run test:integration`, проверяет Cloudflare credentials, применяет миграции, публикует Worker и задаёт секрет через stdin. Если health URL не задан, успешная публикация не означает, что внешний HTTP health-check был выполнен: проверь `/api/health` вручную.

Обычный `npm run deploy` по-прежнему предназначен для локального Wrangler-профиля с настоящим `database_id` в `wrangler.jsonc`. Для GitHub Actions используется временная production-конфигурация, поэтому production UUID не нужно коммитить в репозиторий.
