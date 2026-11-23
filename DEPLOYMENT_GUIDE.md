# QWEMU MUSIC Web Edition 1.4.0 — Cloudflare deployment

1. Распакуй содержимое этого архива в отдельный GitHub-репозиторий или папку проекта. `index.html` должен находиться в корне Pages-проекта.
2. В Cloudflare Pages подключи GitHub repository. Root directory — `/` (корень этого проекта), Build command — пустая, Build output directory — `.`.
3. Создай D1 database `qwemu-web`, замени placeholder `database_id` в `wrangler.jsonc` на ID своей базы.
4. Выполни SQL migration: `npx wrangler d1 migrations apply qwemu-web --remote`.
5. Создай секрет: `npx wrangler secret put RATE_LIMIT_SECRET`. Используй длинное случайное значение; не сохраняй его в Git.
6. В Pages → Settings → Bindings добавь D1 binding с переменной `DB` и созданной базой.
7. Выполни deploy. Проверь `/api/health`, регистрацию, вход, выход и синхронизацию тестового аккаунта.

## Важно

- Музыкальные файлы не загружаются в Cloudflare; браузер использует локальные выбранные файлы.
- Без D1 binding и `RATE_LIMIT_SECRET` облачная авторизация не будет работать.
- Перед production измерь время PBKDF2 на реальном Cloudflare Worker: Free CPU budget может быть недостаточным.
- Production deploy, удалённая миграция и live-auth не были выполнены при подготовке этого архива.
