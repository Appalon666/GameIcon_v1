/**
 * Собирает архив для загрузки в консоль Яндекс Игр: dist/game.zip из
 * содержимого public/ (index.html должен лежать в корне архива).
 *
 * Сборки как таковой почти нет: единственная правка по дороге — из data/*.json
 * убираются служебные поля пайплайна (DROP_FIELDS), чтобы в архив не уезжали
 * адреса сторонних сайтов. Поэтому пакуется не public/, а его копия в
 * dist/stage. Архив вне git
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
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { ROOT } from './lib.mjs';
import { buildBundle, describeBundle } from './bundle.mjs';

const SCRIPTS = join(ROOT, 'scripts');

const PUBLIC = join(ROOT, 'public');
const DIST = join(ROOT, 'dist');
const OUT = join(DIST, 'game.zip');
/**
 * Промежуточная папка: архив собирается не из public/ напрямую, а из копии,
 * у которой из данных вычищены служебные поля (см. DROP_FIELDS).
 */
const STAGE = join(DIST, 'stage');

/**
 * Сырые данные пайплайна, которые в архив не едут: игра читает только
 * data/bundle.json (см. scripts/bundle.mjs), а в этих трёх — адреса источников,
 * авторы и пометки ручной проверки.
 *
 * Требования запрещают в игре ссылки и домены на сторонние ресурсы (п. 8.4.2),
 * а «в игре» — это весь архив, а не только то, что видно на экране: модератор
 * листает файлы. В icons.json и shots.json лежало 1837 адресов
 * cdn2.steamgriddb.com и store.steampowered.com — ровно те два домена, за
 * которые уже приходило замечание по модалке «Об игре». Раньше поля вычищали
 * по одному на пути в архив; теперь файлы в него просто не кладутся.
 * В репозитории они остаются: происхождение каждого файла восстановимо.
 */
const RAW_DATA = ['games.json', 'icons.json', 'shots.json'];

const run = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, ...opts }, (err, out, errout) =>
      err ? reject(new Error(errout || err.message)) : resolve(out),
    );
  });

/**
 * Готовит STAGE: копия public/ со свежим bundle.json и без сырых данных.
 * Возвращает сводку по сборке данных — для отчёта в консоль.
 */
async function stagePublic() {
  // Пересобираем всегда: bundle в public/ мог отстать от правок данных.
  const bundle = await buildBundle();
  await rm(STAGE, { recursive: true, force: true });
  await cp(PUBLIC, STAGE, { recursive: true });
  for (const file of RAW_DATA) await rm(join(STAGE, 'data', file), { force: true });
  return bundle;
}

async function zipWithZip() {
  // zip кладёт пути относительно cwd — запускаем из папки-источника, чтобы
  // index.html оказался в корне архива.
  await run('zip', ['-r', '-q', OUT, '.'], { cwd: STAGE });
}

async function zipWithPython() {
  const script = join(SCRIPTS, 'zipdir.py');
  // Пробуем разные имена интерпретатора (python / py -3 / python3).
  const tries = [['python', [script, STAGE, OUT]], ['py', ['-3', script, STAGE, OUT]], ['python3', [script, STAGE, OUT]]];
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
    `Compress-Archive -Path '${STAGE}\\*' -DestinationPath '${OUT}' -Force`,
  ]);
}

async function main() {
  await mkdir(DIST, { recursive: true });
  await rm(OUT, { force: true });

  const bundle = await stagePublic();
  console.log(`[pack] ${describeBundle(bundle)}; сырые данные в архив не кладём`);

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

  await rm(STAGE, { recursive: true, force: true });

  const size = (await stat(OUT)).size / 1024 / 1024;
  console.log(`[pack] готово: dist/game.zip — ${size.toFixed(1)} МБ`);
  if (size > 100) console.log('[pack] ВНИМАНИЕ: больше 100 МБ — лимит Яндекс Игр. Сожми картинки (npm run optimize).');
}

main().catch((e) => {
  console.error('[pack]', e.message);
  process.exit(1);
});
