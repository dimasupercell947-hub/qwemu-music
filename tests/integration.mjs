import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Запускай интеграционные тесты через npm run test:integration');
const persistDir = await mkdtemp(join(tmpdir(), 'qwemu-d1-'));
const port = 8789;
const baseUrl = `http://127.0.0.1:${port}`;
let server;

function runWrangler(args) {
  const result = spawnSync(process.execPath, [npmCli, 'exec', '--', 'wrangler', ...args], { stdio: 'inherit' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `Wrangler завершился с кодом ${result.status}`);
}

function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

async function waitForServer(child) {
  const deadline = Date.now() + 30000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Wrangler dev завершился с кодом ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.status === 200 || response.status === 503) return;
      lastError = new Error(`Health endpoint вернул HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Wrangler dev не запустился за 30 секунд: ${lastError?.message || 'нет ответа'}`);
}

function check(condition, message) {
  assert.ok(condition, message);
}

async function jsonRequest(path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

try {
  await access(npmCli);
  console.log('Applying D1 migrations to an isolated temporary database...');
  runWrangler(['d1', 'migrations', 'apply', 'qwemu-web', '--local', '--persist-to', persistDir]);

  console.log('Starting local Worker with a test-only rate-limit secret...');
  server = spawn(process.execPath, [
    npmCli, 'exec', '--', 'wrangler', 'dev',
    '--local', '--ip', '127.0.0.1', '--port', String(port),
    '--persist-to', persistDir,
    '--var', 'RATE_LIMIT_SECRET:integration-test-only-value-32-bytes'
  ], { stdio: 'inherit' });
  await waitForServer(server);

  const health = await jsonRequest('/api/health');
  check(health.response.status === 200 && health.payload.databaseReady === true && health.payload.rateLimitConfigured === true, 'D1 health-check должен подтверждать реальный SELECT');

  const unknownApi = await jsonRequest('/api/__not_found__');
  check(unknownApi.response.status === 404 && typeof unknownApi.payload.error === 'string', 'Неизвестный API route должен возвращать JSON 404');

  const username = `qa_${Date.now().toString(36)}`.slice(0, 20);
  const password = 'QwemuIntegration123!';
  const origin = { Origin: baseUrl };

  const blockedRegister = await jsonRequest('/api/auth/register', {
    method: 'POST',
    body: { username, displayName: 'QA Test', email: '', password }
  });
  check(blockedRegister.response.status === 403, 'Регистрация без Origin должна быть запрещена');

  const registration = await jsonRequest('/api/auth/register', {
    method: 'POST',
    headers: origin,
    body: { username, displayName: 'QA Test', email: '', password }
  });
  check(registration.response.status === 201, `Регистрация должна вернуть 201, получено ${registration.response.status}`);

  const setCookies = registration.response.headers.getSetCookie?.() || [registration.response.headers.get('set-cookie') || ''];
  const cookiePairs = setCookies.map(value => value.split(';')[0]).filter(Boolean);
  const cookieHeader = cookiePairs.join('; ');
  const sessionCookie = setCookies.find(value => value.startsWith('QWEMU_SESSION='));
  const csrfCookie = setCookies.find(value => value.startsWith('QWEMU_CSRF='));
  check(Boolean(sessionCookie?.includes('HttpOnly') && sessionCookie.includes('Secure') && sessionCookie.includes('SameSite=Lax')), 'Session cookie должна быть HttpOnly, Secure и SameSite=Lax');
  check(Boolean(csrfCookie?.includes('Secure') && csrfCookie.includes('SameSite=Lax')), 'CSRF cookie должна быть Secure и SameSite=Lax');
  const csrf = cookiePairs.find(value => value.startsWith('QWEMU_CSRF='))?.split('=').slice(1).join('=');
  check(Boolean(cookieHeader && csrf), 'Регистрация должна выдать session и CSRF cookies');

  const me = await jsonRequest('/api/me', { headers: { Cookie: cookieHeader } });
  check(me.response.status === 200 && me.payload.user?.username === username, 'Сессия должна восстанавливаться через /api/me');

  const duplicate = await jsonRequest('/api/auth/register', {
    method: 'POST',
    headers: origin,
    body: { username, displayName: 'QA Test', email: '', password }
  });
  check(duplicate.response.status === 409, 'Повторный username должен вернуть 409');

  const noCsrf = await jsonRequest('/api/playlists', {
    method: 'PUT',
    headers: { ...origin, Cookie: cookieHeader },
    body: { value: [], expectedUpdatedAt: null }
  });
  check(noCsrf.response.status === 403, 'Изменение данных без CSRF должно вернуть 403');

  const initialData = await jsonRequest('/api/playlists', { headers: { Cookie: cookieHeader } });
  check(initialData.response.status === 200 && initialData.payload.updatedAt === null, 'Новая учётная запись должна иметь пустую начальную версию данных');

  const csrfHeaders = { ...origin, Cookie: cookieHeader, 'X-QWEMU-CSRF': csrf };
  const firstWrite = await jsonRequest('/api/playlists', {
    method: 'PUT',
    headers: csrfHeaders,
    body: { value: [{ id: 'qa-playlist', name: 'QA Playlist', description: '', trackIds: [] }], expectedUpdatedAt: null }
  });
  check(firstWrite.response.status === 200 && Number.isSafeInteger(firstWrite.payload.updatedAt), 'Первая синхронизация должна создать версионированную запись');

  const secondWrite = await jsonRequest('/api/playlists', {
    method: 'PUT',
    headers: csrfHeaders,
    body: { value: [{ id: 'qa-playlist', name: 'QA Playlist v2', description: '', trackIds: [] }], expectedUpdatedAt: firstWrite.payload.updatedAt }
  });
  check(secondWrite.response.status === 200 && secondWrite.payload.updatedAt > firstWrite.payload.updatedAt, 'Версия должна строго увеличиваться даже при нескольких записях в одну миллисекунду');

  const staleWrite = await jsonRequest('/api/playlists', {
    method: 'PUT',
    headers: csrfHeaders,
    body: { value: [], expectedUpdatedAt: firstWrite.payload.updatedAt }
  });
  check(staleWrite.response.status === 409 && staleWrite.payload.current?.value?.[0]?.name === 'QA Playlist v2', 'Устаревшая запись должна получить конфликт, а не перезаписать более новую версию');

  const deleteWrite = await jsonRequest('/api/playlists', {
    method: 'PUT',
    headers: csrfHeaders,
    body: { value: [], expectedUpdatedAt: secondWrite.payload.updatedAt }
  });
  check(deleteWrite.response.status === 200 && deleteWrite.payload.value.length === 0, 'Удаление должно сохраниться с актуальной версией');

  const afterDelete = await jsonRequest('/api/playlists', { headers: { Cookie: cookieHeader } });
  check(afterDelete.response.status === 200 && afterDelete.payload.value.length === 0, 'Удалённый плейлист не должен восстанавливаться после чтения');

  const logout = await jsonRequest('/api/auth/logout', {
    method: 'POST',
    headers: csrfHeaders,
    body: {}
  });
  check(logout.response.status === 200, 'Выход должен успешно завершать сессию');
  const afterLogout = await jsonRequest('/api/me', { headers: { Cookie: cookieHeader } });
  check(afterLogout.response.status === 401, 'Старая сессия не должна работать после выхода');

  console.log('QWEMU Worker + D1 integration tests: PASS');
  console.log('Проверено: D1 migrations, readiness, JSON 404, Origin, registration, duplicate username, cookies, session, CSRF, CAS conflict, удаление и logout.');
} finally {
  if (server) {
    stopServer(server);
    await Promise.race([once(server, 'exit').catch(() => undefined), new Promise(resolve => setTimeout(resolve, 4000))]);
    if (server.exitCode === null && server.signalCode === null) stopServer(server);
  }
  await rm(persistDir, { recursive: true, force: true });
}
