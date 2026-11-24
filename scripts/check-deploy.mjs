import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const configPath = resolve(root, process.env.WRANGLER_CONFIG || 'wrangler.jsonc');
const config = JSON.parse(await readFile(configPath, 'utf8'));
const database = config.d1_databases?.find(item => item.binding === 'DB');
const uuid = database?.database_id || '';
const validUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);

if (!validUuid || uuid === '00000000-0000-0000-0000-000000000000') {
  console.error('DEPLOY BLOCKED: укажи настоящий database_id из Cloudflare D1 в wrangler.jsonc.');
  process.exit(1);
}
if (config.name !== 'qwemu-music' || !config.main || !config.assets?.directory || !config.assets?.run_worker_first?.includes('/api/*')) {
  console.error('DEPLOY BLOCKED: конфигурация Worker/Static Assets неполная.');
  process.exit(1);
}
try {
  await access(resolve(root, config.main));
} catch {
  console.error(`DEPLOY BLOCKED: Worker bundle не найден: ${config.main}. Сначала выполни npm run build.`);
  process.exit(1);
}
console.log('Deploy configuration: PASS (D1 UUID, Worker entrypoint, API routing).');
