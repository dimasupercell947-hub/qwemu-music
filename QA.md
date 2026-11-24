# QWEMU MUSIC Web Edition — QA report

Дата: 2026-11-24
Ветка: fix/cloudflare-workers
Цель: проверить отдельную браузерную версию на Cloudflare Workers + Static Assets + D1.

## 1. Исправления по результатам аудита

| Область | Исправление |
|---|---|
| Worker name | Имя Wrangler приведено к Cloudflare service qwemu-music |
| Local D1 | Добавлен стабильный preview_database_id — production UUID больше не переключает локальное хранилище |
| API routing | /api/* направляется в Worker через assets.run_worker_first |
| Static Assets | Исправлен .assetsignore; удалены устаревшие Pages routing-файлы |
| Dev | Добавлен watcher для Pages Functions вместе с Wrangler dev и совместная остановка процессов |
| Health | Проверяется реальный SELECT 1 в D1 |
| Регистрация | Вставка пользователя и сессии выполняется одним D1 batch |
| D1 ошибки | Неуникальные ошибки базы больше не маскируются под занятый логин |
| Сессии | Истёкшие сессии очищаются при создании новой сессии |
| Синхронизация | Добавлен optimistic concurrency control через expectedUpdatedAt |
| Версии | Версия записи строго возрастает даже при нескольких изменениях в одну миллисекунду |
| Конфликты | HTTP 409 не перезаписывает новые данные; в настройках можно выбрать локальную или облачную версию |
| Удаления | Серверная версия становится источником истины; удалённые элементы не возвращаются простым объединением массивов |
| Track IDs | Fingerprint не зависит от имени файла и lastModified |
| Windows | Проверка .assetsignore учитывает LF и CRLF |
| CI | Проверки выполняются на Linux и Windows |
| Tests | Добавлены unit- и Worker/D1 integration tests |

## 2. Тестовый набор

Быстрые проверки, пригодные для Cloudflare Workers Builds:

    npm install
    npm run check

Внутри npm run check выполняются:

1. Сборка Pages Functions в Worker bundle.
2. Проверка синтаксиса Worker, API, frontend, скриптов и тестов.
3. Smoke-тесты структуры сайта, импортов, Workers config, Static Assets, D1 schema и security markers.
4. Unit-тесты fingerprint и CloudWriteQueue.
5. wrangler deploy --dry-run без публикации.

Команда не запускает локальный HTTP-сервер и интеграционную D1-среду. Это исключает зависимость обычной проверки сборки от доступности локального runtime/портов в CI или Cloudflare build container.

Полная интеграционная проверка запускается отдельно:

    npm run test:integration

Она применяет миграции к изолированной временной D1, поднимает локальный Worker, проверяет health, API 404, Origin, регистрацию, cookies, сессии, CSRF, конфликты версий, удаление и logout, затем удаляет временную базу.

Полный локальный набор:

    npm run test:ci

GitHub Actions выполняет `npm run check` и `npm run test:integration` отдельными шагами на Linux и Windows.

Дополнительные команды:

    npm test
    npm run dev

## 3. API integration matrix

| Сценарий | Ожидаемый результат |
|---|---|
| Health с рабочей D1 | HTTP 200 и databaseReady=true |
| Неизвестный API route | JSON HTTP 404 |
| Регистрация без Origin | HTTP 403 |
| Корректная регистрация | HTTP 201 и session/CSRF cookies |
| Повторный username | HTTP 409 |
| Восстановление сессии | /api/me возвращает пользователя |
| PUT без CSRF | HTTP 403 |
| Первая запись метаданных | HTTP 200 и версия |
| Последовательная запись | Версия строго увеличивается |
| PUT со старой версией | HTTP 409 с актуальным snapshot |
| Удаление с актуальной версией | HTTP 200, данные пусты |
| Запрос после logout | HTTP 401 |

## 4. Открытые риски

| Приоритет | Риск | Причина |
|---|---|---|
| P1 | PBKDF2 310 000 итераций | Нужен замер CPU time на выбранном Workers тарифе |
| P1 | Синхронизация двух реальных устройств | API CAS проверяется интеграционно, но полноценный browser E2E ещё нужен |
| P1 | Cloudflare Workers Builds dashboard | Wrangler name исправлен, но Root directory, Build command и Deploy command в Dashboard нужно сверить |
| P2 | Fingerprint | Используется SHA-256 от размера и пяти 32-КиБ выборок, а не полный хэш файла; теоретически возможна коллизия |
| P2 | Локальная медиатека | File/Blob живёт в текущей вкладке; после закрытия файлы нужно выбрать заново |
| P2 | Browser E2E | Нет теста реального воспроизведения всех форматов на актуальных браузерах |
| P2 | Восстановление пароля | Нет безопасного почтового процесса и срока действия recovery token |
| P2 | Удаление аккаунта | Нет пользовательского сценария удаления аккаунта |
| P2 | Rate-limit cleanup | Отдельная плановая очистка записей ещё не добавлена |

## 5. Ручные проверки перед релизом

- [ ] Chrome и Edge на Windows 10/11.
- [ ] Firefox и Safari.
- [ ] Мобильный Safari и Chrome.
- [ ] Все разделы, формы, пустые состояния, кнопки и клавиатурная навигация.
- [ ] Импорт MP3, WAV, FLAC, OGG, M4A с учётом поддержки браузера.
- [ ] Play/Pause/Stop/Next/Previous/Repeat/Seek/Volume/Mute.
- [ ] Повторный импорт одного файла.
- [ ] Local storage после закрытия и повторного открытия вкладки.
- [ ] Регистрация, вход, перезагрузка, восстановление сессии, выход.
- [ ] Один тестовый аккаунт в двух независимых браузерах.
- [ ] Удаление избранного/плейлиста в браузере A и проверка браузера B.
- [ ] Одновременное изменение плейлиста и выбор версии при конфликте.
- [ ] Security headers для HTML и API проверять отдельно.
- [ ] Worker logs, D1 errors, p95 и CPU time.
- [ ] Production deploy и smoke после deploy.

## 6. Cloudflare production checklist

- [ ] Подключён Worker qwemu-music, а не Pages project.
- [ ] Workers Builds Root directory: /.
- [ ] Build command: npm run build.
- [ ] Deploy command: npx wrangler deploy.
- [ ] В wrangler.jsonc заменён только production database_id на настоящий D1 UUID.
- [ ] preview_database_id оставлен стабильным для локальной D1.
- [ ] Создан secret RATE_LIMIT_SECRET.
- [ ] Production D1 migrations применены к правильной базе.
- [ ] Проверены DB binding и secret в Cloudflare Dashboard.
- [ ] После deploy проверены API, авторизация, синхронизация и статика.

Не коммитить секреты, cookies, пароли и production credentials.

## 7. Достоверность статусов

Подтверждается исходниками: реализация CAS, Workers config, local test runner, smoke/unit/integration tests.

PASS для npm run check и npm run test:integration фиксируется отдельно только по GitHub Actions на текущем HEAD, отдельно для Linux и Windows. Результат старого коммита нельзя переносить на новый.

Не выполнялось этим аудитом: production deploy, удалённые D1 migrations, реальная регистрация в Cloudflare, браузерное E2E, мобильное воспроизведение и тарифные лимиты CPU. Эти пункты нельзя считать PASS без отдельной проверки.

## 8. Шаблон бага

    ID:
    Приоритет: P0 / P1 / P2
    Коммит:
    ОС / устройство:
    Браузер / версия:
    Окружение: local / preview / production
    Шаги:
    Ожидаемое:
    Фактическое:
    Console:
    Network (URL / status):
    Worker log:
    D1 error:
    Скриншот:

## 9. Production deploy automation

Добавлен ручной GitHub Actions workflow `.github/workflows/deploy.yml`.

Перед запуском необходимы repository secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_DATABASE_ID`, `RATE_LIMIT_SECRET`. Ветка CI проверяет сам deploy helper через unit tests и проверяет наличие workflow через smoke tests.

Workflow выполняет:
1. `npm run check` и `npm run test:integration`.
2. Проверку формата Account ID, реального D1 UUID и длины RATE_LIMIT_SECRET.
3. Создание временного `wrangler.deploy.jsonc` без записи RATE_LIMIT_SECRET.
4. Проверку авторизации Wrangler.
5. Проверку workers.dev subdomain через Cloudflare API до изменения production D1.
6. Remote D1 migrations.
7. Публикацию Worker/Static Assets вместе с RATE_LIMIT_SECRET через временный secrets-file в одной версии.
9. Необязательную проверку production `/api/health`, которая подтверждает D1 и наличие rate-limit secret.

Production deployment не считается проверенным до успешного запуска workflow в аккаунте пользователя. Удалённые миграции, доступность Worker и CPU budget не подтверждаются локальными тестами.

### Review fixes

- Совместимость: существующий непустой RATE_LIMIT_SECRET любой длины продолжает работать; health выдаёт отдельный флаг rateLimitStrong и не вызывает login outage.
- Новый production deploy требует RATE_LIMIT_SECRET минимум 32 байта и без начальных/конечных пробелов.
- workers.dev subdomain проверяется read-only через Cloudflare API до remote D1 migrations; при отсутствии поддомена deploy останавливается до изменения production базы.
- Unit tests покрывают старый короткий secret, новый сильный secret, секрет с пробелами, зарегистрированный/отсутствующий workers.dev subdomain, route-only worker и недостаточные API permissions.

- Production deployment использует `wrangler deploy --secrets-file`: Worker не активируется раньше, чем в той же версии окажется RATE_LIMIT_SECRET.
