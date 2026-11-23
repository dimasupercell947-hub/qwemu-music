const SAMPLE_BYTES = 32 * 1024;

/**
 * Build a bounded-memory fingerprint from file metadata and evenly spaced
 * content samples. It avoids loading multi-hundred-megabyte audio files into
 * memory merely to identify duplicates.
 */
export async function fingerprintFile(file) {
  if (!file || typeof file.slice !== 'function' || !Number.isFinite(file.size) || file.size <= 0) {
    throw new TypeError('Для идентификации нужен непустой файл.');
  }
  if (!globalThis.crypto?.subtle) {
    throw new Error('Для безопасной идентификации файлов нужен современный браузер с Web Crypto API.');
  }

  const lastStart = Math.max(0, file.size - SAMPLE_BYTES);
  const offsets = [...new Set([
    0,
    Math.floor(file.size * 0.25),
    Math.floor(file.size * 0.5),
    Math.floor(file.size * 0.75),
    lastStart
  ].map(offset => Math.min(lastStart, Math.max(0, offset))))];
  const samples = await Promise.all(offsets.map(async offset => new Uint8Array(
    await file.slice(offset, Math.min(file.size, offset + SAMPLE_BYTES)).arrayBuffer()
  )));
  const metadata = new TextEncoder().encode(`${String(file.name || '')}\0${file.size}\0${Number(file.lastModified) || 0}\0`);
  const totalBytes = metadata.length + samples.reduce((total, sample) => total + 8 + sample.length, 0);
  const payload = new Uint8Array(totalBytes);
  const view = new DataView(payload.buffer);
  payload.set(metadata, 0);
  let cursor = metadata.length;
  samples.forEach((sample, index) => {
    view.setUint32(cursor, offsets[index], true);
    view.setUint32(cursor + 4, sample.length, true);
    cursor += 8;
    payload.set(sample, cursor);
    cursor += sample.length;
  });
  const digest = await globalThis.crypto.subtle.digest('SHA-256', payload);
  return `file-${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
