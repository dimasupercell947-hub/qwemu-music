# QWEMU MUSIC 1.4.0 — Cloudflare Web Edition

Самостоятельный проект браузерной версии QWEMU MUSIC. Не содержит Desktop/Tauri/Rust, Windows BAT-файлов и файлов, не нужных для публикации сайта.

## Состав

- `public/` — готовый сайт и его локальные CSS/JS-ресурсы.
- `functions/api/[[path]].js` — Cloudflare Pages Functions API.
- `migrations/0001_initial.sql` — схема Cloudflare D1.
- `wrangler.jsonc` — конфигурация Pages и D1.
- `tests/` — автономная smoke-проверка пакета.

Музыкальные файлы выбираются пользователем и воспроизводятся в браузере. Они не загружаются в Cloudflare. В D1 сохраняются учётная запись и метаданные: плейлисты, избранное и настройки.

## Важно: это не сборка Windows EXE

Cloudflare Edition — отдельный браузерный сайт. Для него не запускаются `cargo`, `tauri build` или компилятор Rust; пакет не использует `cpal` и `rodio`. Воспроизведение выполняет браузер через HTML Audio.

Если в журнале Cloudflare появляется ошибка `failed to run custom build command for cpal` или `Access is denied (os error 5)`, выбрана папка Desktop-проекта либо задана неправильная команда сборки. Для этого сайта в Cloudflare Pages выставь:

- Root directory — папка, где лежат этот `package.json` и `wrangler.jsonc`.
- Framework preset — `None`.
- Build command — пусто (это готовый статический сайт, сборочный шаг не нужен).
- Build output directory — `public`.

Не указывай `npm run tauri build`, `cargo build` или путь `src-tauri`. Каталог `functions/` должен находиться рядом с `public/` в корне Pages-проекта, чтобы Cloudflare обнаружил API Functions.

## Требования

- Node.js LTS и npm.
- Аккаунт Cloudflare.
- Wrangler 4 (устанавливается через `npm install`).

## Локальный запуск

```bash
npm install
npm run check
npx wrangler login
npx wrangler pages dev public
```

Для локальной работы API создай `.dev.vars` на основе `.dev.vars.example`, затем создай локальную D1-базу и примени миграцию:

```bash
npx wrangler d1 create qwemu-web
npx wrangler d1 migrations apply qwemu-web --local
```

После `d1 create` сохрани выданный `database_id` и внеси его в `wrangler.jsonc`. Не публикуй секреты и файл `.dev.vars`.

## Публикация в Cloudflare Pages

1. Создай D1 database с именем `qwemu-web`:
   ```bash
   npx wrangler d1 create qwemu-web
   ```
2. Скопируй выданный Cloudflare `database_id` в `wrangler.jsonc` вместо нулевого шаблонного UUID.
3. Примени миграцию к удалённой базе:
   ```bash
   npx wrangler d1 migrations apply qwemu-web --remote
   ```
4. Создай секрет для API:
   ```bash
   npx wrangler pages secret put RATE_LIMIT_SECRET --project-name qwemu-music-web
   ```
   Введи длинное случайное значение. Не добавляй его в Git, `.env`, frontend-код или `wrangler.jsonc`.
5. Войди в Cloudflare:
   ```bash
   npx wrangler login
   ```
6. Опубликуй сайт:
   ```bash
   npm run deploy
   ```
   При первом запуске Wrangler предложит создать Pages project `qwemu-music-web`.
7. В Cloudflare Dashboard → Workers & Pages → `qwemu-music-web` → Settings → Bindings проверь D1 binding `DB`, указывающий на `qwemu-web`. Если binding не создан автоматически из `wrangler.jsonc`, добавь его вручную и сделай повторный deploy.
8. Проверь `https://<твой-домен>/api/health`, затем регистрацию, вход, выход и синхронизацию тестового аккаунта.

## GitHub + Cloudflare Pages

- Framework preset: `None`.
- Root directory: `/` (корень этого отдельного проекта).
- Build command: оставить пустым.
- Build output directory: `public`.
- D1 binding: переменная `DB`, база `qwemu-web`.
- Secret: `RATE_LIMIT_SECRET`.

Если Pages управляется через Git-интеграцию, после изменения D1 binding/секретов запусти новый deployment.

## Важные ограничения и безопасность

- `wrangler.jsonc` содержит нулевой UUID как явный шаблон. До удалённого применения миграций и публикации обязательно замени его настоящим `database_id`.
- `RATE_LIMIT_SECRET` обязателен для регистрации и входа. Health endpoint может отвечать `ok`, даже если база ещё не подключена; поле `databaseConfigured` показывает состояние D1 binding.
- Пароли обрабатываются PBKDF2-HMAC-SHA-256 с 310 000 итераций. До production измерь CPU-время регистрации и входа на выбранном тарифе Cloudflare. Если запрос превышает лимит CPU, используй подходящий тариф/проверенный auth backend; не уменьшай число итераций без отдельного анализа безопасности.
- Сессии используют HttpOnly/Secure/SameSite cookies; изменяющие запросы защищены CSRF и проверкой Origin.
- Не включай широкие CORS-заголовки и не переноси секреты в `public/`.
- R2 не требуется: аудио не отправляется на сервер.
- Настоящий Cloudflare deploy, удалённая D1-миграция и live-регистрация не выполнялись при подготовке архива.
