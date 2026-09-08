/**
 * Собирает архив для загрузки в консоль Яндекс Игр: dist/game.zip из
 * содержимого public/ (index.html должен лежать в корне архива).
 *
 * Сборки как таковой нет — это просто zip статических файлов. Архив вне git
 * (см. .gitignore), пересобирается в любой момент: npm run pack.
 *
 * Порядок способов сборки — от более к менее правильному по путям в архиве:
 *   1) системный zip;
 *   2) Python zipfile (scripts/zipdir.py) — прямые слэши гарантированы;
 *   3) PowerShell Compress-Archive — крайний случай: в Windows PowerShell 5.1
 *      пишет ОБРАТНЫЕ слэши (css\style.css), строгие распаковщики их не любят.
 */
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { mkdir, rm, stat } from 'node:fs/promises';
import { ROOT } from './lib.mjs';

const SCRIPTS = join(ROOT, 'scripts');

const PUBLIC = join(ROOT, 'public');
const DIST = join(ROOT, 'dist');
const OUT = join(DIST, 'game.zip');

const run = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, ...opts }, (err, out, errout) =>
      err ? reject(new Error(errout || err.message)) : resolve(out),
    );
  });

async function zipWithZip() {
  // zip кладёт пути относительно cwd — запускаем из public/, чтобы index.html
  // оказался в корне архива.
  await run('zip', ['-r', '-q', OUT, '.'], { cwd: PUBLIC });
}

async function zipWithPython() {
  const script = join(SCRIPTS, 'zipdir.py');
  // Пробуем разные имена интерпретатора (python / py -3 / python3).
  const tries = [['python', [script, PUBLIC, OUT]], ['py', ['-3', script, PUBLIC, OUT]], ['python3', [script, PUBLIC, OUT]]];
  let lastErr;
  for (const [cmd, args] of tries) {
    try {
      await run(cmd, args);
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('python не найден');
}

async function zipWithPowerShell() {
  await run('powershell', [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path '${PUBLIC}\\*' -DestinationPath '${OUT}' -Force`,
  ]);
}

async function main() {
  await mkdir(DIST, { recursive: true });
  await rm(OUT, { force: true });

  try {
    await zipWithZip();
  } catch {
    try {
      console.log('[pack] системный zip недоступен, пакую через Python (прямые слэши)…');
      await zipWithPython();
    } catch {
      console.log('[pack] Python недоступен, крайний случай — PowerShell Compress-Archive.');
      console.log('[pack] ВНИМАНИЕ: пути в архиве будут с обратными слэшами, проверь распаковку.');
      await zipWithPowerShell();
    }
  }

  const size = (await stat(OUT)).size / 1024 / 1024;
  console.log(`[pack] готово: dist/game.zip — ${size.toFixed(1)} МБ`);
  if (size > 100) console.log('[pack] ВНИМАНИЕ: больше 100 МБ — лимит Яндекс Игр. Сожми картинки (npm run optimize).');
}

main().catch((e) => {
  console.error('[pack]', e.message);
  process.exit(1);
});
