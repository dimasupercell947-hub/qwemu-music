import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFile(join(root, path), 'utf8');
const exists = async path => access(join(root, path)).then(() => true, () => false);

const html = await read('public/index.html');
assert.match(html, /<html lang="ru">/i, 'Документ должен иметь русскую локаль');
assert.match(html, /assets\/main\.js/, 'Не подключён основной JS');
assert.match(html, /assets\/app\.css/, 'Не подключены основные стили');
assert.match(html, /id="audio"/, 'Не найден HTML audio element');

for (const asset of [...html.matchAll(/(?:src|href)="\.\/([^"?#]+)"/g)].map(x => `public/${x[1]}`)) {
  assert.equal(await exists(asset), true, `Отсутствует локальный ресурс: ${asset}`);
}

const browserAudio = await read('public/assets/audio-adapter.js');
assert.match(browserAudio, /export class BrowserAudioAdapter/, 'Не найден браузерный аудиоадаптер');
assert.doesNotMatch(browserAudio, /DesktopAudioAdapter|__TAURI__|invoke\(['"]audio_/, 'Cloudflare frontend не должен содержать Desktop/Tauri audio bridge');

const main = await read('public/assets/main.js');
for (const modulePath of [...main.matchAll(/from\s+['"](\.\/[^'"]+)['"]/g)].map(x => x[1])) {
  assert.equal(await exists(`public/assets/${modulePath.slice(2)}`), true, `Не найден модуль ${modulePath}`);
}

const api = await read('functions/api/[[path]].js');
for (const route of ['/api/health', '/api/auth/register', '/api/auth/login', '/api/auth/logout', '/api/me', '/api/playlists', '/api/favorites', '/api/settings']) {
  assert.ok(api.includes(route), `В API отсутствует ожидаемый маршрут/обработчик: ${route}`);
}
assert.match(api, /RATE_LIMIT_SECRET/, 'Не найдена защита rate limit');
assert.match(api, /X-QWEMU-CSRF/, 'Не найдена CSRF-проверка');
assert.match(api, /HttpOnly; Secure; SameSite=Lax/, 'Неправильные атрибуты session cookie');

const config = JSON.parse(await read('wrangler.jsonc'));
assert.equal(config.main, './dist/worker/index.js', 'Worker main должен указывать на собранный bundle');
assert.equal(config.assets?.directory, './public', 'Неправильный каталог Static Assets');
assert.equal(config.assets?.binding, 'ASSETS', 'Не настроен ASSETS binding');
assert.equal(config.assets?.not_found_handling, 'single-page-application', 'Не настроен SPA fallback');
assert.deepEqual(config.assets?.run_worker_first, ['/api/*'], 'API должен вызывать Worker до проверки статических файлов');

const db = config.d1_databases?.find(item => item.binding === 'DB');
assert.ok(db, 'Не настроен D1 binding DB');
assert.equal(db.database_name, 'qwemu-web', 'Неправильное имя D1 database');
assert.equal(db.migrations_dir, 'migrations', 'Не настроен каталог миграций');
assert.match(db.database_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'database_id должен иметь формат UUID');

const headers = await read('public/_headers');
assert.match(headers, /Content-Security-Policy:/, 'Не настроена CSP для Static Assets');
assert.match(headers, /X-Content-Type-Options:\s*nosniff/, 'Не настроен nosniff');

const sql = await read('migrations/0001_initial.sql');
for (const table of ['users', 'sessions', 'user_data', 'rate_limits']) {
  assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, 'i'), `Нет таблицы ${table}`);
}

const files = await readdir(join(root, 'public/assets'));
assert.ok(files.includes('main.js') && files.includes('app.css') && files.includes('audio-adapter.js'), 'Неполный набор frontend assets');
assert.equal(await exists('public/_routes.json'), false, 'Старый Pages _routes.json не должен оставаться в Workers-проекте');
assert.equal(await exists('public/.assetsignore.'), false, 'Некорректный .assetsignore. не должен оставаться в проекте');
assert.equal(await exists('dist/worker/index.js'), true, 'Не найден сгенерированный Worker bundle');
assert.equal(await exists('scripts/check-deploy.mjs'), true, 'Отсутствует pre-deploy validation');
console.log('QWEMU Cloudflare smoke tests: PASS');
console.log('Проверено: HTML, локальные ресурсы, JS imports, API routes/security markers, Workers routing, D1 config/schema, headers и Worker bundle.');
