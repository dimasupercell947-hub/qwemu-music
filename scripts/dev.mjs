import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const npmCli = process.env.npm_execpath;
if (!npmCli || !existsSync(npmCli)) {
  console.error('Запускай dev-сервер через команду: npm run dev');
  process.exit(1);
}

function runWrangler(args, options = {}) {
  return spawnSync(process.execPath, [npmCli, 'exec', '--', 'wrangler', ...args], {
    stdio: 'inherit',
    ...options
  });
}

const build = runWrangler(['pages', 'functions', 'build', '--outdir=./dist/worker/']);
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

const children = [];
let stopping = false;

function terminate(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) terminate(child);
}

process.on('SIGINT', () => stopAll(130));
process.on('SIGTERM', () => stopAll(143));

const watcher = spawn(process.execPath, [npmCli, 'exec', '--', 'wrangler', 'pages', 'functions', 'build', '--outdir=./dist/worker/', '--watch'], { stdio: 'inherit' });
children.push(watcher);
watcher.once('error', error => {
  console.error('Не удалось запустить наблюдатель сборки:', error.message);
  stopAll(1);
});
watcher.once('exit', code => {
  if (!stopping) {
    console.error('Наблюдатель сборки завершился. Останавливаю dev-сервер.');
    stopAll(code || 1);
  }
});

const server = spawn(process.execPath, [npmCli, 'exec', '--', 'wrangler', 'dev'], { stdio: 'inherit' });
children.push(server);
server.once('error', error => {
  console.error('Не удалось запустить Wrangler dev:', error.message);
  stopAll(1);
});
server.once('exit', code => {
  if (!stopping) stopAll(code || 0);
});
