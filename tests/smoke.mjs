import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { join, extname } from 'node:path';
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

const wrangler = await read('wrangler.jsonc');
assert.match(wrangler, /"binding":\s*"DB"/, 'Не настроен D1 binding DB');
assert.match(wrangler, /pages_build_output_dir/, 'Не задан каталог публикации');
assert.match(wrangler, /0001_initial\.sql|migrations_dir/, 'Не настроены миграции D1');

const sql = await read('migrations/0001_initial.sql');
for (const table of ['users', 'sessions', 'user_data', 'rate_limits']) {
  assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, 'i'), `Нет таблицы ${table}`);
}

const files = await readdir(join(root, 'public/assets'));
assert.ok(files.includes('main.js') && files.includes('app.css') && files.includes('audio-adapter.js'), 'Неполный набор frontend assets');
assert.equal(await exists('BUILD_EXE.bat'), false, 'Desktop BAT не должен попадать в Cloudflare-пакет');
console.log('QWEMU Cloudflare smoke tests: PASS');
console.log('Проверено: HTML, локальные ресурсы, JS imports, API routes/security markers, Wrangler D1 binding, SQL schema.');
