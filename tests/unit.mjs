import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { fingerprintFile } from '../public/assets/file-fingerprint.js';
import { CloudWriteQueue } from '../public/assets/cloud-write-queue.js';
import { buildDeployConfig } from '../scripts/prepare-deploy.mjs';
import { onRequest } from '../functions/api/[[path]].js';



async function testWorkerReadiness() {
  const request = new Request('https://qwemu.test/api/health');
  const noDatabase = await onRequest({ request, env: {} });
  assert.equal(noDatabase.status, 503, 'Health должен блокироваться без D1 binding');

  const noSecret = await onRequest({
    request,
    env: { DB: { prepare: () => ({ first: async () => ({ ready: 1 }) }) } }
  });
  assert.equal(noSecret.status, 503, 'Health не должен быть успешным без RATE_LIMIT_SECRET');

  const ready = await onRequest({
    request,
    env: {
      DB: { prepare: () => ({ first: async () => ({ ready: 1 }) }) },
      RATE_LIMIT_SECRET: 'r'.repeat(32)
    }
  });
  assert.equal(ready.status, 200, 'Health должен вернуть 200 с D1 и корректным secret');
  const payload = await ready.json();
  assert.equal(payload.databaseReady, true);
  assert.equal(payload.rateLimitConfigured, true);
}

function testDeployConfig() {
  const zeroId = '00000000-0000-0000-0000-000000000000';
  const source = {
    name: 'qwemu-music',
    main: './dist/worker/index.js',
    assets: { directory: './public', run_worker_first: ['/api/*'] },
    d1_databases: [{
      binding: 'DB',
      database_name: 'qwemu-web',
      database_id: zeroId,
      preview_database_id: zeroId,
      migrations_dir: 'migrations'
    }]
  };
  const secret = 'qwemu-production-secret-'.repeat(2);
  const env = {
    CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
    CLOUDFLARE_D1_DATABASE_ID: '12345678-1234-4abc-8def-123456789abc',
    RATE_LIMIT_SECRET: secret
  };
  const deployed = buildDeployConfig(source, env);
  assert.equal(deployed.account_id, env.CLOUDFLARE_ACCOUNT_ID);
  assert.equal(deployed.d1_databases[0].database_id, env.CLOUDFLARE_D1_DATABASE_ID);
  assert.equal(deployed.d1_databases[0].preview_database_id, zeroId);
  assert.equal(source.d1_databases[0].database_id, zeroId, 'Исходный config не должен мутировать');
  assert.doesNotMatch(JSON.stringify(deployed), new RegExp(secret), 'Секрет не должен попадать в Wrangler config');
  assert.throws(() => buildDeployConfig(source, { ...env, CLOUDFLARE_D1_DATABASE_ID: zeroId }), /настоящим UUID/);
  assert.throws(() => buildDeployConfig(source, { ...env, CLOUDFLARE_ACCOUNT_ID: 'bad' }), /ACCOUNT_ID/);
  assert.throws(() => buildDeployConfig(source, { ...env, RATE_LIMIT_SECRET: 'short' }), /32 байт/);
}

async function testFingerprint() {
  const bytes = new Uint8Array(220_000);
  for (let i=0;i<bytes.length;i++) bytes[i]=(i*37+11)&255;

  const first = new File([bytes], 'track-a.mp3', { lastModified: 1000 });
  const renamed = new File([bytes], 'renamed-track.flac', { lastModified: 9000 });
  const firstId = await fingerprintFile(first);
  const renamedId = await fingerprintFile(renamed);
  assert.equal(firstId, renamedId, 'Идентификатор одинакового содержимого не должен зависеть от имени и даты файла');

  const changedBytes = new Uint8Array(bytes);
  changedBytes[128] ^= 0xff;
  const changed = new File([changedBytes], 'track-a.mp3', { lastModified: 1000 });
  const changedId = await fingerprintFile(changed);
  assert.notEqual(firstId, changedId, 'Изменение содержимого в проверяемом sample должно менять fingerprint');

  await assert.rejects(
    fingerprintFile(new File([], 'empty.mp3')),
    /непуст/
  );
}

async function testCloudWriteQueue() {
  const queue = new CloudWriteQueue();
  const order = [];

  const first = queue.enqueue('account:playlists', async () => {
    await new Promise(resolve => setTimeout(resolve, 10));
    order.push('first');
  });
  const second = queue.enqueue('account:playlists', async () => {
    order.push('second');
  });
  await Promise.all([first,second]);
  assert.deepEqual(order,['first','second'],'Записи одного ключа должны выполняться последовательно');

  await assert.rejects(
    queue.enqueue('account:favorites', async () => { throw new Error('expected failure'); }),
    /expected failure/
  );
  await queue.enqueue('account:favorites', async () => { order.push('after-failure'); });
  await queue.drain();
  assert.equal(order.at(-1),'after-failure','Ошибка предыдущей записи не должна блокировать очередь');
  assert.equal(queue.pending.size,0,'После drain очередь должна быть пустой');
}

testDeployConfig();
await testWorkerReadiness();
await testFingerprint();
await testCloudWriteQueue();
console.log('QWEMU unit tests: PASS');
console.log('Проверено: production Wrangler config validation, Worker readiness behavior, secret isolation, fingerprint stability, invalid file validation, serialized cloud writes and queue recovery.');
