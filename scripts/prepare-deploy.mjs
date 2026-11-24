import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const outputPath = resolve(root, 'wrangler.deploy.jsonc');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT_ID = /^[0-9a-f]{32}$/i;

export function buildDeployConfig(baseConfig, env) {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const databaseId = String(env.CLOUDFLARE_D1_DATABASE_ID || '').trim();
  const rateLimitSecret = String(env.RATE_LIMIT_SECRET || '');

  if (!ACCOUNT_ID.test(accountId)) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID отсутствует или имеет неверный формат (ожидается 32 hex-символа).');
  }
  if (!UUID.test(databaseId) || databaseId === '00000000-0000-0000-0000-000000000000') {
    throw new Error('CLOUDFLARE_D1_DATABASE_ID отсутствует или не является настоящим UUID D1.');
  }
  if (new TextEncoder().encode(rateLimitSecret).byteLength < 32) {
    throw new Error('RATE_LIMIT_SECRET должен содержать не менее 32 байт.');
  }

  const config = JSON.parse(JSON.stringify(baseConfig));
  const database = config.d1_databases?.find(item => item.binding === 'DB');
  if (!database || database.database_name !== 'qwemu-web') {
    throw new Error('В Wrangler config не найден ожидаемый D1 binding DB / qwemu-web.');
  }
  if (!config.main || !config.assets?.directory || !config.assets?.run_worker_first?.includes('/api/*')) {
    throw new Error('Конфигурация Worker / Static Assets неполная.');
  }

  config.account_id = accountId;
  database.database_id = databaseId;
  return config;
}

async function main() {
  const source = JSON.parse(await readFile(resolve(root, 'wrangler.jsonc'), 'utf8'));
  const config = buildDeployConfig(source, process.env);
  await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  console.log('Cloudflare production config prepared. Account/D1 IDs validated; RATE_LIMIT_SECRET was not written to disk.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`DEPLOY CONFIG ERROR: ${error.message}`);
    process.exitCode = 1;
  });
}
