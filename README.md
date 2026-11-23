# QWEMU MUSIC Web Edition 1.4.0 — INFINITY MINIMAL

Это отдельная браузерная редакция QWEMU MUSIC. Она не использует Tauri или Rust runtime и воспроизводит выбранные пользователем аудиофайлы средствами браузера.

## Локальный запуск

Открой папку `web-edition` через локальный HTTP-сервер. Для проверки Cloudflare Pages Functions используй Wrangler:

```bash
npx wrangler pages dev .
```

## Публикация Cloudflare

1. Создай Cloudflare Pages project и подключи репозиторий.
2. Установи Root directory: `web-edition`.
3. Для статического клиента Build command не требуется; output directory — `.`.
4. Создай D1 database, настрой binding `DB` и выполни `migrations/0001_initial.sql` через Wrangler migrations.
5. Добавь secret `RATE_LIMIT_SECRET`.
6. Проверь `/api/health`, регистрацию, вход, выход и синхронизацию тестового аккаунта.

Подробная инструкция находится в `../CLOUDFLARE_DEPLOYMENT.md`.

## Данные и приватность

- Выбранные аудиофайлы остаются в памяти текущей вкладки браузера.
- Аудиофайлы не загружаются на сервер.
- В облако синхронизируются только аккаунт и разрешённые метаданные: плейлисты, избранное и настройки.
- Для полноценной синхронизации необходимо настроить D1 и секреты Cloudflare.
