import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const CONFIG_PATH = resolve(root, process.env.WRANGLER_CONFIG || 'wrangler.deploy.jsonc');
const ACCOUNT_ID = /^[0-9a-f]{32}$/i;

export async function checkWorkersSubdomain({ accountId, apiToken, config, fetchImpl = fetch }) {
  const id = String(accountId || '').trim();
  if (!ACCOUNT_ID.test(id)) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID отсутствует или имеет неверный формат.');
  }

  const hasRoutes = Array.isArray(config?.routes) && config.routes.length > 0;
  const usesWorkersDev = config?.workers_dev !== false && !hasRoutes;
  if (!usesWorkersDev) return { required: false, subdomain: null };

  const token = String(apiToken || '');
  if (!token) {
    throw new Error('CLOUDFLARE_API_TOKEN отсутствует: невозможно проверить workers.dev subdomain.');
  }

  let response;
  try {
    response = await fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${id}/workers/subdomain`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000)
      }
    );
  } catch (error) {
    throw new Error(`Не удалось проверить workers.dev subdomain через Cloudflare API: ${error?.message || 'network error'}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Cloudflare API вернул невалидный JSON при проверке workers.dev (HTTP ${response.status}).`);
  }

  if (!response.ok || payload?.success !== true) {
    const detail = Array.isArray(payload?.errors)
      ? payload.errors.map(item => item.message).filter(Boolean).join('; ')
      : '';
    throw new Error(`Не удалось проверить workers.dev subdomain (HTTP ${response.status})${detail ? `: ${detail}` : ''}. Проверь разрешение Workers Scripts Read или Write у API Token.`);
  }

  const subdomain = payload?.result?.subdomain;
  if (typeof subdomain !== 'string' || !/^[a-z0-9-]+$/i.test(subdomain)) {
    throw new Error('Для аккаунта не настроен workers.dev subdomain. Открой Cloudflare Dashboard → Workers & Pages → Overview → Your subdomain и зарегистрируй поддомен до запуска deploy. Production D1 миграции ещё не запускались.');
  }

  return { required: true, subdomain };
}

async function main() {
  const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
  const result = await checkWorkersSubdomain({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    config
  });
  if (result.required) {
    console.log(`Cloudflare workers.dev subdomain: PASS (${result.subdomain}.workers.dev).`);
  } else {
    console.log('Cloudflare route/custom domain configured; workers.dev subdomain check skipped.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`CLOUDFLARE PREFLIGHT BLOCKED: ${error.message}`);
    process.exitCode = 1;
  });
}
