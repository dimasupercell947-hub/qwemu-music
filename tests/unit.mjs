import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { fingerprintFile } from '../public/assets/file-fingerprint.js';
import { CloudWriteQueue } from '../public/assets/cloud-write-queue.js';

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

await testFingerprint();
await testCloudWriteQueue();
console.log('QWEMU unit tests: PASS');
console.log('Проверено: fingerprint cross-device stability, content change detection, invalid file validation, serialized cloud writes and queue recovery.');
